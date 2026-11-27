mod restore;
mod slices_bundle;

use self::restore::restore_full_snapshot_with_state;
use self::slices_bundle::{
    collect_staged_snapshot_slices, is_safe_snapshot_image_entry, is_safe_snapshot_slice_entry,
    is_safe_snapshot_slice_trash_entry, MAX_SNAPSHOT_SLICES_COUNT, MAX_SNAPSHOT_SLICE_FILE_BYTES,
    MAX_SNAPSHOT_TOTAL_SLICES_BYTES,
};
use crate::ai_tagger::AiTaggerState;
use crate::commands::{BackupFileInfo, FullSnapshotManifest, FullSnapshotRestoreResult};
use crate::db::AppState;
use crate::security::{
    display_leaf, ensure_inside, is_zip_magic, sanitize_err, validate_archive_export_path,
    validate_archive_import_path, ALLOWED_BG_MEDIA_EXTS, ALLOWED_BG_VIDEO_EXTS,
    MAX_CUSTOM_BG_BYTES, MAX_CUSTOM_BG_VIDEO_BYTES, MAX_SNAPSHOT_ARCHIVE_BYTES,
};
use rusqlite::{params, Connection};
use std::fs::{self, File};
use std::io::{self, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const SNAPSHOT_ARCHIVE_SUFFIXES: &[&str] = &[".audify-backup.zip", ".zip"];
pub const SNAPSHOT_MANIFEST_ENTRY: &str = "manifest.json";
pub const SNAPSHOT_DB_ENTRY: &str = "samples.db";
const SNAPSHOT_FORMAT_ID: &str = "audify-full-backup-v1";
const MAX_SNAPSHOT_MANIFEST_BYTES: u64 = 128 * 1024;
const MAX_SNAPSHOT_DB_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_SNAPSHOT_IMAGES_COUNT: usize = 1000;
const MAX_SNAPSHOT_TOTAL_IMAGES_BYTES: u64 = 256 * 1024 * 1024;

pub(super) struct TempPathGuard(pub(super) PathBuf);

impl Drop for TempPathGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
pub(super) struct StagedSnapshot {
    pub(super) staging_guard: TempPathGuard,
    pub(super) manifest: FullSnapshotManifest,
    pub(super) asset_entries: Vec<(String, PathBuf)>,
}

pub(super) fn unique_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn collect_snapshot_images(
    images_root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<(String, PathBuf)>,
) {
    if depth > 4 || out.len() >= MAX_SNAPSHOT_IMAGES_COUNT {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_SNAPSHOT_IMAGES_COUNT {
            break;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let Ok(safe) = ensure_inside(images_root, &path) else {
            continue;
        };
        if meta.is_dir() {
            collect_snapshot_images(images_root, &safe, depth + 1, out);
        } else if meta.is_file() {
            let ext_lower = safe
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            let ext_ok = ALLOWED_BG_MEDIA_EXTS.contains(&ext_lower.as_str());
            let max_item_bytes = if ALLOWED_BG_VIDEO_EXTS.contains(&ext_lower.as_str()) {
                MAX_CUSTOM_BG_VIDEO_BYTES
            } else {
                MAX_CUSTOM_BG_BYTES
            };
            if ext_ok && meta.len() <= max_item_bytes {
                if let Ok(rel) = safe.strip_prefix(images_root) {
                    let rel_norm = rel.to_string_lossy().replace('\\', "/");
                    out.push((format!("images/{}", rel_norm), safe));
                }
            }
        }
    }
}

fn read_manifest_from_zip(
    archive: &mut ZipArchive<BufReader<File>>,
) -> Result<FullSnapshotManifest, String> {
    let entry = archive
        .by_name(SNAPSHOT_MANIFEST_ENTRY)
        .map_err(|_| "Snapshot archive is missing manifest.json".to_string())?;
    if entry.is_symlink() || entry.is_dir() || entry.size() > MAX_SNAPSHOT_MANIFEST_BYTES {
        return Err("Snapshot manifest entry is invalid or oversized".to_string());
    }
    let mut raw = Vec::with_capacity(entry.size() as usize);
    entry
        .take(MAX_SNAPSHOT_MANIFEST_BYTES + 1)
        .read_to_end(&mut raw)
        .map_err(|e| format!("Failed to read snapshot manifest: {}", e))?;
    if (raw.len() as u64) > MAX_SNAPSHOT_MANIFEST_BYTES {
        return Err("Snapshot manifest exceeds maximum size".to_string());
    }
    let manifest: FullSnapshotManifest = serde_json::from_slice(&raw)
        .map_err(|e| format!("Invalid snapshot manifest.json: {}", e))?;
    if manifest.format != SNAPSHOT_FORMAT_ID {
        return Err(format!("Unsupported snapshot format: {}", manifest.format));
    }
    Ok(manifest)
}

pub(super) fn validate_snapshot_zip_safety(
    archive: &mut ZipArchive<BufReader<File>>,
) -> Result<(), String> {
    if archive.len() > MAX_SNAPSHOT_IMAGES_COUNT + MAX_SNAPSHOT_SLICES_COUNT + 64 {
        return Err("Snapshot archive contains too many entries".to_string());
    }
    let mut has_manifest = false;
    let mut has_db = false;
    let mut image_count = 0usize;
    let mut total_image_bytes: u64 = 0;
    let mut slice_count = 0usize;
    let mut total_slice_bytes: u64 = 0;
    for idx in 0..archive.len() {
        let entry = archive
            .by_index(idx)
            .map_err(|_| "Corrupt snapshot ZIP entry".to_string())?;
        if entry.is_symlink() {
            return Err("Snapshot archive contains forbidden symbolic link".to_string());
        }
        let name = entry.name();
        if name.contains("..") || name.contains('\\') || name.starts_with('/') {
            return Err("Snapshot archive contains unsafe entry path".to_string());
        }
        if entry.is_dir() {
            continue;
        }
        if name == SNAPSHOT_MANIFEST_ENTRY {
            has_manifest = true;
        } else if name == SNAPSHOT_DB_ENTRY {
            has_db = true;
        } else if is_safe_snapshot_image_entry(name).is_some() {
            image_count += 1;
            if image_count > MAX_SNAPSHOT_IMAGES_COUNT {
                return Err("Snapshot archive exceeds maximum allowed image count".to_string());
            }
            total_image_bytes = total_image_bytes.saturating_add(entry.size());
            if total_image_bytes > MAX_SNAPSHOT_TOTAL_IMAGES_BYTES {
                return Err("Snapshot archive exceeds maximum total image size limit".to_string());
            }
        } else if is_safe_snapshot_slice_entry(name).is_some()
            || is_safe_snapshot_slice_trash_entry(name).is_some()
        {
            slice_count += 1;
            if slice_count > MAX_SNAPSHOT_SLICES_COUNT {
                return Err("Snapshot archive exceeds maximum allowed slice count".to_string());
            }
            if entry.size() > MAX_SNAPSHOT_SLICE_FILE_BYTES {
                return Err("Snapshot archive contains an oversized slice WAV entry".to_string());
            }
            total_slice_bytes = total_slice_bytes.saturating_add(entry.size());
            if total_slice_bytes > MAX_SNAPSHOT_TOTAL_SLICES_BYTES {
                return Err("Snapshot archive exceeds maximum total slice size limit".to_string());
            }
        } else {
            return Err(format!(
                "Snapshot archive contains unexpected entry '{}'",
                name
            ));
        }
    }
    if !has_manifest || !has_db {
        return Err("Snapshot archive is missing manifest.json or samples.db".to_string());
    }
    Ok(())
}

pub(super) fn copy_bounded_from_zip<R: Read, W: Write>(
    reader: R,
    writer: &mut W,
    max_bytes: u64,
    label: &str,
) -> Result<u64, String> {
    let mut limited = reader.take(max_bytes.saturating_add(1));
    let copied = io::copy(&mut limited, writer)
        .map_err(|e| format!("Failed to extract {}: {}", label, e))?;
    if copied > max_bytes {
        return Err(format!("Snapshot {} exceeds size limit", label));
    }
    Ok(copied)
}

pub(super) fn open_validated_snapshot_archive(
    path: &Path,
) -> Result<(ZipArchive<BufReader<File>>, FullSnapshotManifest), String> {
    let raw_str = path.to_string_lossy();
    if crate::security::is_unc_or_network_path(&raw_str) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if crate::security::has_ntfs_ads_colon(&raw_str) {
        return Err("Alternate data streams are not allowed".to_string());
    }
    crate::security::reject_symlink_ancestors(path)?;
    let sym = fs::symlink_metadata(path)
        .map_err(|_| format!("Failed to inspect snapshot archive {}", display_leaf(path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    if !sym.is_file() || sym.len() > MAX_SNAPSHOT_ARCHIVE_BYTES {
        return Err("Snapshot file is invalid or exceeds size limit".to_string());
    }
    let canon = fs::canonicalize(path)
        .map_err(|_| format!("Failed to resolve snapshot archive {}", display_leaf(path)))?;
    if crate::security::is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Symbolic links pointing to network/UNC paths are not allowed".to_string());
    }
    let mut magic = [0u8; 4];
    let n = File::open(&canon)
        .and_then(|mut f| f.read(&mut magic))
        .map_err(|_| format!("Failed to read snapshot {}", display_leaf(path)))?;
    if n < 4 || !is_zip_magic(&magic) {
        return Err("Selected file is not a valid .audify-backup.zip archive".to_string());
    }
    let file = File::open(&canon)
        .map_err(|_| format!("Failed to open snapshot {}", display_leaf(path)))?;
    let mut archive = ZipArchive::new(BufReader::new(file))
        .map_err(|_| format!("Invalid ZIP snapshot {}", display_leaf(path)))?;
    validate_snapshot_zip_safety(&mut archive)?;
    let manifest = read_manifest_from_zip(&mut archive)?;
    Ok((archive, manifest))
}

pub(crate) fn read_snapshot_manifest_summary(path: &Path) -> Result<FullSnapshotManifest, String> {
    open_validated_snapshot_archive(path).map(|(_, manifest)| manifest)
}

/// Captures a transactionally consistent compacted DB snapshot via `VACUUM INTO` while the
/// caller briefly holds the DB lock, deferring filesystem image scanning and ZIP compression
/// until after the DB lock is released.
pub(super) fn stage_snapshot_db_only(
    conn: &Connection,
    user_dir: &Path,
) -> Result<(TempPathGuard, FullSnapshotManifest), String> {
    let cache_dir = user_dir.join("cache");
    fs::create_dir_all(&cache_dir).map_err(|e| sanitize_err(user_dir, &e.to_string()))?;

    let staging_db_path = cache_dir.join(format!(
        ".snapshot_stage_{}_{}.db",
        std::process::id(),
        unique_nanos()
    ));
    let _ = fs::remove_file(&staging_db_path);
    let staging_str = staging_db_path.to_string_lossy().to_string();

    conn.execute("VACUUM INTO ?1", params![staging_str])
        .map_err(|e| {
            format!(
                "Failed to create clean SQLite snapshot: {}",
                sanitize_err(user_dir, &e.to_string())
            )
        })?;
    let guard = TempPathGuard(staging_db_path);

    let schema_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(14);
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
    let active_profile_name: String = conn
        .query_row(
            "SELECT name FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "Default Studio".to_string());
    let created_at: String = conn
        .query_row(
            "SELECT strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "unknown".to_string());

    let manifest = FullSnapshotManifest {
        format: SNAPSHOT_FORMAT_ID.to_string(),
        schema_version,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at,
        active_profile_name,
        profile_count,
        sample_count,
        image_count: 0,
        slice_count: 0,
    };

    Ok((guard, manifest))
}

fn collect_staged_snapshot_assets(
    user_dir: &Path,
    manifest: &mut FullSnapshotManifest,
) -> Vec<(String, PathBuf)> {
    let mut assets = Vec::new();
    let images_root = user_dir.join("images");
    if images_root.is_dir() {
        let canon_root = crate::security::ensure_inside(&images_root, &images_root).unwrap_or(images_root);
        collect_snapshot_images(&canon_root, &canon_root, 0, &mut assets);
    }
    manifest.image_count = assets.len();
    let slice_entries = collect_staged_snapshot_slices(user_dir, manifest);
    assets.extend(slice_entries);
    assets
}

#[cfg(test)]
pub(super) fn stage_snapshot_db_and_manifest(
    conn: &Connection,
    user_dir: &Path,
) -> Result<StagedSnapshot, String> {
    let (guard, mut manifest) = stage_snapshot_db_only(conn, user_dir)?;
    let asset_entries = collect_staged_snapshot_assets(user_dir, &mut manifest);

    Ok(StagedSnapshot {
        staging_guard: guard,
        manifest,
        asset_entries,
    })
}

pub(super) fn write_staged_snapshot_zip(
    staging_db: &Path,
    manifest: &FullSnapshotManifest,
    asset_entries: &[(String, PathBuf)],
    dest_path: &Path,
) -> Result<u64, String> {
    let manifest_json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize snapshot manifest: {}", e))?;

    let tmp_name = format!(
        ".{}.tmp_{}_{}",
        display_leaf(dest_path),
        std::process::id(),
        unique_nanos()
    );
    let tmp_zip = dest_path
        .parent()
        .map(|p| p.join(&tmp_name))
        .unwrap_or_else(|| dest_path.with_extension("tmp"));
    let _tmp_guard = TempPathGuard(tmp_zip.clone());

    let out_file = File::create(&tmp_zip)
        .map_err(|_| format!("Failed to create snapshot archive {}", display_leaf(dest_path)))?;
    let mut zip = ZipWriter::new(out_file);
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(5));

    zip.start_file(SNAPSHOT_MANIFEST_ENTRY, opts)
        .map_err(|e| format!("Failed to write snapshot manifest: {}", e))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write snapshot manifest body: {}", e))?;

    zip.start_file(SNAPSHOT_DB_ENTRY, opts)
        .map_err(|e| format!("Failed to start samples.db archive entry: {}", e))?;
    {
        let mut db_file = File::open(staging_db)
            .map_err(|e| format!("Failed to open staged DB snapshot: {}", e))?;
        io::copy(&mut db_file, &mut zip)
            .map_err(|e| format!("Failed to stream samples.db into snapshot: {}", e))?;
    }

    for (entry_name, src_path) in asset_entries {
        let leaf = display_leaf(src_path);
        let mut img_file = File::open(src_path)
            .map_err(|e| format!("Failed to open snapshot asset {}: {}", leaf, e))?;
        zip.start_file(entry_name, opts)
            .map_err(|e| format!("Failed to add snapshot asset entry {}: {}", leaf, e))?;
        io::copy(&mut img_file, &mut zip)
            .map_err(|e| format!("Failed to write snapshot asset {}: {}", leaf, e))?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize snapshot archive: {}", e))?;

    fs::rename(&tmp_zip, dest_path)
        .map_err(|_| format!("Failed to finalize snapshot file {}", display_leaf(dest_path)))?;

    Ok(fs::metadata(dest_path).map(|m| m.len()).unwrap_or(0))
}

#[tauri::command]
pub async fn export_full_snapshot_to_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<FullSnapshotManifest, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = validate_archive_export_path(
            &file_path,
            SNAPSHOT_ARCHIVE_SUFFIXES,
            "Full snapshot export must end with .audify-backup.zip or .zip",
        )?;
        let (staging_guard, mut manifest) = {
            let conn = state_owned.lock_db();
            stage_snapshot_db_only(&conn, &state_owned.user_dir)?
        };
        let asset_entries = collect_staged_snapshot_assets(&state_owned.user_dir, &mut manifest);
        write_staged_snapshot_zip(
            &staging_guard.0,
            &manifest,
            &asset_entries,
            &target_path,
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;
        Ok(manifest)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Snapshot export task failed: {}", e)))?
}

#[tauri::command]
pub async fn create_full_snapshot_backup(
    state: State<'_, AppState>,
) -> Result<BackupFileInfo, String> {
    let state_owned = state.inner().clone();
    let user_dir_err = state.user_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let backups_dir = state_owned.user_dir.join("backups");
        fs::create_dir_all(&backups_dir)
            .map_err(|e| sanitize_err(&state_owned.user_dir, &e.to_string()))?;

        let (staging_guard, mut manifest, ts_str) = {
            let conn = state_owned.lock_db();
            let (guard, manifest) = stage_snapshot_db_only(&conn, &state_owned.user_dir)?;
            let ts: String = conn
                .query_row(
                    "SELECT strftime('%Y-%m-%d_%H-%M-%S', 'now', 'localtime')",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| unique_nanos().to_string());
            (guard, manifest, ts)
        };
        let asset_entries = collect_staged_snapshot_assets(&state_owned.user_dir, &mut manifest);

        let file_name = format!("snapshot_library_{}.audify-backup.zip", ts_str);
        let file_path = backups_dir.join(&file_name);
        let file_size = write_staged_snapshot_zip(
            &staging_guard.0,
            &manifest,
            &asset_entries,
            &file_path,
        )
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))? as i64;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        Ok(BackupFileInfo {
            file_name,
            file_path: file_path.to_string_lossy().to_string(),
            profile_name: format!("All Profiles ({})", manifest.profile_count),
            created_at: ts_str,
            timestamp_ms: now_ms,
            file_size,
            is_auto: false,
            kind: "snapshot".to_string(),
            sample_count: manifest.sample_count,
            includes_ai_tags: true,
        })
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Snapshot backup task failed: {}", e)))?
}

#[tauri::command]
pub async fn inspect_full_snapshot_file(file_path: String) -> Result<FullSnapshotManifest, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let validated = validate_archive_import_path(
            &file_path,
            SNAPSHOT_ARCHIVE_SUFFIXES,
            "Full snapshot file must end with .audify-backup.zip or .zip",
        )?;
        read_snapshot_manifest_summary(&validated)
    })
    .await
    .map_err(|e| format!("Snapshot inspection task failed: {}", e))?
}

struct SnapshotAnalysisLockGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl Drop for SnapshotAnalysisLockGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn restore_full_snapshot_from_file(
    app: AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiTaggerState>,
    file_path: String,
) -> Result<FullSnapshotRestoreResult, String> {
    if ai_state.download_running.load(Ordering::SeqCst) {
        return Err(
            "Cannot restore a full database snapshot while an AI model update is running."
                .to_string(),
        );
    }
    if ai_state
        .analysis_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Cannot restore a full database snapshot while AI analysis is running.".to_string(),
        );
    }
    let analysis_guard = SnapshotAnalysisLockGuard(std::sync::Arc::clone(&ai_state.analysis_running));
    let state_owned = state.inner().clone();
    let app_clone = app.clone();
    let vector_cache_arc = std::sync::Arc::clone(&ai_state.vector_cache);
    let external_probes_arc = std::sync::Arc::clone(&ai_state.external_probes);
    let user_dir_err = state.user_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = analysis_guard;
        let validated = validate_archive_import_path(
            &file_path,
            SNAPSHOT_ARCHIVE_SUFFIXES,
            "Full snapshot file must end with .audify-backup.zip or .zip",
        )?;
        let res = restore_full_snapshot_with_state(&state_owned, &validated, || {
            if let Ok(mut cache) = vector_cache_arc.lock() {
                cache.clear();
            }
            if let Ok(mut probes) = external_probes_arc.lock() {
                probes.clear();
            }
        })
        .map_err(|e| sanitize_err(&state_owned.user_dir, &e))?;

        if let Ok(read_conn) = state_owned.acquire_read_conn() {
            crate::reconcile_library_asset_scopes(&app_clone, &read_conn, None);
        } else {
            let conn = state_owned.lock_db();
            crate::reconcile_library_asset_scopes(&app_clone, &conn, None);
        }
        Ok::<FullSnapshotRestoreResult, String>(res)
    })
    .await
    .map_err(|e| sanitize_err(&user_dir_err, &format!("Snapshot restore task failed: {}", e)))??;

    Ok(result)
}
