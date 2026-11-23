use super::decode::{copy_packet_samples, open_audio_decoder};
use super::pcm_ops::{
    apply_anti_click_micro_fade_f32, push_frame_downmixed, push_frame_downmixed_f32,
    resample_interleaved_f32, write_wav_i16, write_wav_pcm_f32,
};
use super::{file_identity_hash8, fnv1a_hash64};
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path, sanitize_err,
};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;

const MAX_SLICE_DURATION_SEC: f64 = 600.0;
const MAX_PCM_BUFFER_SAMPLES: usize = (256 * 1024 * 1024) / std::mem::size_of::<i16>();
const MAX_PCM_F32_SAMPLES: usize = (256 * 1024 * 1024) / std::mem::size_of::<f32>();
static TRANSCODE_TMP_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportAudioPreset {
    Original,
    Wav24,
    Nle48k24,
}

impl ExportAudioPreset {
    pub fn from_opt_str(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some("wav_24") => Self::Wav24,
            Some("nle_48k_24") => Self::Nle48k24,
            _ => Self::Original,
        }
    }

    pub fn filename_suffix(self) -> &'static str {
        match self {
            Self::Original => "",
            Self::Wav24 => "_24b",
            Self::Nle48k24 => "_48k24b",
        }
    }
}

#[cfg(test)]
pub fn export_wav_slice(
    source_path: &Path,
    slices_dir: &Path,
    start_sec: f64,
    end_sec: f64,
) -> Result<String, String> {
    export_wav_slice_with_options(source_path, slices_dir, start_sec, end_sec, None, None)
}

pub fn build_default_slice_file_name_with_preset(
    source_path: &Path,
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    export_preset: Option<&str>,
) -> String {
    let semitones = pitch_semitones.unwrap_or(0.0).clamp(-24.0, 24.0);
    let micro_fade = apply_micro_fade.unwrap_or(false);
    let preset = ExportAudioPreset::from_opt_str(export_preset);
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sample");
    let safe_stem: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let hash8 = file_identity_hash8(source_path);
    let pitch_suffix = if semitones.is_finite() && semitones.abs() >= 0.01 {
        format!("_st{:+.1}", semitones).replace('.', "p")
    } else {
        String::new()
    };
    let fade_suffix = if micro_fade { "_mf3ms" } else { "" };
    let preset_suffix = preset.filename_suffix();
    format!(
        "{}_{}_slice_{:.3}s_{:.3}s{}{}{}.wav",
        safe_stem, hash8, start_sec, end_sec, pitch_suffix, fade_suffix, preset_suffix
    )
}

fn validate_readable_audio_source(source_path: &Path) -> Result<(), String> {
    let raw = source_path.to_string_lossy();
    if is_unc_or_network_path(&raw) || has_ntfs_ads_colon(&raw) {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    let meta = fs::symlink_metadata(source_path).map_err(|_| {
        format!(
            "Source audio file not found: {}",
            display_leaf(source_path)
        )
    })?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("Symbolic links and invalid audio source files are not allowed".to_string());
    }
    Ok(())
}

fn finalize_atomic_tmp_file(
    tmp_path: &Path,
    out_path: &Path,
    parent_dir: &Path,
    skip_if_existing_valid: bool,
) -> Result<(), String> {
    if let Err(rename_err) = fs::rename(tmp_path, out_path) {
        if skip_if_existing_valid
            && fs::metadata(out_path)
                .map(|m| m.len() > 44)
                .unwrap_or(false)
        {
            let _ = fs::remove_file(tmp_path);
            return Ok(());
        }
        let _ = fs::remove_file(out_path);
        if let Err(retry_err) = fs::rename(tmp_path, out_path) {
            let _ = fs::remove_file(tmp_path);
            return Err(sanitize_err(
                parent_dir,
                &format!("{}; {}", rename_err, retry_err),
            ));
        }
    }
    Ok(())
}

