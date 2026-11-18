use crate::commands::FullSnapshotManifest;
use crate::security::{
    ensure_inside, is_dos_device_name, is_safe_existing_bg_image, is_unc_or_network_path,
    normalize_clean_path, MAX_CUSTOM_BG_BYTES,
};
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub(super) const ALLOWED_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
pub(super) const MAX_SNAPSHOT_SLICES_COUNT: usize = 5000;
pub(super) const MAX_SNAPSHOT_SLICE_FILE_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const MAX_SNAPSHOT_TOTAL_SLICES_BYTES: u64 = 512 * 1024 * 1024;

fn is_safe_relative_parts(rel: &str, max_parts: usize, allowed_exts: &[&str]) -> Option<PathBuf> {
    if rel.is_empty()
        || rel.contains("..")
        || rel.contains('\\')
        || rel.contains(':')
        || rel.starts_with('/')
    {
        return None;
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.is_empty()
        || parts.len() > max_parts
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || p.ends_with(' ')
                || p.ends_with('.')
                || is_dos_device_name(p)
        })
    {
        return None;
    }
    let leaf = parts.last().copied()?;
    let ext_ok = Path::new(leaf)
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| allowed_exts.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !ext_ok {
        return None;
    }
    let mut out = PathBuf::new();
    for part in parts {
        out.push(part);
    }
    Some(out)
}

pub(super) fn is_safe_snapshot_image_entry(name: &str) -> Option<PathBuf> {
    let rel = name.strip_prefix("images/")?;
    is_safe_relative_parts(rel, 5, ALLOWED_IMAGE_EXTS)
}

pub(super) fn is_safe_snapshot_slice_entry(name: &str) -> Option<PathBuf> {
    let rel = name.strip_prefix("slices/")?;
    is_safe_relative_parts(rel, 3, &["wav"])
}

fn collect_snapshot_slices_recursive(
    slices_root: &Path,
    dir: &Path,
    depth: usize,
    total_bytes: &mut u64,
    out: &mut Vec<(String, PathBuf)>,
) {
    if depth > 2 || out.len() >= MAX_SNAPSHOT_SLICES_COUNT {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_SNAPSHOT_SLICES_COUNT {
            break;
        }
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let Ok(safe) = ensure_inside(slices_root, &path) else {
            continue;
        };
        if meta.is_dir() {
            collect_snapshot_slices_recursive(slices_root, &safe, depth + 1, total_bytes, out);
        } else if meta.is_file() && meta.len() <= MAX_SNAPSHOT_SLICE_FILE_BYTES {
            let ext_ok = safe
                .extension()
                .and_then(|s| s.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("wav"))
                .unwrap_or(false);
            if !ext_ok {
                continue;
            }
            let next_total = total_bytes.saturating_add(meta.len());
            if next_total > MAX_SNAPSHOT_TOTAL_SLICES_BYTES {
                continue;
            }
            if let Ok(rel) = safe.strip_prefix(slices_root) {
                let rel_norm = rel.to_string_lossy().replace('\\', "/");
                if !rel_norm.is_empty() {
                    *total_bytes = next_total;
                    out.push((format!("slices/{}", rel_norm), safe));
                }
            }
        }
    }
}

pub(super) fn collect_staged_snapshot_slices(
    user_dir: &Path,
    manifest: &mut FullSnapshotManifest,
) -> Vec<(String, PathBuf)> {
    let mut slice_entries = Vec::new();
    let slices_root = user_dir.join("slices");
    if slices_root.is_dir() {
        let canon_root = ensure_inside(&slices_root, &slices_root).unwrap_or(slices_root);
        let mut total_bytes = 0u64;
        collect_snapshot_slices_recursive(
            &canon_root,
            &canon_root,
            0,
            &mut total_bytes,
            &mut slice_entries,
        );
    }
    manifest.slice_count = slice_entries.len();
    slice_entries
}

pub(super) fn write_extracted_nested_file(
    base_dir: &Path,
    rel_path: &Path,
    bytes: &[u8],
) -> bool {
    let mut cur_dir = base_dir.to_path_buf();
    let comps: Vec<_> = rel_path.components().collect();
    if comps.is_empty() {
        return false;
    }
    for comp in &comps[..comps.len() - 1] {
        let Component::Normal(seg) = comp else {
            return false;
        };
        cur_dir.push(seg);
        if let Ok(sym) = fs::symlink_metadata(&cur_dir) {
            if sym.file_type().is_symlink() || !sym.is_dir() {
                return false;
            }
        } else if fs::create_dir(&cur_dir).is_err() {
            return false;
        }
    }
    let Component::Normal(leaf) = comps[comps.len() - 1] else {
        return false;
    };
    let Ok(safe_parent) = ensure_inside(base_dir, &cur_dir) else {
        return false;
    };
    let safe_dest = safe_parent.join(leaf);
    if let Ok(existing_meta) = fs::symlink_metadata(&safe_dest) {
        if existing_meta.file_type().is_symlink() || existing_meta.is_dir() {
            return false;
        }
    }
    fs::write(&safe_dest, bytes).is_ok()
}

