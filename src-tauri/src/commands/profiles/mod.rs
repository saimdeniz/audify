pub(crate) mod archive_pkg;
mod export_pkg;
mod export_share;
mod import_pkg;
mod import_relations;
pub(crate) mod path_relink;
mod slices_and_meta;

pub(crate) use archive_pkg::{
    read_profile_backup_summary, write_profile_package_to_path, PROFILE_ARCHIVE_SUFFIXES,
};
pub(crate) use export_pkg::{apply_share_safe, build_profile_export_package_with_options};
use export_share::{
    collect_profile_library_ids, extract_custom_layer_path, extract_custom_slice_path,
    sanitize_profile_settings_json,
};
#[cfg(test)]
pub(crate) use import_pkg::import_profile_from_file_with_conn;
use path_relink::relink_imported_settings_paths;

use crate::commands::{query_profile_by_id, ImportProfileResult, Profile};
use crate::db::{get_active_profile_id, run_read_query, AppState};
use crate::security::{
    display_leaf, normalize_clean_path, read_bounded_string, validate_archive_export_path,
    validate_hex_color, validate_json_export_path, validate_json_import_path,
    whitelist_and_sanitize_settings, MAX_JSON_IMPORT_BYTES,
};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, Manager, State};

fn invalidate_ai_cache_if_present(app: &AppHandle) {
    if let Some(ai_state) = app.try_state::<crate::ai_tagger::AiTaggerState>() {
        ai_state.invalidate_vector_cache();
    }
}

#[tauri::command]
pub async fn get_profiles(state: State<'_, AppState>) -> Result<Vec<Profile>, String> {
    run_read_query(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, name, color, settings_json, is_active, created_at FROM profiles ORDER BY id ASC")
            .map_err(|e| format!("Query prepare error: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    settings_json: row.get(3)?,
                    is_active: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Query execution error: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    color: String,
    settings_json: String,
) -> Result<Profile, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Profile name cannot be empty".to_string());
        }
        let clean_color = if color.trim().is_empty() {
            "#3B82F6".to_string()
        } else {
            validate_hex_color(&color)?
        };
        let clean_settings = if settings_json.trim().is_empty() {
            "{}".to_string()
        } else {
            sanitize_profile_settings_json(&settings_json)?
        };

        let mut conn = state_owned.lock_db();
        let old_active_id = get_active_profile_id(&conn);
        let old_slice = query_profile_by_id(&conn, old_active_id)
            .ok()
            .and_then(|p| extract_custom_slice_path(&p.settings_json));
        let new_slice = extract_custom_slice_path(&clean_settings);

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start profile transaction: {}", e))?;

        tx.execute("UPDATE profiles SET is_active = 0", [])
            .map_err(|e| format!("Failed to clear active profile flag: {}", e))?;
        tx.execute(
            "INSERT INTO profiles (name, color, settings_json, is_active, created_at)
             VALUES (?1, ?2, ?3, 1, datetime('now'))",
            params![trimmed, clean_color, clean_settings],
        )
        .map_err(|e| format!("Failed to create profile (name may already exist): {}", e))?;

        let new_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT OR IGNORE INTO profile_libraries (profile_id, library_id)
             SELECT ?1, id FROM libraries WHERE is_global = 1",
            params![new_id],
        )
        .map_err(|e| format!("Failed to link global libraries: {}", e))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit created profile: {}", e))?;

        invalidate_ai_cache_if_present(&app);
        let _ = (old_slice, new_slice);
        crate::reconcile_library_asset_scopes(&app, &conn, None);
        query_profile_by_id(&conn, new_id)
    })
    .await
    .map_err(|e| format!("Create profile task failed: {}", e))?
}

