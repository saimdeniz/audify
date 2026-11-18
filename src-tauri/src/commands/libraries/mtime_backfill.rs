use crate::db::AppState;
use crate::scanner::metadata_modified_ms;
use crate::security::{
    has_ntfs_ads_colon, is_safe_library_dir, is_unc_or_network_path, normalize_clean_path,
};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path};
use tauri::State;

const DEFAULT_BACKFILL_BATCH_SIZE: usize = 1500;
const MAX_BACKFILL_BATCH_SIZE: usize = 2000;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct FileMtimePatch {
    pub sample_id: i64,
    pub file_modified_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MtimeBackfillBatchResult {
    pub patches: Vec<FileMtimePatch>,
    pub last_scanned_id: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
struct PendingMtimeRow {
    id: i64,
    library_id: i64,
    file_path: String,
}

fn collect_missing_mtime_batch(
    conn: &Connection,
    after_id: i64,
    batch_size: usize,
) -> Result<(Vec<PendingMtimeRow>, bool), String> {
    let fetch_limit = (batch_size + 1) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT id, library_id, file_path
             FROM samples
             WHERE file_modified_at IS NULL
               AND COALESCE(is_trashed, 0) = 0
               AND id > ?1
             ORDER BY id ASC
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to prepare mtime backfill query: {}", e))?;

    let rows = stmt
        .query_map(params![after_id, fetch_limit], |r| {
            Ok(PendingMtimeRow {
                id: r.get(0)?,
                library_id: r.get(1)?,
                file_path: r.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query missing file timestamps: {}", e))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Failed to read sample row: {}", e))?);
    }

    let has_more = out.len() > batch_size;
    if has_more {
        out.truncate(batch_size);
    }
    Ok((out, has_more))
}

fn collect_library_raw_paths(conn: &Connection) -> HashMap<i64, String> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, path FROM libraries") {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
            for (lib_id, path) in rows.flatten() {
                map.insert(lib_id, path);
            }
        }
    }
    map
}

struct SafeLibraryPrefix {
    canon_norm: String,
    raw_norm: String,
}

fn format_prefix_key(norm: String) -> String {
    if cfg!(windows) {
        norm.to_lowercase()
    } else {
        norm
    }
}

fn is_path_inside_prefix(candidate_key: &str, prefix_key: &str) -> bool {
    if candidate_key.len() <= prefix_key.len() || !candidate_key.starts_with(prefix_key) {
        return false;
    }
    prefix_key.ends_with('/') || candidate_key.as_bytes()[prefix_key.len()] == b'/'
}

fn resolve_safe_library_roots(
    raw_paths: &HashMap<i64, String>,
) -> HashMap<i64, SafeLibraryPrefix> {
    let mut safe_roots = HashMap::new();
    for (&lib_id, raw) in raw_paths {
        if let Ok(safe_dir) = is_safe_library_dir(raw) {
            let canon_norm = format_prefix_key(normalize_clean_path(&safe_dir.to_string_lossy()));
            let raw_norm = format_prefix_key(normalize_clean_path(raw));
            safe_roots.insert(
                lib_id,
                SafeLibraryPrefix {
                    canon_norm,
                    raw_norm,
                },
            );
        }
    }
    safe_roots
}

