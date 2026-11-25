use super::taxonomy::{ensure_taxonomy_tag, rebuild_fts_tags_for_samples};
use crate::taxonomy_catalog::{is_canonical_mood_name, sanitize_id3_genre_or_mood_typo};
use rusqlite::{params, Connection};

/// SQLite v19 migration:
/// 1. Tags existing auto-detected genre/mood links with `source = 'auto_genre'` so `Apply rules`
///    (`auto_rule`) can never wipe genre/mood assignments.
/// 2. Recovers any sample whose `samples.genre` text is populated but whose `sample_tags` link
///    in the `genres` domain was previously stripped by `Apply rules`.
pub(crate) fn run_v19_genre_recovery_migration(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|e| format!("Failed starting v19 migration transaction: {}", e))?;

    let result: Result<(), String> = (|| {
        conn.execute(
            "UPDATE sample_tags
             SET source = 'auto_genre'
             WHERE is_manual = 0
               AND COALESCE(source, 'auto') = 'auto'
               AND tag_id IN (
                   SELECT t.id FROM tags t
                   INNER JOIN tag_facets f ON f.id = t.facet_id
                   WHERE f.domain = 'genres'
               )",
            [],
        )
        .map_err(|e| format!("Failed upgrading auto genre link sources: {}", e))?;

        let orphaned: Vec<(i64, String, bool)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT s.id, TRIM(s.genre), COALESCE(s.genre_is_manual, 0)
                     FROM samples s
                     WHERE TRIM(COALESCE(s.genre, '')) != ''
                       AND COALESCE(s.is_trashed, 0) = 0
                       AND NOT EXISTS (
                           SELECT 1
                           FROM sample_tags st
                           INNER JOIN tags t ON t.id = st.tag_id
                           INNER JOIN tag_facets f ON f.id = t.facet_id
                           WHERE st.sample_id = s.id
                             AND f.domain = 'genres'
                       )",
                )
                .map_err(|e| format!("Failed querying orphaned sample genres: {}", e))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)? != 0,
                    ))
                })
                .map_err(|e| format!("Failed mapping orphaned sample genres: {}", e))?;
            rows.flatten().collect()
        };

        let mut recovered_sample_ids: Vec<i64> = Vec::with_capacity(orphaned.len());
        if !orphaned.is_empty() {
            let mut link_stmt = conn
                .prepare(
                    "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual, source)
                     VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(|e| format!("Failed preparing genre recovery insert: {}", e))?;

            for (sample_id, raw_genre, is_manual) in orphaned {
                let (facet_slug, resolved_name) = match sanitize_id3_genre_or_mood_typo(&raw_genre)
                {
                    Some((f, canonical)) => (f, canonical.to_string()),
                    None => (
                        if is_canonical_mood_name(&raw_genre) {
                            "mood"
                        } else {
                            "genre"
                        },
                        raw_genre,
                    ),
                };
                if let Ok(tag_id) = ensure_taxonomy_tag(
                    conn,
                    &resolved_name,
                    Some(facet_slug),
                    None,
                    None,
                    is_manual,
                ) {
                    let source = if is_manual { "manual" } else { "auto_genre" };
                    let manual_int: i64 = if is_manual { 1 } else { 0 };
                    let _ = link_stmt.execute(params![sample_id, tag_id, manual_int, source]);
                    recovered_sample_ids.push(sample_id);
                }
            }
        }

        if !recovered_sample_ids.is_empty() {
            let _ = rebuild_fts_tags_for_samples(conn, Some(&recovered_sample_ids));
        }

        conn.execute_batch("PRAGMA user_version = 19;")
            .map_err(|e| format!("Failed setting user_version = 19: {}", e))?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT;")
                .map_err(|e| format!("Failed committing v19 migration: {}", e))?;
            Ok(())
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(err)
        }
    }
}
