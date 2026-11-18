mod empty;
mod restore_plan;

use crate::ai_tagger::AiTaggerState;
use crate::commands::file_ops::{
    is_dir_inside_library_root, is_path_inside_quarantine_dir, move_file_resilient,
    query_trash_status_with_conn, rollback_disk_moves, TrashActionSummary,
};
use crate::db::AppState;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path, sanitize_err,
    strip_verbatim_prefix,
};
use restore_plan::{
    commit_restore_db, query_restore_rows, resolve_non_colliding_restore_path,
    validate_and_create_restore_parent, RestoreRow,
};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

type RestoredSampleUpdate = (i64, String, String, String);
type RestoreDiskOutcome = (Vec<RestoredSampleUpdate>, Vec<(PathBuf, PathBuf)>);

fn exec_restore_disk(
    rows_to_restore: &[RestoreRow],
    user_dir: &Path,
) -> Result<RestoreDiskOutcome, String> {
    let mut restored_updates: Vec<RestoredSampleUpdate> = Vec::new();
    let mut completed_disk_moves: Vec<(PathBuf, PathBuf)> = Vec::new();

    for item in rows_to_restore {
        let trash_src_str = if !item.trash_file_path.trim().is_empty() {
            &item.trash_file_path
        } else {
            &item.file_path
        };
        let orig_dst_str = if !item.original_file_path.trim().is_empty() {
            &item.original_file_path
        } else {
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Original file path is missing for trashed sample '{}'",
                item.file_name
            ));
        };

        if is_unc_or_network_path(trash_src_str)
            || is_unc_or_network_path(orig_dst_str)
            || has_ntfs_ads_colon(trash_src_str)
            || has_ntfs_ads_colon(orig_dst_str)
        {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Unsafe or network path rejected during restore".to_string());
        }

        let src_pb = PathBuf::from(trash_src_str);
        let Ok(sym_meta) = fs::symlink_metadata(&src_pb) else {
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Quarantined file '{}' could not be found on disk",
                display_leaf(&src_pb)
            ));
        };
        if sym_meta.file_type().is_symlink() || !sym_meta.file_type().is_file() {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Refusing to restore symbolic link or non-regular file".to_string());
        }

        let Ok(src_canon) = src_pb.canonicalize() else {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Failed to canonicalize quarantined file path".to_string());
        };
        if !is_path_inside_quarantine_dir(&src_canon, user_dir, &item.lib_path) {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Quarantined source path is outside Audify Trash scope".to_string());
        }

        let desired_pb = PathBuf::from(orig_dst_str);
        let Some(dst_parent) = desired_pb.parent() else {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Restore target path has no parent directory".to_string());
        };
        if let Err(e) = validate_and_create_restore_parent(dst_parent, &desired_pb, &item.lib_path, user_dir) {
            rollback_disk_moves(&completed_disk_moves);
            return Err(e);
        }

        let final_dst_pb = resolve_non_colliding_restore_path(&desired_pb);
        if let Err(e) = move_file_resilient(&src_pb, &final_dst_pb) {
            rollback_disk_moves(&completed_disk_moves);
            return Err(sanitize_err(user_dir, &e));
        }
        completed_disk_moves.push((src_pb.clone(), final_dst_pb.clone()));

        let canon_dst = fs::canonicalize(&final_dst_pb).map_err(|e| {
            rollback_disk_moves(&completed_disk_moves);
            format!(
                "Failed to verify restored file destination '{}': {}",
                display_leaf(&final_dst_pb),
                sanitize_err(user_dir, &e.to_string())
            )
        })?;
        if let Some(parent) = canon_dst.parent() {
            if !is_dir_inside_library_root(parent, &item.lib_path) {
                rollback_disk_moves(&completed_disk_moves);
                return Err(
                    "Restored destination escaped registered library directory".to_string(),
                );
            }
        }
        let clean_dst = strip_verbatim_prefix(&canon_dst);
        let norm_dst = normalize_clean_path(&clean_dst.to_string_lossy());
        let final_file_name = clean_dst
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&item.file_name)
            .to_string();

        restored_updates.push((
            item.id,
            norm_dst,
            final_file_name,
            normalize_clean_path(trash_src_str),
        ));
    }

    Ok((restored_updates, completed_disk_moves))
}

pub(crate) fn restore_samples_from_trash_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    sample_ids: &[i64],
) -> Result<TrashActionSummary, String> {
    let rows = query_restore_rows(conn, sample_ids)?;
    let (updates, completed) = exec_restore_disk(&rows, user_dir)?;
    commit_restore_db(conn, user_dir, &updates, &completed)
}

#[tauri::command]
pub async fn restore_samples_from_trash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<TrashActionSummary, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let state_owned = state.inner().clone();
    let ids = sample_ids.unwrap_or_default();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let rows = {
            let conn = state_owned.lock_db();
            query_restore_rows(&conn, &ids)?
        };
        let (updates, completed) = exec_restore_disk(&rows, &state_owned.user_dir)?;
        let mut conn = state_owned.lock_db();
        commit_restore_db(&mut conn, &state_owned.user_dir, &updates, &completed)
    })
    .await
    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))??;
    if res.affected_count > 0 {
        ai_state.invalidate_vector_cache();
    }
    Ok(res)
}

pub(crate) fn empty_audify_trash_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    sample_ids: Option<&[i64]>,
    use_os_recycle_bin: bool,
) -> Result<TrashActionSummary, String> {
    let rows = empty::query_empty_trash_rows(conn, sample_ids)?;
    if rows.is_empty() {
        let status = query_trash_status_with_conn(conn)?;
        return Ok(TrashActionSummary {
            affected_count: 0,
            affected_ids: Vec::new(),
            trashed_count: status.trashed_count,
            total_bytes: status.total_bytes,
        });
    }
    empty::exec_empty_trash_disk(&rows, user_dir, use_os_recycle_bin)?;
    empty::commit_empty_trash_db(conn, user_dir, &rows)
}

#[tauri::command]
pub async fn empty_audify_trash(
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<TrashActionSummary, String> {
    let state_owned = state.inner().clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let rows = {
            let conn = state_owned.lock_db();
            let rows = empty::query_empty_trash_rows(&conn, sample_ids.as_deref())?;
            if rows.is_empty() {
                let status = query_trash_status_with_conn(&conn)?;
                return Ok(TrashActionSummary {
                    affected_count: 0,
                    affected_ids: Vec::new(),
                    trashed_count: status.trashed_count,
                    total_bytes: status.total_bytes,
                });
            }
            rows
        };
        empty::exec_empty_trash_disk(&rows, &state_owned.user_dir, true)?;
        let mut conn = state_owned.lock_db();
        empty::commit_empty_trash_db(&mut conn, &state_owned.user_dir, &rows)
    })
    .await
    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))??;
    ai_state.remove_vectors_from_cache(&res.affected_ids);
    Ok(res)
}