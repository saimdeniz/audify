use super::export::ExportAudioPreset;
use super::layer_pcm_cache::{
    prepare_clip_at_mix_rate_cached, MAX_PROCESSED_SINGLE_CLIP_BYTES,
};
use super::layer_recipe::{
    db_to_linear, linear_to_db, validate_and_normalize_recipe, LanePeaksPreview, LayerClipSpec,
    LayerRecipe, RenderedLayerMix, LAYER_MIX_SAMPLE_RATE, MAX_LAYER_DURATION_SEC,
};
use super::loudness::{apply_export_loudness_normalization, ExportLoudnessMode};
use super::transcode::write_wav_pcm_f32_atomic;
use super::NUM_PEAK_BINS;
use crate::audio_engine::dsp::soft_limit;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub use super::layer_pcm_cache::{clear_layer_pcm_cache, evict_layer_pcm_cache_path};
pub use super::layer_recipe::{
    validate_and_normalize_recipe as validate_layer_recipe, LayerLaneSpec, LayerPitchMode,
    MAX_LAYER_CLIPS, MAX_LAYER_LANES,
};

pub const LAYER_RENDER_CANCELLED_ERR: &str = "LAYER_RENDER_CANCELLED";

/// Upper bound for transient uncached PCM retained concurrently during one mix pass.
const MAX_INFLIGHT_RETAINED_BYTES: usize = 128 * 1024 * 1024;

pub fn compute_stereo_peaks(stereo: &[f32], num_bins: usize) -> Vec<f32> {
    let bins = num_bins.max(1);
    let frames = stereo.len() / 2;
    let mut peaks = vec![0.0_f32; bins];
    if frames == 0 {
        return peaks;
    }
    for (b, slot) in peaks.iter_mut().enumerate() {
        let start = (b * frames) / bins;
        let end = (((b + 1) * frames) / bins).max(start + 1).min(frames);
        let mut p = 0.0_f32;
        for f in start..end {
            let l = stereo[f * 2].abs();
            let r = stereo[f * 2 + 1].abs();
            let m = if l > r { l } else { r };
            if m > p {
                p = m;
            }
        }
        *slot = (p.min(1.0) * 1000.0).round() / 1000.0;
    }
    peaks
}

fn mix_clip_into_lane(
    lane_buf: &mut [f32],
    clip_pcm: &[f32],
    clip: &LayerClipSpec,
    sample_rate: u32,
) {
    let total_mix_frames = lane_buf.len() / 2;
    let clip_frames = clip_pcm.len() / 2;
    if total_mix_frames == 0 || clip_frames == 0 {
        return;
    }
    let start_frame = (clip.start_sec.max(0.0) * (sample_rate as f64)).round() as usize;
    if start_frame >= total_mix_frames {
        return;
    }
    let clip_gain = db_to_linear(clip.gain_db);
    if clip_gain <= 0.0 {
        return;
    }

    let max_fade_frames = clip_frames / 2;
    let fade_in_frames = ((clip.fade_in_sec * (sample_rate as f64)).round() as usize)
        .min(max_fade_frames);
    let fade_out_frames = ((clip.fade_out_sec * (sample_rate as f64)).round() as usize)
        .min(max_fade_frames);
    let render_frames = clip_frames.min(total_mix_frames - start_frame);
    let pi = std::f32::consts::PI;

    for i in 0..render_frames {
        let mut env = 1.0_f32;
        if fade_in_frames > 0 && i < fade_in_frames {
            let t = (i as f32) / (fade_in_frames as f32);
            env *= 0.5 * (1.0 - (pi * t).cos());
        }
        if fade_out_frames > 0 && i >= clip_frames - fade_out_frames {
            let rem = clip_frames - 1 - i;
            let t = (rem as f32) / (fade_out_frames as f32);
            env *= 0.5 * (1.0 - (pi * t).cos());
        }
        let g = clip_gain * env;
        let dst = (start_frame + i) * 2;
        let src = i * 2;
        lane_buf[dst] += clip_pcm[src] * g;
        lane_buf[dst + 1] += clip_pcm[src + 1] * g;
    }
}

