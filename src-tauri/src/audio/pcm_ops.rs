use std::fs::File;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

#[inline]
fn sanitize_float_sample(raw: f32) -> f32 {
    if raw.is_finite() {
        raw
    } else {
        0.0
    }
}

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

/// Downmixes an interleaved multichannel frame (`ch >= 1`) into a stack-allocated `[f32; 2]` buffer
/// with valid length `1` or `2` (zero per-frame heap allocation).
#[inline]
fn downmix_frame_to_f32(frame: &[f32], out_channels: usize) -> ([f32; 2], usize) {
    let ch = frame.len();
    if ch == 0 {
        return ([0.0, 0.0], 0);
    }
    if out_channels == 1 {
        let mut sum = 0.0_f32;
        for &v in frame {
            if v.is_finite() {
                sum += v;
            }
        }
        return ([sanitize_float_sample(sum / (ch as f32)), 0.0], 1);
    }

    match ch {
        1 => {
            let s = sanitize_float_sample(frame[0]);
            ([s, s], 2)
        }
        2 => (
            [sanitize_float_sample(frame[0]), sanitize_float_sample(frame[1])],
            2,
        ),
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
            (
                [sanitize_float_sample(left), sanitize_float_sample(right)],
                2,
            )
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
            (
                [
                    sanitize_float_sample(l_sum * l_scale),
                    sanitize_float_sample(r_sum * r_scale),
                ],
                2,
            )
        }
    }
}

/// Downmixes an interleaved multichannel frame (`ch >= 1`) into `out_channels` (`1` or `2`)
/// while preserving full 32-bit float dynamic range.
pub(super) fn push_frame_downmixed_f32(frame: &[f32], out_channels: usize, dst: &mut Vec<f32>) {
    let (buf, count) = downmix_frame_to_f32(frame, out_channels);
    dst.extend_from_slice(&buf[..count]);
}

/// Streaming PCM WAV writer (16-bit or 24-bit) using constant ~64 KiB memory regardless of
/// audio duration, patching the 44-byte RIFF/WAVE header on `finish()` and failing explicitly
/// instead of silently truncating if the 4 GiB RIFF payload limit is exceeded.
pub(super) struct StreamingWavWriter {
    writer: BufWriter<File>,
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    sample_count: u64,
    max_samples: u64,
}

