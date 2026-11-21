use super::{
    collect_authorized_slice_dirs, ensure_existing_slice_in_scope, format_os_display_path,
    query_slice_record_by_id, resolve_slice_trash_dir, SliceHistoryRecord,
};
use crate::commands::file_ops::{move_file_resilient, rollback_disk_moves};
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    display_leaf, has_ntfs_ads_colon, has_parent_dir_traversal, is_dos_device_name,
    is_unc_or_network_path, normalize_clean_path, sanitize_err, strip_verbatim_prefix,
};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, State};

static SLICE_TRASH_NONCE: AtomicU64 = AtomicU64::new(1);

pub(super) fn dedup_positive_ids(ids: &[i64]) -> Vec<i64> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(ids.len());
    for &id in ids {
        if id > 0 && seen.insert(id) {
            out.push(id);
        }
    }
    out
}

pub(crate) fn trash_slice_files_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    slice_ids: &[i64],
) -> Result<Vec<i64>, String> {
    let clean_ids = dedup_positive_ids(slice_ids);
    if clean_ids.is_empty() {
        return Ok(Vec::new());
    }
    let profile_id = get_active_profile_id(conn);
    let trash_dir = resolve_slice_trash_dir(user_dir);
    fs::create_dir_all(&trash_dir)
        .map_err(|_| "Failed preparing Audify slice trash quarantine".to_string())?;

    struct PlannedTrash {
        slice_id: i64,
        src_pb: PathBuf,
        trash_pb: PathBuf,
    }

    let mut planned: Vec<PlannedTrash> = Vec::with_capacity(clean_ids.len());
    let mut missing_row_ids: Vec<i64> = Vec::new();

    for slice_id in clean_ids {
        let Ok((slice_path, source_file_path)) = conn.query_row(
            "SELECT slice_path, source_file_path FROM sample_slices
             WHERE id = ?1 AND profile_id = ?2 AND COALESCE(is_trashed, 0) = 0",
            params![slice_id, profile_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) else {
            continue;
        };

        let norm_slice = normalize_clean_path(&slice_path);
        if norm_slice.eq_ignore_ascii_case(&normalize_clean_path(&source_file_path)) {
            return Err("Refusing to trash source track".to_string());
        }

        let is_indexed_source: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM samples WHERE LOWER(REPLACE(file_path, '\\', '/')) = LOWER(?1))",
                params![norm_slice],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if is_indexed_source {
            return Err("Refusing to trash an indexed library source track".to_string());
        }

        if let Ok(resolved) = ensure_existing_slice_in_scope(conn, user_dir, &slice_path) {
            super::ensure_slice_not_in_readonly_library(conn, &resolved)?;
            let leaf = display_leaf(&resolved);
            let nonce = SLICE_TRASH_NONCE.fetch_add(1, Ordering::Relaxed);
            let trash_pb = trash_dir.join(format!("{}_{}_{}", slice_id, nonce, leaf));
            planned.push(PlannedTrash {
                slice_id,
                src_pb: resolved,
                trash_pb,
            });
        } else {
            missing_row_ids.push(slice_id);
        }
    }

    let mut completed_moves: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(planned.len());
    for item in &planned {
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
            return Err(format!("Failed starting slice trash transaction: {}", e));
        }
    };

    let mut trashed_ids = Vec::with_capacity(planned.len());
    for item in &planned {
        let trash_disp = format_os_display_path(&item.trash_pb);
        if tx
            .execute(
                "UPDATE sample_slices
                 SET is_trashed = 1, trash_file_path = ?1, trashed_at = datetime('now')
                 WHERE id = ?2 AND profile_id = ?3",
                params![trash_disp, item.slice_id, profile_id],
            )
            .is_err()
        {
            drop(tx);
            rollback_disk_moves(&completed_moves);
            return Err("Failed updating trashed slice state".to_string());
        }
        trashed_ids.push(item.slice_id);
    }

    for missing_id in missing_row_ids {
        let _ = tx.execute(
            "DELETE FROM sample_slices WHERE id = ?1 AND profile_id = ?2",
            params![missing_id, profile_id],
        );
    }

    if tx.commit().is_err() {
        rollback_disk_moves(&completed_moves);
        return Err("Failed committing trashed slice records".to_string());
    }

    Ok(trashed_ids)
}

