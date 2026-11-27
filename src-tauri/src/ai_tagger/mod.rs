pub mod audio_preprocess;
pub mod batch;
pub mod knn;
mod knn_helpers;
pub mod model_download;
pub mod model_manager;
pub mod onnx_runner;
pub mod similarity;
pub mod suggestions;
pub mod taxonomy;
pub mod types;

pub use self::batch::{run_batch_ai_analysis, AiBatchAnalysisOptions};

use self::audio_preprocess::{decode_waveform_for_ai, has_usable_audio_energy};
use self::model_manager::resolve_ready_ai_config;
use self::onnx_runner::{AiInferenceOutput, LoadedOnnxModel};
use self::similarity::AiVectorCache;
use self::types::ResolvedAiModelConfig;
use crate::db::deterministic_color_for_name;
use rusqlite::{params, Connection};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const AI_IDLE_UNLOAD_MS: u64 = 120_000;
const AI_IDLE_POLL_INTERVAL: Duration = Duration::from_secs(30);

fn monotonic_uptime_ms() -> u64 {
    static PROCESS_START: OnceLock<Instant> = OnceLock::new();
    let elapsed = PROCESS_START.get_or_init(Instant::now).elapsed().as_millis();
    (elapsed.min(u128::from(u64::MAX)) as u64).max(1)
}

pub(crate) fn unload_idle_caches_at(
    loaded_model: &Mutex<Option<Arc<LoadedOnnxModel>>>,
    vector_cache: &Mutex<AiVectorCache>,
    analysis_running: &AtomicBool,
    last_activity_ms: &AtomicU64,
    idle_db: Option<&Mutex<Option<Arc<Mutex<Connection>>>>>,
    now_ms: u64,
    idle_threshold_ms: u64,
) -> bool {
    if analysis_running.load(Ordering::SeqCst) {
        return false;
    }
    let last_ms = last_activity_ms.load(Ordering::SeqCst);
    if last_ms == 0 || now_ms.saturating_sub(last_ms) < idle_threshold_ms {
        return false;
    }

    let mut freed = false;
    if let Ok(mut guard) = loaded_model.lock() {
        if guard.take().is_some() {
            freed = true;
        }
    }
    if let Ok(mut cache) = vector_cache.lock() {
        if cache.hydrated || !cache.entries.is_empty() || cache.entries.capacity() > 0 {
            cache.clear();
            freed = true;
        }
    }
    if freed {
        if let Some(db_holder) = idle_db {
            if let Ok(holder) = db_holder.lock() {
                if let Some(ref db_arc) = *holder {
                    if let Ok(conn) = db_arc.lock() {
                        let _ = conn.execute_batch("PRAGMA shrink_memory;");
                    }
                }
            }
        }
    }
    freed
}

#[derive(Debug, Clone)]
pub struct ExternalSimilarityProbe {
    pub probe_id: String,
    pub file_name: String,
    pub duration_ms: i64,
    pub model_id: String,
    pub embedding: [f32; self::types::AI_EMBEDDING_DIM],
}

#[derive(Default)]
pub struct AiTaggerState {
    pub loaded_model: Arc<Mutex<Option<Arc<LoadedOnnxModel>>>>,
    /// Serializes cold ONNX session initialization so concurrent similarity/tagging calls
    /// never load duplicate ~15-30 MB model sessions simultaneously.
    model_load_lock: Mutex<()>,
    pub vector_cache: Arc<Mutex<AiVectorCache>>,
    pub external_probes: Arc<Mutex<VecDeque<ExternalSimilarityProbe>>>,
    pub download_cancel: Arc<AtomicBool>,
    pub analysis_cancel: Arc<AtomicBool>,
    pub download_running: AtomicBool,
    pub analysis_running: Arc<AtomicBool>,
    pub last_avg_ms_per_clip: Mutex<f64>,
    last_activity_ms: Arc<AtomicU64>,
    idle_db: Arc<Mutex<Option<Arc<Mutex<Connection>>>>>,
    reaper_started: AtomicBool,
}

impl AiTaggerState {
    pub fn touch_activity(&self, db: Option<&Arc<Mutex<Connection>>>) {
        if let Some(db_arc) = db {
            if let Ok(mut slot) = self.idle_db.lock() {
                if slot.is_none() {
                    *slot = Some(Arc::clone(db_arc));
                }
            }
        }
        self.last_activity_ms
            .store(monotonic_uptime_ms(), Ordering::SeqCst);
        self.ensure_idle_reaper_started();
    }

