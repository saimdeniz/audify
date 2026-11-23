use super::decoder::{AudioSource, DecodedTrack};
use super::streaming::StreamRing;
use std::sync::MutexGuard;

enum SourceReader<'a> {
    InMemory(&'a DecodedTrack),
    Streaming(Option<MutexGuard<'a, StreamRing>>),
}

impl<'a> SourceReader<'a> {
    fn from_source(src: &'a AudioSource) -> Self {
        match src {
            AudioSource::InMemory(t) => Self::InMemory(t),
            AudioSource::Streaming(t) => Self::Streaming(t.try_lock_ring()),
        }
    }

    #[inline]
    fn read_frame(&self, frame: i64) -> Option<(f32, f32)> {
        match self {
            Self::InMemory(t) => t.read_frame(frame),
            Self::Streaming(Some(guard)) => guard.read_frame(frame),
            Self::Streaming(None) => None,
        }
    }

    fn advance_floor(&mut self, playhead_frame: u64) {
        if let Self::Streaming(Some(guard)) = self {
            guard.advance_read_floor(playhead_frame);
        }
    }
}

/// 4-point Cubic Hermite (Catmull-Rom) interpolator for smooth zero-latency
/// varispeed (`-24..+24 st`) and arbitrary sample-rate conversion.
#[inline]
pub fn hermite4(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c0 = y1;
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * t + c2) * t + c1) * t + c0
}

