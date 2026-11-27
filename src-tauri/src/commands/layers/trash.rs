use super::history::{row_to_layer_record, LAYER_SELECT_COLS};
use super::{
    collect_authorized_layer_dirs, dedup_positive_ids, ensure_existing_layer_in_scope_detailed,
    ensure_slice_not_in_readonly_library, format_os_display_path, resolve_layer_trash_dir,
    with_read_conn, LayerHistoryRecord, LayerScopeError, LayerTrashSummary,
};
use crate::audio_engine::AudioEngineState;
use crate::commands::file_ops::{move_file_resilient, rollback_disk_moves};
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    display_leaf, has_ntfs_ads_colon, has_parent_dir_traversal, is_unc_or_network_path,
    move_files_to_os_recycle_bin, normalize_clean_path, reject_symlink_ancestors, sanitize_err,
    strip_verbatim_prefix,
};
use rusqlite::{params, params_from_iter, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, State};

static LAYER_TRASH_NONCE: AtomicU64 = AtomicU64::new(1);

fn verify_quarantined_layer_file_with_canon(
    raw_path: &str,
    trash_canon: Option<&Path>,
) -> Result<Option<(PathBuf, u64)>, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Refusing unsafe layer quarantine path".to_string());
    }
    let pb = PathBuf::from(trimmed);
    reject_symlink_ancestors(&pb)?;
    let Ok(sym) = fs::symlink_metadata(&pb) else {
        return Ok(None);
    };
    if sym.file_type().is_symlink() || !sym.file_type().is_file() {
        return Err(format!(
            "Refusing symlink or non-file inside layer trash: {}",
            display_leaf(&pb)
        ));
    }
    let Some(base_canon) = trash_canon else {
        return Ok(None);
    };
    let target_canon = pb
        .canonicalize()
        .map_err(|_| "Failed resolving quarantined layer path".to_string())?;
    if is_unc_or_network_path(&target_canon.to_string_lossy())
        || !target_canon.starts_with(base_canon)
    {
        return Err("Refusing access outside layer trash quarantine".to_string());
    }
    Ok(Some((strip_verbatim_prefix(&target_canon), sym.len())))
}

