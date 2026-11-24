//! Windows WebView2 memory target level control + SQLite page-cache trimming.
//!
//! Switches hidden/minimized or Edge-Peek collapsed WebView2 instances to
//! `COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW` so Chromium aggressively trims
//! V8/Blink heaps and GPU caches in the background (~70–110 MB target), while
//! restoring `NORMAL` instantaneously when the window becomes visible again.

use crate::audio_engine::AudioEngineState;
use crate::db::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

static MAIN_MINIMIZED: AtomicBool = AtomicBool::new(false);
static DB_SHRINK_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct DbShrinkInFlightGuard;
impl Drop for DbShrinkInFlightGuard {
    fn drop(&mut self) {
        DB_SHRINK_IN_FLIGHT.store(false, Ordering::Release);
    }
}

/// Applies WebView2 `MemoryUsageTargetLevel` (`Low` vs `Normal`) to the named window
/// and asynchronously trims SQLite + audio decode caches ONLY when the main window enters low-memory mode.
pub fn set_webview_low_memory(app: &tauri::AppHandle, label: &str, low: bool) {
    if low && label == "main" {
        if let Some(engine) = app.try_state::<AudioEngineState>() {
            engine.trim_caches();
        }
        if let Some(state) = app.try_state::<AppState>() {
            if !DB_SHRINK_IN_FLIGHT.swap(true, Ordering::AcqRel) {
                let guard = DbShrinkInFlightGuard;
                let state_owned = state.inner().clone();
                let _ = std::thread::Builder::new()
                    .name("audify-db-shrink".to_string())
                    .spawn(move || {
                        let _guard = guard;
                        state_owned.shrink_all_db_memory();
                    });
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;

        let Some(win) = app.get_webview_window(label) else {
            return;
        };
        let _ = win.with_webview(move |wv| unsafe {
            if let Ok(core) = wv.controller().CoreWebView2() {
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let level = if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    };
                    let _ = core19.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = label;
    }
}

/// Tracks main window minimize / restore transitions without penalizing Always-on-Top
/// visible windows when the user clicks into an NLE or DAW.
pub fn sync_main_window_minimized(window: &tauri::Window, force_restored: bool) {
    let minimized = if force_restored {
        false
    } else {
        window.is_minimized().unwrap_or(false)
    };
    let prev = MAIN_MINIMIZED.swap(minimized, Ordering::SeqCst);
    if prev != minimized {
        set_webview_low_memory(window.app_handle(), "main", minimized);
    }
}
