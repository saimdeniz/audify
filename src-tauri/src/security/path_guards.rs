mod scope;
pub use scope::{
    collect_profile_slice_dirs, sanitize_err, validate_audio_path_in_scope,
    validate_path_in_libraries_or_cache, AuthorizedAudioScope,
};

use std::fs;
use std::path::{Component, Path, PathBuf};

fn is_local_extended_drive_prefix(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 6 {
        return false;
    }
    (s.starts_with(r"\\?\") || s.starts_with("//?/"))
        && bytes[4].is_ascii_alphabetic()
        && bytes[5] == b':'
        && (bytes.len() == 6 || bytes[6] == b'\\' || bytes[6] == b'/')
}

/// Returns `true` for UNC paths (`\\server\...` or `//server/...`), Win32 device namespaces
/// (`\\.\...`, `\\?\UNC\...`, `\??\...`), or network URI schemes, while allowing local Windows
/// extended drive paths `\\?\C:\...`.
///
/// Security invariant: NEVER call `.exists()` or `fs::canonicalize()` before checking this,
/// preventing outbound Windows SMB / WebDAV Net-NTLMv2 credential leaks.
pub fn is_unc_or_network_path(p: &str) -> bool {
    let s = p.trim();
    if s.is_empty() {
        return false;
    }

    let lower = s.to_ascii_lowercase();
    if lower.starts_with("smb:")
        || lower.starts_with("file:")
        || lower.starts_with("http:")
        || lower.starts_with("https:")
        || lower.starts_with("dav:")
        || lower.starts_with("davs:")
    {
        return true;
    }

    if s.starts_with(r"\??\")
        || s.starts_with(r"\\.\")
        || s.starts_with("//./")
        || lower.starts_with(r"\\?\unc")
        || lower.starts_with("//?/unc")
    {
        return true;
    }

    if s.starts_with(r"\\?\") || s.starts_with("//?/") {
        return !is_local_extended_drive_prefix(s);
    }

    let bytes = s.as_bytes();
    if bytes.len() >= 2 {
        let is_slash0 = bytes[0] == b'\\' || bytes[0] == b'/';
        let is_slash1 = bytes[1] == b'\\' || bytes[1] == b'/';
        if is_slash0 && is_slash1 {
            return true;
        }
    }

    false
}

/// Detects NTFS Alternate Data Stream colons (`file.png:stream`) anywhere after a valid drive prefix.
pub fn has_ntfs_ads_colon(p: &str) -> bool {
    let mut s = p.trim();
    if is_local_extended_drive_prefix(s) {
        s = &s[4..];
    }
    let bytes = s.as_bytes();
    let rest = if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        &s[2..]
    } else {
        s
    };
    rest.contains(':')
}

/// Strips local `\\?\` extended-length drive prefix on Windows (`\\?\C:\foo` -> `C:\foo`)
/// while leaving UNC paths untouched.
pub fn strip_verbatim_prefix(p: &Path) -> PathBuf {
    let raw = p.to_string_lossy();
    if is_local_extended_drive_prefix(&raw) {
        PathBuf::from(&raw[4..])
    } else {
        p.to_path_buf()
    }
}

/// Trims whitespace, strips leading local `\\?\`, converts `\` -> `/`, collapses duplicate `/`,
/// and trims trailing `/` while preserving `"C:/"` for drive roots (and `"/"` on Unix).
pub fn normalize_clean_path(p: &str) -> String {
    let trimmed = p.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let is_unc = is_unc_or_network_path(trimmed);
    let stripped = if is_local_extended_drive_prefix(trimmed) {
        &trimmed[4..]
    } else {
        trimmed
    };

    let slash_conv = stripped.replace('\\', "/");
    let mut collapsed = String::with_capacity(slash_conv.len());
    let mut prev_slash = false;
    for ch in slash_conv.chars() {
        if ch == '/' {
            if !prev_slash {
                collapsed.push('/');
            }
            prev_slash = true;
        } else {
            collapsed.push(ch);
            prev_slash = false;
        }
    }

    if is_unc && slash_conv.starts_with("//") && !collapsed.starts_with("//") {
        collapsed.insert(0, '/');
    }

    // Preserve `"/"` and Windows drive roots `"C:/"`
    if collapsed == "/" {
        return collapsed;
    }
    let b = collapsed.as_bytes();
    if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return format!("{}/", collapsed);
    }
    if b.len() == 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/' {
        return collapsed;
    }

    let without_trailing = collapsed.trim_end_matches('/');
    let wb = without_trailing.as_bytes();
    if wb.len() == 2 && wb[0].is_ascii_alphabetic() && wb[1] == b':' {
        format!("{}/", without_trailing)
    } else if without_trailing.is_empty() && collapsed.starts_with('/') {
        "/".to_string()
    } else {
        without_trailing.to_string()
    }
}

pub(super) fn is_forbidden_os_or_root_normalized(norm_clean: &str) -> bool {
    let lower = norm_clean.trim().to_lowercase();
    if lower.is_empty() || lower == "/" {
        return true;
    }

    let lb = lower.as_bytes();
    if lb.len() >= 2 && lb[0].is_ascii_alphabetic() && lb[1] == b':' {
        let after_drive = &lower[2..];
        if after_drive.is_empty() || after_drive == "/" {
            return true;
        }
        let segments: Vec<&str> = after_drive
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();
        if segments.len() == 2 && segments[0] == "users" {
            return true;
        }
        if segments.len() == 3 && segments[0] == "users" && segments[2] == "appdata" {
            return true;
        }
        if after_drive == "/windows"
            || after_drive.starts_with("/windows/")
            || after_drive == "/program files"
            || after_drive.starts_with("/program files/")
            || after_drive == "/program files (x86)"
            || after_drive.starts_with("/program files (x86)/")
            || after_drive == "/users"
            || after_drive == "/$recycle.bin"
            || after_drive.starts_with("/$recycle.bin/")
            || after_drive == "/system volume information"
            || after_drive.starts_with("/system volume information/")
        {
            return true;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let segments: Vec<&str> = lower.split('/').filter(|s| !s.is_empty()).collect();
        if (segments.len() == 1 || segments.len() == 2)
            && matches!(segments[0], "home" | "users")
        {
            return true;
        }
        if lower == "/etc"
            || lower.starts_with("/etc/")
            || lower == "/proc"
            || lower.starts_with("/proc/")
            || lower == "/sys"
            || lower.starts_with("/sys/")
            || lower == "/dev"
            || lower.starts_with("/dev/")
            || lower == "/bin"
            || lower.starts_with("/bin/")
            || lower == "/sbin"
            || lower.starts_with("/sbin/")
            || lower == "/usr"
            || lower.starts_with("/usr/")
            || lower == "/home"
            || lower == "/users"
        {
            return true;
        }
    }

    false
}

/// Public wrapper checking whether a raw path resolves syntactically to an OS root or drive root.
pub fn is_forbidden_os_or_root_path(raw: &str) -> bool {
    is_forbidden_os_or_root_normalized(&normalize_clean_path(raw))
}

fn reject_if_symlink(path: &Path) -> Result<(), String> {
    if let Ok(sym) = fs::symlink_metadata(path) {
        if sym.file_type().is_symlink() {
            return Err("Symbolic links and junctions are not allowed".to_string());
        }
    }
    Ok(())
}

/// Validates that `p` is a safe, existing local audio library or export directory:
/// - Rejects UNC / network paths without touching the filesystem
/// - Rejects NTFS ADS colons and symlinks/junctions
/// - Canonicalizes and verifies `.is_dir()`
/// - Rejects filesystem / drive roots (`C:/`, `/`)
/// - Rejects OS roots (`C:/Windows`, `C:/Program Files`, `C:/Program Files (x86)`, exact `C:/Users`)
pub fn is_safe_library_dir(p: &str) -> Result<PathBuf, String> {
    let trimmed = p.trim();
    if trimmed.is_empty() {
        return Err("Directory path cannot be empty".to_string());
    }
    if is_unc_or_network_path(trimmed) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(trimmed) {
        return Err("Invalid directory path (alternate data streams are not allowed)".to_string());
    }

    let raw_path = Path::new(trimmed);
    let pre_norm = normalize_clean_path(trimmed);
    if is_forbidden_os_or_root_normalized(&pre_norm) {
        return Err(format!(
            "System or root directory is not allowed as a library path: {}",
            display_leaf(raw_path)
        ));
    }

    let sym = fs::symlink_metadata(raw_path).map_err(|_| {
        format!(
            "Directory does not exist or cannot be accessed: {}",
            display_leaf(raw_path)
        )
    })?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed as a library directory".to_string());
    }

    let canon = fs::canonicalize(raw_path).map_err(|_| {
        format!(
            "Directory does not exist or cannot be accessed: {}",
            display_leaf(raw_path)
        )
    })?;

    if is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Symbolic links pointing to network/UNC shares are not allowed".to_string());
    }
    if !canon.is_dir() {
        return Err(format!("Path is not a directory: {}", display_leaf(&canon)));
    }

    let clean_pb = strip_verbatim_prefix(&canon);
    if canon.parent().is_none() || clean_pb.parent().is_none() {
        return Err("Drive or filesystem root cannot be used as a library directory".to_string());
    }

    let canon_norm = normalize_clean_path(&clean_pb.to_string_lossy());
    if is_forbidden_os_or_root_normalized(&canon_norm) {
        return Err("System or root directory is not allowed as a library directory".to_string());
    }

    Ok(clean_pb)
}

