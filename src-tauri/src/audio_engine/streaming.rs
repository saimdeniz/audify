use super::decoder::{push_interleaved_stereo, NormGainAccumulator};
use crate::audio::{copy_packet_samples, open_audio_decoder, OpenedAudioDecoder};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{SeekMode, SeekTo};
use symphonia::core::units::Time;

/// Circular stereo window for long streaming tracks (~4s @ 48 kHz ≈ 1.5 MiB).
const STREAM_RING_FRAMES: usize = 192_000;
const STREAM_LOOKBEHIND_FRAMES: u64 = 16;
const NO_PENDING_SEEK: u64 = u64::MAX;

enum StreamCmd {
    Seek { target_frame: u64, generation: u64 },
    Stop,
}

pub(super) struct StreamRing {
    buf: Vec<f32>,
    base_frame: u64,
    len_frames: usize,
    generation: u64,
}

impl StreamRing {
    fn new(capacity_frames: usize) -> Self {
        Self {
            buf: vec![0.0_f32; capacity_frames * 2],
            base_frame: 0,
            len_frames: 0,
            generation: 1,
        }
    }

    fn capacity_frames(&self) -> usize {
        self.buf.len() / 2
    }

    fn reset(&mut self, start_frame: u64, generation: u64) {
        self.base_frame = start_frame;
        self.len_frames = 0;
        self.generation = generation;
    }

    pub(super) fn free_frames(&self) -> usize {
        self.capacity_frames().saturating_sub(self.len_frames)
    }

    fn push_stereo(&mut self, stereo: &[f32]) -> usize {
        let cap = self.capacity_frames();
        let avail_frames = stereo.len() / 2;
        let to_write = avail_frames.min(self.free_frames());
        for i in 0..to_write {
            let abs_frame = self.base_frame + (self.len_frames as u64);
            let slot = ((abs_frame as usize) % cap) * 2;
            self.buf[slot] = stereo[i * 2];
            self.buf[slot + 1] = stereo[i * 2 + 1];
            self.len_frames += 1;
        }
        to_write
    }

    #[inline]
    pub(super) fn read_frame(&self, frame: i64) -> Option<(f32, f32)> {
        if frame < 0 {
            return None;
        }
        let f = frame as u64;
        if f < self.base_frame {
            return None;
        }
        let offset = f - self.base_frame;
        if offset >= self.len_frames as u64 {
            return None;
        }
        let cap = self.capacity_frames();
        let slot = ((f as usize) % cap) * 2;
        Some((self.buf[slot], self.buf[slot + 1]))
    }

    pub(super) fn advance_read_floor(&mut self, playhead_frame: u64) {
        let keep_from = playhead_frame.saturating_sub(STREAM_LOOKBEHIND_FRAMES);
        if keep_from <= self.base_frame {
            return;
        }
        let drop_frames = (keep_from - self.base_frame) as usize;
        if drop_frames >= self.len_frames {
            self.base_frame = keep_from;
            self.len_frames = 0;
        } else {
            self.base_frame = keep_from;
            self.len_frames -= drop_frames;
        }
    }
}

type StreamCmdQueue = Arc<(Mutex<(VecDeque<StreamCmd>, bool)>, Condvar)>;

pub struct StreamingTrack {
    pub path_norm: String,
    pub sample_rate: u32,
    total_frames: AtomicU64,
    norm_gain_bits: AtomicU32,
    eof: AtomicBool,
    generation: AtomicU64,
    pending_seek_frame: AtomicU64,
    ring: Mutex<StreamRing>,
    cmd_queue: StreamCmdQueue,
    closed_signal: Arc<(Mutex<bool>, Condvar)>,
}

