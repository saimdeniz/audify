use crate::commands::{parent_folder_path, ArtistStat, LicenseGroupCountInput};
use crate::db::{get_active_profile_id, run_read_query, AppState};
use crate::security::normalize_clean_path;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use tauri::State;

fn normalize_match_segment(raw: &str) -> String {
    normalize_clean_path(raw)
        .trim_matches('/')
        .to_lowercase()
}

fn normalize_match_folder_prefix(raw: &str) -> String {
    normalize_clean_path(raw)
        .trim_end_matches('/')
        .to_lowercase()
}

fn normalize_artist_key(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn sample_matches_license_filters(
    file_path: &str,
    artist: &str,
    norm_folders: &[String],
    norm_rel_folders: &[String],
    norm_artists: &HashSet<String>,
) -> bool {
    if !norm_folders.is_empty() {
        let sample_norm = normalize_clean_path(file_path).to_lowercase();
        for folder in norm_folders {
            if sample_norm == *folder || sample_norm.starts_with(&format!("{}/", folder)) {
                return true;
            }
        }
    }
    if !norm_rel_folders.is_empty() {
        let parent_norm = normalize_match_folder_prefix(&parent_folder_path(file_path));
        for rel in norm_rel_folders {
            if parent_norm == *rel
                || parent_norm.ends_with(&format!("/{}", rel))
                || parent_norm.contains(&format!("/{}/", rel))
            {
                return true;
            }
        }
    }
    if !norm_artists.is_empty() {
        let artist_key = normalize_artist_key(artist);
        if !artist_key.is_empty() && norm_artists.contains(&artist_key) {
            return true;
        }
    }
    false
}

/// Returns distinct scanned `artist` metadata values and track counts across the
/// active profile's visible libraries, merging case variants deterministically by
/// keeping the most frequent display spelling.
pub(crate) fn get_artist_stats_with_conn(conn: &Connection) -> Result<Vec<ArtistStat>, String> {
    let active_id = get_active_profile_id(conn);

    let mut stmt = conn
        .prepare(
            "SELECT TRIM(s.artist) AS artist_name, COUNT(*) AS cnt
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND TRIM(COALESCE(s.artist, '')) != ''
               AND (l.is_global = 1 OR s.library_id IN (
                   SELECT library_id FROM profile_libraries WHERE profile_id = ?1
               ))
             GROUP BY TRIM(s.artist)",
        )
        .map_err(|e| format!("Artist stats query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("Artist stats query execution error: {}", e))?;

    // Merge case-only variants deterministically: keep the spelling with the highest count
    // (tie-breaking lexicographically).
    let mut merged: HashMap<String, (String, i64, i64)> = HashMap::new();
    for (artist, count) in rows.flatten() {
        let trimmed = artist.trim();
        if trimmed.is_empty() || count <= 0 {
            continue;
        }
        let key = trimmed.to_lowercase();
        let entry = merged
            .entry(key)
            .or_insert_with(|| (trimmed.to_string(), 0, 0));
        entry.1 += count;
        if count > entry.2 || (count == entry.2 && trimmed < entry.0.as_str()) {
            entry.0 = trimmed.to_string();
            entry.2 = count;
        }
    }

    let mut out: Vec<ArtistStat> = merged
        .into_values()
        .map(|(artist, count, _)| ArtistStat { artist, count })
        .collect();

    out.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()))
            .then_with(|| a.artist.cmp(&b.artist))
    });
    Ok(out)
}

#[tauri::command]
pub async fn get_artist_stats(state: State<'_, AppState>) -> Result<Vec<ArtistStat>, String> {
    run_read_query(&state, get_artist_stats_with_conn).await
}

