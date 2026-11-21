use crate::commands::ProfileExportPackage;
use crate::security::{
    has_ntfs_ads_colon, is_forbidden_os_or_root_path, is_unc_or_network_path, normalize_clean_path,
};
use rusqlite::{params, Transaction};
use std::collections::{HashMap, HashSet};

pub(super) fn restore_manual_meta_slices_and_bin(
    tx: &Transaction<'_>,
    new_profile_id: i64,
    pkg: &ProfileExportPackage,
    resolved_ref_ids: &[Option<i64>],
    sample_meta_by_id: &HashMap<i64, (String, String)>,
) -> Result<Vec<i64>, String> {
    for entry in &pkg.manual_bpm_key_ref_indices {
        if let Some(Some(sample_id)) = resolved_ref_ids.get(entry.sample_index) {
            let safe_bpm = entry
                .bpm
                .filter(|b| b.is_finite() && *b >= 20.0 && *b <= 300.0);
            let mkey: String = entry.musical_key.trim().chars().take(24).collect();
            let ckey: String = entry.camelot_key.trim().chars().take(24).collect();
            tx.execute(
                "UPDATE samples
                 SET bpm = CASE WHEN ?1 = 1 THEN ?2 ELSE bpm END,
                     bpm_is_manual = CASE WHEN ?1 = 1 THEN 1 ELSE bpm_is_manual END,
                     musical_key = CASE WHEN ?3 = 1 THEN ?4 ELSE musical_key END,
                     camelot_key = CASE WHEN ?3 = 1 THEN ?5 ELSE camelot_key END,
                     key_is_manual = CASE WHEN ?3 = 1 THEN 1 ELSE key_is_manual END
                 WHERE id = ?6",
                params![
                    entry.bpm_is_manual,
                    safe_bpm,
                    entry.key_is_manual,
                    mkey,
                    ckey,
                    sample_id
                ],
            )
            .map_err(|e| format!("Failed restoring sample BPM/Key metadata: {}", e))?;
        }
    }

    for sl in &pkg.slices {
        let slice_name = sl.slice_name.trim();
        let raw_slice_path = sl.slice_path.trim();
        if slice_name.is_empty()
            || raw_slice_path.is_empty()
            || is_unc_or_network_path(raw_slice_path)
            || has_ntfs_ads_colon(raw_slice_path)
            || is_forbidden_os_or_root_path(raw_slice_path)
        {
            continue;
        }
        let resolved_src_id = sl
            .source_sample_index
            .and_then(|idx| resolved_ref_ids.get(idx).copied().flatten());
        let (final_src_path, final_src_name) = if let Some(sid) = resolved_src_id {
            if let Some((fpath, fname)) = sample_meta_by_id.get(&sid) {
                (
                    crate::commands::slices::format_os_display_path(std::path::Path::new(
                        &normalize_clean_path(fpath),
                    )),
                    fname.clone(),
                )
            } else {
                (
                    crate::commands::slices::format_os_display_path(std::path::Path::new(
                        &normalize_clean_path(&sl.source_file_path),
                    )),
                    sl.source_file_name.clone(),
                )
            }
        } else if is_unc_or_network_path(&sl.source_file_path)
            || has_ntfs_ads_colon(&sl.source_file_path)
        {
            (sl.source_file_name.clone(), sl.source_file_name.clone())
        } else {
            (
                crate::commands::slices::format_os_display_path(std::path::Path::new(
                    &normalize_clean_path(&sl.source_file_path),
                )),
                sl.source_file_name.clone(),
            )
        };
        let norm_slice = crate::commands::slices::format_os_display_path(std::path::Path::new(
            &normalize_clean_path(raw_slice_path),
        ));
        let pitch = if sl.pitch_semitones.is_finite() {
            sl.pitch_semitones.clamp(-24.0, 24.0)
        } else {
            0.0
        };
        let start = if sl.start_sec.is_finite() {
            sl.start_sec.max(0.0)
        } else {
            0.0
        };
        let end = if sl.end_sec.is_finite() {
            sl.end_sec.max(start)
        } else {
            start
        };
        tx.execute(
            "INSERT OR IGNORE INTO sample_slices (
                profile_id, slice_path, slice_name, source_sample_id,
                source_file_path, source_file_name, start_sec, end_sec,
                pitch_semitones, micro_fade, duration_ms, is_favorite,
                sample_rate, channels, bit_depth, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                       COALESCE(NULLIF(?16, ''), datetime('now')))",
            params![
                new_profile_id,
                norm_slice,
                slice_name,
                resolved_src_id,
                final_src_path,
                final_src_name,
                start,
                end,
                pitch,
                sl.micro_fade,
                sl.duration_ms.max(0),
                sl.is_favorite,
                sl.sample_rate.clamp(8000, 384_000),
                sl.channels.clamp(1, 8),
                sl.bit_depth.clamp(8, 64),
                sl.created_at
            ],
        )
        .map_err(|e| format!("Failed restoring slice record '{}': {}", slice_name, e))?;
    }

    let mut seen_bin = HashSet::new();
    let mut resolved_bin_ids = Vec::with_capacity(pkg.bin_sample_indices.len());
    for &idx in &pkg.bin_sample_indices {
        if let Some(Some(sample_id)) = resolved_ref_ids.get(idx) {
            if seen_bin.insert(*sample_id) {
                resolved_bin_ids.push(*sample_id);
            }
        }
    }
    Ok(resolved_bin_ids)
}
