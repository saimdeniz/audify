use super::slices_bundle::{
    is_safe_snapshot_image_entry, is_safe_snapshot_slice_entry,
    is_safe_snapshot_slice_trash_entry, relink_restored_custom_bg_paths,
    relink_restored_slice_paths, stream_extracted_nested_wav, write_extracted_nested_file,
    MAX_SNAPSHOT_SLICES_COUNT, MAX_SNAPSHOT_SLICE_FILE_BYTES, MAX_SNAPSHOT_TOTAL_SLICES_BYTES,
};
use super::{
    copy_bounded_from_zip, open_validated_snapshot_archive, unique_nanos, TempPathGuard,
    MAX_SNAPSHOT_DB_UNCOMPRESSED_BYTES, MAX_SNAPSHOT_IMAGES_COUNT,
    MAX_SNAPSHOT_TOTAL_IMAGES_BYTES, SNAPSHOT_DB_ENTRY,
};
use crate::commands::{query_profile_by_id, FullSnapshotRestoreResult};
use crate::db::init_schema_on_conn;
use crate::security::{
    detect_image_magic, ensure_not_inside_user_dir, has_ntfs_ads_colon,
    is_forbidden_os_or_root_path, is_unc_or_network_path, is_valid_collection_icon, sanitize_err,
    sanitize_hex_color_or_default, whitelist_and_sanitize_settings, MAX_CUSTOM_BG_BYTES,
};
use rusqlite::config::DbConfig;
use rusqlite::{params, Connection, OpenFlags};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::Path;
use std::time::Duration;
use zip::ZipArchive;

fn validate_staged_sqlite_db(staging_db: &Path, user_dir: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(staging_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Restored archive does not contain a valid SQLite DB: {}", e))?;
    let _ = conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true);
    let _ = conn.execute_batch("PRAGMA trusted_schema = OFF;");

    let check: String = conn
        .query_row("PRAGMA quick_check(1)", [], |r| r.get(0))
        .map_err(|e| format!("Snapshot database integrity check failed: {}", e))?;
    if !check.eq_ignore_ascii_case("ok") {
        return Err(format!("Snapshot database failed integrity check: {}", check));
    }

    for required_table in [
        "profiles",
        "libraries",
        "samples",
        "tags",
        "sample_tags",
        "collections",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![required_table],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists != 1 {
            return Err(format!(
                "Snapshot database is missing required '{}' table",
                required_table
            ));
        }
    }

    let profile_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))
        .unwrap_or(0);
    if profile_count < 1 {
        return Err("Snapshot database contains no profiles".to_string());
    }

    // Reject foreign views or unknown triggers in staged snapshot DBs before copying over live DB.
    let foreign_obj: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master
             WHERE (type = 'view')
                OR (type = 'trigger' AND name NOT IN (
                    'trg_samples_ai', 'trg_samples_ad', 'trg_samples_au',
                    'trg_sample_tags_ai', 'trg_sample_tags_ad', 'trg_tags_au'
                ))
             LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if foreign_obj.is_some() {
        return Err("Snapshot database contains unsupported views or triggers".to_string());
    }

    // Reject snapshot DBs carrying unsafe library paths (UNC, ADS colons, forbidden OS/root folders, or inside user_dir).
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM libraries") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for raw_lib in rows.flatten() {
                let trimmed = raw_lib.trim();
                if trimmed.is_empty()
                    || is_unc_or_network_path(trimmed)
                    || has_ntfs_ads_colon(trimmed)
                    || is_forbidden_os_or_root_path(trimmed)
                    || ensure_not_inside_user_dir(user_dir, Path::new(trimmed)).is_err()
                {
                    return Err(
                        "Snapshot database contains unsafe or forbidden library path".to_string(),
                    );
                }
            }
        }
    }

    Ok(conn)
}

