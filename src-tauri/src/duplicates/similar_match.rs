use super::progress::{PhaseTracker, ProgressEmitFn};
use super::{build_duplicate_group, DuplicateCandidate, DuplicateGroup};
use rayon::prelude::*;
use std::collections::HashMap;

const MAX_CLUSTER_MEMBERS: usize = 24;
const MAX_DURATION_WINDOW_NEIGHBORS: usize = 240;

struct PreparedAudio<'a> {
    candidate: &'a DuplicateCandidate,
    clean_stem: String,
    peaks_unit: Option<&'a [f32]>,
    embedding: Option<&'a [f32]>,
}

struct UnionFind {
    parent: Vec<usize>,
    size: Vec<usize>,
}

impl UnionFind {
    fn new(len: usize) -> Self {
        Self {
            parent: (0..len).collect(),
            size: vec![1; len],
        }
    }

    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }

    fn union(&mut self, a: usize, b: usize) -> Option<(usize, usize, usize)> {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra == rb {
            return Some((ra, ra, ra));
        }
        if self.size[ra] + self.size[rb] > MAX_CLUSTER_MEMBERS {
            return None;
        }
        if self.size[ra] < self.size[rb] {
            self.parent[ra] = rb;
            self.size[rb] += self.size[ra];
            Some((rb, ra, rb))
        } else {
            self.parent[rb] = ra;
            self.size[ra] += self.size[rb];
            Some((ra, ra, rb))
        }
    }
}

pub(super) fn normalize_clean_stem(file_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(file_name);

    let folded = crate::scanner::fold_turkish_to_ascii(stem);
    let mut trimmed = folded.trim().to_string();

    loop {
        let mut changed = false;
        for suffix in [
            " copy",
            "_copy",
            "-copy",
            " (1)",
            " (2)",
            " (3)",
            "_1",
            "_2",
            "-1",
            "-2",
            "_dup",
            "-dup",
            "_normalized",
        ] {
            if trimmed.ends_with(suffix) && trimmed.len() > suffix.len() {
                let new_len = trimmed.len() - suffix.len();
                trimmed.truncate(new_len);
                trimmed = trimmed.trim_end().to_string();
                changed = true;
                break;
            }
        }
        if !changed {
            break;
        }
    }
    trimmed
}

pub(super) fn parse_normalized_peaks(peaks_json: &str) -> Option<Vec<f32>> {
    let raw: Vec<f32> = serde_json::from_str(peaks_json).ok()?;
    if raw.len() < 8 || raw.iter().any(|v| !v.is_finite()) {
        return None;
    }

    let active_bins = raw.iter().filter(|&&v| v > 0.005).count();
    if active_bins < 5 {
        return None;
    }

    let mean = raw.iter().sum::<f32>() / (raw.len() as f32);
    let variance = raw
        .iter()
        .map(|&v| {
            let d = v - mean;
            d * d
        })
        .sum::<f32>()
        / (raw.len() as f32);
    if variance.sqrt() < 0.015 {
        return None;
    }

    let norm_sq: f32 = raw.iter().map(|&v| v * v).sum();
    if !norm_sq.is_finite() || norm_sq <= 1e-8 {
        return None;
    }
    let inv_norm = 1.0 / norm_sq.sqrt();
    Some(raw.into_iter().map(|v| v * inv_norm).collect())
}

pub(super) fn blob_to_unit_embedding(blob: Option<&[u8]>) -> Option<Vec<f32>> {
    let bytes = blob?;
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let (chunks, _) = bytes.as_chunks::<4>();
    let vec: Vec<f32> = chunks
        .iter()
        .map(|&chunk| f32::from_le_bytes(chunk))
        .collect();
    if vec.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let norm_sq: f32 = vec.iter().map(|&v| v * v).sum();
    if !norm_sq.is_finite() || norm_sq <= 1e-8 {
        return None;
    }
    let inv_norm = 1.0 / norm_sq.sqrt();
    Some(vec.into_iter().map(|v| v * inv_norm).collect())
}

fn cosine_equal_len(a: &[f32], b: &[f32]) -> Option<f32> {
    if a.len() != b.len() || a.is_empty() {
        return None;
    }
    let mut sum = 0.0_f32;
    for (&x, &y) in a.iter().zip(b.iter()) {
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        sum += x * y;
    }
    sum.is_finite().then_some(sum)
}

