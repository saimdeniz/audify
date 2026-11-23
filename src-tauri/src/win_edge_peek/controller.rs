//! Win32 DWM Cloak + Extended Frame Bounds + Hover/Drag Edge-Peek loop.

use super::pill_window::{compute_pill_dimensions, take_pill_clicked, NativeEdgePill};
use super::{EdgePeekInner, EdgePeekStatePayload, EdgePillTheme, EdgeSide, EDGE_PEEK_STATE_EVENT};
use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{BOOL, COLORREF, HWND, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindow,
    SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
    LWA_ALPHA, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(vkey: i32) -> i16;
}

const VK_LBUTTON: i32 = 0x01;
const VK_RBUTTON: i32 = 0x02;

fn any_mouse_button_down() -> bool {
    unsafe {
        ((GetAsyncKeyState(VK_LBUTTON) as u16) & 0x8000) != 0
            || ((GetAsyncKeyState(VK_RBUTTON) as u16) & 0x8000) != 0
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct FrameInsets {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn measure_visible_rect_and_insets(hwnd: HWND) -> Option<(RECT, FrameInsets)> {
    unsafe {
        let mut win_rect = RECT::default();
        if GetWindowRect(hwnd, &mut win_rect).is_err() {
            return None;
        }
        let mut frame_rect = RECT::default();
        let got_dwm = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut frame_rect as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        )
        .is_ok();
        if got_dwm && frame_rect.right > frame_rect.left && frame_rect.bottom > frame_rect.top {
            let insets = FrameInsets {
                left: (frame_rect.left - win_rect.left).max(0),
                top: (frame_rect.top - win_rect.top).max(0),
                right: (win_rect.right - frame_rect.right).max(0),
                bottom: (win_rect.bottom - frame_rect.bottom).max(0),
            };
            Some((frame_rect, insets))
        } else {
            Some((win_rect, FrameInsets::default()))
        }
    }
}

fn set_dwm_cloak(hwnd: HWND, cloaked: bool) -> bool {
    unsafe {
        let val = BOOL(if cloaked { 1 } else { 0 });
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_CLOAK,
            &val as *const BOOL as *const c_void,
            size_of::<BOOL>() as u32,
        )
        .is_ok()
    }
}

fn set_layered_state(hwnd: HWND, alpha: u8, click_through: bool) {
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let mut next = ex | (WS_EX_LAYERED.0 as isize);
        if click_through {
            next |= WS_EX_TRANSPARENT.0 as isize;
        } else {
            next &= !(WS_EX_TRANSPARENT.0 as isize);
        }
        if next != ex {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA);
    }
}

pub(super) fn restore_window_normal(hwnd_raw: isize) {
    if hwnd_raw == 0 {
        return;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw);
        if !IsWindow(hwnd).as_bool() {
            return;
        }
        let _ = set_dwm_cloak(hwnd, false);
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if (ex & (WS_EX_LAYERED.0 as isize)) != 0 {
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        }
        let cleaned = ex & !(WS_EX_LAYERED.0 as isize) & !(WS_EX_TRANSPARENT.0 as isize);
        if cleaned != ex {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, cleaned);
            let _ = SetWindowPos(
                hwnd,
                HWND(0),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
            );
        }
    }
}

pub(super) fn snap_window_to_edge(hwnd_raw: isize, side: EdgeSide, scale: f64) -> Option<RECT> {
    if hwnd_raw == 0 {
        return None;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw);
        if !IsWindow(hwnd).as_bool() {
            return None;
        }
        let (vis_rect, insets) = measure_visible_rect_and_insets(hwnd)?;
        let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(hmon, &mut mi).as_bool() {
            return None;
        }
        let work = mi.rcWork;
        let min_w = (440.0 * scale).round() as i32;
        let min_h = (500.0 * scale).round() as i32;
        let work_w = (work.right - work.left).max(min_w);
        let work_h = (work.bottom - work.top).max(min_h);
        let vis_w = (vis_rect.right - vis_rect.left).clamp(min_w, work_w);
        let vis_h = (vis_rect.bottom - vis_rect.top).clamp(min_h, work_h);
        let vis_top = vis_rect
            .top
            .clamp(work.top, (work.bottom - vis_h).max(work.top));
        let vis_left = match side {
            EdgeSide::Right => work.right - vis_w,
            EdgeSide::Left => work.left,
        };

        let hwnd_x = vis_left - insets.left;
        let hwnd_y = vis_top - insets.top;
        let hwnd_w = vis_w + insets.left + insets.right;
        let hwnd_h = vis_h + insets.top + insets.bottom;

        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            hwnd_x,
            hwnd_y,
            hwnd_w,
            hwnd_h,
            SWP_NOACTIVATE,
        );
        Some(RECT {
            left: vis_left,
            top: vis_top,
            right: vis_left + vis_w,
            bottom: vis_top + vis_h,
        })
    }
}

