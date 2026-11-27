use super::super::audio_ops::resolve_slice_cache_dir;
use super::{
    format_os_display_path, pick_collision_safe_wav_path, sanitize_custom_slice_stem,
    PromotedSliceResult, SliceExportInput, PROMOTE_TMP_COUNTER,
};
use crate::audio::{
    build_default_slice_file_name_with_params, export_wav_slice_to_path_with_params,
    SliceExportParams,
};
use crate::security::{
    collect_profile_slice_dirs, display_leaf, has_ntfs_ads_colon, is_unc_or_network_path,
    reject_symlink_ancestors, sanitize_err, strip_verbatim_prefix,
};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

fn is_valid_wav_inside_dir(raw_path: &str, dir: &Path) -> Option<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return None;
    }
    let pb = PathBuf::from(trimmed);
    reject_symlink_ancestors(&pb).ok()?;
    let sym = fs::symlink_metadata(&pb).ok()?;
    if sym.file_type().is_symlink() || !sym.file_type().is_file() || sym.len() <= 44 {
        return None;
    }
    let is_wav = pb
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);
    if !is_wav {
        return None;
    }
    let base_canon = dir.canonicalize().ok()?;
    let target_canon = pb.canonicalize().ok()?;
    if is_unc_or_network_path(&target_canon.to_string_lossy())
        || !target_canon.starts_with(&base_canon)
    {
        return None;
    }
    Some(strip_verbatim_prefix(&target_canon))
}

pub(in crate::commands) fn collect_authorized_slice_dirs(conn: &Connection, user_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![user_dir.join("slices"), resolve_slice_cache_dir(user_dir)];
    for d in collect_profile_slice_dirs(conn, false) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

#[derive(Debug, Clone)]
pub(in crate::commands) enum SliceScopeError {
    NotFound(String),
    Denied(String),
}

impl SliceScopeError {
    pub(in crate::commands) fn into_message(self) -> String {
        match self {
            Self::NotFound(m) | Self::Denied(m) => m,
        }
    }
}

fn missing_slice_has_online_authorized_ancestor(
    conn: &Connection,
    user_dir: &Path,
    pb: &Path,
) -> bool {
    let auth_canons: Vec<PathBuf> = collect_authorized_slice_dirs(conn, user_dir)
        .into_iter()
        .filter_map(|d| d.canonicalize().ok())
        .collect();
    if auth_canons.is_empty() {
        return false;
    }
    let mut cursor = pb.parent();
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

pub(in crate::commands) fn ensure_existing_slice_in_scope_detailed(
    conn: &Connection,
    user_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, SliceScopeError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(SliceScopeError::Denied(
            "Slice path cannot be empty".to_string(),
        ));
    }
    if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err(SliceScopeError::Denied(
            "Network/UNC paths and alternate data streams are not allowed".to_string(),
        ));
    }
    let pb = PathBuf::from(trimmed);
    reject_symlink_ancestors(&pb).map_err(SliceScopeError::Denied)?;
    let sym = match fs::symlink_metadata(&pb) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if missing_slice_has_online_authorized_ancestor(conn, user_dir, &pb) {
                return Err(SliceScopeError::NotFound(format!(
                    "Slice file no longer exists on disk: {}",
                    display_leaf(&pb)
                )));
            }
            return Err(SliceScopeError::Denied(format!(
                "Slice directory is offline or outside registered slice export directories: {}",
                display_leaf(&pb)
            )));
        }
        Err(_) => {
            return Err(SliceScopeError::Denied(format!(
                "Slice file cannot be accessed: {}",
                display_leaf(&pb)
            )));
        }
    };
    if sym.file_type().is_symlink() || !sym.file_type().is_file() {
        return Err(SliceScopeError::Denied(
            "Symbolic links and non-file slice paths are not allowed".to_string(),
        ));
    }
    let is_wav = pb
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);
    if !is_wav {
        return Err(SliceScopeError::Denied(
            "Only WAV slice files are supported".to_string(),
        ));
    }

    let target_canon = pb.canonicalize().map_err(|_| {
        SliceScopeError::Denied(format!("Slice file cannot be resolved: {}", display_leaf(&pb)))
    })?;
    if is_unc_or_network_path(&target_canon.to_string_lossy()) {
        return Err(SliceScopeError::Denied(
            "Symbolic links pointing to network/UNC paths are not allowed".to_string(),
        ));
    }

    for dir in collect_authorized_slice_dirs(conn, user_dir) {
        if let Ok(base_canon) = dir.canonicalize() {
            if target_canon.starts_with(&base_canon) {
                return Ok(strip_verbatim_prefix(&target_canon));
            }
        }
    }

    Err(SliceScopeError::Denied(
        "Access denied: slice path is outside registered slice export directories".to_string(),
    ))
}

