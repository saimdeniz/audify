use crate::scanner::SUPPORTED_EXTENSIONS;
use crate::security::{normalize_clean_path, strip_verbatim_prefix};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub(super) const MAX_COALESCE_WAIT: Duration = Duration::from_secs(18);
const MAX_TRACKED_TOUCHED_PATHS: usize = 128;

pub(super) struct PendingLibraryDirty {
    pub(super) touched_paths: Vec<PathBuf>,
    pub(super) overflowed: bool,
    pub(super) first_event_at: Instant,
    pub(super) last_event_at: Instant,
    size_snapshots: HashMap<PathBuf, u64>,
    stability_checks: u8,
}

impl PendingLibraryDirty {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            touched_paths: Vec::new(),
            overflowed: false,
            first_event_at: now,
            last_event_at: now,
            size_snapshots: HashMap::new(),
            stability_checks: 0,
        }
    }

    pub(super) fn record_path(&mut self, path: PathBuf, now: Instant) {
        self.last_event_at = now;
        if self.overflowed {
            return;
        }
        if self.touched_paths.len() >= MAX_TRACKED_TOUCHED_PATHS {
            self.overflowed = true;
            return;
        }
        if !self.touched_paths.contains(&path) {
            self.touched_paths.push(path);
        }
    }
}

pub(super) fn are_pending_files_size_stable(
    entry: &mut PendingLibraryDirty,
    now: Instant,
) -> bool {
    if now.duration_since(entry.first_event_at) >= MAX_COALESCE_WAIT
        || entry.stability_checks >= 8
    {
        return true;
    }

    let mut unstable = false;
    let check_limit = entry.touched_paths.len().min(64);
    for path in &entry.touched_paths[entry.touched_paths.len() - check_limit..] {
        let Ok(meta) = fs::symlink_metadata(path) else {
            entry.size_snapshots.remove(path);
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        let len = meta.len();
        match entry.size_snapshots.get(path).copied() {
            Some(prev) if prev != len => {
                entry.size_snapshots.insert(path.clone(), len);
                unstable = true;
            }
            None => {
                if let Ok(mtime) = meta.modified() {
                    if mtime.elapsed().is_ok_and(|el| el < Duration::from_secs(2)) {
                        entry.size_snapshots.insert(path.clone(), len);
                        unstable = true;
                    }
                }
            }
            Some(_) => {}
        }
    }

    if unstable {
        entry.stability_checks = entry.stability_checks.saturating_add(1);
    }
    !unstable
}

pub(crate) fn is_relevant_fs_path(path: &Path) -> bool {
    let Some(name_os) = path.file_name() else {
        return false;
    };
    let name = name_os.to_string_lossy();
    if name.starts_with('.') {
        return false;
    }
    let name_lower = name.to_lowercase();
    if matches!(
        name_lower.as_str(),
        "thumbs.db" | "desktop.ini" | "folder.jpg"
    ) {
        return false;
    }

    let Some(ext_os) = path.extension() else {
        return true;
    };
    let ext_lower = ext_os.to_string_lossy().to_lowercase();
    if matches!(
        ext_lower.as_str(),
        "tmp" | "part" | "crdownload" | "partial" | "download" | "asd" | "reapeaks" | "pk" | "pkf"
    ) {
        return false;
    }
    if path.is_dir() {
        return true;
    }
    SUPPORTED_EXTENSIONS.contains(&ext_lower.as_str())
}

pub(super) fn normalize_match_key(path: &Path) -> String {
    let clean = strip_verbatim_prefix(path);
    let norm = normalize_clean_path(&clean.to_string_lossy());
    if cfg!(windows) {
        norm.to_lowercase()
    } else {
        norm
    }
}

pub(crate) fn match_library_root<'a>(
    roots_desc: &'a [PathBuf],
    path: &Path,
) -> Option<&'a PathBuf> {
    let path_key = normalize_match_key(path);
    for root in roots_desc {
        let root_key = normalize_match_key(root);
        if path_key == root_key || path_key.starts_with(&format!("{}/", root_key)) {
            return Some(root);
        }
    }
    None
}

pub(super) fn minimal_top_level_roots(roots: &BTreeSet<PathBuf>) -> BTreeSet<PathBuf> {
    let mut sorted: Vec<PathBuf> = roots.iter().cloned().collect();
    sorted.sort_by_key(|p| normalize_match_key(p).len());
    let mut result: BTreeSet<PathBuf> = BTreeSet::new();
    for cand in sorted {
        let cand_key = normalize_match_key(&cand);
        let covered = result.iter().any(|existing| {
            let ex_key = normalize_match_key(existing);
            cand_key == ex_key || cand_key.starts_with(&format!("{}/", ex_key))
        });
        if !covered {
            result.insert(cand);
        }
    }
    result
}

