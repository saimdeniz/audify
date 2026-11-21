use super::{
    dedup_positive_ids, ensure_existing_slice_in_scope, format_os_display_path,
    query_single_slice_record, query_slice_record_by_id, sanitize_custom_slice_stem,
    SliceHistoryRecord,
};
use crate::db::{get_active_profile_id, AppState};
use crate::security::{normalize_clean_path, sanitize_err};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Deserialize)]
pub struct SliceBatchRenameEntryInput {
    pub slice_id: i64,
    pub new_stem: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SliceRenameOutcome {
    pub old_record: SliceHistoryRecord,
    pub updated_record: SliceHistoryRecord,
}

fn collision_key(p: &Path) -> String {
    let norm = normalize_clean_path(&p.to_string_lossy());
    if cfg!(windows) {
        norm.to_lowercase()
    } else {
        norm
    }
}

pub(crate) fn toggle_slice_favorite_with_conn(
    conn: &Connection,
    slice_id: i64,
) -> Result<SliceHistoryRecord, String> {
    let profile_id = get_active_profile_id(conn);
    let updated_rows = conn
        .execute(
            "UPDATE sample_slices
             SET is_favorite = CASE WHEN COALESCE(is_favorite, 0) = 0 THEN 1 ELSE 0 END
             WHERE id = ?1 AND profile_id = ?2 AND COALESCE(is_trashed, 0) = 0",
            params![slice_id, profile_id],
        )
        .map_err(|e| format!("Failed updating slice favorite: {}", e))?;
    if updated_rows == 0 {
        return Err("Slice record not found".to_string());
    }
    query_slice_record_by_id(conn, profile_id, slice_id)
}

pub(crate) fn toggle_slice_favorites_batch_with_conn(
    conn: &mut Connection,
    slice_ids: &[i64],
    is_favorite: bool,
) -> Result<Vec<i64>, String> {
    let clean_ids = dedup_positive_ids(slice_ids);
    if clean_ids.is_empty() {
        return Ok(Vec::new());
    }
    let profile_id = get_active_profile_id(conn);
    let fav_int: i64 = if is_favorite { 1 } else { 0 };
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting batch favorite transaction: {}", e))?;
    for chunk in clean_ids.chunks(500) {
        let placeholders: Vec<String> = (3..=chunk.len() + 2).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "UPDATE sample_slices
             SET is_favorite = ?1
             WHERE profile_id = ?2 AND COALESCE(is_trashed, 0) = 0 AND id IN ({})",
            placeholders.join(", ")
        );
        let mut values: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 2);
        values.push(rusqlite::types::Value::Integer(fav_int));
        values.push(rusqlite::types::Value::Integer(profile_id));
        for id in chunk {
            values.push(rusqlite::types::Value::Integer(*id));
        }
        tx.execute(&sql, rusqlite::params_from_iter(values.iter()))
            .map_err(|e| format!("Failed updating slice favorites: {}", e))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed committing slice favorites: {}", e))?;
    Ok(clean_ids)
}

struct PlannedSliceRename {
    old_record: SliceHistoryRecord,
    src_pb: PathBuf,
    temp_pb: PathBuf,
    target_pb: PathBuf,
    next_file_name: String,
    src_key: String,
    target_key: String,
}

