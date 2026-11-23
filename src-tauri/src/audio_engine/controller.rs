use super::decoder::{open_audio_source, TrackDecodeCache};
use super::dsp::PlaybackDsp;
use super::output::{open_output_stream, CallbackSignals, OpenedOutputStream};
use super::{AudioSyncPayload, EngineCmd, AUDIO_SYNC_EVENT};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Release WASAPI output handle after 5 seconds of idle silence (0% CPU, DAW-friendly).
const IDLE_STREAM_PARK_TIMEOUT: Duration = Duration::from_secs(5);
const PLAYING_SYNC_HEARTBEAT: Duration = Duration::from_millis(250);

struct ControllerCtx {
    app: AppHandle,
    dsp: Arc<Mutex<PlaybackDsp>>,
    signals: Arc<CallbackSignals>,
    stream: Option<OpenedOutputStream>,
    requested_device_id: String,
    active_display_path: String,
    decode_cache: TrackDecodeCache,
    event_seq: Arc<AtomicU64>,
    last_active_audio: Instant,
    last_heartbeat: Instant,
}

impl ControllerCtx {
    fn ensure_stream(&mut self) -> Result<(), String> {
        if self.stream.is_some() {
            return Ok(());
        }
        let opened = open_output_stream(
            &self.requested_device_id,
            Arc::clone(&self.dsp),
            Arc::clone(&self.signals),
        )?;
        self.stream = Some(opened);
        self.last_active_audio = Instant::now();
        Ok(())
    }

    fn build_snapshot(&self, event: &str, error: Option<String>) -> AudioSyncPayload {
        let seq = self.event_seq.fetch_add(1, Ordering::AcqRel) + 1;
        let (is_playing, position_sec, duration_sec, playback_rate) =
            if let Ok(guard) = self.dsp.lock() {
                (
                    guard.is_playing(),
                    guard.position_sec(),
                    guard.duration_sec(),
                    guard.playback_rate(),
                )
            } else {
                (false, 0.0, 0.0, 1.0)
            };

        let (active_device_id, active_device_name, output_latency_ms) =
            if let Some(st) = self.stream.as_ref() {
                (
                    st.active_device_id.clone(),
                    st.active_device_name.clone(),
                    st.estimated_latency_ms,
                )
            } else {
                (
                    self.requested_device_id.clone(),
                    if self.requested_device_id == "default" {
                        "System Default".to_string()
                    } else {
                        self.requested_device_id.clone()
                    },
                    12.0,
                )
            };

        AudioSyncPayload {
            seq,
            event: event.to_string(),
            file_path: self.active_display_path.clone(),
            is_playing,
            position_sec,
            duration_sec,
            playback_rate,
            active_device_id,
            active_device_name,
            output_latency_ms,
            error,
        }
    }

    fn emit_sync(&self, event: &str, error: Option<String>) -> AudioSyncPayload {
        let payload = self.build_snapshot(event, error);
        let _ = self.app.emit(AUDIO_SYNC_EVENT, &payload);
        payload
    }
}