/// Returns a safe user-facing filename/folder-name leaf without leaking full local paths (`C:\Users\...`).
pub fn display_leaf(p: &Path) -> &str {
    p.file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("path")
}

/// Validates (creating if needed under an existing safe parent) a local slice export directory.
pub fn ensure_safe_export_dir(p: &str) -> Result<PathBuf, String> {
    let trimmed = p.trim();
    if trimmed.is_empty() {
        return Err("Export directory cannot be empty".to_string());
    }
    if is_unc_or_network_path(trimmed) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(trimmed) {
        return Err("Invalid export directory path".to_string());
    }
    let path_obj = Path::new(trimmed);
    if path_obj.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Parent directory traversal ('..') is not allowed in export path".to_string());
    }
    let pre_norm = normalize_clean_path(trimmed);
    if is_forbidden_os_or_root_normalized(&pre_norm) {
        return Err("System or drive root directory cannot be used for slice export".to_string());
    }
    // Check existing target/ancestors for symlinks or protected roots before `create_dir_all`.
    for anc in path_obj.ancestors() {
        if anc.as_os_str().is_empty() || anc.parent().is_none() {
            break;
        }
        match fs::symlink_metadata(anc) {
            Ok(sym) => {
                if sym.file_type().is_symlink() {
                    return Err("Symbolic links and junctions are not allowed in export path".to_string());
                }
                let canon_anc = fs::canonicalize(anc).map_err(|_| {
                    format!("Export parent directory cannot be resolved: {}", display_leaf(anc))
                })?;
                let clean_anc = strip_verbatim_prefix(&canon_anc);
                if is_unc_or_network_path(&clean_anc.to_string_lossy())
                    || is_forbidden_os_or_root_normalized(&normalize_clean_path(&clean_anc.to_string_lossy()))
                {
                    return Err("System or network directory cannot be used for slice export".to_string());
                }
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                return Err(format!("Cannot access export path '{}'", display_leaf(path_obj)));
            }
        }
    }
    if fs::symlink_metadata(path_obj).is_err() {
        fs::create_dir_all(path_obj).map_err(|_| {
            format!("Failed to create slice export directory: {}", display_leaf(path_obj))
        })?;
    }
    is_safe_library_dir(trimmed)
}

