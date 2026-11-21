use crate::ai_tagger::model_manager::{
    active_model_id_and_path, build_ai_model_status, download_default_ai_bundle,
    import_local_ai_file, remove_ai_assets,
};
use crate::ai_tagger::similarity::{
    compute_similarity_duration_bounds, compute_top_k_similar, load_allowed_profile_library_ids,
    vec_to_blob, SimilarityQuery,
};
use crate::ai_tagger::suggestions::{
    approve_all_ai_tag_suggestions_in_db, dismiss_all_ai_tag_suggestions_in_db,
    fetch_ai_tag_suggestions_for_profile, resolve_ai_tag_suggestion_in_db,
    validate_active_profile_sample_access,
};
use crate::ai_tagger::types::{
    AiAnalysisSummary, AiModelStatus, AiTagSuggestionItem, AiTaggingMode, SimilaritySearchResult,
};
use crate::ai_tagger::{
    infer_single_sample_path, run_batch_ai_analysis, AiBatchAnalysisOptions, AiTaggerState,
};
use crate::db::{get_active_profile_id, open_read_conn, run_read_query, AppState};
use crate::security::sanitize_err;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State};

const DEFAULT_CONFIDENCE_THRESHOLD: f32 = 0.72;
const DEFAULT_MIN_SIMILARITY_SCORE: f32 = 0.70;
const DEFAULT_TOP_K: usize = 100;

struct AtomicFlagGuard<'a>(&'a AtomicBool);
impl<'a> Drop for AtomicFlagGuard<'a> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn claim_exclusive_ai_guards<'a>(
    ai_state: &'a AiTaggerState,
    err_msg: &str,
) -> Result<(AtomicFlagGuard<'a>, AtomicFlagGuard<'a>), String> {
    if ai_state
        .download_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(err_msg.to_string());
    }
    let dl_guard = AtomicFlagGuard(&ai_state.download_running);
    if ai_state
        .analysis_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(err_msg.to_string());
    }
    Ok((dl_guard, AtomicFlagGuard(&ai_state.analysis_running)))
}

fn read_ai_status(
    state: &AppState,
    ai_state: &AiTaggerState,
    verify_hashes: bool,
) -> Result<AiModelStatus, String> {
    let conn = open_read_conn(&state.user_dir).map_err(|e| sanitize_err(&state.user_dir, &e))?;
    let profile_id = get_active_profile_id(&conn);
    Ok(build_ai_model_status(
        &conn,
        &state.user_dir,
        profile_id,
        verify_hashes,
        ai_state.last_avg_ms(),
    ))
}

fn read_profile_ai_preferences(conn: &Connection, profile_id: i64) -> (f32, AiTaggingMode, bool) {
    let raw: Option<String> = conn
        .query_row(
            "SELECT settings_json FROM profiles WHERE id = ?1",
            [profile_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();

    let Some(json_str) = raw else {
        return (DEFAULT_CONFIDENCE_THRESHOLD, AiTaggingMode::Suggest, true);
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) else {
        return (DEFAULT_CONFIDENCE_THRESHOLD, AiTaggingMode::Suggest, true);
    };

    let threshold = val
        .get("aiTagConfidenceThreshold")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .map(|v| (v as f32).clamp(0.25, 0.98))
        .unwrap_or(DEFAULT_CONFIDENCE_THRESHOLD);

    let mode = AiTaggingMode::from_str_or_default(val.get("aiTaggingMode").and_then(|v| v.as_str()));
    let knn_learning = val
        .get("aiKnnTagLearning")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    (threshold, mode, knn_learning)
}

#[tauri::command]
pub async fn get_ai_model_status(app: AppHandle) -> Result<AiModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();
        read_ai_status(&state, &ai_state, false)
    })
    .await
    .map_err(|e| format!("AI status task failed: {}", e))?
}

#[tauri::command]
pub async fn verify_ai_model_integrity(app: AppHandle) -> Result<AiModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();
        read_ai_status(&state, &ai_state, true)
    })
    .await
    .map_err(|e| format!("AI integrity check task failed: {}", e))?
}

