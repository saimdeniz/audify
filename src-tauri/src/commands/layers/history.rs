use super::{
    cleanup_quarantined_layer_file_if_present, dedup_positive_ids, ensure_existing_layer_in_scope,
    ensure_slice_not_in_readonly_library, format_os_display_path, sanitize_layer_stem,
    with_read_conn, LayerHistoryRecord,
};
use crate::audio_engine::AudioEngineState;
use crate::db::{get_active_profile_id, AppState};
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path, sanitize_err};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

pub(super) const LAYER_SELECT_COLS: &str =
    "id, layer_path, layer_name, recipe_json, lane_count, clip_count, duration_ms,
     COALESCE(is_favorite, 0), COALESCE(peaks_json, '[]'),
     COALESCE(sample_rate, 48000), COALESCE(channels, 2), COALESCE(bit_depth, 24),
     created_at, updated_at, COALESCE(is_trashed, 0), trash_file_path, trashed_at";

pub(super) fn row_to_layer_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<LayerHistoryRecord> {
    let layer_path: String = row.get(1)?;
    let is_trashed = row.get::<_, i64>(14)? != 0;
    let raw_trash_path: Option<String> = row.get(15)?;
    let trashed_at: Option<String> = row.get(16)?;
    let clean_trash_path = if is_trashed {
        raw_trash_path
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    let check_path = if is_trashed {
        clean_trash_path.as_deref().unwrap_or("")
    } else {
        layer_path.as_str()
    };
    let file_exists = !check_path.is_empty()
        && !is_unc_or_network_path(check_path)
        && !has_ntfs_ads_colon(check_path)
        && fs::symlink_metadata(Path::new(check_path))
            .map(|m| !m.file_type().is_symlink() && m.is_file())
            .unwrap_or(false);

    Ok(LayerHistoryRecord {
        id: row.get(0)?,
        layer_path,
        layer_name: row.get(2)?,
        recipe_json: row.get(3)?,
        lane_count: row.get(4)?,
        clip_count: row.get(5)?,
        duration_ms: row.get(6)?,
        is_favorite: row.get::<_, i64>(7)? != 0,
        peaks_json: row.get(8)?,
        sample_rate: row.get(9)?,
        channels: row.get(10)?,
        bit_depth: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        file_exists,
        is_trashed,
        trash_file_path: clean_trash_path,
        trashed_at,
    })
}

pub(super) fn query_layer_record_by_id(
    conn: &Connection,
    profile_id: i64,
    layer_id: i64,
) -> Result<LayerHistoryRecord, String> {
    let sql = format!(
        "SELECT {} FROM layer_history WHERE id = ?1 AND profile_id = ?2 LIMIT 1",
        LAYER_SELECT_COLS
    );
    conn.query_row(&sql, params![layer_id, profile_id], row_to_layer_record)
        .map_err(|_| "Layer record not found".to_string())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn upsert_layer_history_row(
    conn: &Connection,
    user_dir: &Path,
    profile_id: i64,
    overwrite_id: Option<i64>,
    wav_path: &Path,
    recipe_json: &str,
    lane_count: i64,
    clip_count: i64,
    duration_ms: i64,
    peaks_json: &str,
    sample_rate: i64,
    channels: i64,
    bit_depth: i64,
) -> Result<LayerHistoryRecord, String> {
    let path_str = format_os_display_path(wav_path);
    let layer_name = wav_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("layer.wav")
        .to_string();

    if let Some(id) = overwrite_id {
        let updated = conn
            .execute(
                "UPDATE layer_history
                 SET layer_path = ?1,
                     layer_name = ?2,
                     recipe_json = ?3,
                     lane_count = ?4,
                     clip_count = ?5,
                     duration_ms = ?6,
                     peaks_json = ?7,
                     sample_rate = ?8,
                     channels = ?9,
                     bit_depth = ?10,
                     updated_at = datetime('now')
                 WHERE id = ?11 AND profile_id = ?12",
                params![
                    path_str,
                    layer_name,
                    recipe_json,
                    lane_count,
                    clip_count,
                    duration_ms,
                    peaks_json,
                    sample_rate,
                    channels,
                    bit_depth,
                    id,
                    profile_id,
                ],
            )
            .map_err(|e| format!("Failed updating layer history record: {}", e))?;
        if updated == 0 {
            return Err("Layer record not found for overwrite".to_string());
        }
        return query_layer_record_by_id(conn, profile_id, id);
    }

    // If a previously trashed row occupies this exact (profile_id, layer_path),
    // clean up its quarantined file on disk before ON CONFLICT clears trash_file_path.
    let prior_trash_path: Option<String> = conn
        .query_row(
            "SELECT trash_file_path FROM layer_history
             WHERE profile_id = ?1 AND layer_path = ?2 AND COALESCE(is_trashed, 0) = 1
             LIMIT 1",
            params![profile_id, path_str],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    cleanup_quarantined_layer_file_if_present(user_dir, prior_trash_path.as_deref());

    conn.execute(
        "INSERT INTO layer_history (
            profile_id, layer_path, layer_name, recipe_json,
            lane_count, clip_count, duration_ms,
            peaks_json, sample_rate, channels, bit_depth
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(profile_id, layer_path) DO UPDATE SET
            layer_name = excluded.layer_name,
            recipe_json = excluded.recipe_json,
            lane_count = excluded.lane_count,
            clip_count = excluded.clip_count,
            duration_ms = excluded.duration_ms,
            peaks_json = excluded.peaks_json,
            sample_rate = excluded.sample_rate,
            channels = excluded.channels,
            bit_depth = excluded.bit_depth,
            is_trashed = 0,
            trash_file_path = NULL,
            trashed_at = NULL,
            updated_at = datetime('now')",
        params![
            profile_id,
            path_str,
            layer_name,
            recipe_json,
            lane_count,
            clip_count,
            duration_ms,
            peaks_json,
            sample_rate,
            channels,
            bit_depth,
        ],
    )
    .map_err(|e| format!("Failed saving layer history record: {}", e))?;

    let sql = format!(
        "SELECT {} FROM layer_history WHERE profile_id = ?1 AND layer_path = ?2 LIMIT 1",
        LAYER_SELECT_COLS
    );
    conn.query_row(&sql, params![profile_id, path_str], row_to_layer_record)
        .map_err(|_| "Failed reading saved layer record".to_string())
}

pub(crate) fn list_layer_history_with_conn(conn: &Connection) -> Result<Vec<LayerHistoryRecord>, String> {
    let profile_id = get_active_profile_id(conn);
    let sql = format!(
        "SELECT {} FROM layer_history
         WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 0
         ORDER BY updated_at DESC, id DESC
         LIMIT 5000",
        LAYER_SELECT_COLS
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed preparing layer history query: {}", e))?;
    let rows = stmt
        .query_map([profile_id], row_to_layer_record)
        .map_err(|e| format!("Failed querying layer history: {}", e))?;
    Ok(rows.flatten().collect())
}

#[tauri::command]
pub async fn list_layer_history(state: State<'_, AppState>) -> Result<Vec<LayerHistoryRecord>, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_read_conn(&state_owned, list_layer_history_with_conn)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer history worker error: {}", e)))?
}

pub(crate) fn toggle_layer_favorite_with_conn(
    conn: &Connection,
    layer_id: i64,
) -> Result<LayerHistoryRecord, String> {
    let profile_id = get_active_profile_id(conn);
    let updated = conn
        .execute(
            "UPDATE layer_history
             SET is_favorite = CASE WHEN COALESCE(is_favorite, 0) = 0 THEN 1 ELSE 0 END
             WHERE id = ?1 AND profile_id = ?2 AND COALESCE(is_trashed, 0) = 0",
            params![layer_id, profile_id],
        )
        .map_err(|e| format!("Failed updating layer favorite: {}", e))?;
    if updated == 0 {
        return Err("Layer record not found".to_string());
    }
    query_layer_record_by_id(conn, profile_id, layer_id)
}

#[tauri::command]
pub async fn toggle_layer_favorite(
    state: State<'_, AppState>,
    layer_id: i64,
) -> Result<LayerHistoryRecord, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_owned.lock_db();
        toggle_layer_favorite_with_conn(&conn, layer_id)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Toggle layer favorite failed: {}", e)))?
}

#[tauri::command]
pub async fn toggle_layer_favorites_batch(
    state: State<'_, AppState>,
    layer_ids: Vec<i64>,
    is_favorite: bool,
) -> Result<Vec<i64>, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let clean_ids = dedup_positive_ids(&layer_ids);
        if clean_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = state_owned.lock_db();
        let profile_id = get_active_profile_id(&conn);
        let fav_int: i64 = if is_favorite { 1 } else { 0 };
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed starting layer favorite batch: {}", e))?;
        for chunk in clean_ids.chunks(500) {
            let placeholders: Vec<String> = (3..=chunk.len() + 2).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "UPDATE layer_history
                 SET is_favorite = ?1
                 WHERE profile_id = ?2 AND COALESCE(is_trashed, 0) = 0 AND id IN ({})",
                placeholders.join(", ")
            );
            let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 2);
            vals.push(rusqlite::types::Value::Integer(fav_int));
            vals.push(rusqlite::types::Value::Integer(profile_id));
            for id in chunk {
                vals.push(rusqlite::types::Value::Integer(*id));
            }
            tx.execute(&sql, rusqlite::params_from_iter(vals.iter()))
                .map_err(|e| format!("Failed updating layer favorites: {}", e))?;
        }
        tx.commit()
            .map_err(|e| format!("Failed committing layer favorites: {}", e))?;
        Ok(clean_ids)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer favorite batch failed: {}", e)))?
}

