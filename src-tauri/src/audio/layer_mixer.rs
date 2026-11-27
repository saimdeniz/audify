use super::decode::{copy_packet_samples, open_audio_decoder};
use super::export::ExportAudioPreset;
use super::loudness::{apply_export_loudness_normalization, ExportLoudnessMode};
use super::pcm_ops::resample_interleaved_f32;
use super::pitch_shift::pitch_shift_stereo_preserve_duration;
use super::transcode::{validate_readable_audio_source, write_wav_pcm_f32_atomic};
use super::NUM_PEAK_BINS;
use crate::audio_engine::decoder::push_interleaved_stereo;
use crate::audio_engine::dsp::soft_limit;
use crate::security::normalize_clean_path;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;

pub const LAYER_MIX_SAMPLE_RATE: u32 = 48_000;
pub const MAX_LAYER_LANES: usize = 64;
pub const MAX_LAYER_CLIPS: usize = 256;
pub const MAX_LAYER_DURATION_SEC: f64 = 300.0;
const MAX_CACHED_CLIP_FRAMES: usize = 48_000 * 120; // <= 2 min stereo f32 (~46 MiB)
const MAX_LAYER_CACHE_ENTRIES: usize = 32;
const MAX_LAYER_CACHE_BYTES: usize = 128 * 1024 * 1024;
const MAX_RESAMPLE_SAMPLES: usize = (128 * 1024 * 1024) / std::mem::size_of::<f32>();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerLaneSpec {
    pub id: String,
    pub name: String,
    pub color_hex: String,
    #[serde(default)]
    pub volume_db: f32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub solo: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LayerPitchMode {
    /// Time-preserving Phase Vocoder pitch shift (DaVinci / NLE default):
    /// clip duration on the timeline never changes when pitching ±24st.
    #[default]
    Preserve,
    /// Classic tape-style varispeed resampling: pitching up shortens the clip,
    /// pitching down lengthens it with zero time-stretch artifacts.
    Varispeed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerClipSpec {
    pub id: String,
    pub lane_id: String,
    #[serde(default)]
    pub source_sample_id: Option<i64>,
    pub source_path: String,
    #[serde(default)]
    pub source_name: String,
    pub start_sec: f64,
    #[serde(default)]
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    #[serde(default)]
    pub fade_in_sec: f64,
    #[serde(default)]
    pub fade_out_sec: f64,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub pitch_semitones: f32,
    #[serde(default)]
    pub pitch_mode: LayerPitchMode,
    #[serde(default)]
    pub reversed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerRecipe {
    #[serde(default = "default_recipe_version")]
    pub version: u32,
    pub lanes: Vec<LayerLaneSpec>,
    pub clips: Vec<LayerClipSpec>,
    #[serde(default)]
    pub master_gain_db: f32,
    #[serde(default = "default_true")]
    pub snap_enabled: bool,
    #[serde(default = "default_snap_grid")]
    pub snap_grid_sec: f64,
}

fn default_recipe_version() -> u32 {
    1
}
fn default_true() -> bool {
    true
}
fn default_snap_grid() -> f64 {
    0.1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanePeaksPreview {
    pub lane_id: String,
    pub color_hex: String,
    pub muted: bool,
    pub solo: bool,
    pub peaks: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct RenderedLayerMix {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub total_frames: u64,
    pub duration_sec: f64,
    pub max_source_bit_depth: u32,
    pub master_peaks: Vec<f32>,
    pub lane_peaks: Vec<LanePeaksPreview>,
    pub peak_db: f32,
    pub clipped: bool,
}

#[derive(Clone)]
struct CachedClipPcm {
    path_norm: String,
    file_size: u64,
    mtime_ms: u128,
    sample_rate: u32,
    bit_depth: u32,
    /// Interleaved stereo `f32` PCM (`[L, R, L, R, ...]`).
    samples: Arc<Vec<f32>>,
}

impl CachedClipPcm {
    fn byte_len(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }
}

#[derive(Default)]
struct LayerClipPcmCache {
    entries: VecDeque<CachedClipPcm>,
    total_bytes: usize,
}

impl LayerClipPcmCache {
    fn get(&mut self, path_norm: &str, file_size: u64, mtime_ms: u128) -> Option<CachedClipPcm> {
        let idx = self.entries.iter().position(|e| {
            e.path_norm.eq_ignore_ascii_case(path_norm)
                && e.file_size == file_size
                && e.mtime_ms == mtime_ms
        })?;
        let item = self.entries.remove(idx)?;
        self.entries.push_back(item.clone());
        Some(item)
    }

    fn insert(&mut self, item: CachedClipPcm) {
        let bytes = item.byte_len();
        if bytes > MAX_LAYER_CACHE_BYTES {
            return;
        }
        self.evict_path(&item.path_norm);
        while self.entries.len() >= MAX_LAYER_CACHE_ENTRIES
            || self.total_bytes.saturating_add(bytes) > MAX_LAYER_CACHE_BYTES
        {
            let Some(oldest) = self.entries.pop_front() else {
                break;
            };
            self.total_bytes = self.total_bytes.saturating_sub(oldest.byte_len());
        }
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        self.entries.push_back(item);
    }

    fn evict_path(&mut self, path_norm: &str) {
        let mut idx = 0;
        while idx < self.entries.len() {
            if self.entries[idx].path_norm.eq_ignore_ascii_case(path_norm) {
                if let Some(removed) = self.entries.remove(idx) {
                    self.total_bytes = self.total_bytes.saturating_sub(removed.byte_len());
                }
            } else {
                idx += 1;
            }
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }
}

fn layer_pcm_cache() -> &'static Mutex<LayerClipPcmCache> {
    static CACHE: OnceLock<Mutex<LayerClipPcmCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(LayerClipPcmCache::default()))
}

pub fn clear_layer_pcm_cache() {
    if let Ok(mut guard) = layer_pcm_cache().lock() {
        guard.clear();
    }
}

pub fn evict_layer_pcm_cache_path(path_norm: &str) {
    if let Ok(mut guard) = layer_pcm_cache().lock() {
        guard.evict_path(path_norm);
    }
}

#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    if !db.is_finite() || db <= -59.9 {
        0.0
    } else {
        10.0_f32.powf(db / 20.0)
    }
}

#[inline]
pub fn linear_to_db(peak: f32) -> f32 {
    if !peak.is_finite() || peak <= 1e-6 {
        -96.0
    } else {
        (20.0 * peak.log10()).max(-96.0)
    }
}

fn sanitize_hex_color(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        trimmed.to_ascii_uppercase()
    } else {
        "#38BDF8".to_string()
    }
}

pub fn validate_and_normalize_recipe(recipe: &LayerRecipe) -> Result<LayerRecipe, String> {
    if recipe.lanes.is_empty() {
        return Err("Layer recipe must contain at least one lane".to_string());
    }
    if recipe.lanes.len() > MAX_LAYER_LANES {
        return Err(format!(
            "Layer recipe exceeds maximum of {} lanes",
            MAX_LAYER_LANES
        ));
    }
    if recipe.clips.len() > MAX_LAYER_CLIPS {
        return Err(format!(
            "Layer recipe exceeds maximum of {} clips",
            MAX_LAYER_CLIPS
        ));
    }

    let mut lanes = Vec::with_capacity(recipe.lanes.len());
    let mut lane_ids = HashMap::with_capacity(recipe.lanes.len());
    for (idx, lane) in recipe.lanes.iter().enumerate() {
        let id = lane.id.trim().to_string();
        if id.is_empty() || id.len() > 64 {
            return Err("Invalid lane identifier".to_string());
        }
        if lane_ids.insert(id.clone(), idx).is_some() {
            return Err("Duplicate lane identifier in recipe".to_string());
        }
        let name = lane.name.trim();
        let clean_name = if name.is_empty() {
            format!("Lane {}", idx + 1)
        } else {
            name.chars().take(64).collect()
        };
        let volume_db = if lane.volume_db.is_finite() {
            lane.volume_db.clamp(-60.0, 12.0)
        } else {
            0.0
        };
        lanes.push(LayerLaneSpec {
            id,
            name: clean_name,
            color_hex: sanitize_hex_color(&lane.color_hex),
            volume_db,
            muted: lane.muted,
            solo: lane.solo,
        });
    }

    let mut clips = Vec::with_capacity(recipe.clips.len());
    for clip in &recipe.clips {
        let id = clip.id.trim().to_string();
        let lane_id = clip.lane_id.trim().to_string();
        if id.is_empty() || id.len() > 64 || !lane_ids.contains_key(&lane_id) {
            return Err("Clip references an invalid or missing lane".to_string());
        }
        if !clip.start_sec.is_finite()
            || !clip.trim_start_sec.is_finite()
            || !clip.trim_end_sec.is_finite()
            || !clip.fade_in_sec.is_finite()
            || !clip.fade_out_sec.is_finite()
        {
            return Err("Clip timings must be finite numbers".to_string());
        }
        let start_sec = clip.start_sec.max(0.0);
        let trim_start_sec = clip.trim_start_sec.max(0.0);
        let trim_end_sec = clip.trim_end_sec.max(trim_start_sec);
        if start_sec > MAX_LAYER_DURATION_SEC {
            return Err(format!(
                "Clip start exceeds maximum duration of {:.0}s",
                MAX_LAYER_DURATION_SEC
            ));
        }
        clips.push(LayerClipSpec {
            id,
            lane_id,
            source_sample_id: clip.source_sample_id,
            source_path: clip.source_path.trim().to_string(),
            source_name: clip.source_name.trim().chars().take(160).collect(),
            start_sec,
            trim_start_sec,
            trim_end_sec,
            fade_in_sec: clip.fade_in_sec.max(0.0),
            fade_out_sec: clip.fade_out_sec.max(0.0),
            gain_db: if clip.gain_db.is_finite() {
                clip.gain_db.clamp(-48.0, 18.0)
            } else {
                0.0
            },
            pitch_semitones: if clip.pitch_semitones.is_finite() {
                clip.pitch_semitones.clamp(-24.0, 24.0)
            } else {
                0.0
            },
            pitch_mode: clip.pitch_mode,
            reversed: clip.reversed,
        });
    }

    let master_gain_db = if recipe.master_gain_db.is_finite() {
        recipe.master_gain_db.clamp(-24.0, 12.0)
    } else {
        0.0
    };
    let snap_grid_sec = if recipe.snap_grid_sec.is_finite() {
        recipe.snap_grid_sec.clamp(0.01, 2.0)
    } else {
        0.1
    };

    Ok(LayerRecipe {
        version: 1,
        lanes,
        clips,
        master_gain_db,
        snap_enabled: recipe.snap_enabled,
        snap_grid_sec,
    })
}

fn decode_stereo_window(
    path: &Path,
    start_sec: f64,
    end_sec: Option<f64>,
    max_frames: usize,
) -> Result<(u32, u32, Vec<f32>), String> {
    let mut opened = open_audio_decoder(path)?;
    let mut sample_rate = opened.sample_rate;
    let bit_depth = opened.bit_depth;
    let mut current_frame: u64 = 0;

    if start_sec > 2.0 && sample_rate > 0 {
        let seek_sec = (start_sec - 0.5).max(0.0);
        if let Ok(seeked) = opened.format.seek(
            symphonia::core::formats::SeekMode::Coarse,
            symphonia::core::formats::SeekTo::Time {
                time: symphonia::core::units::Time::from(seek_sec),
                track_id: Some(opened.track_id),
            },
        ) {
            let time_base = opened
                .format
                .tracks()
                .iter()
                .find(|t| t.id == opened.track_id)
                .and_then(|t| t.codec_params.time_base);
            let actual_frame = if let Some(tb) = time_base {
                let t = tb.calc_time(seeked.actual_ts);
                ((t.seconds as f64 + t.frac) * (sample_rate as f64))
                    .round()
                    .max(0.0) as u64
            } else {
                seeked.actual_ts
            };
            if actual_frame <= (start_sec * sample_rate as f64).floor() as u64 {
                opened.decoder.reset();
                current_frame = actual_frame;
            } else {
                opened = open_audio_decoder(path)?;
                sample_rate = opened.sample_rate;
                current_frame = 0;
            }
        }
    }

    let mut out = Vec::new();
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;

    loop {
        let packet = match opened.format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                opened.decoder.reset();
                continue;
            }
            Err(_) => break,
        };
        if packet.track_id() != opened.track_id {
            continue;
        }
        let decoded = match opened.decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => break,
        };

        let Some((spec, frames, samples)) = copy_packet_samples(&mut sample_buf_slot, decoded) else {
            continue;
        };
        let ch = spec.channels.count().max(1);
        if sample_rate == 0 {
            sample_rate = spec.rate;
        }
        if sample_rate == 0 {
            continue;
        }

        let start_frame = (start_sec.max(0.0) * (sample_rate as f64)).floor() as u64;
        let end_frame = end_sec
            .map(|e| (e.max(start_sec) * (sample_rate as f64)).ceil() as u64)
            .unwrap_or(u64::MAX);

        let pkt_frames = (frames as u64).min((samples.len() / ch) as u64);
        if pkt_frames == 0 {
            continue;
        }
        let pkt_end = current_frame.saturating_add(pkt_frames);
        if pkt_end <= start_frame {
            current_frame = pkt_end;
            continue;
        }

        let local_start = start_frame.saturating_sub(current_frame) as usize;
        let local_end = (end_frame.min(pkt_end).saturating_sub(current_frame) as usize)
            .min(pkt_frames as usize);
        if local_end > local_start {
            let remaining = max_frames.saturating_sub(out.len() / 2);
            let take = (local_end - local_start).min(remaining);
            if take > 0 {
                let slice = &samples[(local_start * ch)..((local_start + take) * ch)];
                push_interleaved_stereo(slice, ch, &mut out);
            }
        }
        current_frame = pkt_end;
        if current_frame >= end_frame || (out.len() / 2) >= max_frames {
            break;
        }
    }

    if sample_rate == 0 {
        return Err("Unable to determine source audio sample rate".to_string());
    }
    Ok((sample_rate, bit_depth, out))
}

