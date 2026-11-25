pub mod batch_rename_ops;
pub mod external_import;
pub mod folder_ops;
pub mod move_relocate;
pub mod rename_ops;
pub mod trash_ops;
pub mod trash_restore;

pub use batch_rename_ops::*;
pub use external_import::*;
pub use folder_ops::*;
pub use move_relocate::*;
pub use rename_ops::*;
pub use trash_ops::*;
pub use trash_restore::*;

use crate::db::get_active_profile_id;
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path,
    reject_symlink_ancestors, strip_verbatim_prefix,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOpJournalEntry {
    pub id: i64,
    pub sample_id: i64,
    pub op_type: String,
    pub old_path: String,
    pub new_path: String,
    pub old_name: String,
    pub new_name: String,
    pub created_at: String,
    pub can_undo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashStatusInfo {
    pub trashed_count: usize,
    pub total_bytes: u64,
    pub journal_entries: Vec<FileOpJournalEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashActionSummary {
    pub affected_count: usize,
    pub affected_ids: Vec<i64>,
    pub trashed_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubfolderRenameSummary {
    pub old_folder_path: String,
    pub new_folder_path: String,
    pub new_folder_name: String,
    pub updated_sample_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileCollisionItem {
    pub source_path: String,
    pub sample_id: Option<i64>,
    pub file_name: String,
    pub suggested_new_name: String,
    pub source_size: u64,
    pub existing_size: u64,
    pub target_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovedSampleRecord {
    pub sample_id: i64,
    pub old_library_id: i64,
    pub new_library_id: i64,
    pub old_path: String,
    pub new_path: String,
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleRelocateEntry {
    pub sample_id: i64,
    pub target_library_id: i64,
    pub target_path: String,
    pub target_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderDropResult {
    pub status: String,
    pub target_library_id: i64,
    pub target_folder_path: String,
    pub moved_records: Vec<MovedSampleRecord>,
    pub imported_sample_ids: Vec<i64>,
    pub conflicts: Vec<FileCollisionItem>,
    pub skipped_duplicates: Vec<String>,
    pub skipped_same_folder: usize,
    pub skipped_unsupported: usize,
    pub skipped_conflicts: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DroppedAudioFilePayload {
    pub file_name: String,
    pub bytes: Vec<u8>,
}

fn drive_or_root_prefix(p: &Path) -> String {
    let norm = normalize_clean_path(&p.to_string_lossy());
    if cfg!(windows) {
        let bytes = norm.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return norm[..2].to_ascii_lowercase();
        }
    }
    "/".to_string()
}

pub(super) fn is_same_volume(a: &Path, b: &Path) -> bool {
    drive_or_root_prefix(a) == drive_or_root_prefix(b)
}

pub(super) fn is_same_folder_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

fn is_cross_device_rename_err(err: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        // ERROR_NOT_SAME_DEVICE (17)
        err.raw_os_error() == Some(17)
    }
    #[cfg(not(windows))]
    {
        // EXDEV (18)
        err.raw_os_error() == Some(18)
    }
}

pub(crate) fn move_file_resilient(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            format!("Failed to create target directory {}", display_leaf(parent))
        })?;
    }
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            if !is_cross_device_rename_err(&rename_err) {
                return Err(format!(
                    "Failed to move file '{}' -> '{}'",
                    display_leaf(src),
                    display_leaf(dst),
                ));
            }
            let src_len = fs::metadata(src)
                .map_err(|_| format!("Source file unavailable '{}'", display_leaf(src)))?
                .len();
            let mut src_file = fs::File::open(src)
                .map_err(|_| format!("Failed to read source file '{}'", display_leaf(src)))?;
            let mut dst_file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dst)
                .map_err(|_| {
                    format!(
                        "Destination '{}' already exists or cannot be created",
                        display_leaf(dst)
                    )
                })?;
            let copied = std::io::copy(&mut src_file, &mut dst_file).map_err(|_| {
                let _ = fs::remove_file(dst);
                format!(
                    "Failed to copy file '{}' -> '{}'",
                    display_leaf(src),
                    display_leaf(dst),
                )
            })?;
            if copied != src_len || dst_file.sync_all().is_err() {
                drop(dst_file);
                let _ = fs::remove_file(dst);
                return Err(format!(
                    "Incomplete file copy for '{}' -> '{}'",
                    display_leaf(src),
                    display_leaf(dst),
                ));
            }
            drop(dst_file);
            drop(src_file);
            fs::remove_file(src).map_err(|_| {
                let _ = fs::remove_file(dst);
                format!("Failed to finalize file move '{}'", display_leaf(src))
            })?;
            Ok(())
        }
    }
}

