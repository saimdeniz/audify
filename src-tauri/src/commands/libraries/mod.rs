pub mod folders;
pub mod mtime_backfill;
pub mod relink;
pub mod sync;
mod sync_commit;

pub use folders::*;
pub use mtime_backfill::*;
pub use relink::*;
pub use sync::*;

use crate::commands::Library;
use crate::db::{get_active_profile_id, run_read_query, AppState};
use crate::security::sanitize_err;
use rusqlite::{params, Connection};
use std::path::Path;
use tauri::{AppHandle, State};

fn query_libraries_with_conn(conn: &Connection) -> Result<Vec<Library>, String> {
    let active_id = get_active_profile_id(conn);

    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.path, l.name, l.last_scanned_at,
                    (SELECT COUNT(*) FROM samples s WHERE s.library_id = l.id AND COALESCE(s.is_trashed, 0) = 0) AS sample_count,
                    l.is_global,
                    EXISTS(SELECT 1 FROM profile_libraries pl WHERE pl.profile_id = ?1 AND pl.library_id = l.id) AS assigned_to_profile,
                    COALESCE(l.is_read_only, 0)
             FROM libraries l
             ORDER BY l.name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![active_id], |row| {
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
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut libs = Vec::new();
    for r in rows {
        libs.push(r.map_err(|e| e.to_string())?);
    }
    Ok(libs)
}

#[tauri::command]
pub async fn get_libraries(state: State<'_, AppState>) -> Result<Vec<Library>, String> {
    run_read_query(&state, query_libraries_with_conn).await
}

#[tauri::command]
pub async fn set_library_read_only(
    state: State<'_, AppState>,
    library_id: i64,
    is_read_only: bool,
) -> Result<Library, String> {
    let state_owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_owned.lock_db();
        let active_id = get_active_profile_id(&conn);

        conn.execute(
            "UPDATE libraries SET is_read_only = ?1 WHERE id = ?2",
            params![is_read_only, library_id],
        )
        .map_err(|e| format!("Failed to update library read-only lock: {}", e))?;

        conn.query_row(
            "SELECT l.id, l.path, l.name, l.last_scanned_at,
                    (SELECT COUNT(*) FROM samples s WHERE s.library_id = l.id AND COALESCE(s.is_trashed, 0) = 0) AS sample_count,
                    l.is_global,
                    EXISTS(SELECT 1 FROM profile_libraries pl WHERE pl.profile_id = ?2 AND pl.library_id = l.id) AS assigned_to_profile,
                    COALESCE(l.is_read_only, 0)
             FROM libraries l
             WHERE l.id = ?1",
            params![library_id, active_id],
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
        .map_err(|e| format!("Failed to load library record: {}", e))
    })
    .await
    .map_err(|e| format!("Update library read-only task failed: {}", e))?
}

#[tauri::command]
pub async fn set_library_profile_scope(
    app: AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, crate::ai_tagger::AiTaggerState>,
    library_id: i64,
    is_global: bool,
    assigned_to_profile: bool,
) -> Result<(), String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_owned.lock_db();
        let active_id = get_active_profile_id(&conn);

        conn.execute(
            "UPDATE libraries SET is_global = ?1 WHERE id = ?2",
            params![is_global, library_id],
        )
        .map_err(|e| format!("Failed to update library global scope: {}", e))?;

        if assigned_to_profile {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO profile_libraries (profile_id, library_id) VALUES (?1, ?2)",
                params![active_id, library_id],
            );
        } else {
            let _ = conn.execute(
                "DELETE FROM profile_libraries WHERE profile_id = ?1 AND library_id = ?2",
                params![active_id, library_id],
            );
        }
        crate::reconcile_library_asset_scopes(&app_clone, &conn, None);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Update library profile scope task failed: {}", e))??;
    ai_state.invalidate_vector_cache();
    Ok(())
}