pub(crate) fn duplicate_profile_with_conn(
    conn: &mut Connection,
    source_profile_id: i64,
    new_name: &str,
) -> Result<Profile, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("New profile name cannot be empty".to_string());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start duplicate transaction: {}", e))?;

    let src = query_profile_by_id(&tx, source_profile_id)?;
    tx.execute("UPDATE profiles SET is_active = 0", [])
        .map_err(|e| format!("Failed to clear active profile flag: {}", e))?;

    tx.execute(
        "INSERT INTO profiles (name, color, settings_json, is_active, created_at)
         VALUES (?1, ?2, ?3, 1, datetime('now'))",
        params![trimmed, src.color, src.settings_json],
    )
    .map_err(|e| format!("Failed to duplicate profile: {}", e))?;

    let new_profile_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT OR IGNORE INTO profile_libraries (profile_id, library_id)
         SELECT ?1, library_id FROM profile_libraries WHERE profile_id = ?2",
        params![new_profile_id, source_profile_id],
    )
    .map_err(|e| format!("Failed to copy profile libraries: {}", e))?;

    tx.execute(
        "INSERT OR IGNORE INTO profile_favorites (profile_id, sample_id)
         SELECT ?1, sample_id FROM profile_favorites WHERE profile_id = ?2",
        params![new_profile_id, source_profile_id],
    )
    .map_err(|e| format!("Failed to copy profile favorites: {}", e))?;

    type DuplicateColRow = (
        i64,
        String,
        String,
        String,
        Option<i64>,
        Option<String>,
        Option<String>,
    );
    let cols: Vec<DuplicateColRow> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, name, COALESCE(color, '#10B981'), COALESCE(icon, 'layers'), parent_id, rule_path, smart_query
                 FROM collections
                 WHERE profile_id = ?1
                 ORDER BY (CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END), name COLLATE NOCASE ASC",
            )
            .map_err(|e| format!("Failed reading source collections: {}", e))?;
        let rows = stmt
            .query_map(params![source_profile_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            })
            .map_err(|e| format!("Failed querying source collections: {}", e))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut id_map: HashMap<i64, i64> = HashMap::new();
    for (old_col_id, col_name, col_color, col_icon, old_parent_id, rule_path, smart_query) in cols {
        let new_parent_id = old_parent_id.and_then(|pid| id_map.get(&pid).copied());
        let clean_rule = rule_path.map(|rp| normalize_clean_path(&rp));
        tx.execute(
            "INSERT INTO collections (profile_id, parent_id, rule_path, smart_query, name, color, icon, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            params![
                new_profile_id,
                new_parent_id,
                clean_rule,
                smart_query,
                col_name,
                col_color,
                col_icon
            ],
        )
        .map_err(|e| format!("Failed duplicating collection: {}", e))?;
        let new_col_id = tx.last_insert_rowid();
        id_map.insert(old_col_id, new_col_id);
        tx.execute(
            "INSERT OR IGNORE INTO collection_items (collection_id, sample_id)
             SELECT ?1, sample_id FROM collection_items WHERE collection_id = ?2",
            params![new_col_id, old_col_id],
        )
        .map_err(|e| format!("Failed copying collection items: {}", e))?;
    }

    tx.execute(
        "INSERT OR IGNORE INTO sample_slices (
            profile_id, slice_path, slice_name, source_sample_id,
            source_file_path, source_file_name, start_sec, end_sec,
            pitch_semitones, micro_fade, duration_ms, is_favorite,
            peaks_json, sample_rate, channels, bit_depth, created_at
         )
         SELECT ?1, slice_path, slice_name, source_sample_id,
                source_file_path, source_file_name, start_sec, end_sec,
                pitch_semitones, micro_fade, duration_ms, is_favorite,
                peaks_json, sample_rate, channels, bit_depth, created_at
         FROM sample_slices
         WHERE profile_id = ?2 AND COALESCE(is_trashed, 0) = 0",
        params![new_profile_id, source_profile_id],
    )
    .map_err(|e| format!("Failed copying profile slices: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit profile duplication: {}", e))?;
    query_profile_by_id(conn, new_profile_id)
}

#[tauri::command]
pub async fn duplicate_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    source_profile_id: i64,
    new_name: String,
) -> Result<Profile, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        let profile = duplicate_profile_with_conn(&mut conn, source_profile_id, &new_name)?;
        invalidate_ai_cache_if_present(&app);
        crate::reconcile_library_asset_scopes(&app, &conn, None);
        Ok(profile)
    })
    .await
    .map_err(|e| format!("Duplicate profile task failed: {}", e))?
}

#[tauri::command]
pub async fn switch_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: i64,
) -> Result<Profile, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        let old_active_id = get_active_profile_id(&conn);
        let old_slice = query_profile_by_id(&conn, old_active_id)
            .ok()
            .and_then(|p| extract_custom_slice_path(&p.settings_json));
        let old_libs = collect_profile_library_ids(&conn, old_active_id);

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start profile switch transaction: {}", e))?;
        let target = query_profile_by_id(&tx, profile_id)?;
        tx.execute("UPDATE profiles SET is_active = 0", [])
            .map_err(|e| format!("Failed to clear active profile flag: {}", e))?;
        let updated = tx
            .execute(
                "UPDATE profiles SET is_active = 1 WHERE id = ?1",
                params![profile_id],
            )
            .map_err(|e| format!("Failed to update profile: {}", e))?;
        if updated == 0 {
            return Err("Profile not found".to_string());
        }
        tx.commit()
            .map_err(|e| format!("Failed to commit profile switch: {}", e))?;

        let new_slice = extract_custom_slice_path(&target.settings_json);
        let new_libs = collect_profile_library_ids(&conn, profile_id);
        invalidate_ai_cache_if_present(&app);
        let _ = (old_slice, new_slice, old_libs, new_libs);
        crate::reconcile_library_asset_scopes(&app, &conn, None);
        query_profile_by_id(&conn, profile_id)
    })
    .await
    .map_err(|e| format!("Switch profile task failed: {}", e))?
}

