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
}

static LAST_ASSET_SCOPE: Mutex<Option<AssetScopeMemo>> = Mutex::new(None);
static RUNTIME_SLICE_DIRS: Mutex<Option<(PathBuf, BTreeSet<PathBuf>)>> = Mutex::new(None);

/// Registers a slice directory temporarily for asset protocol playback/waveforms while
/// tracking it so future profile switches or `reconcile_library_asset_scopes` can revoke it.
pub(crate) fn register_runtime_asset_dir(
    app: &tauri::AppHandle,
    user_dir: &Path,
    dir: &Path,
) {
    use tauri::Manager;

    let raw = dir.to_string_lossy();
    if security::is_unc_or_network_path(&raw) || security::has_ntfs_ads_colon(&raw) {
        return;
    }
    if let Ok(meta) = fs::symlink_metadata(dir) {
        if meta.file_type().is_symlink() {
            return;
        }
    }
    let clean = fs::canonicalize(dir)
        .map(|p| security::strip_verbatim_prefix(&p))
        .unwrap_or_else(|_| security::strip_verbatim_prefix(dir));

    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&clean, true);

    let mut guard = RUNTIME_SLICE_DIRS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let entry = guard.get_or_insert_with(|| (user_dir.to_path_buf(), BTreeSet::new()));
    if entry.0 != user_dir {
        for old in std::mem::take(&mut entry.1) {
            let _ = scope.forbid_directory(&old, true);
        }
        entry.0 = user_dir.to_path_buf();
    }
    if entry.1.len() >= 64 && !entry.1.contains(&clean) {
        if let Some(evicted) = entry.1.iter().next().cloned() {
            entry.1.remove(&evicted);
            let _ = scope.forbid_directory(&evicted, true);
        }
    }
    entry.1.insert(clean);
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
pub fn reconcile_library_asset_scopes(
    app: &tauri::AppHandle,
    conn: &rusqlite::Connection,
    removed_path: Option<&str>,
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

    let next_memo = AssetScopeMemo {
        user_dir: state.user_dir.clone(),
        libs: current_libs,
        slices: current_slices,
    };

    let (stale_libs, stale_slices): (Vec<PathBuf>, Vec<PathBuf>) = {
        let mut guard = LAST_ASSET_SCOPE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let stale_l: Vec<PathBuf> = guard
            .as_ref()
            .filter(|prev| prev.user_dir == next_memo.user_dir)
            .map(|prev| prev.libs.difference(&next_memo.libs).cloned().collect())
            .unwrap_or_default();
        let stale_s: Vec<PathBuf> = guard
            .as_ref()
            .filter(|prev| prev.user_dir == next_memo.user_dir)
            .map(|prev| {
                prev.slices
                    .difference(&next_memo.slices)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if removed_path.is_none()
            && stale_l.is_empty()
            && stale_s.is_empty()
            && guard.as_ref() == Some(&next_memo)
        {
            return;
        }
        *guard = Some(next_memo.clone());
        (stale_l, stale_s)
    };

    if let Some(rem) = removed_path {
        let trimmed = rem.trim();
        if !trimmed.is_empty() && !security::is_unc_or_network_path(trimmed) {
            let _ = scope.forbid_directory(Path::new(trimmed), true);
            #[cfg(target_os = "windows")]
            {
                let win_variant = trimmed.replace('/', "\\");
                let _ = scope.forbid_directory(Path::new(&win_variant), true);
            }
            if let Ok(canon) = fs::canonicalize(trimmed) {
                if !security::is_unc_or_network_path(&canon.to_string_lossy()) {
                    let clean = security::strip_verbatim_prefix(&canon);
                    let _ = scope.forbid_directory(&clean, true);
                }
            }
        }
    }

    let stale_runtime: Vec<PathBuf> = {
        let mut rt_guard = RUNTIME_SLICE_DIRS
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some((rt_user_dir, rt_set)) = rt_guard.as_mut() {
            if rt_user_dir != &state.user_dir {
                *rt_user_dir = state.user_dir.clone();
                std::mem::take(rt_set).into_iter().collect()
            } else {
                let mut to_remove = Vec::new();
                for existing in rt_set.iter() {
                    let keep_in_libs = next_memo.libs.iter().any(|l| existing.starts_with(l));
                    let keep_in_slices = next_memo.slices.contains(existing);
                    let keep_in_user = existing.starts_with(state.user_dir.join("slices"))
                        || existing.starts_with(state.user_dir.join("cache"));
                    if (!keep_in_libs && !keep_in_slices && !keep_in_user)
                        || removed_path
                            .map(|rem| {
                                let norm_rem = security::normalize_clean_path(rem);
                                let norm_ex = security::normalize_clean_path(&existing.to_string_lossy());
                                norm_ex == norm_rem || norm_ex.starts_with(&format!("{}/", norm_rem))
                            })
                            .unwrap_or(false)
                    {
                        to_remove.push(existing.clone());
                    }
                }
                for item in &to_remove {
                    rt_set.remove(item);
                }
                to_remove
            }
        } else {
            Vec::new()
        }
    };

    for stale_path in stale_libs
        .into_iter()
        .chain(stale_slices)
        .chain(stale_runtime)
    {
        let _ = scope.forbid_directory(&stale_path, true);
        #[cfg(target_os = "windows")]
        {
            let win_variant = stale_path.to_string_lossy().replace('/', "\\");
            let _ = scope.forbid_directory(Path::new(&win_variant), true);
        }
    }

    for safe_sub in [
        state.user_dir.join("images"),
        state.user_dir.join("slices"),
        state.user_dir.join("trash"),
        state.user_dir.join("cache").join("slices"),
        state.user_dir.join("cache").join("slice_trash"),
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