pub(crate) fn query_layer_trash_status_with_conn(
    conn: &Connection,
    user_dir: &Path,
) -> Result<LayerTrashSummary, String> {
    let profile_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(trash_file_path, '')
             FROM layer_history
             WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
        )
        .map_err(|e| format!("Failed querying layer trash status: {}", e))?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([profile_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Failed reading layer trash rows: {}", e))?
        .flatten()
        .collect();

    let trash_canon = resolve_layer_trash_dir(user_dir).canonicalize().ok();
    let mut total_bytes: u64 = 0;
    for (_, trash_p) in &rows {
        if let Ok(Some((_, bytes))) =
            verify_quarantined_layer_file_with_canon(trash_p, trash_canon.as_deref())
        {
            total_bytes = total_bytes.saturating_add(bytes);
        }
    }

    Ok(LayerTrashSummary {
        affected_count: 0,
        affected_ids: Vec::new(),
        trashed_count: rows.len(),
        total_bytes,
    })
}

pub(crate) fn list_trashed_layers_with_conn(
    conn: &Connection,
    user_dir: &Path,
) -> Result<Vec<LayerHistoryRecord>, String> {
    let profile_id = get_active_profile_id(conn);
    let sql = format!(
        "SELECT {} FROM layer_history
         WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1
         ORDER BY COALESCE(trashed_at, updated_at) DESC, id DESC
         LIMIT 5000",
        LAYER_SELECT_COLS
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed preparing trashed layers query: {}", e))?;
    let mut records: Vec<LayerHistoryRecord> = stmt
        .query_map([profile_id], row_to_layer_record)
        .map_err(|e| format!("Failed reading trashed layers: {}", e))?
        .flatten()
        .collect();

    let trash_canon = resolve_layer_trash_dir(user_dir).canonicalize().ok();
    for rec in &mut records {
        let verified = rec
            .trash_file_path
            .as_deref()
            .and_then(|p| {
                verify_quarantined_layer_file_with_canon(p, trash_canon.as_deref()).ok()
            })
            .flatten();
        if let Some((clean_pb, _)) = verified {
            rec.file_exists = true;
            rec.trash_file_path = Some(format_os_display_path(&clean_pb));
        } else {
            rec.file_exists = false;
            rec.trash_file_path = None;
        }
    }
    Ok(records)
}

pub(crate) fn trash_layer_files_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    audio_engine: Option<&AudioEngineState>,
    layer_ids: &[i64],
) -> Result<Vec<i64>, String> {
    let clean_ids = dedup_positive_ids(layer_ids);
    if clean_ids.is_empty() {
        return Ok(Vec::new());
    }
    let profile_id = get_active_profile_id(conn);
    let trash_dir = resolve_layer_trash_dir(user_dir);
    fs::create_dir_all(&trash_dir)
        .map_err(|_| "Failed preparing Audify layer trash quarantine".to_string())?;

    struct PlannedTrash {
        layer_id: i64,
        src_pb: PathBuf,
        trash_pb: PathBuf,
        raw_path: String,
    }

    let mut planned = Vec::with_capacity(clean_ids.len());
    let mut missing_row_ids = Vec::new();

    for layer_id in clean_ids {
        let Ok(layer_path) = conn.query_row(
            "SELECT layer_path FROM layer_history
             WHERE id = ?1 AND profile_id = ?2 AND COALESCE(is_trashed, 0) = 0",
            params![layer_id, profile_id],
            |r| r.get::<_, String>(0),
        ) else {
            continue;
        };

        let norm_layer = normalize_clean_path(&layer_path);
        let is_indexed_source: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM samples WHERE LOWER(REPLACE(file_path, '\\', '/')) = LOWER(?1))",
                params![norm_layer],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if is_indexed_source {
            return Err("Refusing to trash an indexed library source track".to_string());
        }

        match ensure_existing_layer_in_scope_detailed(conn, user_dir, &layer_path) {
            Ok(resolved) => {
                ensure_slice_not_in_readonly_library(conn, &resolved)?;
                let leaf = display_leaf(&resolved);
                let nonce = LAYER_TRASH_NONCE.fetch_add(1, Ordering::Relaxed);
                let trash_pb = trash_dir.join(format!("{}_{}_{}", layer_id, nonce, leaf));
                planned.push(PlannedTrash {
                    layer_id,
                    src_pb: resolved,
                    trash_pb,
                    raw_path: layer_path,
                });
            }
            Err(LayerScopeError::NotFound(_)) => missing_row_ids.push(layer_id),
            Err(LayerScopeError::Denied(msg)) => return Err(msg),
        }
    }

    let mut completed_moves: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(planned.len());
    for item in &planned {
        if let Some(engine) = audio_engine {
            let _ = engine.release_file_handle(Some(&item.raw_path));
        }
        if let Err(e) = move_file_resilient(&item.src_pb, &item.trash_pb) {
            rollback_disk_moves(&completed_moves);
            return Err(sanitize_err(user_dir, &e));
        }
        completed_moves.push((item.src_pb.clone(), item.trash_pb.clone()));
    }

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(&completed_moves);
            return Err(format!("Failed starting layer trash transaction: {}", e));
        }
    };

    let mut trashed_ids = Vec::with_capacity(planned.len());
    for item in &planned {
        let trash_disp = format_os_display_path(&item.trash_pb);
        if tx
            .execute(
                "UPDATE layer_history
                 SET is_trashed = 1, trash_file_path = ?1, trashed_at = datetime('now')
                 WHERE id = ?2 AND profile_id = ?3",
                params![trash_disp, item.layer_id, profile_id],
            )
            .is_err()
        {
            drop(tx);
            rollback_disk_moves(&completed_moves);
            return Err("Failed updating trashed layer state".to_string());
        }
        trashed_ids.push(item.layer_id);
    }

    for missing_id in missing_row_ids {
        let _ = tx.execute(
            "DELETE FROM layer_history WHERE id = ?1 AND profile_id = ?2",
            params![missing_id, profile_id],
        );
    }

    if tx.commit().is_err() {
        rollback_disk_moves(&completed_moves);
        return Err("Failed committing trashed layer records".to_string());
    }

    Ok(trashed_ids)
}

