use crate::ai_tagger::AiTaggerState;
use crate::commands::file_ops::{
    is_dir_inside_library_root, is_same_folder_path, suggest_keep_both_name,
    validate_writable_library_folder, FileCollisionItem, SubfolderRenameSummary,
};
use crate::db::AppState;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_dos_device_name, is_unc_or_network_path,
    normalize_clean_path, strip_verbatim_prefix, validate_safe_audio_stem,
};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

pub(super) struct DestinationCollisionCtx<'a> {
    pub(super) target_dir_pb: &'a Path,
    pub(super) norm_target_folder: &'a str,
    pub(super) policy: &'a str,
    pub(super) reserved_names_lower: &'a mut HashSet<String>,
    pub(super) conflicts: &'a mut Vec<FileCollisionItem>,
    pub(super) skipped_conflicts: &'a mut usize,
}

/// Resolves file name collisions against disk & reserved batch targets using `policy`.
/// Returns `Ok(Some(final_name))` to write, `Ok(None)` if skipped or queued as conflict.
pub(super) fn resolve_destination_filename(
    ctx: &mut DestinationCollisionCtx<'_>,
    src_path: &Path,
    norm_src: &str,
    sample_id: Option<i64>,
    file_name: &str,
) -> Option<String> {
    let desired_dst = ctx.target_dir_pb.join(file_name);
    let name_lower = file_name.to_lowercase();
    let collides = desired_dst.exists() || ctx.reserved_names_lower.contains(&name_lower);

    let final_name = if collides {
        let suggested =
            suggest_keep_both_name(ctx.target_dir_pb, file_name, ctx.reserved_names_lower);
        match ctx.policy {
            "skip" => {
                *ctx.skipped_conflicts += 1;
                return None;
            }
            "keep_both" => suggested,
            _ => {
                let src_size = fs::metadata(src_path).map(|m| m.len()).unwrap_or(0);
                let existing_size = fs::metadata(&desired_dst).map(|m| m.len()).unwrap_or(0);
                ctx.conflicts.push(FileCollisionItem {
                    source_path: norm_src.to_string(),
                    sample_id,
                    file_name: file_name.to_string(),
                    suggested_new_name: suggested,
                    source_size: src_size,
                    existing_size,
                    target_folder: ctx.norm_target_folder.to_string(),
                });
                return None;
            }
        }
    } else {
        file_name.to_string()
    };

    ctx.reserved_names_lower.insert(final_name.to_lowercase());
    Some(final_name)
}

pub(crate) fn create_physical_subfolder_with_conn(
    conn: &Connection,
    library_id: i64,
    parent_folder_path: &str,
    new_folder_name: &str,
) -> Result<String, String> {
    let (norm_lib, _, clean_parent_pb, _) =
        validate_writable_library_folder(conn, library_id, parent_folder_path)?;

    let clean_name = validate_safe_audio_stem(new_folder_name)?;
    if clean_name.starts_with('.') || clean_name.starts_with('$') {
        return Err("Folder name cannot start with '.' or '$'".to_string());
    }

    let new_dir_pb = clean_parent_pb.join(&clean_name);
    if new_dir_pb.exists() {
        return Err(format!(
            "A folder named '{}' already exists in this location",
            clean_name
        ));
    }

    fs::create_dir(&new_dir_pb)
        .map_err(|e| format!("Failed to create folder '{}': {}", clean_name, e))?;

    let canon_created = new_dir_pb.canonicalize().map_err(|e| {
        let _ = fs::remove_dir(&new_dir_pb);
        format!("Failed to verify created folder '{}': {}", clean_name, e)
    })?;
    if !is_dir_inside_library_root(&canon_created, &norm_lib) {
        let _ = fs::remove_dir(&new_dir_pb);
        return Err("Created folder escaped registered library boundary".to_string());
    }
    let clean_created = strip_verbatim_prefix(&canon_created);
    Ok(normalize_clean_path(&clean_created.to_string_lossy()))
}

