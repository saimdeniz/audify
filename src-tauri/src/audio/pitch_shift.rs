//! Pure-Rust time-preserving stereo pitch shifter using an STFT Phase Vocoder
//! with Laroche–Dolson Scaled Identity Phase Locking, zero-phase anti-alias
//! rolloff, and Catmull-Rom cubic resampling.
//!
//! Preserves exact clip duration (`output_frames == input_frames`) across the
//! full `[-24st, +24st]` (`0.25x .. 4.0x`) pitch range with zero external DSP
//! crate dependencies.

use rayon::join;
use std::f64::consts::PI;

const TWO_PI: f64 = 2.0 * PI;

#[inline]
fn wrap_pi(mut angle: f64) -> f64 {
    angle = (angle + PI) % TWO_PI;
    if angle < 0.0 {
        angle += TWO_PI;
    }
    angle - PI
}

/// In-place iterative radix-2 Cooley-Tukey FFT (`inverse = false` for forward,
/// `inverse = true` for inverse with `1/N` scaling). `re.len() == im.len()`
/// must be a power of two.
fn fft_radix2(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);

    // Bit-reversal permutation
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while (j & bit) != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let sign = if inverse { 1.0 } else { -1.0 };
    let mut len = 2usize;
    while len <= n {
        let half = len >> 1;
        let ang = sign * TWO_PI / (len as f64);
        let wlen_r = ang.cos();
        let wlen_i = ang.sin();

        let mut i = 0usize;
        while i < n {
            let mut wr = 1.0_f64;
            let mut wi = 0.0_f64;
            for k in 0..half {
                let u_r = re[i + k];
                let u_i = im[i + k];
                let idx = i + k + half;
                let v_r = re[idx] * wr - im[idx] * wi;
                let v_i = re[idx] * wi + im[idx] * wr;
                re[i + k] = u_r + v_r;
                im[i + k] = u_i + v_i;
                re[idx] = u_r - v_r;
                im[idx] = u_i - v_i;

                let next_wr = wr * wlen_r - wi * wlen_i;
                wi = wr * wlen_i + wi * wlen_r;
                wr = next_wr;
            }
            i += len;
        }
        len <<= 1;
    }

    if inverse {
        let inv_n = 1.0 / (n as f64);
        for k in 0..n {
            re[k] *= inv_n;
            im[k] *= inv_n;
        }
    }
}

fn choose_fft_size(input_len: usize) -> usize {
    if input_len >= 2048 {
        2048
    } else if input_len >= 1024 {
        1024
    } else if input_len >= 512 {
        512
    } else {
        256
    }
}

fn build_hann_window(n: usize) -> Vec<f64> {
    let inv_n = TWO_PI / (n as f64);
    (0..n).map(|i| 0.5 * (1.0 - (inv_n * (i as f64)).cos())).collect()
}