    fn ensure_idle_reaper_started(&self) {
        if self
            .reaper_started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let loaded_model = Arc::clone(&self.loaded_model);
        let vector_cache = Arc::clone(&self.vector_cache);
        let analysis_running = Arc::clone(&self.analysis_running);
        let last_activity_ms = Arc::clone(&self.last_activity_ms);
        let idle_db = Arc::clone(&self.idle_db);
        std::thread::spawn(move || loop {
            std::thread::sleep(AI_IDLE_POLL_INTERVAL);
            unload_idle_caches_at(
                &loaded_model,
                &vector_cache,
                &analysis_running,
                &last_activity_ms,
                Some(&idle_db),
                monotonic_uptime_ms(),
                AI_IDLE_UNLOAD_MS,
            );
        });
    }

    pub fn ensure_loaded_model(
        &self,
        user_dir: &Path,
    ) -> Result<(Arc<LoadedOnnxModel>, ResolvedAiModelConfig), String> {
        self.touch_activity(None);
        if self.download_running.load(Ordering::SeqCst) {
            return Err("AI model update is currently in progress; try again shortly".to_string());
        }
        // Fast path: check already-loaded ONNX session BEFORE running disk SHA-256 verification
        // on the ~15 MB runtime DLLs. Any model download/import/removal calls `clear_cached_runtime_state()`.
        let (expected_id, _name, raw_model_path, _is_custom) =
            model_manager::active_model_id_and_path(user_dir);
        {
            let guard = self
                .loaded_model
                .lock()
                .map_err(|_| "AI model lock poisoned".to_string())?;
            if let Some(ref existing) = *guard {
                let path_matches = existing.model_id == expected_id
                    && (existing.model_path == raw_model_path
                        || raw_model_path
                            .canonicalize()
                            .ok()
                            .as_deref()
                            .is_some_and(|p| p == existing.model_path.as_path()));
                if path_matches && existing.model_path.is_file() {
                    let cfg = ResolvedAiModelConfig {
                        model_id: existing.model_id.clone(),
                        model_path: existing.model_path.clone(),
                        runtime_dll_path: existing.runtime_dll_path.clone(),
                    };
                    return Ok((Arc::clone(existing), cfg));
                }
            }
        }

        // Serialize cold model loads so concurrent calls share one ONNX session and coordinate
        // cleanly with `clear_cached_runtime_state()` during model import/removal.
        let _load_guard = self
            .model_load_lock
            .lock()
            .map_err(|_| "AI model load lock poisoned".to_string())?;

        if self.download_running.load(Ordering::SeqCst) {
            return Err("AI model update is currently in progress; try again shortly".to_string());
        }

        let cfg = resolve_ready_ai_config(user_dir)?;
        {
            let guard = self
                .loaded_model
                .lock()
                .map_err(|_| "AI model lock poisoned".to_string())?;
            if let Some(ref existing) = *guard {
                if existing.model_id == cfg.model_id && existing.model_path == cfg.model_path {
                    return Ok((Arc::clone(existing), cfg));
                }
            }
        }

        let loaded = Arc::new(LoadedOnnxModel::load(
            &cfg.model_id,
            &cfg.model_path,
            &cfg.runtime_dll_path,
        )?);
        let mut guard = self
            .loaded_model
            .lock()
            .map_err(|_| "AI model lock poisoned".to_string())?;
        *guard = Some(Arc::clone(&loaded));
        Ok((loaded, cfg))
    }

    pub fn clear_cached_runtime_state(&self) {
        let _load_guard = self.model_load_lock.lock();
        if let Ok(mut guard) = self.loaded_model.lock() {
            *guard = None;
        }
        if let Ok(mut cache) = self.vector_cache.lock() {
            cache.clear();
        }
        if let Ok(mut probes) = self.external_probes.lock() {
            probes.clear();
        }
    }

    pub fn invalidate_vector_cache(&self) {
        if let Ok(mut cache) = self.vector_cache.lock() {
            cache.clear();
        }
    }