pub(crate) fn remove_library_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    library_id: i64,
) -> Result<Option<String>, String> {
    let removed_path: Option<String> = conn
        .query_row(
            "SELECT path FROM libraries WHERE id = ?1",
            params![library_id],
            |r| r.get(0),
        )
        .ok();

    // Prevent orphaned quarantine files in `user/trash` when a library is removed:
    // First attempt to restore any trashed samples back to their original library folder;
    // if the library folder was already removed from disk, clean up the leftover quarantine files.
    let trashed_rows: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, COALESCE(trash_file_path, file_path)
                 FROM samples
                 WHERE library_id = ?1 AND COALESCE(is_trashed, 0) = 1",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(params![library_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        mapped.flatten().collect()
    };

    if !trashed_rows.is_empty() {
        let _ = conn.execute(
            "UPDATE libraries SET is_read_only = 0 WHERE id = ?1",
            params![library_id],
        );
        let trashed_ids: Vec<i64> = trashed_rows.iter().map(|(id, _)| *id).collect();
        if crate::commands::file_ops::restore_samples_from_trash_with_conn(
            conn,
            user_dir,
            &trashed_ids,
        )
        .is_err()
        {
            let _ = crate::commands::file_ops::empty_audify_trash_with_conn(
                conn,
                user_dir,
                Some(&trashed_ids),
                true,
            );
        }
    }

    // Drop per-row sample_tags FTS trigger during cascade delete (otherwise deleting a 50k-sample
    // library triggers ~150k redundant FTS updates on rows that `trg_samples_ad` is deleting anyway).
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting library delete transaction: {}", e))?;
    let _ = tx.execute_batch("DROP TRIGGER IF EXISTS trg_sample_tags_ad;");
    tx.execute("DELETE FROM libraries WHERE id = ?1", params![library_id])
        .map_err(|e| format!("Failed to remove library: {}", e))?;
    tx.execute_batch(crate::db::SAMPLE_TAGS_FTS_TRIGGERS_SQL)
        .map_err(|e| format!("Failed restoring tag FTS triggers after library removal: {}", e))?;

    // Clean up orphaned auto-tags and auto-genres while preserving user-created ones!
    let _ = tx.execute(
        "DELETE FROM tags WHERE is_manual = 0 AND id NOT IN (SELECT DISTINCT tag_id FROM sample_tags)",
        [],
    );
    let _ = tx.execute(
        "DELETE FROM genres WHERE is_manual = 0 AND LOWER(name) NOT IN (SELECT DISTINCT LOWER(genre) FROM samples WHERE genre != '')",
        [],
    );
    tx.commit()
        .map_err(|e| format!("Failed committing library removal: {}", e))?;

    Ok(removed_path)
}

