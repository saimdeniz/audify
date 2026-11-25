use super::schema::{
    ensure_column, has_column, SAMPLES_FTS_SCHEMA_AND_TRIGGERS_SQL, SAMPLE_TAGS_FTS_TRIGGERS_SQL,
};
use rusqlite::{params, Connection};

pub(crate) fn run_schema_migrations(conn: &Connection) -> Result<(), String> {
    // Drop premature/legacy FTS triggers if `samples_fts` predates v6 (`genre_meta` missing),
    // so v3..v5 `UPDATE samples` AND `DELETE FROM sample_tags` migrations succeed before v6
    // rebuilds `samples_fts` and triggers.
    if !has_column(conn, "samples_fts", "genre_meta") {
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS trg_samples_ai;
             DROP TRIGGER IF EXISTS trg_samples_ad;
             DROP TRIGGER IF EXISTS trg_samples_au;
             DROP TRIGGER IF EXISTS trg_sample_tags_ai;
             DROP TRIGGER IF EXISTS trg_sample_tags_ad;
             DROP TRIGGER IF EXISTS trg_tags_au;",
        )
        .map_err(|e| format!("Failed preparing pre-v6 FTS triggers: {}", e))?;
    }

    // v3 migration: re-evaluate `is_loop` on non-manual samples
    let user_ver: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("Failed to read schema version before v3 migration: {}", e))?;
    if user_ver < 3 {
        let loop_tag_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM tags WHERE LOWER(name) = 'loop' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();

        let existing_rows: Vec<(i64, String, String, i64, bool)> = {
            let mut stmt = conn
                .prepare("SELECT id, file_path, file_name, duration_ms, is_loop FROM samples WHERE loop_is_manual = 0")
                .map_err(|e| format!("Failed preparing v3 loop migration query: {}", e))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, bool>(4)?,
                    ))
                })
                .map_err(|e| format!("Failed reading rows for v3 loop migration: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed decoding rows for v3 loop migration: {}", e))?
        };

        if !existing_rows.is_empty() {
            conn.execute_batch("BEGIN IMMEDIATE TRANSACTION;")
                .map_err(|e| format!("Failed starting v3 migration transaction: {}", e))?;
            let res: Result<(), String> = (|| {
                let mut upd_stmt = conn
                    .prepare("UPDATE samples SET is_loop = ?1 WHERE id = ?2 AND loop_is_manual = 0")
                    .map_err(|e| e.to_string())?;
                let mut del_loop_tag_stmt = if loop_tag_id.is_some() {
                    Some(
                        conn.prepare(
                            "DELETE FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2 AND is_manual = 0",
                        )
                        .map_err(|e| e.to_string())?,
                    )
                } else {
                    None
                };

                for (sid, fp, fname, dur, old_loop) in existing_rows {
                    let new_loop = crate::scanner::detect_is_loop(&fname, &fp, dur);
                    if new_loop != old_loop {
                        upd_stmt
                            .execute(params![new_loop, sid])
                            .map_err(|e| e.to_string())?;
                        if !new_loop {
                            if let (Some(ref mut del_stmt), Some(ltid)) =
                                (&mut del_loop_tag_stmt, loop_tag_id)
                            {
                                del_stmt
                                    .execute(params![sid, ltid])
                                    .map_err(|e| e.to_string())?;
                            }
                        }
                    }
                }
                Ok(())
            })();
            if let Err(e) = res {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(format!("Failed applying v3 loop migration: {}", e));
            }
            conn.execute_batch("COMMIT;")
                .map_err(|e| format!("Failed committing v3 loop migration: {}", e))?;
        }
        conn.execute_batch("PRAGMA user_version = 3;")
            .map_err(|e| format!("Failed setting user_version = 3: {}", e))?;
    }

    // v4 migration: fast token/folder genre inference on existing samples
    let user_ver_after: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("Failed reading schema version before v4 migration: {}", e))?;
    if user_ver_after < 4 {
        let rows_for_genre: Vec<(i64, String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, file_path, file_name FROM samples WHERE genre = '' AND genre_is_manual = 0")
                .map_err(|e| format!("Failed preparing v4 genre migration query: {}", e))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| format!("Failed querying rows for v4 genre migration: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed decoding rows for v4 genre migration: {}", e))?
        };

        if !rows_for_genre.is_empty() {
            conn.execute_batch("BEGIN IMMEDIATE TRANSACTION;")
                .map_err(|e| format!("Failed starting v4 migration transaction: {}", e))?;
            let res: Result<(), String> = (|| {
                let mut upd_genre_stmt = conn
                    .prepare("UPDATE samples SET genre = ?1 WHERE id = ?2")
                    .map_err(|e| e.to_string())?;
                for (sid, fp, fname) in rows_for_genre {
                    let g = crate::audio::detect_audio_genre(None, &fname, &fp);
                    if !g.is_empty() {
                        upd_genre_stmt
                            .execute(params![g, sid])
                            .map_err(|e| e.to_string())?;
                    }
                }
                Ok(())
            })();
            if let Err(e) = res {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(format!("Failed applying v4 genre migration: {}", e));
            }
            conn.execute_batch("COMMIT;")
                .map_err(|e| format!("Failed committing v4 genre migration: {}", e))?;
        }
        conn.execute_batch("PRAGMA user_version = 4;")
            .map_err(|e| format!("Failed setting user_version = 4: {}", e))?;
    }

    // v5 migration: parallel embedded metadata extraction (Artist, Album, Year, Genre)
    let user_ver_v5: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("Failed reading schema version before v5 migration: {}", e))?;
    if user_ver_v5 < 5 {
        let rows_for_meta: Vec<(i64, String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, file_path, file_name FROM samples")
                .map_err(|e| format!("Failed preparing v5 meta migration query: {}", e))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| format!("Failed querying rows for v5 meta migration: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed decoding rows for v5 meta migration: {}", e))?
        };

        if !rows_for_meta.is_empty() {
            let extracted = crate::audio::extract_embedded_meta_batch(&rows_for_meta);
            conn.execute_batch("BEGIN IMMEDIATE TRANSACTION;")
                .map_err(|e| format!("Failed starting v5 migration transaction: {}", e))?;
            let res: Result<(), String> = (|| {
                let mut upd_stmt = conn
                    .prepare(
                        "UPDATE samples
                         SET artist = CASE WHEN artist = '' THEN ?1 ELSE artist END,
                             album  = CASE WHEN album = '' THEN ?2 ELSE album END,
                             year   = CASE WHEN year = '' THEN ?3 ELSE year END,
                             genre  = CASE WHEN genre = '' AND genre_is_manual = 0 AND ?4 != '' THEN ?4 ELSE genre END
                         WHERE id = ?5",
                    )
                    .map_err(|e| e.to_string())?;
                for (sid, meta) in extracted {
                    upd_stmt
                        .execute(params![
                            meta.artist,
                            meta.album,
                            meta.year,
                            meta.genre,
                            sid
                        ])
                        .map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            if let Err(e) = res {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(format!("Failed applying v5 meta migration: {}", e));
            }
            conn.execute_batch("COMMIT;")
                .map_err(|e| format!("Failed committing v5 meta migration: {}", e))?;
        }
        conn.execute_batch("PRAGMA user_version = 5;")
            .map_err(|e| format!("Failed setting user_version = 5: {}", e))?;
    }

    // v6 migration: `tags.is_manual` + `genres.is_manual` + upgraded 4-column `samples_fts`
    // (indexing `genre`/`artist`/`album` and Turkish `ı`/`İ` folded text)
    let current_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if current_version < 6 || !has_column(conn, "samples_fts", "genre_meta") {
        ensure_column(conn, "tags", "is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
        ensure_column(conn, "genres", "is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;

        let _ = conn.execute(
            "UPDATE tags SET is_manual = 1 WHERE id IN (SELECT DISTINCT tag_id FROM sample_tags WHERE is_manual = 1)",
            [],
        );
        let _ = conn.execute(
            "UPDATE genres SET is_manual = 1 WHERE LOWER(name) IN (SELECT DISTINCT LOWER(genre) FROM samples WHERE genre_is_manual = 1 AND genre != '')",
            [],
        );

        conn.execute_batch(
            "
            BEGIN IMMEDIATE TRANSACTION;
            DROP TRIGGER IF EXISTS trg_samples_ai;
            DROP TRIGGER IF EXISTS trg_samples_ad;
            DROP TRIGGER IF EXISTS trg_samples_au;
            DROP TRIGGER IF EXISTS trg_sample_tags_ai;
            DROP TRIGGER IF EXISTS trg_sample_tags_ad;
            DROP TRIGGER IF EXISTS trg_tags_au;
            DROP TABLE IF EXISTS samples_fts;
            ",
        )
        .map_err(|e| format!("Failed to prepare v6 FTS migration: {}", e))?;

        if let Err(e) = conn.execute_batch(SAMPLES_FTS_SCHEMA_AND_TRIGGERS_SQL) {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(format!("Failed to recreate v6 FTS schema: {}", e));
        }
        if let Err(e) = conn.execute_batch(SAMPLE_TAGS_FTS_TRIGGERS_SQL) {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(format!("Failed to recreate v6 FTS triggers: {}", e));
        }

        if let Err(e) = conn.execute_batch(
            "
            INSERT INTO samples_fts(rowid, file_name, file_path, tags_text, genre_meta)
            SELECT
                s.id,
                s.file_name,
                s.file_path,
                COALESCE((
                    SELECT GROUP_CONCAT(t.name, ' ') || ' ' || REPLACE(REPLACE(GROUP_CONCAT(t.name, ' '), 'ı', 'i'), 'İ', 'i')
                    FROM sample_tags st
                    INNER JOIN tags t ON t.id = st.tag_id
                    WHERE st.sample_id = s.id
                ), ''),
                COALESCE(s.genre, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, '') || ' ' ||
                REPLACE(REPLACE(s.file_name, 'ı', 'i'), 'İ', 'i') || ' ' ||
                REPLACE(REPLACE(s.file_path, 'ı', 'i'), 'İ', 'i')
            FROM samples s;
            COMMIT;
            PRAGMA user_version = 6;
            ",
        ) {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(format!("Failed to populate v6 FTS index: {}", e));
        }
    }

    // v7 migration: lightweight zero-IO filename BPM & Musical Key / Camelot backfill
    let ver_v7: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("Failed reading schema version before v7 migration: {}", e))?;
    if ver_v7 < 7 {
        let existing_names: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, file_name FROM samples WHERE bpm IS NULL AND musical_key = ''")
                .map_err(|e| format!("Failed preparing v7 BPM/Key migration query: {}", e))?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| format!("Failed querying rows for v7 BPM/Key migration: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed decoding rows for v7 BPM/Key migration: {}", e))?
        };

        if !existing_names.is_empty() {
            conn.execute_batch("BEGIN IMMEDIATE TRANSACTION;")
                .map_err(|e| format!("Failed starting v7 migration transaction: {}", e))?;
            let res: Result<(), String> = (|| {
                let mut upd = conn
                    .prepare(
                        "UPDATE samples
                         SET bpm = COALESCE(bpm, ?1),
                             musical_key = CASE WHEN musical_key = '' THEN ?2 ELSE musical_key END,
                             camelot_key = CASE WHEN camelot_key = '' THEN ?3 ELSE camelot_key END
                         WHERE id = ?4",
                    )
                    .map_err(|e| e.to_string())?;
                for (sid, fname) in existing_names {
                    let fast = crate::dsp_analysis::extract_fast_bpm_and_key(None, &fname);
                    if fast.bpm.is_some() || !fast.musical_key.is_empty() {
                        upd.execute(params![
                            fast.bpm,
                            fast.musical_key,
                            fast.camelot_key,
                            sid
                        ])
                        .map_err(|e| e.to_string())?;
                    }
                }
                Ok(())
            })();
            if let Err(e) = res {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(format!("Failed applying v7 BPM/Key migration: {}", e));
            }
            conn.execute_batch("COMMIT;")
                .map_err(|e| format!("Failed committing v7 BPM/Key migration: {}", e))?;
        }
        conn.execute_batch("PRAGMA user_version = 7;")
            .map_err(|e| format!("Failed setting user_version = 7: {}", e))?;
    }

    // v8 migration: Phase E Advanced File Ops (Quarantine Trash, Read-Only Vaults, Rename Journal)
    let ver_v8: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("Failed reading schema version before v8 migration: {}", e))?;
    if ver_v8 < 8 {
        conn.execute_batch("PRAGMA user_version = 8;")
            .map_err(|e| format!("Failed setting user_version = 8: {}", e))?;
    }

    // v9 migration: Phase D Local AI Embeddings & Tag Suggestions
    let ver_v9: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("Failed reading schema version before v9 migration: {}", e))?;
    if ver_v9 < 9 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sample_embeddings (
                sample_id INTEGER PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
                model_id TEXT NOT NULL,
                dim INTEGER NOT NULL DEFAULT 128,
                vector BLOB NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ai_tag_suggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
                tag_name TEXT NOT NULL,
                confidence REAL NOT NULL,
                model_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(sample_id, tag_name)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_embeddings_model ON sample_embeddings(model_id);
            CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status ON ai_tag_suggestions(status, sample_id);
            PRAGMA user_version = 9;",
        )
        .map_err(|e| format!("Failed applying v9 Local AI schema migration: {}", e))?;
    }

    // v10 migration: Distinguish user hand-authored tags ('manual') from bulk-approved AI
    // suggestions ('ai_approved') in `sample_tags.source` so portable profile exports stay compact.
    let ver_v10: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v10 < 10 || !has_column(conn, "sample_tags", "source") {
        ensure_column(conn, "sample_tags", "source", "TEXT NOT NULL DEFAULT 'auto'")?;
        conn.execute_batch(
            "BEGIN IMMEDIATE TRANSACTION;
            UPDATE sample_tags
            SET source = 'manual'
            WHERE is_manual = 1 AND COALESCE(source, 'auto') = 'auto';

            UPDATE sample_tags
            SET source = 'ai_approved'
            WHERE is_manual = 1
              AND EXISTS (
                  SELECT 1
                  FROM ai_tag_suggestions a
                  INNER JOIN tags t ON t.id = sample_tags.tag_id
                  WHERE a.sample_id = sample_tags.sample_id
                    AND LOWER(a.tag_name) = LOWER(t.name)
                    AND a.status = 'approved'
              );
            COMMIT;
            PRAGMA user_version = 10;",
        )
        .map_err(|e| format!("Failed to apply v10 tag provenance migration: {}", e))?;
    }

    let ver_v11: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v11 < 11 {
        let backfill_sql = if has_column(conn, "samples", "is_favorite") {
            "INSERT OR IGNORE INTO profile_favorites (profile_id, sample_id)
            SELECT
                (SELECT id FROM profiles ORDER BY id ASC LIMIT 1),
                id
            FROM samples
            WHERE COALESCE(is_favorite, 0) = 1
              AND EXISTS (SELECT 1 FROM profiles);"
        } else {
            ""
        };
        let migration_sql = format!(
            "BEGIN IMMEDIATE TRANSACTION;
            CREATE TABLE IF NOT EXISTS profile_favorites (
                profile_id INTEGER NOT NULL,
                sample_id INTEGER NOT NULL,
                PRIMARY KEY (profile_id, sample_id),
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_profile_favorites_profile_id ON profile_favorites(profile_id);
            CREATE INDEX IF NOT EXISTS idx_profile_favorites_sample_id ON profile_favorites(sample_id);
            {}
            COMMIT;
            PRAGMA user_version = 11;",
            backfill_sql
        );
        conn.execute_batch(&migration_sql)
            .map_err(|e| format!("Failed to apply v11 per-profile favorites migration: {}", e))?;
    }

    let ver_v12: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v12 < 12 {
        if !has_column(conn, "samples", "file_modified_at") {
            conn.execute_batch(
                "ALTER TABLE samples ADD COLUMN file_modified_at INTEGER DEFAULT NULL;",
            )
            .map_err(|e| format!("Failed to add samples.file_modified_at in v12: {}", e))?;
        }
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_samples_file_modified_at ON samples(file_modified_at);
            CREATE INDEX IF NOT EXISTS idx_samples_created_at ON samples(created_at);
            PRAGMA user_version = 12;
            ",
        )
        .map_err(|e| format!("Failed to apply v12 file_modified_at migration: {}", e))?;
    }

    let ver_v13: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v13 < 13 {
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_collection_items_sample_id ON collection_items(sample_id);
            CREATE INDEX IF NOT EXISTS idx_profile_libraries_library_id ON profile_libraries(library_id);
            CREATE INDEX IF NOT EXISTS idx_ai_suggestions_sample_id ON ai_tag_suggestions(sample_id);
            CREATE INDEX IF NOT EXISTS idx_samples_file_path_lower ON samples(LOWER(file_path));
            CREATE INDEX IF NOT EXISTS idx_samples_original_path_lower ON samples(LOWER(original_file_path));
            CREATE INDEX IF NOT EXISTS idx_libraries_path_lower ON libraries(LOWER(path));
            PRAGMA user_version = 13;
            ",
        )
        .map_err(|e| format!("Failed to apply v13 hot-path index migration: {}", e))?;
    }

    let ver_v14: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v14 < 14 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sample_hashes (
                sample_id INTEGER PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
                file_size INTEGER NOT NULL,
                file_mtime INTEGER DEFAULT NULL,
                partial_hash BLOB DEFAULT NULL,
                full_hash BLOB DEFAULT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            PRAGMA user_version = 14;
            ",
        )
        .map_err(|e| format!("Failed to apply v14 sample_hashes cache migration: {}", e))?;
    }

    let ver_v15: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v15 < 15 {
        conn.execute_batch(
            "
            DROP INDEX IF EXISTS idx_samples_is_favorite;
            DROP INDEX IF EXISTS idx_samples_fav_filename;
            DROP INDEX IF EXISTS idx_samples_is_trashed;
            DROP INDEX IF EXISTS idx_sample_tags_sample_id;
            DROP INDEX IF EXISTS idx_sample_tags_tag_id;
            DROP INDEX IF EXISTS idx_collection_items_collection_id;
            DROP INDEX IF EXISTS idx_profile_libraries_profile_id;
            DROP INDEX IF EXISTS idx_profile_favorites_profile_id;
            PRAGMA user_version = 15;
            ",
        )
        .map_err(|e| format!("Failed to apply v15 dead/redundant index cleanup migration: {}", e))?;
    }

    let ver_v16: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v16 < 16 {
        // Drop redundant 50k indexes:
        // - `idx_samples_file_path_nocase` is unused (all lookups use `LOWER(file_path)` -> `idx_samples_file_path_lower`)
        // - `idx_samples_library_id` is a strict prefix of `idx_samples_lib_filename(library_id, file_name COLLATE NOCASE)`
        conn.execute_batch(
            "
            DROP INDEX IF EXISTS idx_samples_file_path_nocase;
            DROP INDEX IF EXISTS idx_samples_library_id;
            PRAGMA user_version = 16;
            ",
        )
        .map_err(|e| format!("Failed to apply v16 redundant sample index cleanup migration: {}", e))?;
    }

    let ver_v17: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v17 < 17 {
        super::migration_v17::run_v17_taxonomy_migration(conn)?;
    }

    let ver_v18: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v18 < 18 {
        ensure_column(conn, "tag_facets", "domain", "TEXT NOT NULL DEFAULT 'tags'")?;
        ensure_column(
            conn,
            "tag_facets",
            "allow_nesting",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute_batch(
            "
            BEGIN IMMEDIATE TRANSACTION;
            UPDATE tag_facets SET domain = 'tags',   allow_nesting = 1 WHERE slug = 'category';
            UPDATE tag_facets SET domain = 'genres', allow_nesting = 1 WHERE slug = 'genre';
            UPDATE tag_facets SET domain = 'genres', allow_nesting = 0 WHERE slug = 'mood';
            UPDATE tag_facets SET domain = 'tags',   allow_nesting = 0 WHERE slug = 'source';
            COMMIT;
            PRAGMA user_version = 18;
            ",
        )
        .map_err(|e| format!("Failed to apply v18 custom facets migration: {}", e))?;
    }

    let ver_v19: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if ver_v19 < 19 {
        super::migration_v19::run_v19_genre_recovery_migration(conn)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::schema::{has_column, init_schema_on_conn};
    use super::run_schema_migrations;
    use rusqlite::Connection;

    #[test]
    fn migrates_minimal_v1_schema_to_v8_with_fts_and_bpm_key_backfill() {
        let conn = Connection::open_in_memory().expect("open in-memory db");

        // Construct minimal v1 database before Phase B-E columns and 4-column FTS existed.
        conn.execute_batch(
            "
            CREATE TABLE libraries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                last_scanned_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                library_id INTEGER NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                sample_rate INTEGER NOT NULL DEFAULT 44100,
                channels INTEGER NOT NULL DEFAULT 2,
                bit_depth INTEGER NOT NULL DEFAULT 16,
                file_size INTEGER NOT NULL DEFAULT 0,
                is_favorite BOOLEAN NOT NULL DEFAULT 0,
                is_loop BOOLEAN NOT NULL DEFAULT 0,
                peaks_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#f59e0b'
            );
            CREATE TABLE genres (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#8B5CF6'
            );
            CREATE TABLE sample_tags (
                sample_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                is_manual BOOLEAN NOT NULL DEFAULT 0,
                PRIMARY KEY (sample_id, tag_id)
            );
            CREATE TABLE collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE collection_items (
                collection_id INTEGER NOT NULL,
                sample_id INTEGER NOT NULL,
                PRIMARY KEY (collection_id, sample_id)
            );
            CREATE VIRTUAL TABLE samples_fts USING fts5(file_name, file_path);

            INSERT INTO libraries (id, path, name) VALUES (1, 'C:/SFX', 'Main');
            INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, is_favorite, is_loop)
            VALUES
                (1, 1, 'C:/SFX/Loops/Trap_140BPM_Am_Loop.wav', 'Trap_140BPM_Am_Loop.wav', 'wav', 4000, 1, 0),
                (2, 1, 'C:/SFX/Vocals/kısık_ses.wav', 'kısık_ses.wav', 'wav', 500, 0, 0);
            INSERT INTO tags (id, name) VALUES (10, 'Kısık'), (11, 'AutoOnly');
            INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (2, 10, 1), (1, 11, 0);
            PRAGMA user_version = 1;
            ",
        )
        .expect("seed v1 db");

        init_schema_on_conn(&conn).expect("migrate v1 schema to v19");

        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .expect("read user_version");
        assert_eq!(user_version, 19);

        let migrated_fav_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM profile_favorites WHERE sample_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(migrated_fav_count, 1);

        let emb_table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sample_embeddings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(emb_table_exists, 1);

        let sug_table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_tag_suggestions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sug_table_exists, 1);

        // Verify newly ensured columns and 4-column FTS rebuild
        assert!(has_column(&conn, "samples", "bpm"));
        assert!(has_column(&conn, "samples", "musical_key"));
        assert!(has_column(&conn, "samples", "camelot_key"));
        assert!(has_column(&conn, "samples", "is_trashed"));
        assert!(has_column(&conn, "tags", "is_manual"));
        assert!(has_column(&conn, "sample_tags", "source"));
        assert!(has_column(&conn, "genres", "is_manual"));
        assert!(has_column(&conn, "samples_fts", "genre_meta"));

        // Verify v3 loop backfill and v7 filename BPM/Key/Camelot backfill
        let (is_loop, bpm, mkey, ckey): (bool, Option<f64>, String, String) = conn
            .query_row(
                "SELECT is_loop, bpm, musical_key, camelot_key FROM samples WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("query migrated sample 1");
        assert!(is_loop);
        assert_eq!(bpm, Some(140.0));
        assert_eq!(mkey, "Am");
        assert_eq!(ckey, "8A");

        // Verify v6 propagated manual status on tags
        let manual_flag: bool = conn
            .query_row("SELECT is_manual FROM tags WHERE id = 10", [], |r| r.get(0))
            .expect("query manual tag");
        let auto_flag: bool = conn
            .query_row("SELECT is_manual FROM tags WHERE id = 11", [], |r| r.get(0))
            .expect("query auto tag");
        assert!(manual_flag);
        assert!(!auto_flag);

        // Verify v6 FTS index contains Turkish dotless-i folded text
        let fts_match_id: i64 = conn
            .query_row(
                "SELECT rowid FROM samples_fts WHERE samples_fts MATCH 'kisik*'",
                [],
                |r| r.get(0),
            )
            .expect("FTS match on Turkish folded token");
        assert_eq!(fts_match_id, 2);
    }

    #[test]
    fn v11_migration_keeps_legacy_favorites_on_primary_profile_when_newer_profile_is_active() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#F59E0B',
                settings_json TEXT NOT NULL DEFAULT '{}',
                is_active BOOLEAN NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE libraries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
                is_global BOOLEAN NOT NULL DEFAULT 1
            );
            CREATE TABLE samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                library_id INTEGER NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                sample_rate INTEGER NOT NULL DEFAULT 44100,
                channels INTEGER NOT NULL DEFAULT 2,
                bit_depth INTEGER NOT NULL DEFAULT 16,
                file_size INTEGER NOT NULL DEFAULT 0,
                peaks_json TEXT NOT NULL DEFAULT '[]',
                is_favorite BOOLEAN NOT NULL DEFAULT 0,
                is_loop BOOLEAN NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO profiles (id, name, is_active) VALUES
                (6, 'Studio', 0),
                (8, 'Imported Profile', 1);
            INSERT INTO libraries (id, path, name) VALUES (1, 'F:/Audio', 'Audio');
            INSERT INTO samples (id, library_id, file_path, file_name, extension, is_favorite)
            VALUES
                (10, 1, 'F:/Audio/fav.wav', 'fav.wav', 'wav', 1),
                (11, 1, 'F:/Audio/plain.wav', 'plain.wav', 'wav', 0);
            PRAGMA user_version = 10;
            ",
        )
        .expect("seed v10 multi-profile db");

        init_schema_on_conn(&conn).expect("migrate v10 -> v11");

        let primary_favs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM profile_favorites WHERE profile_id = 6 AND sample_id = 10",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let active_imported_favs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM profile_favorites WHERE profile_id = 8",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(primary_favs, 1);
        assert_eq!(active_imported_favs, 0);
    }

    #[test]
    fn init_schema_v11_to_v12_adds_file_modified_at_column() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE libraries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL
            );
            CREATE TABLE samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                library_id INTEGER NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                sample_rate INTEGER NOT NULL DEFAULT 44100,
                channels INTEGER NOT NULL DEFAULT 2,
                bit_depth INTEGER NOT NULL DEFAULT 16,
                file_size INTEGER NOT NULL DEFAULT 0,
                peaks_json TEXT NOT NULL DEFAULT '[]',
                is_favorite BOOLEAN NOT NULL DEFAULT 0,
                is_loop BOOLEAN NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            PRAGMA user_version = 11;
            ",
        )
        .expect("seed v11 db");

        init_schema_on_conn(&conn).expect("migrate v11 -> v12");

        assert!(has_column(&conn, "samples", "file_modified_at"));
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert!(version >= 13);
    }

    #[test]
    fn init_schema_v12_to_v13_creates_hot_path_indexes() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init schema");
        conn.execute_batch(
            "
            DROP INDEX IF EXISTS idx_collection_items_sample_id;
            DROP INDEX IF EXISTS idx_profile_libraries_library_id;
            DROP INDEX IF EXISTS idx_ai_suggestions_sample_id;
            DROP INDEX IF EXISTS idx_samples_file_path_lower;
            DROP INDEX IF EXISTS idx_samples_original_path_lower;
            DROP INDEX IF EXISTS idx_libraries_path_lower;
            PRAGMA user_version = 12;
            ",
        )
        .expect("downgrade to v12 state");

        run_schema_migrations(&conn).expect("migrate v12 -> v19");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 19);

        for dropped in ["idx_samples_file_path_nocase", "idx_samples_library_id"] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    [dropped],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 0, "redundant index {} should be dropped", dropped);
        }

        for idx_name in [
            "idx_collection_items_sample_id",
            "idx_profile_libraries_library_id",
            "idx_ai_suggestions_sample_id",
            "idx_samples_file_path_lower",
            "idx_samples_original_path_lower",
            "idx_libraries_path_lower",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    [idx_name],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "missing index {}", idx_name);
        }

        let hashes_table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sample_hashes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hashes_table_exists, 1);
    }

    #[test]
    fn migrates_v16_to_v17_preserving_manual_tags_cleaning_noise_and_enabling_fts_ancestors() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        // Seed a realistic v16 schema state with legacy flat tags, noisy auto/AI tags, and genres
        init_schema_on_conn(&conn).expect("init baseline schema");
        conn.execute_batch(
            "
            INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/Audio', 'Audio', 1);
            INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, genre, genre_is_manual, is_loop)
            VALUES
              (1, 1, 'C:/Audio/dog_bark.wav', 'dog_bark.wav', 'wav', 600, 'Sountrack', 1, 0),
              (2, 1, 'C:/Audio/whisper.wav', 'whisper.wav', 'wav', 900, 'Dark', 0, 0),
              (3, 1, 'C:/Audio/pika_cry.wav', 'pika_cry.wav', 'wav', 400, 'Ambient', 1, 1),
              (4, 1, 'C:/Audio/synth_pad.wav', 'synth_pad.wav', 'wav', 3000, '', 0, 0);

            INSERT INTO genres (name, color) VALUES
              ('Ambient', '#3B82F6'),
              ('Dark', '#F59E0B'),
              ('Sountrack', '#22C55E');

            INSERT INTO tags (id, name, color, is_manual) VALUES
              (101, 'MyCustomTag', '#112233', 1),
              (102, 'Voice', '#7C3AED', 1),
              (103, 'Vocal', '#8B5CF6', 0),
              (104, 'Animals', '#84CC16', 0),
              (105, 'Dog', '#84CC16', 0),
              (106, 'Pokemon', '#EAB308', 0),
              (107, 'Loop', '#EAB308', 0),
              (108, 'Combat', '#EF4444', 0);

            INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES
              (1, 101, 1, 'manual'),
              (1, 104, 1, 'manual'),
              (1, 105, 0, 'auto_rule'),
              (2, 102, 1, 'manual'),
              (3, 106, 0, 'auto_rule'),
              (3, 107, 0, 'auto_rule'),
              (4, 104, 0, 'ai_auto'),
              (4, 108, 0, 'auto_rule');

            PRAGMA user_version = 16;
            ",
        )
        .expect("seed v16 data");

        run_schema_migrations(&conn).expect("migrate v16 -> v19");

        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 19);

        // Manual custom tag preserved intact
        let custom_kept: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = 1 AND t.name = 'MyCustomTag' AND st.source = 'manual'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(custom_kept, 1);

        // Voice merged into Vocal with 'Voice' alias & manual link preserved on sample 2
        let voice_gone: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags WHERE LOWER(name) = 'voice'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(voice_gone, 0);
        let vocal_aliases: String = conn
            .query_row("SELECT aliases_json FROM tags WHERE name = 'Vocal'", [], |r| r.get(0))
            .unwrap();
        assert!(vocal_aliases.contains("Voice"));
        let vocal_link: String = conn
            .query_row(
                "SELECT st.source FROM sample_tags st JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = 2 AND t.name = 'Vocal'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(vocal_link, "manual");

        // Sountrack typo normalized to Soundtrack (Genre facet=2) with manual provenance
        let s1_genre: String = conn
            .query_row("SELECT genre FROM samples WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(s1_genre, "Soundtrack");
        let dark_facet: i64 = conn
            .query_row("SELECT facet_id FROM tags WHERE name = 'Dark'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(dark_facet, 3, "Dark should be in mood facet");

        // Pokemon moved to source facet (4)
        let poke_facet: i64 = conn
            .query_row("SELECT facet_id FROM tags WHERE name = 'Pokemon'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(poke_facet, 4);

        // Auto Loop link retired
        let loop_links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st JOIN tags t ON t.id = st.tag_id WHERE LOWER(t.name) = 'loop'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(loop_links, 0);

        // Animals ai_auto on synth_pad (sample 4) cleaned, manual Animals on sample 1 preserved
        let ai_animals: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = 4 AND t.name = 'Animals'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ai_animals, 0);
        let manual_animals: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = 1 AND t.name = 'Animals' AND st.source = 'manual'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(manual_animals, 1);

        // Dog placed under Animals parent with valid materialized path
        let (animals_id, dog_parent, dog_path): (i64, Option<i64>, String) = conn
            .query_row(
                "SELECT a.id, d.parent_id, d.path FROM tags a JOIN tags d ON d.name = 'Dog' WHERE a.name = 'Animals'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(dog_parent, Some(animals_id));
        assert!(dog_path.starts_with(&format!("/{}/", animals_id)));

        // FTS5 ancestor + alias indexing: searching 'animals' matches Dog, searching 'voice' matches Vocal
        let fts_voice: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM samples_fts WHERE rowid = 2 AND samples_fts MATCH 'voice'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_voice, 1, "FTS5 alias search 'voice' must match Vocal sample");
        let fts_animals: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM samples_fts WHERE rowid = 1 AND samples_fts MATCH 'animals'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_animals, 1, "FTS5 ancestor search 'animals' must match Dog sample");
    }

    #[test]
    fn migrates_v17_to_v18_backfilling_facet_domains_and_nesting_flags() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init baseline schema");
        conn.execute_batch(
            "
            UPDATE tag_facets SET domain = 'tags', allow_nesting = 0;
            PRAGMA user_version = 17;
            ",
        )
        .expect("simulate v17 state");

        run_schema_migrations(&conn).expect("migrate v17 -> v19");

        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 19);

        let check = |slug: &str| -> (String, i64) {
            conn.query_row(
                "SELECT domain, allow_nesting FROM tag_facets WHERE slug = ?1",
                [slug],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(check("category"), ("tags".to_string(), 1));
        assert_eq!(check("source"), ("tags".to_string(), 0));
        assert_eq!(check("genre"), ("genres".to_string(), 1));
        assert_eq!(check("mood"), ("genres".to_string(), 0));
    }

    #[test]
    fn migrates_v18_to_v19_recovering_orphaned_sample_genres_and_upgrading_sources() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init baseline schema");
        conn.execute_batch(
            "
            INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/Music', 'Music', 1);
            INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, genre, genre_is_manual)
            VALUES
              (1, 1, 'C:/Music/track_a.mp3', 'track_a.mp3', 'mp3', 30000, 'Acoustic', 0),
              (2, 1, 'C:/Music/track_b.mp3', 'track_b.mp3', 'mp3', 30000, 'Synthwave', 0);

            INSERT INTO tags (id, name, color, is_manual, facet_id, path)
            VALUES (300, 'Synthwave', '#8B5CF6', 0, 2, '/300/');

            INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
            VALUES (2, 300, 0, 'auto');

            PRAGMA user_version = 18;
            ",
        )
        .expect("seed v18 orphaned genre state");

        run_schema_migrations(&conn).expect("migrate v18 -> v19");

        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 19);

        // Orphaned sample 1 ('Acoustic') recovered into Genre facet with source='auto_genre'
        let (acoustic_facet, acoustic_source): (i64, String) = conn
            .query_row(
                "SELECT t.facet_id, st.source
                 FROM sample_tags st
                 INNER JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = 1 AND t.name = 'Acoustic'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("recovered Acoustic genre tag link");
        assert_eq!(acoustic_facet, 2);
        assert_eq!(acoustic_source, "auto_genre");

        // Existing sample 2 ('Synthwave') legacy source='auto' upgraded to 'auto_genre'
        let synth_source: String = conn
            .query_row(
                "SELECT source FROM sample_tags WHERE sample_id = 2 AND tag_id = 300",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(synth_source, "auto_genre");
    }
}