/// Transparent limiter: unity gain below `0.98`, smooth `tanh` ceiling at `1.0`.
#[inline]
pub fn soft_limit(x: f32) -> f32 {
    if !x.is_finite() {
        return 0.0;
    }
    let ax = x.abs();
    if ax <= 0.98 {
        x
    } else {
        let excess = (ax - 0.98) / 0.02;
        x.signum() * (0.98 + 0.02 * excess.tanh())
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum FadeMode {
    Steady,
    FadeIn,
    FadeOutToPause,
    FadeOutToStop,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DspRenderEvents {
    pub ended: bool,
    pub looped: bool,
    pub became_paused: bool,
}

/// Real-time lock-free-compatible stereo playback DSP core.
/// Zero heap allocations in `render_into`; fully deterministic and unit-testable.
pub struct PlaybackDsp {
    source: Option<AudioSource>,
    out_sample_rate: u32,
    playing: bool,
    looping: bool,
    volume: f32,
    pitch_semitones: f32,
    normalize_preview: bool,
    slice_start_sec: Option<f64>,
    slice_end_sec: Option<f64>,
    respect_slice_bounds: bool,
    playhead_frame: f64,
    gain_smooth: f32,
    fade_env: f32,
    fade_mode: FadeMode,
    last_out_l: f32,
    last_out_r: f32,
    declick_l: f32,
    declick_r: f32,
    declick_env: f32,
}

impl PlaybackDsp {
    pub fn new(out_sample_rate: u32) -> Self {
        Self {
            source: None,
            out_sample_rate: out_sample_rate.max(8000),
            playing: false,
            looping: false,
            volume: 0.85,
            pitch_semitones: 0.0,
            normalize_preview: false,
            slice_start_sec: None,
            slice_end_sec: None,
            respect_slice_bounds: true,
            playhead_frame: 0.0,
            gain_smooth: 0.85,
            fade_env: 0.0,
            fade_mode: FadeMode::Steady,
            last_out_l: 0.0,
            last_out_r: 0.0,
            declick_l: 0.0,
            declick_r: 0.0,
            declick_env: 0.0,
        }
    }

    pub fn set_out_sample_rate(&mut self, sr: u32) {
        self.out_sample_rate = sr.max(8000);
    }

    pub fn load_source(
        &mut self,
        source: AudioSource,
        autoplay: bool,
        start_sec: f64,
        slice_start_sec: Option<f64>,
        slice_end_sec: Option<f64>,
    ) {
        let sr = source.sample_rate().max(1) as f64;
        let max_frame = source.total_frames() as f64;
        let clamped_frame = (start_sec.max(0.0) * sr).min(max_frame);
        source.request_seek(clamped_frame.floor() as u64);

        if self.playing && (self.last_out_l.abs() > 1e-4 || self.last_out_r.abs() > 1e-4) {
            self.declick_l = self.last_out_l;
            self.declick_r = self.last_out_r;
            self.declick_env = 1.0;
        }
        self.slice_start_sec = slice_start_sec;
        self.slice_end_sec = slice_end_sec;
        self.respect_slice_bounds = true;
        self.source = Some(source);
        self.playhead_frame = clamped_frame;
        self.gain_smooth = self.target_gain();
        self.playing = autoplay;
        if autoplay {
            self.fade_env = 0.0;
            self.fade_mode = FadeMode::FadeIn;
        } else {
            self.fade_env = 0.0;
            self.fade_mode = FadeMode::Steady;
        }
    }

    pub fn clear_source(&mut self) -> Option<AudioSource> {
        if self.playing && (self.last_out_l.abs() > 1e-4 || self.last_out_r.abs() > 1e-4) {
            self.declick_l = self.last_out_l;
            self.declick_r = self.last_out_r;
            self.declick_env = 1.0;
        }
        self.playing = false;
        self.fade_env = 0.0;
        self.fade_mode = FadeMode::Steady;
        self.playhead_frame = 0.0;
        self.source.take()
    }

    pub fn active_path_norm(&self) -> Option<&str> {
        self.source.as_ref().map(|s| s.path_norm())
    }

    pub fn is_playing(&self) -> bool {
        self.playing && !matches!(self.fade_mode, FadeMode::FadeOutToPause | FadeMode::FadeOutToStop)
    }

    pub fn is_rendering_audio(&self) -> bool {
        self.playing
    }

    pub fn position_sec(&self) -> f64 {
        let Some(src) = self.source.as_ref() else {
            return 0.0;
        };
        let sr = src.sample_rate().max(1) as f64;
        (self.playhead_frame / sr).max(0.0)
    }

    pub fn duration_sec(&self) -> f64 {
        self.source.as_ref().map(|s| s.duration_sec()).unwrap_or(0.0)
    }

    pub fn playback_rate(&self) -> f64 {
        let st = self.pitch_semitones.clamp(-24.0, 24.0) as f64;
        if st == 0.0 {
            1.0
        } else {
            2.0_f64.powf(st / 12.0).clamp(0.25, 4.0)
        }
    }

    pub fn set_params(
        &mut self,
        volume: Option<f32>,
        pitch_semitones: Option<f32>,
        looping: Option<bool>,
        normalize_preview: Option<bool>,
        slice_range: Option<Option<(f64, f64)>>,
    ) {
        if let Some(v) = volume {
            if v.is_finite() {
                self.volume = v.clamp(0.0, 1.0);
            }
        }
        if let Some(p) = pitch_semitones {
            if p.is_finite() {
                self.pitch_semitones = p.clamp(-24.0, 24.0);
            }
        }
        if let Some(l) = looping {
            self.looping = l;
        }
        if let Some(n) = normalize_preview {
            self.normalize_preview = n;
        }
        if let Some(slice_opt) = slice_range {
            match slice_opt {
                Some((s, e)) if s.is_finite() && e.is_finite() && e > s => {
                    self.slice_start_sec = Some(s.max(0.0));
                    self.slice_end_sec = Some(e.max(0.0));
                    self.respect_slice_bounds = true;
                }
                _ => {
                    self.slice_start_sec = None;
                    self.slice_end_sec = None;
                    self.respect_slice_bounds = true;
                }
            }
        }
    }

    pub fn play(&mut self) {
        let Some(src) = self.source.as_ref() else {
            return;
        };
        let (start_f, end_f) = if self.respect_slice_bounds {
            self.active_frame_bounds(src)
        } else {
            (0.0, src.total_frames().max(1) as f64)
        };
        if self.playhead_frame >= end_f - 1.0 || self.playhead_frame < start_f {
            self.playhead_frame = start_f;
            src.request_seek(start_f.floor() as u64);
        }
        self.playing = true;
        self.fade_mode = FadeMode::FadeIn;
    }

    pub fn pause(&mut self) {
        if self.playing {
            self.fade_mode = FadeMode::FadeOutToPause;
        }
    }

    pub fn stop(&mut self) {
        self.respect_slice_bounds = true;
        if self.playing {
            self.fade_mode = FadeMode::FadeOutToStop;
        } else if let Some(src) = self.source.as_ref() {
            let (start_f, _) = self.active_frame_bounds(src);
            self.playhead_frame = start_f;
            src.request_seek(start_f.floor() as u64);
        }
    }

    pub fn seek_sec(&mut self, target_sec: f64) {
        let Some(src) = self.source.as_ref() else {
            return;
        };
        let sr = src.sample_rate().max(1) as f64;
        let total = src.total_frames().max(1) as f64;
        let target_f = (target_sec.max(0.0) * sr).clamp(0.0, total);
        let has_slice = self.slice_start_sec.is_some() && self.slice_end_sec.is_some();
        if has_slice {
            let (slice_start_f, slice_end_f) = self.active_frame_bounds(src);
            self.respect_slice_bounds =
                target_f >= slice_start_f - 1.0 && target_f <= slice_end_f + 1.0;
        } else {
            self.respect_slice_bounds = true;
        }
        if self.playing && (self.last_out_l.abs() > 1e-4 || self.last_out_r.abs() > 1e-4) {
            self.declick_l = self.last_out_l;
            self.declick_r = self.last_out_r;
            self.declick_env = 1.0;
        }
        self.playhead_frame = target_f;
        src.request_seek(target_f.floor() as u64);
        if self.playing {
            self.fade_env = 0.0;
            self.fade_mode = FadeMode::FadeIn;
        }
    }

    #[inline]
    fn target_gain(&self) -> f32 {
        let norm = if self.normalize_preview {
            self.source.as_ref().map(|s| s.norm_gain()).unwrap_or(1.0)
        } else {
            1.0
        };
        (self.volume * norm).clamp(0.0, 1.0)
    }

    #[inline]
    fn active_frame_bounds(&self, src: &AudioSource) -> (f64, f64) {
        let sr = src.sample_rate().max(1) as f64;
        let total = src.total_frames().max(1) as f64;
        match (self.slice_start_sec, self.slice_end_sec) {
            (Some(s), Some(e)) if e > s => {
                let sf = (s * sr).clamp(0.0, (total - 1.0).max(0.0));
                let ef = (e * sr).clamp(sf + 1.0, total);
                (sf, ef)
            }
            _ => (0.0, total),
        }
    }

    #[inline]
    fn sample_hermite(reader: &SourceReader<'_>, pos: f64) -> Option<(f32, f32)> {
        let base = pos.floor() as i64;
        let t = (pos - (base as f64)) as f32;
        let s1 = reader.read_frame(base)?;
        let s0 = reader.read_frame(base - 1).unwrap_or(s1);
        let s2 = reader.read_frame(base + 1).unwrap_or(s1);
        let s3 = reader.read_frame(base + 2).unwrap_or(s2);
        Some((
            hermite4(s0.0, s1.0, s2.0, s3.0, t),
            hermite4(s0.1, s1.1, s2.1, s3.1, t),
        ))
    }

    #[inline]
    fn sample_with_aa(reader: &SourceReader<'_>, pos: f64, step: f64) -> Option<(f32, f32)> {
        if step <= 1.5 {
            Self::sample_hermite(reader, pos)
        } else {
            // 2-tap oversampled Nyquist pre-filter when pitching far up (+7..+24 st)
            let a = Self::sample_hermite(reader, (pos - 0.25 * step).max(0.0))?;
            let b = Self::sample_hermite(reader, pos + 0.25 * step).unwrap_or(a);
            Some((0.5 * (a.0 + b.0), 0.5 * (a.1 + b.1)))
        }
    }

    /// Renders `out.len() / out_channels` frames into `out` without allocating.
    pub fn render_into(&mut self, out: &mut [f32], out_channels: usize) -> DspRenderEvents {
        let mut events = DspRenderEvents::default();
        if out_channels == 0 || out.is_empty() {
            return events;
        }
        let fade_step = 1.0_f32 / ((self.out_sample_rate as f32) * 0.0028).max(16.0);
        if !self.playing || self.source.is_none() {
            if self.declick_env > 0.0 {
                for frame_out in out.chunks_exact_mut(out_channels) {
                    if self.declick_env > 0.0 {
                        let out_l = self.declick_l * self.declick_env;
                        let out_r = self.declick_r * self.declick_env;
                        self.declick_env = (self.declick_env - fade_step).max(0.0);
                        match out_channels {
                            1 => frame_out[0] = 0.5 * (out_l + out_r),
                            2 => {
                                frame_out[0] = out_l;
                                frame_out[1] = out_r;
                            }
                            _ => {
                                frame_out.fill(0.0);
                                frame_out[0] = out_l;
                                frame_out[1] = out_r;
                            }
                        }
                    } else {
                        frame_out.fill(0.0);
                    }
                }
                self.last_out_l = 0.0;
                self.last_out_r = 0.0;
            } else {
                out.fill(0.0);
            }
            return events;
        }

        let gain_step = 1.0_f32 / ((self.out_sample_rate as f32) * 0.003).max(16.0);
        let target_gain = self.target_gain();
        let rate = self.playback_rate();
        let out_sr = self.out_sample_rate.max(8000) as f64;
        let has_slice =
            self.respect_slice_bounds && self.slice_start_sec.is_some() && self.slice_end_sec.is_some();

        let Some(src) = self.source.as_ref() else {
            out.fill(0.0);
            self.playing = false;
            return events;
        };
        let src_sr = src.sample_rate().max(1) as f64;
        let step = (src_sr / out_sr) * rate;
        let (start_f, end_f) = if has_slice {
            self.active_frame_bounds(src)
        } else {
            (0.0, src.total_frames().max(1) as f64)
        };
        let src_eof = src.is_eof();
        // Acquire streaming ring lock ONCE per audio callback buffer (zero per-sample mutex ops)
        let mut reader = SourceReader::from_source(src);
        let mut pending_rt_seek: Option<u64> = None;

        for frame_out in out.chunks_exact_mut(out_channels) {
            if !self.playing {
                frame_out.fill(0.0);
                self.last_out_l = 0.0;
                self.last_out_r = 0.0;
                continue;
            }

            // Smooth gain slew (anti-click volume / auto-gain transitions)
            let g_diff = target_gain - self.gain_smooth;
            if g_diff.abs() <= gain_step {
                self.gain_smooth = target_gain;
            } else {
                self.gain_smooth += g_diff.signum() * gain_step;
            }

            // Envelope state machine (anti-click fade-in / fade-out)
            match self.fade_mode {
                FadeMode::Steady => {
                    self.fade_env = 1.0;
                }
                FadeMode::FadeIn => {
                    self.fade_env = (self.fade_env + fade_step).min(1.0);
                    if self.fade_env >= 1.0 {
                        self.fade_mode = FadeMode::Steady;
                    }
                }
                FadeMode::FadeOutToPause => {
                    self.fade_env = (self.fade_env - fade_step).max(0.0);
                    if self.fade_env <= 0.0 {
                        self.playing = false;
                        self.fade_mode = FadeMode::Steady;
                        events.became_paused = true;
                        frame_out.fill(0.0);
                        self.last_out_l = 0.0;
                        self.last_out_r = 0.0;
                        continue;
                    }
                }
                FadeMode::FadeOutToStop => {
                    self.fade_env = (self.fade_env - fade_step).max(0.0);
                    if self.fade_env <= 0.0 {
                        self.playing = false;
                        self.fade_mode = FadeMode::Steady;
                        self.playhead_frame = start_f;
                        pending_rt_seek = Some(start_f.floor() as u64);
                        frame_out.fill(0.0);
                        self.last_out_l = 0.0;
                        self.last_out_r = 0.0;
                        continue;
                    }
                }
            }

            // Boundary / 0-sample slice loop check
            let at_end = self.playhead_frame >= end_f && (has_slice || src_eof);
            if at_end {
                if self.looping {
                    let overshoot = (self.playhead_frame - end_f).max(0.0);
                    let span = (end_f - start_f).max(1.0);
                    self.playhead_frame = start_f + (overshoot % span);
                    pending_rt_seek = Some(self.playhead_frame.floor() as u64);
                    events.looped = true;
                } else {
                    self.playing = false;
                    self.fade_env = 0.0;
                    self.fade_mode = FadeMode::Steady;
                    self.playhead_frame = start_f;
                    pending_rt_seek = Some(start_f.floor() as u64);
                    events.ended = true;
                    frame_out.fill(0.0);
                    self.last_out_l = 0.0;
                    self.last_out_r = 0.0;
                    continue;
                }
            }

            let Some((mut l, mut r)) = Self::sample_with_aa(&reader, self.playhead_frame, step)
            else {
                // Streaming buffer momentarily refilling after seek -> output silence without advancing
                frame_out.fill(0.0);
                self.last_out_l = 0.0;
                self.last_out_r = 0.0;
                continue;
            };

            // 2.5 ms anti-click crossfade at loop seam (both slice & full-track loops!)
            let span_len = end_f - start_f;
            let xfade_len = (src_sr * 0.0025).min(span_len * 0.25);
            if self.looping && xfade_len >= 4.0 && self.playhead_frame >= end_f - xfade_len {
                let alpha = ((self.playhead_frame - (end_f - xfade_len)) / xfade_len)
                    .clamp(0.0, 1.0) as f32;
                let head_pos = start_f + (self.playhead_frame - (end_f - xfade_len));
                if let Some((hl, hr)) = Self::sample_with_aa(&reader, head_pos, step) {
                    l = l * (1.0 - alpha) + hl * alpha;
                    r = r * (1.0 - alpha) + hr * alpha;
                }
            } else if has_slice
                && !self.looping
                && xfade_len >= 4.0
                && self.playhead_frame >= end_f - xfade_len
            {
                // Anti-click micro fade-out approaching non-looping slice boundary
                let rem = ((end_f - self.playhead_frame) / xfade_len).clamp(0.0, 1.0) as f32;
                l *= rem;
                r *= rem;
            }

            let env = self.gain_smooth * self.fade_env;
            let mut mix_l = l * env;
            let mut mix_r = r * env;
            if self.declick_env > 0.0 {
                mix_l += self.declick_l * self.declick_env;
                mix_r += self.declick_r * self.declick_env;
                self.declick_env = (self.declick_env - fade_step).max(0.0);
            }
            let out_l = soft_limit(mix_l);
            let out_r = soft_limit(mix_r);
            self.last_out_l = out_l;
            self.last_out_r = out_r;

            match out_channels {
                1 => frame_out[0] = 0.5 * (out_l + out_r),
                2 => {
                    frame_out[0] = out_l;
                    frame_out[1] = out_r;
                }
                _ => {
                    frame_out.fill(0.0);
                    frame_out[0] = out_l;
                    frame_out[1] = out_r;
                }
            }

            self.playhead_frame += step;
        }

        reader.advance_floor(self.playhead_frame.floor().max(0.0) as u64);
        drop(reader);
        if let Some(seek_frame) = pending_rt_seek {
            if let Some(src) = self.source.as_ref() {
                src.request_seek_nonblocking(seek_frame);
            }
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_engine::decoder::DecodedTrack;
    use std::sync::Arc;

    fn make_sine_source(sr: u32, frames: usize, freq: f32) -> AudioSource {
        let mut samples = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = (2.0 * std::f32::consts::PI * freq * (i as f32) / (sr as f32)).sin() * 0.5;
            samples.push(v);
            samples.push(v);
        }
        AudioSource::InMemory(Arc::new(DecodedTrack {
            path_norm: "test/sine.wav".to_string(),
            sample_rate: sr,
            total_frames: frames as u64,
            samples,
            norm_gain: 0.8,
            leading_silence_sec: 0.0,
        }))
    }

    #[test]
    fn hermite4_interpolates_constant_and_linear_exact() {
        assert!((hermite4(0.5, 0.5, 0.5, 0.5, 0.37) - 0.5).abs() < 1e-6);
        assert!((hermite4(0.0, 1.0, 2.0, 3.0, 0.25) - 1.25).abs() < 1e-6);
    }

    #[test]
    fn soft_limit_keeps_unity_below_threshold_and_bounds_hot_peaks() {
        assert!((soft_limit(0.75) - 0.75).abs() < 1e-6);
        assert!(soft_limit(5.0) <= 1.0 && soft_limit(5.0) > 0.98);
        assert!(soft_limit(-5.0) >= -1.0 && soft_limit(-5.0) < -0.98);
        assert_eq!(soft_limit(f32::NAN), 0.0);
    }

    #[test]
    fn varispeed_and_sample_rate_conversion_advance_playhead_precisely() {
        let mut dsp = PlaybackDsp::new(48_000);
        dsp.set_params(Some(1.0), Some(12.0), Some(false), Some(false), None); // +12 st = 2.0x
        dsp.load_source(make_sine_source(44_100, 44_100, 440.0), true, 0.0, None, None);

        let mut buf = vec![0.0_f32; 4800 * 2]; // 0.1s of 48kHz output
        let ev = dsp.render_into(&mut buf, 2);
        assert!(!ev.ended);
        // At 2.0x speed, 0.1s output = 0.2s source time
        assert!(
            (dsp.position_sec() - 0.2).abs() < 0.002,
            "got pos {}",
            dsp.position_sec()
        );
        // Anti-click fade-in starts smoothly near zero instead of a hard step
        assert!(buf[0].abs() < 0.05);
    }

    #[test]
    fn slice_loop_wraps_zero_drift_and_non_loop_stops_at_slice_end() {
        let mut dsp = PlaybackDsp::new(48_000);
        dsp.set_params(Some(1.0), Some(0.0), Some(true), Some(false), None);
        dsp.load_source(
            make_sine_source(48_000, 48_000, 220.0),
            true,
            0.1,
            Some(0.1),
            Some(0.2),
        );

        let mut buf = vec![0.0_f32; 7200 * 2]; // 0.15s > 0.10s slice -> wraps once to 0.15s
        let ev = dsp.render_into(&mut buf, 2);
        assert!(ev.looped);
        assert!(!ev.ended);
        assert!(
            (dsp.position_sec() - 0.15).abs() < 0.002,
            "expected ~0.15s after wrap, got {}",
            dsp.position_sec()
        );
        assert!(buf.iter().all(|s| s.is_finite() && s.abs() <= 1.0));

        // Disable loop -> stops cleanly at slice end and resets to slice start (0.1s)
        dsp.set_params(None, None, Some(false), None, None);
        let ev2 = dsp.render_into(&mut buf, 2);
        assert!(ev2.ended);
        assert!(!dsp.is_playing());
        assert!((dsp.position_sec() - 0.1).abs() < 0.002);
    }

    #[test]
    fn seek_while_playing_updates_position_immediately_even_if_followed_by_play() {
        let mut dsp = PlaybackDsp::new(48_000);
        dsp.set_params(Some(1.0), Some(0.0), Some(false), Some(false), None);
        dsp.load_source(make_sine_source(48_000, 96_000, 440.0), true, 0.0, None, None);

        // Warm up playback into Steady fade_env = 1.0
        let mut buf = vec![0.0_f32; 4800 * 2]; // 0.1s
        dsp.render_into(&mut buf, 2);
        assert!((dsp.position_sec() - 0.1).abs() < 0.002);

        // Seek to 1.2s while actively playing, then call play() right away
        dsp.seek_sec(1.2);
        assert!((dsp.position_sec() - 1.2).abs() < 0.002);
        dsp.play();
        assert!((dsp.position_sec() - 1.2).abs() < 0.002);

        dsp.render_into(&mut buf, 2);
        assert!(
            (dsp.position_sec() - 1.3).abs() < 0.002,
            "expected ~1.3s after 0.1s render, got {}",
            dsp.position_sec()
        );
    }
}
