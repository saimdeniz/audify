use super::{
    compute_exported_duration_ms, ensure_existing_slice_in_scope, format_os_display_path,
    with_read_conn, SliceHistoryRecord, SliceHistoryUpsert,
};
use crate::audio::decode_audio_and_peaks;
use crate::db::{get_active_profile_id, AppState};
use crate::security::{normalize_clean_path, sanitize_err};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;
use tauri::State;

pub(super) const SLICE_SELECT_COLS: &str =
    "id, slice_path, slice_name, source_sample_id, source_file_path,
     source_file_name, start_sec, end_sec, pitch_semitones, micro_fade,
     duration_ms, created_at,
     COALESCE(is_favorite, 0), COALESCE(peaks_json, '[]'),
     COALESCE(sample_rate, 48000), COALESCE(channels, 2), COALESCE(bit_depth, 16),
     COALESCE(is_trashed, 0), trash_file_path, trashed_at";

pub(super) fn decode_slice_audio_meta(
    slice_path: &Path,
    fallback_dur_ms: i64,
) -> (i64, i64, i64, i64, String) {
    if let Some((dur, sr, ch, bd, peaks)) = decode_audio_and_peaks(slice_path) {
        let final_dur = if dur > 0 { dur } else { fallback_dur_ms };
        return (
            final_dur,
            if sr > 0 { sr } else { 48000 },
            if ch > 0 { ch } else { 2 },
            if bd > 0 { bd } else { 16 },
            if peaks.is_empty() {
                "[]".to_string()
            } else {
                peaks
            },
        );
    }
    (fallback_dur_ms, 48000, 2, 16, "[]".to_string())
}

