use crate::commands::file_ops::folder_ops::ensure_writable_library_folder_for_relocate;
use crate::commands::file_ops::{
    move_file_resilient, prune_file_ops_journal, rollback_disk_moves, MovedSampleRecord,
    SampleRelocateEntry,
};
use crate::security::{
    has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path, sanitize_err,
    validate_audio_path_in_scope, validate_safe_audio_stem,
};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(super) struct RelocatePlan {
    sample_id: i64,
    old_library_id: i64,
    new_library_id: i64,
    src_pb: PathBuf,
    dst_pb: PathBuf,
    norm_old_path: String,
    norm_new_path: String,
    old_name: String,
    new_name: String,
}

pub(super) fn prepare_relocate_plans(
    conn: &Connection,
    user_dir: &Path,
    entries: &[SampleRelocateEntry],
) -> Result<Vec<RelocatePlan>, String> {
    let mut plans = Vec::with_capacity(entries.len());
    let mut seen_targets: HashSet<String> = HashSet::with_capacity(entries.len());
    for item in entries {
        let (old_lib_id, cur_file_path, cur_file_name, is_trashed, src_ro): (
            i64,
            String,
            String,
            bool,
            bool,
        ) = conn
            .query_row(
                "SELECT s.library_id, s.file_path, s.file_name, COALESCE(s.is_trashed, 0),
                        COALESCE(l.is_read_only, 0)
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE s.id = ?1",
                params![item.sample_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|_| format!("Sample {} not found", item.sample_id))?;

        if is_trashed || src_ro {
            return Err("Cannot undo/redo move on a trashed or read-only sample".to_string());
        }

        let target_path_trimmed = item.target_path.trim();
        if is_unc_or_network_path(target_path_trimmed) || has_ntfs_ads_colon(target_path_trimmed) {
            return Err("Unsafe or network path rejected during relocate".to_string());
        }
        let raw_name = item.target_name.trim();
        if raw_name.is_empty()
            || has_ntfs_ads_colon(raw_name)
            || raw_name.contains(':')
            || raw_name.contains('/')
            || raw_name.contains('\\')
            || raw_name.contains("..")
            || raw_name.chars().any(|c| c.is_control())
        {
            return Err("Invalid target filename".to_string());
        }

        let resolved_src = validate_audio_path_in_scope(conn, user_dir, &cur_file_path)?;
        let dst_pb = PathBuf::from(target_path_trimmed);
        let Some(dst_parent) = dst_pb.parent() else {
            return Err("Target path has no parent directory".to_string());
        };
        let dst_parent_str = dst_parent.to_string_lossy().to_string();
        let (_, _, clean_dst_parent, _) = ensure_writable_library_folder_for_relocate(
            conn,
            item.target_library_id,
            &dst_parent_str,
        )?;

        let final_name = validate_relocate_target_filename(&cur_file_name, raw_name)?;
        let final_dst_pb = clean_dst_parent.join(&final_name);
        let norm_old = normalize_clean_path(&resolved_src.to_string_lossy());
        let norm_new = normalize_clean_path(&final_dst_pb.to_string_lossy());

        let target_key = if cfg!(windows) {
            norm_new.to_lowercase()
        } else {
            norm_new.clone()
        };
        if !seen_targets.insert(target_key) {
            return Err(format!(
                "Multiple items in this operation target the same filename '{}'",
                final_name
            ));
        }

        if !norm_old.eq_ignore_ascii_case(&norm_new)
            && std::fs::symlink_metadata(&final_dst_pb).is_ok()
        {
            return Err(format!(
                "Cannot move '{}' because '{}' already exists in destination folder",
                cur_file_name, final_name
            ));
        }

        plans.push(RelocatePlan {
            sample_id: item.sample_id,
            old_library_id: old_lib_id,
            new_library_id: item.target_library_id,
            src_pb: resolved_src,
            dst_pb: final_dst_pb,
            norm_old_path: norm_old,
            norm_new_path: norm_new,
            old_name: cur_file_name,
            new_name: final_name,
        });
    }
    Ok(plans)
}

pub(super) fn execute_relocate_disk(
    plans: &[RelocatePlan],
    user_dir: &Path,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let mut completed_disk_moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    for plan in plans {
        if let Err(e) = move_file_resilient(&plan.src_pb, &plan.dst_pb) {
            rollback_disk_moves(&completed_disk_moves);
            return Err(sanitize_err(user_dir, &e));
        }
        completed_disk_moves.push((plan.src_pb.clone(), plan.dst_pb.clone()));
    }
    Ok(completed_disk_moves)
}

pub(super) fn commit_relocate_db(
    conn: &mut Connection,
    user_dir: &Path,
    plans: &[RelocatePlan],
    completed_disk_moves: &[(PathBuf, PathBuf)],
    op_label: &str,
) -> Result<Vec<MovedSampleRecord>, String> {
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            rollback_disk_moves(completed_disk_moves);
            return Err(format!(
                "Failed to start relocate transaction: {}",
                sanitize_err(user_dir, &e.to_string())
            ));
        }
    };

    let mut out = Vec::with_capacity(plans.len());
    for plan in plans {
        if let Err(e) = tx.execute(
            "UPDATE samples SET library_id = ?1, file_path = ?2, file_name = ?3 WHERE id = ?4",
            params![
                plan.new_library_id,
                plan.norm_new_path,
                plan.new_name,
                plan.sample_id
            ],
        ) {
            drop(tx);
            rollback_disk_moves(completed_disk_moves);
            return Err(format!(
                "Failed to update sample {}: {}",
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
            rollback_disk_moves(completed_disk_moves);
            return Err(e);
        }

        let _ = tx.execute(
            "INSERT INTO file_ops_journal (sample_id, op_type, old_path, new_path, old_name, new_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                plan.sample_id,
                op_label,
                plan.norm_old_path,
                plan.norm_new_path,
                plan.old_name,
                plan.new_name
            ],
        );

        out.push(MovedSampleRecord {
            sample_id: plan.sample_id,
            old_library_id: plan.old_library_id,
            new_library_id: plan.new_library_id,
            old_path: plan.norm_old_path.clone(),
            new_path: plan.norm_new_path.clone(),
            old_name: plan.old_name.clone(),
            new_name: plan.new_name.clone(),
        });
    }
    prune_file_ops_journal(&tx);

    if let Err(e) = tx.commit() {
        rollback_disk_moves(completed_disk_moves);
        return Err(format!(
            "Failed to commit relocate transaction: {}",
            sanitize_err(user_dir, &e.to_string())
        ));
    }

    Ok(out)
}

