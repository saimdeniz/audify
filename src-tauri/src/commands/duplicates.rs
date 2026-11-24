use crate::ai_tagger::model_manager::active_model_id_and_path;
use crate::db::AppState;
use crate::duplicates::{
    compute_duplicates_with_progress, load_duplicate_candidates_for_model,
    persist_sample_hash_cache, DuplicateScanMode, DuplicateScanProgressPayload,
    DuplicateScanResult,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State};

static DUPLICATE_SCAN_ACTIVE: AtomicBool = AtomicBool::new(false);

struct ResetDuplicateScanGuard;

impl Drop for ResetDuplicateScanGuard {
    fn drop(&mut self) {
        DUPLICATE_SCAN_ACTIVE.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn scan_duplicate_samples(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: Option<String>,
    library_id: Option<i64>,
    min_similarity_pct: Option<u8>,
) -> Result<DuplicateScanResult, String> {
    if DUPLICATE_SCAN_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A duplicate scan is already running".to_string());
    }
    let _scan_guard = ResetDuplicateScanGuard;
    let scan_mode = match mode.as_deref().unwrap_or("exact") {
        "similar" => DuplicateScanMode::Similar,
        _ => DuplicateScanMode::Exact,
    };
    let min_sim_pct = min_similarity_pct.unwrap_or(97).clamp(80, 99);
    let mode_label = match scan_mode {
        DuplicateScanMode::Exact => "exact",
        DuplicateScanMode::Similar => "similar",
    };

    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app_clone.emit(
            "duplicate-scan-progress",
            DuplicateScanProgressPayload {
                mode: mode_label.to_string(),
                stage: "loading".to_string(),
                stage_label: "Loading index".to_string(),
                processed: 0,
                total: 0,
                percentage: 0.0,
                current_file: String::new(),
            },
        );

        let active_model_id = if scan_mode == DuplicateScanMode::Similar {
            Some(active_model_id_and_path(&state_owned.user_dir).0)
        } else {
            None
        };
        let bundle = match state_owned.acquire_read_conn() {
            Ok(read_conn) => load_duplicate_candidates_for_model(
                &read_conn,
                scan_mode,
                library_id,
                active_model_id.as_deref(),
            )?,
            Err(_) => {
                let conn = state_owned.lock_db();
                load_duplicate_candidates_for_model(
                    &conn,
                    scan_mode,
                    library_id,
                    active_model_id.as_deref(),
                )?
            }
        };

        let emitter_app = app_clone.clone();
        let emit_progress = Arc::new(move |payload: DuplicateScanProgressPayload| {
            let _ = emitter_app.emit("duplicate-scan-progress", payload);
        });

        let (result, cache_writes) = compute_duplicates_with_progress(
            bundle,
            scan_mode,
            min_sim_pct,
            Some(emit_progress),
        );

        if !cache_writes.is_empty() {
            let _ = app_clone.emit(
                "duplicate-scan-progress",
                DuplicateScanProgressPayload {
                    mode: mode_label.to_string(),
                    stage: "caching".to_string(),
                    stage_label: "Saving hash cache".to_string(),
                    processed: result.scanned_samples,
                    total: result.scanned_samples,
                    percentage: 99.0,
                    current_file: String::new(),
                },
            );
            let mut conn = state_owned.lock_db();
            let _ = persist_sample_hash_cache(&mut conn, &cache_writes);
        }

        let _ = app_clone.emit(
            "duplicate-scan-progress",
            DuplicateScanProgressPayload {
                mode: mode_label.to_string(),
                stage: "done".to_string(),
                stage_label: "Completed".to_string(),
                processed: result.scanned_samples,
                total: result.scanned_samples,
                percentage: 100.0,
                current_file: String::new(),
            },
        );

        Ok(result)
    })
    .await
    .map_err(|e| format!("Duplicate scan task join error: {}", e))?
}
