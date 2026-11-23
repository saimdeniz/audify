use super::filename_parser::{MAJOR_DISPLAY_AND_CAMELOT, MINOR_DISPLAY_AND_CAMELOT};
use std::f32::consts::PI;

const KRUMHANSL_MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

const KRUMHANSL_MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// ============================================================================
// Pure-Rust Iterative Radix-2 Cooley-Tukey FFT
// ============================================================================

/// In-place forward complex FFT (`re.len() == im.len()`, power of 2).
pub fn fft_radix2(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    debug_assert_eq!(n, im.len());
    debug_assert!(n.is_power_of_two());
    if n <= 1 {
        return;
    }

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

    // Butterfly stages
    let mut len = 2usize;
    while len <= n {
        let half = len >> 1;
        let angle = -2.0 * PI / (len as f32);
        let w_step_re = angle.cos();
        let w_step_im = angle.sin();

        let mut base = 0usize;
        while base < n {
            let mut w_re = 1.0_f32;
            let mut w_im = 0.0_f32;
            for k in 0..half {
                let even = base + k;
                let odd = even + half;
                let t_re = w_re * re[odd] - w_im * im[odd];
                let t_im = w_re * im[odd] + w_im * re[odd];

                re[odd] = re[even] - t_re;
                im[odd] = im[even] - t_im;
                re[even] += t_re;
                im[even] += t_im;

                let next_w_re = w_re * w_step_re - w_im * w_step_im;
                let next_w_im = w_re * w_step_im + w_im * w_step_re;
                w_re = next_w_re;
                w_im = next_w_im;
            }
            base += len;
        }
        len <<= 1;
    }
}

fn build_hann_window(size: usize) -> Vec<f32> {
    if size <= 1 {
        return vec![1.0; size];
    }
    let denom = (size - 1) as f32;
    (0..size)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * (i as f32) / denom).cos()))
        .collect()
}

