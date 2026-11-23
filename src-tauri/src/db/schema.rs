use super::default_rules::deterministic_color_for_name;
use super::migrations::run_schema_migrations;
use rusqlite::{params, Connection};
use std::time::Duration;

pub const SAMPLE_TAGS_FTS_TRIGGERS_SQL: &str = "
    CREATE TRIGGER IF NOT EXISTS trg_sample_tags_ai AFTER INSERT ON sample_tags BEGIN
        UPDATE samples_fts
        SET tags_text = COALESCE((
            SELECT GROUP_CONCAT(t.name, ' ') || ' ' || REPLACE(REPLACE(GROUP_CONCAT(t.name, ' '), 'ı', 'i'), 'İ', 'i')
            FROM sample_tags st
            INNER JOIN tags t ON t.id = st.tag_id
            WHERE st.sample_id = new.sample_id
        ), '')
        WHERE rowid = new.sample_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_sample_tags_ad AFTER DELETE ON sample_tags BEGIN
        UPDATE samples_fts
        SET tags_text = COALESCE((
            SELECT GROUP_CONCAT(t.name, ' ') || ' ' || REPLACE(REPLACE(GROUP_CONCAT(t.name, ' '), 'ı', 'i'), 'İ', 'i')
            FROM sample_tags st
            INNER JOIN tags t ON t.id = st.tag_id
            WHERE st.sample_id = old.sample_id
        ), '')
        WHERE rowid = old.sample_id;
    END;
";