pub(in crate::commands) fn ensure_existing_slice_in_scope(
    conn: &Connection,
    user_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    ensure_existing_slice_in_scope_detailed(conn, user_dir, raw_path)
        .map_err(SliceScopeError::into_message)
}

fn copy_cached_wav_atomically(cached: &Path, dest: &Path) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| "Invalid export directory".to_string())?;
    let stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("slice");
    let tmp_name = format!(
        ".{}.tmp.{}.{}.wav",
        stem,
        std::process::id(),
        PROMOTE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let tmp_path = parent.join(tmp_name);
    fs::copy(cached, &tmp_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        sanitize_err(parent, &format!("Failed copying cached slice: {}", e))
    })?;
    if let Err(e) = fs::rename(&tmp_path, dest) {
        let _ = fs::remove_file(&tmp_path);
        return Err(sanitize_err(
            parent,
            &format!("Failed finalizing exported slice: {}", e),
        ));
    }
    Ok(())
}

pub(crate) fn promote_or_export_slice_sync(
    user_dir: &Path,
    input: &SliceExportInput,
) -> Result<PromotedSliceResult, String> {
    if is_unc_or_network_path(&input.export_dir.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    fs::create_dir_all(&input.export_dir).map_err(|e| {
        format!(
            "Failed to create slices directory: {}",
            sanitize_err(user_dir, &e.to_string())
        )
    })?;

    let has_custom = input
        .custom_name
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let out_path = if has_custom {
        let raw_custom = input.custom_name.as_deref().unwrap_or("");
        let clean_stem = sanitize_custom_slice_stem(raw_custom)?;
        pick_collision_safe_wav_path(&input.export_dir, &clean_stem)
    } else {
        let export_params = SliceExportParams {
            start_sec: input.start_sec,
            end_sec: input.end_sec,
            pitch_semitones: input.pitch_semitones,
            apply_micro_fade: input.apply_micro_fade,
            export_preset: input.export_preset.as_deref(),
            loudness_mode: input.export_loudness_mode.as_deref(),
        };
        let default_name =
            build_default_slice_file_name_with_params(&input.source_path, &export_params);
        input.export_dir.join(default_name)
    };

    let slice_name = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("slice.wav")
        .to_string();

    if !has_custom
        && out_path.exists()
        && fs::metadata(&out_path).map(|m| m.len() > 44).unwrap_or(false)
    {
        return Ok(PromotedSliceResult {
            slice_path: format_os_display_path(&out_path),
            slice_name,
            newly_created: false,
        });
    }

    let cache_dir = resolve_slice_cache_dir(user_dir);
    let cached_valid = input
        .cached_slice_path
        .as_deref()
        .and_then(|raw| is_valid_wav_inside_dir(raw, &cache_dir));

    if let Some(cached_pb) = cached_valid {
        copy_cached_wav_atomically(&cached_pb, &out_path)?;
        return Ok(PromotedSliceResult {
            slice_path: format_os_display_path(&out_path),
            slice_name,
            newly_created: true,
        });
    }

    let written = export_wav_slice_to_path_with_params(
        &input.source_path,
        &out_path,
        &SliceExportParams {
            start_sec: input.start_sec,
            end_sec: input.end_sec,
            pitch_semitones: input.pitch_semitones,
            apply_micro_fade: input.apply_micro_fade,
            export_preset: input.export_preset.as_deref(),
            loudness_mode: input.export_loudness_mode.as_deref(),
        },
    )?;

    Ok(PromotedSliceResult {
        slice_path: format_os_display_path(Path::new(&written)),
        slice_name,
        newly_created: true,
    })
}
