use super::{sanitize_hex_color_or_default, validate_hex_color};
use crate::security::path_guards::{
    has_ntfs_ads_colon, is_forbidden_os_or_root_normalized, is_unc_or_network_path,
    normalize_clean_path,
};
use serde_json::{Map, Value};
use std::path::{Component, Path};

const VALID_COLLECTION_ICONS: &[&str] = &[
    "layers",
    "folder",
    "music",
    "zap",
    "flame",
    "sparkles",
    "film",
    "gamepad",
    "disc",
    "shield",
    "headphones",
    "radio",
    "heart",
    "bookmark",
    "archive",
];

pub fn is_valid_collection_icon(icon: &str) -> bool {
    VALID_COLLECTION_ICONS.contains(&icon.trim())
}

pub(super) fn sanitize_clean_text(raw: &str, max_chars: usize, allow_newlines: bool) -> String {
    raw.chars()
        .filter(|&c| {
            if c.is_control() {
                allow_newlines && c == '\n'
            } else {
                true
            }
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}

pub fn has_parent_dir_traversal(raw: &str) -> bool {
    if Path::new(raw)
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return true;
    }
    let norm = raw.replace('\\', "/");
    norm.split('/').any(|seg| seg.trim() == "..")
}

pub(super) fn is_safe_nested_path(raw: &str, is_relative: bool) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || is_unc_or_network_path(trimmed)
        || has_ntfs_ads_colon(trimmed)
        || has_parent_dir_traversal(trimmed)
    {
        return false;
    }
    if is_relative {
        let bytes = trimmed.as_bytes();
        let has_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
        if has_drive
            || trimmed.starts_with('/')
            || trimmed.starts_with('\\')
            || Path::new(trimmed).is_absolute()
        {
            return false;
        }
        return true;
    }
    !is_forbidden_os_or_root_normalized(&normalize_clean_path(trimmed))
}

fn sanitize_path_array(obj: &mut Map<String, Value>, key: &str, is_relative: bool) {
    if let Some(arr) = obj.get_mut(key).and_then(|v| v.as_array_mut()) {
        arr.retain(|entry| {
            entry
                .as_str()
                .map(|s| is_safe_nested_path(s, is_relative))
                .unwrap_or(false)
        });
    }
}

fn sanitize_text_field(obj: &mut Map<String, Value>, key: &str, max_chars: usize, allow_nl: bool) {
    if let Some(raw) = obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string()) {
        obj.insert(
            key.to_string(),
            Value::String(sanitize_clean_text(&raw, max_chars, allow_nl)),
        );
    } else if obj.contains_key(key) {
        obj.remove(key);
    }
}

pub(super) fn sanitize_nested_paths(obj: &mut Map<String, Value>) {
    if let Some(groups) = obj.get_mut("licenseGroups").and_then(|v| v.as_array_mut()) {
        for grp in groups {
            if let Some(g_obj) = grp.as_object_mut() {
                sanitize_path_array(g_obj, "folders", false);
                sanitize_path_array(g_obj, "rel_folders", true);
            }
        }
    }
    if let Some(templates) = obj
        .get_mut("collectionTemplates")
        .and_then(|v| v.as_array_mut())
    {
        for tmpl in templates {
            if let Some(t_obj) = tmpl.as_object_mut() {
                for (key, is_rel) in [("folder_path", false), ("rel_folder_path", true)] {
                    if let Some(fp) = t_obj.get(key).and_then(|v| v.as_str()) {
                        if !fp.trim().is_empty() && !is_safe_nested_path(fp, is_rel) {
                            t_obj.insert(key.to_string(), Value::String(String::new()));
                        }
                    }
                }
            }
        }
    }
    for section_key in ["autoTagCategories", "autoTagRules"] {
        if let Some(items) = obj.get_mut(section_key).and_then(|v| v.as_array_mut()) {
            for item in items {
                if let Some(item_obj) = item.as_object_mut() {
                    sanitize_path_array(item_obj, "include_paths", false);
                    sanitize_path_array(item_obj, "exclude_paths", false);
                    sanitize_path_array(item_obj, "rel_include_paths", true);
                    sanitize_path_array(item_obj, "rel_exclude_paths", true);
                }
            }
        }
    }
}

pub(super) fn sanitize_top_level_enums(map: &mut Map<String, Value>) {
    let enum_checks: &[(&str, &[&str])] = &[
        ("themeMode", &["dark", "light", "contrast"]),
        ("waveformSensitivity", &["logarithmic", "high_boost", "linear"]),
        ("waveformStyle", &["solid_baseline", "symmetric"]),
        ("exportAudioPreset", &["original", "wav_24", "nle_48k_24"]),
        ("exportLoudnessMode", &["off", "peak_m1", "lufs_m14", "lufs_m24"]),
        ("miniDockEdgeSide", &["right", "left"]),
        ("wallpaperKind", &["none", "image", "ascii_preset", "ascii_magic", "ascii_custom"]),
        ("asciiMagicFit", &["contain", "cover"]),
    ];
    for &(key, allowed) in enum_checks {
        if let Some(val) = map.get(key) {
            let valid = val.as_str().map(|s| allowed.contains(&s)).unwrap_or(false);
            if !valid {
                map.remove(key);
            }
        }
    }
    if let Some(val) = map.get("asciiMagicLook") {
        let valid = val
            .as_str()
            .map(crate::ascii_magic::security::is_valid_look)
            .unwrap_or(false);
        if !valid {
            map.remove("asciiMagicLook");
        }
    }
}

