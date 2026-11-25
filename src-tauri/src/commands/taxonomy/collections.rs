use crate::commands::{query_collection_by_id, Collection};
use crate::db::{
    get_active_profile_id, is_sample_visible_in_profile, run_read_query,
    visible_sample_ids_in_profile, AppState,
};
use crate::security::{
    has_ntfs_ads_colon, is_forbidden_os_or_root_path, is_unc_or_network_path,
    is_valid_collection_icon, normalize_clean_path, validate_hex_color,
};
use rusqlite::{params, Connection};
use std::path::{Component, Path};
use tauri::State;

fn sanitize_rule_path(rule_path: Option<String>, keep_empty: bool) -> Result<Option<String>, String> {
    match rule_path {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(keep_empty.then(String::new));
            }
            if is_unc_or_network_path(trimmed) {
                return Err(
                    "Network and UNC paths are not allowed for collection folder rules".to_string(),
                );
            }
            if has_ntfs_ads_colon(trimmed) {
                return Err("Alternate data stream paths are not allowed".to_string());
            }
            if Path::new(trimmed)
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            {
                return Err("Parent directory traversal is not allowed in folder rules".to_string());
            }
            let normalized = normalize_clean_path(trimmed);
            if is_forbidden_os_or_root_path(&normalized) {
                return Err("System or drive root paths cannot be used as collection rules".to_string());
            }
            Ok(Some(normalized))
        }
    }
}

const MAX_SMART_QUERY_LEN: usize = 512;

pub(crate) fn sanitize_smart_query(
    smart_query: Option<String>,
    keep_empty: bool,
) -> Result<Option<String>, String> {
    match smart_query {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(keep_empty.then(String::new));
            }
            if trimmed.chars().count() > MAX_SMART_QUERY_LEN {
                return Err(format!(
                    "Smart collection query cannot exceed {} characters",
                    MAX_SMART_QUERY_LEN
                ));
            }
            if trimmed.chars().any(|c| c.is_control()) {
                return Err("Smart collection query contains invalid control characters".to_string());
            }
            Ok(Some(trimmed.to_string()))
        }
    }
}