fn empty_mix(recipe: &LayerRecipe, target_sr: u32, max_source_bit_depth: u32) -> RenderedLayerMix {
    let lane_peaks = recipe
        .lanes
        .iter()
        .map(|l| LanePeaksPreview {
            lane_id: l.id.clone(),
            color_hex: l.color_hex.clone(),
            muted: l.muted,
            solo: l.solo,
            peaks: vec![0.0; NUM_PEAK_BINS],
        })
        .collect();
    RenderedLayerMix {
        samples: Vec::new(),
        sample_rate: target_sr,
        total_frames: 0,
        duration_sec: 0.0,
        max_source_bit_depth,
        master_peaks: vec![0.0; NUM_PEAK_BINS],
        lane_peaks,
        peak_db: -96.0,
        clipped: false,
    }
}

struct PreparedClipSlot {
    lane_idx: usize,
    clip_idx: usize,
    pcm: Option<Arc<Vec<f32>>>,
    frames: usize,
    bit_depth: u32,
}

/// Renders a multi-lane `LayerRecipe` into interleaved stereo `f32` PCM plus Master Sum and
/// per-lane waveform peaks using parallel clip preparation (`rayon`) backed by a 128 MiB
/// processed-clip LRU cache and bounded-memory lane-by-lane mixing.
pub fn render_layer_mix<F>(
    raw_recipe: &LayerRecipe,
    resolve_source_path: F,
) -> Result<RenderedLayerMix, String>
where
    F: FnMut(&str) -> Result<PathBuf, String>,
{
    render_layer_mix_cancellable(raw_recipe, &|| false, resolve_source_path)
}