impl StreamingWavWriter {
    pub(super) fn create(
        path: &Path,
        sample_rate: u32,
        channels: u16,
        bits_per_sample: u16,
    ) -> io::Result<Self> {
        if sample_rate == 0 || channels == 0 || (bits_per_sample != 16 && bits_per_sample != 24) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid WAV header parameters",
            ));
        }
        let file = File::create(path)?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);
        writer.write_all(&[0u8; 44])?;
        let bytes_per_sample = (bits_per_sample / 8) as u64;
        let max_samples = (u32::MAX as u64).saturating_sub(44) / bytes_per_sample;
        Ok(Self {
            writer,
            sample_rate,
            channels,
            bits_per_sample,
            sample_count: 0,
            max_samples,
        })
    }

    pub(super) fn write_f32_samples(&mut self, samples: &[f32]) -> io::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let next_total = self.sample_count.saturating_add(samples.len() as u64);
        if next_total > self.max_samples {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "WAV payload exceeds 4GB RIFF limit",
            ));
        }
        if self.bits_per_sample == 24 {
            let mut chunk_buf = [0u8; 9216]; // divisible by 3
            for sample_chunk in samples.chunks(chunk_buf.len() / 3) {
                let byte_len = sample_chunk.len() * 3;
                for (idx, &s) in sample_chunk.iter().enumerate() {
                    let le = float_to_pcm_i24(s).to_le_bytes();
                    chunk_buf[idx * 3] = le[0];
                    chunk_buf[idx * 3 + 1] = le[1];
                    chunk_buf[idx * 3 + 2] = le[2];
                }
                self.writer.write_all(&chunk_buf[..byte_len])?;
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
                self.writer.write_all(&chunk_buf[..byte_len])?;
            }
        }
        self.sample_count = next_total;
        Ok(())
    }

    pub(super) fn sample_count(&self) -> u64 {
        self.sample_count
    }

    pub(super) fn finish(mut self) -> io::Result<()> {
        self.writer.flush()?;
        let mut file = self.writer.into_inner().map_err(|e| e.into_error())?;
        file.seek(SeekFrom::Start(0))?;
        let count_usize = usize::try_from(self.sample_count).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "WAV payload exceeds 4GB RIFF limit",
            )
        })?;
        write_wav_header(
            &mut file,
            self.sample_rate,
            self.channels,
            self.bits_per_sample,
            count_usize,
        )?;
        file.flush()?;
        Ok(())
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
) -> Result<Vec<f32>, String> {
    if !speed_ratio.is_finite()
        || speed_ratio <= 0.0
        || (speed_ratio - 1.0).abs() < 1e-5
        || channels == 0
    {
        return Ok(samples.to_vec());
    }
    let in_frames = samples.len() / channels;
    if in_frames <= 1 {
        return Ok(samples.to_vec());
    }

    let max_out_frames = (max_total_samples / channels).max(1);
    let requested_out_frames = (((in_frames as f64) / speed_ratio).round() as usize).max(1);
    if requested_out_frames > max_out_frames {
        return Err(
            "Resampled slice exceeds maximum 256 MiB WAV buffer size (shorten range or reduce pitch-down)"
                .to_string(),
        );
    }
    let out_frames = requested_out_frames;

    let mut out = Vec::with_capacity(out_frames * channels);
    let last_frame = (in_frames - 1) as isize;
    let use_aa_sinc = speed_ratio > 1.02;
    let aa_cutoff = (0.92 / speed_ratio).min(1.0);
    let aa_radius = if use_aa_sinc {
        ((2.5 * speed_ratio).ceil() as isize).clamp(4, 64)
    } else {
        0
    };

    // Precompute symmetric Hann-windowed sinc LUT (64 subdivisions per tap) to eliminate
    // per-tap `sin`/`cos` transcendental math in the inner resampling loop.
    const SINC_LUT_SUBDIV: usize = 64;
    let sinc_lut: Vec<f64> = if use_aa_sinc {
        let r_f64 = aa_radius as f64;
        let entries = (aa_radius as usize) * SINC_LUT_SUBDIV + 2;
        let mut table = Vec::with_capacity(entries);
        for i in 0..entries {
            let d = (i as f64) / (SINC_LUT_SUBDIV as f64);
            if d >= r_f64 {
                table.push(0.0);
            } else {
                let x = std::f64::consts::PI * d * aa_cutoff;
                let sinc = if x.abs() < 1e-9 { 1.0 } else { x.sin() / x };
                let win = 0.5 * (1.0 + (std::f64::consts::PI * d / r_f64).cos());
                table.push(sinc * win);
            }
        }
        table
    } else {
        Vec::new()
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
                let d_abs = ((idx + k) as f64 - src_pos).abs();
                if d_abs >= r_f64 {
                    continue;
                }
                let lut_pos = d_abs * (SINC_LUT_SUBDIV as f64);
                let lut_i = lut_pos as usize;
                let lut_t = lut_pos - (lut_i as f64);
                let w = sinc_lut[lut_i] + (sinc_lut[lut_i + 1] - sinc_lut[lut_i]) * lut_t;
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
                out.push(sanitize_float_sample(val));
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
                out.push(sanitize_float_sample(val));
            }
        }
    }
    Ok(out)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_and_resample_preserve_float32_headroom_and_reject_oversize() {
        let mut out = Vec::new();
        push_frame_downmixed_f32(&[2.5, -3.0], 2, &mut out);
        assert_eq!(out, vec![2.5, -3.0]);

        let mut sanitized = Vec::new();
        push_frame_downmixed_f32(&[f32::NAN, f32::INFINITY], 2, &mut sanitized);
        assert_eq!(sanitized, vec![0.0, 0.0]);

        let hot_buf = vec![2.2_f32; 200];
        let resampled = resample_interleaved_f32(&hot_buf, 1, 0.5, 1000).unwrap();
        assert_eq!(resampled.len(), 400);
        assert!(
            resampled[100] > 2.0,
            "Expected >0 dBFS float headroom preserved through resample, got {}",
            resampled[100]
        );

        // Oversized output must return Err instead of silently truncating
        let err = resample_interleaved_f32(&hot_buf, 1, 0.25, 300);
        assert!(err.is_err());
    }
}
