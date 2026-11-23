use crate::audio::open_audio_decoder;
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path};
use std::fs;
use std::path::Path;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;

pub const AI_TARGET_SAMPLE_RATE: u32 = 16_000;
const AI_MAX_ANALYSIS_SECONDS: f64 = 8.0;
const AI_DECODE_WINDOW_SECONDS: f64 = 12.0;
const SILENCE_THRESHOLD: f32 = 0.0015;
const MIN_SIGNAL_RMS: f32 = 1e-5;

/// Linear interpolation resample from arbitrary `in_sr` to exact 16,000 Hz mono PCM `[-1.0, 1.0]`.
pub fn resample_mono_to_16k(mono: &[f32], in_sr: u32, max_samples: usize) -> Vec<f32> {
    if mono.is_empty() || in_sr == 0 || max_samples == 0 {
        return Vec::new();
    }
    if in_sr == AI_TARGET_SAMPLE_RATE {
        let len = mono.len().min(max_samples);
        return mono[..len].iter().map(|&v| v.clamp(-1.0, 1.0)).collect();
    }

    let ratio = (in_sr as f64) / (AI_TARGET_SAMPLE_RATE as f64);
    let est_out = ((mono.len() as f64) / ratio).floor().max(1.0) as usize;
    let out_len = est_out.min(max_samples);
    let mut out = Vec::with_capacity(out_len);
    let last_idx = (mono.len() - 1) as isize;
    let use_aa_sinc = ratio > 1.05;
    let aa_cutoff = (0.92 / ratio).min(1.0);
    let aa_radius = if use_aa_sinc {
        ((2.0 * ratio).ceil() as isize).clamp(3, 12)
    } else {
        0
    };

    for i in 0..out_len {
        let src_pos = (i as f64) * ratio;
        let idx = src_pos.floor() as isize;
        let sample = if use_aa_sinc {
            // Hann-windowed sinc low-pass filter prevents HF cymbal/transient aliasing into 16 kHz YAMNet band
            let r_f64 = aa_radius as f64;
            let mut acc = 0.0_f64;
            let mut w_sum = 0.0_f64;
            for k in -aa_radius..=aa_radius {
                let s_idx = (idx + k).clamp(0, last_idx) as usize;
                let dx = (idx + k) as f64 - src_pos;
                if dx.abs() >= r_f64 {
                    continue;
                }
                let x = std::f64::consts::PI * dx * aa_cutoff;
                let sinc = if x.abs() < 1e-9 { 1.0 } else { x.sin() / x };
                let win = 0.5 * (1.0 + (std::f64::consts::PI * dx / r_f64).cos());
                let w = sinc * win;
                w_sum += w;
                acc += (mono[s_idx] as f64) * w;
            }
            if w_sum.abs() > 1e-9 {
                (acc / w_sum) as f32
            } else {
                mono[idx.clamp(0, last_idx) as usize]
            }
        } else {
            let idx_u = idx.clamp(0, last_idx) as usize;
            let frac = (src_pos - (idx as f64)) as f32;
            let a = mono[idx_u];
            let b = mono[(idx_u + 1).min(last_idx as usize)];
            a + (b - a) * frac
        };
        out.push(if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        });
    }
    out
}

/// Selects an active `max_samples` window by skipping leading and trailing digital silence when
/// possible, ensuring delayed-onset and tail-heavy recordings expose maximal active acoustic content.
pub fn select_active_window(samples_16k: &[f32], max_samples: usize) -> Vec<f32> {
    if samples_16k.is_empty() || max_samples == 0 {
        return Vec::new();
    }
    let first_active = samples_16k
        .iter()
        .position(|&s| s.abs() >= SILENCE_THRESHOLD)
        .unwrap_or(0);
    // Keep a short 32 ms pre-roll before transient onset if available
    let pre_roll = (AI_TARGET_SAMPLE_RATE as usize) / 32;
    let start = first_active.saturating_sub(pre_roll);
    let remaining = samples_16k.len().saturating_sub(start);
    let use_full_start =
        remaining < (AI_TARGET_SAMPLE_RATE as usize / 4) && samples_16k.len() > remaining;
    let slice_start = if use_full_start { 0 } else { start };
    let take_len = if use_full_start {
        samples_16k.len().min(max_samples)
    } else {
        remaining.min(max_samples)
    };
    let raw_slice = &samples_16k[slice_start..slice_start + take_len];

    // Trim trailing digital silence while retaining a 64 ms tail decay margin
    let post_roll = ((AI_TARGET_SAMPLE_RATE as usize) * 64) / 1000;
    let trimmed_len = match raw_slice
        .iter()
        .rposition(|&s| s.abs() >= SILENCE_THRESHOLD)
    {
        Some(last_active) => (last_active + 1 + post_roll).min(raw_slice.len()),
        None => raw_slice.len(),
    };
    raw_slice[..trimmed_len].to_vec()
}

