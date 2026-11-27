use crate::commands::ProfileExportPackage;
use crate::security::{
    display_leaf, is_zip_magic, read_bounded_string, MAX_LEGACY_PROFILE_JSON_BYTES,
    MAX_PROFILE_UNCOMPRESSED_BYTES,
};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

static PROFILE_ARCHIVE_TMP_NONCE: AtomicU64 = AtomicU64::new(1);

pub const PROFILE_ARCHIVE_SUFFIXES: &[&str] = &[
    ".audify-profile",
    ".audify-profile.json",
    ".audify-profile.zip",
    ".json",
    ".zip",
];

pub const PROFILE_ARCHIVE_ENTRY_NAME: &str = "profile.json";
pub const PROFILE_MANIFEST_ENTRY_NAME: &str = "manifest.json";
const MAX_PROFILE_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileArchiveManifest {
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub sample_count: i64,
    #[serde(default)]
    pub includes_ai_tags: bool,
}

fn is_plain_json_target(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.trim().to_ascii_lowercase().ends_with(".json"))
        .unwrap_or(false)
}

fn read_zip_entry_bounded(
    archive: &mut ZipArchive<BufReader<File>>,
    entry_name: &str,
    max_bytes: u64,
) -> Result<String, String> {
    let entry = archive
        .by_name(entry_name)
        .map_err(|_| format!("Profile archive is missing '{}'", entry_name))?;
    if entry.is_symlink() || entry.is_dir() {
        return Err(format!("Invalid archive entry type for '{}'", entry_name));
    }
    if entry.size() > max_bytes {
        return Err(format!(
            "Profile archive entry '{}' exceeds maximum allowed size ({} bytes)",
            entry_name, max_bytes
        ));
    }
    let cap = (entry.size() as usize).min(max_bytes as usize);
    let mut buf = Vec::with_capacity(cap);
    entry
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read '{}': {}", entry_name, e))?;
    if (buf.len() as u64) > max_bytes {
        return Err(format!(
            "Profile archive entry '{}' exceeded decompression limit ({} bytes)",
            entry_name, max_bytes
        ));
    }
    String::from_utf8(buf).map_err(|e| format!("Archive entry '{}' is not valid UTF-8: {}", entry_name, e))
}

/// Writes a `ProfileExportPackage` either as compact JSON (if target ends in `.json`) or as a
/// deflate-compressed `.audify-profile` ZIP containing a fast `manifest.json` + `profile.json`.
pub(crate) fn write_profile_package_to_path(
    pkg: &ProfileExportPackage,
    target_path: &Path,
) -> Result<u64, String> {
    let compact_json = serde_json::to_string(pkg)
        .map_err(|e| format!("Failed to serialize profile package: {}", e))?;

    if is_plain_json_target(target_path) {
        fs::write(target_path, compact_json.as_bytes())
            .map_err(|_| format!("Failed to write profile export {}", display_leaf(target_path)))?;
        return Ok(compact_json.len() as u64);
    }

    let manifest = ProfileArchiveManifest {
        format: pkg.format.clone(),
        version: pkg.version,
        name: pkg.name.clone(),
        sample_count: pkg.sample_refs.len() as i64,
        includes_ai_tags: pkg.includes_ai_tags,
    };
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|e| format!("Failed to serialize profile manifest: {}", e))?;

    let tmp_nonce = PROFILE_ARCHIVE_TMP_NONCE.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(
        ".{}.tmp_{}_{}",
        display_leaf(target_path),
        std::process::id(),
        tmp_nonce
    );
    let tmp_path = target_path
        .parent()
        .map(|p| p.join(&tmp_name))
        .unwrap_or_else(|| target_path.with_extension("tmp"));

    let write_res: Result<(), String> = (|| {
        let out_file = File::create(&tmp_path).map_err(|_| {
            format!(
                "Failed to create profile archive {}",
                display_leaf(target_path)
            )
        })?;
        let mut zip = ZipWriter::new(out_file);
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(6));

        zip.start_file(PROFILE_MANIFEST_ENTRY_NAME, opts)
            .map_err(|e| format!("Failed to start manifest entry: {}", e))?;
        zip.write_all(manifest_json.as_bytes())
            .map_err(|e| format!("Failed to write manifest entry: {}", e))?;

        zip.start_file(PROFILE_ARCHIVE_ENTRY_NAME, opts)
            .map_err(|e| format!("Failed to start profile entry: {}", e))?;
        zip.write_all(compact_json.as_bytes())
            .map_err(|e| format!("Failed to write profile entry: {}", e))?;

        zip.finish()
            .map_err(|e| format!("Failed to finalize profile archive: {}", e))?;
        Ok(())
    })();

    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }

    if fs::rename(&tmp_path, target_path).is_err() {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to finalize profile archive {}",
            display_leaf(target_path)
        ));
    }

    let len = fs::metadata(target_path).map(|m| m.len()).unwrap_or(0);
    Ok(len)
}

