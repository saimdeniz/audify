use crate::db::AppState;
use crate::{security, win_drag};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

pub const MAX_DRAG_ICON_BYTES: usize = 2 * 1024 * 1024;

pub const AUDIFY_WEBVIEW_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

static SETTINGS_HIDE_SEQ: AtomicU64 = AtomicU64::new(0);
static SETTINGS_VISIBLE: AtomicBool = AtomicBool::new(false);
static SETTINGS_CREATING: AtomicBool = AtomicBool::new(false);
const SETTINGS_IDLE_DESTROY_DELAY_SECS: u64 = 8;

struct ResetSettingsCreatingGuard;
impl Drop for ResetSettingsCreatingGuard {
    fn drop(&mut self) {
        SETTINGS_CREATING.store(false, Ordering::SeqCst);
    }
}

pub fn on_settings_window_destroyed() {
    // Never clear `SETTINGS_CREATING` here (owned exclusively by `ResetSettingsCreatingGuard`),
    // and ignore stale `Destroyed` events arriving while a fresh Settings window is being built.
    if !SETTINGS_CREATING.load(Ordering::SeqCst) {
        SETTINGS_VISIBLE.store(false, Ordering::SeqCst);
    }
}

static MAIN_WINDOW_FOCUSED: AtomicBool = AtomicBool::new(true);
static SETTINGS_WINDOW_FOCUSED: AtomicBool = AtomicBool::new(false);
static APP_FOCUS_EMIT_SEQ: AtomicU64 = AtomicU64::new(0);
static LAST_EMITTED_APP_ACTIVE: AtomicBool = AtomicBool::new(true);

/// Tracks Audify-wide focus across `main` and `settings` windows so animations pause
/// only when the entire Audify app goes to the background or minimizes (never when
/// switching focus between Main and Settings).
pub fn on_window_focus_changed(app: &tauri::AppHandle, label: &str, focused: bool) {
    use tauri::{Emitter, Manager};

    match label {
        "main" => MAIN_WINDOW_FOCUSED.store(focused, Ordering::SeqCst),
        "settings" => SETTINGS_WINDOW_FOCUSED.store(focused, Ordering::SeqCst),
        _ => return,
    }

    if MAIN_WINDOW_FOCUSED.load(Ordering::SeqCst) || SETTINGS_WINDOW_FOCUSED.load(Ordering::SeqCst) {
        APP_FOCUS_EMIT_SEQ.fetch_add(1, Ordering::SeqCst);
        if !LAST_EMITTED_APP_ACTIVE.swap(true, Ordering::SeqCst) {
            let _ = app.emit("audify:app-focus", true);
        }
        return;
    }

    let seq = APP_FOCUS_EMIT_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(180));
        if APP_FOCUS_EMIT_SEQ.load(Ordering::SeqCst) != seq {
            return;
        }
        let main_active = app_handle
            .get_webview_window("main")
            .map(|w| w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
            .unwrap_or(false);
        let settings_active = app_handle
            .get_webview_window("settings")
            .map(|w| {
                w.is_visible().unwrap_or(false)
                    && w.is_focused().unwrap_or(false)
                    && !w.is_minimized().unwrap_or(false)
            })
            .unwrap_or(false);
        if main_active
            || settings_active
            || MAIN_WINDOW_FOCUSED.load(Ordering::SeqCst)
            || SETTINGS_WINDOW_FOCUSED.load(Ordering::SeqCst)
        {
            return;
        }
        if LAST_EMITTED_APP_ACTIVE.swap(false, Ordering::SeqCst) {
            let _ = app_handle.emit("audify:app-focus", false);
        }
    });
}

/// Hides the Settings window immediately on close, notifies the frontend to unmount
/// heavy tabs and clear caches, and destroys the idle secondary WebView2 process after
/// a short grace period so reopening immediately stays instant while long-term RAM drops to 0.
pub fn on_settings_close_requested(window: &tauri::Window) {
    use tauri::{Emitter, Manager};

    SETTINGS_VISIBLE.store(false, Ordering::SeqCst);
    let seq = SETTINGS_HIDE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = window.emit_to("settings", "audify:settings-visibility", false);
    let _ = window.hide();
    crate::win_memory::set_webview_low_memory(window.app_handle(), "settings", true);
    on_window_focus_changed(window.app_handle(), "settings", false);

    let app_handle = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(SETTINGS_IDLE_DESTROY_DELAY_SECS));
        if SETTINGS_HIDE_SEQ.load(Ordering::SeqCst) != seq
            || SETTINGS_VISIBLE.load(Ordering::SeqCst)
            || SETTINGS_CREATING.load(Ordering::SeqCst)
        {
            return;
        }
        // Dispatch destroy on the main thread with an atomic seq re-check so it can never
        // ABBA-deadlock with window events or race against a concurrent reopen.
        let app_for_main = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            if SETTINGS_HIDE_SEQ.load(Ordering::SeqCst) != seq
                || SETTINGS_VISIBLE.load(Ordering::SeqCst)
                || SETTINGS_CREATING.load(Ordering::SeqCst)
            {
                return;
            }
            if let Some(settings_win) = app_for_main.get_webview_window("settings") {
                let _ = settings_win.destroy();
            }
        });
    });
}