fn is_restore_parent_authorized(target_parent: &Path, auth_dirs: &[PathBuf]) -> bool {
    let raw = target_parent.to_string_lossy();
    if raw.trim().is_empty()
        || is_unc_or_network_path(&raw)
        || has_ntfs_ads_colon(&raw)
        || has_parent_dir_traversal(&raw)
        || reject_symlink_ancestors(target_parent).is_err()
    {
        return false;
    }
    let auth_canons: Vec<PathBuf> = auth_dirs
        .iter()
        .filter_map(|d| d.canonicalize().ok())
        .collect();
    if auth_canons.is_empty() {
        return false;
    }
    let mut cursor = Some(target_parent);
    while let Some(dir) = cursor {
        match fs::symlink_metadata(dir) {
            Ok(sym) => {
                if sym.file_type().is_symlink() || !sym.file_type().is_dir() {
                    return false;
                }
                let Ok(canon) = dir.canonicalize() else {
                    return false;
                };
                return auth_canons.iter().any(|base| canon.starts_with(base));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => cursor = dir.parent(),
            Err(_) => return false,
        }
    }
    false
}

pub(crate) fn restore_trashed_layer_files_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    audio_engine: Option<&AudioEngineState>,
    layer_ids: Option<&[i64]>,
) -> Result<Vec<i64>, String> {
    let profile_id = get_active_profile_id(conn);
    let trash_canon = resolve_layer_trash_dir(user_dir).canonicalize().ok();
    let auth_dirs = collect_authorized_layer_dirs(conn, user_dir);

    let rows: Vec<(i64, String, String)> = if let Some(ids) = layer_ids {
        let clean = dedup_positive_ids(ids);
        if clean.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for chunk in clean.chunks(450) {
            let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT id, layer_path, COALESCE(trash_file_path, '')
                 FROM layer_history
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1 AND id IN ({})",
                placeholders.join(", ")
            );
            let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            vals.push(rusqlite::types::Value::Integer(profile_id));
            for id in chunk {
                vals.push(rusqlite::types::Value::Integer(*id));
            }
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed preparing layer restore query: {}", e))?;
            let found = stmt
                .query_map(params_from_iter(vals.iter()), |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                })
                .map_err(|e| format!("Failed reading trashed layers: {}", e))?;
            out.extend(found.flatten());
        }
        out
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, layer_path, COALESCE(trash_file_path, '')
                 FROM layer_history
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
            )
            .map_err(|e| format!("Failed preparing full layer restore query: {}", e))?;
        let found = stmt
            .query_map([profile_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| format!("Failed reading trashed layers: {}", e))?;
        found.flatten().collect()
    };

    struct PlannedRestore {
        layer_id: i64,
        trash_pb: PathBuf,
        restore_pb: PathBuf,
        trash_raw: String,
    }

    let mut planned = Vec::with_capacity(rows.len());
    for (id, orig_path, trash_path) in rows {
        let Some((quarantined_pb, _)) =
            verify_quarantined_layer_file_with_canon(&trash_path, trash_canon.as_deref())?
        else {
            continue;
        };
        let target_pb = PathBuf::from(orig_path.trim());
        let parent = target_pb
            .parent()
            .ok_or_else(|| "Invalid original layer folder".to_string())?;
        if !is_restore_parent_authorized(parent, &auth_dirs) {
            return Err("Original layer export folder is no longer authorized or online".to_string());
        }
        ensure_slice_not_in_readonly_library(conn, &target_pb)?;
        let final_pb = if target_pb.exists() {
            let stem = target_pb
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("layer");
            super::pick_collision_safe_layer_wav_path(parent, stem)
        } else {
            target_pb
        };
        planned.push(PlannedRestore {
            layer_id: id,
            trash_pb: quarantined_pb,
            restore_pb: final_pb,
            trash_raw: trash_path,
        });
    }

    let mut completed_moves: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(planned.len());
    for item in &planned {
        if let Some(engine) = audio_engine {
            let _ = engine.release_file_handle(Some(&item.trash_raw));
        }
        if let Some(parent) = item.restore_pb.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = move_file_resilient(&item.trash_pb, &item.restore_pb) {
            rollback_disk_moves(&completed_moves);
            return Err(sanitize_err(user_dir, &e));
        }
        completed_moves.push((item.trash_pb.clone(), item.restore_pb.clone()));
    }

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(&completed_moves);
            return Err(format!("Failed starting layer restore transaction: {}", e));
        }
    };

    let mut restored_ids = Vec::with_capacity(planned.len());
    for item in &planned {
        let restored_disp = format_os_display_path(&item.restore_pb);
        let restored_name = item
            .restore_pb
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("layer.wav")
            .to_string();
        if tx
            .execute(
                "UPDATE layer_history
                 SET is_trashed = 0, trash_file_path = NULL, trashed_at = NULL,
                     layer_path = ?1, layer_name = ?2, updated_at = datetime('now')
                 WHERE id = ?3 AND profile_id = ?4",
                params![restored_disp, restored_name, item.layer_id, profile_id],
            )
            .is_err()
        {
            drop(tx);
            rollback_disk_moves(&completed_moves);
            return Err("Failed committing restored layer state".to_string());
        }
        restored_ids.push(item.layer_id);
    }

    if tx.commit().is_err() {
        rollback_disk_moves(&completed_moves);
        return Err("Failed committing restored layers".to_string());
    }

    Ok(restored_ids)
}

