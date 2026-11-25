use super::with_read_conn;
use crate::audio_engine::output::AudioOutputDeviceInfo;
use crate::audio_engine::{AudioEngineState, AudioSyncPayload, LoadTrackRequest};
use crate::db::AppState;
use crate::security::{sanitize_err, validate_audio_path_in_scope};
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn audio_engine_load(
    state: State<'_, AppState>,
    engine: State<'_, AudioEngineState>,
    file_path: String,
    autoplay: bool,
    start_sec: Option<f64>,
    slice_start_sec: Option<f64>,
    slice_end_sec: Option<f64>,
    volume: Option<f32>,
    pitch_semitones: Option<f32>,
    looping: Option<bool>,
    normalize_preview: Option<bool>,
    skip_leading_silence: Option<bool>,
) -> Result<AudioSyncPayload, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    let display_path = file_path.clone();

    let canon_path = tauri::async_runtime::spawn_blocking(move || {
        with_read_conn(&state_owned, |conn| {
            validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Audio path check error: {}", e)))??;

    let slice_range = match (slice_start_sec, slice_end_sec) {
        (Some(s), Some(e)) if s.is_finite() && e.is_finite() && e > s => Some((s.max(0.0), e)),
        _ => None,
    };

    let req = LoadTrackRequest {
        canon_path,
        display_path,
        autoplay,
        start_sec: start_sec.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.0),
        slice_range,
        volume: volume.filter(|v| v.is_finite()).unwrap_or(0.85).clamp(0.0, 1.0),
        pitch_semitones: pitch_semitones
            .filter(|v| v.is_finite())
            .unwrap_or(0.0)
            .clamp(-24.0, 24.0),
        looping: looping.unwrap_or(false),
        normalize_preview: normalize_preview.unwrap_or(false),
        skip_leading_silence: skip_leading_silence.unwrap_or(false),
    };

    let engine_owned = engine.inner().clone();
    let user_dir_load = user_dir_err.clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine_owned
            .load_track(req)
            .map_err(|e| sanitize_err(&user_dir_load, &e))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Audio load task error: {}", e)))?
}

#[tauri::command]
pub fn audio_engine_play(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    engine.play()
}

#[tauri::command]
pub fn audio_engine_pause(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    engine.pause()
}

#[tauri::command]
pub fn audio_engine_stop(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    engine.stop()
}

#[tauri::command]
pub fn audio_engine_unload(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    engine.unload()
}

#[tauri::command]
pub fn audio_engine_seek(engine: State<'_, AudioEngineState>, sec: f64) -> Result<(), String> {
    if !sec.is_finite() || sec < 0.0 {
        return Err("Seek position must be a non-negative finite number".to_string());
    }
    engine.seek(sec)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn audio_engine_set_params(
    engine: State<'_, AudioEngineState>,
    volume: Option<f32>,
    pitch_semitones: Option<f32>,
    looping: Option<bool>,
    normalize_preview: Option<bool>,
    update_slice: Option<bool>,
    slice_start_sec: Option<f64>,
    slice_end_sec: Option<f64>,
) -> Result<(), String> {
    let slice_update = if update_slice.unwrap_or(false) {
        match (slice_start_sec, slice_end_sec) {
            (Some(s), Some(e)) if s.is_finite() && e.is_finite() && e > s => {
                Some(Some((s.max(0.0), e)))
            }
            _ => Some(None),
        }
    } else {
        None
    };

    engine.set_params(
        volume,
        pitch_semitones,
        looping,
        normalize_preview,
        slice_update,
    )
}

#[tauri::command]
pub async fn audio_engine_list_devices(
    engine: State<'_, AudioEngineState>,
) -> Result<Vec<AudioOutputDeviceInfo>, String> {
    let engine_owned = engine.inner().clone();
    Ok(tauri::async_runtime::spawn_blocking(move || engine_owned.list_devices())
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub fn audio_engine_set_device(
    engine: State<'_, AudioEngineState>,
    device_id: String,
) -> Result<(), String> {
    if device_id.len() > 512 || device_id.chars().any(|c| c.is_control()) {
        return Err("Invalid audio output device identifier".to_string());
    }
    engine.set_device(device_id)
}

#[tauri::command]
pub async fn audio_engine_release_handle(
    engine: State<'_, AudioEngineState>,
    file_path: Option<String>,
) -> Result<bool, String> {
    let engine_owned = engine.inner().clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        engine_owned.release_file_handle(file_path.as_deref())
    })
    .await
    .unwrap_or(false))
}
