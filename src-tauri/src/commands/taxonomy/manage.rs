use super::tags::query_tag_by_id_for_profile;
use crate::commands::Tag;
use crate::db::taxonomy::{
    encode_aliases_json, facet_allows_nesting_in_db, facet_domain_in_db, parse_aliases_json,
    rebuild_subtree_paths, resolve_facet_id_in_db, subtree_height_in_db, tag_depth_in_db,
    validate_tag_reparent, MAX_TAXONOMY_DEPTH,
};
use crate::db::{sync_primary_genre_for_samples, sync_primary_genre_for_tag, AppState};
use crate::security::validate_hex_color;
use crate::taxonomy_catalog::{FACET_CATEGORY_ID, FACET_SOURCE_ID};
use rusqlite::{params, Connection};
use tauri::State;

#[tauri::command]
pub async fn rename_tag(
    state: State<'_, AppState>,
    tag_id: i64,
    new_name: String,
) -> Result<Tag, String> {
    let trimmed = new_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    if trimmed.chars().count() > 64 {
        return Err("Tag name is too long (maximum 64 characters)".to_string());
    }
    crate::db::run_write_op(&state, move |conn| {
        let conflict: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tags WHERE id != ?1 AND (LOWER(name) = LOWER(?2) OR name = ?2))",
                params![tag_id, trimmed],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if conflict {
            return Err("A tag with that name already exists".to_string());
        }
        let facet_id: i64 = conn
            .query_row(
                "SELECT COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
                params![tag_id],
                |r| r.get(0),
            )
            .map_err(|_| "Tag not found".to_string())?;

        conn.execute(
            "UPDATE tags SET name = ?1 WHERE id = ?2",
            params![trimmed, tag_id],
        )
        .map_err(|e| format!("Failed to rename tag: {}", e))?;

        if facet_domain_in_db(conn, facet_id) == "genres" {
            sync_primary_genre_for_tag(conn, tag_id)?;
        }

        query_tag_by_id_for_profile(conn, tag_id)
    })
    .await
}

#[tauri::command]
pub async fn update_tag_color(
    state: State<'_, AppState>,
    tag_id: i64,
    new_color: String,
) -> Result<Tag, String> {
    if new_color.trim().is_empty() {
        return Err("Tag color cannot be empty".to_string());
    }
    let clean_color = validate_hex_color(&new_color)?;
    crate::db::run_write_op(&state, move |conn| {
        conn.execute(
            "UPDATE tags SET color = ?1, color_inherited = 0 WHERE id = ?2",
            params![clean_color, tag_id],
        )
        .map_err(|e| format!("Failed to update tag color: {}", e))?;

        query_tag_by_id_for_profile(conn, tag_id)
    })
    .await
}

