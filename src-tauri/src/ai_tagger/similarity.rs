use super::types::{SimilarityMatch, SimilaritySearchResult, AI_EMBEDDING_DIM};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct CachedEmbedding {
    pub sample_id: i64,
    pub library_id: i64,
    pub duration_ms: i64,
    pub parent_folder_norm: String,
    pub vector: [f32; AI_EMBEDDING_DIM],
}

#[derive(Debug, Default)]
pub struct AiVectorCache {
    pub model_id: String,
    pub profile_id: i64,
    pub hydrated: bool,
    pub entries: Vec<CachedEmbedding>,
    pub id_to_index: HashMap<i64, usize>,
}

impl AiVectorCache {
    pub fn clear(&mut self) {
        self.model_id = String::new();
        self.profile_id = 0;
        self.hydrated = false;
        // Replace rather than .clear() so 55k-sample heap capacity is actually returned to the allocator.
        self.entries = Vec::new();
        self.id_to_index = HashMap::new();
    }

    pub fn upsert(
        &mut self,
        model_id: &str,
        sample_id: i64,
        library_id: i64,
        sample_path: &str,
        duration_ms: i64,
        vector: [f32; AI_EMBEDDING_DIM],
    ) {
        if !self.hydrated || self.model_id != model_id {
            // Never stamp `hydrated = true` during partial incremental upserts; leave unhydrated
            // so `ensure_hydrated` reads all existing embeddings from SQLite on first search.
            return;
        }
        let parent_folder_norm = normalize_parent_folder(sample_path);
        if let Some(&idx) = self.id_to_index.get(&sample_id) {
            if let Some(slot) = self.entries.get_mut(idx) {
                slot.library_id = library_id;
                slot.duration_ms = duration_ms.max(0);
                slot.parent_folder_norm = parent_folder_norm;
                slot.vector = vector;
            }
            return;
        }
        let idx = self.entries.len();
        self.entries.push(CachedEmbedding {
            sample_id,
            library_id,
            duration_ms: duration_ms.max(0),
            parent_folder_norm,
            vector,
        });
        self.id_to_index.insert(sample_id, idx);
    }

    pub fn remove_sample_ids(&mut self, sample_ids: &[i64]) {
        if !self.hydrated || sample_ids.is_empty() {
            return;
        }
        for &sample_id in sample_ids {
            if let Some(idx) = self.id_to_index.remove(&sample_id) {
                let last_idx = self.entries.len() - 1;
                self.entries.swap_remove(idx);
                if idx < last_idx {
                    let swapped_id = self.entries[idx].sample_id;
                    self.id_to_index.insert(swapped_id, idx);
                }
            }
        }
    }

    pub fn update_sample_location(&mut self, sample_id: i64, library_id: i64, sample_path: &str) {
        if !self.hydrated {
            return;
        }
        if let Some(&idx) = self.id_to_index.get(&sample_id) {
            if let Some(slot) = self.entries.get_mut(idx) {
                slot.library_id = library_id;
                slot.parent_folder_norm = normalize_parent_folder(sample_path);
            }
        }
    }

    #[cfg(test)]
    pub fn ensure_hydrated(&mut self, conn: &Connection, model_id: &str) -> Result<(), String> {
        let active_profile_id: i64 = conn
            .query_row(
                "SELECT id FROM profiles WHERE is_active = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(1);
        self.ensure_hydrated_for_profile(conn, model_id, active_profile_id)
    }

    pub fn ensure_hydrated_for_profile(
        &mut self,
        conn: &Connection,
        model_id: &str,
        profile_id: i64,
    ) -> Result<(), String> {
        if self.hydrated && self.model_id == model_id && self.profile_id == profile_id {
            return Ok(());
        }

        self.clear();
        self.model_id = model_id.to_string();
        self.profile_id = profile_id;

        let mut stmt = conn
            .prepare(
                "SELECT e.sample_id, s.library_id, s.file_path, COALESCE(s.duration_ms, 0), e.vector
                 FROM sample_embeddings e
                 JOIN samples s ON s.id = e.sample_id
                 WHERE e.model_id = ?1
                   AND COALESCE(s.is_trashed, 0) = 0
                   AND s.library_id IN (
                       SELECT l.id FROM libraries l
                       WHERE l.is_global = 1
                          OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2)
                   )",
            )
            .map_err(|e| format!("Failed preparing embedding hydration query: {}", e))?;

        let rows = stmt
            .query_map(params![model_id, profile_id], |row| {
                let sample_id: i64 = row.get(0)?;
                let library_id: i64 = row.get(1)?;
                let sample_path: String = row.get(2)?;
                let duration_ms: i64 = row.get(3)?;
                let blob: Vec<u8> = row.get(4)?;
                Ok((sample_id, library_id, sample_path, duration_ms, blob))
            })
            .map_err(|e| format!("Failed querying cached embeddings: {}", e))?;

        for row in rows.flatten() {
            if let Some(vector) = blob_to_vec(&row.4) {
                let idx = self.entries.len();
                self.entries.push(CachedEmbedding {
                    sample_id: row.0,
                    library_id: row.1,
                    duration_ms: row.3.max(0),
                    parent_folder_norm: normalize_parent_folder(&row.2),
                    vector,
                });
                self.id_to_index.insert(row.0, idx);
            }
        }

        self.hydrated = true;
        Ok(())
    }
}