#[tauri::command]
pub async fn remove_library(
    app: AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, crate::ai_tagger::AiTaggerState>,
    library_id: i64,
) -> Result<(), String> {
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state_owned.lock_db();
        let removed_path = remove_library_with_conn(&mut conn, &state_owned.user_dir, library_id)?;
        crate::reconcile_library_asset_scopes(&app_clone, &conn, removed_path.as_deref());
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Library removal task failed: {}", e)))??;
    ai_state.invalidate_vector_cache();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;
    use crate::security::normalize_clean_path;

    #[test]
    fn relink_library_preserves_sample_ids_favorites_collections_tags_and_bpm_key() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();
        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('Whoosh', '#F59E0B', 1)",
            [],
        )
        .unwrap();
        let tag_id: i64 = conn.last_insert_rowid();

        let root_temp =
            std::env::temp_dir().join(format!("audify_relink_test_{}", std::process::id()));
        let new_lib_dir = root_temp.join("Moved_SFX_Pack");
        std::fs::create_dir_all(new_lib_dir.join("Whooshes")).unwrap();

        let old_lib_path = "D:/OldDrive/My_SFX_Pack";
        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'My_SFX_Pack', 1)",
            params![old_lib_path],
        )
        .unwrap();
        let lib_id: i64 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, bpm, musical_key, camelot_key, bpm_is_manual, key_is_manual)
             VALUES (?1, ?2, 'swish_01.wav', 'wav', 1200, 128.0, 'Am', '8A', 1, 1)",
            params![lib_id, "D:/OldDrive/My_SFX_Pack/Whooshes/swish_01.wav"],
        )
        .unwrap();
        let sample_id: i64 = conn.last_insert_rowid();

        let active_profile_id = get_active_profile_id(&conn);
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
            params![active_profile_id, sample_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, ?2, 1)",
            params![sample_id, tag_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO collections (profile_id, name, rule_path) VALUES (?1, 'Whooshes', ?2)",
            params![active_profile_id, "D:/OldDrive/My_SFX_Pack/Whooshes"],
        )
        .unwrap();
        let col_id: i64 = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO collection_items (collection_id, sample_id) VALUES (?1, ?2)",
            params![col_id, sample_id],
        )
        .unwrap();

        let new_path_str = new_lib_dir.to_string_lossy().to_string();
        let (returned_old, updated_lib) =
            relink_library_with_conn(&mut conn, lib_id, &new_path_str).unwrap();

        assert_eq!(returned_old, old_lib_path);
        assert_eq!(updated_lib.id, lib_id);
        assert_eq!(updated_lib.name, "Moved_SFX_Pack");
        assert_eq!(updated_lib.sample_count, 1);

        let (db_fp, bpm, m_key, c_key): (String, Option<f64>, String, String) = conn
            .query_row(
                "SELECT file_path, bpm, musical_key, camelot_key FROM samples WHERE id = ?1",
                params![sample_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        let is_fav: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM profile_favorites WHERE profile_id = ?1 AND sample_id = ?2)",
                params![active_profile_id, sample_id],
                |r| r.get(0),
            )
            .unwrap();

        let norm_new_root = normalize_clean_path(&new_lib_dir.canonicalize().unwrap().to_string_lossy());
        assert_eq!(db_fp, format!("{}/Whooshes/swish_01.wav", norm_new_root));
        assert!(is_fav);
        assert_eq!(bpm, Some(128.0));
        assert_eq!(m_key, "Am");
        assert_eq!(c_key, "8A");

        let tag_links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
                params![sample_id, tag_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tag_links, 1);

        let col_links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_items WHERE collection_id = ?1 AND sample_id = ?2",
                params![col_id, sample_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(col_links, 1);

        let updated_rule_path: String = conn
            .query_row(
                "SELECT rule_path FROM collections WHERE id = ?1",
                params![col_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(updated_rule_path, format!("{}/Whooshes", norm_new_root));

        let _ = std::fs::remove_dir_all(&root_temp);
    }

    #[test]
    fn preview_license_group_samples_matches_explicit_and_rel_folders_respecting_limit() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();

        let lib_path = "C:/Samples/CC_Pack";
        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'CC_Pack', 1)",
            params![lib_path],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        for (fp, name, trashed) in [
            ("C:/Samples/CC_Pack/ArtistA/Hit_02.wav", "Hit_02.wav", 0),
            ("C:/Samples/CC_Pack/ArtistA/Hit_01.wav", "Hit_01.wav", 0),
            ("C:/Samples/CC_Pack/ArtistA/Sub/Hit_03.wav", "Hit_03.wav", 0),
            ("C:/Samples/CC_Pack/ArtistA/Trashed.wav", "Trashed.wav", 1),
            ("C:/Samples/CC_Pack/ArtistAB/Other.wav", "Other.wav", 0),
        ] {
            conn.execute(
                "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, is_trashed)
                 VALUES (?1, ?2, ?3, 'wav', 500, ?4)",
                params![lib_id, fp, name, trashed],
            )
            .unwrap();
        }

        let explicit = folders::preview_license_group_samples_with_conn(
            &conn,
            &["C:/Samples/CC_Pack/ArtistA".to_string()],
            &[],
            2,
        )
        .unwrap();
        assert_eq!(explicit, vec!["Hit_01.wav", "Hit_02.wav"]);

        let portable = folders::preview_license_group_samples_with_conn(
            &conn,
            &[],
            &["ArtistA".to_string()],
            10,
        )
        .unwrap();
        // Should match ArtistA and ArtistA/Sub, never ArtistAB or trashed files
        assert_eq!(portable, vec!["Hit_01.wav", "Hit_02.wav", "Hit_03.wav"]);
    }
}