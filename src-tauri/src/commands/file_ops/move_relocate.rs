mod relocate;

use super::folder_ops::{resolve_destination_filename, DestinationCollisionCtx};
use crate::ai_tagger::AiTaggerState;
use crate::commands::file_ops::{
    find_identical_file_in_dir, is_same_folder_path, move_file_resilient, prune_file_ops_journal,
    rollback_disk_moves, validate_writable_library_folder, FileCollisionItem, FolderDropResult,
    MovedSampleRecord, SampleRelocateEntry,
};
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    has_ntfs_ads_colon, normalize_clean_path, sanitize_err, AuthorizedAudioScope,
};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

struct MoveCandidate {
    sample_id: i64,
    old_library_id: i64,
    resolved_src: PathBuf,
    norm_src: String,
    file_name: String,
}

struct MovePlan {
    sample_id: i64,
    old_library_id: i64,
    src_pb: PathBuf,
    dst_pb: PathBuf,
    norm_old_path: String,
    norm_new_path: String,
    old_name: String,
    new_name: String,
}

enum MoveDiskOutcome {
    EarlyConflict(FolderDropResult),
    Moved {
        plans: Vec<MovePlan>,
        completed_disk_moves: Vec<(PathBuf, PathBuf)>,
        skipped_duplicates: Vec<String>,
        skipped_same_folder: usize,
        skipped_conflicts: usize,
    },
}

fn load_move_candidates(
    conn: &Connection,
    user_dir: &Path,
    sample_ids: &[i64],
    target_library_id: i64,
    target_folder_path: &str,
) -> Result<(PathBuf, String, Vec<MoveCandidate>), String> {
    let (_, _, target_dir_pb, norm_target_folder) =
        validate_writable_library_folder(conn, target_library_id, target_folder_path)?;

    let active_id = get_active_profile_id(conn);
    let audio_scope = AuthorizedAudioScope::from_conn(conn, user_dir);
    let mut candidates = Vec::with_capacity(sample_ids.len());
    for &sid in sample_ids {
        let Ok((old_lib_id, file_path, file_name, is_trashed, src_lib_name, src_lib_ro)) = conn
            .query_row(
                "SELECT s.library_id, s.file_path, s.file_name, COALESCE(s.is_trashed, 0),
                        l.name, COALESCE(l.is_read_only, 0)
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE s.id = ?1
                   AND (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2))",
                params![sid, active_id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, bool>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, bool>(5)?,
                    ))
                },
            )
        else {
            continue;
        };

        if is_trashed {
            continue;
        }
        if src_lib_ro {
            return Err(format!(
                "Source library '{}' is locked as a Protected Read-Only Vault. Unlock it before moving files out of it.",
                src_lib_name
            ));
        }

        let resolved_src = audio_scope.validate_audio_path(&file_path)?;
        let norm_src = normalize_clean_path(&resolved_src.to_string_lossy());
        candidates.push(MoveCandidate {
            sample_id: sid,
            old_library_id: old_lib_id,
            resolved_src,
            norm_src,
            file_name,
        });
    }

    Ok((target_dir_pb, norm_target_folder, candidates))
}

