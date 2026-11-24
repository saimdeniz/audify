use super::similarity::blob_to_vec;
use super::taxonomy::MappedAiTag;
use super::types::AI_EMBEDDING_DIM;
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// Merges built-in YAMNet taxonomy predictions with personalized k-NN votes, keeping
/// the highest confidence per tag name and capping to `max_tags`.
pub fn merge_yamnet_and_knn_tags(
    yamnet: Vec<MappedAiTag>,
    knn: Vec<MappedAiTag>,
    max_tags: usize,
) -> Vec<MappedAiTag> {
    if knn.is_empty() {
        return yamnet;
    }
    if yamnet.is_empty() {
        let mut out = knn;
        out.truncate(max_tags);
        return out;
    }

    let mut by_key: HashMap<String, MappedAiTag> = HashMap::new();
    for item in yamnet.into_iter().chain(knn) {
        let key = item.tag_name.to_lowercase();
        by_key
            .entry(key)
            .and_modify(|existing| {
                if item.confidence > existing.confidence {
                    *existing = item.clone();
                }
            })
            .or_insert(item);
    }

    let mut merged: Vec<MappedAiTag> = by_key.into_values().collect();
    merged.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.tag_name.cmp(&b.tag_name))
    });
    merged.truncate(max_tags);
    merged
}

pub(super) struct TargetVectorItem {
    pub(super) sample_id: i64,
    pub(super) filename: String,
    pub(super) vector: [f32; AI_EMBEDDING_DIM],
}

pub(super) fn count_knn_profile_targets(
    conn: &Connection,
    profile_id: i64,
    model_id: &str,
) -> Result<usize, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM samples s
             JOIN sample_embeddings e
               ON e.sample_id = s.id AND e.model_id = ?2
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            params![profile_id, model_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count.max(0) as usize)
}

pub(super) fn collect_knn_target_page(
    conn: &Connection,
    profile_id: i64,
    model_id: &str,
    after_sample_id: i64,
    limit: usize,
) -> Result<Vec<TargetVectorItem>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT s.id, s.file_name, e.vector
             FROM samples s
             JOIN sample_embeddings e
               ON e.sample_id = s.id AND e.model_id = ?2
             WHERE s.id > ?3
               AND COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )
             ORDER BY s.id ASC
             LIMIT ?4",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![profile_id, model_id, after_sample_id, limit as i64], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut items = Vec::with_capacity(limit.min(512));
    for (sample_id, filename, blob) in rows.flatten() {
        if let Some(vector) = blob_to_vec(&blob) {
            items.push(TargetVectorItem {
                sample_id,
                filename,
                vector,
            });
        }
    }
    Ok(items)
}

pub(super) fn collect_knn_target_vectors_for_ids(
    conn: &Connection,
    profile_id: i64,
    model_id: &str,
    ids: &[i64],
) -> Result<Vec<TargetVectorItem>, String> {
    let mut items = Vec::new();
    if ids.is_empty() {
        return Ok(items);
    }
    for chunk in ids.chunks(400) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("?{}", i + 3)).collect();
        let sql = format!(
            "SELECT s.id, s.file_name, e.vector
             FROM samples s
             JOIN sample_embeddings e
               ON e.sample_id = s.id AND e.model_id = ?2
             WHERE s.id IN ({})
               AND COALESCE(s.is_trashed, 0) = 0
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 2);
        vals.push(rusqlite::types::Value::Integer(profile_id));
        vals.push(rusqlite::types::Value::Text(model_id.to_string()));
        for &id in chunk {
            vals.push(rusqlite::types::Value::Integer(id));
        }
        let rows = stmt
            .query_map(rusqlite::params_from_iter(vals), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for (sample_id, filename, blob) in rows.flatten() {
            if let Some(vector) = blob_to_vec(&blob) {
                items.push(TargetVectorItem {
                    sample_id,
                    filename,
                    vector,
                });
            }
        }
    }
    Ok(items)
}
