pub mod fts_query;
pub mod lookup;
pub mod mutations;
pub mod query;

pub use lookup::*;
pub use mutations::*;
pub use query::*;

use super::BpmKeyProgressPayload;
use crate::db::{get_active_profile_id, AppState};
use crate::dsp_analysis::analyze_file_bpm_and_key;
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path};
use rayon::prelude::*;
use rusqlite::{params, params_from_iter};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn analyze_library_bpm_and_key(
    app: AppHandle,
    state: State<'_, AppState>,
    library_id: Option<i64>,
    overwrite_existing: Option<bool>,
) -> Result<usize, String> {
    let overwrite = overwrite_existing.unwrap_or(false);

    #[derive(Clone)]
    struct CandidateRow {
        id: i64,
        file_path: String,
        file_name: String,
        duration_ms: i64,
        bpm_is_manual: bool,
        key_is_manual: bool,
        has_bpm: bool,
        has_key: bool,
    }

    let candidates: Vec<CandidateRow> = crate::db::run_read_query(&state, move |conn| {
        let active_id = get_active_profile_id(conn);

        let mut sql = String::from(
            "SELECT s.id, s.file_path, s.file_name, s.duration_ms,
                    s.bpm_is_manual, s.key_is_manual,
                    (s.bpm IS NOT NULL), (s.musical_key != '')
             FROM samples s
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
        );
        let mut p_vec: Vec<rusqlite::types::Value> =
            vec![rusqlite::types::Value::Integer(active_id)];
        if let Some(lid) = library_id {
            p_vec.push(rusqlite::types::Value::Integer(lid));
            sql.push_str(&format!(" AND s.library_id = ?{}", p_vec.len()));
        }
        if !overwrite {
            sql.push_str(
                " AND ((s.bpm IS NULL AND s.bpm_is_manual = 0 AND s.duration_ms >= 1500)
                       OR (s.musical_key = '' AND s.key_is_manual = 0))",
            );
        } else {
            sql.push_str(" AND (s.bpm_is_manual = 0 OR s.key_is_manual = 0)");
        }

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(p_vec.iter()), |r| {
                Ok(CandidateRow {
                    id: r.get(0)?,
                    file_path: r.get(1)?,
                    file_name: r.get(2)?,
                    duration_ms: r.get(3)?,
                    bpm_is_manual: r.get(4)?,
                    key_is_manual: r.get(5)?,
                    has_bpm: r.get(6)?,
                    has_key: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.flatten().collect())
    })
    .await?;

    let total = candidates.len();
    if total == 0 {
        let _ = app.emit(
            "bpm-key-progress",
            BpmKeyProgressPayload {
                processed: 0,
                total: 0,
                percentage: 100.0,
                current_file: String::new(),
                updated_count: 0,
            },
        );
        return Ok(0);
    }

    let app_clone = app.clone();
    let analyzed_updates: Vec<(i64, Option<f64>, String, String, CandidateRow)> =
        tauri::async_runtime::spawn_blocking(move || {
            let processed = AtomicUsize::new(0);
            let updated_atomic = AtomicUsize::new(0);

            candidates
                .into_par_iter()
                .filter_map(|cand| {
                    if is_unc_or_network_path(&cand.file_path)
                        || has_ntfs_ads_colon(&cand.file_path)
                    {
                        return None;
                    }
                    let path = Path::new(&cand.file_path);
                    let res = analyze_file_bpm_and_key(path, &cand.file_name, cand.duration_ms);
                    let changed = (!cand.bpm_is_manual
                        && (overwrite || !cand.has_bpm)
                        && res.bpm.is_some())
                        || (!cand.key_is_manual
                            && (overwrite || !cand.has_key)
                            && !res.musical_key.is_empty());

                    if changed {
                        updated_atomic.fetch_add(1, Ordering::Relaxed);
                    }
                    let done = processed.fetch_add(1, Ordering::Relaxed) + 1;
                    if done == 1 || done == total || done.is_multiple_of(8) {
                        let _ = app_clone.emit(
                            "bpm-key-progress",
                            BpmKeyProgressPayload {
                                processed: done,
                                total,
                                percentage: ((done as f64 / total as f64) * 100.0).clamp(0.0, 100.0),
                                current_file: cand.file_name.clone(),
                                updated_count: updated_atomic.load(Ordering::Relaxed),
                            },
                        );
                    }

                    if changed {
                        Some((cand.id, res.bpm, res.musical_key, res.camelot_key, cand))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .await
        .map_err(|e| format!("BPM/Key analyzer worker error: {}", e))?;

    let updated_count = analyzed_updates.len();
    if updated_count > 0 {
        let state_owned = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let mut conn = state_owned.lock_db();
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            {
                let mut stmt = tx
                    .prepare(
                        "UPDATE samples
                         SET bpm = CASE
                                 WHEN bpm_is_manual = 1 THEN bpm
                                 WHEN ?1 IS NOT NULL AND (?4 = 1 OR bpm IS NULL) THEN ?1
                                 ELSE bpm
                             END,
                             musical_key = CASE
                                 WHEN key_is_manual = 1 THEN musical_key
                                 WHEN ?2 != '' AND (?4 = 1 OR musical_key = '') THEN ?2
                                 ELSE musical_key
                             END,
                             camelot_key = CASE
                                 WHEN key_is_manual = 1 THEN camelot_key
                                 WHEN ?3 != '' AND (?4 = 1 OR camelot_key = '') THEN ?3
                                 ELSE camelot_key
                             END
                         WHERE id = ?5",
                    )
                    .map_err(|e| e.to_string())?;
                let ov_flag: i64 = if overwrite { 1 } else { 0 };
                for (sid, bpm_opt, mkey, ckey, _cand) in analyzed_updates {
                    stmt.execute(params![bpm_opt, mkey, ckey, ov_flag, sid])
                        .map_err(|e| e.to_string())?;
                }
            }
            tx.commit().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| format!("BPM/Key commit join error: {}", e))??;
    }

    let _ = app.emit(
        "bpm-key-progress",
        BpmKeyProgressPayload {
            processed: total,
            total,
            percentage: 100.0,
            current_file: String::new(),
            updated_count,
        },
    );

    Ok(updated_count)
}
