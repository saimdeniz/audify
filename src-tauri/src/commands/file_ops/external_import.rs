use super::folder_ops::{resolve_destination_filename, DestinationCollisionCtx};
use crate::commands::file_ops::{
    find_identical_file_in_dir, is_same_folder_path, validate_writable_library_folder,
    DroppedAudioFilePayload, FileCollisionItem, FolderDropResult,
};
use crate::db::AppState;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path, sanitize_err,
    strip_verbatim_prefix, validate_safe_audio_stem,
};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

static DROP_STAGE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
const MAX_STAGE_DROP_FILES: usize = 250;
const MAX_STAGE_DROP_FILE_BYTES: usize = 256 * 1024 * 1024;
const MAX_STAGE_DROP_TOTAL_BYTES: usize = 1024 * 1024 * 1024;

enum ExternalCopyOutcome {
    EarlyConflict(FolderDropResult),
    Copied {
        copied_dst_paths: Vec<PathBuf>,
        skipped_duplicates: Vec<String>,
        skipped_same_folder: usize,
        skipped_unsupported: usize,
        skipped_conflicts: usize,
    },
}

fn execute_external_copy_disk(
    library_id: i64,
    target_dir_pb: &Path,
    norm_target_folder: &str,
    external_paths: &[String],
    conflict_policy: &str,
    user_dir: &Path,
) -> Result<ExternalCopyOutcome, String> {
    let policy = conflict_policy.trim().to_lowercase();
    let mut candidate_files: Vec<PathBuf> = Vec::new();
    let mut skipped_unsupported = 0usize;

    for raw in external_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
            skipped_unsupported += 1;
            continue;
        }
        let pb = PathBuf::from(trimmed);
        let Ok(sym_meta) = fs::symlink_metadata(&pb) else {
            continue;
        };
        if sym_meta.file_type().is_symlink() {
            skipped_unsupported += 1;
            continue;
        }
        if sym_meta.file_type().is_file() {
            let ext = pb
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            if crate::scanner::SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                candidate_files.push(pb);
            } else {
                skipped_unsupported += 1;
            }
        } else if sym_meta.file_type().is_dir() {
            for entry in walkdir::WalkDir::new(&pb)
                .follow_links(false)
                .max_depth(8)
                .max_open(32)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if candidate_files.len() >= 10_000 {
                    break;
                }
                if entry.file_type().is_file() {
                    let ep = entry.path();
                    let ext = ep
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|s| s.to_lowercase())
                        .unwrap_or_default();
                    if crate::scanner::SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                        candidate_files.push(ep.to_path_buf());
                    } else {
                        skipped_unsupported += 1;
                    }
                }
            }
        }
    }

    let mut conflicts: Vec<FileCollisionItem> = Vec::new();
    let mut skipped_duplicates = Vec::new();
    let mut skipped_same_folder = 0usize;
    let mut skipped_conflicts = 0usize;
    let mut copy_plans: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut reserved_names_lower: HashSet<String> = HashSet::new();

    for src_pb in candidate_files {
        let Ok(canon_src) = src_pb.canonicalize() else {
            continue;
        };
        if is_unc_or_network_path(&canon_src.to_string_lossy()) {
            continue;
        }
        let clean_src = strip_verbatim_prefix(&canon_src);
        let norm_src = normalize_clean_path(&clean_src.to_string_lossy());
        let src_parent = crate::commands::parent_folder_path(&norm_src);

        if is_same_folder_path(&src_parent, norm_target_folder) {
            skipped_same_folder += 1;
            continue;
        }

        let Some(file_name) = clean_src
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
        else {
            continue;
        };

        if let Some(existing_dup_name) = find_identical_file_in_dir(&clean_src, target_dir_pb) {
            skipped_duplicates.push(existing_dup_name);
            continue;
        }

        let Some(final_name) = resolve_destination_filename(
            &mut DestinationCollisionCtx {
                target_dir_pb,
                norm_target_folder,
                policy: policy.as_str(),
                reserved_names_lower: &mut reserved_names_lower,
                conflicts: &mut conflicts,
                skipped_conflicts: &mut skipped_conflicts,
            },
            &clean_src,
            &norm_src,
            None,
            &file_name,
        ) else {
            continue;
        };

        let final_dst = target_dir_pb.join(&final_name);
        copy_plans.push((clean_src, final_dst));
    }

    if !conflicts.is_empty() && policy != "skip" && policy != "keep_both" {
        return Ok(ExternalCopyOutcome::EarlyConflict(FolderDropResult {
            status: "conflict".to_string(),
            target_library_id: library_id,
            target_folder_path: norm_target_folder.to_string(),
            moved_records: Vec::new(),
            imported_sample_ids: Vec::new(),
            conflicts,
            skipped_duplicates,
            skipped_same_folder,
            skipped_unsupported,
            skipped_conflicts,
        }));
    }

    let mut copied_dst_paths: Vec<PathBuf> = Vec::new();
    for (src_pb, dst_pb) in &copy_plans {
        if let Err(e) = fs::copy(src_pb, dst_pb) {
            for created in &copied_dst_paths {
                let _ = fs::remove_file(created);
            }
            return Err(format!(
                "Failed to copy '{}' to target folder: {}",
                display_leaf(src_pb),
                sanitize_err(user_dir, &e.to_string())
            ));
        }
        copied_dst_paths.push(dst_pb.clone());
    }

    Ok(ExternalCopyOutcome::Copied {
        copied_dst_paths,
        skipped_duplicates,
        skipped_same_folder,
        skipped_unsupported,
        skipped_conflicts,
    })
}

