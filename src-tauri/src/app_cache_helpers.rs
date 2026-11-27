use crate::db::AppState;
use crate::security;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const CACHE_PRUNE_MAX_FILES: usize = 250;
pub const CACHE_PRUNE_MAX_BYTES: u64 = 500 * 1024 * 1024;
pub const CACHE_PRUNE_MIN_AGE_SECS: u64 = 24 * 60 * 60;

#[derive(Clone, Default, PartialEq, Eq)]
struct AssetScopeMemo {
    user_dir: PathBuf,
    libs: BTreeSet<PathBuf>,
    slices: BTreeSet<PathBuf>,
    layers: BTreeSet<PathBuf>,
}

static LAST_ASSET_SCOPE: Mutex<Option<AssetScopeMemo>> = Mutex::new(None);

/// Registers a slice directory temporarily for asset protocol playback/waveforms after
/// verifying UNC/ADS/symlink-ancestor safety.
pub(crate) fn register_runtime_asset_dir(
    app: &tauri::AppHandle,
    user_dir: &Path,
    dir: &Path,
) {
    use tauri::Manager;

    let raw = dir.to_string_lossy();
    if raw.trim().is_empty()
        || security::is_unc_or_network_path(&raw)
        || security::has_ntfs_ads_colon(&raw)
        || security::has_parent_dir_traversal(&raw)
        || security::is_forbidden_os_or_root_path(&raw)
    {
        return;
    }
    if security::reject_symlink_ancestors(dir).is_err() {
        return;
    }
    let Ok(canon) = fs::canonicalize(dir) else {
        return;
    };
    let clean = security::strip_verbatim_prefix(&canon);
    let clean_str = clean.to_string_lossy();
    if security::is_unc_or_network_path(&clean_str)
        || security::is_forbidden_os_or_root_path(&clean_str)
        || security::ensure_not_inside_user_dir(user_dir, &clean).is_err()
    {
        return;
    }

    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&clean, true);
}

/// Collects validated library root directories belonging to the currently active profile.
pub fn resolve_active_watcher_roots(
    conn: &rusqlite::Connection,
    user_dir: &Path,
) -> BTreeSet<PathBuf> {
    let active_id = crate::db::get_active_profile_id(conn);
    let mut roots: BTreeSet<PathBuf> = BTreeSet::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT path FROM libraries
         WHERE is_global = 1
            OR id IN (SELECT library_id FROM profile_libraries WHERE profile_id = ?1)",
    ) {
        if let Ok(rows) = stmt.query_map([active_id], |r| r.get::<_, String>(0)) {
            for p in rows.flatten() {
                if let Ok(safe_dir) = security::is_safe_library_dir(&p) {
                    if security::ensure_not_inside_user_dir(user_dir, &safe_dir).is_ok() {
                        roots.insert(safe_dir);
                    }
                }
            }
        }
    }
    roots
}

