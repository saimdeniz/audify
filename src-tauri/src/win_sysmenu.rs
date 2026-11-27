//! Blocks keyboard-triggered Win32 System Menu (`WM_SYSCOMMAND` / `SC_KEYMENU`)
//! on frameless Audify windows so `Alt+Scroll` zoom, `Alt+Drag` clone, and `Alt+Click`
//! never leave Windows in menu-bar focus mode or pop open the top-left OS window menu
//! when the user next presses `Space` to play.
//!
//! Preserves `Alt+F4` (`SC_CLOSE`), `Alt+Tab`, Turkish-Q `AltGr`, taskbar right-click
//! system menus, and normal window drag/resize operations.

#[cfg(target_os = "windows")]
mod imp {
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{SC_KEYMENU, WM_NCDESTROY, WM_SYSCOMMAND};

    const SYSMENU_SUBCLASS_ID: usize = 0xA0D1_F100;

    unsafe extern "system" fn sysmenu_subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        uid: usize,
        _ref_data: usize,
    ) -> LRESULT {
        if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == (SC_KEYMENU as usize) {
            return LRESULT(0);
        }
        if msg == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(sysmenu_subclass_proc), uid);
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn install_sysmenu_guard(window: &tauri::WebviewWindow) {
        if let Ok(raw_hwnd) = window.hwnd() {
            let hwnd = HWND(raw_hwnd.0);
            unsafe {
                let _ = SetWindowSubclass(hwnd, Some(sysmenu_subclass_proc), SYSMENU_SUBCLASS_ID, 0);
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::install_sysmenu_guard;

#[cfg(not(target_os = "windows"))]
pub fn install_sysmenu_guard(_window: &tauri::WebviewWindow) {}
