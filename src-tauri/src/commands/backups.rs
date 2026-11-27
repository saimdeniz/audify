use super::profiles::{
    build_profile_export_package_with_options, read_profile_backup_summary,
    write_profile_package_to_path,
};
use super::snapshot::read_snapshot_manifest_summary;
use super::BackupFileInfo;
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    ensure_inside, has_ntfs_ads_colon, is_unc_or_network_path, open_directory_in_shell,
    reject_symlink_ancestors, sanitize_err,
};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

static QUICK_BACKUP_NONCE: AtomicU64 = AtomicU64::new(1);

fn is_profile_backup_filename(fname: &str) -> bool {
    let lower = fname.to_ascii_lowercase();
    lower.ends_with(".audify-profile") || lower.ends_with(".audify-profile.json")
}

fn is_snapshot_backup_filename(fname: &str) -> bool {
    fname.to_ascii_lowercase().ends_with(".audify-backup.zip")
}

fn list_backups_from_dir(user_dir: &Path) -> Result<Vec<BackupFileInfo>, String> {
    let backups_dir = user_dir.join("backups");
    let _ = fs::create_dir_all(&backups_dir);

    let mut list = Vec::new();
    let entries = match fs::read_dir(&backups_dir) {
        Ok(e) => e,
        Err(_) => return Ok(list),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.file_type().is_file() {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_string();
        let is_snapshot = is_snapshot_backup_filename(&fname);
        let is_profile = is_profile_backup_filename(&fname);
        if !is_snapshot && !is_profile {
            continue;
        }

        let file_size = meta.len() as i64;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        if is_snapshot {
            if let Ok(manifest) = read_snapshot_manifest_summary(&path) {
                list.push(BackupFileInfo {
                    file_name: fname,
                    file_path: path.to_string_lossy().to_string(),
                    profile_name: format!("All Profiles ({})", manifest.profile_count),
                    created_at: manifest.created_at,
                    timestamp_ms: modified_ms,
                    file_size,
                    is_auto: false,
                    kind: "snapshot".to_string(),
                    sample_count: manifest.sample_count,
                    includes_ai_tags: true,
                });
            }
            continue;
        }

        let is_auto = fname.starts_with("auto_");
        let summary = read_profile_backup_summary(&path);
        let created_at = fname
            .trim_end_matches(".audify-profile.json")
            .trim_end_matches(".audify-profile")
            .to_string();

        list.push(BackupFileInfo {
            file_name: fname,
            file_path: path.to_string_lossy().to_string(),
            profile_name: summary.name,
            created_at,
            timestamp_ms: modified_ms,
            file_size,
            is_auto,
            kind: "profile".to_string(),
            sample_count: summary.sample_count,
            includes_ai_tags: summary.includes_ai_tags,
        });
    }

    list.sort_by_key(|a| std::cmp::Reverse(a.timestamp_ms));
    Ok(list)
}

#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupFileInfo>, String> {
    let user_dir = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || list_backups_from_dir(&user_dir))
        .await
        .map_err(|e| format!("Backup list task join error: {}", e))?
}