fn compute_pill_rect(vis_rect: RECT, work: RECT, scale: f64, side: EdgeSide) -> (i32, i32, i32, i32) {
    let work_h = (work.bottom - work.top).max(64);
    let (pill_w, pill_h) = compute_pill_dimensions(work_h, scale);
    let center_y = ((vis_rect.top + vis_rect.bottom) / 2)
        .clamp(work.top + pill_h / 2, work.bottom - pill_h / 2);
    let pill_y = (center_y - pill_h / 2).clamp(work.top, (work.bottom - pill_h).max(work.top));
    let pill_x = match side {
        EdgeSide::Right => work.right - pill_w,
        EdgeSide::Left => work.left,
    };
    (pill_x, pill_y, pill_w, pill_h)
}

fn fade_window(
    hwnd: HWND,
    expanding: bool,
    gen: u64,
    gen_arc: &AtomicU64,
    pill: Option<&NativeEdgePill>,
) {
    let steps = 6i32;
    for step in 1..=steps {
        if gen_arc.load(Ordering::Acquire) != gen {
            return;
        }
        let linear = (step as f32) / (steps as f32);
        let ease = if expanding {
            1.0 - (1.0 - linear).powi(3)
        } else {
            (1.0 - linear).powi(2)
        };
        let alpha = (ease * 255.0).round().clamp(0.0, 255.0) as u8;
        set_layered_state(hwnd, alpha, !expanding);
        if let Some(p) = pill {
            p.pump_messages();
        }
        std::thread::sleep(Duration::from_millis(14));
    }
}

fn current_theme(inner: &Arc<Mutex<EdgePeekInner>>) -> EdgePillTheme {
    inner.lock().map(|g| g.theme).unwrap_or_default()
}

