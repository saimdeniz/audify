use super::NUM_PEAK_BINS;
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path};
use lofty::file::AudioFile;
use lofty::probe::Probe;
use std::fs::{self, File};
use std::path::Path;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{
    Decoder, DecoderOptions, CODEC_TYPE_NULL, CODEC_TYPE_PCM_F32BE, CODEC_TYPE_PCM_F32LE,
    CODEC_TYPE_PCM_F64BE, CODEC_TYPE_PCM_F64LE, CODEC_TYPE_PCM_S24BE, CODEC_TYPE_PCM_S24LE,
    CODEC_TYPE_PCM_S32BE, CODEC_TYPE_PCM_S32LE,
};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Opened Symphonia demuxer + codec decoder positioned at the first decodable audio track.
pub(crate) struct OpenedAudioDecoder {
    pub(crate) format: Box<dyn FormatReader>,
    pub(crate) decoder: Box<dyn Decoder>,
    pub(crate) track_id: u32,
    pub(crate) sample_rate: u32,
    pub(crate) channels: usize,
    pub(crate) bit_depth: u32,
    pub(crate) n_frames: Option<u64>,
}

/// Validates path safety, probes container metadata, selects the primary audio track, and
/// initializes the Symphonia decoder in one shared place.
pub(crate) fn open_audio_decoder(path: &Path) -> Result<OpenedAudioDecoder, String> {
    let raw = path.to_string_lossy();
    if is_unc_or_network_path(&raw) || has_ntfs_ads_colon(&raw) {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    let meta = fs::symlink_metadata(path).map_err(|_| "Audio file is unavailable".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    let file = File::open(path).map_err(|e| format!("Failed opening audio file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| "Unsupported or corrupted audio container".to_string())?;

    let format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No supported audio track found".to_string())?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .filter(|&c| c > 0)
        .unwrap_or(0);
    let bit_depth = track
        .codec_params
        .bits_per_sample
        .or(track.codec_params.bits_per_coded_sample)
        .or(match track.codec_params.codec {
            CODEC_TYPE_PCM_S24LE | CODEC_TYPE_PCM_S24BE => Some(24),
            CODEC_TYPE_PCM_S32LE
            | CODEC_TYPE_PCM_S32BE
            | CODEC_TYPE_PCM_F32LE
            | CODEC_TYPE_PCM_F32BE => Some(32),
            CODEC_TYPE_PCM_F64LE | CODEC_TYPE_PCM_F64BE => Some(64),
            _ => None,
        })
        .unwrap_or(16);
    let n_frames = track.codec_params.n_frames;

    let decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| "Unsupported audio codec".to_string())?;

    Ok(OpenedAudioDecoder {
        format,
        decoder,
        track_id,
        sample_rate,
        channels,
        bit_depth,
        n_frames,
    })
}

/// Raw decode result shared by the 600-bin scan peaks and the on-demand hi-res peaks.
struct DecodedBlocks {
    /// ~512-frame blocks as (peak, rms)
    blocks: Vec<(f32, f32)>,
    sample_rate: i64,
    channels: i64,
    bit_depth: i64,
    total_frames: u64,
    n_frames_hint: Option<u64>,
}

pub(crate) fn copy_packet_samples<'a>(
    slot: &'a mut Option<(SignalSpec, usize, SampleBuffer<f32>)>,
    decoded: symphonia::core::audio::AudioBufferRef<'_>,
) -> Option<(SignalSpec, usize, &'a [f32])> {
    let frames = decoded.frames();
    if frames == 0 {
        return None;
    }
    let spec = *decoded.spec();
    if spec.channels.is_empty() || spec.rate == 0 {
        return None;
    }
    let ch_count = spec.channels.count();
    let required_samples = frames.checked_mul(ch_count)?;

    let need_realloc = match slot {
        Some((prev_spec, alloc_frames, buf)) => {
            *prev_spec != spec || frames > *alloc_frames || required_samples > buf.capacity()
        }
        None => true,
    };

    if need_realloc {
        let alloc_frames = frames.max(4096);
        let new_buf = SampleBuffer::<f32>::new(alloc_frames as u64, spec);
        *slot = Some((spec, alloc_frames, new_buf));
    }

    let (_, _, buf) = slot.as_mut()?;
    buf.copy_interleaved_ref(decoded);
    Some((spec, frames, buf.samples()))
}

fn decode_audio_blocks(path: &Path) -> Option<DecodedBlocks> {
    let opened = open_audio_decoder(path).ok()?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut sample_rate = opened.sample_rate as i64;
    let mut channels = opened.channels as i64;
    let bit_depth = opened.bit_depth as i64;
    let n_frames_hint = opened.n_frames;

    let mut block_peaks: Vec<(f32, f32)> = Vec::with_capacity(2048);
    let mut total_frames: u64 = 0;
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(_)) | Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => continue,
        };
        {
            let Some((spec, frames, samples)) = copy_packet_samples(&mut sample_buf_slot, decoded)
            else {
                continue;
            };

            let ch_count = spec.channels.count();
            if sample_rate <= 0 {
                sample_rate = spec.rate as i64;
            }
            if channels <= 0 {
                channels = ch_count as i64;
            }
            total_frames += frames as u64;

            let chunk_frames = 512;
            let chunk_samples = (chunk_frames * ch_count).max(1);
            for chunk in samples.chunks(chunk_samples) {
                let mut max_abs: f32 = 0.0;
                let mut sum_sq: f32 = 0.0;
                for &raw_s in chunk {
                    if !raw_s.is_finite() {
                        continue;
                    }
                    // Clamp extreme float values so `s * s` can never overflow f32 into +Inf
                    let s = raw_s.clamp(-8.0, 8.0);
                    let a = s.abs();
                    if a > max_abs {
                        max_abs = a;
                    }
                    sum_sq += s * s;
                }
                let rms_raw = (sum_sq / (chunk.len() as f32)).sqrt();
                let rms = if rms_raw.is_finite() { rms_raw } else { 0.0 };
                let peak = if max_abs.is_finite() { max_abs } else { 0.0 };
                block_peaks.push((peak, rms));
            }
        }
    }

    Some(DecodedBlocks {
        blocks: block_peaks,
        sample_rate,
        channels,
        bit_depth,
        total_frames,
        n_frames_hint,
    })
}

