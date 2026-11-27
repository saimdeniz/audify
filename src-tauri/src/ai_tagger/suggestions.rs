use super::{ensure_manual_tag_on_sample, ensure_manual_tag_on_sample_batched};
use super::types::AiTagSuggestionItem;
use crate::security::sanitize_err;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const MAX_SUGGESTIONS_FETCH: usize = 5_000;

pub fn validate_active_profile_sample_access(
    conn: &Connection,
    profile_id: i64,
    sample_id: i64,
) -> Result<(i64, String), String> {
    conn.query_row(
        "SELECT s.library_id, s.file_path
         FROM samples s
         WHERE s.id = ?1
           AND COALESCE(s.is_trashed, 0) = 0
           AND s.library_id IN (
               SELECT l.id FROM libraries l
               WHERE l.is_global = 1
                  OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2)
           )",
        params![sample_id, profile_id],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            "Sample is unavailable or belongs to another profile".to_string()
        }
        other => format!("Sample lookup failed: {}", other),
    })
}

pub fn fetch_ai_tag_suggestions_for_profile(
    conn: &Connection,
    profile_id: i64,
    clean_status: &str,
    sample_ids: Option<&[i64]>,
) -> Result<Vec<AiTagSuggestionItem>, String> {
    if let Some(ids) = sample_ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for chunk in ids.chunks(400) {
            let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("?{}", i + 3)).collect();
            let sql = format!(
                "SELECT a.sample_id, a.tag_name, a.confidence, a.model_id, a.status
                 FROM ai_tag_suggestions a
                 JOIN samples s ON s.id = a.sample_id
                 WHERE a.status = ?1
                   AND COALESCE(s.is_trashed, 0) = 0
                   AND a.sample_id IN ({})
                   AND s.library_id IN (
                       SELECT l.id FROM libraries l
                       WHERE l.is_global = 1
                          OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2)
                   )
                 ORDER BY a.confidence DESC, a.tag_name ASC",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 2);
            vals.push(rusqlite::types::Value::Text(clean_status.to_string()));
            vals.push(rusqlite::types::Value::Integer(profile_id));
            for &id in chunk {
                vals.push(rusqlite::types::Value::Integer(id));
            }
            let rows = stmt
                .query_map(rusqlite::params_from_iter(vals), |r| {
                    Ok(AiTagSuggestionItem {
                        sample_id: r.get(0)?,
                        tag_name: r.get(1)?,
                        confidence: r.get(2)?,
                        model_id: r.get(3)?,
                        status: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for item in rows.flatten() {
                out.push(item);
            }
        }
        return Ok(out);
    }

    let mut stmt = conn
        .prepare(
            "SELECT a.sample_id, a.tag_name, a.confidence, a.model_id, a.status
             FROM ai_tag_suggestions a
             JOIN samples s ON s.id = a.sample_id
             WHERE a.status = ?1
               AND COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2)
               )
             ORDER BY a.sample_id ASC, a.confidence DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![clean_status, profile_id, MAX_SUGGESTIONS_FETCH as i64], |r| {
            Ok(AiTagSuggestionItem {
                sample_id: r.get(0)?,
                tag_name: r.get(1)?,
                confidence: r.get(2)?,
                model_id: r.get(3)?,
                status: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

pub fn resolve_ai_tag_suggestion_in_db(
    conn: &Connection,
    user_dir: &Path,
    profile_id: i64,
    sample_id: i64,
    tag_name: &str,
    approve: bool,
) -> Result<(), String> {
    validate_active_profile_sample_access(conn, profile_id, sample_id)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    if approve {
        ensure_manual_tag_on_sample(&tx, sample_id, tag_name)?;
    }
    let next_status = if approve { "approved" } else { "dismissed" };
    tx.execute(
        "UPDATE ai_tag_suggestions
         SET status = ?1
         WHERE sample_id = ?2 AND LOWER(tag_name) = LOWER(?3)",
        params![next_status, sample_id, tag_name],
    )
    .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    tx.commit()
        .map_err(|e| sanitize_err(user_dir, &e.to_string()))
}

fn collect_pending_ai_suggestions(
    conn: &Connection,
    profile_id: i64,
    sample_ids: Option<&[i64]>,
) -> Result<Vec<(i64, String)>, String> {
    if let Some(ids) = sample_ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut items = Vec::new();
        for chunk in ids.chunks(400) {
            let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("?{}", i + 2)).collect();
            let sql = format!(
                "SELECT a.sample_id, a.tag_name
                 FROM ai_tag_suggestions a
                 JOIN samples s ON s.id = a.sample_id
                 WHERE a.status = 'pending'
                   AND COALESCE(s.is_trashed, 0) = 0
                   AND a.sample_id IN ({})
                   AND s.library_id IN (
                       SELECT l.id FROM libraries l
                       WHERE l.is_global = 1
                          OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
                   )",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            vals.push(rusqlite::types::Value::Integer(profile_id));
            for &id in chunk {
                vals.push(rusqlite::types::Value::Integer(id));
            }
            let rows = stmt
                .query_map(rusqlite::params_from_iter(vals), |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            for item in rows.flatten() {
                items.push(item);
            }
        }
        return Ok(items);
    }

    let mut stmt = conn
        .prepare(
            "SELECT a.sample_id, a.tag_name
             FROM ai_tag_suggestions a
             JOIN samples s ON s.id = a.sample_id
             WHERE a.status = 'pending'
               AND COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([profile_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

pub fn approve_all_ai_tag_suggestions_in_db(
    conn: &Connection,
    user_dir: &Path,
    profile_id: i64,
    sample_ids: Option<&[i64]>,
) -> Result<usize, String> {
    let pending = collect_pending_ai_suggestions(conn, profile_id, sample_ids)?;
    if pending.is_empty() {
        return Ok(0);
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    let mut approved_count = 0usize;
    let mut tag_cache: HashMap<String, (i64, bool)> = HashMap::new();
    let mut genre_dirty_sample_ids: HashSet<i64> = HashSet::new();
    {
        let mut update_stmt = tx
            .prepare_cached(
                "UPDATE ai_tag_suggestions
                 SET status = 'approved'
                 WHERE sample_id = ?1 AND LOWER(tag_name) = LOWER(?2)",
            )
            .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

        for (sample_id, tag_name) in &pending {
            let is_genre =
                ensure_manual_tag_on_sample_batched(&tx, *sample_id, tag_name, &mut tag_cache)?;
            if is_genre {
                genre_dirty_sample_ids.insert(*sample_id);
            }
            update_stmt
                .execute(params![sample_id, tag_name])
                .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
            approved_count += 1;
        }
    }

    if !genre_dirty_sample_ids.is_empty() {
        let dirty_vec: Vec<i64> = genre_dirty_sample_ids.into_iter().collect();
        let _ = crate::db::sync_primary_genre_for_samples(&tx, &dirty_vec);
    }

    tx.commit()
        .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    Ok(approved_count)
}

pub fn dismiss_all_ai_tag_suggestions_in_db(
    conn: &Connection,
    user_dir: &Path,
    profile_id: i64,
    sample_ids: Option<&[i64]>,
) -> Result<usize, String> {
    let pending = collect_pending_ai_suggestions(conn, profile_id, sample_ids)?;
    if pending.is_empty() {
        return Ok(0);
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    let mut dismissed_count = 0usize;
    {
        let mut dismiss_stmt = tx
            .prepare_cached(
                "UPDATE ai_tag_suggestions
                 SET status = 'dismissed'
                 WHERE sample_id = ?1 AND LOWER(tag_name) = LOWER(?2) AND status = 'pending'",
            )
            .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
        for (sample_id, tag_name) in &pending {
            let changed = dismiss_stmt
                .execute(params![sample_id, tag_name])
                .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
            dismissed_count += changed;
        }
    }

    tx.commit()
        .map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    Ok(dismissed_count)
}