pub(super) fn run_audio_control_loop(
    app: AppHandle,
    rx: mpsc::Receiver<EngineCmd>,
    latest_load_seq: Arc<AtomicU64>,
    event_seq: Arc<AtomicU64>,
) {
    let mut ctx = ControllerCtx {
        app,
        dsp: Arc::new(Mutex::new(PlaybackDsp::new(48_000))),
        signals: Arc::new(CallbackSignals::default()),
        stream: None,
        requested_device_id: "default".to_string(),
        active_display_path: String::new(),
        decode_cache: TrackDecodeCache::default(),
        event_seq,
        last_active_audio: Instant::now(),
        last_heartbeat: Instant::now(),
    };

    loop {
        let is_idle_parked = ctx.stream.is_none()
            && !ctx
                .dsp
                .lock()
                .map(|g| g.is_rendering_audio())
                .unwrap_or(false);

        let cmd_opt = if is_idle_parked {
            // Zero-CPU sleep when audio stream is parked (eliminates 50 Hz idle wakeups)
            match rx.recv() {
                Ok(cmd) => Some(cmd),
                Err(_) => break,
            }
        } else {
            match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(cmd) => Some(cmd),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        };

        if let Some(first_cmd) = cmd_opt {
            handle_cmd(&mut ctx, first_cmd, &latest_load_seq);
            while let Ok(next_cmd) = rx.try_recv() {
                handle_cmd(&mut ctx, next_cmd, &latest_load_seq);
            }
        }

        // Recover gracefully if WASAPI invalidated the output stream (headphone unplug / rate change)
        if ctx.signals.stream_errored.swap(false, Ordering::AcqRel) {
            ctx.stream = None;
            let was_playing = ctx
                .dsp
                .lock()
                .map(|g| g.is_rendering_audio())
                .unwrap_or(false);
            if was_playing {
                if let Err(err) = ctx.ensure_stream() {
                    if let Ok(mut g) = ctx.dsp.lock() {
                        g.pause();
                    }
                    ctx.emit_sync("error", Some(err));
                } else {
                    ctx.emit_sync("device", None);
                }
            }
        }

        if ctx.signals.ended.swap(false, Ordering::AcqRel) {
            ctx.emit_sync("ended", None);
        }
        if ctx.signals.looped.swap(false, Ordering::AcqRel) {
            ctx.emit_sync("looped", None);
        }
        if ctx.signals.became_paused.swap(false, Ordering::AcqRel) {
            ctx.emit_sync("paused", None);
        }

        let rendering = ctx
            .dsp
            .lock()
            .map(|g| g.is_rendering_audio())
            .unwrap_or(false);

        if rendering {
            ctx.last_active_audio = Instant::now();
            if ctx.last_heartbeat.elapsed() >= PLAYING_SYNC_HEARTBEAT {
                ctx.last_heartbeat = Instant::now();
                ctx.emit_sync("sync", None);
            }
        } else if ctx.stream.is_some()
            && ctx.last_active_audio.elapsed() >= IDLE_STREAM_PARK_TIMEOUT
        {
            ctx.stream = None;
        }
    }

    ctx.stream = None;
    let remaining_src = ctx.dsp.lock().ok().and_then(|mut g| g.clear_source());
    if let Some(src) = remaining_src {
        src.release_file_handle();
    }
}