#[tauri::command]
pub async fn update_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: i64,
    name: Option<String>,
    color: Option<String>,
    settings_json: Option<String>,
) -> Result<Profile, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_owned.lock_db();
        let current = query_profile_by_id(&conn, profile_id)?;
        let old_slice = extract_custom_slice_path(&current.settings_json);
        let old_layer = extract_custom_layer_path(&current.settings_json);

        let next_name = name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or(current.name);
        let next_color = match color {
            Some(c) if !c.trim().is_empty() => validate_hex_color(&c)?,
            Some(_) => return Err("Profile color cannot be empty".to_string()),
            None => current.color,
        };
        let has_new_settings = settings_json.is_some();
        let next_settings = match settings_json {
            Some(raw) if raw.trim().is_empty() => "{}".to_string(),
            Some(raw) => sanitize_profile_settings_json(&raw)?,
            None => current.settings_json,
        };
        let new_slice = extract_custom_slice_path(&next_settings);
        let new_layer = extract_custom_layer_path(&next_settings);

        conn.execute(
            "UPDATE profiles SET name = ?1, color = ?2, settings_json = ?3 WHERE id = ?4",
            params![next_name, next_color, next_settings, profile_id],
        )
        .map_err(|e| format!("Failed to update profile: {}", e))?;

        if has_new_settings && current.is_active {
            if old_slice != new_slice || old_layer != new_layer {
                crate::reconcile_library_asset_scopes(&app, &conn, None);
            } else {
                crate::library_watcher::reconcile_watcher_if_managed(&app, &conn);
            }
        }

        query_profile_by_id(&conn, profile_id)
    })
    .await
    .map_err(|e| format!("Update profile task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: i64,
) -> Result<Profile, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        let target = query_profile_by_id(&conn, profile_id)?;
        let old_slice = if target.is_active {
            extract_custom_slice_path(&target.settings_json)
        } else {
            None
        };

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start profile delete transaction: {}", e))?;
        let count: i64 = tx
            .query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))
            .unwrap_or(0);
        if count <= 1 {
            return Err("Cannot delete the only remaining workspace profile".to_string());
        }

        let trashed_slice_paths: Vec<String> = tx
            .prepare(
                "SELECT COALESCE(trash_file_path, '') FROM sample_slices
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map(params![profile_id], |r| r.get::<_, String>(0))
                    .ok()
                    .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default();

        let trashed_layer_paths: Vec<String> = tx
            .prepare(
                "SELECT COALESCE(trash_file_path, '') FROM layer_history
                 WHERE profile_id = ?1 AND COALESCE(is_trashed, 0) = 1",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map(params![profile_id], |r| r.get::<_, String>(0))
                    .ok()
                    .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default();

        let deleted = tx
            .execute("DELETE FROM profiles WHERE id = ?1", params![profile_id])
            .map_err(|e| format!("Failed to delete profile: {}", e))?;
        if deleted == 0 {
            return Err("Profile not found".to_string());
        }

        let has_active: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM profiles WHERE is_active = 1)",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if !has_active {
            tx.execute(
                "UPDATE profiles SET is_active = 1 WHERE id = (SELECT id FROM profiles ORDER BY id ASC LIMIT 1)",
                [],
            )
            .map_err(|e| format!("Failed to activate fallback profile: {}", e))?;
        }
        tx.commit()
            .map_err(|e| format!("Failed to commit profile deletion: {}", e))?;

        let slice_trash_dir = state_owned.user_dir.join("cache").join("slice_trash");
        if let Ok(canon_trash) = slice_trash_dir.canonicalize() {
            for raw_tp in trashed_slice_paths {
                let tp = raw_tp.trim();
                if tp.is_empty()
                    || crate::security::is_unc_or_network_path(tp)
                    || crate::security::has_ntfs_ads_colon(tp)
                {
                    continue;
                }
                if let Ok(meta) = fs::symlink_metadata(tp) {
                    if !meta.file_type().is_symlink() && meta.is_file() {
                        if let Ok(canon) = fs::canonicalize(tp) {
                            if canon.starts_with(&canon_trash) {
                                let _ = fs::remove_file(tp);
                            }
                        }
                    }
                }
            }
        }

        for raw_ltp in trashed_layer_paths {
            crate::commands::layers::cleanup_quarantined_layer_file_if_present(
                &state_owned.user_dir,
                Some(&raw_ltp),
            );
        }

        let active_id = get_active_profile_id(&conn);
        invalidate_ai_cache_if_present(&app);
        crate::reconcile_library_asset_scopes(&app, &conn, old_slice.as_deref());
        query_profile_by_id(&conn, active_id)
    })
    .await
    .map_err(|e| format!("Delete profile task failed: {}", e))?
}

