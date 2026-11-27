use crate::commands::file_ops::{
    is_path_inside_quarantine_dir, query_trash_status_with_conn, TrashActionSummary,
};
use crate::db::get_active_profile_id;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, move_files_to_os_recycle_bin,
    sanitize_err,
};
use rusqlite::{params, params_from_iter, Connection};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn query_empty_trash_rows(
    conn: &Connection,
    sample_ids: Option<&[i64]>,
) -> Result<Vec<(i64, String, String)>, String> {
    let active_id = get_active_profile_id(conn);
    match sample_ids {
        Some(ids) if !ids.is_empty() => {
            let mut list = Vec::with_capacity(ids.len());
            for chunk in ids.chunks(500) {
                let placeholders: Vec<String> =
                    (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
                let sql = format!(
                    "SELECT s.id, COALESCE(s.trash_file_path, s.file_path), l.path, COALESCE(l.is_read_only, 0), l.name
                     FROM samples s
                     INNER JOIN libraries l ON l.id = s.library_id
                     WHERE COALESCE(s.is_trashed, 0) = 1
                       AND (l.is_global = 1
                            OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
                       AND s.id IN ({})",
                    placeholders.join(", ")
                );
                let mut params_vec: Vec<rusqlite::types::Value> =
                    Vec::with_capacity(chunk.len() + 1);
                params_vec.push(rusqlite::types::Value::Integer(active_id));
                for id in chunk {
                    params_vec.push(rusqlite::types::Value::Integer(*id));
                }
                if let Ok(mut stmt) = conn.prepare(&sql) {
                    if let Ok(rows) = stmt.query_map(params_from_iter(params_vec.iter()), |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, bool>(3)?,
                            r.get::<_, String>(4)?,
                        ))
                    }) {
                        for row in rows.flatten() {
                            if row.3 {
                                return Err(format!(
                                    "Library '{}' is locked as a Protected Read-Only Vault. Unlock it in Settings > Libraries before permanently deleting files.",
                                    row.4
                                ));
                            }
                            list.push((row.0, row.1, row.2));
                        }
                    }
                }
            }
            Ok(list)
        }
        _ => {
            let mut stmt = conn
                .prepare(
                    "SELECT s.id, COALESCE(s.trash_file_path, s.file_path), l.path, COALESCE(l.is_read_only, 0), l.name
                     FROM samples s
                     INNER JOIN libraries l ON l.id = s.library_id
                     WHERE COALESCE(s.is_trashed, 0) = 1
                       AND (l.is_global = 1
                            OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))",
                )
                .map_err(|_| "Failed to query trashed samples".to_string())?;
            let mapped = stmt
                .query_map(params![active_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, bool>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                })
                .map_err(|_| "Failed to read trashed samples".to_string())?;
            let mut list = Vec::new();
            for row in mapped.flatten() {
                if row.3 {
                    return Err(format!(
                        "Library '{}' is locked as a Protected Read-Only Vault. Unlock it in Settings > Libraries before permanently deleting files.",
                        row.4
                    ));
                }
                list.push((row.0, row.1, row.2));
            }
            Ok(list)
        }
    }
}

pub(super) fn exec_empty_trash_disk(
    rows: &[(i64, String, String)],
    user_dir: &Path,
    use_os_recycle_bin: bool,
) -> Result<(), String> {
    let mut disk_files: Vec<PathBuf> = Vec::new();
    for (_, path_str, lib_path) in rows {
        let trimmed = path_str.trim();
        if trimmed.is_empty()
            || is_unc_or_network_path(trimmed)
            || has_ntfs_ads_colon(trimmed)
        {
            continue;
        }
        let pb = PathBuf::from(trimmed);
        if crate::security::reject_symlink_ancestors(&pb).is_err() {
            continue;
        }
        if let Ok(sym_meta) = fs::symlink_metadata(&pb) {
            if !sym_meta.file_type().is_symlink() && sym_meta.file_type().is_file() {
                if let Ok(canon) = pb.canonicalize() {
                    if is_path_inside_quarantine_dir(&canon, user_dir, lib_path) {
                        disk_files.push(pb);
                    }
                }
            }
        }
    }

    if !disk_files.is_empty() {
        if use_os_recycle_bin {
            move_files_to_os_recycle_bin(&disk_files).map_err(|e| sanitize_err(user_dir, &e))?;
        } else {
            for pb in &disk_files {
                fs::remove_file(pb).map_err(|e| {
                    format!(
                        "Failed deleting trashed file {}: {}",
                        display_leaf(pb),
                        sanitize_err(user_dir, &e.to_string())
                    )
                })?;
            }
        }
    }
    Ok(())
}

pub(super) fn commit_empty_trash_db(
    conn: &mut Connection,
    user_dir: &Path,
    rows: &[(i64, String, String)],
) -> Result<TrashActionSummary, String> {
    let tx = conn.transaction().map_err(|e| {
        format!(
            "Failed to start empty trash transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;

    for chunk in rows.chunks(500) {
        let placeholders: Vec<String> = (1..=chunk.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "DELETE FROM samples WHERE COALESCE(is_trashed, 0) = 1 AND id IN ({})",
            placeholders.join(", ")
        );
        let params_vec: Vec<rusqlite::types::Value> = chunk
            .iter()
            .map(|(sid, _, _)| rusqlite::types::Value::Integer(*sid))
            .collect();
        tx.execute(&sql, params_from_iter(params_vec.iter()))
            .map_err(|e| {
                format!(
                    "Failed to delete trashed sample records: {}",
                    sanitize_err(user_dir, &e.to_string())
                )
            })?;
    }
    let affected_ids: Vec<i64> = rows.iter().map(|(sid, _, _)| *sid).collect();

    // Clean up orphaned auto-tags and auto-genres while preserving user-created ones, system roots, and parent tags
    let _ = crate::db::prune_orphan_auto_tags(&tx);

    tx.commit().map_err(|e| {
        format!(
            "Failed to commit empty trash transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;

    let status = query_trash_status_with_conn(conn)?;
    Ok(TrashActionSummary {
        affected_count: affected_ids.len(),
        affected_ids,
        trashed_count: status.trashed_count,
        total_bytes: status.total_bytes,
    })
}
