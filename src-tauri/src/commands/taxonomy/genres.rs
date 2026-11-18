use crate::audio::extract_embedded_meta_batch;
use crate::commands::Genre;
use crate::db::{
    deterministic_color_for_name, get_active_profile_id, is_sample_visible_in_profile,
    run_read_query, visible_sample_ids_in_profile, AppState,
};
use crate::security::validate_hex_color;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use tauri::State;

fn query_genre_by_id_for_profile(
    conn: &Connection,
    genre_id: i64,
    active_id: i64,
) -> Result<Genre, String> {
    conn.query_row(
        "SELECT g.id, g.name, g.color,
                (SELECT COUNT(*)
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE COALESCE(s.is_trashed, 0) = 0
                   AND s.genre = g.name COLLATE NOCASE
                   AND (
                       l.is_global = 1
                       OR EXISTS (
                           SELECT 1 FROM profile_libraries pl
                           WHERE pl.profile_id = ?2 AND pl.library_id = l.id
                       )
                   )) AS sample_count
         FROM genres g
         WHERE g.id = ?1",
        params![genre_id, active_id],
        |row| {
            Ok(Genre {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sample_count: row.get(3)?,
            })
        },
    )
    .map_err(|e| format!("Failed to retrieve genre: {}", e))
}

fn ensure_manual_genre(
    conn: &Connection,
    trimmed: &str,
    resolved_color: &str,
) -> Result<i64, String> {
    if let Ok(existing_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM genres WHERE name = ?1 COLLATE NOCASE LIMIT 1",
        params![trimmed],
        |r| r.get(0),
    ) {
        conn.execute(
            "UPDATE genres SET is_manual = 1 WHERE id = ?1",
            params![existing_id],
        )
        .map_err(|e| format!("Failed to update genre flag: {}", e))?;
        return Ok(existing_id);
    }

    conn.execute(
        "INSERT INTO genres (name, color, is_manual) VALUES (?1, ?2, 1)",
        params![trimmed, resolved_color],
    )
    .map_err(|e| format!("Failed to create genre: {}", e))?;
    Ok(conn.last_insert_rowid())
}

fn query_genres_with_conn(conn: &Connection) -> Result<Vec<Genre>, String> {
    let active_id = get_active_profile_id(conn);
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.name, g.color, COALESCE(c.cnt, 0) AS sample_count
             FROM genres g
             LEFT JOIN (
                 SELECT s.genre AS genre_key, COUNT(*) AS cnt
                 FROM samples s
                 INNER JOIN libraries l ON l.id = s.library_id
                 WHERE COALESCE(s.is_trashed, 0) = 0
                   AND s.genre != ''
                   AND (
                       l.is_global = 1
                       OR EXISTS (
                           SELECT 1 FROM profile_libraries pl
                           WHERE pl.profile_id = ?1 AND pl.library_id = l.id
                       )
                   )
                 GROUP BY s.genre COLLATE NOCASE
             ) c ON c.genre_key = g.name COLLATE NOCASE
             ORDER BY sample_count DESC, g.name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |row| {
            Ok(Genre {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sample_count: row.get(3)?,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut genres = Vec::new();
    for r in rows {
        genres.push(r.map_err(|e| e.to_string())?);
    }
    Ok(genres)
}

#[tauri::command]
pub async fn get_genres(state: State<'_, AppState>) -> Result<Vec<Genre>, String> {
    run_read_query(&state, query_genres_with_conn).await
}

#[tauri::command]
pub fn create_genre(
    state: State<'_, AppState>,
    name: String,
    color: String,
) -> Result<Genre, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Genre name cannot be empty".to_string());
    }
    let resolved_color = if color.trim().is_empty() {
        deterministic_color_for_name(trimmed).to_string()
    } else {
        validate_hex_color(&color)?
    };
    let conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    let genre_id = ensure_manual_genre(&conn, trimmed, &resolved_color)?;
    query_genre_by_id_for_profile(&conn, genre_id, active_id)
}

#[tauri::command]
pub fn rename_genre(
    state: State<'_, AppState>,
    genre_id: i64,
    new_name: String,
) -> Result<Genre, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Genre name cannot be empty".to_string());
    }
    let mut conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    let old_name: String = tx
        .query_row(
            "SELECT name FROM genres WHERE id = ?1",
            params![genre_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Genre not found: {}", e))?;

    let conflict: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM genres WHERE id != ?1 AND name = ?2 COLLATE NOCASE)",
            params![genre_id, trimmed],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if conflict {
        return Err("A genre with that name already exists".to_string());
    }

    tx.execute(
        "UPDATE genres SET name = ?1 WHERE id = ?2",
        params![trimmed, genre_id],
    )
    .map_err(|e| format!("Failed to rename genre: {}", e))?;

    tx.execute(
        "UPDATE samples SET genre = ?1 WHERE genre = ?2 COLLATE NOCASE",
        params![trimmed, old_name],
    )
    .map_err(|e| format!("Failed to update sample genres: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit genre rename: {}", e))?;

    query_genre_by_id_for_profile(&conn, genre_id, active_id)
}

#[tauri::command]
pub fn update_genre_color(
    state: State<'_, AppState>,
    genre_id: i64,
    new_color: String,
) -> Result<Genre, String> {
    if new_color.trim().is_empty() {
        return Err("Genre color cannot be empty".to_string());
    }
    let clean_color = validate_hex_color(&new_color)?;
    let conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    conn.execute(
        "UPDATE genres SET color = ?1 WHERE id = ?2",
        params![clean_color, genre_id],
    )
    .map_err(|e| format!("Failed to update genre color: {}", e))?;

    query_genre_by_id_for_profile(&conn, genre_id, active_id)
}

