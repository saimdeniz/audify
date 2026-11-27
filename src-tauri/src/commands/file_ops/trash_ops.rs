use crate::ai_tagger::AiTaggerState;
use crate::commands::file_ops::{
    is_same_folder_path, is_same_volume, move_file_resilient, prune_file_ops_journal,
    query_trash_status_with_conn, rollback_disk_moves, validate_writable_library_folder,
    TrashActionSummary, TrashStatusInfo,
};
use crate::db::{get_active_profile_id, run_read_query, AppState};
use crate::security::{
    has_ntfs_ads_colon, is_dos_device_name, is_safe_library_dir, is_unc_or_network_path,
    normalize_clean_path, sanitize_err, truncate_filename_stem_utf16, AuthorizedAudioScope,
};
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

static TRASH_NONCE: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub async fn get_trash_status(state: State<'_, AppState>) -> Result<TrashStatusInfo, String> {
    run_read_query(&state, query_trash_status_with_conn).await
}

pub(crate) fn move_samples_to_trash_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    sample_ids: &[i64],
) -> Result<TrashActionSummary, String> {
    if sample_ids.is_empty() {
        let status = query_trash_status_with_conn(conn)?;
        return Ok(TrashActionSummary {
            affected_count: 0,
            affected_ids: Vec::new(),
            trashed_count: status.trashed_count,
            total_bytes: status.total_bytes,
        });
    }

    #[derive(Clone)]
    struct TrashCandidate {
        sample_id: i64,
        file_path: String,
        file_name: String,
        lib_path: String,
        lib_name: String,
        lib_read_only: bool,
        is_trashed: bool,
    }

    let active_id = get_active_profile_id(conn);
    let mut candidates = Vec::with_capacity(sample_ids.len());
    for &sid in sample_ids {
        if let Ok(cand) = conn.query_row(
            "SELECT s.id, s.file_path, s.file_name, l.path, l.name,
                    COALESCE(l.is_read_only, 0), COALESCE(s.is_trashed, 0)
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE s.id = ?1
               AND (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2))",
            params![sid, active_id],
            |r| {
                Ok(TrashCandidate {
                    sample_id: r.get(0)?,
                    file_path: r.get(1)?,
                    file_name: r.get(2)?,
                    lib_path: r.get(3)?,
                    lib_name: r.get(4)?,
                    lib_read_only: r.get(5)?,
                    is_trashed: r.get(6)?,
                })
            },
        ) {
            if cand.lib_read_only {
                return Err(format!(
                    "Library '{}' is locked as a Protected Read-Only Vault. Unlock it in Settings > Libraries or Advanced before moving files to Trash.",
                    cand.lib_name
                ));
            }
            if !cand.is_trashed {
                candidates.push(cand);
            }
        }
    }

    let user_trash_dir = user_dir.join("trash");
    let _ = fs::create_dir_all(&user_trash_dir);

    // Pre-resolve authorized scope ONCE outside the per-sample loop (eliminates N+1 DB scope queries)
    let audio_scope = AuthorizedAudioScope::from_conn(conn, user_dir);
    let mut moved_records: Vec<(i64, String, String, String)> = Vec::new();
    let mut completed_disk_moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    for cand in &candidates {
        let resolved_src = match audio_scope.validate_audio_path(&cand.file_path) {
            Ok(p) => p,
            Err(e) => {
                rollback_disk_moves(&completed_disk_moves);
                return Err(e);
            }
        };
        let safe_leaf_name = cand.file_name.trim();
        if safe_leaf_name.is_empty()
            || safe_leaf_name.contains('/')
            || safe_leaf_name.contains('\\')
            || safe_leaf_name.contains(':')
            || safe_leaf_name == ".."
            || is_dos_device_name(safe_leaf_name)
        {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Invalid source file name recorded for sample".to_string());
        }
        let quarantine_dir = if is_same_volume(&resolved_src, &user_trash_dir) {
            user_trash_dir.clone()
        } else {
            let safe_lib = match is_safe_library_dir(&cand.lib_path) {
                Ok(p) => p,
                Err(e) => {
                    rollback_disk_moves(&completed_disk_moves);
                    return Err(sanitize_err(user_dir, &e));
                }
            };
            let q = safe_lib.join(".audify_trash");
            if is_unc_or_network_path(&q.to_string_lossy())
                || has_ntfs_ads_colon(&q.to_string_lossy())
            {
                rollback_disk_moves(&completed_disk_moves);
                return Err("Invalid quarantine folder path".to_string());
            }
            q
        };
        if let Err(e) = fs::create_dir_all(&quarantine_dir) {
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Failed to create quarantine folder: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
        if fs::symlink_metadata(&quarantine_dir)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
        {
            rollback_disk_moves(&completed_disk_moves);
            return Err("Quarantine folder cannot be a symbolic link".to_string());
        }

        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let nonce = TRASH_NONCE.fetch_add(1, Ordering::Relaxed);
        let prefix = format!("{}_{:x}{:x}_", cand.sample_id, ts_ms & 0xFFFF_FFFF, nonce);
        let leaf_path = Path::new(safe_leaf_name);
        let leaf_stem = leaf_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Audio");
        let leaf_ext = leaf_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let ext_part = if leaf_ext.is_empty() {
            String::new()
        } else {
            format!(".{}", leaf_ext)
        };
        let reserved_units = prefix.encode_utf16().count() + ext_part.encode_utf16().count();
        let bounded_stem = truncate_filename_stem_utf16(leaf_stem, reserved_units);
        let quarantine_file_name = format!("{}{}{}", prefix, bounded_stem, ext_part);
        let dst_pb = quarantine_dir.join(&quarantine_file_name);

        if let Err(e) = move_file_resilient(&resolved_src, &dst_pb) {
            rollback_disk_moves(&completed_disk_moves);
            return Err(e);
        }
        completed_disk_moves.push((resolved_src.clone(), dst_pb.clone()));

        let norm_orig = normalize_clean_path(&resolved_src.to_string_lossy());
        let norm_trash = normalize_clean_path(&dst_pb.to_string_lossy());
        moved_records.push((
            cand.sample_id,
            norm_orig,
            norm_trash,
            cand.file_name.clone(),
        ));
    }

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Failed to start trash transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    let mut affected_ids = Vec::with_capacity(moved_records.len());
    for (sid, norm_orig, norm_trash, fname) in &moved_records {
        if let Err(e) = tx.execute(
            "UPDATE samples
             SET is_trashed = 1,
                 trashed_at = datetime('now'),
                 original_file_path = ?1,
                 trash_file_path = ?2,
                 file_path = ?2
             WHERE id = ?3",
            params![norm_orig, norm_trash, sid],
        ) {
            drop(tx);
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Failed to mark sample {} as trashed: {}",
                sid,
                sanitize_err(user_dir, &e.to_string())
            ));
        }

        let _ = tx.execute(
            "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
             VALUES (?1, 'TRASH', ?2, ?3, ?4, ?4)",
            params![sid, norm_orig, norm_trash, fname],
        );
        affected_ids.push(*sid);
    }
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        rollback_disk_moves(&completed_disk_moves);
        return Err(format!(
            "Failed to commit trash transaction: {}",
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

#[tauri::command]
pub async fn move_samples_to_trash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<TrashActionSummary, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let state_owned = state.inner().clone();
    let sample_ids = sample_ids.unwrap_or_default();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        move_samples_to_trash_with_conn(&mut conn, &state_owned.user_dir, &sample_ids)
    })
    .await
    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))??;
    ai_state.remove_vectors_from_cache(&res.affected_ids);
    Ok(res)
}

