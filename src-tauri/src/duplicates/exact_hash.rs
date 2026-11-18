use super::progress::{PhaseTracker, ProgressEmitFn};
use super::{
    build_duplicate_group, resolve_library_roots, DuplicateCandidate, DuplicateGroup,
    SampleHashCacheWrite,
};
use crate::scanner::metadata_modified_ms;
use crate::security::{ensure_inside, has_ntfs_ads_colon, is_unc_or_network_path};
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const PARTIAL_CHUNK_BYTES: usize = 4096;
const FULL_HASH_BUFFER_BYTES: usize = 65536;

struct ValidatedFileMeta {
    canon_path: PathBuf,
    disk_mtime: Option<i64>,
}

struct ValidatedCandidate {
    idx: usize,
    path: PathBuf,
    file_size: i64,
    disk_mtime: Option<i64>,
    cached_partial: Option<[u8; 32]>,
    cached_full: Option<[u8; 32]>,
}

fn validate_readable_library_file(
    raw_path: &str,
    library_roots: &HashMap<i64, PathBuf>,
    library_id: i64,
    expected_size: i64,
) -> Option<ValidatedFileMeta> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty()
        || is_unc_or_network_path(trimmed)
        || has_ntfs_ads_colon(trimmed)
        || expected_size <= 0
    {
        return None;
    }

    let canon_root = library_roots.get(&library_id)?;
    let raw_target = Path::new(trimmed);
    let sym = fs::symlink_metadata(raw_target).ok()?;
    if sym.file_type().is_symlink() || !sym.is_file() {
        return None;
    }
    if sym.len() != expected_size as u64 {
        return None;
    }

    let disk_mtime = metadata_modified_ms(&sym);
    let canon_file = fs::canonicalize(raw_target).ok()?;
    if is_unc_or_network_path(&canon_file.to_string_lossy()) {
        return None;
    }
    if ensure_inside(canon_root, &canon_file).is_err() {
        return None;
    }

    Some(ValidatedFileMeta {
        canon_path: canon_file,
        disk_mtime,
    })
}

fn is_hash_cache_valid(c: &DuplicateCandidate, disk_mtime: Option<i64>) -> bool {
    c.cached_hash_size == Some(c.file_size)
        && disk_mtime.is_some()
        && c.cached_hash_mtime == disk_mtime
}

fn compute_partial_fingerprint(path: &Path, expected_size: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let meta_len = file.metadata().ok()?.len();
    if meta_len != expected_size || meta_len <= (PARTIAL_CHUNK_BYTES as u64) * 2 {
        return None;
    }

    let mut head = [0u8; PARTIAL_CHUNK_BYTES];
    file.read_exact(&mut head).ok()?;

    let mut tail = [0u8; PARTIAL_CHUNK_BYTES];
    file.seek(SeekFrom::End(-(PARTIAL_CHUNK_BYTES as i64)))
        .ok()?;
    file.read_exact(&mut tail).ok()?;

    let mut hasher = Sha256::new();
    hasher.update(expected_size.to_le_bytes());
    hasher.update(head);
    hasher.update(tail);
    Some(hasher.finalize().into())
}

fn compute_full_sha256(path: &Path) -> Option<[u8; 32]> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::with_capacity(FULL_HASH_BUFFER_BYTES, file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; FULL_HASH_BUFFER_BYTES];
    loop {
        let n = reader.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hasher.finalize().into())
}