fn monitor_work_area(hwnd: HWND) -> Option<RECT> {
    unsafe {
        let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(hmon, &mut mi).as_bool() {
            Some(mi.rcWork)
        } else {
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_edge_peek_loop(
    app: AppHandle,
    hwnd_raw: isize,
    side: EdgeSide,
    scale: f64,
    gen: u64,
    inner: Arc<Mutex<EdgePeekInner>>,
    hold_open: Arc<AtomicBool>,
    wake_requested: Arc<AtomicBool>,
    gen_arc: Arc<AtomicU64>,
) {
    let hwnd = HWND(hwnd_raw);
    let mut pill = NativeEdgePill::new();
    let mut collapsed = false;
    let mut outside_since: Option<Instant> = None;
    let mut trigger_since: Option<Instant> = None;
    let mut cached_vis_rect = measure_visible_rect_and_insets(hwnd)
        .map(|(r, _)| r)
        .unwrap_or_default();

    while gen_arc.load(Ordering::Acquire) == gen {
        if let Some(ref p) = pill {
            p.pump_messages();
        }
        if !unsafe { IsWindow(hwnd).as_bool() } {
            break;
        }
        if unsafe { IsIconic(hwnd).as_bool() } {
            if let Some(ref mut p) = pill {
                p.hide();
            }
            if collapsed {
                collapsed = false;
                restore_window_normal(hwnd_raw);
                if let Ok(mut guard) = inner.lock() {
                    guard.collapsed = false;
                }
                let _ = app.emit(
                    EDGE_PEEK_STATE_EVENT,
                    EdgePeekStatePayload {
                        enabled: true,
                        collapsed: false,
                        side: side.as_str().to_string(),
                    },
                );
            }
            outside_since = None;
            trigger_since = None;
            std::thread::sleep(Duration::from_millis(60));
            continue;
        }

        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt).is_err() } {
            std::thread::sleep(Duration::from_millis(24));
            continue;
        }
        let Some(work) = monitor_work_area(hwnd) else {
            std::thread::sleep(Duration::from_millis(24));
            continue;
        };

        let is_native_drag = crate::win_drag::is_native_file_drag_active();
        let mouse_down = any_mouse_button_down();
        let is_held = hold_open.load(Ordering::Acquire);
        let theme = current_theme(&inner);

        if collapsed {
            let (pill_x, pill_y, pill_w, pill_h) =
                compute_pill_rect(cached_vis_rect, work, scale, side);
            let in_y = pt.y >= pill_y - 12 && pt.y <= pill_y + pill_h + 12;
            let in_x = match side {
                EdgeSide::Right => pt.x >= pill_x - 3 && pt.x <= work.right + 4,
                EdgeSide::Left => pt.x >= work.left - 4 && pt.x <= pill_x + pill_w + 3,
            };
            let pill_hovered = in_x && in_y && !is_native_drag;

            if let Some(ref mut p) = pill {
                p.show_or_update(
                    pill_x,
                    pill_y,
                    pill_w,
                    pill_h,
                    scale,
                    side,
                    theme,
                    pill_hovered,
                );
            }

            let clicked = take_pill_clicked();
            let woke_by_focus = wake_requested.swap(false, Ordering::AcqRel);
            let hover_ready = if pill_hovered && !mouse_down {
                let entered = *trigger_since.get_or_insert_with(Instant::now);
                entered.elapsed() >= Duration::from_millis(35)
            } else {
                trigger_since = None;
                false
            };

            if clicked || woke_by_focus || hover_ready {
                trigger_since = None;
                outside_since = None;
                collapsed = false;
                if let Ok(mut guard) = inner.lock() {
                    guard.collapsed = false;
                }
                let _ = app.emit(
                    EDGE_PEEK_STATE_EVENT,
                    EdgePeekStatePayload {
                        enabled: true,
                        collapsed: false,
                        side: side.as_str().to_string(),
                    },
                );
                if let Some(ref mut p) = pill {
                    p.hide();
                }
                set_layered_state(hwnd, 0, false);
                let _ = set_dwm_cloak(hwnd, false);
                unsafe {
                    let _ = SetWindowPos(
                        hwnd,
                        HWND_TOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                    );
                }
                fade_window(hwnd, true, gen, &gen_arc, pill.as_ref());
                if gen_arc.load(Ordering::Acquire) == gen {
                    restore_window_normal(hwnd_raw);
                }
            }
        } else {
            let _ = take_pill_clicked();
            wake_requested.store(false, Ordering::Release);
            if let Some((vis_rect, _)) = measure_visible_rect_and_insets(hwnd) {
                cached_vis_rect = vis_rect;
            }

            let inside_window = pt.x >= cached_vis_rect.left
                && pt.x <= cached_vis_rect.right
                && pt.y >= cached_vis_rect.top
                && pt.y <= cached_vis_rect.bottom;
            let drag_left_dock = is_native_drag
                && match side {
                    EdgeSide::Right => pt.x < cached_vis_rect.left - 24,
                    EdgeSide::Left => pt.x > cached_vis_rect.right + 24,
                };

            let should_collapse = if drag_left_dock {
                outside_since = None;
                true
            } else if !inside_window && !mouse_down && !is_held {
                let left_at = *outside_since.get_or_insert_with(Instant::now);
                if left_at.elapsed() >= Duration::from_millis(280) {
                    outside_since = None;
                    true
                } else {
                    false
                }
            } else {
                outside_since = None;
                false
            };

            if should_collapse {
                if let Some(snapped_vis) = snap_window_to_edge(hwnd_raw, side, scale) {
                    cached_vis_rect = snapped_vis;
                }
                let (pill_x, pill_y, pill_w, pill_h) =
                    compute_pill_rect(cached_vis_rect, work, scale, side);
                if let Some(ref mut p) = pill {
                    p.show_or_update(pill_x, pill_y, pill_w, pill_h, scale, side, theme, false);
                }
                fade_window(hwnd, false, gen, &gen_arc, pill.as_ref());
                if gen_arc.load(Ordering::Acquire) != gen {
                    break;
                }
                let cloaked = set_dwm_cloak(hwnd, true);
                // Keep alpha at 255 while DWM-cloaked so taskbar thumbnail stays clean & intact,
                // while WS_EX_LAYERED | WS_EX_TRANSPARENT ensures 100% click-through.
                set_layered_state(hwnd, if cloaked { 255 } else { 0 }, true);
                collapsed = true;
                if let Ok(mut guard) = inner.lock() {
                    guard.collapsed = true;
                }
                let _ = app.emit(
                    EDGE_PEEK_STATE_EVENT,
                    EdgePeekStatePayload {
                        enabled: true,
                        collapsed: true,
                        side: side.as_str().to_string(),
                    },
                );
            }
        }

        std::thread::sleep(Duration::from_millis(20));
    }

    if let Some(ref mut p) = pill {
        p.hide();
    }
    drop(pill);
    if gen_arc.load(Ordering::Acquire) == gen {
        restore_window_normal(hwnd_raw);
    }
}