/// Resolves `target` and guarantees it lives inside `base` (rejecting UNC paths and symlinks).
pub fn ensure_inside(base: &Path, target: &Path) -> Result<PathBuf, String> {
    let base_str = base.to_string_lossy();
    let target_str = target.to_string_lossy();
    if is_unc_or_network_path(&base_str) || is_unc_or_network_path(&target_str) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if has_ntfs_ads_colon(&target_str) {
        return Err("Alternate data streams are not allowed".to_string());
    }
    reject_if_symlink(base)?;
    reject_if_symlink(target)?;

    let b = base
        .canonicalize()
        .map_err(|_| format!("Base directory cannot be resolved: {}", display_leaf(base)))?;
    let t = target
        .canonicalize()
        .map_err(|_| format!("Target path cannot be resolved: {}", display_leaf(target)))?;

    if is_unc_or_network_path(&b.to_string_lossy()) || is_unc_or_network_path(&t.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }

    if t.starts_with(&b) {
        Ok(strip_verbatim_prefix(&t))
    } else {
        Err("Path is outside the allowed directory".to_string())
    }
}

/// Ensures `candidate` neither sits inside Audify's `user_dir` (which holds `samples.db`,
/// `backups/`, and WebView cache) nor is a parent directory containing `user_dir`.
pub fn ensure_not_inside_user_dir(user_dir: &Path, candidate: &Path) -> Result<(), String> {
    let user_canon = fs::canonicalize(user_dir)
        .map(|p| strip_verbatim_prefix(&p))
        .unwrap_or_else(|_| user_dir.to_path_buf());
    let cand_canon = fs::canonicalize(candidate)
        .map(|p| strip_verbatim_prefix(&p))
        .unwrap_or_else(|_| candidate.to_path_buf());

    let user_norm = normalize_clean_path(&user_canon.to_string_lossy());
    let cand_norm = normalize_clean_path(&cand_canon.to_string_lossy());
    let (u_cmp, c_cmp) = if cfg!(windows) {
        (user_norm.to_lowercase(), cand_norm.to_lowercase())
    } else {
        (user_norm, cand_norm)
    };

    let overlaps = !u_cmp.is_empty()
        && !c_cmp.is_empty()
        && (c_cmp == u_cmp
            || c_cmp.starts_with(&format!("{}/", u_cmp.trim_end_matches('/')))
            || u_cmp.starts_with(&format!("{}/", c_cmp.trim_end_matches('/'))));

    if overlaps {
        return Err(
            "Audify application data directory cannot be used as a library or export path"
                .to_string(),
        );
    }
    Ok(())
}