fn is_restore_parent_authorized(target_parent: &Path, auth_dirs: &[PathBuf]) -> bool {
    let raw = target_parent.to_string_lossy();
    if raw.trim().is_empty()
        || is_unc_or_network_path(&raw)
        || has_ntfs_ads_colon(&raw)
        || has_parent_dir_traversal(&raw)
    {
        return false;
    }

    let mut pending_segments: Vec<String> = Vec::new();
    let mut cursor: Option<&Path> = Some(target_parent);
    let mut canon_existing: Option<PathBuf> = None;

    while let Some(dir) = cursor {
        if dir.exists() {
            let Ok(sym) = fs::symlink_metadata(dir) else {
                return false;
            };
            if sym.file_type().is_symlink() || !sym.file_type().is_dir() {
                return false;
            }
            let Ok(canon) = dir.canonicalize() else {
                return false;
            };
            canon_existing = Some(canon);
            break;
        }
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') || name.starts_with('$') || is_dos_device_name(name) {
                return false;
            }
            pending_segments.push(name.to_string());
        }
        cursor = dir.parent();
    }

    let Some(mut resolved) = canon_existing else {
        return false;
    };
    for seg in pending_segments.into_iter().rev() {
        resolved.push(seg);
    }

    auth_dirs.iter().any(|d| {
        d.canonicalize()
            .ok()
            .map(|cd| resolved.starts_with(&cd))
            .unwrap_or(false)
    })
}