/// Cancellable variant of `render_layer_mix` used by `preview_layer_mix` so stale edits
/// abort early before wasting CPU or overwriting newer WASAPI playback.
pub fn render_layer_mix_cancellable<F>(
    raw_recipe: &LayerRecipe,
    is_cancelled: &(dyn Fn() -> bool + Sync),
    mut resolve_source_path: F,
) -> Result<RenderedLayerMix, String>
where
    F: FnMut(&str) -> Result<PathBuf, String>,
{
    if is_cancelled() {
        return Err(LAYER_RENDER_CANCELLED_ERR.to_string());
    }
    let recipe = validate_and_normalize_recipe(raw_recipe)?;
    let target_sr = LAYER_MIX_SAMPLE_RATE;

    if recipe.clips.is_empty() {
        return Ok(empty_mix(&recipe, target_sr, 24));
    }

    let lane_index_map: HashMap<&str, usize> = recipe
        .lanes
        .iter()
        .enumerate()
        .map(|(i, l)| (l.id.as_str(), i))
        .collect();

    let mut clip_jobs: Vec<(usize, usize, PathBuf)> = Vec::with_capacity(recipe.clips.len());
    for (clip_idx, clip) in recipe.clips.iter().enumerate() {
        if is_cancelled() {
            return Err(LAYER_RENDER_CANCELLED_ERR.to_string());
        }
        let Some(&lane_idx) = lane_index_map.get(clip.lane_id.as_str()) else {
            continue;
        };
        let resolved = resolve_source_path(&clip.source_path)?;
        clip_jobs.push((lane_idx, clip_idx, resolved));
    }

    let retained_bytes = AtomicUsize::new(0);
    let prepared_res: Result<Vec<PreparedClipSlot>, String> = clip_jobs
        .par_iter()
        .map(|(lane_idx, clip_idx, resolved)| {
            if is_cancelled() {
                return Err(LAYER_RENDER_CANCELLED_ERR.to_string());
            }
            let clip = &recipe.clips[*clip_idx];
            let (pcm, bd) = prepare_clip_at_mix_rate_cached(clip, resolved, target_sr)?;
            let frames = pcm.len() / 2;
            let bytes = pcm.len() * std::mem::size_of::<f32>();
            let keep_pcm = if bytes <= MAX_PROCESSED_SINGLE_CLIP_BYTES {
                let prev = retained_bytes.fetch_add(bytes, Ordering::Relaxed);
                prev.saturating_add(bytes) <= MAX_INFLIGHT_RETAINED_BYTES
            } else {
                false
            };
            Ok(PreparedClipSlot {
                lane_idx: *lane_idx,
                clip_idx: *clip_idx,
                pcm: if keep_pcm { Some(pcm) } else { None },
                frames,
                bit_depth: bd,
            })
        })
        .collect();
    let mut prepared_slots = prepared_res?;

    if is_cancelled() {
        return Err(LAYER_RENDER_CANCELLED_ERR.to_string());
    }

    let mut max_end_frames: usize = 0;
    let mut max_source_bit_depth: u32 = 16;
    for slot in &prepared_slots {
        max_source_bit_depth = max_source_bit_depth.max(slot.bit_depth);
        let clip = &recipe.clips[slot.clip_idx];
        let start_f = (clip.start_sec * (target_sr as f64)).round() as usize;
        let end_f = start_f.saturating_add(slot.frames);
        if end_f > max_end_frames {
            max_end_frames = end_f;
        }
    }

    let max_allowed_frames = (MAX_LAYER_DURATION_SEC * (target_sr as f64)).round() as usize;
    let total_frames = max_end_frames.min(max_allowed_frames);
    if total_frames == 0 {
        return Ok(empty_mix(&recipe, target_sr, max_source_bit_depth));
    }

    let resolved_by_clip: HashMap<usize, &PathBuf> = clip_jobs
        .iter()
        .map(|(_, clip_idx, path)| (*clip_idx, path))
        .collect();

    let any_solo = recipe.lanes.iter().any(|l| l.solo);
    let mut master_buf = vec![0.0_f32; total_frames * 2];
    let mut lane_scratch = vec![0.0_f32; total_frames * 2];
    let mut lane_peaks = Vec::with_capacity(recipe.lanes.len());

    for (lane_idx, lane) in recipe.lanes.iter().enumerate() {
        if is_cancelled() {
            return Err(LAYER_RENDER_CANCELLED_ERR.to_string());
        }
        lane_scratch.fill(0.0);
        let audible = if any_solo {
            lane.solo && !lane.muted
        } else {
            !lane.muted
        };
        let lane_gain = db_to_linear(lane.volume_db);
        let mut has_any_clip = false;

        for slot in &mut prepared_slots {
            if slot.lane_idx != lane_idx {
                continue;
            }
            let clip = &recipe.clips[slot.clip_idx];
            if let Some(pcm_arc) = slot.pcm.take() {
                mix_clip_into_lane(&mut lane_scratch, &pcm_arc, clip, target_sr);
                has_any_clip = true;
            } else if let Some(resolved) = resolved_by_clip.get(&slot.clip_idx) {
                let (pcm_arc, _) = prepare_clip_at_mix_rate_cached(clip, resolved, target_sr)?;
                mix_clip_into_lane(&mut lane_scratch, &pcm_arc, clip, target_sr);
                has_any_clip = true;
            }
        }

        if has_any_clip && lane_gain > 0.0 {
            for s in &mut lane_scratch {
                *s *= lane_gain;
            }
            if audible {
                for (dst, &src) in master_buf.iter_mut().zip(lane_scratch.iter()) {
                    *dst += src;
                }
            }
            let peaks = compute_stereo_peaks(&lane_scratch, NUM_PEAK_BINS);
            lane_peaks.push(LanePeaksPreview {
                lane_id: lane.id.clone(),
                color_hex: lane.color_hex.clone(),
                muted: lane.muted,
                solo: lane.solo,
                peaks,
            });
        } else {
            lane_peaks.push(LanePeaksPreview {
                lane_id: lane.id.clone(),
                color_hex: lane.color_hex.clone(),
                muted: lane.muted,
                solo: lane.solo,
                peaks: vec![0.0; NUM_PEAK_BINS],
            });
        }
    }

    let master_gain = db_to_linear(recipe.master_gain_db);
    let mut pre_limit_peak: f32 = 0.0;
    for s in &mut master_buf {
        let v = if s.is_finite() { *s * master_gain } else { 0.0 };
        let a = v.abs();
        if a > pre_limit_peak {
            pre_limit_peak = a;
        }
        *s = soft_limit(v);
    }

    let master_peaks = compute_stereo_peaks(&master_buf, NUM_PEAK_BINS);
    let duration_sec = (total_frames as f64) / (target_sr as f64);

    Ok(RenderedLayerMix {
        samples: master_buf,
        sample_rate: target_sr,
        total_frames: total_frames as u64,
        duration_sec,
        max_source_bit_depth,
        master_peaks,
        lane_peaks,
        peak_db: linear_to_db(pre_limit_peak),
        clipped: pre_limit_peak > 0.995,
    })
}

