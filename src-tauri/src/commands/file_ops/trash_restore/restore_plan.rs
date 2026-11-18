use crate::commands::file_ops::{
    is_dir_inside_library_root, prune_file_ops_journal, query_trash_status_with_conn,
    rollback_disk_moves, TrashActionSummary,
};
use crate::db::get_active_profile_id;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, sanitize_err,
    strip_verbatim_prefix,
};
use rusqlite::{params, params_from_iter, Connection};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Clone)]
pub(super) struct RestoreRow {
    pub id: i64,
    pub file_name: String,
    pub file_path: String,
    pub original_file_path: String,
    pub trash_file_path: String,
    pub lib_path: String,
    pub lib_name: String,
    pub lib_read_only: bool,
}

pub(super) fn resolve_non_colliding_restore_path(original_path: &Path) -> PathBuf {
    if fs::symlink_metadata(original_path).is_err() {
        return original_path.to_path_buf();
    }
    let parent = original_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    let stem = original_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Restored_Audio");
    let ext = original_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    for idx in 1..1000 {
        let candidate_name = if ext.is_empty() {
            format!("{} (Restored {})", stem, idx)
        } else {
            format!("{} (Restored {}).{}", stem, idx, ext)
        };
        let cand_pb = parent.join(candidate_name);
        if fs::symlink_metadata(&cand_pb).is_err() {
            return cand_pb;
        }
    }
    original_path.to_path_buf()
}

pub(super) fn validate_and_create_restore_parent(
    dst_parent: &Path,
    desired_pb: &Path,
    lib_path: &str,
    user_dir: &Path,
) -> Result<PathBuf, String> {
    if desired_pb
        .components()
        .any(|c| matches!(c, Component::ParentDir))
        || desired_pb
            .to_string_lossy()
            .split(['/', '\\'])
            .any(|seg| seg == "..")
    {
        return Err("Parent directory traversal ('..') is not allowed in restore path".to_string());
    }
    if is_unc_or_network_path(lib_path) || has_ntfs_ads_colon(lib_path) {
        return Err("Unsafe library root rejected during restore".to_string());
    }
    let lib_pb = Path::new(lib_path);
    let lib_meta = fs::symlink_metadata(lib_pb)
        .map_err(|_| "Registered library root could not be found during restore".to_string())?;
    if lib_meta.file_type().is_symlink() || !lib_meta.is_dir() {
        return Err("Registered library root is invalid or a symbolic link".to_string());
    }
    let canon_lib = strip_verbatim_prefix(
        &fs::canonicalize(lib_pb).map_err(|_| "Failed to verify library root".to_string())?,
    );

    let mut cur = dst_parent.to_path_buf();
    let mut tail: Vec<String> = Vec::new();
    loop {
        match fs::symlink_metadata(&cur) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_dir() {
                    return Err(
                        "Refusing to restore into symbolic link or non-directory path".to_string(),
                    );
                }
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let seg = cur
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| "Restore target path has no valid ancestor".to_string())?
                    .to_string();
                tail.push(seg);
                cur = cur
                    .parent()
                    .ok_or_else(|| "Restore target path has no valid ancestor".to_string())?
                    .to_path_buf();
            }
            Err(_) => return Err("Failed to inspect restore destination parent".to_string()),
        }
    }

    let canon_ancestor = cur
        .canonicalize()
        .map_err(|_| "Failed to verify restore target directory".to_string())?;
    if !is_dir_inside_library_root(&canon_ancestor, lib_path) {
        return Err("Restore target path is outside the sample's registered library".to_string());
    }
    let clean_ancestor = strip_verbatim_prefix(&canon_ancestor);
    if let Ok(rel_existing) = clean_ancestor.strip_prefix(&canon_lib) {
        let mut step = canon_lib;
        for comp in rel_existing.components() {
            step.push(comp);
            if let Ok(meta) = fs::symlink_metadata(&step) {
                if meta.file_type().is_symlink() {
                    return Err("Refusing to traverse symbolic link in restore path".to_string());
                }
            }
        }
    }
    for seg in tail.iter().rev() {
        if seg.is_empty() || seg == ".." || has_ntfs_ads_colon(seg) || seg.contains(':') {
            return Err("Unsafe folder segment rejected in restore path".to_string());
        }
    }

    fs::create_dir_all(dst_parent).map_err(|e| {
        format!(
            "Failed to recreate target folder {}: {}",
            display_leaf(dst_parent),
            sanitize_err(user_dir, &e.to_string())
        )
    })?;
    let dst_parent_canon = dst_parent
        .canonicalize()
        .map_err(|_| "Failed to verify restore target directory".to_string())?;
    if !is_dir_inside_library_root(&dst_parent_canon, lib_path) {
        return Err("Restore target path is outside the sample's registered library".to_string());
    }
    Ok(dst_parent_canon)
}

