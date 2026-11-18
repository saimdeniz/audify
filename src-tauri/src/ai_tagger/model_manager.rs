use super::types::{AiModelStatus, ResolvedAiModelConfig, AI_EMBEDDING_DIM};
use crate::security::{
    ensure_inside, has_ntfs_ads_colon, is_unc_or_network_path, sanitize_err,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

pub use super::model_download::download_default_ai_bundle;

pub const DEFAULT_MODEL_ID: &str = "yamnet-audioset-v1";
pub const DEFAULT_MODEL_NAME: &str = "YAMNet AudioSet ONNX";
pub const DEFAULT_MODEL_FILE: &str = "yamnet.onnx";
pub const CUSTOM_MODEL_FILE: &str = "custom.onnx";

pub(super) const DEFAULT_MODEL_URL: &str =
    "https://huggingface.co/audiomagic/yamnet-onnx/resolve/main/yamnet.onnx";
pub(super) const DEFAULT_MODEL_SHA256: &str =
    "d3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e";
pub(super) const DEFAULT_MODEL_BYTES: u64 = 16_093_355;

pub(super) const DEFAULT_ORT_WHL_URL: &str =
    "https://files.pythonhosted.org/packages/45/b2/793b4051d8dc6acb379ead9b72050f0ffa283ca49a6904add2e218b83e2e/onnxruntime-1.31.1-cp312-cp312-win_amd64.whl";
pub(super) const DEFAULT_ORT_WHL_SHA256: &str =
    "ae8a9a351efda685cc59a66226cdefaa37a126c1d66872ca23a2de9425326130";
pub(super) const DEFAULT_ORT_WHL_BYTES: u64 = 14_888_466;

pub(super) const ORT_DLL_NAME: &str = "onnxruntime.dll";
pub(super) const ORT_DLL_SHA256: &str =
    "e45f61e50d8650885452be538a00bb14a715e46a1bc3691000ce947e89ed0306";
pub(super) const ORT_SHARED_DLL_NAME: &str = "onnxruntime_providers_shared.dll";
pub(super) const ORT_SHARED_DLL_SHA256: &str =
    "02b3edadc03a2bddd90bcbd090733a2c458f4aff8be2cebb6070428e81c6d41e";

pub(super) const MAX_REMOTE_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024;
const MAX_LOCAL_ONNX_BYTES: u64 = 512 * 1024 * 1024;
pub(super) const MAX_DLL_ENTRY_BYTES: u64 = 48 * 1024 * 1024;

pub fn models_root_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("models")
}

pub fn runtime_bin_dir(user_dir: &Path) -> PathBuf {
    models_root_dir(user_dir).join("bin")
}

pub(super) fn ensure_models_dirs(user_dir: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let models = models_root_dir(user_dir);
    let bin = runtime_bin_dir(user_dir);
    let tmp = models.join(".tmp");
    fs::create_dir_all(&models).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    fs::create_dir_all(&bin).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    fs::create_dir_all(&tmp).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    Ok((models, bin, tmp))
}

pub fn sha256_file_hex(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to read file for SHA-256: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65_536];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed while hashing file: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn is_regular_non_symlink_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| !m.file_type().is_symlink() && m.is_file())
        .unwrap_or(false)
}

fn reject_symlink_chain(path: &Path) -> Result<(), String> {
    for anc in path.ancestors() {
        if anc.as_os_str().is_empty() || anc.parent().is_none() {
            break;
        }
        let meta = fs::symlink_metadata(anc)
            .map_err(|_| "Source path or parent directory cannot be read".to_string())?;
        if meta.file_type().is_symlink() {
            return Err("Symlinks and junctions are blocked for security".to_string());
        }
    }
    Ok(())
}

pub fn active_model_id_and_path(user_dir: &Path) -> (String, String, PathBuf, bool) {
    let root = models_root_dir(user_dir);
    let custom = root.join(CUSTOM_MODEL_FILE);
    if is_regular_non_symlink_file(&custom) {
        return (
            "custom-onnx".to_string(),
            "Custom Imported ONNX".to_string(),
            custom,
            true,
        );
    }
    let default_path = root.join(DEFAULT_MODEL_FILE);
    (
        DEFAULT_MODEL_ID.to_string(),
        DEFAULT_MODEL_NAME.to_string(),
        default_path,
        false,
    )
}

