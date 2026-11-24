pub use super::knn_helpers::merge_yamnet_and_knn_tags;

use super::knn_helpers::{
    collect_knn_target_page, collect_knn_target_vectors_for_ids, count_knn_profile_targets,
    TargetVectorItem,
};
use super::model_manager::active_model_id_and_path;
use super::similarity::{blob_to_vec, dot_similarity};
use super::taxonomy::{persist_ai_tags_for_sample, MappedAiTag};
use super::types::{AiAnalysisSummary, AiIndexProgress, AiTaggingMode, AI_EMBEDDING_DIM};
use super::AiTaggerState;
use crate::db::{get_active_profile_id, AppState};
use crate::security::sanitize_err;
use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::cmp::Reverse;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const KNN_TOP_K: usize = 15;
const KNN_MIN_NEIGHBOR_SIM: f32 = 0.70;
const KNN_SINGLE_NEIGHBOR_HIGH_SIM: f32 = 0.92;
const KNN_CHUNK_SIZE: usize = 128;

#[derive(Debug, Clone)]
pub struct LabeledEmbeddingEntry {
    pub sample_id: i64,
    pub vector: [f32; AI_EMBEDDING_DIM],
    pub tag_names: Vec<String>,
}

#[derive(Debug, Default)]
pub struct KnnLabeledIndex {
    entries: Vec<LabeledEmbeddingEntry>,
}

impl KnnLabeledIndex {
    /// Loads all non-trashed samples inside the active profile that have BOTH an embedding
    /// for `model_id` and at least one manual/approved tag (`sample_tags.is_manual = 1`).
    pub fn load_from_db(
        conn: &Connection,
        profile_id: i64,
        model_id: &str,
    ) -> Result<Self, String> {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, e.vector, t.name
                 FROM samples s
                 JOIN sample_embeddings e
                   ON e.sample_id = s.id AND e.model_id = ?2
                 JOIN sample_tags st
                   ON st.sample_id = s.id AND COALESCE(st.is_manual, 0) = 1
                 JOIN tags t
                   ON t.id = st.tag_id
                 WHERE COALESCE(s.is_trashed, 0) = 0
                   AND s.library_id IN (
                       SELECT l.id FROM libraries l
                       WHERE l.is_global = 1
                          OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
                   )
                 ORDER BY s.id ASC",
            )
            .map_err(|e| format!("Failed preparing k-NN labeled query: {}", e))?;

        let rows = stmt
            .query_map(params![profile_id, model_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed querying k-NN labeled samples: {}", e))?;

        let mut entries: Vec<LabeledEmbeddingEntry> = Vec::new();
        let mut index_by_sample: HashMap<i64, usize> = HashMap::new();

        for row in rows.flatten() {
            let (sample_id, blob, tag_name) = row;
            let trimmed = tag_name.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(&idx) = index_by_sample.get(&sample_id) {
                if !entries[idx]
                    .tag_names
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(trimmed))
                {
                    entries[idx].tag_names.push(trimmed.to_string());
                }
                continue;
            }
            if let Some(vector) = blob_to_vec(&blob) {
                let idx = entries.len();
                index_by_sample.insert(sample_id, idx);
                entries.push(LabeledEmbeddingEntry {
                    sample_id,
                    vector,
                    tag_names: vec![trimmed.to_string()],
                });
            }
        }

        Ok(Self { entries })
    }

    #[cfg(test)]
    pub fn from_entries(entries: Vec<LabeledEmbeddingEntry>) -> Self {
        Self { entries }
    }

    pub fn labeled_count(&self) -> usize {
        self.entries.len()
    }

    /// Runs weighted cosine-similarity k-NN voting against manually tagged samples.
    pub fn suggest_for_vector(
        &self,
        query_sample_id: i64,
        query_vec: &[f32; AI_EMBEDDING_DIM],
        min_confidence: f32,
        max_tags: usize,
    ) -> Vec<MappedAiTag> {
        if self.entries.is_empty() || max_tags == 0 {
            return Vec::new();
        }

        let mut neighbors: Vec<(f32, usize)> = Vec::with_capacity(KNN_TOP_K);
        for (idx, entry) in self.entries.iter().enumerate() {
            if entry.sample_id == query_sample_id || entry.tag_names.is_empty() {
                continue;
            }
            let sim = dot_similarity(query_vec, &entry.vector);
            if sim < KNN_MIN_NEIGHBOR_SIM {
                continue;
            }
            if neighbors.len() < KNN_TOP_K {
                neighbors.push((sim, idx));
            } else if let Some((min_pos, &(min_sim, min_idx))) =
                neighbors.iter().enumerate().min_by(|a, b| {
                    a.1 .0
                        .partial_cmp(&b.1 .0)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| Reverse(a.1 .1).cmp(&Reverse(b.1 .1)))
                })
            {
                let ord = sim
                    .partial_cmp(&min_sim)
                    .unwrap_or(std::cmp::Ordering::Equal);
                if ord == std::cmp::Ordering::Greater
                    || (ord == std::cmp::Ordering::Equal && idx < min_idx)
                {
                    neighbors[min_pos] = (sim, idx);
                }
            }
        }