pub(super) fn query_restore_rows(
    conn: &Connection,
    sample_ids: &[i64],
) -> Result<Vec<RestoreRow>, String> {
    let active_id = get_active_profile_id(conn);
    let rows_to_restore: Vec<RestoreRow> = if sample_ids.is_empty() {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.file_name, s.file_path,
                        COALESCE(s.original_file_path, ''),
                        COALESCE(s.trash_file_path, s.file_path),
                        l.path, l.name, COALESCE(l.is_read_only, 0)
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE COALESCE(s.is_trashed, 0) = 1
                   AND (l.is_global = 1
                        OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))",
            )
            .map_err(|_| "Failed to query trashed samples".to_string())?;
        let mapped = stmt
            .query_map(params![active_id], |r| {
                Ok(RestoreRow {
                    id: r.get(0)?,
                    file_name: r.get(1)?,
                    file_path: r.get(2)?,
                    original_file_path: r.get(3)?,
                    trash_file_path: r.get(4)?,
                    lib_path: r.get(5)?,
                    lib_name: r.get(6)?,
                    lib_read_only: r.get(7)?,
                })
            })
            .map_err(|_| "Failed to read trashed samples".to_string())?;
        mapped.flatten().collect()
    } else {
        let mut out = Vec::with_capacity(sample_ids.len());
        for chunk in sample_ids.chunks(500) {
            let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT s.id, s.file_name, s.file_path,
                        COALESCE(s.original_file_path, ''),
                        COALESCE(s.trash_file_path, s.file_path),
                        l.path, l.name, COALESCE(l.is_read_only, 0)
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE COALESCE(s.is_trashed, 0) = 1
                   AND (l.is_global = 1
                        OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
                   AND s.id IN ({})",
                placeholders.join(", ")
            );
            let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            params_vec.push(rusqlite::types::Value::Integer(active_id));
            for id in chunk {
                params_vec.push(rusqlite::types::Value::Integer(*id));
            }
            if let Ok(mut stmt) = conn.prepare(&sql) {
                if let Ok(mapped) = stmt.query_map(params_from_iter(params_vec.iter()), |r| {
                    Ok(RestoreRow {
                        id: r.get(0)?,
                        file_name: r.get(1)?,
                        file_path: r.get(2)?,
                        original_file_path: r.get(3)?,
                        trash_file_path: r.get(4)?,
                        lib_path: r.get(5)?,
                        lib_name: r.get(6)?,
                        lib_read_only: r.get(7)?,
                    })
                }) {
                    out.extend(mapped.flatten());
                }
            }
        }
        out
    };

    for item in &rows_to_restore {
        if item.lib_read_only {
            return Err(format!(
                "Library '{}' is locked as a Protected Read-Only Vault. Unlock it before restoring files.",
                item.lib_name
            ));
        }
    }
    Ok(rows_to_restore)
}

pub(super) fn commit_restore_db(
    conn: &mut Connection,
    user_dir: &Path,
    restored_updates: &[(i64, String, String, String)],
    completed_disk_moves: &[(PathBuf, PathBuf)],
) -> Result<TrashActionSummary, String> {
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(completed_disk_moves);
            return Err(format!(
                "Failed to start restore transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    let mut affected_ids = Vec::with_capacity(restored_updates.len());
    for (sid, norm_dst, final_name, old_trash_path) in restored_updates {
        if let Err(e) = tx.execute(
            "UPDATE samples
             SET is_trashed = 0,
                 trashed_at = NULL,
                 original_file_path = NULL,
                 trash_file_path = NULL,
                 file_path = ?1,
                 file_name = ?2
             WHERE id = ?3",
            params![norm_dst, final_name, sid],
        ) {
            drop(tx);
            rollback_disk_moves(completed_disk_moves);
            return Err(format!(
                "Failed to restore sample {}: {}",
                sid,
                sanitize_err(user_dir, &e.to_string())
            ));
        }

        let _ = tx.execute(
            "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
             VALUES (?1, 'RESTORE', ?2, ?3, ?4, ?4)",
            params![sid, old_trash_path, norm_dst, final_name],
        );
        affected_ids.push(*sid);
    }
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        rollback_disk_moves(completed_disk_moves);
        return Err(format!(
            "Failed to commit restore transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    let status = query_trash_status_with_conn(conn)?;
    Ok(TrashActionSummary {
        affected_count: affected_ids.len(),
        affected_ids,
        trashed_count: status.trashed_count,
        total_bytes: status.total_bytes,
    })
}
