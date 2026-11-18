use super::{
    display_leaf, has_ntfs_ads_colon, is_forbidden_os_or_root_normalized, is_safe_library_dir,
    is_unc_or_network_path, normalize_clean_path, reject_if_symlink, strip_verbatim_prefix,
};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// Collects valid `customSliceExportPath` directories across all profiles (or active profile).
pub fn collect_profile_slice_dirs(conn: &Connection, active_only: bool) -> Vec<PathBuf> {
    let sql = if active_only {
        "SELECT settings_json FROM profiles WHERE is_active = 1"
    } else {
        "SELECT settings_json FROM profiles"
    };
    let mut dirs = Vec::new();
    if let Ok(mut stmt) = conn.prepare(sql) {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for json_str in rows.flatten() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    if let Some(raw) = val.get("customSliceExportPath").and_then(|v| v.as_str()) {
                        let trimmed = raw.trim();
                        if !trimmed.is_empty() {
                            if let Ok(safe_dir) = is_safe_library_dir(trimmed) {
                                if !dirs.contains(&safe_dir) {
                                    dirs.push(safe_dir);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    dirs
}

/// Validates that `raw_path` is non-UNC, non-symlink, canonicalizes cleanly, and resides inside
/// registered `libraries.path`, `user_dir/cache/{slices,playback_fallback}`, `user_dir/trash`,
/// or an active profile's valid `customSliceExportPath` / `licenseGroups` folder.
pub fn validate_path_in_libraries_or_cache(
    conn: &Connection,
    user_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if is_unc_or_network_path(trimmed) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(trimmed) {
        return Err("Alternate data streams are not allowed".to_string());
    }

    let raw_target = Path::new(trimmed);
    let sym = fs::symlink_metadata(raw_target).map_err(|_| {
        format!(
            "Path does not exist or cannot be accessed: {}",
            display_leaf(raw_target)
        )
    })?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }

    let target_canon = fs::canonicalize(raw_target).map_err(|_| {
        format!(
            "Path does not exist or cannot be accessed: {}",
            display_leaf(raw_target)
        )
    })?;
    if is_unc_or_network_path(&target_canon.to_string_lossy()) {
        return Err("Symbolic links pointing to network/UNC paths are not allowed".to_string());
    }

    // 1. Built-in audio cache, permanent slice store & quarantine trash directories
    for cache_sub in [
        user_dir.join("slices"),
        user_dir.join("cache").join("slices"),
        user_dir.join("cache").join("playback_fallback"),
        user_dir.join("trash"),
    ] {
        if !is_unc_or_network_path(&cache_sub.to_string_lossy()) {
            if let Ok(base_canon) = cache_sub.canonicalize() {
                if target_canon.starts_with(&base_canon) {
                    return Ok(strip_verbatim_prefix(&target_canon));
                }
            }
        }
    }

    // 2. Registered libraries visible to the active profile
    let active_profile_id = crate::db::get_active_profile_id(conn);
    if let Ok(mut stmt) = conn.prepare(
        "SELECT l.path
         FROM libraries l
         WHERE l.is_global = 1
            OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)",
    ) {
        if let Ok(rows) = stmt.query_map([active_profile_id], |r| r.get::<_, String>(0)) {
            for lib_path in rows.flatten() {
                let lp = lib_path.trim();
                if lp.is_empty()
                    || is_unc_or_network_path(lp)
                    || is_forbidden_os_or_root_normalized(&normalize_clean_path(lp))
                    || reject_if_symlink(Path::new(lp)).is_err()
                {
                    continue;
                }
                if let Ok(base_canon) = fs::canonicalize(lp) {
                    if !is_unc_or_network_path(&base_canon.to_string_lossy())
                        && target_canon.starts_with(&base_canon)
                    {
                        return Ok(strip_verbatim_prefix(&target_canon));
                    }
                }
            }
        }
    }

    // 3. Active profile's valid customSliceExportPath
    for slice_dir in collect_profile_slice_dirs(conn, true) {
        if let Ok(base_canon) = slice_dir.canonicalize() {
            if target_canon.starts_with(&base_canon) {
                return Ok(strip_verbatim_prefix(&target_canon));
            }
        }
    }

    // 4. Active profile's configured licenseGroups folders (for Show in Explorer on Licenses tab)
    if let Ok(mut stmt) = conn.prepare("SELECT settings_json FROM profiles WHERE is_active = 1") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for json_str in rows.flatten() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    if let Some(groups) = val.get("licenseGroups").and_then(|v| v.as_array()) {
                        for grp in groups {
                            if let Some(folders) = grp.get("folders").and_then(|v| v.as_array()) {
                                for f_val in folders {
                                    if let Some(f_str) = f_val.as_str() {
                                        if let Ok(safe_dir) = is_safe_library_dir(f_str.trim()) {
                                            if let Ok(base_canon) = safe_dir.canonicalize() {
                                                if target_canon.starts_with(&base_canon) {
                                                    return Ok(strip_verbatim_prefix(&target_canon));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Access denied: path is outside registered libraries and audio cache".to_string())
}

/// Validates that `raw_path` is an existing regular file inside registered libraries or audio cache.
pub fn validate_audio_path_in_scope(
    conn: &Connection,
    user_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    let resolved = validate_path_in_libraries_or_cache(conn, user_dir, raw_path)?;
    if !resolved.is_file() {
        return Err(format!(
            "Source audio file not found: {}",
            display_leaf(&resolved)
        ));
    }
    Ok(resolved)
}

/// Redacts local `user_dir` and personal OS profile path segments before returning errors to UI.
pub fn sanitize_err(user_dir: &Path, msg: &str) -> String {
    let mut out = msg.to_string();
    let stripped = strip_verbatim_prefix(user_dir);
    for candidate in [
        user_dir.to_string_lossy().into_owned(),
        stripped.to_string_lossy().into_owned(),
    ] {
        if !candidate.is_empty() {
            let slash = candidate.replace('\\', "/");
            let back = candidate.replace('/', "\\");
            out = out.replace(&candidate, "<audify_user>");
            out = out.replace(&slash, "<audify_user>");
            out = out.replace(&back, "<audify_user>");
        }
    }
    let mut search_from = 0usize;
    for _ in 0..16 {
        if search_from >= out.len() {
            break;
        }
        let lower_tail = out[search_from..].to_ascii_lowercase();
        let best = ["\\users\\", "/users/", "/home/"]
            .iter()
            .filter_map(|marker| lower_tail.find(marker).map(|rel| (search_from + rel, *marker)))
            .min_by_key(|(pos, _)| *pos);
        let Some((pos, marker)) = best else {
            break;
        };
        let rest_start = pos + marker.len();
        let rest = &out[rest_start..];
        if rest.starts_with("<user>") {
            search_from = rest_start + "<user>".len();
            continue;
        }
        let user_len = rest
            .find(['\\', '/', ' ', '"', '\'', ':'])
            .unwrap_or(rest.len());
        out = format!(
            "{}{}<user>{}",
            &out[..pos],
            marker,
            &out[rest_start + user_len..]
        );
        search_from = rest_start + "<user>".len();
    }
    out
}
