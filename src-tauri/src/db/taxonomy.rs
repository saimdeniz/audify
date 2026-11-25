use crate::security::{sanitize_hex_color_or_default, validate_hex_color};
use crate::taxonomy_catalog::{
    deterministic_full_spectrum_color, facet_id_for_slug, facet_spec_by_id,
    lookup_canonical_by_name, FACET_CATEGORY_ID, FACET_GENRE_ID, FACET_MOOD_ID, FACET_SOURCE_ID,
    SYSTEM_FACETS,
};
use rusqlite::{params, params_from_iter, Connection};
use std::collections::{HashSet, VecDeque};

pub const MAX_TAXONOMY_DEPTH: usize = 3;

/// Shared SQL expression computing `samples_fts.tags_text` including every assigned tag,
/// all of its ancestor categories (via materialized `tags.path`), its aliases, and Turkish
/// dotless-i folded forms.
pub const FTS_TAGS_TEXT_SUBQUERY_SQL: &str = "
    COALESCE((
        SELECT GROUP_CONCAT(
            anc.name || ' ' ||
            REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(anc.aliases_json, ''), '[', ' '), ']', ' '), '\"', ' '), ',', ' '),
            ' '
        ) || ' ' || REPLACE(REPLACE(GROUP_CONCAT(
            anc.name || ' ' ||
            REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(anc.aliases_json, ''), '[', ' '), ']', ' '), '\"', ' '), ',', ' '),
            ' '
        ), 'ı', 'i'), 'İ', 'i')
        FROM sample_tags st
        INNER JOIN tags t ON t.id = st.tag_id
        INNER JOIN tags anc ON anc.id = t.id OR (t.path != '/' AND INSTR(t.path, '/' || anc.id || '/') > 0)
        WHERE st.sample_id = samples_fts.rowid
    ), '')
";

pub fn seed_system_facets(conn: &Connection) -> Result<(), String> {
    for facet in SYSTEM_FACETS {
        conn.execute(
            "INSERT OR IGNORE INTO tag_facets (id, slug, name, color, sort_order, is_system, domain, allow_nesting)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
            params![
                facet.id,
                facet.slug,
                facet.name,
                facet.color,
                facet.sort_order,
                facet.domain,
                i64::from(facet.allow_nesting)
            ],
        )
        .map_err(|e| format!("Failed seeding tag facet '{}': {}", facet.slug, e))?;
    }
    Ok(())
}

pub fn resolve_facet_id_in_db(conn: &Connection, slug: &str) -> Option<i64> {
    let clean = slug.trim();
    if clean.is_empty() {
        return None;
    }
    conn.query_row(
        "SELECT id FROM tag_facets WHERE LOWER(slug) = LOWER(?1) LIMIT 1",
        params![clean],
        |r| r.get::<_, i64>(0),
    )
    .ok()
    .or_else(|| facet_id_for_slug(clean))
}

