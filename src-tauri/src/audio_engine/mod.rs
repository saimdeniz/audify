mod controller;
pub mod decoder;
pub mod dsp;
pub mod output;
pub mod streaming;

use crate::security::normalize_clean_path;
use output::AudioOutputDeviceInfo;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

/// Event emitted to the frontend only on discrete state transitions plus a light
/// 250ms drift-correction heartbeat while actively playing (zero 60Hz IPC spam).
pub const AUDIO_SYNC_EVENT: &str = "audify:audio-sync";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncPayload {
    pub seq: u64,
    pub event: String,
    pub file_path: String,
    pub is_playing: bool,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub playback_rate: f64,
    pub active_device_id: String,
    pub active_device_name: String,
    pub output_latency_ms: f64,
    pub error: Option<String>,
}

impl Default for AudioSyncPayload {
    fn default() -> Self {
        Self {
            seq: 0,
            event: "idle".to_string(),
            file_path: String::new(),
            is_playing: false,
            position_sec: 0.0,
            duration_sec: 0.0,
            playback_rate: 1.0,
            active_device_id: "default".to_string(),
            active_device_name: "System Default".to_string(),
            output_latency_ms: 12.0,
            error: None,
        }
    }
}

pub struct LoadTrackRequest {
    pub canon_path: PathBuf,
    pub display_path: String,
    pub autoplay: bool,
    pub start_sec: f64,
    pub slice_range: Option<(f64, f64)>,
    pub volume: f32,
    pub pitch_semitones: f32,
    pub looping: bool,
    pub normalize_preview: bool,
    pub skip_leading_silence: bool,
}

pub struct LoadMemoryPcmRequest {
    pub display_path: String,
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub autoplay: bool,
    pub start_sec: f64,
    pub volume: f32,
    pub looping: bool,
    pub normalize_preview: bool,
}

pub(super) enum EngineCmd {
    Load {
        load_seq: u64,
        req: LoadTrackRequest,
        reply: Option<mpsc::Sender<Result<AudioSyncPayload, String>>>,
    },
    LoadMemoryPcm {
        load_seq: u64,
        req: LoadMemoryPcmRequest,
        reply: Option<mpsc::Sender<Result<AudioSyncPayload, String>>>,
    },
    Play,
    Pause,
    Stop,
    Unload,
    Seek {
        sec: f64,
    },
    SetParams {
        volume: Option<f32>,
        pitch_semitones: Option<f32>,
        looping: Option<bool>,
        normalize_preview: Option<bool>,
        slice_range: Option<Option<(f64, f64)>>,
    },
    SetDevice {
        device_id: String,
    },
    ReleaseHandle {
        target_path_norm: Option<String>,
        reply: mpsc::Sender<bool>,
    },
    TrimCaches,
}

#[derive(Clone, Default)]
pub struct AudioEngineState {
    tx: Arc<Mutex<Option<mpsc::Sender<EngineCmd>>>>,
    latest_load_seq: Arc<AtomicU64>,
    event_seq: Arc<AtomicU64>,
}

impl AudioEngineState {
    pub fn start(&self, app: AppHandle) {
        let mut guard = self.tx.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<EngineCmd>();
        *guard = Some(tx);
        let latest_load_seq = Arc::clone(&self.latest_load_seq);
        let event_seq = Arc::clone(&self.event_seq);
        let _ = thread::Builder::new()
            .name("audify-audio-ctrl".to_string())
            .spawn(move || {
                controller::run_audio_control_loop(app, rx, latest_load_seq, event_seq);
            });
    }

    fn send(&self, cmd: EngineCmd) -> Result<(), String> {
        let guard = self.tx.lock().unwrap_or_else(|e| e.into_inner());
        let Some(tx) = guard.as_ref() else {
            return Err("Native audio engine is not initialized".to_string());
        };
        tx.send(cmd)
            .map_err(|_| "Native audio control thread stopped".to_string())
    }

    pub fn load_track(&self, req: LoadTrackRequest) -> Result<AudioSyncPayload, String> {
        let load_seq = self.latest_load_seq.fetch_add(1, Ordering::AcqRel) + 1;
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(EngineCmd::Load {
            load_seq,
            req,
            reply: Some(reply_tx),
        })?;
        reply_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Audio decode timed out".to_string())?
    }

    pub fn load_memory_pcm(&self, req: LoadMemoryPcmRequest) -> Result<AudioSyncPayload, String> {
        let load_seq = self.latest_load_seq.fetch_add(1, Ordering::AcqRel) + 1;
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(EngineCmd::LoadMemoryPcm {
            load_seq,
            req,
            reply: Some(reply_tx),
        })?;
        reply_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Layer memory audio load timed out".to_string())?
    }

    pub fn play(&self) -> Result<(), String> {
        self.send(EngineCmd::Play)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send(EngineCmd::Pause)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send(EngineCmd::Stop)
    }

    pub fn unload(&self) -> Result<(), String> {
        self.send(EngineCmd::Unload)
    }

    pub fn seek(&self, sec: f64) -> Result<(), String> {
        self.send(EngineCmd::Seek { sec })
    }

    pub fn set_params(
        &self,
        volume: Option<f32>,
        pitch_semitones: Option<f32>,
        looping: Option<bool>,
        normalize_preview: Option<bool>,
        slice_range: Option<Option<(f64, f64)>>,
    ) -> Result<(), String> {
        self.send(EngineCmd::SetParams {
            volume,
            pitch_semitones,
            looping,
            normalize_preview,
            slice_range,
        })
    }

    pub fn set_device(&self, device_id: String) -> Result<(), String> {
        self.send(EngineCmd::SetDevice { device_id })
    }

    pub fn release_file_handle(&self, target_path: Option<&str>) -> bool {
        let target_path_norm = target_path
            .map(|p| normalize_clean_path(p).to_lowercase())
            .filter(|p| !p.is_empty());
        let (reply_tx, reply_rx) = mpsc::channel();
        if self
            .send(EngineCmd::ReleaseHandle {
                target_path_norm,
                reply: reply_tx,
            })
            .is_err()
        {
            return false;
        }
        reply_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or(false)
    }

    pub fn list_devices(&self) -> Vec<AudioOutputDeviceInfo> {
        output::list_output_devices()
    }

    pub fn trim_caches(&self) {
        let _ = self.send(EngineCmd::TrimCaches);
    }
}
