use super::fts_query::{build_fts_match_expression, load_synonym_config};
use super::lookup::{hydrate_sample_peaks, hydrate_sample_tag_ids, hydrate_sample_tags};
use crate::commands::{normalize_path_str, parent_folder_path, SampleItem};
use crate::db::{get_active_profile_id, AppState};
use rusqlite::{params_from_iter, Connection};
use std::collections::HashSet;
use tauri::State;

const MAX_TAG_BIND_CHUNK: usize = 900;

fn prefilter_sample_ids_by_large_tag_set(
    conn: &Connection,
    unique_tids: &[i64],
) -> Result<HashSet<i64>, String> {
    let mut running: Option<HashSet<i64>> = None;
    for chunk in unique_tids.chunks(MAX_TAG_BIND_CHUNK) {
        let mut placeholders = Vec::with_capacity(chunk.len());
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len());
        for (idx, tid) in chunk.iter().enumerate() {
            placeholders.push(format!("?{}", idx + 1));
            params_vec.push(rusqlite::types::Value::Integer(*tid));
        }
        let sql = format!(
            "SELECT st.sample_id
             FROM sample_tags st
             WHERE st.tag_id IN ({})
             GROUP BY st.sample_id
             HAVING COUNT(DISTINCT st.tag_id) = {}",
            placeholders.join(", "),
            chunk.len()
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Tag chunk query prepare error: {}", e))?;
        let rows = stmt
            .query_map(params_from_iter(params_vec.iter()), |r| r.get::<_, i64>(0))
            .map_err(|e| format!("Tag chunk query execution error: {}", e))?;
        let chunk_ids: HashSet<i64> = rows.flatten().collect();

        running = Some(match running {
            None => chunk_ids,
            Some(prev) => prev.intersection(&chunk_ids).copied().collect(),
        });
        if running.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            return Ok(HashSet::new());
        }
    }
    Ok(running.unwrap_or_default())
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
    query_samples_with_conn_compact(
        conn,
        search_query,
        folder_filter,
        favorite_only,
        tag_ids,
        collection_id,
        limit,
        offset,
        include_peaks,
        trashed_only,
        false,
    )
}

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

    let use_filename_index_fast_path = limit.unwrap_or(i64::MAX) <= 1_000
        && !using_fts
        && collection_id.is_none()
        && folder_filter
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        && tag_ids.as_ref().is_none_or(Vec::is_empty);

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
    if let Some(tids) = tag_ids.as_ref().filter(|t| !t.is_empty()) {
        let mut unique_tids: Vec<i64> = tids
            .iter()
            .copied()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        unique_tids.sort_unstable();

        if unique_tids.len() <= MAX_TAG_BIND_CHUNK {
            let mut placeholders = Vec::with_capacity(unique_tids.len());
            for tid in &unique_tids {
                params_vec.push(rusqlite::types::Value::Integer(*tid));
                placeholders.push(format!("?{}", params_vec.len()));
            }
            where_clauses.push(format!(
                "s.id IN (
                    SELECT st.sample_id
                    FROM sample_tags st
                    WHERE st.tag_id IN ({})
                    GROUP BY st.sample_id
                    HAVING COUNT(DISTINCT st.tag_id) = {}
                )",
                placeholders.join(", "),
                unique_tids.len()
            ));
        } else {
            let matched_ids = prefilter_sample_ids_by_large_tag_set(conn, &unique_tids)?;
            if matched_ids.is_empty() {
                return Ok(Vec::new());
            }
            if matched_ids.len() <= MAX_TAG_BIND_CHUNK {
                let mut placeholders = Vec::with_capacity(matched_ids.len());
                for sid in &matched_ids {
                    params_vec.push(rusqlite::types::Value::Integer(*sid));
                    placeholders.push(format!("?{}", params_vec.len()));
                }
                where_clauses.push(format!("s.id IN ({})", placeholders.join(", ")));
            } else {
                large_tag_allowlist = Some(matched_ids);
            }
        }
    }

    if !where_clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_clauses.join(" AND "));
    }

    if using_fts {
        sql.push_str(" ORDER BY bm25(samples_fts), s.file_name COLLATE NOCASE ASC");
    } else if want_trashed {
        sql.push_str(" ORDER BY s.trashed_at DESC, s.file_name COLLATE NOCASE ASC");
    } else {
        sql.push_str(" ORDER BY s.file_name COLLATE NOCASE ASC");
    }

    if large_tag_allowlist.is_none() {
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
        out.push(item);
    }

    if large_tag_allowlist.is_some() {
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
    collection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_peaks: Option<bool>,
    trashed_only: Option<bool>,
    compact_tags: Option<bool>,
) -> Result<Vec<SampleItem>, String> {
    let want_compact_tags = compact_tags.unwrap_or(false);
    crate::db::run_read_query(&state, move |conn| {
        query_samples_with_conn_compact(
            conn,
            search_query,
            folder_filter,
            favorite_only,
            tag_ids,
            collection_id,
            limit,
            offset,
            include_peaks,
            trashed_only,
            want_compact_tags,
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