fn sanitize_restored_snapshot_db(conn: &mut Connection) {
    let Ok(tx) = conn.transaction() else {
        return;
    };
    if let Ok(mut stmt) = tx.prepare("SELECT id, color, settings_json FROM profiles") {
        let rows: Vec<(i64, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect();
        drop(stmt);
        for (pid, color, raw_settings) in rows {
            let safe_color = sanitize_hex_color_or_default(&color, "#38BDF8");
            let parsed = serde_json::from_str::<serde_json::Value>(&raw_settings)
                .unwrap_or_else(|_| serde_json::json!({}));
            let sanitized_settings = whitelist_and_sanitize_settings(&parsed, false, false)
                .unwrap_or_else(|_| serde_json::json!({}));
            let safe_json =
                serde_json::to_string(&sanitized_settings).unwrap_or_else(|_| "{}".to_string());
            let _ = tx.execute(
                "UPDATE profiles SET color = ?1, settings_json = ?2 WHERE id = ?3",
                params![safe_color, safe_json, pid],
            );
        }
    }

    for (table, default_hex) in [("tags", "#3B82F6"), ("genres", "#8B5CF6")] {
        let query = format!("SELECT id, color FROM {}", table);
        if let Ok(mut stmt) = tx.prepare(&query) {
            let rows: Vec<(i64, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .collect();
            drop(stmt);
            let update_sql = format!("UPDATE {} SET color = ?1 WHERE id = ?2", table);
            for (id, color) in rows {
                let safe_color = sanitize_hex_color_or_default(&color, default_hex);
                let _ = tx.execute(&update_sql, params![safe_color, id]);
            }
        }
    }

    if let Ok(mut stmt) = tx.prepare("SELECT id, color, icon, rule_path FROM collections") {
        let rows: Vec<(i64, String, String, Option<String>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect();
        drop(stmt);
        for (cid, color, icon, rule_path) in rows {
            let safe_color = sanitize_hex_color_or_default(&color, "#10B981");
            let safe_icon = if is_valid_collection_icon(&icon) {
                icon.trim().to_string()
            } else {
                "layers".to_string()
            };
            let safe_rule_path = rule_path.and_then(|rp| {
                let t = rp.trim();
                if t.is_empty()
                    || is_unc_or_network_path(t)
                    || has_ntfs_ads_colon(t)
                    || is_forbidden_os_or_root_path(t)
                {
                    None
                } else {
                    Some(t.to_string())
                }
            });
            let _ = tx.execute(
                "UPDATE collections SET color = ?1, icon = ?2, rule_path = ?3 WHERE id = ?4",
                params![safe_color, safe_icon, safe_rule_path, cid],
            );
        }
    }
    let _ = tx.commit();
}

struct PreparedSnapshotArchive {
    archive: ZipArchive<BufReader<File>>,
    _staging_guard: TempPathGuard,
    staging_conn: Connection,
}

fn prepare_snapshot_archive_for_restore(
    user_dir: &Path,
    archive_path: &Path,
) -> Result<PreparedSnapshotArchive, String> {
    let (mut archive, _manifest) = open_validated_snapshot_archive(archive_path)?;

    let cache_dir = user_dir.join("cache");
    fs::create_dir_all(&cache_dir).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    let staging_db = cache_dir.join(format!(
        ".restore_stage_{}_{}.db",
        std::process::id(),
        unique_nanos()
    ));
    let staging_guard = TempPathGuard(staging_db.clone());
    {
        let db_entry = archive
            .by_name(SNAPSHOT_DB_ENTRY)
            .map_err(|_| "Snapshot archive is missing samples.db".to_string())?;
        let mut out_db = File::create(&staging_db)
            .map_err(|e| format!("Failed to stage restored database: {}", e))?;
        copy_bounded_from_zip(
            db_entry,
            &mut out_db,
            MAX_SNAPSHOT_DB_UNCOMPRESSED_BYTES,
            "samples.db",
        )?;
    }

    let staging_conn = validate_staged_sqlite_db(&staging_db, user_dir)?;
    Ok(PreparedSnapshotArchive {
        archive,
        _staging_guard: staging_guard,
        staging_conn,
    })
}

fn extract_snapshot_media_assets(
    archive: &mut ZipArchive<BufReader<File>>,
    user_dir: &Path,
) -> Result<(usize, usize), String> {
    let images_dir = user_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    let slices_dir = user_dir.join("slices");
    fs::create_dir_all(&slices_dir).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;
    let slice_trash_dir = user_dir.join("cache").join("slice_trash");

    let mut restored_images = 0usize;
    let mut restored_slices = 0usize;
    let mut total_restored_img_bytes: u64 = 0;
    let mut total_restored_slice_bytes: u64 = 0;
    for idx in 0..archive.len() {
        let Ok(entry) = archive.by_index(idx) else {
            continue;
        };
        if entry.is_dir() || entry.is_symlink() {
            continue;
        }
        if let Some(rel_img_path) = is_safe_snapshot_image_entry(entry.name()) {
            if restored_images >= MAX_SNAPSHOT_IMAGES_COUNT
                || entry.size() > MAX_CUSTOM_BG_BYTES
                || total_restored_img_bytes.saturating_add(entry.size())
                    > MAX_SNAPSHOT_TOTAL_IMAGES_BYTES
            {
                continue;
            }
            let mut img_bytes = Vec::with_capacity(entry.size() as usize);
            if copy_bounded_from_zip(entry, &mut img_bytes, MAX_CUSTOM_BG_BYTES, "image").is_err() {
                continue;
            }
            if total_restored_img_bytes.saturating_add(img_bytes.len() as u64)
                > MAX_SNAPSHOT_TOTAL_IMAGES_BYTES
                || detect_image_magic(&img_bytes).is_none()
            {
                continue;
            }
            if write_extracted_nested_file(&images_dir, &rel_img_path, &img_bytes) {
                total_restored_img_bytes =
                    total_restored_img_bytes.saturating_add(img_bytes.len() as u64);
                restored_images += 1;
            }
        } else if let Some((target_base_dir, rel_slice_path)) =
            is_safe_snapshot_slice_entry(entry.name())
                .map(|rel| (&slices_dir, rel))
                .or_else(|| {
                    is_safe_snapshot_slice_trash_entry(entry.name()).map(|rel| (&slice_trash_dir, rel))
                })
        {
            if restored_slices >= MAX_SNAPSHOT_SLICES_COUNT
                || entry.size() > MAX_SNAPSHOT_SLICE_FILE_BYTES
            {
                continue;
            }
            let remaining_budget =
                MAX_SNAPSHOT_TOTAL_SLICES_BYTES.saturating_sub(total_restored_slice_bytes);
            if remaining_budget < 12 || entry.size() > remaining_budget {
                continue;
            }
            if !target_base_dir.is_dir() && fs::create_dir_all(target_base_dir).is_err() {
                continue;
            }
            let cap = MAX_SNAPSHOT_SLICE_FILE_BYTES.min(remaining_budget);
            if let Some(written) =
                stream_extracted_nested_wav(target_base_dir, &rel_slice_path, entry, cap)
            {
                total_restored_slice_bytes = total_restored_slice_bytes.saturating_add(written);
                restored_slices += 1;
            }
        }
    }
    Ok((restored_images, restored_slices))
}

fn apply_staged_db_backup(conn: &mut Connection, staging_conn: &Connection) -> Result<(), String> {
    if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK;");
    }
    {
        let backup = rusqlite::backup::Backup::new(staging_conn, conn)
            .map_err(|e| format!("Failed to initialize SQLite snapshot restore: {}", e))?;
        backup
            .run_to_completion(512, Duration::from_millis(5), None)
            .map_err(|e| format!("Failed to restore SQLite database: {}", e))?;
    }
    if let Ok(mut stmt) = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'") {
        let triggers: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect();
        drop(stmt);
        for trg in triggers {
            let escaped = trg.replace('"', "\"\"");
            let _ = conn.execute_batch(&format!("DROP TRIGGER IF EXISTS \"{}\";", escaped));
        }
    }
    init_schema_on_conn(conn)?;
    sanitize_restored_snapshot_db(conn);
    Ok(())
}

fn finalize_restored_snapshot_conn(
    conn: &Connection,
    user_dir: &Path,
    restored_images: usize,
    restored_slices: usize,
) -> Result<FullSnapshotRestoreResult, String> {
    relink_restored_custom_bg_paths(conn, user_dir);
    relink_restored_slice_paths(conn, user_dir);

    let active_id = crate::db::get_active_profile_id(conn);
    let active_profile = query_profile_by_id(conn, active_id)?;
    let profile_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))
        .unwrap_or(1);
    let sample_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM samples WHERE COALESCE(is_trashed, 0) = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let tag_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
        .unwrap_or(0);
    let collection_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
        .unwrap_or(0);

    Ok(FullSnapshotRestoreResult {
        active_profile,
        profile_count,
        sample_count,
        tag_count,
        collection_count,
        restored_images,
        restored_slices,
    })
}

