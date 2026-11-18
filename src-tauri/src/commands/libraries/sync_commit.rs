use super::sync::ExistingSampleEntry;
use crate::commands::{resolve_or_create_auto_tag, Library};
use crate::db::{deterministic_color_for_name, AutoTagRule};
use crate::scanner::{path_lookup_key, ScannedSample};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[allow(clippy::too_many_arguments)]
pub(super) fn commit_synced_samples_with_status(
    conn: &mut Connection,
    lib_id: i64,
    active_profile_id: i64,
    target_folder_is_none: bool,
    force: bool,
    existing_entries: &HashMap<String, ExistingSampleEntry>,
    scanned_samples: &[ScannedSample],
    seen_paths: &HashSet<String>,
    mtime_backfills: &[(String, i64)],
    rules: &[AutoTagRule],
) -> Result<(Library, bool), String> {
    let mut seen_by_key: HashMap<String, &String> = HashMap::with_capacity(seen_paths.len());
    for p in seen_paths {
        seen_by_key.insert(path_lookup_key(p), p);
    }

    let has_deleted_or_renamed = existing_entries.iter().any(|(key, old_entry)| {
        match seen_by_key.get(key) {
            None => true,
            Some(&actual_disk_path) => actual_disk_path != &old_entry.db_file_path,
        }
    });
    if !force && !has_deleted_or_renamed && scanned_samples.is_empty() {
        if !mtime_backfills.is_empty() {
            let tx = conn
                .transaction()
                .map_err(|e| format!("Failed to start mtime backfill transaction: {}", e))?;
            {
                let mut mtime_stmt = tx
                    .prepare("UPDATE samples SET file_modified_at = ?1 WHERE id = ?2 AND file_modified_at IS NULL")
                    .map_err(|e| format!("Failed to prepare mtime backfill statement: {}", e))?;
                for (lookup_key, modified_ms) in mtime_backfills {
                    if let Some(entry) = existing_entries.get(lookup_key) {
                        let _ = mtime_stmt.execute(params![modified_ms, entry.id]);
                    }
                }
            }
            tx.commit()
                .map_err(|e| format!("Failed to commit mtime backfill transaction: {}", e))?;
        }
        let library = load_library_record(conn, lib_id, active_profile_id)?;
        return Ok((library, false));
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    if !mtime_backfills.is_empty() {
        let mut mtime_stmt = tx
            .prepare("UPDATE samples SET file_modified_at = ?1 WHERE id = ?2 AND file_modified_at IS NULL")
            .map_err(|e| format!("Failed to prepare mtime backfill statement: {}", e))?;
        for (lookup_key, modified_ms) in mtime_backfills {
            if let Some(entry) = existing_entries.get(lookup_key) {
                let _ = mtime_stmt.execute(params![modified_ms, entry.id]);
            }
        }
    }

    if force && target_folder_is_none {
        tx.execute(
            "DELETE FROM sample_tags
             WHERE is_manual = 0
               AND COALESCE(source, 'auto') IN ('auto', 'auto_rule')
               AND sample_id IN (SELECT id FROM samples WHERE library_id = ?1)",
            params![lib_id],
        )
        .map_err(|e| format!("Failed to clear old auto-tags for library: {}", e))?;
    }

    // 1. Delete genuinely removed files (lookup key absent from seen_by_key) and
    //    update case-renamed paths in-place on existing `samples.id` so favorites,
    //    manual tags, and collection items are never cascade-deleted!
    //    Guard both operations against concurrent move/rename/trash between pre-scan & commit.
    let mut rows_deleted_or_renamed = 0usize;
    {
        let mut delete_absent_stmt = tx
            .prepare(
                "DELETE FROM samples
                 WHERE id = ?1
                   AND library_id = ?2
                   AND COALESCE(is_trashed, 0) = 0
                   AND file_path = ?3
                   AND file_size = ?4
                   AND file_modified_at IS ?5",
            )
            .map_err(|e| format!("Failed to prepare sample delete guard: {}", e))?;
        let mut rename_case_stmt = tx
            .prepare(
                "UPDATE samples
                 SET file_path = ?1, file_name = ?2
                 WHERE id = ?3
                   AND library_id = ?4
                   AND COALESCE(is_trashed, 0) = 0
                   AND file_path = ?5",
            )
            .map_err(|e| format!("Failed to prepare sample case-rename guard: {}", e))?;

        for (key, old_entry) in existing_entries {
            match seen_by_key.get(key) {
                None => {
                    rows_deleted_or_renamed += delete_absent_stmt
                        .execute(params![
                            old_entry.id,
                            lib_id,
                            old_entry.db_file_path,
                            old_entry.file_size,
                            old_entry.file_modified_at,
                        ])
                        .unwrap_or(0);
                }
                Some(&actual_disk_path) if actual_disk_path != &old_entry.db_file_path => {
                    let new_file_name = Path::new(actual_disk_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown");
                    rows_deleted_or_renamed += rename_case_stmt
                        .execute(params![
                            actual_disk_path,
                            new_file_name,
                            old_entry.id,
                            lib_id,
                            old_entry.db_file_path,
                        ])
                        .unwrap_or(0);
                }
                Some(_) => {}
            }
        }
    }

    let mut tag_map: HashMap<String, i64> = HashMap::new();
    if let Ok(mut stmt) = tx.prepare("SELECT id, name FROM tags") {
        if let Ok(rows) =
            stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        {
            for (tid, tname) in rows.flatten() {
                tag_map.insert(tname.to_lowercase(), tid);
            }
        }
    }

    let mut genre_set: HashSet<String> = HashSet::new();
    if let Ok(mut stmt) = tx.prepare("SELECT name FROM genres") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for gname in rows.flatten() {
                genre_set.insert(gname.to_lowercase());
            }
        }
    }

    {
        let mut genre_insert_stmt = tx
            .prepare("INSERT OR IGNORE INTO genres (name, color) VALUES (?1, ?2)")
            .map_err(|e| format!("Failed to prepare genre insert: {}", e))?;

        let mut upsert_stmt = tx
            .prepare(
                "INSERT INTO samples (
                    library_id, file_path, file_name, extension,
                    duration_ms, sample_rate, channels, bit_depth,
                    file_size, is_loop, genre, artist, album, year,
                    bpm, musical_key, camelot_key, peaks_json, file_modified_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                ON CONFLICT(file_path) DO UPDATE SET
                    library_id = excluded.library_id,
                    file_name = excluded.file_name,
                    extension = excluded.extension,
                    duration_ms = excluded.duration_ms,
                    sample_rate = excluded.sample_rate,
                    channels = excluded.channels,
                    bit_depth = excluded.bit_depth,
                    file_size = excluded.file_size,
                    is_loop = CASE
                        WHEN samples.loop_is_manual = 1 THEN samples.is_loop
                        ELSE excluded.is_loop
                    END,
                    genre = CASE
                        WHEN samples.genre_is_manual = 1 THEN samples.genre
                        WHEN excluded.genre != '' THEN excluded.genre
                        ELSE samples.genre
                    END,
                    artist = CASE WHEN excluded.artist != '' THEN excluded.artist ELSE samples.artist END,
                    album = CASE WHEN excluded.album != '' THEN excluded.album ELSE samples.album END,
                    year = CASE WHEN excluded.year != '' THEN excluded.year ELSE samples.year END,
                    bpm = CASE
                        WHEN samples.bpm_is_manual = 1 THEN samples.bpm
                        WHEN excluded.bpm IS NOT NULL THEN excluded.bpm
                        ELSE samples.bpm
                    END,
                    musical_key = CASE
                        WHEN samples.key_is_manual = 1 THEN samples.musical_key
                        WHEN excluded.musical_key != '' THEN excluded.musical_key
                        ELSE samples.musical_key
                    END,
                    camelot_key = CASE
                        WHEN samples.key_is_manual = 1 THEN samples.camelot_key
                        WHEN excluded.camelot_key != '' THEN excluded.camelot_key
                        ELSE samples.camelot_key
                    END,
                    peaks_json = excluded.peaks_json,
                    file_modified_at = COALESCE(excluded.file_modified_at, samples.file_modified_at)",
            )
            .map_err(|e| format!("Failed to prepare sample upsert: {}", e))?;

        let mut select_id_stmt = tx
            .prepare("SELECT id FROM samples WHERE file_path = ?1")
            .map_err(|e| e.to_string())?;

        let mut clear_sample_autotags_stmt = tx
            .prepare(
                "DELETE FROM sample_tags
                 WHERE sample_id = ?1
                   AND is_manual = 0
                   AND COALESCE(source, 'auto') IN ('auto', 'auto_rule')",
            )
            .map_err(|e| e.to_string())?;

        let mut tag_insert_stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual, source)
                 VALUES (?1, ?2, 0, 'auto_rule')",
            )
            .map_err(|e| e.to_string())?;

        for s in scanned_samples {
            if !s.genre.is_empty() {
                let trimmed_genre = s.genre.trim();
                if !trimmed_genre.is_empty() && genre_set.insert(trimmed_genre.to_lowercase()) {
                    let color = deterministic_color_for_name(trimmed_genre);
                    let _ = genre_insert_stmt.execute(params![trimmed_genre, color]);
                }
            }
            upsert_stmt
                .execute(params![
                    lib_id,
                    s.file_path,
                    s.file_name,
                    s.extension,
                    s.duration_ms,
                    s.sample_rate,
                    s.channels,
                    s.bit_depth,
                    s.file_size,
                    s.is_loop,
                    s.genre,
                    s.artist,
                    s.album,
                    s.year,
                    s.bpm,
                    s.musical_key,
                    s.camelot_key,
                    s.peaks_json,
                    s.file_modified_at
                ])
                .map_err(|e| format!("Failed to insert sample {}: {}", s.file_name, e))?;

            if let Ok(sample_id) =
                select_id_stmt.query_row(params![s.file_path], |r| r.get::<_, i64>(0))
            {
                if force && !target_folder_is_none {
                    let _ = clear_sample_autotags_stmt.execute(params![sample_id]);
                }
                for tname in &s.auto_tags {
                    let tag_id = resolve_or_create_auto_tag(&tx, &mut tag_map, rules, tname);
                    if tag_id > 0 {
                        let _ = tag_insert_stmt.execute(params![sample_id, tag_id]);
                    }
                }
            }
        }

        // Prune ONLY non-manual orphan auto-tags!
        let _ = tx.execute(
            "DELETE FROM tags WHERE is_manual = 0 AND id NOT IN (SELECT DISTINCT tag_id FROM sample_tags)",
            [],
        );
    }

    let changed = force || !scanned_samples.is_empty() || rows_deleted_or_renamed > 0;
    tx.commit()
        .map_err(|e| format!("Failed to commit scan transaction: {}", e))?;

    let library = load_library_record(conn, lib_id, active_profile_id)?;
    Ok((library, changed))
}

