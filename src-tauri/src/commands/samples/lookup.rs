use crate::commands::{
    parent_folder_path, query_sample_tags, ProfileQuickStats, SampleItem, SampleTagBadge,
};
use crate::db::{get_active_profile_id, run_read_query, AppState};
use crate::security::normalize_clean_path;
use rusqlite::{params, params_from_iter, Connection};
use std::collections::{HashMap, HashSet};
use tauri::State;

pub(super) fn hydrate_sample_peaks(conn: &Connection, out: &mut [SampleItem]) {
    let mut peaks_by_id: HashMap<i64, String> = HashMap::with_capacity(out.len());
    let sample_ids: Vec<i64> = out.iter().map(|item| item.id).collect();
    for chunk in sample_ids.chunks(500) {
        let placeholders: Vec<String> = (1..=chunk.len()).map(|i| format!("?{}", i)).collect();
        let peaks_sql = format!(
            "SELECT id, COALESCE(peaks_json, '') FROM samples WHERE id IN ({})",
            placeholders.join(", ")
        );
        if let Ok(mut p_stmt) = conn.prepare(&peaks_sql) {
            let p_params: Vec<rusqlite::types::Value> = chunk
                .iter()
                .copied()
                .map(rusqlite::types::Value::Integer)
                .collect();
            if let Ok(p_rows) = p_stmt.query_map(params_from_iter(p_params), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            }) {
                for (sid, p_json) in p_rows.flatten() {
                    if !p_json.is_empty() {
                        peaks_by_id.insert(sid, p_json);
                    }
                }
            }
        }
    }
    if !peaks_by_id.is_empty() {
        for item in out {
            if let Some(p_json) = peaks_by_id.remove(&item.id) {
                item.peaks_json = p_json;
            }
        }
    }
}

pub(super) fn hydrate_sample_tags(
    conn: &Connection,
    active_id: i64,
    want_trashed: bool,
    out: &mut [SampleItem],
) {
    let mut tag_dict: HashMap<i64, (usize, SampleTagBadge)> = HashMap::new();
    if let Ok(mut t_stmt) =
        conn.prepare("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE ASC")
    {
        if let Ok(t_rows) = t_stmt.query_map([], |r| {
            Ok(SampleTagBadge {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
            })
        }) {
            for (rank, badge) in t_rows.flatten().enumerate() {
                tag_dict.insert(badge.id, (rank, badge));
            }
        }
    }

    if tag_dict.is_empty() {
        return;
    }

    let mut tags_by_sample: HashMap<i64, Vec<(usize, SampleTagBadge)>> =
        HashMap::with_capacity(out.len());

    if out.len() > 2_000 {
        let out_ids: HashSet<i64> = out.iter().map(|item| item.id).collect();
        let trashed_flag: i64 = i64::from(want_trashed);
        let sql = "SELECT st.sample_id, st.tag_id
                   FROM sample_tags st
                   INNER JOIN samples s ON s.id = st.sample_id
                   WHERE COALESCE(s.is_trashed, 0) = ?1
                     AND s.library_id IN (
                         SELECT l.id FROM libraries l
                         WHERE l.is_global = 1
                            OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2)
                     )";
        if let Ok(mut st_stmt) = conn.prepare(sql) {
            if let Ok(st_rows) = st_stmt.query_map(
                params_from_iter([
                    rusqlite::types::Value::Integer(trashed_flag),
                    rusqlite::types::Value::Integer(active_id),
                ]),
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            ) {
                for (sid, tid) in st_rows.flatten() {
                    if out_ids.contains(&sid) {
                        if let Some(entry) = tag_dict.get(&tid) {
                            tags_by_sample.entry(sid).or_default().push(entry.clone());
                        }
                    }
                }
            }
        }
    } else {
        let sample_ids: Vec<i64> = out.iter().map(|item| item.id).collect();
        for chunk in sample_ids.chunks(500) {
            let placeholders = (1..=chunk.len())
                .map(|i| format!("?{}", i))
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT sample_id, tag_id FROM sample_tags WHERE sample_id IN ({})",
                placeholders
            );
            if let Ok(mut st_stmt) = conn.prepare(&sql) {
                if let Ok(st_rows) =
                    st_stmt.query_map(params_from_iter(chunk.iter().copied()), |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                    })
                {
                    for (sid, tid) in st_rows.flatten() {
                        if let Some(entry) = tag_dict.get(&tid) {
                            tags_by_sample.entry(sid).or_default().push(entry.clone());
                        }
                    }
                }
            }
        }
    }

    for item in out {
        if let Some(mut ranked) = tags_by_sample.remove(&item.id) {
            if ranked.len() > 1 {
                ranked.sort_unstable_by_key(|(rank, _)| *rank);
            }
            item.tags = ranked.into_iter().map(|(_, b)| b).collect();
        }
    }
}