/// Restores a snapshot with `lock_db()` held ONLY during SQLite backup/relink, keeping heavy
/// ZIP decompression, integrity checks, and streaming image/slice extraction off the DB lock.
pub(crate) fn restore_full_snapshot_with_state(
    state: &crate::db::AppState,
    archive_path: &Path,
) -> Result<FullSnapshotRestoreResult, String> {
    let mut prepared = prepare_snapshot_archive_for_restore(&state.user_dir, archive_path)?;
    {
        let mut conn = state.lock_db();
        apply_staged_db_backup(&mut conn, &prepared.staging_conn)?;
    }
    drop(prepared.staging_conn);
    let (restored_images, restored_slices) =
        extract_snapshot_media_assets(&mut prepared.archive, &state.user_dir)?;
    let conn = state.lock_db();
    finalize_restored_snapshot_conn(&conn, &state.user_dir, restored_images, restored_slices)
}

/// Validates a `.audify-backup.zip` archive and atomically restores SQLite + wallpaper images + slices
/// over the live database connection via `rusqlite::backup::Backup`.
#[cfg(test)]
pub(crate) fn restore_full_snapshot_with_conn(
    conn: &mut Connection,
    user_dir: &Path,
    archive_path: &Path,
) -> Result<FullSnapshotRestoreResult, String> {
    let mut prepared = prepare_snapshot_archive_for_restore(user_dir, archive_path)?;
    apply_staged_db_backup(conn, &prepared.staging_conn)?;
    drop(prepared.staging_conn);
    let (restored_images, restored_slices) =
        extract_snapshot_media_assets(&mut prepared.archive, user_dir)?;
    finalize_restored_snapshot_conn(conn, user_dir, restored_images, restored_slices)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::snapshot::{
        read_snapshot_manifest_summary, stage_snapshot_db_and_manifest, write_staged_snapshot_zip,
    };
    use crate::db::{init_db, open_read_conn};
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    struct TestDir(PathBuf);
    impl TestDir {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "audify_snap_test_{}_{}_{}",
                name,
                std::process::id(),
                unique_nanos()
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn full_snapshot_roundtrip_preserves_wal_read_conn_and_ai_data() {
        let tmp = TestDir::new("rt");
        let user_dir = tmp.0.join("user");
        let mut conn = init_db(&user_dir).expect("init db");

        conn.execute(
            "INSERT INTO libraries (path, name) VALUES ('D:/Packs', 'Packs')",
            [],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, 'D:/Packs/kick.wav', 'kick.wav', 'wav', 320, 44100)",
            params![lib_id],
        )
        .unwrap();
        let sid = conn.last_insert_rowid();
        let active_pid: i64 = conn
            .query_row("SELECT id FROM profiles WHERE is_active = 1 LIMIT 1", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id)
             VALUES (?1, ?2)",
            params![active_pid, sid],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('Punch', '#F59E0B', 1)",
            [],
        )
        .unwrap();
        let tid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'ai_approved')",
            params![sid, tid],
        )
        .unwrap();
        let vec_blob = vec![0u8; 512];
        conn.execute(
            "INSERT INTO sample_embeddings (sample_id, model_id, dim, vector) VALUES (?1, 'yamnet', 128, ?2)",
            params![sid, vec_blob],
        )
        .unwrap();

        let images_dir = user_dir.join("images");
        let nested_bg_dir = images_dir.join("custom").join("sub");
        fs::create_dir_all(&nested_bg_dir).unwrap();
        fs::write(images_dir.join("bg.png"), b"\x89PNG\r\n\x1a\nfake").unwrap();
        let nested_bg = nested_bg_dir.join("nested.png");
        fs::write(&nested_bg, b"\x89PNG\r\n\x1a\nnested").unwrap();
        let slices_dir = user_dir.join("slices");
        fs::create_dir_all(&slices_dir).unwrap();
        let slice_file = slices_dir.join("kick_cut.wav");
        fs::write(&slice_file, b"RIFF\x24\x00\x00\x00WAVEfmt ").unwrap();

        let personal_bg_str =
            "C:/Users/old_pc/AppData/Roaming/Audify/user/images/custom/sub/nested.png".to_string();
        let settings_val = serde_json::json!({
            "customBgImage": personal_bg_str,
            "customSliceExportPath": "C:/Users/old_pc/Music/Slices"
        });
        conn.execute(
            "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
            params![serde_json::to_string(&settings_val).unwrap(), active_pid],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sample_slices (profile_id, slice_path, slice_name, source_sample_id, source_file_path, source_file_name, start_sec, end_sec, pitch_semitones, micro_fade, duration_ms)
             VALUES (?1, 'C:/Users/old_pc/AppData/Roaming/Audify/user/slices/kick_cut.wav', 'kick_cut.wav', ?2, 'D:/Packs/kick.wav', 'kick.wav', 0.0, 0.25, 0.0, 1, 250)",
            params![active_pid, sid],
        )
        .unwrap();

        let snap_path = tmp.0.join("studio.audify-backup.zip");
        let staged = stage_snapshot_db_and_manifest(&conn, &user_dir).unwrap();
        assert_eq!(staged.manifest.sample_count, 1);
        assert_eq!(staged.manifest.image_count, 2);
        assert_eq!(staged.manifest.slice_count, 1);
        write_staged_snapshot_zip(
            &staged.staging_guard.0,
            &staged.manifest,
            &staged.asset_entries,
            &snap_path,
        )
        .unwrap();
        drop(staged);

        // Mutate live DB (delete sample & embedding & remove images/slices) while holding open WAL reader!
        let reader = open_read_conn(&user_dir).expect("open WAL reader");
        let pre_cnt: i64 = reader
            .query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pre_cnt, 1);

        conn.execute("DELETE FROM samples", []).unwrap();
        conn.execute("DELETE FROM sample_slices", []).unwrap();
        fs::remove_dir_all(&images_dir).unwrap();
        fs::remove_dir_all(&slices_dir).unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
                .unwrap(),
            0
        );

        // Restore live DB snapshot while read-only WAL connection stays open!
        let restored = restore_full_snapshot_with_conn(&mut conn, &user_dir, &snap_path)
            .expect("restore snapshot");
        assert_eq!(restored.sample_count, 1);
        assert_eq!(restored.restored_images, 2);
        assert_eq!(restored.restored_slices, 1);
        assert!(images_dir.join("bg.png").is_file());
        assert!(nested_bg.is_file());
        assert!(slice_file.is_file());
        // Nested customBgImage relinks to local restored path instead of being wiped
        assert!(!restored.active_profile.settings_json.contains("\"customBgImage\":\"\""));
        assert!(restored.active_profile.settings_json.contains("nested.png"));
        let post_reader_cnt: i64 = reader
            .query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
            .unwrap();
        assert_eq!(post_reader_cnt, 1);
        drop(reader);
        let emb_cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM sample_embeddings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(emb_cnt, 1);
        let fav_cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM profile_favorites WHERE sample_id = ?1", params![sid], |r| r.get(0))
            .unwrap();
        assert_eq!(fav_cnt, 1);
    }

    #[test]
    fn snapshot_restore_rejects_zip_slip_and_unexpected_entries() {
        let tmp = TestDir::new("evil");
        let user_dir = tmp.0.join("user");
        let mut conn = init_db(&user_dir).expect("init db");

        let evil_zip = tmp.0.join("evil.audify-backup.zip");
        {
            let f = File::create(&evil_zip).unwrap();
            let mut zip = ZipWriter::new(f);
            let opts = SimpleFileOptions::default();
            zip.start_file("../escape.txt", opts).unwrap();
            zip.write_all(b"pwned").unwrap();
            zip.finish().unwrap();
        }
        assert!(read_snapshot_manifest_summary(&evil_zip).is_err());
        assert!(restore_full_snapshot_with_conn(&mut conn, &user_dir, &evil_zip).is_err());
    }
}