pub(crate) fn empty_trashed_layers_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    audio_engine: Option<&AudioEngineState>,
    layer_ids: Option<&[i64]>,
) -> Result<Vec<i64>, String> {
    let profile_id = get_active_profile_id(conn);
    let trash_canon = resolve_layer_trash_dir(user_dir).canonicalize().ok();
    let targets: Vec<(i64, String)> = if let Some(ids) = layer_ids {
        let clean = dedup_positive_ids(ids);
        if clean.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for chunk in clean.chunks(450) {
            let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT id, COALESCE(trash_file_path, '')
                 FROM layer_history
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1 AND id IN ({})",
                placeholders.join(", ")
            );
            let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            vals.push(rusqlite::types::Value::Integer(profile_id));
            for id in chunk {
                vals.push(rusqlite::types::Value::Integer(*id));
            }
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed preparing empty layer trash query: {}", e))?;
            let found = stmt
                .query_map(params_from_iter(vals.iter()), |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed reading trashed layers: {}", e))?;
            out.extend(found.flatten());
        }
        out
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, COALESCE(trash_file_path, '')
                 FROM layer_history
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
            )
            .map_err(|e| format!("Failed preparing full empty layer trash query: {}", e))?;
        let found = stmt
            .query_map([profile_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Failed reading trashed layers: {}", e))?;
        found.flatten().collect()
    };

    if targets.is_empty() {
        return Ok(Vec::new());
    }

    let mut files_to_recycle: Vec<PathBuf> = Vec::new();
    for (_, trash_p) in &targets {
        if let Some((pb, _)) =
            verify_quarantined_layer_file_with_canon(trash_p, trash_canon.as_deref())?
        {
            if let Some(engine) = audio_engine {
                let _ = engine.release_file_handle(Some(trash_p));
            }
            files_to_recycle.push(pb);
        }
    }

    if !files_to_recycle.is_empty() {
        move_files_to_os_recycle_bin(&files_to_recycle)
            .map_err(|e| sanitize_err(user_dir, &e))?;
    }

    let deleted_ids: Vec<i64> = targets.iter().map(|(id, _)| *id).collect();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting delete trashed layers tx: {}", e))?;
    for chunk in deleted_ids.chunks(500) {
        let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "DELETE FROM layer_history WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1 AND id IN ({})",
            placeholders.join(", ")
        );
        let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        vals.push(rusqlite::types::Value::Integer(profile_id));
        for id in chunk {
            vals.push(rusqlite::types::Value::Integer(*id));
        }
        tx.execute(&sql, params_from_iter(vals.iter()))
            .map_err(|e| format!("Failed deleting trashed layers: {}", e))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed committing empty layer trash: {}", e))?;
    Ok(deleted_ids)
}

#[tauri::command]
pub async fn trash_layer_files(
    app: AppHandle,
    state: State<'_, AppState>,
    layer_ids: Vec<i64>,
) -> Result<LayerTrashSummary, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine_opt = app_clone.try_state::<AudioEngineState>().map(|s| s.inner().clone());
        let mut conn = state_owned.lock_db();
        let affected_ids = trash_layer_files_with_conn(
            &mut conn,
            &state_owned.user_dir,
            engine_opt.as_ref(),
            &layer_ids,
        )?;
        let mut summary = query_layer_trash_status_with_conn(&conn, &state_owned.user_dir)?;
        summary.affected_count = affected_ids.len();
        summary.affected_ids = affected_ids;
        Ok(summary)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Trash layers failed: {}", e)))?
}