pub(crate) fn get_sample_by_id_or_path_with_conn(
    conn: &Connection,
    sample_id: Option<i64>,
    file_path: Option<String>,
    include_peaks: Option<bool>,
) -> Result<Option<SampleItem>, String> {
    let norm_fp = file_path
        .map(|fp| normalize_clean_path(&fp))
        .filter(|fp| !fp.is_empty());

    if sample_id.is_none() && norm_fp.is_none() {
        return Ok(None);
    }

    let peaks_col = if include_peaks.unwrap_or(false) {
        "s.peaks_json"
    } else {
        "''"
    };

    let path_clause_1 = if cfg!(windows) {
        "(s.file_path = ?1 COLLATE NOCASE OR s.original_file_path = ?1 COLLATE NOCASE)"
    } else {
        "(s.file_path = ?1 OR s.original_file_path = ?1)"
    };
    let path_clause_2 = if cfg!(windows) {
        " OR s.file_path = ?2 COLLATE NOCASE OR s.original_file_path = ?2 COLLATE NOCASE"
    } else {
        " OR s.file_path = ?2 OR s.original_file_path = ?2"
    };
    let active_id = get_active_profile_id(conn);
    let fav_idx = if sample_id.is_some() && norm_fp.is_some() {
        3
    } else {
        2
    };

    let mut sql = format!(
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
            EXISTS(SELECT 1 FROM profile_favorites pf WHERE pf.profile_id = ?{fav_idx} AND pf.sample_id = s.id),
            s.is_loop,
            COALESCE(s.genre, ''),
            COALESCE(s.artist, ''),
            COALESCE(s.album, ''),
            COALESCE(s.year, ''),
            s.bpm,
            COALESCE(s.musical_key, ''),
            COALESCE(s.camelot_key, ''),
            {},
            s.created_at,
            COALESCE(s.is_trashed, 0),
            s.trashed_at,
            s.original_file_path,
            s.previous_file_name,
            s.file_modified_at
         FROM samples s WHERE ",
        peaks_col
    );

    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(id) = sample_id {
        if let Some(path) = norm_fp {
            sql.push_str("(s.id = ?1");
            sql.push_str(path_clause_2);
            sql.push(')');
            params_vec.push(rusqlite::types::Value::Integer(id));
            params_vec.push(rusqlite::types::Value::Text(path));
        } else {
            sql.push_str("s.id = ?1");
            params_vec.push(rusqlite::types::Value::Integer(id));
        }
    } else if let Some(path) = norm_fp {
        sql.push_str(path_clause_1);
        params_vec.push(rusqlite::types::Value::Text(path));
    }
    params_vec.push(rusqlite::types::Value::Integer(active_id));
    sql.push_str(&format!(
        " AND s.library_id IN (
            SELECT l.id FROM libraries l
            WHERE l.is_global = 1
               OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?{fav_idx})
          ) LIMIT 1"
    ));

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let mut rows = stmt
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
                created_at: row.get(20)?,
                file_modified_at,
                is_trashed,
                trashed_at,
                original_file_path,
                previous_file_name,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    if let Some(first) = rows.next() {
        let mut sample = first.map_err(|e| e.to_string())?;
        if let Ok(tags) = query_sample_tags(conn, sample.id) {
            sample.tags = tags;
        }
        return Ok(Some(sample));
    }

    Ok(None)
}

#[tauri::command]
pub async fn get_sample_by_id_or_path(
    state: State<'_, AppState>,
    sample_id: Option<i64>,
    file_path: Option<String>,
    include_peaks: Option<bool>,
) -> Result<Option<SampleItem>, String> {
    run_read_query(&state, move |conn| {
        get_sample_by_id_or_path_with_conn(conn, sample_id, file_path, include_peaks)
    })
    .await
}

/// Returns lightweight profile startup counts (favorites total + validated recent/bin sample IDs)
/// so Stage 1 can populate sidebar view badges without waiting for full 55k pool hydration.
pub(crate) fn get_profile_quick_stats_with_conn(
    conn: &Connection,
    sample_ids: Option<Vec<i64>>,
) -> Result<ProfileQuickStats, String> {
    let active_id = get_active_profile_id(conn);

    let favorites_count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM samples s
             INNER JOIN profile_favorites pf
                ON pf.sample_id = s.id AND pf.profile_id = ?1
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            params![active_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to count favorites: {}", e))?;

    let mut valid_ids: Vec<i64> = Vec::new();
    let mut seen: HashSet<i64> = HashSet::new();
    for id in sample_ids.unwrap_or_default() {
        if id > 0 && seen.insert(id) {
            valid_ids.push(id);
            if valid_ids.len() >= 500 {
                break;
            }
        }
    }

    let mut existing_sample_ids = Vec::new();
    if !valid_ids.is_empty() {
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(valid_ids.len() + 1);
        params_vec.push(rusqlite::types::Value::Integer(active_id));
        let placeholders: Vec<String> = valid_ids
            .iter()
            .map(|id| {
                params_vec.push(rusqlite::types::Value::Integer(*id));
                format!("?{}", params_vec.len())
            })
            .collect();
        let sql = format!(
            "SELECT s.id
             FROM samples s
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )
               AND s.id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare sample existence query: {}", e))?;
        let rows = stmt
            .query_map(params_from_iter(params_vec.iter()), |r| r.get::<_, i64>(0))
            .map_err(|e| format!("Failed to execute sample existence query: {}", e))?;
        for id in rows.flatten() {
            existing_sample_ids.push(id);
        }
    }

    Ok(ProfileQuickStats {
        favorites_count,
        existing_sample_ids,
    })
}

#[tauri::command]
pub async fn get_profile_quick_stats(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<ProfileQuickStats, String> {
    run_read_query(&state, move |conn| {
        get_profile_quick_stats_with_conn(conn, sample_ids)
    })
    .await
}
