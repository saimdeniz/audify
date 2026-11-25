//! Export Peak & ITU-R BS.1770-4 Integrated LUFS Loudness Normalization DSP.
//!
//! Pure-Rust implementation with zero external crates:
//! - `-1.0 dBTP` peak normalization (with Catmull-Rom inter-sample true-peak estimation)
//! - `-14 LUFS` (Streaming) & `-24 LUFS` (Broadcast) integrated loudness using BS.1770-4
//!   2-stage K-weighting biquad filters dynamically derived for any sample rate
//! - Peak-safe linear ceiling cap (`-1.0 dBTP`) so transient SFX never clip or distort.

use std::f64::consts::PI;

/// Linear amplitude for `-1.0 dBTP` (`10^(-1 / 20)`).
const TRUE_PEAK_CEILING: f64 = 0.891_250_938_133_745_6;
/// Minimum peak amplitude below which audio is treated as digital silence (`-100 dBFS`).
const SILENCE_PEAK_FLOOR: f64 = 1e-5;
/// Maximum positive gain allowed in Peak mode (`+36 dB`) to avoid exploding noise floors.
const MAX_PEAK_BOOST: f64 = 63.095_734_448;
/// Maximum positive gain allowed in LUFS modes (`+24 dB`).
const MAX_LUFS_BOOST: f64 = 15.848_931_925;
/// Minimum attenuation factor (`-40 dB`).
const MIN_GAIN_FLOOR: f64 = 0.01;
/// ITU-R BS.1770-4 absolute gating threshold (`-70.0 LKFS`) converted to linear energy.
const ABSOLUTE_GATE_ENERGY: f64 = 1.172_465_304_751_118e-7; // 10^((-70.0 + 0.691) / 10.0)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExportLoudnessMode {
    #[default]
    Off,
    PeakM1,
    LufsM14,
    LufsM24,
}

