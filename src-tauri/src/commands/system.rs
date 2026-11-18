use crate::audio::fnv1a_hex8;
use crate::db::AppState;
use crate::security::{
    detect_image_magic, ensure_inside, has_ntfs_ads_colon, is_dos_device_name,
    is_unc_or_network_path, open_directory_in_shell, read_bounded_bytes,
    reveal_file_in_explorer, sanitize_err, validate_path_in_libraries_or_cache,
    MAX_CUSTOM_BG_BYTES,
};
use std::fs;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn show_in_folder(state: State<'_, AppState>, file_path: String) -> Result<(), String> {
    let resolved = {
        let conn = state.lock_db();
        validate_path_in_libraries_or_cache(&conn, &state.user_dir, &file_path)?
    };

    if resolved.is_file() {
        if reveal_file_in_explorer(&resolved).is_err() {
            if let Some(parent) = resolved.parent() {
                open_directory_in_shell(parent)?;
            } else {
                return Err("Failed to reveal file in Explorer".to_string());
            }
        }
        Ok(())
    } else {
        open_directory_in_shell(&resolved)
    }
}

#[tauri::command]
pub fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    let _ = fs::create_dir_all(&state.user_dir);
    open_directory_in_shell(&state.user_dir)
}

const MAX_BG_SCAN_DEPTH: usize = 4;
const MAX_BG_SCAN_ITEMS: usize = 1000;
const ALLOWED_BG_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