#[tauri::command]
pub async fn restore_trashed_layer_files(
    app: AppHandle,
    state: State<'_, AppState>,
    layer_ids: Option<Vec<i64>>,
) -> Result<LayerTrashSummary, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine_opt = app_clone.try_state::<AudioEngineState>().map(|s| s.inner().clone());
        let mut conn = state_owned.lock_db();
        let affected_ids = restore_trashed_layer_files_with_conn(
            &mut conn,
            &state_owned.user_dir,
            engine_opt.as_ref(),
            layer_ids.as_deref(),
        )?;
        let mut summary = query_layer_trash_status_with_conn(&conn, &state_owned.user_dir)?;
        summary.affected_count = affected_ids.len();
        summary.affected_ids = affected_ids;
        Ok(summary)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Restore layers failed: {}", e)))?
}

#[tauri::command]
pub async fn get_layer_trash_status(state: State<'_, AppState>) -> Result<LayerTrashSummary, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_read_conn(&state_owned, |conn| {
            query_layer_trash_status_with_conn(conn, &state_owned.user_dir)
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer trash status failed: {}", e)))?
}

#[tauri::command]
pub async fn list_trashed_layers(
    state: State<'_, AppState>,
) -> Result<Vec<LayerHistoryRecord>, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_read_conn(&state_owned, |conn| {
            list_trashed_layers_with_conn(conn, &state_owned.user_dir)
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("List trashed layers failed: {}", e)))?
}