/// Phase-locked STFT time-stretch of a single mono channel by `alpha` (`0.25 .. 4.0`).
/// When `alpha > 1.0`, applies a zero-phase cosine low-pass rolloff right before the
/// Nyquist foldback point (`half / alpha`) so subsequent downsampling by `alpha` is
/// free of aliasing.
fn time_stretch_mono(input: &[f32], alpha: f64, target_len: usize) -> Vec<f32> {
    let in_len = input.len();
    if in_len < 32 || target_len == 0 {
        return vec![0.0_f32; target_len];
    }

    let fft_size = choose_fft_size(in_len);
    let half = fft_size / 2;
    let pad = half;
    let max_hop = fft_size / 4;

    let (ana_hop_f, syn_hop) = if alpha >= 1.0 {
        let hs = max_hop;
        let ha = ((hs as f64) / alpha).max(16.0);
        (ha, hs)
    } else {
        let ha = max_hop as f64;
        let hs = ((max_hop as f64) * alpha).round().max(16.0) as usize;
        (ha, hs)
    };

    // Zero-pad front by `pad` and tail by `fft_size` so clip start/end align at window center.
    let mut padded = vec![0.0_f64; pad + in_len + fft_size];
    for (i, &s) in input.iter().enumerate() {
        padded[pad + i] = if s.is_finite() { s as f64 } else { 0.0 };
    }

    let window = build_hann_window(fft_size);
    let num_frames = target_len.div_ceil(syn_hop) + 3;
    let out_buf_len = (num_frames * syn_hop + fft_size).max(pad + target_len + fft_size);
    let mut out = vec![0.0_f64; out_buf_len];
    let mut norm = vec![0.0_f64; out_buf_len];

    let mut re = vec![0.0_f64; fft_size];
    let mut im = vec![0.0_f64; fft_size];
    let mut mag = vec![0.0_f64; half + 1];
    let mut phase = vec![0.0_f64; half + 1];
    let mut prev_phase = vec![0.0_f64; half + 1];
    let mut syn_phase = vec![0.0_f64; half + 1];
    let mut prev_syn_phase = vec![0.0_f64; half + 1];
    let mut peaks: Vec<usize> = Vec::with_capacity(half / 2);
    let mut peak_rot = vec![0.0_f64; half + 1];

    // Precompute anti-alias gain curve when stretching for upward pitch shift (alpha > 1.0)
    let aa_gain: Vec<f64> = if alpha > 1.001 {
        let cutoff = (half as f64) / alpha;
        let roll_start = cutoff * 0.92;
        let span = (cutoff - roll_start).max(1.0);
        (0..=half)
            .map(|k| {
                let kf = k as f64;
                if kf <= roll_start {
                    1.0
                } else if kf >= cutoff {
                    0.0
                } else {
                    0.5 * (1.0 + (PI * (kf - roll_start) / span).cos())
                }
            })
            .collect()
    } else {
        vec![1.0; half + 1]
    };

    let max_read_pos = padded.len().saturating_sub(fft_size);
    let mut prev_read_pos = 0usize;

    for frame_idx in 0..num_frames {
        let read_pos = ((frame_idx as f64) * ana_hop_f).round() as usize;
        if read_pos > max_read_pos {
            break;
        }
        let write_pos = frame_idx * syn_hop;
        if write_pos + fft_size > out.len() {
            break;
        }

        for n in 0..fft_size {
            re[n] = padded[read_pos + n] * window[n];
            im[n] = 0.0;
        }
        fft_radix2(&mut re, &mut im, false);

        for k in 0..=half {
            mag[k] = re[k].hypot(im[k]);
            phase[k] = im[k].atan2(re[k]);
        }

        if frame_idx == 0 {
            syn_phase.copy_from_slice(&phase);
        } else {
            let actual_ha = read_pos.saturating_sub(prev_read_pos).max(1) as f64;
            let hs_f = syn_hop as f64;

            // Detect spectral magnitude peaks for Laroche–Dolson Identity Phase Locking
            peaks.clear();
            for k in 1..half {
                let m = mag[k];
                if m > 1e-12 && m >= mag[k - 1] && m >= mag[k + 1] {
                    let lo2 = if k >= 2 { mag[k - 2] } else { 0.0 };
                    let hi2 = if k + 2 <= half { mag[k + 2] } else { 0.0 };
                    if m >= lo2 && m >= hi2 {
                        peaks.push(k);
                    }
                }
            }

            if peaks.is_empty() {
                // Fallback standard phase propagation when frame is silent/flat
                for k in 0..=half {
                    let omega = TWO_PI * (k as f64) / (fft_size as f64);
                    let delta = wrap_pi(phase[k] - prev_phase[k] - omega * actual_ha);
                    let inst_freq = omega + delta / actual_ha;
                    syn_phase[k] = wrap_pi(prev_syn_phase[k] + inst_freq * hs_f);
                }
            } else {
                // Propagate phase accurately at every spectral peak
                for &p in &peaks {
                    let omega = TWO_PI * (p as f64) / (fft_size as f64);
                    let delta = wrap_pi(phase[p] - prev_phase[p] - omega * actual_ha);
                    let inst_freq = omega + delta / actual_ha;
                    let next_sp = wrap_pi(prev_syn_phase[p] + inst_freq * hs_f);
                    syn_phase[p] = next_sp;
                    peak_rot[p] = next_sp - phase[p];
                }

                // Lock every non-peak bin to its nearest spectral peak's rotation angle
                let mut cur_peak_idx = 0usize;
                for k in 0..=half {
                    while cur_peak_idx + 1 < peaks.len()
                        && (peaks[cur_peak_idx + 1] as isize - k as isize).abs()
                            < (peaks[cur_peak_idx] as isize - k as isize).abs()
                    {
                        cur_peak_idx += 1;
                    }
                    let p = peaks[cur_peak_idx];
                    if k != p {
                        syn_phase[k] = wrap_pi(phase[k] + peak_rot[p]);
                    }
                }
            }
        }

        prev_phase.copy_from_slice(&phase);
        prev_syn_phase.copy_from_slice(&syn_phase);
        prev_read_pos = read_pos;

        // Reconstruct conjugate-symmetric spectrum with anti-alias rolloff
        re[0] = mag[0] * aa_gain[0] * syn_phase[0].cos();
        im[0] = 0.0;
        re[half] = mag[half] * aa_gain[half] * syn_phase[half].cos();
        im[half] = 0.0;
        for k in 1..half {
            let g_mag = mag[k] * aa_gain[k];
            let c = syn_phase[k].cos();
            let s = syn_phase[k].sin();
            let rk = g_mag * c;
            let ik = g_mag * s;
            re[k] = rk;
            im[k] = ik;
            re[fft_size - k] = rk;
            im[fft_size - k] = -ik;
        }

        fft_radix2(&mut re, &mut im, true);

        for n in 0..fft_size {
            let w = window[n];
            out[write_pos + n] += re[n] * w;
            norm[write_pos + n] += w * w;
        }
    }

    let mut result = vec![0.0_f32; target_len];
    for (i, slot) in result.iter_mut().enumerate() {
        let idx = pad + i;
        let denom = norm[idx];
        let val = if denom > 1e-8 { out[idx] / denom } else { 0.0 };
        *slot = if val.is_finite() { val as f32 } else { 0.0 };
    }
    result
}

