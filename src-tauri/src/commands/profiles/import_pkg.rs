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

#[cfg(test)]
pub(crate) fn import_profile_from_file_with_conn(
    conn: &mut Connection,
    file_path: &str,
) -> Result<ImportProfileResult, String> {
    import_profile_from_file_with_user_dir(conn, None, file_path)
}

pub(crate) fn import_profile_from_file_with_user_dir(
    conn: &mut Connection,
    user_dir: Option<&std::path::Path>,
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

    // Pass 0: Restore custom user facets before tags so custom `facet_slug` references resolve cleanly.
    for f in &pkg.facets {
        let fname = f.name.trim();
        let raw_slug = f.slug.trim().to_ascii_lowercase();
        if fname.is_empty()
            || fname.chars().count() > 40
            || raw_slug.is_empty()
            || matches!(raw_slug.as_str(), "category" | "genre" | "mood" | "source")
            || !raw_slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        {
            continue;
        }
        let fdomain = if f.domain.eq_ignore_ascii_case("genres") {
            "genres"
        } else {
            "tags"
        };
        let fcolor = sanitize_hex_color_or_default(&f.color, "#64748B");
        let next_sort = if f.sort_order > 0 { f.sort_order } else { 20 };
        let _ = tx.execute(
            "INSERT OR IGNORE INTO tag_facets (slug, name, color, sort_order, is_system, domain, allow_nesting)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
            params![raw_slug, fname, fcolor, next_sort, fdomain, i64::from(f.allow_nesting)],
        );
    }

    // Pass 1: Ensure imported tags exist (preserving existing global user colors on conflict!)
    // Topologically ordered by `parent_name` chain depth (0 -> 1 -> 2) so 3-level hierarchies resolve cleanly.
    let parent_by_lower: std::collections::HashMap<String, String> = pkg
        .tags
        .iter()
        .filter_map(|t| {
            let child = t.name.trim().to_lowercase();
            let parent = t.parent_name.as_deref()?.trim().to_lowercase();
            (!child.is_empty() && !parent.is_empty() && child != parent).then_some((child, parent))
        })
        .collect();
    let compute_import_tag_depth = |name_lower: &str| -> usize {
        let mut depth = 0usize;
        let mut cur = name_lower;
        let mut seen = std::collections::HashSet::new();
        seen.insert(cur);
        while let Some(next) = parent_by_lower.get(cur) {
            if !seen.insert(next.as_str()) || depth > crate::db::taxonomy::MAX_TAXONOMY_DEPTH {
                break;
            }
            depth += 1;
            cur = next.as_str();
        }
        depth
    };
    let mut indexed_tags: Vec<(usize, &crate::commands::ExportedTagEntry)> =
        pkg.tags.iter().enumerate().collect();
    indexed_tags.sort_by_key(|(idx, t)| (compute_import_tag_depth(&t.name.trim().to_lowercase()), *idx));

    let manual_tag_names_lower: std::collections::HashSet<String> = pkg
        .manual_tag_ref_indices
        .keys()
        .chain(pkg.ai_approved_tag_ref_indices.keys())
        .chain(pkg.manual_tag_samples.keys())
        .chain(pkg.manual_tag_assignments.keys())
        .map(|k| k.trim().to_lowercase())
        .collect();

    for (_, t) in indexed_tags {
        let tname = t.name.trim();
        if tname.is_empty() || tname.chars().count() > 64 {
            continue;
        }
        let is_man = manual_tag_names_lower.contains(&tname.to_lowercase());
        let safe_tag_color =
            sanitize_hex_color_or_default(&t.color, deterministic_color_for_name(tname));

        let existing_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) LIMIT 1",
                params![tname],
                |r| r.get(0),
            )
            .ok();

        if let Some(eid) = existing_id {
            if is_man {
                let _ = tx.execute("UPDATE tags SET is_manual = 1 WHERE id = ?1", params![eid]);
            }
            continue;
        }

        let facet_override = t
            .facet_slug
            .as_deref()
            .filter(|s| crate::db::taxonomy::resolve_facet_id_in_db(&tx, s).is_some());
        let parent_override = t
            .parent_name
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case(tname));
        let color_opt = if t.color_inherited {
            None
        } else {
            Some(safe_tag_color.as_str())
        };

        let created_id = crate::db::ensure_taxonomy_tag(
            &tx,
            tname,
            facet_override,
            parent_override,
            color_opt,
            is_man,
        )?;
        if !t.aliases.is_empty() {
            let encoded = crate::db::taxonomy::encode_aliases_json(&t.aliases, Some(tname));
            let _ = tx.execute(
                "UPDATE tags SET aliases_json = ?1 WHERE id = ?2",
                params![encoded, created_id],
            );
        }
    }

    let manual_genre_names_lower: std::collections::HashSet<String> = pkg
        .manual_genre_ref_indices
        .keys()
        .chain(pkg.manual_genre_assignments.keys())
        .map(|k| k.trim().to_lowercase())
        .collect();

    for g in &pkg.genres {
        let gname = g.name.trim();
        if gname.is_empty() || gname.chars().count() > 64 {
            continue;
        }
        let (target_facet, canonical_name) =
            match crate::taxonomy_catalog::sanitize_id3_genre_or_mood_typo(gname) {
                Some((f, canon)) => (f, canon.to_string()),
                None => (
                    if crate::taxonomy_catalog::is_canonical_mood_name(gname) {
                        "mood"
                    } else {
                        "genre"
                    },
                    gname.to_string(),
                ),
            };
        let is_man = manual_genre_names_lower.contains(&gname.to_lowercase())
            || manual_genre_names_lower.contains(&canonical_name.to_lowercase());
        let safe_genre_color =
            sanitize_hex_color_or_default(&g.color, deterministic_color_for_name(&canonical_name));
        let existing_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) LIMIT 1",
                params![canonical_name],
                |r| r.get(0),
            )
            .ok();
        if let Some(eid) = existing_id {
            if is_man {
                let _ = tx.execute("UPDATE tags SET is_manual = 1 WHERE id = ?1", params![eid]);
            }
        } else {
            let _ = crate::db::ensure_taxonomy_tag(
                &tx,
                &canonical_name,
                Some(target_facet),
                None,
                Some(&safe_genre_color),
                is_man,
            )?;
        }
    }

    // Security Hardening: ONLY insert libraries that pass `is_safe_library_dir` locally!
    for lib in &pkg.libraries {
        if let Ok(safe_dir) = is_safe_library_dir(&lib.path) {
            if let Some(ud) = user_dir {
                if crate::security::ensure_not_inside_user_dir(ud, &safe_dir).is_err() {
                    continue;
                }
            }
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

    if let Some(obj) = imported_settings.as_object_mut() {
        obj.insert(
            "binSampleIds".to_string(),
            serde_json::to_value(&resolved_bin_ids).unwrap_or_default(),
        );
        updated_settings = true;
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

    #[test]
    fn export_and_import_preserves_3_level_hierarchy_case_insensitive_refs_and_custom_genre_facets() {
        use crate::commands::taxonomy::facets::create_tag_facet_with_conn;
        use crate::commands::taxonomy::tags::create_tag_with_options_conn;

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "audify_import_v18_hierarchy_{}_{}",
            std::process::id(),
            nanos
        ));
        let src_user = root.join("src_user");
        let dst_user = root.join("dst_user");
        let lib_dir = root.join("V18Lib");
        fs::create_dir_all(&lib_dir).unwrap();
        let wav_path = lib_dir.join("retro_blade.wav");
        fs::write(&wav_path, b"RIFF0000WAVEfmt ").unwrap();

        let conn_src = init_db(&src_user).expect("init src db");
        let src_pid = get_active_profile_id(&conn_src);
        let lib_norm = normalize_clean_path(&lib_dir.to_string_lossy());
        let wav_norm = normalize_clean_path(&wav_path.to_string_lossy());

        conn_src
            .execute(
                "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'V18Lib', 0)",
                params![lib_norm],
            )
            .unwrap();
        let src_lib_id = conn_src.last_insert_rowid();
        conn_src
            .execute(
                "INSERT INTO profile_libraries (profile_id, library_id) VALUES (?1, ?2)",
                params![src_pid, src_lib_id],
            )
            .unwrap();
        conn_src
            .execute(
                "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
                 VALUES (?1, ?2, 'retro_blade.wav', 'wav', 900, 2048)",
                params![src_lib_id, wav_norm],
            )
            .unwrap();
        let src_sid = conn_src.last_insert_rowid();

        // Create custom genres-domain facet ("Era") and 3-level Category hierarchy + 2-level Genre hierarchy
        let era_facet = create_tag_facet_with_conn(&conn_src, "Era", "genres", "#F59E0B", false)
            .expect("create Era facet");
        let tag_era_80s = create_tag_with_options_conn(
            &conn_src,
            "80s",
            "#F59E0B",
            Some(&era_facet.slug),
            None,
            Some(false),
            None,
        )
        .expect("create 80s tag");

        // Bump sqlite_sequence so depth-2/3 tags get 3-digit IDs (exercises slash-depth sort vs string length)
        conn_src
            .execute("UPDATE sqlite_sequence SET seq = 150 WHERE name = 'tags'", [])
            .ok();

        let root_cat = create_tag_with_options_conn(
            &conn_src,
            "CustomCombat",
            "#EF4444",
            Some("category"),
            None,
            Some(false),
            None,
        )
        .expect("create root category");
        let mid_cat = create_tag_with_options_conn(
            &conn_src,
            "CustomBlades",
            "",
            Some("category"),
            Some(root_cat.id),
            Some(true),
            None,
        )
        .expect("create depth-2 category");
        let leaf_cat = create_tag_with_options_conn(
            &conn_src,
            "PlasmaKatana",
            "",
            Some("category"),
            Some(mid_cat.id),
            Some(true),
            None,
        )
        .expect("create depth-3 category");

        let root_elec = create_tag_with_options_conn(
            &conn_src,
            "ElectronicRoot",
            "#0EA5E9",
            Some("genre"),
            None,
            Some(false),
            None,
        )
        .expect("create root genre");
        let sub_synth = create_tag_with_options_conn(
            &conn_src,
            "OutrunWave",
            "",
            Some("genre"),
            Some(root_elec.id),
            Some(true),
            None,
        )
        .expect("create sub-genre");

        conn_src
            .execute(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
                 VALUES (?1, ?2, 1, 'manual'), (?1, ?3, 1, 'manual'), (?1, ?4, 1, 'manual')",
                params![src_sid, leaf_cat.id, tag_era_80s.id, sub_synth.id],
            )
            .unwrap();

        let (_, mut pkg) = build_profile_export_package_with_options(&conn_src, src_pid, false)
            .expect("export profile package");

        // Verify export ordered CustomCombat -> CustomBlades -> PlasmaKatana despite 3-digit IDs
        let exported_names: Vec<&str> = pkg.tags.iter().map(|t| t.name.as_str()).collect();
        let pos_root = exported_names.iter().position(|&n| n == "CustomCombat").unwrap();
        let pos_mid = exported_names.iter().position(|&n| n == "CustomBlades").unwrap();
        let pos_leaf = exported_names.iter().position(|&n| n == "PlasmaKatana").unwrap();
        assert!(pos_root < pos_mid && pos_mid < pos_leaf, "export must topologically order depth 1 -> 2 -> 3");

        // Reverse pkg.tags to ALSO exercise import's topological sort, and lowercase manual_tag_ref_indices key
        pkg.tags.reverse();
        if let Some(indices) = pkg.manual_tag_ref_indices.remove("PlasmaKatana") {
            pkg.manual_tag_ref_indices
                .insert("plasmakatana".to_string(), indices);
        }

        let pkg_path = root.join("v18_hierarchy.audify-profile");
        write_profile_package_to_path(&pkg, &pkg_path).unwrap();

        // Import into a brand-new clean destination database that already knows the physical file
        let mut conn_dst = init_db(&dst_user).expect("init dst db");
        conn_dst
            .execute(
                "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'V18Lib', 0)",
                params![lib_norm],
            )
            .unwrap();
        let dst_lib_id = conn_dst.last_insert_rowid();
        conn_dst
            .execute(
                "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
                 VALUES (?1, ?2, 'retro_blade.wav', 'wav', 900, 2048)",
                params![dst_lib_id, wav_norm],
            )
            .unwrap();
        let dst_sid = conn_dst.last_insert_rowid();

        let _ = import_profile_from_file_with_conn(&mut conn_dst, &pkg_path.to_string_lossy())
            .expect("import v18 package");

        // Verify 3-level Category chain: CustomCombat -> CustomBlades -> PlasmaKatana
        let (leaf_id, mid_id_opt, leaf_path): (i64, Option<i64>, String) = conn_dst
            .query_row(
                "SELECT id, parent_id, path FROM tags WHERE LOWER(name) = 'plasmakatana'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("PlasmaKatana imported");
        let mid_id = mid_id_opt.expect("PlasmaKatana must keep parent_id");
        let (root_id_opt, mid_name): (Option<i64>, String) = conn_dst
            .query_row(
                "SELECT parent_id, name FROM tags WHERE id = ?1",
                params![mid_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        let root_id = root_id_opt.expect("CustomBlades must keep root parent_id");
        assert_eq!(mid_name, "CustomBlades");
        assert_eq!(leaf_path, format!("/{}/{}/{}/", root_id, mid_id, leaf_id));

        // Verify case-insensitive manual tag link + custom genres-domain primary genre sync
        let linked_count: i64 = conn_dst
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = ?1",
                params![dst_sid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(linked_count, 3, "all 3 manual tags (including lowercase ref) must link");

        let synced_genre: String = conn_dst
            .query_row(
                "SELECT COALESCE(genre, '') FROM samples WHERE id = ?1",
                params![dst_sid],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            synced_genre == "OutrunWave" || synced_genre == "80s",
            "primary samples.genre must sync from imported sub-genre or custom genres-domain facet, got: {}",
            synced_genre
        );

        let _ = fs::remove_dir_all(&root);
    }
}