fn find_image_recursive(
    root: &Path,
    dir: &Path,
    depth: usize,
    rel_suffix_lower: Option<&str>,
    target_filename: &std::ffi::OsStr,
) -> Option<PathBuf> {
    if depth > 4 {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let Ok(safe) = ensure_inside(root, &path) else {
            continue;
        };
        if meta.is_file() && meta.len() <= MAX_CUSTOM_BG_BYTES {
            if let Some(rel_sfx) = rel_suffix_lower {
                if let Ok(rel) = safe.strip_prefix(root) {
                    if rel.to_string_lossy().replace('\\', "/").to_lowercase() == rel_sfx {
                        return Some(safe);
                    }
                }
            }
            if safe.file_name() == Some(target_filename) {
                return Some(safe);
            }
        } else if meta.is_dir() {
            subdirs.push(safe);
        }
    }
    for sub in subdirs {
        if let Some(found) =
            find_image_recursive(root, &sub, depth + 1, rel_suffix_lower, target_filename)
        {
            return Some(found);
        }
    }
    None
}

pub(super) fn relink_restored_custom_bg_paths(conn: &Connection, user_dir: &Path) {
    let images_dir = user_dir.join("images");
    let canon_root = ensure_inside(&images_dir, &images_dir).unwrap_or_else(|_| images_dir.clone());
    if let Ok(mut stmt) = conn.prepare("SELECT id, settings_json FROM profiles") {
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect();

        for (pid, settings_json) in rows {
            let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&settings_json) else {
                continue;
            };
            let Some(obj) = val.as_object_mut() else {
                continue;
            };
            let Some(bg_path) = obj
                .get("customBgImage")
                .and_then(|v| v.as_str())
                .map(str::to_string)
            else {
                continue;
            };
            let trimmed = bg_path.trim();
            if trimmed.is_empty() {
                continue;
            }
            if is_unc_or_network_path(trimmed) {
                obj.insert(
                    "customBgImage".to_string(),
                    serde_json::Value::String(String::new()),
                );
                if let Ok(updated_json) = serde_json::to_string(&val) {
                    let _ = conn.execute(
                        "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
                        params![updated_json, pid],
                    );
                }
                continue;
            }
            if is_safe_existing_bg_image(trimmed) {
                continue;
            }
            let norm_lower = normalize_clean_path(trimmed).to_lowercase();
            let rel_suffix_owned = norm_lower
                .split("/images/")
                .nth(1)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let resolved = Path::new(trimmed).file_name().and_then(|fname| {
                find_image_recursive(
                    &canon_root,
                    &canon_root,
                    0,
                    rel_suffix_owned.as_deref(),
                    fname,
                )
            });
            let next_bg = resolved
                .map(|p| normalize_clean_path(&p.to_string_lossy()))
                .unwrap_or_default();
            obj.insert(
                "customBgImage".to_string(),
                serde_json::Value::String(next_bg),
            );
            if let Ok(updated_json) = serde_json::to_string(&val) {
                let _ = conn.execute(
                    "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
                    params![updated_json, pid],
                );
            }
        }
    }
}

pub(super) fn relink_restored_slice_paths(conn: &Connection, user_dir: &Path) {
    let slices_dir = user_dir.join("slices");
    if !slices_dir.is_dir() {
        return;
    }
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, slice_path, slice_name FROM sample_slices WHERE COALESCE(is_trashed, 0) = 0",
    ) else {
        return;
    };
    let rows: Vec<(i64, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    for (id, slice_path, slice_name) in rows {
        let p = Path::new(slice_path.trim());
        if p.is_file() {
            continue;
        }
        let norm_lower = normalize_clean_path(&slice_path).to_lowercase();
        let mut candidate_rel = norm_lower
            .split("/slices/")
            .nth(1)
            .map(str::to_string)
            .filter(|s| !s.is_empty());
        if candidate_rel.is_none() && !slice_name.trim().is_empty() {
            candidate_rel = Some(slice_name.trim().to_string());
        }
        if let Some(rel_str) = candidate_rel {
            if let Some(rel_pb) = is_safe_relative_parts(&rel_str, 3, &["wav"]) {
                let local = slices_dir.join(&rel_pb);
                if local.is_file() {
                    if let Ok(safe) = ensure_inside(&slices_dir, &local) {
                        let next_str = if cfg!(windows) {
                            safe.to_string_lossy().replace('/', "\\")
                        } else {
                            safe.to_string_lossy().to_string()
                        };
                        let _ = conn.execute(
                            "UPDATE sample_slices SET slice_path = ?1 WHERE id = ?2",
                            params![next_str, id],
                        );
                    }
                }
            }
        }
    }
}