fn commit_external_import_db(
    conn: &mut Connection,
    norm_lib_path: &str,
    norm_target_folder: String,
    library_id: i64,
    outcome: ExternalCopyOutcome,
) -> Result<FolderDropResult, String> {
    let ExternalCopyOutcome::Copied {
        copied_dst_paths,
        skipped_duplicates,
        skipped_same_folder,
        skipped_unsupported,
        skipped_conflicts,
    } = outcome
    else {
        unreachable!("EarlyConflict handled before commit_external_import_db");
    };

    let mut imported_sample_ids = Vec::new();
    if !copied_dst_paths.is_empty() {
        crate::commands::libraries::sync_library_with_conn(
            conn,
            norm_lib_path,
            Some(&norm_target_folder),
            false,
        )?;

        for dst_pb in &copied_dst_paths {
            let norm_dst = normalize_clean_path(&dst_pb.to_string_lossy());
            let sid_opt: Option<i64> = if cfg!(windows) {
                conn.query_row(
                    "SELECT id FROM samples WHERE LOWER(file_path) = LOWER(?1) LIMIT 1",
                    params![norm_dst],
                    |r| r.get(0),
                )
                .ok()
            } else {
                conn.query_row(
                    "SELECT id FROM samples WHERE file_path = ?1 LIMIT 1",
                    params![norm_dst],
                    |r| r.get(0),
                )
                .ok()
            };
            if let Some(sid) = sid_opt {
                imported_sample_ids.push(sid);
            }
        }
    }

    Ok(FolderDropResult {
        status: "ok".to_string(),
        target_library_id: library_id,
        target_folder_path: norm_target_folder,
        moved_records: Vec::new(),
        imported_sample_ids,
        conflicts: Vec::new(),
        skipped_duplicates,
        skipped_same_folder,
        skipped_unsupported,
        skipped_conflicts,
    })
}