fn execute_move_disk(
    user_dir: &Path,
    target_library_id: i64,
    target_dir_pb: &Path,
    norm_target_folder: &str,
    candidates: &[MoveCandidate],
    conflict_policy: &str,
) -> Result<MoveDiskOutcome, String> {
    let policy = conflict_policy.trim().to_lowercase();
    let mut conflicts: Vec<FileCollisionItem> = Vec::new();
    let mut skipped_duplicates = Vec::new();
    let mut skipped_same_folder = 0usize;
    let mut skipped_conflicts = 0usize;
    let mut plans: Vec<MovePlan> = Vec::new();
    let mut reserved_names_lower: HashSet<String> = HashSet::new();

    for cand in candidates {
        let src_parent = crate::commands::parent_folder_path(&cand.norm_src);
        if is_same_folder_path(&src_parent, norm_target_folder) {
            skipped_same_folder += 1;
            continue;
        }

        if let Some(existing_dup_name) =
            find_identical_file_in_dir(&cand.resolved_src, target_dir_pb)
        {
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
            &cand.resolved_src,
            &cand.norm_src,
            Some(cand.sample_id),
            &cand.file_name,
        ) else {
            continue;
        };

        if has_ntfs_ads_colon(&final_name) || final_name.contains(':') {
            return Err("Invalid target filename".to_string());
        }

        let final_dst = target_dir_pb.join(&final_name);
        let norm_dst = normalize_clean_path(&final_dst.to_string_lossy());
        plans.push(MovePlan {
            sample_id: cand.sample_id,
            old_library_id: cand.old_library_id,
            src_pb: cand.resolved_src.clone(),
            dst_pb: final_dst,
            norm_old_path: cand.norm_src.clone(),
            norm_new_path: norm_dst,
            old_name: cand.file_name.clone(),
            new_name: final_name,
        });
    }

    if !conflicts.is_empty() && policy != "skip" && policy != "keep_both" {
        return Ok(MoveDiskOutcome::EarlyConflict(FolderDropResult {
            status: "conflict".to_string(),
            target_library_id,
            target_folder_path: norm_target_folder.to_string(),
            moved_records: Vec::new(),
            imported_sample_ids: Vec::new(),
            conflicts,
            skipped_duplicates,
            skipped_same_folder,
            skipped_unsupported: 0,
            skipped_conflicts,
        }));
    }

    let mut completed_disk_moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    for plan in &plans {
        if let Err(e) = move_file_resilient(&plan.src_pb, &plan.dst_pb) {
            rollback_disk_moves(&completed_disk_moves);
            return Err(sanitize_err(user_dir, &e));
        }
        completed_disk_moves.push((plan.src_pb.clone(), plan.dst_pb.clone()));
    }

    Ok(MoveDiskOutcome::Moved {
        plans,
        completed_disk_moves,
        skipped_duplicates,
        skipped_same_folder,
        skipped_conflicts,
    })
}

fn commit_move_db(
    conn: &mut Connection,
    user_dir: &Path,
    target_library_id: i64,
    norm_target_folder: String,
    outcome: MoveDiskOutcome,
) -> Result<FolderDropResult, String> {
    let MoveDiskOutcome::Moved {
        plans,
        completed_disk_moves,
        skipped_duplicates,
        skipped_same_folder,
        skipped_conflicts,
    } = outcome
    else {
        unreachable!("EarlyConflict handled before commit_move_db");
    };

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Failed to start folder move transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    let mut moved_records = Vec::with_capacity(plans.len());
    for plan in &plans {
        if let Err(e) = tx.execute(
            "UPDATE samples SET library_id = ?1, file_path = ?2, file_name = ?3 WHERE id = ?4",
            params![
                target_library_id,
                plan.norm_new_path,
                plan.new_name,
                plan.sample_id
            ],
        ) {
            drop(tx);
            rollback_disk_moves(&completed_disk_moves);
            return Err(format!(
                "Failed to update moved sample {}: {}",
                plan.sample_id,
                sanitize_err(user_dir, &e.to_string())
            ));
        }

        if let Err(e) = crate::commands::slices::relink_sample_slices_source_by_sample_id(
            &tx,
            plan.sample_id,
            &plan.norm_new_path,
            &plan.new_name,
        ) {
            drop(tx);
            rollback_disk_moves(&completed_disk_moves);
            return Err(e);
        }

        let _ = tx.execute(
            "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
             VALUES (?1, 'MOVE', ?2, ?3, ?4, ?5)",
            params![
                plan.sample_id,
                plan.norm_old_path,
                plan.norm_new_path,
                plan.old_name,
                plan.new_name
            ],
        );

        moved_records.push(MovedSampleRecord {
            sample_id: plan.sample_id,
            old_library_id: plan.old_library_id,
            new_library_id: target_library_id,
            old_path: plan.norm_old_path.clone(),
            new_path: plan.norm_new_path.clone(),
            old_name: plan.old_name.clone(),
            new_name: plan.new_name.clone(),
        });
    }
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        rollback_disk_moves(&completed_disk_moves);
        return Err(format!(
            "Failed to commit folder move transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    Ok(FolderDropResult {
        status: "ok".to_string(),
        target_library_id,
        target_folder_path: norm_target_folder,
        moved_records,
        imported_sample_ids: Vec::new(),
        conflicts: Vec::new(),
        skipped_duplicates,
        skipped_same_folder,
        skipped_unsupported: 0,
        skipped_conflicts,
    })
}

