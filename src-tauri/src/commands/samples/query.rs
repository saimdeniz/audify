use super::fts_query::{build_fts_match_expression, load_synonym_config};
use super::lookup::{hydrate_sample_peaks, hydrate_sample_tag_ids, hydrate_sample_tags};
use super::sort::build_samples_order_by_sql;
use crate::commands::{normalize_path_str, parent_folder_path, SampleItem};
use crate::db::{get_active_profile_id, AppState};
use rusqlite::{params_from_iter, Connection};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::State;

const MAX_TAG_BIND_CHUNK: usize = 900;

struct TagHierarchyEntry {
    facet_id: i64,
    path: String,
}

fn load_tag_hierarchy_map(conn: &Connection) -> HashMap<i64, TagHierarchyEntry> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, COALESCE(facet_id, 1), COALESCE(path, '/') FROM tags") {
        if let Ok(rows) = stmt.query_map([], |r| {
            let id: i64 = r.get(0)?;
            let facet_id: i64 = r.get(1)?;
            let raw_path: String = r.get(2)?;
            let path = if raw_path.len() <= 1 {
                format!("/{}/", id)
            } else {
                raw_path
            };
            Ok((id, TagHierarchyEntry { facet_id, path }))
        }) {
            for (id, entry) in rows.flatten() {
                map.insert(id, entry);
            }
        }
    }
    map
}

fn expand_tag_with_descendants(
    tag_id: i64,
    hierarchy: &HashMap<i64, TagHierarchyEntry>,
    out: &mut HashSet<i64>,
) {
    out.insert(tag_id);
    let Some(target) = hierarchy.get(&tag_id) else {
        return;
    };
    if target.path.len() <= 1 {
        return;
    }
    for (&other_id, other) in hierarchy {
        if other_id != tag_id && other.path.starts_with(&target.path) {
            out.insert(other_id);
        }
    }
}

