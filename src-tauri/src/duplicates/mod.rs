mod exact_hash;
mod progress;
mod similar_match;

pub use progress::DuplicateScanProgressPayload;
use progress::ProgressEmitFn;

use crate::db::get_active_profile_id;
use crate::security::{
    has_ntfs_ads_colon, is_unc_or_network_path, reject_symlink_ancestors,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DuplicateScanMode {
    Exact,
    Similar,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateSampleEntry {
    pub sample_id: i64,
    pub library_id: i64,
    pub library_name: String,
    pub library_read_only: bool,
    pub file_path: String,
    pub file_name: String,
    pub extension: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub bit_depth: i64,
    pub file_size: i64,
    pub is_favorite: bool,
    pub tag_count: i64,
    pub collection_count: i64,
    pub keep_suggested: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub group_id: String,
    pub match_kind: String,
    pub similarity_pct: u8,
    pub file_size: i64,
    pub reclaimable_bytes: i64,
    pub items: Vec<DuplicateSampleEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateScanResult {
    pub mode: String,
    pub scanned_samples: usize,
    pub groups_found: usize,
    pub duplicate_files_count: usize,
    pub reclaimable_bytes: i64,
    pub elapsed_ms: u64,
    pub groups: Vec<DuplicateGroup>,
}

#[derive(Debug, Clone)]
pub(crate) struct DuplicateCandidate {
    pub sample_id: i64,
    pub library_id: i64,
    pub library_name: String,
    pub library_read_only: bool,
    pub file_path: String,
    pub file_name: String,
    pub extension: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub bit_depth: i64,
    pub file_size: i64,
    pub is_favorite: bool,
    pub tag_count: i64,
    pub collection_count: i64,
    pub peaks_unit: Option<Vec<f32>>,
    pub embedding_unit: Option<Vec<f32>>,
    pub cached_hash_size: Option<i64>,
    pub cached_hash_mtime: Option<i64>,
    pub cached_partial_hash: Option<[u8; 32]>,
    pub cached_full_hash: Option<[u8; 32]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SampleHashCacheWrite {
    pub sample_id: i64,
    pub file_size: i64,
    pub file_mtime: Option<i64>,
    pub partial_hash: Option<[u8; 32]>,
    pub full_hash: Option<[u8; 32]>,
}

fn blob_to_hash32(blob: Option<Vec<u8>>) -> Option<[u8; 32]> {
    let bytes = blob?;
    if bytes.len() != 32 {
        return None;
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Some(out)
}

pub(crate) struct DuplicateLoadBundle {
    pub(crate) candidates: Vec<DuplicateCandidate>,
    pub(crate) raw_library_roots: Vec<(i64, String)>,
}

pub(crate) fn resolve_library_roots(raw_roots: &[(i64, String)]) -> HashMap<i64, PathBuf> {
    let mut map = HashMap::new();
    for (lib_id, raw_path) in raw_roots {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
            continue;
        }
        let path = Path::new(trimmed);
        if reject_symlink_ancestors(path).is_err() {
            continue;
        }
        if let Ok(sym) = fs::symlink_metadata(path) {
            if sym.file_type().is_symlink() || !sym.is_dir() {
                continue;
            }
        } else {
            continue;
        }
        if let Ok(canon) = fs::canonicalize(path) {
            if !is_unc_or_network_path(&canon.to_string_lossy()) {
                map.insert(*lib_id, canon);
            }
        }
    }
    map
}

fn keep_priority_score(c: &DuplicateCandidate) -> i64 {
    let mut score: i64 = 0;
    if c.library_read_only {
        score += 1_000_000;
    }
    if c.is_favorite {
        score += 50_000;
    }
    score += c.tag_count.min(20) * 1_000;
    score += c.collection_count.min(20) * 1_000;

    match c.extension.to_ascii_lowercase().as_str() {
        "wav" | "aiff" | "aif" | "flac" => score += 500,
        _ => {}
    }
    score += (c.sample_rate / 1000).min(192);
    score += c.bit_depth.min(64);

    let lower = c.file_name.to_ascii_lowercase();
    if lower.contains("copy") || lower.contains("(1)") || lower.contains("(2)") {
        score -= 300;
    }

    let depth = c.file_path.matches(['/', '\\']).count() as i64;
    score -= depth * 10;
    score
}

pub(crate) fn build_duplicate_group(
    group_id: String,
    match_kind: &str,
    similarity_pct: u8,
    mut items: Vec<&DuplicateCandidate>,
) -> DuplicateGroup {
    items.sort_by(|a, b| {
        keep_priority_score(b)
            .cmp(&keep_priority_score(a))
            .then_with(|| a.sample_id.cmp(&b.sample_id))
    });

    let mut entries = Vec::with_capacity(items.len());
    let mut reclaimable_bytes: i64 = 0;
    let mut max_size: i64 = 0;

    for (idx, c) in items.iter().enumerate() {
        let keep_suggested = idx == 0;
        if !keep_suggested && !c.library_read_only {
            reclaimable_bytes += c.file_size.max(0);
        }
        max_size = max_size.max(c.file_size.max(0));
        entries.push(DuplicateSampleEntry {
            sample_id: c.sample_id,
            library_id: c.library_id,
            library_name: c.library_name.clone(),
            library_read_only: c.library_read_only,
            file_path: c.file_path.clone(),
            file_name: c.file_name.clone(),
            extension: c.extension.clone(),
            duration_ms: c.duration_ms,
            sample_rate: c.sample_rate,
            channels: c.channels,
            bit_depth: c.bit_depth,
            file_size: c.file_size,
            is_favorite: c.is_favorite,
            tag_count: c.tag_count,
            collection_count: c.collection_count,
            keep_suggested,
        });
    }

    DuplicateGroup {
        group_id,
        match_kind: match_kind.to_string(),
        similarity_pct,
        file_size: max_size,
        reclaimable_bytes,
        items: entries,
    }
}

/// Queries active-profile non-trashed candidates using the WAL read connection so the
/// connection can be released immediately before Stage 2/3 parallel disk I/O runs.
#[cfg(test)]
pub(crate) fn load_duplicate_candidates(
    conn: &Connection,
    mode: DuplicateScanMode,
    library_id: Option<i64>,
) -> Result<DuplicateLoadBundle, String> {
    load_duplicate_candidates_for_model(conn, mode, library_id, None)
}

pub(crate) fn load_duplicate_candidates_for_model(
    conn: &Connection,
    mode: DuplicateScanMode,
    library_id: Option<i64>,
    active_model_id: Option<&str>,
) -> Result<DuplicateLoadBundle, String> {
    let active_profile_id = get_active_profile_id(conn);

    let mut raw_library_roots = Vec::new();
    {
        let lib_sql = if library_id.is_some() {
            "SELECT l.id, l.path
             FROM libraries l
             WHERE l.id = ?2
               AND (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))"
        } else {
            "SELECT l.id, l.path
             FROM libraries l
             WHERE l.is_global = 1
                OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)"
        };
        let mut stmt = conn
            .prepare(lib_sql)
            .map_err(|e| format!("Failed preparing duplicate library scope: {}", e))?;
        let lib_row_mapper = |r: &rusqlite::Row<'_>| -> rusqlite::Result<(i64, String)> {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        };
        let rows = if let Some(lib_id) = library_id {
            stmt.query_map(params![active_profile_id, lib_id], lib_row_mapper)
        } else {
            stmt.query_map(params![active_profile_id], lib_row_mapper)
        }
        .map_err(|e| format!("Failed querying duplicate library scope: {}", e))?;
        for row in rows.flatten() {
            raw_library_roots.push(row);
        }
    }

    let extra_cols = match mode {
        DuplicateScanMode::Exact => {
            "'' AS peaks_json, NULL AS vector,
             sh.file_size AS cached_hash_size, sh.file_mtime AS cached_hash_mtime,
             sh.partial_hash AS cached_partial_hash, sh.full_hash AS cached_full_hash"
        }
        DuplicateScanMode::Similar => {
            "COALESCE(s.peaks_json, '[]') AS peaks_json, e.vector,
             NULL AS cached_hash_size, NULL AS cached_hash_mtime,
             NULL AS cached_partial_hash, NULL AS cached_full_hash"
        }
    };
    let model_filter = active_model_id.unwrap_or("");
    let emb_join = match mode {
        DuplicateScanMode::Exact => "LEFT JOIN sample_hashes sh ON sh.sample_id = s.id",
        DuplicateScanMode::Similar if !model_filter.is_empty() => {
            "LEFT JOIN sample_embeddings e ON e.sample_id = s.id AND e.model_id = ?2"
        }
        DuplicateScanMode::Similar => "LEFT JOIN sample_embeddings e ON e.sample_id = s.id",
    };
    let use_model_param = mode == DuplicateScanMode::Similar && !model_filter.is_empty();
    let lib_filter = match (use_model_param, library_id.is_some()) {
        (true, true) => "AND s.library_id = ?3",
        (false, true) => "AND s.library_id = ?2",
        (_, false) => "",
    };

    let sql = format!(
        "SELECT s.id, s.library_id, l.name, COALESCE(l.is_read_only, 0),
                s.file_path, s.file_name, s.extension, s.duration_ms,
                s.sample_rate, s.channels, s.bit_depth, s.file_size,
                CASE WHEN pf.sample_id IS NOT NULL THEN 1 ELSE 0 END,
                COALESCE(tc.cnt, 0), COALESCE(cc.cnt, 0),
                {}
         FROM samples s
         INNER JOIN libraries l ON l.id = s.library_id
         LEFT JOIN profile_favorites pf
                ON pf.sample_id = s.id AND pf.profile_id = ?1
         LEFT JOIN (
                SELECT st.sample_id, COUNT(*) AS cnt
                FROM sample_tags st
                INNER JOIN samples s2 ON s2.id = st.sample_id
                INNER JOIN libraries l2 ON l2.id = s2.library_id
                WHERE COALESCE(s2.is_trashed, 0) = 0
                  AND (l2.is_global = 1
                       OR l2.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
                GROUP BY st.sample_id
         ) tc ON tc.sample_id = s.id
         LEFT JOIN (
                SELECT ci.sample_id, COUNT(*) AS cnt
                FROM collection_items ci
                INNER JOIN collections c ON c.id = ci.collection_id
                WHERE c.profile_id = ?1
                GROUP BY ci.sample_id
         ) cc ON cc.sample_id = s.id
         {}
         WHERE COALESCE(s.is_trashed, 0) = 0
           AND (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
           {}
         ORDER BY s.id ASC",
        extra_cols, emb_join, lib_filter
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed preparing duplicate candidate query: {}", e))?;

    let mut candidates = Vec::new();
    let is_similar = mode == DuplicateScanMode::Similar;
    let row_mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<DuplicateCandidate> {
        let duration_ms: i64 = row.get(7)?;
        let file_size: i64 = row.get(11)?;
        let (peaks_unit, embedding_unit) = if is_similar && file_size > 0 && duration_ms >= 80 {
            let raw_peaks: String = row.get(15)?;
            let raw_blob: Option<Vec<u8>> = row.get(16)?;
            (
                similar_match::parse_normalized_peaks(&raw_peaks),
                similar_match::blob_to_unit_embedding(raw_blob.as_deref()),
            )
        } else {
            (None, None)
        };
        Ok(DuplicateCandidate {
            sample_id: row.get(0)?,
            library_id: row.get(1)?,
            library_name: row.get(2)?,
            library_read_only: row.get(3)?,
            file_path: row.get(4)?,
            file_name: row.get(5)?,
            extension: row.get(6)?,
            duration_ms,
            sample_rate: row.get(8)?,
            channels: row.get(9)?,
            bit_depth: row.get(10)?,
            file_size,
            is_favorite: row.get(12)?,
            tag_count: row.get(13)?,
            collection_count: row.get(14)?,
            peaks_unit,
            embedding_unit,
            cached_hash_size: row.get(17)?,
            cached_hash_mtime: row.get(18)?,
            cached_partial_hash: blob_to_hash32(row.get(19)?),
            cached_full_hash: blob_to_hash32(row.get(20)?),
        })
    };

    let rows = match (use_model_param, library_id) {
        (true, Some(lib_id)) => {
            stmt.query_map(params![active_profile_id, model_filter, lib_id], row_mapper)
        }
        (true, None) => stmt.query_map(params![active_profile_id, model_filter], row_mapper),
        (false, Some(lib_id)) => stmt.query_map(params![active_profile_id, lib_id], row_mapper),
        (false, None) => stmt.query_map(params![active_profile_id], row_mapper),
    }
    .map_err(|e| format!("Failed scanning duplicate candidates: {}", e))?;

    for cand in rows.flatten() {
        candidates.push(cand);
    }

    Ok(DuplicateLoadBundle {
        candidates,
        raw_library_roots,
    })
}

pub(crate) fn persist_sample_hash_cache(
    conn: &mut Connection,
    writes: &[SampleHashCacheWrite],
) -> Result<usize, String> {
    if writes.is_empty() {
        return Ok(0);
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting sample hash cache transaction: {}", e))?;
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO sample_hashes (sample_id, file_size, file_mtime, partial_hash, full_hash, updated_at)
                 SELECT ?1, ?2, ?3, ?4, ?5, datetime('now')
                 WHERE EXISTS (SELECT 1 FROM samples WHERE id = ?1)
                 ON CONFLICT(sample_id) DO UPDATE SET
                     partial_hash = CASE
                         WHEN sample_hashes.file_size = excluded.file_size
                          AND sample_hashes.file_mtime IS excluded.file_mtime
                         THEN COALESCE(excluded.partial_hash, sample_hashes.partial_hash)
                         ELSE excluded.partial_hash
                     END,
                     full_hash = CASE
                         WHEN sample_hashes.file_size = excluded.file_size
                          AND sample_hashes.file_mtime IS excluded.file_mtime
                         THEN COALESCE(excluded.full_hash, sample_hashes.full_hash)
                         ELSE excluded.full_hash
                     END,
                     file_size = excluded.file_size,
                     file_mtime = excluded.file_mtime,
                     updated_at = datetime('now')",
            )
            .map_err(|e| format!("Failed preparing sample hash upsert: {}", e))?;

        for entry in writes {
            stmt.execute(params![
                entry.sample_id,
                entry.file_size,
                entry.file_mtime,
                entry.partial_hash.as_ref().map(|h| h.as_slice()),
                entry.full_hash.as_ref().map(|h| h.as_slice()),
            ])
            .map_err(|e| format!("Failed persisting sample hash cache row: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed committing sample hash cache: {}", e))?;
    Ok(writes.len())
}

#[cfg(test)]
pub(crate) fn compute_duplicates(
    bundle: DuplicateLoadBundle,
    mode: DuplicateScanMode,
) -> DuplicateScanResult {
    compute_duplicates_with_progress(bundle, mode, 97, None).0
}

#[cfg(test)]
pub(crate) fn compute_duplicates_with_min_similarity(
    bundle: DuplicateLoadBundle,
    mode: DuplicateScanMode,
    min_similarity_pct: u8,
) -> DuplicateScanResult {
    compute_duplicates_with_progress(bundle, mode, min_similarity_pct, None).0
}

pub(crate) fn compute_duplicates_with_progress(
    bundle: DuplicateLoadBundle,
    mode: DuplicateScanMode,
    min_similarity_pct: u8,
    emit_progress: Option<ProgressEmitFn>,
) -> (DuplicateScanResult, Vec<SampleHashCacheWrite>) {
    let start = Instant::now();
    let scanned_samples = bundle.candidates.len();

    let (groups, cache_writes) = match mode {
        DuplicateScanMode::Exact => exact_hash::find_exact_duplicate_groups_with_progress(
            &bundle.candidates,
            &bundle.raw_library_roots,
            emit_progress,
        ),
        DuplicateScanMode::Similar => (
            similar_match::find_similar_duplicate_groups_with_progress(
                &bundle.candidates,
                min_similarity_pct,
                emit_progress,
            ),
            Vec::new(),
        ),
    };

    let groups_found = groups.len();
    let duplicate_files_count: usize = groups
        .iter()
        .map(|g| g.items.len().saturating_sub(1))
        .sum();
    let reclaimable_bytes: i64 = groups.iter().map(|g| g.reclaimable_bytes).sum();

    let result = DuplicateScanResult {
        mode: match mode {
            DuplicateScanMode::Exact => "exact".to_string(),
            DuplicateScanMode::Similar => "similar".to_string(),
        },
        scanned_samples,
        groups_found,
        duplicate_files_count,
        reclaimable_bytes,
        elapsed_ms: start.elapsed().as_millis() as u64,
        groups,
    };
    (result, cache_writes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "audify_dup_test_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn exact_hash_detects_content_clones_and_keeps_favorite_or_protected_copy() {
        let root = temp_dir("exact");
        let a = root.join("kick_copy.wav");
        let b = root.join("kick_main.wav");
        let c = root.join("snare_same_size.wav");

        let payload_ab = vec![0x52u8; 16_384];
        let mut payload_c = vec![0x52u8; 16_384];
        payload_c[10_000] = 0x99;

        fs::write(&a, &payload_ab).unwrap();
        fs::write(&b, &payload_ab).unwrap();
        fs::write(&c, &payload_c).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        let active_profile_id = get_active_profile_id(&conn);
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (1, ?1, 'Main Lib', 1, 0)",
            params![root.to_string_lossy().to_string()],
        )
        .unwrap();

        for (id, path, name, fav) in [
            (1i64, a.to_string_lossy().to_string(), "kick_copy.wav", false),
            (2i64, b.to_string_lossy().to_string(), "kick_main.wav", true),
            (3i64, c.to_string_lossy().to_string(), "snare_same_size.wav", false),
        ] {
            conn.execute(
                "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, sample_rate, channels, bit_depth, file_size)
                 VALUES (?1, 1, ?2, ?3, 'wav', 1000, 48000, 2, 24, 16384)",
                params![id, path, name],
            )
            .unwrap();
            if fav {
                conn.execute(
                    "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
                    params![active_profile_id, id],
                )
                .unwrap();
            }
        }

        let bundle = load_duplicate_candidates(&conn, DuplicateScanMode::Exact, None).unwrap();
        let res = compute_duplicates(bundle, DuplicateScanMode::Exact);

        assert_eq!(res.groups_found, 1);
        assert_eq!(res.duplicate_files_count, 1);
        assert_eq!(res.reclaimable_bytes, 16_384);
        assert_eq!(res.groups[0].items.len(), 2);
        // Favorite copy (`kick_main.wav`) must be suggested to keep!
        assert_eq!(res.groups[0].items[0].sample_id, 2);
        assert!(res.groups[0].items[0].keep_suggested);
        assert_eq!(res.groups[0].items[1].sample_id, 1);
        assert!(!res.groups[0].items[1].keep_suggested);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn exact_hash_protects_read_only_library_reclaimable_bytes() {
        let ro_root = temp_dir("ro_vault");
        let rw_root = temp_dir("rw_work");
        let ro_file = ro_root.join("vault_hit.wav");
        let rw_file = rw_root.join("work_hit.wav");
        let bytes = b"identical tiny wav data payload";
        fs::write(&ro_file, bytes).unwrap();
        fs::write(&rw_file, bytes).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        let active_profile_id = get_active_profile_id(&conn);
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (1, ?1, 'Vault', 1, 1)",
            params![ro_root.to_string_lossy().to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (2, ?1, 'Scratch', 1, 0)",
            params![rw_root.to_string_lossy().to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (1, 1, ?1, 'vault_hit.wav', 'wav', 500, ?2)",
            params![ro_file.to_string_lossy().to_string(), bytes.len() as i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (2, 2, ?1, 'work_hit.wav', 'wav', 500, ?2)",
            params![rw_file.to_string_lossy().to_string(), bytes.len() as i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, 2)",
            params![active_profile_id],
        )
        .unwrap();

        let bundle = load_duplicate_candidates(&conn, DuplicateScanMode::Exact, None).unwrap();
        let res = compute_duplicates(bundle, DuplicateScanMode::Exact);

        assert_eq!(res.groups_found, 1);
        // Even though scratch copy is favorite, Read-Only vault copy MUST stay protected as KEEP
        assert_eq!(res.groups[0].items[0].sample_id, 1);
        assert!(res.groups[0].items[0].library_read_only);
        assert!(res.groups[0].items[0].keep_suggested);
        assert_eq!(res.groups[0].reclaimable_bytes, bytes.len() as i64);

        let _ = fs::remove_dir_all(&ro_root);
        let _ = fs::remove_dir_all(&rw_root);
    }

    #[test]
    fn similar_mode_clusters_waveform_and_duration_near_duplicates() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (1, 'D:/Sounds', 'Main', 1, 0)",
            [],
        )
        .unwrap();

        let envelope_wav = "[0.95,0.82,0.61,0.44,0.31,0.20,0.12,0.06,0.02,0.01]";
        let envelope_mp3 = "[0.94,0.81,0.60,0.43,0.31,0.20,0.12,0.06,0.02,0.01]";
        let different_env = "[0.05,0.10,0.25,0.45,0.75,0.92,0.88,0.65,0.30,0.12]";

        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size, peaks_json)
             VALUES (1, 1, 'D:/Sounds/Boom.wav', 'Boom.wav', 'wav', 1500, 144000, ?1)",
            params![envelope_wav],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size, peaks_json)
             VALUES (2, 1, 'D:/Sounds/Boom.mp3', 'Boom.mp3', 'mp3', 1510, 24000, ?1)",
            params![envelope_mp3],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size, peaks_json)
             VALUES (3, 1, 'D:/Sounds/Pad.wav', 'Pad.wav', 'wav', 1505, 145000, ?1)",
            params![different_env],
        )
        .unwrap();

        let bundle = load_duplicate_candidates(&conn, DuplicateScanMode::Similar, None).unwrap();
        let res = compute_duplicates(bundle, DuplicateScanMode::Similar);

        assert_eq!(res.groups_found, 1);
        assert_eq!(res.groups[0].items.len(), 2);
        // Lossless WAV preferred over MP3
        assert_eq!(res.groups[0].items[0].sample_id, 1);
        assert!(res.groups[0].items[0].keep_suggested);
        assert_eq!(res.groups[0].items[1].sample_id, 2);
    }

    #[test]
    fn similar_mode_respects_min_similarity_pct_thresholds() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (1, 'D:/Sounds', 'Main', 1, 0)",
            [],
        )
        .unwrap();

        let env_base = "[0.90,0.75,0.58,0.40,0.28,0.18,0.10,0.05,0.02,0.01]";
        let env_variation = "[0.84,0.78,0.52,0.46,0.24,0.20,0.13,0.07,0.03,0.01]";

        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size, peaks_json)
             VALUES (1, 1, 'D:/Sounds/Kick_Clean.wav', 'Kick_Clean.wav', 'wav', 1000, 96000, ?1)",
            params![env_base],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size, peaks_json)
             VALUES (2, 1, 'D:/Sounds/Kick_Alt.wav', 'Kick_Alt.wav', 'wav', 1020, 96000, ?1)",
            params![env_variation],
        )
        .unwrap();

        let bundle_strict =
            load_duplicate_candidates(&conn, DuplicateScanMode::Similar, None).unwrap();
        let res_strict =
            compute_duplicates_with_min_similarity(bundle_strict, DuplicateScanMode::Similar, 98);
        assert_eq!(res_strict.groups_found, 0);

        let bundle_loose =
            load_duplicate_candidates(&conn, DuplicateScanMode::Similar, None).unwrap();
        let res_loose =
            compute_duplicates_with_min_similarity(bundle_loose, DuplicateScanMode::Similar, 90);
        assert_eq!(res_loose.groups_found, 1);
        assert!(res_loose.groups[0].similarity_pct >= 90);
        assert!(res_loose.groups[0].similarity_pct < 98);
    }

    #[test]
    fn exact_hash_cache_hits_on_unchanged_and_invalidates_on_change() {
        let dir = temp_dir("hash_cache");
        fs::create_dir_all(&dir).unwrap();
        let file_a = dir.join("clone_a.wav");
        let file_b = dir.join("clone_b.wav");
        let payload = vec![b'C'; 10_240];
        fs::write(&file_a, &payload).unwrap();
        fs::write(&file_b, &payload).unwrap();

        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        let lib_str = dir.to_string_lossy().to_string();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (1, ?1, 'Main', 1, 0)",
            params![lib_str],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (1, 1, ?1, 'clone_a.wav', 'wav', 900, ?2)",
            params![file_a.to_string_lossy().to_string(), payload.len() as i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (2, 1, ?1, 'clone_b.wav', 'wav', 900, ?2)",
            params![file_b.to_string_lossy().to_string(), payload.len() as i64],
        )
        .unwrap();

        // First scan computes hashes and returns cache writes
        let bundle1 = load_duplicate_candidates(&conn, DuplicateScanMode::Exact, None).unwrap();
        let (res1, writes1) =
            compute_duplicates_with_progress(bundle1, DuplicateScanMode::Exact, 97, None);
        assert_eq!(res1.groups_found, 1);
        assert_eq!(writes1.len(), 2);
        persist_sample_hash_cache(&mut conn, &writes1).unwrap();

        // Second scan on unchanged files uses cache and emits zero new hash writes
        let bundle2 = load_duplicate_candidates(&conn, DuplicateScanMode::Exact, None).unwrap();
        assert!(bundle2.candidates[0].cached_partial_hash.is_some());
        assert!(bundle2.candidates[0].cached_full_hash.is_some());
        let (res2, writes2) =
            compute_duplicates_with_progress(bundle2, DuplicateScanMode::Exact, 97, None);
        assert_eq!(res2.groups_found, 1);
        assert!(writes2.is_empty());

        // Rewrite clone_b with different content of identical length and force stale mtime in DB
        let modified = vec![b'X'; 10_240];
        fs::write(&file_b, &modified).unwrap();
        conn.execute(
            "UPDATE sample_hashes SET file_mtime = COALESCE(file_mtime, 0) - 5000 WHERE sample_id = 2",
            [],
        )
        .unwrap();

        let bundle3 = load_duplicate_candidates(&conn, DuplicateScanMode::Exact, None).unwrap();
        let (res3, writes3) =
            compute_duplicates_with_progress(bundle3, DuplicateScanMode::Exact, 97, None);
        assert_eq!(res3.groups_found, 0);
        assert_eq!(writes3.len(), 1);
        assert_eq!(writes3[0].sample_id, 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_progress_labels_include_clear_step_prefixes() {
        let dir = temp_dir("progress_steps");
        let file_a = dir.join("hit_a.wav");
        let file_b = dir.join("hit_b.wav");
        let payload = vec![b'P'; 10_240];
        fs::write(&file_a, &payload).unwrap();
        fs::write(&file_b, &payload).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global, is_read_only) VALUES (1, ?1, 'Main', 1, 0)",
            params![dir.to_string_lossy().to_string()],
        )
        .unwrap();
        for (id, path, name) in [(1i64, &file_a, "hit_a.wav"), (2i64, &file_b, "hit_b.wav")] {
            conn.execute(
                "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, file_size, peaks_json)
                 VALUES (?1, 1, ?2, ?3, 'wav', 900, ?4, '[0.9,0.7,0.5,0.3,0.2,0.1,0.05,0.02,0.01]')",
                params![id, path.to_string_lossy().to_string(), name, payload.len() as i64],
            )
            .unwrap();
        }

        let exact_labels = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let exact_capture = exact_labels.clone();
        let exact_bundle = load_duplicate_candidates(&conn, DuplicateScanMode::Exact, None).unwrap();
        compute_duplicates_with_progress(
            exact_bundle,
            DuplicateScanMode::Exact,
            97,
            Some(std::sync::Arc::new(move |p| {
                exact_capture.lock().unwrap().push(p.stage_label);
            })),
        );
        let collected_exact = exact_labels.lock().unwrap();
        assert!(collected_exact.iter().any(|l| l == "Step 1/3 · Checking files"));
        assert!(collected_exact.iter().any(|l| l == "Step 2/3 · Sampling headers"));
        assert!(collected_exact.iter().any(|l| l == "Step 3/3 · Verifying SHA-256"));

        let sim_labels = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let sim_capture = sim_labels.clone();
        let sim_bundle = load_duplicate_candidates(&conn, DuplicateScanMode::Similar, None).unwrap();
        compute_duplicates_with_progress(
            sim_bundle,
            DuplicateScanMode::Similar,
            97,
            Some(std::sync::Arc::new(move |p| {
                sim_capture.lock().unwrap().push(p.stage_label);
            })),
        );
        let collected_sim = sim_labels.lock().unwrap();
        assert!(collected_sim.iter().any(|l| l == "Step 1/2 · Analyzing envelopes"));
        assert!(collected_sim.iter().any(|l| l == "Step 2/2 · Comparing audio"));

        let _ = fs::remove_dir_all(&dir);
    }
}
