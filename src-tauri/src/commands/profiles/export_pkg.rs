use crate::commands::{
    compute_rel_path, make_resilient_ref, normalize_path_str, query_profile_by_id,
    ExportedCollectionEntry, ExportedGenreEntry, ExportedLibraryEntry, ExportedManualLoopIndexEntry,
    ExportedManualMetaIndexEntry, ExportedSliceEntry, ExportedTagEntry, Profile,
    ProfileExportPackage, ResilientSampleRef,
};
use crate::security::{normalize_clean_path, sanitize_settings_paths};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

pub(crate) use super::export_share::apply_share_safe;
use super::export_share::populate_scope_rel_paths;

struct SampleRefInterner<'a> {
    lib_paths: &'a [String],
    refs: Vec<ResilientSampleRef>,
    index_by_path: HashMap<String, usize>,
}

impl<'a> SampleRefInterner<'a> {
    fn new(lib_paths: &'a [String]) -> Self {
        Self {
            lib_paths,
            refs: Vec::new(),
            index_by_path: HashMap::new(),
        }
    }

    fn intern(
        &mut self,
        fpath: String,
        fname: Option<String>,
        fsize: Option<i64>,
        dur_ms: Option<i64>,
    ) -> usize {
        let key = normalize_path_str(&fpath).to_lowercase();
        if let Some(&idx) = self.index_by_path.get(&key) {
            return idx;
        }
        let idx = self.refs.len();
        self.refs
            .push(make_resilient_ref(fpath, fname, fsize, dur_ms, self.lib_paths));
        self.index_by_path.insert(key, idx);
        idx
    }
}

