use super::manage::delete_tag_with_conn;
use super::tags::{create_tag_with_options_conn, query_facets_with_conn, query_tags_with_conn};
use crate::audio::extract_embedded_meta_batch;
use crate::commands::Genre;
use crate::db::taxonomy::{facet_domain_in_db, resolve_facet_id_in_db};
use crate::db::{
    ensure_taxonomy_tag, get_active_profile_id, is_sample_visible_in_profile, run_read_query,
    sync_primary_genre_for_samples, sync_primary_genre_for_tag, visible_sample_ids_in_profile,
    AppState,
};
use crate::security::validate_hex_color;
use crate::taxonomy_catalog::{is_canonical_mood_name, sanitize_id3_genre_or_mood_typo};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use tauri::State;

fn tag_to_genre(tag: crate::commands::Tag) -> Genre {
    Genre {
        id: tag.id,
        name: tag.name,
        color: tag.effective_color,
        sample_count: tag.sample_count,
        facet_slug: tag.facet_slug,
    }
}

fn query_genres_with_conn(conn: &Connection) -> Result<Vec<Genre>, String> {
    let genre_facet_ids: HashSet<i64> = query_facets_with_conn(conn)?
        .into_iter()
        .filter(|f| f.domain == "genres")
        .map(|f| f.id)
        .collect();
    let tags = query_tags_with_conn(conn)?;
    let mut genres: Vec<Genre> = tags
        .into_iter()
        .filter(|t| genre_facet_ids.contains(&t.facet_id))
        .map(tag_to_genre)
        .collect();
    genres.sort_by(|a, b| {
        b.sample_count
            .cmp(&a.sample_count)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(genres)
}

#[tauri::command]
pub async fn get_genres(state: State<'_, AppState>) -> Result<Vec<Genre>, String> {
    run_read_query(&state, query_genres_with_conn).await
}

#[tauri::command]
pub async fn create_genre(
    state: State<'_, AppState>,
    name: String,
    color: String,
    facet_slug: Option<String>,
) -> Result<Genre, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Genre name cannot be empty".to_string());
    }
    crate::db::run_write_op(&state, move |conn| {
        let target_facet_owned = match facet_slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(slug) => {
                if let Some(fid) = resolve_facet_id_in_db(conn, slug) {
                    if facet_domain_in_db(conn, fid) == "genres" {
                        slug.to_string()
                    } else {
                        "genre".to_string()
                    }
                } else {
                    "genre".to_string()
                }
            }
            None => {
                if is_canonical_mood_name(&trimmed) {
                    "mood".to_string()
                } else {
                    "genre".to_string()
                }
            }
        };
        let tag = create_tag_with_options_conn(
            conn,
            &trimmed,
            &color,
            Some(&target_facet_owned),
            None,
            Some(false),
            None,
        )?;
        Ok(tag_to_genre(tag))
    })
    .await
}

#[tauri::command]
pub async fn rename_genre(
    state: State<'_, AppState>,
    genre_id: i64,
    new_name: String,
) -> Result<Genre, String> {
    let trimmed = new_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Genre name cannot be empty".to_string());
    }
    crate::db::run_write_op(&state, move |conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start transaction: {}", e))?;

        let conflict: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tags WHERE id != ?1 AND LOWER(name) = LOWER(?2))",
                params![genre_id, trimmed],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if conflict {
            return Err("A genre or tag with that name already exists".to_string());
        }

        tx.execute(
            "UPDATE tags SET name = ?1 WHERE id = ?2",
            params![trimmed, genre_id],
        )
        .map_err(|e| format!("Failed to rename genre: {}", e))?;

        sync_primary_genre_for_tag(&tx, genre_id)?;
        tx.commit()
            .map_err(|e| format!("Failed to commit genre rename: {}", e))?;

        let tag = super::tags::query_tag_by_id_for_profile(conn, genre_id)?;
        Ok(tag_to_genre(tag))
    })
    .await
}

#[tauri::command]
pub async fn update_genre_color(
    state: State<'_, AppState>,
    genre_id: i64,
    new_color: String,
) -> Result<Genre, String> {
    if new_color.trim().is_empty() {
        return Err("Genre color cannot be empty".to_string());
    }
    let clean_color = validate_hex_color(&new_color)?;
    crate::db::run_write_op(&state, move |conn| {
        conn.execute(
            "UPDATE tags SET color = ?1, color_inherited = 0 WHERE id = ?2",
            params![clean_color, genre_id],
        )
        .map_err(|e| format!("Failed to update genre color: {}", e))?;

        let tag = super::tags::query_tag_by_id_for_profile(conn, genre_id)?;
        Ok(tag_to_genre(tag))
    })
    .await
}

#[tauri::command]
pub async fn delete_genre(state: State<'_, AppState>, genre_id: i64) -> Result<(), String> {
    crate::db::run_write_op(&state, move |conn| delete_tag_with_conn(conn, genre_id)).await
}