pub fn has_usable_audio_energy(samples: &[f32]) -> bool {
    if samples.is_empty() {
        return false;
    }
    let sum_sq: f64 = samples.iter().map(|&v| (v as f64) * (v as f64)).sum();
    let rms = (sum_sq / (samples.len() as f64)).sqrt() as f32;
    rms >= MIN_SIGNAL_RMS
}

/// Decodes up to `AI_DECODE_WINDOW_SECONDS` of mono PCM from `path`, then resamples to an active
/// `16,000 Hz` window (up to `AI_MAX_ANALYSIS_SECONDS`) ready for YAMNet inference.
pub fn decode_waveform_for_ai(path: &Path) -> Result<Vec<f32>, String> {
    let path_str = path.to_string_lossy();
    if is_unc_or_network_path(&path_str) || has_ntfs_ads_colon(&path_str) {
        return Err("Unsafe or network audio path rejected".to_string());
    }
    let sym_meta = fs::symlink_metadata(path)
        .map_err(|_| "Audio file missing or inaccessible".to_string())?;
    if sym_meta.file_type().is_symlink() || !sym_meta.is_file() {
        return Err("Symlink or non-file audio target rejected".to_string());
    }

    let opened = open_audio_decoder(path)?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut orig_sr = opened.sample_rate;

    let mut slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;
    let mut mono: Vec<f32> = Vec::with_capacity(48_000 * 8);

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(_)) | Err(SymphoniaError::ResetRequired) => break,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else {
            continue;
        };
        let frames = decoded.frames();
        if frames == 0 {
            continue;
        }
        let spec = *decoded.spec();
        if spec.channels.is_empty() || spec.rate == 0 {
            continue;
        }
        if orig_sr == 0 {
            orig_sr = spec.rate;
        }

        let ch = spec.channels.count();
        let req = frames.saturating_mul(ch);
        let need_realloc = match &slot {
            Some((ps, af, buf)) => *ps != spec || frames > *af || req > buf.capacity(),
            None => true,
        };
        if need_realloc {
            let af = frames.max(4096);
            slot = Some((spec, af, SampleBuffer::<f32>::new(af as u64, spec)));
        }
        let Some((_, _, ref mut buf)) = slot else {
            continue;
        };
        buf.copy_interleaved_ref(decoded);
        let samples = buf.samples();

        let max_decode_frames = (AI_DECODE_WINDOW_SECONDS * (orig_sr as f64)).ceil() as usize;
        for f in 0..frames {
            if mono.len() >= max_decode_frames {
                break;
            }
            let base = f * ch;
            let mut sum = 0.0_f32;
            for c in 0..ch {
                let v = samples[base + c];
                if v.is_finite() {
                    sum += v.clamp(-2.0, 2.0);
                }
            }
            mono.push(sum / (ch as f32));
        }

        if mono.len() >= max_decode_frames {
            break;
        }
    }

    if orig_sr == 0 || mono.is_empty() {
        return Err("Decoded audio stream is empty".to_string());
    }

    let max_decode_16k = (AI_DECODE_WINDOW_SECONDS * (AI_TARGET_SAMPLE_RATE as f64)).ceil() as usize;
    let resampled = resample_mono_to_16k(&mono, orig_sr, max_decode_16k);
    let max_ai_samples = (AI_MAX_ANALYSIS_SECONDS * (AI_TARGET_SAMPLE_RATE as f64)).ceil() as usize;
    let window = select_active_window(&resampled, max_ai_samples);

    if !has_usable_audio_energy(&window) {
        return Err("Audio signal is silent or below energy threshold".to_string());
    }
    Ok(window)
}