pub fn vec_to_blob(vec: &[f32; AI_EMBEDDING_DIM]) -> Vec<u8> {
    let mut out = Vec::with_capacity(AI_EMBEDDING_DIM * 4);
    for &val in vec {
        let safe = if val.is_finite() { val } else { 0.0 };
        out.extend_from_slice(&safe.to_le_bytes());
    }
    out
}

pub fn blob_to_vec(blob: &[u8]) -> Option<[f32; AI_EMBEDDING_DIM]> {
    if blob.len() != AI_EMBEDDING_DIM * 4 {
        return None;
    }
    let mut out = [0.0_f32; AI_EMBEDDING_DIM];
    for (i, chunk) in blob.as_chunks::<4>().0.iter().enumerate() {
        let val = f32::from_le_bytes(*chunk);
        out[i] = if val.is_finite() { val } else { 0.0 };
    }
    Some(out)
}

pub fn normalize_folder_prefix(raw: &str) -> String {
    let replaced = raw.trim().replace('\\', "/");
    replaced.trim_end_matches('/').to_lowercase()
}

pub fn normalize_parent_folder(sample_path: &str) -> String {
    let parent = Path::new(sample_path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    normalize_folder_prefix(&parent)
}

#[inline]
pub fn dot_similarity(a: &[f32; AI_EMBEDDING_DIM], b: &[f32; AI_EMBEDDING_DIM]) -> f32 {
    let mut sum = 0.0_f32;
    for i in 0..AI_EMBEDDING_DIM {
        sum += a[i] * b[i];
    }
    if sum.is_finite() {
        sum.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Computes an adaptive duration window around `anchor_duration_ms` so "similar duration"
/// keeps snappy one-shots matching other one-shots without excluding slight decay differences.
pub fn compute_similarity_duration_bounds(anchor_duration_ms: i64) -> Option<(i64, i64)> {
    if anchor_duration_ms <= 0 {
        return None;
    }
    let min_ms = ((anchor_duration_ms as f64) * 0.35).floor() as i64;
    let scaled_max = ((anchor_duration_ms as f64) * 2.5).ceil() as i64;
    let max_ms = scaled_max.max(anchor_duration_ms.saturating_add(600));
    Some((min_ms.max(0), max_ms))
}

#[derive(Debug, Clone, Copy)]
pub struct SimilarityQuery<'a> {
    pub anchor_sample_id: i64,
    pub anchor_vec: &'a [f32; AI_EMBEDDING_DIM],
    pub allowed_libraries: Option<&'a HashSet<i64>>,
    pub folder_prefix: Option<&'a str>,
    pub duration_bounds_ms: Option<(i64, i64)>,
    pub min_score: f32,
    pub top_k: usize,
}

pub fn compute_top_k_similar(
    entries: &[CachedEmbedding],
    query: &SimilarityQuery<'_>,
) -> SimilaritySearchResult {
    let started = Instant::now();
    let raw_min = if query.min_score.is_finite() {
        query.min_score
    } else {
        0.50
    };
    let clamped_min = raw_min.clamp(0.0, 0.99);
    let clamped_k = query.top_k.clamp(1, 500);
    let norm_prefix = query
        .folder_prefix
        .map(normalize_folder_prefix)
        .filter(|s| !s.is_empty());

    let mut matches: Vec<SimilarityMatch> = Vec::new();
    let mut scanned = 0usize;

    for entry in entries {
        if entry.sample_id == query.anchor_sample_id {
            continue;
        }
        if let Some(allowed) = query.allowed_libraries {
            if !allowed.contains(&entry.library_id) {
                continue;
            }
        }
        if let Some(ref prefix) = norm_prefix {
            let matches_exact = entry.parent_folder_norm == *prefix;
            let matches_child = entry.parent_folder_norm.len() > prefix.len()
                && entry.parent_folder_norm.starts_with(prefix)
                && entry.parent_folder_norm.as_bytes().get(prefix.len()) == Some(&b'/');
            if !matches_exact && !matches_child {
                continue;
            }
        }
        if let Some((min_ms, max_ms)) = query.duration_bounds_ms {
            if entry.duration_ms < min_ms || entry.duration_ms > max_ms {
                continue;
            }
        }

        scanned += 1;
        let score = dot_similarity(query.anchor_vec, &entry.vector);
        if score >= clamped_min {
            matches.push(SimilarityMatch {
                sample_id: entry.sample_id,
                score,
            });
        }
    }

    if matches.len() > clamped_k {
        matches.select_nth_unstable_by(clamped_k, |a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.sample_id.cmp(&b.sample_id))
        });
        matches.truncate(clamped_k);
    }

    matches.sort_unstable_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.sample_id.cmp(&b.sample_id))
    });

    SimilaritySearchResult {
        anchor_sample_id: query.anchor_sample_id,
        matches,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        scanned_vectors: scanned,
    }
}