fn load_clip_stereo_slice(
    path: &Path,
    trim_start_sec: f64,
    trim_end_sec: f64,
) -> Result<(u32, u32, Vec<f32>), String> {
    validate_readable_audio_source(path)?;
    let meta = fs::metadata(path).map_err(|_| "Source audio file is unavailable".to_string())?;
    let file_size = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path_norm = normalize_clean_path(&path.to_string_lossy()).to_lowercase();

    if let Ok(mut guard) = layer_pcm_cache().lock() {
        if let Some(hit) = guard.get(&path_norm, file_size, mtime_ms) {
            return Ok(slice_stereo_pcm(
                &hit.samples,
                hit.sample_rate,
                hit.bit_depth,
                trim_start_sec,
                trim_end_sec,
            ));
        }
    }

    // Check estimated duration: cache short/medium clips (<= 2 min) in full for instant re-mixes,
    // and decode long field recordings directly by window to keep RAM tight.
    let probe = open_audio_decoder(path)?;
    let cacheable = probe
        .n_frames
        .map(|n| n <= MAX_CACHED_CLIP_FRAMES as u64)
        .unwrap_or(file_size <= 24 * 1024 * 1024);
    drop(probe);

    if cacheable {
        let (sr, bd, full_pcm) = decode_stereo_window(path, 0.0, None, MAX_CACHED_CLIP_FRAMES)?;
        let reached_cap = (full_pcm.len() / 2) >= MAX_CACHED_CLIP_FRAMES;
        if !reached_cap {
            let shared = Arc::new(full_pcm);
            let out = slice_stereo_pcm(&shared, sr, bd, trim_start_sec, trim_end_sec);
            if let Ok(mut guard) = layer_pcm_cache().lock() {
                guard.insert(CachedClipPcm {
                    path_norm,
                    file_size,
                    mtime_ms,
                    sample_rate: sr,
                    bit_depth: bd,
                    samples: shared,
                });
            }
            return Ok(out);
        }
    }

    let max_window_frames = ((MAX_LAYER_DURATION_SEC * 192_000.0) as usize).min(MAX_RESAMPLE_SAMPLES / 2);
    let end_opt = if trim_end_sec > trim_start_sec {
        Some(trim_end_sec)
    } else {
        Some(trim_start_sec + MAX_LAYER_DURATION_SEC)
    };
    decode_stereo_window(path, trim_start_sec, end_opt, max_window_frames)
}

