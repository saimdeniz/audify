use super::folders::validate_and_resolve_scan_paths;
use super::sync_commit::commit_synced_samples_with_status;
use crate::commands::Library;
use crate::db::{get_active_profile_id, AppState, AutoTagCategoryConfig, AutoTagRule};
use crate::scanner::{
    parse_rules_from_settings, path_lookup_key, scan_directory_with_progress, ExistingFileMeta,
    ScanProgressPayload,
};
use crate::security::ensure_not_inside_user_dir;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone)]
pub(super) struct ExistingSampleEntry {
    pub(super) id: i64,
    pub(super) db_file_path: String,
    pub(super) file_size: i64,
    pub(super) file_modified_at: Option<i64>,
}

type PreparedSyncTuple = (
    i64,
    i64,
    HashMap<String, ExistingSampleEntry>,
    Vec<AutoTagRule>,
    HashMap<String, AutoTagCategoryConfig>,
);

pub(super) fn prepare_sync_db_state(
    conn: &Connection,
    safe_root: &Path,
    norm_lib_path: &str,
    norm_scan_prefix: &str,
) -> Result<PreparedSyncTuple, String> {
    let lib_name = safe_root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Audio Library")
        .to_string();

    // Prevent case-duplicate libraries on Windows by looking up LOWER(path) first.
    let existing_lib: Option<(i64, String)> = if cfg!(windows) {
        conn.query_row(
            "SELECT id, path FROM libraries WHERE LOWER(path) = LOWER(?1) LIMIT 1",
            params![norm_lib_path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()
    } else {
        conn.query_row(
            "SELECT id, path FROM libraries WHERE path = ?1 LIMIT 1",
            params![norm_lib_path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()
    };

    let lib_id = if let Some((existing_id, old_path)) = existing_lib {
        conn.execute(
            "UPDATE libraries SET path = ?1, name = ?2, last_scanned_at = datetime('now') WHERE id = ?3",
            params![norm_lib_path, lib_name, existing_id],
        )
        .map_err(|e| format!("Failed to update library: {}", e))?;
        let _ = old_path;
        existing_id
    } else {
        conn.execute(
            "INSERT INTO libraries (path, name, last_scanned_at, is_global)
             VALUES (?1, ?2, datetime('now'), 1)
             ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                last_scanned_at = datetime('now')",
            params![norm_lib_path, lib_name],
        )
        .map_err(|e| format!("Failed to upsert library: {}", e))?;
        conn.query_row(
            "SELECT id FROM libraries WHERE path = ?1",
            params![norm_lib_path],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to fetch library id: {}", e))?
    };

    let active_id = get_active_profile_id(conn);
    let _ = conn.execute(
        "INSERT OR IGNORE INTO profile_libraries (profile_id, library_id) VALUES (?1, ?2)",
        params![active_id, lib_id],
    );

    let settings_json: String = conn
        .query_row(
            "SELECT settings_json FROM profiles WHERE id = ?1",
            params![active_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "{}".to_string());
    let (rules, categories) = parse_rules_from_settings(&settings_json);

    let escaped_prefix = norm_scan_prefix
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let like_pattern = format!("{}/%", escaped_prefix);

    let mut existing: HashMap<String, ExistingSampleEntry> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, file_size, file_modified_at
             FROM samples
             WHERE library_id = ?1
               AND COALESCE(is_trashed, 0) = 0
               AND (LOWER(file_path) = LOWER(?2) OR LOWER(file_path) LIKE LOWER(?3) ESCAPE '\\')",
        )
        .map_err(|e| format!("Failed to query existing samples in scope: {}", e))?;

    let rows = stmt
        .query_map(params![lib_id, norm_scan_prefix, like_pattern], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to read existing samples in scope: {}", e))?;

    for (id, fp, fs, fma) in rows.flatten() {
        existing.insert(
            path_lookup_key(&fp),
            ExistingSampleEntry {
                id,
                db_file_path: fp,
                file_size: fs,
                file_modified_at: fma,
            },
        );
    }

    Ok((lib_id, active_id, existing, rules, categories))
}

/// Core synchronous library sync helper callable from internal commands and unit tests.
pub(crate) fn sync_library_with_conn(
    conn: &mut Connection,
    library_path: &str,
    target_folder: Option<&str>,
    force_rebuild: bool,
) -> Result<Library, String> {
    let (lib, _) =
        sync_library_with_conn_and_status(conn, library_path, target_folder, force_rebuild)?;
    Ok(lib)
}

pub(crate) fn sync_library_with_conn_and_status(
    conn: &mut Connection,
    library_path: &str,
    target_folder: Option<&str>,
    force_rebuild: bool,
) -> Result<(Library, bool), String> {
    let (safe_root, norm_lib_path, scan_dir, norm_scan_prefix) =
        validate_and_resolve_scan_paths(library_path, target_folder)?;

    let (lib_id, active_profile_id, existing_entries, rules, categories) =
        prepare_sync_db_state(conn, &safe_root, &norm_lib_path, &norm_scan_prefix)?;

    let existing_meta: HashMap<String, ExistingFileMeta> = existing_entries
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                ExistingFileMeta {
                    file_size: v.file_size,
                    file_modified_at: v.file_modified_at,
                },
            )
        })
        .collect();

    let scan_output = scan_directory_with_progress(
        &norm_lib_path,
        &scan_dir,
        &existing_meta,
        force_rebuild,
        &rules,
        &categories,
        |_| {},
    );

    commit_synced_samples_with_status(
        conn,
        lib_id,
        active_profile_id,
        target_folder.is_none(),
        force_rebuild,
        &existing_entries,
        &scan_output.scanned_samples,
        &scan_output.seen_paths,
        &scan_output.mtime_backfills,
        &rules,
    )
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackgroundLibrarySyncResult {
    pub library: Library,
    pub changed: bool,
}

pub(crate) async fn run_incremental_sync_owned(
    app: AppHandle,
    state_owned: AppState,
    library_path: String,
    target_folder: Option<String>,
    force: bool,
    emit_progress: bool,
) -> Result<(Library, bool), String> {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (safe_root, norm_lib_path, scan_dir, norm_scan_prefix) =
            validate_and_resolve_scan_paths(&library_path, target_folder.as_deref())?;
        ensure_not_inside_user_dir(&state_owned.user_dir, &safe_root)?;

        let _ = app_clone.asset_protocol_scope().allow_directory(&safe_root, true);

        let (lib_id, active_profile_id, existing_entries, rules, categories) = {
            let conn = state_owned.lock_db();
            prepare_sync_db_state(&conn, &safe_root, &norm_lib_path, &norm_scan_prefix)?
        };

        let existing_meta: HashMap<String, ExistingFileMeta> = existing_entries
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    ExistingFileMeta {
                        file_size: v.file_size,
                        file_modified_at: v.file_modified_at,
                    },
                )
            })
            .collect();

        let app_prog = app_clone.clone();
        let scan_output = scan_directory_with_progress(
            &norm_lib_path,
            &scan_dir,
            &existing_meta,
            force,
            &rules,
            &categories,
            |payload: ScanProgressPayload| {
                if emit_progress {
                    let _ = app_prog.emit("scan-progress", payload);
                }
            },
        );

        let mut conn = state_owned.lock_db();
        let (updated, changed) = commit_synced_samples_with_status(
            &mut conn,
            lib_id,
            active_profile_id,
            target_folder.is_none(),
            force,
            &existing_entries,
            &scan_output.scanned_samples,
            &scan_output.seen_paths,
            &scan_output.mtime_backfills,
            &rules,
        )?;
        if changed {
            app_clone
                .state::<crate::ai_tagger::AiTaggerState>()
                .invalidate_vector_cache();
        }
        Ok((updated, changed))
    })
    .await
    .map_err(|e| format!("Scanner thread join error: {}", e))?
}

