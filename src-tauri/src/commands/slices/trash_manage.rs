use super::history::{row_to_slice_record, SLICE_SELECT_COLS};
use super::trash::dedup_positive_ids;
use super::{
    format_os_display_path, resolve_slice_trash_dir, with_read_conn, SliceHistoryRecord,
    SliceTrashSummary,
};
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, move_files_to_os_recycle_bin,
    sanitize_err, strip_verbatim_prefix,
};
use rusqlite::{params_from_iter, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

fn verify_quarantined_slice_file(
    raw_path: &str,
    trash_dir: &Path,
) -> Result<Option<(PathBuf, u64)>, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Refusing unsafe slice quarantine path".to_string());
    }
    let pb = PathBuf::from(trimmed);
    let Ok(sym) = fs::symlink_metadata(&pb) else {
        return Ok(None);
    };
    if sym.file_type().is_symlink() || !sym.file_type().is_file() {
        return Err(format!(
            "Refusing symlink or non-file inside slice trash: {}",
            display_leaf(&pb)
        ));
    }
    let Ok(trash_canon) = trash_dir.canonicalize() else {
        return Ok(None);
    };
    let target_canon = pb
        .canonicalize()
        .map_err(|_| "Failed resolving quarantined slice path".to_string())?;
    if is_unc_or_network_path(&target_canon.to_string_lossy())
        || !target_canon.starts_with(&trash_canon)
    {
        return Err("Refusing access outside slice trash quarantine".to_string());
    }
    Ok(Some((strip_verbatim_prefix(&target_canon), sym.len())))
}

