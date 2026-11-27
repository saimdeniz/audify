use super::decode::{copy_packet_samples, open_audio_decoder};
use super::layer_recipe::{LayerClipSpec, LayerPitchMode, MAX_LAYER_DURATION_SEC};
use super::pcm_ops::resample_interleaved_f32;
use super::pitch_shift::pitch_shift_stereo_preserve_duration;
use super::transcode::validate_readable_audio_source;
use crate::audio_engine::decoder::push_interleaved_stereo;
use crate::security::normalize_clean_path;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;

const MAX_CACHED_CLIP_FRAMES: usize = 48_000 * 120; // <= 2 min stereo f32 (~46 MiB)
const MAX_LAYER_CACHE_ENTRIES: usize = 32;
const MAX_LAYER_CACHE_BYTES: usize = 128 * 1024 * 1024;
const MAX_PROCESSED_CACHE_ENTRIES: usize = 64;
const MAX_PROCESSED_CACHE_BYTES: usize = 128 * 1024 * 1024;
pub(super) const MAX_PROCESSED_SINGLE_CLIP_BYTES: usize = 32 * 1024 * 1024;
const MAX_RESAMPLE_SAMPLES: usize = (128 * 1024 * 1024) / std::mem::size_of::<f32>();

#[derive(Clone)]
struct CachedClipPcm {
    path_norm: String,
    file_size: u64,
    mtime_ms: u128,
    sample_rate: u32,
    bit_depth: u32,
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

#[derive(Clone, PartialEq, Eq)]
struct ProcessedClipKey {
    path_norm: String,
    file_size: u64,
    mtime_ms: u128,
    trim_start_ms: u64,
    trim_end_ms: u64,
    reversed: bool,
    pitch_mode: LayerPitchMode,
    pitch_millist: i32,
    target_sr: u32,
}

#[derive(Clone)]
struct CachedProcessedClip {
    key: ProcessedClipKey,
    bit_depth: u32,
    samples: Arc<Vec<f32>>,
}

impl CachedProcessedClip {
    fn byte_len(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }
}

#[derive(Default)]
struct ProcessedClipCache {
    entries: VecDeque<CachedProcessedClip>,
    total_bytes: usize,
}

impl ProcessedClipCache {
    fn get(&mut self, key: &ProcessedClipKey) -> Option<(Arc<Vec<f32>>, u32)> {
        let idx = self.entries.iter().position(|e| &e.key == key)?;
        let item = self.entries.remove(idx)?;
        let res = (Arc::clone(&item.samples), item.bit_depth);
        self.entries.push_back(item);
        Some(res)
    }

    fn insert(&mut self, item: CachedProcessedClip) {
        let bytes = item.byte_len();
        if bytes > MAX_PROCESSED_SINGLE_CLIP_BYTES || bytes > MAX_PROCESSED_CACHE_BYTES {
            return;
        }
        if let Some(existing_idx) = self.entries.iter().position(|e| e.key == item.key) {
            if let Some(removed) = self.entries.remove(existing_idx) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.byte_len());
            }
        }
        while self.entries.len() >= MAX_PROCESSED_CACHE_ENTRIES
            || self.total_bytes.saturating_add(bytes) > MAX_PROCESSED_CACHE_BYTES
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
            if self.entries[idx].key.path_norm.eq_ignore_ascii_case(path_norm) {
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

fn processed_clip_cache() -> &'static Mutex<ProcessedClipCache> {
    static CACHE: OnceLock<Mutex<ProcessedClipCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ProcessedClipCache::default()))
}

pub fn clear_layer_pcm_cache() {
    if let Ok(mut guard) = layer_pcm_cache().lock() {
        guard.clear();
    }
    if let Ok(mut guard) = processed_clip_cache().lock() {
        guard.clear();
    }
}