pub(crate) fn rename_layer_item_with_conn(
    conn: &Connection,
    user_dir: &Path,
    audio_engine: Option<&AudioEngineState>,
    layer_id: i64,
    new_name: &str,
) -> Result<LayerHistoryRecord, String> {
    let profile_id = get_active_profile_id(conn);
    let clean_stem = sanitize_layer_stem(new_name)?;
    let existing = query_layer_record_by_id(conn, profile_id, layer_id)?;
    if existing.is_trashed {
        return Err("Cannot rename a trashed layer".to_string());
    }
    let src_pb = ensure_existing_layer_in_scope(conn, user_dir, &existing.layer_path)?;
    ensure_slice_not_in_readonly_library(conn, &src_pb)?;
    let parent_dir = src_pb
        .parent()
        .ok_or_else(|| "Invalid layer parent folder".to_string())?;
    let next_file_name = format!("{}.wav", clean_stem);
    let target_pb = parent_dir.join(&next_file_name);

    let same_ci = normalize_clean_path(&src_pb.to_string_lossy())
        .eq_ignore_ascii_case(&normalize_clean_path(&target_pb.to_string_lossy()));
    if !same_ci && fs::symlink_metadata(&target_pb).is_ok() {
        return Err(format!("A layer named '{}' already exists in this folder", next_file_name));
    }

    if let Some(engine) = audio_engine {
        let _ = engine.release_file_handle(Some(&existing.layer_path));
    }
    fs::rename(&src_pb, &target_pb).map_err(|_| "Failed renaming layer file on disk".to_string())?;

    let next_path_str = format_os_display_path(&target_pb);
    if conn
        .execute(
            "UPDATE layer_history
             SET layer_path = ?1, layer_name = ?2, updated_at = datetime('now')
             WHERE id = ?3 AND profile_id = ?4",
            params![next_path_str, next_file_name, layer_id, profile_id],
        )
        .is_err()
    {
        let _ = fs::rename(&target_pb, &src_pb);
        return Err("Failed updating renamed layer record".to_string());
    }

    query_layer_record_by_id(conn, profile_id, layer_id)
}

