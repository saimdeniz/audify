mod scope;

use self::scope::{
    are_pending_files_size_stable, compute_target_folder_scope, is_relevant_fs_event_path,
    match_library_root, minimal_top_level_roots, normalize_match_key, PendingLibraryDirty,
    MAX_COALESCE_WAIT,
};
use crate::app_cache_helpers::resolve_active_watcher_roots;
use crate::db::AppState;
use crate::security::{normalize_clean_path, strip_verbatim_prefix};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_DELAY: Duration = Duration::from_millis(1600);
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const STABILITY_RECHECK_DELAY: Duration = Duration::from_millis(700);
const UNATTACHED_ROOT_RETRY_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize)]
pub struct LibraryFsChangedPayload {
    pub library_id: i64,
    pub library_path: String,
    pub sample_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct WatcherConfig {
    enabled: bool,
    roots: BTreeSet<PathBuf>,
}

enum WatcherMsg {
    FsEvent(notify::Result<Event>),
    Reconcile(WatcherConfig),
    Suppress {
        duration: Duration,
        root: Option<PathBuf>,
    },
    SetManualScan(bool),
    SyncFinished(PathBuf),
}

#[derive(Clone, Default)]
pub struct LibraryWatcherState {
    sender: Arc<Mutex<Option<mpsc::Sender<WatcherMsg>>>>,
    last_config: Arc<Mutex<Option<WatcherConfig>>>,
    has_unattached_roots: Arc<AtomicBool>,
}

impl LibraryWatcherState {
    pub fn start(&self, app: AppHandle) {
        let mut sender_guard = self.sender.lock().unwrap_or_else(|e| e.into_inner());
        if sender_guard.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<WatcherMsg>();
        *sender_guard = Some(tx.clone());
        drop(sender_guard);

        let tx_worker = tx.clone();
        let has_unattached = Arc::clone(&self.has_unattached_roots);
        std::thread::Builder::new()
            .name("audify-lib-watcher".to_string())
            .spawn(move || run_watcher_loop(app, rx, tx_worker, has_unattached))
            .ok();
    }

    pub fn reconcile_from_conn(&self, conn: &Connection, user_dir: &Path) {
        let config = resolve_watcher_config_from_db(conn, user_dir);
        let mut cfg_guard = self.last_config.lock().unwrap_or_else(|e| e.into_inner());
        if cfg_guard.as_ref() == Some(&config)
            && !self.has_unattached_roots.load(Ordering::Relaxed)
        {
            return;
        }
        *cfg_guard = Some(config.clone());
        drop(cfg_guard);

        if let Some(tx) = self
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .cloned()
        {
            let _ = tx.send(WatcherMsg::Reconcile(config));
        }
    }

    pub fn suppress_briefly(&self, duration_ms: u64) {
        self.suppress_root_briefly(None, duration_ms);
    }

    pub fn suppress_root_briefly(&self, root: Option<PathBuf>, duration_ms: u64) {
        if let Some(tx) = self
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .cloned()
        {
            let clamped = duration_ms.clamp(250, 10_000);
            let _ = tx.send(WatcherMsg::Suppress {
                duration: Duration::from_millis(clamped),
                root,
            });
        }
    }

    pub fn set_manual_scan(&self, active: bool) {
        if let Some(tx) = self
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .cloned()
        {
            let _ = tx.send(WatcherMsg::SetManualScan(active));
        }
    }
}

pub fn reconcile_watcher_if_managed(app: &AppHandle, conn: &Connection) {
    if let (Some(watcher_state), Some(app_state)) = (
        app.try_state::<LibraryWatcherState>(),
        app.try_state::<AppState>(),
    ) {
        watcher_state.reconcile_from_conn(conn, &app_state.user_dir);
    }
}

pub fn suppress_watcher_if_managed(app: &AppHandle, duration_ms: u64) {
    if let Some(watcher_state) = app.try_state::<LibraryWatcherState>() {
        watcher_state.suppress_briefly(duration_ms);
    }
}

pub struct ManualScanWatcherGuard<'a> {
    app: &'a AppHandle,
}

