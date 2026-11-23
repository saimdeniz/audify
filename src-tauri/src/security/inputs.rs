mod nested;

use super::path_guards::{
    has_ntfs_ads_colon, is_forbidden_os_or_root_normalized, is_safe_library_dir,
    is_unc_or_network_path, normalize_clean_path, strip_verbatim_prefix,
};
pub use nested::{has_parent_dir_traversal, is_valid_collection_icon};
use nested::{sanitize_nested_metadata, sanitize_nested_paths, sanitize_top_level_enums};
use std::fs;
use std::path::Path;

pub const ALLOWED_PROFILE_SETTINGS_KEYS: &[&str] = &[
    "themeMode",
    "accentColor",
    "accentAuto",
    "waveformSensitivity",
    "waveformStyle",
    "autoPreview",
    "isLooping",
    "isShuffle",
    "volume",
    "enableMica",
    "sidebarCompactHover",
    "themeTintIntensity",
    "customBgImage",
    "customBgBlur",
    "customBgOpacity",
    "wallpaperKind",
    "asciiPreset",
    "asciiMagicSlug",
    "asciiMagicLook",
    "asciiMagicFit",
    "asciiMotionSpeed",
    "shortcuts",
    "autoTagRules",
    "autoTagCategories",
    "enableLicensesSystem",
    "licenseGroups",
    "collectionTemplates",
    "autoCreateCollectionSubfolders",
    "autoRouteCollectionDrops",
    "customSliceExportPath",
    "playheadLatencyMs",
    "smartSearchSynonyms",
    "autoBinOnNleDrag",
    "binSampleIds",
    "audioOutputDeviceId",
    "sliceMicroFade",
    "exportAudioPreset",
    "skipLeadingSilence",
    "miniDockEdgePeek",
    "miniDockEdgeSide",
    "normalizePreview",
    "autoAnalyzeBpmKey",
    "enableAdvancedFileOps",
    "confirmBeforeTrash",
    "enableLiveFolderWatch",
    "aiAutoAnalyzeOnScan",
    "aiTagConfidenceThreshold",
    "aiTaggingMode",
    "aiKnnTagLearning",
    "aiSimilarityMinScore",
    "aiSimilarityTopK",
    "aiSimilarityScope",
    "aiSimilarityDurationMatch",
];

pub const ALLOWED_BG_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
pub const ALLOWED_BG_VIDEO_EXTS: &[&str] = &["mp4", "webm"];
pub const ALLOWED_BG_MEDIA_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "mp4", "webm",
];

/// True when a path looks like it belongs to a personal user profile / app-data directory.
pub fn is_personal_path(p: &str) -> bool {
    let lower = p.replace('\\', "/").to_lowercase();
    lower.contains("/users/")
        || lower.contains("/home/")
        || lower.contains("/appdata/")
        || lower.ends_with("/appdata")
}

pub fn is_safe_existing_bg_image(bg: &str) -> bool {
    let trimmed = bg.trim();
    if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return false;
    }
    let p = Path::new(trimmed);
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_BG_MEDIA_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !ext_ok {
        return false;
    }
    let Ok(sym) = fs::symlink_metadata(p) else {
        return false;
    };
    if sym.file_type().is_symlink() {
        return false;
    }
    let Ok(canon) = fs::canonicalize(p) else {
        return false;
    };
    if is_unc_or_network_path(&canon.to_string_lossy()) || !canon.is_file() {
        return false;
    }
    let clean = strip_verbatim_prefix(&canon);
    if let Some(parent) = clean.parent() {
        if is_forbidden_os_or_root_normalized(&normalize_clean_path(&parent.to_string_lossy())) {
            return false;
        }
    }
    true
}