#[cfg(test)]
pub(crate) fn move_samples_to_folder_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    sample_ids: &[i64],
    target_library_id: i64,
    target_folder_path: &str,
    conflict_policy: &str,
) -> Result<FolderDropResult, String> {
    let (target_dir_pb, norm_target_folder, candidates) = load_move_candidates(
        conn,
        user_dir,
        sample_ids,
        target_library_id,
        target_folder_path,
    )?;
    let outcome = execute_move_disk(
        user_dir,
        target_library_id,
        &target_dir_pb,
        &norm_target_folder,
        &candidates,
        conflict_policy,
    )?;
    if let MoveDiskOutcome::EarlyConflict(res) = outcome {
        return Ok(res);
    }
    commit_move_db(conn, user_dir, target_library_id, norm_target_folder, outcome)
}

#[tauri::command]
pub async fn move_samples_to_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    sample_ids: Option<Vec<i64>>,
    target_library_id: i64,
    target_folder_path: String,
    conflict_policy: Option<String>,
) -> Result<FolderDropResult, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let sample_ids = sample_ids.unwrap_or_default();
    let state_owned = state.inner().clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let (target_dir_pb, norm_target_folder, candidates) = {
            let conn = state_owned.lock_db();
            load_move_candidates(
                &conn,
                &state_owned.user_dir,
                &sample_ids,
                target_library_id,
                &target_folder_path,
            )?
        };
        let outcome = execute_move_disk(
            &state_owned.user_dir,
            target_library_id,
            &target_dir_pb,
            &norm_target_folder,
            &candidates,
            conflict_policy.as_deref().unwrap_or("prompt"),
        )?;
        match outcome {
            MoveDiskOutcome::EarlyConflict(conflict) => Ok(conflict),
            other => {
                let mut conn = state_owned.lock_db();
                commit_move_db(
                    &mut conn,
                    &state_owned.user_dir,
                    target_library_id,
                    norm_target_folder,
                    other,
                )
            }
        }
    })
    .await
    .map_err(|e| format!("Move samples task failed: {}", e))??;
    let updates: Vec<(i64, i64, &str)> = res
        .moved_records
        .iter()
        .map(|r| (r.sample_id, r.new_library_id, r.new_path.as_str()))
        .collect();
    ai_state.update_vector_locations(&updates);
    Ok(res)
}

#[tauri::command]
pub async fn relocate_moved_samples(
    app: AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    entries: Vec<SampleRelocateEntry>,
    op_label: Option<String>,
) -> Result<Vec<MovedSampleRecord>, String> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let state_owned = state.inner().clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let label = op_label.as_deref().unwrap_or("UNDO_MOVE");
        let plans = {
            let conn = state_owned.lock_db();
            relocate::prepare_relocate_plans(&conn, &state_owned.user_dir, &entries)?
        };
        let completed = relocate::execute_relocate_disk(&plans, &state_owned.user_dir)?;
        let mut conn = state_owned.lock_db();
        relocate::commit_relocate_db(&mut conn, &state_owned.user_dir, &plans, &completed, label)
    })
    .await
    .map_err(|e| format!("Relocate samples task failed: {}", e))??;
    let updates: Vec<(i64, i64, &str)> = res
        .iter()
        .map(|r| (r.sample_id, r.new_library_id, r.new_path.as_str()))
        .collect();
    ai_state.update_vector_locations(&updates);
    Ok(res)
}