impl<'a> ManualScanWatcherGuard<'a> {
    pub fn enter(app: &'a AppHandle) -> Self {
        if let Some(watcher_state) = app.try_state::<LibraryWatcherState>() {
            watcher_state.set_manual_scan(true);
        }
        Self { app }
    }
}

impl Drop for ManualScanWatcherGuard<'_> {
    fn drop(&mut self) {
        if let Some(watcher_state) = self.app.try_state::<LibraryWatcherState>() {
            watcher_state.set_manual_scan(false);
        }
    }
}

fn resolve_watcher_config_from_db(conn: &Connection, user_dir: &Path) -> WatcherConfig {
    let active_id = crate::db::get_active_profile_id(conn);
    let enabled = conn
        .query_row(
            "SELECT settings_json FROM profiles WHERE id = ?1",
            params![active_id],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|val| val.get("enableLiveFolderWatch").and_then(|b| b.as_bool()))
        .unwrap_or(true);

    if !enabled {
        return WatcherConfig {
            enabled: false,
            roots: BTreeSet::new(),
        };
    }

    let roots = resolve_active_watcher_roots(conn, user_dir);
    WatcherConfig {
        enabled: true,
        roots,
    }
}

fn run_watcher_loop(
    app: AppHandle,
    rx: mpsc::Receiver<WatcherMsg>,
    tx_self: mpsc::Sender<WatcherMsg>,
    has_unattached_roots: Arc<AtomicBool>,
) {
    let tx_notify = tx_self.clone();
    let mut watcher: Option<RecommendedWatcher> = notify::recommended_watcher(move |res| {
        let _ = tx_notify.send(WatcherMsg::FsEvent(res));
    })
    .ok();

    let mut active_watches: BTreeSet<PathBuf> = BTreeSet::new();
    let mut roots_desc: Vec<PathBuf> = Vec::new();
    let mut last_desired_cfg: Option<WatcherConfig> = None;
    let mut last_reattach_attempt = Instant::now();
    let mut enabled = false;
    let mut manual_scan_depth: usize = 0;
    let mut suppress_until: Option<Instant> = None;
    let mut suppress_until_by_root: HashMap<String, Instant> = HashMap::new();
    let mut pending_by_root: HashMap<PathBuf, PendingLibraryDirty> = HashMap::new();
    let mut in_flight_roots: HashSet<PathBuf> = HashSet::new();

    loop {
        match rx.recv_timeout(POLL_INTERVAL) {
            Ok(msg) => {
                process_watcher_msg(
                    msg,
                    &mut watcher,
                    &mut active_watches,
                    &mut roots_desc,
                    &mut last_desired_cfg,
                    &has_unattached_roots,
                    &mut enabled,
                    &mut manual_scan_depth,
                    &mut suppress_until,
                    &mut suppress_until_by_root,
                    &mut pending_by_root,
                    &mut in_flight_roots,
                );
                while let Ok(next_msg) = rx.try_recv() {
                    process_watcher_msg(
                        next_msg,
                        &mut watcher,
                        &mut active_watches,
                        &mut roots_desc,
                        &mut last_desired_cfg,
                        &has_unattached_roots,
                        &mut enabled,
                        &mut manual_scan_depth,
                        &mut suppress_until,
                        &mut suppress_until_by_root,
                        &mut pending_by_root,
                        &mut in_flight_roots,
                    );
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        let now = Instant::now();
        suppress_until_by_root.retain(|_, until| *until > now);
        if enabled
            && has_unattached_roots.load(Ordering::Relaxed)
            && now.duration_since(last_reattach_attempt) >= UNATTACHED_ROOT_RETRY_INTERVAL
        {
            last_reattach_attempt = now;
            if let Some(cfg) = last_desired_cfg.as_ref() {
                apply_os_watch_diff(&mut watcher, &mut active_watches, cfg, &has_unattached_roots);
            }
        }

        if !enabled || manual_scan_depth > 0 {
            continue;
        }

        if let Some(until) = suppress_until {
            if now < until {
                continue;
            }
            suppress_until = None;
        }

        flush_due_roots(
            &app,
            &tx_self,
            &roots_desc,
            &mut pending_by_root,
            &mut in_flight_roots,
            now,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn process_watcher_msg(
    msg: WatcherMsg,
    watcher: &mut Option<RecommendedWatcher>,
    active_watches: &mut BTreeSet<PathBuf>,
    roots_desc: &mut Vec<PathBuf>,
    last_desired_cfg: &mut Option<WatcherConfig>,
    has_unattached_roots: &Arc<AtomicBool>,
    enabled: &mut bool,
    manual_scan_depth: &mut usize,
    suppress_until: &mut Option<Instant>,
    suppress_until_by_root: &mut HashMap<String, Instant>,
    pending_by_root: &mut HashMap<PathBuf, PendingLibraryDirty>,
    in_flight_roots: &mut HashSet<PathBuf>,
) {
    match msg {
        WatcherMsg::Reconcile(cfg) => {
            *enabled = cfg.enabled;
            let mut next_desc: Vec<PathBuf> = cfg.roots.iter().cloned().collect();
            next_desc.sort_by_key(|p| std::cmp::Reverse(normalize_match_key(p).len()));
            *roots_desc = next_desc;

            if !cfg.enabled {
                pending_by_root.clear();
            } else {
                pending_by_root.retain(|k, _| cfg.roots.contains(k));
            }
            apply_os_watch_diff(watcher, active_watches, &cfg, has_unattached_roots);
            *last_desired_cfg = Some(cfg);
        }
        WatcherMsg::Suppress { duration, root } => {
            let until = Instant::now() + duration;
            if let Some(root_path) = root {
                let key = normalize_match_key(&root_path);
                let prev = suppress_until_by_root.get(&key).copied();
                if prev.is_none_or(|p| until > p) {
                    suppress_until_by_root.insert(key, until);
                }
            } else {
                *suppress_until = Some(match *suppress_until {
                    Some(prev) if prev > until => prev,
                    _ => until,
                });
            }
        }
        WatcherMsg::SetManualScan(active) => {
            if active {
                *manual_scan_depth = manual_scan_depth.saturating_add(1);
                pending_by_root.clear();
            } else {
                *manual_scan_depth = manual_scan_depth.saturating_sub(1);
                if *manual_scan_depth == 0 {
                    *suppress_until = Some(Instant::now() + Duration::from_millis(800));
                }
            }
        }
        WatcherMsg::SyncFinished(root) => {
            in_flight_roots.remove(&root);
        }
        WatcherMsg::FsEvent(Ok(event)) => {
            if !*enabled || *manual_scan_depth > 0 || matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let now = Instant::now();
            if suppress_until.is_some_and(|until| now < until) {
                return;
            }
            for raw_path in event.paths {
                let clean = strip_verbatim_prefix(&raw_path);
                if !is_relevant_fs_event_path(&clean, &event.kind) {
                    continue;
                }
                if let Some(root) = match_library_root(roots_desc, &clean) {
                    let root_key = normalize_match_key(root);
                    if suppress_until_by_root
                        .get(&root_key)
                        .is_some_and(|until| now < *until)
                    {
                        continue;
                    }
                    let entry = pending_by_root
                        .entry(root.clone())
                        .or_insert_with(|| PendingLibraryDirty::new(now));
                    entry.record_path(clean, now);
                }
            }
        }
        WatcherMsg::FsEvent(Err(_)) => {
            // OS watcher kernel buffer overflow (e.g. ReadDirectoryChangesW during huge copy/unzip):
            // mark all watched roots overflowed so the next debounce runs a full incremental scan.
            if !*enabled || *manual_scan_depth > 0 {
                return;
            }
            let now = Instant::now();
            for root in roots_desc.iter() {
                let entry = pending_by_root
                    .entry(root.clone())
                    .or_insert_with(|| PendingLibraryDirty::new(now));
                entry.overflowed = true;
                entry.last_event_at = now;
            }
        }
    }
}

fn apply_os_watch_diff(
    watcher: &mut Option<RecommendedWatcher>,
    active_watches: &mut BTreeSet<PathBuf>,
    cfg: &WatcherConfig,
    has_unattached_roots: &Arc<AtomicBool>,
) {
    let Some(w) = watcher.as_mut() else {
        has_unattached_roots.store(cfg.enabled && !cfg.roots.is_empty(), Ordering::Relaxed);
        return;
    };

    let desired_os_watches = if cfg.enabled {
        minimal_top_level_roots(&cfg.roots)
    } else {
        BTreeSet::new()
    };

    let to_remove: Vec<PathBuf> = active_watches
        .difference(&desired_os_watches)
        .cloned()
        .collect();
    for path in to_remove {
        let _ = w.unwatch(&path);
        active_watches.remove(&path);
    }

    let to_add: Vec<PathBuf> = desired_os_watches
        .difference(active_watches)
        .cloned()
        .collect();
    for path in to_add {
        if path.is_dir() && w.watch(&path, RecursiveMode::Recursive).is_ok() {
            active_watches.insert(path);
        }
    }

    let unattached = desired_os_watches
        .iter()
        .any(|path| !active_watches.contains(path));
    has_unattached_roots.store(unattached, Ordering::Relaxed);
}

fn flush_due_roots(
    app: &AppHandle,
    tx_self: &mpsc::Sender<WatcherMsg>,
    roots_desc: &[PathBuf],
    pending_by_root: &mut HashMap<PathBuf, PendingLibraryDirty>,
    in_flight_roots: &mut HashSet<PathBuf>,
    now: Instant,
) {
    let candidate_roots: Vec<PathBuf> = pending_by_root
        .iter()
        .filter(|(root, entry)| {
            !in_flight_roots.contains(*root)
                && (now.duration_since(entry.last_event_at) >= DEBOUNCE_DELAY
                    || now.duration_since(entry.first_event_at) >= MAX_COALESCE_WAIT)
        })
        .map(|(root, _)| root.clone())
        .collect();

    for root in candidate_roots {
        let Some(entry) = pending_by_root.get_mut(&root) else {
            continue;
        };
        if !roots_desc.contains(&root) {
            pending_by_root.remove(&root);
            continue;
        }
        if !are_pending_files_size_stable(entry, now) {
            let recheck_backdate = DEBOUNCE_DELAY.saturating_sub(STABILITY_RECHECK_DELAY);
            entry.last_event_at = now.checked_sub(recheck_backdate).unwrap_or(now);
            continue;
        }
        let Some(finished_entry) = pending_by_root.remove(&root) else {
            continue;
        };
        if !root.is_dir() {
            continue;
        }

        let target_folder = if finished_entry.overflowed {
            None
        } else {
            compute_target_folder_scope(&root, &finished_entry.touched_paths)
        };

        in_flight_roots.insert(root.clone());
        spawn_watcher_root_sync(app.clone(), tx_self.clone(), root, target_folder);
    }
}

fn spawn_watcher_root_sync(
    app: AppHandle,
    tx_self: mpsc::Sender<WatcherMsg>,
    root: PathBuf,
    target_folder: Option<String>,
) {
    let Some(app_state) = app.try_state::<AppState>().map(|s| s.inner().clone()) else {
        let _ = tx_self.send(WatcherMsg::SyncFinished(root));
        return;
    };
    let lib_path_str = normalize_clean_path(&root.to_string_lossy());

    tauri::async_runtime::spawn(async move {
        let res = crate::commands::libraries::run_incremental_sync_owned(
            app.clone(),
            app_state,
            lib_path_str,
            target_folder,
            false,
            false,
            false,
        )
        .await;

        if let Ok(Some((updated_lib, true))) = res {
            let _ = app.emit(
                "audify:library-fs-changed",
                LibraryFsChangedPayload {
                    library_id: updated_lib.id,
                    library_path: updated_lib.path,
                    sample_count: updated_lib.sample_count,
                },
            );
        }

        let _ = tx_self.send(WatcherMsg::SyncFinished(root));
    });
}