/// Sanitizes machine-specific paths inside a settings JSON object:
/// - Rejects UNC paths, NTFS ADS colons, and forbidden OS/root paths immediately before any filesystem check.
/// - Preserves valid user paths on live save and normal backups (`is_import == false`); share-safe sanitization
///   happens explicitly in `apply_share_safe`.
/// - On `is_import == true`: clears `customSliceExportPath` unless `is_safe_library_dir` passes,
///   clears `customBgImage` unless it is a safe existing local image file, and filters UNC paths from
///   path arrays (`licenseGroups`, `collectionTemplates`, `autoTagCategories`, `autoTagRules`).
pub fn sanitize_settings_paths(settings: &mut serde_json::Value, is_import: bool) {
    let Some(obj) = settings.as_object_mut() else {
        return;
    };

    if let Some(slice_path) = obj
        .get("customSliceExportPath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        let trimmed = slice_path.trim();
        let strip = if trimmed.is_empty() {
            false
        } else if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
            true
        } else if is_import {
            is_safe_library_dir(trimmed).is_err()
        } else {
            is_forbidden_os_or_root_normalized(&normalize_clean_path(trimmed))
        };

        if strip {
            obj.insert(
                "customSliceExportPath".to_string(),
                serde_json::Value::String(String::new()),
            );
        }
    }

    if let Some(bg) = obj
        .get("customBgImage")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        let trimmed = bg.trim();
        let strip = if trimmed.is_empty() {
            false
        } else if is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
            true
        } else if is_import {
            !is_safe_existing_bg_image(trimmed)
        } else {
            Path::new(trimmed)
                .parent()
                .map(|p| is_forbidden_os_or_root_normalized(&normalize_clean_path(&p.to_string_lossy())))
                .unwrap_or(false)
        };

        if strip {
            obj.insert(
                "customBgImage".to_string(),
                serde_json::Value::String(String::new()),
            );
        }
    }

    if obj.get("wallpaperKind").and_then(|v| v.as_str()) == Some("ascii_custom") {
        obj.insert(
            "wallpaperKind".to_string(),
            serde_json::Value::String("ascii_preset".to_string()),
        );
    }

    if let Some(slug) = obj
        .get("asciiMagicSlug")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        if !slug.is_empty() && !crate::ascii_magic::security::is_valid_slug(&slug) {
            obj.insert(
                "asciiMagicSlug".to_string(),
                serde_json::Value::String(String::new()),
            );
        }
    }

    if let Some(look) = obj
        .get("asciiMagicLook")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        if !crate::ascii_magic::security::is_valid_look(&look) {
            obj.insert(
                "asciiMagicLook".to_string(),
                serde_json::Value::String("original".to_string()),
            );
        }
    }

    if let Some(fit) = obj
        .get("asciiMagicFit")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        if !matches!(fit.as_str(), "contain" | "cover") {
            obj.insert(
                "asciiMagicFit".to_string(),
                serde_json::Value::String("contain".to_string()),
            );
        }
    }

    sanitize_nested_paths(obj);
}

/// Validates a CSS hex color (`#RGB` or `#RRGGBB`) and normalizes it to uppercase `#RRGGBB`.
pub fn validate_hex_color(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let Some(hex) = trimmed.strip_prefix('#') else {
        return Err("Color must be a hex value such as #38BDF8".to_string());
    };
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Color contains invalid hex characters".to_string());
    }
    match hex.len() {
        3 => {
            let mut expanded = String::with_capacity(7);
            expanded.push('#');
            for ch in hex.chars() {
                let up = ch.to_ascii_uppercase();
                expanded.push(up);
                expanded.push(up);
            }
            Ok(expanded)
        }
        6 => Ok(format!("#{}", hex.to_ascii_uppercase())),
        _ => Err("Color must be a 3- or 6-digit hex value (#RGB or #RRGGBB)".to_string()),
    }
}

/// Returns normalized `#RRGGBB` when `raw` is valid hex, otherwise `fallback`.
pub fn sanitize_hex_color_or_default(raw: &str, fallback: &str) -> String {
    validate_hex_color(raw).unwrap_or_else(|_| fallback.to_string())
}

fn sanitize_clamped_float(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    min: f64,
    max: f64,
) {
    let Some(val) = map.get(key).cloned() else {
        return;
    };
    match val.as_f64().filter(|n| n.is_finite()) {
        Some(n) => {
            if let Some(num) = serde_json::Number::from_f64(n.clamp(min, max)) {
                map.insert(key.to_string(), serde_json::Value::Number(num));
            } else {
                map.remove(key);
            }
        }
        None => {
            map.remove(key);
        }
    }
}

fn sanitize_clamped_int(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    min: i64,
    max: i64,
) {
    let Some(val) = map.get(key).cloned() else {
        return;
    };
    let parsed = val
        .as_i64()
        .or_else(|| val.as_f64().filter(|n| n.is_finite()).map(|n| n.round() as i64));
    match parsed {
        Some(n) => {
            map.insert(key.to_string(), serde_json::Value::from(n.clamp(min, max)));
        }
        None => {
            map.remove(key);
        }
    }
}

fn sanitize_ai_settings_fields(map: &mut serde_json::Map<String, serde_json::Value>) {
    if let Some(val) = map.get("aiAutoAnalyzeOnScan") {
        if !val.is_boolean() {
            map.remove("aiAutoAnalyzeOnScan");
        }
    }
    if let Some(val) = map.get("aiTaggingMode").cloned() {
        let valid = val
            .as_str()
            .map(|s| s == "vectors_only" || s == "suggest" || s == "auto_apply")
            .unwrap_or(false);
        if !valid {
            map.remove("aiTaggingMode");
        }
    }
    sanitize_clamped_float(map, "aiTagConfidenceThreshold", 0.25, 0.98);
    sanitize_clamped_float(map, "aiSimilarityMinScore", 0.35, 0.95);
    sanitize_clamped_int(map, "aiSimilarityTopK", 10, 500);
    if let Some(val) = map.get("aiSimilarityScope").cloned() {
        let valid = val
            .as_str()
            .map(|s| s == "profile" || s == "folder")
            .unwrap_or(false);
        if !valid {
            map.remove("aiSimilarityScope");
        }
    }
    if let Some(val) = map.get("aiSimilarityDurationMatch") {
        if !val.is_boolean() {
            map.remove("aiSimilarityDurationMatch");
        }
    }
    if let Some(val) = map.get("aiKnnTagLearning") {
        if !val.is_boolean() {
            map.remove("aiKnnTagLearning");
        }
    }
}