#[tauri::command]
pub fn delete_genre(state: State<'_, AppState>, genre_id: i64) -> Result<(), String> {
    let mut conn = state.lock_db();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    if let Ok(name) = tx.query_row::<String, _, _>(
        "SELECT name FROM genres WHERE id = ?1",
        params![genre_id],
        |r| r.get(0),
    ) {
        tx.execute(
            "UPDATE samples SET genre = '', genre_is_manual = 0 WHERE genre = ?1 COLLATE NOCASE",
            params![name],
        )
        .map_err(|e| format!("Failed to clear sample genres: {}", e))?;
    }
    tx.execute("DELETE FROM genres WHERE id = ?1", params![genre_id])
        .map_err(|e| format!("Failed to delete genre: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit genre deletion: {}", e))
}

#[tauri::command]
pub fn assign_sample_genre(
    state: State<'_, AppState>,
    sample_id: i64,
    genre_name: String,
) -> Result<String, String> {
    let trimmed = genre_name.trim().to_string();
    let conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    if !is_sample_visible_in_profile(&conn, active_id, sample_id) {
        return Err("Sample not found in active profile".to_string());
    }
    if !trimmed.is_empty() {
        let color = deterministic_color_for_name(&trimmed);
        let _ = ensure_manual_genre(&conn, &trimmed, color);
    }
    let is_manual = !trimmed.is_empty();
    conn.execute(
        "UPDATE samples SET genre = ?1, genre_is_manual = ?2 WHERE id = ?3",
        params![trimmed, is_manual, sample_id],
    )
    .map_err(|e| format!("Failed to assign genre: {}", e))?;
    Ok(trimmed)
}

#[tauri::command]
pub fn assign_sample_genre_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    genre_name: String,
) -> Result<String, String> {
    let sample_ids = sample_ids.unwrap_or_default();
    let trimmed = genre_name.trim().to_string();
    if sample_ids.is_empty() {
        return Ok(trimmed);
    }
    let mut conn = state.lock_db();
    let active_id = get_active_profile_id(&conn);
    let visible_set = visible_sample_ids_in_profile(&conn, active_id, &sample_ids)?;
    let visible_ids: Vec<i64> = sample_ids
        .into_iter()
        .filter(|sid| visible_set.contains(sid))
        .collect();
    if visible_ids.is_empty() {
        return Ok(trimmed);
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    if !trimmed.is_empty() {
        let color = deterministic_color_for_name(&trimmed);
        let _ = ensure_manual_genre(&tx, &trimmed, color);
    }
    let is_manual = i64::from(!trimmed.is_empty());
    for chunk in visible_ids.chunks(450) {
        let placeholders = (3..=chunk.len() + 2)
            .map(|idx| format!("?{}", idx))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE samples SET genre = ?1, genre_is_manual = ?2 WHERE id IN ({})",
            placeholders
        );
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 2);
        params_vec.push(rusqlite::types::Value::Text(trimmed.clone()));
        params_vec.push(rusqlite::types::Value::Integer(is_manual));
        for sid in chunk {
            params_vec.push(rusqlite::types::Value::Integer(*sid));
        }
        tx.execute(&sql, rusqlite::params_from_iter(params_vec))
            .map_err(|e| format!("Failed to assign genre in batch: {}", e))?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(trimmed)
}

#[tauri::command]
pub async fn auto_detect_library_genres(state: State<'_, AppState>) -> Result<usize, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let candidates: Vec<(i64, String, String)> = {
            let conn = state_owned.lock_db();
            let active_profile_id = get_active_profile_id(&conn);
            let mut stmt = conn
                .prepare(
                    "SELECT s.id, s.file_path, s.file_name
                     FROM samples s
                     WHERE COALESCE(s.is_trashed, 0) = 0
                       AND s.library_id IN (
                           SELECT l.id FROM libraries l
                           WHERE l.is_global = 1
                              OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
                       )",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![active_profile_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.flatten().collect()
        };

        if candidates.is_empty() {
            return Ok(0);
        }

        let detected = extract_embedded_meta_batch(&candidates);

        let mut conn = state_owned.lock_db();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start transaction: {}", e))?;

        let mut unique_genres: HashMap<String, String> = HashMap::new();
        for (_, meta) in &detected {
            let g = meta.genre.trim();
            if !g.is_empty() {
                unique_genres
                    .entry(g.to_lowercase())
                    .or_insert_with(|| g.to_string());
            }
        }
        for (_, g) in unique_genres {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM genres WHERE name = ?1 COLLATE NOCASE)",
                    params![&g],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !exists {
                let color = deterministic_color_for_name(&g);
                tx.execute(
                    "INSERT OR IGNORE INTO genres (name, color, is_manual) VALUES (?1, ?2, 0)",
                    params![g, color],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        let mut genre_count = 0usize;
        {
            let mut upd_stmt = tx
                .prepare(
                    "UPDATE samples
                     SET genre  = CASE WHEN genre_is_manual = 0 AND ?1 != '' THEN ?1 ELSE genre END,
                         artist = CASE WHEN ?2 != '' THEN ?2 ELSE artist END,
                         album  = CASE WHEN ?3 != '' THEN ?3 ELSE album END,
                         year   = CASE WHEN ?4 != '' THEN ?4 ELSE year END
                     WHERE id = ?5",
                )
                .map_err(|e| e.to_string())?;
            for (sid, meta) in detected {
                upd_stmt
                    .execute(params![
                        meta.genre,
                        meta.artist,
                        meta.album,
                        meta.year,
                        sid
                    ])
                    .map_err(|e| e.to_string())?;
                if !meta.genre.is_empty() {
                    genre_count += 1;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(genre_count)
    })
    .await
    .map_err(|e| format!("Genre & metadata detection worker error: {}", e))?
}