pub fn decode_audio_and_peaks(path: &Path) -> Option<(i64, i64, i64, i64, String)> {
    let decoded = decode_audio_blocks(path)?;
    if decoded.blocks.is_empty() {
        let (lofty_dur, lofty_sr, lofty_ch, lofty_bd) = fallback_lofty_props(path);
        let sr = if lofty_sr > 0 {
            lofty_sr
        } else if decoded.sample_rate > 0 {
            decoded.sample_rate
        } else {
            44100
        };
        let ch = if lofty_ch > 0 {
            lofty_ch
        } else if decoded.channels > 0 {
            decoded.channels
        } else {
            2
        };
        let bd = if lofty_bd > 0 {
            lofty_bd
        } else if decoded.bit_depth > 0 {
            decoded.bit_depth
        } else {
            16
        };
        let dur = if lofty_dur > 0 {
            lofty_dur
        } else if sr > 0 {
            ((decoded.n_frames_hint.unwrap_or(0) as f64 * 1000.0) / sr as f64).round() as i64
        } else {
            0
        };
        return Some((dur, sr, ch, bd, "[]".to_string()));
    }

    let sample_rate = if decoded.sample_rate > 0 {
        decoded.sample_rate
    } else {
        44100
    };
    let channels = if decoded.channels > 0 {
        decoded.channels
    } else {
        2
    };
    let final_frames = if decoded.total_frames > 0 {
        decoded.total_frames
    } else {
        decoded.n_frames_hint.unwrap_or(0)
    };
    let duration_ms = ((final_frames as f64 * 1000.0) / sample_rate as f64).round() as i64;

    let peaks = compute_bins_from_blocks(&decoded.blocks, NUM_PEAK_BINS);
    let peaks_json = serde_json::to_string(&peaks).unwrap_or_else(|_| "[]".to_string());

    Some((duration_ms, sample_rate, channels, decoded.bit_depth, peaks_json))
}

fn summarize_hybrid_bins(
    blocks: &[(f32, f32)],
    num_bins: usize,
    peak_weight: f32,
    rms_weight: f32,
) -> (Vec<f32>, f32) {
    let len = blocks.len();
    let mut raw = Vec::with_capacity(num_bins);
    for i in 0..num_bins {
        let start = ((i * len) / num_bins).min(len - 1);
        let end = (((i + 1) * len) / num_bins).clamp(start + 1, len);
        let slice = &blocks[start..end];
        let mut max_peak: f32 = 0.0;
        let mut rms_sum: f32 = 0.0;
        for &(p, r) in slice {
            let p_clean = if p.is_finite() { p } else { 0.0 };
            let r_clean = if r.is_finite() { r } else { 0.0 };
            if p_clean > max_peak {
                max_peak = p_clean;
            }
            rms_sum += r_clean;
        }
        let avg_rms = rms_sum / (slice.len() as f32);
        let blended = peak_weight * max_peak + rms_weight * avg_rms;
        raw.push(if blended.is_finite() { blended } else { 0.0 });
    }
    let global_max = raw
        .iter()
        .copied()
        .filter(|v| v.is_finite())
        .fold(0.0_f32, f32::max)
        .max(0.001);
    (raw, global_max)
}

