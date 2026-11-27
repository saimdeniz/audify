use rusqlite::Connection;

/// SQLite v20 migration:
/// Adds the `layer_history` table storing rendered `.wav` mixes alongside their lightweight
/// versioned `recipe_json` timeline definitions so saved Layers can be played, favorited,
/// dragged to NLEs, trashed/restored, and reopened non-destructively in the Layers Editor.
pub(crate) fn run_v20_layer_history_migration(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        BEGIN IMMEDIATE TRANSACTION;

        CREATE TABLE IF NOT EXISTS layer_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL DEFAULT 1,
            layer_path TEXT NOT NULL,
            layer_name TEXT NOT NULL,
            recipe_json TEXT NOT NULL,
            lane_count INTEGER NOT NULL DEFAULT 1,
            clip_count INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            is_favorite BOOLEAN NOT NULL DEFAULT 0,
            peaks_json TEXT NOT NULL DEFAULT '[]',
            sample_rate INTEGER NOT NULL DEFAULT 48000,
            channels INTEGER NOT NULL DEFAULT 2,
            bit_depth INTEGER NOT NULL DEFAULT 24,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_trashed BOOLEAN NOT NULL DEFAULT 0,
            trash_file_path TEXT DEFAULT NULL,
            trashed_at TEXT DEFAULT NULL,
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, layer_path)
        );

        CREATE INDEX IF NOT EXISTS idx_layer_history_profile_created
            ON layer_history(profile_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_layer_history_profile_trashed
            ON layer_history(profile_id, is_trashed, created_at DESC, id DESC);

        PRAGMA user_version = 20;
        COMMIT;
        ",
    )
    .map_err(|e| {
        let _ = conn.execute_batch("ROLLBACK;");
        format!("Failed applying v20 layer_history migration: {}", e)
    })
}