#[tauri::command]
pub async fn export_settings_to_file(
    file_path: String,
    settings_json: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = validate_json_export_path(&file_path)?;
        let parsed: serde_json::Value = serde_json::from_str(&settings_json)
            .map_err(|e| format!("Invalid JSON in settings file: {}", e))?;

        let sanitized = whitelist_and_sanitize_settings(&parsed, false, false)?;

        let pretty = serde_json::to_string_pretty(&sanitized)
            .map_err(|e| format!("Failed to serialize settings JSON: {}", e))?;
        fs::write(&target_path, pretty)
            .map_err(|_| format!("Failed to write settings file {}", display_leaf(&target_path)))
    })
    .await
    .map_err(|e| format!("Export settings task failed: {}", e))?
}

pub(crate) fn import_settings_from_file_with_conn(
    conn: &Connection,
    file_path: &str,
) -> Result<Profile, String> {
    let validated_path = validate_json_import_path(file_path)?;
    let content = read_bounded_string(&validated_path, MAX_JSON_IMPORT_BYTES)?;
    let val: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in settings file: {}", e))?;

    let mut settings_obj = whitelist_and_sanitize_settings(&val, true, true)?;
    let mut current_lib_paths: Vec<String> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM libraries") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            current_lib_paths.extend(rows.flatten().map(|p| normalize_clean_path(&p)));
        }
    }
    let _ = relink_imported_settings_paths(&mut settings_obj, &[], &current_lib_paths);
    let serialized = serde_json::to_string(&settings_obj)
        .map_err(|e| format!("Failed to serialize imported settings: {}", e))?;

    let active_id = get_active_profile_id(conn);
    conn.execute(
        "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
        params![serialized, active_id],
    )
    .map_err(|e| format!("Failed to save imported settings to active profile: {}", e))?;

    query_profile_by_id(conn, active_id)
}

#[tauri::command]
pub async fn import_settings_from_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<Profile, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_owned.lock_db();
        let profile = import_settings_from_file_with_conn(&conn, &file_path)?;
        crate::reconcile_library_asset_scopes(&app_clone, &conn, None);
        Ok(profile)
    })
    .await
    .map_err(|e| format!("Settings import task failed: {}", e))?
}

#[tauri::command]
pub async fn export_profile_to_file(
    state: State<'_, AppState>,
    profile_id: i64,
    file_path: String,
    share_safe: Option<bool>,
    include_ai_tags: Option<bool>,
) -> Result<(), String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = validate_archive_export_path(
            &file_path,
            PROFILE_ARCHIVE_SUFFIXES,
            "Export file path must end with .audify-profile or .json",
        )?;
        let mut pkg = {
            if let Ok(read_conn) = state_owned.acquire_read_conn() {
                let (_, pkg) = build_profile_export_package_with_options(
                    &read_conn,
                    profile_id,
                    include_ai_tags.unwrap_or(false),
                )?;
                pkg
            } else {
                let conn = state_owned.lock_db();
                let (_, pkg) = build_profile_export_package_with_options(
                    &conn,
                    profile_id,
                    include_ai_tags.unwrap_or(false),
                )?;
                pkg
            }
        };
        if share_safe.unwrap_or(false) {
            apply_share_safe(&mut pkg);
        }
        write_profile_package_to_path(&pkg, &target_path).map_err(|e| {
            format!(
                "Failed to write profile export {}: {}",
                display_leaf(&target_path),
                e
            )
        })?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Profile export task failed: {}", e))?
}

#[tauri::command]
pub async fn import_profile_from_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<ImportProfileResult, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        let old_active_id = get_active_profile_id(&conn);
        let old_slice = query_profile_by_id(&conn, old_active_id)
            .ok()
            .and_then(|p| extract_custom_slice_path(&p.settings_json));
        let res = import_pkg::import_profile_from_file_with_user_dir(
            &mut conn,
            Some(&state_owned.user_dir),
            &file_path,
        )?;
        let new_slice = extract_custom_slice_path(&res.profile.settings_json);
        invalidate_ai_cache_if_present(&app_clone);
        let removed = old_slice
            .as_deref()
            .filter(|old_s| new_slice.as_deref() != Some(*old_s));
        crate::reconcile_library_asset_scopes(&app_clone, &conn, removed);
        Ok(res)
    })
    .await
    .map_err(|e| {
        crate::security::sanitize_err(&user_dir_err, &format!("Profile import task failed: {}", e))
    })?
}