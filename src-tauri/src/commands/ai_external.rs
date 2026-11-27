use crate::ai_tagger::model_manager::active_model_id_and_path;
use crate::ai_tagger::similarity::{
    compute_similarity_duration_bounds, compute_top_k_similar, load_allowed_profile_library_ids,
    SimilarityQuery,
};
use crate::ai_tagger::types::{SimilarityMatch, AI_EMBEDDING_DIM};
use crate::ai_tagger::{infer_single_sample_path, AiTaggerState, ExternalSimilarityProbe};
use crate::audio::{fallback_lofty_props, open_audio_decoder};
use crate::db::{get_active_profile_id, AppState};
use crate::scanner::SUPPORTED_EXTENSIONS;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, has_parent_dir_traversal, is_dos_device_name,
    is_unc_or_network_path, normalize_clean_path, reject_symlink_ancestors, sanitize_err,
    strip_verbatim_prefix,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DEFAULT_MIN_SIMILARITY_SCORE: f32 = 0.70;
const DEFAULT_TOP_K: usize = 100;
const MAX_EXTERNAL_SIMILARITY_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EXTERNAL_SIMILARITY_UPLOAD_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXTERNAL_PROBE_LRU: usize = 8;
const STALE_PROBE_CLEANUP_AGE: Duration = Duration::from_secs(600);

static EXTERNAL_PROBE_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalSimilaritySearchResult {
    pub anchor_sample_id: i64,
    pub probe_id: String,
    pub file_name: String,
    pub anchor_duration_ms: i64,
    pub matches: Vec<SimilarityMatch>,
    pub elapsed_ms: f64,
    pub scanned_vectors: usize,
}

struct TempProbeFile(PathBuf);

impl Drop for TempProbeFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(crate) fn is_supported_audio_extension(name_or_path: &str) -> bool {
    Path::new(name_or_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

pub(crate) fn percent_decode_utf8(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}

pub(crate) fn validate_external_audio_path(raw: &str) -> Result<(PathBuf, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("External audio path is empty".to_string());
    }
    if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    if has_parent_dir_traversal(trimmed) {
        return Err("Parent directory traversal is not allowed".to_string());
    }

    let clean = normalize_clean_path(trimmed);
    let path = PathBuf::from(&clean);
    if !path.is_absolute() {
        return Err("External audio path must be an absolute local file path".to_string());
    }
    let leaf = display_leaf(&path).to_string();
    if leaf.is_empty() || !is_supported_audio_extension(&leaf) {
        return Err("Unsupported audio file format for similarity search".to_string());
    }
    let stem = Path::new(&leaf)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if is_dos_device_name(stem) || is_dos_device_name(&leaf) {
        return Err("Invalid reserved system file name".to_string());
    }

    reject_symlink_ancestors(&path)?;
    let meta = fs::symlink_metadata(&path)
        .map_err(|_| "Dropped audio file is missing or inaccessible".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("Symbolic links, junctions, and folders are not allowed".to_string());
    }
    if meta.len() == 0 {
        return Err("Dropped audio file is empty".to_string());
    }
    if meta.len() > MAX_EXTERNAL_SIMILARITY_FILE_BYTES {
        return Err("Dropped audio file exceeds 256 MB similarity probe limit".to_string());
    }

    // Re-check canonicalized path to block mapped network drives or volume mount points to UNC.
    let canon = fs::canonicalize(&path)
        .map_err(|_| "Dropped audio file is missing or inaccessible".to_string())?;
    let canon_raw = canon.to_string_lossy();
    if is_unc_or_network_path(&canon_raw) {
        return Err("Network and mapped UNC audio paths are not allowed".to_string());
    }
    let safe_path = strip_verbatim_prefix(&canon);

    Ok((safe_path, leaf))
}

pub(crate) fn validate_external_audio_bytes(
    raw_name: &str,
    bytes: &[u8],
) -> Result<(String, String), String> {
    if bytes.is_empty() {
        return Err("Dropped audio payload is empty".to_string());
    }
    if bytes.len() > MAX_EXTERNAL_SIMILARITY_UPLOAD_BYTES {
        return Err("Dropped audio file exceeds 64 MB in-memory probe limit".to_string());
    }
    let leaf = display_leaf(Path::new(raw_name.trim())).to_string();
    if leaf.is_empty() || has_ntfs_ads_colon(&leaf) || !is_supported_audio_extension(&leaf) {
        return Err("Unsupported audio file format for similarity search".to_string());
    }
    let stem = Path::new(&leaf)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if is_dos_device_name(stem) || is_dos_device_name(&leaf) {
        return Err("Invalid reserved system file name".to_string());
    }
    let ext = Path::new(&leaf)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .ok_or_else(|| "Unsupported audio file extension".to_string())?;
    Ok((leaf, ext))
}

/// Removes all orphaned temp files inside `cache/sim_probe` at startup (regardless of audio ext).
pub fn clear_stale_sim_probe_dir(user_dir: &Path) -> usize {
    let dir = user_dir.join("cache").join("sim_probe");
    if is_unc_or_network_path(&dir.to_string_lossy()) {
        return 0;
    }
    let Ok(entries) = fs::read_dir(&dir) else {
        return 0;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if !meta.file_type().is_symlink() && meta.is_file() && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

fn cleanup_stale_probe_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let stale = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age > STALE_PROBE_CLEANUP_AGE);
        if stale {
            let _ = fs::remove_file(&path);
        }
    }
}

