use super::with_read_conn;
use crate::audio::{
    compute_hires_peaks, compute_preview_norm_gain, export_wav_slice_with_params,
    resolve_metadata_titles_validated, transcode_audio_to_pcm_wav, SliceExportParams,
};
use crate::db::AppState;
use crate::security::{
    ensure_not_inside_user_dir, ensure_safe_export_dir, has_ntfs_ads_colon,
    open_directory_in_shell, sanitize_err, validate_audio_path_in_scope,
};
use rusqlite::{params_from_iter, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

pub(crate) fn resolve_slice_cache_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("cache").join("slices")
}

pub(crate) fn resolve_layer_preview_cache_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("cache").join("layer_preview")
}

fn resolve_profile_export_dir(
    conn: &Connection,
    user_dir: &Path,
    custom_dir: Option<&str>,
    settings_key: &str,
    default_leaf: &str,
) -> Result<PathBuf, String> {
    if let Some(dir) = custom_dir {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            let safe_dir =
                ensure_safe_export_dir(trimmed).map_err(|e| sanitize_err(user_dir, &e))?;
            ensure_not_inside_user_dir(user_dir, &safe_dir)?;
            crate::commands::slices::ensure_slice_not_in_readonly_library(conn, &safe_dir)?;
            return Ok(safe_dir);
        }
    }

    if let Ok(settings_json) = conn.query_row(
        "SELECT settings_json FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    ) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&settings_json) {
            if let Some(custom_path) = parsed.get(settings_key).and_then(|v| v.as_str()) {
                let trimmed = custom_path.trim();
                if !trimmed.is_empty() {
                    if let Ok(safe_dir) = ensure_safe_export_dir(trimmed) {
                        if ensure_not_inside_user_dir(user_dir, &safe_dir).is_ok()
                            && crate::commands::slices::ensure_slice_not_in_readonly_library(
                                conn, &safe_dir,
                            )
                            .is_ok()
                        {
                            return Ok(safe_dir);
                        }
                    }
                }
            }
        }
    }

    Ok(user_dir.join(default_leaf))
}

pub(crate) fn resolve_slice_export_dir(
    conn: &Connection,
    user_dir: &Path,
    custom_dir: Option<&str>,
) -> Result<PathBuf, String> {
    resolve_profile_export_dir(conn, user_dir, custom_dir, "customSliceExportPath", "slices")
}

pub(crate) fn resolve_layer_export_dir(
    conn: &Connection,
    user_dir: &Path,
    custom_dir: Option<&str>,
) -> Result<PathBuf, String> {
    resolve_profile_export_dir(conn, user_dir, custom_dir, "customLayerExportPath", "layers")
}