pub(super) fn validate_relocate_target_filename(
    cur_file_name: &str,
    raw_name: &str,
) -> Result<String, String> {
    let clean_name = validate_safe_audio_stem(
        Path::new(raw_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Audio"),
    )?;
    let src_ext = Path::new(cur_file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let ext = Path::new(raw_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let ext_lower = ext.to_ascii_lowercase();
    if ext.is_empty()
        || has_ntfs_ads_colon(ext)
        || ext.contains(':')
        || !ext.eq_ignore_ascii_case(src_ext)
        || !crate::scanner::SUPPORTED_EXTENSIONS.contains(&ext_lower.as_str())
    {
        return Err("Target file extension must match the source audio format".to_string());
    }
    let final_name = format!("{}.{}", clean_name, ext);
    if has_ntfs_ads_colon(&final_name) || final_name.contains(':') {
        return Err("Invalid target filename".to_string());
    }
    Ok(final_name)
}

#[cfg(test)]
mod tests {
    use super::validate_relocate_target_filename;

    #[test]
    fn relocate_filename_rejects_executable_or_mismatched_extension() {
        assert!(validate_relocate_target_filename("kick.wav", "kick.exe").is_err());
        assert!(validate_relocate_target_filename("kick.wav", "kick.bat").is_err());
        assert!(validate_relocate_target_filename("kick.wav", "kick.mp3").is_err());
        assert!(validate_relocate_target_filename("kick.wav", "kick.wav:evil").is_err());
        assert!(validate_relocate_target_filename("kick.wav", "kick").is_err());
        assert_eq!(
            validate_relocate_target_filename("kick.wav", "snare.WAV").unwrap(),
            "snare.WAV"
        );
    }
}