pub(crate) const SAMPLES_FTS_SCHEMA_AND_TRIGGERS_SQL: &str = "
    CREATE VIRTUAL TABLE IF NOT EXISTS samples_fts USING fts5(
        file_name,
        file_path,
        tags_text,
        genre_meta,
        tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS trg_samples_ai AFTER INSERT ON samples BEGIN
        INSERT INTO samples_fts(rowid, file_name, file_path, tags_text, genre_meta)
        VALUES (
            new.id,
            new.file_name,
            new.file_path,
            '',
            COALESCE(new.genre, '') || ' ' || COALESCE(new.artist, '') || ' ' || COALESCE(new.album, '') || ' ' ||
            REPLACE(REPLACE(new.file_name, 'ı', 'i'), 'İ', 'i') || ' ' ||
            REPLACE(REPLACE(new.file_path, 'ı', 'i'), 'İ', 'i')
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_samples_ad AFTER DELETE ON samples BEGIN
        DELETE FROM samples_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_samples_au AFTER UPDATE OF file_name, file_path, genre, artist, album ON samples BEGIN
        UPDATE samples_fts
        SET file_name = new.file_name,
            file_path = new.file_path,
            genre_meta = COALESCE(new.genre, '') || ' ' || COALESCE(new.artist, '') || ' ' || COALESCE(new.album, '') || ' ' ||
                         REPLACE(REPLACE(new.file_name, 'ı', 'i'), 'İ', 'i') || ' ' ||
                         REPLACE(REPLACE(new.file_path, 'ı', 'i'), 'İ', 'i')
        WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_tags_au AFTER UPDATE OF name ON tags BEGIN
        UPDATE samples_fts
        SET tags_text = COALESCE((
            SELECT GROUP_CONCAT(t.name, ' ') || ' ' || REPLACE(REPLACE(GROUP_CONCAT(t.name, ' '), 'ı', 'i'), 'İ', 'i')
            FROM sample_tags st
            INNER JOIN tags t ON t.id = st.tag_id
            WHERE st.sample_id = samples_fts.rowid
        ), '')
        WHERE rowid IN (SELECT sample_id FROM sample_tags WHERE tag_id = new.id);
    END;
";

pub(crate) fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    let sql = format!("PRAGMA table_info({})", table);
    if let Ok(mut stmt) = conn.prepare(&sql) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
            for col in rows.flatten() {
                if col.eq_ignore_ascii_case(column) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    if !has_column(conn, table, column) {
        let sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition);
        conn.execute(&sql, [])
            .map_err(|e| format!("Failed to add column {}.{}: {}", table, column, e))?;
    }
    Ok(())
}

pub fn init_schema_on_conn(conn: &Connection) -> Result<(), String> {
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set SQLite busy_timeout: {}", e))?;

    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA journal_size_limit = 33554432;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 67108864;
        PRAGMA cache_size = -12000;
        PRAGMA foreign_keys = OFF;

        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#F59E0B',
            settings_json TEXT NOT NULL DEFAULT '{}',
            is_active BOOLEAN NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS libraries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_global BOOLEAN NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS profile_libraries (
            profile_id INTEGER NOT NULL,
            library_id INTEGER NOT NULL,
            PRIMARY KEY (profile_id, library_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
            FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS samples (
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
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            file_modified_at INTEGER DEFAULT NULL,
            FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#f59e0b',
            is_manual BOOLEAN NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS genres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#8B5CF6',
            is_manual BOOLEAN NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sample_tags (
            sample_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            is_manual BOOLEAN NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'auto',
            PRIMARY KEY (sample_id, tag_id),
            FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL DEFAULT 1,
            parent_id INTEGER DEFAULT NULL,
            rule_path TEXT DEFAULT NULL,
            smart_query TEXT DEFAULT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#10B981',
            icon TEXT NOT NULL DEFAULT 'layers',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES collections(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS collection_items (
            collection_id INTEGER NOT NULL,
            sample_id INTEGER NOT NULL,
            PRIMARY KEY (collection_id, sample_id),
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS profile_favorites (
            profile_id INTEGER NOT NULL,
            sample_id INTEGER NOT NULL,
            PRIMARY KEY (profile_id, sample_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
            FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS file_ops_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sample_id INTEGER NOT NULL,
            op_type TEXT NOT NULL,
            old_path TEXT NOT NULL,
            new_path TEXT NOT NULL,
            old_name TEXT NOT NULL,
            new_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sample_embeddings (
            sample_id INTEGER PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
            model_id TEXT NOT NULL,
            dim INTEGER NOT NULL DEFAULT 128,
            vector BLOB NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sample_hashes (
            sample_id INTEGER PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
            file_size INTEGER NOT NULL,
            file_mtime INTEGER DEFAULT NULL,
            partial_hash BLOB DEFAULT NULL,
            full_hash BLOB DEFAULT NULL,
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

        CREATE TABLE IF NOT EXISTS sample_slices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL,
            slice_path TEXT NOT NULL,
            slice_name TEXT NOT NULL,
            source_sample_id INTEGER DEFAULT NULL,
            source_file_path TEXT NOT NULL,
            source_file_name TEXT NOT NULL,
            start_sec REAL NOT NULL,
            end_sec REAL NOT NULL,
            pitch_semitones REAL NOT NULL DEFAULT 0.0,
            micro_fade BOOLEAN NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            is_favorite BOOLEAN NOT NULL DEFAULT 0,
            peaks_json TEXT NOT NULL DEFAULT '[]',
            sample_rate INTEGER NOT NULL DEFAULT 48000,
            channels INTEGER NOT NULL DEFAULT 2,
            bit_depth INTEGER NOT NULL DEFAULT 16,
            is_trashed BOOLEAN NOT NULL DEFAULT 0,
            trash_file_path TEXT DEFAULT NULL,
            trashed_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, slice_path)
        );
        ",
    )
    .map_err(|e| format!("Failed to initialize database schema: {}", e))?;

    ensure_column(conn, "sample_tags", "is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "sample_tags", "source", "TEXT NOT NULL DEFAULT 'auto'")?;
    ensure_column(conn, "tags", "is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "genres", "is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "libraries", "is_global", "BOOLEAN NOT NULL DEFAULT 1")?;
    ensure_column(conn, "libraries", "is_read_only", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "collections", "color", "TEXT NOT NULL DEFAULT '#10B981'")?;
    ensure_column(conn, "collections", "icon", "TEXT NOT NULL DEFAULT 'layers'")?;
    ensure_column(conn, "collections", "parent_id", "INTEGER DEFAULT NULL")?;
    ensure_column(conn, "collections", "rule_path", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "collections", "smart_query", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "samples", "genre", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "samples", "genre_is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "samples", "artist", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "samples", "album", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "samples", "year", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "samples", "loop_is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "samples", "bpm", "REAL DEFAULT NULL")?;
    ensure_column(conn, "samples", "musical_key", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "samples", "camelot_key", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "samples", "bpm_is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "samples", "key_is_manual", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "samples", "is_trashed", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "samples", "trashed_at", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "samples", "original_file_path", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "samples", "trash_file_path", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "samples", "previous_file_name", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "samples", "file_modified_at", "INTEGER DEFAULT NULL")?;
    ensure_column(conn, "sample_slices", "is_favorite", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "sample_slices", "peaks_json", "TEXT NOT NULL DEFAULT '[]'")?;
    ensure_column(conn, "sample_slices", "sample_rate", "INTEGER NOT NULL DEFAULT 48000")?;
    ensure_column(conn, "sample_slices", "channels", "INTEGER NOT NULL DEFAULT 2")?;
    ensure_column(conn, "sample_slices", "bit_depth", "INTEGER NOT NULL DEFAULT 16")?;
    ensure_column(conn, "sample_slices", "is_trashed", "BOOLEAN NOT NULL DEFAULT 0")?;
    ensure_column(conn, "sample_slices", "trash_file_path", "TEXT DEFAULT NULL")?;
    ensure_column(conn, "sample_slices", "trashed_at", "TEXT DEFAULT NULL")?;

    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE INDEX IF NOT EXISTS idx_samples_library_id ON samples(library_id);
        CREATE INDEX IF NOT EXISTS idx_samples_is_loop ON samples(is_loop);
        CREATE INDEX IF NOT EXISTS idx_samples_trashed_lib ON samples(is_trashed, library_id);
        CREATE INDEX IF NOT EXISTS idx_samples_file_path_nocase ON samples(file_path COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_samples_genre ON samples(genre COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_samples_bpm ON samples(bpm);
        CREATE INDEX IF NOT EXISTS idx_samples_camelot ON samples(camelot_key COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_samples_file_name ON samples(file_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_samples_lib_filename ON samples(library_id, file_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_samples_file_modified_at ON samples(file_modified_at);
        CREATE INDEX IF NOT EXISTS idx_samples_created_at ON samples(created_at);
        CREATE INDEX IF NOT EXISTS idx_collections_profile_id ON collections(profile_id);
        CREATE INDEX IF NOT EXISTS idx_sample_slices_profile_created
            ON sample_slices(profile_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_sample_slices_profile_trashed
            ON sample_slices(profile_id, is_trashed, created_at DESC, id DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_unique_sibling
            ON collections(profile_id, COALESCE(parent_id, 0), name);
        CREATE INDEX IF NOT EXISTS idx_collections_parent_id
            ON collections(parent_id);
        CREATE INDEX IF NOT EXISTS idx_profile_favorites_sample_id ON profile_favorites(sample_id);
        CREATE INDEX IF NOT EXISTS idx_file_ops_journal_sample_id ON file_ops_journal(sample_id);
        CREATE INDEX IF NOT EXISTS idx_ai_embeddings_model ON sample_embeddings(model_id);
        CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status ON ai_tag_suggestions(status, sample_id);
        CREATE INDEX IF NOT EXISTS idx_collection_items_sample_id ON collection_items(sample_id);
        CREATE INDEX IF NOT EXISTS idx_profile_libraries_library_id ON profile_libraries(library_id);
        CREATE INDEX IF NOT EXISTS idx_ai_suggestions_sample_id ON ai_tag_suggestions(sample_id);
        CREATE INDEX IF NOT EXISTS idx_samples_file_path_lower ON samples(LOWER(file_path));
        CREATE INDEX IF NOT EXISTS idx_samples_original_path_lower ON samples(LOWER(original_file_path));
        CREATE INDEX IF NOT EXISTS idx_libraries_path_lower ON libraries(LOWER(path));
        CREATE INDEX IF NOT EXISTS idx_samples_active_lib_id
            ON samples(library_id, id)
            WHERE COALESCE(is_trashed, 0) = 0;
        CREATE INDEX IF NOT EXISTS idx_samples_active_genre_lib
            ON samples(genre COLLATE NOCASE, library_id)
            WHERE COALESCE(is_trashed, 0) = 0 AND genre != '';
        CREATE INDEX IF NOT EXISTS idx_sample_tags_tag_sample
            ON sample_tags(tag_id, sample_id);
        ",
    )
    .map_err(|e| format!("Failed to initialize database indexes: {}", e))?;

    conn.execute_batch(SAMPLES_FTS_SCHEMA_AND_TRIGGERS_SQL)
        .map_err(|e| format!("Failed to initialize FTS5 schema: {}", e))?;
    conn.execute_batch(SAMPLE_TAGS_FTS_TRIGGERS_SQL)
        .map_err(|e| format!("Failed to initialize FTS5 tag triggers: {}", e))?;

    // Ensure at least one profile exists
    let profile_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))
        .unwrap_or(0);
    if profile_count == 0 {
        let _ = conn.execute(
            "INSERT INTO profiles (name, color, settings_json, is_active) VALUES (?1, ?2, ?3, 1)",
            params!["Default Studio", "#F59E0B", "{}"],
        );
    }

    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM profiles WHERE is_active = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if active_count == 0 {
        let _ = conn.execute(
            "UPDATE profiles SET is_active = 1 WHERE id = (SELECT id FROM profiles ORDER BY id ASC LIMIT 1)",
            [],
        );
    }

    let pl_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM profile_libraries", [], |r| r.get(0))
        .unwrap_or(0);
    if pl_count == 0 {
        if let Ok(active_id) = conn.query_row::<i64, _, _>(
            "SELECT id FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
            [],
            |r| r.get(0),
        ) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO profile_libraries (profile_id, library_id) SELECT ?1, id FROM libraries",
                params![active_id],
            );
        }
    }

    let sample_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
        .unwrap_or(0);
    if sample_count == 0 {
        let _ = conn.execute(
            "DELETE FROM tags WHERE is_manual = 0 AND id NOT IN (SELECT DISTINCT tag_id FROM sample_tags)",
            [],
        );
        let _ = conn.execute(
            "DELETE FROM genres WHERE is_manual = 0 AND LOWER(name) NOT IN (SELECT DISTINCT LOWER(genre) FROM samples WHERE genre != '')",
            [],
        );
    } else if let Ok(mut stmt) =
        conn.prepare("SELECT id, name FROM genres WHERE color = '#8B5CF6' AND LOWER(name) != 'lo-fi'")
    {
        if let Ok(rows) =
            stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        {
            let to_update: Vec<(i64, String)> = rows.flatten().collect();
            for (gid, gname) in to_update {
                let col = deterministic_color_for_name(&gname);
                let _ = conn.execute(
                    "UPDATE genres SET color = ?1 WHERE id = ?2",
                    params![col, gid],
                );
            }
        }
    }
    run_schema_migrations(conn)
}
