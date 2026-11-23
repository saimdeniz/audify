//! Windows Edge-Peek Auto-Hide Controller for Audify Mini Dock (v2 — DWM Cloak + Native Pill).
//!
//! Architecture:
//! - Zero `SetWindowRgn` calls (eliminates white `WS_THICKFRAME` border flashes and broken DWM
//!   taskbar thumbnails permanently).
//! - Compensates invisible Windows `WS_THICKFRAME` margins via `DwmGetWindowAttribute`
//!   (`DWMWA_EXTENDED_FRAME_BOUNDS`) so the Mini Dock sits 0px flush on the monitor edge and
//!   strictly within the taskbar-excluded `rcWork` area.
//! - On collapse: fades smoothly with `WS_EX_LAYERED` (`LWA_ALPHA`), cloaks the window via
//!   `DwmSetWindowAttribute(DWMWA_CLOAK)` while marking it click-through (`WS_EX_TRANSPARENT`)
//!   and keeping its taskbar entry intact, and displays a zero-RAM native layered Win32 edge pill
//!   painted in Audify's live theme & accent colors.
//! - On expand (hover pill, click pill, or Taskbar/Alt+Tab focus): uncloaks + fades smoothly
//!   with `SWP_NOACTIVATE` (so NLE focus stays untouched on hover), then restores pure unlayered
//!   hardware presentation on the main WebView2 window.

#[cfg(target_os = "windows")]
mod controller;
#[cfg(target_os = "windows")]
mod pill_window;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

pub const EDGE_PEEK_STATE_EVENT: &str = "audify:edge-peek-state";
pub const PILL_WIDTH_LOGICAL: f64 = 10.0;
pub const PILL_HEIGHT_LOGICAL: f64 = 148.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EdgeSide {
    #[default]
    Right,
    Left,
}