fn collect_backgrounds_recursive(
    images_root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<String>,
) {
    if depth > MAX_BG_SCAN_DEPTH || out.len() >= MAX_BG_SCAN_ITEMS {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_BG_SCAN_ITEMS {
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
        let Ok(safe_path) = ensure_inside(images_root, &path) else {
            continue;
        };
        if meta.is_dir() {
            collect_backgrounds_recursive(images_root, &safe_path, depth + 1, out);
        } else if meta.is_file() {
            let is_valid = safe_path
                .extension()
                .and_then(|s| s.to_str())
                .map(|ext| ALLOWED_BG_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            if is_valid {
                out.push(safe_path.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

pub(crate) fn get_custom_backgrounds_from_dir(user_dir: &Path) -> Result<Vec<String>, String> {
    let images_dir = user_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    let mut out = Vec::new();
    collect_backgrounds_recursive(&images_dir, &images_dir, 0, &mut out);
    out.sort();
    Ok(out)
}

pub(crate) fn import_custom_background_to_dir(
    user_dir: &Path,
    source_path: &str,
) -> Result<String, String> {
    let trimmed = source_path.trim();
    if trimmed.is_empty() {
        return Err("Source image file path cannot be empty".to_string());
    }
    if is_unc_or_network_path(trimmed) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(trimmed) {
        return Err("Invalid file path: NTFS alternate data streams (':') are not allowed".to_string());
    }

    let src = Path::new(trimmed);
    let raw_file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid image file name".to_string())?;

    if raw_file_name.contains(':')
        || raw_file_name.contains('/')
        || raw_file_name.contains('\\')
        || raw_file_name.contains("..")
        || raw_file_name.chars().any(|c| c.is_control())
    {
        return Err("Invalid characters in image file name".to_string());
    }
    if is_dos_device_name(raw_file_name) {
        return Err("Reserved system device names are not allowed".to_string());
    }

    let ext_lower = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if !["jpg", "jpeg", "png", "webp", "gif", "bmp"].contains(&ext_lower.as_str()) {
        return Err(
            "Only image files (jpg, png, webp, gif, bmp) can be used as background".to_string(),
        );
    }

    let bytes = read_bounded_bytes(src, MAX_CUSTOM_BG_BYTES)
        .map_err(|e| sanitize_err(user_dir, &e))?;
    let _magic_kind = detect_image_magic(&bytes).ok_or_else(|| {
        "File is not a valid image (PNG/JPEG/WEBP/GIF/BMP magic header mismatch)".to_string()
    })?;

    let images_dir = user_dir.join("images");
    let target_dir = if ext_lower == "gif" {
        images_dir.join("gifs")
    } else {
        images_dir.clone()
    };
    fs::create_dir_all(&target_dir).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("background");
    let safe_stem: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe_stem = safe_stem.trim().trim_matches('.');
    let final_stem = if safe_stem.is_empty() {
        "background"
    } else {
        safe_stem
    };
    if is_dos_device_name(final_stem) {
        return Err("Reserved system device names are not allowed".to_string());
    }

    let safe_target_dir = ensure_inside(&images_dir, &target_dir)
        .map_err(|e| sanitize_err(user_dir, &e))?;
    let candidate_name = format!("{}.{}", final_stem, ext_lower);
    let mut dest = safe_target_dir.join(&candidate_name);

    if let Ok(sym) = fs::symlink_metadata(&dest) {
        if sym.file_type().is_symlink() || sym.is_dir() {
            return Err("Destination path is invalid or a symlink".to_string());
        }
        let safe_dest = ensure_inside(&safe_target_dir, &dest)
            .map_err(|e| sanitize_err(user_dir, &e))?;
        let same_content = sym.is_file()
            && sym.len() == bytes.len() as u64
            && fs::read(&safe_dest)
                .map(|existing| existing == bytes)
                .unwrap_or(false);

        if same_content {
            return Ok(safe_dest.to_string_lossy().replace('\\', "/"));
        }

        let hash8 = fnv1a_hex8(&[&bytes]);
        dest = safe_target_dir.join(format!("{}_{}.{}", final_stem, hash8, ext_lower));
        if let Ok(sym2) = fs::symlink_metadata(&dest) {
            if sym2.file_type().is_symlink() || sym2.is_dir() {
                return Err("Destination path is invalid or a symlink".to_string());
            }
        }
    }

    fs::write(&dest, &bytes)
        .map_err(|e| format!("Failed to copy image: {}", sanitize_err(user_dir, &e.to_string())))?;
    Ok(dest.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn import_custom_background(
    state: State<'_, AppState>,
    source_path: String,
) -> Result<String, String> {
    import_custom_background_to_dir(&state.user_dir, &source_path)
}

#[tauri::command]
pub fn get_custom_backgrounds(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    get_custom_backgrounds_from_dir(&state.user_dir)
}

#[tauri::command]
pub fn delete_custom_background(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Invalid background image path".to_string());
    }
    let p = Path::new(trimmed);
    let Ok(meta) = fs::symlink_metadata(p) else {
        return Ok(());
    };
    if meta.file_type().is_symlink() {
        return Err("Symlinked background files cannot be deleted here".to_string());
    }
    let images_dir = state.user_dir.join("images");
    let _ = fs::create_dir_all(&images_dir);
    let safe = ensure_inside(&images_dir, p)?;
    fs::remove_file(safe).map_err(|_| "Failed to delete background image".to_string())
}

#[tauri::command]
pub fn open_custom_backgrounds_folder(state: State<'_, AppState>) -> Result<(), String> {
    let images_dir = state.user_dir.join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|e| sanitize_err(&state.user_dir, &e.to_string()))?;
    open_directory_in_shell(&images_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_user_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("audify_sys_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scans_subfolders_and_auto_routes_imported_gifs() {
        let user_dir = make_temp_user_dir("bg_subfolders");
        let images_dir = user_dir.join("images");
        let custom_dir = images_dir.join("nature").join("night");
        let hidden_dir = images_dir.join(".hidden");
        fs::create_dir_all(&custom_dir).unwrap();
        fs::create_dir_all(&hidden_dir).unwrap();

        fs::write(images_dir.join("root_bg.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        fs::write(custom_dir.join("forest.webp"), b"RIFF1234WEBP").unwrap();
        fs::write(custom_dir.join("notes.txt"), b"ignored").unwrap();
        fs::write(hidden_dir.join("secret.png"), b"\x89PNG\r\n\x1a\n").unwrap();

        let gif_src = user_dir.join("spark.gif");
        fs::write(&gif_src, b"GIF89a").unwrap();
        let imported = import_custom_background_to_dir(&user_dir, gif_src.to_str().unwrap()).unwrap();
        assert!(imported.ends_with("/images/gifs/spark.gif"), "got: {imported}");

        let list = get_custom_backgrounds_from_dir(&user_dir).unwrap();
        assert_eq!(list.len(), 3, "got list: {:?}", list);
        assert!(list.iter().any(|p| p.ends_with("/images/root_bg.png")));
        assert!(list.iter().any(|p| p.ends_with("/images/nature/night/forest.webp")));
        assert!(list.iter().any(|p| p.ends_with("/images/gifs/spark.gif")));

        let _ = fs::remove_dir_all(&user_dir);
    }
}