pub(super) fn sanitize_nested_metadata(map: &mut Map<String, Value>) {
    if let Some(groups) = map.get_mut("licenseGroups").and_then(|v| v.as_array_mut()) {
        groups.retain_mut(|grp| {
            let Some(g_obj) = grp.as_object_mut() else {
                return false;
            };
            sanitize_text_field(g_obj, "id", 128, false);
            sanitize_text_field(g_obj, "name", 128, false);
            sanitize_text_field(g_obj, "template", 2000, true);
            let clean_color = g_obj
                .get("color")
                .and_then(|v| v.as_str())
                .map(|c| sanitize_hex_color_or_default(c, "#38BDF8"))
                .unwrap_or_else(|| "#38BDF8".to_string());
            g_obj.insert("color".to_string(), Value::String(clean_color));

            if let Some(qm) = g_obj.get("quoteMode").and_then(|v| v.as_str()) {
                if !matches!(qm, "auto" | "multi_only" | "always" | "never") {
                    g_obj.insert("quoteMode".to_string(), Value::String("auto".to_string()));
                }
            }
            if let Some(icon) = g_obj.get("icon") {
                let valid = icon
                    .as_str()
                    .map(|s| VALID_COLLECTION_ICONS.contains(&s))
                    .unwrap_or(false);
                if !valid {
                    g_obj.remove("icon");
                }
            }
            true
        });
    }

    if let Some(templates) = map
        .get_mut("collectionTemplates")
        .and_then(|v| v.as_array_mut())
    {
        templates.retain_mut(|tmpl| {
            let Some(t_obj) = tmpl.as_object_mut() else {
                return false;
            };
            sanitize_text_field(t_obj, "id", 128, false);
            sanitize_text_field(t_obj, "name", 128, false);
            if let Some(raw_col) = t_obj.get("color").cloned() {
                match raw_col.as_str().and_then(|s| validate_hex_color(s).ok()) {
                    Some(clean) => {
                        t_obj.insert("color".to_string(), Value::String(clean));
                    }
                    None => {
                        t_obj.remove("color");
                    }
                }
            }
            if let Some(icon) = t_obj.get("icon") {
                let valid = icon
                    .as_str()
                    .map(|s| VALID_COLLECTION_ICONS.contains(&s))
                    .unwrap_or(false);
                if !valid {
                    t_obj.remove("icon");
                }
            }
            true
        });
    }

    if let Some(rules) = map.get_mut("autoTagRules").and_then(|v| v.as_array_mut()) {
        rules.retain_mut(|rule| {
            let Some(r_obj) = rule.as_object_mut() else {
                return false;
            };
            sanitize_text_field(r_obj, "id", 128, false);
            sanitize_text_field(r_obj, "tag_name", 128, false);
            sanitize_text_field(r_obj, "category", 128, false);
            sanitize_text_field(r_obj, "parent_tag_name", 64, false);
            if let Some(fval) = r_obj.get("facet_slug") {
                let valid = fval
                    .as_str()
                    .map(|s| matches!(s, "category" | "genre" | "mood" | "source"))
                    .unwrap_or(false);
                if !valid {
                    r_obj.remove("facet_slug");
                }
            }
            let clean_color = r_obj
                .get("tag_color")
                .and_then(|v| v.as_str())
                .map(|c| sanitize_hex_color_or_default(c, "#64748B"))
                .unwrap_or_else(|| "#64748B".to_string());
            r_obj.insert("tag_color".to_string(), Value::String(clean_color));

            if let Some(kws) = r_obj.get_mut("keywords").and_then(|v| v.as_array_mut()) {
                let mut clean_kws = Vec::with_capacity(kws.len());
                for kw in kws.iter() {
                    if let Some(s) = kw.as_str() {
                        let clean = sanitize_clean_text(s, 128, false);
                        if !clean.is_empty() {
                            clean_kws.push(Value::String(clean));
                        }
                    }
                }
                *kws = clean_kws;
            }
            true
        });
    }

    if let Some(cats) = map
        .get_mut("autoTagCategories")
        .and_then(|v| v.as_array_mut())
    {
        cats.retain_mut(|cat| {
            let Some(c_obj) = cat.as_object_mut() else {
                return false;
            };
            sanitize_text_field(c_obj, "name", 128, false);
            true
        });
    }
}
