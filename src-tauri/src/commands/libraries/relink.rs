use crate::commands::Library;
use crate::db::{get_active_profile_id, AppState};
use crate::security::{display_leaf, is_safe_library_dir, normalize_clean_path, sanitize_err};
use rusqlite::{params, Connection};
use tauri::{AppHandle, State};

fn strip_prefix_safe<'a>(value: &'a str, prefix_with_slash: &str, prefix_lower: &str, ci: bool) -> Option<&'a str> {
    if ci {
        crate::commands::strip_unicode_prefix_ci(value, prefix_lower)
    } else {
        value.strip_prefix(prefix_with_slash)
    }
}

pub(crate) fn replace_library_prefix(
    raw: &str,
    old_prefix_slash: &str,
    old_prefix_lower: &str,
    norm_new_path: &str,
) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let norm = normalize_clean_path(trimmed);
    let rel_opt = strip_prefix_safe(&norm, old_prefix_slash, old_prefix_lower, cfg!(windows));
    rel_opt.map(|rel| format!("{}/{}", norm_new_path, rel.trim_start_matches('/')))
}

/// Transactionally relinks a moved library folder to `new_path`, updating `libraries.path`,
/// `libraries.name`, and every sample's `file_path` (plus `original_file_path` and `trash_file_path`
/// for quarantined samples) IN-PLACE so sample IDs, Favorites, Collections, Tags, Genres, Session Bin
/// links, and manual BPM/Key overrides remain 100% intact.
pub(crate) fn relink_library_with_conn(
    conn: &mut Connection,
    library_id: i64,
    new_path: &str,
) -> Result<(String, Library), String> {
    let safe_root = is_safe_library_dir(new_path)?;
    let norm_new_path = normalize_clean_path(&safe_root.to_string_lossy());
    let new_name = safe_root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Audio Library")
        .to_string();

    let old_path: String = conn
        .query_row(
            "SELECT path FROM libraries WHERE id = ?1",
            params![library_id],
            |r| r.get(0),
        )
        .map_err(|_| "Library not found".to_string())?;
    let norm_old_path = normalize_clean_path(&old_path);

    let duplicate_other: bool = if cfg!(windows) {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM libraries WHERE id != ?1 AND LOWER(path) = LOWER(?2))",
            params![library_id, norm_new_path],
            |r| r.get(0),
        )
        .unwrap_or(false)
    } else {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM libraries WHERE id != ?1 AND path = ?2)",
            params![library_id, norm_new_path],
            |r| r.get(0),
        )
        .unwrap_or(false)
    };
    if duplicate_other {
        return Err(format!(
            "Another library is already registered at '{}'",
            display_leaf(&safe_root)
        ));
    }

    let sample_rows: Vec<(i64, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, COALESCE(original_file_path, ''), COALESCE(trash_file_path, '')
                 FROM samples WHERE library_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![library_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    let collection_rules: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, rule_path FROM collections WHERE rule_path IS NOT NULL AND rule_path != ''")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    let active_profile_id = get_active_profile_id(conn);
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start relink transaction: {}", e))?;

    tx.execute(
        "UPDATE libraries SET path = ?1, name = ?2, last_scanned_at = datetime('now') WHERE id = ?3",
        params![norm_new_path, new_name, library_id],
    )
    .map_err(|e| format!("Failed to update library path: {}", e))?;

    let old_prefix_slash = if norm_old_path.ends_with('/') {
        norm_old_path.clone()
    } else {
        format!("{}/", norm_old_path)
    };
    let old_prefix_lower = old_prefix_slash.to_lowercase();

    {
        let mut upd_sample = tx
            .prepare(
                "UPDATE samples
                 SET file_path = ?1,
                     original_file_path = ?2,
                     trash_file_path = ?3
                 WHERE id = ?4",
            )
            .map_err(|e| e.to_string())?;

        for (sid, fp, orig_fp, trash_fp) in sample_rows {
            let new_fp = replace_library_prefix(
                &fp,
                &old_prefix_slash,
                &old_prefix_lower,
                &norm_new_path,
            );
            let new_orig_fp = replace_library_prefix(
                &orig_fp,
                &old_prefix_slash,
                &old_prefix_lower,
                &norm_new_path,
            );
            let new_trash_fp = replace_library_prefix(
                &trash_fp,
                &old_prefix_slash,
                &old_prefix_lower,
                &norm_new_path,
            );

            if new_fp.is_some() || new_orig_fp.is_some() || new_trash_fp.is_some() {
                let final_fp = new_fp.unwrap_or(fp);
                let final_orig = if orig_fp.trim().is_empty() {
                    None
                } else {
                    Some(new_orig_fp.unwrap_or(orig_fp))
                };
                let final_trash = if trash_fp.trim().is_empty() {
                    None
                } else {
                    Some(new_trash_fp.unwrap_or(trash_fp))
                };
                upd_sample
                    .execute(params![final_fp, final_orig, final_trash, sid])
                    .map_err(|e| format!("Failed to relink sample {}: {}", sid, e))?;
            }
        }

        let mut upd_col = tx
            .prepare("UPDATE collections SET rule_path = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        let old_root_lower = norm_old_path.to_lowercase();
        for (cid, rp) in collection_rules {
            let norm_rp = normalize_clean_path(&rp);
            let updated_rp = if cfg!(windows) {
                let rp_lower = norm_rp.to_lowercase();
                if rp_lower == old_root_lower {
                    Some(norm_new_path.clone())
                } else {
                    strip_prefix_safe(&norm_rp, &old_prefix_slash, &old_prefix_lower, true).map(
                        |rel| format!("{}/{}", norm_new_path, rel.trim_start_matches('/')),
                    )
                }
            } else if norm_rp == norm_old_path {
                Some(norm_new_path.clone())
            } else {
                norm_rp
                    .strip_prefix(&old_prefix_slash)
                    .map(|rel| format!("{}/{}", norm_new_path, rel.trim_start_matches('/')))
            };

            if let Some(new_rp) = updated_rp {
                let _ = upd_col.execute(params![new_rp, cid]);
            }
        }
    }

    crate::commands::slices::relink_sample_slices_source_prefix(
        &tx,
        &old_prefix_slash,
        &old_prefix_lower,
        &norm_new_path,
    )?;
    crate::commands::slices::relink_sample_slices_path_prefix(
        &tx,
        &old_prefix_slash,
        &old_prefix_lower,
        &norm_new_path,
    )?;
    crate::commands::profiles::path_relink::relink_prefix_in_all_profiles_settings(
        &tx,
        &norm_old_path,
        &norm_new_path,
    )?;

    tx.commit()
        .map_err(|e| format!("Failed to commit relink transaction: {}", e))?;

    let lib = conn
        .query_row(
            "SELECT l.id, l.path, l.name, l.last_scanned_at,
                    (SELECT COUNT(*) FROM samples s WHERE s.library_id = l.id AND COALESCE(s.is_trashed, 0) = 0) AS sample_count,
                    l.is_global,
                    EXISTS(SELECT 1 FROM profile_libraries pl WHERE pl.profile_id = ?2 AND pl.library_id = l.id) AS assigned_to_profile,
                    COALESCE(l.is_read_only, 0)
             FROM libraries l
             WHERE l.id = ?1",
            params![library_id, active_profile_id],
            |row| {
                Ok(Library {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    last_scanned_at: row.get(3)?,
                    sample_count: row.get(4)?,
                    is_global: row.get(5)?,
                    assigned_to_profile: row.get(6)?,
                    is_read_only: row.get(7)?,
                })
            },
        )
        .map_err(|e| format!("Failed to load relinked library: {}", e))?;

    Ok((old_path, lib))
}

#[tauri::command]
pub async fn relink_library_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, crate::ai_tagger::AiTaggerState>,
    library_id: i64,
    new_path: String,
) -> Result<Library, String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let updated_lib = tauri::async_runtime::spawn_blocking(move || {
        let safe_root = is_safe_library_dir(&new_path)
            .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
        crate::security::ensure_not_inside_user_dir(&state_owned.user_dir, &safe_root)?;
        let mut conn = state_owned.lock_db();
        let (old_path, updated_lib) = relink_library_with_conn(&mut conn, library_id, &new_path)
            .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
        crate::reconcile_library_asset_scopes(&app_clone, &conn, Some(&old_path));
        Ok::<Library, String>(updated_lib)
    })
    .await
    .map_err(|e| format!("Relink task failed: {}", e))??;
    ai_state.invalidate_vector_cache();
    Ok(updated_lib)
}