#[tauri::command]
pub fn create_physical_subfolder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    library_id: i64,
    parent_folder_path: String,
    new_folder_name: String,
) -> Result<String, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let conn = state.lock_db();
    create_physical_subfolder_with_conn(&conn, library_id, &parent_folder_path, &new_folder_name)
}

pub(crate) fn rename_physical_subfolder_with_conn(
    conn: &mut Connection,
    library_id: i64,
    folder_path: &str,
    new_folder_name: &str,
) -> Result<SubfolderRenameSummary, String> {
    let (norm_lib_path, _, clean_folder_pb, norm_old_folder) =
        validate_writable_library_folder(conn, library_id, folder_path)?;

    if is_same_folder_path(&norm_old_folder, &norm_lib_path) {
        return Err(
            "Library root folder cannot be renamed here. Use Relink in Settings > Libraries."
                .to_string(),
        );
    }

    let clean_name = validate_safe_audio_stem(new_folder_name)?;
    if clean_name.starts_with('.') || clean_name.starts_with('$') {
        return Err("Folder name cannot start with '.' or '$'".to_string());
    }

    let parent_pb = clean_folder_pb
        .parent()
        .ok_or_else(|| "Subfolder has no parent directory".to_string())?;
    let target_pb = parent_pb.join(&clean_name);
    let norm_new_folder = normalize_clean_path(&target_pb.to_string_lossy());

    if norm_new_folder == norm_old_folder {
        return Ok(SubfolderRenameSummary {
            old_folder_path: norm_old_folder,
            new_folder_path: norm_new_folder,
            new_folder_name: clean_name,
            updated_sample_count: 0,
        });
    }

    let is_case_only = norm_new_folder.eq_ignore_ascii_case(&norm_old_folder);
    if !is_case_only && target_pb.exists() {
        return Err(format!(
            "A folder named '{}' already exists in this parent folder",
            clean_name
        ));
    }

    let sample_rows: Vec<(i64, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, COALESCE(original_file_path, ''), COALESCE(trash_file_path, '')
                 FROM samples WHERE library_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![library_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    fs::rename(&clean_folder_pb, &target_pb)
        .map_err(|e| format!("Failed to rename folder on disk: {}", e))?;

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            let _ = fs::rename(&target_pb, &clean_folder_pb);
            return Err(format!("Failed to start subfolder rename transaction: {}", e));
        }
    };

    let old_prefix_slash = format!("{}/", norm_old_folder);
    let old_prefix_lower = old_prefix_slash.to_lowercase();
    let mut updated_count = 0usize;

    for (sid, fp, orig_fp, trash_fp) in sample_rows {
        let new_fp = crate::commands::libraries::replace_library_prefix(
            &fp,
            &old_prefix_slash,
            &old_prefix_lower,
            &norm_new_folder,
        );
        let new_orig_fp = crate::commands::libraries::replace_library_prefix(
            &orig_fp,
            &old_prefix_slash,
            &old_prefix_lower,
            &norm_new_folder,
        );
        let new_trash_fp = crate::commands::libraries::replace_library_prefix(
            &trash_fp,
            &old_prefix_slash,
            &old_prefix_lower,
            &norm_new_folder,
        );

        if new_fp.is_some() || new_orig_fp.is_some() || new_trash_fp.is_some() {
            let final_fp = new_fp.unwrap_or(fp);
            let final_orig = if orig_fp.trim().is_empty() {
                None
            } else {
                Some(new_orig_fp.unwrap_or(orig_fp))
            };
            let final_trash = if trash_fp.trim().is_empty() {
                None
            } else {
                Some(new_trash_fp.unwrap_or(trash_fp))
            };
            if let Err(e) = tx.execute(
                "UPDATE samples
                 SET file_path = ?1,
                     original_file_path = ?2,
                     trash_file_path = ?3
                 WHERE id = ?4",
                params![final_fp, final_orig, final_trash, sid],
            ) {
                drop(tx);
                let _ = fs::rename(&target_pb, &clean_folder_pb);
                return Err(format!("Failed to update sample path {}: {}", sid, e));
            }
            updated_count += 1;
        }
    }

    if let Err(e) = crate::commands::slices::relink_sample_slices_source_prefix(
        &tx,
        &old_prefix_slash,
        &old_prefix_lower,
        &norm_new_folder,
    ) {
        drop(tx);
        let _ = fs::rename(&target_pb, &clean_folder_pb);
        return Err(e);
    }

    if let Err(e) = crate::commands::profiles::path_relink::relink_prefix_in_all_profiles_settings(
        &tx,
        &norm_old_folder,
        &norm_new_folder,
    ) {
        drop(tx);
        let _ = fs::rename(&target_pb, &clean_folder_pb);
        return Err(e);
    }

    if let Err(e) = tx.commit() {
        let _ = fs::rename(&target_pb, &clean_folder_pb);
        return Err(format!("Failed to commit subfolder rename: {}", e));
    }

    Ok(SubfolderRenameSummary {
        old_folder_path: norm_old_folder,
        new_folder_path: norm_new_folder,
        new_folder_name: clean_name,
        updated_sample_count: updated_count,
    })
}