pub(crate) fn update_tag_taxonomy_with_conn(
    conn: &mut Connection,
    tag_id: i64,
    facet_slug: Option<String>,
    parent_id: Option<Option<i64>>,
    color_inherited: Option<bool>,
    aliases: Option<Vec<String>>,
    sort_order: Option<i64>,
) -> Result<Tag, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting taxonomy update transaction: {}", e))?;

    let (tag_name, old_facet_id, old_parent_id, old_color_inherited, old_aliases, old_sort): (
        String,
        i64,
        Option<i64>,
        bool,
        String,
        i64,
    ) = tx
        .query_row(
            "SELECT name, COALESCE(facet_id, 1), parent_id, COALESCE(color_inherited, 0),
                    COALESCE(aliases_json, '[]'), COALESCE(sort_order, 0)
             FROM tags WHERE id = ?1",
            params![tag_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get::<_, i64>(3)? != 0,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|_| "Tag not found".to_string())?;

    let next_facet_id = match facet_slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(slug) => resolve_facet_id_in_db(&tx, slug)
            .ok_or_else(|| format!("Unknown taxonomy facet '{}'", slug))?,
        None => old_facet_id,
    };

    let next_allows_nesting = facet_allows_nesting_in_db(&tx, next_facet_id);
    let next_parent_id = match parent_id {
        Some(explicit) => explicit,
        None => {
            if !next_allows_nesting || next_facet_id != old_facet_id {
                None
            } else {
                old_parent_id
            }
        }
    };

    validate_tag_reparent(&tx, tag_id, next_parent_id, next_facet_id)?;

    let next_color_inherited = match color_inherited {
        Some(explicit) => explicit,
        None => {
            if next_parent_id.is_some() && next_parent_id != old_parent_id {
                true
            } else if next_parent_id.is_none()
                && old_parent_id.is_some()
                && next_facet_id != FACET_SOURCE_ID
            {
                false
            } else {
                old_color_inherited
            }
        }
    };
    let next_aliases_json = match aliases {
        Some(list) => encode_aliases_json(&list, Some(&tag_name)),
        None => old_aliases,
    };
    let next_sort = sort_order.unwrap_or(old_sort);

    tx.execute(
        "UPDATE tags
         SET facet_id = ?1,
             parent_id = ?2,
             color_inherited = ?3,
             aliases_json = ?4,
             sort_order = ?5,
             is_manual = 1
         WHERE id = ?6",
        params![
            next_facet_id,
            next_parent_id,
            i64::from(next_color_inherited),
            next_aliases_json,
            next_sort,
            tag_id
        ],
    )
    .map_err(|e| format!("Failed updating tag taxonomy: {}", e))?;

    rebuild_subtree_paths(&tx, tag_id)?;

    let touched_genre_or_mood = facet_domain_in_db(&tx, old_facet_id) == "genres"
        || facet_domain_in_db(&tx, next_facet_id) == "genres";
    if touched_genre_or_mood {
        sync_primary_genre_for_tag(&tx, tag_id)?;
    }

    tx.commit()
        .map_err(|e| format!("Failed committing taxonomy update: {}", e))?;

    query_tag_by_id_for_profile(conn, tag_id)
}

#[tauri::command]
pub async fn update_tag_taxonomy(
    state: State<'_, AppState>,
    tag_id: i64,
    facet_slug: Option<String>,
    parent_id: Option<Option<i64>>,
    color_inherited: Option<bool>,
    aliases: Option<Vec<String>>,
    sort_order: Option<i64>,
) -> Result<Tag, String> {
    crate::db::run_write_op(&state, move |conn| {
        update_tag_taxonomy_with_conn(
            conn,
            tag_id,
            facet_slug,
            parent_id,
            color_inherited,
            aliases,
            sort_order,
        )
    })
    .await
}

