//! Win32 DWM Cloak + Extended Frame Bounds + Hover/Drag Edge-Peek loop.

#[path = "window_ops.rs"]
mod window_ops;

use super::pill_window::{compute_pill_dimensions, take_pill_clicked, NativeEdgePill};
use super::{EdgePeekInner, EdgePeekStatePayload, EdgePillTheme, EdgeSide, EDGE_PEEK_STATE_EVENT};
use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
pub(super) use window_ops::{dispatch_restore_window_normal, restore_window_normal};
use window_ops::{
    any_mouse_button_down, dispatch_layered_and_cloak, dispatch_layered_state, live_window_scale,
    measure_visible_rect_and_insets, EdgePeekRestoreGuard,
};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, IsIconic, IsWindow, SetWindowPos, HWND_TOPMOST, SWP_ASYNCWINDOWPOS,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

pub(super) fn snap_window_to_edge(hwnd_raw: isize, side: EdgeSide, scale: f64) -> Option<RECT> {
    if hwnd_raw == 0 {
        return None;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut c_void);
        if !IsWindow(Some(hwnd)).as_bool() {
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
            Some(HWND_TOPMOST),
            hwnd_x,
            hwnd_y,
            hwnd_w,
            hwnd_h,
            SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE,
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
    let raw_work_h = (work.bottom - work.top).max(1);
    let (pill_w, raw_pill_h) = compute_pill_dimensions(raw_work_h, scale);
    let pill_h = raw_pill_h.min(raw_work_h).max(1);
    let min_center = work.top.saturating_add(pill_h / 2);
    let max_center = work.bottom.saturating_sub(pill_h / 2).max(min_center);
    let center_y = ((vis_rect.top.saturating_add(vis_rect.bottom)) / 2).clamp(min_center, max_center);
    let max_top = work.bottom.saturating_sub(pill_h).max(work.top);
    let pill_y = (center_y - pill_h / 2).clamp(work.top, max_top);
    let pill_x = match side {
        EdgeSide::Right => work.right - pill_w,
        EdgeSide::Left => work.left,
    };
    (pill_x, pill_y, pill_w, pill_h)
}

fn fade_window(
    app: &AppHandle,
    hwnd_raw: isize,
    expanding: bool,
    gen: u64,
    gen_arc: &Arc<AtomicU64>,
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
        dispatch_layered_state(app, hwnd_raw, alpha, !expanding, gen, gen_arc);
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
    let hwnd = HWND(hwnd_raw as *mut c_void);
    let _restore_guard = EdgePeekRestoreGuard {
        app: app.clone(),
        hwnd_raw,
        gen,
        gen_arc: Arc::clone(&gen_arc),
    };
    let mut pill = NativeEdgePill::new();
    let mut collapsed = false;
    let mut collapsed_since: Option<Instant> = None;
    let mut low_mem_applied = false;
    let mut outside_since: Option<Instant> = None;
    let mut trigger_since: Option<Instant> = None;
    let mut cached_vis_rect = measure_visible_rect_and_insets(hwnd)
        .map(|(r, _)| r)
        .unwrap_or_default();
    let fallback_scale = scale;

    while gen_arc.load(Ordering::Acquire) == gen {
        let scale = live_window_scale(hwnd, fallback_scale);
        if let Some(ref p) = pill {
            p.pump_messages();
        }
        if !unsafe { IsWindow(Some(hwnd)).as_bool() } {
            break;
        }
        if unsafe { IsIconic(hwnd).as_bool() } {
            if let Some(ref mut p) = pill {
                p.hide();
            }
            if collapsed {
                collapsed = false;
                collapsed_since = None;
                low_mem_applied = false;
                dispatch_restore_window_normal(&app, hwnd_raw);
                if let Ok(mut guard) = inner.lock() {
                    guard.collapsed = false;
                }
                // Window is still minimized (IsIconic) — keep LOW memory intact!
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

            // Only enter LOW memory after staying collapsed continuously for 20s so rapid
            // NLE drag-out-and-back workflows never thrash V8/SQLite hot caches.
            if !low_mem_applied
                && collapsed_since
                    .map(|t| t.elapsed() >= Duration::from_secs(20))
                    .unwrap_or(false)
            {
                low_mem_applied = true;
                crate::win_memory::set_webview_low_memory(&app, "main", true);
            }

            if clicked || woke_by_focus || hover_ready {
                trigger_since = None;
                outside_since = None;
                collapsed = false;
                collapsed_since = None;
                if let Ok(mut guard) = inner.lock() {
                    guard.collapsed = false;
                }
                if low_mem_applied {
                    low_mem_applied = false;
                    crate::win_memory::set_webview_low_memory(&app, "main", false);
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
                // Apply alpha=0 BEFORE uncloaking inside one main-thread turn (zero opaque 1-frame flash)
                dispatch_layered_and_cloak(
                    &app,
                    hwnd_raw,
                    None,
                    0,
                    false,
                    None,
                    Some(false),
                    gen,
                    &gen_arc,
                );
                unsafe {
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                    );
                }
                fade_window(&app, hwnd_raw, true, gen, &gen_arc, pill.as_ref());
                if gen_arc.load(Ordering::Acquire) == gen {
                    dispatch_restore_window_normal(&app, hwnd_raw);
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
                fade_window(&app, hwnd_raw, false, gen, &gen_arc, pill.as_ref());
                if gen_arc.load(Ordering::Acquire) != gen {
                    break;
                }
                // Cloak FIRST, then set alpha=255 (taskbar thumbnail intact) & WS_EX_TRANSPARENT
                // atomically on the Win32 main thread so no opaque frame can leak before cloak.
                dispatch_layered_and_cloak(
                    &app,
                    hwnd_raw,
                    Some(255),
                    0,
                    true,
                    Some(true),
                    None,
                    gen,
                    &gen_arc,
                );
                collapsed = true;
                collapsed_since = Some(Instant::now());
                low_mem_applied = false;
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

        let sleep_ms = if collapsed {
            let edge_dist = match side {
                EdgeSide::Right => (work.right - pt.x).abs(),
                EdgeSide::Left => (pt.x - work.left).abs(),
            };
            if edge_dist > 320 {
                140
            } else if edge_dist > 140 {
                85
            } else {
                20
            }
        } else if !is_native_drag && outside_since.is_none() {
            50
        } else {
            20
        };
        std::thread::sleep(Duration::from_millis(sleep_ms));
    }

    if let Some(ref mut p) = pill {
        p.hide();
    }
    drop(pill);
    if low_mem_applied && !unsafe { IsIconic(hwnd).as_bool() } {
        crate::win_memory::set_webview_low_memory(&app, "main", false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_pill_rect_never_panics_on_tiny_or_inverted_work_area() {
        let vis = RECT {
            left: 100,
            top: 0,
            right: 540,
            bottom: 40,
        };
        let tiny_work = RECT {
            left: 0,
            top: 10,
            right: 1920,
            bottom: 30,
        };
        let (x, y, w, h) = compute_pill_rect(vis, tiny_work, 1.5, EdgeSide::Right);
        assert!(w > 0);
        assert!((1..=20).contains(&h));
        assert!((tiny_work.top..=tiny_work.bottom).contains(&y));
        assert_eq!(x, tiny_work.right - w);

        let inverted_work = RECT {
            left: 0,
            top: 100,
            right: 1920,
            bottom: 100,
        };
        let (_, y2, _, h2) = compute_pill_rect(vis, inverted_work, 1.0, EdgeSide::Left);
        assert_eq!(h2, 1);
        assert_eq!(y2, inverted_work.top);
    }
}