fn write_temp_probe_file(
    user_dir: &Path,
    ext: &str,
    bytes: &[u8],
) -> Result<TempProbeFile, String> {
    let dir = user_dir.join("cache").join("sim_probe");
    fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Failed creating similarity probe dir: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;
    cleanup_stale_probe_files(&dir);

    let seq = EXTERNAL_PROBE_SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let probe_path = dir.join(format!("probe_{}_{}_{}.{}", std::process::id(), ts, seq, ext));
    let mut file = fs::File::create(&probe_path).map_err(|e| {
        format!(
            "Failed staging similarity probe file: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;
    file.write_all(bytes).map_err(|e| {
        format!(
            "Failed writing similarity probe audio: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;
    file.flush().map_err(|e| {
        format!(
            "Failed flushing similarity probe audio: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;
    Ok(TempProbeFile(probe_path))
}

fn probe_audio_duration_ms(path: &Path) -> i64 {
    if let Ok(opened) = open_audio_decoder(path) {
        if opened.sample_rate > 0 {
            if let Some(frames) = opened.n_frames {
                if frames > 0 {
                    return ((frames as f64 * 1000.0) / (opened.sample_rate as f64)).round() as i64;
                }
            }
        }
    }
    fallback_lofty_props(path).0.max(0)
}

#[allow(clippy::too_many_arguments)]
fn execute_external_similarity_search(
    app: &AppHandle,
    probe_id: Option<String>,
    file_path: Option<String>,
    file_name: Option<String>,
    bytes: Option<Vec<u8>>,
    min_score: Option<f32>,
    top_k: Option<usize>,
    scope_folder_path: Option<String>,
    match_similar_duration: Option<bool>,
) -> Result<ExternalSimilaritySearchResult, String> {
    let state = app.state::<AppState>();
    let ai_state = app.state::<AiTaggerState>();
    let (active_model_id, _, _, _) = active_model_id_and_path(&state.user_dir);

    let (search_pid, allowed_libs) = {
        let conn = state
            .acquire_read_conn()
            .map_err(|e| sanitize_err(&state.user_dir, &e))?;
        let pid = get_active_profile_id(&conn);
        let allowed = load_allowed_profile_library_ids(&conn, pid)?;

        let mut cache = ai_state
            .vector_cache
            .lock()
            .map_err(|_| "AI similarity cache lock poisoned".to_string())?;
        if cache.hydrated
            && (cache.profile_id != pid
                || cache.entries.iter().any(|e| !allowed.contains(&e.library_id)))
        {
            cache.clear();
        }
        cache.ensure_hydrated_for_profile(&conn, &active_model_id, pid)?;
        (pid, allowed)
    };
    ai_state.touch_activity(Some(&state.db));

    // Fast path: look up probe_id in bounded 8-entry LRU (immune to concurrent drop races)
    let cached_probe: Option<(String, String, i64, String, [f32; AI_EMBEDDING_DIM])> =
        probe_id.as_deref().and_then(|wanted_id| {
            let mut probes = ai_state.external_probes.lock().ok()?;
            let pos = probes
                .iter()
                .position(|p| p.probe_id == wanted_id && p.model_id == active_model_id)?;
            let hit = probes.remove(pos)?;
            let out = (
                hit.probe_id.clone(),
                hit.file_name.clone(),
                hit.duration_ms,
                hit.model_id.clone(),
                hit.embedding,
            );
            probes.push_back(hit);
            Some(out)
        });

    let (resolved_probe_id, resolved_name, anchor_duration_ms, effective_model_id, anchor_vec) =
        if let Some(hit) = cached_probe {
            hit
        } else {
            let mut _temp_guard: Option<TempProbeFile> = None;
            let (probe_path, resolved_leaf) = if let Some(ref raw_path) = file_path {
                validate_external_audio_path(raw_path)
                    .map_err(|e| sanitize_err(&state.user_dir, &e))?
            } else if let Some(ref raw_bytes) = bytes {
                let supplied_name = file_name.as_deref().unwrap_or("dropped_audio.wav");
                let (leaf, ext) = validate_external_audio_bytes(supplied_name, raw_bytes)?;
                let temp = write_temp_probe_file(&state.user_dir, &ext, raw_bytes)
                    .map_err(|e| sanitize_err(&state.user_dir, &e))?;
                let path = temp.0.clone();
                _temp_guard = Some(temp);
                (path, leaf)
            } else {
                return Err(
                    "Reference audio probe expired — drop the audio file on the waveform again"
                        .to_string(),
                );
            };

            let (model, cfg) = ai_state
                .ensure_loaded_model(&state.user_dir)
                .map_err(|e| sanitize_err(&state.user_dir, &e))?;
            let output = infer_single_sample_path(&model, &probe_path)
                .map_err(|e| sanitize_err(&state.user_dir, &e))?;
            let dur_ms = probe_audio_duration_ms(&probe_path);

            let next_id = format!(
                "ext_{}_{}",
                std::process::id(),
                EXTERNAL_PROBE_SEQ.fetch_add(1, Ordering::Relaxed)
            );
            if let Ok(mut probes) = ai_state.external_probes.lock() {
                while probes.len() >= MAX_EXTERNAL_PROBE_LRU {
                    probes.pop_front();
                }
                probes.push_back(ExternalSimilarityProbe {
                    probe_id: next_id.clone(),
                    file_name: resolved_leaf.clone(),
                    duration_ms: dur_ms,
                    model_id: cfg.model_id.clone(),
                    embedding: output.embedding,
                });
            }
            (next_id, resolved_leaf, dur_ms, cfg.model_id, output.embedding)
        };

    let duration_bounds_ms = if match_similar_duration.unwrap_or(false) {
        compute_similarity_duration_bounds(anchor_duration_ms)
    } else {
        None
    };

    let mut cache = ai_state
        .vector_cache
        .lock()
        .map_err(|_| "AI similarity cache lock poisoned".to_string())?;
    if !cache.hydrated || cache.model_id != effective_model_id || cache.profile_id != search_pid {
        let conn = state
            .acquire_read_conn()
            .map_err(|e| sanitize_err(&state.user_dir, &e))?;
        cache.ensure_hydrated_for_profile(&conn, &effective_model_id, search_pid)?;
    }

    let safe_min_score = min_score
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(0.0, 0.99))
        .unwrap_or(DEFAULT_MIN_SIMILARITY_SCORE);

    let search = compute_top_k_similar(
        &cache.entries,
        &SimilarityQuery {
            anchor_sample_id: -1,
            anchor_vec: &anchor_vec,
            allowed_libraries: Some(&allowed_libs),
            folder_prefix: scope_folder_path.as_deref(),
            duration_bounds_ms,
            min_score: safe_min_score,
            top_k: top_k.unwrap_or(DEFAULT_TOP_K),
        },
    );

    Ok(ExternalSimilaritySearchResult {
        anchor_sample_id: -1,
        probe_id: resolved_probe_id,
        file_name: resolved_name,
        anchor_duration_ms,
        matches: search.matches,
        elapsed_ms: search.elapsed_ms,
        scanned_vectors: search.scanned_vectors,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn find_similar_samples_by_external_audio(
    app: AppHandle,
    probe_id: Option<String>,
    file_path: Option<String>,
    file_name: Option<String>,
    bytes: Option<Vec<u8>>,
    min_score: Option<f32>,
    top_k: Option<usize>,
    scope_folder_path: Option<String>,
    match_similar_duration: Option<bool>,
) -> Result<ExternalSimilaritySearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_external_similarity_search(
            &app,
            probe_id,
            file_path,
            file_name,
            bytes,
            min_score,
            top_k,
            scope_folder_path,
            match_similar_duration,
        )
    })
    .await
    .map_err(|e| format!("External similarity search worker failed: {}", e))?
}

/// Zero-JSON raw binary IPC entry point for external OS audio drops (WebView2 `Uint8Array` body).
/// Validates size before cloning into the blocking worker to prevent 650–900 MB JSON spikes.
#[tauri::command]
pub async fn find_similar_samples_by_external_audio_raw(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<ExternalSimilaritySearchResult, String> {
    let raw_slice = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        _ => return Err("Expected raw binary audio payload".to_string()),
    };
    if raw_slice.is_empty() {
        return Err("Dropped audio payload is empty".to_string());
    }
    if raw_slice.len() > MAX_EXTERNAL_SIMILARITY_UPLOAD_BYTES {
        return Err("Dropped audio file exceeds 64 MB in-memory probe limit".to_string());
    }

    let headers = request.headers();
    let file_name = headers
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode_utf8)
        .unwrap_or_else(|| "dropped_audio.wav".to_string());
    let min_score = headers
        .get("x-min-score")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<f32>().ok());
    let top_k = headers
        .get("x-top-k")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok());
    let match_similar_duration = headers
        .get("x-match-duration")
        .and_then(|v| v.to_str().ok())
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"));

    // Validate filename/extension before allocating & copying up to 64 MB
    validate_external_audio_bytes(&file_name, raw_slice)?;
    let owned_bytes = raw_slice.to_vec();

    tauri::async_runtime::spawn_blocking(move || {
        execute_external_similarity_search(
            &app,
            None,
            None,
            Some(file_name),
            Some(owned_bytes),
            min_score,
            top_k,
            None,
            match_similar_duration,
        )
    })
    .await
    .map_err(|e| format!("External similarity search worker failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::write_wav_i16;

    #[test]
    fn validate_external_audio_path_rejects_unsafe_relative_and_non_audio() {
        assert!(validate_external_audio_path("").is_err());
        assert!(validate_external_audio_path("relative_kick.wav").is_err());
        assert!(validate_external_audio_path(r"\\192.168.1.50\share\kick.wav").is_err());
        assert!(validate_external_audio_path("C:/Sounds/kick.wav:secret").is_err());
        assert!(validate_external_audio_path("C:/Sounds/../kick.wav").is_err());
        assert!(validate_external_audio_path("C:/Sounds/payload.exe").is_err());
        assert!(validate_external_audio_path("C:/Sounds/CON.wav").is_err());
    }

    #[test]
    fn validate_external_audio_path_accepts_valid_local_wav() {
        let dir = std::env::temp_dir().join(format!("audify_ext_sim_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let wav_path = dir.join("probe_kick.wav");
        let pcm: Vec<i16> = (0..4410).map(|i| ((i % 100) * 150) as i16).collect();
        write_wav_i16(&wav_path, 44100, 1, &pcm).unwrap();

        let (resolved, leaf) = validate_external_audio_path(&wav_path.to_string_lossy()).unwrap();
        assert_eq!(leaf, "probe_kick.wav");
        assert!(resolved.is_file());
        assert!(probe_audio_duration_ms(&resolved) >= 95);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_external_audio_bytes_enforces_extension_and_bounds() {
        assert!(validate_external_audio_bytes("kick.wav", &[]).is_err());
        assert!(validate_external_audio_bytes("readme.txt", b"hello").is_err());
        assert!(validate_external_audio_bytes("NUL.wav", b"RIFF").is_err());
        assert!(validate_external_audio_bytes("kick.wav:ads", b"RIFF").is_err());

        let (leaf, ext) = validate_external_audio_bytes(r"C:\Temp\Snare_01.FLAC", b"fLaC").unwrap();
        assert_eq!(leaf, "Snare_01.FLAC");
        assert_eq!(ext, "flac");
        assert_eq!(
            percent_decode_utf8("R%C3%BCzgar%2001.wav"),
            "Rüzgar 01.wav"
        );
    }
}