fn is_collection_smart(conn: &Connection, collection_id: i64, active_id: i64) -> Result<bool, String> {
    let smart_query: Option<String> = conn
        .query_row(
            "SELECT smart_query FROM collections WHERE id = ?1 AND profile_id = ?2",
            params![collection_id, active_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to inspect collection: {}", e))?;
    Ok(smart_query
        .as_deref()
        .map(|q| !q.trim().is_empty())
        .unwrap_or(false))
}

fn ensure_collection_in_active_profile(
    conn: &Connection,
    collection_id: i64,
    active_id: i64,
) -> Result<(), String> {
    let belongs: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1 AND profile_id = ?2)",
            params![collection_id, active_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to verify collection ownership: {}", e))?;
    if !belongs {
        return Err("Collection not found in active profile".to_string());
    }
    Ok(())
}

fn ensure_manual_item_target(
    conn: &Connection,
    collection_id: i64,
    active_id: i64,
) -> Result<(), String> {
    ensure_collection_in_active_profile(conn, collection_id, active_id)?;
    if is_collection_smart(conn, collection_id, active_id)? {
        return Err(
            "Smart collections update automatically from their query and cannot contain manual items"
                .to_string(),
        );
    }
    Ok(())
}

fn query_collections_with_conn(conn: &Connection) -> Result<Vec<Collection>, String> {
    let active_id = get_active_profile_id(conn);

    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.profile_id, c.name, COALESCE(c.color, '#10B981'), COALESCE(c.icon, 'layers'), c.created_at,
                    (SELECT COUNT(DISTINCT ci.sample_id)
                     FROM collection_items ci
                     INNER JOIN samples s ON s.id = ci.sample_id AND COALESCE(s.is_trashed, 0) = 0
                     INNER JOIN libraries l ON l.id = s.library_id
                     WHERE (l.is_global = 1 OR EXISTS (
                         SELECT 1 FROM profile_libraries pl
                         WHERE pl.profile_id = c.profile_id AND pl.library_id = l.id
                     ))
                       AND (ci.collection_id = c.id
                            OR ci.collection_id IN (
                                SELECT id FROM collections WHERE parent_id = c.id AND profile_id = c.profile_id
                            ))) AS sample_count,
                    c.parent_id,
                    c.rule_path,
                    c.smart_query
             FROM collections c
             WHERE c.profile_id = ?1
             ORDER BY c.parent_id IS NOT NULL, c.name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |row| {
            Ok(Collection {
                id: row.get(0)?,
                profile_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                icon: row.get(4)?,
                created_at: row.get(5)?,
                sample_count: row.get(6)?,
                parent_id: row.get(7)?,
                rule_path: row.get(8)?,
                smart_query: row.get(9)?,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut cols = Vec::new();
    for r in rows {
        cols.push(r.map_err(|e| e.to_string())?);
    }
    Ok(cols)
}

#[tauri::command]
pub async fn get_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    run_read_query(&state, query_collections_with_conn).await
}

fn create_collection_with_conn(
    conn: &Connection,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<i64>,
    rule_path: Option<String>,
    smart_query: Option<String>,
) -> Result<Collection, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Collection name cannot be empty".to_string());
    }
    let normalized_rule = sanitize_rule_path(rule_path, false)?;
    let normalized_smart = sanitize_smart_query(smart_query, false)?;
    if normalized_rule.is_some() && normalized_smart.is_some() {
        return Err("A collection cannot have both a folder rule and a smart query".to_string());
    }
    let active_id = get_active_profile_id(conn);
    if let Some(pid) = parent_id {
        ensure_collection_in_active_profile(conn, pid, active_id)?;
        if is_collection_smart(conn, pid, active_id)? {
            return Err("Smart collections cannot contain sub-folders".to_string());
        }
        if normalized_smart.is_some() {
            return Err("Smart collections must be top-level collections".to_string());
        }
    }
    let col_color = match color {
        Some(c) if !c.trim().is_empty() => validate_hex_color(&c)?,
        _ => "#10B981".to_string(),
    };
    let col_icon = match icon {
        Some(raw_icon) if !raw_icon.trim().is_empty() => {
            if is_valid_collection_icon(&raw_icon) {
                raw_icon.trim().to_string()
            } else {
                return Err("Unsupported collection icon".to_string());
            }
        }
        _ => "layers".to_string(),
    };
    let parent_coalesce = parent_id.unwrap_or(0);

    if let Ok(existing_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM collections WHERE profile_id = ?1 AND COALESCE(parent_id, 0) = ?2 AND name = ?3",
        params![active_id, parent_coalesce, trimmed],
        |r| r.get(0),
    ) {
        conn.execute(
            "UPDATE collections SET color = ?1, icon = ?2, rule_path = ?3, smart_query = ?4 WHERE id = ?5 AND profile_id = ?6",
            params![
                col_color,
                col_icon,
                normalized_rule,
                normalized_smart,
                existing_id,
                active_id
            ],
        )
        .map_err(|e| format!("Failed to update existing collection: {}", e))?;
        return query_collection_by_id(conn, existing_id);
    }

    conn.execute(
        "INSERT INTO collections (profile_id, parent_id, rule_path, smart_query, name, color, icon, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
        params![
            active_id,
            parent_id,
            normalized_rule,
            normalized_smart,
            trimmed,
            col_color,
            col_icon
        ],
    )
    .map_err(|e| format!("Failed to create collection: {}", e))?;

    let new_id = conn.last_insert_rowid();
    query_collection_by_id(conn, new_id)
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<i64>,
    rule_path: Option<String>,
    smart_query: Option<String>,
) -> Result<Collection, String> {
    crate::db::run_write_op(&state, move |conn| {
        create_collection_with_conn(conn, name, color, icon, parent_id, rule_path, smart_query)
    })
    .await
}

#[tauri::command]
pub async fn add_to_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    sample_id: i64,
) -> Result<Collection, String> {
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        ensure_manual_item_target(conn, collection_id, active_id)?;
        if !is_sample_visible_in_profile(conn, active_id, sample_id) {
            return Err("Sample not found in active profile".to_string());
        }

        conn.execute(
            "INSERT OR IGNORE INTO collection_items (collection_id, sample_id) VALUES (?1, ?2)",
            params![collection_id, sample_id],
        )
        .map_err(|e| format!("Failed to add sample to collection: {}", e))?;

        query_collection_by_id(conn, collection_id)
    })
    .await
}

#[tauri::command]
pub async fn add_samples_to_collection_batch(
    state: State<'_, AppState>,
    collection_id: i64,
    sample_ids: Option<Vec<i64>>,
) -> Result<Collection, String> {
    let sample_ids = sample_ids.unwrap_or_default();
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        ensure_manual_item_target(conn, collection_id, active_id)?;
        let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
        let visible_ids: Vec<i64> = sample_ids
            .into_iter()
            .filter(|sid| visible_set.contains(sid))
            .collect();

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start database transaction: {}", e))?;

        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR IGNORE INTO collection_items (collection_id, sample_id) VALUES (?1, ?2)",
                )
                .map_err(|e| e.to_string())?;
            for sid in visible_ids {
                stmt.execute(params![collection_id, sid])
                    .map_err(|e| format!("Failed to add sample to collection: {}", e))?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        query_collection_by_id(conn, collection_id)
    })
    .await
}