    pub fn remove_vectors_from_cache(&self, sample_ids: &[i64]) {
        if sample_ids.is_empty() {
            return;
        }
        if let Ok(mut cache) = self.vector_cache.lock() {
            cache.remove_sample_ids(sample_ids);
        }
    }

    pub fn update_vector_locations(&self, updates: &[(i64, i64, &str)]) {
        if updates.is_empty() {
            return;
        }
        if let Ok(mut cache) = self.vector_cache.lock() {
            for &(sample_id, library_id, path) in updates {
                cache.update_sample_location(sample_id, library_id, path);
            }
        }
    }

    pub fn last_avg_ms(&self) -> f64 {
        self.last_avg_ms_per_clip
            .lock()
            .map(|v| *v)
            .unwrap_or(0.0)
    }

    pub fn set_last_avg_ms(&self, ms: f64) {
        if let Ok(mut guard) = self.last_avg_ms_per_clip.lock() {
            *guard = ms;
        }
    }
}

pub fn infer_single_sample_path(
    model: &LoadedOnnxModel,
    sample_path: &Path,
) -> Result<AiInferenceOutput, String> {
    let waveform = decode_waveform_for_ai(sample_path)?;
    if !has_usable_audio_energy(&waveform) {
        return Err("Audio sample contains digital silence or sub-floor signal".to_string());
    }
    model.infer_waveform(waveform)
}

/// Inserts/promotes an AI-approved tag on `sample_id` while caching `(tag_id, is_genre)`
/// across a batch transaction so bulk approval avoids N+1 `tags`/`tag_facets` lookups and
/// defers `sync_primary_genre_for_samples` to a single batched pass.
pub(crate) fn ensure_manual_tag_on_sample_batched(
    conn: &Connection,
    sample_id: i64,
    tag_name: &str,
    tag_cache: &mut std::collections::HashMap<String, (i64, bool)>,
) -> Result<bool, String> {
    let trimmed = tag_name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("Invalid tag name".to_string());
    }
    let key = trimmed.to_lowercase();
    let (tag_id, is_genre) = if let Some(&cached) = tag_cache.get(&key) {
        cached
    } else {
        let id: i64 = match conn.query_row(
            "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) LIMIT 1",
            [trimmed],
            |r| r.get(0),
        ) {
            Ok(id) => id,
            Err(_) => crate::db::ensure_taxonomy_tag(conn, trimmed, None, None, None, true)
                .or_else(|_| {
                    let color = deterministic_color_for_name(trimmed);
                    conn.execute(
                        "INSERT INTO tags (name, color, is_manual) VALUES (?1, ?2, 1)",
                        params![trimmed, color],
                    )
                    .map_err(|e| e.to_string())?;
                    Ok::<i64, String>(conn.last_insert_rowid())
                })?,
        };
        let genre_flag = conn
            .query_row::<i64, _, _>(
                "SELECT COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map(|fid| crate::db::taxonomy::facet_domain_in_db(conn, fid) == "genres")
            .unwrap_or(false);
        tag_cache.insert(key, (id, genre_flag));
        (id, genre_flag)
    };

    let mut stmt = conn
        .prepare_cached(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
             VALUES (?1, ?2, 1, 'ai_approved')
             ON CONFLICT(sample_id, tag_id) DO UPDATE SET
                is_manual = 1,
                source = CASE WHEN sample_tags.source = 'manual' THEN 'manual' ELSE 'ai_approved' END",
        )
        .map_err(|e| e.to_string())?;
    stmt.execute(params![sample_id, tag_id])
        .map_err(|e| e.to_string())?;

    Ok(is_genre)
}