/// Reads a `ProfileExportPackage` from either a compressed `.audify-profile` ZIP or a plain
/// `.audify-profile.json` (supporting v1, v2, v3, and v4 schemas).
pub(crate) fn read_profile_package_from_path(path: &Path) -> Result<ProfileExportPackage, String> {
    let raw_str = path.to_string_lossy();
    if crate::security::is_unc_or_network_path(&raw_str) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if crate::security::has_ntfs_ads_colon(&raw_str) {
        return Err("Alternate data streams are not allowed".to_string());
    }
    let sym = fs::symlink_metadata(path)
        .map_err(|_| format!("Failed to locate profile file {}", display_leaf(path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }

    let canon = fs::canonicalize(path)
        .map_err(|_| format!("Failed to locate profile file {}", display_leaf(path)))?;
    if crate::security::is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Symbolic links pointing to network/UNC paths are not allowed".to_string());
    }

    let mut magic = [0u8; 4];
    let magic_len = File::open(&canon)
        .and_then(|mut f| f.read(&mut magic))
        .map_err(|_| format!("Failed to open profile file {}", display_leaf(path)))?;

    let content = if magic_len >= 4 && is_zip_magic(&magic) {
        let meta = fs::metadata(&canon)
            .map_err(|_| format!("Failed to inspect profile archive {}", display_leaf(path)))?;
        if !meta.is_file() || meta.len() > MAX_PROFILE_UNCOMPRESSED_BYTES {
            return Err(format!(
                "Profile archive {} is invalid or exceeds size limit",
                display_leaf(path)
            ));
        }
        let file = File::open(&canon)
            .map_err(|_| format!("Failed to open profile archive {}", display_leaf(path)))?;
        let mut archive = ZipArchive::new(BufReader::new(file))
            .map_err(|_| format!("Invalid .audify-profile archive {}", display_leaf(path)))?;
        read_zip_entry_bounded(
            &mut archive,
            PROFILE_ARCHIVE_ENTRY_NAME,
            MAX_PROFILE_UNCOMPRESSED_BYTES,
        )?
    } else {
        read_bounded_string(&canon, MAX_LEGACY_PROFILE_JSON_BYTES)?
    };

    serde_json::from_str(&content)
        .map_err(|e| format!("Invalid profile package format in {}: {}", display_leaf(path), e))
}

/// Quickly extracts summary metadata for `list_backups` without inflating large JSON payloads.
pub(crate) fn read_profile_backup_summary(path: &Path) -> ProfileArchiveManifest {
    let fallback = ProfileArchiveManifest {
        format: "audify-profile".to_string(),
        version: 2,
        name: "Workspace".to_string(),
        sample_count: 0,
        includes_ai_tags: false,
    };

    let raw_str = path.to_string_lossy();
    if crate::security::is_unc_or_network_path(&raw_str)
        || crate::security::has_ntfs_ads_colon(&raw_str)
    {
        return fallback;
    }
    let Ok(sym) = fs::symlink_metadata(path) else {
        return fallback;
    };
    if sym.file_type().is_symlink() || !sym.is_file() {
        return fallback;
    }
    let Ok(mut f) = File::open(path) else {
        return fallback;
    };
    let mut magic = [0u8; 4];
    let n = f.read(&mut magic).unwrap_or(0);
    drop(f);

    if n >= 4 && is_zip_magic(&magic) {
        if let Ok(file) = File::open(path) {
            if let Ok(mut archive) = ZipArchive::new(BufReader::new(file)) {
                if let Ok(raw) = read_zip_entry_bounded(
                    &mut archive,
                    PROFILE_MANIFEST_ENTRY_NAME,
                    MAX_PROFILE_MANIFEST_BYTES,
                ) {
                    if let Ok(m) = serde_json::from_str::<ProfileArchiveManifest>(&raw) {
                        return m;
                    }
                }
            }
        }
        return fallback;
    }

    if let Ok(raw) = read_bounded_string(path, MAX_LEGACY_PROFILE_JSON_BYTES) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            let name = v
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("Workspace")
                .to_string();
            let sample_count = v
                .get("sample_refs")
                .and_then(|arr| arr.as_array())
                .map(|a| a.len() as i64)
                .unwrap_or(0);
            let includes_ai_tags = v
                .get("includes_ai_tags")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            return ProfileArchiveManifest {
                format: v
                    .get("format")
                    .and_then(|s| s.as_str())
                    .unwrap_or("audify-profile-v2")
                    .to_string(),
                version: v.get("version").and_then(|n| n.as_u64()).unwrap_or(2) as u32,
                name,
                sample_count,
                includes_ai_tags,
            };
        }
    }

    fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::profiles::export_pkg::build_profile_export_package_with_options;
    use crate::commands::profiles::import_pkg::import_profile_from_file_with_conn;
    use crate::db::{get_active_profile_id, init_db};
    use crate::security::{normalize_clean_path, strip_verbatim_prefix};
    use rusqlite::params;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestTempDir(PathBuf);
    impl TestTempDir {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let p = std::env::temp_dir().join(format!(
                "audify_profile_v3_test_{}_{}_{}",
                tag,
                std::process::id(),
                nanos
            ));
            fs::create_dir_all(&p).unwrap();
            let clean = fs::canonicalize(&p)
                .map(|c| strip_verbatim_prefix(&c))
                .unwrap_or(p);
            Self(clean)
        }
    }
    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn profile_v3_deduplicates_refs_splits_ai_tags_and_roundtrips_zip() {
        let tmp = TestTempDir::new("rt");
        let user_dir = tmp.0.join("user");
        let lib_dir = tmp.0.join("MyPack");
        fs::create_dir_all(&lib_dir).unwrap();
        let wav_path = lib_dir.join("snare.wav");
        fs::write(&wav_path, b"RIFF0000WAVEfmt ").unwrap();

        let mut conn = init_db(&user_dir).expect("init_db");
        let pid = get_active_profile_id(&conn);

        let clean_lib = normalize_clean_path(&lib_dir.to_string_lossy());
        let clean_wav = normalize_clean_path(&wav_path.to_string_lossy());

        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'MyPack', 1)",
            params![clean_lib],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, ?2, 'snare.wav', 'wav', 250, 1024)",
            params![lib_id, clean_wav],
        )
        .unwrap();
        let sid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
            params![pid, sid],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('Snappy', '#38BDF8', 1)",
            [],
        )
        .unwrap();
        let manual_tid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('AcousticDrum', '#A855F7', 1)",
            [],
        )
        .unwrap();
        let ai_tid = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')",
            params![sid, manual_tid],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'ai_approved')",
            params![sid, ai_tid],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO collections (name, color, profile_id) VALUES ('DrumKit', '#10B981', ?1)",
            params![pid],
        )
        .unwrap();
        let cid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO collection_items (collection_id, sample_id) VALUES (?1, ?2)",
            params![cid, sid],
        )
        .unwrap();

        // Tier 1 (without AI tags): only manual tags, favorites, and collections exported
        let (_, pkg_compact) =
            build_profile_export_package_with_options(&conn, pid, false).expect("compact export");
        assert_eq!(pkg_compact.version, 4);
        assert!(!pkg_compact.includes_ai_tags);
        assert_eq!(pkg_compact.sample_refs.len(), 1);
        assert_eq!(pkg_compact.favorite_ref_indices, vec![0]);
        assert!(pkg_compact.manual_tag_ref_indices.contains_key("Snappy"));
        assert!(pkg_compact.ai_approved_tag_ref_indices.is_empty());
        assert!(pkg_compact.favorite_samples.is_empty());
        assert!(pkg_compact.manual_tag_samples.is_empty());

        // Tier 1 + AI tags: single deduplicated sample_ref shared across manual, AI, favorite, collection
        let (_, pkg_with_ai) =
            build_profile_export_package_with_options(&conn, pid, true).expect("ai export");
        assert_eq!(pkg_with_ai.version, 4);
        assert!(pkg_with_ai.includes_ai_tags);
        assert_eq!(pkg_with_ai.sample_refs.len(), 1);
        assert_eq!(
            pkg_with_ai.ai_approved_tag_ref_indices.get("AcousticDrum"),
            Some(&vec![0usize])
        );

        let zip_path = tmp.0.join("compact.audify-profile");
        let written_len = write_profile_package_to_path(&pkg_with_ai, &zip_path).expect("write zip");
        assert!(written_len > 0);

        let summary = read_profile_backup_summary(&zip_path);
        assert_eq!(summary.version, 4);
        assert_eq!(summary.sample_count, 1);
        assert!(summary.includes_ai_tags);

        // Clear tags and favorite before re-importing into new profile
        conn.execute("DELETE FROM sample_tags", []).unwrap();
        conn.execute("DELETE FROM profile_favorites", []).unwrap();
        conn.execute("DELETE FROM collection_items", []).unwrap();

        let imported =
            import_profile_from_file_with_conn(&mut conn, &zip_path.to_string_lossy())
                .expect("import v3 zip");
        assert_eq!(imported.report.matched, 1);

        let is_fav_in_imported: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM profile_favorites WHERE profile_id = ?1 AND sample_id = ?2)",
                params![imported.profile.id, sid],
                |r| r.get(0),
            )
            .unwrap();
        assert!(is_fav_in_imported);

        let is_fav_in_source: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM profile_favorites WHERE profile_id = ?1 AND sample_id = ?2)",
                params![pid, sid],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!is_fav_in_source);

        let manual_src: String = conn
            .query_row(
                "SELECT source FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
                params![sid, manual_tid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(manual_src, "manual");

        let ai_src: String = conn
            .query_row(
                "SELECT source FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
                params![sid, ai_tid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ai_src, "ai_approved");
    }

    #[test]
    fn per_profile_favorites_survive_import_and_switch_back_without_resetting_source() {
        use crate::commands::samples::{
            get_profile_quick_stats_with_conn, query_samples_with_conn,
        };

        let tmp = TestTempDir::new("switch_back");
        let user_dir = tmp.0.join("user");
        let lib_dir = tmp.0.join("SFX");
        fs::create_dir_all(&lib_dir).unwrap();
        let wav_a = lib_dir.join("a.wav");
        let wav_b = lib_dir.join("b.wav");
        fs::write(&wav_a, b"RIFF0000WAVEfmt ").unwrap();
        fs::write(&wav_b, b"RIFF0000WAVEfmt ").unwrap();

        let mut conn = init_db(&user_dir).expect("init_db");
        let primary_id = get_active_profile_id(&conn);

        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'SFX', 1)",
            params![normalize_clean_path(&lib_dir.to_string_lossy())],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, ?2, 'a.wav', 'wav', 250, 1024)",
            params![lib_id, normalize_clean_path(&wav_a.to_string_lossy())],
        )
        .unwrap();
        let sid_a = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, ?2, 'b.wav', 'wav', 250, 1024)",
            params![lib_id, normalize_clean_path(&wav_b.to_string_lossy())],
        )
        .unwrap();
        let sid_b = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
            params![primary_id, sid_a],
        )
        .unwrap();

        // Create and export a separate profile with 0 favorites (e.g., DaVinci Relink package)
        conn.execute("UPDATE profiles SET is_active = 0", []).unwrap();
        conn.execute(
            "INSERT INTO profiles (name, color, settings_json, is_active, created_at)
             VALUES ('Relink', '#38BDF8', '{}', 1, datetime('now'))",
            [],
        )
        .unwrap();
        let relink_template_id = conn.last_insert_rowid();
        let (_, pkg_zero_favs) =
            build_profile_export_package_with_options(&conn, relink_template_id, false)
                .expect("export zero-fav profile");
        let zip_path = tmp.0.join("relink.audify-profile");
        write_profile_package_to_path(&pkg_zero_favs, &zip_path).expect("write zip");

        // Import zero-fav profile -> becomes active with 0 favorites, then switch back to primary profile
        let imported = import_profile_from_file_with_conn(&mut conn, &zip_path.to_string_lossy())
            .expect("import zero-fav profile");
        assert_eq!(
            get_profile_quick_stats_with_conn(&conn, None)
                .unwrap()
                .favorites_count,
            0
        );

        // Star sid_b only in imported profile
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
            params![imported.profile.id, sid_b],
        )
        .unwrap();
        assert_eq!(
            get_profile_quick_stats_with_conn(&conn, None)
                .unwrap()
                .favorites_count,
            1
        );

        // Switch back to primary profile and verify it still has its exact original favorite (sid_a only)
        conn.execute("UPDATE profiles SET is_active = 0", []).unwrap();
        conn.execute(
            "UPDATE profiles SET is_active = 1 WHERE id = ?1",
            params![primary_id],
        )
        .unwrap();

        assert_eq!(
            get_profile_quick_stats_with_conn(&conn, None)
                .unwrap()
                .favorites_count,
            1
        );
        let primary_favs = query_samples_with_conn(
            &conn,
            None,
            None,
            Some(true),
            None,
            None,
            Some(100),
            Some(0),
            Some(false),
        )
        .unwrap();
        assert_eq!(primary_favs.len(), 1);
        assert_eq!(primary_favs[0].id, sid_a);
    }

    #[test]
    fn v3_profile_export_import_share_duplicate_and_settings_parity() {
        use crate::commands::profiles::export_share::apply_share_safe;
        use crate::commands::profiles::{
            duplicate_profile_with_conn, import_settings_from_file_with_conn,
        };

        let tmp = TestTempDir::new("v3_parity");
        let user_dir = tmp.0.join("user");
        let lib_dir = tmp.0.join("ReadOnlyLib");
        let drums_dir = lib_dir.join("Drums");
        let slices_dir = lib_dir.join("MySlices");
        fs::create_dir_all(&drums_dir).unwrap();
        fs::create_dir_all(&slices_dir).unwrap();
        let src_wav = drums_dir.join("kick.wav");
        let slice_wav = slices_dir.join("kick_slice.wav");
        fs::write(&src_wav, b"RIFF0000WAVEfmt ").unwrap();
        fs::write(&slice_wav, b"RIFF0000WAVEfmt ").unwrap();

        let mut conn = init_db(&user_dir).expect("init_db");
        let pid = get_active_profile_id(&conn);

        let clean_lib = normalize_clean_path(&lib_dir.to_string_lossy());
        let clean_src = normalize_clean_path(&src_wav.to_string_lossy());
        let clean_slice = normalize_clean_path(&slice_wav.to_string_lossy());
        let custom_slice_dir = "D:/StudioArchive/MySlices";
        let custom_bg_img = "D:/StudioArchive/bg.png";

        conn.execute(
            "INSERT INTO libraries (path, name, is_global, is_read_only) VALUES (?1, 'ReadOnlyLib', 0, 1)",
            params![clean_lib],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO profile_libraries (profile_id, library_id) VALUES (?1, ?2)",
            params![pid, lib_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size, bpm, bpm_is_manual, musical_key, camelot_key, key_is_manual)
             VALUES (?1, ?2, 'kick.wav', 'wav', 500, 1024, 128.0, 1, 'Am', '8A', 1)",
            params![lib_id, clean_src],
        )
        .unwrap();
        let sid = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO sample_slices (
                profile_id, slice_path, slice_name, source_sample_id,
                source_file_path, source_file_name, start_sec, end_sec,
                pitch_semitones, micro_fade, duration_ms, is_favorite,
                peaks_json, sample_rate, channels, bit_depth, created_at
             ) VALUES (?1, ?2, 'kick_slice.wav', ?3, ?4, 'kick.wav', 0.1, 0.4, -2.0, 0, 300, 1, '[0.2,0.8]', 48000, 2, 16, datetime('now'))",
            params![pid, clean_slice, sid, clean_src],
        )
        .unwrap();

        let settings_json = serde_json::json!({
            "themeMode": "dark",
            "binSampleIds": [sid],
            "customSliceExportPath": custom_slice_dir,
            "customBgImage": custom_bg_img,
            "collectionTemplates": [{
                "name": "DrumTMPL",
                "folder_path": "",
                "rel_folder_path": "Drums"
            }]
        })
        .to_string();
        conn.execute(
            "UPDATE profiles SET settings_json = ?1 WHERE id = ?2",
            params![settings_json, pid],
        )
        .unwrap();

        let (_, pkg) =
            build_profile_export_package_with_options(&conn, pid, false).expect("build v3 pkg");
        assert!(pkg.libraries.iter().any(|l| l.name == "ReadOnlyLib" && l.is_read_only));
        assert_eq!(pkg.bin_sample_indices.len(), 1);
        assert_eq!(pkg.manual_bpm_key_ref_indices.len(), 1);
        assert_eq!(pkg.slices.len(), 1);
        assert_eq!(
            pkg.settings.get("customSliceExportPath").and_then(|v| v.as_str()),
            Some(custom_slice_dir)
        );
        assert_eq!(
            pkg.settings.get("customBgImage").and_then(|v| v.as_str()),
            Some(custom_bg_img)
        );

        let mut share_pkg = pkg.clone();
        apply_share_safe(&mut share_pkg);
        assert!(share_pkg.libraries.is_empty());
        assert_eq!(share_pkg.bin_sample_indices.len(), 1);
        assert!(!share_pkg.sample_refs[0].file_path.contains("ReadOnlyLib"));
        assert!(share_pkg
            .settings
            .get("binSampleIds")
            .and_then(|v| v.as_array())
            .is_some_and(|a| a.is_empty()));
        assert_eq!(
            share_pkg.settings.get("customSliceExportPath").and_then(|v| v.as_str()),
            Some("")
        );
        assert_eq!(
            share_pkg.settings.get("customBgImage").and_then(|v| v.as_str()),
            Some("")
        );
        assert_eq!(share_pkg.slices[0].slice_path, "kick_slice.wav");
        assert_eq!(share_pkg.slices[0].source_file_path, "kick.wav");

        // Clear manual BPM/key + read_only flag on sample before testing full re-import restoration
        conn.execute(
            "UPDATE samples SET bpm = NULL, bpm_is_manual = 0, musical_key = '', camelot_key = '', key_is_manual = 0 WHERE id = ?1",
            params![sid],
        )
        .unwrap();
        let pkg_path = tmp.0.join("full_v3.audify-profile");
        write_profile_package_to_path(&pkg, &pkg_path).expect("write v3 pkg");
        let imported = import_profile_from_file_with_conn(&mut conn, &pkg_path.to_string_lossy())
            .expect("import v3 pkg");

        let restored_meta: (Option<f64>, i64, String, String, i64) = conn
            .query_row(
                "SELECT bpm, bpm_is_manual, musical_key, camelot_key, key_is_manual FROM samples WHERE id = ?1",
                params![sid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(restored_meta, (Some(128.0), 1, "Am".to_string(), "8A".to_string(), 1));

        let imported_slices: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_slices WHERE profile_id = ?1 AND slice_name = 'kick_slice.wav'",
                params![imported.profile.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(imported_slices, 1);

        let imp_settings: serde_json::Value =
            serde_json::from_str(&imported.profile.settings_json).unwrap();
        assert_eq!(
            imp_settings
                .get("binSampleIds")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_i64()).collect::<Vec<_>>()),
            Some(vec![sid])
        );

        let dup = duplicate_profile_with_conn(&mut conn, imported.profile.id, "Cloned V3")
            .expect("duplicate_profile_with_conn");
        let dup_slices: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_slices WHERE profile_id = ?1 AND slice_name = 'kick_slice.wav'",
                params![dup.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dup_slices, 1);

        let settings_file = tmp.0.join("relink.audify-settings.json");
        fs::write(&settings_file, settings_json).unwrap();
        let saved_profile =
            import_settings_from_file_with_conn(&conn, &settings_file.to_string_lossy())
                .expect("import_settings_from_file_with_conn");
        let relinked_val: serde_json::Value =
            serde_json::from_str(&saved_profile.settings_json).unwrap();
        let resolved_dir = relinked_val["collectionTemplates"][0]["folder_path"]
            .as_str()
            .unwrap_or("");
        assert!(
            resolved_dir.ends_with("/Drums"),
            "expected rel_folder_path relinked to Drums, got '{}'",
            resolved_dir
        );
    }

    #[test]
    fn profile_v4_roundtrips_taxonomy_hierarchy_preserves_custom_colors_and_imports_legacy_v3() {
        use crate::db::taxonomy::{ensure_taxonomy_tag, sync_primary_genre_for_samples};

        let tmp = TestTempDir::new("v4_taxonomy");
        let user_dir = tmp.0.join("user");
        let lib_dir = tmp.0.join("SFX");
        fs::create_dir_all(&lib_dir).unwrap();
        let wav_path = lib_dir.join("wolf_dark.wav");
        fs::write(&wav_path, b"RIFF0000WAVEfmt ").unwrap();

        let mut conn = init_db(&user_dir).expect("init_db");
        let pid = get_active_profile_id(&conn);

        conn.execute(
            "INSERT INTO libraries (path, name, is_global) VALUES (?1, 'SFX', 1)",
            params![normalize_clean_path(&lib_dir.to_string_lossy())],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, ?2, 'wolf_dark.wav', 'wav', 600, 1024)",
            params![lib_id, normalize_clean_path(&wav_path.to_string_lossy())],
        )
        .unwrap();
        let sid = conn.last_insert_rowid();

        let animals_id = ensure_taxonomy_tag(&conn, "Animals", Some("category"), None, Some("#22C55E"), true).unwrap();
        let wolf_id = ensure_taxonomy_tag(&conn, "Wolf", Some("category"), Some("Animals"), None, true).unwrap();
        let custom_facet = crate::commands::taxonomy::create_tag_facet_with_conn(
            &conn,
            "Mic Type",
            "tags",
            "#0EA5E9",
            false,
        )
        .unwrap();
        let ribbon_id = ensure_taxonomy_tag(&conn, "RibbonMic", Some(&custom_facet.slug), None, Some("#0EA5E9"), true).unwrap();
        conn.execute(
            "UPDATE tags SET aliases_json = '[\"Lupine\"]' WHERE id = ?1",
            params![wolf_id],
        )
        .unwrap();
        let cin_id = ensure_taxonomy_tag(&conn, "Cinematic", Some("genre"), None, None, true).unwrap();
        let dark_id = ensure_taxonomy_tag(&conn, "Dark", Some("mood"), None, None, true).unwrap();

        for tid in [wolf_id, ribbon_id, cin_id, dark_id] {
            conn.execute(
                "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 1, 'manual')",
                params![sid, tid],
            )
            .unwrap();
        }
        sync_primary_genre_for_samples(&conn, &[sid]).unwrap();

        let (_, pkg_v4) =
            build_profile_export_package_with_options(&conn, pid, false).expect("export v4");
        assert_eq!(pkg_v4.version, 4);
        assert!(pkg_v4.facets.iter().any(|f| f.slug == "mic_type" && f.domain == "tags"));
        let wolf_entry = pkg_v4.tags.iter().find(|t| t.name == "Wolf").expect("Wolf exported");
        assert_eq!(wolf_entry.parent_name.as_deref(), Some("Animals"));
        assert_eq!(wolf_entry.aliases, vec!["Lupine".to_string()]);
        assert!(wolf_entry.color_inherited);

        let v4_path = tmp.0.join("taxonomy_v4.audify-profile");
        write_profile_package_to_path(&pkg_v4, &v4_path).expect("write v4");

        // Wipe sample_tags, Wolf, RibbonMic & custom facet, customize Animals local color to verify existing custom color is NOT clobbered
        conn.execute("DELETE FROM sample_tags", []).unwrap();
        conn.execute("DELETE FROM tags WHERE id IN (?1, ?2)", params![wolf_id, ribbon_id]).unwrap();
        conn.execute("DELETE FROM tag_facets WHERE id = ?1", params![custom_facet.id]).unwrap();
        conn.execute(
            "UPDATE tags SET color = '#123456', color_inherited = 0 WHERE id = ?1",
            params![animals_id],
        )
        .unwrap();
        conn.execute("UPDATE samples SET genre = '', genre_is_manual = 0 WHERE id = ?1", params![sid]).unwrap();

        let imported =
            import_profile_from_file_with_conn(&mut conn, &v4_path.to_string_lossy()).expect("import v4");
        assert_eq!(imported.report.matched, 1);

        let animals_color: String = conn
            .query_row("SELECT color FROM tags WHERE id = ?1", params![animals_id], |r| r.get(0))
            .unwrap();
        assert_eq!(animals_color, "#123456", "existing local tag color must be preserved on import");

        let (restored_parent, restored_aliases): (Option<i64>, String) = conn
            .query_row(
                "SELECT parent_id, aliases_json FROM tags WHERE name = 'Wolf'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored_parent, Some(animals_id));
        assert!(restored_aliases.contains("Lupine"));

        let restored_genre: String = conn
            .query_row("SELECT genre FROM samples WHERE id = ?1", params![sid], |r| r.get(0))
            .unwrap();
        assert_eq!(restored_genre, "Cinematic");

        let restored_ribbon_facet: String = conn
            .query_row(
                "SELECT f.slug FROM tags t JOIN tag_facets f ON f.id = t.facet_id WHERE t.name = 'RibbonMic'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(restored_ribbon_facet, "mic_type");

        // Verify legacy v3 JSON package with "Sountrack" typo & flat genre imports cleanly
        let v3_json = serde_json::json!({
            "format": "audify-profile",
            "version": 3,
            "name": "LegacyV3",
            "color": "#38BDF8",
            "settings": {},
            "libraries": [{ "name": "SFX", "path": normalize_clean_path(&lib_dir.to_string_lossy()), "is_global": true }],
            "collections": [],
            "tags": [{ "name": "LegacyCustom", "color": "#AA5500" }],
            "genres": [{ "name": "Sountrack", "color": "#3B82F6" }],
            "sample_refs": [{
                "file_path": normalize_clean_path(&wav_path.to_string_lossy()),
                "rel_path": "wolf_dark.wav",
                "file_name": "wolf_dark.wav",
                "file_size": 1024
            }],
            "manual_tag_ref_indices": { "LegacyCustom": [0] },
            "manual_genre_ref_indices": { "Sountrack": [0] }
        });
        let v3_path = tmp.0.join("legacy_v3.audify-profile.json");
        fs::write(&v3_path, serde_json::to_string(&v3_json).unwrap()).unwrap();
        conn.execute("DELETE FROM sample_tags", []).unwrap();
        conn.execute("UPDATE samples SET genre = '', genre_is_manual = 0 WHERE id = ?1", params![sid]).unwrap();

        import_profile_from_file_with_conn(&mut conn, &v3_path.to_string_lossy()).expect("import legacy v3");
        let fixed_genre: String = conn
            .query_row("SELECT genre FROM samples WHERE id = ?1", params![sid], |r| r.get(0))
            .unwrap();
        assert_eq!(fixed_genre, "Soundtrack");
    }
}