fn max_duration_tolerance_ms(duration_ms: i64, min_pct: u8) -> i64 {
    let base = duration_ms.max(1) as f64;
    if min_pct >= 98 {
        (base * 0.015).clamp(15.0, 45.0) as i64
    } else if min_pct >= 95 {
        (base * 0.025).clamp(25.0, 90.0) as i64
    } else {
        (base * 0.05).clamp(40.0, 180.0) as i64
    }
}

fn peak_cosine_to_base_pct(p_cos: f64) -> Option<f64> {
    if p_cos < 0.920 {
        return None;
    }
    let pct = if p_cos >= 0.998 {
        99.0
    } else if p_cos >= 0.995 {
        98.0 + ((p_cos - 0.995) / 0.003)
    } else if p_cos >= 0.990 {
        96.0 + ((p_cos - 0.990) / 0.005) * 2.0
    } else if p_cos >= 0.970 {
        91.0 + ((p_cos - 0.970) / 0.020) * 5.0
    } else if p_cos >= 0.930 {
        85.0 + ((p_cos - 0.930) / 0.040) * 6.0
    } else {
        82.0 + ((p_cos - 0.920) / 0.010) * 3.0
    };
    Some(pct)
}

fn compare_pair(a: &PreparedAudio<'_>, b: &PreparedAudio<'_>, min_pct: u8) -> Option<u8> {
    let dur_a = a.candidate.duration_ms.max(1);
    let dur_diff = (b.candidate.duration_ms - dur_a).abs();
    if dur_diff > max_duration_tolerance_ms(dur_a, min_pct) {
        return None;
    }

    let dur_ratio = (dur_diff as f64) / (dur_a as f64);
    let peak_cos = match (a.peaks_unit, b.peaks_unit) {
        (Some(pa), Some(pb)) => cosine_equal_len(pa, pb),
        _ => None,
    };

    if let (Some(ea), Some(eb)) = (a.embedding, b.embedding) {
        if let Some(emb_cos) = cosine_equal_len(ea, eb) {
            if emb_cos < 0.80 {
                return None;
            }
            let env_score = peak_cos.unwrap_or(emb_cos).clamp(0.0, 1.0);
            if env_score < 0.78 {
                return None;
            }
            if min_pct >= 98 && (emb_cos < 0.980 || env_score < 0.960) {
                return None;
            }
            let dur_score = (1.0 - dur_ratio * 2.0).clamp(0.0, 1.0);
            let hybrid = (emb_cos as f64) * 0.72 + (env_score as f64) * 0.23 + dur_score * 0.05;
            let pct = (hybrid * 100.0).floor().clamp(80.0, 99.0) as u8;
            return (pct >= min_pct).then_some(pct);
        }
    }

    let p_cos = peak_cos? as f64;
    let base_pct = peak_cosine_to_base_pct(p_cos)?;
    let stem_same = !a.clean_stem.is_empty() && a.clean_stem == b.clean_stem;
    if min_pct >= 98 && p_cos < 0.994 && !(stem_same && p_cos >= 0.992) {
        return None;
    }
    let stem_bonus = if stem_same && p_cos >= 0.960 { 1.2 } else { 0.0 };
    let diff_penalty = (dur_ratio * 35.0) + if !stem_same && p_cos < 0.996 { 1.0 } else { 0.0 };
    let pct = (base_pct + stem_bonus - diff_penalty)
        .floor()
        .clamp(80.0, 99.0) as u8;
    (pct >= min_pct).then_some(pct)
}