pub(crate) fn rollback_disk_moves(completed_moves: &[(PathBuf, PathBuf)]) {
    for (from_pb, to_pb) in completed_moves.iter().rev() {
        if to_pb.exists() && !from_pb.exists() {
            let _ = move_file_resilient(to_pb, from_pb);
        }
    }
}

pub(super) fn prune_file_ops_journal(tx: &Connection) {
    let _ = tx.execute(
        "DELETE FROM file_ops_journal
         WHERE id NOT IN (SELECT id FROM file_ops_journal ORDER BY id DESC LIMIT 200)",
        [],
    );
}

pub(super) fn is_path_inside_quarantine_dir(
    target_canon: &Path,
    user_dir: &Path,
    lib_path: &str,
) -> bool {
    let user_trash = user_dir.join("trash");
    if !is_unc_or_network_path(&user_trash.to_string_lossy()) {
        if let Ok(trash_canon) = user_trash.canonicalize() {
            if target_canon.starts_with(&trash_canon) {
                return true;
            }
        }
    }
    let lib_trash = Path::new(lib_path).join(".audify_trash");
    if !is_unc_or_network_path(&lib_trash.to_string_lossy()) {
        if let Ok(lib_trash_canon) = lib_trash.canonicalize() {
            if target_canon.starts_with(&lib_trash_canon) {
                return true;
            }
        }
    }
    false
}

pub(super) fn is_dir_inside_library_root(dir_canon: &Path, lib_path: &str) -> bool {
    if is_unc_or_network_path(lib_path) {
        return false;
    }
    if let Ok(lib_canon) = Path::new(lib_path).canonicalize() {
        if !is_unc_or_network_path(&lib_canon.to_string_lossy()) {
            return dir_canon.starts_with(&lib_canon);
        }
    }
    false
}