fn resolve_mtime_patches_for_batch(
    candidates: &[PendingMtimeRow],
    raw_library_paths: &HashMap<i64, String>,
) -> Vec<FileMtimePatch> {
    let safe_roots = resolve_safe_library_roots(raw_library_paths);
    let mut patches = Vec::with_capacity(candidates.len());

    for row in candidates {
        let Some(lib_root) = safe_roots.get(&row.library_id) else {
            continue;
        };
        let fp = row.file_path.trim();
        if fp.is_empty() || is_unc_or_network_path(fp) || has_ntfs_ads_colon(fp) {
            continue;
        }
        let target_path = Path::new(fp);
        if target_path
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        {
            continue;
        }
        let fp_key = format_prefix_key(normalize_clean_path(fp));
        if !is_path_inside_prefix(&fp_key, &lib_root.canon_norm)
            && !is_path_inside_prefix(&fp_key, &lib_root.raw_norm)
        {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(target_path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        if let Some(modified_ms) = metadata_modified_ms(&meta) {
            patches.push(FileMtimePatch {
                sample_id: row.id,
                file_modified_at: modified_ms,
            });
        }
    }

    patches
}

fn apply_mtime_patches_with_conn(
    conn: &mut Connection,
    patches: &[FileMtimePatch],
) -> Result<(), String> {
    if patches.is_empty() {
        return Ok(());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start mtime backfill transaction: {}", e))?;
    {
        let mut stmt = tx
            .prepare(
                "UPDATE samples
                 SET file_modified_at = ?1
                 WHERE id = ?2 AND file_modified_at IS NULL",
            )
            .map_err(|e| format!("Failed to prepare mtime backfill update: {}", e))?;
        for patch in patches {
            stmt.execute(params![patch.file_modified_at, patch.sample_id])
                .map_err(|e| format!("Failed to update sample mtime: {}", e))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit mtime backfill transaction: {}", e))?;
    Ok(())
}

/// Silently backfills `samples.file_modified_at` in bounded batches without decoding audio,
/// keeping offline/missing files non-blocking via monotonic cursor pagination (`after_id`).
#[tauri::command]
pub async fn backfill_file_modified_dates(
    state: State<'_, AppState>,
    after_id: Option<i64>,
    batch_size: Option<usize>,
) -> Result<MtimeBackfillBatchResult, String> {
    let cursor = after_id.unwrap_or(0).max(0);
    let limit = batch_size
        .unwrap_or(DEFAULT_BACKFILL_BATCH_SIZE)
        .clamp(1, MAX_BACKFILL_BATCH_SIZE);
    let state_owned = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let (candidates, has_more, raw_library_paths) = {
            let conn = state_owned.lock_db();
            let (rows, more) = collect_missing_mtime_batch(&conn, cursor, limit)?;
            if rows.is_empty() {
                return Ok(MtimeBackfillBatchResult {
                    patches: Vec::new(),
                    last_scanned_id: cursor,
                    has_more: false,
                });
            }
            let lib_paths = collect_library_raw_paths(&conn);
            (rows, more, lib_paths)
        };

        let last_scanned_id = candidates.last().map(|r| r.id).unwrap_or(cursor);
        let patches = resolve_mtime_patches_for_batch(&candidates, &raw_library_paths);

        if !patches.is_empty() {
            let mut conn = state_owned.lock_db();
            apply_mtime_patches_with_conn(&mut conn, &patches)?;
        }

        Ok(MtimeBackfillBatchResult {
            patches,
            last_scanned_id,
            has_more,
        })
    })
    .await
    .map_err(|e| format!("Mtime backfill worker join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::libraries::sync::sync_library_with_conn_and_status;
    use crate::db::init_schema_on_conn;
    use std::path::PathBuf;

    fn make_test_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "audify_mtime_{}_{}_{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn backfill_batch_populates_local_files_and_skips_missing_or_unc() {
        let dir = make_test_temp_dir("backfill");
        let outside_dir = make_test_temp_dir("outside");
        let f1 = dir.join("kick.wav");
        let f2 = dir.join("snare.wav");
        let missing = dir.join("missing.wav");
        let outside = outside_dir.join("escape.wav");
        fs::write(&f1, b"RIFF0000WAVE").unwrap();
        fs::write(&f2, b"RIFF0000WAVE").unwrap();
        fs::write(&outside, b"RIFF0000WAVE").unwrap();

        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();

        let dir_norm = normalize_clean_path(&dir.to_string_lossy());
        conn.execute(
            "INSERT INTO libraries (id, path, name) VALUES (1, ?1, 'TestLib')",
            params![dir_norm],
        )
        .unwrap();

        let p1 = normalize_clean_path(&f1.to_string_lossy());
        let p2 = normalize_clean_path(&f2.to_string_lossy());
        let p_missing = normalize_clean_path(&missing.to_string_lossy());
        let p_outside = normalize_clean_path(&outside.to_string_lossy());
        let p_unc = r"\\evil-server\share\leak.wav";

        for (id, fp, fnm) in [
            (1i64, p1.as_str(), "kick.wav"),
            (2i64, p2.as_str(), "snare.wav"),
            (3i64, p_missing.as_str(), "missing.wav"),
            (4i64, p_outside.as_str(), "escape.wav"),
            (5i64, p_unc, "leak.wav"),
        ] {
            conn.execute(
                "INSERT INTO samples (id, library_id, file_path, file_name, extension)
                 VALUES (?1, 1, ?2, ?3, 'wav')",
                params![id, fp, fnm],
            )
            .unwrap();
        }

        let (rows, has_more) = collect_missing_mtime_batch(&conn, 0, 10).unwrap();
        assert_eq!(rows.len(), 5);
        assert!(!has_more);

        let lib_paths = collect_library_raw_paths(&conn);
        let patches = resolve_mtime_patches_for_batch(&rows, &lib_paths);
        assert_eq!(patches.len(), 2);
        assert_eq!(patches[0].sample_id, 1);
        assert_eq!(patches[1].sample_id, 2);
        assert!(patches[0].file_modified_at > 0);

        apply_mtime_patches_with_conn(&mut conn, &patches).unwrap();

        let m1: Option<i64> = conn
            .query_row(
                "SELECT file_modified_at FROM samples WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let m3: Option<i64> = conn
            .query_row(
                "SELECT file_modified_at FROM samples WHERE id = 3",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let m5: Option<i64> = conn
            .query_row(
                "SELECT file_modified_at FROM samples WHERE id = 5",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(m1, Some(patches[0].file_modified_at));
        assert!(m3.is_none());
        assert!(m5.is_none());

        // Cursor after max scanned id returns empty & terminates pagination cleanly even with remaining NULLs
        let last_id = rows.last().unwrap().id;
        let (next_rows, next_more) = collect_missing_mtime_batch(&conn, last_id, 10).unwrap();
        assert!(next_rows.is_empty());
        assert!(!next_more);

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside_dir);
    }

    #[test]
    fn sync_updates_file_modified_at_when_mtime_changes_at_same_byte_size() {
        let dir = make_test_temp_dir("sync_mtime");
        let audio_file = dir.join("loop.wav");
        // Write a tiny valid 44-byte WAV header + 4 zero bytes
        let mut wav_bytes = Vec::from(&b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xAC\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x04\x00\x00\x00"[..]);
        wav_bytes.extend_from_slice(&[0u8; 4]);
        fs::write(&audio_file, &wav_bytes).unwrap();

        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        let lib_norm = normalize_clean_path(&dir.to_string_lossy());
        conn.execute(
            "INSERT INTO libraries (id, path, name) VALUES (1, ?1, 'SyncLib')",
            params![lib_norm],
        )
        .unwrap();

        let (_, changed_first) =
            sync_library_with_conn_and_status(&mut conn, &lib_norm, None, false).unwrap();
        assert!(changed_first);

        // Simulate older stored mtime while keeping exact file_size
        let stored_mtime: Option<i64> = conn
            .query_row("SELECT file_modified_at FROM samples LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(stored_mtime.is_some());

        // Second sync without changes skips cleanly
        let (_, changed_second) =
            sync_library_with_conn_and_status(&mut conn, &lib_norm, None, false).unwrap();
        assert!(!changed_second);

        // Change DB stored mtime artificially to verify mtime mismatch forces rescan even with identical byte size
        let stale_mtime = stored_mtime.unwrap() - 60_000;
        conn.execute(
            "UPDATE samples SET file_modified_at = ?1",
            params![stale_mtime],
        )
        .unwrap();

        let (_, changed_third) =
            sync_library_with_conn_and_status(&mut conn, &lib_norm, None, false).unwrap();
        assert!(changed_third);

        let refreshed_mtime: Option<i64> = conn
            .query_row("SELECT file_modified_at FROM samples LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(refreshed_mtime, stored_mtime);

        let _ = fs::remove_dir_all(&dir);
    }
}