pub(crate) fn query_slice_trash_status_with_conn(
    conn: &Connection,
    user_dir: &Path,
) -> Result<SliceTrashSummary, String> {
    let profile_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(trash_file_path, '')
             FROM sample_slices
             WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
        )
        .map_err(|e| format!("Failed querying slice trash status: {}", e))?;

    let rows: Vec<(i64, String)> = stmt
        .query_map([profile_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Failed reading slice trash rows: {}", e))?
        .flatten()
        .collect();

    let trash_dir = resolve_slice_trash_dir(user_dir);
    let mut total_bytes: u64 = 0;
    for (_, trash_p) in &rows {
        if let Ok(Some((_, bytes))) = verify_quarantined_slice_file(trash_p, &trash_dir) {
            total_bytes = total_bytes.saturating_add(bytes);
        }
    }

    Ok(SliceTrashSummary {
        affected_count: 0,
        affected_ids: Vec::new(),
        trashed_count: rows.len(),
        total_bytes,
    })
}

pub(crate) fn list_trashed_slices_with_conn(
    conn: &Connection,
    user_dir: &Path,
) -> Result<Vec<SliceHistoryRecord>, String> {
    let profile_id = get_active_profile_id(conn);
    let sql = format!(
        "SELECT {} FROM sample_slices
         WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1
         ORDER BY COALESCE(trashed_at, created_at) DESC, id DESC
         LIMIT 5000",
        SLICE_SELECT_COLS
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed preparing trashed slices query: {}", e))?;
    let mut records: Vec<SliceHistoryRecord> = stmt
        .query_map([profile_id], row_to_slice_record)
        .map_err(|e| format!("Failed reading trashed slices: {}", e))?
        .flatten()
        .collect();

    let trash_dir = resolve_slice_trash_dir(user_dir);
    for rec in &mut records {
        let verified = rec
            .trash_file_path
            .as_deref()
            .and_then(|p| verify_quarantined_slice_file(p, &trash_dir).ok())
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

pub(crate) fn empty_trashed_slices_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    slice_ids: Option<&[i64]>,
    use_os_recycle_bin: bool,
) -> Result<SliceTrashSummary, String> {
    let profile_id = get_active_profile_id(conn);
    let mut rows: Vec<(i64, String)> = Vec::new();

    if let Some(raw_ids) = slice_ids {
        let clean_ids = dedup_positive_ids(raw_ids);
        if clean_ids.is_empty() {
            return query_slice_trash_status_with_conn(conn, user_dir);
        }
        for chunk in clean_ids.chunks(450) {
            let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT id, COALESCE(trash_file_path, '')
                 FROM sample_slices
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1 AND id IN ({})",
                placeholders.join(", ")
            );
            let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            params_vec.push(rusqlite::types::Value::Integer(profile_id));
            for id in chunk {
                params_vec.push(rusqlite::types::Value::Integer(*id));
            }
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed preparing trashed slice query: {}", e))?;
            let mut found: Vec<(i64, String)> = stmt
                .query_map(params_from_iter(params_vec.iter()), |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed reading trashed slice targets: {}", e))?
                .flatten()
                .collect();
            rows.append(&mut found);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, COALESCE(trash_file_path, '')
                 FROM sample_slices
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
            )
            .map_err(|e| format!("Failed preparing full slice trash query: {}", e))?;
        rows = stmt
            .query_map([profile_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Failed reading trashed slices: {}", e))?
            .flatten()
            .collect();
    }

    if rows.is_empty() {
        return query_slice_trash_status_with_conn(conn, user_dir);
    }

    let trash_dir = resolve_slice_trash_dir(user_dir);
    let mut disk_files: Vec<PathBuf> = Vec::with_capacity(rows.len());
    for (_, trash_p) in &rows {
        if let Some((clean_pb, _)) = verify_quarantined_slice_file(trash_p, &trash_dir)? {
            disk_files.push(clean_pb);
        }
    }

    if !disk_files.is_empty() {
        if use_os_recycle_bin {
            move_files_to_os_recycle_bin(&disk_files).map_err(|e| sanitize_err(user_dir, &e))?;
        } else {
            for pb in &disk_files {
                fs::remove_file(pb).map_err(|e| {
                    format!(
                        "Failed deleting trashed slice {}: {}",
                        display_leaf(pb),
                        sanitize_err(user_dir, &e.to_string())
                    )
                })?;
            }
        }
    }

    let affected_ids: Vec<i64> = rows.iter().map(|(id, _)| *id).collect();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting empty slice trash transaction: {}", e))?;

    for chunk in affected_ids.chunks(450) {
        let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "DELETE FROM sample_slices
             WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1 AND id IN ({})",
            placeholders.join(", ")
        );
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        params_vec.push(rusqlite::types::Value::Integer(profile_id));
        for id in chunk {
            params_vec.push(rusqlite::types::Value::Integer(*id));
        }
        tx.execute(&sql, params_from_iter(params_vec.iter()))
            .map_err(|e| format!("Failed deleting trashed slice records: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed committing empty slice trash transaction: {}", e))?;

    let post = query_slice_trash_status_with_conn(conn, user_dir)?;
    Ok(SliceTrashSummary {
        affected_count: affected_ids.len(),
        affected_ids,
        trashed_count: post.trashed_count,
        total_bytes: post.total_bytes,
    })
}

#[tauri::command]
pub fn get_slice_trash_status(state: State<'_, AppState>) -> Result<SliceTrashSummary, String> {
    with_read_conn(&state, |conn| query_slice_trash_status_with_conn(conn, &state.user_dir))
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[tauri::command]
pub fn list_trashed_slices(state: State<'_, AppState>) -> Result<Vec<SliceHistoryRecord>, String> {
    with_read_conn(&state, |conn| list_trashed_slices_with_conn(conn, &state.user_dir))
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[tauri::command]
pub async fn empty_trashed_slices(
    app: AppHandle,
    state: State<'_, AppState>,
    slice_ids: Option<Vec<i64>>,
) -> Result<SliceTrashSummary, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        empty_trashed_slices_with_conn(&mut conn, &state_owned.user_dir, slice_ids.as_deref(), true)
    })
    .await
    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?
    .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::slices::trash_slice_files_with_conn;
    use crate::db::init_schema_on_conn;
    use rusqlite::params;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("audify_slice_trash_test_{}_{}", label, nonce));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        conn
    }

    fn insert_slice(conn: &Connection, slice_path: &Path, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO sample_slices (
                profile_id, slice_path, slice_name, source_sample_id,
                source_file_path, source_file_name, start_sec, end_sec,
                pitch_semitones, micro_fade, duration_ms,
                peaks_json, sample_rate, channels, bit_depth
             ) VALUES (1, ?1, ?2, NULL, 'C:/src/track.wav', 'track.wav', 0.5, 1.5, 0.0, 1, 1000, '[]', 48000, 2, 16)",
            params![slice_path.to_string_lossy().to_string(), name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn lists_checks_status_and_empties_trashed_slices() {
        let root = make_temp_dir("list_empty");
        let user_dir = root.join("user");
        let slices_dir = user_dir.join("slices");
        fs::create_dir_all(&slices_dir).unwrap();

        let wav_a = slices_dir.join("snare_01.wav");
        let wav_b = slices_dir.join("snare_02.wav");
        fs::write(&wav_a, vec![1u8; 256]).unwrap();
        fs::write(&wav_b, vec![2u8; 512]).unwrap();

        let mut conn = setup_db();
        let id_a = insert_slice(&conn, &wav_a, "snare_01.wav");
        let id_b = insert_slice(&conn, &wav_b, "snare_02.wav");

        let moved = trash_slice_files_with_conn(&mut conn, &user_dir, &[id_a, id_b]).unwrap();
        assert_eq!(moved.len(), 2);

        let listed = list_trashed_slices_with_conn(&conn, &user_dir).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|s| s.is_trashed && s.file_exists));
        assert!(listed.iter().all(|s| s.trash_file_path.is_some()));

        let status = query_slice_trash_status_with_conn(&conn, &user_dir).unwrap();
        assert_eq!(status.trashed_count, 2);
        assert_eq!(status.total_bytes, 768);

        let summary_one =
            empty_trashed_slices_with_conn(&mut conn, &user_dir, Some(&[id_a]), false).unwrap();
        assert_eq!(summary_one.affected_count, 1);
        assert_eq!(summary_one.affected_ids, vec![id_a]);
        assert_eq!(summary_one.trashed_count, 1);
        assert_eq!(summary_one.total_bytes, 512);

        let remaining = list_trashed_slices_with_conn(&conn, &user_dir).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, id_b);

        let summary_all = empty_trashed_slices_with_conn(&mut conn, &user_dir, None, false).unwrap();
        assert_eq!(summary_all.affected_count, 1);
        assert_eq!(summary_all.trashed_count, 0);
        assert_eq!(summary_all.total_bytes, 0);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_empty_outside_slice_quarantine() {
        let root = make_temp_dir("outside");
        let user_dir = root.join("user");
        let trash_dir = resolve_slice_trash_dir(&user_dir);
        fs::create_dir_all(&trash_dir).unwrap();
        let outside = root.join("secret.wav");
        fs::write(&outside, vec![9u8; 128]).unwrap();

        let mut conn = setup_db();
        let id = insert_slice(&conn, &outside, "secret.wav");
        conn.execute(
            "UPDATE sample_slices SET is_trashed = 1, trash_file_path = ?1 WHERE id = ?2",
            params![outside.to_string_lossy().to_string(), id],
        )
        .unwrap();

        let listed = list_trashed_slices_with_conn(&conn, &user_dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].file_exists);
        assert!(listed[0].trash_file_path.is_none());

        let err = empty_trashed_slices_with_conn(&mut conn, &user_dir, Some(&[id]), false)
            .unwrap_err();
        assert!(err.contains("outside"));
        assert!(outside.exists());

        let _ = fs::remove_dir_all(&root);
    }
}