#[tauri::command]
pub async fn rename_layer_item(
    app: AppHandle,
    state: State<'_, AppState>,
    layer_id: i64,
    new_name: String,
) -> Result<LayerHistoryRecord, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine_opt = app_clone.try_state::<AudioEngineState>().map(|s| s.inner().clone());
        let conn = state_owned.lock_db();
        rename_layer_item_with_conn(
            &conn,
            &state_owned.user_dir,
            engine_opt.as_ref(),
            layer_id,
            &new_name,
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Rename layer failed: {}", e)))?
}

#[tauri::command]
pub async fn clear_missing_layers(state: State<'_, AppState>) -> Result<usize, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        let profile_id = get_active_profile_id(&conn);
        let records = list_layer_history_with_conn(&conn)?;
        let missing_ids: Vec<i64> = records
            .into_iter()
            .filter(|r| !r.file_exists)
            .map(|r| r.id)
            .collect();
        if missing_ids.is_empty() {
            return Ok(0);
        }
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed starting cleanup transaction: {}", e))?;
        let mut removed = 0usize;
        for chunk in missing_ids.chunks(500) {
            let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "DELETE FROM layer_history WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 0 AND id IN ({})",
                placeholders.join(", ")
            );
            let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            vals.push(rusqlite::types::Value::Integer(profile_id));
            for id in chunk {
                vals.push(rusqlite::types::Value::Integer(*id));
            }
            removed += tx
                .execute(&sql, rusqlite::params_from_iter(vals.iter()))
                .unwrap_or(0);
        }
        tx.commit()
            .map_err(|e| format!("Failed committing missing layers cleanup: {}", e))?;
        Ok(removed)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Clear missing layers failed: {}", e)))?
}