/// Reconciles Tauri's `asset_protocol_scope` so ONLY safe narrow directories are readable
/// by the WebView (`user/images`, `user/cache/slices`, `user/cache/playback_fallback`,
/// registered `libraries.path`, and valid active-profile `customSliceExportPath` directories),
/// NEVER exposing `user/samples.db`, `user/backups/`, or `user/cache/webview/`.
///
/// NOTE: Tauri v2's `FsScope::forbid_directory` appends to `forbidden_patterns` permanently
/// (a subsequent `allow_directory` cannot undo it). Therefore switchable library/profile slice
/// paths must NEVER be permanently forbidden — active-profile isolation is enforced on every
/// Rust IPC command via `validate_path_in_libraries_or_cache`.
pub fn reconcile_library_asset_scopes(
    app: &tauri::AppHandle,
    conn: &rusqlite::Connection,
    _removed_path: Option<&str>,
) {
    use tauri::Manager;

    let state = app.state::<AppState>();
    let scope = app.asset_protocol_scope();

    crate::library_watcher::reconcile_watcher_if_managed(app, conn);

    let current_libs = resolve_active_watcher_roots(conn, &state.user_dir);

    let current_slices: BTreeSet<PathBuf> = security::collect_profile_slice_dirs(conn, true)
        .into_iter()
        .filter(|d| security::ensure_not_inside_user_dir(&state.user_dir, d).is_ok())
        .collect();
    let current_layers: BTreeSet<PathBuf> = security::collect_profile_layer_dirs(conn, true)
        .into_iter()
        .filter(|d| security::ensure_not_inside_user_dir(&state.user_dir, d).is_ok())
        .collect();

    let next_memo = AssetScopeMemo {
        user_dir: state.user_dir.clone(),
        libs: current_libs,
        slices: current_slices,
        layers: current_layers,
    };

    {
        let mut guard = LAST_ASSET_SCOPE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if guard.as_ref() == Some(&next_memo) {
            return;
        }
        *guard = Some(next_memo.clone());
    }

    for safe_sub in [
        state.user_dir.join("images"),
        state.user_dir.join("slices"),
        state.user_dir.join("layers"),
        state.user_dir.join("trash"),
        state.user_dir.join("cache").join("slices"),
        state.user_dir.join("cache").join("slice_trash"),
        state.user_dir.join("cache").join("layer_preview"),
        state.user_dir.join("cache").join("layer_trash"),
        state.user_dir.join("cache").join("playback_fallback"),
    ] {
        if !security::is_unc_or_network_path(&safe_sub.to_string_lossy()) {
            let _ = fs::create_dir_all(&safe_sub);
            let _ = scope.allow_directory(&safe_sub, true);
        }
    }

    for safe_dir in &next_memo.libs {
        let _ = scope.allow_directory(safe_dir, true);
    }
    for slice_dir in &next_memo.slices {
        let _ = scope.allow_directory(slice_dir, true);
    }
    for layer_dir in &next_memo.layers {
        let _ = scope.allow_directory(layer_dir, true);
    }
}

/// Prunes stale `.wav` files in `dirs` when total file count exceeds `max_files` OR total byte
/// size exceeds `max_bytes`, deleting the oldest files whose modification age is `>= min_age`.
pub fn prune_audio_cache_dirs(
    dirs: &[PathBuf],
    max_files: usize,
    max_bytes: u64,
    min_age: Duration,
) -> usize {
    #[derive(Debug)]
    struct CachedWavEntry {
        path: PathBuf,
        len: u64,
        modified: SystemTime,
    }

    let mut entries: Vec<CachedWavEntry> = Vec::new();
    for dir in dirs {
        if security::is_unc_or_network_path(&dir.to_string_lossy()) {
            continue;
        }
        let Ok(rd) = fs::read_dir(dir) else {
            continue;
        };
        for item in rd.flatten() {
            let Ok(ft) = item.file_type() else {
                continue;
            };
            if ft.is_symlink() || !ft.is_file() {
                continue;
            }
            let path = item.path();
            let is_wav = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("wav"))
                .unwrap_or(false);
            if !is_wav {
                continue;
            }
            let Ok(meta) = item.metadata() else {
                continue;
            };
            let modified = meta.modified().unwrap_or(UNIX_EPOCH);
            entries.push(CachedWavEntry {
                path,
                len: meta.len(),
                modified,
            });
        }
    }

    let mut total_files = entries.len();
    let mut total_bytes: u64 = entries.iter().map(|e| e.len).sum();
    if total_files <= max_files && total_bytes <= max_bytes {
        return 0;
    }

    entries.sort_by_key(|e| e.modified);
    let now = SystemTime::now();
    let mut deleted = 0usize;

    for entry in entries {
        if total_files <= max_files && total_bytes <= max_bytes {
            break;
        }
        let age = now.duration_since(entry.modified).unwrap_or_default();
        if age >= min_age && fs::remove_file(&entry.path).is_ok() {
            total_files = total_files.saturating_sub(1);
            total_bytes = total_bytes.saturating_sub(entry.len);
            deleted += 1;
        }
    }

    deleted
}
