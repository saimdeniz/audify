use super::schema::{ensure_column, SAMPLES_FTS_SCHEMA_AND_TRIGGERS_SQL, SAMPLE_TAGS_FTS_TRIGGERS_SQL};
use super::taxonomy::{
    compute_tag_path, encode_aliases_json, ensure_taxonomy_tag, parse_aliases_json,
    prune_orphan_auto_tags, rebuild_fts_tags_for_samples, seed_system_facets,
};
use crate::taxonomy_catalog::{
    facet_id_for_slug, is_canonical_mood_name, lookup_canonical_by_name,
    sanitize_id3_genre_or_mood_typo, FACET_CATEGORY_ID, FACET_GENRE_ID, FACET_MOOD_ID,
    FACET_SOURCE_ID,
};
use rusqlite::{params, Connection};
use std::collections::HashSet;

fn merge_legacy_tag_into(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
    alias_to_add: &str,
) -> Result<(), String> {
    if source_id == target_id {
        return Ok(());
    }
    // Promote any manual link from source onto target while preserving target's manual links.
    conn.execute(
        "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
         SELECT sample_id, ?1, is_manual, source
         FROM sample_tags
         WHERE tag_id = ?2
         ON CONFLICT(sample_id, tag_id) DO UPDATE SET
             is_manual = CASE WHEN sample_tags.is_manual = 1 OR excluded.is_manual = 1 THEN 1 ELSE 0 END,
             source = CASE
                 WHEN sample_tags.source = 'manual' OR excluded.source = 'manual' THEN 'manual'
                 WHEN sample_tags.source = 'ai_approved' OR excluded.source = 'ai_approved' THEN 'ai_approved'
                 ELSE sample_tags.source
             END",
        params![target_id, source_id],
    )
    .map_err(|e| format!("Failed merging legacy tag links: {}", e))?;

    conn.execute(
        "UPDATE tags SET parent_id = ?1 WHERE parent_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| format!("Failed reparenting merged tag children: {}", e))?;

    // Merge aliases onto target tag
    let (target_name, target_aliases_raw): (String, String) = conn
        .query_row(
            "SELECT name, COALESCE(aliases_json, '[]') FROM tags WHERE id = ?1",
            params![target_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or_else(|_| (String::new(), "[]".to_string()));
    let mut merged = parse_aliases_json(&target_aliases_raw);
    if !alias_to_add.trim().is_empty() {
        merged.push(alias_to_add.trim().to_string());
    }
    let encoded = encode_aliases_json(&merged, Some(&target_name));
    conn.execute(
        "UPDATE tags SET aliases_json = ?1 WHERE id = ?2",
        params![encoded, target_id],
    )
    .map_err(|e| format!("Failed updating merged tag aliases: {}", e))?;

    conn.execute("DELETE FROM sample_tags WHERE tag_id = ?1", params![source_id])
        .map_err(|e| format!("Failed deleting merged source sample_tags: {}", e))?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![source_id])
        .map_err(|e| format!("Failed deleting merged source tag: {}", e))?;
    Ok(())
}

/// Safe, atomic, one-time v16 -> v17 Faceted & Nested Taxonomy migration:
/// - Preserves 100% of manual user tags (`source = 'manual'`) and manual genres (`genre_is_manual = 1`).
/// - Splits legacy `genres` & `samples.genre` into `Genre` and `Mood` facets (fixing `"Sountrack"`).
/// - Organizes canonical auto tags into the 2-level `Category` tree + `Source / Pack` (`Pokemon`).
/// - Merges `Voice` -> `Vocal`, auto `Combat` -> `Impact`, retires auto `Loop` tag, and cleans noisy
///   `ai_auto` `Animals` links while preserving manual/rule/ai_approved links.
/// - Rebuilds `samples_fts` triggers & ancestor/alias `tags_text`.
pub(crate) fn run_v17_taxonomy_migration(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tag_facets (
            id INTEGER PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_system INTEGER NOT NULL DEFAULT 1
        );",
    )
    .map_err(|e| format!("Failed creating tag_facets table in v17: {}", e))?;
    seed_system_facets(conn)?;

    ensure_column(conn, "tags", "facet_id", "INTEGER NOT NULL DEFAULT 1")?;
    ensure_column(conn, "tags", "parent_id", "INTEGER DEFAULT NULL")?;
    ensure_column(conn, "tags", "path", "TEXT NOT NULL DEFAULT '/'")?;
    ensure_column(conn, "tags", "aliases_json", "TEXT NOT NULL DEFAULT '[]'")?;
    ensure_column(conn, "tags", "is_system", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "tags", "sort_order", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "tags", "color_inherited", "INTEGER NOT NULL DEFAULT 0")?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(path);
         CREATE INDEX IF NOT EXISTS idx_tags_facet_parent ON tags(facet_id, parent_id);",
    )
    .map_err(|e| format!("Failed creating v17 taxonomy indexes: {}", e))?;

    let existing_tag_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
        .unwrap_or(0);
    let existing_genre_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM genres", [], |r| r.get(0))
        .unwrap_or(0);
    let existing_sample_genre_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM samples WHERE genre != ''", [], |r| r.get(0))
        .unwrap_or(0);

    conn.execute_batch(
        "BEGIN IMMEDIATE TRANSACTION;
         DROP TRIGGER IF EXISTS trg_sample_tags_ai;
         DROP TRIGGER IF EXISTS trg_sample_tags_ad;
         DROP TRIGGER IF EXISTS trg_tags_au;",
    )
    .map_err(|e| format!("Failed starting v17 taxonomy transaction: {}", e))?;

    let migration_res: Result<(), String> = (|| {
        if existing_tag_count > 0 || existing_genre_count > 0 || existing_sample_genre_count > 0 {
            migrate_existing_genres_and_moods(conn)?;
            migrate_existing_tags_hierarchy(conn)?;
            recompute_all_tag_paths(conn)?;
            let _ = prune_orphan_auto_tags(conn);
            rebuild_fts_tags_for_samples(conn, None)?;
        }

        conn.execute_batch(SAMPLES_FTS_SCHEMA_AND_TRIGGERS_SQL)
            .map_err(|e| format!("Failed updating FTS triggers in v17: {}", e))?;
        conn.execute_batch(SAMPLE_TAGS_FTS_TRIGGERS_SQL)
            .map_err(|e| format!("Failed updating sample_tags FTS triggers in v17: {}", e))?;
        Ok(())
    })();

    if let Err(err) = migration_res {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(err);
    }

    conn.execute_batch("COMMIT; PRAGMA user_version = 17;")
        .map_err(|e| format!("Failed committing v17 taxonomy migration: {}", e))?;

    Ok(())
}