fn remove_samples_from_collection_with_conn(
    conn: &mut Connection,
    collection_id: i64,
    sample_ids: Vec<i64>,
) -> Result<Collection, String> {
    let active_id = get_active_profile_id(conn);
    ensure_manual_item_target(conn, collection_id, active_id)?;
    let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
    let visible_ids: Vec<i64> = sample_ids
        .into_iter()
        .filter(|sid| visible_set.contains(sid))
        .collect();

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    {
        // Symmetric with `query_samples` and `get_collections`: removing from a parent
        // collection removes the sample from both the parent and its child sub-collections,
        // while removing from a child sub-collection only affects that child.
        let mut stmt = tx
            .prepare_cached(
                "DELETE FROM collection_items
                 WHERE sample_id = ?1
                   AND (collection_id = ?2
                        OR collection_id IN (
                            SELECT id FROM collections WHERE parent_id = ?2 AND profile_id = ?3
                        ))",
            )
            .map_err(|e| e.to_string())?;
        for sid in visible_ids {
            stmt.execute(params![sid, collection_id, active_id])
                .map_err(|e| format!("Failed to remove sample from collection: {}", e))?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    query_collection_by_id(conn, collection_id)
}

#[tauri::command]
pub async fn remove_samples_from_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    sample_ids: Option<Vec<i64>>,
) -> Result<Collection, String> {
    let sample_ids = sample_ids.unwrap_or_default();
    crate::db::run_write_op(&state, move |conn| {
        remove_samples_from_collection_with_conn(conn, collection_id, sample_ids)
    })
    .await
}

fn rename_collection_with_conn(
    conn: &Connection,
    collection_id: i64,
    new_name: String,
    new_color: Option<String>,
    new_icon: Option<String>,
    new_rule_path: Option<String>,
    new_smart_query: Option<String>,
) -> Result<Collection, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Collection name cannot be empty".to_string());
    }
    let normalized_new_rule = sanitize_rule_path(new_rule_path, true)?;
    let normalized_new_smart = sanitize_smart_query(new_smart_query, true)?;
    let active_id = get_active_profile_id(conn);
    ensure_collection_in_active_profile(conn, collection_id, active_id)?;
    let current = query_collection_by_id(conn, collection_id)?;
    let col_color = match new_color {
        Some(c) if !c.trim().is_empty() => validate_hex_color(&c)?,
        Some(_) => return Err("Collection color cannot be empty".to_string()),
        None => current.color,
    };
    let col_icon = match new_icon {
        Some(raw_icon) if !raw_icon.trim().is_empty() => {
            if is_valid_collection_icon(&raw_icon) {
                raw_icon.trim().to_string()
            } else {
                return Err("Unsupported collection icon".to_string());
            }
        }
        _ => current.icon,
    };
    let col_smart = match normalized_new_smart {
        Some(s) if s.is_empty() => None,
        Some(s) => {
            if current.parent_id.is_some() {
                return Err("Smart collections must be top-level collections".to_string());
            }
            let has_children: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM collections WHERE parent_id = ?1 AND profile_id = ?2)",
                    params![collection_id, active_id],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if has_children {
                return Err("Collections with sub-folders cannot become smart collections".to_string());
            }
            Some(s)
        }
        None => current.smart_query,
    };
    let col_rule = match normalized_new_rule {
        Some(s) if s.is_empty() => None,
        Some(s) => {
            if col_smart.is_some() {
                return Err("A collection cannot have both a folder rule and a smart query".to_string());
            }
            Some(s)
        }
        None => {
            if col_smart.is_some() {
                None
            } else {
                current.rule_path
            }
        }
    };

    conn.execute(
        "UPDATE collections SET name = ?1, color = ?2, icon = ?3, rule_path = ?4, smart_query = ?5
         WHERE id = ?6 AND profile_id = ?7",
        params![trimmed, col_color, col_icon, col_rule, col_smart, collection_id, active_id],
    )
    .map_err(|e| format!("Failed to update collection: {}", e))?;

    query_collection_by_id(conn, collection_id)
}