impl StreamingTrack {
    pub(crate) fn spawn(
        canon_path: PathBuf,
        path_norm: String,
        opened: OpenedAudioDecoder,
        prefix_stereo: Vec<f32>,
        initial_gain: NormGainAccumulator,
    ) -> Arc<Self> {
        let sr = opened.sample_rate.max(1);
        let prefix_frames = (prefix_stereo.len() / 2) as u64;
        let est_frames = opened.n_frames.unwrap_or(prefix_frames).max(prefix_frames);
        let init_gain_val = initial_gain.current_gain();

        let cmd_queue = Arc::new((Mutex::new((VecDeque::<StreamCmd>::new(), false)), Condvar::new()));
        let closed_signal = Arc::new((Mutex::new(false), Condvar::new()));

        let mut ring = StreamRing::new(STREAM_RING_FRAMES);
        let mut ring_prefilled_frames: u64 = 0;
        let (leftover, leftover_offset) = if !prefix_stereo.is_empty() {
            let written = ring.push_stereo(&prefix_stereo);
            ring_prefilled_frames = written as u64;
            if written * 2 < prefix_stereo.len() {
                // Zero-copy handoff: reuse prefix_stereo with a read cursor instead of cloning ~46.5 MiB
                (prefix_stereo, written * 2)
            } else {
                (Vec::new(), 0)
            }
        } else {
            (Vec::new(), 0)
        };

        let track = Arc::new(Self {
            path_norm,
            sample_rate: sr,
            total_frames: AtomicU64::new(est_frames),
            norm_gain_bits: AtomicU32::new(init_gain_val.to_bits()),
            eof: AtomicBool::new(false),
            generation: AtomicU64::new(1),
            pending_seek_frame: AtomicU64::new(NO_PENDING_SEEK),
            ring: Mutex::new(ring),
            cmd_queue: Arc::clone(&cmd_queue),
            closed_signal: Arc::clone(&closed_signal),
        });

        let worker_track = Arc::clone(&track);
        let _ = thread::Builder::new()
            .name("audify-audio-stream".to_string())
            .spawn(move || {
                run_streaming_producer(
                    worker_track,
                    canon_path,
                    opened,
                    ring_prefilled_frames,
                    leftover,
                    leftover_offset,
                    initial_gain,
                    cmd_queue,
                    closed_signal,
                );
            });

        track
    }

    pub fn total_frames(&self) -> u64 {
        self.total_frames.load(Ordering::Acquire)
    }

    pub fn norm_gain(&self) -> f32 {
        f32::from_bits(self.norm_gain_bits.load(Ordering::Relaxed))
    }

    pub fn is_eof(&self) -> bool {
        self.eof.load(Ordering::Acquire)
    }

    pub(super) fn has_pending_seek(&self) -> bool {
        self.pending_seek_frame.load(Ordering::Acquire) != NO_PENDING_SEEK
    }

    pub(super) fn try_lock_ring(&self) -> Option<MutexGuard<'_, StreamRing>> {
        if self.has_pending_seek() {
            return None;
        }
        self.ring.try_lock().ok()
    }

    pub(super) fn notify_producer(&self) {
        // Non-blocking lock attempt avoids missed Condvar notifications when producer is entering wait
        let _guard = self.cmd_queue.0.try_lock();
        self.cmd_queue.1.notify_one();
    }

    pub fn read_frame_try(&self, frame: i64) -> Option<(f32, f32)> {
        let guard = self.try_lock_ring()?;
        guard.read_frame(frame)
    }

    pub fn advance_floor_try(&self, playhead_frame: u64) {
        let mut should_wake = false;
        if let Ok(mut guard) = self.ring.try_lock() {
            guard.advance_read_floor(playhead_frame);
            if !self.eof.load(Ordering::Relaxed) && guard.free_frames() >= 4096 {
                should_wake = true;
            }
        }
        if should_wake {
            self.notify_producer();
        }
    }

    /// Lock-free, allocation-free seek request safe to invoke from real-time audio callbacks.
    pub fn request_seek_nonblocking(&self, target_frame: u64) {
        self.eof.store(false, Ordering::Release);
        self.pending_seek_frame
            .store(target_frame.min(NO_PENDING_SEEK - 1), Ordering::Release);
        self.notify_producer();
    }

    pub fn request_seek(&self, target_frame: u64) {
        self.pending_seek_frame.store(NO_PENDING_SEEK, Ordering::Release);
        let next_gen = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.eof.store(false, Ordering::Release);
        if let Ok(mut guard) = self.ring.lock() {
            guard.reset(target_frame, next_gen);
        }
        let (lock, cvar) = &*self.cmd_queue;
        if let Ok(mut state) = lock.lock() {
            if !state.1 {
                // Coalesce queued seeks so rapid waveform scrubbing only executes the latest target
                state.0.retain(|cmd| !matches!(cmd, StreamCmd::Seek { .. }));
                state.0.push_back(StreamCmd::Seek {
                    target_frame,
                    generation: next_gen,
                });
                cvar.notify_one();
            }
        }
    }

    fn signal_stop(&self) {
        let (lock, cvar) = &*self.cmd_queue;
        if let Ok(mut state) = lock.lock() {
            if !state.1 {
                state.1 = true;
                state.0.push_back(StreamCmd::Stop);
                cvar.notify_one();
            }
        }
    }

    pub fn close_and_wait(&self) {
        self.signal_stop();
        let (lock, cvar) = &*self.closed_signal;
        if let Ok(closed) = lock.lock() {
            if !*closed {
                let _ = cvar.wait_timeout(closed, Duration::from_millis(500));
            }
        }
    }
}