/// Validates that a relocate destination folder belongs to a writable registered library
/// *before* creating any missing subdirectory on disk, preventing arbitrary directory creation
/// or symlink escapes outside library scope.
pub(super) fn ensure_writable_library_folder_for_relocate(
    conn: &Connection,
    library_id: i64,
    folder_path: &str,
) -> Result<(String, String, PathBuf, String), String> {
    let trimmed = folder_path.trim();
    if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Invalid or unsupported target folder path".to_string());
    }
    if trimmed.to_ascii_lowercase().contains(".audify_trash") {
        return Err("Cannot perform folder operations inside .audify_trash".to_string());
    }

    let target_pb = PathBuf::from(trimmed);
    if target_pb
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Parent directory traversal ('..') is not allowed in target folder".to_string());
    }

    let (lib_path, lib_name, lib_read_only): (String, String, bool) = conn
        .query_row(
            "SELECT path, name, COALESCE(is_read_only, 0) FROM libraries WHERE id = ?1",
            params![library_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Target library not found".to_string())?;

    if lib_read_only {
        return Err(format!(
            "Library '{}' is locked as a Protected Read-Only Vault. Unlock it in Settings > Libraries or Advanced first.",
            lib_name
        ));
    }

    if !target_pb.exists() {
        let mut cursor: Option<&Path> = Some(&target_pb);
        while let Some(dir) = cursor {
            if dir.exists() {
                let sym = fs::symlink_metadata(dir)
                    .map_err(|_| "Failed to inspect target parent directory".to_string())?;
                if sym.file_type().is_symlink() || !sym.file_type().is_dir() {
                    return Err("Target parent path is not a valid physical folder".to_string());
                }
                let canon_ancestor = dir
                    .canonicalize()
                    .map_err(|_| "Failed to verify target parent directory".to_string())?;
                if !is_dir_inside_library_root(&canon_ancestor, &lib_path) {
                    return Err(format!(
                        "Target folder '{}' is outside library '{}'",
                        display_leaf(&target_pb),
                        lib_name
                    ));
                }
                fs::create_dir_all(&target_pb).map_err(|_| {
                    format!(
                        "Failed to create target directory {}",
                        display_leaf(&target_pb)
                    )
                })?;
                break;
            }
            if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name.starts_with('$') || is_dos_device_name(name) {
                    return Err("Target folder name is invalid or reserved".to_string());
                }
            }
            cursor = dir.parent();
        }
        if !target_pb.exists() {
            return Err("Target library root directory could not be resolved on disk".to_string());
        }
    }

    validate_writable_library_folder(conn, library_id, trimmed)
}

#[tauri::command]
pub fn rename_physical_subfolder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    library_id: i64,
    folder_path: String,
    new_folder_name: String,
) -> Result<SubfolderRenameSummary, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    let res =
        rename_physical_subfolder_with_conn(&mut conn, library_id, &folder_path, &new_folder_name)?;
    if res.updated_sample_count > 0 {
        ai_state.invalidate_vector_cache();
    }
    Ok(res)
}