fn make_atomic_tmp_path(out_path: &Path, parent_dir: &Path) -> std::path::PathBuf {
    let leaf = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("audio.wav");
    let tmp_name = format!(
        ".__audify_{}.tmp.{}.{}.wav",
        leaf,
        std::process::id(),
        TRANSCODE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    parent_dir.join(tmp_name)
}

fn write_wav_i16_atomic(
    out_path: &Path,
    parent_dir: &Path,
    sample_rate: u32,
    channels: u16,
    pcm_samples: &[i16],
    skip_if_existing_valid: bool,
) -> Result<(), String> {
    let tmp_path = make_atomic_tmp_path(out_path, parent_dir);
    if let Err(e) = write_wav_i16(&tmp_path, sample_rate, channels, pcm_samples) {
        let _ = fs::remove_file(&tmp_path);
        return Err(sanitize_err(parent_dir, &e.to_string()));
    }
    finalize_atomic_tmp_file(&tmp_path, out_path, parent_dir, skip_if_existing_valid)
}

fn write_wav_pcm_f32_atomic(
    out_path: &Path,
    parent_dir: &Path,
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    pcm_samples: &[f32],
    skip_if_existing_valid: bool,
) -> Result<(), String> {
    let tmp_path = make_atomic_tmp_path(out_path, parent_dir);
    if let Err(e) = write_wav_pcm_f32(&tmp_path, sample_rate, channels, bits_per_sample, pcm_samples) {
        let _ = fs::remove_file(&tmp_path);
        return Err(sanitize_err(parent_dir, &e.to_string()));
    }
    finalize_atomic_tmp_file(&tmp_path, out_path, parent_dir, skip_if_existing_valid)
}

#[cfg(test)]
pub fn export_wav_slice_with_options(
    source_path: &Path,
    slices_dir: &Path,
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
) -> Result<String, String> {
    export_wav_slice_with_preset(
        source_path,
        slices_dir,
        start_sec,
        end_sec,
        pitch_semitones,
        apply_micro_fade,
        None,
    )
}

pub fn export_wav_slice_with_preset(
    source_path: &Path,
    slices_dir: &Path,
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    export_preset: Option<&str>,
) -> Result<String, String> {
    if is_unc_or_network_path(&slices_dir.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    fs::create_dir_all(slices_dir).map_err(|e| {
        format!(
            "Failed to create slice WAV: {}",
            sanitize_err(slices_dir, &e.to_string())
        )
    })?;
    let file_name = build_default_slice_file_name_with_preset(
        source_path,
        start_sec,
        end_sec,
        pitch_semitones,
        apply_micro_fade,
        export_preset,
    );
    let out_path = slices_dir.join(file_name);
    export_wav_slice_to_path_with_preset(
        source_path,
        &out_path,
        start_sec,
        end_sec,
        pitch_semitones,
        apply_micro_fade,
        export_preset,
    )
}

pub fn export_wav_slice_to_path_with_preset(
    source_path: &Path,
    out_path: &Path,
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    export_preset: Option<&str>,
) -> Result<String, String> {
    if !start_sec.is_finite() || !end_sec.is_finite() || start_sec < 0.0 || end_sec <= start_sec {
        return Err(
            "Invalid slice range: start_sec and end_sec must be finite, non-negative, and end_sec > start_sec"
                .to_string(),
        );
    }
    if (end_sec - start_sec) > MAX_SLICE_DURATION_SEC {
        return Err(format!(
            "Slice range exceeds maximum duration of {:.0} seconds",
            MAX_SLICE_DURATION_SEC
        ));
    }
    if is_unc_or_network_path(&out_path.to_string_lossy())
        || has_ntfs_ads_colon(&out_path.to_string_lossy())
    {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    validate_readable_audio_source(source_path)?;
    let parent_dir = out_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent_dir).map_err(|e| {
        format!(
            "Failed to create slice WAV: {}",
            sanitize_err(parent_dir, &e.to_string())
        )
    })?;

    let preset = ExportAudioPreset::from_opt_str(export_preset);
    let opened = open_audio_decoder(source_path)
        .map_err(|e| sanitize_err(parent_dir, &e))?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut sample_rate = opened.sample_rate;
    let mut out_channels = opened.channels.clamp(0, 2);
    let source_bit_depth = opened.bit_depth;

    let out_bits: u16 = match preset {
        ExportAudioPreset::Original => {
            if source_bit_depth > 16 {
                24
            } else {
                16
            }
        }
        ExportAudioPreset::Wav24 | ExportAudioPreset::Nle48k24 => 24,
    };

    let init_sr = if sample_rate > 0 { sample_rate } else { 48000 };
    let max_init_frames = (10.0 * init_sr as f64) as usize;
    let requested_init_frames = ((end_sec - start_sec) * init_sr as f64).ceil() as usize;
    let init_cap = requested_init_frames
        .min(max_init_frames)
        .saturating_mul(if out_channels > 0 { out_channels } else { 2 });

    let bytes_per_sample = (out_bits / 8) as usize;
    let max_wav_samples =
        ((u32::MAX as usize).saturating_sub(44) / bytes_per_sample).min(MAX_PCM_F32_SAMPLES);
    let mut pcm_samples: Vec<f32> = Vec::with_capacity(init_cap);
    let mut current_frame: u64 = 0;
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;

    // Fast coarse seek for deep slices (> 2s) so extracting a 2s clip from minute 45
    // doesn't decode the entire preceding file from byte 0.
    if start_sec > 2.0 && sample_rate > 0 {
        let seek_target_sec = (start_sec - 0.5).max(0.0);
        if let Ok(seeked) = format.seek(
            symphonia::core::formats::SeekMode::Coarse,
            symphonia::core::formats::SeekTo::Time {
                time: symphonia::core::units::Time::from(seek_target_sec),
                track_id: Some(track_id),
            },
        ) {
            let time_base = format
                .tracks()
                .iter()
                .find(|t| t.id == track_id)
                .and_then(|t| t.codec_params.time_base);
            let actual_frame = if let Some(tb) = time_base {
                let t = tb.calc_time(seeked.actual_ts);
                ((t.seconds as f64 + t.frac) * (sample_rate as f64)).round().max(0.0) as u64
            } else {
                seeked.actual_ts
            };
            if actual_frame <= (start_sec * sample_rate as f64).floor() as u64 {
                decoder.reset();
                current_frame = actual_frame;
            } else {
                // Coarse seek overshot start_sec -> fall back to clean decode from 0
                let _ = format.seek(
                    symphonia::core::formats::SeekMode::Coarse,
                    symphonia::core::formats::SeekTo::Time {
                        time: symphonia::core::units::Time::from(0.0),
                        track_id: Some(track_id),
                    },
                );
                decoder.reset();
                current_frame = 0;
            }
        }
    }

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
        if let Ok(decoded) = decoder.decode(&packet) {
            let Some((spec, frames_usize, samples)) =
                copy_packet_samples(&mut sample_buf_slot, decoded)
            else {
                continue;
            };
            if sample_rate == 0 {
                sample_rate = spec.rate;
            }
            let ch = spec.channels.count();
            if out_channels == 0 {
                out_channels = ch.clamp(1, 2);
            }
            let start_frame = (start_sec * sample_rate as f64).floor() as u64;
            let end_frame = (end_sec * sample_rate as f64).ceil() as u64;
            if current_frame >= end_frame {
                break;
            }

            let frames = frames_usize as u64;
            let packet_end = current_frame + frames;
            if packet_end <= start_frame {
                current_frame = packet_end;
                continue;
            }

            let slice_start_frame = start_frame.saturating_sub(current_frame) as usize;
            let slice_end_frame = ((end_frame - current_frame).min(frames)) as usize;

            for f_idx in slice_start_frame..slice_end_frame {
                if pcm_samples.len().saturating_add(out_channels) > max_wav_samples {
                    break;
                }
                let frame_slice = &samples[f_idx * ch..(f_idx + 1) * ch];
                push_frame_downmixed_f32(frame_slice, out_channels, &mut pcm_samples);
            }

            current_frame = packet_end;
            if current_frame >= end_frame
                || pcm_samples.len().saturating_add(out_channels) > max_wav_samples
            {
                break;
            }
        }
    }

    if sample_rate == 0 || out_channels == 0 || pcm_samples.is_empty() {
        return Err("No audio frames could be decoded in the selected slice range".to_string());
    }

    let out_sample_rate: u32 = match preset {
        ExportAudioPreset::Nle48k24 => 48_000,
        ExportAudioPreset::Original | ExportAudioPreset::Wav24 => sample_rate,
    };

    let semitones = pitch_semitones.unwrap_or(0.0).clamp(-24.0, 24.0);
    let pitch_ratio = if semitones.is_finite() && semitones.abs() >= 0.01 {
        2.0_f64.powf((semitones as f64) / 12.0)
    } else {
        1.0
    };
    let sr_ratio = (sample_rate as f64) / (out_sample_rate as f64);
    let combined_ratio = pitch_ratio * sr_ratio;
    if (combined_ratio - 1.0).abs() > 1e-5 {
        pcm_samples = resample_interleaved_f32(
            &pcm_samples,
            out_channels,
            combined_ratio,
            max_wav_samples,
        );
    }

    let micro_fade = apply_micro_fade.unwrap_or(false);
    if micro_fade {
        apply_anti_click_micro_fade_f32(&mut pcm_samples, out_sample_rate, out_channels);
    }

    write_wav_pcm_f32_atomic(
        out_path,
        parent_dir,
        out_sample_rate,
        out_channels as u16,
        out_bits,
        &pcm_samples,
        false,
    )
    .map_err(|e| format!("Failed to create slice WAV: {}", e))?;

    Ok(out_path.to_string_lossy().to_string())
}

pub fn transcode_audio_to_pcm_wav(
    source_path: &Path,
    cache_dir: &Path,
) -> Result<String, String> {
    if is_unc_or_network_path(&cache_dir.to_string_lossy())
        || has_ntfs_ads_colon(&cache_dir.to_string_lossy())
    {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    validate_readable_audio_source(source_path)?;

    fs::create_dir_all(cache_dir).map_err(|e| {
        format!(
            "Failed to create playback fallback cache directory: {}",
            sanitize_err(cache_dir, &e.to_string())
        )
    })?;

    let meta = fs::metadata(source_path).ok();
    let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sample");
    let safe_stem: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let norm_lower = normalize_clean_path(&source_path.to_string_lossy()).to_lowercase();
    let hash_hex = format!(
        "{:016x}",
        fnv1a_hash64(&[
            norm_lower.as_bytes(),
            &[0xFF],
            &file_size.to_le_bytes(),
            &mtime.to_le_bytes(),
        ])
    );

    let out_file_name = format!("{}_{}.wav", safe_stem, hash_hex);
    let out_path = cache_dir.join(&out_file_name);

    if out_path.exists()
        && fs::metadata(&out_path)
            .map(|m| m.len() > 44)
            .unwrap_or(false)
    {
        return Ok(out_path.to_string_lossy().to_string());
    }

    let opened = open_audio_decoder(source_path)
        .map_err(|e| sanitize_err(cache_dir, &e))?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut sample_rate = opened.sample_rate;
    let mut out_channels = opened.channels.clamp(0, 2);

    let mut pcm_samples: Vec<i16> = Vec::new();
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;

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
            let Some((spec, frames, samples)) =
                copy_packet_samples(&mut sample_buf_slot, decoded)
            else {
                continue;
            };
            if sample_rate == 0 {
                sample_rate = spec.rate;
            }
            let ch = spec.channels.count();
            if out_channels == 0 {
                out_channels = ch.clamp(1, 2);
            }
            let mut hit_cap = false;
            for f_idx in 0..frames {
                if pcm_samples.len().saturating_add(out_channels) > MAX_PCM_BUFFER_SAMPLES {
                    hit_cap = true;
                    break;
                }
                let frame_slice = &samples[f_idx * ch..(f_idx + 1) * ch];
                push_frame_downmixed(frame_slice, out_channels, &mut pcm_samples);
            }
            if hit_cap {
                break;
            }
        }
    }

    if sample_rate == 0 || out_channels == 0 || pcm_samples.is_empty() {
        return Err("No audio frames could be decoded from file".to_string());
    }

    write_wav_i16_atomic(
        &out_path,
        cache_dir,
        sample_rate,
        out_channels as u16,
        &pcm_samples,
        true,
    )
    .map_err(|e| format!("Failed to finalize converted PCM WAV: {}", e))?;

    Ok(out_path.to_string_lossy().to_string())
}