fn handle_cmd(ctx: &mut ControllerCtx, cmd: EngineCmd, latest_load_seq: &AtomicU64) {
    match cmd {
        EngineCmd::Load {
            load_seq,
            req,
            reply,
        } => {
            if load_seq < latest_load_seq.load(Ordering::Acquire) {
                if let Some(r) = reply {
                    let _ = r.send(Ok(ctx.build_snapshot("superseded", None)));
                }
                return;
            }

            let open_res = open_audio_source(&req.canon_path, &mut ctx.decode_cache);
            if load_seq < latest_load_seq.load(Ordering::Acquire) {
                if let Ok(src) = open_res {
                    src.release_file_handle();
                }
                if let Some(r) = reply {
                    let _ = r.send(Ok(ctx.build_snapshot("superseded", None)));
                }
                return;
            }

            match open_res {
                Ok(source) => {
                    let mut stream_err: Option<String> = None;
                    if req.autoplay {
                        if let Err(e) = ctx.ensure_stream() {
                            stream_err = Some(e);
                        }
                    }

                    let will_play = req.autoplay && stream_err.is_none();
                    let prev_src = if let Ok(mut g) = ctx.dsp.lock() {
                        g.set_params(
                            Some(req.volume),
                            Some(req.pitch_semitones),
                            Some(req.looping),
                            Some(req.normalize_preview),
                            Some(req.slice_range),
                        );
                        let old = g.clear_source();
                        let (s_start, s_end) = match req.slice_range {
                            Some((s, e)) if e > s => (Some(s), Some(e)),
                            _ => (None, None),
                        };
                        let effective_start_sec = if req.skip_leading_silence
                            && s_start.is_none()
                            && req.start_sec <= 0.001
                        {
                            source.leading_silence_sec()
                        } else {
                            req.start_sec
                        };
                        g.load_source(source, will_play, effective_start_sec, s_start, s_end);
                        old
                    } else {
                        None
                    };
                    if let Some(old) = prev_src {
                        old.release_file_handle();
                    }

                    ctx.active_display_path = req.display_path;
                    ctx.signals.ended.store(false, Ordering::Release);
                    ctx.signals.looped.store(false, Ordering::Release);
                    ctx.signals.became_paused.store(false, Ordering::Release);
                    ctx.last_active_audio = Instant::now();
                    ctx.last_heartbeat = Instant::now();

                    let payload = if let Some(err) = stream_err {
                        ctx.emit_sync("error", Some(err))
                    } else {
                        ctx.emit_sync(if will_play { "playing" } else { "loaded" }, None)
                    };
                    if let Some(r) = reply {
                        let _ = r.send(Ok(payload));
                    }
                }
                Err(err) => {
                    if let Some(r) = reply {
                        let _ = r.send(Err(err));
                    }
                }
            }
        }

        EngineCmd::Play => {
            if let Err(err) = ctx.ensure_stream() {
                ctx.emit_sync("error", Some(err));
                return;
            }
            if let Ok(mut g) = ctx.dsp.lock() {
                g.play();
            }
            ctx.last_active_audio = Instant::now();
            ctx.last_heartbeat = Instant::now();
            ctx.emit_sync("playing", None);
        }

        EngineCmd::Pause => {
            if let Ok(mut g) = ctx.dsp.lock() {
                g.pause();
            }
            ctx.emit_sync("paused", None);
        }

        EngineCmd::Stop => {
            if let Ok(mut g) = ctx.dsp.lock() {
                g.stop();
            }
            ctx.emit_sync("stopped", None);
        }

        EngineCmd::Unload => {
            let old = ctx.dsp.lock().ok().and_then(|mut g| g.clear_source());
            if let Some(src) = old {
                src.release_file_handle();
            }
            ctx.active_display_path.clear();
            ctx.emit_sync("stopped", None);
        }

        EngineCmd::Seek { sec } => {
            if let Ok(mut g) = ctx.dsp.lock() {
                g.seek_sec(sec);
            }
            ctx.last_heartbeat = Instant::now();
            ctx.emit_sync("seeked", None);
        }

        EngineCmd::SetParams {
            volume,
            pitch_semitones,
            looping,
            normalize_preview,
            slice_range,
        } => {
            let pitch_changed = pitch_semitones.is_some();
            if let Ok(mut g) = ctx.dsp.lock() {
                g.set_params(
                    volume,
                    pitch_semitones,
                    looping,
                    normalize_preview,
                    slice_range,
                );
            }
            if pitch_changed {
                ctx.emit_sync("sync", None);
            }
        }

        EngineCmd::SetDevice { device_id } => {
            let clean = if device_id.trim().is_empty() {
                "default".to_string()
            } else {
                device_id.trim().to_string()
            };
            if ctx.requested_device_id == clean {
                return;
            }
            ctx.requested_device_id = clean;
            let was_open = ctx.stream.is_some();
            ctx.stream = None;
            if was_open {
                if let Err(err) = ctx.ensure_stream() {
                    ctx.emit_sync("error", Some(err));
                    return;
                }
            }
            ctx.emit_sync("device", None);
        }

        EngineCmd::ReleaseHandle {
            target_path_norm,
            reply,
        } => {
            if let Some(target) = target_path_norm.as_deref() {
                ctx.decode_cache.evict_path(target);
            }
            let should_clear = if let Ok(g) = ctx.dsp.lock() {
                match (g.active_path_norm(), target_path_norm.as_deref()) {
                    (Some(_), None) => true,
                    (Some(active), Some(target)) => active.eq_ignore_ascii_case(target),
                    (None, _) => false,
                }
            } else {
                false
            };

            if should_clear {
                let old = ctx.dsp.lock().ok().and_then(|mut g| g.clear_source());
                if let Some(src) = old {
                    src.release_file_handle();
                }
                ctx.active_display_path.clear();
                ctx.emit_sync("stopped", None);
                let _ = reply.send(true);
            } else {
                let _ = reply.send(false);
            }
        }

        EngineCmd::GetSnapshot { reply } => {
            let _ = reply.send(ctx.build_snapshot("snapshot", None));
        }
    }
}