/// 3-stage exact-content duplicate detection with persistent cache + progress telemetry:
/// 1) Group candidates in memory by `file_size > 0` and validate matching files in parallel
/// 2) Filter >8KB candidates via cached or 4KB head + 4KB tail SHA-256 fingerprint
/// 3) Verify remaining collisions using cached or streaming full SHA-256
pub(super) fn find_exact_duplicate_groups_with_progress(
    candidates: &[DuplicateCandidate],
    raw_library_roots: &[(i64, String)],
    emit_progress: Option<ProgressEmitFn>,
) -> (Vec<DuplicateGroup>, Vec<SampleHashCacheWrite>) {
    let library_roots = resolve_library_roots(raw_library_roots);
    if library_roots.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let mut by_size: HashMap<i64, Vec<usize>> = HashMap::new();
    for (idx, c) in candidates.iter().enumerate() {
        if c.file_size > 0 {
            by_size.entry(c.file_size).or_default().push(idx);
        }
    }

    let size_collision_indices: Vec<usize> = by_size
        .into_values()
        .filter(|indices| indices.len() >= 2)
        .flatten()
        .collect();

    if size_collision_indices.is_empty() {
        return (Vec::new(), Vec::new());
    }

    // Stage 1: parallel filesystem & security gate validation + cache mtime verification
    let validate_tracker = PhaseTracker::new(
        "exact",
        "validating",
        "Step 1/3 · Checking files",
        0.0,
        25.0,
        size_collision_indices.len(),
        emit_progress.clone(),
    );
    validate_tracker.emit_start("");

    let validated: Vec<ValidatedCandidate> = size_collision_indices
        .into_par_iter()
        .filter_map(|idx| {
            let c = &candidates[idx];
            let meta = validate_readable_library_file(
                &c.file_path,
                &library_roots,
                c.library_id,
                c.file_size,
            );
            validate_tracker.tick(&c.file_name);
            let meta = meta?;
            let valid_cache = is_hash_cache_valid(c, meta.disk_mtime);
            Some(ValidatedCandidate {
                idx,
                path: meta.canon_path,
                file_size: c.file_size,
                disk_mtime: meta.disk_mtime,
                cached_partial: if valid_cache {
                    c.cached_partial_hash
                } else {
                    None
                },
                cached_full: if valid_cache { c.cached_full_hash } else { None },
            })
        })
        .collect();
    validate_tracker.finish("");

    let small_threshold = (PARTIAL_CHUNK_BYTES as i64) * 2;
    let mut small_targets: Vec<(ValidatedCandidate, Option<[u8; 32]>)> = Vec::new();
    let mut partial_cached: Vec<(ValidatedCandidate, [u8; 32])> = Vec::new();
    let mut partial_uncached: Vec<ValidatedCandidate> = Vec::new();

    for v in validated {
        if v.file_size <= small_threshold {
            small_targets.push((v, None));
        } else if let Some(ph) = v.cached_partial {
            partial_cached.push((v, ph));
        } else {
            partial_uncached.push(v);
        }
    }

    type PartialKey = (i64, [u8; 32]);
    type PartialCandidatePair = (ValidatedCandidate, Option<[u8; 32]>);
    type FullHashResult = (ValidatedCandidate, Option<[u8; 32]>, Option<[u8; 32]>);
    let mut by_partial: HashMap<PartialKey, Vec<PartialCandidatePair>> = HashMap::new();
    for (v, ph) in partial_cached {
        by_partial
            .entry((v.file_size, ph))
            .or_default()
            .push((v, Some(ph)));
    }

    let mut new_writes: HashMap<usize, SampleHashCacheWrite> = HashMap::new();

    // Stage 2: partial head + tail hash only for >8KB entries without a valid cached partial hash
    if !partial_uncached.is_empty() {
        let partial_tracker = PhaseTracker::new(
            "exact",
            "partial_hash",
            "Step 2/3 · Sampling headers",
            25.0,
            60.0,
            partial_uncached.len(),
            emit_progress.clone(),
        );
        partial_tracker.emit_start("");

        let partial_results: Vec<PartialCandidatePair> = partial_uncached
            .into_par_iter()
            .map(|v| {
                let ph = compute_partial_fingerprint(&v.path, v.file_size as u64);
                partial_tracker.tick(&candidates[v.idx].file_name);
                (v, ph)
            })
            .collect();
        partial_tracker.finish("");

        for (v, maybe_ph) in partial_results {
            if let Some(ph) = maybe_ph {
                let cand = &candidates[v.idx];
                new_writes.insert(
                    v.idx,
                    SampleHashCacheWrite {
                        sample_id: cand.sample_id,
                        file_size: v.file_size,
                        file_mtime: v.disk_mtime,
                        partial_hash: Some(ph),
                        full_hash: None,
                    },
                );
                by_partial
                    .entry((v.file_size, ph))
                    .or_default()
                    .push((v, Some(ph)));
            }
        }
    }

    let mut stage3_targets: Vec<PartialCandidatePair> = small_targets;
    for group in by_partial.into_values() {
        if group.len() >= 2 {
            stage3_targets.extend(group);
        }
    }

    let mut cache_writes: Vec<SampleHashCacheWrite> = new_writes.into_values().collect();
    if stage3_targets.len() < 2 {
        cache_writes.sort_by_key(|w| w.sample_id);
        return (Vec::new(), cache_writes);
    }

    let mut by_full_hash: HashMap<[u8; 32], Vec<&DuplicateCandidate>> = HashMap::new();
    let mut full_uncached: Vec<PartialCandidatePair> = Vec::new();

    for (v, partial_opt) in stage3_targets {
        if let Some(cached_full) = v.cached_full {
            by_full_hash
                .entry(cached_full)
                .or_default()
                .push(&candidates[v.idx]);
        } else {
            full_uncached.push((v, partial_opt));
        }
    }

    // Stage 3: full SHA-256 verification only on uncached surviving collisions
    if !full_uncached.is_empty() {
        let full_tracker = PhaseTracker::new(
            "exact",
            "full_hash",
            "Step 3/3 · Verifying SHA-256",
            60.0,
            98.0,
            full_uncached.len(),
            emit_progress,
        );
        full_tracker.emit_start("");

        let full_results: Vec<FullHashResult> =
            full_uncached
                .into_par_iter()
                .map(|(v, partial_opt)| {
                    let fh = compute_full_sha256(&v.path);
                    full_tracker.tick(&candidates[v.idx].file_name);
                    (v, partial_opt, fh)
                })
                .collect();
        full_tracker.finish("");

        let mut write_by_sample_id: HashMap<i64, SampleHashCacheWrite> =
            cache_writes.into_iter().map(|w| (w.sample_id, w)).collect();

        for (v, partial_opt, maybe_fh) in full_results {
            if let Some(fh) = maybe_fh {
                let cand = &candidates[v.idx];
                by_full_hash.entry(fh).or_default().push(cand);
                let existing_partial = write_by_sample_id
                    .get(&cand.sample_id)
                    .and_then(|w| w.partial_hash)
                    .or(partial_opt);
                write_by_sample_id.insert(
                    cand.sample_id,
                    SampleHashCacheWrite {
                        sample_id: cand.sample_id,
                        file_size: v.file_size,
                        file_mtime: v.disk_mtime,
                        partial_hash: existing_partial,
                        full_hash: Some(fh),
                    },
                );
            }
        }
        cache_writes = write_by_sample_id.into_values().collect();
    } else if let Some(emit) = emit_progress {
        let done_tracker = PhaseTracker::new(
            "exact",
            "full_hash",
            "Step 3/3 · Verifying SHA-256",
            98.0,
            98.0,
            0,
            Some(emit),
        );
        done_tracker.finish("");
    }

    cache_writes.sort_by_key(|w| w.sample_id);

    let mut groups: Vec<DuplicateGroup> = by_full_hash
        .into_iter()
        .filter(|(_, list)| list.len() >= 2)
        .map(|(hash, list)| {
            let group_id = format!("exact:{}", hex::encode(&hash[..8]));
            build_duplicate_group(group_id, "exact_hash", 100, list)
        })
        .collect();

    groups.sort_by(|a, b| {
        b.reclaimable_bytes
            .cmp(&a.reclaimable_bytes)
            .then_with(|| b.items.len().cmp(&a.items.len()))
            .then_with(|| a.group_id.cmp(&b.group_id))
    });
    (groups, cache_writes)
}
