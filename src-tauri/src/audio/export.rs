use super::decode::{copy_packet_samples, open_audio_decoder};
use super::file_identity_hash8;
use super::loudness::{apply_export_loudness_normalization, ExportLoudnessMode};
use super::pcm_ops::{
    apply_anti_click_micro_fade_f32, push_frame_downmixed_f32, resample_interleaved_f32,
};
use super::transcode::{
    validate_readable_audio_source, write_wav_pcm_f32_atomic, StreamingSliceSink,
};
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path, sanitize_err};
use std::fs;
use std::path::Path;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;

const MAX_SLICE_DURATION_SEC: f64 = 600.0;
const MAX_PCM_F32_SAMPLES: usize = (256 * 1024 * 1024) / std::mem::size_of::<f32>();

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

#[derive(Debug, Clone, Copy, Default)]
pub struct SliceExportParams<'a> {
    pub start_sec: f64,
    pub end_sec: f64,
    pub pitch_semitones: Option<f32>,
    pub apply_micro_fade: Option<bool>,
    pub export_preset: Option<&'a str>,
    pub loudness_mode: Option<&'a str>,
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

pub fn build_default_slice_file_name_with_params(
    source_path: &Path,
    params: &SliceExportParams<'_>,
) -> String {
    let semitones = params.pitch_semitones.unwrap_or(0.0).clamp(-24.0, 24.0);
    let micro_fade = params.apply_micro_fade.unwrap_or(false);
    let preset = ExportAudioPreset::from_opt_str(params.export_preset);
    let loudness = ExportLoudnessMode::from_opt_str(params.loudness_mode);
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
    let loudness_suffix = loudness.filename_suffix();
    format!(
        "{}_{}_slice_{:.3}s_{:.3}s{}{}{}{}.wav",
        safe_stem,
        hash8,
        params.start_sec,
        params.end_sec,
        pitch_suffix,
        fade_suffix,
        preset_suffix,
        loudness_suffix
    )
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
    export_wav_slice_with_params(
        source_path,
        slices_dir,
        &SliceExportParams {
            start_sec,
            end_sec,
            pitch_semitones,
            apply_micro_fade,
            export_preset: None,
            loudness_mode: None,
        },
    )
}

#[cfg(test)]
pub fn export_wav_slice_with_preset(
    source_path: &Path,
    slices_dir: &Path,
    start_sec: f64,
    end_sec: f64,
    pitch_semitones: Option<f32>,
    apply_micro_fade: Option<bool>,
    export_preset: Option<&str>,
) -> Result<String, String> {
    export_wav_slice_with_params(
        source_path,
        slices_dir,
        &SliceExportParams {
            start_sec,
            end_sec,
            pitch_semitones,
            apply_micro_fade,
            export_preset,
            loudness_mode: None,
        },
    )
}

pub fn export_wav_slice_with_params(
    source_path: &Path,
    slices_dir: &Path,
    params: &SliceExportParams<'_>,
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
    let file_name = build_default_slice_file_name_with_params(source_path, params);
    let out_path = slices_dir.join(file_name);
    export_wav_slice_to_path_with_params(source_path, &out_path, params)
}