impl Drop for StreamingTrack {
    fn drop(&mut self) {
        self.signal_stop();
    }
}

fn apply_stream_seek(
    track: &StreamingTrack,
    canon_path: &Path,
    opened: &mut OpenedAudioDecoder,
    target_frame: u64,
) -> u64 {
    let sr = track.sample_rate.max(1) as f64;
    let seek_sec = target_frame as f64 / sr;
    let seek_res = opened.format.seek(
        SeekMode::Accurate,
        SeekTo::Time {
            time: Time::from(seek_sec),
            track_id: Some(opened.track_id),
        },
    );
    let mut skip_frames: u64 = 0;
    if let Ok(seeked) = seek_res {
        opened.decoder.reset();
        if seeked.required_ts > seeked.actual_ts {
            let delta_ts = seeked.required_ts - seeked.actual_ts;
            let time_base = opened
                .format
                .tracks()
                .iter()
                .find(|t| t.id == opened.track_id)
                .and_then(|t| t.codec_params.time_base);
            skip_frames = if let Some(tb) = time_base {
                let t = tb.calc_time(delta_ts);
                let sec = t.seconds as f64 + t.frac;
                (sec * sr).round().max(0.0) as u64
            } else {
                delta_ts
            };
            // Bound residual skip to avoid stalls on malformed container timestamps
            skip_frames = skip_frames.min((track.sample_rate as u64).saturating_mul(10));
        }
    } else if let Ok(reopened) = open_audio_decoder(canon_path) {
        *opened = reopened;
        skip_frames = target_frame.min((track.sample_rate as u64).saturating_mul(10));
    }
    track.eof.store(false, Ordering::Release);
    skip_frames
}

fn release_pending_buffer(pending_stereo: &mut Vec<f32>) {
    pending_stereo.clear();
    if pending_stereo.capacity() > 65_536 {
        pending_stereo.shrink_to_fit();
    }
}

