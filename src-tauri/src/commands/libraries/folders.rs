use crate::commands::{parent_folder_path, FolderStat};
use crate::db::{get_active_profile_id, run_read_query, AppState};
use crate::scanner::path_lookup_key;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_safe_library_dir, is_unc_or_network_path,
    normalize_clean_path, strip_verbatim_prefix,
};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

pub(super) fn collect_physical_subfolders(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    remaining_budget: &mut usize,
    out: &mut Vec<String>,
) {
    if depth >= max_depth || *remaining_budget == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *remaining_budget == 0 {
            break;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy();
        if fname_str.starts_with('.')
            || fname_str.eq_ignore_ascii_case("$recycle.bin")
            || fname_str.eq_ignore_ascii_case("system volume information")
        {
            continue;
        }
        let sub_path = entry.path();
        let norm_sub = normalize_clean_path(&sub_path.to_string_lossy());
        *remaining_budget = remaining_budget.saturating_sub(1);
        out.push(norm_sub);
        collect_physical_subfolders(&sub_path, depth + 1, max_depth, remaining_budget, out);
    }
}

pub(crate) fn get_folder_tree_stats_with_conn(conn: &Connection) -> Result<Vec<FolderStat>, String> {
    let active_id = get_active_profile_id(conn);

    let mut stmt = conn
        .prepare(
            "SELECT s.library_id, s.file_path
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND (l.is_global = 1 OR s.library_id IN (
                   SELECT library_id FROM profile_libraries WHERE profile_id = ?1
               ))",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut counts: HashMap<(i64, String), (String, i64)> = HashMap::new();
    for row in rows.flatten() {
        let (lib_id, file_path) = row;
        let folder = parent_folder_path(&file_path);
        let key = path_lookup_key(&folder);
        let entry = counts.entry((lib_id, key)).or_insert_with(|| (folder, 0));
        entry.1 += 1;
    }

    if let Ok(mut lib_stmt) = conn.prepare(
        "SELECT l.id, l.path
         FROM libraries l
         WHERE l.is_global = 1 OR l.id IN (
             SELECT library_id FROM profile_libraries WHERE profile_id = ?1
         )",
    ) {
        if let Ok(lib_rows) = lib_stmt.query_map(params![active_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        }) {
            for (lib_id, lib_path) in lib_rows.flatten() {
                if is_unc_or_network_path(&lib_path) || has_ntfs_ads_colon(&lib_path) {
                    continue;
                }
                let root_pb = Path::new(&lib_path);
                let Ok(meta) = fs::symlink_metadata(root_pb) else {
                    continue;
                };
                if meta.file_type().is_symlink() || !meta.is_dir() {
                    continue;
                }
                let mut budget = 2000usize;
                let mut subdirs = Vec::new();
                collect_physical_subfolders(root_pb, 0, 10, &mut budget, &mut subdirs);
                for sub in subdirs {
                    let key = path_lookup_key(&sub);
                    counts.entry((lib_id, key)).or_insert((sub, 0));
                }
            }
        }
    }

    let mut out: Vec<FolderStat> = counts
        .into_iter()
        .map(|((library_id, _), (folder_path, count))| FolderStat {
            library_id,
            folder_path,
            count,
        })
        .collect();

    out.sort_by(|a, b| a.folder_path.cmp(&b.folder_path));
    Ok(out)
}

#[tauri::command]
pub async fn get_folder_tree_stats(state: State<'_, AppState>) -> Result<Vec<FolderStat>, String> {
    run_read_query(&state, get_folder_tree_stats_with_conn).await
}

fn normalize_match_segment(raw: &str) -> String {
    normalize_clean_path(raw)
        .trim_matches('/')
        .to_lowercase()
}

fn normalize_match_folder_prefix(raw: &str) -> String {
    normalize_clean_path(raw)
        .trim_end_matches('/')
        .to_lowercase()
}

fn sample_matches_license_filters(
    file_path: &str,
    norm_folders: &[String],
    norm_rel_folders: &[String],
) -> bool {
    let sample_norm = normalize_clean_path(file_path).to_lowercase();
    for folder in norm_folders {
        if sample_norm == *folder || sample_norm.starts_with(&format!("{}/", folder)) {
            return true;
        }
    }
    if !norm_rel_folders.is_empty() {
        let parent_norm = normalize_match_folder_prefix(&parent_folder_path(file_path));
        for rel in norm_rel_folders {
            if parent_norm == *rel
                || parent_norm.ends_with(&format!("/{}", rel))
                || parent_norm.contains(&format!("/{}/", rel))
            {
                return true;
            }
        }
    }
    false
}

pub(crate) fn preview_license_group_samples_with_conn(
    conn: &Connection,
    folders: &[String],
    rel_folders: &[String],
    limit: usize,
) -> Result<Vec<String>, String> {
    let max_items = limit.clamp(1, 20);
    let norm_folders: Vec<String> = folders
        .iter()
        .map(|f| normalize_match_folder_prefix(f))
        .filter(|f| !f.is_empty())
        .collect();
    let norm_rel_folders: Vec<String> = rel_folders
        .iter()
        .map(|r| normalize_match_segment(r))
        .filter(|r| !r.is_empty())
        .collect();

    if norm_folders.is_empty() && norm_rel_folders.is_empty() {
        return Ok(Vec::new());
    }

    let active_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT s.file_path, s.file_name
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND (l.is_global = 1 OR s.library_id IN (
                   SELECT library_id FROM profile_libraries WHERE profile_id = ?1
               ))
             ORDER BY s.file_name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Preview query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Preview query execution error: {}", e))?;

    let mut names = Vec::with_capacity(max_items);
    for row in rows.flatten() {
        if sample_matches_license_filters(&row.0, &norm_folders, &norm_rel_folders) {
            names.push(row.1);
            if names.len() >= max_items {
                break;
            }
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn preview_license_group_samples(
    state: State<'_, AppState>,
    folders: Vec<String>,
    rel_folders: Option<Vec<String>>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let rel = rel_folders.unwrap_or_default();
    let max_items = limit.unwrap_or(3).clamp(1, 20);
    run_read_query(&state, move |conn| {
        preview_license_group_samples_with_conn(conn, &folders, &rel, max_items)
    })
    .await
}

pub(super) fn validate_and_resolve_scan_paths(
    library_path: &str,
    target_folder: Option<&str>,
) -> Result<(PathBuf, String, PathBuf, String), String> {
    let safe_root = is_safe_library_dir(library_path)?;
    let norm_lib_path = normalize_clean_path(&safe_root.to_string_lossy());

    let (scan_dir, norm_scan_prefix) = if let Some(tf) = target_folder {
        let tf_trimmed = tf.trim();
        if tf_trimmed.is_empty() {
            (safe_root.clone(), norm_lib_path.clone())
        } else {
            if is_unc_or_network_path(tf_trimmed) {
                return Err("Network and UNC paths are not allowed".to_string());
            }
            if has_ntfs_ads_colon(tf_trimmed) {
                return Err("Alternate data stream paths are not allowed".to_string());
            }
            if Path::new(tf_trimmed)
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            {
                return Err("Parent directory traversal is not allowed".to_string());
            }
            let tf_leaf = display_leaf(Path::new(tf_trimmed));
            let meta = fs::symlink_metadata(tf_trimmed)
                .map_err(|_| format!("Target folder does not exist: {}", tf_leaf))?;
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(format!("Target folder is not a valid directory: {}", tf_leaf));
            }
            let canon_tf = fs::canonicalize(tf_trimmed)
                .map_err(|_| format!("Target folder does not exist: {}", tf_leaf))?;
            if is_unc_or_network_path(&canon_tf.to_string_lossy()) || !canon_tf.is_dir() {
                return Err(format!("Target folder is not a valid directory: {}", tf_leaf));
            }
            let clean_tf = strip_verbatim_prefix(&canon_tf);
            let norm_tf = normalize_clean_path(&clean_tf.to_string_lossy());

            let inside = if cfg!(windows) {
                let lib_lower = norm_lib_path.to_lowercase();
                let tf_lower = norm_tf.to_lowercase();
                tf_lower == lib_lower || tf_lower.starts_with(&format!("{}/", lib_lower))
            } else {
                norm_tf == norm_lib_path || norm_tf.starts_with(&format!("{}/", norm_lib_path))
            };

            if !inside {
                return Err(format!(
                    "Target folder '{}' is outside the selected library",
                    display_leaf(&clean_tf)
                ));
            }
            (clean_tf, norm_tf)
        }
    } else {
        (safe_root.clone(), norm_lib_path.clone())
    };

    Ok((safe_root, norm_lib_path, scan_dir, norm_scan_prefix))
}