        if neighbors.is_empty() {
            return Vec::new();
        }

        neighbors.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.1.cmp(&b.1))
        });

        let total_sim: f32 = neighbors.iter().map(|(sim, _)| *sim).sum();
        if total_sim <= 0.0 || !total_sim.is_finite() {
            return Vec::new();
        }

        struct VoteAcc {
            canonical_name: String,
            sim_sum: f32,
            max_sim: f32,
            support_count: usize,
        }

        let mut votes: HashMap<String, VoteAcc> = HashMap::new();
        for &(sim, entry_idx) in &neighbors {
            for tag in &self.entries[entry_idx].tag_names {
                let key = tag.to_lowercase();
                let acc = votes.entry(key).or_insert_with(|| VoteAcc {
                    canonical_name: tag.clone(),
                    sim_sum: 0.0,
                    max_sim: 0.0,
                    support_count: 0,
                });
                acc.sim_sum += sim;
                if sim > acc.max_sim {
                    acc.max_sim = sim;
                }
                acc.support_count += 1;
            }
        }

        let clamped_min = min_confidence.clamp(0.25, 0.98);
        let mut ranked: Vec<MappedAiTag> = votes
            .into_values()
            .filter_map(|acc| {
                // Reject isolated 1-neighbor noise unless it is a near-exact acoustic duplicate.
                if acc.support_count < 2 && acc.max_sim < KNN_SINGLE_NEIGHBOR_HIGH_SIM {
                    return None;
                }
                let vote_share = (acc.sim_sum / total_sim).clamp(0.0, 1.0);
                let confidence = (acc.max_sim * (0.80 + 0.20 * vote_share)).clamp(0.0, 0.98);
                if confidence < clamped_min {
                    return None;
                }
                Some(MappedAiTag {
                    tag_name: acc.canonical_name,
                    confidence,
                })
            })
            .collect();

        ranked.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.tag_name.cmp(&b.tag_name))
        });
        ranked.truncate(max_tags);
        ranked
    }
}

