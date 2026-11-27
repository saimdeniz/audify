use crate::commands::{compute_rel_path, ProfileExportPackage, ResilientSampleRef};
use crate::security::{normalize_clean_path, whitelist_and_sanitize_settings};
use rusqlite::{params, Connection};

pub(super) fn extract_custom_slice_path(settings_json: &str) -> Option<String> {
    let val: serde_json::Value = serde_json::from_str(settings_json).ok()?;
    let raw = val.get("customSliceExportPath")?.as_str()?.trim();
    if raw.is_empty() {
        None
    } else {
        Some(normalize_clean_path(raw))
    }
}

pub(super) fn extract_custom_layer_path(settings_json: &str) -> Option<String> {
    let val: serde_json::Value = serde_json::from_str(settings_json).ok()?;
    let raw = val.get("customLayerExportPath")?.as_str()?.trim();
    if raw.is_empty() {
        None
    } else {
        Some(normalize_clean_path(raw))
    }
}

pub(super) fn collect_profile_library_ids(conn: &Connection, profile_id: i64) -> Vec<i64> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT l.id FROM libraries l
         WHERE l.is_global = 1
            OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
         ORDER BY l.id ASC",
    ) else {
        return Vec::new();
    };
    stmt.query_map(params![profile_id], |r| r.get::<_, i64>(0))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .collect()
}

pub(super) fn sanitize_profile_settings_json(raw: &str) -> Result<String, String> {
    let val: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid profile settings JSON: {}", e))?;
    let cleaned = whitelist_and_sanitize_settings(&val, false, false)?;
    serde_json::to_string(&cleaned)
        .map_err(|e| format!("Failed to serialize profile settings JSON: {}", e))
}

/// Populates portable relative path arrays (`rel_include_paths` / `rel_exclude_paths`)
/// from absolute scope paths against known library roots when exporting a profile.
pub(super) fn populate_scope_rel_paths(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    section_key: &str,
    lib_paths: &[String],
) {
    if let Some(items) = obj.get_mut(section_key).and_then(|v| v.as_array_mut()) {
        for item in items {
            let Some(item_obj) = item.as_object_mut() else {
                continue;
            };
            for (abs_key, rel_key) in [
                ("include_paths", "rel_include_paths"),
                ("exclude_paths", "rel_exclude_paths"),
            ] {
                let mut rels: Vec<String> = Vec::new();
                if let Some(paths) = item_obj.get(abs_key).and_then(|f| f.as_array()) {
                    for p_val in paths {
                        if let Some(p_str) = p_val.as_str() {
                            if let Some(rel) = compute_rel_path(p_str, lib_paths) {
                                if !rels.contains(&rel) {
                                    rels.push(rel);
                                }
                            }
                        }
                    }
                }
                if !rels.is_empty() {
                    item_obj.insert(
                        rel_key.to_string(),
                        serde_json::to_value(rels).unwrap_or_default(),
                    );
                }
            }
        }
    }
}

/// Makes an export safe to share: removes every machine-specific absolute path
/// (username, drive letters, project folder). Relinking still works through
/// `rel_path` + `file_name` + `file_size` (Tier 2 / Tier 3).
pub(crate) fn apply_share_safe(pkg: &mut ProfileExportPackage) {
    fn anon(r: &mut ResilientSampleRef) {
        r.file_path = r
            .rel_path
            .clone()
            .or_else(|| r.file_name.clone())
            .unwrap_or_default();
    }

    pkg.libraries.clear();
    pkg.favorite_sample_paths.clear();
    pkg.manual_tag_assignments.clear();
    pkg.sample_refs.iter_mut().for_each(anon);
    pkg.favorite_samples.iter_mut().for_each(anon);
    for refs in pkg.manual_tag_samples.values_mut() {
        refs.iter_mut().for_each(anon);
    }
    for refs in pkg.manual_genre_assignments.values_mut() {
        refs.iter_mut().for_each(anon);
    }
    for entry in pkg.manual_loops.iter_mut() {
        anon(&mut entry.sample);
    }
    for item in pkg.sample_tags.iter_mut() {
        if let Some(ref mut s_ref) = item.sample_ref {
            anon(s_ref);
            item.file_path = s_ref.file_path.clone();
        } else {
            item.file_path.clear();
        }
    }
    for col in pkg.collections.iter_mut() {
        col.sample_file_paths.clear();
        col.rule_path = None;
        col.samples.iter_mut().for_each(anon);
    }
    for sl in pkg.slices.iter_mut() {
        sl.slice_path = sl.slice_name.clone();
        sl.source_file_path = sl.source_file_name.clone();
    }

    if let Some(obj) = pkg.settings.as_object_mut() {
        obj.insert(
            "binSampleIds".to_string(),
            serde_json::json!([]),
        );
        obj.insert(
            "customSliceExportPath".to_string(),
            serde_json::Value::String(String::new()),
        );
        obj.insert(
            "customLayerExportPath".to_string(),
            serde_json::Value::String(String::new()),
        );
        obj.insert(
            "customBgImage".to_string(),
            serde_json::Value::String(String::new()),
        );
        if let Some(groups) = obj.get_mut("licenseGroups").and_then(|v| v.as_array_mut()) {
            for g in groups {
                if let Some(g_obj) = g.as_object_mut() {
                    g_obj.insert("folders".to_string(), serde_json::json!([]));
                }
            }
        }
        if let Some(templates) = obj
            .get_mut("collectionTemplates")
            .and_then(|v| v.as_array_mut())
        {
            for tmpl in templates {
                if let Some(t_obj) = tmpl.as_object_mut() {
                    t_obj.insert(
                        "folder_path".to_string(),
                        serde_json::Value::String(String::new()),
                    );
                }
            }
        }
        if let Some(categories) = obj
            .get_mut("autoTagCategories")
            .and_then(|v| v.as_array_mut())
        {
            for cat in categories {
                if let Some(c_obj) = cat.as_object_mut() {
                    c_obj.insert("include_paths".to_string(), serde_json::json!([]));
                    c_obj.insert("exclude_paths".to_string(), serde_json::json!([]));
                }
            }
        }
        if let Some(rules) = obj.get_mut("autoTagRules").and_then(|v| v.as_array_mut()) {
            for rule in rules {
                if let Some(r_obj) = rule.as_object_mut() {
                    if r_obj.contains_key("include_paths") {
                        r_obj.insert("include_paths".to_string(), serde_json::json!([]));
                    }
                    if r_obj.contains_key("exclude_paths") {
                        r_obj.insert("exclude_paths".to_string(), serde_json::json!([]));
                    }
                }
            }
        }
    }
}