/// Estimates tempo (`60.0 ..= 200.0 BPM`) from a mono signal (`sample_rate` ~ 11025..48000 Hz).
/// Returns `None` for short clips (`< 1.5s`) or non-rhythmic/ambience audio failing confidence gating.
pub fn estimate_bpm_from_mono(mono: &[f32], sample_rate: u32) -> Option<f64> {
    if sample_rate == 0 {
        return None;
    }
    let duration_sec = mono.len() as f64 / sample_rate as f64;
    if duration_sec < 1.5 {
        return None;
    }

    let fft_size = 1024usize;
    let hop_size = 256usize;
    if mono.len() < fft_size + hop_size * 8 {
        return None;
    }

    let hann = build_hann_window(fft_size);
    let half_bins = fft_size / 2;
    let mut re = vec![0.0_f32; fft_size];
    let mut im = vec![0.0_f32; fft_size];
    let mut prev_mag = vec![0.0_f32; half_bins];
    let mut flux: Vec<f32> = Vec::with_capacity((mono.len() - fft_size) / hop_size + 1);

    let mut pos = 0usize;
    let mut is_first = true;
    while pos + fft_size <= mono.len() {
        for i in 0..fft_size {
            re[i] = mono[pos + i] * hann[i];
            im[i] = 0.0;
        }
        fft_radix2(&mut re, &mut im);

        let norm_scale = 4.0 / (fft_size as f32);
        let mut frame_flux = 0.0_f32;
        for b in 1..half_bins {
            let mag = (re[b] * re[b] + im[b] * im[b]).sqrt() * norm_scale;
            let log_mag = (1.0 + 20.0 * mag).ln();
            if !is_first {
                let diff = log_mag - prev_mag[b];
                if diff > 0.0 {
                    frame_flux += diff;
                }
            }
            prev_mag[b] = log_mag;
        }
        flux.push(if is_first { 0.0 } else { frame_flux });
        is_first = false;
        pos += hop_size;
    }

    let env_rate = sample_rate as f64 / hop_size as f64;
    let half_win = ((0.18 * env_rate).round() as usize).max(2);
    let mut onset = vec![0.0_f32; flux.len()];
    for i in 0..flux.len() {
        let start = i.saturating_sub(half_win);
        let end = (i + half_win + 1).min(flux.len());
        let sum: f32 = flux[start..end].iter().sum();
        let mean = sum / ((end - start) as f32);
        let v = flux[i] - mean;
        onset[i] = if v > 0.0 { v } else { 0.0 };
    }

    let onset_mean = (onset.iter().map(|&v| v as f64).sum::<f64>()) / (onset.len() as f64);
    let centered: Vec<f64> = onset.iter().map(|&v| (v as f64) - onset_mean).collect();
    let zero_var: f64 = centered.iter().map(|&v| v * v).sum();
    if zero_var <= 1e-9 {
        return None;
    }

    let min_lag = ((60.0 * env_rate) / 200.0).floor().max(2.0) as usize;
    let max_lag = (((60.0 * env_rate) / 60.0).ceil() as usize).min(centered.len() / 2);
    if max_lag <= min_lag + 2 {
        return None;
    }

    let mut corr = vec![0.0_f64; max_lag + 1];
    let mut weighted = vec![0.0_f64; max_lag + 1];
    let mut corr_sum = 0.0_f64;
    let lag_count = (max_lag - min_lag + 1) as f64;

    for lag in min_lag..=max_lag {
        let count = centered.len() - lag;
        let mut dot = 0.0_f64;
        let mut e_a = 0.0_f64;
        let mut e_b = 0.0_f64;
        for i in 0..count {
            let a = centered[i];
            let b = centered[i + lag];
            dot += a * b;
            e_a += a * a;
            e_b += b * b;
        }
        let denom = (e_a * e_b).sqrt();
        let norm_r = if denom > 1e-9 { dot / denom } else { 0.0 };
        corr[lag] = norm_r;
        corr_sum += norm_r.max(0.0);

        // Gentle log-Gaussian perceptual tempo prior centered at 120 BPM
        let bpm = (60.0 * env_rate) / (lag as f64);
        let log_oct = (bpm / 120.0).log2();
        let prior = (-0.5 * (log_oct / 0.85).powi(2)).exp();
        // Reinforce with 2x lag (two-beat periodicity) when available
        let mut combo = norm_r.max(0.0);
        if lag * 2 < centered.len() / 2 {
            let mut dot2 = 0.0_f64;
            let mut ea2 = 0.0_f64;
            let mut eb2 = 0.0_f64;
            let c2 = centered.len() - lag * 2;
            for i in 0..c2 {
                let a = centered[i];
                let b = centered[i + lag * 2];
                dot2 += a * b;
                ea2 += a * a;
                eb2 += b * b;
            }
            let d2 = (ea2 * eb2).sqrt();
            if d2 > 1e-9 {
                combo = 0.75 * combo + 0.25 * (dot2 / d2).max(0.0);
            }
        }
        weighted[lag] = combo * (0.75 + 0.25 * prior);
    }

    let mut best_lag = min_lag;
    let mut best_score = 0.0_f64;
    for (lag, &score) in weighted.iter().enumerate().take(max_lag + 1).skip(min_lag) {
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    let mean_pos_corr = corr_sum / lag_count;
    // Confidence gate: reject non-periodic foley / ambience / white noise
    if corr[best_lag] < 0.24 || (corr[best_lag] - mean_pos_corr) < 0.18 {
        return None;
    }

    // Parabolic sub-sample lag refinement on the same weighted curve where best_lag peaked
    let refined_lag = if best_lag > min_lag && best_lag < max_lag {
        let y_prev = weighted[best_lag - 1];
        let y_curr = weighted[best_lag];
        let y_next = weighted[best_lag + 1];
        let denom = y_prev - 2.0 * y_curr + y_next;
        if denom < -1e-9 {
            let delta = (0.5 * (y_prev - y_next) / denom).clamp(-0.5, 0.5);
            best_lag as f64 + delta
        } else {
            best_lag as f64
        }
    } else {
        best_lag as f64
    };

    let raw_bpm = (60.0 * env_rate) / refined_lag;
    if !(60.0..=200.0).contains(&raw_bpm) {
        return None;
    }

    let nearest_int = raw_bpm.round();
    let final_bpm = if (raw_bpm - nearest_int).abs() <= 0.25 {
        nearest_int
    } else {
        (raw_bpm * 10.0).round() / 10.0
    };
    Some(final_bpm)
}

fn pearson_corr_12(x: &[f32; 12], y: &[f32; 12]) -> f32 {
    let mean_x = x.iter().sum::<f32>() / 12.0;
    let mean_y = y.iter().sum::<f32>() / 12.0;
    let mut cov = 0.0_f32;
    let mut vx = 0.0_f32;
    let mut vy = 0.0_f32;
    for i in 0..12 {
        let dx = x[i] - mean_x;
        let dy = y[i] - mean_y;
        cov += dx * dy;
        vx += dx * dx;
        vy += dy * dy;
    }
    let denom = (vx * vy).sqrt();
    if denom > 1e-9 {
        cov / denom
    } else {
        0.0
    }
}

/// Estimates Musical Key & Camelot (`1A..12B`) from a mono signal using a `4096`-point STFT
/// 12-bin chromagram, Wiener spectral flatness noise gating, and Krumhansl-Kessler correlation.
/// Returns `None` for atonal/noisy sound effects.
pub fn estimate_key_from_mono(mono: &[f32], sample_rate: u32) -> Option<(String, String)> {
    if sample_rate < 8000 {
        return None;
    }

    let fft_size = 4096usize;
    let hop_size = 2048usize;
    if mono.len() < fft_size {
        return None;
    }

    let hann = build_hann_window(fft_size);
    let half_bins = fft_size / 2;
    let bin_hz = sample_rate as f32 / fft_size as f32;

    let min_flat_bin = ((80.0 / bin_hz).ceil() as usize).max(1);
    let max_flat_bin = ((5000.0 / bin_hz).floor() as usize).min(half_bins - 1);
    let min_chroma_bin = ((85.0 / bin_hz).ceil() as usize).max(2);
    let max_chroma_bin = ((3500.0 / bin_hz).floor() as usize).min(half_bins - 2);
    if max_chroma_bin <= min_chroma_bin || max_flat_bin <= min_flat_bin {
        return None;
    }

    let mut re = vec![0.0_f32; fft_size];
    let mut im = vec![0.0_f32; fft_size];
    let mut mags = vec![0.0_f32; max_chroma_bin + 2];
    let norm_scale = 4.0 / (fft_size as f32);
    let mut chroma = [0.0_f32; 12];
    let mut active_frames = 0usize;
    let mut tonal_frames = 0usize;
    let mut flatness_sum = 0.0_f32;

    let mut pos = 0usize;
    while pos + fft_size <= mono.len() {
        let mut frame_rms_sq = 0.0_f32;
        for i in 0..fft_size {
            let s = mono[pos + i];
            frame_rms_sq += s * s;
            re[i] = s * hann[i];
            im[i] = 0.0;
        }
        pos += hop_size;

        let frame_rms = (frame_rms_sq / (fft_size as f32)).sqrt();
        if frame_rms < 0.002 {
            continue;
        }
        active_frames += 1;

        fft_radix2(&mut re, &mut im);

        // Wiener spectral flatness (`exp(mean(ln(P))) / mean(P)`) to reject white noise / impacts
        let mut log_sum = 0.0_f32;
        let mut arith_sum = 0.0_f32;
        let flat_count = (max_flat_bin - min_flat_bin + 1) as f32;
        for b in min_flat_bin..=max_flat_bin {
            let p = (re[b] * re[b] + im[b] * im[b]).max(1e-12);
            log_sum += p.ln();
            arith_sum += p;
        }
        let geom_mean = (log_sum / flat_count).exp();
        let arith_mean = (arith_sum / flat_count).max(1e-12);
        let flatness = (geom_mean / arith_mean).clamp(0.0, 1.0);
        flatness_sum += flatness;

        if flatness > 0.42 {
            continue;
        }

        let mut frame_max_mag = 0.0_f32;
        for b in (min_chroma_bin - 1)..=(max_chroma_bin + 1) {
            let m = (re[b] * re[b] + im[b] * im[b]).sqrt() * norm_scale;
            mags[b] = m;
            if b >= min_chroma_bin && b <= max_chroma_bin && m > frame_max_mag {
                frame_max_mag = m;
            }
        }
        if frame_max_mag < 0.002 {
            continue;
        }
        tonal_frames += 1;

        // Parabolic-interpolated local spectral peaks (-30 dB relative threshold eliminates sidelobes)
        let mag_floor = (frame_max_mag * 0.03).max(0.0008);
        for b in min_chroma_bin..=max_chroma_bin {
            let m0 = mags[b];
            if m0 < mag_floor || m0 <= mags[b - 1] || m0 < mags[b + 1] {
                continue;
            }
            let ml = mags[b - 1];
            let mr = mags[b + 1];
            let denom = ml - 2.0 * m0 + mr;
            let delta = if denom.abs() > 1e-7 {
                (0.5 * (ml - mr) / denom).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            let freq = ((b as f32) + delta) * bin_hz;
            // MIDI pitch where C4 = 60, A4 = 69 (440 Hz)
            let midi = 69.0 + 12.0 * (freq / 440.0).log2();
            let nearest_midi = midi.round();
            let cents_off = (midi - nearest_midi).abs();
            if cents_off > 0.45 {
                continue;
            }
            let weight = (-0.5 * (cents_off / 0.25).powi(2)).exp();
            let pc = (nearest_midi as i32).rem_euclid(12) as usize;
            chroma[pc] += m0.powf(0.65) * weight;
        }
    }

    if active_frames == 0 || tonal_frames == 0 {
        return None;
    }
    let avg_flatness = flatness_sum / (active_frames as f32);
    let tonal_ratio = (tonal_frames as f32) / (active_frames as f32);
    if avg_flatness > 0.36 || tonal_ratio < 0.25 {
        return None;
    }

    let chroma_sum: f32 = chroma.iter().sum();
    if chroma_sum <= 1e-6 {
        return None;
    }

    let mut scores: Vec<(f32, usize, bool)> = Vec::with_capacity(24);
    for root in 0..12usize {
        let mut rotated_maj = [0.0_f32; 12];
        let mut rotated_min = [0.0_f32; 12];
        for i in 0..12 {
            let pc = (root + i) % 12;
            rotated_maj[pc] = KRUMHANSL_MAJOR[i];
            rotated_min[pc] = KRUMHANSL_MINOR[i];
        }
        scores.push((pearson_corr_12(&chroma, &rotated_maj), root, false));
        scores.push((pearson_corr_12(&chroma, &rotated_min), root, true));
    }

    scores.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let (best_r, best_root, best_is_minor) = scores[0];
    let fourth_r = scores[3].0;

    // Require strong correlation and clear separation over non-relative competing keys
    if best_r < 0.48 || (best_r - fourth_r) < 0.05 {
        return None;
    }

    let (mkey, cam) = if best_is_minor {
        MINOR_DISPLAY_AND_CAMELOT[best_root]
    } else {
        MAJOR_DISPLAY_AND_CAMELOT[best_root]
    };
    Some((mkey.to_string(), cam.to_string()))
}