pub(crate) fn build_profile_export_package_with_options(
    conn: &Connection,
    profile_id: i64,
    include_ai_tags: bool,
) -> Result<(Profile, ProfileExportPackage), String> {
    let profile = query_profile_by_id(conn, profile_id)?;
    let settings: serde_json::Value =
        serde_json::from_str(&profile.settings_json).unwrap_or_else(|_| serde_json::json!({}));

    let mut sanitized_settings = settings;
    sanitize_settings_paths(&mut sanitized_settings, false);

    let mut libraries = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT l.path, l.name, l.is_global, COALESCE(l.is_read_only, 0)
         FROM libraries l
         WHERE l.is_global = 1
            OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
         ORDER BY l.name COLLATE NOCASE ASC",
    ) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok(ExportedLibraryEntry {
                path: r.get(0)?,
                name: r.get(1)?,
                is_global: r.get(2)?,
                is_read_only: r.get(3)?,
            })
        }) {
            libraries.extend(rows.flatten());
        }
    }

    let lib_paths: Vec<String> = libraries.iter().map(|l| l.path.clone()).collect();
    let mut interner = SampleRefInterner::new(&lib_paths);

    if let Some(obj) = sanitized_settings.as_object_mut() {
        if let Some(groups) = obj.get_mut("licenseGroups").and_then(|v| v.as_array_mut()) {
            for group in groups {
                if let Some(g_obj) = group.as_object_mut() {
                    let mut rel_folders: Vec<String> = Vec::new();
                    if let Some(folders) = g_obj.get("folders").and_then(|f| f.as_array()) {
                        for f_val in folders {
                            if let Some(f_str) = f_val.as_str() {
                                if let Some(rel) = compute_rel_path(f_str, &lib_paths) {
                                    if !rel_folders.contains(&rel) {
                                        rel_folders.push(rel);
                                    }
                                }
                            }
                        }
                    }
                    if !rel_folders.is_empty() {
                        g_obj.insert(
                            "rel_folders".to_string(),
                            serde_json::to_value(rel_folders).unwrap_or_default(),
                        );
                    }
                }
            }
        }

        if let Some(templates) = obj
            .get_mut("collectionTemplates")
            .and_then(|v| v.as_array_mut())
        {
            for tmpl in templates {
                if let Some(t_obj) = tmpl.as_object_mut() {
                    if let Some(fp) = t_obj.get("folder_path").and_then(|f| f.as_str()) {
                        if !fp.trim().is_empty() {
                            if let Some(rel) = compute_rel_path(fp, &lib_paths) {
                                t_obj.insert(
                                    "rel_folder_path".to_string(),
                                    serde_json::Value::String(rel),
                                );
                            }
                        }
                    }
                }
            }
        }

        populate_scope_rel_paths(obj, "autoTagCategories", &lib_paths);
        populate_scope_rel_paths(obj, "autoTagRules", &lib_paths);
    }

    let mut tags = Vec::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT name, color FROM tags ORDER BY name COLLATE NOCASE ASC")
    {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(ExportedTagEntry {
                name: r.get(0)?,
                color: r.get(1)?,
            })
        }) {
            tags.extend(rows.flatten());
        }
    }

    let mut genres = Vec::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT name, color FROM genres ORDER BY name COLLATE NOCASE ASC")
    {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(ExportedGenreEntry {
                name: r.get(0)?,
                color: r.get(1)?,
            })
        }) {
            genres.extend(rows.flatten());
        }
    }

    let mut collections = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT c.id, c.name, COALESCE(c.color, '#10B981'), COALESCE(c.icon, 'layers'),
                p.name, c.rule_path, c.smart_query
         FROM collections c
         LEFT JOIN collections p ON p.id = c.parent_id
         WHERE c.profile_id = ?1
         ORDER BY (CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END), c.name COLLATE NOCASE ASC",
    ) {
        type ExportColRow = (
            i64,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let col_rows: Vec<ExportColRow> = stmt
            .query_map(params![profile_id], |r| {
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
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect();

        let mut items_by_col: HashMap<i64, Vec<usize>> = HashMap::new();
        if let Ok(mut item_stmt) = conn.prepare(
            "SELECT ci.collection_id, s.file_path, s.file_name, s.file_size, s.duration_ms
             FROM collection_items ci
             INNER JOIN collections c ON c.id = ci.collection_id
             INNER JOIN samples s ON s.id = ci.sample_id
             WHERE c.profile_id = ?1
               AND COALESCE(s.is_trashed, 0) = 0
             ORDER BY ci.collection_id ASC, s.file_path ASC",
        ) {
            if let Ok(p_rows) = item_stmt.query_map(params![profile_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                ))
            }) {
                for (col_id, fpath, fname, fsize, dur_ms) in p_rows.flatten() {
                    let idx = interner.intern(fpath, fname, fsize, dur_ms);
                    items_by_col.entry(col_id).or_default().push(idx);
                }
            }
        }

        for (cid, cname, ccolor, cicon, parent_name, rule_path, smart_query) in col_rows {
            let is_smart = smart_query
                .as_deref()
                .map(|q| !q.trim().is_empty())
                .unwrap_or(false);
            let rel_rule_path = if is_smart {
                None
            } else {
                rule_path
                    .as_ref()
                    .and_then(|rp| compute_rel_path(rp, &lib_paths))
            };
            let sample_indices = if is_smart {
                Vec::new()
            } else {
                items_by_col.remove(&cid).unwrap_or_default()
            };
            collections.push(ExportedCollectionEntry {
                name: cname,
                color: ccolor,
                icon: cicon,
                parent_name,
                rule_path: if is_smart {
                    None
                } else {
                    rule_path.map(|rp| normalize_clean_path(&rp))
                },
                rel_rule_path,
                smart_query: smart_query.and_then(|q| {
                    let t = q.trim();
                    (!t.is_empty()).then(|| t.to_string())
                }),
                sample_indices,
                ..Default::default()
            });
        }
    }

    let mut favorite_ref_indices = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT s.file_path, s.file_name, s.file_size, s.duration_ms
         FROM profile_favorites pf
         INNER JOIN samples s ON s.id = pf.sample_id
         WHERE pf.profile_id = ?1
           AND COALESCE(s.is_trashed, 0) = 0
         ORDER BY s.file_path ASC",
    ) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        }) {
            for (fpath, fname, fsize, dur_ms) in rows.flatten() {
                favorite_ref_indices.push(interner.intern(fpath, fname, fsize, dur_ms));
            }
        }
    }

    let lib_filter = "COALESCE(s.is_trashed, 0) = 0 AND s.library_id IN (SELECT l.id FROM libraries l WHERE l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))";

    let mut manual_tag_ref_indices: HashMap<String, Vec<usize>> = HashMap::new();
    let mut ai_approved_tag_ref_indices: HashMap<String, Vec<usize>> = HashMap::new();
    let tag_sql = format!(
        "SELECT t.name, COALESCE(st.source, 'manual'), s.file_path, s.file_name, s.file_size, s.duration_ms
         FROM sample_tags st
         INNER JOIN samples s ON s.id = st.sample_id
         INNER JOIN tags t ON t.id = st.tag_id
         WHERE st.is_manual = 1 AND {lib_filter}
         ORDER BY t.name ASC, s.file_path ASC"
    );
    if let Ok(mut stmt) = conn.prepare(&tag_sql) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<i64>>(5)?,
            ))
        }) {
            for (tname, source, fpath, fname, fsize, dur_ms) in rows.flatten() {
                if source == "ai_approved" {
                    if include_ai_tags {
                        let idx = interner.intern(fpath, fname, fsize, dur_ms);
                        ai_approved_tag_ref_indices.entry(tname).or_default().push(idx);
                    }
                } else {
                    let idx = interner.intern(fpath, fname, fsize, dur_ms);
                    manual_tag_ref_indices.entry(tname).or_default().push(idx);
                }
            }
        }
    }

    let mut manual_genre_ref_indices: HashMap<String, Vec<usize>> = HashMap::new();
    let genre_sql = format!(
        "SELECT s.genre, s.file_path, s.file_name, s.file_size, s.duration_ms
         FROM samples s
         WHERE s.genre_is_manual = 1 AND s.genre != '' AND {lib_filter}
         ORDER BY s.genre ASC, s.file_path ASC"
    );
    if let Ok(mut stmt) = conn.prepare(&genre_sql) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<i64>>(4)?,
            ))
        }) {
            for (gname, fpath, fname, fsize, dur_ms) in rows.flatten() {
                let idx = interner.intern(fpath, fname, fsize, dur_ms);
                manual_genre_ref_indices.entry(gname).or_default().push(idx);
            }
        }
    }

    let mut manual_loop_ref_indices: Vec<ExportedManualLoopIndexEntry> = Vec::new();
    let loop_sql = format!(
        "SELECT s.is_loop, s.file_path, s.file_name, s.file_size, s.duration_ms
         FROM samples s
         WHERE s.loop_is_manual = 1 AND {lib_filter}
         ORDER BY s.file_path ASC"
    );
    if let Ok(mut stmt) = conn.prepare(&loop_sql) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((
                r.get::<_, bool>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<i64>>(4)?,
            ))
        }) {
            for (is_loop, fpath, fname, fsize, dur_ms) in rows.flatten() {
                let sample_index = interner.intern(fpath, fname, fsize, dur_ms);
                manual_loop_ref_indices.push(ExportedManualLoopIndexEntry {
                    is_loop,
                    sample_index,
                });
            }
        }
    }

    let mut manual_bpm_key_ref_indices: Vec<ExportedManualMetaIndexEntry> = Vec::new();
    let meta_sql = format!(
        "SELECT s.bpm, COALESCE(s.musical_key, ''), COALESCE(s.camelot_key, ''),
                COALESCE(s.bpm_is_manual, 0), COALESCE(s.key_is_manual, 0),
                s.file_path, s.file_name, s.file_size, s.duration_ms
         FROM samples s
         WHERE (COALESCE(s.bpm_is_manual, 0) = 1 OR COALESCE(s.key_is_manual, 0) = 1)
           AND {lib_filter}
         ORDER BY s.file_path ASC"
    );
    if let Ok(mut stmt) = conn.prepare(&meta_sql) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((
                r.get::<_, Option<f64>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, bool>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<i64>>(7)?,
                r.get::<_, Option<i64>>(8)?,
            ))
        }) {
            for (bpm, mkey, ckey, bpm_man, key_man, fpath, fname, fsize, dur_ms) in rows.flatten() {
                let sample_index = interner.intern(fpath, fname, fsize, dur_ms);
                manual_bpm_key_ref_indices.push(ExportedManualMetaIndexEntry {
                    sample_index,
                    bpm,
                    musical_key: mkey,
                    camelot_key: ckey,
                    bpm_is_manual: bpm_man,
                    key_is_manual: key_man,
                });
            }
        }
    }

    let mut bin_sample_indices: Vec<usize> = Vec::new();
    let bin_ids: Vec<i64> = sanitized_settings
        .get("binSampleIds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            let mut seen = HashSet::new();
            arr.iter()
                .filter_map(|v| v.as_i64())
                .filter(|id| *id > 0 && seen.insert(*id))
                .collect()
        })
        .unwrap_or_default();
    if !bin_ids.is_empty() {
        type BinSampleRow = (String, Option<String>, Option<i64>, Option<i64>);
        let mut by_id: HashMap<i64, BinSampleRow> = HashMap::with_capacity(bin_ids.len());
        for chunk in bin_ids.chunks(450) {
            let placeholders: Vec<String> = (1..=chunk.len()).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT id, file_path, file_name, file_size, duration_ms
                 FROM samples
                 WHERE COALESCE(is_trashed, 0) = 0 AND id IN ({})",
                placeholders.join(", ")
            );
            let params_vec: Vec<rusqlite::types::Value> = chunk
                .iter()
                .map(|id| rusqlite::types::Value::Integer(*id))
                .collect();
            if let Ok(mut stmt) = conn.prepare(&sql) {
                if let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(params_vec.iter()), |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<i64>>(3)?,
                        r.get::<_, Option<i64>>(4)?,
                    ))
                }) {
                    for (id, fp, fnm, fsz, dur) in rows.flatten() {
                        by_id.insert(id, (fp, fnm, fsz, dur));
                    }
                }
            }
        }
        for id in bin_ids {
            if let Some((fp, fnm, fsz, dur)) = by_id.remove(&id) {
                bin_sample_indices.push(interner.intern(fp, fnm, fsz, dur));
            }
        }
    }

    let mut slices: Vec<ExportedSliceEntry> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT sl.slice_path, sl.slice_name, sl.source_file_path, sl.source_file_name,
                sl.start_sec, sl.end_sec, sl.pitch_semitones, sl.micro_fade,
                sl.duration_ms, COALESCE(sl.is_favorite, 0),
                COALESCE(sl.sample_rate, 48000), COALESCE(sl.channels, 2), COALESCE(sl.bit_depth, 16),
                sl.created_at,
                src.file_path, src.file_name, src.file_size, src.duration_ms
         FROM sample_slices sl
         LEFT JOIN samples src ON src.id = sl.source_sample_id AND COALESCE(src.is_trashed, 0) = 0
         WHERE sl.profile_id = ?1 AND COALESCE(sl.is_trashed, 0) = 0
         ORDER BY sl.created_at ASC, sl.id ASC",
    ) {
        if let Ok(rows) = stmt.query_map(params![profile_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, bool>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, bool>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, i64>(11)?,
                r.get::<_, i64>(12)?,
                r.get::<_, String>(13)?,
                r.get::<_, Option<String>>(14)?,
                r.get::<_, Option<String>>(15)?,
                r.get::<_, Option<i64>>(16)?,
                r.get::<_, Option<i64>>(17)?,
            ))
        }) {
            for (
                slice_path,
                slice_name,
                source_file_path,
                source_file_name,
                start_sec,
                end_sec,
                pitch_semitones,
                micro_fade,
                duration_ms,
                is_favorite,
                sample_rate,
                channels,
                bit_depth,
                created_at,
                src_fp,
                src_fnm,
                src_fsz,
                src_dur,
            ) in rows.flatten()
            {
                let source_sample_index = src_fp.map(|fp| interner.intern(fp, src_fnm, src_fsz, src_dur));
                slices.push(ExportedSliceEntry {
                    slice_path: normalize_clean_path(&slice_path),
                    slice_name,
                    source_sample_index,
                    source_file_path: normalize_clean_path(&source_file_path),
                    source_file_name,
                    start_sec,
                    end_sec,
                    pitch_semitones,
                    micro_fade,
                    duration_ms,
                    is_favorite,
                    sample_rate,
                    channels,
                    bit_depth,
                    created_at,
                });
            }
        }
    }

    let pkg = ProfileExportPackage {
        format: "audify-profile-v3".to_string(),
        version: 3,
        name: profile.name.clone(),
        color: profile.color.clone(),
        includes_ai_tags: include_ai_tags && !ai_approved_tag_ref_indices.is_empty(),
        settings: sanitized_settings,
        libraries,
        tags,
        genres,
        collections,
        sample_refs: interner.refs,
        favorite_ref_indices,
        bin_sample_indices,
        manual_tag_ref_indices,
        ai_approved_tag_ref_indices,
        manual_genre_ref_indices,
        manual_loop_ref_indices,
        manual_bpm_key_ref_indices,
        slices,
        ..Default::default()
    };

    Ok((profile, pkg))
}