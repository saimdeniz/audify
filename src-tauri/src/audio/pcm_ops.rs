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

/// Downmixes an interleaved multichannel frame (`ch >= 1`) into `out_channels` (`1` or `2`).
/// For `ch > 2` (e.g. 5.1 6-channel or 10-channel field recordings), mixes front-left/even
/// channels into `L` and front-right/odd channels into `R`, clamped safely to `[-1.0, 1.0]`.
pub(super) fn push_frame_downmixed(frame: &[f32], out_channels: usize, dst: &mut Vec<i16>) {
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
        dst.push(float_to_pcm_i16(sum / (ch as f32)));
        return;
    }

    match ch {
        1 => {
            let pcm = float_to_pcm_i16(frame[0]);
            dst.push(pcm);
            dst.push(pcm);
        }
        2 => {
            dst.push(float_to_pcm_i16(frame[0]));
            dst.push(float_to_pcm_i16(frame[1]));
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
            dst.push(float_to_pcm_i16(left));
            dst.push(float_to_pcm_i16(right));
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
            dst.push(float_to_pcm_i16(l_sum * l_scale));
            dst.push(float_to_pcm_i16(r_sum * r_scale));
        }
    }
}

/// Applies Catmull-Rom / 4-point cubic Hermite varispeed resampling (`rate = 2^(semitones / 12)`)
/// so pitched previews exported to NLEs remain standard `sample_rate` PCM WAV files.
pub(super) fn resample_interleaved_varispeed(
    samples: &[i16],
    channels: usize,
    semitones: f32,
    max_total_samples: usize,
) -> Vec<i16> {
    let clamped_st = semitones.clamp(-24.0, 24.0);
    if !clamped_st.is_finite() || clamped_st.abs() < 0.01 || channels == 0 {
        return samples.to_vec();
    }
    let in_frames = samples.len() / channels;
    if in_frames <= 1 {
        return samples.to_vec();
    }

    let rate = 2.0_f64.powf((clamped_st as f64) / 12.0);
    let max_out_frames = (max_total_samples / channels).max(1);
    let out_frames = (((in_frames as f64) / rate).round() as usize)
        .max(1)
        .min(max_out_frames);

    let mut out = Vec::with_capacity(out_frames * channels);
    let last_frame = (in_frames - 1) as isize;

    for out_f in 0..out_frames {
        let src_pos = (out_f as f64) * rate;
        let idx = src_pos.floor() as isize;
        let frac = (src_pos - (idx as f64)) as f32;

        let f0 = (idx - 1).clamp(0, last_frame) as usize;
        let f1 = idx.clamp(0, last_frame) as usize;
        let f2 = (idx + 1).clamp(0, last_frame) as usize;
        let f3 = (idx + 2).clamp(0, last_frame) as usize;

        for ch in 0..channels {
            let y0 = samples[f0 * channels + ch] as f32;
            let y1 = samples[f1 * channels + ch] as f32;
            let y2 = samples[f2 * channels + ch] as f32;
            let y3 = samples[f3 * channels + ch] as f32;

            // 4-point, 3rd-order Hermite interpolation
            let c0 = y1;
            let c1 = 0.5 * (y2 - y0);
            let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
            let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            let val = ((c3 * frac + c2) * frac + c1) * frac + c0;
            out.push(val.round().clamp(-32768.0, 32767.0) as i16);
        }
    }
    out
}

/// Applies a smooth `3ms` half-cosine anti-click fade-in and fade-out at slice boundaries.
pub(super) fn apply_anti_click_micro_fade(samples: &mut [i16], sample_rate: u32, channels: usize) {
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
            samples[start_base + ch] = ((samples[start_base + ch] as f32) * gain)
                .round()
                .clamp(-32768.0, 32767.0) as i16;
            samples[end_base + ch] = ((samples[end_base + ch] as f32) * gain)
                .round()
                .clamp(-32768.0, 32767.0) as i16;
        }
    }
}

pub fn write_wav_i16(
    path: &Path,
    sample_rate: u32,
    channels: u16,
    samples: &[i16],
) -> io::Result<()> {
    if sample_rate == 0 || channels == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid WAV header parameters (sample_rate and channels must be > 0)",
        ));
    }

    let data_bytes_usize = samples
        .len()
        .checked_mul(2)
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

    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);

    let bits_per_sample: u16 = 16;
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
    writer.write_all(&1u16.to_le_bytes())?;
    writer.write_all(&channels.to_le_bytes())?;
    writer.write_all(&sample_rate.to_le_bytes())?;
    writer.write_all(&byte_rate.to_le_bytes())?;
    writer.write_all(&block_align.to_le_bytes())?;
    writer.write_all(&bits_per_sample.to_le_bytes())?;

    writer.write_all(b"data")?;
    writer.write_all(&data_bytes.to_le_bytes())?;

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