/// Exports a `RenderedLayerMix` to disk atomically honoring Audify's Settings -> Audio Export
/// Format preset (`Original` / `Wav24` / `Nle48k24`) and Loudness mode (`Off` / `-1 dBTP` / LUFS).
pub fn export_rendered_layer_wav(
    rendered: &RenderedLayerMix,
    out_path: &Path,
    export_preset: Option<&str>,
    loudness_mode: Option<&str>,
) -> Result<(u32, u16, u16, Vec<f32>), String> {
    if rendered.total_frames == 0 || rendered.samples.is_empty() {
        return Err("Cannot export an empty layer mix".to_string());
    }
    let parent_dir = out_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent_dir)
        .map_err(|_| "Failed to create layer export directory".to_string())?;

    let preset = ExportAudioPreset::from_opt_str(export_preset);
    let loudness = ExportLoudnessMode::from_opt_str(loudness_mode);
    let bits_per_sample: u16 = match preset {
        ExportAudioPreset::Original => {
            if rendered.max_source_bit_depth > 16 {
                24
            } else {
                16
            }
        }
        ExportAudioPreset::Wav24 | ExportAudioPreset::Nle48k24 => 24,
    };

    let mut samples = rendered.samples.clone();
    let final_peaks = if loudness != ExportLoudnessMode::Off {
        apply_export_loudness_normalization(&mut samples, rendered.sample_rate, 2, loudness);
        compute_stereo_peaks(&samples, NUM_PEAK_BINS)
    } else {
        rendered.master_peaks.clone()
    };

    write_wav_pcm_f32_atomic(
        out_path,
        parent_dir,
        rendered.sample_rate,
        2,
        bits_per_sample,
        &samples,
        false,
    )?;

    Ok((rendered.sample_rate, 2, bits_per_sample, final_peaks))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::layer_pcm_cache::processed_clip_cache_len;
    use crate::audio::write_wav_i16;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn make_lane(id: &str, vol: f32, muted: bool, solo: bool) -> LayerLaneSpec {
        LayerLaneSpec {
            id: id.to_string(),
            name: id.to_string(),
            color_hex: "#38BDF8".to_string(),
            volume_db: vol,
            muted,
            solo,
        }
    }

    fn make_clip(id: &str, lane_id: &str, path: &Path, start: f64, trim_end: f64) -> LayerClipSpec {
        LayerClipSpec {
            id: id.to_string(),
            lane_id: lane_id.to_string(),
            source_sample_id: None,
            source_path: path.to_string_lossy().to_string(),
            source_name: "clip.wav".to_string(),
            source_duration_sec: Some(trim_end),
            start_sec: start,
            trim_start_sec: 0.0,
            trim_end_sec: trim_end,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            gain_db: 0.0,
            pitch_semitones: 0.0,
            pitch_mode: LayerPitchMode::Preserve,
            reversed: false,
        }
    }

    #[test]
    fn mixes_two_lanes_respects_mute_solo_and_soft_limiter() {
        let root = std::env::temp_dir().join(format!("audify_layer_mix_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let wav_a = root.join("dc_pos.wav");
        let wav_b = root.join("dc_hot.wav");
        write_wav_i16(&wav_a, 48_000, 1, &vec![13_107i16; 12_000]).unwrap();
        write_wav_i16(&wav_b, 48_000, 1, &vec![26_214i16; 12_000]).unwrap();

        let recipe = LayerRecipe {
            version: 1,
            lanes: vec![
                make_lane("l1", 0.0, false, false),
                make_lane("l2", 0.0, false, false),
            ],
            clips: vec![
                make_clip("c1", "l1", &wav_a, 0.0, 0.25),
                make_clip("c2", "l2", &wav_b, 0.0, 0.25),
            ],
            master_gain_db: 0.0,
            snap_enabled: true,
            snap_grid_sec: 0.1,
        };
        let mixed = render_layer_mix(&recipe, |p| Ok(PathBuf::from(p))).unwrap();
        assert_eq!(mixed.total_frames, 12_000);
        assert!(mixed.clipped, "Sum of 0.4 + 0.8 should report clipped=true");
        let mid_l = mixed.samples[6000 * 2];
        assert!(mid_l > 0.98 && mid_l <= 1.0, "Soft limiter must hold <= 1.0, got {}", mid_l);
        assert_eq!(mixed.master_peaks.len(), NUM_PEAK_BINS);
        assert_eq!(mixed.lane_peaks.len(), 2);

        let mut solo_recipe = recipe.clone();
        solo_recipe.lanes[0].solo = true;
        let solo_mix = render_layer_mix(&solo_recipe, |p| Ok(PathBuf::from(p))).unwrap();
        assert!(!solo_mix.clipped);
        let solo_l = solo_mix.samples[6000 * 2];
        assert!((solo_l - 0.4).abs() < 0.02, "Expected ~0.40 when soloing lane 1, got {}", solo_l);

        let mut mute_recipe = recipe;
        mute_recipe.lanes[0].muted = true;
        mute_recipe.lanes[1].muted = true;
        let muted_mix = render_layer_mix(&mute_recipe, |p| Ok(PathBuf::from(p))).unwrap();
        assert_eq!(muted_mix.total_frames, 12_000);
        assert!(muted_mix.samples.iter().all(|&s| s == 0.0));

        clear_layer_pcm_cache();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn applies_fade_curves_reverse_pitch_and_exports_wav() {
        let root = std::env::temp_dir().join(format!("audify_layer_dsp_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let wav_ramp = root.join("ramp.wav");
        let ramp: Vec<i16> = (0..9600).map(|i| ((i as f32 / 9600.0) * 28_000.0) as i16).collect();
        write_wav_i16(&wav_ramp, 48_000, 1, &ramp).unwrap();

        let mut clip = make_clip("c1", "l1", &wav_ramp, 0.0, 0.20);
        clip.reversed = true;
        clip.pitch_semitones = 12.0;
        clip.pitch_mode = LayerPitchMode::Varispeed;
        clip.fade_in_sec = 0.02;
        clip.fade_out_sec = 0.02;

        let recipe = LayerRecipe {
            version: 1,
            lanes: vec![make_lane("l1", 0.0, false, false)],
            clips: vec![clip],
            master_gain_db: 0.0,
            snap_enabled: true,
            snap_grid_sec: 0.1,
        };

        let mixed = render_layer_mix(&recipe, |p| Ok(PathBuf::from(p))).unwrap();
        assert!((mixed.total_frames as i64 - 4800).abs() <= 4);
        assert!(mixed.samples[0].abs() < 1e-4, "Fade-in must start at 0");
        assert!(
            mixed.samples[mixed.samples.len() - 2].abs() < 1e-3,
            "Fade-out must end near 0"
        );
        let early = mixed.samples[(mixed.total_frames as usize / 4) * 2];
        let late = mixed.samples[((mixed.total_frames as usize * 3) / 4) * 2];
        assert!(early > late, "Reversed ramp should decay (early={}, late={})", early, late);

        let out_wav = root.join("exported_layer.wav");
        let (sr, ch, bits, peaks) =
            export_rendered_layer_wav(&mixed, &out_wav, Some("nle_48k_24"), Some("peak_m1"))
                .unwrap();
        assert_eq!(sr, 48_000);
        assert_eq!(ch, 2);
        assert_eq!(bits, 24);
        assert_eq!(peaks.len(), NUM_PEAK_BINS);
        assert!(out_wav.is_file());
        assert!(fs::metadata(&out_wav).unwrap().len() > 44);

        clear_layer_pcm_cache();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn preserve_pitch_mode_keeps_exact_clip_duration_at_extreme_semitones() {
        let root =
            std::env::temp_dir().join(format!("audify_layer_preserve_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let wav_tone = root.join("tone_440.wav");
        let tone: Vec<i16> = (0..12_000)
            .map(|i| {
                let s = (2.0 * std::f64::consts::PI * 440.0 * (i as f64) / 48_000.0).sin();
                (s * 20_000.0) as i16
            })
            .collect();
        write_wav_i16(&wav_tone, 48_000, 1, &tone).unwrap();

        for &st in &[24.0_f32, -24.0_f32] {
            let mut clip = make_clip("c1", "l1", &wav_tone, 0.0, 0.25);
            clip.pitch_semitones = st;
            clip.pitch_mode = LayerPitchMode::Preserve;
            let recipe = LayerRecipe {
                version: 1,
                lanes: vec![make_lane("l1", 0.0, false, false)],
                clips: vec![clip],
                master_gain_db: 0.0,
                snap_enabled: true,
                snap_grid_sec: 0.1,
            };
            let mixed = render_layer_mix(&recipe, |p| Ok(PathBuf::from(p))).unwrap();
            assert_eq!(mixed.total_frames, 12_000);
            assert!(mixed.samples.iter().all(|s| s.is_finite()));
        }

        clear_layer_pcm_cache();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validates_duplicate_clip_ids_excessive_trim_cache_reuse_and_cancellation() {
        let root =
            std::env::temp_dir().join(format!("audify_layer_guard_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let wav = root.join("hit.wav");
        write_wav_i16(&wav, 48_000, 1, &vec![12_000i16; 9_600]).unwrap();

        // 1. Duplicate clip IDs rejected
        let dup_recipe = LayerRecipe {
            version: 1,
            lanes: vec![make_lane("l1", 0.0, false, false)],
            clips: vec![
                make_clip("same-id", "l1", &wav, 0.0, 0.2),
                make_clip("same-id", "l1", &wav, 0.5, 0.2),
            ],
            master_gain_db: 0.0,
            snap_enabled: true,
            snap_grid_sec: 0.1,
        };
        assert!(validate_and_normalize_recipe(&dup_recipe).is_err());

        // 2. Oversize trim span > MAX_LAYER_DURATION_SEC rejected
        let mut long_clip = make_clip("c-long", "l1", &wav, 0.0, 400.0);
        long_clip.trim_end_sec = MAX_LAYER_DURATION_SEC + 5.0;
        let long_recipe = LayerRecipe {
            version: 1,
            lanes: vec![make_lane("l1", 0.0, false, false)],
            clips: vec![long_clip],
            master_gain_db: 0.0,
            snap_enabled: true,
            snap_grid_sec: 0.1,
        };
        assert!(validate_and_normalize_recipe(&long_recipe).is_err());

        // 3. ProcessedClipCache caches pitched clip across startSec moves
        let mut pitched_clip = make_clip("c-pitch", "l1", &wav, 0.0, 0.2);
        pitched_clip.pitch_semitones = 7.0;
        let recipe_a = LayerRecipe {
            version: 1,
            lanes: vec![make_lane("l1", 0.0, false, false)],
            clips: vec![pitched_clip.clone()],
            master_gain_db: 0.0,
            snap_enabled: true,
            snap_grid_sec: 0.1,
        };
        let _ = render_layer_mix(&recipe_a, |p| Ok(PathBuf::from(p))).unwrap();
        assert!(processed_clip_cache_len() >= 1);

        // 4. Cancellation aborts immediately
        let cancelled = AtomicBool::new(true);
        let err = render_layer_mix_cancellable(
            &recipe_a,
            &|| cancelled.load(Ordering::Relaxed),
            |p| Ok(PathBuf::from(p)),
        )
        .unwrap_err();
        assert_eq!(err, LAYER_RENDER_CANCELLED_ERR);

        clear_layer_pcm_cache();
        let _ = fs::remove_dir_all(&root);
    }
}