#[tauri::command]
pub async fn create_quick_backup(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    is_auto: Option<bool>,
    include_ai_tags: Option<bool>,
) -> Result<BackupFileInfo, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (profile, pkg, ts_str) = {
            let conn = state_owned.lock_db();
            let pid = profile_id.unwrap_or_else(|| get_active_profile_id(&conn));
            let (profile, pkg) =
                build_profile_export_package_with_options(&conn, pid, include_ai_tags.unwrap_or(true))
                    .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
            let ts: String = conn
                .query_row(
                    "SELECT strftime('%Y-%m-%d_%H-%M-%S', 'now', 'localtime')",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| {
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis().to_string())
                        .unwrap_or_else(|_| "0".to_string())
                });
            (profile, pkg, ts)
        };

        let backups_dir = state_owned.user_dir.join("backups");
        fs::create_dir_all(&backups_dir).map_err(|e| {
            format!(
                "Failed to create AppData directory: {}",
                sanitize_err(&state_owned.user_dir, &e.to_string())
            )
        })?;

        let auto_flag = is_auto.unwrap_or(false);
        let prefix = if auto_flag { "auto" } else { "quick" };
        let slug: String = profile
            .name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '_' })
            .collect();

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let mut file_name = format!("{}_{}_{}.audify-profile", prefix, slug, ts_str);
        let mut file_path = backups_dir.join(&file_name);
        if fs::symlink_metadata(&file_path).is_ok() {
            let nonce = QUICK_BACKUP_NONCE.fetch_add(1, Ordering::Relaxed);
            file_name = format!("{}_{}_{}_{}.audify-profile", prefix, slug, ts_str, nonce);
            file_path = backups_dir.join(&file_name);
        }
        let file_size = write_profile_package_to_path(&pkg, &file_path)
            .map_err(|e| sanitize_err(&state_owned.user_dir, &e))? as i64;

        if auto_flag {
            if let Ok(entries) = fs::read_dir(&backups_dir) {
                let mut auto_files: Vec<(std::path::PathBuf, u128)> = entries
                    .flatten()
                    .filter_map(|e| {
                        let fname = e.file_name().to_string_lossy().to_string();
                        if fname.starts_with("auto_") && is_profile_backup_filename(&fname) {
                            let m = e
                                .metadata()
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_millis())
                                .unwrap_or(0);
                            Some((e.path(), m))
                        } else {
                            None
                        }
                    })
                    .collect();
                auto_files.sort_by_key(|a| std::cmp::Reverse(a.1));
                for (old_path, _) in auto_files.into_iter().skip(15) {
                    let _ = fs::remove_file(old_path);
                }
            }
        }

        Ok(BackupFileInfo {
            file_name,
            file_path: file_path.to_string_lossy().to_string(),
            profile_name: profile.name,
            created_at: ts_str,
            timestamp_ms: now_ms,
            file_size,
            is_auto: auto_flag,
            kind: "profile".to_string(),
            sample_count: pkg.sample_refs.len() as i64,
            includes_ai_tags: pkg.includes_ai_tags,
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Quick backup task failed: {}", e)))?
}

#[tauri::command]
pub async fn delete_backup_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let user_dir = state.user_dir.clone();
    let user_dir_err = user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if is_unc_or_network_path(&file_path) {
            return Err("Network and UNC paths are not allowed".to_string());
        }
        if has_ntfs_ads_colon(&file_path) {
            return Err("Alternate data streams are not allowed".to_string());
        }
        let p = Path::new(&file_path);
        reject_symlink_ancestors(p)?;
        match fs::symlink_metadata(p) {
            Ok(sym) if sym.file_type().is_symlink() => {
                return Err("Symbolic links and junctions are not allowed".to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(());
            }
            Err(_) => {
                return Err("Failed to inspect backup file".to_string());
            }
            Ok(_) => {}
        }
        let safe = ensure_inside(&user_dir.join("backups"), p)?;
        let valid_ext = safe
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| {
                let lower = n.to_ascii_lowercase();
                lower.ends_with(".json")
                    || lower.ends_with(".audify-profile")
                    || lower.ends_with(".audify-backup.zip")
            })
            .unwrap_or(false);
        if !valid_ext {
            return Err("Only Audify backup files can be deleted here".to_string());
        }
        fs::remove_file(safe).map_err(|e| sanitize_err(&user_dir, &e.to_string()))
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Backup delete task failed: {}", e)))?
}

#[tauri::command]
pub async fn open_backups_folder(state: State<'_, AppState>) -> Result<(), String> {
    let user_dir = state.user_dir.clone();
    let user_dir_err = user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let backups_dir = user_dir.join("backups");
        fs::create_dir_all(&backups_dir).map_err(|e| {
            format!(
                "Failed to create backups folder: {}",
                sanitize_err(&user_dir, &e.to_string())
            )
        })?;
        open_directory_in_shell(&backups_dir)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Open backups folder failed: {}", e)))?
}
