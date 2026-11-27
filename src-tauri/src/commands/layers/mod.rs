mod history;
mod render;
mod trash;

pub use history::*;
pub use render::*;
pub use trash::*;

use super::audio_ops::resolve_layer_preview_cache_dir;
pub(super) use super::slices::{ensure_slice_not_in_readonly_library, format_os_display_path};
pub(super) use super::with_read_conn;
use crate::audio::LanePeaksPreview;
use crate::audio_engine::AudioSyncPayload;
use crate::security::{
    collect_profile_layer_dirs, has_ntfs_ads_colon, has_parent_dir_traversal,
    is_unc_or_network_path, reject_symlink_ancestors, strip_verbatim_prefix,
    validate_safe_audio_stem,
};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub(super) const MAX_RECIPE_JSON_BYTES: usize = 256 * 1024;
static LAYER_TMP_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
pub struct LayerHistoryRecord {
    pub id: i64,
    pub layer_path: String,
    pub layer_name: String,
    pub recipe_json: String,
    pub lane_count: i64,
    pub clip_count: i64,
    pub duration_ms: i64,
    pub is_favorite: bool,
    pub peaks_json: String,
    pub sample_rate: i64,
    pub channels: i64,
    pub bit_depth: i64,
    pub created_at: String,
    pub updated_at: String,
    pub file_exists: bool,
    pub is_trashed: bool,
    pub trash_file_path: Option<String>,
    pub trashed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerPreviewResult {
    pub duration_sec: f64,
    pub master_peaks: Vec<f32>,
    pub lane_peaks: Vec<LanePeaksPreview>,
    pub peak_db: f32,
    pub clipped: bool,
    pub audio_sync: AudioSyncPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedLayerDragResult {
    pub wav_path: String,
    pub saved_record: Option<LayerHistoryRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayerTrashSummary {
    pub affected_count: usize,
    pub affected_ids: Vec<i64>,
    pub trashed_count: usize,
    pub total_bytes: u64,
}

pub(super) fn dedup_positive_ids(ids: &[i64]) -> Vec<i64> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(ids.len());
    for &id in ids {
        if id > 0 && seen.insert(id) {
            out.push(id);
        }
    }
    out
}

pub(super) fn sanitize_layer_stem(raw_name: &str) -> Result<String, String> {
    let trimmed = raw_name.trim();
    let without_ext = if trimmed.len() > 4 && trimmed.to_ascii_lowercase().ends_with(".wav") {
        trimmed[..trimmed.len() - 4].trim_end()
    } else {
        trimmed
    };
    validate_safe_audio_stem(without_ext)
}

pub(super) fn resolve_layer_trash_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("cache").join("layer_trash")
}

pub(super) fn pick_collision_safe_layer_wav_path(export_dir: &Path, stem: &str) -> PathBuf {
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
        LAYER_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

pub(super) fn collect_authorized_layer_dirs(conn: &Connection, user_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![user_dir.join("layers"), resolve_layer_preview_cache_dir(user_dir)];
    for d in collect_profile_layer_dirs(conn, false) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

#[derive(Debug, Clone)]
pub(super) enum LayerScopeError {
    NotFound(String),
    Denied(String),
}

impl LayerScopeError {
    pub(super) fn into_message(self) -> String {
        match self {
            Self::NotFound(m) | Self::Denied(m) => m,
        }
    }
}

pub(super) fn is_restore_parent_authorized(target_parent: &Path, auth_dirs: &[PathBuf]) -> bool {
    let raw = target_parent.to_string_lossy();
    if raw.trim().is_empty()
        || is_unc_or_network_path(&raw)
        || has_ntfs_ads_colon(&raw)
        || has_parent_dir_traversal(&raw)
        || reject_symlink_ancestors(target_parent).is_err()
    {
        return false;
    }
    let auth_canons: Vec<PathBuf> = auth_dirs
        .iter()
        .filter_map(|d| d.canonicalize().ok())
        .collect();
    if auth_canons.is_empty() {
        return false;
    }
    let mut cursor = Some(target_parent);
    while let Some(dir) = cursor {
        match fs::symlink_metadata(dir) {
            Ok(sym) => {
                if sym.file_type().is_symlink() || !sym.file_type().is_dir() {
                    return false;
                }
                let Ok(canon) = dir.canonicalize() else {
                    return false;
                };
                return auth_canons.iter().any(|base| canon.starts_with(base));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                cursor = dir.parent();
            }
            Err(_) => return false,
        }
    }
    false
}

pub(crate) fn cleanup_quarantined_layer_file_if_present(
    user_dir: &Path,
    raw_trash_path: Option<&str>,
) {
    let Some(raw) = raw_trash_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    if is_unc_or_network_path(raw) || has_ntfs_ads_colon(raw) || has_parent_dir_traversal(raw) {
        return;
    }
    let pb = PathBuf::from(raw);
    if reject_symlink_ancestors(&pb).is_err() {
        return;
    }
    let Ok(trash_canon) = resolve_layer_trash_dir(user_dir).canonicalize() else {
        return;
    };
    if let Ok(sym) = fs::symlink_metadata(&pb) {
        if !sym.file_type().is_symlink() && sym.file_type().is_file() {
            if let Ok(canon) = pb.canonicalize() {
                if canon.starts_with(&trash_canon) {
                    let _ = fs::remove_file(&pb);
                }
            }
        }
    }
}

fn missing_layer_has_online_authorized_ancestor(
    conn: &Connection,
    user_dir: &Path,
    pb: &Path,
) -> bool {
    let Some(parent) = pb.parent() else {
        return false;
    };
    let auth_dirs = collect_authorized_layer_dirs(conn, user_dir);
    is_restore_parent_authorized(parent, &auth_dirs)
}

pub(super) fn ensure_existing_layer_in_scope_detailed(
    conn: &Connection,
    user_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, LayerScopeError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err(LayerScopeError::Denied(
            "Invalid or unsafe layer file path".to_string(),
        ));
    }
    let pb = PathBuf::from(trimmed);
    reject_symlink_ancestors(&pb).map_err(LayerScopeError::Denied)?;
    let sym = match fs::symlink_metadata(&pb) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if missing_layer_has_online_authorized_ancestor(conn, user_dir, &pb) {
                return Err(LayerScopeError::NotFound(
                    "Layer file not found on disk".to_string(),
                ));
            }
            return Err(LayerScopeError::Denied(
                "Layer folder is offline or outside authorized export directories".to_string(),
            ));
        }
        Err(_) => {
            return Err(LayerScopeError::Denied(
                "Layer file cannot be accessed".to_string(),
            ));
        }
    };
    if sym.file_type().is_symlink() || !sym.file_type().is_file() {
        return Err(LayerScopeError::Denied(
            "Symbolic links and non-files cannot be modified as layers".to_string(),
        ));
    }
    let target_canon = pb
        .canonicalize()
        .map_err(|_| LayerScopeError::Denied("Failed resolving layer path".to_string()))?;
    if is_unc_or_network_path(&target_canon.to_string_lossy()) {
        return Err(LayerScopeError::Denied(
            "Network/UNC layer paths are not allowed".to_string(),
        ));
    }

    for dir in collect_authorized_layer_dirs(conn, user_dir) {
        if let Ok(base_canon) = dir.canonicalize() {
            if target_canon.starts_with(&base_canon) {
                return Ok(strip_verbatim_prefix(&target_canon));
            }
        }
    }
    Err(LayerScopeError::Denied(
        "Refusing access to layer file outside authorized layer export folders".to_string(),
    ))
}

pub(super) fn ensure_existing_layer_in_scope(
    conn: &Connection,
    user_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    ensure_existing_layer_in_scope_detailed(conn, user_dir, raw_path)
        .map_err(LayerScopeError::into_message)
}