#[tauri::command]
pub async fn download_ai_model(app: AppHandle) -> Result<AiModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();

        let _guards = claim_exclusive_ai_guards(
            &ai_state,
            "Stop running AI tasks before downloading model files",
        )?;
        ai_state.download_cancel.store(false, Ordering::SeqCst);

        ai_state.clear_cached_runtime_state();
        download_default_ai_bundle(&app, &state.user_dir, &ai_state.download_cancel)
            .map_err(|e| sanitize_err(&state.user_dir, &e))?;

        read_ai_status(&state, &ai_state, true)
    })
    .await
    .map_err(|e| format!("AI download worker failed: {}", e))?
}

#[tauri::command]
pub fn cancel_ai_download(ai_state: State<'_, AiTaggerState>) -> Result<(), String> {
    ai_state.download_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn import_ai_model_file(
    app: AppHandle,
    source_path: String,
    kind: String,
) -> Result<AiModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();
        let _guards = claim_exclusive_ai_guards(
            &ai_state,
            "Stop running AI tasks before importing model files",
        )?;

        ai_state.clear_cached_runtime_state();
        import_local_ai_file(&state.user_dir, &source_path, &kind)
            .map_err(|e| sanitize_err(&state.user_dir, &e))?;

        read_ai_status(&state, &ai_state, false)
    })
    .await
    .map_err(|e| format!("AI import worker failed: {}", e))?
}

#[tauri::command]
pub fn remove_ai_model(
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    include_runtime: Option<bool>,
    clear_ai_data: Option<bool>,
) -> Result<AiModelStatus, String> {
    let _guards = claim_exclusive_ai_guards(
        &ai_state,
        "Stop running AI tasks before removing model files",
    )?;

    ai_state.clear_cached_runtime_state();
    let remove_res = remove_ai_assets(&state.user_dir, include_runtime.unwrap_or(false));

    if clear_ai_data.unwrap_or(false) {
        let conn = state.lock_db();
        let profile_id = get_active_profile_id(&conn);
        let scope_sql = "SELECT s.id FROM samples s
            WHERE s.library_id IN (
                SELECT l.id FROM libraries l
                WHERE l.is_global = 1
                   OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
            )";
        conn.execute(
            &format!("DELETE FROM sample_embeddings WHERE sample_id IN ({})", scope_sql),
            params![profile_id],
        )
        .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
        conn.execute(
            &format!(
                "DELETE FROM ai_tag_suggestions WHERE status = 'pending' AND sample_id IN ({})",
                scope_sql
            ),
            params![profile_id],
        )
        .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
    }

    remove_res.map_err(|e| sanitize_err(&state.user_dir, &e))?;
    read_ai_status(&state, &ai_state, false)
}