fn query_sample_ids_matching_any_tag_chunked(
    conn: &Connection,
    tag_ids: &[i64],
) -> Result<HashSet<i64>, String> {
    let mut union_samples: HashSet<i64> = HashSet::new();
    for chunk in tag_ids.chunks(MAX_TAG_BIND_CHUNK) {
        let mut placeholders = Vec::with_capacity(chunk.len());
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len());
        for (idx, tid) in chunk.iter().enumerate() {
            placeholders.push(format!("?{}", idx + 1));
            params_vec.push(rusqlite::types::Value::Integer(*tid));
        }
        let sql = format!(
            "SELECT DISTINCT st.sample_id FROM sample_tags st WHERE st.tag_id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Tag chunk query prepare error: {}", e))?;
        let rows = stmt
            .query_map(params_from_iter(params_vec.iter()), |r| r.get::<_, i64>(0))
            .map_err(|e| format!("Tag chunk query execution error: {}", e))?;
        for sid in rows.flatten() {
            union_samples.insert(sid);
        }
    }
    Ok(union_samples)
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn query_samples_with_conn_ext(
    conn: &Connection,
    search_query: Option<String>,
    folder_filter: Option<String>,
    favorite_only: Option<bool>,
    tag_ids: Option<Vec<i64>>,
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
    trashed_only: Option<bool>,
) -> Result<Vec<SampleItem>, String> {
    query_samples_with_conn_faceted(
        conn,
        search_query,
        folder_filter,
        favorite_only,
        tag_ids,
        None,
        None,
        collection_id,
        limit,
        offset,
        include_peaks,
        trashed_only,
        false,
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn query_samples_with_conn_compact(
    conn: &Connection,
    search_query: Option<String>,
    folder_filter: Option<String>,
    favorite_only: Option<bool>,
    tag_ids: Option<Vec<i64>>,
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
    trashed_only: Option<bool>,
    compact_tags: bool,
) -> Result<Vec<SampleItem>, String> {
    query_samples_with_conn_faceted(
        conn,
        search_query,
        folder_filter,
        favorite_only,
        tag_ids,
        None,
        None,
        collection_id,
        limit,
        offset,
        include_peaks,
        trashed_only,
        compact_tags,
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn query_samples_with_conn_faceted(
    conn: &Connection,
    search_query: Option<String>,
    folder_filter: Option<String>,
    favorite_only: Option<bool>,
    tag_ids: Option<Vec<i64>>,
    excluded_tag_ids: Option<Vec<i64>>,
    tag_match_mode: Option<String>,
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
    trashed_only: Option<bool>,
    compact_tags: bool,
) -> Result<Vec<SampleItem>, String> {
    query_samples_with_conn_sorted(
        conn,
        search_query,
        folder_filter,
        favorite_only,
        tag_ids,
        excluded_tag_ids,
        tag_match_mode,
        collection_id,
        limit,
        offset,
        include_peaks,
        trashed_only,
        compact_tags,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn query_samples_with_conn_sorted(
    conn: &Connection,
    search_query: Option<String>,
    folder_filter: Option<String>,
    favorite_only: Option<bool>,
    tag_ids: Option<Vec<i64>>,
    excluded_tag_ids: Option<Vec<i64>>,
    tag_match_mode: Option<String>,
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
    trashed_only: Option<bool>,
    compact_tags: bool,
    sort_key: Option<String>,
    sort_dir: Option<String>,
) -> Result<Vec<SampleItem>, String> {
    let active_id = get_active_profile_id(conn);
    let limit = limit.map(|l| l.max(1));
    let offset = offset.map(|o| o.max(0));
    let want_trashed = trashed_only.unwrap_or(false);
    let want_peaks = include_peaks.unwrap_or(false);

    let mut sql = String::from(
        "SELECT
            s.id,
            s.library_id,
            s.file_path,
            s.file_name,
            s.extension,
            s.duration_ms,
            s.sample_rate,
            s.channels,
            s.bit_depth,
            s.file_size,
            EXISTS(SELECT 1 FROM profile_favorites pf WHERE pf.profile_id = ?1 AND pf.sample_id = s.id),
            s.is_loop,
            COALESCE(s.genre, ''),
            COALESCE(s.artist, ''),
            COALESCE(s.album, ''),
            COALESCE(s.year, ''),
            s.bpm,
            COALESCE(s.musical_key, ''),
            COALESCE(s.camelot_key, ''),
            '',
            s.created_at,
            COALESCE(s.is_trashed, 0),
            s.trashed_at,
            s.original_file_path,
            s.previous_file_name,
            s.file_modified_at
         FROM samples s",
    );

    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();
    let mut where_clauses: Vec<String> = Vec::new();

    if want_trashed {
        where_clauses.push("COALESCE(s.is_trashed, 0) = 1".to_string());
    } else {
        // Matches partial indexes `idx_samples_active_lib_id` & `idx_samples_active_genre_lib`
        where_clauses.push("COALESCE(s.is_trashed, 0) = 0".to_string());
    }

    let fts_match = search_query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .and_then(|q| {
            let syn_cfg = load_synonym_config(conn, active_id);
            build_fts_match_expression(q, syn_cfg.use_synonyms, &syn_cfg.custom_synonyms)
        });

    let using_fts = fts_match.is_some();
    if using_fts {
        sql.push_str(" INNER JOIN samples_fts fts ON fts.rowid = s.id");
    }

    let (order_by_sql, is_default_filename_asc) = build_samples_order_by_sql(
        sort_key.as_deref(),
        sort_dir.as_deref(),
        using_fts,
        want_trashed,
    );

    let use_filename_index_fast_path = is_default_filename_asc
        && limit.unwrap_or(i64::MAX) <= 1_000
        && !using_fts
        && collection_id.is_none()
        && folder_filter
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        && tag_ids.as_ref().is_none_or(Vec::is_empty)
        && excluded_tag_ids.as_ref().is_none_or(Vec::is_empty);

    params_vec.push(rusqlite::types::Value::Integer(active_id));
    where_clauses.push(format!(
        "{}s.library_id IN (
            SELECT l.id FROM libraries l
            WHERE l.is_global = 1
               OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?{})
        )",
        if use_filename_index_fast_path { "+" } else { "" },
        params_vec.len()
    ));

    if let Some(m) = fts_match {
        params_vec.push(rusqlite::types::Value::Text(m));
        where_clauses.push(format!("samples_fts MATCH ?{}", params_vec.len()));
    }

    if let Some(cid) = collection_id {
        if !crate::db::is_collection_in_profile(conn, active_id, cid) {
            where_clauses.push("0 = 1".to_string());
        } else {
            params_vec.push(rusqlite::types::Value::Integer(cid));
            let idx1 = params_vec.len();
            params_vec.push(rusqlite::types::Value::Integer(cid));
            let idx2 = params_vec.len();
            params_vec.push(rusqlite::types::Value::Integer(active_id));
            let idx3 = params_vec.len();
            where_clauses.push(format!(
                "s.id IN (
                    SELECT ci.sample_id FROM collection_items ci
                    WHERE ci.collection_id = ?{}
                       OR ci.collection_id IN (SELECT id FROM collections WHERE parent_id = ?{} AND profile_id = ?{})
                )",
                idx1, idx2, idx3
            ));
        }
    }

    if let Some(folder) = folder_filter
        .as_ref()
        .map(|f| f.trim())
        .filter(|f| !f.is_empty())
    {
        let norm_folder = normalize_path_str(folder);
        let escaped = norm_folder
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like_pat = format!("{}/%", escaped);
        params_vec.push(rusqlite::types::Value::Text(norm_folder));
        let idx1 = params_vec.len();
        params_vec.push(rusqlite::types::Value::Text(like_pat));
        let idx2 = params_vec.len();
        if cfg!(windows) {
            where_clauses.push(format!(
                "(LOWER(s.file_path) = LOWER(?{}) OR LOWER(s.file_path) LIKE LOWER(?{}) ESCAPE '\\')",
                idx1, idx2
            ));
        } else {
            where_clauses.push(format!(
                "(s.file_path = ?{} OR s.file_path LIKE ?{} ESCAPE '\\')",
                idx1, idx2
            ));
        }
    }

    if favorite_only.unwrap_or(false) {
        where_clauses.push(
            "EXISTS(SELECT 1 FROM profile_favorites pf WHERE pf.profile_id = ?1 AND pf.sample_id = s.id)"
                .to_string(),
        );
    }

    let mut large_tag_allowlist: Option<HashSet<i64>> = None;
    let mut large_tag_denylist: Option<HashSet<i64>> = None;
    let has_pos_tags = tag_ids.as_ref().is_some_and(|t| !t.is_empty());
    let has_neg_tags = excluded_tag_ids.as_ref().is_some_and(|t| !t.is_empty());
    let hierarchy = if has_pos_tags || has_neg_tags {
        load_tag_hierarchy_map(conn)
    } else {
        HashMap::new()
    };

    let match_any_within_facet = tag_match_mode
        .as_deref()
        .is_some_and(|m| m.eq_ignore_ascii_case("any"));

    if let Some(tids) = tag_ids.as_ref().filter(|t| !t.is_empty()) {
        // Default ("all"): AND across every selected tag (each expanded with its descendants).
        // Optional ("any"): OR within the same facet, AND across distinct facets.
        let mut tag_groups: Vec<HashSet<i64>> = Vec::new();
        if match_any_within_facet {
            let mut by_facet: BTreeMap<i64, HashSet<i64>> = BTreeMap::new();
            for &tid in tids {
                let facet_key = hierarchy.get(&tid).map(|e| e.facet_id).unwrap_or(-1);
                if facet_key < 0 {
                    return Ok(Vec::new());
                }
                let bucket = by_facet.entry(facet_key).or_default();
                expand_tag_with_descendants(tid, &hierarchy, bucket);
            }
            tag_groups.extend(by_facet.into_values());
        } else {
            let mut seen_tids: HashSet<i64> = HashSet::new();
            for &tid in tids {
                if !seen_tids.insert(tid) {
                    continue;
                }
                if !hierarchy.contains_key(&tid) {
                    return Ok(Vec::new());
                }
                let mut group = HashSet::new();
                expand_tag_with_descendants(tid, &hierarchy, &mut group);
                tag_groups.push(group);
            }
        }

        for expanded_set in tag_groups {
            let mut expanded_vec: Vec<i64> = expanded_set.into_iter().collect();
            expanded_vec.sort_unstable();
            if expanded_vec.len() <= MAX_TAG_BIND_CHUNK
                && params_vec.len() + expanded_vec.len() <= MAX_TAG_BIND_CHUNK
            {
                let mut placeholders = Vec::with_capacity(expanded_vec.len());
                for tid in &expanded_vec {
                    params_vec.push(rusqlite::types::Value::Integer(*tid));
                    placeholders.push(format!("?{}", params_vec.len()));
                }
                where_clauses.push(format!(
                    "EXISTS(
                        SELECT 1 FROM sample_tags st
                        WHERE st.sample_id = s.id AND st.tag_id IN ({})
                    )",
                    placeholders.join(", ")
                ));
            } else {
                let matched_ids = query_sample_ids_matching_any_tag_chunked(conn, &expanded_vec)?;
                if matched_ids.is_empty() {
                    return Ok(Vec::new());
                }
                large_tag_allowlist = Some(match large_tag_allowlist {
                    None => matched_ids,
                    Some(prev) => prev.intersection(&matched_ids).copied().collect(),
                });
                if large_tag_allowlist.as_ref().is_none_or(HashSet::is_empty) {
                    return Ok(Vec::new());
                }
            }
        }
    }

    if let Some(ex_tids) = excluded_tag_ids.as_ref().filter(|t| !t.is_empty()) {
        let mut expanded_excl: HashSet<i64> = HashSet::new();
        for &tid in ex_tids {
            expand_tag_with_descendants(tid, &hierarchy, &mut expanded_excl);
        }
        let mut excl_vec: Vec<i64> = expanded_excl.into_iter().collect();
        excl_vec.sort_unstable();
        if excl_vec.len() <= MAX_TAG_BIND_CHUNK
            && params_vec.len() + excl_vec.len() <= MAX_TAG_BIND_CHUNK
        {
            let mut placeholders = Vec::with_capacity(excl_vec.len());
            for tid in &excl_vec {
                params_vec.push(rusqlite::types::Value::Integer(*tid));
                placeholders.push(format!("?{}", params_vec.len()));
            }
            where_clauses.push(format!(
                "NOT EXISTS(
                    SELECT 1 FROM sample_tags st
                    WHERE st.sample_id = s.id AND st.tag_id IN ({})
                )",
                placeholders.join(", ")
            ));
        } else {
            let denied = query_sample_ids_matching_any_tag_chunked(conn, &excl_vec)?;
            if !denied.is_empty() {
                large_tag_denylist = Some(denied);
            }
        }
    }

    if !where_clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_clauses.join(" AND "));
    }

    sql.push_str(&order_by_sql);

    if large_tag_allowlist.is_none() && large_tag_denylist.is_none() {
        if let Some(lim) = limit {
            params_vec.push(rusqlite::types::Value::Integer(lim));
            sql.push_str(&format!(" LIMIT ?{}", params_vec.len()));
        } else if offset.is_some() {
            sql.push_str(" LIMIT -1");
        }
        if let Some(off) = offset {
            params_vec.push(rusqlite::types::Value::Integer(off));
            sql.push_str(&format!(" OFFSET ?{}", params_vec.len()));
        }
    }

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params_from_iter(params_vec.iter()), |row| {
            let id: i64 = row.get(0)?;
            let file_path: String = row.get(2)?;
            let is_trashed: bool = row.get(21)?;
            let trashed_at: Option<String> = row.get(22)?;
            let original_file_path: Option<String> = row.get(23)?;
            let previous_file_name: Option<String> = row.get(24)?;
            let file_modified_at: Option<i64> = row.get(25)?;
            let folder_source = if is_trashed {
                original_file_path.as_deref().unwrap_or(&file_path)
            } else {
                &file_path
            };
            let folder_path = parent_folder_path(folder_source);
            Ok(SampleItem {
                id,
                library_id: row.get(1)?,
                file_path,
                file_name: row.get(3)?,
                folder_path,
                extension: row.get(4)?,
                duration_ms: row.get(5)?,
                sample_rate: row.get(6)?,
                channels: row.get(7)?,
                bit_depth: row.get(8)?,
                file_size: row.get(9)?,
                is_favorite: row.get(10)?,
                is_loop: row.get(11)?,
                genre: row.get(12)?,
                artist: row.get(13)?,
                album: row.get(14)?,
                year: row.get(15)?,
                bpm: row.get(16)?,
                musical_key: row.get(17)?,
                camelot_key: row.get(18)?,
                peaks_json: row.get(19)?,
                tags: Vec::new(),
                tag_ids: Vec::new(),
                created_at: row.get(20)?,
                file_modified_at,
                is_trashed,
                trashed_at,
                original_file_path,
                previous_file_name,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut out = Vec::new();
    for r in rows {
        let item = r.map_err(|e| e.to_string())?;
        if let Some(ref allow) = large_tag_allowlist {
            if !allow.contains(&item.id) {
                continue;
            }
        }
        if let Some(ref deny) = large_tag_denylist {
            if deny.contains(&item.id) {
                continue;
            }
        }
        out.push(item);
    }

    if large_tag_allowlist.is_some() || large_tag_denylist.is_some() {
        let off = offset.unwrap_or(0).max(0) as usize;
        if off > 0 {
            if off >= out.len() {
                out.clear();
            } else {
                out.drain(0..off);
            }
        }
        if let Some(lim) = limit {
            let lim_usize = lim.max(0) as usize;
            if out.len() > lim_usize {
                out.truncate(lim_usize);
            }
        }
    }

    if out.is_empty() {
        return Ok(out);
    }

    if want_peaks {
        hydrate_sample_peaks(conn, &mut out);
    }
    if compact_tags {
        hydrate_sample_tag_ids(conn, active_id, want_trashed, &mut out);
    } else {
        hydrate_sample_tags(conn, active_id, want_trashed, &mut out);
    }

    Ok(out)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_samples(
    state: State<'_, AppState>,
    search_query: Option<String>,
    folder_filter: Option<String>,
    favorite_only: Option<bool>,
    tag_ids: Option<Vec<i64>>,
    excluded_tag_ids: Option<Vec<i64>>,
    tag_match_mode: Option<String>,
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
    trashed_only: Option<bool>,
    compact_tags: Option<bool>,
    sort_key: Option<String>,
    sort_dir: Option<String>,
) -> Result<Vec<SampleItem>, String> {
    let want_compact_tags = compact_tags.unwrap_or(false);
    crate::db::run_read_query(&state, move |conn| {
        query_samples_with_conn_sorted(
            conn,
            search_query,
            folder_filter,
            favorite_only,
            tag_ids,
            excluded_tag_ids,
            tag_match_mode,
            collection_id,
            limit,
            offset,
            include_peaks,
            trashed_only,
            want_compact_tags,
            sort_key,
            sort_dir,
        )
    })
    .await
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn query_samples_with_conn(
    conn: &Connection,
    search_query: Option<String>,
    folder_filter: Option<String>,
    favorite_only: Option<bool>,
    tag_ids: Option<Vec<i64>>,
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
) -> Result<Vec<SampleItem>, String> {
    query_samples_with_conn_ext(
        conn,
        search_query,
        folder_filter,
        favorite_only,
        tag_ids,
        collection_id,
        limit,
        offset,
        include_peaks,
        Some(false),
    )
}

#[cfg(test)]
mod tests {
    use super::{query_samples_with_conn_faceted, query_samples_with_conn_sorted};
    use crate::db::init_schema_on_conn;
    use crate::db::taxonomy::ensure_taxonomy_tag;
    use rusqlite::{params, Connection};

    #[test]
    fn sorted_query_matches_frontend_empty_last_and_limit_consistency() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, genre, bpm, camelot_key)
             VALUES
               (1, 1, 'C:/SFX/0_untagged.wav', '0_untagged.wav', 'wav', 500, '', NULL, ''),
               (2, 1, 'C:/SFX/z_acoustic.wav', 'z_acoustic.wav', 'wav', 1500, 'Acoustic', 90.0, '10A'),
               (3, 1, 'C:/SFX/m_cinematic.wav', 'm_cinematic.wav', 'wav', 2500, 'Cinematic', 140.0, '2A'),
               (4, 1, 'C:/SFX/a_ambient.wav', 'a_ambient.wav', 'wav', 1000, 'Ambient', 0.0, '8B')",
            [],
        )
        .unwrap();

        // Genre ASC: Acoustic -> Ambient -> Cinematic -> empty last (NOT filename-first `0_untagged.wav`)
        let genre_asc = query_samples_with_conn_sorted(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(150),
            Some(0),
            Some(false),
            Some(false),
            false,
            Some("genre".to_string()),
            Some("asc".to_string()),
        )
        .unwrap();
        let ids: Vec<i64> = genre_asc.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![2, 4, 3, 1]);

        // Stage 1 LIMIT 2 must return exact top 2 rows of full Genre ASC list
        let genre_asc_top2 = query_samples_with_conn_sorted(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(2),
            Some(0),
            Some(false),
            Some(false),
            false,
            Some("genre".to_string()),
            Some("asc".to_string()),
        )
        .unwrap();
        let top2_ids: Vec<i64> = genre_asc_top2.iter().map(|s| s.id).collect();
        assert_eq!(top2_ids, vec![2, 4]);

        // Genre DESC: Cinematic -> Ambient -> Acoustic -> empty STILL last
        let genre_desc = query_samples_with_conn_sorted(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(150),
            Some(0),
            Some(false),
            Some(false),
            false,
            Some("genre".to_string()),
            Some("desc".to_string()),
        )
        .unwrap();
        let desc_ids: Vec<i64> = genre_desc.iter().map(|s| s.id).collect();
        assert_eq!(desc_ids, vec![3, 4, 2, 1]);

        // Key ASC: numeric Camelot order (2A -> 8B -> 10A) with empty last
        let key_asc = query_samples_with_conn_sorted(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(150),
            Some(0),
            Some(false),
            Some(false),
            false,
            Some("key".to_string()),
            Some("asc".to_string()),
        )
        .unwrap();
        let key_ids: Vec<i64> = key_asc.iter().map(|s| s.id).collect();
        assert_eq!(key_ids, vec![3, 4, 2, 1]);

        // BPM DESC: 140 -> 90 -> missing/zero last (ordered by filename tie-break)
        let bpm_desc = query_samples_with_conn_sorted(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(150),
            Some(0),
            Some(false),
            Some(false),
            false,
            Some("bpm".to_string()),
            Some("desc".to_string()),
        )
        .unwrap();
        let bpm_ids: Vec<i64> = bpm_desc.iter().map(|s| s.id).collect();
        assert_eq!(bpm_ids, vec![3, 2, 1, 4]);
    }

    #[test]
    fn faceted_query_supports_or_within_facet_and_across_facets_rollup_and_exclude() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms)
             VALUES
               (1, 1, 'C:/SFX/dog_dark.wav', 'dog_dark.wav', 'wav', 500),
               (2, 1, 'C:/SFX/bird_bright.wav', 'bird_bright.wav', 'wav', 500),
               (3, 1, 'C:/SFX/dog_pokemon.wav', 'dog_pokemon.wav', 'wav', 500),
               (4, 1, 'C:/SFX/sword_dark.wav', 'sword_dark.wav', 'wav', 500)",
            [],
        )
        .unwrap();

        let animals_id = ensure_taxonomy_tag(&conn, "Animals", Some("category"), None, None, true).unwrap();
        let dog_id = ensure_taxonomy_tag(&conn, "Dog", Some("category"), Some("Animals"), None, true).unwrap();
        let bird_id = ensure_taxonomy_tag(&conn, "Bird", Some("category"), Some("Animals"), None, true).unwrap();
        let weapons_id = ensure_taxonomy_tag(&conn, "Weapons", Some("category"), Some("Action & Combat"), None, true).unwrap();
        let dark_id = ensure_taxonomy_tag(&conn, "Dark", Some("mood"), None, None, true).unwrap();
        let pokemon_id = ensure_taxonomy_tag(&conn, "Pokemon", Some("source"), None, None, true).unwrap();

        for (sid, tid) in [
            (1, dog_id),
            (1, dark_id),
            (2, bird_id),
            (3, dog_id),
            (3, pokemon_id),
            (4, weapons_id),
            (4, dark_id),
        ] {
            conn.execute(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')",
                params![sid, tid],
            )
            .unwrap();
        }

        // Selecting parent `Animals` rolls up descendants (`Dog` + `Bird`) -> samples 1, 2, 3
        let by_parent = query_samples_with_conn_faceted(
            &conn, None, None, None, Some(vec![animals_id]), None, None, None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        let mut ids: Vec<i64> = by_parent.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![1, 2, 3]);

        // Default mode ("all"): selecting `Dog` + `Bird` (same facet) -> AND intersection -> empty
        let same_facet_and_default = query_samples_with_conn_faceted(
            &conn, None, None, None, Some(vec![dog_id, bird_id]), None, None, None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        assert!(same_facet_and_default.is_empty());

        // Default mode ("all"): selecting parent `Animals` + child `Dog` narrows cleanly to `Dog` -> 1, 3
        let parent_plus_child_and = query_samples_with_conn_faceted(
            &conn, None, None, None, Some(vec![animals_id, dog_id]), None, Some("all".to_string()), None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        let mut ids: Vec<i64> = parent_plus_child_and.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![1, 3]);

        // Optional mode ("any"): selecting `Dog` + `Bird` (same category facet) -> OR -> samples 1, 2, 3
        let same_facet_or = query_samples_with_conn_faceted(
            &conn, None, None, None, Some(vec![dog_id, bird_id]), None, Some("any".to_string()), None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        let mut ids: Vec<i64> = same_facet_or.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![1, 2, 3]);

        // Selecting `Animals` (category) + `Dark` (mood) -> AND across facets -> sample 1 only
        let cross_facet_and = query_samples_with_conn_faceted(
            &conn, None, None, None, Some(vec![animals_id, dark_id]), None, None, None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        let ids: Vec<i64> = cross_facet_and.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![1]);

        // Selecting `Animals` while excluding `Pokemon` -> samples 1 and 2
        let excluded_src = query_samples_with_conn_faceted(
            &conn, None, None, None, Some(vec![animals_id]), Some(vec![pokemon_id]), None, None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        let mut ids: Vec<i64> = excluded_src.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![1, 2]);

        // Excluding parent `Animals` excludes descendants (`Dog` & `Bird`) -> sample 4 only
        let excluded_parent = query_samples_with_conn_faceted(
            &conn, None, None, None, None, Some(vec![animals_id]), None, None, Some(50), Some(0), Some(false), Some(false), false,
        )
        .unwrap();
        let ids: Vec<i64> = excluded_parent.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![4]);
    }
}