#[allow(clippy::too_many_arguments)]
fn run_streaming_producer(
    track: Arc<StreamingTrack>,
    canon_path: PathBuf,
    mut opened: OpenedAudioDecoder,
    ring_prefilled_frames: u64,
    mut pending_stereo: Vec<f32>,
    mut pending_offset: usize,
    mut norm_acc: NormGainAccumulator,
    cmd_queue: StreamCmdQueue,
    closed_signal: Arc<(Mutex<bool>, Condvar)>,
) {
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;
    let mut active_gen: u64 = 1;
    let mut local_eof = false;
    let mut decoded_pos: u64 = ring_prefilled_frames
        .saturating_add((pending_stereo.len().saturating_sub(pending_offset) / 2) as u64);
    let mut skip_frames_remaining: u64 = 0;

    loop {
        let mut should_stop = false;
        let drained: Vec<StreamCmd> = {
            let (lock, _) = &*cmd_queue;
            if let Ok(mut state) = lock.lock() {
                state.0.drain(..).collect()
            } else {
                break;
            }
        };
        let mut latest_seek: Option<(u64, u64)> = None;
        for cmd in drained {
            match cmd {
                StreamCmd::Stop => {
                    should_stop = true;
                    break;
                }
                StreamCmd::Seek {
                    target_frame,
                    generation,
                } => {
                    latest_seek = Some((target_frame, generation));
                }
            }
        }
        if should_stop {
            break;
        }

        // Service lock-free real-time seek requests posted by PlaybackDsp::render_into;
        // if an RT seek arrived, it supersedes any queued Seek command.
        let rt_seek = track.pending_seek_frame.swap(NO_PENDING_SEEK, Ordering::AcqRel);
        if rt_seek != NO_PENDING_SEEK {
            let next_gen = track.generation.fetch_add(1, Ordering::AcqRel) + 1;
            active_gen = next_gen;
            release_pending_buffer(&mut pending_stereo);
            pending_offset = 0;
            local_eof = false;
            if let Ok(mut ring) = track.ring.lock() {
                ring.reset(rt_seek, next_gen);
            }
            skip_frames_remaining = apply_stream_seek(&track, &canon_path, &mut opened, rt_seek);
            decoded_pos = rt_seek;
        } else if let Some((target_frame, generation)) = latest_seek {
            active_gen = generation;
            release_pending_buffer(&mut pending_stereo);
            pending_offset = 0;
            local_eof = false;
            skip_frames_remaining =
                apply_stream_seek(&track, &canon_path, &mut opened, target_frame);
            decoded_pos = target_frame;
        }

        if pending_offset < pending_stereo.len() {
            let written = if let Ok(mut ring) = track.ring.lock() {
                if ring.generation == active_gen {
                    ring.push_stereo(&pending_stereo[pending_offset..])
                } else {
                    release_pending_buffer(&mut pending_stereo);
                    pending_offset = 0;
                    0
                }
            } else {
                0
            };
            if written > 0 {
                pending_offset += written * 2;
                if pending_offset >= pending_stereo.len() {
                    release_pending_buffer(&mut pending_stereo);
                    pending_offset = 0;
                }
                continue;
            }
        }

        let need_more = if local_eof || pending_offset < pending_stereo.len() {
            false
        } else if let Ok(ring) = track.ring.lock() {
            ring.generation == active_gen && ring.free_frames() >= 4096
        } else {
            false
        };

        if !need_more {
            let (lock, cvar) = &*cmd_queue;
            let Ok(guard) = lock.lock() else {
                break;
            };
            if guard.0.is_empty()
                && !guard.1
                && track.pending_seek_frame.load(Ordering::Acquire) == NO_PENDING_SEEK
            {
                let wait_dur = if local_eof {
                    Duration::from_millis(500)
                } else {
                    Duration::from_millis(250)
                };
                let _ = cvar.wait_timeout(guard, wait_dur);
            }
            continue;
        }

        match opened.format.next_packet() {
            Ok(packet) => {
                if packet.track_id() != opened.track_id {
                    continue;
                }
                match opened.decoder.decode(&packet) {
                    Ok(decoded) => {
                        let Some((spec, frames, samples)) =
                            copy_packet_samples(&mut sample_buf_slot, decoded)
                        else {
                            continue;
                        };
                        let mut tmp = Vec::with_capacity(frames * 2);
                        push_interleaved_stereo(samples, spec.channels.count().max(1), &mut tmp);
                        let slice_start = if skip_frames_remaining > 0 {
                            let avail_frames = (tmp.len() / 2) as u64;
                            if avail_frames <= skip_frames_remaining {
                                skip_frames_remaining -= avail_frames;
                                continue;
                            }
                            let skip_now = skip_frames_remaining as usize;
                            skip_frames_remaining = 0;
                            skip_now * 2
                        } else {
                            0
                        };
                        let usable = &tmp[slice_start..];
                        let usable_frames = (usable.len() / 2) as u64;
                        norm_acc.feed_stereo(usable);
                        track
                            .norm_gain_bits
                            .store(norm_acc.current_gain().to_bits(), Ordering::Relaxed);
                        decoded_pos = decoded_pos.saturating_add(usable_frames);
                        let prev_total = track.total_frames.load(Ordering::Relaxed);
                        if decoded_pos > prev_total {
                            track.total_frames.store(decoded_pos, Ordering::Release);
                        }
                        let written = if let Ok(mut ring) = track.ring.lock() {
                            if ring.generation == active_gen {
                                ring.push_stereo(usable)
                            } else {
                                0
                            }
                        } else {
                            0
                        };
                        if written * 2 < usable.len() {
                            if pending_offset >= pending_stereo.len() {
                                release_pending_buffer(&mut pending_stereo);
                                pending_offset = 0;
                            }
                            pending_stereo.extend_from_slice(&usable[written * 2..]);
                        }
                    }
                    Err(SymphoniaError::ResetRequired) => {
                        opened.decoder.reset();
                    }
                    Err(_) => {}
                }
            }
            Err(SymphoniaError::ResetRequired) => {
                opened.decoder.reset();
            }
            Err(SymphoniaError::IoError(_)) | Err(_) => {
                local_eof = true;
                if decoded_pos > 0 {
                    track.total_frames.store(decoded_pos, Ordering::Release);
                }
                track.eof.store(true, Ordering::Release);
            }
        }
    }

    drop(opened);
    let (lock, cvar) = &*closed_signal;
    if let Ok(mut closed) = lock.lock() {
        *closed = true;
        cvar.notify_all();
    }
}