pub fn resolve_ready_ai_config(user_dir: &Path) -> Result<ResolvedAiModelConfig, String> {
    let (model_id, _name, model_path, _is_custom) = active_model_id_and_path(user_dir);
    let models_root = models_root_dir(user_dir);
    if !is_regular_non_symlink_file(&model_path) {
        return Err(
            "AI model is not installed. Download or import an ONNX model in Settings -> AI."
                .to_string(),
        );
    }
    let canon_model = ensure_inside(&models_root, &model_path)
        .map_err(|e| sanitize_err(user_dir, &e))?;

    let bin_root = runtime_bin_dir(user_dir);
    let dll_path = bin_root.join(ORT_DLL_NAME);
    if !is_regular_non_symlink_file(&dll_path) {
        return Err(
            "ONNX Runtime DLL is not installed. Download AI engine or import onnxruntime.dll in Settings -> AI."
                .to_string(),
        );
    }
    let canon_dll = ensure_inside(&bin_root, &dll_path)
        .map_err(|e| sanitize_err(user_dir, &e))?;
    let dll_hash = sha256_file_hex(&canon_dll).map_err(|e| sanitize_err(user_dir, &e))?;
    if !dll_hash.eq_ignore_ascii_case(ORT_DLL_SHA256) {
        return Err(
            "ONNX Runtime DLL SHA-256 verification failed. Re-download or re-import the official runtime in Settings -> AI."
                .to_string(),
        );
    }

    let shared_dll_path = bin_root.join(ORT_SHARED_DLL_NAME);
    if fs::symlink_metadata(&shared_dll_path).is_ok() {
        if !is_regular_non_symlink_file(&shared_dll_path) {
            return Err(
                "ONNX Runtime companion DLL is invalid or a symlink. Re-download the official runtime in Settings -> AI."
                    .to_string(),
            );
        }
        let canon_shared = ensure_inside(&bin_root, &shared_dll_path)
            .map_err(|e| sanitize_err(user_dir, &e))?;
        let shared_hash = sha256_file_hex(&canon_shared).map_err(|e| sanitize_err(user_dir, &e))?;
        if !shared_hash.eq_ignore_ascii_case(ORT_SHARED_DLL_SHA256) {
            return Err(
                "ONNX Runtime companion DLL SHA-256 verification failed. Re-download the official runtime in Settings -> AI."
                    .to_string(),
            );
        }
    }

    Ok(ResolvedAiModelConfig {
        model_id,
        model_path: canon_model,
        runtime_dll_path: canon_dll,
    })
}

pub fn build_ai_model_status(
    conn: &Connection,
    user_dir: &Path,
    active_profile_id: i64,
    verify_hashes: bool,
    last_avg_ms: f64,
) -> AiModelStatus {
    let (model_id, model_name, model_path, is_custom) = active_model_id_and_path(user_dir);
    let runtime_path = runtime_bin_dir(user_dir).join(ORT_DLL_NAME);

    let model_meta = fs::symlink_metadata(&model_path)
        .ok()
        .filter(|m| !m.file_type().is_symlink() && m.is_file());
    let runtime_meta = fs::symlink_metadata(&runtime_path)
        .ok()
        .filter(|m| !m.file_type().is_symlink() && m.is_file());

    let installed = model_meta.is_some();
    let runtime_installed = runtime_meta.is_some();
    let model_size_bytes = model_meta.map(|m| m.len()).unwrap_or(0);
    let runtime_size_bytes = runtime_meta.map(|m| m.len()).unwrap_or(0);

    let model_sha256_ok = if !installed {
        false
    } else if is_custom {
        model_size_bytes > 0
    } else if verify_hashes {
        sha256_file_hex(&model_path)
            .map(|h| h.eq_ignore_ascii_case(DEFAULT_MODEL_SHA256))
            .unwrap_or(false)
    } else {
        model_size_bytes == DEFAULT_MODEL_BYTES
    };

    let runtime_sha256_ok = if !runtime_installed {
        false
    } else if verify_hashes {
        sha256_file_hex(&runtime_path)
            .map(|h| h.eq_ignore_ascii_case(ORT_DLL_SHA256))
            .unwrap_or(false)
    } else {
        runtime_size_bytes > 0
    };

    let total_profile_samples: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM samples s
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            [active_profile_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let indexed_count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM sample_embeddings e
             JOIN samples s ON s.id = e.sample_id
             WHERE e.model_id = ?2
               AND COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            rusqlite::params![active_profile_id, &model_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let pending_suggestions_count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM ai_tag_suggestions a
             JOIN samples s ON s.id = a.sample_id
             WHERE a.status = 'pending'
               AND COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            [active_profile_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let embedding_bytes =
        (indexed_count.max(0) as u64).saturating_mul((AI_EMBEDDING_DIM * 4) as u64);

    AiModelStatus {
        model_id,
        model_name,
        installed,
        runtime_installed,
        ready: installed && runtime_installed && model_sha256_ok && runtime_sha256_ok,
        model_sha256_ok,
        runtime_sha256_ok,
        is_custom_model: is_custom,
        model_size_bytes,
        runtime_size_bytes,
        model_rel_path: format!(
            "user/models/{}",
            if is_custom {
                CUSTOM_MODEL_FILE
            } else {
                DEFAULT_MODEL_FILE
            }
        ),
        runtime_rel_path: format!("user/models/bin/{}", ORT_DLL_NAME),
        indexed_count: indexed_count.max(0) as usize,
        total_profile_samples: total_profile_samples.max(0) as usize,
        pending_suggestions_count: pending_suggestions_count.max(0) as usize,
        embedding_bytes,
        embedding_dim: AI_EMBEDDING_DIM,
        last_avg_ms_per_clip: last_avg_ms,
    }
}

fn validate_local_import_source(
    src: &str,
    expected_ext: &str,
    max_bytes: u64,
) -> Result<PathBuf, String> {
    let trimmed = src.trim();
    if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Invalid or unsupported source file path".to_string());
    }
    let path = PathBuf::from(trimmed);
    reject_symlink_chain(&path)?;
    let sym = fs::symlink_metadata(&path)
        .map_err(|_| "Source file does not exist or cannot be read".to_string())?;
    if sym.file_type().is_symlink() || !sym.is_file() {
        return Err("Symlinks and non-file sources are blocked for security".to_string());
    }
    if sym.len() == 0 || sym.len() > max_bytes {
        return Err("Source file is empty or exceeds size limit".to_string());
    }
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(expected_ext))
        .unwrap_or(false);
    if !ext_ok {
        return Err(format!("Expected a .{} file", expected_ext));
    }
    let canon = fs::canonicalize(&path)
        .map_err(|_| "Source file path cannot be resolved safely".to_string())?;
    if is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Network/UNC source paths are not allowed".to_string());
    }
    Ok(canon)
}