#[tauri::command]
pub async fn stage_dropped_audio_files(
    state: State<'_, AppState>,
    files: Vec<DroppedAudioFilePayload>,
) -> Result<Vec<String>, String> {
    let user_dir = state.user_dir.clone();
    let user_dir_err = user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if files.is_empty() {
            return Ok(Vec::new());
        }
        if files.len() > MAX_STAGE_DROP_FILES {
            return Err(format!(
                "Too many dropped files ({}). Maximum per drop batch is {}.",
                files.len(),
                MAX_STAGE_DROP_FILES
            ));
        }

        let mut total_bytes: usize = 0;
        for item in &files {
            if item.bytes.len() > MAX_STAGE_DROP_FILE_BYTES {
                return Err(format!(
                    "Dropped file '{}' exceeds maximum allowed size (256 MB).",
                    display_leaf(Path::new(&item.file_name))
                ));
            }
            total_bytes = total_bytes
                .checked_add(item.bytes.len())
                .ok_or_else(|| "Dropped batch size overflow".to_string())?;
            if total_bytes > MAX_STAGE_DROP_TOTAL_BYTES {
                return Err(
                    "Total dropped batch exceeds maximum allowed size (1 GB).".to_string()
                );
            }
        }

        let staging_root = user_dir.join("cache").join("drop_staging");
        if let Ok(rd) = fs::read_dir(&staging_root) {
            let now = std::time::SystemTime::now();
            for item in rd.flatten() {
                if let Ok(meta) = item.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if now.duration_since(modified).unwrap_or_default().as_secs() > 600 {
                            let _ = fs::remove_dir_all(item.path());
                        }
                    }
                }
            }
        }
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let seq = DROP_STAGE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let batch_dir = staging_root.join(format!("batch_{}_{}", millis, seq));
        fs::create_dir_all(&batch_dir).map_err(|e| {
            format!(
                "Failed to create drop staging folder: {}",
                sanitize_err(&user_dir, &e.to_string())
            )
        })?;

        let mut staged_paths = Vec::with_capacity(files.len());
        for item in files {
            let raw_name = item.file_name.trim();
            if raw_name.is_empty() {
                continue;
            }
            // Strip any path separators before reading stem/extension
            let leaf_name = Path::new(raw_name)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(raw_name);
            let pb = Path::new(leaf_name);
            let Some(stem) = pb.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let ext = pb
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            if !crate::scanner::SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            let safe_stem =
                validate_safe_audio_stem(stem).unwrap_or_else(|_| "Sample".to_string());
            let mut clean_name = format!("{}.{}", safe_stem, ext);
            let mut target_pb = batch_dir.join(&clean_name);
            let mut suffix = 1usize;
            while target_pb.exists() {
                clean_name = format!("{}_{}.{}", safe_stem, suffix, ext);
                target_pb = batch_dir.join(&clean_name);
                suffix += 1;
            }
            fs::write(&target_pb, &item.bytes).map_err(|e| {
                format!(
                    "Failed to stage dropped file '{}': {}",
                    clean_name,
                    sanitize_err(&user_dir, &e.to_string())
                )
            })?;
            staged_paths.push(normalize_clean_path(&target_pb.to_string_lossy()));
        }
        Ok(staged_paths)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Stage task join error: {}", e)))?
}

#[tauri::command]
pub async fn import_external_files_to_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    library_id: i64,
    target_folder_path: String,
    external_paths: Vec<String>,
    conflict_policy: Option<String>,
) -> Result<FolderDropResult, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let state_owned = state.inner().clone();
    let user_dir_err = state_owned.user_dir.clone();
    let policy = conflict_policy.unwrap_or_else(|| "prompt".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let (norm_lib_path, _, target_dir_pb, norm_target_folder) = {
            let conn = state_owned.lock_db();
            validate_writable_library_folder(&conn, library_id, &target_folder_path)?
        };
        let outcome = execute_external_copy_disk(
            library_id,
            &target_dir_pb,
            &norm_target_folder,
            &external_paths,
            &policy,
            &state_owned.user_dir,
        )?;
        if let ExternalCopyOutcome::EarlyConflict(conflict) = outcome {
            return Ok(conflict);
        }
        let mut conn = state_owned.lock_db();
        commit_external_import_db(&mut conn, &norm_lib_path, norm_target_folder, library_id, outcome)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Import task join error: {}", e)))?
}