#[tauri::command]
pub async fn suggest_knn_ai_tags(
    app: AppHandle,
    sample_ids: Option<Vec<i64>>,
    confidence_threshold: Option<f32>,
    tagging_mode: Option<AiTaggingMode>,
) -> Result<AiAnalysisSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();

        let (pref_conf, pref_mode, _) = {
            let conn =
                open_read_conn(&state.user_dir).map_err(|e| sanitize_err(&state.user_dir, &e))?;
            let profile_id = get_active_profile_id(&conn);
            read_profile_ai_preferences(&conn, profile_id)
        };

        let conf = confidence_threshold
            .filter(|v| v.is_finite())
            .map(|v| v.clamp(0.25, 0.98))
            .unwrap_or(pref_conf);
        let mode = tagging_mode.unwrap_or(pref_mode);
        if mode == AiTaggingMode::VectorsOnly {
            return Err(
                "AI tagging mode is set to Vectors Only. Switch to Suggest or Auto-Apply to generate k-NN tag suggestions."
                    .to_string(),
            );
        }

        crate::ai_tagger::knn::run_knn_tag_suggestions(
            &app,
            &state,
            &ai_state,
            sample_ids.as_deref(),
            conf,
            mode,
            4,
        )
        .map_err(|e| sanitize_err(&state.user_dir, &e))
        .inspect(|_| ai_state.touch_activity(Some(&state.db)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn analyze_samples_ai(
    app: AppHandle,
    sample_ids: Option<Vec<i64>>,
    confidence_threshold: Option<f32>,
    auto_apply: Option<bool>,
    tagging_mode: Option<AiTaggingMode>,
    reanalyze_existing: Option<bool>,
    knn_learning: Option<bool>,
) -> Result<AiAnalysisSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();

        let (pref_conf, pref_mode, pref_knn) = {
            let conn =
                open_read_conn(&state.user_dir).map_err(|e| sanitize_err(&state.user_dir, &e))?;
            let profile_id = get_active_profile_id(&conn);
            read_profile_ai_preferences(&conn, profile_id)
        };
        let use_knn = knn_learning.unwrap_or(pref_knn);

        let conf = confidence_threshold
            .filter(|v| v.is_finite())
            .map(|v| v.clamp(0.25, 0.98))
            .unwrap_or(pref_conf);
        let mode = tagging_mode.unwrap_or_else(|| match auto_apply {
            Some(true) => AiTaggingMode::AutoApply,
            Some(false) if pref_mode == AiTaggingMode::VectorsOnly => AiTaggingMode::VectorsOnly,
            Some(false) => AiTaggingMode::Suggest,
            None => pref_mode,
        });
        let reanalyze = reanalyze_existing.unwrap_or(false);

        run_batch_ai_analysis(
            &app,
            &state,
            &ai_state,
            sample_ids.as_deref(),
            AiBatchAnalysisOptions {
                confidence_threshold: conf,
                tagging_mode: mode,
                reanalyze_existing: reanalyze,
                use_knn_learning: use_knn,
            },
        )
        .map_err(|e| sanitize_err(&state.user_dir, &e))
        .inspect(|_| ai_state.touch_activity(Some(&state.db)))
    })
    .await
    .map_err(|e| format!("AI analysis worker failed: {}", e))?
}