pub fn facet_allows_nesting_in_db(conn: &Connection, facet_id: i64) -> bool {
    conn.query_row(
        "SELECT COALESCE(allow_nesting, 0) FROM tag_facets WHERE id = ?1",
        params![facet_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .unwrap_or_else(|_| facet_spec_by_id(facet_id).allow_nesting)
}

pub fn facet_domain_in_db(conn: &Connection, facet_id: i64) -> String {
    conn.query_row(
        "SELECT COALESCE(domain, 'tags') FROM tag_facets WHERE id = ?1",
        params![facet_id],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| facet_spec_by_id(facet_id).domain.to_string())
}

pub fn facet_color_in_db(conn: &Connection, facet_id: i64) -> String {
    conn.query_row(
        "SELECT color FROM tag_facets WHERE id = ?1",
        params![facet_id],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| facet_spec_by_id(facet_id).color.to_string())
}

pub fn parse_aliases_json(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Vec::new();
    }
    serde_json::from_str::<Vec<String>>(trimmed)
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn sanitize_aliases(aliases: &[String], exclude_self_name: Option<&str>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    if let Some(self_name) = exclude_self_name {
        let low = self_name.trim().to_lowercase();
        if !low.is_empty() {
            seen.insert(low);
        }
    }
    let mut out = Vec::new();
    for raw in aliases {
        let clean: String = raw
            .chars()
            .filter(|c| !c.is_control())
            .collect::<String>()
            .trim()
            .chars()
            .take(64)
            .collect();
        if clean.is_empty() {
            continue;
        }
        let low = clean.to_lowercase();
        if seen.insert(low) {
            out.push(clean);
            if out.len() >= 20 {
                break;
            }
        }
    }
    out
}

pub fn encode_aliases_json(aliases: &[String], exclude_self_name: Option<&str>) -> String {
    let clean = sanitize_aliases(aliases, exclude_self_name);
    serde_json::to_string(&clean).unwrap_or_else(|_| "[]".to_string())
}

/// Centralized orphan-tag pruner protecting manual tags, system structural category roots,
/// and ANY tag that still owns child sub-tags.
pub fn prune_orphan_auto_tags(conn: &Connection) -> Result<usize, String> {
    let mut total_deleted = 0usize;
    for _ in 0..=MAX_TAXONOMY_DEPTH {
        let deleted = conn
            .execute(
                "DELETE FROM tags
                 WHERE is_manual = 0
                   AND COALESCE(is_system, 0) = 0
                   AND id NOT IN (SELECT DISTINCT tag_id FROM sample_tags)
                   AND id NOT IN (SELECT DISTINCT parent_id FROM tags WHERE parent_id IS NOT NULL)",
                [],
            )
            .map_err(|e| format!("Failed pruning orphan auto-tags: {}", e))?;
        total_deleted += deleted;
        if deleted == 0 {
            break;
        }
    }
    let _ = conn.execute(
        "DELETE FROM genres
         WHERE is_manual = 0
           AND LOWER(name) NOT IN (SELECT DISTINCT LOWER(genre) FROM samples WHERE genre != '')",
        [],
    );
    Ok(total_deleted)
}

pub fn compute_tag_path(
    conn: &Connection,
    tag_id: i64,
    parent_id: Option<i64>,
) -> Result<String, String> {
    let Some(pid) = parent_id else {
        return Ok(format!("/{}/", tag_id));
    };
    let parent_path: String = conn
        .query_row("SELECT COALESCE(path, '/') FROM tags WHERE id = ?1", params![pid], |r| r.get(0))
        .unwrap_or_else(|_| "/".to_string());
    let base = if parent_path.len() <= 1 || !parent_path.starts_with('/') || !parent_path.ends_with('/') {
        format!("/{}/", pid)
    } else {
        parent_path
    };
    Ok(format!("{}{}/", base, tag_id))
}

pub fn rebuild_subtree_paths(conn: &Connection, root_id: i64) -> Result<(), String> {
    let (root_facet_id, root_parent_id): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COALESCE(facet_id, 1), parent_id FROM tags WHERE id = ?1",
            params![root_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("Tag {} not found: {}", root_id, e))?;

    let root_path = compute_tag_path(conn, root_id, root_parent_id)?;
    conn.execute(
        "UPDATE tags SET path = ?1 WHERE id = ?2",
        params![root_path, root_id],
    )
    .map_err(|e| format!("Failed updating root tag path: {}", e))?;

    let mut queue: VecDeque<(i64, String)> = VecDeque::new();
    queue.push_back((root_id, root_path));
    let mut visited: HashSet<i64> = HashSet::from([root_id]);

    while let Some((curr_id, curr_path)) = queue.pop_front() {
        let children: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT id FROM tags WHERE parent_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![curr_id], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            rows.flatten().collect()
        };
        for child_id in children {
            if !visited.insert(child_id) {
                continue;
            }
            let child_path = format!("{}{}/", curr_path, child_id);
            conn.execute(
                "UPDATE tags SET path = ?1, facet_id = ?2 WHERE id = ?3",
                params![child_path, root_facet_id, child_id],
            )
            .map_err(|e| format!("Failed updating child tag path: {}", e))?;
            queue.push_back((child_id, child_path));
        }
    }
    Ok(())
}

pub fn tag_depth_in_db(conn: &Connection, tag_id: i64) -> usize {
    let mut depth = 1usize;
    let mut curr = tag_id;
    let mut seen = HashSet::from([tag_id]);
    while depth <= MAX_TAXONOMY_DEPTH + 2 {
        let parent: Option<i64> = conn
            .query_row("SELECT parent_id FROM tags WHERE id = ?1", params![curr], |r| r.get(0))
            .ok()
            .flatten();
        match parent {
            Some(pid) if seen.insert(pid) => {
                depth += 1;
                curr = pid;
            }
            _ => break,
        }
    }
    depth
}

pub fn subtree_height_in_db(conn: &Connection, root_id: i64) -> usize {
    let mut max_height = 1usize;
    let mut queue = VecDeque::from([(root_id, 1usize)]);
    let mut seen = HashSet::from([root_id]);
    while let Some((curr, h)) = queue.pop_front() {
        if h > max_height {
            max_height = h;
        }
        if h > MAX_TAXONOMY_DEPTH + 2 {
            break;
        }
        if let Ok(mut stmt) = conn.prepare("SELECT id FROM tags WHERE parent_id = ?1") {
            if let Ok(rows) = stmt.query_map(params![curr], |r| r.get::<_, i64>(0)) {
                for cid in rows.flatten() {
                    if seen.insert(cid) {
                        queue.push_back((cid, h + 1));
                    }
                }
            }
        }
    }
    max_height
}

pub fn validate_tag_reparent(
    conn: &Connection,
    tag_id: i64,
    new_parent_id: Option<i64>,
    target_facet_id: i64,
) -> Result<(), String> {
    let sub_h = subtree_height_in_db(conn, tag_id);
    if !facet_allows_nesting_in_db(conn, target_facet_id) {
        if new_parent_id.is_some() {
            return Err("Sub-items are only supported inside hierarchical facets.".to_string());
        }
        if sub_h > 1 {
            return Err(
                "Move or remove sub-items before moving this item to a flat facet.".to_string(),
            );
        }
        return Ok(());
    }

    let Some(pid) = new_parent_id else {
        return Ok(());
    };
    if pid == tag_id {
        return Err("An item cannot be its own parent.".to_string());
    }
    let parent_facet: i64 = conn
        .query_row(
            "SELECT COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
            params![pid],
            |r| r.get(0),
        )
        .map_err(|_| "Target parent item was not found.".to_string())?;
    if parent_facet != target_facet_id {
        return Err("Parent item must belong to the same facet.".to_string());
    }

    // Cycle check: walk ancestors of `pid` and ensure `tag_id` is never encountered.
    let mut curr = Some(pid);
    let mut steps = 0usize;
    while let Some(node) = curr {
        if node == tag_id {
            return Err("Cannot move a parent item inside one of its own sub-items.".to_string());
        }
        steps += 1;
        if steps > MAX_TAXONOMY_DEPTH + 4 {
            return Err("Taxonomy cycle detected.".to_string());
        }
        curr = conn
            .query_row("SELECT parent_id FROM tags WHERE id = ?1", params![node], |r| r.get(0))
            .ok()
            .flatten();
    }

    let parent_depth = tag_depth_in_db(conn, pid);
    if parent_depth + sub_h > MAX_TAXONOMY_DEPTH {
        return Err(format!(
            "Maximum nesting depth is {} levels.",
            MAX_TAXONOMY_DEPTH
        ));
    }
    Ok(())
}

/// Ensures a tag exists in `tags` with proper facet, parent, materialized `path`, aliases,
/// and color inheritance. Lazily creates canonical structural parent roots (`is_system = 1`)
/// only when a child tag under them is actually needed.
pub fn ensure_taxonomy_tag(
    conn: &Connection,
    raw_name: &str,
    facet_override: Option<&str>,
    parent_override: Option<&str>,
    color_override: Option<&str>,
    is_manual: bool,
) -> Result<i64, String> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    if trimmed.chars().count() > 64 {
        return Err("Tag name is too long (maximum 64 characters)".to_string());
    }

    if let Ok(existing_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) OR name = ?1 LIMIT 1",
        params![trimmed],
        |r| r.get(0),
    ) {
        if is_manual {
            let _ = conn.execute(
                "UPDATE tags SET is_manual = 1 WHERE id = ?1",
                params![existing_id],
            );
        }
        return Ok(existing_id);
    }

    let spec = lookup_canonical_by_name(trimmed);
    let resolved_facet_slug = facet_override
        .and_then(|s| resolve_facet_id_in_db(conn, s).map(|_| s))
        .or_else(|| spec.map(|s| s.facet_slug))
        .unwrap_or("category");
    let facet_id = resolve_facet_id_in_db(conn, resolved_facet_slug).unwrap_or(FACET_CATEGORY_ID);

    let allows_nesting = facet_allows_nesting_in_db(conn, facet_id);
    let parent_name_opt = if allows_nesting {
        parent_override
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case(trimmed))
            .or_else(|| {
                if facet_id == FACET_CATEGORY_ID {
                    spec.and_then(|s| s.parent_name)
                } else {
                    None
                }
            })
    } else {
        None
    };

    let parent_id: Option<i64> = if let Some(pname) = parent_name_opt {
        let pid = ensure_taxonomy_tag(conn, pname, Some(resolved_facet_slug), None, None, false)?;
        let depth = tag_depth_in_db(conn, pid);
        if depth < MAX_TAXONOMY_DEPTH {
            Some(pid)
        } else {
            None
        }
    } else {
        None
    };

    let facet_color = facet_color_in_db(conn, facet_id);
    let (color, color_inherited) = match color_override.and_then(|c| validate_hex_color(c).ok()) {
        Some(clean) => (clean, false),
        None => {
            if let Some(s) = spec {
                (
                    sanitize_hex_color_or_default(s.color, &facet_color),
                    s.color_inherited,
                )
            } else if parent_id.is_some() || facet_id == FACET_SOURCE_ID {
                (facet_color.clone(), true)
            } else {
                (deterministic_full_spectrum_color(trimmed), false)
            }
        }
    };

    let aliases_json = spec
        .map(|s| {
            let owned: Vec<String> = s.aliases.iter().map(|a| (*a).to_string()).collect();
            encode_aliases_json(&owned, Some(trimmed))
        })
        .unwrap_or_else(|| "[]".to_string());
    let is_system = spec.is_some_and(|s| s.is_system);
    let sort_order = spec.map(|s| s.sort_order).unwrap_or(500);

    let canonical_name = spec.map(|s| s.name).unwrap_or(trimmed);
    conn.execute(
        "INSERT OR IGNORE INTO tags
            (name, color, is_manual, facet_id, parent_id, path, aliases_json, is_system, sort_order, color_inherited)
         VALUES (?1, ?2, ?3, ?4, ?5, '/', ?6, ?7, ?8, ?9)",
        params![
            canonical_name,
            color,
            is_manual,
            facet_id,
            parent_id,
            aliases_json,
            is_system,
            sort_order,
            color_inherited
        ],
    )
    .map_err(|e| format!("Failed creating taxonomy tag '{}': {}", canonical_name, e))?;

    let tag_id: i64 = conn
        .query_row(
            "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) OR name = ?1 LIMIT 1",
            params![canonical_name],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed resolving created tag '{}': {}", canonical_name, e))?;

    let path = compute_tag_path(conn, tag_id, parent_id)?;
    conn.execute(
        "UPDATE tags SET path = ?1 WHERE id = ?2 AND (path = '/' OR path != ?1)",
        params![path, tag_id],
    )
    .map_err(|e| format!("Failed setting tag path: {}", e))?;

    Ok(tag_id)
}