pub fn evict_layer_pcm_cache_path(path_norm: &str) {
    if let Ok(mut guard) = layer_pcm_cache().lock() {
        guard.evict_path(path_norm);
    }
    if let Ok(mut guard) = processed_clip_cache().lock() {
        guard.evict_path(path_norm);
    }
}

#[cfg(test)]
pub(super) fn processed_clip_cache_len() -> usize {
    processed_clip_cache()
        .lock()
        .map(|g| g.entries.len())
        .unwrap_or(0)
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

fn load_clip_stereo_slice_with_meta(
    path: &Path,
    path_norm: &str,
    file_size: u64,
    mtime_ms: u128,
    trim_start_sec: f64,
    trim_end_sec: f64,
) -> Result<(u32, u32, Vec<f32>), String> {
    if let Ok(mut guard) = layer_pcm_cache().lock() {
        if let Some(hit) = guard.get(path_norm, file_size, mtime_ms) {
            return Ok(slice_stereo_pcm(
                &hit.samples,
                hit.sample_rate,
                hit.bit_depth,
                trim_start_sec,
                trim_end_sec,
            ));
        }
    }

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
                    path_norm: path_norm.to_string(),
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

    let max_window_frames =
        ((MAX_LAYER_DURATION_SEC * 192_000.0) as usize).min(MAX_RESAMPLE_SAMPLES / 2);
    let end_opt = if trim_end_sec > trim_start_sec {
        Some(trim_end_sec)
    } else {
        Some(trim_start_sec + MAX_LAYER_DURATION_SEC)
    };
    decode_stereo_window(path, trim_start_sec, end_opt, max_window_frames)
}

/// Decodes, trims, reverses, resamples, and pitch-shifts a single clip at `target_sr`,
/// backed by a bounded 128 MiB processed-clip LRU cache so moving/muting/soloing clips
/// avoids re-running the STFT Phase Vocoder on untouched clips.
pub(super) fn prepare_clip_at_mix_rate_cached(
    clip: &LayerClipSpec,
    resolved_path: &Path,
    target_sr: u32,
) -> Result<(Arc<Vec<f32>>, u32), String> {
    validate_readable_audio_source(resolved_path)?;
    let meta = fs::symlink_metadata(resolved_path)
        .map_err(|_| "Source audio file is unavailable".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("Source audio file is invalid".to_string());
    }
    let file_size = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path_norm = normalize_clean_path(&resolved_path.to_string_lossy()).to_lowercase();

    let key = ProcessedClipKey {
        path_norm: path_norm.clone(),
        file_size,
        mtime_ms,
        trim_start_ms: (clip.trim_start_sec.max(0.0) * 1000.0).round() as u64,
        trim_end_ms: (clip.trim_end_sec.max(0.0) * 1000.0).round() as u64,
        reversed: clip.reversed,
        pitch_mode: clip.pitch_mode,
        pitch_millist: (clip.pitch_semitones * 1000.0).round() as i32,
        target_sr,
    };

    if let Ok(mut guard) = processed_clip_cache().lock() {
        if let Some(hit) = guard.get(&key) {
            return Ok(hit);
        }
    }

    let (src_sr, bit_depth, mut pcm) = load_clip_stereo_slice_with_meta(
        resolved_path,
        &path_norm,
        file_size,
        mtime_ms,
        clip.trim_start_sec,
        clip.trim_end_sec,
    )?;
    if pcm.is_empty() {
        return Ok((Arc::new(pcm), bit_depth));
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
    let processed =
        if clip.pitch_mode == LayerPitchMode::Preserve && (pitch_ratio - 1.0).abs() > 1e-5 {
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

    let shared = Arc::new(processed);
    if shared.len() * std::mem::size_of::<f32>() <= MAX_PROCESSED_SINGLE_CLIP_BYTES {
        if let Ok(mut guard) = processed_clip_cache().lock() {
            guard.insert(CachedProcessedClip {
                key,
                bit_depth,
                samples: Arc::clone(&shared),
            });
        }
    }
    Ok((shared, bit_depth))
}