fn load_library_record(
    conn: &Connection,
    lib_id: i64,
    active_profile_id: i64,
) -> Result<Library, String> {
    conn.query_row(
        "SELECT l.id, l.path, l.name, l.last_scanned_at,
                (SELECT COUNT(*) FROM samples s WHERE s.library_id = l.id AND COALESCE(s.is_trashed, 0) = 0) AS sample_count,
                l.is_global,
                EXISTS(SELECT 1 FROM profile_libraries pl WHERE pl.profile_id = ?2 AND pl.library_id = l.id) AS assigned_to_profile,
                COALESCE(l.is_read_only, 0)
         FROM libraries l
         WHERE l.id = ?1",
        params![lib_id, active_profile_id],
        |row| {
            Ok(Library {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                last_scanned_at: row.get(3)?,
                sample_count: row.get(4)?,
                is_global: row.get(5)?,
                assigned_to_profile: row.get(6)?,
                is_read_only: row.get(7)?,
            })
        },
    )
    .map_err(|e| format!("Failed to load library record: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;

    #[test]
    fn commit_preserves_ai_auto_tags_and_skips_concurrently_moved_deletes() {
        let mut conn = Connection::open_in_memory().expect("open db");
        init_schema_on_conn(&conn).expect("init schema");

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/Lib', 'Lib', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, file_size, file_modified_at)
             VALUES (1, 1, 'C:/Lib/moved_new.wav', 'moved_new.wav', 'wav', 100, 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tags (id, name, color, is_manual) VALUES (1, 'Warm', '#123456', 1), (2, 'OldRule', '#654321', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
             VALUES (1, 1, 0, 'ai_auto'), (1, 2, 0, 'auto_rule')",
            [],
        )
        .unwrap();

        let mut existing = HashMap::new();
        existing.insert(
            path_lookup_key("C:/Lib/moved_old.wav"),
            ExistingSampleEntry {
                id: 1,
                db_file_path: "C:/Lib/moved_old.wav".to_string(),
                file_size: 100,
                file_modified_at: Some(1000),
            },
        );
        let seen = HashSet::from(["C:/Lib/moved_new.wav".to_string()]);
        let scanned = vec![ScannedSample {
            file_path: "C:/Lib/moved_new.wav".to_string(),
            file_name: "moved_new.wav".to_string(),
            extension: "wav".to_string(),
            duration_ms: 250,
            sample_rate: 44100,
            channels: 1,
            bit_depth: 16,
            file_size: 100,
            file_modified_at: Some(1000),
            is_loop: false,
            genre: String::new(),
            artist: String::new(),
            album: String::new(),
            year: String::new(),
            bpm: None,
            musical_key: String::new(),
            camelot_key: String::new(),
            peaks_json: "[]".to_string(),
            auto_tags: vec!["warm".to_string()],
        }];

        let (_, changed) = commit_synced_samples_with_status(
            &mut conn,
            1,
            1,
            true,
            true,
            &existing,
            &scanned,
            &seen,
            &[],
            &[],
        )
        .expect("commit sync");
        assert!(changed);

        let moved_still_exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM samples WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(moved_still_exists, 1, "concurrently moved sample must not be deleted");

        let warm_source: String = conn
            .query_row(
                "SELECT source FROM sample_tags WHERE sample_id = 1 AND tag_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(warm_source, "ai_auto");

        let warm_color: String = conn
            .query_row("SELECT color FROM tags WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(warm_color, "#123456");

        let old_rule_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = 1 AND tag_id = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_rule_count, 0, "stale auto_rule tag must be cleared on force rebuild");
    }
}