pub(crate) fn ensure_source_not_a_slice(conn: &Connection, source_path: &Path) -> Result<(), String> {
    let disp = format_os_display_path(source_path);
    let norm = normalize_clean_path(&disp);
    let is_slice_row: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sample_slices
                WHERE LOWER(slice_path) = LOWER(?1) OR LOWER(slice_path) = LOWER(?2)
             )",
            params![disp, norm],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if is_slice_row {
        return Err(
            "Cannot create a slice from another saved slice — open the original source track first"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn upsert_slice_history_with_meta(
    conn: &Connection,
    entry: &SliceHistoryUpsert<'_>,
    predecoded: Option<(i64, i64, i64, i64, String)>,
) -> Result<SliceHistoryRecord, String> {
    let slice_path_str = format_os_display_path(entry.slice_path);
    let slice_name = entry
        .slice_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("slice.wav")
        .to_string();
    let source_path_str = format_os_display_path(entry.source_file_path);
    let source_name = entry
        .source_file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sample")
        .to_string();
    let (dur_ms, sample_rate, channels, bit_depth, peaks_json) = match predecoded {
        Some(meta) => meta,
        None => {
            let fallback_dur =
                compute_exported_duration_ms(entry.start_sec, entry.end_sec, entry.pitch_semitones);
            decode_slice_audio_meta(entry.slice_path, fallback_dur)
        }
    };
    let pitch_clean = if entry.pitch_semitones.is_finite() {
        entry.pitch_semitones.clamp(-24.0, 24.0)
    } else {
        0.0
    };

    if let Ok(Some(old_trash_path)) = conn.query_row(
        "SELECT trash_file_path FROM sample_slices
         WHERE profile_id = ?1 AND slice_path = ?2 AND COALESCE(is_trashed, 0) = 1
         LIMIT 1",
        params![entry.profile_id, slice_path_str],
        |r| r.get::<_, Option<String>>(0),
    ) {
        let tp = old_trash_path.trim();
        if !tp.is_empty()
            && !crate::security::is_unc_or_network_path(tp)
            && !crate::security::has_ntfs_ads_colon(tp)
            && normalize_clean_path(tp)
                .to_lowercase()
                .contains("/cache/slice_trash/")
        {
            if let Ok(meta) = fs::symlink_metadata(tp) {
                if !meta.file_type().is_symlink() && meta.is_file() {
                    let _ = fs::remove_file(tp);
                }
            }
        }
    }

    conn.execute(
        "INSERT INTO sample_slices (
            profile_id, slice_path, slice_name, source_sample_id,
            source_file_path, source_file_name, start_sec, end_sec,
            pitch_semitones, micro_fade, duration_ms,
            peaks_json, sample_rate, channels, bit_depth
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(profile_id, slice_path) DO UPDATE SET
            slice_name = excluded.slice_name,
            source_sample_id = COALESCE(excluded.source_sample_id, sample_slices.source_sample_id),
            source_file_path = excluded.source_file_path,
            source_file_name = excluded.source_file_name,
            start_sec = excluded.start_sec,
            end_sec = excluded.end_sec,
            pitch_semitones = excluded.pitch_semitones,
            micro_fade = excluded.micro_fade,
            duration_ms = excluded.duration_ms,
            peaks_json = excluded.peaks_json,
            sample_rate = excluded.sample_rate,
            channels = excluded.channels,
            bit_depth = excluded.bit_depth,
            is_favorite = CASE WHEN COALESCE(sample_slices.is_trashed, 0) = 1 THEN 0 ELSE sample_slices.is_favorite END,
            is_trashed = 0,
            trash_file_path = NULL,
            trashed_at = NULL,
            created_at = datetime('now')",
        params![
            entry.profile_id,
            slice_path_str,
            slice_name,
            entry.source_sample_id,
            source_path_str,
            source_name,
            entry.start_sec,
            entry.end_sec,
            pitch_clean,
            entry.micro_fade,
            dur_ms,
            peaks_json,
            sample_rate,
            channels,
            bit_depth,
        ],
    )
    .map_err(|e| format!("Failed saving slice history record: {}", e))?;

    query_single_slice_record(conn, entry.profile_id, &slice_path_str)
}

#[cfg(test)]
pub(crate) fn upsert_slice_history_with_conn(
    conn: &Connection,
    entry: &SliceHistoryUpsert<'_>,
) -> Result<SliceHistoryRecord, String> {
    upsert_slice_history_with_meta(conn, entry, None)
}

pub(super) fn row_to_slice_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SliceHistoryRecord> {
    let slice_path: String = row.get(1)?;
    let is_trashed = row.get::<_, i64>(17)? != 0;
    let raw_trash_path: Option<String> = row.get(18)?;
    let trashed_at: Option<String> = row.get(19)?;
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
        slice_path.as_str()
    };
    let file_exists = !check_path.is_empty()
        && !crate::security::is_unc_or_network_path(check_path)
        && !crate::security::has_ntfs_ads_colon(check_path)
        && fs::symlink_metadata(check_path)
            .map(|m| !m.file_type().is_symlink() && m.file_type().is_file())
            .unwrap_or(false);
    Ok(SliceHistoryRecord {
        id: row.get(0)?,
        slice_path,
        slice_name: row.get(2)?,
        source_sample_id: row.get(3)?,
        source_file_path: row.get(4)?,
        source_file_name: row.get(5)?,
        start_sec: row.get(6)?,
        end_sec: row.get(7)?,
        pitch_semitones: row.get(8)?,
        micro_fade: row.get(9)?,
        duration_ms: row.get(10)?,
        created_at: row.get(11)?,
        is_favorite: row.get::<_, i64>(12)? != 0,
        peaks_json: row.get(13)?,
        sample_rate: row.get(14)?,
        channels: row.get(15)?,
        bit_depth: row.get(16)?,
        file_exists,
        is_trashed,
        trash_file_path: clean_trash_path,
        trashed_at: if is_trashed { trashed_at } else { None },
    })
}

pub(super) fn query_single_slice_record(
    conn: &Connection,
    profile_id: i64,
    slice_path: &str,
) -> Result<SliceHistoryRecord, String> {
    let sql = format!(
        "SELECT {} FROM sample_slices WHERE profile_id = ?1 AND slice_path = ?2 LIMIT 1",
        SLICE_SELECT_COLS
    );
    conn.query_row(&sql, params![profile_id, slice_path], row_to_slice_record)
        .map_err(|e| format!("Failed loading saved slice record: {}", e))
}

pub(super) fn query_slice_record_by_id(
    conn: &Connection,
    profile_id: i64,
    slice_id: i64,
) -> Result<SliceHistoryRecord, String> {
    let sql = format!(
        "SELECT {} FROM sample_slices WHERE id = ?1 AND profile_id = ?2 LIMIT 1",
        SLICE_SELECT_COLS
    );
    conn.query_row(&sql, params![slice_id, profile_id], row_to_slice_record)
        .map_err(|_| "Slice record not found".to_string())
}

#[tauri::command]
pub async fn list_slice_history(
    state: State<'_, AppState>,
) -> Result<Vec<SliceHistoryRecord>, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut records: Vec<SliceHistoryRecord> = with_read_conn(&state_owned, |conn| {
            let profile_id = get_active_profile_id(conn);
            let sql = format!(
                "SELECT {} FROM sample_slices
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 0
                 ORDER BY created_at DESC, id DESC
                 LIMIT 5000",
                SLICE_SELECT_COLS
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed preparing slice history query: {}", e))?;
            let rows = stmt
                .query_map([profile_id], row_to_slice_record)
                .map_err(|e| format!("Failed reading slice history: {}", e))?;
            Ok(rows.flatten().collect())
        })
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        // Lazily backfill peaks & audio format metadata for older slice entries created before v2
        let mut backfilled: Vec<(usize, i64, i64, i64, i64, String)> = Vec::new();
        for (idx, rec) in records.iter().enumerate() {
            if backfilled.len() >= 64 {
                break;
            }
            if rec.file_exists && (rec.peaks_json.trim().is_empty() || rec.peaks_json == "[]") {
                let (dur, sr, ch, bd, peaks) =
                    decode_slice_audio_meta(Path::new(&rec.slice_path), rec.duration_ms);
                if peaks != "[]" {
                    backfilled.push((idx, dur, sr, ch, bd, peaks));
                }
            }
        }

        if !backfilled.is_empty() {
            let mut conn = state_owned.lock_db();
            if let Ok(tx) = conn.transaction() {
                for (idx, dur, sr, ch, bd, peaks) in &backfilled {
                    let id = records[*idx].id;
                    let _ = tx.execute(
                        "UPDATE sample_slices
                         SET peaks_json = ?1, sample_rate = ?2, channels = ?3, bit_depth = ?4, duration_ms = ?5
                         WHERE id = ?6",
                        params![peaks, sr, ch, bd, dur, id],
                    );
                }
                if tx.commit().is_ok() {
                    for (idx, dur, sr, ch, bd, peaks) in backfilled {
                        records[idx].duration_ms = dur;
                        records[idx].sample_rate = sr;
                        records[idx].channels = ch;
                        records[idx].bit_depth = bd;
                        records[idx].peaks_json = peaks;
                    }
                }
            }
            drop(conn);
        }

        Ok(records)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Slice history task failed: {}", e)))?
}

#[tauri::command]
pub fn clear_missing_slices(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.lock_db();
    let profile_id = get_active_profile_id(&conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, slice_path FROM sample_slices
             WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 0",
        )
        .map_err(|_| "Failed preparing missing slice cleanup".to_string())?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([profile_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "Failed querying slice records".to_string())?
        .flatten()
        .collect();
    drop(stmt);

    let missing_ids: Vec<i64> = rows
        .into_iter()
        .filter(|(_, p)| {
            let trimmed = p.trim();
            trimmed.is_empty()
                || crate::security::is_unc_or_network_path(trimmed)
                || crate::security::has_ntfs_ads_colon(trimmed)
                || fs::symlink_metadata(trimmed)
                    .map(|m| m.file_type().is_symlink() || !m.file_type().is_file())
                    .unwrap_or(true)
        })
        .map(|(id, _)| id)
        .collect();

    if missing_ids.is_empty() {
        return Ok(0);
    }

    for chunk in missing_ids.chunks(500) {
        let placeholders: Vec<String> = (2..=chunk.len() + 1).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "DELETE FROM sample_slices WHERE profile_id = ?1 AND id IN ({})",
            placeholders.join(", ")
        );
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        params_vec.push(rusqlite::types::Value::Integer(profile_id));
        for id in chunk {
            params_vec.push(rusqlite::types::Value::Integer(*id));
        }
        conn.execute(&sql, rusqlite::params_from_iter(params_vec.iter()))
            .map_err(|_| "Failed removing missing slice entries".to_string())?;
    }

    Ok(missing_ids.len())
}

#[tauri::command]
pub fn cleanup_unrecorded_slice_file(
    state: State<'_, AppState>,
    slice_path: String,
) -> Result<(), String> {
    let conn = state.lock_db();
    let resolved = ensure_existing_slice_in_scope(&conn, &state.user_dir, &slice_path)
        .map_err(|e| sanitize_err(&state.user_dir, &e))?;
    super::ensure_slice_not_in_readonly_library(&conn, &resolved)?;
    let disp = format_os_display_path(&resolved);
    let norm_disp = normalize_clean_path(&disp);
    let exists_in_db: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sample_slices
                WHERE (LOWER(slice_path) = LOWER(?1) OR LOWER(slice_path) = LOWER(?2))
                  AND COALESCE(is_trashed, 0) = 0
             )",
            params![disp, norm_disp],
            |r| r.get(0),
        )
        .unwrap_or(true);
    let is_indexed_sample: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM samples
                WHERE LOWER(REPLACE(file_path, '\\', '/')) = LOWER(?1)
                   OR LOWER(REPLACE(COALESCE(original_file_path, ''), '\\', '/')) = LOWER(?1)
             )",
            params![norm_disp],
            |r| r.get(0),
        )
        .unwrap_or(true);
    if !exists_in_db && !is_indexed_sample {
        let _ = fs::remove_file(&resolved);
    }
    Ok(())
}