fn slice_stereo_pcm(
    stereo: &[f32],
    sample_rate: u32,
    bit_depth: u32,
    trim_start_sec: f64,
    trim_end_sec: f64,
) -> (u32, u32, Vec<f32>) {
    let total_frames = stereo.len() / 2;
    if total_frames == 0 || sample_rate == 0 {
        return (sample_rate, bit_depth, Vec::new());
    }
    let sr_f = sample_rate as f64;
    let start_f = ((trim_start_sec.max(0.0) * sr_f).floor() as usize).min(total_frames);
    let end_f = if trim_end_sec > trim_start_sec {
        ((trim_end_sec * sr_f).ceil() as usize).clamp(start_f, total_frames)
    } else {
        total_frames
    };
    (sample_rate, bit_depth, stereo[(start_f * 2)..(end_f * 2)].to_vec())
}

fn reverse_stereo_frames_in_place(stereo: &mut [f32]) {
    let frames = stereo.len() / 2;
    for i in 0..(frames / 2) {
        let j = frames - 1 - i;
        stereo.swap(i * 2, j * 2);
        stereo.swap(i * 2 + 1, j * 2 + 1);
    }
}

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

fn prepare_clip_at_mix_rate(
    clip: &LayerClipSpec,
    resolved_path: &Path,
    target_sr: u32,
) -> Result<(Vec<f32>, u32), String> {
    let (src_sr, bit_depth, mut pcm) =
        load_clip_stereo_slice(resolved_path, clip.trim_start_sec, clip.trim_end_sec)?;
    if pcm.is_empty() {
        return Ok((pcm, bit_depth));
    }
    if clip.reversed {
        reverse_stereo_frames_in_place(&mut pcm);
    }
    let pitch_ratio = if clip.pitch_semitones.abs() >= 0.01 {
        2.0_f64.powf((clip.pitch_semitones as f64) / 12.0)
    } else {
        1.0
    };
    let sr_ratio = (src_sr as f64) / (target_sr.max(1) as f64);
    let processed = if clip.pitch_mode == LayerPitchMode::Preserve && (pitch_ratio - 1.0).abs() > 1e-5
    {
        let at_mix_sr = if (sr_ratio - 1.0).abs() > 1e-5 {
            resample_interleaved_f32(&pcm, 2, sr_ratio, MAX_RESAMPLE_SAMPLES)?
        } else {
            pcm
        };
        pitch_shift_stereo_preserve_duration(&at_mix_sr, pitch_ratio, MAX_RESAMPLE_SAMPLES)?
    } else {
        let speed_ratio = pitch_ratio * sr_ratio;
        if (speed_ratio - 1.0).abs() > 1e-5 {
            resample_interleaved_f32(&pcm, 2, speed_ratio, MAX_RESAMPLE_SAMPLES)?
        } else {
            pcm
        }
    };
    Ok((processed, bit_depth))
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

    let fade_in_frames = ((clip.fade_in_sec * (sample_rate as f64)).round() as usize)
        .min(clip_frames);
    let fade_out_frames = ((clip.fade_out_sec * (sample_rate as f64)).round() as usize)
        .min(clip_frames);
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

/// Renders a multi-lane `LayerRecipe` into interleaved stereo `f32` PCM plus Master Sum and
/// per-lane waveform peaks in a single bounded-memory pass (only 2 stereo buffers allocated).
pub fn render_layer_mix<F>(
    raw_recipe: &LayerRecipe,
    mut resolve_source_path: F,
) -> Result<RenderedLayerMix, String>
where
    F: FnMut(&str) -> Result<PathBuf, String>,
{
    let recipe = validate_and_normalize_recipe(raw_recipe)?;
    let target_sr = LAYER_MIX_SAMPLE_RATE;

    if recipe.clips.is_empty() {
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
        return Ok(RenderedLayerMix {
            samples: Vec::new(),
            sample_rate: target_sr,
            total_frames: 0,
            duration_sec: 0.0,
            max_source_bit_depth: 24,
            master_peaks: vec![0.0; NUM_PEAK_BINS],
            lane_peaks,
            peak_db: -96.0,
            clipped: false,
        });
    }

    // Resolve and decode each unique clip window once, tracking full timeline span across all lanes
    // so muting/soloing a lane keeps ruler length and playhead position stable.
    let mut prepared_clips: Vec<(usize, &LayerClipSpec, Vec<f32>)> =
        Vec::with_capacity(recipe.clips.len());
    let lane_index_map: HashMap<&str, usize> = recipe
        .lanes
        .iter()
        .enumerate()
        .map(|(i, l)| (l.id.as_str(), i))
        .collect();
    let mut max_end_frames: usize = 0;
    let mut max_source_bit_depth: u32 = 16;

    for clip in &recipe.clips {
        let Some(&lane_idx) = lane_index_map.get(clip.lane_id.as_str()) else {
            continue;
        };
        let resolved = resolve_source_path(&clip.source_path)?;
        let (pcm, bd) = prepare_clip_at_mix_rate(clip, &resolved, target_sr)?;
        max_source_bit_depth = max_source_bit_depth.max(bd);
        let start_f = (clip.start_sec * (target_sr as f64)).round() as usize;
        let end_f = start_f.saturating_add(pcm.len() / 2);
        if end_f > max_end_frames {
            max_end_frames = end_f;
        }
        prepared_clips.push((lane_idx, clip, pcm));
    }

    let max_allowed_frames = (MAX_LAYER_DURATION_SEC * (target_sr as f64)).round() as usize;
    let total_frames = max_end_frames.min(max_allowed_frames);
    if total_frames == 0 {
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
        return Ok(RenderedLayerMix {
            samples: Vec::new(),
            sample_rate: target_sr,
            total_frames: 0,
            duration_sec: 0.0,
            max_source_bit_depth,
            master_peaks: vec![0.0; NUM_PEAK_BINS],
            lane_peaks,
            peak_db: -96.0,
            clipped: false,
        });
    }

    let any_solo = recipe.lanes.iter().any(|l| l.solo);
    let mut master_buf = vec![0.0_f32; total_frames * 2];
    let mut lane_scratch = vec![0.0_f32; total_frames * 2];
    let mut lane_peaks = Vec::with_capacity(recipe.lanes.len());

    for (lane_idx, lane) in recipe.lanes.iter().enumerate() {
        lane_scratch.fill(0.0);
        let audible = if any_solo {
            lane.solo && !lane.muted
        } else {
            !lane.muted
        };
        let lane_gain = db_to_linear(lane.volume_db);
        let mut has_any_clip = false;

        for (c_lane_idx, clip, pcm) in &prepared_clips {
            if *c_lane_idx == lane_idx {
                mix_clip_into_lane(&mut lane_scratch, pcm, clip, target_sr);
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
    use crate::audio::write_wav_i16;

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
        // 0.25s @ 48 kHz mono constant DC (+0.40 and +0.80)
        write_wav_i16(&wav_a, 48_000, 1, &vec![13_107i16; 12_000]).unwrap();
        write_wav_i16(&wav_b, 48_000, 1, &vec![26_214i16; 12_000]).unwrap();

        // 1. Both lanes active -> sum ~1.20 triggers soft limiter & clipped flag
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

        // 2. Solo lane 1 -> only 0.40 audible, not clipped
        let mut solo_recipe = recipe.clone();
        solo_recipe.lanes[0].solo = true;
        let solo_mix = render_layer_mix(&solo_recipe, |p| Ok(PathBuf::from(p))).unwrap();
        assert!(!solo_mix.clipped);
        let solo_l = solo_mix.samples[6000 * 2];
        assert!((solo_l - 0.4).abs() < 0.02, "Expected ~0.40 when soloing lane 1, got {}", solo_l);

        // 3. Mute lane 1 + mute lane 2 -> silent master, timeline span preserved
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
        // Linear ramp from 0.0 to ~0.9 at 48 kHz mono (0.20s = 9600 samples)
        let ramp: Vec<i16> = (0..9600).map(|i| ((i as f32 / 9600.0) * 28_000.0) as i16).collect();
        write_wav_i16(&wav_ramp, 48_000, 1, &ramp).unwrap();

        // Reverse ramp + 20ms fade-in + 20ms fade-out + +12st varispeed pitch (halves duration to 0.10s)
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
        // +12st halves 9600 frames -> ~4800 frames
        assert!((mixed.total_frames as i64 - 4800).abs() <= 4);
        // Fade-in starts at 0.0 and fade-out ends at 0.0
        assert!(mixed.samples[0].abs() < 1e-4, "Fade-in must start at 0");
        assert!(
            mixed.samples[mixed.samples.len() - 2].abs() < 1e-3,
            "Fade-out must end near 0"
        );
        // Reversed ramp should be louder near 25% than near 75%
        let early = mixed.samples[(mixed.total_frames as usize / 4) * 2];
        let late = mixed.samples[((mixed.total_frames as usize * 3) / 4) * 2];
        assert!(early > late, "Reversed ramp should decay (early={}, late={})", early, late);

        // Export 24-bit WAV with Peak -1 dBTP normalization
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
        // 0.25s @ 48 kHz mono 440 Hz sine (12,000 frames)
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
            assert_eq!(
                mixed.total_frames, 12_000,
                "Preserve pitch mode must keep 12,000 frames at {}st",
                st
            );
            assert!(mixed.samples.iter().all(|s| s.is_finite()));
        }

        clear_layer_pcm_cache();
        let _ = fs::remove_dir_all(&root);
    }
}