pub(crate) fn restore_trashed_slice_files_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    slice_ids: &[i64],
) -> Result<Vec<SliceHistoryRecord>, String> {
    let clean_ids = dedup_positive_ids(slice_ids);
    if clean_ids.is_empty() {
        return Ok(Vec::new());
    }
    let profile_id = get_active_profile_id(conn);
    let trash_dir = resolve_slice_trash_dir(user_dir);
    let trash_canon = trash_dir
        .canonicalize()
        .map_err(|_| "Slice trash quarantine folder is missing".to_string())?;
    let auth_dirs = collect_authorized_slice_dirs(conn, user_dir);

    struct PlannedRestore {
        slice_id: i64,
        trash_pb: PathBuf,
        restore_pb: PathBuf,
        restore_name: String,
    }

    let path_collision_key = |p: &Path| -> String {
        let norm = normalize_clean_path(&strip_verbatim_prefix(p).to_string_lossy());
        if cfg!(windows) {
            norm.to_lowercase()
        } else {
            norm
        }
    };

    let mut db_path_owner: HashMap<String, i64> = HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT id, slice_path FROM sample_slices WHERE profile_id = ?1")
    {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        }) {
            for row in rows.flatten() {
                db_path_owner.insert(path_collision_key(Path::new(&row.1)), row.0);
            }
        }
    }
    let mut reserved_targets: HashSet<String> = HashSet::with_capacity(clean_ids.len());

    let mut planned: Vec<PlannedRestore> = Vec::with_capacity(clean_ids.len());
    for slice_id in clean_ids {
        let Ok((orig_path_str, trash_path_str)) = conn.query_row(
            "SELECT slice_path, COALESCE(trash_file_path, '') FROM sample_slices
             WHERE id = ?1 AND profile_id = ?2 AND COALESCE(is_trashed, 0) = 1",
            params![slice_id, profile_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) else {
            continue;
        };
        if trash_path_str.trim().is_empty() {
            continue;
        }
        let trash_pb = PathBuf::from(trash_path_str.trim());
        let Ok(sym) = fs::symlink_metadata(&trash_pb) else {
            continue;
        };
        if sym.file_type().is_symlink() || !sym.file_type().is_file() {
            continue;
        }
        let Ok(canon_trash_file) = trash_pb.canonicalize() else {
            continue;
        };
        if !canon_trash_file.starts_with(&trash_canon) {
            return Err("Refusing restore outside slice quarantine".to_string());
        }

        let orig_pb = PathBuf::from(&orig_path_str);
        let target_parent = orig_pb
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| user_dir.join("slices"));
        let safe_parent = if is_restore_parent_authorized(&target_parent, &auth_dirs)
            && fs::create_dir_all(&target_parent).is_ok()
            && !fs::symlink_metadata(&target_parent)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(true)
        {
            target_parent
        } else {
            let fallback = user_dir.join("slices");
            let _ = fs::create_dir_all(&fallback);
            fallback
        };

        let stem = orig_pb
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("slice");
        let is_target_free = |cand: &Path| -> bool {
            if cand.exists() {
                return false;
            }
            let key = path_collision_key(cand);
            if reserved_targets.contains(&key) {
                return false;
            }
            db_path_owner
                .get(&key)
                .is_none_or(|&owner| owner == slice_id)
        };
        let primary = safe_parent.join(format!("{}.wav", stem));
        let restore_pb = if is_target_free(&primary) {
            primary
        } else {
            let mut chosen = None;
            for idx in 1..10000 {
                let candidate = safe_parent.join(format!("{}_{:02}.wav", stem, idx));
                if is_target_free(&candidate) {
                    chosen = Some(candidate);
                    break;
                }
            }
            chosen.unwrap_or_else(|| {
                let nonce = SLICE_TRASH_NONCE.fetch_add(1, Ordering::Relaxed);
                safe_parent.join(format!("{}_{}_{}.wav", stem, slice_id, nonce))
            })
        };
        reserved_targets.insert(path_collision_key(&restore_pb));
        let restore_name = restore_pb
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("slice.wav")
            .to_string();

        planned.push(PlannedRestore {
            slice_id,
            trash_pb: strip_verbatim_prefix(&canon_trash_file),
            restore_pb,
            restore_name,
        });
    }

    if planned.is_empty() {
        return Ok(Vec::new());
    }

    let mut completed: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(planned.len());
    for item in &planned {
        if let Err(e) = move_file_resilient(&item.trash_pb, &item.restore_pb) {
            rollback_disk_moves(&completed);
            return Err(sanitize_err(user_dir, &e));
        }
        completed.push((item.trash_pb.clone(), item.restore_pb.clone()));
    }

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(&completed);
            return Err(format!("Failed starting slice restore transaction: {}", e));
        }
    };

    for item in &planned {
        let disp = format_os_display_path(&item.restore_pb);
        if tx
            .execute(
                "UPDATE sample_slices
                 SET slice_path = ?1, slice_name = ?2, is_trashed = 0, trash_file_path = NULL, trashed_at = NULL
                 WHERE id = ?3 AND profile_id = ?4",
                params![disp, item.restore_name, item.slice_id, profile_id],
            )
            .is_err()
        {
            drop(tx);
            rollback_disk_moves(&completed);
            return Err("Failed restoring trashed slice records".to_string());
        }
    }
    if tx.commit().is_err() {
        rollback_disk_moves(&completed);
        return Err("Failed committing restored slice records".to_string());
    }

    let mut restored = Vec::with_capacity(planned.len());
    for item in planned {
        if let Ok(rec) = query_slice_record_by_id(conn, profile_id, item.slice_id) {
            restored.push(rec);
        }
    }
    Ok(restored)
}

#[tauri::command]
pub fn trash_slice_files(
    app: AppHandle,
    state: State<'_, AppState>,
    slice_ids: Vec<i64>,
) -> Result<Vec<i64>, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    trash_slice_files_with_conn(&mut conn, &state.user_dir, &slice_ids)
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[tauri::command]
pub fn restore_trashed_slice_files(
    app: AppHandle,
    state: State<'_, AppState>,
    slice_ids: Vec<i64>,
) -> Result<Vec<SliceHistoryRecord>, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    restore_trashed_slice_files_with_conn(&mut conn, &state.user_dir, &slice_ids)
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}