pub use crate::app_cache_helpers::{
    prune_audio_cache_dirs, reconcile_library_asset_scopes, CACHE_PRUNE_MAX_BYTES,
    CACHE_PRUNE_MAX_FILES, CACHE_PRUNE_MIN_AGE_SECS,
};

#[tauri::command]
pub async fn start_native_file_drag(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    paths: Vec<String>,
    icon_png: Option<Vec<u8>>,
) -> Result<bool, String> {
    if paths.is_empty() {
        return Ok(false);
    }

    let state_owned = state.inner().clone();
    let paths_for_check = paths.clone();
    let valid_paths: Vec<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        let validate_all = |conn: &rusqlite::Connection| -> Result<Vec<PathBuf>, String> {
            let scope = security::AuthorizedAudioScope::from_conn(conn, &state_owned.user_dir);
            let mut out = Vec::with_capacity(paths_for_check.len());
            for p in &paths_for_check {
                let trimmed = p.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let resolved = match scope.validate_existing_audio_file(trimmed) {
                    Ok(Some(pb)) => pb,
                    _ => security::validate_audio_path_in_scope(
                        conn,
                        &state_owned.user_dir,
                        trimmed,
                    )?,
                };
                #[cfg(target_os = "windows")]
                let native_pb = PathBuf::from(resolved.to_string_lossy().replace('/', "\\"));
                #[cfg(not(target_os = "windows"))]
                let native_pb = resolved;
                out.push(native_pb);
            }
            Ok(out)
        };

        if let Ok(read_conn) = state_owned.acquire_read_conn() {
            validate_all(&read_conn)
        } else {
            let conn = state_owned.lock_db();
            validate_all(&conn)
        }
    })
    .await
    .map_err(|e| security::sanitize_err(&state.user_dir, &e.to_string()))??;

    if valid_paths.is_empty() {
        return Err("Source audio file not found".to_string());
    }

    // Win32 OLE SHDoDragDrop MUST execute on the main STA thread where OleInitialize runs.
    let (tx, rx) = std::sync::mpsc::channel();
    let user_dir_main = state.user_dir.clone();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "windows")]
        let res = {
            let badge_slice = icon_png
                .as_deref()
                .filter(|b| !b.is_empty() && b.len() <= MAX_DRAG_ICON_BYTES);
            win_drag::start_explorer_file_drag(&window, valid_paths, badge_slice)
                .map_err(|e| security::sanitize_err(&user_dir_main, &e))
        };

        #[cfg(not(target_os = "windows"))]
        let res = {
            use std::sync::atomic::{AtomicBool, Ordering};
            use std::sync::Arc;
            let user_dir_err = user_dir_main.clone();

            let dropped = Arc::new(AtomicBool::new(false));
            let dropped_cb = Arc::clone(&dropped);
            let item = drag::DragItem::Files(valid_paths);
            let image = match icon_png {
                Some(bytes) if !bytes.is_empty() && bytes.len() <= MAX_DRAG_ICON_BYTES => {
                    drag::Image::Raw(bytes)
                }
                _ => drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
            };
            let options = drag::Options {
                skip_animatation_on_cancel_or_failure: true,
                mode: drag::DragMode::Copy,
            };
            drag::start_drag(
                &window,
                item,
                image,
                move |result, _| {
                    if matches!(result, drag::DragResult::Dropped) {
                        dropped_cb.store(true, Ordering::SeqCst);
                    }
                },
                options,
            )
            .map(|_| dropped.load(Ordering::SeqCst))
            .map_err(|e| security::sanitize_err(&user_dir_err, &e.to_string()))
        };

        let _ = tx.send(res);
    })
    .map_err(|e| security::sanitize_err(&state.user_dir, &e.to_string()))?;

    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| security::sanitize_err(&state.user_dir, &e.to_string()))?
        .map_err(|e| security::sanitize_err(&state.user_dir, &e.to_string()))?
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CrossWindowSyncPayload {
    source: String,
    kind: String,
    msg_id: Option<String>,
}

