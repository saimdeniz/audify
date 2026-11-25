use super::path_relink::{resolve_rel_path_inside_library, sanitize_direct_existing_dir};
use crate::commands::taxonomy::collections::sanitize_smart_query;
use crate::commands::{
    insert_unique, normalize_path_str, strip_lib_prefix, ImportReport, ProfileExportPackage,
    ResilientSampleRef,
};
use crate::db::deterministic_color_for_name;
use crate::security::{is_valid_collection_icon, sanitize_hex_color_or_default};
use rusqlite::{params, Transaction};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub(super) fn restore_imported_profile_relations(
    tx: &Transaction<'_>,
    new_profile_id: i64,
    pkg: &ProfileExportPackage,
    current_lib_paths: &[String],
) -> Result<(ImportReport, Vec<i64>), String> {
    let mut exact_map: HashMap<String, Option<i64>> = HashMap::new();
    let mut rel_map: HashMap<String, Option<i64>> = HashMap::new();
    let mut name_size_dur_map: HashMap<(String, i64, i64), Option<i64>> = HashMap::new();
    let mut name_size_map: HashMap<(String, i64), Option<i64>> = HashMap::new();
    let mut sample_meta_by_id: HashMap<i64, (String, String)> = HashMap::new();

    if let Ok(mut s_stmt) = tx.prepare(
        "SELECT s.id, s.file_path, s.file_name, s.file_size, s.duration_ms
         FROM samples s
         INNER JOIN libraries l ON l.id = s.library_id
         WHERE COALESCE(s.is_trashed, 0) = 0
           AND (l.is_global = 1
                OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))",
    ) {
        if let Ok(s_rows) = s_stmt.query_map(params![new_profile_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        }) {
            for (sid, fpath, fname, fsize, dur_ms) in s_rows.flatten() {
                sample_meta_by_id.insert(sid, (fpath.clone(), fname.clone()));
                insert_unique(
                    &mut exact_map,
                    normalize_path_str(&fpath).to_lowercase(),
                    sid,
                );

                for lib in current_lib_paths {
                    if let Some(rel) = strip_lib_prefix(&fpath, lib) {
                        insert_unique(&mut rel_map, rel.to_lowercase(), sid);
                    }
                }

                if fsize > 0 && !fname.is_empty() {
                    let lower_name = fname.to_lowercase();
                    insert_unique(&mut name_size_dur_map, (lower_name.clone(), fsize, dur_ms), sid);
                    insert_unique(&mut name_size_map, (lower_name, fsize), sid);
                }
            }
        }
    }

    let matched_keys = std::cell::RefCell::new(HashSet::<String>::new());
    let unmatched_keys = std::cell::RefCell::new(HashSet::<String>::new());
    let ambiguous_keys = std::cell::RefCell::new(HashSet::<String>::new());

    let resolve_sample_id = |s_ref: &ResilientSampleRef| -> Option<i64> {
        let report_key = s_ref
            .rel_path
            .clone()
            .unwrap_or_else(|| s_ref.file_path.clone());
        let mut ambiguous = false;
        let mut found: Option<i64> = None;

        let norm_exact = normalize_path_str(&s_ref.file_path).to_lowercase();
        match exact_map.get(&norm_exact) {
            Some(Some(id)) => found = Some(*id),
            Some(None) => ambiguous = true,
            None => {}
        }

        if found.is_none() {
            if let Some(ref r_path) = s_ref.rel_path {
                let norm_rel = normalize_path_str(r_path)
                    .trim_start_matches('/')
                    .to_lowercase();
                match rel_map.get(&norm_rel) {
                    Some(Some(id)) => found = Some(*id),
                    Some(None) => ambiguous = true,
                    None => {}
                }
            }
        }

        if found.is_none() {
            let fname = s_ref.file_name.clone().or_else(|| {
                Path::new(&s_ref.file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            });
            if let (Some(fname), Some(fsize)) = (fname, s_ref.file_size) {
                if fsize > 0 {
                    let lower = fname.to_lowercase();
                    if let Some(dur_ms) = s_ref.duration_ms {
                        match name_size_dur_map.get(&(lower.clone(), fsize, dur_ms)) {
                            Some(Some(id)) => found = Some(*id),
                            Some(None) => ambiguous = true,
                            None => {}
                        }
                    }
                    if found.is_none() && !ambiguous {
                        match name_size_map.get(&(lower, fsize)) {
                            Some(Some(id)) => found = Some(*id),
                            Some(None) => ambiguous = true,
                            None => {}
                        }
                    }
                }
            }
        }

        match found {
            Some(id) => {
                matched_keys.borrow_mut().insert(report_key);
                Some(id)
            }
            None => {
                if ambiguous {
                    ambiguous_keys.borrow_mut().insert(report_key);
                } else {
                    unmatched_keys.borrow_mut().insert(report_key);
                }
                None
            }
        }
    };

    // Pre-resolve deduplicated v3 `sample_refs` once so tag/collection index lookups avoid
    // repeating path resolution across multiple tags on the same file.
    let resolved_ref_ids: Vec<Option<i64>> = pkg
        .sample_refs
        .iter()
        .map(&resolve_sample_id)
        .collect();

    let mut genre_domain_facet_ids: HashSet<i64> = HashSet::from([
        crate::taxonomy_catalog::FACET_GENRE_ID,
        crate::taxonomy_catalog::FACET_MOOD_ID,
    ]);
    if let Ok(mut f_stmt) = tx.prepare("SELECT id, COALESCE(domain, 'tags') FROM tag_facets") {
        if let Ok(f_rows) =
            f_stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        {
            for (fid, dom) in f_rows.flatten() {
                if dom.eq_ignore_ascii_case("genres") {
                    genre_domain_facet_ids.insert(fid);
                } else {
                    genre_domain_facet_ids.remove(&fid);
                }
            }
        }
    }

    let mut tag_ids_by_lower_name: HashMap<String, (i64, bool)> = HashMap::new();
    if let Ok(mut t_stmt) = tx.prepare("SELECT id, name, COALESCE(facet_id, 1) FROM tags") {
        if let Ok(t_rows) = t_stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        }) {
            for (tid, tname, fid) in t_rows.flatten() {
                tag_ids_by_lower_name.insert(
                    tname.trim().to_lowercase(),
                    (tid, genre_domain_facet_ids.contains(&fid)),
                );
            }
        }
    }

    let mut root_collections_by_name: HashMap<String, i64> = HashMap::new();

    for col in &pkg.collections {
        let col_name = col.name.trim();
        if col_name.is_empty() || col_name.chars().count() > 80 {
            continue;
        }
        let parent_id = col
            .parent_name
            .as_ref()
            .and_then(|pname| root_collections_by_name.get(&pname.trim().to_lowercase()).copied());

        let smart_query = sanitize_smart_query(col.smart_query.clone(), false)
            .ok()
            .flatten()
            .filter(|_| parent_id.is_none());

        // Relink rule_path across current libraries and normalize with `/` forward slashes!
        let rule_path = if smart_query.is_some() {
            None
        } else {
            col.rel_rule_path
                .as_ref()
                .and_then(|rel| {
                    current_lib_paths
                        .iter()
                        .find_map(|lib| resolve_rel_path_inside_library(lib, rel, true))
                })
                .or_else(|| {
                    col.rule_path
                        .as_ref()
                        .and_then(|rp| sanitize_direct_existing_dir(rp))
                })
        };

        let safe_col_color = sanitize_hex_color_or_default(&col.color, "#10B981");
        let safe_icon = if is_valid_collection_icon(&col.icon) {
            col.icon.trim()
        } else {
            "layers"
        };
        tx.execute(
            "INSERT INTO collections (profile_id, parent_id, rule_path, smart_query, name, color, icon, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            params![
                new_profile_id,
                parent_id,
                rule_path,
                smart_query,
                col_name,
                safe_col_color,
                safe_icon
            ],
        )
        .map_err(|e| format!("Failed restoring collection '{}': {}", col_name, e))?;

        let col_id = tx.last_insert_rowid();
        if parent_id.is_none() {
            root_collections_by_name.insert(col_name.to_lowercase(), col_id);
        }

        if smart_query.is_some() {
            continue;
        }

        if !col.sample_indices.is_empty() {
            for &idx in &col.sample_indices {
                if let Some(Some(sample_id)) = resolved_ref_ids.get(idx) {
                    tx.execute(
                        "INSERT OR IGNORE INTO collection_items (collection_id, sample_id)
                         VALUES (?1, ?2)",
                        params![col_id, sample_id],
                    )
                    .map_err(|e| format!("Failed restoring collection item: {}", e))?;
                }
            }
        } else {
            let refs: Vec<ResilientSampleRef> = if !col.samples.is_empty() {
                col.samples.clone()
            } else {
                col.sample_file_paths
                    .iter()
                    .map(|p| ResilientSampleRef {
                        file_path: p.clone(),
                        rel_path: None,
                        file_name: None,
                        file_size: None,
                        duration_ms: None,
                    })
                    .collect()
            };

            for s_ref in refs {
                if let Some(sample_id) = resolve_sample_id(&s_ref) {
                    let _ = tx.execute(
                        "INSERT OR IGNORE INTO collection_items (collection_id, sample_id)
                         VALUES (?1, ?2)",
                        params![col_id, sample_id],
                    );
                }
            }
        }
    }

    if !pkg.favorite_ref_indices.is_empty() {
        for &idx in &pkg.favorite_ref_indices {
            if let Some(Some(sample_id)) = resolved_ref_ids.get(idx) {
                tx.execute(
                    "INSERT OR IGNORE INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
                    params![new_profile_id, sample_id],
                )
                .map_err(|e| format!("Failed restoring favorite: {}", e))?;
            }
        }
    } else {
        let fav_refs: Vec<ResilientSampleRef> = if !pkg.favorite_samples.is_empty() {
            pkg.favorite_samples.clone()
        } else {
            pkg.favorite_sample_paths
                .iter()
                .map(|p| ResilientSampleRef {
                    file_path: p.clone(),
                    rel_path: None,
                    file_name: None,
                    file_size: None,
                    duration_ms: None,
                })
                .collect()
        };

        for s_ref in fav_refs {
            if let Some(sample_id) = resolve_sample_id(&s_ref) {
                tx.execute(
                    "INSERT OR IGNORE INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
                    params![new_profile_id, sample_id],
                )
                .map_err(|e| format!("Failed restoring favorite: {}", e))?;
            }
        }
    }

    let mut genre_touched_samples: Vec<i64> = Vec::new();
    if !pkg.manual_tag_ref_indices.is_empty() {
        let mut ins_manual = tx
            .prepare(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                 VALUES (?1, ?2, 1, 'manual')
                 ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
            )
            .map_err(|e| format!("Failed preparing tag insert: {}", e))?;
        for (tag_name, indices) in &pkg.manual_tag_ref_indices {
            if let Some(&(tag_id, is_gm)) =
                tag_ids_by_lower_name.get(&tag_name.trim().to_lowercase())
            {
                for &idx in indices {
                    if let Some(Some(sample_id)) = resolved_ref_ids.get(idx) {
                        ins_manual
                            .execute(params![sample_id, tag_id])
                            .map_err(|e| format!("Failed restoring tag link: {}", e))?;
                        if is_gm {
                            genre_touched_samples.push(*sample_id);
                        }
                    }
                }
            }
        }
    }

    if !pkg.ai_approved_tag_ref_indices.is_empty() {
        let mut ins_ai = tx
            .prepare(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                 VALUES (?1, ?2, 1, 'ai_approved')
                 ON CONFLICT(sample_id, tag_id) DO UPDATE SET
                    is_manual = 1,
                    source = CASE WHEN sample_tags.source = 'manual' THEN 'manual' ELSE 'ai_approved' END",
            )
            .map_err(|e| format!("Failed preparing AI tag insert: {}", e))?;
        for (tag_name, indices) in &pkg.ai_approved_tag_ref_indices {
            if let Some(&(tag_id, is_gm)) =
                tag_ids_by_lower_name.get(&tag_name.trim().to_lowercase())
            {
                for &idx in indices {
                    if let Some(Some(sample_id)) = resolved_ref_ids.get(idx) {
                        ins_ai
                            .execute(params![sample_id, tag_id])
                            .map_err(|e| format!("Failed restoring AI tag link: {}", e))?;
                        if is_gm {
                            genre_touched_samples.push(*sample_id);
                        }
                    }
                }
            }
        }
    }

    if !pkg.manual_tag_samples.is_empty() {
        for (tag_name, s_refs) in &pkg.manual_tag_samples {
            if let Some(&(tag_id, is_gm)) =
                tag_ids_by_lower_name.get(&tag_name.trim().to_lowercase())
            {
                for s_ref in s_refs {
                    if let Some(sample_id) = resolve_sample_id(s_ref) {
                        tx.execute(
                            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                             VALUES (?1, ?2, 1, 'manual')
                             ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
                            params![sample_id, tag_id],
                        )
                        .map_err(|e| format!("Failed restoring tag link: {}", e))?;
                        if is_gm {
                            genre_touched_samples.push(sample_id);
                        }
                    }
                }
            }
        }
    } else if !pkg.manual_tag_assignments.is_empty() {
        for (tag_name, file_paths) in &pkg.manual_tag_assignments {
            if let Some(&(tag_id, is_gm)) =
                tag_ids_by_lower_name.get(&tag_name.trim().to_lowercase())
            {
                for fp in file_paths {
                    let s_ref = ResilientSampleRef {
                        file_path: fp.clone(),
                        rel_path: None,
                        file_name: None,
                        file_size: None,
                        duration_ms: None,
                    };
                    if let Some(sample_id) = resolve_sample_id(&s_ref) {
                        tx.execute(
                            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                             VALUES (?1, ?2, 1, 'manual')
                             ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
                            params![sample_id, tag_id],
                        )
                        .map_err(|e| format!("Failed restoring tag link: {}", e))?;
                        if is_gm {
                            genre_touched_samples.push(sample_id);
                        }
                    }
                }
            }
        }
    }

    for entry in &pkg.sample_tags {
        let s_ref = entry
            .sample_ref
            .clone()
            .unwrap_or_else(|| ResilientSampleRef {
                file_path: entry.file_path.clone(),
                rel_path: None,
                file_name: None,
                file_size: None,
                duration_ms: None,
            });
        if let Some(sample_id) = resolve_sample_id(&s_ref) {
            for tag_name in &entry.tag_names {
                if let Some(&(tag_id, is_gm)) =
                    tag_ids_by_lower_name.get(&tag_name.trim().to_lowercase())
                {
                    tx.execute(
                        "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual)
                         VALUES (?1, ?2, 0)",
                        params![sample_id, tag_id],
                    )
                    .map_err(|e| format!("Failed restoring sample tag: {}", e))?;
                    if is_gm {
                        genre_touched_samples.push(sample_id);
                    }
                }
            }
        }
    }

    if !pkg.manual_genre_ref_indices.is_empty() {
        for (genre_name, indices) in &pkg.manual_genre_ref_indices {
            let clean_g = genre_name.trim();
            if clean_g.is_empty() || clean_g.chars().count() > 64 {
                continue;
            }
            let (facet_slug, resolved_name) =
                match crate::taxonomy_catalog::sanitize_id3_genre_or_mood_typo(clean_g) {
                    Some((f, canon)) => (f, canon.to_string()),
                    None => (
                        if crate::taxonomy_catalog::is_canonical_mood_name(clean_g) {
                            "mood"
                        } else {
                            "genre"
                        },
                        clean_g.to_string(),
                    ),
                };
            let color = deterministic_color_for_name(&resolved_name);
            let tag_id = crate::db::ensure_taxonomy_tag(
                tx,
                &resolved_name,
                Some(facet_slug),
                None,
                Some(color),
                true,
            )?;
            for &idx in indices {
                if let Some(Some(sample_id)) = resolved_ref_ids.get(idx) {
                    tx.execute(
                        "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                         VALUES (?1, ?2, 1, 'manual')
                         ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
                        params![sample_id, tag_id],
                    )
                    .map_err(|e| format!("Failed restoring sample genre tag: {}", e))?;
                    genre_touched_samples.push(*sample_id);
                }
            }
        }
    }

    for (genre_name, s_refs) in &pkg.manual_genre_assignments {
        let clean_g = genre_name.trim();
        if clean_g.is_empty() || clean_g.chars().count() > 64 {
            continue;
        }
        let (facet_slug, resolved_name) =
            match crate::taxonomy_catalog::sanitize_id3_genre_or_mood_typo(clean_g) {
                Some((f, canon)) => (f, canon.to_string()),
                None => (
                    if crate::taxonomy_catalog::is_canonical_mood_name(clean_g) {
                        "mood"
                    } else {
                        "genre"
                    },
                    clean_g.to_string(),
                ),
            };
        let color = deterministic_color_for_name(&resolved_name);
        let tag_id = crate::db::ensure_taxonomy_tag(
            tx,
            &resolved_name,
            Some(facet_slug),
            None,
            Some(color),
            true,
        )?;
        for s_ref in s_refs {
            if let Some(sample_id) = resolve_sample_id(s_ref) {
                tx.execute(
                    "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                     VALUES (?1, ?2, 1, 'manual')
                     ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
                    params![sample_id, tag_id],
                )
                .map_err(|e| format!("Failed restoring sample genre tag: {}", e))?;
                genre_touched_samples.push(sample_id);
            }
        }
    }
    if !genre_touched_samples.is_empty() {
        crate::db::sync_primary_genre_for_samples(tx, &genre_touched_samples)?;
    }

    for entry in &pkg.manual_loop_ref_indices {
        if let Some(Some(sample_id)) = resolved_ref_ids.get(entry.sample_index) {
            tx.execute(
                "UPDATE samples SET is_loop = ?1, loop_is_manual = 1 WHERE id = ?2",
                params![entry.is_loop, sample_id],
            )
            .map_err(|e| format!("Failed restoring manual loop classification: {}", e))?;
        }
    }

    for entry in &pkg.manual_loops {
        if let Some(sample_id) = resolve_sample_id(&entry.sample) {
            tx.execute(
                "UPDATE samples SET is_loop = ?1, loop_is_manual = 1 WHERE id = ?2",
                params![entry.is_loop, sample_id],
            )
            .map_err(|e| format!("Failed restoring manual loop classification: {}", e))?;
        }
    }

    let resolved_bin_ids = super::slices_and_meta::restore_manual_meta_slices_and_bin(
        tx,
        new_profile_id,
        pkg,
        &resolved_ref_ids,
        &sample_meta_by_id,
    )?;

    let report = {
        let matched = matched_keys.borrow();
        let mut unmatched: Vec<String> = unmatched_keys
            .borrow()
            .iter()
            .filter(|k| !matched.contains(*k))
            .cloned()
            .collect();
        unmatched.sort();
        let ambiguous = ambiguous_keys
            .borrow()
            .iter()
            .filter(|k| !matched.contains(*k))
            .count();
        ImportReport {
            matched: matched.len(),
            unmatched: unmatched.len(),
            ambiguous,
            unmatched_samples: unmatched.into_iter().take(20).collect(),
        }
    };
    Ok((report, resolved_bin_ids))
}