/// Whitelists only known `ProfileSettings` keys on an imported JSON object, rejecting arbitrary
/// JSON documents that have zero recognized keys (unless the object is empty `{}`), and runs
/// `sanitize_settings_paths`.
pub fn whitelist_and_sanitize_settings(
    raw_val: &serde_json::Value,
    is_import: bool,
    require_known_key_if_nonempty: bool,
) -> Result<serde_json::Value, String> {
    let source_obj = if let Some(inner) = raw_val.get("settings").and_then(|v| v.as_object()) {
        inner
    } else if let Some(obj) = raw_val.as_object() {
        obj
    } else {
        return Err("Settings file does not contain a valid JSON settings object".to_string());
    };

    let mut filtered = serde_json::Map::new();
    for (k, v) in source_obj {
        if ALLOWED_PROFILE_SETTINGS_KEYS.contains(&k.as_str()) {
            filtered.insert(k.clone(), v.clone());
        }
    }

    if let Some(accent_val) = filtered.get("accentColor").cloned() {
        match accent_val.as_str().and_then(|s| validate_hex_color(s).ok()) {
            Some(clean_hex) => {
                filtered.insert("accentColor".to_string(), serde_json::Value::String(clean_hex));
            }
            None => {
                filtered.remove("accentColor");
            }
        }
    }

    sanitize_top_level_enums(&mut filtered);
    sanitize_ai_settings_fields(&mut filtered);
    sanitize_nested_metadata(&mut filtered);

    if require_known_key_if_nonempty && !source_obj.is_empty() && filtered.is_empty() {
        return Err(
            "Settings file does not contain any recognized Audify profile settings keys"
                .to_string(),
        );
    }

    let mut out = serde_json::Value::Object(filtered);
    sanitize_settings_paths(&mut out, is_import);
    Ok(out)
}

/// Verifies magic bytes for supported background image formats: PNG, JPEG, WEBP, GIF, BMP.
pub fn detect_image_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF] {
        return Some("jpg");
    }
    if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 14 && &bytes[0..2] == b"BM" {
        return Some("bmp");
    }
    None
}

/// Verifies magic bytes for all supported background wallpaper media:
/// images (PNG, JPEG, WEBP, GIF, BMP) and hardware-decoded loop videos (MP4, WebM).
pub fn detect_wallpaper_media_magic(bytes: &[u8]) -> Option<&'static str> {
    if let Some(img) = detect_image_magic(bytes) {
        return Some(img);
    }
    // ISO Base Media File Format (MP4 / ftyp box: small header box 8..=4096 bytes + ASCII brand)
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let box_size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        let valid_brand = bytes[8..12].iter().all(|&b| (0x20..=0x7E).contains(&b));
        if (8..=4096).contains(&box_size) && valid_brand {
            return Some("mp4");
        }
    }
    // EBML container with explicit "webm" DocType within header window
    if bytes.len() >= 4 && bytes[0..4] == [0x1A, 0x45, 0xDF, 0xA3] {
        let probe_len = bytes.len().min(64);
        if bytes[..probe_len].windows(4).any(|w| w == b"webm") {
            return Some("webm");
        }
    }
    None
}

pub fn is_dos_device_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }
    let dev_check = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .trim()
        .to_ascii_uppercase();
    const RESERVED_DEVICES: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    RESERVED_DEVICES.contains(&dev_check.as_str())
}

/// Validates a new audio filename stem (without extension) before an on-disk rename:
/// - Trims leading whitespace, rejects trailing spaces or trailing dots (Windows shell hazard)
/// - Rejects empty stems, `.` / `..`, path separators (`/`, `\`), NTFS ADS `:`, and wildcards (`*`, `?`, `"`, `<`, `>`, `|`)
/// - Rejects ASCII/Unicode control characters and stems longer than 200 characters
/// - Rejects Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`)
pub fn validate_safe_audio_stem(raw_stem: &str) -> Result<String, String> {
    if raw_stem.ends_with(' ') || raw_stem.ends_with('.') {
        return Err("File name cannot end with a space or period on Windows".to_string());
    }
    let trimmed = raw_stem.trim();
    if trimmed.is_empty() {
        return Err("File name cannot be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Invalid file name".to_string());
    }
    if trimmed.chars().count() > 200 {
        return Err("File name is too long (maximum 200 characters)".to_string());
    }
    for ch in trimmed.chars() {
        if ch.is_control()
            || matches!(
                ch,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        {
            return Err(format!(
                "File name contains forbidden character '{}'",
                ch
            ));
        }
    }

    if is_dos_device_name(trimmed) {
        return Err(format!(
            "'{}' is a reserved Windows system name and cannot be used",
            trimmed
        ));
    }

    Ok(trimmed.to_string())
}