fn build_temp_slice_rename_path(parent_dir: &Path, slice_id: i64, index: usize) -> PathBuf {
    let pid = std::process::id();
    for attempt in 0..64usize {
        let candidate = parent_dir.join(format!(
            ".__audify_slrn_{}_{}_{}_{}.tmp",
            pid, slice_id, index, attempt
        ));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent_dir.join(format!(".__audify_slrn_{}_{}_{}.tmp", pid, slice_id, index))
}

fn rollback_slice_renames(plans: &[PlannedSliceRename], committed_targets: usize) {
    for plan in plans[..committed_targets].iter().rev() {
        if plan.target_pb.exists() {
            let _ = fs::rename(&plan.target_pb, &plan.temp_pb);
        }
    }
    for plan in plans.iter().rev() {
        if plan.temp_pb.exists() && !plan.src_pb.exists() {
            let _ = fs::rename(&plan.temp_pb, &plan.src_pb);
        }
    }
}

pub(crate) fn batch_rename_slices_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    entries: &[SliceBatchRenameEntryInput],
) -> Result<Vec<SliceRenameOutcome>, String> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let profile_id = get_active_profile_id(conn);
    let mut seen_ids = HashSet::new();
    let mut plans = Vec::with_capacity(entries.len());

    for (idx, item) in entries.iter().enumerate() {
        if item.slice_id <= 0 || !seen_ids.insert(item.slice_id) {
            return Err("Duplicate or invalid slice selection in rename batch".to_string());
        }
        let clean_stem = sanitize_custom_slice_stem(&item.new_stem)?;
        let old_record = query_slice_record_by_id(conn, profile_id, item.slice_id)?;
        if old_record.is_trashed {
            return Err("Cannot rename a trashed slice".to_string());
        }
        if normalize_clean_path(&old_record.slice_path)
            .eq_ignore_ascii_case(&normalize_clean_path(&old_record.source_file_path))
        {
            return Err("Refusing to rename a source library track".to_string());
        }
        let src_pb = ensure_existing_slice_in_scope(conn, user_dir, &old_record.slice_path)?;
        super::ensure_slice_not_in_readonly_library(conn, &src_pb)?;
        let parent_dir = src_pb
            .parent()
            .ok_or_else(|| "Invalid slice parent folder".to_string())?;
        let next_file_name = format!("{}.wav", clean_stem);
        let target_pb = parent_dir.join(&next_file_name);
        let src_key = collision_key(&src_pb);
        let target_key = collision_key(&target_pb);
        if src_key == target_key {
            continue;
        }
        let temp_pb = build_temp_slice_rename_path(parent_dir, item.slice_id, idx);
        plans.push(PlannedSliceRename {
            old_record,
            src_pb,
            temp_pb,
            target_pb,
            next_file_name,
            src_key,
            target_key,
        });
    }

    if plans.is_empty() {
        return Ok(Vec::new());
    }

    let vacated_keys: HashSet<String> = plans.iter().map(|p| p.src_key.clone()).collect();
    let mut reserved_targets: HashSet<String> = HashSet::new();
    for plan in &plans {
        if !reserved_targets.insert(plan.target_key.clone()) {
            return Err(format!(
                "Duplicate target slice name '{}'",
                plan.next_file_name
            ));
        }
        if plan.target_pb.exists() && !vacated_keys.contains(&plan.target_key) {
            return Err(format!(
                "A slice named '{}' already exists in that folder",
                plan.next_file_name
            ));
        }
    }

    // Stage 1: Move sources -> hidden .tmp paths so swap cycles (A <-> B) succeed atomically
    for (staged_count, plan) in plans.iter().enumerate() {
        if let Err(e) = fs::rename(&plan.src_pb, &plan.temp_pb) {
            for rollback in plans[..staged_count].iter().rev() {
                if rollback.temp_pb.exists() && !rollback.src_pb.exists() {
                    let _ = fs::rename(&rollback.temp_pb, &rollback.src_pb);
                }
            }
            return Err(sanitize_err(
                user_dir,
                &format!("Failed renaming slice file: {}", e),
            ));
        }
    }

    // Stage 2: Move .tmp paths -> final target names
    for (committed_targets, plan) in plans.iter().enumerate() {
        if let Err(e) = fs::rename(&plan.temp_pb, &plan.target_pb) {
            rollback_slice_renames(&plans, committed_targets);
            return Err(sanitize_err(
                user_dir,
                &format!("Failed finalizing slice rename: {}", e),
            ));
        }
    }
    let committed_targets = plans.len();

    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_slice_renames(&plans, committed_targets);
            return Err(format!("Failed starting slice rename transaction: {}", e));
        }
    };
    // Two-phase DB update avoids UNIQUE(profile_id, slice_path) collisions during swap cycles (A <-> B)
    for plan in &plans {
        let temp_disp = format_os_display_path(&plan.temp_pb);
        if let Err(e) = tx.execute(
            "UPDATE sample_slices SET slice_path = ?1
             WHERE id = ?2 AND profile_id = ?3",
            params![temp_disp, plan.old_record.id, profile_id],
        ) {
            drop(tx);
            rollback_slice_renames(&plans, committed_targets);
            return Err(sanitize_err(
                user_dir,
                &format!("Failed staging slice rename record: {}", e),
            ));
        }
    }
    for plan in &plans {
        let next_disp = format_os_display_path(&plan.target_pb);
        if let Err(e) = tx.execute(
            "UPDATE sample_slices SET slice_path = ?1, slice_name = ?2
             WHERE id = ?3 AND profile_id = ?4",
            params![next_disp, plan.next_file_name, plan.old_record.id, profile_id],
        ) {
            drop(tx);
            rollback_slice_renames(&plans, committed_targets);
            return Err(sanitize_err(
                user_dir,
                &format!("Failed updating renamed slice record: {}", e),
            ));
        }
    }
    if let Err(e) = tx.commit() {
        rollback_slice_renames(&plans, committed_targets);
        return Err(sanitize_err(
            user_dir,
            &format!("Failed committing renamed slices: {}", e),
        ));
    }

    let mut outcomes = Vec::with_capacity(plans.len());
    for plan in plans {
        let next_disp = format_os_display_path(&plan.target_pb);
        let updated_record = query_single_slice_record(conn, profile_id, &next_disp)?;
        outcomes.push(SliceRenameOutcome {
            old_record: plan.old_record,
            updated_record,
        });
    }
    Ok(outcomes)
}