impl ExportLoudnessMode {
    pub fn from_opt_str(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some("peak_m1") => Self::PeakM1,
            Some("lufs_m14") => Self::LufsM14,
            Some("lufs_m24") => Self::LufsM24,
            _ => Self::Off,
        }
    }

    pub fn filename_suffix(self) -> &'static str {
        match self {
            Self::Off => "",
            Self::PeakM1 => "_pk1",
            Self::LufsM14 => "_lufs14",
            Self::LufsM24 => "_lufs24",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct BiquadCoeffs {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

#[derive(Debug, Clone, Copy, Default)]
struct BiquadState {
    z1: f64,
    z2: f64,
}

impl BiquadState {
    #[inline]
    fn process(&mut self, x: f64, c: &BiquadCoeffs) -> f64 {
        // Transposed Direct Form II for high numerical stability on low-frequency poles.
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

/// ITU-R BS.1770-4 Stage 1 K-weighting high-shelf pre-filter (bilinear transform for any Fs).
fn k_weight_stage1(sample_rate: u32) -> BiquadCoeffs {
    let fs = (sample_rate.max(8_000)) as f64;
    let f0 = 1_681.974_450_955_533_f64.min(fs * 0.45);
    let g_db = 3.999_843_853_973_347_f64;
    let q = 0.707_175_236_955_419_6_f64;

    let k = (PI * f0 / fs).tan();
    let k2 = k * k;
    let vh = 10.0_f64.powf(g_db / 20.0);
    let vb = vh.powf(0.499_666_774_154_541_6);
    let a0 = 1.0 + k / q + k2;

    BiquadCoeffs {
        b0: (vh + vb * k / q + k2) / a0,
        b1: 2.0 * (k2 - vh) / a0,
        b2: (vh - vb * k / q + k2) / a0,
        a1: 2.0 * (k2 - 1.0) / a0,
        a2: (1.0 - k / q + k2) / a0,
    }
}

/// ITU-R BS.1770-4 Stage 2 K-weighting RLB high-pass filter (bilinear transform for any Fs).
fn k_weight_stage2(sample_rate: u32) -> BiquadCoeffs {
    let fs = (sample_rate.max(8_000)) as f64;
    let f0 = 38.135_470_876_024_44_f64.min(fs * 0.45);
    let q = 0.500_327_037_323_877_3_f64;

    let k = (PI * f0 / fs).tan();
    let k2 = k * k;
    let a0 = 1.0 + k / q + k2;

    BiquadCoeffs {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: 2.0 * (k2 - 1.0) / a0,
        a2: (1.0 - k / q + k2) / a0,
    }
}

/// 12-tap Hann-windowed 4x polyphase FIR coefficients for ITU-R BS.1770-4 true-peak estimation
/// at fractional phases `t = 0.25, 0.50, 0.75` (radius 6 -> catches >99% of Fs/4 inter-sample peaks).
fn true_peak_4x_fir() -> &'static [[f64; 12]; 3] {
    static COEFFS: std::sync::OnceLock<[[f64; 12]; 3]> = std::sync::OnceLock::new();
    COEFFS.get_or_init(|| {
        const PHASES: [f64; 3] = [0.25, 0.50, 0.75];
        let mut table = [[0.0_f64; 12]; 3];
        for (p_idx, &frac) in PHASES.iter().enumerate() {
            let mut sum = 0.0_f64;
            for (tap, slot) in table[p_idx].iter_mut().enumerate() {
                // taps span offsets -5..=+6 relative to base sample index
                let d = (tap as f64 - 5.0) - frac;
                let x = PI * d;
                let sinc = if x.abs() < 1e-12 { 1.0 } else { x.sin() / x };
                let win = 0.5 * (1.0 + (PI * d / 6.0).cos());
                let w = sinc * win;
                *slot = w;
                sum += w;
            }
            if sum.abs() > 1e-12 {
                for w in &mut table[p_idx] {
                    *w /= sum;
                }
            }
        }
        table
    })
}

/// Sanitizes non-finite samples and computes an ITU-R BS.1770-4 style 4x oversampled true peak
/// using a 12-tap Hann-windowed polyphase FIR across phases `0.25, 0.50, 0.75`.
fn estimate_true_peak_and_sanitize(samples: &mut [f32], channels: usize) -> f64 {
    let ch = channels.max(1);
    let frames = samples.len() / ch;
    let mut max_peak = 0.0_f64;

    for s in samples.iter_mut() {
        if !s.is_finite() {
            *s = 0.0;
        }
        let abs = (*s as f64).abs();
        if abs > max_peak {
            max_peak = abs;
        }
    }

    if frames >= 4 {
        let fir = true_peak_4x_fir();
        let last_f = (frames - 1) as isize;
        for c in 0..ch {
            for f in 0..frames.saturating_sub(1) {
                let mut ring = [0.0_f64; 12];
                for (tap, slot) in ring.iter_mut().enumerate() {
                    let idx = ((f as isize) + (tap as isize) - 5).clamp(0, last_f) as usize;
                    *slot = samples[idx * ch + c] as f64;
                }
                for phase in fir {
                    let mut acc = 0.0_f64;
                    for tap in 0..12 {
                        acc += ring[tap] * phase[tap];
                    }
                    let abs = acc.abs();
                    if abs > max_peak {
                        max_peak = abs;
                    }
                }
            }
        }
    }

    max_peak
}

/// Measures ITU-R BS.1770-4 gated integrated loudness in LUFS.
/// Falls back gracefully to whole-clip K-weighted energy for short one-shot SFX (< 400 ms).
pub fn measure_integrated_lufs(samples: &[f32], sample_rate: u32, channels: usize) -> Option<f64> {
    let ch = channels.max(1);
    let frames = samples.len() / ch;
    if frames == 0 || sample_rate == 0 {
        return None;
    }

    let c1 = k_weight_stage1(sample_rate);
    let c2 = k_weight_stage2(sample_rate);
    let mut s1 = vec![BiquadState::default(); ch];
    let mut s2 = vec![BiquadState::default(); ch];

    let hop_frames = ((sample_rate as usize * 100) / 1000).max(1);
    let block_frames = hop_frames * 4; // 400 ms block = 4 x 100 ms hops (75% overlap)

    // Ultra-short clips (< 400 ms): measure whole-clip K-weighted energy directly.
    if frames < block_frames {
        let mut total_energy = 0.0_f64;
        for f in 0..frames {
            let base = f * ch;
            for c in 0..ch {
                let raw = samples[base + c];
                let x = if raw.is_finite() { raw as f64 } else { 0.0 };
                let y = s2[c].process(s1[c].process(x, &c1), &c2);
                total_energy += y * y;
            }
        }
        let mean_energy = total_energy / (frames as f64);
        if !mean_energy.is_finite() || mean_energy <= ABSOLUTE_GATE_ENERGY {
            return None;
        }
        return Some(-0.691 + 10.0 * mean_energy.log10());
    }

    // Accumulate K-weighted squared energy per 100 ms hop to build 400 ms overlapping blocks
    // in O(N) time and tiny O(N / hop) memory. Also track the exact final 400 ms window
    // `[frames - block_frames .. frames]` so partial trailing audio (< 100 ms) is measured
    // with its true 400 ms weight instead of extrapolating a few samples across 100 ms.
    let mut hop_energies: Vec<f64> = Vec::with_capacity(frames / hop_frames + 1);
    let mut acc = 0.0_f64;
    let mut in_hop = 0usize;
    let tail_window_start = frames.saturating_sub(block_frames);
    let mut tail_block_energy = 0.0_f64;

    for f in 0..frames {
        let base = f * ch;
        let mut frame_energy = 0.0_f64;
        for c in 0..ch {
            let raw = samples[base + c];
            let x = if raw.is_finite() { raw as f64 } else { 0.0 };
            let y = s2[c].process(s1[c].process(x, &c1), &c2);
            frame_energy += y * y;
        }
        acc += frame_energy;
        if f >= tail_window_start {
            tail_block_energy += frame_energy;
        }
        in_hop += 1;
        if in_hop == hop_frames {
            hop_energies.push(acc);
            acc = 0.0;
            in_hop = 0;
        }
    }

    if hop_energies.len() < 4 {
        return None;
    }

    let inv_block_frames = 1.0 / (block_frames as f64);
    let mut abs_gated_blocks: Vec<f64> = Vec::with_capacity(hop_energies.len() - 2);
    let mut abs_sum = 0.0_f64;

    for w in hop_energies.windows(4) {
        let z_j = (w[0] + w[1] + w[2] + w[3]) * inv_block_frames;
        if z_j > ABSOLUTE_GATE_ENERGY {
            abs_gated_blocks.push(z_j);
            abs_sum += z_j;
        }
    }
    if in_hop > 0 {
        let z_tail = tail_block_energy * inv_block_frames;
        if z_tail > ABSOLUTE_GATE_ENERGY {
            abs_gated_blocks.push(z_tail);
            abs_sum += z_tail;
        }
    }

    if abs_gated_blocks.is_empty() {
        return None;
    }

    // Relative gate: -10 LU below mean energy of absolute-gated blocks (0.1x linear energy).
    let mean_abs = abs_sum / (abs_gated_blocks.len() as f64);
    let rel_threshold = mean_abs * 0.1;

    let mut rel_sum = 0.0_f64;
    let mut rel_count = 0usize;
    for &z_j in &abs_gated_blocks {
        if z_j > rel_threshold {
            rel_sum += z_j;
            rel_count += 1;
        }
    }

    let final_energy = if rel_count > 0 {
        rel_sum / (rel_count as f64)
    } else {
        mean_abs
    };

    if final_energy <= ABSOLUTE_GATE_ENERGY {
        return None;
    }

    Some(-0.691 + 10.0 * final_energy.log10())
}

/// Applies export Peak or LUFS normalization in-place to interleaved `f32` PCM samples.
/// Returns the linear gain factor applied (`1.0` when bypassed or silent).
pub fn apply_export_loudness_normalization(
    samples: &mut [f32],
    sample_rate: u32,
    channels: usize,
    mode: ExportLoudnessMode,
) -> f64 {
    if mode == ExportLoudnessMode::Off || samples.is_empty() {
        return 1.0;
    }

    let true_peak = estimate_true_peak_and_sanitize(samples, channels);
    if !true_peak.is_finite() || true_peak < SILENCE_PEAK_FLOOR {
        return 1.0;
    }

    let ceiling_gain = TRUE_PEAK_CEILING / true_peak;
    let gain = match mode {
        ExportLoudnessMode::Off => 1.0,
        // Never floor Peak attenuation so >0 dBFS 32-bit float sources attenuate cleanly without hard-clipping.
        ExportLoudnessMode::PeakM1 => ceiling_gain.min(MAX_PEAK_BOOST),
        ExportLoudnessMode::LufsM14 | ExportLoudnessMode::LufsM24 => {
            let target_lufs = match mode {
                ExportLoudnessMode::LufsM14 => -14.0,
                ExportLoudnessMode::LufsM24 => -24.0,
                _ => -14.0,
            };
            let Some(measured_lufs) = measure_integrated_lufs(samples, sample_rate, channels)
            else {
                return 1.0;
            };
            let raw_gain = 10.0_f64
                .powf((target_lufs - measured_lufs) / 20.0)
                .clamp(MIN_GAIN_FLOOR, MAX_LUFS_BOOST);
            // Peak-safe ceiling: guarantee zero clipping/distortion on spiky transients or hot float32 files.
            raw_gain.min(ceiling_gain)
        }
    };

    if !gain.is_finite() || (gain - 1.0).abs() < 1e-4 {
        return 1.0;
    }

    let g32 = gain as f32;
    let ceil32 = TRUE_PEAK_CEILING as f32;
    for s in samples.iter_mut() {
        *s = (*s * g32).clamp(-ceil32, ceil32);
    }

    gain
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_sine(sr: u32, channels: usize, secs: f64, freq: f64, amp: f32) -> Vec<f32> {
        let frames = (sr as f64 * secs).round() as usize;
        let mut out = Vec::with_capacity(frames * channels);
        for f in 0..frames {
            let v = ((2.0 * PI * freq * (f as f64) / (sr as f64)).sin() as f32) * amp;
            for _ in 0..channels {
                out.push(v);
            }
        }
        out
    }

    #[test]
    fn k_weight_coefficients_at_48khz_match_bs1770_4_spec() {
        let s1 = k_weight_stage1(48_000);
        assert!((s1.b0 - 1.535_124_859_586_97).abs() < 1e-6);
        assert!((s1.b1 - (-2.691_696_189_406_38)).abs() < 1e-6);
        assert!((s1.b2 - 1.198_392_810_852_85).abs() < 1e-6);
        assert!((s1.a1 - (-1.690_659_293_182_41)).abs() < 1e-6);
        assert!((s1.a2 - 0.732_480_774_215_85).abs() < 1e-6);

        let s2 = k_weight_stage2(48_000);
        assert!((s2.b0 - 1.0).abs() < 1e-9);
        assert!((s2.b1 - (-2.0)).abs() < 1e-9);
        assert!((s2.b2 - 1.0).abs() < 1e-9);
        assert!((s2.a1 - (-1.990_047_454_833_98)).abs() < 1e-6);
        assert!((s2.a2 - 0.990_072_250_366_21).abs() < 1e-6);
    }

    #[test]
    fn mode_parsing_and_suffixes_match_contract() {
        assert_eq!(ExportLoudnessMode::from_opt_str(None), ExportLoudnessMode::Off);
        assert_eq!(ExportLoudnessMode::from_opt_str(Some("off")), ExportLoudnessMode::Off);
        assert_eq!(ExportLoudnessMode::from_opt_str(Some("peak_m1")), ExportLoudnessMode::PeakM1);
        assert_eq!(ExportLoudnessMode::from_opt_str(Some("lufs_m14")), ExportLoudnessMode::LufsM14);
        assert_eq!(ExportLoudnessMode::from_opt_str(Some("lufs_m24")), ExportLoudnessMode::LufsM24);
        assert_eq!(ExportLoudnessMode::Off.filename_suffix(), "");
        assert_eq!(ExportLoudnessMode::PeakM1.filename_suffix(), "_pk1");
        assert_eq!(ExportLoudnessMode::LufsM14.filename_suffix(), "_lufs14");
        assert_eq!(ExportLoudnessMode::LufsM24.filename_suffix(), "_lufs24");
    }

    #[test]
    fn silence_stays_untouched_without_nan_or_boost() {
        let mut buf = vec![0.0f32; 48_000];
        let g = apply_export_loudness_normalization(&mut buf, 48_000, 1, ExportLoudnessMode::LufsM14);
        assert_eq!(g, 1.0);
        assert!(buf.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn peak_m1_normalizes_quiet_sine_to_minus_1_dbtp() {
        let mut buf = generate_sine(48_000, 1, 1.0, 1000.0, 0.1);
        apply_export_loudness_normalization(&mut buf, 48_000, 1, ExportLoudnessMode::PeakM1);
        let peak = buf.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
        assert!(
            (peak as f64 - TRUE_PEAK_CEILING).abs() < 0.01,
            "Expected peak ~0.8913 (-1 dBTP), got {}",
            peak
        );
    }

    #[test]
    fn lufs_m14_and_m24_hit_target_integrated_loudness() {
        // Stereo 1 kHz sine at 0.08 amplitude (~ -22.6 LUFS) -> normalize to -14 LUFS
        let mut buf14 = generate_sine(48_000, 2, 1.5, 1000.0, 0.08);
        apply_export_loudness_normalization(&mut buf14, 48_000, 2, ExportLoudnessMode::LufsM14);
        let measured14 = measure_integrated_lufs(&buf14, 48_000, 2).unwrap();
        assert!(
            (measured14 - (-14.0)).abs() < 0.25,
            "Expected ~ -14.0 LUFS, got {:.2}",
            measured14
        );

        // Loud stereo 1 kHz sine at 0.5 amplitude (~ -6.7 LUFS) -> attenuate to -24 LUFS
        let mut buf24 = generate_sine(44_100, 2, 1.5, 1000.0, 0.5);
        apply_export_loudness_normalization(&mut buf24, 44_100, 2, ExportLoudnessMode::LufsM24);
        let measured24 = measure_integrated_lufs(&buf24, 44_100, 2).unwrap();
        assert!(
            (measured24 - (-24.0)).abs() < 0.25,
            "Expected ~ -24.0 LUFS, got {:.2}",
            measured24
        );
    }

    #[test]
    fn short_oneshot_sfx_below_400ms_still_normalizes_and_never_clips() {
        // 120ms mono impact (< 400ms block)
        let mut short_sfx = generate_sine(48_000, 1, 0.12, 800.0, 0.05);
        let g = apply_export_loudness_normalization(
            &mut short_sfx,
            48_000,
            1,
            ExportLoudnessMode::LufsM14,
        );
        assert!(g > 2.0, "Short quiet SFX should still receive loudness boost, got gain {}", g);

        // Spiky transient + quiet body: LUFS target boost must be capped at -1 dBTP ceiling
        let mut spiky = generate_sine(48_000, 1, 1.0, 1000.0, 0.01);
        spiky[4000] = 0.5;
        apply_export_loudness_normalization(&mut spiky, 48_000, 1, ExportLoudnessMode::LufsM14);
        let max_sample = spiky.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
        assert!(
            (max_sample as f64) <= TRUE_PEAK_CEILING + 1e-4,
            "Peak-safe ceiling must prevent clipping on transient spikes (got {})",
            max_sample
        );
    }

    #[test]
    fn true_peak_4x_catches_intersample_peak_hot_float_and_sanitizes_nan() {
        // Fs/4 sine shifted by pi/4: discrete sample peaks are sqrt(2)/2 (~0.7071) while true peak is 1.0
        let mut isp = vec![0.0_f32; 256];
        for (i, slot) in isp.iter_mut().enumerate() {
            let phase = (std::f64::consts::FRAC_PI_2 * (i as f64)) + std::f64::consts::FRAC_PI_4;
            *slot = phase.sin() as f32;
        }
        let tp = estimate_true_peak_and_sanitize(&mut isp, 1);
        assert!(
            tp > 0.96,
            "4x cubic true-peak must catch Fs/4 inter-sample peak > 0.96, got {}",
            tp
        );

        // Hot +12 dBFS float32 (amplitude 4.0) must attenuate cleanly below -1 dBTP (never floored)
        let mut hot = generate_sine(48_000, 1, 0.5, 1000.0, 4.0);
        apply_export_loudness_normalization(&mut hot, 48_000, 1, ExportLoudnessMode::PeakM1);
        let peak_after = hot.iter().fold(0.0_f32, |m, &s| m.max(s.abs()));
        assert!(
            (peak_after as f64 - TRUE_PEAK_CEILING).abs() < 0.02,
            "Hot >0 dBFS float32 must attenuate to ~-1 dBTP, got {}",
            peak_after
        );

        // Non-finite samples must not poison measure_integrated_lufs into Some(NaN)
        let mut poisoned = generate_sine(48_000, 1, 0.6, 1000.0, 0.1);
        poisoned[100] = f32::NAN;
        poisoned[200] = f32::INFINITY;
        let lufs = measure_integrated_lufs(&poisoned, 48_000, 1);
        assert!(lufs.is_some_and(|v| v.is_finite()), "Expected finite LUFS, got {:?}", lufs);
    }

    #[test]
    fn trailing_single_hot_sample_after_400ms_does_not_inflate_lufs() {
        // 400 ms quiet tone (~ -20.7 LUFS) plus 1 single trailing 1.0 sample at 48 kHz
        let mut clip = generate_sine(48_000, 1, 0.4, 1000.0, 0.1);
        let base_lufs = measure_integrated_lufs(&clip, 48_000, 1).unwrap();
        clip.push(1.0_f32);
        let with_tail_lufs = measure_integrated_lufs(&clip, 48_000, 1).unwrap();
        assert!(
            (with_tail_lufs - base_lufs).abs() < 0.5,
            "1 trailing sample after 400 ms must not inflate LUFS (base={:.2}, with_tail={:.2})",
            base_lufs,
            with_tail_lufs
        );
    }
}