pub(crate) fn merge_tags_with_conn(
    conn: &mut Connection,
    source_tag_id: i64,
    target_tag_id: i64,
    add_source_as_alias: bool,
) -> Result<Tag, String> {
    if source_tag_id == target_tag_id {
        return Err("Cannot merge a tag into itself.".to_string());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting merge transaction: {}", e))?;

    let (src_name, src_facet, src_aliases_raw): (String, i64, String) = tx
        .query_row(
            "SELECT name, COALESCE(facet_id, 1), COALESCE(aliases_json, '[]') FROM tags WHERE id = ?1",
            params![source_tag_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Source tag not found.".to_string())?;

    let (tgt_name, tgt_facet, tgt_aliases_raw): (String, i64, String) = tx
        .query_row(
            "SELECT name, COALESCE(facet_id, 1), COALESCE(aliases_json, '[]') FROM tags WHERE id = ?1",
            params![target_tag_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Target tag not found.".to_string())?;

    // Check child reparenting depth/cycle constraints when source owns sub-tags
    let src_children: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM tags WHERE parent_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![source_tag_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    if !src_children.is_empty() {
        let target_is_descendant_of_source: bool = {
            let mut curr = Some(target_tag_id);
            let mut found = false;
            let mut hops = 0usize;
            while let Some(node) = curr {
                if node == source_tag_id {
                    found = true;
                    break;
                }
                hops += 1;
                if hops > MAX_TAXONOMY_DEPTH + 4 {
                    break;
                }
                curr = tx
                    .query_row("SELECT parent_id FROM tags WHERE id = ?1", params![node], |r| r.get(0))
                    .ok()
                    .flatten();
            }
            found
        };
        if target_is_descendant_of_source {
            return Err("Cannot merge a parent tag into one of its own sub-tags.".to_string());
        }
        if !facet_allows_nesting_in_db(&tx, tgt_facet) {
            return Err("Move or remove sub-items before merging into a flat facet.".to_string());
        }
        let tgt_depth = tag_depth_in_db(&tx, target_tag_id);
        for &cid in &src_children {
            let child_h = subtree_height_in_db(&tx, cid);
            if tgt_depth + child_h > MAX_TAXONOMY_DEPTH {
                return Err(format!(
                    "Merging would exceed the maximum nesting depth of {} levels.",
                    MAX_TAXONOMY_DEPTH
                ));
            }
        }
    }

    let affected_samples: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT sample_id FROM sample_tags WHERE tag_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![source_tag_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    tx.execute(
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
        params![target_tag_id, source_tag_id],
    )
    .map_err(|e| format!("Failed migrating sample links during merge: {}", e))?;

    if !src_children.is_empty() {
        tx.execute(
            "UPDATE tags SET parent_id = ?1, facet_id = ?2 WHERE parent_id = ?3",
            params![target_tag_id, tgt_facet, source_tag_id],
        )
        .map_err(|e| format!("Failed reparenting merged tag children: {}", e))?;
    }

    if add_source_as_alias {
        let mut merged_aliases = parse_aliases_json(&tgt_aliases_raw);
        merged_aliases.push(src_name);
        merged_aliases.extend(parse_aliases_json(&src_aliases_raw));
        let encoded = encode_aliases_json(&merged_aliases, Some(&tgt_name));
        tx.execute(
            "UPDATE tags SET aliases_json = ?1, is_manual = 1 WHERE id = ?2",
            params![encoded, target_tag_id],
        )
        .map_err(|e| format!("Failed updating merged tag aliases: {}", e))?;
    }

    tx.execute("DELETE FROM sample_tags WHERE tag_id = ?1", params![source_tag_id])
        .map_err(|e| format!("Failed clearing source sample_tags: {}", e))?;
    tx.execute("DELETE FROM tags WHERE id = ?1", params![source_tag_id])
        .map_err(|e| format!("Failed deleting merged source tag: {}", e))?;

    rebuild_subtree_paths(&tx, target_tag_id)?;

    if facet_domain_in_db(&tx, src_facet) == "genres"
        || facet_domain_in_db(&tx, tgt_facet) == "genres"
    {
        sync_primary_genre_for_samples(&tx, &affected_samples)?;
    }

    tx.commit()
        .map_err(|e| format!("Failed committing tag merge: {}", e))?;

    query_tag_by_id_for_profile(conn, target_tag_id)
}

#[tauri::command]
pub async fn merge_tags(
    state: State<'_, AppState>,
    source_tag_id: i64,
    target_tag_id: i64,
    add_source_as_alias: Option<bool>,
) -> Result<Tag, String> {
    crate::db::run_write_op(&state, move |conn| {
        merge_tags_with_conn(
            conn,
            source_tag_id,
            target_tag_id,
            add_source_as_alias.unwrap_or(true),
        )
    })
    .await
}

pub(crate) fn delete_tag_with_conn(conn: &mut Connection, tag_id: i64) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting delete_tag transaction: {}", e))?;

    let (parent_of_deleted, facet_id): (Option<i64>, i64) = tx
        .query_row(
            "SELECT parent_id, COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
            params![tag_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((None, FACET_CATEGORY_ID));

    let children: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM tags WHERE parent_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tag_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    let affected_samples: Vec<i64> = if facet_domain_in_db(&tx, facet_id) == "genres" {
        let mut stmt = tx
            .prepare("SELECT sample_id FROM sample_tags WHERE tag_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tag_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    } else {
        Vec::new()
    };

    if !children.is_empty() {
        tx.execute(
            "UPDATE tags SET parent_id = ?1 WHERE parent_id = ?2",
            params![parent_of_deleted, tag_id],
        )
        .map_err(|e| format!("Failed promoting sub-tags before delete: {}", e))?;
    }

    tx.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])
        .map_err(|e| format!("Failed to delete tag: {}", e))?;

    for cid in children {
        rebuild_subtree_paths(&tx, cid)?;
    }

    if !affected_samples.is_empty() {
        sync_primary_genre_for_samples(&tx, &affected_samples)?;
    }

    tx.commit()
        .map_err(|e| format!("Failed committing tag delete: {}", e))
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, tag_id: i64) -> Result<(), String> {
    crate::db::run_write_op(&state, move |conn| delete_tag_with_conn(conn, tag_id)).await
}

pub(crate) fn reorder_taxonomy_items_with_conn(
    conn: &mut Connection,
    ordered_tag_ids: &[i64],
) -> Result<(), String> {
    if ordered_tag_ids.is_empty() {
        return Ok(());
    }
    if ordered_tag_ids.len() > 2000 {
        return Err("Too many taxonomy items in reorder request.".to_string());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting taxonomy reorder transaction: {}", e))?;
    {
        let mut stmt = tx
            .prepare("UPDATE tags SET sort_order = ?1, is_manual = 1 WHERE id = ?2")
            .map_err(|e| format!("Failed preparing taxonomy reorder: {}", e))?;
        for (idx, &tid) in ordered_tag_ids.iter().enumerate() {
            if tid > 0 {
                let next_order = -10_000 + (idx as i64) * 10;
                stmt.execute(params![next_order, tid])
                    .map_err(|e| format!("Failed updating tag sort order: {}", e))?;
            }
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed committing taxonomy reorder: {}", e))
}

#[tauri::command]
pub async fn reorder_taxonomy_items(
    state: State<'_, AppState>,
    ordered_tag_ids: Vec<i64>,
) -> Result<(), String> {
    crate::db::run_write_op(&state, move |conn| {
        reorder_taxonomy_items_with_conn(conn, &ordered_tag_ids)
    })
    .await
}

pub(crate) fn harmonize_taxonomy_colors_with_conn(
    conn: &mut Connection,
    facet_slug: Option<&str>,
    parent_tag_id: Option<i64>,
) -> Result<usize, String> {
    if let Some(pid) = parent_tag_id {
        let parent_path: String = conn
            .query_row(
                "SELECT COALESCE(path, '/') FROM tags WHERE id = ?1",
                params![pid],
                |r| r.get(0),
            )
            .map_err(|_| "Parent tag not found.".to_string())?;
        let base_path = if parent_path.len() <= 1
            || !parent_path.starts_with('/')
            || !parent_path.ends_with('/')
        {
            format!("/{}/", pid)
        } else {
            parent_path
        };
        let like_pattern = format!("{}%", base_path);
        let updated = conn
            .execute(
                "UPDATE tags
                 SET color_inherited = 1
                 WHERE id != ?1
                   AND COALESCE(color_inherited, 0) = 0
                   AND (parent_id = ?1 OR path LIKE ?2)",
                params![pid, like_pattern],
            )
            .map_err(|e| format!("Failed harmonizing sub-tag colors: {}", e))?;
        return Ok(updated);
    }

    if let Some(slug) = facet_slug.map(str::trim).filter(|s| !s.is_empty()) {
        let facet_id = resolve_facet_id_in_db(conn, slug)
            .ok_or_else(|| format!("Unknown taxonomy facet '{}'", slug))?;
        let updated = conn
            .execute(
                "UPDATE tags
                 SET color_inherited = 1
                 WHERE COALESCE(facet_id, 1) = ?1
                   AND parent_id IS NOT NULL
                   AND COALESCE(color_inherited, 0) = 0",
                params![facet_id],
            )
            .map_err(|e| format!("Failed harmonizing facet colors: {}", e))?;
        return Ok(updated);
    }

    Err("Either facet_slug or parent_tag_id is required.".to_string())
}

#[tauri::command]
pub async fn harmonize_taxonomy_colors(
    state: State<'_, AppState>,
    facet_slug: Option<String>,
    parent_tag_id: Option<i64>,
) -> Result<usize, String> {
    crate::db::run_write_op(&state, move |conn| {
        harmonize_taxonomy_colors_with_conn(conn, facet_slug.as_deref(), parent_tag_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;
    use crate::db::taxonomy::ensure_taxonomy_tag;
    use rusqlite::{params, Connection};

    #[test]
    fn merge_tags_preserves_provenance_aliases_and_delete_promotes_children() {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms)
             VALUES (1, 1, 'C:/SFX/v.wav', 'v.wav', 'wav', 300)",
            [],
        )
        .unwrap();

        let voice_id = ensure_taxonomy_tag(&conn, "CustomVoice", Some("category"), None, None, true).unwrap();
        let vocal_id = ensure_taxonomy_tag(&conn, "Vocal", Some("category"), Some("Voice & Music"), None, true).unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (1, ?1, 1, 'manual')",
            params![voice_id],
        )
        .unwrap();

        let merged = merge_tags_with_conn(&mut conn, voice_id, vocal_id, true).expect("merge tags");
        assert_eq!(merged.id, vocal_id);
        assert!(merged.aliases.iter().any(|a| a.eq_ignore_ascii_case("CustomVoice")));

        let src: String = conn
            .query_row(
                "SELECT source FROM sample_tags WHERE sample_id = 1 AND tag_id = ?1",
                params![vocal_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(src, "manual");

        // Deleting parent promotes child to root and updates path
        let parent_id = ensure_taxonomy_tag(&conn, "TempParent", Some("category"), None, None, true).unwrap();
        let child_id = ensure_taxonomy_tag(&conn, "TempChild", Some("category"), Some("TempParent"), None, true).unwrap();
        delete_tag_with_conn(&mut conn, parent_id).expect("delete parent");

        let (new_parent, new_path): (Option<i64>, String) = conn
            .query_row(
                "SELECT parent_id, path FROM tags WHERE id = ?1",
                params![child_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(new_parent, None);
        assert_eq!(new_path, format!("/{}/", child_id));
    }

    #[test]
    fn reorder_taxonomy_items_assigns_negative_ascending_sort_order() {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        let a = ensure_taxonomy_tag(&conn, "AlphaTag", Some("category"), None, None, true).unwrap();
        let b = ensure_taxonomy_tag(&conn, "BetaTag", Some("category"), None, None, true).unwrap();
        let c = ensure_taxonomy_tag(&conn, "GammaTag", Some("category"), None, None, true).unwrap();

        reorder_taxonomy_items_with_conn(&mut conn, &[c, a, b]).expect("reorder siblings");

        let orders: Vec<(i64, i64)> = [c, a, b]
            .iter()
            .map(|tid| {
                let so: i64 = conn
                    .query_row("SELECT sort_order FROM tags WHERE id = ?1", params![tid], |r| {
                        r.get(0)
                    })
                    .unwrap();
                (*tid, so)
            })
            .collect();

        assert_eq!(orders, vec![(c, -10_000), (a, -9_990), (b, -9_980)]);
    }

    #[test]
    fn reparent_auto_inherits_parent_shade_and_harmonize_updates_facet_and_subtree() {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        let root_a = ensure_taxonomy_tag(&conn, "ParentA", Some("category"), None, Some("#8B5CF6"), true).unwrap();
        let loose_b = ensure_taxonomy_tag(&conn, "LooseChild", Some("category"), None, Some("#EF4444"), true).unwrap();

        // Moving a standalone root tag under ParentA automatically enables color_inherited = true
        let moved = update_tag_taxonomy_with_conn(
            &mut conn,
            loose_b,
            Some("category".to_string()),
            Some(Some(root_a)),
            None,
            None,
            None,
        )
        .expect("reparent loose child");
        assert!(moved.color_inherited, "reparented tag must default to auto parent shade");

        // Manually overriding child color disables color_inherited, then harmonize_taxonomy_colors restores it
        conn.execute("UPDATE tags SET color = '#10B981', color_inherited = 0 WHERE id = ?1", params![loose_b])
            .unwrap();
        let fixed_parent = harmonize_taxonomy_colors_with_conn(&mut conn, None, Some(root_a))
            .expect("harmonize parent subtree");
        assert_eq!(fixed_parent, 1);

        // Reset again and test facet-wide harmonize
        conn.execute("UPDATE tags SET color = '#F97316', color_inherited = 0 WHERE id = ?1", params![loose_b])
            .unwrap();
        let fixed_facet = harmonize_taxonomy_colors_with_conn(&mut conn, Some("category"), None)
            .expect("harmonize facet");
        assert!(fixed_facet >= 1);
        let inherited_after: i64 = conn
            .query_row("SELECT color_inherited FROM tags WHERE id = ?1", params![loose_b], |r| r.get(0))
            .unwrap();
        assert_eq!(inherited_after, 1);
    }
}