pub(crate) fn relink_sample_slices_source_by_sample_id(
    conn: &Connection,
    sample_id: i64,
    new_source_path: &str,
    new_source_name: &str,
) -> Result<(), String> {
    let disp = format_os_display_path(Path::new(new_source_path));
    conn.execute(
        "UPDATE sample_slices
         SET source_file_path = ?1, source_file_name = ?2
         WHERE source_sample_id = ?3",
        params![disp, new_source_name, sample_id],
    )
    .map_err(|e| format!("Failed updating slice source references: {}", e))?;
    Ok(())
}

pub(crate) fn relink_sample_slices_source_prefix(
    conn: &Connection,
    old_prefix_slash: &str,
    old_prefix_lower: &str,
    norm_new_root: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, source_file_path FROM sample_slices WHERE source_file_path != ''")
        .map_err(|e| format!("Failed reading slice source paths: {}", e))?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Failed mapping slice source paths: {}", e))?
        .flatten()
        .collect();
    for (id, src_path) in rows {
        let norm = normalize_clean_path(&src_path);
        let rel_opt = if cfg!(windows) {
            norm.get(..old_prefix_slash.len())
                .filter(|head| head.to_lowercase() == old_prefix_lower)
                .and_then(|_| norm.get(old_prefix_slash.len()..))
        } else {
            norm.strip_prefix(old_prefix_slash)
        };
        if let Some(rel) = rel_opt {
            let next_path = format!(
                "{}/{}",
                norm_new_root.trim_end_matches('/'),
                rel.trim_start_matches('/')
            );
            let disp = format_os_display_path(Path::new(&next_path));
            let next_name = Path::new(&next_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("sample")
                .to_string();
            conn.execute(
                "UPDATE sample_slices SET source_file_path = ?1, source_file_name = ?2 WHERE id = ?3",
                params![disp, next_name, id],
            )
            .map_err(|e| format!("Failed relinking slice source {}: {}", id, e))?;
        }
    }
    Ok(())
}

pub(crate) fn relink_sample_slices_path_prefix(
    conn: &Connection,
    old_prefix_slash: &str,
    old_prefix_lower: &str,
    norm_new_root: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, slice_path FROM sample_slices WHERE slice_path != ''")
        .map_err(|e| format!("Failed reading slice paths: {}", e))?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Failed mapping slice paths: {}", e))?
        .flatten()
        .collect();
    for (id, sl_path) in rows {
        let norm = normalize_clean_path(&sl_path);
        let rel_opt = if cfg!(windows) {
            norm.get(..old_prefix_slash.len())
                .filter(|head| head.to_lowercase() == old_prefix_lower)
                .and_then(|_| norm.get(old_prefix_slash.len()..))
        } else {
            norm.strip_prefix(old_prefix_slash)
        };
        if let Some(rel) = rel_opt {
            let next_path = format!(
                "{}/{}",
                norm_new_root.trim_end_matches('/'),
                rel.trim_start_matches('/')
            );
            let disp = format_os_display_path(Path::new(&next_path));
            let _ = conn.execute(
                "UPDATE sample_slices SET slice_path = ?1 WHERE id = ?2",
                params![disp, id],
            );
        }
    }
    Ok(())
}