/// Synchronizes `samples.genre` (primary genre cache) and `samples.genre_is_manual` from
/// `sample_tags` for the specified sample IDs. Prefers `Genre` facet tags over `Mood` tags,
/// and manual assignments over automatic assignments.
pub fn sync_primary_genre_for_samples(
    conn: &Connection,
    sample_ids: &[i64],
) -> Result<(), String> {
    if sample_ids.is_empty() {
        return Ok(());
    }
    let mut unique_ids: Vec<i64> = sample_ids.to_vec();
    unique_ids.sort_unstable();
    unique_ids.dedup();

    for chunk in unique_ids.chunks(400) {
        let placeholders = crate::db::sql_in_placeholders(3, chunk.len());
        let sql = format!(
            "UPDATE samples
             SET genre = COALESCE((
                     SELECT t.name
                     FROM sample_tags st
                     INNER JOIN tags t ON t.id = st.tag_id
                     INNER JOIN tag_facets f ON f.id = t.facet_id
                     WHERE st.sample_id = samples.id
                       AND f.domain = 'genres'
                     ORDER BY
                         CASE
                             WHEN t.facet_id = ?1 THEN 0
                             WHEN t.facet_id = ?2 THEN 1
                             ELSE 2
                         END ASC,
                         st.is_manual DESC,
                         t.sort_order ASC,
                         t.name COLLATE NOCASE ASC
                     LIMIT 1
                 ), ''),
                 genre_is_manual = COALESCE((
                     SELECT MAX(st.is_manual)
                     FROM sample_tags st
                     INNER JOIN tags t ON t.id = st.tag_id
                     INNER JOIN tag_facets f ON f.id = t.facet_id
                     WHERE st.sample_id = samples.id
                       AND f.domain = 'genres'
                 ), 0)
             WHERE id IN ({})",
            placeholders
        );
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 2);
        params_vec.push(rusqlite::types::Value::Integer(FACET_GENRE_ID));
        params_vec.push(rusqlite::types::Value::Integer(FACET_MOOD_ID));
        for &sid in chunk {
            params_vec.push(rusqlite::types::Value::Integer(sid));
        }
        conn.execute(&sql, params_from_iter(params_vec))
            .map_err(|e| format!("Failed synchronizing primary sample genre cache: {}", e))?;
    }
    Ok(())
}

