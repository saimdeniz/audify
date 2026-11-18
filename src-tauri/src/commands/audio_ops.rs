use super::{strip_lib_prefix, with_read_conn};
use crate::audio::{
    compute_hires_peaks, compute_preview_norm_gain, export_wav_slice_with_options,
    resolve_metadata_titles_validated, transcode_audio_to_pcm_wav,
};
use crate::db::AppState;
use crate::security::{
    collect_profile_slice_dirs, ensure_not_inside_user_dir, ensure_safe_export_dir,
    has_ntfs_ads_colon, is_unc_or_network_path, open_directory_in_shell, sanitize_err,
    validate_audio_path_in_scope,
};
use rusqlite::{params_from_iter, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

pub(crate) fn resolve_slice_cache_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("cache").join("slices")
}

pub(crate) fn resolve_slice_export_dir(
    conn: &Connection,
    user_dir: &Path,
    custom_dir: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(dir) = custom_dir {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            let safe_dir = ensure_safe_export_dir(trimmed).map_err(|e| sanitize_err(user_dir, &e))?;
            ensure_not_inside_user_dir(user_dir, &safe_dir)?;
            return Ok(safe_dir);
        }
    }

    if let Ok(settings_json) = conn.query_row(
        "SELECT settings_json FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    ) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&settings_json) {
            if let Some(custom_path) = parsed
                .get("customSliceExportPath")
                .and_then(|v| v.as_str())
            {
                let trimmed = custom_path.trim();
                if !trimmed.is_empty() {
                    if let Ok(safe_dir) = ensure_safe_export_dir(trimmed) {
                        if ensure_not_inside_user_dir(user_dir, &safe_dir).is_ok() {
                            return Ok(safe_dir);
                        }
                    }
                }
            }
        }
    }

    Ok(user_dir.join("slices"))
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
) -> Result<String, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    let use_temp_cache = cache_only.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let (source_path, slices_dir) = with_read_conn(&state_owned, |conn| {
            let src = validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
            let dir = if use_temp_cache {
                resolve_slice_cache_dir(&state_owned.user_dir)
            } else {
                resolve_slice_export_dir(conn, &state_owned.user_dir, custom_dir.as_deref())?
            };
            Ok((src, dir))
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

        export_wav_slice_with_options(
            &source_path,
            &slices_dir,
            start_sec,
            end_sec,
            pitch_semitones,
            apply_micro_fade,
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
pub fn open_slices_folder(
    state: State<'_, AppState>,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let slices_dir = with_read_conn(&state, |conn| {
        resolve_slice_export_dir(conn, &state.user_dir, custom_dir.as_deref())
    })?;
    fs::create_dir_all(&slices_dir).map_err(|e| {
        format!(
            "Failed to create slices folder: {}",
            sanitize_err(&state.user_dir, &e.to_string())
        )
    })?;
    open_directory_in_shell(&slices_dir)
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

fn is_missing_path_within_scope_prefix(conn: &Connection, user_dir: &Path, raw: &str) -> bool {
    if raw.contains("..") {
        return false;
    }
    for cache_sub in [
        user_dir.join("slices"),
        user_dir.join("cache").join("slices"),
        user_dir.join("cache").join("playback_fallback"),
    ] {
        if strip_lib_prefix(raw, &cache_sub.to_string_lossy()).is_some() {
            return true;
        }
    }
    let active_id = crate::db::get_active_profile_id(conn);
    if let Ok(mut stmt) = conn.prepare(
        "SELECT path FROM libraries
         WHERE is_global = 1
            OR id IN (SELECT library_id FROM profile_libraries WHERE profile_id = ?1)",
    ) {
        if let Ok(rows) = stmt.query_map([active_id], |r| r.get::<_, String>(0)) {
            for lp in rows.flatten() {
                if !is_unc_or_network_path(&lp) && strip_lib_prefix(raw, &lp).is_some() {
                    return true;
                }
            }
        }
    }
    for sd in collect_profile_slice_dirs(conn, true) {
        if strip_lib_prefix(raw, &sd.to_string_lossy()).is_some() {
            return true;
        }
    }
    false
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
        let validated_pairs: Vec<(String, PathBuf)> = with_read_conn(&state_owned, |conn| {
            let mut pairs = Vec::with_capacity(file_paths.len());
            for fp in file_paths {
                let trimmed = fp.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
                    return Err(
                        "Network/UNC paths and alternate data streams are not allowed".to_string(),
                    );
                }
                // Check registered library / cache / slice scope BEFORE touching filesystem metadata
                // so out-of-scope paths can never act as an existence/symlink oracle.
                if !is_missing_path_within_scope_prefix(conn, &state_owned.user_dir, trimmed) {
                    return Err(
                        "Access denied: path is outside registered libraries and audio cache"
                            .to_string(),
                    );
                }
                match fs::symlink_metadata(trimmed) {
                    Ok(sym) if sym.file_type().is_symlink() => {
                        return Err("Symbolic links and junctions are not allowed".to_string());
                    }
                    Err(_) => {
                        continue;
                    }
                    Ok(_) => {}
                }
                let canon = validate_audio_path_in_scope(conn, &state_owned.user_dir, trimmed)
                    .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
                pairs.push((fp, canon));
            }
            Ok(pairs)
        })?;

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