pub(crate) fn query_trash_status_with_conn(conn: &Connection) -> Result<TrashStatusInfo, String> {
    let active_id = get_active_profile_id(conn);

    let (count, bytes): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(s.file_size), 0)
             FROM samples s
             WHERE COALESCE(s.is_trashed, 0) = 1
               AND s.library_id IN (
                   SELECT l.id FROM libraries l
                   WHERE l.is_global = 1
                      OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1)
               )",
            params![active_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, 0));

    let mut journal_entries = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT j.id, j.sample_id, j.op_type, j.old_path, j.new_path, j.old_name, j.new_name, j.created_at,
                CASE
                    WHEN j.id != (SELECT MAX(j2.id) FROM file_ops_journal j2 WHERE j2.sample_id = j.sample_id) THEN 0
                    WHEN j.op_type = 'RENAME' THEN EXISTS(
                        SELECT 1 FROM samples s
                        WHERE s.id = j.sample_id
                          AND COALESCE(s.is_trashed, 0) = 0
                          AND s.file_name = j.new_name
                          AND s.previous_file_name = j.old_name
                    )
                    WHEN j.op_type = 'TRASH' THEN EXISTS(
                        SELECT 1 FROM samples s
                        WHERE s.id = j.sample_id
                          AND COALESCE(s.is_trashed, 0) = 1
                    )
                    WHEN j.op_type = 'MOVE' THEN EXISTS(
                        SELECT 1 FROM samples s
                        WHERE s.id = j.sample_id
                          AND COALESCE(s.is_trashed, 0) = 0
                          AND s.file_path = j.new_path
                    )
                    ELSE 0
                END AS can_undo
         FROM file_ops_journal j
         INNER JOIN samples s_vis ON s_vis.id = j.sample_id
         INNER JOIN libraries l_vis ON l_vis.id = s_vis.library_id
         WHERE (l_vis.is_global = 1
                OR l_vis.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
         ORDER BY j.id DESC
         LIMIT 30",
    ) {
        if let Ok(rows) = stmt.query_map(params![active_id], |r| {
            Ok(FileOpJournalEntry {
                id: r.get(0)?,
                sample_id: r.get(1)?,
                op_type: r.get(2)?,
                old_path: r.get(3)?,
                new_path: r.get(4)?,
                old_name: r.get(5)?,
                new_name: r.get(6)?,
                created_at: r.get(7)?,
                can_undo: r.get::<_, i64>(8).unwrap_or(0) != 0,
            })
        }) {
            for entry in rows.flatten() {
                journal_entries.push(entry);
            }
        }
    }

    Ok(TrashStatusInfo {
        trashed_count: count.max(0) as usize,
        total_bytes: bytes.max(0) as u64,
        journal_entries,
    })
}

fn files_are_byte_identical(a: &Path, b: &Path) -> bool {
    let (Ok(meta_a), Ok(meta_b)) = (fs::metadata(a), fs::metadata(b)) else {
        return false;
    };
    if !meta_a.is_file() || !meta_b.is_file() || meta_a.len() != meta_b.len() {
        return false;
    }
    if meta_a.len() == 0 {
        return true;
    }
    let (Ok(file_a), Ok(file_b)) = (fs::File::open(a), fs::File::open(b)) else {
        return false;
    };
    use std::io::Read;
    let mut reader_a = std::io::BufReader::with_capacity(64 * 1024, file_a);
    let mut reader_b = std::io::BufReader::with_capacity(64 * 1024, file_b);
    let mut buf_a = [0u8; 16 * 1024];
    let mut buf_b = [0u8; 16 * 1024];
    loop {
        let n_a = match reader_a.read(&mut buf_a) {
            Ok(n) => n,
            Err(_) => return false,
        };
        if n_a == 0 {
            return true;
        }
        let mut read_b = 0;
        while read_b < n_a {
            match reader_b.read(&mut buf_b[read_b..n_a]) {
                Ok(0) | Err(_) => return false,
                Ok(n) => read_b += n,
            }
        }
        if buf_a[..n_a] != buf_b[..n_a] {
            return false;
        }
    }
}

