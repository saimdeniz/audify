use super::prune_file_ops_journal;
use crate::ai_tagger::AiTaggerState;
use crate::db::{get_active_profile_id, AppState};
use crate::security::{
    display_leaf, normalize_clean_path, sanitize_err, validate_audio_path_in_scope,
    validate_safe_audio_stem,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
pub struct BatchRenameEntryInput {
    pub sample_id: i64,
    pub new_stem: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchRenameRecord {
    pub sample_id: i64,
    pub library_id: i64,
    pub old_path: String,
    pub new_path: String,
    pub old_name: String,
    pub new_name: String,
}

struct PlannedRename {
    sample_id: i64,
    library_id: i64,
    resolved_src: PathBuf,
    temp_pb: PathBuf,
    target_pb: PathBuf,
    norm_old_path: String,
    norm_new_path: String,
    old_name: String,
    new_name: String,
    src_key: String,
    target_key: String,
}

fn path_collision_key(norm_path: &str) -> String {
    if cfg!(windows) {
        norm_path.to_lowercase()
    } else {
        norm_path.to_string()
    }
}

fn build_unique_temp_rename_path(parent_dir: &Path, sample_id: i64, index: usize, ext: &str) -> PathBuf {
    let pid = std::process::id();
    for attempt in 0..64usize {
        let candidate = if ext.is_empty() {
            parent_dir.join(format!(".__audify_rn_{}_{}_{}_{}.tmp", pid, sample_id, index, attempt))
        } else {
            parent_dir.join(format!(
                ".__audify_rn_{}_{}_{}_{}.{}",
                pid, sample_id, index, attempt, ext
            ))
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    parent_dir.join(format!(".__audify_rn_{}_{}_{}.tmp", pid, sample_id, index))
}

fn rollback_stage1_temps(staged: &[(PathBuf, PathBuf)]) {
    for (src_pb, temp_pb) in staged.iter().rev() {
        if temp_pb.exists() && !src_pb.exists() {
            let _ = fs::rename(temp_pb, src_pb);
        }
    }
}

fn rollback_all_two_phase_renames(plans: &[PlannedRename], committed_targets_len: usize) {
    for plan in plans[..committed_targets_len].iter().rev() {
        if plan.target_pb.exists() {
            let _ = fs::rename(&plan.target_pb, &plan.temp_pb);
        }
    }
    for plan in plans.iter().rev() {
        if plan.temp_pb.exists() && !plan.resolved_src.exists() {
            let _ = fs::rename(&plan.temp_pb, &plan.resolved_src);
        }
    }
}

fn build_batch_rename_plans(
    conn: &Connection,
    user_dir: &Path,
    entries: &[BatchRenameEntryInput],
) -> Result<Vec<PlannedRename>, String> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let active_id = get_active_profile_id(conn);
    let mut seen_ids = HashSet::with_capacity(entries.len());
    let mut plans = Vec::with_capacity(entries.len());
    let mut seen_target_keys = HashSet::with_capacity(entries.len());

    for (idx, entry) in entries.iter().enumerate() {
        if entry.sample_id <= 0 || !seen_ids.insert(entry.sample_id) {
            return Err("Duplicate or invalid sample ID in batch rename list".to_string());
        }
        let clean_stem = validate_safe_audio_stem(&entry.new_stem)?;

        let (library_id, current_file_path, current_file_name, db_ext, is_trashed, lib_name, lib_read_only): (
            i64,
            String,
            String,
            String,
            bool,
            String,
            bool,
        ) = conn
            .query_row(
                "SELECT s.library_id, s.file_path, s.file_name, s.extension,
                        COALESCE(s.is_trashed, 0), l.name, COALESCE(l.is_read_only, 0)
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE s.id = ?1
                   AND (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2))",
                params![entry.sample_id, active_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .map_err(|_| "One or more selected samples were not found".to_string())?;

        if is_trashed {
            return Err(format!(
                "Cannot rename '{}' while it is in Audify Trash.",
                current_file_name
            ));
        }
        if lib_read_only {
            return Err(format!(
                "Library '{}' is locked as a Protected Read-Only Vault.",
                lib_name
            ));
        }

        let resolved_src = validate_audio_path_in_scope(conn, user_dir, &current_file_path)?;
        if !resolved_src.is_file() {
            return Err(format!(
                "Source audio file does not exist on disk: {}",
                current_file_name
            ));
        }

        let ext = Path::new(&current_file_name)
            .extension()
            .and_then(|e| e.to_str())
            .filter(|e| !e.is_empty())
            .unwrap_or(db_ext.as_str());

        let new_file_name = if ext.is_empty() {
            clean_stem
        } else {
            format!("{}.{}", clean_stem, ext)
        };

        let parent_dir = resolved_src
            .parent()
            .ok_or_else(|| "Source audio file has no parent folder".to_string())?;
        let target_pb = parent_dir.join(&new_file_name);
        let norm_old_path = normalize_clean_path(&resolved_src.to_string_lossy());
        let norm_new_path = normalize_clean_path(&target_pb.to_string_lossy());

        if norm_old_path == norm_new_path {
            continue;
        }

        let src_key = path_collision_key(&norm_old_path);
        let target_key = path_collision_key(&norm_new_path);

        if !seen_target_keys.insert(target_key.clone()) {
            return Err(format!(
                "Multiple files resolve to the same target filename '{}'",
                new_file_name
            ));
        }

        let temp_pb = build_unique_temp_rename_path(parent_dir, entry.sample_id, idx, ext);

        plans.push(PlannedRename {
            sample_id: entry.sample_id,
            library_id,
            resolved_src,
            temp_pb,
            target_pb,
            norm_old_path,
            norm_new_path,
            old_name: current_file_name,
            new_name: new_file_name,
            src_key,
            target_key,
        });
    }

    if plans.is_empty() {
        return Ok(plans);
    }

    let moving_src_keys: HashSet<&str> = plans.iter().map(|p| p.src_key.as_str()).collect();
    let moving_sample_ids: HashSet<i64> = plans.iter().map(|p| p.sample_id).collect();

    for plan in &plans {
        let is_case_only = plan.target_key == plan.src_key;
        if !is_case_only
            && plan.target_pb.exists()
            && !moving_src_keys.contains(plan.target_key.as_str())
        {
            return Err(format!(
                "Target file '{}' already exists in folder",
                plan.new_name
            ));
        }

        let existing_db_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM samples
                 WHERE LOWER(file_path) = LOWER(?1) AND COALESCE(is_trashed, 0) = 0
                 LIMIT 1",
                params![plan.norm_new_path],
                |r| r.get(0),
            )
            .ok();

        if let Some(other_id) = existing_db_id {
            if !moving_sample_ids.contains(&other_id) {
                return Err(format!(
                    "Target path '{}' is already indexed in catalog",
                    plan.new_name
                ));
            }
        }
    }

    Ok(plans)
}

pub(crate) fn batch_rename_samples_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    entries: &[BatchRenameEntryInput],
) -> Result<Vec<BatchRenameRecord>, String> {
    let plans = build_batch_rename_plans(conn, user_dir, entries)?;
    if plans.is_empty() {
        return Ok(Vec::new());
    }

    // Two-phase filesystem rename allows case-only renames AND swap cycles (A <-> B) atomically.
    let mut phase1_done: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(plans.len());
    for plan in &plans {
        if let Err(e) = fs::rename(&plan.resolved_src, &plan.temp_pb) {
            rollback_stage1_temps(&phase1_done);
            return Err(format!(
                "Failed staging file rename '{}': {}",
                display_leaf(&plan.resolved_src),
                sanitize_err(user_dir, &e.to_string())
            ));
        }
        phase1_done.push((plan.resolved_src.clone(), plan.temp_pb.clone()));
    }

    for (idx, plan) in plans.iter().enumerate() {
        if let Err(e) = fs::rename(&plan.temp_pb, &plan.target_pb) {
            rollback_all_two_phase_renames(&plans, idx);
            return Err(format!(
                "Failed finalizing file rename '{}' -> '{}': {}",
                plan.old_name,
                plan.new_name,
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    }

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_all_two_phase_renames(&plans, plans.len());
            return Err(format!(
                "Failed to start batch rename transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    // Temporary unique file_path shift prevents UNIQUE(file_path) violations on swap cycles (A <-> B).
    let nonce = std::process::id();
    for (idx, plan) in plans.iter().enumerate() {
        let tmp_db_path = format!("__audify_tmp_rn_{}_{}_{}", nonce, plan.sample_id, idx);
        if let Err(e) = tx.execute(
            "UPDATE samples SET file_path = ?1 WHERE id = ?2",
            params![tmp_db_path, plan.sample_id],
        ) {
            rollback_all_two_phase_renames(&plans, plans.len());
            return Err(format!("Failed staging database rename records: {}", e));
        }
    }

    let mut records = Vec::with_capacity(plans.len());
    for plan in &plans {
        if let Err(e) = tx.execute(
            "UPDATE samples
             SET file_path = ?1,
                 file_name = ?2,
                 previous_file_name = ?3
             WHERE id = ?4",
            params![plan.norm_new_path, plan.new_name, plan.old_name, plan.sample_id],
        ) {
            drop(tx);
            rollback_all_two_phase_renames(&plans, plans.len());
            return Err(format!("Failed updating batch rename record: {}", e));
        }

        if let Err(e) = crate::commands::slices::relink_sample_slices_source_by_sample_id(
            &tx,
            plan.sample_id,
            &plan.norm_new_path,
            &plan.new_name,
        ) {
            drop(tx);
            rollback_all_two_phase_renames(&plans, plans.len());
            return Err(e);
        }

        let _ = tx.execute(
            "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
             VALUES (?1, 'RENAME', ?2, ?3, ?4, ?5)",
            params![
                plan.sample_id,
                plan.norm_old_path,
                plan.norm_new_path,
                plan.old_name,
                plan.new_name
            ],
        );

        records.push(BatchRenameRecord {
            sample_id: plan.sample_id,
            library_id: plan.library_id,
            old_path: plan.norm_old_path.clone(),
            new_path: plan.norm_new_path.clone(),
            old_name: plan.old_name.clone(),
            new_name: plan.new_name.clone(),
        });
    }
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        rollback_all_two_phase_renames(&plans, plans.len());
        return Err(format!("Failed to commit batch rename transaction: {}", e));
    }

    Ok(records)
}

#[tauri::command]
pub fn batch_rename_samples(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    entries: Vec<BatchRenameEntryInput>,
) -> Result<Vec<BatchRenameRecord>, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    let res = batch_rename_samples_with_conn(&mut conn, &state.user_dir, &entries)?;
    let updates: Vec<(i64, i64, &str)> = res
        .iter()
        .map(|r| (r.sample_id, r.library_id, r.new_path.as_str()))
        .collect();
    ai_state.update_vector_locations(&updates);
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;

    fn setup_batch_rename_env(name: &str, read_only: bool) -> (Connection, PathBuf, PathBuf, i64, i64, i64) {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();

        let root_temp = std::env::temp_dir().join(format!(
            "audify_batch_rename_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root_temp);
        let user_dir = root_temp.join("user");
        let lib_dir = root_temp.join("SFX");
        fs::create_dir_all(&user_dir).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let a = lib_dir.join("kick.wav");
        let b = lib_dir.join("snare.wav");
        fs::write(&a, b"RIFF_A").unwrap();
        fs::write(&b, b"RIFF_B").unwrap();

        let norm_lib = normalize_clean_path(&lib_dir.canonicalize().unwrap().to_string_lossy());
        let norm_a = normalize_clean_path(&a.canonicalize().unwrap().to_string_lossy());
        let norm_b = normalize_clean_path(&b.canonicalize().unwrap().to_string_lossy());

        conn.execute(
            "INSERT INTO libraries (path, name, is_global, is_read_only) VALUES (?1, 'SFX', 1, ?2)",
            params![norm_lib, i64::from(read_only)],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms)
             VALUES (?1, ?2, 'kick.wav', 'wav', 250)",
            params![lib_id, norm_a],
        )
        .unwrap();
        let id_a = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms)
             VALUES (?1, ?2, 'snare.wav', 'wav', 300)",
            params![lib_id, norm_b],
        )
        .unwrap();
        let id_b = conn.last_insert_rowid();

        (conn, root_temp, lib_dir, lib_id, id_a, id_b)
    }

    #[test]
    fn batch_rename_updates_disk_db_and_supports_swap_cycles() {
        let (mut conn, root, lib_dir, _lib_id, id_a, id_b) = setup_batch_rename_env("swap", false);

        // 1. Standard prefix batch rename
        let renamed = batch_rename_samples_with_conn(
            &mut conn,
            &root.join("user"),
            &[
                BatchRenameEntryInput {
                    sample_id: id_a,
                    new_stem: "sfx_kick".to_string(),
                },
                BatchRenameEntryInput {
                    sample_id: id_b,
                    new_stem: "sfx_snare".to_string(),
                },
            ],
        )
        .unwrap();
        assert_eq!(renamed.len(), 2);
        assert!(lib_dir.join("sfx_kick.wav").exists());
        assert!(lib_dir.join("sfx_snare.wav").exists());
        assert!(!lib_dir.join("kick.wav").exists());

        // 2. Atomic swap cycle: sfx_kick <-> sfx_snare
        let swapped = batch_rename_samples_with_conn(
            &mut conn,
            &root.join("user"),
            &[
                BatchRenameEntryInput {
                    sample_id: id_a,
                    new_stem: "sfx_snare".to_string(),
                },
                BatchRenameEntryInput {
                    sample_id: id_b,
                    new_stem: "sfx_kick".to_string(),
                },
            ],
        )
        .unwrap();
        assert_eq!(swapped.len(), 2);
        assert_eq!(fs::read(lib_dir.join("sfx_snare.wav")).unwrap(), b"RIFF_A");
        assert_eq!(fs::read(lib_dir.join("sfx_kick.wav")).unwrap(), b"RIFF_B");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn batch_rename_rejects_duplicates_and_read_only_vault_without_mutating_disk() {
        let (mut conn, root, lib_dir, _lib_id, id_a, id_b) = setup_batch_rename_env("dupe", false);

        let err = batch_rename_samples_with_conn(
            &mut conn,
            &root.join("user"),
            &[
                BatchRenameEntryInput {
                    sample_id: id_a,
                    new_stem: "same_name".to_string(),
                },
                BatchRenameEntryInput {
                    sample_id: id_b,
                    new_stem: "SAME_NAME".to_string(),
                },
            ],
        )
        .unwrap_err();
        if cfg!(windows) {
            assert!(err.contains("same target filename"));
            assert!(lib_dir.join("kick.wav").exists());
            assert!(lib_dir.join("snare.wav").exists());
        } else {
            assert!(!err.is_empty());
        }
        let _ = fs::remove_dir_all(&root);

        let (mut ro_conn, ro_root, ro_lib_dir, _, ro_id_a, _) = setup_batch_rename_env("ro", true);
        let ro_err = batch_rename_samples_with_conn(
            &mut ro_conn,
            &ro_root.join("user"),
            &[BatchRenameEntryInput {
                sample_id: ro_id_a,
                new_stem: "should_fail".to_string(),
            }],
        )
        .unwrap_err();
        assert!(ro_err.contains("Protected Read-Only Vault"));
        assert!(ro_lib_dir.join("kick.wav").exists());
        let _ = fs::remove_dir_all(&ro_root);
    }
}