fn remove_empty_subfolder_tree(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() && !ft.is_symlink() {
                let _ = remove_empty_subfolder_tree(&path);
            }
        }
    }
    fs::remove_dir(dir).is_ok()
}

pub(crate) fn trash_physical_subfolder_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    library_id: i64,
    folder_path: &str,
) -> Result<TrashActionSummary, String> {
    let (norm_lib_path, _, clean_folder_pb, norm_folder) =
        validate_writable_library_folder(conn, library_id, folder_path)?;

    if is_same_folder_path(&norm_folder, &norm_lib_path) {
        return Err(
            "Cannot delete the root library folder from the tree. Remove the library in Settings > Libraries instead."
                .to_string(),
        );
    }

    let prefix_slash = format!("{}/", norm_folder);
    let prefix_lower = prefix_slash.to_lowercase();

    let mut sample_ids: Vec<i64> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path FROM samples
                 WHERE library_id = ?1 AND COALESCE(is_trashed, 0) = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![library_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for (sid, fp) in rows.flatten() {
            let norm_fp = normalize_clean_path(&fp);
            let inside = if cfg!(windows) {
                norm_fp.to_lowercase().starts_with(&prefix_lower)
            } else {
                norm_fp.starts_with(&prefix_slash)
            };
            if inside {
                sample_ids.push(sid);
            }
        }
    }

    let summary = move_samples_to_trash_with_conn(conn, user_dir, &sample_ids)?;
    let _ = remove_empty_subfolder_tree(&clean_folder_pb);
    Ok(summary)
}

#[tauri::command]
pub async fn trash_physical_subfolder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    library_id: i64,
    folder_path: String,
) -> Result<TrashActionSummary, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let state_owned = state.inner().clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        trash_physical_subfolder_with_conn(&mut conn, &state_owned.user_dir, library_id, &folder_path)
    })
    .await
    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))??;
    ai_state.remove_vectors_from_cache(&res.affected_ids);
    Ok(res)
}