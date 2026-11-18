//! Pure-Rust zero-dependency audio DSP engine for Audify (Faz C):
//! - Iterative radix-2 Cooley-Tukey FFT (`fft_radix2`)
//! - Fast embedded tag (`TBPM` / `TKEY`) & filename BPM + Musical Key / Camelot parser
//! - Spectral-flux onset envelope + perceptual autocorrelation BPM estimator (`60..200 BPM`)
//! - `4096`-sample STFT 12-bin A440 chromagram + Wiener spectral flatness noise gate
//!   + Krumhansl-Kessler 24-profile Pearson correlation -> Musical Key & Camelot (`1A..12B`)

mod fft_estimators;
mod filename_parser;

pub use fft_estimators::{estimate_bpm_from_mono, estimate_key_from_mono, fft_radix2};
pub use filename_parser::{
    detect_bpm_from_filename, detect_key_from_filename, extract_fast_bpm_and_key,
    normalize_musical_or_camelot_key, parse_bpm_value, BpmKeyResult,
};

use crate::audio::open_audio_decoder;
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path};
use std::fs;
use std::path::Path;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;


/// Decodes up to `max_seconds` of mono audio (downsampled to `~22050 Hz` via integer stride)
/// for fast background BPM & Musical Key DSP analysis.
fn decode_mono_for_dsp(path: &Path, max_seconds: f64) -> Option<(Vec<f32>, u32, i64)> {
    let raw_str = path.to_string_lossy();
    if is_unc_or_network_path(&raw_str) || has_ntfs_ads_colon(&raw_str) {
        return None;
    }
    let sym = fs::symlink_metadata(path).ok()?;
    if sym.file_type().is_symlink() || !sym.is_file() {
        return None;
    }
    let opened = open_audio_decoder(path).ok()?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut orig_sr = opened.sample_rate;
    let n_frames_hint = opened.n_frames;

    let mut slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;
    let mut mono: Vec<f32> = Vec::with_capacity(22050 * 30);
    let mut total_orig_frames: u64 = 0;
    let mut out_sr: u32 = 22050;
    let mut stride_phase: usize = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(_)) | Err(SymphoniaError::ResetRequired) => break,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        if let Ok(decoded) = decoder.decode(&packet) {
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
            let stride = ((orig_sr as usize) / 22050).max(1);
            out_sr = (orig_sr / (stride as u32)).max(1);

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

            let max_out_samples = (max_seconds * (out_sr as f64)).ceil() as usize;
            for f in 0..frames {
                if stride_phase == 0 && mono.len() < max_out_samples {
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
                stride_phase += 1;
                if stride_phase >= stride {
                    stride_phase = 0;
                }
            }

            total_orig_frames += frames as u64;
            if mono.len() >= max_out_samples {
                break;
            }
        }
    }

    if orig_sr == 0 || mono.is_empty() {
        return None;
    }
    let full_frames = n_frames_hint.unwrap_or(total_orig_frames).max(total_orig_frames);
    let duration_ms = ((full_frames as f64 * 1000.0) / (orig_sr as f64)).round() as i64;
    Some((mono, out_sr, duration_ms))
}