pub(crate) fn compute_target_folder_scope(
    lib_root: &Path,
    touched_paths: &[PathBuf],
) -> Option<String> {
    if touched_paths.is_empty() {
        return None;
    }
    let root_key = normalize_match_key(lib_root);
    let mut dirs: Vec<PathBuf> = Vec::with_capacity(touched_paths.len());

    for raw in touched_paths {
        let mut cur = if raw.is_dir() {
            raw.to_path_buf()
        } else {
            raw.parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| lib_root.to_path_buf())
        };
        loop {
            let cur_key = normalize_match_key(&cur);
            if cur_key == root_key || !cur_key.starts_with(&format!("{}/", root_key)) {
                return None;
            }
            if let Ok(meta) = fs::symlink_metadata(&cur) {
                if !meta.file_type().is_symlink() && meta.is_dir() {
                    dirs.push(cur);
                    break;
                }
            }
            let parent = cur.parent()?;
            cur = parent.to_path_buf();
        }
    }

    let first = dirs.first()?.clone();
    let mut common = first;
    for d in dirs.iter().skip(1) {
        while normalize_match_key(&common) != normalize_match_key(d)
            && !normalize_match_key(d).starts_with(&format!("{}/", normalize_match_key(&common)))
        {
            if normalize_match_key(&common) == root_key {
                return None;
            }
            common = common.parent()?.to_path_buf();
        }
    }

    if normalize_match_key(&common) == root_key {
        None
    } else {
        Some(normalize_clean_path(&common.to_string_lossy()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relevant_fs_path_filters_daw_sidecars_and_hidden_files() {
        assert!(is_relevant_fs_path(Path::new("C:/SFX/Kicks/kick_01.wav")));
        assert!(is_relevant_fs_path(Path::new("C:/SFX/Ambience/forest.FLAC")));
        assert!(is_relevant_fs_path(Path::new("C:/SFX/NewFolder")));
        assert!(!is_relevant_fs_path(Path::new("C:/SFX/Kicks/.DS_Store")));
        assert!(!is_relevant_fs_path(Path::new("C:/SFX/Kicks/Thumbs.db")));
        assert!(!is_relevant_fs_path(Path::new(
            "C:/SFX/Kicks/kick_01.wav.asd"
        )));
        assert!(!is_relevant_fs_path(Path::new("C:/SFX/Kicks/render.tmp")));
        assert!(!is_relevant_fs_path(Path::new("C:/SFX/Kicks/notes.txt")));
    }

    #[test]
    fn longest_matching_library_root_wins() {
        let roots = vec![
            PathBuf::from("C:/Samples/Packs/Kicks"),
            PathBuf::from("C:/Samples"),
        ];
        let matched = match_library_root(&roots, Path::new("C:\\Samples\\Packs\\Kicks\\sub.wav"));
        assert_eq!(matched, Some(&PathBuf::from("C:/Samples/Packs/Kicks")));
    }

    #[test]
    fn target_folder_scope_narrows_to_common_existing_dir() {
        let temp_root = std::env::temp_dir().join(format!(
            "audify_watcher_scope_test_{}",
            std::process::id()
        ));
        let sub_a = temp_root.join("Drums").join("Kicks");
        let sub_b = temp_root.join("Drums").join("Snares");
        let _ = fs::create_dir_all(&sub_a);
        let _ = fs::create_dir_all(&sub_b);

        let scope_single = compute_target_folder_scope(&temp_root, &[sub_a.join("k1.wav")]);
        assert_eq!(
            scope_single,
            Some(normalize_clean_path(&sub_a.to_string_lossy()))
        );

        let scope_shared =
            compute_target_folder_scope(&temp_root, &[sub_a.join("k1.wav"), sub_b.join("s1.wav")]);
        assert_eq!(
            scope_shared,
            Some(normalize_clean_path(
                &temp_root.join("Drums").to_string_lossy()
            ))
        );

        let scope_missing_dir = compute_target_folder_scope(
            &temp_root,
            &[temp_root.join("DeletedFolder").join("a.wav")],
        );
        assert_eq!(scope_missing_dir, None);

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn stability_check_waits_once_when_new_file_grows_then_settles() {
        let temp_root = std::env::temp_dir().join(format!(
            "audify_watcher_stable_test_{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&temp_root);
        let wav_path = temp_root.join("render.wav");
        fs::write(&wav_path, b"RIFF1234").unwrap();

        let now = Instant::now();
        let mut entry = PendingLibraryDirty::new(now);
        entry.record_path(wav_path.clone(), now);

        assert!(!are_pending_files_size_stable(&mut entry, now));

        fs::write(&wav_path, b"RIFF1234567890").unwrap();
        assert!(!are_pending_files_size_stable(&mut entry, now));

        assert!(are_pending_files_size_stable(&mut entry, now));

        let _ = fs::remove_dir_all(&temp_root);
    }
}
