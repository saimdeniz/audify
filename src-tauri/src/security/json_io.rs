use super::inputs::is_dos_device_name;
use super::path_guards::{
    display_leaf, has_ntfs_ads_colon, is_forbidden_os_or_root_normalized, is_unc_or_network_path,
    normalize_clean_path, strip_verbatim_prefix,
};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

pub const MAX_JSON_IMPORT_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_LEGACY_PROFILE_JSON_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_PROFILE_UNCOMPRESSED_BYTES: u64 = 160 * 1024 * 1024;
pub const MAX_SNAPSHOT_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_CUSTOM_BG_BYTES: u64 = 25 * 1024 * 1024;

/// Reads at most `max_bytes` from `path`, rejecting UNC paths and oversized files before reading.
pub fn read_bounded_bytes(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let raw = path.to_string_lossy();
    if is_unc_or_network_path(&raw) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(&raw) {
        return Err("Alternate data streams are not allowed".to_string());
    }

    let sym = fs::symlink_metadata(path)
        .map_err(|_| format!("Failed to read file metadata for {}", display_leaf(path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    if !sym.is_file() {
        return Err(format!("Path is not a regular file: {}", display_leaf(path)));
    }
    if sym.len() > max_bytes {
        return Err(format!(
            "File exceeds maximum allowed size ({} bytes > {} bytes)",
            sym.len(),
            max_bytes
        ));
    }

    let canon = fs::canonicalize(path)
        .map_err(|_| format!("Failed to resolve file path for {}", display_leaf(path)))?;
    if is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Symbolic links pointing to network/UNC paths are not allowed".to_string());
    }

    let file = File::open(&canon)
        .map_err(|_| format!("Failed to open file {}", display_leaf(path)))?;
    let cap = (sym.len() as usize).min(max_bytes as usize);
    let mut buf = Vec::with_capacity(cap);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut buf)
        .map_err(|_| format!("Failed to read file {}", display_leaf(path)))?;

    if (buf.len() as u64) > max_bytes {
        return Err(format!(
            "File exceeds maximum allowed size ({} bytes limit)",
            max_bytes
        ));
    }
    Ok(buf)
}

/// Reads a UTF-8 string of at most `max_bytes` from `path`, rejecting UNC paths before reading.
pub fn read_bounded_string(path: &Path, max_bytes: u64) -> Result<String, String> {
    let bytes = read_bounded_bytes(path, max_bytes)?;
    String::from_utf8(bytes)
        .map_err(|_| format!("File {} is not valid UTF-8 text", display_leaf(path)))
}

fn has_allowed_suffix(path: &Path, allowed_suffixes: &[&str]) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let lower = name.trim().to_ascii_lowercase();
    allowed_suffixes
        .iter()
        .any(|sfx| lower.len() > sfx.len() && lower.ends_with(sfx))
}

fn has_valid_json_filename(path: &Path) -> bool {
    has_allowed_suffix(path, &[".json"])
}

fn validate_basic_import_path(
    raw_path: &str,
    allowed_suffixes: &[&str],
    ext_error: &str,
) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".to_string());
    }
    if is_unc_or_network_path(trimmed) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(trimmed) {
        return Err("Alternate data streams are not allowed".to_string());
    }
    let p = Path::new(trimmed);
    if !has_allowed_suffix(p, allowed_suffixes) {
        return Err(ext_error.to_string());
    }
    if p.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(is_dos_device_name)
    {
        return Err("Reserved DOS device names are not allowed".to_string());
    }
    if let Ok(sym) = fs::symlink_metadata(p) {
        if sym.file_type().is_symlink() {
            return Err("Symbolic links and junctions are not allowed".to_string());
        }
    }
    Ok(p.to_path_buf())
}

/// Validates a `.json` file path before importing settings packages.
pub fn validate_json_import_path(raw_path: &str) -> Result<PathBuf, String> {
    validate_basic_import_path(raw_path, &[".json"], "Import file must have a .json extension")
}

/// Validates an archive or JSON file path before importing a profile or full backup snapshot.
pub fn validate_archive_import_path(
    raw_path: &str,
    allowed_suffixes: &[&str],
    ext_error: &str,
) -> Result<PathBuf, String> {
    validate_basic_import_path(raw_path, allowed_suffixes, ext_error)
}

