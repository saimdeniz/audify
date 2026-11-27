use super::history::{query_layer_record_by_id, upsert_layer_history_row};
use super::{
    ensure_existing_layer_in_scope, ensure_slice_not_in_readonly_library, format_os_display_path,
    pick_collision_safe_layer_wav_path, sanitize_layer_stem, with_read_conn, LayerHistoryRecord,
    LayerPreviewResult, PreparedLayerDragResult, MAX_RECIPE_JSON_BYTES,
};
use crate::audio::{
    export_rendered_layer_wav, fnv1a_hex8, render_layer_mix, validate_and_normalize_recipe,
    LayerRecipe,
};
use crate::audio_engine::{AudioEngineState, LoadMemoryPcmRequest};
use crate::commands::audio_ops::{
    resolve_active_export_loudness_mode, resolve_active_export_preset, resolve_layer_export_dir,
    resolve_layer_preview_cache_dir,
};
use crate::db::{get_active_profile_id, AppState};
use crate::security::{sanitize_err, AuthorizedAudioScope};
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

pub const LAYER_DRAFT_DISPLAY_PATH: &str = "layer://draft";

fn resolve_recipe_paths_in_scope(
    scope: &AuthorizedAudioScope,
    recipe: &LayerRecipe,
) -> Result<HashMap<String, PathBuf>, String> {
    let mut resolved = HashMap::new();
    for clip in &recipe.clips {
        let raw = clip.source_path.trim();
        if resolved.contains_key(raw) {
            continue;
        }
        let valid = scope
            .validate_existing_audio_file(raw)?
            .ok_or_else(|| "One or more source clips in this layer are missing on disk".to_string())?;
        resolved.insert(raw.to_string(), valid);
    }
    Ok(resolved)
}