pub fn ensure_manual_tag_on_sample(
    conn: &Connection,
    sample_id: i64,
    tag_name: &str,
) -> Result<(), String> {
    let mut cache = std::collections::HashMap::new();
    let is_genre = ensure_manual_tag_on_sample_batched(conn, sample_id, tag_name, &mut cache)?;
    if is_genre {
        let _ = crate::db::sync_primary_genre_for_samples(conn, &[sample_id]);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::audio_preprocess::{resample_mono_to_16k, select_active_window};
    use super::onnx_runner::{
        aggregate_frame_scores, compute_hop_energy_stats, energy_weighted_pool_frames,
        mean_pool_frames, project_and_l2_normalize,
    };
    use super::similarity::AiVectorCache;
    use super::taxonomy::{
        extract_mapped_tags_from_scores, map_audioset_class_to_audify_tag,
        persist_ai_tags_for_sample, yamnet_class_label, MappedAiTag,
    };
    use super::unload_idle_caches_at;
    use rusqlite::Connection;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn yamnet_class_map_csv_has_521_labels() {
        assert_eq!(yamnet_class_label(0), Some("Speech"));
        assert_eq!(yamnet_class_label(420), Some("Explosion"));
        assert_eq!(yamnet_class_label(520), Some("Field recording"));
        assert_eq!(yamnet_class_label(521), None);
        assert_eq!(map_audioset_class_to_audify_tag(420), Some("Explosion"));
        assert_eq!(map_audioset_class_to_audify_tag(499), Some("Synth"));
        assert_eq!(map_audioset_class_to_audify_tag(505), Some("Ambience"));
        assert_eq!(map_audioset_class_to_audify_tag(494), None);
    }

    #[test]
    fn resampler_and_active_window_skip_leading_silence() {
        let mut mono = vec![0.0_f32; 48_000];
        mono.extend(vec![0.5_f32; 48_000]);
        let resampled = resample_mono_to_16k(&mono, 48_000, 128_000);
        assert!((resampled.len() as i32 - 32_000).abs() <= 4);

        let window = select_active_window(&resampled, 16_000);
        assert_eq!(window.len(), 16_000);
        let nonzero = window.iter().filter(|&&v| v.abs() > 0.1).count();
        assert!(nonzero > 14_000);
    }

    #[test]
    fn active_window_trims_trailing_silence_keeping_tail_margin() {
        let mut wave = vec![0.4_f32; 8_000];
        wave.extend(vec![0.0_f32; 40_000]);
        let window = select_active_window(&wave, 160_000);
        // 8,000 active + 1,024 samples (64 ms at 16 kHz) tail margin = 9,024 samples
        assert!(window.len() < 12_000, "expected trailing zeros trimmed, got {}", window.len());
        assert!(window.len() >= 9_000, "expected tail margin preserved, got {}", window.len());
    }

    #[test]
    fn onnx_frame_aggregation_and_projection_preserve_unit_norm() {
        let mut scores = vec![0.0_f32; 2 * 521];
        scores[420] = 0.80;
        scores[521 + 420] = 0.20;
        let agg = aggregate_frame_scores(&[2, 521], &scores);
        assert!((agg[420] - (0.55 * 0.50 + 0.45 * 0.80)).abs() < 1e-5);

        let tags = extract_mapped_tags_from_scores(&agg, 0.70, 4);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag_name, "Explosion");

        let emb = vec![1.0_f32; 2048];
        let pooled = mean_pool_frames(&[2, 1024], &emb);
        let projected = project_and_l2_normalize(&pooled);
        let norm: f32 = projected.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);

        // Energy-weighted pooling should heavily favor loud transient frames over quiet tails.
        let mut two_frame_wave = vec![0.6_f32; 7_680];
        two_frame_wave.extend(vec![0.0_f32; 15_360]);
        let hop_stats = compute_hop_energy_stats(&two_frame_wave);
        let mut weighted_emb = vec![0.0_f32; 2 * 1024];
        weighted_emb[0] = 1.0;
        weighted_emb[1024 + 1] = 1.0;
        let weighted = energy_weighted_pool_frames(&[2, 1024], &weighted_emb, &hop_stats);
        assert!(
            weighted[0] > weighted[1] * 20.0,
            "loud frame should dominate quiet tail: {:?}",
            &weighted[..2]
        );
    }

    #[test]
    fn persist_ai_tags_never_overwrites_manual_or_dismissed_tags() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, is_manual INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE sample_tags (sample_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, is_manual INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'auto', PRIMARY KEY (sample_id, tag_id));
             CREATE TABLE ai_tag_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, sample_id INTEGER NOT NULL, tag_name TEXT NOT NULL, confidence REAL NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', UNIQUE(sample_id, tag_name));
             INSERT INTO tags (id, name, color, is_manual) VALUES (1, 'Explosion', '#FF5500', 1), (2, 'Fire', '#F97316', 0);
             INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (10, 1, 1, 'manual'), (10, 2, 0, 'auto');
             INSERT INTO ai_tag_suggestions (sample_id, tag_name, confidence, model_id, status) VALUES (10, 'Whoosh', 0.9, 'yamnet-audioset-v1', 'dismissed');",
        )
        .expect("schema");

        let mapped = vec![
            MappedAiTag {
                tag_name: "Explosion".to_string(),
                confidence: 0.95,
            },
            MappedAiTag {
                tag_name: "Fire".to_string(),
                confidence: 0.92,
            },
            MappedAiTag {
                tag_name: "Whoosh".to_string(),
                confidence: 0.88,
            },
            MappedAiTag {
                tag_name: "Impact".to_string(),
                confidence: 0.84,
            },
        ];

        let (added_suggest, _) =
            persist_ai_tags_for_sample(&conn, 10, "yamnet-audioset-v1", &mapped[..2], false)
                .expect("suggest skips existing tags");
        assert_eq!(added_suggest, 0);

        let (added, applied) =
            persist_ai_tags_for_sample(&conn, 10, "yamnet-audioset-v1", &mapped, true)
                .expect("persist");
        assert_eq!(added, 0);
        assert_eq!(applied, 1);

        let manual_flag: i64 = conn
            .query_row(
                "SELECT st.is_manual FROM sample_tags st JOIN tags t ON t.id = st.tag_id WHERE st.sample_id = 10 AND t.name = 'Explosion'",
                [],
                |r| r.get(0),
            )
            .expect("manual preserved");
        assert_eq!(manual_flag, 1);

        let whoosh_applied: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st JOIN tags t ON t.id = st.tag_id WHERE st.sample_id = 10 AND t.name = 'Whoosh'",
                [],
                |r| r.get(0),
            )
            .expect("dismissed skipped");
        assert_eq!(whoosh_applied, 0);

        let impact_source: String = conn
            .query_row(
                "SELECT st.source FROM sample_tags st JOIN tags t ON t.id = st.tag_id WHERE st.sample_id = 10 AND t.name = 'Impact'",
                [],
                |r| r.get(0),
            )
            .expect("ai auto tag persisted");
        assert_eq!(impact_source, "ai_auto");
    }

    #[test]
    fn ai_queries_execute_cleanly_against_real_audify_schema() {
        use super::batch::collect_analysis_candidates;
        use super::model_manager::build_ai_model_status;
        use super::onnx_runner::l2_normalize_inplace;
        use super::similarity::{
            compute_top_k_similar, load_allowed_profile_library_ids, vec_to_blob, AiVectorCache,
            SimilarityQuery,
        };
        use super::suggestions::{
            approve_all_ai_tag_suggestions_in_db, dismiss_all_ai_tag_suggestions_in_db,
            fetch_ai_tag_suggestions_for_profile, resolve_ai_tag_suggestion_in_db,
            validate_active_profile_sample_access,
        };
        use super::types::AI_EMBEDDING_DIM;
        use crate::db::init_schema_on_conn;
        use rusqlite::params;
        use std::path::Path;

        let conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init real Audify schema");

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'F:/Audio/SFX', 'SFX', 1)",
            [],
        )
        .expect("insert library");
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms)
             VALUES (101, 1, 'F:/Audio/SFX/Impacts/boom.wav', 'boom.wav', 'wav', 1250),
                    (102, 1, 'F:/Audio/SFX/Impacts/hit.wav', 'hit.wav', 'wav', 800)",
            [],
        )
        .expect("insert samples");

        let user_dir = Path::new("nonexistent-ai-test-user-dir");
        let status_before = build_ai_model_status(&conn, user_dir, 1, false, 0.0);
        assert_eq!(status_before.total_profile_samples, 2);
        assert_eq!(status_before.indexed_count, 0);

        let all_candidates =
            collect_analysis_candidates(&conn, 1, "yamnet-audioset-v1", None, false)
                .expect("collect all missing candidates");
        assert_eq!(all_candidates.len(), 2);
        assert_eq!(all_candidates[0].filename, "boom.wav");

        let targeted =
            collect_analysis_candidates(&conn, 1, "yamnet-audioset-v1", Some(&[101]), true)
                .expect("collect targeted sample candidate");
        assert_eq!(targeted.len(), 1);
        assert_eq!(targeted[0].path, "F:/Audio/SFX/Impacts/boom.wav");

        let (lib_id, resolved_path) =
            validate_active_profile_sample_access(&conn, 1, 101).expect("validate sample access");
        assert_eq!(lib_id, 1);
        assert_eq!(resolved_path, "F:/Audio/SFX/Impacts/boom.wav");

        let mut emb1 = [0.0_f32; AI_EMBEDDING_DIM];
        emb1[0] = 1.0;
        let mut emb2 = [0.0_f32; AI_EMBEDDING_DIM];
        emb2[0] = 0.9;
        emb2[1] = 0.1;
        l2_normalize_inplace(&mut emb2);

        conn.execute(
            "INSERT INTO sample_embeddings (sample_id, model_id, dim, vector)
             VALUES (?1, 'yamnet-audioset-v1', ?2, ?3), (?4, 'yamnet-audioset-v1', ?2, ?5)",
            params![
                101,
                AI_EMBEDDING_DIM as i64,
                vec_to_blob(&emb1),
                102,
                vec_to_blob(&emb2)
            ],
        )
        .expect("insert embeddings");

        let allowed = load_allowed_profile_library_ids(&conn, 1).expect("allowed libs");
        let mut cache = AiVectorCache::default();
        cache
            .ensure_hydrated(&conn, "yamnet-audioset-v1")
            .expect("hydrate vector cache from real schema");
        assert_eq!(cache.entries.len(), 2);

        let sim = compute_top_k_similar(
            &cache.entries,
            &SimilarityQuery {
                anchor_sample_id: 101,
                anchor_vec: &emb1,
                allowed_libraries: Some(&allowed),
                folder_prefix: None,
                duration_bounds_ms: None,
                min_score: 0.5,
                top_k: 10,
            },
        );
        assert_eq!(sim.matches.len(), 1);
        assert_eq!(sim.matches[0].sample_id, 102);

        persist_ai_tags_for_sample(
            &conn,
            101,
            "yamnet-audioset-v1",
            &[super::taxonomy::MappedAiTag {
                tag_name: "Explosion".to_string(),
                confidence: 0.91,
            }],
            false,
        )
        .expect("persist pending ai suggestion");

        let pending = fetch_ai_tag_suggestions_for_profile(&conn, 1, "pending", None)
            .expect("fetch pending suggestions");
        assert_eq!(pending.len(), 1);

        resolve_ai_tag_suggestion_in_db(&conn, user_dir, 1, 101, "Explosion", true)
            .expect("approve single suggestion");
        let after_single = fetch_ai_tag_suggestions_for_profile(&conn, 1, "pending", None)
            .expect("fetch after approve");
        assert!(after_single.is_empty());

        persist_ai_tags_for_sample(
            &conn,
            102,
            "yamnet-audioset-v1",
            &[super::taxonomy::MappedAiTag {
                tag_name: "Impact".to_string(),
                confidence: 0.88,
            }],
            false,
        )
        .expect("persist second pending ai suggestion");
        let approved_all =
            approve_all_ai_tag_suggestions_in_db(&conn, user_dir, 1, Some(&[102]))
                .expect("approve all selected");
        assert_eq!(approved_all, 1);

        persist_ai_tags_for_sample(
            &conn,
            101,
            "yamnet-audioset-v1",
            &[super::taxonomy::MappedAiTag {
                tag_name: "Laser".to_string(),
                confidence: 0.85,
            }],
            false,
        )
        .expect("persist third pending ai suggestion");
        let dismissed_all =
            dismiss_all_ai_tag_suggestions_in_db(&conn, user_dir, 1, None)
                .expect("dismiss all remaining pending");
        assert_eq!(dismissed_all, 1);
        assert!(
            fetch_ai_tag_suggestions_for_profile(&conn, 1, "pending", None)
                .expect("no pending left")
                .is_empty()
        );
    }

    #[test]
    fn idle_reaper_unloads_vector_cache_only_when_idle_and_not_running() {
        let loaded_model = Mutex::new(None);
        let mut initial_cache = AiVectorCache {
            model_id: "yamnet-v1".to_string(),
            hydrated: true,
            ..Default::default()
        };
        initial_cache.entries.push(super::similarity::CachedEmbedding {
            sample_id: 1,
            library_id: 1,
            duration_ms: 500,
            parent_folder_norm: Arc::from("f:/sfx"),
            vector: [0.0; 128],
        });
        initial_cache.id_to_index.insert(1, 0);
        let vector_cache = Mutex::new(initial_cache);
        let analysis_running = AtomicBool::new(true);
        let last_activity_ms = AtomicU64::new(1_000);

        // Should never unload while analysis is actively running
        assert!(!unload_idle_caches_at(
            &loaded_model,
            &vector_cache,
            &analysis_running,
            &last_activity_ms,
            None,
            200_000,
            120_000,
        ));
        assert!(vector_cache.lock().unwrap().hydrated);

        analysis_running.store(false, Ordering::SeqCst);
        // Should not unload before idle threshold
        assert!(!unload_idle_caches_at(
            &loaded_model,
            &vector_cache,
            &analysis_running,
            &last_activity_ms,
            None,
            50_000,
            120_000,
        ));
        assert!(vector_cache.lock().unwrap().hydrated);

        // Should unload and release Vec capacity once idle threshold passes
        assert!(unload_idle_caches_at(
            &loaded_model,
            &vector_cache,
            &analysis_running,
            &last_activity_ms,
            None,
            150_000,
            120_000,
        ));
        let guard = vector_cache.lock().unwrap();
        assert!(!guard.hydrated);
        assert_eq!(guard.entries.capacity(), 0);
    }

    #[test]
    fn yamnet_521_maps_fine_subtags_genres_moods_and_knn_weights_manual_above_ai_approved() {
        use super::knn::{KnnLabeledIndex, LabeledEmbeddingEntry};
        use super::taxonomy::{extract_mapped_tags_from_scores, map_audioset_class_to_audify_tag};
        use super::types::AI_EMBEDDING_DIM;

        assert_eq!(map_audioset_class_to_audify_tag(69), Some("Dog"));
        assert_eq!(map_audioset_class_to_audify_tag(76), Some("Cat"));
        assert_eq!(map_audioset_class_to_audify_tag(106), Some("Bird"));
        assert_eq!(map_audioset_class_to_audify_tag(82), Some("Horse"));
        assert_eq!(map_audioset_class_to_audify_tag(421), Some("Gunshot"));
        assert_eq!(map_audioset_class_to_audify_tag(214), Some("Rock"));
        assert_eq!(map_audioset_class_to_audify_tag(276), Some("Horror"));
        assert_eq!(
            map_audioset_class_to_audify_tag(67),
            None,
            "generic Animal root class should not flood Animals"
        );

        // Floor calibration check: 0.58 * 0.40 = 0.232; score 0.20 is rejected, 0.30 is accepted
        let mut scores = vec![0.0_f32; 521];
        scores[69] = 0.30; // Dog
        scores[106] = 0.20; // Bird below calibrated 0.58 floor
        let mapped = extract_mapped_tags_from_scores(&scores, 0.40, 5);
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].tag_name, "Dog");

        // kNN weighting: manual (1.0) scores higher than ai_approved (0.75) at identical similarity
        let mut v = [0.0_f32; AI_EMBEDDING_DIM];
        v[0] = 1.0;
        let idx = KnnLabeledIndex::from_entries(vec![
            LabeledEmbeddingEntry {
                sample_id: 1,
                vector: v,
                tag_names: vec!["ManualTag".to_string()],
                tag_weights: vec![1.0],
            },
            LabeledEmbeddingEntry {
                sample_id: 2,
                vector: v,
                tag_names: vec!["ManualTag".to_string()],
                tag_weights: vec![1.0],
            },
            LabeledEmbeddingEntry {
                sample_id: 3,
                vector: v,
                tag_names: vec!["ApprovedTag".to_string()],
                tag_weights: vec![0.75],
            },
            LabeledEmbeddingEntry {
                sample_id: 4,
                vector: v,
                tag_names: vec!["ApprovedTag".to_string()],
                tag_weights: vec![0.75],
            },
        ]);
        let preds = idx.suggest_for_vector(99, &v, 0.25, 5);
        assert_eq!(preds.len(), 2);
        assert_eq!(preds[0].tag_name, "ManualTag");
        assert_eq!(preds[1].tag_name, "ApprovedTag");
        assert!(preds[0].confidence > preds[1].confidence);
    }
}