fn is_json_header(slice: &[u8]) -> bool {
    if slice.contains(&0) {
        return false;
    }
    let after_bom = slice.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(slice);
    let first_non_ws = after_bom
        .iter()
        .copied()
        .find(|b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'));
    matches!(first_non_ws, Some(b'{'))
}

pub fn is_zip_magic(slice: &[u8]) -> bool {
    slice.starts_with(b"PK\x03\x04") || slice.starts_with(b"PK\x05\x06")
}

fn validate_export_target_common(
    raw_path: &str,
    allowed_suffixes: &[&str],
    ext_error: &str,
    expect_zip_magic_if_not_json: bool,
) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Export file path cannot be empty".to_string());
    }
    if is_unc_or_network_path(trimmed) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(trimmed) {
        return Err("Alternate data streams are not allowed".to_string());
    }

    let p = Path::new(trimmed);
    if !has_allowed_suffix(p, allowed_suffixes) {
        return Err(ext_error.to_string());
    }

    let parent = p
        .parent()
        .filter(|par| !par.as_os_str().is_empty())
        .ok_or_else(|| "Export file path must include a valid parent directory".to_string())?;

    if is_unc_or_network_path(&parent.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }

    if let Ok(sym_parent) = fs::symlink_metadata(parent) {
        if sym_parent.file_type().is_symlink() {
            return Err("Symbolic links and junctions are not allowed as export directories".to_string());
        }
    }
    let canon_parent = fs::canonicalize(parent).map_err(|_| {
        format!(
            "Export parent directory does not exist or cannot be accessed: {}",
            display_leaf(parent)
        )
    })?;
    if is_unc_or_network_path(&canon_parent.to_string_lossy()) {
        return Err("Network and UNC export directories are not allowed".to_string());
    }
    let clean_parent = strip_verbatim_prefix(&canon_parent);
    if is_forbidden_os_or_root_normalized(&normalize_clean_path(&clean_parent.to_string_lossy())) {
        return Err("Exporting directly into a system or drive root directory is not allowed".to_string());
    }

    let file_name = p
        .file_name()
        .ok_or_else(|| "Invalid export file name".to_string())?;
    if file_name.to_str().is_some_and(is_dos_device_name) {
        return Err("Reserved DOS device names are not allowed".to_string());
    }
    let target_path = clean_parent.join(file_name);

    if let Ok(sym_meta) = fs::symlink_metadata(&target_path) {
        if sym_meta.file_type().is_symlink() || !sym_meta.file_type().is_file() {
            return Err("Refusing to overwrite symlink or non-regular file".to_string());
        }
        if sym_meta.permissions().readonly() {
            return Err("Refusing to overwrite read-only or system file".to_string());
        }
        if sym_meta.len() > 0 {
            let mut f = File::open(&target_path).map_err(|_| {
                format!(
                    "Failed to inspect existing export file: {}",
                    display_leaf(&target_path)
                )
            })?;
            let mut prefix = [0u8; 64];
            let n = f.read(&mut prefix).unwrap_or(0);
            let slice = &prefix[..n];
            if has_valid_json_filename(&target_path) {
                if !is_json_header(slice) {
                    return Err("Refusing to overwrite existing non-JSON file".to_string());
                }
            } else if expect_zip_magic_if_not_json && !is_zip_magic(slice) {
                return Err("Refusing to overwrite existing non-archive file".to_string());
            }
        }
    }

    Ok(target_path)
}

/// Validates a `.json` destination path before exporting settings packages.
pub fn validate_json_export_path(raw_path: &str) -> Result<PathBuf, String> {
    validate_export_target_common(
        raw_path,
        &[".json"],
        "Export file path must end with .json",
        false,
    )
}

/// Validates an archive (or optional `.json`) destination path before exporting profiles or snapshots.
pub fn validate_archive_export_path(
    raw_path: &str,
    allowed_suffixes: &[&str],
    ext_error: &str,
) -> Result<PathBuf, String> {
    validate_export_target_common(raw_path, allowed_suffixes, ext_error, true)
}