pub fn export_wav_slice_to_path_with_params(
    source_path: &Path,
    out_path: &Path,
    params: &SliceExportParams<'_>,
) -> Result<String, String> {
    let start_sec = params.start_sec;
    let end_sec = params.end_sec;
    let pitch_semitones = params.pitch_semitones;
    let apply_micro_fade = params.apply_micro_fade;
    let export_preset = params.export_preset;
    let loudness = ExportLoudnessMode::from_opt_str(params.loudness_mode);
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
    let opened = open_audio_decoder(source_path).map_err(|e| sanitize_err(parent_dir, &e))?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let mut track_id = opened.track_id;
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

    let semitones = pitch_semitones.unwrap_or(0.0).clamp(-24.0, 24.0);
    let pitch_ratio = if semitones.is_finite() && semitones.abs() >= 0.01 {
        2.0_f64.powf((semitones as f64) / 12.0)
    } else {
        1.0
    };
    let micro_fade = apply_micro_fade.unwrap_or(false);

    let bytes_per_sample = (out_bits / 8) as usize;
    let max_wav_samples =
        ((u32::MAX as usize).saturating_sub(44) / bytes_per_sample).min(MAX_PCM_F32_SAMPLES);

    let needs_resample_at_sr = |sr: u32| -> bool {
        let out_sr = match preset {
            ExportAudioPreset::Nle48k24 => 48_000,
            ExportAudioPreset::Original | ExportAudioPreset::Wav24 => sr,
        };
        let combined = pitch_ratio * ((sr as f64) / (out_sr.max(1) as f64));
        (combined - 1.0).abs() > 1e-5
    };

    let mut pcm_samples: Vec<f32> = Vec::new();
    let mut stream_sink: Option<StreamingSliceSink> = None;
    let mut using_streaming: Option<bool> = None;
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
                ((t.seconds as f64 + t.frac) * (sample_rate as f64))
                    .round()
                    .max(0.0) as u64
            } else {
                seeked.actual_ts
            };
            if actual_frame <= (start_sec * sample_rate as f64).floor() as u64 {
                decoder.reset();
                current_frame = actual_frame;
            } else {
                let rewound_to_zero = format
                    .seek(
                        symphonia::core::formats::SeekMode::Coarse,
                        symphonia::core::formats::SeekTo::Time {
                            time: symphonia::core::units::Time::from(0.0),
                            track_id: Some(track_id),
                        },
                    )
                    .ok()
                    .map(|r| r.actual_ts == 0)
                    .unwrap_or(false);
                if rewound_to_zero {
                    decoder.reset();
                    current_frame = 0;
                } else {
                    let reopened = open_audio_decoder(source_path)
                        .map_err(|e| sanitize_err(parent_dir, &e))?;
                    format = reopened.format;
                    decoder = reopened.decoder;
                    track_id = reopened.track_id;
                    current_frame = 0;
                }
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
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => continue,
        };
        let Some((spec, frames_usize, samples)) = copy_packet_samples(&mut sample_buf_slot, decoded)
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

        if slice_start_frame < slice_end_frame {
            let is_stream = *using_streaming.get_or_insert_with(|| {
                loudness == ExportLoudnessMode::Off && !needs_resample_at_sr(sample_rate)
            });
            if is_stream {
                if stream_sink.is_none() {
                    stream_sink = Some(StreamingSliceSink::create(
                        out_path,
                        parent_dir,
                        sample_rate,
                        out_channels,
                        out_bits,
                        micro_fade,
                    )?);
                }
                if let Some(ref mut sink) = stream_sink {
                    sink.push_packet_slice(
                        samples,
                        ch,
                        slice_start_frame,
                        slice_end_frame,
                        parent_dir,
                    )?;
                }
            } else {
                for f_idx in slice_start_frame..slice_end_frame {
                    if pcm_samples.len().saturating_add(out_channels) > max_wav_samples {
                        return Err(
                            "Selected slice exceeds maximum resampled WAV buffer size (256 MiB)"
                                .to_string(),
                        );
                    }
                    let frame_slice = &samples[f_idx * ch..(f_idx + 1) * ch];
                    push_frame_downmixed_f32(frame_slice, out_channels, &mut pcm_samples);
                }
            }
        }

        current_frame = packet_end;
        if current_frame >= end_frame {
            break;
        }
    }

    if using_streaming == Some(true) {
        let Some(sink) = stream_sink.take() else {
            return Err("No audio frames could be decoded in the selected slice range".to_string());
        };
        if sample_rate == 0 || out_channels == 0 {
            return Err("No audio frames could be decoded in the selected slice range".to_string());
        }
        return sink.finish_atomic(out_path, parent_dir);
    }

    if sample_rate == 0 || out_channels == 0 || pcm_samples.is_empty() {
        return Err("No audio frames could be decoded in the selected slice range".to_string());
    }

    let out_sample_rate: u32 = match preset {
        ExportAudioPreset::Nle48k24 => 48_000,
        ExportAudioPreset::Original | ExportAudioPreset::Wav24 => sample_rate,
    };

    let sr_ratio = (sample_rate as f64) / (out_sample_rate as f64);
    let combined_ratio = pitch_ratio * sr_ratio;
    if (combined_ratio - 1.0).abs() > 1e-5 {
        pcm_samples = resample_interleaved_f32(
            &pcm_samples,
            out_channels,
            combined_ratio,
            max_wav_samples,
        )?;
    }

    if loudness != ExportLoudnessMode::Off {
        apply_export_loudness_normalization(&mut pcm_samples, out_sample_rate, out_channels, loudness);
    }

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
