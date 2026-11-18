use crate::commands::{query_sample_tags, SampleTagBadge, Tag};
use crate::db::{
    deterministic_color_for_name, get_active_profile_id, is_sample_visible_in_profile,
    run_read_query, visible_sample_ids_in_profile, AppState,
};
use crate::security::validate_hex_color;
use rusqlite::{params, Connection};
use tauri::State;

fn query_tag_by_id_for_profile(
    conn: &Connection,
    tag_id: i64,
    active_id: i64,
) -> Result<Tag, String> {
    conn.query_row(
        "SELECT t.id, t.name, t.color,
                (SELECT COUNT(*)
                 FROM sample_tags st
                 INNER JOIN samples s ON s.id = st.sample_id AND COALESCE(s.is_trashed, 0) = 0
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE st.tag_id = t.id
                   AND (
                       l.is_global = 1
                       OR EXISTS (
                           SELECT 1 FROM profile_libraries pl
                           WHERE pl.profile_id = ?2 AND pl.library_id = l.id
                       )
                   )) AS sample_count
         FROM tags t
         WHERE t.id = ?1",
        params![tag_id, active_id],
        |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sample_count: row.get(3)?,
            })
        },
    )
    .map_err(|e| format!("Failed to retrieve tag: {}", e))
}

fn query_tags_with_conn(conn: &Connection) -> Result<Vec<Tag>, String> {
    let active_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color, COALESCE(c.cnt, 0) AS sample_count
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
             ORDER BY sample_count DESC, t.name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sample_count: row.get(3)?,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut tags = Vec::new();
    for r in rows {
        tags.push(r.map_err(|e| e.to_string())?);
    }
    Ok(tags)
}

#[tauri::command]
pub async fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    run_read_query(&state, query_tags_with_conn).await
}

pub(crate) fn create_tag_with_conn(
    conn: &Connection,
    name: &str,
    color: &str,
) -> Result<Tag, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }

    let resolved_color = if color.trim().is_empty() {
        deterministic_color_for_name(trimmed).to_string()
    } else {
        validate_hex_color(color)?
    };

    let active_id = get_active_profile_id(conn);
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
            "INSERT INTO tags (name, color, is_manual) VALUES (?1, ?2, 1)",
            params![trimmed, resolved_color],
        )
        .map_err(|e| format!("Failed to create tag: {}", e))?;
        conn.last_insert_rowid()
    };

    query_tag_by_id_for_profile(conn, tag_id, active_id)
}

#[tauri::command]
pub fn create_tag(state: State<'_, AppState>, name: String, color: String) -> Result<Tag, String> {
    let conn = state.lock_db();
    create_tag_with_conn(&conn, &name, &color)
}

#[tauri::command]
pub fn assign_tag(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_id: i64,
) -> Result<Vec<SampleTagBadge>, String> {
    let conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    if !is_sample_visible_in_profile(&conn, active_id, sample_id) {
        return Err("Sample not found in active profile".to_string());
    }
    conn.execute(
        "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')
         ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
        params![sample_id, tag_id],
    )
    .map_err(|e| format!("Failed to assign tag: {}", e))?;

    query_sample_tags(&conn, sample_id)
}

#[tauri::command]
pub fn unassign_tag(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_id: i64,
) -> Result<Vec<SampleTagBadge>, String> {
    let conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    if !is_sample_visible_in_profile(&conn, active_id, sample_id) {
        return Err("Sample not found in active profile".to_string());
    }
    conn.execute(
        "DELETE FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
        params![sample_id, tag_id],
    )
    .map_err(|e| format!("Failed to unassign tag: {}", e))?;

    query_sample_tags(&conn, sample_id)
}

#[tauri::command]
pub fn assign_tag_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    tag_id: i64,
) -> Result<(), String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(());
    }
    let mut conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    let visible_set = visible_sample_ids_in_profile(&conn, active_id, &sample_ids)?;
    let visible_ids: Vec<i64> = sample_ids
        .into_iter()
        .filter(|sid| visible_set.contains(sid))
        .collect();
    if visible_ids.is_empty() {
        return Ok(());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')
                 ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
            )
            .map_err(|e| e.to_string())?;
        for sid in visible_ids {
            stmt.execute(params![sid, tag_id])
                .map_err(|e| format!("Failed to assign tag in batch: {}", e))?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_sample_tags_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
) -> Result<(), String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(());
    }
    let mut conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    let visible_set = visible_sample_ids_in_profile(&conn, active_id, &sample_ids)?;
    let visible_ids: Vec<i64> = sample_ids
        .into_iter()
        .filter(|sid| visible_set.contains(sid))
        .collect();
    if visible_ids.is_empty() {
        return Ok(());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    {
        for chunk in visible_ids.chunks(450) {
            let placeholders = (1..=chunk.len())
                .map(|idx| format!("?{}", idx))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "DELETE FROM sample_tags WHERE sample_id IN ({})",
                placeholders
            );
            let params_vec: Vec<rusqlite::types::Value> = chunk
                .iter()
                .map(|id| rusqlite::types::Value::Integer(*id))
                .collect();
            tx.execute(&sql, rusqlite::params_from_iter(params_vec))
                .map_err(|e| format!("Failed to clear sample tags: {}", e))?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_tag(
    state: State<'_, AppState>,
    tag_id: i64,
    new_name: String,
) -> Result<Tag, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    let conn = state.lock_db();
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
    let active_id = get_active_profile_id(&conn);
    conn.execute(
        "UPDATE tags SET name = ?1 WHERE id = ?2",
        params![trimmed, tag_id],
    )
    .map_err(|e| format!("Failed to rename tag: {}", e))?;

    query_tag_by_id_for_profile(&conn, tag_id, active_id)
}

#[tauri::command]
pub fn update_tag_color(
    state: State<'_, AppState>,
    tag_id: i64,
    new_color: String,
) -> Result<Tag, String> {
    if new_color.trim().is_empty() {
        return Err("Tag color cannot be empty".to_string());
    }
    let clean_color = validate_hex_color(&new_color)?;
    let conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    conn.execute(
        "UPDATE tags SET color = ?1 WHERE id = ?2",
        params![clean_color, tag_id],
    )
    .map_err(|e| format!("Failed to update tag color: {}", e))?;

    query_tag_by_id_for_profile(&conn, tag_id, active_id)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, tag_id: i64) -> Result<(), String> {
    let conn = state.lock_db();
    conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])
        .map_err(|e| format!("Failed to delete tag: {}", e))?;
    Ok(())
}
