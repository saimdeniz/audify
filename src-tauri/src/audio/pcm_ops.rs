use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;

#[inline]
fn sanitize_audio_sample(raw: f32) -> f32 {
    if raw.is_finite() {
        raw.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

#[inline]
fn float_to_pcm_i16(raw: f32) -> i16 {
    (sanitize_audio_sample(raw) * 32767.0).round() as i16
}

#[inline]
fn float_to_pcm_i24(raw: f32) -> i32 {
    (sanitize_audio_sample(raw) * 8_388_607.0)
        .round()
        .clamp(-8_388_608.0, 8_388_607.0) as i32
}

/// Downmixes an interleaved multichannel frame (`ch >= 1`) into `out_channels` (`1` or `2`)
/// while preserving full 32-bit float dynamic range.
pub(super) fn push_frame_downmixed_f32(frame: &[f32], out_channels: usize, dst: &mut Vec<f32>) {
    let ch = frame.len();
    if ch == 0 {
        return;
    }
    if out_channels == 1 {
        let mut sum = 0.0_f32;
        for &v in frame {
            if v.is_finite() {
                sum += v;
            }
        }
        dst.push(sanitize_audio_sample(sum / (ch as f32)));
        return;
    }

    match ch {
        1 => {
            let s = sanitize_audio_sample(frame[0]);
            dst.push(s);
            dst.push(s);
        }
        2 => {
            dst.push(sanitize_audio_sample(frame[0]));
            dst.push(sanitize_audio_sample(frame[1]));
        }
        6 => {
            // Standard 5.1 layout: FL(0), FR(1), FC(2), LFE(3), BL/SL(4), BR/SR(5)
            let s0 = if frame[0].is_finite() { frame[0] } else { 0.0 };
            let s1 = if frame[1].is_finite() { frame[1] } else { 0.0 };
            let s2 = if frame[2].is_finite() { frame[2] } else { 0.0 };
            let s4 = if frame[4].is_finite() { frame[4] } else { 0.0 };
            let s5 = if frame[5].is_finite() { frame[5] } else { 0.0 };
            let k = std::f32::consts::FRAC_1_SQRT_2;
            let left = (s0 + k * s2 + k * s4) * k;
            let right = (s1 + k * s2 + k * s5) * k;
            dst.push(sanitize_audio_sample(left));
            dst.push(sanitize_audio_sample(right));
        }
        _ => {
            // General multichannel (>2ch) field recording: even channels -> L, odd channels -> R
            let mut l_sum = 0.0_f32;
            let mut r_sum = 0.0_f32;
            let mut l_cnt = 0usize;
            let mut r_cnt = 0usize;
            for (idx, &v) in frame.iter().enumerate() {
                let clean = if v.is_finite() { v } else { 0.0 };
                if idx % 2 == 0 {
                    l_sum += clean;
                    l_cnt += 1;
                } else {
                    r_sum += clean;
                    r_cnt += 1;
                }
            }
            let l_scale = if l_cnt > 0 {
                1.0 / (l_cnt as f32).sqrt()
            } else {
                1.0
            };
            let r_scale = if r_cnt > 0 {
                1.0 / (r_cnt as f32).sqrt()
            } else {
                1.0
            };
            dst.push(sanitize_audio_sample(l_sum * l_scale));
            dst.push(sanitize_audio_sample(r_sum * r_scale));
        }
    }
}

/// Downmixes an interleaved multichannel frame (`ch >= 1`) into `out_channels` (`1` or `2`) as `i16`.
pub(super) fn push_frame_downmixed(frame: &[f32], out_channels: usize, dst: &mut Vec<i16>) {
    let mut tmp = Vec::with_capacity(out_channels);
    push_frame_downmixed_f32(frame, out_channels, &mut tmp);
    for s in tmp {
        dst.push(float_to_pcm_i16(s));
    }
}

/// Single-pass high-precision float32 resampler for combined varispeed pitch (`2^(st/12)`)
/// and sample-rate conversion (`src_sr / dst_sr`).
/// Uses Hann-windowed sinc anti-aliasing when `speed_ratio > 1.02` and 4-point cubic Hermite otherwise.
pub(super) fn resample_interleaved_f32(
    samples: &[f32],
    channels: usize,
    speed_ratio: f64,
    max_total_samples: usize,
) -> Vec<f32> {
    if !speed_ratio.is_finite()
        || speed_ratio <= 0.0
        || (speed_ratio - 1.0).abs() < 1e-5
        || channels == 0
    {
        return samples.to_vec();
    }
    let in_frames = samples.len() / channels;
    if in_frames <= 1 {
        return samples.to_vec();
    }

    let max_out_frames = (max_total_samples / channels).max(1);
    let out_frames = (((in_frames as f64) / speed_ratio).round() as usize)
        .max(1)
        .min(max_out_frames);

    let mut out = Vec::with_capacity(out_frames * channels);
    let last_frame = (in_frames - 1) as isize;
    let use_aa_sinc = speed_ratio > 1.02;
    let aa_cutoff = (0.92 / speed_ratio).min(1.0);
    let aa_radius = if use_aa_sinc {
        ((2.5 * speed_ratio).ceil() as isize).clamp(4, 16)
    } else {
        0
    };

    for out_f in 0..out_frames {
        let src_pos = (out_f as f64) * speed_ratio;
        let idx = src_pos.floor() as isize;
        let frac = (src_pos - (idx as f64)) as f32;

        if use_aa_sinc {
            let r_f64 = aa_radius as f64;
            let mut ch_acc = [0.0_f64; 8];
            let mut weight_sum = 0.0_f64;
            let ch_capped = channels.min(8);

            for k in -aa_radius..=aa_radius {
                let sample_idx = (idx + k).clamp(0, last_frame) as usize;
                let dx = (idx + k) as f64 - src_pos;
                if dx.abs() >= r_f64 {
                    continue;
                }
                let x = std::f64::consts::PI * dx * aa_cutoff;
                let sinc = if x.abs() < 1e-9 { 1.0 } else { x.sin() / x };
                let win = 0.5 * (1.0 + (std::f64::consts::PI * dx / r_f64).cos());
                let w = sinc * win;
                weight_sum += w;
                let base = sample_idx * channels;
                for (c, slot) in ch_acc.iter_mut().enumerate().take(ch_capped) {
                    *slot += (samples[base + c] as f64) * w;
                }
            }
            let inv_w = if weight_sum.abs() > 1e-9 {
                1.0 / weight_sum
            } else {
                1.0
            };
            for ch in 0..channels {
                let val = if ch < ch_capped {
                    (ch_acc[ch] * inv_w) as f32
                } else {
                    samples[(idx.clamp(0, last_frame) as usize) * channels + ch]
                };
                out.push(sanitize_audio_sample(val));
            }
        } else {
            let f0 = (idx - 1).clamp(0, last_frame) as usize;
            let f1 = idx.clamp(0, last_frame) as usize;
            let f2 = (idx + 1).clamp(0, last_frame) as usize;
            let f3 = (idx + 2).clamp(0, last_frame) as usize;

            for ch in 0..channels {
                let y0 = samples[f0 * channels + ch];
                let y1 = samples[f1 * channels + ch];
                let y2 = samples[f2 * channels + ch];
                let y3 = samples[f3 * channels + ch];

                let c0 = y1;
                let c1 = 0.5 * (y2 - y0);
                let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
                let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
                let val = ((c3 * frac + c2) * frac + c1) * frac + c0;
                out.push(sanitize_audio_sample(val));
            }
        }
    }
    out
}

/// Applies a smooth `3ms` half-cosine anti-click fade-in and fade-out at slice boundaries.
pub(super) fn apply_anti_click_micro_fade_f32(
    samples: &mut [f32],
    sample_rate: u32,
    channels: usize,
) {
    if channels == 0 || sample_rate == 0 {
        return;
    }
    let total_frames = samples.len() / channels;
    if total_frames < 4 {
        return;
    }
    let fade_frames = ((sample_rate as f64 * 0.003).round() as usize)
        .max(2)
        .min(total_frames / 2);

    for i in 0..fade_frames {
        let phase = (i as f32) / (fade_frames as f32);
        let gain = 0.5 * (1.0 - (std::f32::consts::PI * phase).cos());

        let start_base = i * channels;
        let end_base = (total_frames - 1 - i) * channels;
        for ch in 0..channels {
            samples[start_base + ch] = sanitize_audio_sample(samples[start_base + ch] * gain);
            samples[end_base + ch] = sanitize_audio_sample(samples[end_base + ch] * gain);
        }
    }
}

fn write_wav_header<W: Write>(
    writer: &mut W,
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    sample_count: usize,
) -> io::Result<()> {
    if sample_rate == 0 || channels == 0 || (bits_per_sample != 16 && bits_per_sample != 24) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid WAV header parameters",
        ));
    }
    let bytes_per_sample = (bits_per_sample / 8) as usize;
    let data_bytes_usize = sample_count
        .checked_mul(bytes_per_sample)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "WAV byte length overflow"))?;
    let data_bytes = u32::try_from(data_bytes_usize).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "WAV payload exceeds 4GB RIFF limit",
        )
    })?;
    let riff_size = 36u32
        .checked_add(data_bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "WAV RIFF size overflow"))?;

    let block_align = channels
        .checked_mul(bits_per_sample / 8)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "WAV block_align overflow"))?;
    let byte_rate = sample_rate
        .checked_mul(block_align as u32)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "WAV byte_rate overflow"))?;

    writer.write_all(b"RIFF")?;
    writer.write_all(&riff_size.to_le_bytes())?;
    writer.write_all(b"WAVE")?;

    writer.write_all(b"fmt ")?;
    writer.write_all(&16u32.to_le_bytes())?;
    writer.write_all(&1u16.to_le_bytes())?; // PCM
    writer.write_all(&channels.to_le_bytes())?;
    writer.write_all(&sample_rate.to_le_bytes())?;
    writer.write_all(&byte_rate.to_le_bytes())?;
    writer.write_all(&block_align.to_le_bytes())?;
    writer.write_all(&bits_per_sample.to_le_bytes())?;

    writer.write_all(b"data")?;
    writer.write_all(&data_bytes.to_le_bytes())?;
    Ok(())
}

