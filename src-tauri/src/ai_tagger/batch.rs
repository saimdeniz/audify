use super::knn;
use super::onnx_runner::AiInferenceOutput;
use super::similarity::vec_to_blob;
use super::taxonomy::{
    extract_mapped_tags_from_scores, persist_ai_tags_for_sample, MappedAiTag,
};
use super::types::{AiAnalysisSummary, AiIndexProgress, AiTaggingMode};
use super::{infer_single_sample_path, AiTaggerState};
use crate::db::AppState;
use crate::security::sanitize_err;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const ANALYSIS_CHUNK_SIZE: usize = 32;
const MAX_AI_TAGS_PER_SAMPLE: usize = 4;

pub(super) struct SampleAnalysisCandidate {
    pub(super) sample_id: i64,
    pub(super) library_id: i64,
    pub(super) path: String,
    pub(super) filename: String,
    pub(super) duration_ms: i64,
}

struct ProcessedAiChunkItem {
    sample_id: i64,
    library_id: i64,
    path: String,
    duration_ms: i64,
    output: AiInferenceOutput,
    mapped_tags: Vec<MappedAiTag>,
}

#[derive(Debug, Clone, Copy)]
pub struct AiBatchAnalysisOptions {
    pub confidence_threshold: f32,
    pub tagging_mode: AiTaggingMode,
    pub reanalyze_existing: bool,
    pub use_knn_learning: bool,
}