/// Syncs `samples.genre` for every sample currently linked to `tag_id`.
pub fn sync_primary_genre_for_tag(conn: &Connection, tag_id: i64) -> Result<(), String> {
    let sample_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT sample_id FROM sample_tags WHERE tag_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tag_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    sync_primary_genre_for_samples(conn, &sample_ids)
}

/// Rebuilds `samples_fts.tags_text` for either a specific slice of `sample_ids` or all rows.
pub fn rebuild_fts_tags_for_samples(
    conn: &Connection,
    sample_ids: Option<&[i64]>,
) -> Result<(), String> {
    match sample_ids {
        None => {
            let sql = format!(
                "UPDATE samples_fts SET tags_text = {}",
                FTS_TAGS_TEXT_SUBQUERY_SQL
            );
            conn.execute(&sql, [])
                .map_err(|e| format!("Failed rebuilding full FTS tags index: {}", e))?;
        }
        Some(ids) => {
            if ids.is_empty() {
                return Ok(());
            }
            let mut sorted: Vec<i64> = ids.to_vec();
            sorted.sort_unstable();
            sorted.dedup();
            for chunk in sorted.chunks(450) {
                let placeholders = crate::db::sql_in_placeholders(1, chunk.len());
                let sql = format!(
                    "UPDATE samples_fts SET tags_text = {} WHERE rowid IN ({})",
                    FTS_TAGS_TEXT_SUBQUERY_SQL, placeholders
                );
                conn.execute(&sql, params_from_iter(chunk.iter().copied()))
                    .map_err(|e| format!("Failed rebuilding FTS tags chunk: {}", e))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_schema_on_conn;
    use rusqlite::{params, Connection};

    #[test]
    fn orphan_pruner_preserves_system_roots_and_parents_with_children() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        let animals_id = ensure_taxonomy_tag(&conn, "Animals", Some("category"), None, None, false).unwrap();
        let dog_id = ensure_taxonomy_tag(&conn, "Dog", Some("category"), Some("Animals"), None, false).unwrap();
        let parent_auto = ensure_taxonomy_tag(&conn, "CustomAutoParent", Some("category"), None, None, false).unwrap();
        let child_manual = ensure_taxonomy_tag(&conn, "CustomManualChild", Some("category"), Some("CustomAutoParent"), None, true).unwrap();
        let unused_leaf = ensure_taxonomy_tag(&conn, "UnusedAutoLeaf", Some("category"), None, None, false).unwrap();

        prune_orphan_auto_tags(&conn).expect("prune orphans");

        let exists = |id: i64| -> bool {
            conn.query_row("SELECT EXISTS(SELECT 1 FROM tags WHERE id = ?1)", params![id], |r| r.get(0))
                .unwrap()
        };
        assert!(exists(animals_id), "is_system root must survive orphan pruning");
        assert!(!exists(dog_id), "unused auto leaf should be pruned");
        assert!(exists(parent_auto), "auto parent with children must survive orphan pruning");
        assert!(exists(child_manual), "manual child must survive orphan pruning");
        assert!(!exists(unused_leaf), "unused auto leaf should be pruned");
    }

    #[test]
    fn validate_tag_reparent_enforces_depth_3_cycle_guard_and_rebuilds_paths() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        let lvl1 = ensure_taxonomy_tag(&conn, "Lvl1", Some("category"), None, None, true).unwrap();
        let lvl2 = ensure_taxonomy_tag(&conn, "Lvl2", Some("category"), Some("Lvl1"), None, true).unwrap();
        let lvl3 = ensure_taxonomy_tag(&conn, "Lvl3", Some("category"), Some("Lvl2"), None, true).unwrap();
        let extra = ensure_taxonomy_tag(&conn, "Extra", Some("category"), None, None, true).unwrap();

        assert!(validate_tag_reparent(&conn, extra, Some(lvl3), FACET_CATEGORY_ID).is_err());
        assert!(validate_tag_reparent(&conn, lvl1, Some(lvl1), FACET_CATEGORY_ID).is_err());
        assert!(validate_tag_reparent(&conn, lvl1, Some(lvl2), FACET_CATEGORY_ID).is_err());
        assert!(validate_tag_reparent(&conn, lvl1, Some(lvl3), FACET_CATEGORY_ID).is_err());
        assert!(validate_tag_reparent(&conn, extra, Some(lvl1), FACET_GENRE_ID).is_err());

        validate_tag_reparent(&conn, lvl2, Some(extra), FACET_CATEGORY_ID).expect("valid reparent");
        conn.execute("UPDATE tags SET parent_id = ?1 WHERE id = ?2", params![extra, lvl2]).unwrap();
        rebuild_subtree_paths(&conn, lvl2).expect("rebuild paths");

        let lvl3_path: String = conn
            .query_row("SELECT path FROM tags WHERE id = ?1", params![lvl3], |r| r.get(0))
            .unwrap();
        assert_eq!(lvl3_path, format!("/{}/{}/{}/", extra, lvl2, lvl3));
    }
}
