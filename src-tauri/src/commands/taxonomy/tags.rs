use crate::commands::{query_sample_tags, SampleTagBadge, Tag, TagFacet};
use crate::db::taxonomy::{
    compute_tag_path, encode_aliases_json, facet_allows_nesting_in_db, facet_color_in_db,
    facet_domain_in_db, parse_aliases_json, resolve_facet_id_in_db, tag_depth_in_db,
    MAX_TAXONOMY_DEPTH,
};
use crate::db::{
    get_active_profile_id, is_sample_visible_in_profile, run_read_query,
    sync_primary_genre_for_samples, visible_sample_ids_in_profile, AppState,
};
use crate::security::validate_hex_color;
use crate::taxonomy_catalog::{
    derive_child_tonal_color, deterministic_full_spectrum_color, facet_spec_by_id,
    FACET_CATEGORY_ID, FACET_SOURCE_ID,
};
use rusqlite::{params, params_from_iter, Connection};
use std::collections::{HashMap, HashSet};
use tauri::State;

pub(crate) fn query_facets_with_conn(conn: &Connection) -> Result<Vec<TagFacet>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, slug, name, color, sort_order, is_system,
                    COALESCE(domain, 'tags'), COALESCE(allow_nesting, 0)
             FROM tag_facets
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| format!("Failed preparing tag_facets query: {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagFacet {
                id: r.get(0)?,
                slug: r.get(1)?,
                name: r.get(2)?,
                color: r.get(3)?,
                sort_order: r.get(4)?,
                is_system: r.get::<_, i64>(5)? != 0,
                domain: r.get(6)?,
                allow_nesting: r.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|e| format!("Failed querying tag_facets: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_tag_facets(state: State<'_, AppState>) -> Result<Vec<TagFacet>, String> {
    run_read_query(&state, query_facets_with_conn).await
}

fn resolve_effective_colors(
    tags: &mut [Tag],
    facet_colors: &HashMap<i64, String>,
) {
    let by_id: HashMap<i64, (Option<i64>, String, bool, i64)> = tags
        .iter()
        .map(|t| (t.id, (t.parent_id, t.color.clone(), t.color_inherited, t.facet_id)))
        .collect();

    for tag in tags.iter_mut() {
        if !tag.color_inherited {
            tag.effective_color = tag.color.clone();
            continue;
        }
        let mut curr = tag.parent_id;
        let mut resolved: Option<String> = None;
        let mut hops = 0usize;
        while let Some(pid) = curr {
            hops += 1;
            if hops > MAX_TAXONOMY_DEPTH + 2 {
                break;
            }
            if let Some((next_pid, p_color, p_inherited, _)) = by_id.get(&pid) {
                if !*p_inherited {
                    resolved = Some(p_color.clone());
                    break;
                }
                curr = *next_pid;
            } else {
                break;
            }
        }
        let base_hex = resolved.unwrap_or_else(|| {
            facet_colors
                .get(&tag.facet_id)
                .cloned()
                .unwrap_or_else(|| facet_spec_by_id(tag.facet_id).color.to_string())
        });
        tag.effective_color = if tag.parent_id.is_some() {
            derive_child_tonal_color(&base_hex, &tag.name, hops.saturating_add(1).max(2))
        } else {
            base_hex
        };
    }
}

pub(crate) fn query_tags_with_conn(conn: &Connection) -> Result<Vec<Tag>, String> {
    let active_id = get_active_profile_id(conn);

    let mut facet_slugs: HashMap<i64, String> = HashMap::new();
    let mut facet_colors: HashMap<i64, String> = HashMap::new();
    if let Ok(facets) = query_facets_with_conn(conn) {
        for f in facets {
            facet_slugs.insert(f.id, f.slug);
            facet_colors.insert(f.id, f.color);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color, COALESCE(c.cnt, 0) AS sample_count,
                    COALESCE(t.facet_id, 1), t.parent_id, COALESCE(t.path, '/'),
                    COALESCE(t.aliases_json, '[]'), COALESCE(t.is_system, 0),
                    COALESCE(t.sort_order, 0), COALESCE(t.color_inherited, 0)
             FROM tags t
             LEFT JOIN (
                 SELECT st.tag_id, COUNT(*) AS cnt
                 FROM sample_tags st
                 INNER JOIN samples s ON s.id = st.sample_id AND COALESCE(s.is_trashed, 0) = 0
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE l.is_global = 1
                    OR EXISTS (
                        SELECT 1 FROM profile_libraries pl
                        WHERE pl.profile_id = ?1 AND pl.library_id = l.id
                    )
                 GROUP BY st.tag_id
             ) c ON c.tag_id = t.id
             ORDER BY COALESCE(t.facet_id, 1) ASC, COALESCE(t.sort_order, 0) ASC, sample_count DESC, t.name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |row| {
            let id: i64 = row.get(0)?;
            let name: String = row.get(1)?;
            let color: String = row.get(2)?;
            let sample_count: i64 = row.get(3)?;
            let facet_id: i64 = row.get(4)?;
            let parent_id: Option<i64> = row.get(5)?;
            let raw_path: String = row.get(6)?;
            let aliases_raw: String = row.get(7)?;
            let is_system: bool = row.get::<_, i64>(8)? != 0;
            let sort_order: i64 = row.get(9)?;
            let color_inherited: bool = row.get::<_, i64>(10)? != 0;
            let path = if raw_path.len() <= 1 {
                format!("/{}/", id)
            } else {
                raw_path
            };
            let facet_slug = facet_slugs
                .get(&facet_id)
                .cloned()
                .unwrap_or_else(|| facet_spec_by_id(facet_id).slug.to_string());
            Ok(Tag {
                id,
                name,
                effective_color: color.clone(),
                color,
                sample_count,
                facet_id,
                facet_slug,
                parent_id,
                path,
                aliases: parse_aliases_json(&aliases_raw),
                color_inherited,
                is_system,
                sort_order,
                rollup_count: sample_count,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut tags = Vec::new();
    for r in rows {
        tags.push(r.map_err(|e| e.to_string())?);
    }

    resolve_effective_colors(&mut tags, &facet_colors);

    // Compute DISTINCT subtree `rollup_count` ONLY for tags that actually have children (fast O(parents) path).
    let mut children_by_parent: HashMap<i64, Vec<i64>> = HashMap::new();
    for t in &tags {
        if let Some(pid) = t.parent_id {
            children_by_parent.entry(pid).or_default().push(t.id);
        }
    }

    if !children_by_parent.is_empty() {
        for tag in &mut tags {
            if !children_by_parent.contains_key(&tag.id) {
                continue;
            }
            let mut subtree_ids = Vec::new();
            let mut stack = vec![tag.id];
            let mut visited = HashSet::from([tag.id]);
            while let Some(curr) = stack.pop() {
                subtree_ids.push(curr);
                if let Some(kids) = children_by_parent.get(&curr) {
                    for &kid in kids {
                        if visited.insert(kid) {
                            stack.push(kid);
                        }
                    }
                }
            }
            let placeholders = crate::db::sql_in_placeholders(2, subtree_ids.len());
            let sql = format!(
                "SELECT COUNT(DISTINCT st.sample_id)
                 FROM sample_tags st
                 INNER JOIN samples s ON s.id = st.sample_id AND COALESCE(s.is_trashed, 0) = 0
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE st.tag_id IN ({})
                   AND (
                       l.is_global = 1
                       OR EXISTS (
                           SELECT 1 FROM profile_libraries pl
                           WHERE pl.profile_id = ?1 AND pl.library_id = l.id
                       )
                   )",
                placeholders
            );
            let mut pvals: Vec<rusqlite::types::Value> = Vec::with_capacity(subtree_ids.len() + 1);
            pvals.push(rusqlite::types::Value::Integer(active_id));
            for tid in subtree_ids {
                pvals.push(rusqlite::types::Value::Integer(tid));
            }
            if let Ok(rollup) = conn.query_row(&sql, params_from_iter(pvals), |r| r.get::<_, i64>(0))
            {
                tag.rollup_count = rollup;
            }
        }
    }

    Ok(tags)
}

pub(crate) fn query_tag_by_id_for_profile(
    conn: &Connection,
    tag_id: i64,
) -> Result<Tag, String> {
    let all = query_tags_with_conn(conn)?;
    all.into_iter()
        .find(|t| t.id == tag_id)
        .ok_or_else(|| format!("Tag {} not found", tag_id))
}

#[tauri::command]
pub async fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    run_read_query(&state, query_tags_with_conn).await
}

#[cfg(test)]
pub(crate) fn create_tag_with_conn(
    conn: &Connection,
    name: &str,
    color: &str,
) -> Result<Tag, String> {
    create_tag_with_options_conn(conn, name, color, None, None, None, None)
}

pub(crate) fn create_tag_with_options_conn(
    conn: &Connection,
    name: &str,
    color: &str,
    facet_slug: Option<&str>,
    parent_id: Option<i64>,
    color_inherited: Option<bool>,
    aliases: Option<Vec<String>>,
) -> Result<Tag, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    if trimmed.chars().count() > 64 {
        return Err("Tag name is too long (maximum 64 characters)".to_string());
    }

    let facet_id = match facet_slug.map(str::trim).filter(|s| !s.is_empty()) {
        Some(slug) => resolve_facet_id_in_db(conn, slug)
            .ok_or_else(|| format!("Unknown taxonomy facet '{}'", slug))?,
        None => FACET_CATEGORY_ID,
    };

    let validated_parent: Option<i64> = if let Some(pid) = parent_id {
        if !facet_allows_nesting_in_db(conn, facet_id) {
            return Err("Sub-items are only supported inside hierarchical facets.".to_string());
        }
        let parent_facet: i64 = conn
            .query_row(
                "SELECT COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
                params![pid],
                |r| r.get(0),
            )
            .map_err(|_| "Parent item was not found.".to_string())?;
        if parent_facet != facet_id {
            return Err("Parent item must belong to the same facet.".to_string());
        }
        if tag_depth_in_db(conn, pid) >= MAX_TAXONOMY_DEPTH {
            return Err(format!(
                "Maximum nesting depth is {} levels.",
                MAX_TAXONOMY_DEPTH
            ));
        }
        Some(pid)
    } else {
        None
    };

    let inherit_color = color_inherited.unwrap_or(
        validated_parent.is_some() || facet_id == FACET_SOURCE_ID,
    );
    let resolved_color = if color.trim().is_empty() {
        if inherit_color {
            facet_color_in_db(conn, facet_id)
        } else {
            deterministic_full_spectrum_color(trimmed)
        }
    } else {
        validate_hex_color(color)?
    };
    let effective_inherit = if !color.trim().is_empty() && color_inherited.is_none() {
        false
    } else {
        inherit_color
    };

    let aliases_json = aliases
        .as_deref()
        .map(|a| encode_aliases_json(a, Some(trimmed)))
        .unwrap_or_else(|| "[]".to_string());

    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) OR name = ?1 LIMIT 1",
            params![trimmed],
            |r| r.get(0),
        )
        .ok();

    let tag_id = if let Some(eid) = existing_id {
        conn.execute("UPDATE tags SET is_manual = 1 WHERE id = ?1", params![eid])
            .map_err(|e| format!("Failed to update tag flag: {}", e))?;
        eid
    } else {
        conn.execute(
            "INSERT INTO tags
                (name, color, is_manual, facet_id, parent_id, path, aliases_json, is_system, sort_order, color_inherited)
             VALUES (?1, ?2, 1, ?3, ?4, '/', ?5, 0, 500, ?6)",
            params![
                trimmed,
                resolved_color,
                facet_id,
                validated_parent,
                aliases_json,
                i64::from(effective_inherit)
            ],
        )
        .map_err(|e| format!("Failed to create tag: {}", e))?;
        let new_id = conn.last_insert_rowid();
        let path = compute_tag_path(conn, new_id, validated_parent)?;
        conn.execute(
            "UPDATE tags SET path = ?1 WHERE id = ?2",
            params![path, new_id],
        )
        .map_err(|e| format!("Failed setting tag path: {}", e))?;
        new_id
    };

    query_tag_by_id_for_profile(conn, tag_id)
}

#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: String,
    facet_slug: Option<String>,
    parent_id: Option<i64>,
    color_inherited: Option<bool>,
    aliases: Option<Vec<String>>,
) -> Result<Tag, String> {
    crate::db::run_write_op(&state, move |conn| {
        create_tag_with_options_conn(
            conn,
            &name,
            &color,
            facet_slug.as_deref(),
            parent_id,
            color_inherited,
            aliases,
        )
    })
    .await
}

fn tag_is_genre_or_mood(conn: &Connection, tag_id: i64) -> bool {
    conn.query_row(
        "SELECT COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
        params![tag_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|fid| facet_domain_in_db(conn, fid) == "genres")
    .unwrap_or(false)
}

#[tauri::command]
pub async fn assign_tag(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_id: i64,
) -> Result<Vec<SampleTagBadge>, String> {
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        if !is_sample_visible_in_profile(conn, active_id, sample_id) {
            return Err("Sample not found in active profile".to_string());
        }
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')
             ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
            params![sample_id, tag_id],
        )
        .map_err(|e| format!("Failed to assign tag: {}", e))?;

        if tag_is_genre_or_mood(conn, tag_id) {
            sync_primary_genre_for_samples(conn, &[sample_id])?;
        }

        query_sample_tags(conn, sample_id)
    })
    .await
}