fn allowlisted_settings_tab(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or("profiles").trim() {
        "libraries" => "libraries",
        "appearance" => "appearance",
        "audio" => "audio",
        "ai" => "ai",
        "shortcuts" => "shortcuts",
        "licenses" => "licenses",
        "collections" => "collections",
        "tags" => "tags",
        "genres" => "genres",
        "profiles" => "profiles",
        "advanced" => "advanced",
        _ => "profiles",
    }
}

fn allowlisted_theme_mode(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or("dark").trim() {
        "light" => "light",
        "contrast" => "contrast",
        _ => "dark",
    }
}

pub fn theme_window_bg_color(theme: Option<&str>) -> tauri::window::Color {
    match allowlisted_theme_mode(theme) {
        "light" => tauri::window::Color(245, 245, 247, 255),
        "contrast" => tauri::window::Color(0, 0, 0, 255),
        _ => tauri::window::Color(13, 13, 15, 255),
    }
}

#[tauri::command]
pub async fn sync_window_theme_bg(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    use tauri::Manager;

    let clean_theme = allowlisted_theme_mode(Some(&theme));
    let bg = theme_window_bg_color(Some(clean_theme));
    for label in ["main", "settings"] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_background_color(Some(bg));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_settings_window(
    app: tauri::AppHandle,
    tab: Option<String>,
    always_on_top: Option<bool>,
    theme: Option<String>,
) -> Result<(), String> {
    use tauri::{Emitter, Manager};

    let pin_top = always_on_top.unwrap_or(false);
    let clean_tab = allowlisted_settings_tab(tab.as_deref());
    let clean_theme = allowlisted_theme_mode(theme.as_deref());
    let bg = theme_window_bg_color(Some(clean_theme));

    let open_seq = SETTINGS_HIDE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    SETTINGS_VISIBLE.store(true, Ordering::SeqCst);

    // Serialize concurrent clicks while building a fresh settings window
    if SETTINGS_CREATING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        if let Some(existing) = app.get_webview_window("settings") {
            let _ = existing.emit_to("settings", "audify:settings-select-tab", clean_tab);
            let _ = existing.show();
            let _ = existing.set_focus();
        }
        return Ok(());
    }
    let _creating_guard = ResetSettingsCreatingGuard;

    if let Some(existing) = app.get_webview_window("settings") {
        crate::win_memory::set_webview_low_memory(&app, "settings", false);
        let _ = existing.set_background_color(Some(bg));
        let _ = existing.set_always_on_top(pin_top);
        let _ = existing.emit_to("settings", "audify:settings-visibility", true);
        let _ = existing.emit_to("settings", "audify:settings-select-tab", clean_tab);
        let _ = existing.unminimize();
        // Only short-circuit if the existing window actually survived and showed; if an idle
        // destroy raced right before show(), fall through and build a fresh Settings window.
        if existing.show().is_ok() {
            let _ = existing.set_focus();
            return Ok(());
        }
    }

    let url = format!(
        "index.html?window=settings&tab={}&theme={}",
        clean_tab, clean_theme
    );
    let webview_cache_dir = app.state::<AppState>().user_dir.join("cache").join("webview");
    let _ = fs::create_dir_all(&webview_cache_dir);

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Settings")
    .inner_size(960.0, 660.0)
    .min_inner_size(760.0, 520.0)
    .resizable(true)
    .decorations(false)
    .center()
    .visible(false)
    .background_color(bg)
    .always_on_top(pin_top)
    .data_directory(webview_cache_dir)
    .disable_drag_drop_handler();

    #[cfg(target_os = "windows")]
    {
        builder = builder.additional_browser_args(AUDIFY_WEBVIEW_ARGS);
    }

    let win = builder
        .build()
        .map_err(|e| security::sanitize_err(&app.state::<AppState>().user_dir, &e.to_string()))?;
    let _ = win.set_background_color(Some(bg));
    let win_clone = win.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        if SETTINGS_HIDE_SEQ.load(Ordering::SeqCst) != open_seq
            || !SETTINGS_VISIBLE.load(Ordering::SeqCst)
        {
            return;
        }
        let _ = win_clone.show();
        let _ = win_clone.set_focus();
    });
    Ok(())
}

#[tauri::command]
pub fn broadcast_state_sync(
    app: tauri::AppHandle,
    window: tauri::Window,
    kind: String,
    msg_id: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;
    let payload = CrossWindowSyncPayload {
        source: window.label().to_string(),
        kind,
        msg_id,
    };
    app.emit("audify:cross-window-sync", payload)
        .map_err(|e| e.to_string())
}