/// High-resolution transient envelope for the transport deck waveform.
pub fn compute_hires_peaks(path: &Path, target_bins: Option<usize>) -> Option<Vec<u8>> {
    let decoded = decode_audio_blocks(path)?;
    if decoded.blocks.is_empty() || decoded.sample_rate <= 0 {
        return None;
    }
    let frames = if decoded.total_frames > 0 {
        decoded.total_frames
    } else {
        decoded.n_frames_hint.unwrap_or(0)
    };
    let duration_sec = frames as f64 / decoded.sample_rate as f64;
    let bins = target_bins
        .unwrap_or_else(|| (duration_sec * 30.0).round() as usize)
        .clamp(1200, 6000);

    let (raw, global_max) = summarize_hybrid_bins(&decoded.blocks, bins, 0.8, 0.2);
    Some(
        raw.into_iter()
            .map(|v| {
                if v.is_finite() {
                    ((v / global_max).clamp(0.0, 1.0) * 255.0).round() as u8
                } else {
                    0
                }
            })
            .collect(),
    )
}

pub fn compute_bins_from_blocks(blocks: &[(f32, f32)], num_bins: usize) -> Vec<f32> {
    if blocks.is_empty() || num_bins == 0 {
        return Vec::new();
    }

    let (raw_bins, global_max) = summarize_hybrid_bins(blocks, num_bins, 0.65, 0.35);
    raw_bins
        .into_iter()
        .map(|v| {
            if !v.is_finite() {
                0.0
            } else {
                let norm = (v / global_max).clamp(0.0, 1.0);
                (norm * 1000.0).round() / 1000.0
            }
        })
        .collect()
}

pub fn fallback_lofty_props(path: &Path) -> (i64, i64, i64, i64) {
    let raw = path.to_string_lossy();
    if is_unc_or_network_path(&raw)
        || has_ntfs_ads_colon(&raw)
        || fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink() || !m.is_file())
            .unwrap_or(true)
    {
        return (0, 44100, 2, 16);
    }
    if let Ok(probed) = Probe::open(path) {
        if let Ok(tagged) = probed.read() {
            let props = tagged.properties();
            let duration_ms = props.duration().as_millis() as i64;
            let sample_rate = props.sample_rate().filter(|&r| r > 0).unwrap_or(44100) as i64;
            let channels = props.channels().filter(|&c| c > 0).unwrap_or(2) as i64;
            let bit_depth = props.bit_depth().filter(|&b| b > 0).unwrap_or(16) as i64;
            return (duration_ms, sample_rate, channels, bit_depth);
        }
    }
    (0, 44100, 2, 16)
}

/// Computes a safe non-destructive preview loudness gain multiplier in `[0.20 .. 1.0]`
/// targeting `-14 dBFS` active RMS (`0.1995`) without boosting quiet room tones above `1.0`
/// and without routing `<audio>` through WebAudio (`setSinkId` remains 100% intact).
pub fn compute_preview_norm_gain(path: &Path) -> Option<f32> {
    if !path.exists() {
        return None;
    }
    let opened = open_audio_decoder(path).ok()?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut sr = opened.sample_rate;

    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;
    let mut decoded_frames: u64 = 0;
    let mut active_rms_sq_sum: f64 = 0.0;
    let mut active_blocks: usize = 0;
    let mut global_peak: f32 = 0.0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(_)) | Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => continue,
        };
        {
            let Some((spec, frames, samples)) = copy_packet_samples(&mut sample_buf_slot, decoded)
            else {
                continue;
            };
            if sr == 0 {
                sr = spec.rate;
            }
            let ch = spec.channels.count().max(1);
            for chunk in samples.chunks(1024 * ch) {
                let mut sum_sq = 0.0_f64;
                for &raw_s in chunk {
                    if !raw_s.is_finite() {
                        continue;
                    }
                    let s = raw_s.clamp(-2.0, 2.0);
                    let a = s.abs();
                    if a > global_peak {
                        global_peak = a;
                    }
                    sum_sq += (s as f64) * (s as f64);
                }
                let rms = (sum_sq / (chunk.len().max(1) as f64)).sqrt();
                // Gate out near-silence (`< -52 dBFS`) so sparse impacts measure impact loudness
                if rms > 0.0025 {
                    active_rms_sq_sum += rms * rms;
                    active_blocks += 1;
                }
            }
            decoded_frames += frames as u64;
            if sr > 0 && decoded_frames >= (sr as u64) * 12 {
                break;
            }
        }
    }

    if active_blocks == 0 {
        return Some(1.0);
    }
    let active_rms = (active_rms_sq_sum / (active_blocks as f64)).sqrt() as f32;
    if !active_rms.is_finite() || active_rms <= 0.001 {
        return Some(1.0);
    }

    let target_rms: f32 = 0.199_526; // -14.0 dBFS
    let desired = target_rms / active_rms;
    let peak_safe = if global_peak > 0.98 {
        0.95 / global_peak
    } else {
        1.0
    };
    Some(desired.min(peak_safe).clamp(0.20, 1.0))
}