#[tauri::command]
pub async fn unassign_tag(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_id: i64,
) -> Result<Vec<SampleTagBadge>, String> {
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        if !is_sample_visible_in_profile(conn, active_id, sample_id) {
            return Err("Sample not found in active profile".to_string());
        }
        let affects_genre = tag_is_genre_or_mood(conn, tag_id);
        conn.execute(
            "DELETE FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
            params![sample_id, tag_id],
        )
        .map_err(|e| format!("Failed to unassign tag: {}", e))?;

        if affects_genre {
            sync_primary_genre_for_samples(conn, &[sample_id])?;
        }

        query_sample_tags(conn, sample_id)
    })
    .await
}

#[tauri::command]
pub async fn assign_tag_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    tag_id: i64,
) -> Result<(), String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(());
    }
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
        let visible_ids: Vec<i64> = sample_ids
            .into_iter()
            .filter(|sid| visible_set.contains(sid))
            .collect();
        if visible_ids.is_empty() {
            return Ok(());
        }
        let affects_genre = tag_is_genre_or_mood(conn, tag_id);
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start database transaction: {}", e))?;

        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')
                     ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
                )
                .map_err(|e| e.to_string())?;
            for &sid in &visible_ids {
                stmt.execute(params![sid, tag_id])
                    .map_err(|e| format!("Failed to assign tag in batch: {}", e))?;
            }
        }

        if affects_genre {
            sync_primary_genre_for_samples(&tx, &visible_ids)?;
        }

        tx.commit().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn unassign_tag_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    tag_id: i64,
) -> Result<(), String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(());
    }
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
        let visible_ids: Vec<i64> = sample_ids
            .into_iter()
            .filter(|sid| visible_set.contains(sid))
            .collect();
        if visible_ids.is_empty() {
            return Ok(());
        }
        let affects_genre = tag_is_genre_or_mood(conn, tag_id);
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start database transaction: {}", e))?;

        for chunk in visible_ids.chunks(450) {
            let placeholders = crate::db::sql_in_placeholders(2, chunk.len());
            let sql = format!(
                "DELETE FROM sample_tags WHERE tag_id = ?1 AND sample_id IN ({})",
                placeholders
            );
            let mut pvals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            pvals.push(rusqlite::types::Value::Integer(tag_id));
            for &sid in chunk {
                pvals.push(rusqlite::types::Value::Integer(sid));
            }
            tx.execute(&sql, params_from_iter(pvals))
                .map_err(|e| format!("Failed to unassign tag in batch: {}", e))?;
        }

        if affects_genre {
            sync_primary_genre_for_samples(&tx, &visible_ids)?;
        }

        tx.commit().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn clear_sample_tags_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    facet_slugs: Option<Vec<String>>,
) -> Result<(), String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(());
    }
    let raw_slugs = facet_slugs.unwrap_or_default();

    crate::db::run_write_op(&state, move |conn| {
        let facet_ids: Vec<i64> = raw_slugs
            .iter()
            .filter_map(|slug| resolve_facet_id_in_db(conn, slug))
            .collect();
        let active_id = get_active_profile_id(conn);
        let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
        let visible_ids: Vec<i64> = sample_ids
            .into_iter()
            .filter(|sid| visible_set.contains(sid))
            .collect();
        if visible_ids.is_empty() {
            return Ok(());
        }
        let affects_genre = facet_ids.is_empty()
            || facet_ids
                .iter()
                .any(|fid| facet_domain_in_db(conn, *fid) == "genres");
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start database transaction: {}", e))?;

        for chunk in visible_ids.chunks(400) {
            if facet_ids.is_empty() {
                let placeholders = crate::db::sql_in_placeholders(1, chunk.len());
                let sql = format!(
                    "DELETE FROM sample_tags WHERE sample_id IN ({})",
                    placeholders
                );
                let params_vec: Vec<rusqlite::types::Value> = chunk
                    .iter()
                    .map(|id| rusqlite::types::Value::Integer(*id))
                    .collect();
                tx.execute(&sql, params_from_iter(params_vec))
                    .map_err(|e| format!("Failed to clear sample tags: {}", e))?;
            } else {
                let sample_ph = crate::db::sql_in_placeholders(1, chunk.len());
                let facet_ph = crate::db::sql_in_placeholders(chunk.len() + 1, facet_ids.len());
                let sql = format!(
                    "DELETE FROM sample_tags
                     WHERE sample_id IN ({})
                       AND tag_id IN (SELECT id FROM tags WHERE COALESCE(facet_id, 1) IN ({}))",
                    sample_ph, facet_ph
                );
                let mut params_vec: Vec<rusqlite::types::Value> =
                    Vec::with_capacity(chunk.len() + facet_ids.len());
                for &sid in chunk {
                    params_vec.push(rusqlite::types::Value::Integer(sid));
                }
                for &fid in &facet_ids {
                    params_vec.push(rusqlite::types::Value::Integer(fid));
                }
                tx.execute(&sql, params_from_iter(params_vec))
                    .map_err(|e| format!("Failed to clear facet sample tags: {}", e))?;
            }
        }

        if affects_genre {
            sync_primary_genre_for_samples(&tx, &visible_ids)?;
        }

        tx.commit().map_err(|e| e.to_string())
    })
    .await
}