#[tauri::command]
pub fn toggle_slice_favorite(
    state: State<'_, AppState>,
    slice_id: i64,
) -> Result<SliceHistoryRecord, String> {
    let conn = state.lock_db();
    toggle_slice_favorite_with_conn(&conn, slice_id)
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[tauri::command]
pub fn toggle_slice_favorites_batch(
    state: State<'_, AppState>,
    slice_ids: Vec<i64>,
    is_favorite: bool,
) -> Result<Vec<i64>, String> {
    let mut conn = state.lock_db();
    toggle_slice_favorites_batch_with_conn(&mut conn, &slice_ids, is_favorite)
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[tauri::command]
pub fn batch_rename_slices(
    app: AppHandle,
    state: State<'_, AppState>,
    entries: Vec<SliceBatchRenameEntryInput>,
) -> Result<Vec<SliceRenameOutcome>, String> {
    crate::library_watcher::suppress_watcher_if_managed(&app, 2500);
    let mut conn = state.lock_db();
    batch_rename_slices_with_conn(&mut conn, &state.user_dir, &entries)
        .map_err(|e| sanitize_err(&state.user_dir, &e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::write_wav_i16;
    use crate::commands::slices::history::{ensure_source_not_a_slice, upsert_slice_history_with_conn};
    use crate::commands::slices::trash::{
        restore_trashed_slice_files_with_conn, trash_slice_files_with_conn,
    };
    use crate::commands::slices::SliceHistoryUpsert;
    use crate::db::init_db;

    fn temp_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "audify_slice_ops_test_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn slice_favorite_batch_rename_swap_and_trash_restore_roundtrip() {
        let base = temp_dir("ops");
        let user_dir = base.join("user");
        let slices_dir = user_dir.join("slices");
        let lib_dir = base.join("lib");
        fs::create_dir_all(&slices_dir).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let mut conn = init_db(&user_dir).unwrap();
        let pid = get_active_profile_id(&conn);

        let src_wav = lib_dir.join("source.wav");
        let s1_wav = slices_dir.join("Alpha.wav");
        let s2_wav = slices_dir.join("Beta.wav");
        write_wav_i16(&src_wav, 48000, 1, &vec![500i16; 4800]).unwrap();
        write_wav_i16(&s1_wav, 48000, 1, &vec![1200i16; 2400]).unwrap();
        write_wav_i16(&s2_wav, 48000, 2, &vec![800i16; 4800]).unwrap();

        let r1 = upsert_slice_history_with_conn(
            &conn,
            &SliceHistoryUpsert {
                profile_id: pid,
                slice_path: &s1_wav,
                source_sample_id: Some(7),
                source_file_path: &src_wav,
                start_sec: 0.0,
                end_sec: 0.25,
                pitch_semitones: 0.0,
                micro_fade: true,
            },
        )
        .unwrap();
        let r2 = upsert_slice_history_with_conn(
            &conn,
            &SliceHistoryUpsert {
                profile_id: pid,
                slice_path: &s2_wav,
                source_sample_id: Some(7),
                source_file_path: &src_wav,
                start_sec: 0.25,
                end_sec: 0.5,
                pitch_semitones: 2.0,
                micro_fade: false,
            },
        )
        .unwrap();

        assert_ne!(r1.peaks_json, "[]");
        assert_eq!(r2.channels, 2);
        assert!(ensure_source_not_a_slice(&conn, &s1_wav).is_err());

        let fav1 = toggle_slice_favorite_with_conn(&conn, r1.id).unwrap();
        assert!(fav1.is_favorite);

        let swapped = batch_rename_slices_with_conn(
            &mut conn,
            &user_dir,
            &[
                SliceBatchRenameEntryInput {
                    slice_id: r1.id,
                    new_stem: "Beta".to_string(),
                },
                SliceBatchRenameEntryInput {
                    slice_id: r2.id,
                    new_stem: "Alpha".to_string(),
                },
            ],
        )
        .unwrap();
        assert_eq!(swapped.len(), 2);
        assert_eq!(swapped[0].updated_record.slice_name, "Beta.wav");
        assert!(swapped[0].updated_record.is_favorite);
        assert_eq!(swapped[1].updated_record.slice_name, "Alpha.wav");

        let trashed_ids = trash_slice_files_with_conn(&mut conn, &user_dir, &[r1.id]).unwrap();
        assert_eq!(trashed_ids, vec![r1.id]);
        assert!(!slices_dir.join("Beta.wav").exists());

        let restored = restore_trashed_slice_files_with_conn(&mut conn, &user_dir, &[r1.id]).unwrap();
        assert_eq!(restored.len(), 1);
        assert!(slices_dir.join("Beta.wav").exists());
        assert!(restored[0].is_favorite);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn batch_restore_trashed_slices_avoids_colliding_target_overwrite() {
        let base = temp_dir("batch_restore_collision");
        let user_dir = base.join("user");
        let slices_dir = user_dir.join("slices");
        let trash_dir = user_dir.join("cache").join("slice_trash");
        let lib_dir = base.join("lib");
        fs::create_dir_all(&slices_dir).unwrap();
        fs::create_dir_all(&trash_dir).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let mut conn = init_db(&user_dir).unwrap();
        let pid = get_active_profile_id(&conn);

        let src_wav = lib_dir.join("source.wav");
        let t1_wav = trash_dir.join("1_dup_a.wav");
        let t2_wav = trash_dir.join("2_dup_b.wav");
        write_wav_i16(&src_wav, 48000, 1, &vec![500i16; 4800]).unwrap();
        write_wav_i16(&t1_wav, 48000, 1, &vec![1111i16; 1200]).unwrap();
        write_wav_i16(&t2_wav, 48000, 1, &vec![2222i16; 2400]).unwrap();

        let orig_a = slices_dir.join("Hit.wav");
        let orig_b = slices_dir.join("Hit.wav");
        let len_t1 = fs::metadata(&t1_wav).unwrap().len();
        let len_t2 = fs::metadata(&t2_wav).unwrap().len();

        conn.execute(
            "INSERT INTO sample_slices
             (profile_id, slice_path, slice_name, source_file_path, source_file_name, start_sec, end_sec, duration_ms, is_trashed, trash_file_path)
             VALUES (?1, ?2, 'Hit.wav', ?3, 'source.wav', 0.0, 0.25, 250, 1, ?4)",
            params![
                pid,
                orig_a.to_string_lossy().to_string(),
                src_wav.to_string_lossy().to_string(),
                t1_wav.to_string_lossy().to_string()
            ],
        )
        .unwrap();
        let id1 = conn.last_insert_rowid();

        // Simulate a second trashed slice whose original parent is unauthorized so both fallback to user_dir/slices/Hit.wav
        let fallback_orig = base.join("unauthorized_dir").join("Hit.wav");
        conn.execute(
            "INSERT INTO sample_slices
             (profile_id, slice_path, slice_name, source_file_path, source_file_name, start_sec, end_sec, duration_ms, is_trashed, trash_file_path)
             VALUES (?1, ?2, 'Hit.wav', ?3, 'source.wav', 0.25, 0.5, 250, 1, ?4)",
            params![
                pid,
                fallback_orig.to_string_lossy().to_string(),
                src_wav.to_string_lossy().to_string(),
                t2_wav.to_string_lossy().to_string()
            ],
        )
        .unwrap();
        let id2 = conn.last_insert_rowid();
        let _ = orig_b;

        let restored = restore_trashed_slice_files_with_conn(&mut conn, &user_dir, &[id1, id2])
            .expect("batch restore must not overwrite or collide");
        assert_eq!(restored.len(), 2);
        assert_ne!(restored[0].slice_path, restored[1].slice_path);
        assert_eq!(restored[0].slice_name, "Hit.wav");
        assert_eq!(restored[1].slice_name, "Hit_01.wav");
        assert_eq!(fs::metadata(&restored[0].slice_path).unwrap().len(), len_t1);
        assert_eq!(fs::metadata(&restored[1].slice_path).unwrap().len(), len_t2);

        let _ = fs::remove_dir_all(&base);
    }
}