fn migrate_existing_genres_and_moods(conn: &Connection) -> Result<(), String> {
    // 1. Collect all legacy `genres` rows (name, color, is_manual)
    let legacy_genres: Vec<(String, String, bool)> = {
        let mut stmt = conn
            .prepare("SELECT name, color, COALESCE(is_manual, 0) FROM genres")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    for (raw_name, raw_color, is_manual) in legacy_genres {
        let trimmed = raw_name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (target_facet, target_name) = match sanitize_id3_genre_or_mood_typo(trimmed) {
            Some((f, canonical)) => (f, canonical.to_string()),
            None => {
                if let Some(spec) = lookup_canonical_by_name(trimmed) {
                    (spec.facet_slug, spec.name.to_string())
                } else if is_canonical_mood_name(trimmed) {
                    ("mood", trimmed.to_string())
                } else {
                    ("genre", trimmed.to_string())
                }
            }
        };

        let color_opt = if is_manual {
            Some(raw_color.as_str())
        } else {
            None
        };
        let tid = ensure_taxonomy_tag(
            conn,
            &target_name,
            Some(target_facet),
            None,
            color_opt,
            is_manual,
        )?;
        // If an existing tag already had this name in category (e.g., Ambient), move canonical genres/moods cleanly
        if matches!(target_facet, "genre" | "mood") {
            let fid = facet_id_for_slug(target_facet).unwrap_or(FACET_GENRE_ID);
            let _ = conn.execute(
                "UPDATE tags SET facet_id = ?1, parent_id = NULL WHERE id = ?2 AND COALESCE(is_system, 0) = 0",
                params![fid, tid],
            );
        }
    }

    // 2. Migrate all non-empty `samples.genre` values into `sample_tags` (and normalize typos on `samples.genre`)
    let sample_genres: Vec<(i64, String, bool)> = {
        let mut stmt = conn
            .prepare("SELECT id, genre, COALESCE(genre_is_manual, 0) FROM samples WHERE genre != ''")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    for (sample_id, raw_genre, is_manual) in sample_genres {
        let trimmed = raw_genre.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (target_facet, target_name) = match sanitize_id3_genre_or_mood_typo(trimmed) {
            Some((f, canonical)) => (f, canonical.to_string()),
            None => {
                if let Some(spec) = lookup_canonical_by_name(trimmed) {
                    (spec.facet_slug, spec.name.to_string())
                } else if is_canonical_mood_name(trimmed) {
                    ("mood", trimmed.to_string())
                } else {
                    ("genre", trimmed.to_string())
                }
            }
        };
        let tag_id = ensure_taxonomy_tag(
            conn,
            &target_name,
            Some(target_facet),
            None,
            None,
            is_manual,
        )?;
        let source = if is_manual { "manual" } else { "auto" };
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(sample_id, tag_id) DO UPDATE SET
                is_manual = CASE WHEN sample_tags.is_manual = 1 OR excluded.is_manual = 1 THEN 1 ELSE 0 END,
                source = CASE WHEN sample_tags.source = 'manual' OR excluded.source = 'manual' THEN 'manual' ELSE sample_tags.source END",
            params![sample_id, tag_id, is_manual, source],
        )
        .map_err(|e| format!("Failed migrating sample genre link: {}", e))?;

        if target_name != trimmed {
            let _ = conn.execute(
                "UPDATE samples SET genre = ?1 WHERE id = ?2",
                params![target_name, sample_id],
            );
        }
    }

    Ok(())
}

fn migrate_existing_tags_hierarchy(conn: &Connection) -> Result<(), String> {
    // 1. Merge `Voice` -> `Vocal` (preserving all manual links, keeping "Voice" as alias)
    let voice_id: Option<i64> = conn
        .query_row("SELECT id FROM tags WHERE LOWER(name) = 'voice' LIMIT 1", [], |r| r.get(0))
        .ok();
    if let Some(vid) = voice_id {
        let vocal_id = ensure_taxonomy_tag(conn, "Vocal", Some("category"), Some("Voice & Music"), None, false)?;
        merge_legacy_tag_into(conn, vid, vocal_id, "Voice")?;
    }

    // 2. Merge auto-only `Combat` -> `Impact` (if user explicitly created manual `Combat`, keep under Action & Combat)
    let combat_row: Option<(i64, bool)> = conn
        .query_row(
            "SELECT id, COALESCE(is_manual, 0) FROM tags WHERE LOWER(name) = 'combat' LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    if let Some((cid, combat_is_manual)) = combat_row {
        if !combat_is_manual {
            let impact_id = ensure_taxonomy_tag(
                conn,
                "Impact",
                Some("category"),
                Some("Action & Combat"),
                None,
                false,
            )?;
            merge_legacy_tag_into(conn, cid, impact_id, "Combat")?;
        } else {
            let parent_id =
                ensure_taxonomy_tag(conn, "Action & Combat", Some("category"), None, None, false)?;
            let _ = conn.execute(
                "UPDATE tags SET facet_id = ?1, parent_id = ?2 WHERE id = ?3",
                params![FACET_CATEGORY_ID, parent_id, cid],
            );
        }
    }

    // 3. Retire legacy auto-only `Loop` tag assignments (`samples.is_loop` handles loops natively)
    if let Ok(loop_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM tags WHERE LOWER(name) = 'loop' LIMIT 1",
        [],
        |r| r.get(0),
    ) {
        let _ = conn.execute(
            "DELETE FROM sample_tags WHERE tag_id = ?1 AND is_manual = 0",
            params![loop_id],
        );
    }

    // 4. Clean noisy `ai_auto` assignments on broad `Animals` while preserving manual/ai_approved/auto_rule
    if let Ok(animals_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM tags WHERE LOWER(name) = 'animals' LIMIT 1",
        [],
        |r| r.get(0),
    ) {
        let _ = conn.execute(
            "DELETE FROM sample_tags
             WHERE tag_id = ?1
               AND is_manual = 0
               AND source = 'ai_auto'",
            params![animals_id],
        );
    }

    // 5. Move `Pokemon` into Source / Pack facet (flat, uncolored `#`)
    if let Ok(poke_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM tags WHERE LOWER(name) = 'pokemon' LIMIT 1",
        [],
        |r| r.get(0),
    ) {
        let _ = conn.execute(
            "UPDATE tags
             SET facet_id = ?1, parent_id = NULL, color = '#64748B', color_inherited = 1,
                 aliases_json = '[\"PKMN\",\"Pokedex\"]', sort_order = 300
             WHERE id = ?2",
            params![FACET_SOURCE_ID, poke_id],
        );
    }

    // 6. Place remaining canonical tags under their canonical parents & family colors
    let all_tags: Vec<(i64, String, bool)> = {
        let mut stmt = conn
            .prepare("SELECT id, name, COALESCE(is_manual, 0) FROM tags ORDER BY id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    for (tid, name, is_manual) in all_tags {
        let Some(spec) = lookup_canonical_by_name(&name) else {
            continue;
        };
        let fid = facet_id_for_slug(spec.facet_slug).unwrap_or(FACET_CATEGORY_ID);
        let parent_id: Option<i64> = if fid == FACET_CATEGORY_ID {
            if let Some(pname) = spec.parent_name {
                let pid = ensure_taxonomy_tag(conn, pname, Some("category"), None, None, false)?;
                if pid != tid {
                    Some(pid)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        let existing_aliases: String = conn
            .query_row(
                "SELECT COALESCE(aliases_json, '[]') FROM tags WHERE id = ?1",
                params![tid],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());
        let mut merged_aliases = parse_aliases_json(&existing_aliases);
        for &a in spec.aliases {
            merged_aliases.push(a.to_string());
        }
        let encoded_aliases = encode_aliases_json(&merged_aliases, Some(&name));

        // Preserve user's hand-picked color on manual tags; apply clean family palette / inheritance on auto tags.
        if is_manual {
            let _ = conn.execute(
                "UPDATE tags
                 SET facet_id = ?1,
                     parent_id = ?2,
                     aliases_json = ?3,
                     is_system = CASE WHEN ?4 = 1 THEN 1 ELSE is_system END,
                     sort_order = ?5
                 WHERE id = ?6",
                params![
                    fid,
                    parent_id,
                    encoded_aliases,
                    i64::from(spec.is_system),
                    spec.sort_order,
                    tid
                ],
            );
        } else {
            let _ = conn.execute(
                "UPDATE tags
                 SET facet_id = ?1,
                     parent_id = ?2,
                     color = ?3,
                     color_inherited = ?4,
                     aliases_json = ?5,
                     is_system = ?6,
                     sort_order = ?7
                 WHERE id = ?8",
                params![
                    fid,
                    parent_id,
                    spec.color,
                    i64::from(spec.color_inherited),
                    encoded_aliases,
                    i64::from(spec.is_system),
                    spec.sort_order,
                    tid
                ],
            );
        }
    }

    // Legacy `Crowd`, `Clap`, `Heartbeat`, `Instrument`, `Kick`, `Snare`, `Percussion`, `Cymbal`, `Hi-Hat`
    // that existed from older YAMNet runs without a parent get placed cleanly under their family root.
    let legacy_family_placement: &[(&str, &str)] = &[
        ("crowd", "Foley"),
        ("clap", "Foley"),
        ("heartbeat", "Foley"),
        ("instrument", "Voice & Music"),
        ("kick", "Voice & Music"),
        ("snare", "Voice & Music"),
        ("percussion", "Voice & Music"),
        ("cymbal", "Voice & Music"),
        ("hi-hat", "Voice & Music"),
    ];
    for &(child_lower, parent_name) in legacy_family_placement {
        if let Ok((cid, is_man)) = conn.query_row::<(i64, bool), _, _>(
            "SELECT id, COALESCE(is_manual, 0) FROM tags WHERE LOWER(name) = ?1 AND parent_id IS NULL AND facet_id = 1 LIMIT 1",
            params![child_lower],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ) {
            let pid = ensure_taxonomy_tag(conn, parent_name, Some("category"), None, None, false)?;
            if pid != cid {
                let _ = conn.execute(
                    "UPDATE tags SET parent_id = ?1, color_inherited = CASE WHEN ?2 = 1 THEN color_inherited ELSE 1 END WHERE id = ?3",
                    params![pid, i64::from(is_man), cid],
                );
            }
        }
    }

    Ok(())
}

fn recompute_all_tag_paths(conn: &Connection) -> Result<(), String> {
    let rows: Vec<(i64, Option<i64>)> = {
        let mut stmt = conn
            .prepare("SELECT id, parent_id FROM tags ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END ASC, id ASC")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?)))
            .map_err(|e| e.to_string())?;
        mapped.flatten().collect()
    };

    // Process roots first, then children, then grandchildren (max 3 passes).
    let mut done: HashSet<i64> = HashSet::new();
    for _ in 0..4 {
        let mut progress = false;
        for &(tid, pid) in &rows {
            if done.contains(&tid) {
                continue;
            }
            if pid.is_none() || pid.is_some_and(|p| done.contains(&p)) {
                let path = compute_tag_path(conn, tid, pid)?;
                conn.execute("UPDATE tags SET path = ?1 WHERE id = ?2", params![path, tid])
                    .map_err(|e| format!("Failed updating path for tag {}: {}", tid, e))?;
                done.insert(tid);
                progress = true;
            }
        }
        if !progress {
            break;
        }
    }
    // Safety fallback for any broken/cyclic legacy parent_id
    for &(tid, _) in &rows {
        if !done.contains(&tid) {
            let root_path = format!("/{}/", tid);
            let _ = conn.execute(
                "UPDATE tags SET parent_id = NULL, path = ?1 WHERE id = ?2",
                params![root_path, tid],
            );
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn _ensure_mood_facet_const_used() -> i64 {
    FACET_MOOD_ID
}
