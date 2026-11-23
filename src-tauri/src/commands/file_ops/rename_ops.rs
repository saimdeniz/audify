use crate::commands::file_ops::prune_file_ops_journal;
use crate::commands::{get_sample_by_id_or_path_with_conn, SampleItem};
use crate::db::{get_active_profile_id, is_sample_visible_in_profile, AppState};
use crate::security::{
    ensure_inside, is_dos_device_name, normalize_clean_path, sanitize_err,
    validate_audio_path_in_scope, validate_safe_audio_stem,
};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;
use tauri::State;

fn validate_safe_file_component(raw: &str) -> Result<String, String> {
    if raw.ends_with(' ') || raw.ends_with('.') {
        return Err("File name cannot end with a space or period".to_string());
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." || trimmed.chars().count() > 240 {
        return Err("Invalid recorded file name".to_string());
    }
    for ch in trimmed.chars() {
        if ch.is_control()
            || matches!(
                ch,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        {
            return Err("Invalid character in file name".to_string());
        }
    }
    if is_dos_device_name(trimmed) {
        return Err("Reserved Windows device names are not allowed".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn rename_sample_file_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    sample_id: i64,
    new_stem: &str,
) -> Result<SampleItem, String> {
    let clean_stem = validate_safe_audio_stem(new_stem)?;
    let active_id = get_active_profile_id(conn);
    if !is_sample_visible_in_profile(conn, active_id, sample_id) {
        return Err("Sample not found in active workspace profile".to_string());
    }

    let (current_file_path, current_file_name, extension, is_trashed, lib_name, lib_read_only): (
        String,
        String,
        String,
        bool,
        String,
        bool,
    ) = conn
        .query_row(
            "SELECT s.file_path, s.file_name, s.extension, COALESCE(s.is_trashed, 0),
                    l.name, COALESCE(l.is_read_only, 0)
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE s.id = ?1",
            params![sample_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|_| "Sample not found in library".to_string())?;

    if is_trashed {
        return Err("Cannot rename a sample while it is in Audify Trash. Restore it first.".to_string());
    }
    if lib_read_only {
        return Err(format!(
            "Library '{}' is locked as a Protected Read-Only Vault. Unlock it in Settings > Libraries or Advanced to rename files.",
            lib_name
        ));
    }

    let resolved_src = validate_audio_path_in_scope(conn, user_dir, &current_file_path)?;
    let ext_clean = extension
        .trim()
        .trim_start_matches('.')
        .to_string();
    let new_file_name = if ext_clean.is_empty() {
        clean_stem.clone()
    } else {
        let safe_ext = validate_safe_file_component(&ext_clean)?;
        format!("{}.{}", clean_stem, safe_ext)
    };

    if new_file_name == current_file_name {
        return get_sample_by_id_or_path_with_conn(conn, Some(sample_id), None, None)?
            .ok_or_else(|| "Sample not found after rename check".to_string());
    }

    let parent_dir = resolved_src
        .parent()
        .ok_or_else(|| "Source audio file has no parent folder".to_string())?;
    let target_pb = parent_dir.join(&new_file_name);
    let norm_new_path = normalize_clean_path(&target_pb.to_string_lossy());
    let norm_old_path = normalize_clean_path(&resolved_src.to_string_lossy());

    let is_case_only_rename = norm_new_path.to_lowercase() == norm_old_path.to_lowercase();
    if !is_case_only_rename && target_pb.exists() {
        return Err(format!(
            "A file named '{}' already exists in this folder",
            new_file_name
        ));
    }

    let db_conflict: bool = if cfg!(windows) {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM samples WHERE id != ?1 AND LOWER(file_path) = LOWER(?2))",
            params![sample_id, norm_new_path],
            |r| r.get(0),
        )
        .unwrap_or(false)
    } else {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM samples WHERE id != ?1 AND file_path = ?2)",
            params![sample_id, norm_new_path],
            |r| r.get(0),
        )
        .unwrap_or(false)
    };
    if db_conflict {
        return Err(format!(
            "Another indexed sample already exists at '{}'",
            new_file_name
        ));
    }

    fs::rename(&resolved_src, &target_pb).map_err(|e| {
        format!(
            "Failed to rename file on disk ('{}' -> '{}'): {}",
            current_file_name,
            new_file_name,
            sanitize_err(user_dir, &e.to_string())
        )
    })?;

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            let _ = fs::rename(&target_pb, &resolved_src);
            return Err(format!(
                "Failed to start database transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    if let Err(e) = tx.execute(
        "UPDATE samples
         SET file_path = ?1,
             file_name = ?2,
             previous_file_name = ?3
         WHERE id = ?4",
        params![norm_new_path, new_file_name, current_file_name, sample_id],
    ) {
        drop(tx);
        let _ = fs::rename(&target_pb, &resolved_src);
        return Err(format!(
            "Failed to update sample record: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    if let Err(e) = crate::commands::slices::relink_sample_slices_source_by_sample_id(
        &tx,
        sample_id,
        &norm_new_path,
        &new_file_name,
    ) {
        drop(tx);
        let _ = fs::rename(&target_pb, &resolved_src);
        return Err(e);
    }

    let _ = tx.execute(
        "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
         VALUES (?1, 'RENAME', ?2, ?3, ?4, ?5)",
        params![
            sample_id,
            norm_old_path,
            norm_new_path,
            current_file_name,
            new_file_name
        ],
    );
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        let _ = fs::rename(&target_pb, &resolved_src);
        return Err(format!(
            "Failed to commit rename transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    get_sample_by_id_or_path_with_conn(conn, Some(sample_id), None, None)?
        .ok_or_else(|| "Renamed sample could not be loaded".to_string())
}

#[tauri::command]
pub fn rename_sample_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sample_id: i64,
    new_stem: String,
) -> Result<SampleItem, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    rename_sample_file_with_conn(&mut conn, &state.user_dir, sample_id, &new_stem)
}

pub(crate) fn undo_rename_sample_file_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    sample_id: i64,
) -> Result<SampleItem, String> {
    let active_id = get_active_profile_id(conn);
    if !is_sample_visible_in_profile(conn, active_id, sample_id) {
        return Err("Sample not found in active workspace profile".to_string());
    }
    let (current_file_path, current_file_name, prev_file_name, is_trashed, lib_name, lib_read_only): (
        String,
        String,
        Option<String>,
        bool,
        String,
        bool,
    ) = conn
        .query_row(
            "SELECT s.file_path, s.file_name, s.previous_file_name, COALESCE(s.is_trashed, 0),
                    l.name, COALESCE(l.is_read_only, 0)
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE s.id = ?1",
            params![sample_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|_| "Sample not found".to_string())?;

    if is_trashed {
        return Err("Cannot undo rename while sample is in Audify Trash.".to_string());
    }
    if lib_read_only {
        return Err(format!(
            "Library '{}' is locked as a Protected Read-Only Vault.",
            lib_name
        ));
    }

    let raw_old_name = prev_file_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "No previous file name recorded for this sample".to_string())?;
    let target_old_name = validate_safe_file_component(&raw_old_name)?;

    let resolved_src = validate_audio_path_in_scope(conn, user_dir, &current_file_path)?;
    let parent_dir = resolved_src
        .parent()
        .ok_or_else(|| "Source audio file has no parent folder".to_string())?;
    let target_pb = parent_dir.join(&target_old_name);
    if fs::symlink_metadata(&target_pb).is_ok() {
        ensure_inside(parent_dir, &target_pb)?;
    }
    let norm_new_path = normalize_clean_path(&target_pb.to_string_lossy());
    let norm_old_path = normalize_clean_path(&resolved_src.to_string_lossy());

    let is_case_only = norm_new_path.eq_ignore_ascii_case(&norm_old_path);
    if !is_case_only && fs::symlink_metadata(&target_pb).is_ok() {
        return Err(format!(
            "Cannot restore previous name because '{}' already exists in this folder",
            target_old_name
        ));
    }

    fs::rename(&resolved_src, &target_pb).map_err(|e| {
        format!(
            "Failed to restore original file name ('{}' -> '{}'): {}",
            current_file_name,
            target_old_name,
            sanitize_err(user_dir, &e.to_string())
        )
    })?;

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            let _ = fs::rename(&target_pb, &resolved_src);
            return Err(format!(
                "Failed to start database transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    if let Err(e) = tx.execute(
        "UPDATE samples
         SET file_path = ?1,
             file_name = ?2,
             previous_file_name = NULL
         WHERE id = ?3",
        params![norm_new_path, target_old_name, sample_id],
    ) {
        drop(tx);
        let _ = fs::rename(&target_pb, &resolved_src);
        return Err(format!(
            "Failed to update sample record: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    if let Err(e) = crate::commands::slices::relink_sample_slices_source_by_sample_id(
        &tx,
        sample_id,
        &norm_new_path,
        &target_old_name,
    ) {
        drop(tx);
        let _ = fs::rename(&target_pb, &resolved_src);
        return Err(e);
    }

    let _ = tx.execute(
        "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
         VALUES (?1, 'UNDO_RENAME', ?2, ?3, ?4, ?5)",
        params![
            sample_id,
            norm_old_path,
            norm_new_path,
            current_file_name,
            target_old_name
        ],
    );
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        let _ = fs::rename(&target_pb, &resolved_src);
        return Err(format!(
            "Failed to commit undo rename transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    get_sample_by_id_or_path_with_conn(conn, Some(sample_id), None, None)?
        .ok_or_else(|| "Sample could not be loaded after undo rename".to_string())
}

#[tauri::command]
pub fn undo_rename_sample_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sample_id: i64,
) -> Result<SampleItem, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    undo_rename_sample_file_with_conn(&mut conn, &state.user_dir, sample_id)
}