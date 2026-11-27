mod export_ops;
pub mod history;
pub mod ops;
pub mod trash;
pub mod trash_manage;

pub(crate) use export_ops::promote_or_export_slice_sync;
pub(super) use export_ops::{
    collect_authorized_slice_dirs, ensure_existing_slice_in_scope,
    ensure_existing_slice_in_scope_detailed, SliceScopeError,
};
pub use history::*;
pub use ops::*;
pub use trash::*;
pub use trash_manage::*;

use super::audio_ops::{
    resolve_active_export_loudness_mode, resolve_active_export_preset, resolve_slice_export_dir,
};
pub(super) use super::with_read_conn;
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    sanitize_err, strip_verbatim_prefix, validate_audio_path_in_scope, validate_safe_audio_stem,
};
use rusqlite::Connection;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, State};

pub(super) static PROMOTE_TMP_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
pub struct SliceHistoryRecord {
    pub id: i64,
    pub slice_path: String,
    pub slice_name: String,
    pub source_sample_id: Option<i64>,
    pub source_file_path: String,
    pub source_file_name: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub pitch_semitones: f64,
    pub micro_fade: bool,
    pub duration_ms: i64,
    pub is_favorite: bool,
    pub peaks_json: String,
    pub sample_rate: i64,
    pub channels: i64,
    pub bit_depth: i64,
    pub created_at: String,
    pub file_exists: bool,
    pub is_trashed: bool,
    pub trash_file_path: Option<String>,
    pub trashed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SliceTrashSummary {
    pub affected_count: usize,
    pub affected_ids: Vec<i64>,
    pub trashed_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromotedSliceResult {
    pub slice_path: String,
    pub slice_name: String,
    pub newly_created: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct SliceExportInput {
    pub source_path: PathBuf,
    pub export_dir: PathBuf,
    pub start_sec: f64,
    pub end_sec: f64,
    pub pitch_semitones: Option<f32>,
    pub apply_micro_fade: Option<bool>,
    pub export_preset: Option<String>,
    pub export_loudness_mode: Option<String>,
    pub cached_slice_path: Option<String>,
    pub custom_name: Option<String>,
}

pub(super) fn sanitize_custom_slice_stem(raw_name: &str) -> Result<String, String> {
    let trimmed = raw_name.trim();
    let without_ext = if trimmed.len() > 4 && trimmed.to_ascii_lowercase().ends_with(".wav") {
        trimmed[..trimmed.len() - 4].trim_end()
    } else {
        trimmed
    };
    validate_safe_audio_stem(without_ext)
}

pub(super) fn resolve_slice_trash_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("cache").join("slice_trash")
}

pub(super) fn pick_collision_safe_wav_path(export_dir: &Path, stem: &str) -> PathBuf {
    let primary = export_dir.join(format!("{}.wav", stem));
    if !primary.exists() {
        return primary;
    }
    for idx in 1..10000 {
        let candidate = export_dir.join(format!("{}_{:02}.wav", stem, idx));
        if !candidate.exists() {
            return candidate;
        }
    }
    export_dir.join(format!(
        "{}_{}.wav",
        stem,
        PROMOTE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

pub(crate) fn format_os_display_path(p: &Path) -> String {
    let clean = strip_verbatim_prefix(p);
    let s = clean.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        s.replace('/', "\\")
    }
    #[cfg(not(target_os = "windows"))]
    {
        s
    }
}

pub(crate) fn ensure_slice_not_in_readonly_library(
    conn: &Connection,
    slice_pb: &Path,
) -> Result<(), String> {
    let target_norm = crate::security::normalize_clean_path(&slice_pb.to_string_lossy());
    let target_lower = target_norm.to_lowercase();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT path, name FROM libraries WHERE COALESCE(is_read_only, 0) = 1",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            for (lib_path, lib_name) in rows.flatten() {
                let lib_norm = crate::security::normalize_clean_path(lib_path.trim());
                if target_lower == lib_norm.to_lowercase()
                    || crate::commands::strip_lib_prefix(&target_norm, &lib_norm).is_some()
                {
                    return Err(format!(
                        "Library '{}' is locked as a Protected Read-Only Vault. Unlock it before modifying or trashing files inside it.",
                        lib_name
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(super) fn compute_exported_duration_ms(
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: f64,
) -> i64 {
    let base_sec = (end_sec - start_sec).max(0.01);
    let factor = if pitch_semitones.is_finite() && pitch_semitones.abs() >= 0.01 {
        2.0f64.powf(pitch_semitones.clamp(-24.0, 24.0) / 12.0)
    } else {
        1.0
    };
    ((base_sec / factor) * 1000.0).round().max(10.0) as i64
}

pub(crate) struct SliceHistoryUpsert<'a> {
    pub profile_id: i64,
    pub slice_path: &'a Path,
    pub source_sample_id: Option<i64>,
    pub source_file_path: &'a Path,
    pub start_sec: f64,
    pub end_sec: f64,
    pub pitch_semitones: f64,
    pub micro_fade: bool,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn promote_slice_to_export(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    start_sec: f64,
    end_sec: f64,
    custom_dir: Option<String>,
    cached_slice_path: Option<String>,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    custom_name: Option<String>,
    export_preset: Option<String>,
    export_loudness_mode: Option<String>,
) -> Result<PromotedSliceResult, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source_path, export_dir, resolved_preset, resolved_loudness) =
            with_read_conn(&state_owned, |conn| {
                let src = validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                    .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
                ensure_source_not_a_slice(conn, &src)?;
                let dir =
                    resolve_slice_export_dir(conn, &state_owned.user_dir, custom_dir.as_deref())?;
                let preset = resolve_active_export_preset(conn, export_preset.as_deref());
                let loudness =
                    resolve_active_export_loudness_mode(conn, export_loudness_mode.as_deref());
                Ok((src, dir, preset, loudness))
            })?;
        fs::create_dir_all(&export_dir).map_err(|e| {
            format!(
                "Failed to create slice export directory: {}",
                sanitize_err(&state_owned.user_dir, &e.to_string())
            )
        })?;
        crate::app_cache_helpers::register_runtime_asset_dir(
            &app_clone,
            &state_owned.user_dir,
            &export_dir,
        );

        promote_or_export_slice_sync(
            &state_owned.user_dir,
            &SliceExportInput {
                source_path,
                export_dir,
                start_sec,
                end_sec,
                pitch_semitones,
                apply_micro_fade,
                export_preset: resolved_preset,
                export_loudness_mode: resolved_loudness,
                cached_slice_path,
                custom_name,
            },
        )
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Slice promote error: {}", e)))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn record_slice_export(
    state: State<'_, AppState>,
    slice_path: String,
    source_sample_id: Option<i64>,
    source_file_path: String,
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
) -> Result<SliceHistoryRecord, String> {
    if !start_sec.is_finite() || !end_sec.is_finite() || start_sec < 0.0 || end_sec <= start_sec {
        return Err("Invalid slice time bounds".to_string());
    }
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (resolved_slice, resolved_src, profile_id) = with_read_conn(&state_owned, |conn| {
            let slice_pb = ensure_existing_slice_in_scope(conn, &state_owned.user_dir, &slice_path)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
            let src_pb =
                validate_audio_path_in_scope(conn, &state_owned.user_dir, &source_file_path)
                    .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
            ensure_source_not_a_slice(conn, &src_pb)
                .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
            let pid = get_active_profile_id(conn);
            Ok((slice_pb, src_pb, pid))
        })?;

        let pitch_f64 = pitch_semitones.unwrap_or(0.0) as f64;
        let fallback_dur = compute_exported_duration_ms(start_sec, end_sec, pitch_f64);
        let decoded_meta = history::decode_slice_audio_meta(&resolved_slice, fallback_dur);

        let conn = state_owned.lock_db();
        history::upsert_slice_history_with_meta(
            &conn,
            Some(&state_owned.user_dir),
            &SliceHistoryUpsert {
                profile_id,
                slice_path: &resolved_slice,
                source_sample_id,
                source_file_path: &resolved_src,
                start_sec,
                end_sec,
                pitch_semitones: pitch_f64,
                micro_fade: apply_micro_fade.unwrap_or(false),
            },
            Some(decoded_meta),
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Record slice task error: {}", e)))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_slice_to_export(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    source_sample_id: Option<i64>,
    start_sec: f64,
    end_sec: f64,
    custom_dir: Option<String>,
    cached_slice_path: Option<String>,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    custom_name: Option<String>,
    export_preset: Option<String>,
    export_loudness_mode: Option<String>,
) -> Result<SliceHistoryRecord, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source_path, export_dir, profile_id, resolved_preset, resolved_loudness) =
            with_read_conn(&state_owned, |conn| {
                let src = validate_audio_path_in_scope(conn, &state_owned.user_dir, &file_path)
                    .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
                ensure_source_not_a_slice(conn, &src)?;
                let dir =
                    resolve_slice_export_dir(conn, &state_owned.user_dir, custom_dir.as_deref())?;
                let pid = get_active_profile_id(conn);
                let preset = resolve_active_export_preset(conn, export_preset.as_deref());
                let loudness =
                    resolve_active_export_loudness_mode(conn, export_loudness_mode.as_deref());
                Ok((src, dir, pid, preset, loudness))
            })?;
        fs::create_dir_all(&export_dir).map_err(|e| {
            format!(
                "Failed to create slice export directory: {}",
                sanitize_err(&state_owned.user_dir, &e.to_string())
            )
        })?;
        crate::app_cache_helpers::register_runtime_asset_dir(
            &app_clone,
            &state_owned.user_dir,
            &export_dir,
        );

        let promoted = promote_or_export_slice_sync(
            &state_owned.user_dir,
            &SliceExportInput {
                source_path: source_path.clone(),
                export_dir,
                start_sec,
                end_sec,
                pitch_semitones,
                apply_micro_fade,
                export_preset: resolved_preset,
                export_loudness_mode: resolved_loudness,
                cached_slice_path,
                custom_name,
            },
        )?;

        let pitch_f64 = pitch_semitones.unwrap_or(0.0) as f64;
        let fallback_dur = compute_exported_duration_ms(start_sec, end_sec, pitch_f64);
        let decoded_meta =
            history::decode_slice_audio_meta(Path::new(&promoted.slice_path), fallback_dur);

        let conn = state_owned.lock_db();
        history::upsert_slice_history_with_meta(
            &conn,
            Some(&state_owned.user_dir),
            &SliceHistoryUpsert {
                profile_id,
                slice_path: Path::new(&promoted.slice_path),
                source_sample_id,
                source_file_path: &source_path,
                start_sec,
                end_sec,
                pitch_semitones: pitch_f64,
                micro_fade: apply_micro_fade.unwrap_or(false),
            },
            Some(decoded_meta),
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Save slice worker error: {}", e)))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::write_wav_i16;
    use crate::commands::resolve_slice_cache_dir;
    use crate::db::init_db;

    fn temp_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "audify_slices_test_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn custom_slice_stem_rejects_traversal_and_strips_wav_extension() {
        assert_eq!(
            sanitize_custom_slice_stem("  Wolf Bark.WAV  ").unwrap(),
            "Wolf Bark"
        );
        assert!(sanitize_custom_slice_stem("../evil").is_err());
        assert!(sanitize_custom_slice_stem("bad:stream").is_err());
        assert!(sanitize_custom_slice_stem("CON").is_err());
    }

    #[test]
    fn promote_copies_cached_wav_with_collision_numbering_and_upsert_preserves_source() {
        let base = temp_dir("promote");
        let user_dir = base.join("user");
        let export_dir = base.join("exports");
        let lib_dir = base.join("lib");
        fs::create_dir_all(resolve_slice_cache_dir(&user_dir)).unwrap();
        fs::create_dir_all(&export_dir).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let conn = init_db(&user_dir).unwrap();
        let pid = get_active_profile_id(&conn);

        let src_wav = lib_dir.join("wolf_01.wav");
        let cached_wav = resolve_slice_cache_dir(&user_dir).join("cached_preview.wav");
        write_wav_i16(&src_wav, 48000, 1, &vec![1000i16; 4800]).unwrap();
        write_wav_i16(&cached_wav, 48000, 1, &vec![500i16; 1200]).unwrap();

        let first = promote_or_export_slice_sync(
            &user_dir,
            &SliceExportInput {
                source_path: src_wav.clone(),
                export_dir: export_dir.clone(),
                start_sec: 1.2,
                end_sec: 2.85,
                pitch_semitones: Some(2.0),
                apply_micro_fade: Some(true),
                export_preset: None,
                export_loudness_mode: None,
                cached_slice_path: Some(cached_wav.to_string_lossy().to_string()),
                custom_name: Some("Wolf Bark".to_string()),
            },
        )
        .unwrap();
        assert_eq!(first.slice_name, "Wolf Bark.wav");
        assert!(first.newly_created);

        let second = promote_or_export_slice_sync(
            &user_dir,
            &SliceExportInput {
                source_path: src_wav.clone(),
                export_dir: export_dir.clone(),
                start_sec: 1.2,
                end_sec: 2.85,
                pitch_semitones: None,
                apply_micro_fade: None,
                export_preset: None,
                export_loudness_mode: None,
                cached_slice_path: Some(cached_wav.to_string_lossy().to_string()),
                custom_name: Some("Wolf Bark".to_string()),
            },
        )
        .unwrap();
        assert_eq!(second.slice_name, "Wolf Bark_01.wav");

        let rec = upsert_slice_history_with_conn(
            &conn,
            &SliceHistoryUpsert {
                profile_id: pid,
                slice_path: Path::new(&first.slice_path),
                source_sample_id: Some(42),
                source_file_path: &src_wav,
                start_sec: 1.2,
                end_sec: 2.85,
                pitch_semitones: 2.0,
                micro_fade: true,
            },
        )
        .unwrap();
        assert_eq!(rec.slice_name, "Wolf Bark.wav");
        assert_eq!(rec.source_sample_id, Some(42));
        assert!(rec.file_exists);

        fs::remove_file(&second.slice_path).unwrap();
        let rec2 = upsert_slice_history_with_conn(
            &conn,
            &SliceHistoryUpsert {
                profile_id: pid,
                slice_path: Path::new(&second.slice_path),
                source_sample_id: Some(42),
                source_file_path: &src_wav,
                start_sec: 0.5,
                end_sec: 1.0,
                pitch_semitones: 0.0,
                micro_fade: false,
            },
        )
        .unwrap();
        assert!(!rec2.file_exists);

        let _ = fs::remove_dir_all(&base);
    }
}
