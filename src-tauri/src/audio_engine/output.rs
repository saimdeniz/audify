use super::dsp::PlaybackDsp;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, Stream, StreamConfig};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Default)]
pub struct CallbackSignals {
    pub ended: AtomicBool,
    pub looped: AtomicBool,
    pub became_paused: AtomicBool,
    pub stream_errored: AtomicBool,
    /// Lock-free mirror of `PlaybackDsp::is_rendering_audio()` so the controller loop never
    /// polls `dsp.lock()` at 50 Hz while WASAPI callbacks are rendering.
    pub rendering: AtomicBool,
}

impl CallbackSignals {
    pub fn record_dsp_events(&self, ended: bool, looped: bool, became_paused: bool) {
        if ended {
            self.ended.store(true, Ordering::Release);
        }
        if looped {
            self.looped.store(true, Ordering::Release);
        }
        if became_paused {
            self.became_paused.store(true, Ordering::Release);
        }
    }
}

pub struct OpenedOutputStream {
    pub stream: Stream,
    pub sample_rate: u32,
    pub active_device_id: String,
    pub active_device_name: String,
    pub estimated_latency_ms: f64,
}

/// Enumerates all system audio output endpoints (WASAPI on Windows),
/// always placing a synthetic `"default"` entry first.
pub fn list_output_devices() -> Vec<AudioOutputDeviceInfo> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let mut out = vec![AudioOutputDeviceInfo {
        id: "default".to_string(),
        name: if default_name.is_empty() {
            "System Default".to_string()
        } else {
            format!("System Default ({})", default_name)
        },
        is_default: true,
    }];

    let mut seen = HashSet::new();
    if let Ok(devices) = host.output_devices() {
        for dev in devices {
            if let Ok(name) = dev.name() {
                let clean = name.trim().to_string();
                if clean.is_empty() || !seen.insert(clean.clone()) {
                    continue;
                }
                let is_def = !default_name.is_empty() && clean == default_name;
                out.push(AudioOutputDeviceInfo {
                    id: clean.clone(),
                    name: clean,
                    is_default: is_def,
                });
            }
        }
    }
    out
}

fn build_converted_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    dsp: Arc<Mutex<PlaybackDsp>>,
    signals: Arc<CallbackSignals>,
) -> Result<Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let err_signals = Arc::clone(&signals);
    let prealloc_samples = ((config.sample_rate.0 as usize).max(48_000) / 4)
        .saturating_mul(channels.max(2))
        .max(8192);
    let mut scratch: Vec<f32> = vec![0.0; prealloc_samples];
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                if scratch.len() < data.len() {
                    scratch.resize(data.len(), 0.0);
                }
                let slice = &mut scratch[..data.len()];
                if let Ok(mut guard) = dsp.try_lock() {
                    let ev = guard.render_into(slice, channels);
                    signals
                        .rendering
                        .store(guard.is_rendering_audio(), Ordering::Release);
                    signals.record_dsp_events(ev.ended, ev.looped, ev.became_paused);
                } else {
                    slice.fill(0.0);
                }
                for (dst, &src) in data.iter_mut().zip(slice.iter()) {
                    *dst = T::from_sample(src);
                }
            },
            move |_err| {
                err_signals.stream_errored.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| format!("Failed opening output audio stream: {}", e))
}

/// Opens a shared-mode output stream on `requested_device_id` (falling back
/// automatically to the OS default output device if missing or `"default"`).
pub fn open_output_stream(
    requested_device_id: &str,
    dsp: Arc<Mutex<PlaybackDsp>>,
    signals: Arc<CallbackSignals>,
) -> Result<OpenedOutputStream, String> {
    let host = cpal::default_host();
    let req = requested_device_id.trim();

    let (device, matched_requested) = if !req.is_empty() && req != "default" {
        let found = host
            .output_devices()
            .ok()
            .and_then(|mut iter| iter.find(|d| d.name().ok().as_deref() == Some(req)));
        if let Some(dev) = found {
            (dev, true)
        } else {
            let def = host
                .default_output_device()
                .ok_or_else(|| "No audio output device available".to_string())?;
            (def, false)
        }
    } else {
        let def = host
            .default_output_device()
            .ok_or_else(|| "No audio output device available".to_string())?;
        (def, false)
    };

    let dev_name = device
        .name()
        .unwrap_or_else(|_| "System Default".to_string());
    let active_device_id = if matched_requested {
        dev_name.clone()
    } else {
        "default".to_string()
    };

    let supported = device
        .default_output_config()
        .map_err(|e| format!("Failed querying audio output format: {}", e))?;

    let sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate().0.max(8000);
    let channels = (supported.channels() as usize).max(1);
    let config: StreamConfig = supported.into();

    if let Ok(mut guard) = dsp.lock() {
        guard.set_out_sample_rate(sample_rate);
    }

    let stream = match sample_format {
        SampleFormat::F32 => {
            let err_signals = Arc::clone(&signals);
            device
                .build_output_stream(
                    &config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        if let Ok(mut guard) = dsp.try_lock() {
                            let ev = guard.render_into(data, channels);
                            signals
                                .rendering
                                .store(guard.is_rendering_audio(), Ordering::Release);
                            signals.record_dsp_events(ev.ended, ev.looped, ev.became_paused);
                        } else {
                            data.fill(0.0);
                        }
                    },
                    move |_err| {
                        err_signals.stream_errored.store(true, Ordering::Release);
                    },
                    None,
                )
                .map_err(|e| format!("Failed opening F32 audio stream: {}", e))?
        }
        SampleFormat::I16 => {
            build_converted_stream::<i16>(&device, &config, channels, dsp, signals)?
        }
        SampleFormat::I32 => {
            build_converted_stream::<i32>(&device, &config, channels, dsp, signals)?
        }
        SampleFormat::U16 => {
            build_converted_stream::<u16>(&device, &config, channels, dsp, signals)?
        }
        SampleFormat::F64 => {
            build_converted_stream::<f64>(&device, &config, channels, dsp, signals)?
        }
        other => {
            return Err(format!("Unsupported audio output sample format: {:?}", other));
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed starting audio output stream: {}", e))?;

    let estimated_latency_ms = match config.buffer_size {
        cpal::BufferSize::Fixed(frames) => (frames as f64 / sample_rate as f64) * 1000.0,
        cpal::BufferSize::Default => 12.0,
    };

    Ok(OpenedOutputStream {
        stream,
        sample_rate,
        active_device_id,
        active_device_name: dev_name,
        estimated_latency_ms,
    })
}