pub(crate) fn preview_license_group_samples_with_conn(
    conn: &Connection,
    folders: &[String],
    rel_folders: &[String],
    artists: &[String],
    limit: usize,
) -> Result<Vec<String>, String> {
    let max_items = limit.clamp(1, 20);
    let norm_folders: Vec<String> = folders
        .iter()
        .map(|f| normalize_match_folder_prefix(f))
        .filter(|f| !f.is_empty())
        .collect();
    let norm_rel_folders: Vec<String> = rel_folders
        .iter()
        .map(|r| normalize_match_segment(r))
        .filter(|r| !r.is_empty())
        .collect();
    let norm_artists: HashSet<String> = artists
        .iter()
        .map(|a| normalize_artist_key(a))
        .filter(|a| !a.is_empty())
        .collect();

    if norm_folders.is_empty() && norm_rel_folders.is_empty() && norm_artists.is_empty() {
        return Ok(Vec::new());
    }

    let active_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT s.file_path, s.file_name, COALESCE(s.artist, '')
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND (l.is_global = 1 OR s.library_id IN (
                   SELECT library_id FROM profile_libraries WHERE profile_id = ?1
               ))
             ORDER BY s.file_name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Preview query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Preview query execution error: {}", e))?;

    let mut names = Vec::with_capacity(max_items);
    for (file_path, file_name, artist) in rows.flatten() {
        if sample_matches_license_filters(
            &file_path,
            &artist,
            &norm_folders,
            &norm_rel_folders,
            &norm_artists,
        ) {
            names.push(file_name);
            if names.len() >= max_items {
                break;
            }
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn preview_license_group_samples(
    state: State<'_, AppState>,
    folders: Vec<String>,
    rel_folders: Option<Vec<String>>,
    artists: Option<Vec<String>>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let rel = rel_folders.unwrap_or_default();
    let art = artists.unwrap_or_default();
    let max_items = limit.unwrap_or(3).clamp(1, 20);
    run_read_query(&state, move |conn| {
        preview_license_group_samples_with_conn(conn, &folders, &rel, &art, max_items)
    })
    .await
}

struct PreparedGroupMatcher {
    id: String,
    norm_folders: Vec<String>,
    norm_rel_folders: Vec<String>,
    norm_artists: HashSet<String>,
    count: i64,
}

/// Computes exact deduplicated union counts (`folders ∪ rel_folders ∪ artists`) per
/// license group in a single pass across the active profile's non-trashed samples.
pub(crate) fn count_license_group_matches_with_conn(
    conn: &Connection,
    groups: &[LicenseGroupCountInput],
) -> Result<HashMap<String, i64>, String> {
    let mut out = HashMap::with_capacity(groups.len());
    if groups.is_empty() {
        return Ok(out);
    }

    let mut matchers: Vec<PreparedGroupMatcher> = Vec::with_capacity(groups.len());
    for g in groups.iter().take(256) {
        let norm_folders: Vec<String> = g
            .folders
            .iter()
            .map(|f| normalize_match_folder_prefix(f))
            .filter(|f| !f.is_empty())
            .collect();
        let norm_rel_folders: Vec<String> = g
            .rel_folders
            .iter()
            .map(|r| normalize_match_segment(r))
            .filter(|r| !r.is_empty())
            .collect();
        let norm_artists: HashSet<String> = g
            .artists
            .iter()
            .map(|a| normalize_artist_key(a))
            .filter(|a| !a.is_empty())
            .collect();
        out.insert(g.id.clone(), 0);
        if !norm_folders.is_empty() || !norm_rel_folders.is_empty() || !norm_artists.is_empty() {
            matchers.push(PreparedGroupMatcher {
                id: g.id.clone(),
                norm_folders,
                norm_rel_folders,
                norm_artists,
                count: 0,
            });
        }
    }

    if matchers.is_empty() {
        return Ok(out);
    }

    let active_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT s.file_path, COALESCE(s.artist, '')
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND (l.is_global = 1 OR s.library_id IN (
                   SELECT library_id FROM profile_libraries WHERE profile_id = ?1
               ))",
        )
        .map_err(|e| format!("License count query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| format!("License count query execution error: {}", e))?;

    for (file_path, artist) in rows.flatten() {
        for m in &mut matchers {
            if sample_matches_license_filters(
                &file_path,
                &artist,
                &m.norm_folders,
                &m.norm_rel_folders,
                &m.norm_artists,
            ) {
                m.count += 1;
            }
        }
    }

    for m in matchers {
        out.insert(m.id, m.count);
    }
    Ok(out)
}

#[tauri::command]
pub async fn count_license_group_matches(
    state: State<'_, AppState>,
    groups: Vec<LicenseGroupCountInput>,
) -> Result<HashMap<String, i64>, String> {
    run_read_query(&state, move |conn| {
        count_license_group_matches_with_conn(conn, &groups)
    })
    .await
}
