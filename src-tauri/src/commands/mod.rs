pub mod ai;
pub mod ascii_magic;
pub mod audio_ops;
pub mod backups;
pub mod duplicates;
pub mod file_ops;
pub mod libraries;
pub mod profiles;
pub mod samples;
pub mod shared_types;
pub mod slices;
pub mod snapshot;
pub mod system;
pub mod taxonomy;

pub use ai::*;
pub use ascii_magic::*;
pub use audio_ops::*;
pub use backups::*;
pub use duplicates::*;
pub use file_ops::*;
pub use libraries::*;
pub use profiles::*;
pub use samples::*;
pub use shared_types::*;
pub use slices::*;
pub use snapshot::*;
pub use system::*;
pub use taxonomy::*;

use rusqlite::{params, Connection, Transaction};
use std::collections::HashMap;
use std::path::Path;

pub(crate) fn with_read_conn<T, F>(state: &crate::db::AppState, op: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    if let Ok(read_conn) = crate::db::open_read_conn(&state.user_dir) {
        op(&read_conn)
    } else {
        let conn = state.lock_db();
        op(&conn)
    }
}

pub(crate) fn resolve_or_create_auto_tag(
    tx: &Transaction<'_>,
    tag_map: &mut HashMap<String, i64>,
    rules: &[crate::db::AutoTagRule],
    raw_name: &str,
) -> i64 {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let lower = trimmed.to_lowercase();
    if let Some(&tid) = tag_map.get(&lower) {
        return tid;
    }

    if let Ok(existing_id) = tx.query_row(
        "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) OR name = ?2 LIMIT 1",
        params![&lower, trimmed],
        |r| r.get::<_, i64>(0),
    ) {
        if existing_id > 0 {
            tag_map.insert(lower, existing_id);
            return existing_id;
        }
    }

    let raw_col = rules
        .iter()
        .find(|r| r.tag_name.trim().eq_ignore_ascii_case(trimmed))
        .map(|r| r.tag_color.as_str())
        .unwrap_or("");
    let fallback_col = crate::db::deterministic_color_for_name(trimmed);
    let col = crate::security::sanitize_hex_color_or_default(raw_col, fallback_col);

    // Preserve any existing manual/auto tag color on conflict or case collision.
    let _ = tx.execute(
        "INSERT OR IGNORE INTO tags (name, color, is_manual) VALUES (?1, ?2, 0)",
        params![trimmed, col],
    );
    let tid: i64 = tx
        .query_row(
            "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) OR name = ?2 LIMIT 1",
            params![&lower, trimmed],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if tid > 0 {
        tag_map.insert(lower, tid);
    }
    tid
}

pub(crate) fn normalize_path_str(p: &str) -> String {
    let clean = crate::security::normalize_clean_path(p);
    let bytes = clean.as_bytes();
    let is_windows_drive_root =
        bytes.len() == 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
    if clean == "/" || is_windows_drive_root {
        clean
    } else {
        clean.trim_end_matches('/').to_string()
    }
}

/// Returns the part of `file_path` that lies below `lib_path` (original casing, no leading slash).
/// - Requires a folder boundary, so `C:/Sounds` does NOT match `C:/SoundsOld/x.wav`.
/// - Uses checked slicing, so case-folding differences (e.g. Turkish `İ`) can never cause a
///   char-boundary panic; a non-matching prefix simply yields `None`.
pub(crate) fn strip_lib_prefix(file_path: &str, lib_path: &str) -> Option<String> {
    let norm_file = normalize_path_str(file_path);
    let norm_lib = normalize_path_str(lib_path);
    if norm_lib.is_empty() {
        return None;
    }
    let head = norm_file.get(..norm_lib.len())?;
    if head.to_lowercase() != norm_lib.to_lowercase() {
        return None;
    }
    let rest = norm_file.get(norm_lib.len()..)?;
    if !norm_lib.ends_with('/') && !rest.starts_with('/') {
        return None;
    }
    let trimmed = rest.trim_start_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn compute_rel_path(file_path: &str, lib_paths: &[String]) -> Option<String> {
    lib_paths
        .iter()
        .find_map(|lib| strip_lib_prefix(file_path, lib))
}

/// Inserts `id` under `key`; if the key already maps to a different sample it is marked
/// ambiguous (`None`) so relinking never silently picks the wrong duplicate file.
pub(crate) fn insert_unique<K: std::hash::Hash + Eq>(
    map: &mut HashMap<K, Option<i64>>,
    key: K,
    id: i64,
) {
    map.entry(key)
        .and_modify(|v| {
            if *v != Some(id) {
                *v = None;
            }
        })
        .or_insert(Some(id));
}

pub(crate) fn make_resilient_ref(
    file_path: String,
    file_name: Option<String>,
    file_size: Option<i64>,
    duration_ms: Option<i64>,
    lib_paths: &[String],
) -> ResilientSampleRef {
    let rel_path = compute_rel_path(&file_path, lib_paths);
    let name = file_name.or_else(|| {
        Path::new(&file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
    });

    ResilientSampleRef {
        file_path,
        rel_path,
        file_name: name,
        file_size,
        duration_ms,
    }
}

pub(crate) fn parent_folder_path(file_path: &str) -> String {
    let norm = file_path.replace('\\', "/");
    if let Some(idx) = norm.rfind('/') {
        norm[..idx].to_string()
    } else {
        String::new()
    }
}

pub(crate) fn query_profile_by_id(conn: &Connection, id: i64) -> Result<Profile, String> {
    conn.query_row(
        "SELECT id, name, color, settings_json, is_active, created_at
         FROM profiles
         WHERE id = ?1",
        params![id],
        |row| {
            Ok(Profile {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                settings_json: row.get(3)?,
                is_active: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| format!("Failed to load profile {}: {}", id, e))
}

pub(crate) fn query_collection_by_id(conn: &Connection, id: i64) -> Result<Collection, String> {
    conn.query_row(
        "SELECT c.id, c.profile_id, c.name, COALESCE(c.color, '#10B981'), COALESCE(c.icon, 'layers'), c.created_at,
                (SELECT COUNT(DISTINCT ci.sample_id)
                 FROM collection_items ci
                 INNER JOIN samples s ON s.id = ci.sample_id AND COALESCE(s.is_trashed, 0) = 0
                 WHERE ci.collection_id = c.id OR ci.collection_id IN (SELECT id FROM collections WHERE parent_id = c.id)) AS sample_count,
                c.parent_id,
                c.rule_path,
                c.smart_query
         FROM collections c
         WHERE c.id = ?1",
        params![id],
        |row| {
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
        },
    )
    .map_err(|e| format!("Failed to query collection {}: {}", id, e))
}

pub(crate) fn query_sample_tags(
    conn: &Connection,
    sample_id: i64,
) -> Result<Vec<SampleTagBadge>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color
             FROM sample_tags st
             INNER JOIN tags t ON t.id = st.tag_id
             WHERE st.sample_id = ?1
             ORDER BY t.name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map(params![sample_id], |row| {
            Ok(SampleTagBadge {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| format!("Query execution error: {}", e))?;

    let mut out = Vec::new();
    for r in rows.flatten() {
        out.push(r);
    }
    Ok(out)
}

#[cfg(test)]
mod audit_tests {
    use super::*;
    use crate::audio::write_wav_i16;
    use crate::commands::libraries::sync_library_with_conn;
    use crate::commands::profiles::{
        apply_share_safe, import_profile_from_file_with_conn, import_settings_from_file_with_conn,
    };
    use crate::commands::samples::query_samples_with_conn;
    use crate::commands::system::import_custom_background_to_dir;
    use crate::commands::taxonomy::{apply_auto_tag_rules_with_conn, create_tag_with_conn};
    use crate::db::init_db;
    use crate::security::{
        ensure_inside, is_personal_path, is_safe_library_dir, is_unc_or_network_path,
        normalize_clean_path, sanitize_settings_paths,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TempTestDir(PathBuf);

    impl TempTestDir {
        fn new(prefix: &str) -> Self {
            let n = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "audify_cmd_test_{}_{}_{}_{}",
                prefix,
                std::process::id(),
                n,
                ts
            ));
            fs::create_dir_all(&dir).expect("create temp test dir");
            let dir = crate::security::ensure_inside(&dir, &dir).unwrap_or(dir);
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_tiny_wav(path: &Path, num_samples: usize) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let pcm: Vec<i16> = (0..num_samples)
            .map(|i| ((i as f32 * 0.05).sin() * 12000.0) as i16)
            .collect();
        write_wav_i16(path, 44100, 1, &pcm).expect("write test wav");
    }

    #[test]
    fn strip_lib_prefix_requires_folder_boundary() {
        assert_eq!(
            strip_lib_prefix("C:/Sounds/a/b.wav", "c:\\sounds"),
            Some("a/b.wav".to_string())
        );
        // `C:/Sounds` must NOT match the sibling `C:/SoundsOld`
        assert_eq!(strip_lib_prefix("C:/SoundsOld/x.wav", "C:/Sounds"), None);
        // the library root itself has no relative part
        assert_eq!(strip_lib_prefix("C:/Sounds", "C:/Sounds"), None);
    }

    #[test]
    fn strip_lib_prefix_never_panics_on_case_folding() {
        let _ = strip_lib_prefix("C:/İstanbul/x.wav", "C:/istanbul");
        let _ = strip_lib_prefix("C:/istanbul/x.wav", "C:/İstanbul");
        let _ = strip_lib_prefix("İ", "İİİİİİ");
    }

    #[test]
    fn compute_rel_path_uses_first_matching_library() {
        let libs = vec!["D:/Other".to_string(), "C:/Users/me/Sounds".to_string()];
        assert_eq!(
            compute_rel_path("C:\\Users\\me\\Sounds\\sfx\\hit.wav", &libs),
            Some("sfx/hit.wav".to_string())
        );
    }

    #[test]
    fn insert_unique_marks_duplicates_as_ambiguous() {
        let mut m: HashMap<String, Option<i64>> = HashMap::new();
        insert_unique(&mut m, "kick.wav".to_string(), 1);
        insert_unique(&mut m, "kick.wav".to_string(), 1);
        assert_eq!(m.get("kick.wav"), Some(&Some(1)));
        insert_unique(&mut m, "kick.wav".to_string(), 2);
        assert_eq!(m.get("kick.wav"), Some(&None));
        insert_unique(&mut m, "kick.wav".to_string(), 3);
        assert_eq!(m.get("kick.wav"), Some(&None));
    }

    #[test]
    fn personal_path_detection() {
        assert!(is_personal_path("C:\\Users\\studio_user\\Downloads\\x"));
        assert!(is_personal_path("/home/bob/music"));
        assert!(is_personal_path("D:/Stuff/AppData/Roaming"));
        assert!(!is_personal_path("D:/Samples/Kicks"));
    }

    #[test]
    fn sanitize_settings_paths_export_and_import() {
        let mut v = serde_json::json!({
            "customSliceExportPath": "C:/Users/studio_user/Music/Slices",
            "customBgImage": "Z:/definitely/missing/bg.jpg"
        });
        sanitize_settings_paths(&mut v, false);
        assert_eq!(v["customSliceExportPath"], "C:/Users/studio_user/Music/Slices");
        assert_eq!(v["customBgImage"], "Z:/definitely/missing/bg.jpg");

        sanitize_settings_paths(&mut v, true);
        assert_eq!(v["customBgImage"], "");

        // Forbidden OS paths and UNC paths must always be stripped immediately on both export and import
        let mut unc_val = serde_json::json!({
            "customSliceExportPath": r"\\evil-server\share\slices",
            "customBgImage": "//evil-server/share/bg.png"
        });
        sanitize_settings_paths(&mut unc_val, false);
        assert_eq!(unc_val["customSliceExportPath"], "");
        assert_eq!(unc_val["customBgImage"], "");

        let mut os_val = serde_json::json!({
            "customSliceExportPath": "C:/Windows/System32",
            "customBgImage": "C:/Windows/wallpaper.jpg"
        });
        sanitize_settings_paths(&mut os_val, false);
        assert_eq!(os_val["customSliceExportPath"], "");
        assert_eq!(os_val["customBgImage"], "");

        assert_eq!(
            strip_lib_prefix("D:/Kicks/kick.wav", "D:/").as_deref(),
            Some("Kicks/kick.wav")
        );
        assert_eq!(strip_lib_prefix("D:/", "D:/"), None);
    }

    #[test]
    fn ensure_inside_and_library_safety_guards() {
        let tmp = TempTestDir::new("inside");
        let base = tmp.path().join("backups");
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let inside_file = base.join("a.json");
        let outside_file = outside.join("b.json");
        fs::write(&inside_file, "{}").unwrap();
        fs::write(&outside_file, "{}").unwrap();

        assert!(ensure_inside(&base, &inside_file).is_ok());
        assert!(ensure_inside(&base, &outside_file).is_err());
        let sneaky = base.join("..").join("outside").join("b.json");
        assert!(ensure_inside(&base, &sneaky).is_err());
        assert!(ensure_inside(&base, Path::new(r"\\attacker\share\a.json")).is_err());

        assert!(is_unc_or_network_path(r"\\attacker\share\folder"));
        assert!(is_unc_or_network_path("//attacker/share/folder"));
        assert!(!is_unc_or_network_path(r"\\?\C:\Audio\Packs"));

        assert!(is_safe_library_dir(r"\\attacker\share").is_err());
        #[cfg(target_os = "windows")]
        {
            assert!(is_safe_library_dir("C:\\").is_err());
            assert!(is_safe_library_dir("C:\\Windows").is_err());
            assert!(is_safe_library_dir("C:\\Program Files").is_err());
            assert!(is_safe_library_dir("C:\\Users").is_err());
        }
        assert!(is_safe_library_dir(&outside.to_string_lossy()).is_ok());
    }

    #[test]
    fn share_safe_export_contains_no_personal_paths() {
        let r = |p: &str, rel: &str| ResilientSampleRef {
            file_path: p.to_string(),
            rel_path: Some(rel.to_string()),
            file_name: Some("x.wav".to_string()),
            file_size: Some(10),
            duration_ms: Some(100),
        };
        let mut pkg = ProfileExportPackage {
            format: "audify-profile-v2".into(),
            version: 2,
            name: "n".into(),
            color: "#fff".into(),
            settings: serde_json::json!({
                "customBgImage": "D:/Projects/Audify/user/images/bg.jpg",
                "customSliceExportPath": "C:/Users/studio_user/Slices",
                "licenseGroups": [{
                    "name": "A",
                    "folders": ["C:\\Users\\studio_user\\Downloads\\sounds\\music\\A"],
                    "rel_folders": ["music/A"]
                }],
                "collectionTemplates": [{
                    "name": "Sub",
                    "folder_path": "C:\\Users\\studio_user\\Downloads\\sounds\\sfx\\Sub",
                    "rel_folder_path": "sfx/Sub"
                }],
                "autoTagCategories": [{
                    "name": "Cat",
                    "include_paths": ["C:\\Users\\studio_user\\Downloads\\sounds\\sfx"],
                    "exclude_paths": ["C:\\Users\\studio_user\\Downloads\\sounds\\raw"]
                }]
            }),
            libraries: vec![ExportedLibraryEntry {
                path: "C:/Users/studio_user/Downloads/sounds".into(),
                name: "sounds".into(),
                is_global: false,
                is_read_only: false,
            }],
            tags: vec![],
            genres: vec![],
            collections: vec![ExportedCollectionEntry {
                name: "c".into(),
                color: "#fff".into(),
                icon: "layers".into(),
                parent_name: Some("ParentCol".into()),
                rule_path: Some("C:/Users/studio_user/Downloads/sounds/a".into()),
                rel_rule_path: Some("a".into()),
                sample_file_paths: vec!["C:/Users/studio_user/Downloads/sounds/a/x.wav".into()],
                samples: vec![r("C:/Users/studio_user/Downloads/sounds/a/x.wav", "a/x.wav")],
                ..Default::default()
            }],
            favorite_sample_paths: vec!["C:/Users/studio_user/Downloads/sounds/a/x.wav".into()],
            favorite_samples: vec![r("C:/Users/studio_user/Downloads/sounds/a/x.wav", "a/x.wav")],
            manual_tag_assignments: HashMap::from([(
                "t".to_string(),
                vec!["C:/Users/studio_user/Downloads/sounds/a/x.wav".to_string()],
            )]),
            manual_tag_samples: HashMap::from([(
                "t".to_string(),
                vec![r("C:/Users/studio_user/Downloads/sounds/a/x.wav", "a/x.wav")],
            )]),
            sample_tags: vec![ExportedSampleTagMap {
                file_path: "C:/Users/studio_user/Downloads/sounds/a/x.wav".into(),
                tag_names: vec!["t".into()],
                sample_ref: Some(r("C:/Users/studio_user/Downloads/sounds/a/x.wav", "a/x.wav")),
            }],
            ..Default::default()
        };

        apply_share_safe(&mut pkg);
        let json = serde_json::to_string(&pkg).unwrap();
        assert!(!json.to_lowercase().contains("studio_user"), "leaked: {}", json);
        assert!(!json.contains("D:/Projects"), "leaked project path: {}", json);
        assert!(pkg.collections[0].rule_path.is_none());
        assert_eq!(pkg.collections[0].rel_rule_path.as_deref(), Some("a"));
        assert_eq!(pkg.collections[0].parent_name.as_deref(), Some("ParentCol"));
        assert_eq!(pkg.favorite_samples[0].file_path, "a/x.wav");
        assert_eq!(pkg.favorite_samples[0].file_size, Some(10));
        assert_eq!(pkg.sample_tags[0].file_path, "a/x.wav");
        assert_eq!(
            pkg.settings["licenseGroups"][0]["rel_folders"][0],
            "music/A"
        );
    }

    #[test]
    fn import_settings_whitelists_keys_and_blocks_arbitrary_json_exfiltration() {
        let tmp = TempTestDir::new("settings_sec");
        let conn = init_db(&tmp.path().join("user")).expect("init db");

        // 1. Arbitrary sensitive JSON (zero recognized ProfileSettings keys) must be rejected
        let secret_json = tmp.path().join("package_secrets.json");
        fs::write(
            &secret_json,
            r#"{"api_key":"sk-live-secret","database_password":"hunter2","private_token":"xyz"}"#,
        )
        .unwrap();
        assert!(
            import_settings_from_file_with_conn(&conn, &secret_json.to_string_lossy()).is_err()
        );

        // 2. Non-.json extension must be rejected
        let txt_file = tmp.path().join("settings.txt");
        fs::write(&txt_file, r#"{"themeMode":"dark"}"#).unwrap();
        assert!(import_settings_from_file_with_conn(&conn, &txt_file.to_string_lossy()).is_err());

        // 3. UNC path must be rejected immediately
        assert!(
            import_settings_from_file_with_conn(&conn, r"\\evil-server\share\settings.json")
                .is_err()
        );

        // 4. Mixed JSON keeps ONLY whitelisted keys and strips missing/UNC paths
        let mixed_json = tmp.path().join("valid_settings.json");
        fs::write(
            &mixed_json,
            r##"{
                "themeMode": "light",
                "accentColor": "#22C55E",
                "volume": 0.85,
                "customSliceExportPath": "\\\\evil\\share\\slices",
                "customBgImage": "Z:/missing/wallpaper.png",
                "leakedPrivateField": "MUST_BE_DROPPED"
            }"##,
        )
        .unwrap();
        let updated = import_settings_from_file_with_conn(&conn, &mixed_json.to_string_lossy())
            .expect("valid settings import");
        let parsed: serde_json::Value = serde_json::from_str(&updated.settings_json).unwrap();
        assert_eq!(parsed["themeMode"], "light");
        assert_eq!(parsed["accentColor"], "#22C55E");
        assert_eq!(parsed["customSliceExportPath"], "");
        assert_eq!(parsed["customBgImage"], "");
        assert!(parsed.get("leakedPrivateField").is_none());

        // 5. export_settings_to_file refuses non-JSON destinations and existing non-JSON binary files
        let bad_dest = tmp.path().join("evil.exe");
        assert!(export_settings_to_file(bad_dest.to_string_lossy().into(), "{}".into()).is_err());

        let fake_json = tmp.path().join("not_really_json.json");
        fs::write(&fake_json, b"MZ\x90\x00binary_executable_payload").unwrap();
        assert!(export_settings_to_file(fake_json.to_string_lossy().into(), "{}".into()).is_err());
    }

    #[test]
    fn custom_background_import_enforces_magic_bytes_ads_and_collision_suffix() {
        let tmp = TempTestDir::new("bg_sec");
        let user_dir = tmp.path().join("user");
        fs::create_dir_all(&user_dir).unwrap();

        // Fake PNG (plain text disguised as .png) must be rejected
        let fake_png = tmp.path().join("fake.png");
        fs::write(&fake_png, b"not an image at all").unwrap();
        assert!(import_custom_background_to_dir(&user_dir, &fake_png.to_string_lossy()).is_err());

        // NTFS ADS colon must be rejected
        let ads_path = format!("{}:hidden_stream.png", fake_png.display());
        assert!(import_custom_background_to_dir(&user_dir, &ads_path).is_err());

        // Valid PNG #1 imports as `wall.png`
        let dir_a = tmp.path().join("a");
        let dir_b = tmp.path().join("b");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();

        let png1 = dir_a.join("wall.png");
        let png2 = dir_b.join("wall.png");
        fs::write(&png1, b"\x89PNG\r\n\x1a\npayload_one_1234").unwrap();
        fs::write(&png2, b"\x89PNG\r\n\x1a\npayload_two_5678").unwrap();

        let imported1 = import_custom_background_to_dir(&user_dir, &png1.to_string_lossy())
            .expect("import png1");
        // Re-importing exact same bytes is idempotent
        let imported1_again = import_custom_background_to_dir(&user_dir, &png1.to_string_lossy())
            .expect("re-import png1");
        assert_eq!(imported1, imported1_again);

        // Importing a DIFFERENT file named `wall.png` appends a hash suffix instead of overwriting!
        let imported2 = import_custom_background_to_dir(&user_dir, &png2.to_string_lossy())
            .expect("import png2");
        assert_ne!(imported1, imported2);
        assert!(Path::new(&imported1).exists());
        assert!(Path::new(&imported2).exists());
    }

    #[test]
    fn sync_library_incremental_protects_sibling_folders_underscores_and_case_renames() {
        let tmp = TempTestDir::new("sync_siblings");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");

        let lib_root = tmp.path().join("SoundPack");
        let drums = lib_root.join("Drums");
        let drums2 = lib_root.join("Drums2");
        let drums_heavy = lib_root.join("Drums_Heavy");
        let fx_1 = lib_root.join("FX_1");
        let fxa1 = lib_root.join("FXA1");

        write_tiny_wav(&drums.join("kick.wav"), 2205);
        write_tiny_wav(&drums2.join("snare2.wav"), 2205);
        write_tiny_wav(&drums_heavy.join("boom.wav"), 2205);
        write_tiny_wav(&fx_1.join("riser.wav"), 2205);
        write_tiny_wav(&fxa1.join("zap.wav"), 2205);

        let lib_str = lib_root.to_string_lossy().to_string();
        let synced = sync_library_with_conn(&mut conn, &lib_str, None, false).expect("initial sync");
        assert_eq!(synced.sample_count, 5);

        // Sync ONLY `Drums` after removing `kick.wav`:
        // MUST delete `Drums/kick.wav`, MUST NOT delete `Drums2/snare2.wav` or `Drums_Heavy/boom.wav`!
        fs::remove_file(drums.join("kick.wav")).unwrap();
        let after_drums = sync_library_with_conn(
            &mut conn,
            &lib_str,
            Some(&drums.to_string_lossy()),
            false,
        )
        .expect("targeted Drums sync");
        assert_eq!(after_drums.sample_count, 4);

        let remaining_names: Vec<String> = conn
            .prepare("SELECT file_name FROM samples ORDER BY file_name ASC")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(
            remaining_names,
            vec!["boom.wav", "riser.wav", "snare2.wav", "zap.wav"]
        );

        // Sync ONLY `FX_1` after removing `riser.wav`:
        // Because `_` is escaped in `LIKE ... ESCAPE '\'`, `FXA1/zap.wav` MUST survive!
        fs::remove_file(fx_1.join("riser.wav")).unwrap();
        let after_fx1 = sync_library_with_conn(
            &mut conn,
            &lib_str,
            Some(&fx_1.to_string_lossy()),
            false,
        )
        .expect("targeted FX_1 sync");
        assert_eq!(after_fx1.sample_count, 3);

        let zap_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM samples WHERE file_name = 'zap.wav')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(zap_exists, "FXA1/zap.wav must not be deleted when syncing FX_1");

        // Reject target_folder outside library_path
        let outside_dir = tmp.path().join("OtherFolder");
        fs::create_dir_all(&outside_dir).unwrap();
        assert!(sync_library_with_conn(
            &mut conn,
            &lib_str,
            Some(&outside_dir.to_string_lossy()),
            false
        )
        .is_err());

        // Case-only rename on Windows preserves `samples.id`, `profile_favorites`, and manual tags!
        #[cfg(target_os = "windows")]
        {
            let zap_id: i64 = conn
                .query_row(
                    "SELECT id FROM samples WHERE file_name = 'zap.wav'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let active_profile_id: i64 = conn
                .query_row(
                    "SELECT id FROM profiles WHERE is_active = 1 LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            conn.execute(
                "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
                params![active_profile_id, zap_id],
            )
            .unwrap();
            let manual_tag = create_tag_with_conn(&conn, "KeepMeOnCaseRename", "#FF00AA").unwrap();
            conn.execute(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, ?2, 1)",
                params![zap_id, manual_tag.id],
            )
            .unwrap();

            // Rename `zap.wav` -> `ZAP_TMP.wav` -> `ZAP.wav` on NTFS
            let tmp_name = fxa1.join("ZAP_TMP.wav");
            let upper_name = fxa1.join("ZAP.wav");
            fs::rename(fxa1.join("zap.wav"), &tmp_name).unwrap();
            fs::rename(&tmp_name, &upper_name).unwrap();

            sync_library_with_conn(&mut conn, &lib_str, Some(&fxa1.to_string_lossy()), false)
                .expect("case rename sync");

            let (id_after, fname_after): (i64, String) = conn
                .query_row(
                    "SELECT id, file_name FROM samples WHERE id = ?1",
                    params![zap_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .expect("sample id preserved across case rename");
            let fav_after: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM profile_favorites WHERE profile_id = ?1 AND sample_id = ?2)",
                    params![active_profile_id, zap_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(id_after, zap_id);
            assert_eq!(fname_after, "ZAP.wav");
            assert!(fav_after);

            let still_has_manual_tag: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2)",
                    params![zap_id, manual_tag.id],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(still_has_manual_tag);
        }
    }

    #[test]
    fn apply_auto_tag_rules_preserves_manual_loops_and_unassigned_manual_tags() {
        let tmp = TempTestDir::new("autotag_manual");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");

        let lib_dir = tmp.path().join("Lib");
        // Filename has "loop" in it, so `detect_is_loop` would normally return `true`,
        // EXCEPT the user manually overrode `is_loop = 0, loop_is_manual = 1`!
        let sample_path = lib_dir.join("drum_loop_120bpm.wav");
        write_tiny_wav(&sample_path, 4410);

        sync_library_with_conn(&mut conn, &lib_dir.to_string_lossy(), None, false)
            .expect("sync lib");

        let sample_id: i64 = conn
            .query_row("SELECT id FROM samples LIMIT 1", [], |r| r.get(0))
            .unwrap();

        // Force manual One-Shot override (`is_loop = 0, loop_is_manual = 1`)
        conn.execute(
            "UPDATE samples SET is_loop = 0, loop_is_manual = 1 WHERE id = ?1",
            params![sample_id],
        )
        .unwrap();

        // Create an unassigned MANUAL tag (`is_manual = 1`) via `create_tag_with_conn`
        let manual_tag =
            create_tag_with_conn(&conn, "MyCustomEmptyTag", "#123456").expect("create manual tag");

        // Insert an unassigned AUTO tag (`is_manual = 0`) directly
        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('StaleAutoTag', '#654321', 0)",
            [],
        )
        .unwrap();

        apply_auto_tag_rules_with_conn(&mut conn).expect("apply auto tag rules");

        // 1. Manual loop override (`is_loop = 0, loop_is_manual = 1`) MUST remain untouched!
        let (is_loop_after, loop_manual_after): (bool, bool) = conn
            .query_row(
                "SELECT is_loop, loop_is_manual FROM samples WHERE id = ?1",
                params![sample_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(!is_loop_after, "manual One-Shot override was overwritten!");
        assert!(loop_manual_after);

        // 2. Unassigned manual tag MUST still exist!
        let manual_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tags WHERE id = ?1 AND name = 'MyCustomEmptyTag')",
                params![manual_tag.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(manual_exists, "unassigned manual tag must be preserved!");

        // 3. Unassigned auto-tag MUST be pruned!
        let stale_auto_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tags WHERE name = 'StaleAutoTag')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!stale_auto_exists, "unassigned auto-tag must be pruned!");

        // 4. Verify `trg_sample_tags_ai` trigger was restored by assigning manual_tag and searching FTS!
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, ?2, 1)",
            params![sample_id, manual_tag.id],
        )
        .unwrap();
        let found = query_samples_with_conn(
            &conn,
            Some("MyCustomEmptyTag".into()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("FTS search after trigger restore");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn query_samples_fts_turkish_synonyms_genres_and_large_tag_chunks() {
        let tmp = TempTestDir::new("fts_parity");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");

        let lib_dir = tmp.path().join("Lib");
        write_tiny_wav(&lib_dir.join("kılıç_darbesi.wav"), 2205);
        write_tiny_wav(&lib_dir.join("cinematic_uplifter_01.wav"), 2205);
        sync_library_with_conn(&mut conn, &lib_dir.to_string_lossy(), None, false)
            .expect("sync lib");

        // Assign genre "Cyberpunk" to uplifter and add both samples into a Collection
        let uplifter_id: i64 = conn
            .query_row(
                "SELECT id FROM samples WHERE file_name = 'cinematic_uplifter_01.wav'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let kilic_id: i64 = conn
            .query_row(
                "SELECT id FROM samples WHERE file_name = 'kılıç_darbesi.wav'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "UPDATE samples SET genre = 'Cyberpunk' WHERE id = ?1",
            params![uplifter_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO collections (profile_id, name, color, icon) VALUES (1, 'TrailerCol', '#fff', 'layers')",
            [],
        )
        .unwrap();
        let col_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO collection_items (collection_id, sample_id) VALUES (?1, ?2), (?1, ?3)",
            params![col_id, kilic_id, uplifter_id],
        )
        .unwrap();

        // 1. ASCII "kilic" finds Turkish "kılıç_darbesi.wav" inside Collection!
        let tr_hits = query_samples_with_conn(
            &conn,
            Some("kilic".into()),
            None,
            None,
            None,
            Some(col_id),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(tr_hits.len(), 1);
        assert_eq!(tr_hits[0].id, kilic_id);

        // 2. Studio synonym "riser" finds "cinematic_uplifter_01.wav" inside Collection!
        let syn_hits = query_samples_with_conn(
            &conn,
            Some("riser".into()),
            None,
            None,
            None,
            Some(col_id),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(syn_hits.len(), 1);
        assert_eq!(syn_hits[0].id, uplifter_id);

        // 3. Genre "cyberpunk" finds "cinematic_uplifter_01.wav" inside Collection!
        let genre_hits = query_samples_with_conn(
            &conn,
            Some("cyberpunk".into()),
            None,
            None,
            None,
            Some(col_id),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(genre_hits.len(), 1);
        assert_eq!(genre_hits[0].id, uplifter_id);

        // 4. Bare `_` and Smart Search operators (`-loop <3s 1-5s #sfx ext:wav`) never cause FTS syntax error!
        let underscore_res = query_samples_with_conn(
            &conn,
            Some("_ -loop <3s 1-5s #sfx ext:wav".into()),
            None,
            None,
            None,
            Some(col_id),
            None,
            None,
            None,
        )
        .expect("underscore + smart operators query");
        assert_eq!(underscore_res.len(), 2);

        // 5. > 900 tag_ids parameter binding works cleanly via chunking without SQLite limit error
        let huge_tags: Vec<i64> = (1..=1250).collect();
        let chunked_res = query_samples_with_conn(
            &conn,
            None,
            None,
            None,
            Some(huge_tags),
            None,
            None,
            None,
            None,
        )
        .expect(">900 tag_ids chunked query");
        assert!(chunked_res.is_empty());
    }

    #[test]
    fn import_profile_rejects_unsafe_libraries_and_normalizes_forward_slashes() {
        let tmp = TempTestDir::new("profile_import");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");

        let valid_lib = tmp.path().join("LocalPack");
        let sub_rule = valid_lib.join("Impacts");
        fs::create_dir_all(&sub_rule).unwrap();

        let pkg = ProfileExportPackage {
            format: "audify-profile-v2".into(),
            version: 2,
            name: "ImportedStudio".into(),
            color: "#3B82F6".into(),
            settings: serde_json::json!({
                "themeMode": "dark",
                "collectionTemplates": [{
                    "name": "Impacts",
                    "folder_path": "",
                    "rel_folder_path": "Impacts"
                }]
            }),
            libraries: vec![
                ExportedLibraryEntry {
                    path: "C:/".into(),
                    name: "DriveRootMustBeBlocked".into(),
                    is_global: true,
                    is_read_only: false,
                },
                ExportedLibraryEntry {
                    path: r"\\evil-server\share\sfx".into(),
                    name: "UncMustBeBlocked".into(),
                    is_global: true,
                    is_read_only: false,
                },
                ExportedLibraryEntry {
                    path: valid_lib.to_string_lossy().to_string(),
                    name: "LocalPack".into(),
                    is_global: true,
                    is_read_only: false,
                },
            ],
            tags: vec![],
            genres: vec![],
            collections: vec![ExportedCollectionEntry {
                name: "ImpactCol".into(),
                color: "#fff".into(),
                icon: "layers".into(),
                parent_name: None,
                rule_path: None,
                rel_rule_path: Some("Impacts".into()),
                sample_file_paths: vec![],
                samples: vec![],
                ..Default::default()
            }],
            ..Default::default()
        };

        let pkg_file = tmp.path().join("studio.audify-profile.json");
        fs::write(&pkg_file, serde_json::to_string_pretty(&pkg).unwrap()).unwrap();

        let res = import_profile_from_file_with_conn(&mut conn, &pkg_file.to_string_lossy())
            .expect("import profile");

        let db_libs: Vec<String> = conn
            .prepare("SELECT path FROM libraries")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(db_libs.len(), 1);
        assert_eq!(
            db_libs[0],
            normalize_clean_path(&valid_lib.to_string_lossy())
        );

        let rule_path: String = conn
            .query_row(
                "SELECT rule_path FROM collections WHERE profile_id = ?1 AND name = 'ImpactCol'",
                params![res.profile.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!rule_path.contains('\\'), "rule_path must use `/` slashes: {}", rule_path);

        let settings_val: serde_json::Value =
            serde_json::from_str(&res.profile.settings_json).unwrap();
        let tmpl_fp = settings_val["collectionTemplates"][0]["folder_path"]
            .as_str()
            .unwrap();
        assert!(!tmpl_fp.contains('\\'), "template folder_path must use `/` slashes: {}", tmpl_fp);
    }

    #[test]
    fn import_profile_round_trips_category_and_rule_scope_rel_paths() {
        let tmp = TempTestDir::new("cat_scope_rt");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");

        // Machine A library -> exported as share-safe or machine package
        let machine_b_lib = tmp.path().join("StudioB");
        let sfx_dir = machine_b_lib.join("SFX");
        let sfx_raw_dir = sfx_dir.join("Raw");
        let custom_dir = machine_b_lib.join("CustomHits");
        fs::create_dir_all(&sfx_raw_dir).unwrap();
        fs::create_dir_all(&custom_dir).unwrap();

        let pkg = ProfileExportPackage {
            format: "audify-profile-v2".into(),
            version: 2,
            name: "ScopedStudio".into(),
            color: "#10B981".into(),
            settings: serde_json::json!({
                "autoTagCategories": [{
                    "name": "SFX",
                    "include_paths": [],
                    "exclude_paths": [],
                    "rel_include_paths": ["SFX"],
                    "rel_exclude_paths": ["SFX/Raw"]
                }],
                "autoTagRules": [{
                    "id": "r-custom",
                    "tag_name": "Punch",
                    "tag_color": "#EF4444",
                    "keywords": ["punch"],
                    "enabled": true,
                    "category": "SFX",
                    "include_paths": [],
                    "exclude_paths": [],
                    "rel_include_paths": ["CustomHits"],
                    "rel_exclude_paths": ["SFX/Raw"]
                }]
            }),
            libraries: vec![ExportedLibraryEntry {
                path: machine_b_lib.to_string_lossy().to_string(),
                name: "StudioB".into(),
                is_global: true,
                is_read_only: false,
            }],
            ..Default::default()
        };

        let pkg_file = tmp.path().join("scoped.audify-profile.json");
        fs::write(&pkg_file, serde_json::to_string_pretty(&pkg).unwrap()).unwrap();

        let res = import_profile_from_file_with_conn(&mut conn, &pkg_file.to_string_lossy())
            .expect("import scoped profile");

        let settings_val: serde_json::Value =
            serde_json::from_str(&res.profile.settings_json).unwrap();
        let cat_inc = settings_val["autoTagCategories"][0]["include_paths"][0]
            .as_str()
            .expect("resolved category include_paths");
        let cat_exc = settings_val["autoTagCategories"][0]["exclude_paths"][0]
            .as_str()
            .expect("resolved category exclude_paths");
        assert_eq!(cat_inc, normalize_clean_path(&sfx_dir.to_string_lossy()));
        assert_eq!(cat_exc, normalize_clean_path(&sfx_raw_dir.to_string_lossy()));

        let rule_inc = settings_val["autoTagRules"][0]["include_paths"][0]
            .as_str()
            .expect("resolved rule include_paths");
        assert_eq!(rule_inc, normalize_clean_path(&custom_dir.to_string_lossy()));
        assert_eq!(
            settings_val["autoTagCategories"][0]["rel_include_paths"][0],
            "SFX"
        );
        assert_eq!(
            settings_val["autoTagRules"][0]["rel_include_paths"][0],
            "CustomHits"
        );
    }

    #[test]
    fn prune_audio_cache_dirs_removes_stale_files_when_over_limit() {
        let tmp = TempTestDir::new("cache_prune");
        let slices_dir = tmp.path().join("slices");
        fs::create_dir_all(&slices_dir).unwrap();

        for i in 0..5 {
            fs::write(slices_dir.join(format!("s_{}.wav", i)), b"RIFF0000WAVE").unwrap();
        }
        // With min_age = 0s and max_files = 2, oldest 3 `.wav` files are pruned down to 2
        let removed = crate::prune_audio_cache_dirs(
            std::slice::from_ref(&slices_dir),
            2,
            u64::MAX,
            Duration::ZERO,
        );
        assert_eq!(removed, 3);

        // With min_age = 48h, freshly created files are preserved even if max_files = 0
        let removed_fresh = crate::prune_audio_cache_dirs(
            &[slices_dir],
            0,
            u64::MAX,
            Duration::from_secs(48 * 3600),
        );
        assert_eq!(removed_fresh, 0);
    }

    #[test]
    fn background_sync_reports_unchanged_when_no_files_added_modified_or_removed() {
        let tmp = TempTestDir::new("sync_noop");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");
        let lib_root = tmp.path().join("Pack");
        write_tiny_wav(&lib_root.join("kick.wav"), 2205);

        let lib_str = lib_root.to_string_lossy().to_string();
        let (first_lib, first_changed) =
            super::sync_library_with_conn_and_status(&mut conn, &lib_str, None, false)
                .expect("first sync");
        assert!(first_changed);
        assert_eq!(first_lib.sample_count, 1);

        let (second_lib, second_changed) =
            super::sync_library_with_conn_and_status(&mut conn, &lib_str, None, false)
                .expect("unchanged second sync");
        assert!(!second_changed);
        assert_eq!(second_lib.sample_count, 1);

        write_tiny_wav(&lib_root.join("snare.wav"), 2205);
        let (third_lib, third_changed) =
            super::sync_library_with_conn_and_status(&mut conn, &lib_str, None, false)
                .expect("third sync after add");
        assert!(third_changed);
        assert_eq!(third_lib.sample_count, 2);
    }

    #[test]
    fn query_samples_loads_tags_for_over_2000_samples_via_single_profile_join() {
        let tmp = TempTestDir::new("query_large_tags");
        let mut conn = init_db(&tmp.path().join("user")).expect("init db");
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'D:/Pack', 'Pack', 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO tags (id, name, color) VALUES (1, 'Drum', '#F59E0B')", [])
            .unwrap();

        let tx = conn.transaction().unwrap();
        for i in 1..=2050_i64 {
            tx.execute(
                "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, sample_rate, channels, bit_depth, file_size)
                 VALUES (?1, 1, ?2, ?3, 'wav', 500, 48000, 2, 24, 1024)",
                rusqlite::params![i, format!("D:/Pack/s_{}.wav", i), format!("s_{}.wav", i)],
            )
            .unwrap();
            if i == 1 || i == 2050 {
                tx.execute(
                    "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, 1, 1)",
                    rusqlite::params![i],
                )
                .unwrap();
            }
        }
        tx.commit().unwrap();

        let rows = query_samples_with_conn(
            &conn, None, None, None, None, None, Some(5000), Some(0), Some(false),
        )
        .expect("large profile sample query");
        assert_eq!(rows.len(), 2050);
        let tagged_ids: Vec<i64> = rows
            .iter()
            .filter(|s| s.tags.iter().any(|t| t.name == "Drum"))
            .map(|s| s.id)
            .collect();
        assert_eq!(tagged_ids.len(), 2);
        assert!(tagged_ids.contains(&1) && tagged_ids.contains(&2050));
    }

    #[test]
    fn get_profile_quick_stats_and_sample_by_id_with_peaks_respect_profile_scope() {
        let tmp = TempTestDir::new("quick_stats");
        let conn = init_db(&tmp.path().join("user")).expect("init db");
        conn.execute(
            "INSERT INTO profiles (id, name, color, settings_json, is_active) VALUES (2, 'Other', '#000000', '{}', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'D:/Main', 'Main', 1), (2, 'D:/Priv', 'Priv', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO profile_libraries (profile_id, library_id) VALUES (2, 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, sample_rate, channels, bit_depth, file_size, is_trashed, peaks_json)
             VALUES
               (10, 1, 'D:/Main/fav1.wav', 'fav1.wav', 'wav', 500, 48000, 2, 24, 1024, 0, '[0.2,0.8]'),
               (11, 1, 'D:/Main/norm.wav', 'norm.wav', 'wav', 500, 48000, 2, 24, 1024, 0, '[0.1]'),
               (12, 1, 'D:/Main/trashed.wav', 'trashed.wav', 'wav', 500, 48000, 2, 24, 1024, 1, '[0.9]'),
               (13, 2, 'D:/Priv/other_fav.wav', 'other_fav.wav', 'wav', 500, 48000, 2, 24, 1024, 0, '[0.5]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (1, 10), (1, 12), (2, 13)",
            [],
        )
        .unwrap();

        let stats = get_profile_quick_stats_with_conn(&conn, Some(vec![10, 11, 12, 13, 999, 10]))
            .expect("quick stats");
        assert_eq!(stats.favorites_count, 1);
        assert!(stats.existing_sample_ids.contains(&10));
        assert!(stats.existing_sample_ids.contains(&11));
        assert!(!stats.existing_sample_ids.contains(&12));
        assert!(!stats.existing_sample_ids.contains(&13));

        let with_peaks =
            get_sample_by_id_or_path_with_conn(&conn, Some(10), None, Some(true))
                .expect("sample with peaks")
                .expect("present");
        assert_eq!(with_peaks.peaks_json, "[0.2,0.8]");
        assert!(with_peaks.is_favorite);

        let without_peaks =
            get_sample_by_id_or_path_with_conn(&conn, Some(10), None, None)
                .expect("sample without peaks")
                .expect("present");
        assert_eq!(without_peaks.peaks_json, "");
        assert!(without_peaks.is_favorite);

        // Cross-profile sample (library 2 belongs only to profile 2) must NEVER leak even when both id and path are passed
        let foreign_both = get_sample_by_id_or_path_with_conn(
            &conn,
            Some(13),
            Some("D:/Priv/other_fav.wav".to_string()),
            Some(true),
        )
        .expect("foreign lookup ok");
        assert!(foreign_both.is_none());

        // Quarantined slice_trash files must be allowed for preview/peaks/transcode
        let slice_trash_dir = tmp.path().join("user").join("cache").join("slice_trash");
        fs::create_dir_all(&slice_trash_dir).unwrap();
        let trashed_slice = slice_trash_dir.join("1_slice.wav");
        fs::write(&trashed_slice, b"RIFF0000WAVE").unwrap();
        assert!(crate::security::validate_path_in_libraries_or_cache(
            &conn,
            &tmp.path().join("user"),
            &trashed_slice.to_string_lossy()
        )
        .is_ok());
    }

    #[test]
    fn per_profile_favorites_are_isolated_across_profiles_and_cascade_on_delete() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema_on_conn(&conn).unwrap();

        conn.execute(
            "INSERT INTO profiles (id, name, color, settings_json, is_active) VALUES (2, 'ProjectB', '#38BDF8', '{}', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'D:/SharedSFX', 'SharedSFX', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, sample_rate, channels, bit_depth, file_size)
             VALUES
               (101, 1, 'D:/SharedSFX/kick.wav', 'kick.wav', 'wav', 300, 48000, 2, 24, 1000),
               (102, 1, 'D:/SharedSFX/snare.wav', 'snare.wav', 'wav', 300, 48000, 2, 24, 1000)",
            [],
        )
        .unwrap();

        // Active profile 1 favorites sample 101
        let now_fav = crate::commands::samples::toggle_favorite_with_conn(&conn, 101).unwrap();
        assert!(now_fav);
        assert_eq!(
            get_profile_quick_stats_with_conn(&conn, None).unwrap().favorites_count,
            1
        );

        // Switch to profile 2: must see 0 favorites and NOT inherit profile 1's favorites
        conn.execute("UPDATE profiles SET is_active = CASE WHEN id = 2 THEN 1 ELSE 0 END", [])
            .unwrap();
        let p2_stats = get_profile_quick_stats_with_conn(&conn, None).unwrap();
        assert_eq!(p2_stats.favorites_count, 0);
        let p2_favs = query_samples_with_conn_ext(
            &conn, None, None, Some(true), None, None, None, None, None, Some(false),
        )
        .unwrap();
        assert!(p2_favs.is_empty());

        // Batch-favorite 102 on profile 2, leaving profile 1 untouched
        crate::commands::samples::toggle_favorites_batch_with_conn(&mut conn, &[102], true).unwrap();
        let p2_favs_after = query_samples_with_conn_ext(
            &conn, None, None, Some(true), None, None, None, None, None, Some(false),
        )
        .unwrap();
        assert_eq!(p2_favs_after.len(), 1);
        assert_eq!(p2_favs_after[0].id, 102);

        let p2_item_101 = get_sample_by_id_or_path_with_conn(&conn, Some(101), None, None)
            .unwrap()
            .unwrap();
        assert!(!p2_item_101.is_favorite);

        // Switch back to profile 1 -> still sees ONLY sample 101 as favorite
        conn.execute("UPDATE profiles SET is_active = CASE WHEN id = 1 THEN 1 ELSE 0 END", [])
            .unwrap();
        let p1_favs = query_samples_with_conn_ext(
            &conn, None, None, Some(true), None, None, None, None, None, Some(false),
        )
        .unwrap();
        assert_eq!(p1_favs.len(), 1);
        assert_eq!(p1_favs[0].id, 101);

        // Deleting profile 2 removes only profile 2's favorite rows via ON DELETE CASCADE
        conn.execute("DELETE FROM profiles WHERE id = 2", []).unwrap();
        let remaining_p2_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM profile_favorites WHERE profile_id = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining_p2_rows, 0);
        assert_eq!(
            get_profile_quick_stats_with_conn(&conn, None).unwrap().favorites_count,
            1
        );
    }
}