/// Full hybrid analyzer: checks embedded tags & filename tokens first, then runs pure-Rust DSP
/// for any still-missing BPM (when `duration_ms >= 1500`) or Musical Key / Camelot.
pub fn analyze_file_bpm_and_key(path: &Path, file_name: &str, known_duration_ms: i64) -> BpmKeyResult {
    let mut res = extract_fast_bpm_and_key(Some(path), file_name);
    let need_bpm = res.bpm.is_none() && (known_duration_ms <= 0 || known_duration_ms >= 1500);
    let need_key = res.musical_key.is_empty();

    if !need_bpm && !need_key {
        return res;
    }

    let Some((mono, sr, decoded_dur_ms)) = decode_mono_for_dsp(path, 40.0) else {
        return res;
    };
    let effective_dur = if known_duration_ms > 0 {
        known_duration_ms
    } else {
        decoded_dur_ms
    };

    if res.bpm.is_none() && effective_dur >= 1500 {
        res.bpm = estimate_bpm_from_mono(&mono, sr);
    }
    if res.musical_key.is_empty() {
        if let Some((mkey, cam)) = estimate_key_from_mono(&mono, sr) {
            res.musical_key = mkey;
            res.camelot_key = cam;
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn test_camelot_and_key_normalization() {
        assert_eq!(
            normalize_musical_or_camelot_key("Am"),
            Some(("Am".to_string(), "8A".to_string()))
        );
        assert_eq!(
            normalize_musical_or_camelot_key("C major"),
            Some(("C".to_string(), "8B".to_string()))
        );
        assert_eq!(
            normalize_musical_or_camelot_key("F#m"),
            Some(("F#m".to_string(), "11A".to_string()))
        );
        assert_eq!(
            normalize_musical_or_camelot_key("8A"),
            Some(("Am".to_string(), "8A".to_string()))
        );
        assert_eq!(
            normalize_musical_or_camelot_key("3b"),
            Some(("Db".to_string(), "3B".to_string()))
        );
    }

    #[test]
    fn test_filename_sfx_take_suffix_safety() {
        // SFX take suffixes MUST NOT be misclassified as Camelot keys!
        let r1 = extract_fast_bpm_and_key(None, "Footstep_Concrete_01a.wav");
        assert_eq!(r1.bpm, None);
        assert_eq!(r1.musical_key, "");

        let r2 = extract_fast_bpm_and_key(None, "Radio_AM_Static_Noise.wav");
        assert_eq!(r2.musical_key, "");

        // Loop with BPM + key token IS recognized!
        let r3 = extract_fast_bpm_and_key(None, "Cyber_Bass_Loop_128bpm_Am.wav");
        assert_eq!(r3.bpm, Some(128.0));
        assert_eq!(r3.musical_key, "Am");
        assert_eq!(r3.camelot_key, "8A");

        let r4 = extract_fast_bpm_and_key(None, "Pad_Atmosphere_F#m.wav");
        assert_eq!(r4.musical_key, "F#m");
        assert_eq!(r4.camelot_key, "11A");
    }

    #[test]
    fn test_pure_rust_bpm_and_key_dsp() {
        let sr = 22050u32;
        let secs = 6usize;
        let len = (sr as usize) * secs;

        // 1. Synthetic 120 BPM rhythmic click/pluck train (beat every 0.5s)
        let mut pulse_signal = vec![0.0_f32; len];
        let beat_samples = (sr as usize) / 2; // 0.5s = 120 BPM
        for beat in 0..(secs * 2) {
            let start = beat * beat_samples;
            for i in 0..2000.min(len.saturating_sub(start)) {
                let env = (-(i as f32) / 350.0).exp();
                let t = (start + i) as f32 / (sr as f32);
                pulse_signal[start + i] += 0.8 * env * (2.0 * PI * 220.0 * t).sin();
            }
        }
        let detected_bpm = estimate_bpm_from_mono(&pulse_signal, sr).expect("should detect 120 BPM");
        assert!(
            (detected_bpm - 120.0).abs() <= 1.5,
            "Expected ~120 BPM, got {}",
            detected_bpm
        );

        // 2. Synthetic A Minor triad + scale tones (A3=220, C4=261.63, E4=329.63, D4=293.66, G4=392.0)
        let mut a_minor_signal = vec![0.0_f32; len];
        for (i, sample) in a_minor_signal.iter_mut().enumerate() {
            let t = i as f32 / (sr as f32);
            *sample = 0.45 * (2.0 * PI * 220.0 * t).sin()
                + 0.32 * (2.0 * PI * 261.6256 * t).sin()
                + 0.30 * (2.0 * PI * 329.6276 * t).sin()
                + 0.12 * (2.0 * PI * 293.6648 * t).sin()
                + 0.10 * (2.0 * PI * 391.9954 * t).sin();
        }
        let (mkey, cam) = estimate_key_from_mono(&a_minor_signal, sr).expect("should detect Am");
        assert_eq!(mkey, "Am");
        assert_eq!(cam, "8A");

        // 3. Deterministic pseudo-white-noise (atonal impact/hiss) MUST be rejected by flatness gate!
        let mut lcg: u32 = 0x1234_5678;
        let mut noise = vec![0.0_f32; len];
        for sample in &mut noise {
            lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
            let u = ((lcg >> 8) as f32) / ((1u32 << 24) as f32);
            *sample = (u * 2.0 - 1.0) * 0.5;
        }
        assert_eq!(estimate_key_from_mono(&noise, sr), None);
        assert_eq!(estimate_bpm_from_mono(&noise, sr), None);
    }
}