/// Suggests (or auto-applies) personalized tags over already-indexed YAMNet embeddings
/// using k-NN neighbor voting against the user's own manual tags (`is_manual = 1`).
/// Zero extra AI models or audio decoding needed.
pub fn run_knn_tag_suggestions(
    app: &AppHandle,
    state: &AppState,
    ai_state: &AiTaggerState,
    sample_ids: Option<&[i64]>,
    confidence_threshold: f32,
    tagging_mode: AiTaggingMode,
    max_tags_per_sample: usize,
) -> Result<AiAnalysisSummary, String> {
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

    let (model_id, _, _, _) = active_model_id_and_path(&state.user_dir);
    let read_conn = state.acquire_read_conn()?;
    let profile_id = get_active_profile_id(&read_conn);

    let knn_index = KnnLabeledIndex::load_from_db(&read_conn, profile_id, &model_id)?;
    if knn_index.labeled_count() == 0 {
        return Err(
            "No manually tagged & AI-indexed samples found in this profile to learn from yet."
                .to_string(),
        );
    }

    let total = if let Some(ids) = sample_ids {
        ids.len()
    } else {
        count_knn_profile_targets(&read_conn, profile_id, &model_id)?
    };
    drop(read_conn);

    if total == 0 {
        return Err(
            "Target sample(s) are not AI indexed yet. Run 'AI Index / Analyze' first."
                .to_string(),
        );
    }

    let auto_apply = tagging_mode == AiTaggingMode::AutoApply;
    let started = Instant::now();
    let mut processed = 0usize;
    let mut suggestions_added = 0usize;
    let mut tags_auto_applied = 0usize;
    let mut canceled = false;
    let mut last_sample_id: i64 = 0;
    let mut id_cursor: usize = 0;
    const KNN_PAGE_SIZE: usize = KNN_CHUNK_SIZE * 4;

    loop {
        if ai_state.analysis_cancel.load(Ordering::SeqCst) {
            canceled = true;
            break;
        }
        let page: Vec<TargetVectorItem> = if let Some(ids) = sample_ids {
            if id_cursor >= ids.len() {
                break;
            }
            let end = (id_cursor + KNN_PAGE_SIZE).min(ids.len());
            let slice = &ids[id_cursor..end];
            id_cursor = end;
            let page_conn = state.acquire_read_conn()?;
            collect_knn_target_vectors_for_ids(&page_conn, profile_id, &model_id, slice)?
        } else {
            let page_conn = state.acquire_read_conn()?;
            let batch = collect_knn_target_page(
                &page_conn,
                profile_id,
                &model_id,
                last_sample_id,
                KNN_PAGE_SIZE,
            )?;
            if let Some(last) = batch.last() {
                last_sample_id = last.sample_id;
            }
            batch
        };
        if page.is_empty() {
            if sample_ids.is_some() {
                continue;
            }
            break;
        }

        for chunk in page.chunks(KNN_CHUNK_SIZE) {
            if ai_state.analysis_cancel.load(Ordering::SeqCst) {
                canceled = true;
                break;
            }

            let chunk_predictions: Vec<(i64, Vec<MappedAiTag>)> =
                if chunk.len() > 16 && knn_index.labeled_count() > 500 {
                    chunk
                        .par_iter()
                        .filter_map(|item| {
                            let predicted = knn_index.suggest_for_vector(
                                item.sample_id,
                                &item.vector,
                                confidence_threshold,
                                max_tags_per_sample,
                            );
                            if predicted.is_empty() {
                                None
                            } else {
                                Some((item.sample_id, predicted))
                            }
                        })
                        .collect()
                } else {
                    let mut preds = Vec::new();
                    for item in chunk {
                        let predicted = knn_index.suggest_for_vector(
                            item.sample_id,
                            &item.vector,
                            confidence_threshold,
                            max_tags_per_sample,
                        );
                        if !predicted.is_empty() {
                            preds.push((item.sample_id, predicted));
                        }
                    }
                    preds
                };
            processed += chunk.len();
            let last_name = chunk.last().map(|i| i.filename.clone()).unwrap_or_default();
            // Keep idle reaper aware that k-NN batch is active
            ai_state.touch_activity(Some(&state.db));

            if !chunk_predictions.is_empty() {
                let conn = state.lock_db();
                let tx = conn
                    .unchecked_transaction()
                    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
                for (sample_id, predicted) in &chunk_predictions {
                    let still_exists: bool = tx
                        .prepare_cached(
                            "SELECT EXISTS(SELECT 1 FROM samples WHERE id = ?1 AND COALESCE(is_trashed, 0) = 0)",
                        )
                        .and_then(|mut s| s.query_row([*sample_id], |r| r.get::<_, i64>(0)))
                        .map(|v| v != 0)
                        .unwrap_or(false);
                    if !still_exists {
                        continue;
                    }
                    let (added, applied) =
                        persist_ai_tags_for_sample(&tx, *sample_id, &model_id, predicted, auto_apply)?;
                    suggestions_added += added;
                    tags_auto_applied += applied;
                }
                tx.commit()
                    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
            }

            let avg_ms = if processed > 0 {
                (started.elapsed().as_secs_f64() * 1000.0) / (processed as f64)
            } else {
                0.0
            };
            let percentage = ((processed as f64 / total.max(processed).max(1) as f64) * 100.0).min(100.0);
            let _ = app.emit(
                "ai-index-progress",
                AiIndexProgress {
                    processed,
                    total: total.max(processed),
                    percentage,
                    current_file: last_name,
                    indexed_count: total.max(processed),
                    tags_suggested: suggestions_added + tags_auto_applied,
                    avg_ms_per_clip: avg_ms,
                },
            );
        }
        if canceled {
            break;
        }
    }

    if processed == 0 && !canceled {
        return Err(
            "Target sample(s) are not AI indexed yet. Run 'AI Index / Analyze' first."
                .to_string(),
        );
    }

    let elapsed_avg = if processed > 0 {
        (started.elapsed().as_secs_f64() * 1000.0) / (processed as f64)
    } else {
        0.0
    };

    Ok(AiAnalysisSummary {
        processed,
        indexed: processed,
        suggestions_added,
        tags_auto_applied,
        canceled,
        avg_ms_per_clip: elapsed_avg,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_tagger::similarity::vec_to_blob;
    use crate::db::init_schema_on_conn;

    fn make_unit_vec(primary_dim: usize, secondary_dim: usize, secondary_weight: f32) -> [f32; AI_EMBEDDING_DIM] {
        let mut v = [0.0_f32; AI_EMBEDDING_DIM];
        v[primary_dim] = 1.0;
        v[secondary_dim] += secondary_weight;
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in &mut v {
                *x /= norm;
            }
        }
        v
    }

    #[test]
    fn knn_learns_custom_user_tag_from_manual_neighbors_and_excludes_self() {
        let mut entries = Vec::new();
        for i in 1..=3 {
            entries.push(LabeledEmbeddingEntry {
                sample_id: i,
                vector: make_unit_vec(0, 1, 0.1 * (i as f32)),
                tag_names: vec!["Custom_Rumble".to_string()],
            });
        }
        // Query sample ID 1 closely matches sample 2 & 3, and shouldn't vote using itself
        let index = KnnLabeledIndex::from_entries(entries);
        let query_vec = make_unit_vec(0, 1, 0.15);
        let tags = index.suggest_for_vector(1, &query_vec, 0.72, 4);

        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag_name, "Custom_Rumble");
        assert!(tags[0].confidence >= 0.72);
    }

    #[test]
    fn knn_rejects_single_weak_neighbor_noise_but_accepts_near_exact_duplicate() {
        // Isolated single neighbor at ~0.78 cosine similarity should be rejected (< 2 support and < 0.92)
        let weak_neighbor = LabeledEmbeddingEntry {
            sample_id: 10,
            vector: make_unit_vec(0, 2, 0.8),
            tag_names: vec!["NoiseFluke".to_string()],
        };
        let near_dupe = LabeledEmbeddingEntry {
            sample_id: 11,
            vector: make_unit_vec(5, 6, 0.05),
            tag_names: vec!["BossLayer".to_string()],
        };
        let index = KnnLabeledIndex::from_entries(vec![weak_neighbor, near_dupe]);

        let q_weak = make_unit_vec(0, 3, 0.0);
        assert!(index.suggest_for_vector(99, &q_weak, 0.65, 4).is_empty());

        let q_exact = make_unit_vec(5, 6, 0.04);
        let exact_tags = index.suggest_for_vector(99, &q_exact, 0.72, 4);
        assert_eq!(exact_tags.len(), 1);
        assert_eq!(exact_tags[0].tag_name, "BossLayer");
    }

    #[test]
    fn knn_db_loader_uses_only_is_manual_1_tags_in_active_profile() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();

        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES ('F:/Lib', 'Lib', 1)",
            [],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        let vec_blob = vec_to_blob(&make_unit_vec(4, 0, 0.0));
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms)
             VALUES (?1, 'F:/Lib/s1.wav', 's1.wav', 'wav', 200)",
            [lib_id],
        )
        .unwrap();
        let s1 = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO sample_embeddings (sample_id, model_id, dim, vector) VALUES (?1, 'yamnet-v1', 128, ?2)",
            params![s1, vec_blob],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('UserCustom', '#112233', 1)",
            [],
        )
        .unwrap();
        let manual_tag = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('UnapprovedAi', '#445566', 0)",
            [],
        )
        .unwrap();
        let ai_tag = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, ?2, 1)",
            params![s1, manual_tag],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, ?2, 0)",
            params![s1, ai_tag],
        )
        .unwrap();

        let profile_id = crate::db::get_active_profile_id(&conn);
        let index = KnnLabeledIndex::load_from_db(&conn, profile_id, "yamnet-v1").unwrap();
        assert_eq!(index.labeled_count(), 1);
        assert_eq!(index.entries[0].tag_names, vec!["UserCustom".to_string()]);
    }

    #[test]
    fn merge_yamnet_and_knn_tags_keeps_higher_confidence_and_custom_tags() {
        let merged = merge_yamnet_and_knn_tags(
            vec![
                MappedAiTag {
                    tag_name: "Impact".to_string(),
                    confidence: 0.74,
                },
                MappedAiTag {
                    tag_name: "Boom".to_string(),
                    confidence: 0.79,
                },
            ],
            vec![
                MappedAiTag {
                    tag_name: "impact".to_string(),
                    confidence: 0.91,
                },
                MappedAiTag {
                    tag_name: "UI_Whoosh".to_string(),
                    confidence: 0.85,
                },
            ],
            4,
        );

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].tag_name.to_lowercase(), "impact");
        assert!((merged[0].confidence - 0.91).abs() < 0.001);
        assert_eq!(merged[1].tag_name, "UI_Whoosh");
        assert_eq!(merged[2].tag_name, "Boom");
    }
}