fn serialize_bounded_recipe(recipe: &LayerRecipe) -> Result<String, String> {
    let json = serde_json::to_string(recipe)
        .map_err(|_| "Failed serializing layer recipe".to_string())?;
    if json.len() > MAX_RECIPE_JSON_BYTES {
        return Err("Layer recipe exceeds maximum allowed size".to_string());
    }
    Ok(json)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn preview_layer_mix(
    state: State<'_, AppState>,
    audio_engine: State<'_, AudioEngineState>,
    recipe: LayerRecipe,
    autoplay: Option<bool>,
    start_sec: Option<f64>,
    volume: Option<f32>,
    looping: Option<bool>,
    normalize_preview: Option<bool>,
) -> Result<LayerPreviewResult, String> {
    let state_owned = state.inner().clone();
    let engine_owned = audio_engine.inner().clone();
    let user_dir_err = state.user_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let normalized = validate_and_normalize_recipe(&recipe)?;
        let path_map = with_read_conn(&state_owned, |conn| {
            let scope = AuthorizedAudioScope::from_conn(conn, &state_owned.user_dir);
            resolve_recipe_paths_in_scope(&scope, &normalized)
        })
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        let rendered = render_layer_mix(&normalized, |p| {
            path_map
                .get(p.trim())
                .cloned()
                .ok_or_else(|| "Source clip path is outside authorized scope".to_string())
        })
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        let clamped_start = start_sec
            .unwrap_or(0.0)
            .clamp(0.0, rendered.duration_sec.max(0.0));
        let audio_sync = engine_owned.load_memory_pcm(LoadMemoryPcmRequest {
            display_path: LAYER_DRAFT_DISPLAY_PATH.to_string(),
            samples: rendered.samples,
            sample_rate: rendered.sample_rate,
            autoplay: autoplay.unwrap_or(false),
            start_sec: clamped_start,
            volume: volume.unwrap_or(0.85).clamp(0.0, 1.0),
            looping: looping.unwrap_or(false),
            normalize_preview: normalize_preview.unwrap_or(false),
        })?;

        Ok(LayerPreviewResult {
            duration_sec: rendered.duration_sec,
            master_peaks: rendered.master_peaks,
            lane_peaks: rendered.lane_peaks,
            peak_db: rendered.peak_db,
            clipped: rendered.clipped,
            audio_sync,
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer preview worker error: {}", e)))?
}

pub(crate) struct SaveLayerInput<'a> {
    pub recipe: &'a LayerRecipe,
    pub name: &'a str,
    pub overwrite_layer_id: Option<i64>,
    pub custom_dir: Option<&'a str>,
    pub export_preset: Option<&'a str>,
    pub export_loudness_mode: Option<&'a str>,
}

pub(crate) fn save_layer_mix_with_conn(
    conn: &Connection,
    user_dir: &Path,
    audio_engine: Option<&AudioEngineState>,
    input: &SaveLayerInput<'_>,
) -> Result<(LayerHistoryRecord, PathBuf), String> {
    let normalized = validate_and_normalize_recipe(input.recipe)?;
    if normalized.clips.is_empty() {
        return Err("Add at least one clip before saving a layer".to_string());
    }
    let clean_stem = sanitize_layer_stem(input.name)?;
    let recipe_json = serialize_bounded_recipe(&normalized)?;

    let scope = AuthorizedAudioScope::from_conn(conn, user_dir);
    let path_map = resolve_recipe_paths_in_scope(&scope, &normalized)?;
    let rendered = render_layer_mix(&normalized, |p| {
        path_map
            .get(p.trim())
            .cloned()
            .ok_or_else(|| "Source clip path is outside authorized scope".to_string())
    })?;

    let resolved_preset = resolve_active_export_preset(conn, input.export_preset);
    let resolved_loudness = resolve_active_export_loudness_mode(conn, input.export_loudness_mode);
    let profile_id = get_active_profile_id(conn);

    let (target_wav_path, export_dir, overwrite_id) =
        if let Some(existing_id) = input.overwrite_layer_id.filter(|&id| id > 0) {
            let existing = query_layer_record_by_id(conn, profile_id, existing_id)?;
            if existing.is_trashed {
                return Err("Cannot overwrite a trashed layer — restore it first".to_string());
            }
            let existing_pb =
                ensure_existing_layer_in_scope(conn, user_dir, &existing.layer_path)?;
            ensure_slice_not_in_readonly_library(conn, &existing_pb)?;
            let parent = existing_pb
                .parent()
                .ok_or_else(|| "Invalid existing layer folder".to_string())?
                .to_path_buf();
            if let Some(engine) = audio_engine {
                let _ = engine.release_file_handle(Some(&existing.layer_path));
            }
            (existing_pb, parent, Some(existing_id))
        } else {
            let dir = resolve_layer_export_dir(conn, user_dir, input.custom_dir)?;
            fs::create_dir_all(&dir)
                .map_err(|_| "Failed creating layer export directory".to_string())?;
            let wav_pb = pick_collision_safe_layer_wav_path(&dir, &clean_stem);
            (wav_pb, dir, None)
        };

    let (sample_rate, channels, bit_depth, final_peaks) = export_rendered_layer_wav(
        &rendered,
        &target_wav_path,
        resolved_preset.as_deref(),
        resolved_loudness.as_deref(),
    )?;

    let peaks_json = serde_json::to_string(&final_peaks).unwrap_or_else(|_| "[]".to_string());
    let duration_ms = (rendered.duration_sec * 1000.0).round().max(1.0) as i64;
    let rec = upsert_layer_history_row(
        conn,
        profile_id,
        overwrite_id,
        &target_wav_path,
        &recipe_json,
        normalized.lanes.len() as i64,
        normalized.clips.len() as i64,
        duration_ms,
        &peaks_json,
        sample_rate as i64,
        channels as i64,
        bit_depth as i64,
    )?;

    Ok((rec, export_dir))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_layer_mix(
    app: AppHandle,
    state: State<'_, AppState>,
    recipe: LayerRecipe,
    name: String,
    overwrite_layer_id: Option<i64>,
    custom_dir: Option<String>,
    export_preset: Option<String>,
    export_loudness_mode: Option<String>,
) -> Result<LayerHistoryRecord, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let engine_opt = app_clone.try_state::<AudioEngineState>().map(|s| s.inner().clone());
        let conn = state_owned.lock_db();
        let (rec, export_dir) = save_layer_mix_with_conn(
            &conn,
            &state_owned.user_dir,
            engine_opt.as_ref(),
            &SaveLayerInput {
                recipe: &recipe,
                name: &name,
                overwrite_layer_id,
                custom_dir: custom_dir.as_deref(),
                export_preset: export_preset.as_deref(),
                export_loudness_mode: export_loudness_mode.as_deref(),
            },
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        crate::app_cache_helpers::register_runtime_asset_dir(
            &app_clone,
            &state_owned.user_dir,
            &export_dir,
        );
        Ok(rec)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer save worker error: {}", e)))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn prepare_layer_drag_wav(
    app: AppHandle,
    state: State<'_, AppState>,
    recipe: LayerRecipe,
    suggested_name: String,
    auto_save: Option<bool>,
    custom_dir: Option<String>,
    export_preset: Option<String>,
    export_loudness_mode: Option<String>,
) -> Result<PreparedLayerDragResult, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    let should_save = auto_save.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        if should_save {
            let engine_opt = app_clone.try_state::<AudioEngineState>().map(|s| s.inner().clone());
            let conn = state_owned.lock_db();
            let (rec, export_dir) = save_layer_mix_with_conn(
                &conn,
                &state_owned.user_dir,
                engine_opt.as_ref(),
                &SaveLayerInput {
                    recipe: &recipe,
                    name: &suggested_name,
                    overwrite_layer_id: None,
                    custom_dir: custom_dir.as_deref(),
                    export_preset: export_preset.as_deref(),
                    export_loudness_mode: export_loudness_mode.as_deref(),
                },
            )
            .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
            crate::app_cache_helpers::register_runtime_asset_dir(
                &app_clone,
                &state_owned.user_dir,
                &export_dir,
            );
            return Ok(PreparedLayerDragResult {
                wav_path: rec.layer_path.clone(),
                saved_record: Some(rec),
            });
        }

        let normalized = validate_and_normalize_recipe(&recipe)?;
        if normalized.clips.is_empty() {
            return Err("Add at least one clip before dragging a layer mix".to_string());
        }
        let clean_stem = sanitize_layer_stem(&suggested_name)
            .unwrap_or_else(|_| "Layer_Mix".to_string());
        let recipe_json = serialize_bounded_recipe(&normalized)?;
        let hash8 = fnv1a_hex8(&[recipe_json.as_bytes()]);

        let (path_map, resolved_preset, resolved_loudness) =
            with_read_conn(&state_owned, |conn| {
                let scope = AuthorizedAudioScope::from_conn(conn, &state_owned.user_dir);
                let map = resolve_recipe_paths_in_scope(&scope, &normalized)?;
                let preset = resolve_active_export_preset(conn, export_preset.as_deref());
                let loudness =
                    resolve_active_export_loudness_mode(conn, export_loudness_mode.as_deref());
                Ok((map, preset, loudness))
            })
            .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        let rendered = render_layer_mix(&normalized, |p| {
            path_map
                .get(p.trim())
                .cloned()
                .ok_or_else(|| "Source clip path is outside authorized scope".to_string())
        })
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        let cache_dir = resolve_layer_preview_cache_dir(&state_owned.user_dir);
        fs::create_dir_all(&cache_dir)
            .map_err(|_| "Failed creating layer preview cache folder".to_string())?;
        let wav_pb = cache_dir.join(format!("{}_{}.wav", clean_stem, hash8));
        export_rendered_layer_wav(
            &rendered,
            &wav_pb,
            resolved_preset.as_deref(),
            resolved_loudness.as_deref(),
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        crate::app_cache_helpers::register_runtime_asset_dir(
            &app_clone,
            &state_owned.user_dir,
            &cache_dir,
        );

        Ok(PreparedLayerDragResult {
            wav_path: format_os_display_path(&wav_pb),
            saved_record: None,
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer drag prepare error: {}", e)))?
}

#[tauri::command]
pub async fn validate_layer_recipe_sources(
    state: State<'_, AppState>,
    recipe: LayerRecipe,
) -> Result<Vec<String>, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        with_read_conn(&state_owned, |conn| {
            let scope = AuthorizedAudioScope::from_conn(conn, &state_owned.user_dir);
            let mut missing_clip_ids = Vec::new();
            for clip in &recipe.clips {
                let exists = scope
                    .validate_existing_audio_file(clip.source_path.trim())
                    .ok()
                    .flatten()
                    .is_some();
                if !exists {
                    missing_clip_ids.push(clip.id.clone());
                }
            }
            Ok(missing_clip_ids)
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Layer source check error: {}", e)))?
}