#[tauri::command]
pub fn cancel_ai_analysis(ai_state: State<'_, AiTaggerState>) -> Result<(), String> {
    ai_state.analysis_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn find_similar_samples(
    app: AppHandle,
    sample_id: i64,
    min_score: Option<f32>,
    top_k: Option<usize>,
    scope_folder_path: Option<String>,
    match_similar_duration: Option<bool>,
) -> Result<SimilaritySearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let ai_state = app.state::<AiTaggerState>();
        let (active_model_id, _, _, _) = active_model_id_and_path(&state.user_dir);

        let (library_id, sample_path, anchor_duration_ms, allowed_libs) = {
            let conn =
                open_read_conn(&state.user_dir).map_err(|e| sanitize_err(&state.user_dir, &e))?;
            let pid = get_active_profile_id(&conn);
            let (lib_id, path) = validate_active_profile_sample_access(&conn, pid, sample_id)?;
            let duration_ms: i64 = conn
                .query_row("SELECT COALESCE(duration_ms, 0) FROM samples WHERE id = ?1", [sample_id], |r| r.get(0))
                .unwrap_or(0);
            let allowed = load_allowed_profile_library_ids(&conn, pid)?;

            let mut cache = ai_state.vector_cache.lock().map_err(|_| "AI similarity cache lock poisoned".to_string())?;
            if cache.hydrated && cache.entries.iter().any(|e| !allowed.contains(&e.library_id)) {
                cache.clear();
            }
            cache.ensure_hydrated_for_profile(&conn, &active_model_id, pid)?;
            (lib_id, path, duration_ms, allowed)
        };
        ai_state.touch_activity(Some(&state.db));

        let anchor_vec = {
            let cached_vec = {
                let cache = ai_state.vector_cache.lock().map_err(|_| "AI similarity cache lock poisoned".to_string())?;
                cache.id_to_index.get(&sample_id).and_then(|&idx| cache.entries.get(idx)).map(|e| e.vector)
            };

            if let Some(vec) = cached_vec {
                vec
            } else {
                // On-demand single-sample embedding if user invokes similarity before batch indexing
                let (model, cfg) = ai_state.ensure_loaded_model(&state.user_dir).map_err(|e| sanitize_err(&state.user_dir, &e))?;
                let output = infer_single_sample_path(&model, Path::new(&sample_path)).map_err(|e| sanitize_err(&state.user_dir, &e))?;

                let blob = vec_to_blob(&output.embedding);
                {
                    let conn = state.lock_db();
                    conn.execute(
                        "INSERT INTO sample_embeddings (sample_id, model_id, dim, vector)
                         VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT(sample_id) DO UPDATE SET
                             model_id = excluded.model_id, dim = excluded.dim, vector = excluded.vector, updated_at = datetime('now')",
                        params![sample_id, cfg.model_id, output.embedding.len() as i64, blob],
                    )
                    .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
                }

                let mut cache = ai_state.vector_cache.lock().map_err(|_| "AI similarity cache lock poisoned".to_string())?;
                cache.upsert(&cfg.model_id, sample_id, library_id, &sample_path, anchor_duration_ms, output.embedding);
                output.embedding
            }
        };

        let duration_bounds_ms = if match_similar_duration.unwrap_or(false) {
            compute_similarity_duration_bounds(anchor_duration_ms)
        } else {
            None
        };

        let cache = ai_state
            .vector_cache
            .lock()
            .map_err(|_| "AI similarity cache lock poisoned".to_string())?;

        let safe_min_score = min_score
            .filter(|v| v.is_finite())
            .map(|v| v.clamp(0.0, 0.99))
            .unwrap_or(DEFAULT_MIN_SIMILARITY_SCORE);

        Ok(compute_top_k_similar(
            &cache.entries,
            &SimilarityQuery {
                anchor_sample_id: sample_id,
                anchor_vec: &anchor_vec,
                allowed_libraries: Some(&allowed_libs),
                folder_prefix: scope_folder_path.as_deref(),
                duration_bounds_ms,
                min_score: safe_min_score,
                top_k: top_k.unwrap_or(DEFAULT_TOP_K),
            },
        ))
    })
    .await
    .map_err(|e| format!("Similarity search worker failed: {}", e))?
}

#[tauri::command]
pub async fn get_ai_tag_suggestions(
    state: State<'_, AppState>,
    status: Option<String>,
    sample_ids: Option<Vec<i64>>,
) -> Result<Vec<AiTagSuggestionItem>, String> {
    run_read_query(&state, move |conn| {
        let profile_id = get_active_profile_id(conn);
        let clean_status = match status.as_deref() {
            Some("approved") => "approved",
            Some("dismissed") => "dismissed",
            _ => "pending",
        };
        fetch_ai_tag_suggestions_for_profile(conn, profile_id, clean_status, sample_ids.as_deref())
    })
    .await
}

#[tauri::command]
pub fn resolve_ai_tag_suggestion(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_name: String,
    approve: bool,
) -> Result<(), String> {
    let trimmed = tag_name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("Invalid AI tag suggestion name".to_string());
    }

    let conn = state.lock_db();
    let profile_id = get_active_profile_id(&conn);
    resolve_ai_tag_suggestion_in_db(&conn, &state.user_dir, profile_id, sample_id, trimmed, approve)
}

#[tauri::command]
pub fn approve_all_ai_tag_suggestions(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<usize, String> {
    let conn = state.lock_db();
    let profile_id = get_active_profile_id(&conn);
    approve_all_ai_tag_suggestions_in_db(&conn, &state.user_dir, profile_id, sample_ids.as_deref())
}

#[tauri::command]
pub fn dismiss_all_ai_tag_suggestions(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<usize, String> {
    let conn = state.lock_db();
    let profile_id = get_active_profile_id(&conn);
    dismiss_all_ai_tag_suggestions_in_db(&conn, &state.user_dir, profile_id, sample_ids.as_deref())
}
