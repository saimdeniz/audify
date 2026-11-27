use super::super::decoder::{AudioSource, DecodedTrack};
use super::super::streaming::{StreamRing, StreamingTrack};
use super::{hermite4, soft_limit, DspRenderEvents, FadeMode, PlaybackDsp};
use std::sync::MutexGuard;

enum SourceReader<'a> {
    InMemory(&'a DecodedTrack),
    Streaming(&'a StreamingTrack, Option<MutexGuard<'a, StreamRing>>),
}

impl<'a> SourceReader<'a> {
    fn from_source(src: &'a AudioSource) -> Self {
        match src {
            AudioSource::InMemory(t) => Self::InMemory(t),
            AudioSource::Streaming(t) => Self::Streaming(t, t.try_lock_ring()),
        }
    }

    #[inline]
    fn read_frame(&self, frame: i64) -> Option<(f32, f32)> {
        match self {
            Self::InMemory(t) => t.read_frame(frame),
            Self::Streaming(_, Some(guard)) => guard.read_frame(frame),
            Self::Streaming(_, None) => None,
        }
    }

    fn advance_floor(self, playhead_frame: u64) {
        match self {
            Self::Streaming(track, Some(mut guard)) => {
                guard.advance_read_floor(playhead_frame);
                let should_wake = !track.is_eof() && guard.free_frames() >= 4096;
                drop(guard);
                if should_wake {
                    track.notify_producer();
                }
            }
            Self::Streaming(track, None) => {
                // Recover from contended ring lock or missed Condvar wakeup during seek/refill
                if track.has_pending_seek() || !track.is_eof() {
                    track.notify_producer();
                }
            }
            Self::InMemory(_) => {}
        }
    }
}

impl PlaybackDsp {
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
        let total_f = src.total_frames().max(1) as f64;
        let step = (src_sr / out_sr) * rate;
        let (start_f, end_f) = if has_slice {
            self.active_frame_bounds(src)
        } else {
            (0.0, total_f)
        };
        let span_len = (end_f - start_f).max(1.0);
        let xfade_len = (src_sr * 0.0025).min(span_len * 0.25);
        // Streaming tracks reset their ring to `start_f` upon loop wrap, so `end_f + elapsed`
        // is no longer resident; restrict post-tail blending to full in-memory sources.
        let has_post_tail = matches!(src, AudioSource::InMemory(_))
            && has_slice
            && xfade_len >= 4.0
            && end_f + xfade_len <= total_f;
        let src_eof = src.is_eof();
        // Acquire streaming ring lock ONCE per audio callback buffer (zero per-sample mutex ops)
        let reader = SourceReader::from_source(src);
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

            // Advance FadeOut envelopes BEFORE reading audio so pause/stop never hangs on underrun;
            // FadeIn is intentionally deferred until real audio samples are available below.
            match self.fade_mode {
                FadeMode::Steady => {
                    self.fade_env = 1.0;
                }
                FadeMode::FadeIn => {}
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
                    if has_post_tail {
                        self.playhead_frame = start_f + (overshoot % span_len);
                        self.loop_post_tail_active = true;
                        self.did_head_xfade = false;
                    } else if self.did_head_xfade && xfade_len >= 4.0 {
                        let eff_span = (span_len - xfade_len).max(1.0);
                        self.playhead_frame = start_f + xfade_len + (overshoot % eff_span);
                        self.did_head_xfade = false;
                        self.loop_post_tail_active = false;
                    } else {
                        self.playhead_frame = start_f + (overshoot % span_len);
                        self.did_head_xfade = false;
                        self.loop_post_tail_active = false;
                        if self.last_out_l.abs() > 1e-4 || self.last_out_r.abs() > 1e-4 {
                            self.declick_l = self.last_out_l;
                            self.declick_r = self.last_out_r;
                            self.declick_env = 1.0;
                        }
                    }
                    pending_rt_seek = Some(self.playhead_frame.floor() as u64);
                    events.looped = true;
                } else {
                    self.playing = false;
                    self.fade_env = 0.0;
                    self.fade_mode = FadeMode::Steady;
                    self.loop_post_tail_active = false;
                    self.did_head_xfade = false;
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
                if self.declick_env <= 0.0
                    && (self.last_out_l.abs() > 1e-4 || self.last_out_r.abs() > 1e-4)
                {
                    self.declick_l = self.last_out_l;
                    self.declick_r = self.last_out_r;
                    self.declick_env = 1.0;
                }
                let (mut out_l, mut out_r) = (0.0_f32, 0.0_f32);
                if self.declick_env > 0.0 {
                    out_l = self.declick_l * self.declick_env;
                    out_r = self.declick_r * self.declick_env;
                    self.declick_env = (self.declick_env - fade_step).max(0.0);
                }
                self.last_out_l = out_l;
                self.last_out_r = out_r;
                if !matches!(
                    self.fade_mode,
                    FadeMode::FadeOutToPause | FadeMode::FadeOutToStop
                ) {
                    self.fade_env = 0.0;
                    self.fade_mode = FadeMode::FadeIn;
                }
                if out_channels == 1 {
                    frame_out[0] = (out_l + out_r) * 0.5;
                } else {
                    frame_out[0] = out_l;
                    frame_out[1] = out_r;
                    for ch_s in frame_out.iter_mut().skip(2) {
                        *ch_s = 0.0;
                    }
                }
                continue;
            };

            if matches!(self.fade_mode, FadeMode::FadeIn) {
                self.fade_env = (self.fade_env + fade_step).min(1.0);
                if self.fade_env >= 1.0 {
                    self.fade_mode = FadeMode::Steady;
                }
            }

            // 2.5 ms anti-click crossfade at loop seam (zero click & zero double transient!)
            if self.looping && has_post_tail && self.loop_post_tail_active {
                let elapsed = self.playhead_frame - start_f;
                if elapsed >= 0.0 && elapsed < xfade_len {
                    let alpha = (elapsed / xfade_len).clamp(0.0, 1.0) as f32;
                    let tail_pos = end_f + elapsed;
                    if let Some((tl, tr)) = Self::sample_with_aa(&reader, tail_pos, step) {
                        l = tl * (1.0 - alpha) + l * alpha;
                        r = tr * (1.0 - alpha) + r * alpha;
                    }
                } else {
                    self.loop_post_tail_active = false;
                }
            } else if self.looping
                && !has_post_tail
                && xfade_len >= 4.0
                && self.playhead_frame >= end_f - xfade_len
            {
                let alpha = ((self.playhead_frame - (end_f - xfade_len)) / xfade_len)
                    .clamp(0.0, 1.0) as f32;
                let head_pos = start_f + (self.playhead_frame - (end_f - xfade_len));
                if let Some((hl, hr)) = Self::sample_with_aa(&reader, head_pos, step) {
                    l = l * (1.0 - alpha) + hl * alpha;
                    r = r * (1.0 - alpha) + hr * alpha;
                    self.did_head_xfade = true;
                }
            } else if has_slice
                && !self.looping
                && xfade_len >= 4.0
                && self.playhead_frame >= end_f - xfade_len
            {
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
        if let Some(seek_frame) = pending_rt_seek {
            if let Some(src) = self.source.as_ref() {
                src.request_seek_nonblocking(seek_frame);
            }
        }
        events
    }
}