pub(super) fn collect_analysis_candidates(
    conn: &Connection,
    profile_id: i64,
    model_id: &str,
    sample_ids: Option<&[i64]>,
    reanalyze_existing: bool,
) -> Result<Vec<SampleAnalysisCandidate>, String> {
    if let Some(ids) = sample_ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut candidates = Vec::new();
        for chunk in ids.chunks(400) {
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("?{}", i + 2)).collect();
            let sql = format!(
                "SELECT s.id, s.library_id, s.file_path, s.file_name, COALESCE(s.duration_ms, 0)
                 FROM samples s
                 WHERE s.id IN ({})
                   AND COALESCE(s.is_trashed, 0) = 0
                   AND s.library_id IN (
                       SELECT l.id FROM libraries l
                       WHERE l.is_global = 1
                          OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
                   )",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let mut bind_vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            bind_vals.push(rusqlite::types::Value::Integer(profile_id));
            for &id in chunk {
                bind_vals.push(rusqlite::types::Value::Integer(id));
            }
            let rows = stmt
                .query_map(rusqlite::params_from_iter(bind_vals), |r| {
                    Ok(SampleAnalysisCandidate {
                        sample_id: r.get(0)?,
                        library_id: r.get(1)?,
                        path: r.get(2)?,
                        filename: r.get(3)?,
                        duration_ms: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                candidates.push(row);
            }
        }
        return Ok(candidates);
    }

    let sql = if reanalyze_existing {
        "SELECT s.id, s.library_id, s.file_path, s.file_name, COALESCE(s.duration_ms, 0)
         FROM samples s
         WHERE COALESCE(s.is_trashed, 0) = 0
           AND s.library_id IN (
               SELECT l.id FROM libraries l
               WHERE l.is_global = 1
                  OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
           )
         ORDER BY s.id ASC"
    } else {
        "SELECT s.id, s.library_id, s.file_path, s.file_name, COALESCE(s.duration_ms, 0)
         FROM samples s
         LEFT JOIN sample_embeddings e
           ON e.sample_id = s.id AND e.model_id = ?2
         WHERE e.sample_id IS NULL
           AND COALESCE(s.is_trashed, 0) = 0
           AND s.library_id IN (
               SELECT l.id FROM libraries l
               WHERE l.is_global = 1
                  OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
           )
         ORDER BY s.id ASC"
    };

    fn map_candidate(r: &rusqlite::Row<'_>) -> rusqlite::Result<SampleAnalysisCandidate> {
        Ok(SampleAnalysisCandidate {
            sample_id: r.get(0)?,
            library_id: r.get(1)?,
            path: r.get(2)?,
            filename: r.get(3)?,
            duration_ms: r.get(4)?,
        })
    }

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = if reanalyze_existing {
        stmt.query_map(params![profile_id], map_candidate)
    } else {
        stmt.query_map(params![profile_id, model_id], map_candidate)
    }
    .map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

pub fn run_batch_ai_analysis(
    app: &AppHandle,
    state: &AppState,
    ai_state: &AiTaggerState,
    sample_ids: Option<&[i64]>,
    options: AiBatchAnalysisOptions,
) -> Result<AiAnalysisSummary, String> {
    let AiBatchAnalysisOptions {
        confidence_threshold,
        tagging_mode,
        reanalyze_existing,
        use_knn_learning,
    } = options;
    if ai_state
        .analysis_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("AI analysis is already running".to_string());
    }
    ai_state.analysis_cancel.store(false, Ordering::SeqCst);

    struct RunningGuard<'a>(&'a AtomicBool);
    impl<'a> Drop for RunningGuard<'a> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _running_guard = RunningGuard(&ai_state.analysis_running);

    let (model, cfg) = ai_state.ensure_loaded_model(&state.user_dir)?;
    let read_conn = state.acquire_read_conn()?;
    let profile_id = crate::db::get_active_profile_id(&read_conn);
    let candidates = collect_analysis_candidates(
        &read_conn,
        profile_id,
        &cfg.model_id,
        sample_ids,
        reanalyze_existing,
    )?;
    let knn_index = if use_knn_learning && tagging_mode != AiTaggingMode::VectorsOnly {
        knn::KnnLabeledIndex::load_from_db(&read_conn, profile_id, &cfg.model_id).ok()
    } else {
        None
    };
    drop(read_conn);

    let total = candidates.len();
    if total == 0 {
        let _ = app.emit(
            "ai-index-progress",
            AiIndexProgress {
                processed: 0,
                total: 0,
                percentage: 100.0,
                current_file: String::new(),
                indexed_count: 0,
                tags_suggested: 0,
                avg_ms_per_clip: ai_state.last_avg_ms(),
            },
        );
        return Ok(AiAnalysisSummary {
            processed: 0,
            indexed: 0,
            suggestions_added: 0,
            tags_auto_applied: 0,
            canceled: false,
            avg_ms_per_clip: ai_state.last_avg_ms(),
        });
    }

    let safe_conf = if confidence_threshold.is_finite() {
        confidence_threshold
    } else {
        0.45
    };
    let clamped_conf = safe_conf.clamp(0.25, 0.98);
    let mut processed = 0usize;
    let mut indexed = 0usize;
    let mut suggestions_added = 0usize;
    let mut tags_auto_applied = 0usize;
    let mut canceled = false;
    let mut last_infer_err: Option<String> = None;
    let started = Instant::now();

    for chunk in candidates.chunks(ANALYSIS_CHUNK_SIZE) {
        if ai_state.analysis_cancel.load(Ordering::SeqCst) {
            canceled = true;
            break;
        }

        let mut chunk_outputs: Vec<ProcessedAiChunkItem> = Vec::with_capacity(chunk.len());
        let mut last_name = String::new();

        for item in chunk {
            if ai_state.analysis_cancel.load(Ordering::SeqCst) {
                canceled = true;
                break;
            }
            processed += 1;
            last_name = item.filename.clone();

            match infer_single_sample_path(&model, Path::new(&item.path)) {
                Ok(output) => {
                    let mapped_tags = if tagging_mode == AiTaggingMode::VectorsOnly {
                        Vec::new()
                    } else {
                        let yamnet_tags = extract_mapped_tags_from_scores(
                            &output.class_scores,
                            clamped_conf,
                            MAX_AI_TAGS_PER_SAMPLE,
                        );
                        if let Some(ref knn) = knn_index {
                            let knn_tags = knn.suggest_for_vector(
                                item.sample_id,
                                &output.embedding,
                                clamped_conf,
                                MAX_AI_TAGS_PER_SAMPLE,
                            );
                            knn::merge_yamnet_and_knn_tags(
                                yamnet_tags,
                                knn_tags,
                                MAX_AI_TAGS_PER_SAMPLE,
                            )
                        } else {
                            yamnet_tags
                        }
                    };
                    chunk_outputs.push(ProcessedAiChunkItem {
                        sample_id: item.sample_id,
                        library_id: item.library_id,
                        path: item.path.clone(),
                        duration_ms: item.duration_ms,
                        output,
                        mapped_tags,
                    });
                }
                Err(err) => {
                    last_infer_err = Some(err);
                }
            }
        }

        if !chunk_outputs.is_empty() {
            let conn = state.lock_db();
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;

            let auto_apply = tagging_mode == AiTaggingMode::AutoApply;
            let mut committed_indices = Vec::with_capacity(chunk_outputs.len());
            {
                let mut exists_stmt = tx
                    .prepare_cached(
                        "SELECT EXISTS(SELECT 1 FROM samples WHERE id = ?1 AND COALESCE(is_trashed, 0) = 0)",
                    )
                    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;

                for (idx, entry) in chunk_outputs.iter().enumerate() {
                    let still_exists: bool = exists_stmt
                        .query_row(params![entry.sample_id], |r| r.get(0))
                        .unwrap_or(false);
                    if !still_exists {
                        continue;
                    }

                    let blob = vec_to_blob(&entry.output.embedding);
                    tx.execute(
                        "INSERT INTO sample_embeddings (sample_id, model_id, dim, vector)
                         VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT(sample_id) DO UPDATE SET
                             model_id = excluded.model_id,
                             dim = excluded.dim,
                             vector = excluded.vector,
                             updated_at = datetime('now')",
                        params![
                            entry.sample_id,
                            cfg.model_id,
                            entry.output.embedding.len() as i64,
                            blob
                        ],
                    )
                    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;

                    if tagging_mode != AiTaggingMode::VectorsOnly {
                        let (added, applied) = persist_ai_tags_for_sample(
                            &tx,
                            entry.sample_id,
                            &cfg.model_id,
                            &entry.mapped_tags,
                            auto_apply,
                        )?;
                        suggestions_added += added;
                        tags_auto_applied += applied;
                    }
                    indexed += 1;
                    committed_indices.push(idx);
                }
            }

            tx.commit()
                .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
            drop(conn);

            if let Ok(mut cache) = ai_state.vector_cache.lock() {
                let committed_set: std::collections::HashSet<usize> =
                    committed_indices.into_iter().collect();
                for (idx, entry) in chunk_outputs.into_iter().enumerate() {
                    if committed_set.contains(&idx) {
                        cache.upsert(
                            &cfg.model_id,
                            entry.sample_id,
                            entry.library_id,
                            &entry.path,
                            entry.duration_ms,
                            entry.output.embedding,
                        );
                    }
                }
            }
        }

        let avg_ms = if processed > 0 {
            (started.elapsed().as_secs_f64() * 1000.0) / (processed as f64)
        } else {
            0.0
        };
        ai_state.set_last_avg_ms(avg_ms);

        let percentage = ((processed as f64 / total as f64) * 100.0).min(100.0);
        let _ = app.emit(
            "ai-index-progress",
            AiIndexProgress {
                processed,
                total,
                percentage,
                current_file: last_name,
                indexed_count: indexed,
                tags_suggested: suggestions_added + tags_auto_applied,
                avg_ms_per_clip: avg_ms,
            },
        );

        if canceled {
            break;
        }
    }

    if !canceled && processed > 0 && indexed == 0 {
        if let Some(err) = last_infer_err {
            return Err(sanitize_err(&state.user_dir, &err));
        }
    }

    let avg_ms = ai_state.last_avg_ms();
    Ok(AiAnalysisSummary {
        processed,
        indexed,
        suggestions_added,
        tags_auto_applied,
        canceled,
        avg_ms_per_clip: avg_ms,
    })
}