/// Resamples a mono signal to an exact target length using Catmull-Rom cubic interpolation.
fn resample_mono_exact_len(src: &[f32], target_len: usize) -> Vec<f32> {
    if src.is_empty() || target_len == 0 {
        return vec![0.0_f32; target_len];
    }
    if src.len() == target_len {
        return src.to_vec();
    }
    if src.len() == 1 {
        return vec![src[0]; target_len];
    }

    let mut out = vec![0.0_f32; target_len];
    let last = src.len() - 1;
    let step = (src.len() as f64) / (target_len as f64);

    for (i, dst) in out.iter_mut().enumerate() {
        let pos = (i as f64) * step;
        let idx = (pos.floor() as usize).min(last);
        let t = (pos - (idx as f64)).clamp(0.0, 1.0) as f32;

        let p0 = src[idx.saturating_sub(1)];
        let p1 = src[idx];
        let p2 = src[(idx + 1).min(last)];
        let p3 = src[(idx + 2).min(last)];

        let t2 = t * t;
        let t3 = t2 * t;
        let v = 0.5
            * ((2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
        *dst = if v.is_finite() { v } else { 0.0 };
    }
    out
}

fn pitch_shift_mono_preserve(input: &[f32], pitch_ratio: f64, stretched_len: usize) -> Vec<f32> {
    let stretched = time_stretch_mono(input, pitch_ratio, stretched_len);
    resample_mono_exact_len(&stretched, input.len())
}

/// Time-preserving stereo pitch shift on interleaved stereo `f32` PCM (`[L, R, L, R, ...]`).
/// Guarantees `output.len() == input.len()` so clip duration on the timeline never changes.
pub(super) fn pitch_shift_stereo_preserve_duration(
    interleaved_stereo: &[f32],
    pitch_ratio: f64,
    max_work_samples: usize,
) -> Result<Vec<f32>, String> {
    let frames = interleaved_stereo.len() / 2;
    if frames == 0 || (pitch_ratio - 1.0).abs() <= 1e-5 {
        return Ok(interleaved_stereo.to_vec());
    }
    let ratio = pitch_ratio.clamp(0.25, 4.0);
    let stretched_len = ((frames as f64) * ratio).round().max(1.0) as usize;
    if stretched_len.saturating_mul(2) > max_work_samples {
        return Err("Clip is too long for time-preserving pitch shift buffer limit".to_string());
    }

    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for &[l, r] in interleaved_stereo.as_chunks::<2>().0 {
        left.push(l);
        right.push(r);
    }

    let (out_l, out_r) = join(
        || pitch_shift_mono_preserve(&left, ratio, stretched_len),
        || pitch_shift_mono_preserve(&right, ratio, stretched_len),
    );

    let mut out = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        out.push(out_l[i]);
        out.push(out_r[i]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dominant_freq_hz(mono: &[f32], sample_rate: f64) -> f64 {
        // Measure dominant frequency in the steady center window via Goertzel/DFT over 16384 samples
        let n = 16384usize.min(mono.len().next_power_of_two() >> 1).max(256);
        let start = (mono.len().saturating_sub(n)) / 2;
        let win = build_hann_window(n);
        let mut re = vec![0.0_f64; n];
        let mut im = vec![0.0_f64; n];
        for i in 0..n {
            re[i] = (mono[start + i] as f64) * win[i];
        }
        fft_radix2(&mut re, &mut im, false);
        let mut best_k = 1usize;
        let mut best_mag = 0.0_f64;
        for k in 1..(n / 2) {
            let m = re[k].hypot(im[k]);
            if m > best_mag {
                best_mag = m;
                best_k = k;
            }
        }
        (best_k as f64) * sample_rate / (n as f64)
    }

    fn rms(mono: &[f32]) -> f64 {
        let sum: f64 = mono.iter().map(|&x| (x as f64) * (x as f64)).sum();
        (sum / (mono.len().max(1) as f64)).sqrt()
    }

    #[test]
    fn preserves_exact_duration_and_shifts_frequency_across_full_two_octave_range() {
        let sr = 48_000.0_f64;
        let frames = 24_000usize; // 0.5s
        let base_hz = 440.0_f64;
        let mut stereo = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let s = (TWO_PI * base_hz * (i as f64) / sr).sin() as f32 * 0.7;
            stereo.push(s);
            stereo.push(s);
        }

        let cases: &[(f64, f64, f64)] = &[
            (12.0, 880.0, 8.0),
            (-12.0, 220.0, 8.0),
            (24.0, 1760.0, 16.0),
            (-24.0, 110.0, 8.0),
            (7.0, 440.0 * 2.0_f64.powf(7.0 / 12.0), 8.0),
        ];

        for &(semitones, expected_hz, tol_hz) in cases {
            let ratio = 2.0_f64.powf(semitones / 12.0);
            let shifted =
                pitch_shift_stereo_preserve_duration(&stereo, ratio, 32 * 1024 * 1024).unwrap();
            assert_eq!(
                shifted.len(),
                stereo.len(),
                "Duration must stay bit-exact at {}st",
                semitones
            );
            assert!(shifted.iter().all(|s| s.is_finite()));

            let mono_l: Vec<f32> = shifted.as_chunks::<2>().0.iter().map(|&[l, _]| l).collect();
            let mono_r: Vec<f32> = shifted.as_chunks::<2>().0.iter().map(|&[_, r]| r).collect();
            assert_eq!(mono_l, mono_r, "Identical stereo channels must stay phase-locked");

            let measured = dominant_freq_hz(&mono_l, sr);
            assert!(
                (measured - expected_hz).abs() <= tol_hz,
                "At {}st expected ~{:.1} Hz, got {:.1} Hz",
                semitones,
                expected_hz,
                measured
            );

            let out_rms = rms(&mono_l[2000..frames - 2000]);
            let in_rms = 0.7 / 2.0_f64.sqrt();
            let db_diff = 20.0 * (out_rms / in_rms).log10();
            assert!(
                db_diff.abs() < 2.0,
                "At {}st energy drift too large: {:.2} dB",
                semitones,
                db_diff
            );
        }
    }
}