#[tauri::command]
pub async fn assign_sample_genre(
    state: State<'_, AppState>,
    sample_id: i64,
    genre_name: String,
) -> Result<String, String> {
    let trimmed = genre_name.trim().to_string();
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        if !is_sample_visible_in_profile(conn, active_id, sample_id) {
            return Err("Sample not found in active profile".to_string());
        }
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start genre assignment transaction: {}", e))?;

        if trimmed.is_empty() {
            tx.execute(
                "DELETE FROM sample_tags
                 WHERE sample_id = ?1
                   AND tag_id IN (
                       SELECT t.id FROM tags t
                       INNER JOIN tag_facets f ON f.id = t.facet_id
                       WHERE f.domain = 'genres'
                   )",
                params![sample_id],
            )
            .map_err(|e| format!("Failed to clear genre tags: {}", e))?;
            sync_primary_genre_for_samples(&tx, &[sample_id])?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(String::new());
        }

        let (facet_slug, resolved_name) = match sanitize_id3_genre_or_mood_typo(&trimmed) {
            Some((f, canonical)) => (f, canonical.to_string()),
            None => (
                if is_canonical_mood_name(&trimmed) {
                    "mood"
                } else {
                    "genre"
                },
                trimmed.clone(),
            ),
        };
        let tag_id = ensure_taxonomy_tag(&tx, &resolved_name, Some(facet_slug), None, None, true)?;
        tx.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
             VALUES (?1, ?2, 1, 'manual')
             ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
            params![sample_id, tag_id],
        )
        .map_err(|e| format!("Failed assigning genre tag: {}", e))?;
        sync_primary_genre_for_samples(&tx, &[sample_id])?;
        tx.commit().map_err(|e| e.to_string())?;

        let primary: String = conn
            .query_row("SELECT COALESCE(genre, '') FROM samples WHERE id = ?1", params![sample_id], |r| r.get(0))
            .unwrap_or(resolved_name);
        Ok(primary)
    })
    .await
}

#[tauri::command]
pub async fn assign_sample_genre_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    genre_name: String,
) -> Result<String, String> {
    let sample_ids = sample_ids.unwrap_or_default();
    let trimmed = genre_name.trim().to_string();
    if sample_ids.is_empty() {
        return Ok(trimmed);
    }
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
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

        if trimmed.is_empty() {
            for chunk in visible_ids.chunks(400) {
                let ph = crate::db::sql_in_placeholders(1, chunk.len());
                let sql = format!(
                    "DELETE FROM sample_tags
                     WHERE tag_id IN (
                         SELECT t.id FROM tags t
                         INNER JOIN tag_facets f ON f.id = t.facet_id
                         WHERE f.domain = 'genres'
                     )
                       AND sample_id IN ({})",
                    ph
                );
                let pvals: Vec<rusqlite::types::Value> = chunk
                    .iter()
                    .map(|sid| rusqlite::types::Value::Integer(*sid))
                    .collect();
                tx.execute(&sql, rusqlite::params_from_iter(pvals))
                    .map_err(|e| format!("Failed clearing genres in batch: {}", e))?;
            }
            sync_primary_genre_for_samples(&tx, &visible_ids)?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(String::new());
        }

        let (facet_slug, resolved_name) = match sanitize_id3_genre_or_mood_typo(&trimmed) {
            Some((f, canonical)) => (f, canonical.to_string()),
            None => (
                if is_canonical_mood_name(&trimmed) {
                    "mood"
                } else {
                    "genre"
                },
                trimmed.clone(),
            ),
        };
        let tag_id = ensure_taxonomy_tag(&tx, &resolved_name, Some(facet_slug), None, None, true)?;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                     VALUES (?1, ?2, 1, 'manual')
                     ON CONFLICT(sample_id, tag_id) DO UPDATE SET is_manual = 1, source = 'manual'",
                )
                .map_err(|e| e.to_string())?;
            for &sid in &visible_ids {
                stmt.execute(params![sid, tag_id])
                    .map_err(|e| format!("Failed assigning genre in batch: {}", e))?;
            }
        }
        sync_primary_genre_for_samples(&tx, &visible_ids)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(resolved_name)
    })
    .await
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
        if detected.is_empty() {
            return Ok(0);
        }

        let mut conn = state_owned.lock_db();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start transaction: {}", e))?;

        let mut updated_sample_ids: Vec<i64> = Vec::new();
        let mut detected_count = 0usize;
        {
            let mut upd_stmt = tx
                .prepare(
                    "UPDATE samples
                     SET artist = CASE WHEN ?1 != '' THEN ?1 ELSE artist END,
                         album  = CASE WHEN ?2 != '' THEN ?2 ELSE album END,
                         year   = CASE WHEN ?3 != '' THEN ?3 ELSE year END
                     WHERE id = ?4",
                )
                .map_err(|e| e.to_string())?;
            let mut link_stmt = tx
                .prepare(
                    "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual, source)
                     VALUES (?1, ?2, 0, 'auto_genre')",
                )
                .map_err(|e| e.to_string())?;

            for (sid, meta) in detected {
                let _ = upd_stmt.execute(params![meta.artist, meta.album, meta.year, sid]);
                if !meta.genre_mood_tags.is_empty() {
                    for (facet_slug, name) in &meta.genre_mood_tags {
                        if let Ok(tid) =
                            ensure_taxonomy_tag(&tx, name, Some(facet_slug), None, None, false)
                        {
                            let _ = link_stmt.execute(params![sid, tid]);
                        }
                    }
                    updated_sample_ids.push(sid);
                    detected_count += 1;
                }
            }
        }

        if !updated_sample_ids.is_empty() {
            sync_primary_genre_for_samples(&tx, &updated_sample_ids)?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(detected_count)
    })
    .await
    .map_err(|e| format!("Genre & metadata detection worker error: {}", e))?
}
