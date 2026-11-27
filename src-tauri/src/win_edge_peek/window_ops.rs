//! Low-level Win32 DWM cloak, layered alpha/click-through, DPI, and frame-bounds helpers.

use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use windows::core::BOOL;
use windows::Win32::Foundation::{COLORREF, HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowRect, IsWindow, SetLayeredWindowAttributes, SetWindowLongPtrW,
    SetWindowPos, GWL_EXSTYLE, LWA_ALPHA, SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(vkey: i32) -> i16;
    fn GetDpiForWindow(hwnd: HWND) -> u32;
}

const VK_LBUTTON: i32 = 0x01;
const VK_RBUTTON: i32 = 0x02;

pub(super) fn live_window_scale(hwnd: HWND, fallback: f64) -> f64 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if (48..=480).contains(&dpi) {
        (dpi as f64 / 96.0).clamp(0.75, 4.0)
    } else {
        fallback.clamp(0.75, 4.0)
    }
}

pub(super) struct EdgePeekRestoreGuard {
    pub(super) app: AppHandle,
    pub(super) hwnd_raw: isize,
    pub(super) gen: u64,
    pub(super) gen_arc: Arc<AtomicU64>,
}

impl Drop for EdgePeekRestoreGuard {
    fn drop(&mut self) {
        if std::thread::panicking() || self.gen_arc.load(Ordering::Acquire) == self.gen {
            dispatch_restore_window_normal(&self.app, self.hwnd_raw);
        }
    }
}

pub(super) fn any_mouse_button_down() -> bool {
    unsafe {
        ((GetAsyncKeyState(VK_LBUTTON) as u16) & 0x8000) != 0
            || ((GetAsyncKeyState(VK_RBUTTON) as u16) & 0x8000) != 0
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct FrameInsets {
    pub(super) left: i32,
    pub(super) top: i32,
    pub(super) right: i32,
    pub(super) bottom: i32,
}

pub(super) fn measure_visible_rect_and_insets(hwnd: HWND) -> Option<(RECT, FrameInsets)> {
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

pub(super) fn set_dwm_cloak(hwnd: HWND, cloaked: bool) -> bool {
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

pub(super) fn set_layered_state(hwnd: HWND, alpha: u8, click_through: bool) {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return;
        }
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

/// Dispatches layered alpha/click-through and optional DWM cloak transitions atomically on
/// the Win32 main UI thread so cloak/alpha ordering never flashes a 1-frame opaque artifact.
#[allow(clippy::too_many_arguments)]
pub(super) fn dispatch_layered_and_cloak(
    app: &AppHandle,
    hwnd_raw: isize,
    alpha_if_cloaked: Option<u8>,
    alpha: u8,
    click_through: bool,
    cloak_before: Option<bool>,
    cloak_after: Option<bool>,
    gen: u64,
    gen_arc: &Arc<AtomicU64>,
) {
    let gen_check = Arc::clone(gen_arc);
    let _ = app.run_on_main_thread(move || {
        if gen_check.load(Ordering::Acquire) != gen {
            return;
        }
        let hwnd = HWND(hwnd_raw as *mut c_void);
        let mut effective_alpha = alpha;
        if let Some(cloak) = cloak_before {
            let cloaked_ok = set_dwm_cloak(hwnd, cloak);
            if cloak && cloaked_ok {
                if let Some(a) = alpha_if_cloaked {
                    effective_alpha = a;
                }
            }
        }
        set_layered_state(hwnd, effective_alpha, click_through);
        if let Some(cloak) = cloak_after {
            let _ = set_dwm_cloak(hwnd, cloak);
        }
    });
}

/// Dispatches `SetWindowLongPtrW` / `SetLayeredWindowAttributes` onto the Win32 main UI thread
/// so background Edge-Peek workers never synchronously send `WM_STYLECHANGING` across threads.
pub(super) fn dispatch_layered_state(
    app: &AppHandle,
    hwnd_raw: isize,
    alpha: u8,
    click_through: bool,
    gen: u64,
    gen_arc: &Arc<AtomicU64>,
) {
    dispatch_layered_and_cloak(
        app,
        hwnd_raw,
        None,
        alpha,
        click_through,
        None,
        None,
        gen,
        gen_arc,
    );
}

/// Dispatches `restore_window_normal` onto the Win32 main UI thread (safe from any worker thread).
pub(in crate::win_edge_peek) fn dispatch_restore_window_normal(app: &AppHandle, hwnd_raw: isize) {
    if hwnd_raw == 0 {
        return;
    }
    let _ = app.run_on_main_thread(move || {
        restore_window_normal(hwnd_raw);
    });
}

pub(in crate::win_edge_peek) fn restore_window_normal(hwnd_raw: isize) {
    if hwnd_raw == 0 {
        return;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut c_void);
        if !IsWindow(Some(hwnd)).as_bool() {
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
                None,
                0,
                0,
                0,
                0,
                SWP_ASYNCWINDOWPOS
                    | SWP_NOACTIVATE
                    | SWP_NOMOVE
                    | SWP_NOSIZE
                    | SWP_NOZORDER
                    | SWP_FRAMECHANGED,
            );
        }
    }
}