impl EdgeSide {
    pub fn from_opt_str(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some("left") => Self::Left,
            _ => Self::Right,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Right => "right",
            Self::Left => "left",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EdgePillTheme {
    pub surface: (u8, u8, u8),
    pub border: (u8, u8, u8),
    pub accent: (u8, u8, u8),
    pub is_light: bool,
}

impl Default for EdgePillTheme {
    fn default() -> Self {
        Self {
            surface: (19, 21, 26),
            border: (46, 52, 64),
            accent: (56, 189, 248),
            is_light: false,
        }
    }
}

pub fn parse_hex_rgb(raw: &str) -> Option<(u8, u8, u8)> {
    let trimmed = raw.trim();
    let hex = trimmed.strip_prefix('#').unwrap_or(trimmed);
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgePeekStatePayload {
    pub enabled: bool,
    pub collapsed: bool,
    pub side: String,
}

#[derive(Default)]
struct EdgePeekInner {
    enabled: bool,
    collapsed: bool,
    side: EdgeSide,
    theme: EdgePillTheme,
}

pub struct EdgePeekState {
    inner: Arc<Mutex<EdgePeekInner>>,
    hold_open: Arc<AtomicBool>,
    wake_requested: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
}

impl Default for EdgePeekState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(EdgePeekInner::default())),
            hold_open: Arc::new(AtomicBool::new(false)),
            wake_requested: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl EdgePeekState {
    pub fn set_hold_open(&self, hold: bool) {
        self.hold_open.store(hold, Ordering::Release);
    }

    pub fn notify_main_focused(&self) {
        let should_wake = {
            let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            guard.enabled && guard.collapsed
        };
        if should_wake {
            self.wake_requested.store(true, Ordering::Release);
        }
    }

    pub fn set_theme(
        &self,
        surface_hex: &str,
        border_hex: &str,
        accent_hex: &str,
        is_light: bool,
    ) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let surface = parse_hex_rgb(surface_hex).unwrap_or(guard.theme.surface);
        let border = parse_hex_rgb(border_hex).unwrap_or(guard.theme.border);
        let accent = parse_hex_rgb(accent_hex).unwrap_or(guard.theme.accent);
        guard.theme = EdgePillTheme {
            surface,
            border,
            accent,
            is_light,
        };
    }

    pub fn disable_for_window(&self, app: &AppHandle, window: &WebviewWindow) {
        let _ = self.generation.fetch_add(1, Ordering::AcqRel);
        self.wake_requested.store(false, Ordering::Release);
        let side = {
            let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            guard.enabled = false;
            guard.collapsed = false;
            guard.side
        };
        #[cfg(target_os = "windows")]
        {
            if let Ok(hwnd) = window.hwnd() {
                controller::restore_window_normal(hwnd.0 as isize);
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = window;
        }
        let _ = app.emit(
            EDGE_PEEK_STATE_EVENT,
            EdgePeekStatePayload {
                enabled: false,
                collapsed: false,
                side: side.as_str().to_string(),
            },
        );
    }
}

#[tauri::command]
pub fn mini_dock_set_edge_peek(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, EdgePeekState>,
    enabled: bool,
    side: Option<String>,
) -> Result<EdgePeekStatePayload, String> {
    if window.label() != "main" {
        return Err("Edge-Peek is only supported on the main window".to_string());
    }

    let chosen_side = EdgeSide::from_opt_str(side.as_deref());
    if !enabled {
        state.disable_for_window(&app, &window);
        return Ok(EdgePeekStatePayload {
            enabled: false,
            collapsed: false,
            side: chosen_side.as_str().to_string(),
        });
    }

    let gen = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    state.wake_requested.store(false, Ordering::Release);
    {
        let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.enabled = true;
        guard.collapsed = false;
        guard.side = chosen_side;
    }

    #[cfg(target_os = "windows")]
    {
        let hwnd_raw = window
            .hwnd()
            .map_err(|e| format!("Failed reading window handle: {}", e))?
            .0 as isize;
        let scale = window.scale_factor().unwrap_or(1.0).clamp(0.75, 4.0);
        controller::restore_window_normal(hwnd_raw);
        controller::snap_window_to_edge(hwnd_raw, chosen_side, scale);

        let app_clone = app.clone();
        let inner_arc = Arc::clone(&state.inner);
        let hold_arc = Arc::clone(&state.hold_open);
        let wake_arc = Arc::clone(&state.wake_requested);
        let gen_arc = Arc::clone(&state.generation);

        std::thread::Builder::new()
            .name("audify-edge-peek".to_string())
            .spawn(move || {
                controller::run_edge_peek_loop(
                    app_clone,
                    hwnd_raw,
                    chosen_side,
                    scale,
                    gen,
                    inner_arc,
                    hold_arc,
                    wake_arc,
                    gen_arc,
                );
            })
            .map_err(|e| format!("Failed starting Edge-Peek monitor: {}", e))?;
    }

    let payload = EdgePeekStatePayload {
        enabled: true,
        collapsed: false,
        side: chosen_side.as_str().to_string(),
    };
    let _ = app.emit(EDGE_PEEK_STATE_EVENT, &payload);
    Ok(payload)
}

#[tauri::command]
pub fn mini_dock_edge_peek_set_hold(state: State<'_, EdgePeekState>, hold: bool) {
    state.set_hold_open(hold);
}

#[tauri::command]
pub fn mini_dock_edge_peek_set_theme(
    state: State<'_, EdgePeekState>,
    surface_hex: String,
    border_hex: String,
    accent_hex: String,
    is_light: bool,
) {
    state.set_theme(&surface_hex, &border_hex, &accent_hex, is_light);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_rgb_accepts_valid_hex_and_rejects_malformed() {
        assert_eq!(parse_hex_rgb("#38BDF8"), Some((56, 189, 248)));
        assert_eq!(parse_hex_rgb("000000"), Some((0, 0, 0)));
        assert_eq!(parse_hex_rgb("#fff"), None);
        assert_eq!(parse_hex_rgb("not-a-color"), None);
    }
}