pub(crate) fn resolve_active_export_preset(
    conn: &Connection,
    explicit: Option<&str>,
) -> Option<String> {
    if let Some(raw) = explicit {
        let trimmed = raw.trim();
        if matches!(trimmed, "original" | "wav_24" | "nle_48k_24") {
            return Some(trimmed.to_string());
        }
    }
    if let Ok(settings_json) = conn.query_row(
        "SELECT settings_json FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    ) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&settings_json) {
            if let Some(preset) = parsed.get("exportAudioPreset").and_then(|v| v.as_str()) {
                let trimmed = preset.trim();
                if matches!(trimmed, "original" | "wav_24" | "nle_48k_24") {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

pub(crate) fn resolve_active_export_loudness_mode(
    conn: &Connection,
    explicit: Option<&str>,
) -> Option<String> {
    if let Some(raw) = explicit {
        let trimmed = raw.trim();
        if matches!(trimmed, "off" | "peak_m1" | "lufs_m14" | "lufs_m24") {
            return Some(trimmed.to_string());
        }
    }
    if let Ok(settings_json) = conn.query_row(
        "SELECT settings_json FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    ) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&settings_json) {
            if let Some(mode) = parsed.get("exportLoudnessMode").and_then(|v| v.as_str()) {
                let trimmed = mode.trim();
                if matches!(trimmed, "off" | "peak_m1" | "lufs_m14" | "lufs_m24") {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_audio_slice(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    start_sec: f64,
    end_sec: f64,
    custom_dir: Option<String>,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    cache_only: Option<bool>,
    export_preset: Option<String>,
    export_loudness_mode: Option<String>,
) -> Result<String, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    let use_temp_cache = cache_only.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let (source_path, slices_dir, resolved_preset, resolved_loudness) =
            with_read_conn(&state_owned, |conn| {
                let src = validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                    .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
                let dir = if use_temp_cache {
                    resolve_slice_cache_dir(&state_owned.user_dir)
                } else {
                    resolve_slice_export_dir(conn, &state_owned.user_dir, custom_dir.as_deref())?
                };
                let preset = resolve_active_export_preset(conn, export_preset.as_deref());
                let loudness =
                    resolve_active_export_loudness_mode(conn, export_loudness_mode.as_deref());
                Ok((src, dir, preset, loudness))
            })?;

        if has_ntfs_ads_colon(&slices_dir.to_string_lossy()) {
            return Err("Invalid slice export directory path".to_string());
        }
        fs::create_dir_all(&slices_dir).map_err(|e| {
            format!(
                "Failed to create slices directory: {}",
                sanitize_err(&state_owned.user_dir, &e.to_string())
            )
        })?;
        crate::app_cache_helpers::register_runtime_asset_dir(
            &app_clone,
            &state_owned.user_dir,
            &slices_dir,
        );

        export_wav_slice_with_params(
            &source_path,
            &slices_dir,
            &SliceExportParams {
                start_sec,
                end_sec,
                pitch_semitones,
                apply_micro_fade,
                export_preset: resolved_preset.as_deref(),
                loudness_mode: resolved_loudness.as_deref(),
            },
        )
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Slice export worker error: {}", e)))?
}

#[tauri::command]
pub async fn get_audio_preview_gain(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<f32, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = with_read_conn(&state_owned, |conn| {
            validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
        })?;
        Ok(compute_preview_norm_gain(&source_path).unwrap_or(1.0))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Preview gain worker error: {}", e)))?
}

#[tauri::command]
pub async fn open_slices_folder(
    state: State<'_, AppState>,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let slices_dir = with_read_conn(&state_owned, |conn| {
            resolve_slice_export_dir(conn, &state_owned.user_dir, custom_dir.as_deref())
        })?;
        fs::create_dir_all(&slices_dir).map_err(|e| {
            format!(
                "Failed to create slices folder: {}",
                sanitize_err(&state_owned.user_dir, &e.to_string())
            )
        })?;
        open_directory_in_shell(&slices_dir)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Open slices folder failed: {}", e)))?
}

#[tauri::command]
pub async fn open_layers_folder(
    state: State<'_, AppState>,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let layers_dir = with_read_conn(&state_owned, |conn| {
            resolve_layer_export_dir(conn, &state_owned.user_dir, custom_dir.as_deref())
        })?;
        fs::create_dir_all(&layers_dir).map_err(|e| {
            format!(
                "Failed to create layers folder: {}",
                sanitize_err(&state_owned.user_dir, &e.to_string())
            )
        })?;
        open_directory_in_shell(&layers_dir)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Open layers folder failed: {}", e)))?
}

#[tauri::command]
pub async fn transcode_to_pcm_cache(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    let cache_dir = state.user_dir.join("cache").join("playback_fallback");
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = with_read_conn(&state_owned, |conn| {
            validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
        })?;
        transcode_audio_to_pcm_wav(&source_path, &cache_dir)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Transcode fallback error: {}", e)))?
}

#[tauri::command]
pub async fn resolve_metadata_titles(
    state: State<'_, AppState>,
    file_paths: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    if file_paths.is_empty() {
        return Ok(HashMap::new());
    }

    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = with_read_conn(&state_owned, |conn| {
            Ok(crate::security::AuthorizedAudioScope::from_conn(
                conn,
                &state_owned.user_dir,
            ))
        })?;

        let mut validated_pairs: Vec<(String, PathBuf)> = Vec::with_capacity(file_paths.len());
        for fp in file_paths {
            if let Some(canon) = scope
                .validate_existing_audio_file(&fp)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?
            {
                validated_pairs.push((fp, canon));
            }
        }

        if validated_pairs.is_empty() {
            return Ok(HashMap::new());
        }

        Ok(resolve_metadata_titles_validated(&validated_pairs))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &e.to_string()))?
}

pub(crate) fn get_sample_peaks_with_conn(
    conn: &Connection,
    sample_ids: &[i64],
) -> Result<HashMap<String, String>, String> {
    if sample_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let active_id = crate::db::get_active_profile_id(conn);
    let mut out = HashMap::new();
    for chunk in sample_ids.chunks(500) {
        let mut placeholders = Vec::with_capacity(chunk.len());
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        params_vec.push(rusqlite::types::Value::Integer(active_id));
        for (i, id) in chunk.iter().enumerate() {
            placeholders.push(format!("?{}", i + 2));
            params_vec.push(rusqlite::types::Value::Integer(*id));
        }

        let sql = format!(
            "SELECT s.id, s.peaks_json
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
               AND s.id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Query prepare error: {}", e))?;

        let rows = stmt
            .query_map(params_from_iter(params_vec.iter()), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| format!("Query execution error: {}", e))?;

        for r in rows.flatten() {
            if let Some(peaks) = r.1 {
                out.insert(r.0.to_string(), peaks);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_sample_peaks(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<HashMap<String, String>, String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let state_cloned = state.inner().clone();
    let user_dir_err = state_cloned.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_read_conn(&state_cloned, |conn| {
            get_sample_peaks_with_conn(conn, &sample_ids)
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Sample peaks worker error: {}", e)))?
}

#[tauri::command]
pub async fn get_hires_peaks(
    state: State<'_, AppState>,
    file_path: String,
    target_bins: Option<u32>,
) -> Result<Vec<u8>, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = with_read_conn(&state_owned, |conn| {
            validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
        })?;
        compute_hires_peaks(&source_path, target_bins.map(|b| b as usize))
            .ok_or_else(|| "Failed to decode audio for hi-res peaks".to_string())
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &e.to_string()))?
}