pub fn write_wav_pcm_f32(
    path: &Path,
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    samples: &[f32],
) -> io::Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    write_wav_header(&mut writer, sample_rate, channels, bits_per_sample, samples.len())?;

    if bits_per_sample == 24 {
        let mut chunk_buf = [0u8; 9216]; // divisible by 3
        for sample_chunk in samples.chunks(chunk_buf.len() / 3) {
            let byte_len = sample_chunk.len() * 3;
            for (idx, &s) in sample_chunk.iter().enumerate() {
                let le = float_to_pcm_i24(s).to_le_bytes();
                chunk_buf[idx * 3] = le[0];
                chunk_buf[idx * 3 + 1] = le[1];
                chunk_buf[idx * 3 + 2] = le[2];
            }
            writer.write_all(&chunk_buf[..byte_len])?;
        }
    } else {
        let mut chunk_buf = [0u8; 8192];
        for sample_chunk in samples.chunks(chunk_buf.len() / 2) {
            let byte_len = sample_chunk.len() * 2;
            for (idx, &s) in sample_chunk.iter().enumerate() {
                let le = float_to_pcm_i16(s).to_le_bytes();
                chunk_buf[idx * 2] = le[0];
                chunk_buf[idx * 2 + 1] = le[1];
            }
            writer.write_all(&chunk_buf[..byte_len])?;
        }
    }

    writer.flush()?;
    Ok(())
}

pub fn write_wav_i16(
    path: &Path,
    sample_rate: u32,
    channels: u16,
    samples: &[i16],
) -> io::Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    write_wav_header(&mut writer, sample_rate, channels, 16, samples.len())?;

    let mut chunk_buf = [0u8; 8192];
    for sample_chunk in samples.chunks(chunk_buf.len() / 2) {
        let byte_len = sample_chunk.len() * 2;
        for (idx, &s) in sample_chunk.iter().enumerate() {
            let le = s.to_le_bytes();
            chunk_buf[idx * 2] = le[0];
            chunk_buf[idx * 2 + 1] = le[1];
        }
        writer.write_all(&chunk_buf[..byte_len])?;
    }
    writer.flush()?;
    Ok(())
}