pub(super) fn find_identical_file_in_dir(src_file: &Path, target_dir: &Path) -> Option<String> {
    let src_len = fs::metadata(src_file).ok()?.len();
    if let Some(fname) = src_file.file_name() {
        let same_name_pb = target_dir.join(fname);
        if same_name_pb.is_file() && files_are_byte_identical(src_file, &same_name_pb) {
            return Some(fname.to_string_lossy().to_string());
        }
    }
    let entries = fs::read_dir(target_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() && meta.len() == src_len && files_are_byte_identical(src_file, &path)
            {
                return Some(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    None
}

fn strip_trailing_copy_number(stem: &str) -> &str {
    let trimmed = stem.trim_end();
    if let Some(open_idx) = trimmed.rfind(" (") {
        if trimmed.ends_with(')') {
            let inside = &trimmed[open_idx + 2..trimmed.len() - 1];
            if !inside.is_empty() && inside.chars().all(|c| c.is_ascii_digit()) {
                let base = trimmed[..open_idx].trim_end();
                if !base.is_empty() {
                    return base;
                }
            }
        }
    }
    stem
}

pub(super) fn suggest_keep_both_name(
    target_dir: &Path,
    file_name: &str,
    reserved_lower: &std::collections::HashSet<String>,
) -> String {
    let p = Path::new(file_name);
    let raw_stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Audio");
    let base_stem = strip_trailing_copy_number(raw_stem);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    for idx in 2..1000 {
        let candidate = if ext.is_empty() {
            format!("{} ({})", base_stem, idx)
        } else {
            format!("{} ({}).{}", base_stem, idx, ext)
        };
        let cand_lower = candidate.to_lowercase();
        if !reserved_lower.contains(&cand_lower) && !target_dir.join(&candidate).exists() {
            return candidate;
        }
    }
    file_name.to_string()
}

pub(super) fn validate_writable_library_folder(
    conn: &Connection,
    library_id: i64,
    folder_path: &str,
) -> Result<(String, String, PathBuf, String), String> {
    let active_id = get_active_profile_id(conn);
    let (lib_path, lib_name, lib_read_only): (String, String, bool) = conn
        .query_row(
            "SELECT path, name, COALESCE(is_read_only, 0)
             FROM libraries
             WHERE id = ?1
               AND (is_global = 1 OR id IN (SELECT library_id FROM profile_libraries WHERE profile_id = ?2))",
            params![library_id, active_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Target library not found in active profile".to_string())?;

    if lib_read_only {
        return Err(format!(
            "Library '{}' is locked as a Protected Read-Only Vault. Unlock it in Settings > Libraries or Advanced first.",
            lib_name
        ));
    }

    let trimmed = folder_path.trim();
    if trimmed.is_empty() || is_unc_or_network_path(trimmed) || has_ntfs_ads_colon(trimmed) {
        return Err("Invalid or unsupported folder path".to_string());
    }

    let raw_pb = PathBuf::from(trimmed);
    reject_symlink_ancestors(&raw_pb)?;
    let sym_meta = fs::symlink_metadata(&raw_pb)
        .map_err(|_| format!("Folder does not exist on disk: {}", display_leaf(&raw_pb)))?;
    if sym_meta.file_type().is_symlink() || !sym_meta.file_type().is_dir() {
        return Err("Target path is not a valid physical folder".to_string());
    }

    let canon_dir = raw_pb
        .canonicalize()
        .map_err(|_| "Failed to resolve folder path on disk".to_string())?;
    if !is_dir_inside_library_root(&canon_dir, &lib_path) {
        return Err(format!(
            "Folder '{}' is outside library '{}'",
            display_leaf(&raw_pb),
            lib_name
        ));
    }

    let clean_dir = strip_verbatim_prefix(&canon_dir);
    let norm_dir = normalize_clean_path(&clean_dir.to_string_lossy());
    if norm_dir.to_lowercase().contains("/.audify_trash") {
        return Err("Cannot perform folder operations inside .audify_trash".to_string());
    }

    let norm_lib = normalize_clean_path(&lib_path);
    Ok((norm_lib, lib_name, clean_dir, norm_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::samples::query_samples_with_conn_ext;
    use crate::db::init_schema_on_conn;

    #[test]
    fn rename_undo_trash_and_restore_preserve_tags_favorites_and_collections() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();

        let root_temp =
            std::env::temp_dir().join(format!("audify_file_ops_test_{}", std::process::id()));
        let user_dir = root_temp.join("user");
        let lib_dir = root_temp.join("SFX_Lib");
        fs::create_dir_all(user_dir.join("trash")).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let sample_file = lib_dir.join("11L-magic_blast-175483435.wav");
        fs::write(&sample_file, b"RIFF_DUMMY_AUDIO").unwrap();

        let norm_lib = normalize_clean_path(&lib_dir.canonicalize().unwrap().to_string_lossy());
        let norm_file =
            normalize_clean_path(&sample_file.canonicalize().unwrap().to_string_lossy());

        conn.execute(
            "INSERT INTO libraries (path, name, is_global, is_read_only) VALUES (?1, 'SFX_Lib', 1, 0)",
            params![norm_lib],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, ?2, '11L-magic_blast-175483435.wav', 'wav', 1500, 16)",
            params![lib_id, norm_file],
        )
        .unwrap();
        let sample_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO profile_favorites (profile_id, sample_id)
             VALUES ((SELECT id FROM profiles WHERE is_active = 1 LIMIT 1), ?1)",
            params![sample_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tags (name, color, is_manual) VALUES ('Magic', '#A855F7', 1)",
            [],
        )
        .unwrap();
        let tag_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual) VALUES (?1, ?2, 1)",
            params![sample_id, tag_id],
        )
        .unwrap();

        // 1. Protected Read-Only Library blocks rename & trash
        conn.execute(
            "UPDATE libraries SET is_read_only = 1 WHERE id = ?1",
            params![lib_id],
        )
        .unwrap();
        assert!(rename_sample_file_with_conn(&mut conn, &user_dir, sample_id, "magic_blast").is_err());
        assert!(move_samples_to_trash_with_conn(&mut conn, &user_dir, &[sample_id]).is_err());

        // Unlock library
        conn.execute(
            "UPDATE libraries SET is_read_only = 0 WHERE id = ?1",
            params![lib_id],
        )
        .unwrap();

        // 2. Rename file on disk
        let renamed =
            rename_sample_file_with_conn(&mut conn, &user_dir, sample_id, "magic_blast").unwrap();
        assert_eq!(renamed.file_name, "magic_blast.wav");
        assert_eq!(
            renamed.previous_file_name.as_deref(),
            Some("11L-magic_blast-175483435.wav")
        );
        assert!(lib_dir.join("magic_blast.wav").exists());

        // 3. Undo Rename restores exact original name
        let undone = undo_rename_sample_file_with_conn(&mut conn, &user_dir, sample_id).unwrap();
        assert_eq!(undone.file_name, "11L-magic_blast-175483435.wav");
        assert!(undone.previous_file_name.is_none());
        assert!(lib_dir.join("11L-magic_blast-175483435.wav").exists());

        // 4. Move to Audify Trash (Stage 1 Quarantine)
        let trash_res =
            move_samples_to_trash_with_conn(&mut conn, &user_dir, &[sample_id]).unwrap();
        assert_eq!(trash_res.affected_count, 1);
        assert_eq!(trash_res.trashed_count, 1);
        assert!(!lib_dir.join("11L-magic_blast-175483435.wav").exists());

        // Active query returns 0, Trash query returns 1
        let active_list = query_samples_with_conn_ext(
            &conn, None, None, None, None, None, None, None, None, Some(false),
        )
        .unwrap();
        assert!(active_list.is_empty());

        let trashed_list = query_samples_with_conn_ext(
            &conn, None, None, None, None, None, None, None, None, Some(true),
        )
        .unwrap();
        assert_eq!(trashed_list.len(), 1);
        assert_eq!(trashed_list[0].id, sample_id);
        assert!(trashed_list[0].is_favorite);
        assert_eq!(trashed_list[0].tags.len(), 1);

        // 5. Restore from Trash preserves sample ID, Favorite, and Tags
        let restore_res =
            restore_samples_from_trash_with_conn(&mut conn, &user_dir, &[sample_id]).unwrap();
        assert_eq!(restore_res.affected_count, 1);
        assert_eq!(restore_res.trashed_count, 0);
        assert!(lib_dir.join("11L-magic_blast-175483435.wav").exists());

        let active_after = query_samples_with_conn_ext(
            &conn, None, None, None, None, None, None, None, None, Some(false),
        )
        .unwrap();
        assert_eq!(active_after.len(), 1);
        assert_eq!(active_after[0].id, sample_id);
        assert!(active_after[0].is_favorite);
        assert_eq!(active_after[0].tags[0].name, "Magic");

        let _ = fs::remove_dir_all(&root_temp);
    }

    #[test]
    fn subfolder_crud_move_duplicate_detection_and_conflict_resolution() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on_conn(&conn).unwrap();

        let root_temp =
            std::env::temp_dir().join(format!("audify_folder_ops_test_{}", std::process::id()));
        let user_dir = root_temp.join("user");
        let lib_dir = root_temp.join("Drums_Lib");
        fs::create_dir_all(user_dir.join("trash")).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();

        let kick_a = lib_dir.join("kick.wav");
        fs::write(&kick_a, b"RIFF_KICK_AUDIO_CONTENT_A").unwrap();

        let norm_lib = normalize_clean_path(&lib_dir.canonicalize().unwrap().to_string_lossy());
        let norm_kick_a = normalize_clean_path(&kick_a.canonicalize().unwrap().to_string_lossy());

        conn.execute(
            "INSERT INTO libraries (path, name, is_global, is_read_only) VALUES (?1, 'Drums_Lib', 1, 0)",
            params![norm_lib],
        )
        .unwrap();
        let lib_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size, is_favorite)
             VALUES (?1, ?2, 'kick.wav', 'wav', 500, 25, 1)",
            params![lib_id, norm_kick_a],
        )
        .unwrap();
        let sample_a_id = conn.last_insert_rowid();

        // 1. Create physical subfolder 'Kicks' and verify get_folder_tree_stats includes it with count 0
        let created_sub =
            create_physical_subfolder_with_conn(&conn, lib_id, &norm_lib, "Kicks").unwrap();
        assert!(created_sub.ends_with("/Kicks"));
        let stats = crate::commands::libraries::get_folder_tree_stats_with_conn(&conn).unwrap();
        assert!(stats
            .iter()
            .any(|st| st.folder_path == created_sub && st.count == 0));

        // 2. Move sample_a into 'Kicks'
        let move_res = move_samples_to_folder_with_conn(
            &mut conn,
            &user_dir,
            &[sample_a_id],
            lib_id,
            &created_sub,
            "prompt",
        )
        .unwrap();
        assert_eq!(move_res.status, "ok");
        assert_eq!(move_res.moved_records.len(), 1);
        assert!(lib_dir.join("Kicks").join("kick.wav").exists());

        // 3. Create an identical duplicate file at root and try to move it into 'Kicks':
        //    should be detected as an exact duplicate and skipped without creating 'kick (2).wav'!
        let dup_kick = lib_dir.join("kick.wav");
        fs::write(&dup_kick, b"RIFF_KICK_AUDIO_CONTENT_A").unwrap();
        let norm_dup = normalize_clean_path(&dup_kick.canonicalize().unwrap().to_string_lossy());
        conn.execute(
            "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, file_size)
             VALUES (?1, ?2, 'kick.wav', 'wav', 500, 25)",
            params![lib_id, norm_dup],
        )
        .unwrap();
        let dup_id = conn.last_insert_rowid();

        let dup_move_res = move_samples_to_folder_with_conn(
            &mut conn,
            &user_dir,
            &[dup_id],
            lib_id,
            &created_sub,
            "prompt",
        )
        .unwrap();
        assert_eq!(dup_move_res.status, "ok");
        assert_eq!(dup_move_res.moved_records.len(), 0);
        assert_eq!(dup_move_res.skipped_duplicates, vec!["kick.wav".to_string()]);
        assert!(!lib_dir.join("Kicks").join("kick (2).wav").exists());

        // 4. Now overwrite root 'kick.wav' with DIFFERENT audio content:
        //    'prompt' returns status == 'conflict', 'keep_both' moves it as 'kick (2).wav'
        fs::write(&dup_kick, b"RIFF_DIFFERENT_KICK_CONTENT_BBBB").unwrap();
        let conflict_res = move_samples_to_folder_with_conn(
            &mut conn,
            &user_dir,
            &[dup_id],
            lib_id,
            &created_sub,
            "prompt",
        )
        .unwrap();
        assert_eq!(conflict_res.status, "conflict");
        assert_eq!(conflict_res.conflicts.len(), 1);
        assert_eq!(conflict_res.conflicts[0].suggested_new_name, "kick (2).wav");

        let keep_both_res = move_samples_to_folder_with_conn(
            &mut conn,
            &user_dir,
            &[dup_id],
            lib_id,
            &created_sub,
            "keep_both",
        )
        .unwrap();
        assert_eq!(keep_both_res.status, "ok");
        assert_eq!(keep_both_res.moved_records.len(), 1);
        assert_eq!(keep_both_res.moved_records[0].new_name, "kick (2).wav");
        assert!(lib_dir.join("Kicks").join("kick (2).wav").exists());

        // 5. Rename subfolder 'Kicks' -> 'Heavy_Kicks' and verify both samples' paths update
        let ren_sub =
            rename_physical_subfolder_with_conn(&mut conn, lib_id, &created_sub, "Heavy_Kicks")
                .unwrap();
        assert!(ren_sub.new_folder_path.ends_with("/Heavy_Kicks"));
        assert_eq!(ren_sub.updated_sample_count, 2);

        // 6. Trash subfolder 'Heavy_Kicks' and verify samples are moved to quarantine trash
        let trash_sub = trash_physical_subfolder_with_conn(
            &mut conn,
            &user_dir,
            lib_id,
            &ren_sub.new_folder_path,
        )
        .unwrap();
        assert_eq!(trash_sub.affected_count, 2);
        assert!(!lib_dir.join("Heavy_Kicks").exists());

        let _ = fs::remove_dir_all(&root_temp);
    }

    #[test]
    fn symlink_or_junction_outside_library_is_blocked() {
        let root_temp = std::env::temp_dir().join(format!(
            "audify_symlink_escape_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let user_dir = root_temp.join("user");
        let lib_dir = root_temp.join("lib");
        let outside_dir = root_temp.join("outside_secret");
        fs::create_dir_all(&user_dir).unwrap();
        fs::create_dir_all(&lib_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        let outside_wav = outside_dir.join("secret.wav");
        fs::write(&outside_wav, b"RIFF_SECRET").unwrap();

        let escape_link = lib_dir.join("EscapeLink");

        #[cfg(target_os = "windows")]
        let link_created = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &escape_link.to_string_lossy(),
                &outside_dir.to_string_lossy(),
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        #[cfg(unix)]
        let link_created = std::os::unix::fs::symlink(&outside_dir, &escape_link).is_ok();

        if link_created {
            let conn = crate::db::init_db(&user_dir).expect("init_db");
            let norm_lib = normalize_clean_path(&lib_dir.canonicalize().unwrap().to_string_lossy());
            conn.execute(
                "INSERT INTO libraries (path, name, is_global, is_read_only) VALUES (?1, 'Lib', 1, 0)",
                params![norm_lib],
            )
            .unwrap();
            let lib_id = conn.last_insert_rowid();

            let link_str = escape_link.to_string_lossy().to_string();
            assert!(
                validate_writable_library_folder(&conn, lib_id, &link_str).is_err(),
                "writable folder validation must reject symlinks/junctions pointing outside library"
            );
            assert!(
                create_physical_subfolder_with_conn(&conn, lib_id, &link_str, "Injected").is_err(),
                "subfolder creation inside external junction must fail"
            );
            assert!(!outside_dir.join("Injected").exists());

            // Also verify direct canonicalize escape guard rejects outside directory
            let outside_canon = outside_dir.canonicalize().unwrap();
            assert!(!is_dir_inside_library_root(&outside_canon, &norm_lib));

            let _ = fs::remove_dir(&escape_link);
        }

        let _ = fs::remove_dir_all(&root_temp);
    }
}