#[tauri::command]
pub async fn sync_library_incremental(
    app: AppHandle,
    state: State<'_, AppState>,
    library_path: String,
    target_folder: Option<String>,
    force_rebuild: Option<bool>,
) -> Result<Library, String> {
    let _watcher_guard = crate::library_watcher::ManualScanWatcherGuard::enter(&app);
    let force = force_rebuild.unwrap_or(false);
    let state_owned = state.inner().clone();
    let (updated, _) = run_incremental_sync_owned(
        app.clone(),
        state_owned,
        library_path,
        target_folder,
        force,
        true,
    )
    .await?;
    {
        let conn = state.lock_db();
        crate::reconcile_library_asset_scopes(&app, &conn, None);
    }
    Ok(updated)
}

#[tauri::command]
pub async fn sync_library_background(
    app: AppHandle,
    state: State<'_, AppState>,
    library_path: String,
) -> Result<BackgroundLibrarySyncResult, String> {
    let _watcher_guard = crate::library_watcher::ManualScanWatcherGuard::enter(&app);
    let (library, changed) = run_incremental_sync_owned(
        app.clone(),
        state.inner().clone(),
        library_path,
        None,
        false,
        false,
    )
    .await?;
    Ok(BackgroundLibrarySyncResult { library, changed })
}