#[tauri::command]
pub async fn empty_trashed_layers(
    app: AppHandle,
    state: State<'_, AppState>,
    layer_ids: Option<Vec<i64>>,
) -> Result<LayerTrashSummary, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine_opt = app_clone.try_state::<AudioEngineState>().map(|s| s.inner().clone());
        let mut conn = state_owned.lock_db();
        let affected_ids = empty_trashed_layers_with_conn(
            &mut conn,
            &state_owned.user_dir,
            engine_opt.as_ref(),
            layer_ids.as_deref(),
        )?;
        let mut summary = query_layer_trash_status_with_conn(&conn, &state_owned.user_dir)?;
        summary.affected_count = affected_ids.len();
        summary.affected_ids = affected_ids;
        Ok(summary)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Empty layer trash failed: {}", e)))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{write_wav_i16, LayerClipSpec, LayerLaneSpec, LayerRecipe};
    use crate::commands::layers::history::{
        list_layer_history_with_conn, rename_layer_item_with_conn, toggle_layer_favorite_with_conn,
    };
    use crate::commands::layers::render::{save_layer_mix_with_conn, SaveLayerInput};
    use crate::db::init_schema_on_conn;

    #[test]
    fn layer_lifecycle_save_overwrite_rename_favorite_trash_and_restore() {
        let root = std::env::temp_dir().join(format!("audify_layer_cmd_{}", std::process::id()));
        let user_dir = root.join("user");
        let lib_dir = root.join("lib");
        fs::create_dir_all(&user_dir).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let src_wav = lib_dir.join("impact_hit.wav");
        write_wav_i16(&src_wav, 48_000, 1, &vec![16_000i16; 9_600]).unwrap();

        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, ?1, 'SFX', 1)",
            params![lib_dir.to_string_lossy().to_string()],
        )
        .unwrap();

        let recipe = LayerRecipe {
            version: 1,
            lanes: vec![LayerLaneSpec {
                id: "lane-1".to_string(),
                name: "Impact".to_string(),
                color_hex: "#38BDF8".to_string(),
                volume_db: 0.0,
                muted: false,
                solo: false,
            }],
            clips: vec![LayerClipSpec {
                id: "clip-1".to_string(),
                lane_id: "lane-1".to_string(),
                source_sample_id: None,
                source_path: src_wav.to_string_lossy().to_string(),
                source_name: "impact_hit.wav".to_string(),
                start_sec: 0.0,
                trim_start_sec: 0.0,
                trim_end_sec: 0.2,
                fade_in_sec: 0.01,
                fade_out_sec: 0.02,
                gain_db: 0.0,
                pitch_semitones: 0.0,
                pitch_mode: Default::default(),
                reversed: false,
            }],
            master_gain_db: 0.0,
            snap_enabled: true,
            snap_grid_sec: 0.1,
        };

        // 1. Save new layer
        let (saved, _) = save_layer_mix_with_conn(
            &conn,
            &user_dir,
            None,
            &SaveLayerInput {
                recipe: &recipe,
                name: "SciFi_Boom",
                overwrite_layer_id: None,
                custom_dir: None,
                export_preset: Some("nle_48k_24"),
                export_loudness_mode: Some("off"),
            },
        )
        .unwrap();
        assert_eq!(saved.layer_name, "SciFi_Boom.wav");
        assert!(saved.file_exists);
        assert_eq!(saved.lane_count, 1);
        assert_eq!(saved.clip_count, 1);
        assert_eq!(saved.bit_depth, 24);

        // 2. Toggle favorite
        let fav = toggle_layer_favorite_with_conn(&conn, saved.id).unwrap();
        assert!(fav.is_favorite);

        // 3. Rename layer
        let renamed =
            rename_layer_item_with_conn(&conn, &user_dir, None, saved.id, "Boss_Slam_v2").unwrap();
        assert_eq!(renamed.layer_name, "Boss_Slam_v2.wav");
        assert!(Path::new(&renamed.layer_path).is_file());

        // 4. Overwrite existing layer with modified recipe
        let mut updated_recipe = recipe.clone();
        updated_recipe.clips[0].fade_out_sec = 0.05;
        let (overwritten, _) = save_layer_mix_with_conn(
            &conn,
            &user_dir,
            None,
            &SaveLayerInput {
                recipe: &updated_recipe,
                name: "Boss_Slam_v2",
                overwrite_layer_id: Some(renamed.id),
                custom_dir: None,
                export_preset: Some("nle_48k_24"),
                export_loudness_mode: Some("off"),
            },
        )
        .unwrap();
        assert_eq!(overwritten.id, renamed.id);
        assert!(overwritten.recipe_json.contains("0.05"));

        // 5. Trash & verify quarantine
        let trashed_ids = trash_layer_files_with_conn(&mut conn, &user_dir, None, &[renamed.id]).unwrap();
        assert_eq!(trashed_ids, vec![renamed.id]);
        assert!(!Path::new(&renamed.layer_path).exists());
        assert!(list_layer_history_with_conn(&conn).unwrap().is_empty());
        let trashed_list = list_trashed_layers_with_conn(&conn, &user_dir).unwrap();
        assert_eq!(trashed_list.len(), 1);
        assert!(trashed_list[0].file_exists);

        // 6. Restore & verify WAV back on disk
        let restored_ids =
            restore_trashed_layer_files_with_conn(&mut conn, &user_dir, None, Some(&[renamed.id]))
                .unwrap();
        assert_eq!(restored_ids, vec![renamed.id]);
        assert!(Path::new(&renamed.layer_path).is_file());
        assert_eq!(list_layer_history_with_conn(&conn).unwrap().len(), 1);

        // 7. Security check: out-of-scope source file must be rejected
        let rogue_wav = root.join("rogue.wav");
        write_wav_i16(&rogue_wav, 48_000, 1, &vec![4_000i16; 2_000]).unwrap();
        let mut rogue_recipe = recipe;
        rogue_recipe.clips[0].source_path = rogue_wav.to_string_lossy().to_string();
        assert!(save_layer_mix_with_conn(
            &conn,
            &user_dir,
            None,
            &SaveLayerInput {
                recipe: &rogue_recipe,
                name: "Bad_Layer",
                overwrite_layer_id: None,
                custom_dir: None,
                export_preset: None,
                export_loudness_mode: None,
            },
        )
        .is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