#[tauri::command]
pub async fn rename_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    new_name: String,
    new_color: Option<String>,
    new_icon: Option<String>,
    new_rule_path: Option<String>,
    new_smart_query: Option<String>,
) -> Result<Collection, String> {
    crate::db::run_write_op(&state, move |conn| {
        rename_collection_with_conn(
            conn,
            collection_id,
            new_name,
            new_color,
            new_icon,
            new_rule_path,
            new_smart_query,
        )
    })
    .await
}

pub(crate) fn reparent_collection_with_conn(
    conn: &Connection,
    collection_id: i64,
    new_parent_id: Option<i64>,
) -> Result<Collection, String> {
    let active_id = get_active_profile_id(conn);
    ensure_collection_in_active_profile(conn, collection_id, active_id)?;
    let current = query_collection_by_id(conn, collection_id)?;
    if current
        .smart_query
        .as_deref()
        .is_some_and(|q| !q.trim().is_empty())
    {
        return Err("Smart collections must remain top-level collections.".to_string());
    }
    if current.parent_id == new_parent_id {
        return Ok(current);
    }

    if let Some(pid) = new_parent_id {
        if pid == collection_id {
            return Err("A collection cannot be nested inside itself.".to_string());
        }
        ensure_collection_in_active_profile(conn, pid, active_id)?;
        if is_collection_smart(conn, pid, active_id)? {
            return Err("Smart collections cannot contain sub-collections.".to_string());
        }
        let target_parent_of_parent: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM collections WHERE id = ?1 AND profile_id = ?2",
                params![pid, active_id],
                |r| r.get(0),
            )
            .unwrap_or(None);
        if target_parent_of_parent.is_some() {
            return Err("Collections can only be nested 2 levels deep.".to_string());
        }
        let has_children: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM collections WHERE parent_id = ?1 AND profile_id = ?2)",
                params![collection_id, active_id],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if has_children {
            return Err(
                "Move or remove sub-collections before nesting this collection inside another."
                    .to_string(),
            );
        }
    }

    let sibling_conflict: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM collections
                WHERE profile_id = ?1
                  AND COALESCE(parent_id, 0) = ?2
                  AND LOWER(name) = LOWER(?3)
                  AND id != ?4
            )",
            params![active_id, new_parent_id.unwrap_or(0), current.name, collection_id],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if sibling_conflict {
        return Err("A collection with that name already exists at the target level.".to_string());
    }

    conn.execute(
        "UPDATE collections SET parent_id = ?1 WHERE id = ?2 AND profile_id = ?3",
        params![new_parent_id, collection_id, active_id],
    )
    .map_err(|e| format!("Failed to move collection: {}", e))?;

    query_collection_by_id(conn, collection_id)
}

#[tauri::command]
pub async fn reparent_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    new_parent_id: Option<i64>,
) -> Result<Collection, String> {
    crate::db::run_write_op(&state, move |conn| {
        reparent_collection_with_conn(conn, collection_id, new_parent_id)
    })
    .await
}