pub fn load_allowed_profile_library_ids(
    conn: &Connection,
    profile_id: i64,
) -> Result<HashSet<i64>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT l.id
             FROM libraries l
             WHERE l.is_global = 1
                OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)",
        )
        .map_err(|e| format!("Failed resolving profile library scope: {}", e))?;

    let rows = stmt
        .query_map([profile_id], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("Failed reading profile library IDs: {}", e))?;
    Ok(rows.flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_tagger::onnx_runner::l2_normalize_inplace;

    #[test]
    fn blob_roundtrip_preserves_128d_vector() {
        let mut v = [0.0_f32; AI_EMBEDDING_DIM];
        for (i, slot) in v.iter_mut().enumerate() {
            *slot = ((i as f32) - 64.0) * 0.03125;
        }
        l2_normalize_inplace(&mut v);

        let blob = vec_to_blob(&v);
        assert_eq!(blob.len(), 512);
        let restored = blob_to_vec(&blob).expect("blob decode");
        assert!((dot_similarity(&v, &restored) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn similarity_search_50k_synthetic_vectors_is_fast_and_ordered() {
        let mut entries = Vec::with_capacity(50_000);
        let mut anchor = [0.0_f32; AI_EMBEDDING_DIM];
        anchor[0] = 1.0;

        for idx in 0..50_000_i64 {
            let mut vec = [0.0_f32; AI_EMBEDDING_DIM];
            if idx == 42 {
                vec[0] = 0.98;
                vec[1] = 0.2;
            } else if idx == 777 {
                vec[0] = 0.90;
                vec[1] = 0.43;
            } else {
                vec[2 + ((idx as usize) % (AI_EMBEDDING_DIM - 2))] = 1.0;
            }
            l2_normalize_inplace(&mut vec);
            entries.push(CachedEmbedding {
                sample_id: idx + 1,
                library_id: 1,
                duration_ms: if idx == 777 { 9_500 } else { 1_000 },
                parent_folder_norm: if idx == 42 {
                    "c:/sfx/impacts".to_string()
                } else {
                    "c:/sfx/ambience".to_string()
                },
                vector: vec,
            });
        }

        let res = compute_top_k_similar(
            &entries,
            &SimilarityQuery {
                anchor_sample_id: 999_999,
                anchor_vec: &anchor,
                allowed_libraries: None,
                folder_prefix: None,
                duration_bounds_ms: None,
                min_score: 0.70,
                top_k: 50,
            },
        );
        assert_eq!(res.scanned_vectors, 50_000);
        assert_eq!(res.matches.len(), 2);
        assert_eq!(res.matches[0].sample_id, 43);
        assert_eq!(res.matches[1].sample_id, 778);
        assert!(res.matches[0].score > res.matches[1].score);
        assert!(
            res.elapsed_ms < 250.0,
            "Expected sub-second 50k similarity scan, took {:.2} ms",
            res.elapsed_ms
        );

        let scoped = compute_top_k_similar(
            &entries,
            &SimilarityQuery {
                anchor_sample_id: 999_999,
                anchor_vec: &anchor,
                allowed_libraries: None,
                folder_prefix: Some("C:\\SFX\\IMPACTS"),
                duration_bounds_ms: None,
                min_score: 0.70,
                top_k: 50,
            },
        );
        assert_eq!(scoped.matches.len(), 1);
        assert_eq!(scoped.matches[0].sample_id, 43);

        let bounds = compute_similarity_duration_bounds(1_000).expect("valid bounds");
        assert_eq!(bounds, (350, 2_500));
        let duration_filtered = compute_top_k_similar(
            &entries,
            &SimilarityQuery {
                anchor_sample_id: 999_999,
                anchor_vec: &anchor,
                allowed_libraries: None,
                folder_prefix: None,
                duration_bounds_ms: Some(bounds),
                min_score: 0.70,
                top_k: 50,
            },
        );
        assert_eq!(duration_filtered.matches.len(), 1);
        assert_eq!(duration_filtered.matches[0].sample_id, 43);
    }

    #[test]
    fn partial_upsert_does_not_mask_existing_db_embeddings() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema_on_conn(&conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES ('C:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        let mut vec_a = [0.0_f32; AI_EMBEDDING_DIM];
        vec_a[0] = 1.0;
        let mut vec_b = [0.0_f32; AI_EMBEDDING_DIM];
        vec_b[1] = 1.0;
        let blob_a = vec_to_blob(&vec_a);
        let blob_b = vec_to_blob(&vec_b);

        for (i, blob) in [(1_i64, &blob_a), (2_i64, &blob_b)] {
            let path = format!("C:/SFX/s{}.wav", i);
            conn.execute(
                "INSERT INTO samples (id, library_id, file_path, file_name, extension)
                 VALUES (?1, ?2, ?3, ?4, 'wav')",
                params![i, lib_id, path, format!("s{}.wav", i)],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sample_embeddings (sample_id, model_id, dim, vector)
                 VALUES (?1, 'yamnet_v1', 128, ?2)",
                params![i, blob],
            )
            .unwrap();
        }

        // Before `ensure_hydrated`, batch analysis calling `upsert` must NOT mark cache hydrated
        let mut cache = AiVectorCache::default();
        cache.upsert("yamnet_v1", 2, lib_id, "C:/SFX/s2.wav", 500, vec_b);
        assert!(!cache.hydrated);

        cache.ensure_hydrated(&conn, "yamnet_v1").unwrap();
        assert!(cache.hydrated);
        assert_eq!(cache.entries.len(), 2);
        assert!(cache.id_to_index.contains_key(&1));
        assert!(cache.id_to_index.contains_key(&2));
    }

    #[test]
    fn remove_sample_ids_and_update_location_preserve_index_consistency() {
        let mut cache = AiVectorCache {
            model_id: "yamnet_v1".to_string(),
            hydrated: true,
            ..Default::default()
        };
        let mut v = [0.0_f32; AI_EMBEDDING_DIM];
        v[0] = 1.0;
        for id in 1..=5_i64 {
            cache.upsert("yamnet_v1", id, 10, &format!("C:/A/s{}.wav", id), 400, v);
        }

        cache.remove_sample_ids(&[1, 3, 5]);
        assert_eq!(cache.entries.len(), 2);
        assert!(!cache.id_to_index.contains_key(&1));
        assert!(!cache.id_to_index.contains_key(&3));
        assert!(!cache.id_to_index.contains_key(&5));

        cache.update_sample_location(2, 20, "D:/Moved/Sub/s2.wav");
        let idx2 = *cache.id_to_index.get(&2).unwrap();
        assert_eq!(cache.entries[idx2].sample_id, 2);
        assert_eq!(cache.entries[idx2].library_id, 20);
        assert_eq!(cache.entries[idx2].parent_folder_norm, "d:/moved/sub");

        let idx4 = *cache.id_to_index.get(&4).unwrap();
        assert_eq!(cache.entries[idx4].sample_id, 4);
    }
}
