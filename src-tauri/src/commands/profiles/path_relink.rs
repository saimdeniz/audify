use crate::commands::compute_rel_path;
use crate::security::{
    ensure_inside, has_ntfs_ads_colon, has_parent_dir_traversal, is_safe_library_dir,
    is_unc_or_network_path, normalize_clean_path,
};
use rusqlite::{params, Connection};
use std::path::{Component, Path};

pub(crate) fn sanitize_direct_existing_dir(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || has_parent_dir_traversal(trimmed) || has_ntfs_ads_colon(trimmed) {
        return None;
    }
    let safe = is_safe_library_dir(trimmed).ok()?;
    Some(normalize_clean_path(&safe.to_string_lossy()))
}

pub(crate) fn resolve_rel_path_inside_library(
    current_lib: &str,
    rel_path: &str,
    must_exist_dir: bool,
) -> Option<String> {
    let lib_trimmed = current_lib.trim();
    let rel_trimmed = rel_path.trim();
    let has_drive_prefix = rel_trimmed.len() >= 2
        && rel_trimmed.as_bytes()[1] == b':'
        && rel_trimmed.as_bytes()[0].is_ascii_alphabetic();
    if lib_trimmed.is_empty()
        || rel_trimmed.is_empty()
        || is_unc_or_network_path(lib_trimmed)
        || is_unc_or_network_path(rel_trimmed)
        || has_ntfs_ads_colon(lib_trimmed)
        || has_ntfs_ads_colon(rel_trimmed)
        || has_drive_prefix
        || rel_trimmed.starts_with('/')
        || rel_trimmed.starts_with('\\')
        || has_parent_dir_traversal(rel_trimmed)
    {
        return None;
    }

    let rel_os = rel_trimmed.replace('\\', "/");
    let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
    for comp in Path::new(&rel_os).components() {
        match comp {
            Component::Normal(seg) => parts.push(seg),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }

    let base_path = Path::new(lib_trimmed);
    let base_meta = std::fs::symlink_metadata(base_path).ok()?;
    if base_meta.file_type().is_symlink() || !base_meta.is_dir() {
        return None;
    }

    let mut cur = base_path.to_path_buf();
    for seg in &parts {
        cur.push(seg);
        let meta = std::fs::symlink_metadata(&cur).ok()?;
        if meta.file_type().is_symlink() {
            return None;
        }
    }

    if must_exist_dir {
        let final_meta = std::fs::symlink_metadata(&cur).ok()?;
        if !final_meta.is_dir() {
            return None;
        }
    }

    let canon = ensure_inside(base_path, &cur).ok()?;
    Some(normalize_clean_path(&canon.to_string_lossy()))
}

fn resolve_scope_rel_paths_on_import(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    section_key: &str,
    pkg_lib_paths: &[String],
    current_lib_paths: &[String],
) -> bool {
    let mut updated = false;
    if let Some(items) = obj.get_mut(section_key).and_then(|v| v.as_array_mut()) {
        for item in items {
            let Some(item_obj) = item.as_object_mut() else {
                continue;
            };
            for (abs_key, rel_key) in [
                ("include_paths", "rel_include_paths"),
                ("exclude_paths", "rel_exclude_paths"),
            ] {
                let mut rels: Vec<String> = item_obj
                    .get(rel_key)
                    .and_then(|r| r.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();

                if rels.is_empty() {
                    if let Some(paths) = item_obj.get(abs_key).and_then(|f| f.as_array()) {
                        for p_val in paths {
                            if let Some(p_str) = p_val.as_str() {
                                if let Some(rel) = compute_rel_path(p_str, pkg_lib_paths) {
                                    if !rels.contains(&rel) {
                                        rels.push(rel);
                                    }
                                }
                            }
                        }
                    }
                }

                if !rels.is_empty() {
                    item_obj.insert(
                        rel_key.to_string(),
                        serde_json::to_value(&rels).unwrap_or_default(),
                    );
                    updated = true;

                    let mut local_paths: Vec<String> = Vec::new();
                    for rel in &rels {
                        for current_lib in current_lib_paths {
                            if let Some(norm) =
                                resolve_rel_path_inside_library(current_lib, rel, false)
                            {
                                if !local_paths.contains(&norm) {
                                    local_paths.push(norm);
                                }
                            }
                        }
                    }
                    if !local_paths.is_empty() {
                        item_obj.insert(
                            abs_key.to_string(),
                            serde_json::to_value(local_paths).unwrap_or_default(),
                        );
                        updated = true;
                    }
                }
            }
        }
    }
    updated
}

pub(crate) fn relink_imported_settings_paths(
    imported_settings: &mut serde_json::Value,
    pkg_lib_paths: &[String],
    current_lib_paths: &[String],
) -> bool {
    let mut updated_settings = false;
    let Some(obj) = imported_settings.as_object_mut() else {
        return false;
    };

    if let Some(groups) = obj.get_mut("licenseGroups").and_then(|v| v.as_array_mut()) {
        for group in groups {
            let Some(g_obj) = group.as_object_mut() else {
                continue;
            };
            let mut rel_list: Vec<String> = g_obj
                .get("rel_folders")
                .and_then(|r| r.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();

            if rel_list.is_empty() {
                if let Some(folders) = g_obj.get("folders").and_then(|f| f.as_array()) {
                    for f_val in folders {
                        if let Some(f_str) = f_val.as_str() {
                            if let Some(rel) = compute_rel_path(f_str, pkg_lib_paths) {
                                if !rel_list.contains(&rel) {
                                    rel_list.push(rel);
                                }
                            }
                        }
                    }
                }
            }

            if !rel_list.is_empty() {
                g_obj.insert(
                    "rel_folders".to_string(),
                    serde_json::to_value(&rel_list).unwrap_or_default(),
                );
                updated_settings = true;

                let mut local_folders: Vec<String> = Vec::new();
                for rel in &rel_list {
                    for current_lib in current_lib_paths {
                        if let Some(norm) = resolve_rel_path_inside_library(current_lib, rel, true)
                        {
                            if !local_folders.contains(&norm) {
                                local_folders.push(norm);
                            }
                        }
                    }
                }
                if !local_folders.is_empty() {
                    g_obj.insert(
                        "folders".to_string(),
                        serde_json::to_value(local_folders).unwrap_or_default(),
                    );
                    updated_settings = true;
                }
            }
        }
    }

    if let Some(templates) = obj
        .get_mut("collectionTemplates")
        .and_then(|v| v.as_array_mut())
    {
        for tmpl in templates {
            let Some(t_obj) = tmpl.as_object_mut() else {
                continue;
            };
            let rel = t_obj
                .get("rel_folder_path")
                .and_then(|r| r.as_str())
                .map(str::to_string)
                .or_else(|| {
                    t_obj
                        .get("folder_path")
                        .and_then(|f| f.as_str())
                        .and_then(|fp| compute_rel_path(fp, pkg_lib_paths))
                });

            let mut relinked = false;
            if let Some(rel_path) = rel {
                t_obj.insert(
                    "rel_folder_path".to_string(),
                    serde_json::Value::String(rel_path.clone()),
                );
                updated_settings = true;

                for current_lib in current_lib_paths {
                    if let Some(norm) = resolve_rel_path_inside_library(current_lib, &rel_path, true)
                    {
                        t_obj.insert("folder_path".to_string(), serde_json::Value::String(norm));
                        updated_settings = true;
                        relinked = true;
                        break;
                    }
                }
            }

            if !relinked {
                if let Some(existing_fp) = t_obj
                    .get("folder_path")
                    .and_then(|f| f.as_str())
                    .map(str::to_string)
                {
                    let cleaned = sanitize_direct_existing_dir(&existing_fp).unwrap_or_default();
                    if cleaned != existing_fp {
                        t_obj.insert("folder_path".to_string(), serde_json::Value::String(cleaned));
                        updated_settings = true;
                    }
                }
            }
        }
    }

    if resolve_scope_rel_paths_on_import(obj, "autoTagCategories", pkg_lib_paths, current_lib_paths)
    {
        updated_settings = true;
    }
    if resolve_scope_rel_paths_on_import(obj, "autoTagRules", pkg_lib_paths, current_lib_paths) {
        updated_settings = true;
    }
    updated_settings
}

fn replace_folder_or_prefix(
    raw: &str,
    norm_old_root: &str,
    old_prefix_slash: &str,
    old_prefix_lower: &str,
    norm_new_root: &str,
) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let norm = normalize_clean_path(trimmed);
    let exact_match = if cfg!(windows) {
        norm.eq_ignore_ascii_case(norm_old_root)
    } else {
        norm == norm_old_root
    };
    if exact_match {
        return Some(norm_new_root.to_string());
    }
    let rel_opt = if cfg!(windows) {
        norm.get(..old_prefix_slash.len())
            .filter(|head| head.to_lowercase() == old_prefix_lower)
            .and_then(|_| norm.get(old_prefix_slash.len()..))
    } else {
        norm.strip_prefix(old_prefix_slash)
    };
    rel_opt.map(|rel| format!("{}/{}", norm_new_root.trim_end_matches('/'), rel.trim_start_matches('/')))
}

pub(crate) fn relink_prefix_in_all_profiles_settings(
    conn: &Connection,
    norm_old_root: &str,
    norm_new_root: &str,
) -> Result<(), String> {
    let old_prefix_slash = format!("{}/", norm_old_root.trim_end_matches('/'));
    let old_prefix_lower = old_prefix_slash.to_lowercase();

    let rows: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, settings_json FROM profiles")
            .map_err(|e| format!("Failed reading profiles settings: {}", e))?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Failed querying profiles settings: {}", e))?;
        mapped.flatten().collect()
    };

    for (pid, raw_json) in rows {
        let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&raw_json) else {
            continue;
        };
        let Some(obj) = val.as_object_mut() else {
            continue;
        };
        let mut changed = false;

        if let Some(s_val) = obj.get("customSliceExportPath").and_then(|v| v.as_str()) {
            if let Some(next_p) = replace_folder_or_prefix(
                s_val,
                norm_old_root,
                &old_prefix_slash,
                &old_prefix_lower,
                norm_new_root,
            ) {
                obj.insert(
                    "customSliceExportPath".to_string(),
                    serde_json::Value::String(next_p),
                );
                changed = true;
            }
        }

        if let Some(groups) = obj.get_mut("licenseGroups").and_then(|v| v.as_array_mut()) {
            for g in groups {
                if let Some(folders) = g
                    .as_object_mut()
                    .and_then(|m| m.get_mut("folders"))
                    .and_then(|v| v.as_array_mut())
                {
                    for f in folders {
                        if let Some(old_s) = f.as_str() {
                            if let Some(next_p) = replace_folder_or_prefix(
                                old_s,
                                norm_old_root,
                                &old_prefix_slash,
                                &old_prefix_lower,
                                norm_new_root,
                            ) {
                                *f = serde_json::Value::String(next_p);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }

        if let Some(tmpls) = obj
            .get_mut("collectionTemplates")
            .and_then(|v| v.as_array_mut())
        {
            for t in tmpls {
                if let Some(t_obj) = t.as_object_mut() {
                    if let Some(old_fp) = t_obj.get("folder_path").and_then(|v| v.as_str()) {
                        if let Some(next_p) = replace_folder_or_prefix(
                            old_fp,
                            norm_old_root,
                            &old_prefix_slash,
                            &old_prefix_lower,
                            norm_new_root,
                        ) {
                            t_obj.insert(
                                "folder_path".to_string(),
                                serde_json::Value::String(next_p),
                            );
                            changed = true;
                        }
                    }
                }
            }
        }

        for section_key in ["autoTagCategories", "autoTagRules"] {
            if let Some(items) = obj.get_mut(section_key).and_then(|v| v.as_array_mut()) {
                for item in items {
                    let Some(m) = item.as_object_mut() else {
                        continue;
                    };
                    for key in ["include_paths", "exclude_paths"] {
                        if let Some(arr) = m.get_mut(key).and_then(|v| v.as_array_mut()) {
                            for p in arr {
                                if let Some(old_s) = p.as_str() {
                                    if let Some(next_p) = replace_folder_or_prefix(
                                        old_s,
                                        norm_old_root,
                                        &old_prefix_slash,
                                        &old_prefix_lower,
                                        norm_new_root,
                                    ) {
                                        *p = serde_json::Value::String(next_p);
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if changed {
            if let Ok(next_json) = serde_json::to_string(&val) {
                conn.execute(
                    "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
                    params![next_json, pid],
                )
                .map_err(|e| format!("Failed updating profile settings paths: {}", e))?;
            }
        }
    }
    Ok(())
}