#[tauri::command]
pub async fn delete_collection(
    state: State<'_, AppState>,
    collection_id: i64,
) -> Result<(), String> {
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        ensure_collection_in_active_profile(conn, collection_id, active_id)?;
        conn.execute(
            "DELETE FROM collections WHERE (id = ?1 OR parent_id = ?1) AND profile_id = ?2",
            params![collection_id, active_id],
        )
        .map_err(|e| format!("Failed to delete collection: {}", e))?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        init_schema_on_conn(&conn).expect("schema init");
        conn
    }

    #[test]
    fn creates_renames_and_protects_smart_collections() {
        let conn = test_conn();
        let created = create_collection_with_conn(
            &conn,
            "Fast Whooshes".into(),
            None,
            None,
            None,
            None,
            Some("  whoosh dur:<2s  ".into()),
        )
        .expect("create smart collection");

        assert_eq!(created.smart_query.as_deref(), Some("whoosh dur:<2s"));
        assert!(created.rule_path.is_none());

        // Cannot attach subfolders under a smart collection
        let sub_err = create_collection_with_conn(
            &conn,
            "Child".into(),
            None,
            None,
            Some(created.id),
            None,
            None,
        )
        .expect_err("smart collection must reject subfolders");
        assert!(sub_err.contains("sub-folders"));

        // Cannot manually insert items into a smart collection
        let manual_err = ensure_manual_item_target(&conn, created.id, 1)
            .expect_err("smart collection must reject manual items");
        assert!(manual_err.contains("Smart collections"));

        // Updating smart query persists cleanly
        let updated = rename_collection_with_conn(
            &conn,
            created.id,
            "Short Whooshes".into(),
            None,
            None,
            None,
            Some("whoosh dur:<1.5s".into()),
        )
        .expect("update smart query");
        assert_eq!(updated.name, "Short Whooshes");
        assert_eq!(updated.smart_query.as_deref(), Some("whoosh dur:<1.5s"));
    }

    #[test]
    fn rejects_invalid_smart_queries_and_conflicting_rules() {
        let conn = test_conn();
        let conflict = create_collection_with_conn(
            &conn,
            "Conflict".into(),
            None,
            None,
            None,
            Some("C:/Samples/Whoosh".into()),
            Some("whoosh".into()),
        );
        assert!(conflict.is_err());

        let too_long = "a".repeat(513);
        assert!(sanitize_smart_query(Some(too_long), false).is_err());
        assert!(sanitize_smart_query(Some("whoosh\u{0007}".into()), false).is_err());
    }

    #[test]
    fn removes_samples_from_parent_and_child_subcollections_symmetrically() {
        let mut conn = test_conn();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'D:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension)
             VALUES (101, 1, 'D:/SFX/Hit.wav', 'Hit.wav', 'wav'),
                    (102, 1, 'D:/SFX/Pad.wav', 'Pad.wav', 'wav')",
            [],
        )
        .unwrap();

        let parent = create_collection_with_conn(
            &conn,
            "Project A".into(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let child_sfx = create_collection_with_conn(
            &conn,
            "SFX".into(),
            None,
            None,
            Some(parent.id),
            None,
            None,
        )
        .unwrap();
        let child_music = create_collection_with_conn(
            &conn,
            "Music".into(),
            None,
            None,
            Some(parent.id),
            None,
            None,
        )
        .unwrap();

        // Auto-routed samples live under child sub-collections
        conn.execute(
            "INSERT INTO collection_items (collection_id, sample_id) VALUES (?1, 101), (?2, 102)",
            params![child_sfx.id, child_music.id],
        )
        .unwrap();
        assert_eq!(query_collection_by_id(&conn, parent.id).unwrap().sample_count, 2);

        // Removing from a child only deletes from that child
        let after_child_rm =
            remove_samples_from_collection_with_conn(&mut conn, child_music.id, vec![102]).unwrap();
        assert_eq!(after_child_rm.sample_count, 0);
        assert_eq!(query_collection_by_id(&conn, parent.id).unwrap().sample_count, 1);
        assert_eq!(query_collection_by_id(&conn, child_sfx.id).unwrap().sample_count, 1);

        // Removing from parent also deletes auto-routed samples residing in its child sub-collections
        let after_parent_rm =
            remove_samples_from_collection_with_conn(&mut conn, parent.id, vec![101]).unwrap();
        assert_eq!(after_parent_rm.sample_count, 0);
        assert_eq!(query_collection_by_id(&conn, child_sfx.id).unwrap().sample_count, 0);
    }

    #[test]
    fn reparent_collection_nests_promotes_and_guards_smart_and_depth() {
        let conn = test_conn();
        let parent = create_collection_with_conn(&conn, "SFX Pack".into(), None, None, None, None, None).unwrap();
        let child = create_collection_with_conn(&conn, "Whooshes".into(), None, None, None, None, None).unwrap();
        let third = create_collection_with_conn(&conn, "Deep".into(), None, None, None, None, None).unwrap();
        let smart = create_collection_with_conn(&conn, "SmartLoops".into(), None, None, None, None, Some("is:loop".into())).unwrap();

        // Nest manual child under parent
        let nested = reparent_collection_with_conn(&conn, child.id, Some(parent.id)).expect("nest collection");
        assert_eq!(nested.parent_id, Some(parent.id));

        // Reject 3rd level nesting (parent already has parent) and nesting a parent with children
        assert!(reparent_collection_with_conn(&conn, third.id, Some(child.id)).is_err());
        assert!(reparent_collection_with_conn(&conn, parent.id, Some(third.id)).is_err());
        assert!(reparent_collection_with_conn(&conn, child.id, Some(child.id)).is_err());

        // Reject smart collection as source or parent
        assert!(reparent_collection_with_conn(&conn, smart.id, Some(parent.id)).is_err());
        assert!(reparent_collection_with_conn(&conn, third.id, Some(smart.id)).is_err());

        // Promote child back to top-level root
        let promoted = reparent_collection_with_conn(&conn, child.id, None).expect("promote collection");
        assert_eq!(promoted.parent_id, None);
    }
}