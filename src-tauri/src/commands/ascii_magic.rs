use crate::ascii_magic::catalog::{
    delete_piece_from_dir, install_piece_to_dir, read_preview_from_dir, read_state_from_dir,
    save_preview_to_dir, sync_catalog_to_dir,
};
use crate::ascii_magic::{AsciiMagicState, InstalledPieceRecord};
use crate::db::AppState;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_ascii_magic_state(
    state: State<'_, AppState>,
) -> Result<AsciiMagicState, String> {
    let user_dir = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || read_state_from_dir(&user_dir))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn sync_ascii_magic_catalog(
    state: State<'_, AppState>,
) -> Result<AsciiMagicState, String> {
    let user_dir = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || sync_catalog_to_dir(&user_dir))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn install_ascii_magic_piece(
    app: AppHandle,
    state: State<'_, AppState>,
    slug_or_url: String,
) -> Result<InstalledPieceRecord, String> {
    let user_dir = state.user_dir.clone();
    let rec = tauri::async_runtime::spawn_blocking(move || {
        install_piece_to_dir(&user_dir, &slug_or_url)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))??;
    let _ = app.emit("ascii-magic-updated", &rec.slug);
    Ok(rec)
}

#[tauri::command]
pub async fn delete_ascii_magic_piece(
    app: AppHandle,
    state: State<'_, AppState>,
    slug: String,
) -> Result<(), String> {
    let user_dir = state.user_dir.clone();
    let slug_copy = slug.clone();
    tauri::async_runtime::spawn_blocking(move || delete_piece_from_dir(&user_dir, &slug_copy))
        .await
        .map_err(|e| format!("Task join failed: {}", e))??;
    let _ = app.emit("ascii-magic-updated", &slug);
    Ok(())
}

#[tauri::command]
pub async fn save_ascii_magic_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    slug: String,
    preview_json: String,
) -> Result<(), String> {
    let user_dir = state.user_dir.clone();
    let slug_copy = slug.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_preview_to_dir(&user_dir, &slug_copy, &preview_json)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))??;
    let _ = app.emit("ascii-magic-updated", &slug);
    Ok(())
}

#[tauri::command]
pub async fn get_ascii_magic_preview(
    state: State<'_, AppState>,
    slug: String,
) -> Result<Option<String>, String> {
    let user_dir = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || read_preview_from_dir(&user_dir, &slug))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}