/// Fast O(N log N) near-duplicate audio clustering using a sorted duration sliding window,
/// L2-normalized waveform peak envelopes, cleaned stem tie-breakers, and cached AI embeddings.
pub(super) fn find_similar_duplicate_groups_with_progress(
    candidates: &[DuplicateCandidate],
    min_similarity_pct: u8,
    emit_progress: Option<ProgressEmitFn>,
) -> Vec<DuplicateGroup> {
    let clamped_min = min_similarity_pct.clamp(80, 99);
    let prep_tracker = PhaseTracker::new(
        "similar",
        "preparing",
        "Step 1/2 · Analyzing envelopes",
        0.0,
        35.0,
        candidates.len(),
        emit_progress.clone(),
    );
    prep_tracker.emit_start("");

    let mut prepared: Vec<PreparedAudio<'_>> = candidates
        .par_iter()
        .filter_map(|c| {
            let item = if c.file_size > 0 && c.duration_ms >= 80 {
                Some(PreparedAudio {
                    candidate: c,
                    clean_stem: normalize_clean_stem(&c.file_name),
                    peaks_unit: c.peaks_unit.as_deref(),
                    embedding: c.embedding_unit.as_deref(),
                })
            } else {
                None
            };
            prep_tracker.tick(&c.file_name);
            item
        })
        .collect();
    prep_tracker.finish("");

    if prepared.len() < 2 {
        return Vec::new();
    }

    prepared.sort_by_key(|p| p.candidate.duration_ms);

    let match_tracker = PhaseTracker::new(
        "similar",
        "matching",
        "Step 2/2 · Comparing audio",
        35.0,
        98.0,
        prepared.len(),
        emit_progress,
    );
    match_tracker.emit_start("");

    let edge_batches: Vec<Vec<(usize, usize, u8)>> = (0..prepared.len())
        .into_par_iter()
        .map(|i| {
            let base_dur = prepared[i].candidate.duration_ms;
            let max_tol_ms = max_duration_tolerance_ms(base_dur, clamped_min);
            let max_j = (i + 1 + MAX_DURATION_WINDOW_NEIGHBORS).min(prepared.len());
            let mut edges = Vec::new();

            for j in (i + 1)..max_j {
                if prepared[j].candidate.duration_ms - base_dur > max_tol_ms {
                    break;
                }
                if let Some(sim_pct) = compare_pair(&prepared[i], &prepared[j], clamped_min) {
                    edges.push((i, j, sim_pct));
                }
            }
            match_tracker.tick(&prepared[i].candidate.file_name);
            edges
        })
        .collect();
    match_tracker.finish("");

    let mut all_edges: Vec<(usize, usize, u8)> = edge_batches.into_iter().flatten().collect();
    // Bind highest-similarity pairs first so near-identical matches are never crowded out
    all_edges.sort_by(|a, b| {
        b.2.cmp(&a.2)
            .then_with(|| a.0.cmp(&b.0))
            .then_with(|| a.1.cmp(&b.1))
    });

    let mut uf = UnionFind::new(prepared.len());
    let mut root_min_similarity: HashMap<usize, u8> = HashMap::new();

    for (i, j, sim_pct) in all_edges {
        if let Some((new_root, old_a, old_b)) = uf.union(i, j) {
            let mut merged_pct = sim_pct;
            if old_a != new_root {
                if let Some(prev) = root_min_similarity.remove(&old_a) {
                    merged_pct = merged_pct.min(prev);
                }
            }
            if old_b != new_root {
                if let Some(prev) = root_min_similarity.remove(&old_b) {
                    merged_pct = merged_pct.min(prev);
                }
            }
            root_min_similarity
                .entry(new_root)
                .and_modify(|prev| *prev = (*prev).min(merged_pct))
                .or_insert(merged_pct);
        }
    }

    let mut clusters: HashMap<usize, (Vec<&DuplicateCandidate>, u8)> = HashMap::new();
    for (idx, item) in prepared.iter().enumerate() {
        let root = uf.find(idx);
        let entry = clusters.entry(root).or_insert_with(|| {
            let pct = root_min_similarity.get(&root).copied().unwrap_or(clamped_min);
            (Vec::new(), pct)
        });
        entry.0.push(item.candidate);
    }

    let mut groups: Vec<DuplicateGroup> = clusters
        .into_iter()
        .filter(|(_, (items, _))| items.len() >= 2)
        .map(|(root_idx, (items, sim_pct))| {
            let first_id = items.iter().map(|c| c.sample_id).min().unwrap_or(root_idx as i64);
            let group_id = format!("similar:{}", first_id);
            build_duplicate_group(group_id, "near_duplicate", sim_pct, items)
        })
        .collect();

    groups.sort_by(|a, b| {
        b.similarity_pct
            .cmp(&a.similarity_pct)
            .then_with(|| b.reclaimable_bytes.cmp(&a.reclaimable_bytes))
            .then_with(|| a.group_id.cmp(&b.group_id))
    });
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nan_inputs_do_not_produce_nan_similarity() {
        assert!(cosine_equal_len(&[1.0, f32::NAN], &[1.0, 0.0]).is_none());
        assert!(cosine_equal_len(&[0.6, 0.8], &[f32::INFINITY, 0.0]).is_none());
        let mut nan_blob = Vec::new();
        nan_blob.extend_from_slice(&0.5_f32.to_le_bytes());
        nan_blob.extend_from_slice(&f32::NAN.to_le_bytes());
        assert!(blob_to_unit_embedding(Some(&nan_blob)).is_none());
        assert!(parse_normalized_peaks("[]").is_none());
        assert!(parse_normalized_peaks("[0.1, null, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]").is_none());
    }
}