pub fn import_local_ai_file(user_dir: &Path, source_path: &str, kind: &str) -> Result<(), String> {
    let (models_dir, bin_dir, tmp_dir) = ensure_models_dirs(user_dir)?;
    match kind {
        "onnx" => {
            let src = validate_local_import_source(source_path, "onnx", MAX_LOCAL_ONNX_BYTES)?;
            let hash = sha256_file_hex(&src).map_err(|e| sanitize_err(user_dir, &e))?;
            let target_name = if hash.eq_ignore_ascii_case(DEFAULT_MODEL_SHA256) {
                let custom = models_dir.join(CUSTOM_MODEL_FILE);
                if fs::symlink_metadata(&custom).is_ok() {
                    let _ = fs::remove_file(&custom);
                }
                DEFAULT_MODEL_FILE
            } else {
                CUSTOM_MODEL_FILE
            };
            let tmp_out = tmp_dir.join(format!("{}.import.tmp", target_name));
            let final_out = models_dir.join(target_name);
            let _ = fs::remove_file(&tmp_out);
            fs::copy(&src, &tmp_out).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
            if fs::symlink_metadata(&final_out).is_ok() {
                let _ = fs::remove_file(&final_out);
            }
            fs::rename(&tmp_out, &final_out)
                .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
            Ok(())
        }
        "runtime_dll" => {
            let src = validate_local_import_source(source_path, "dll", MAX_DLL_ENTRY_BYTES)?;
            let hash = sha256_file_hex(&src).map_err(|e| sanitize_err(user_dir, &e))?;
            if !hash.eq_ignore_ascii_case(ORT_DLL_SHA256) {
                return Err(
                    "Imported onnxruntime.dll failed SHA-256 verification against the pinned official release"
                        .to_string(),
                );
            }
            let tmp_out = tmp_dir.join("onnxruntime.dll.import.tmp");
            let final_out = bin_dir.join(ORT_DLL_NAME);
            let _ = fs::remove_file(&tmp_out);
            fs::copy(&src, &tmp_out).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
            if fs::symlink_metadata(&final_out).is_ok() {
                let _ = fs::remove_file(&final_out);
            }
            fs::rename(&tmp_out, &final_out)
                .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
            Ok(())
        }
        _ => Err("Unsupported AI asset import type".to_string()),
    }
}

pub fn remove_ai_assets(user_dir: &Path, include_runtime: bool) -> Result<(), String> {
    let models = models_root_dir(user_dir);
    for fname in [DEFAULT_MODEL_FILE, CUSTOM_MODEL_FILE] {
        let p = models.join(fname);
        if fs::symlink_metadata(&p).is_ok() {
            fs::remove_file(&p).map_err(|e| {
                sanitize_err(user_dir, &format!("Failed to remove model '{}': {}", fname, e))
            })?;
        }
    }
    if include_runtime {
        let bin = runtime_bin_dir(user_dir);
        let mut locked_dlls: Vec<&str> = Vec::new();
        for fname in [ORT_DLL_NAME, ORT_SHARED_DLL_NAME] {
            let p = bin.join(fname);
            if fs::symlink_metadata(&p).is_ok() {
                if let Err(e) = fs::remove_file(&p) {
                    if cfg!(windows) {
                        locked_dlls.push(fname);
                    } else {
                        return Err(sanitize_err(
                            user_dir,
                            &format!("Failed to remove runtime '{}': {}", fname, e),
                        ));
                    }
                }
            }
        }
        if !locked_dlls.is_empty() {
            return Err(format!(
                "ONNX model removed, but {} remained locked in memory from earlier AI analysis. Restart Audify and remove the engine again.",
                locked_dlls.join(", ")
            ));
        }
    }
    Ok(())
}
