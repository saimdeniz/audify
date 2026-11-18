use super::archive_pkg::{read_profile_package_from_path, PROFILE_ARCHIVE_SUFFIXES};
use super::import_relations::restore_imported_profile_relations;
use super::path_relink::relink_imported_settings_paths;
use crate::commands::{query_profile_by_id, ImportProfileResult};
use crate::db::deterministic_color_for_name;
use crate::security::{
    is_safe_library_dir, is_unc_or_network_path, normalize_clean_path,
    sanitize_hex_color_or_default, strip_verbatim_prefix, validate_archive_import_path,
    whitelist_and_sanitize_settings,
};
use rusqlite::{params, Connection, Transaction};

fn paths_equal_platform(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

fn find_existing_library_id(tx: &Transaction<'_>, canonical_norm_path: &str) -> Option<i64> {
    let direct: Option<i64> = if cfg!(windows) {
        tx.query_row(
            "SELECT id FROM libraries WHERE LOWER(path) = LOWER(?1) LIMIT 1",
            params![canonical_norm_path],
            |r| r.get(0),
        )
        .ok()
    } else {
        tx.query_row(
            "SELECT id FROM libraries WHERE path = ?1 LIMIT 1",
            params![canonical_norm_path],
            |r| r.get(0),
        )
        .ok()
    };
    if direct.is_some() {
        return direct;
    }

    // Fallback: match existing libraries stored via non-canonical aliases (e.g., Windows 8.3 RUNNER~1 short paths)
    let mut stmt = tx.prepare("SELECT id, path FROM libraries").ok()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .ok()?;
    for (id, raw_existing) in rows.flatten() {
        let trimmed = raw_existing.trim();
        if trimmed.is_empty() || is_unc_or_network_path(trimmed) {
            continue;
        }
        if let Ok(canon) = std::fs::canonicalize(trimmed) {
            let clean = strip_verbatim_prefix(&canon);
            let existing_norm = normalize_clean_path(&clean.to_string_lossy());
            if paths_equal_platform(&existing_norm, canonical_norm_path) {
                return Some(id);
            }
        }
    }
    None
}

pub(crate) fn import_profile_from_file_with_conn(
    conn: &mut Connection,
    file_path: &str,
) -> Result<ImportProfileResult, String> {
    let validated_path = validate_archive_import_path(
        file_path,
        PROFILE_ARCHIVE_SUFFIXES,
        "Import file must be a .audify-profile or .json profile package",
    )?;
    let pkg = read_profile_package_from_path(&validated_path)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    let _ = tx.execute("UPDATE profiles SET is_active = 0", []);

    let base_name = if pkg.name.trim().is_empty() {
        "Imported Profile".to_string()
    } else {
        pkg.name.trim().to_string()
    };

    let mut final_name = base_name.clone();
    let mut suffix = 2;
    while tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM profiles WHERE name = ?1)",
            params![final_name],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(false)
    {
        final_name = format!("{} ({})", base_name, suffix);
        suffix += 1;
    }

    let mut imported_settings = whitelist_and_sanitize_settings(&pkg.settings, true, false)
        .unwrap_or_else(|_| serde_json::json!({}));

    let safe_profile_color = sanitize_hex_color_or_default(&pkg.color, "#3B82F6");
    let settings_json =
        serde_json::to_string(&imported_settings).unwrap_or_else(|_| "{}".to_string());
    tx.execute(
        "INSERT INTO profiles (name, color, settings_json, is_active, created_at)
         VALUES (?1, ?2, ?3, 1, datetime('now'))",
        params![final_name, safe_profile_color, settings_json],
    )
    .map_err(|e| format!("Failed to insert imported profile: {}", e))?;

    let new_profile_id = tx.last_insert_rowid();

    for t in &pkg.tags {
        let tname = t.name.trim();
        if tname.is_empty() || tname.chars().count() > 64 {
            continue;
        }
        let is_man = pkg.manual_tag_ref_indices.contains_key(tname)
            || pkg.ai_approved_tag_ref_indices.contains_key(tname)
            || pkg.manual_tag_samples.contains_key(tname)
            || pkg.manual_tag_assignments.contains_key(tname);
        let safe_tag_color =
            sanitize_hex_color_or_default(&t.color, deterministic_color_for_name(tname));
        tx.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET
                color = excluded.color,
                is_manual = CASE WHEN tags.is_manual = 1 OR excluded.is_manual = 1 THEN 1 ELSE 0 END",
            params![tname, safe_tag_color, is_man],
        )
        .map_err(|e| format!("Failed restoring imported tag: {}", e))?;
    }

    for g in &pkg.genres {
        let gname = g.name.trim();
        if gname.is_empty() || gname.chars().count() > 64 {
            continue;
        }
        let is_man = pkg.manual_genre_ref_indices.contains_key(gname)
            || pkg.manual_genre_assignments.contains_key(gname);
        let safe_genre_color =
            sanitize_hex_color_or_default(&g.color, deterministic_color_for_name(gname));
        tx.execute(
            "INSERT INTO genres (name, color, is_manual) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET
                color = excluded.color,
                is_manual = CASE WHEN genres.is_manual = 1 OR excluded.is_manual = 1 THEN 1 ELSE 0 END",
            params![gname, safe_genre_color, is_man],
        )
        .map_err(|e| format!("Failed restoring imported genre: {}", e))?;
    }

    // Security Hardening: ONLY insert libraries that pass `is_safe_library_dir` locally!
    for lib in &pkg.libraries {
        if let Ok(safe_dir) = is_safe_library_dir(&lib.path) {
            let norm_path = normalize_clean_path(&safe_dir.to_string_lossy());
            let lib_name = {
                let t = lib.name.trim();
                if t.is_empty() { "Audio Library" } else { t }
            };
            let existing_id = find_existing_library_id(&tx, &norm_path);

            let lib_id = match existing_id {
                Some(id) => id,
                None => {
                    tx.execute(
                        "INSERT INTO libraries (path, name, last_scanned_at, is_global, is_read_only)
                         VALUES (?1, ?2, datetime('now'), ?3, ?4)
                         ON CONFLICT(path) DO NOTHING",
                        params![norm_path, lib_name, lib.is_global, lib.is_read_only],
                    )
                    .map_err(|e| format!("Failed restoring library record: {}", e))?;
                    tx.query_row(
                        "SELECT id FROM libraries WHERE path = ?1",
                        params![norm_path],
                        |r| r.get(0),
                    )
                    .unwrap_or(0)
                }
            };

            if lib_id > 0 {
                tx.execute(
                    "INSERT OR IGNORE INTO profile_libraries (profile_id, library_id) VALUES (?1, ?2)",
                    params![new_profile_id, lib_id],
                )
                .map_err(|e| format!("Failed linking library to imported profile: {}", e))?;
            }
        }
    }

    let mut current_lib_paths: Vec<String> = Vec::new();
    if let Ok(mut l_stmt) = tx.prepare("SELECT path FROM libraries") {
        if let Ok(l_rows) = l_stmt.query_map([], |r| r.get::<_, String>(0)) {
            current_lib_paths.extend(l_rows.flatten().map(|p| normalize_clean_path(&p)));
        }
    }

    let pkg_lib_paths: Vec<String> = pkg
        .libraries
        .iter()
        .filter(|l| !is_unc_or_network_path(&l.path))
        .map(|l| normalize_clean_path(&l.path))
        .collect();

    let mut updated_settings = relink_imported_settings_paths(
        &mut imported_settings,
        &pkg_lib_paths,
        &current_lib_paths,
    );

    let (report, resolved_bin_ids) =
        restore_imported_profile_relations(&tx, new_profile_id, &pkg, &current_lib_paths)?;

    if !pkg.bin_sample_indices.is_empty() {
        if let Some(obj) = imported_settings.as_object_mut() {
            obj.insert(
                "binSampleIds".to_string(),
                serde_json::to_value(&resolved_bin_ids).unwrap_or_default(),
            );
            updated_settings = true;
        }
    }

    if updated_settings {
        let final_settings_json =
            serde_json::to_string(&imported_settings).unwrap_or_else(|_| "{}".to_string());
        tx.execute(
            "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
            params![final_settings_json, new_profile_id],
        )
        .map_err(|e| format!("Failed saving relinked profile settings: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit profile import transaction: {}", e))?;

    let profile = query_profile_by_id(conn, new_profile_id)?;
    Ok(ImportProfileResult { profile, report })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::profiles::archive_pkg::write_profile_package_to_path;
    use crate::commands::profiles::export_pkg::build_profile_export_package_with_options;
    use crate::db::{get_active_profile_id, init_db};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn profile_import_matches_existing_non_canonical_library_path() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // Intentionally use uncanonicalized std::env::temp_dir() to exercise 8.3 short-path parity on CI
        let root = std::env::temp_dir().join(format!(
            "audify_import_canon_test_{}_{}",
            std::process::id(),
            nanos
        ));
        let user_dir = root.join("user");
        let lib_dir = root.join("ScopedLib");
        fs::create_dir_all(&lib_dir).unwrap();
        let wav = lib_dir.join("kick.wav");
        fs::write(&wav, b"RIFF0000WAVEfmt ").unwrap();

        let mut conn = init_db(&user_dir).expect("init_db");
        let pid = get_active_profile_id(&conn);

        let raw_lib_norm = normalize_clean_path(&format!("{}/.", lib_dir.to_string_lossy()));
        let raw_wav_norm = normalize_clean_path(&wav.to_string_lossy());
        conn.execute(
            "INSERT INTO libraries (path, name, is_global, is_read_only) VALUES (?1, 'ScopedLib', 0, 1)",
            params![raw_lib_norm],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO profile_libraries (profile_id, library_id) VALUES (?1, ?2)",
            params![pid, lib_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size, bpm, bpm_is_manual)
             VALUES (?1, ?2, 'kick.wav', 'wav', 400, 1024, 124.0, 1)",
            params![lib_id, raw_wav_norm],
        )
        .unwrap();
        let sid = conn.last_insert_rowid();

        let (_, pkg) = build_profile_export_package_with_options(&conn, pid, false).unwrap();
        conn.execute("UPDATE samples SET bpm = NULL, bpm_is_manual = 0 WHERE id = ?1", params![sid])
            .unwrap();
        let pkg_path = root.join("canon.audify-profile");
        write_profile_package_to_path(&pkg, &pkg_path).unwrap();

        let _ = import_profile_from_file_with_conn(&mut conn, &pkg_path.to_string_lossy()).unwrap();

        let lib_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM libraries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(lib_count, 1, "should reuse existing library without duplicating row");

        let restored: (Option<f64>, i64) = conn
            .query_row(
                "SELECT bpm, bpm_is_manual FROM samples WHERE id = ?1",
                params![sid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored, (Some(124.0), 1));

        let _ = fs::remove_dir_all(&root);
    }
}