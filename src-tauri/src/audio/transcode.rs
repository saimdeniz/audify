use super::decode::{copy_packet_samples, open_audio_decoder};
use super::fnv1a_hash64;
use super::pcm_ops::{
    apply_anti_click_micro_fade_f32, push_frame_downmixed_f32, write_wav_pcm_f32,
    StreamingWavWriter,
};
use crate::security::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, normalize_clean_path, sanitize_err,
};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::errors::Error as SymphoniaError;

static TRANSCODE_TMP_COUNTER: AtomicU64 = AtomicU64::new(1);

pub(super) fn validate_readable_audio_source(source_path: &Path) -> Result<(), String> {
    let raw = source_path.to_string_lossy();
    if is_unc_or_network_path(&raw) || has_ntfs_ads_colon(&raw) {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    let meta = fs::symlink_metadata(source_path).map_err(|_| {
        format!(
            "Source audio file not found: {}",
            display_leaf(source_path)
        )
    })?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("Symbolic links and invalid audio source files are not allowed".to_string());
    }
    Ok(())
}

pub(super) fn make_atomic_tmp_path(out_path: &Path, parent_dir: &Path) -> PathBuf {
    let leaf = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("audio.wav");
    let tmp_name = format!(
        ".__audify_{}.tmp.{}.{}.wav",
        leaf,
        std::process::id(),
        TRANSCODE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    parent_dir.join(tmp_name)
}

#[cfg(target_os = "windows")]
fn atomic_replace_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    }
    let src_w: Vec<u16> = src.as_os_str().encode_wide().chain(Some(0)).collect();
    let dst_w: Vec<u16> = dst.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            src_w.as_ptr(),
            dst_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::rename(src, dst)
}

pub(super) fn finalize_atomic_tmp_file(
    tmp_path: &Path,
    out_path: &Path,
    parent_dir: &Path,
    skip_if_existing_valid: bool,
) -> Result<(), String> {
    if skip_if_existing_valid
        && fs::metadata(out_path)
            .map(|m| m.len() > 44)
            .unwrap_or(false)
    {
        let _ = fs::remove_file(tmp_path);
        return Ok(());
    }
    if let Err(replace_err) = atomic_replace_file(tmp_path, out_path) {
        if skip_if_existing_valid
            && fs::metadata(out_path)
                .map(|m| m.len() > 44)
                .unwrap_or(false)
        {
            let _ = fs::remove_file(tmp_path);
            return Ok(());
        }
        let _ = fs::remove_file(tmp_path);
        return Err(sanitize_err(parent_dir, &replace_err.to_string()));
    }
    Ok(())
}

pub(super) fn write_wav_pcm_f32_atomic(
    out_path: &Path,
    parent_dir: &Path,
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    pcm_samples: &[f32],
    skip_if_existing_valid: bool,
) -> Result<(), String> {
    let tmp_path = make_atomic_tmp_path(out_path, parent_dir);
    if let Err(e) = write_wav_pcm_f32(&tmp_path, sample_rate, channels, bits_per_sample, pcm_samples)
    {
        let _ = fs::remove_file(&tmp_path);
        return Err(sanitize_err(parent_dir, &e.to_string()));
    }
    finalize_atomic_tmp_file(&tmp_path, out_path, parent_dir, skip_if_existing_valid)
}

/// Constant-memory 1:1 slice WAV sink supporting optional 3ms half-cosine anti-click
/// fade-in/fade-out via a tiny rolling window (`2 * fade_frames` = ~6ms / ~4.6 KiB)
/// so slices shorter than 6ms never suffer double-fading, and `Drop` closes the Windows
/// handle before removing any uncommitted `.tmp` file.
pub(super) struct StreamingSliceSink {
    tmp_path: PathBuf,
    writer: Option<StreamingWavWriter>,
    sample_rate: u32,
    out_channels: usize,
    micro_fade: bool,
    fade_frames: usize,
    emitted_frames: usize,
    committed: bool,
    pkt_buf: Vec<f32>,
    fade_tail_ring: VecDeque<f32>,
}

impl Drop for StreamingSliceSink {
    fn drop(&mut self) {
        // Close handle first so Windows never fails `remove_file` with ERROR_SHARING_VIOLATION.
        self.writer.take();
        if !self.committed {
            let _ = fs::remove_file(&self.tmp_path);
        }
    }
}

impl StreamingSliceSink {
    pub(super) fn create(
        out_path: &Path,
        parent_dir: &Path,
        sample_rate: u32,
        out_channels: usize,
        out_bits: u16,
        micro_fade: bool,
    ) -> Result<Self, String> {
        let tmp_path = make_atomic_tmp_path(out_path, parent_dir);
        let writer = StreamingWavWriter::create(&tmp_path, sample_rate, out_channels as u16, out_bits)
            .map_err(|e| {
                let _ = fs::remove_file(&tmp_path);
                format!(
                    "Failed to create slice WAV: {}",
                    sanitize_err(parent_dir, &e.to_string())
                )
            })?;
        let fade_frames = if micro_fade {
            ((sample_rate as f64 * 0.003).round() as usize).max(2)
        } else {
            0
        };
        Ok(Self {
            tmp_path,
            writer: Some(writer),
            sample_rate,
            out_channels,
            micro_fade,
            fade_frames,
            emitted_frames: 0,
            committed: false,
            pkt_buf: Vec::with_capacity(4096),
            fade_tail_ring: VecDeque::new(),
        })
    }

    pub(super) fn push_packet_slice(
        &mut self,
        samples: &[f32],
        in_channels: usize,
        slice_start_frame: usize,
        slice_end_frame: usize,
        parent_dir: &Path,
    ) -> Result<(), String> {
        self.pkt_buf.clear();
        for f_idx in slice_start_frame..slice_end_frame {
            let frame_slice = &samples[f_idx * in_channels..(f_idx + 1) * in_channels];
            push_frame_downmixed_f32(frame_slice, self.out_channels, &mut self.pkt_buf);
        }

        let write_res = if self.micro_fade {
            // Buffer 2 * fade_frames (~6ms) so short <6ms slices stay completely inside the ring
            // until finish_atomic knows the exact total duration (preventing overlapping fade-in/out).
            let ring_cap = self.fade_frames * 2 * self.out_channels;
            self.fade_tail_ring.extend(self.pkt_buf.iter().copied());
            self.pkt_buf.clear();
            while self.fade_tail_ring.len() > ring_cap {
                let frame_idx = self.emitted_frames;
                let gain = if frame_idx < self.fade_frames {
                    let phase = (frame_idx as f32) / (self.fade_frames as f32);
                    0.5 * (1.0 - (std::f32::consts::PI * phase).cos())
                } else {
                    1.0
                };
                for _ in 0..self.out_channels {
                    if let Some(v) = self.fade_tail_ring.pop_front() {
                        self.pkt_buf.push(v * gain);
                    }
                }
                self.emitted_frames += 1;
            }
            if let Some(ref mut w) = self.writer {
                w.write_f32_samples(&self.pkt_buf)
            } else {
                Ok(())
            }
        } else if let Some(ref mut w) = self.writer {
            w.write_f32_samples(&self.pkt_buf)
        } else {
            Ok(())
        };

        if let Err(e) = write_res {
            self.writer.take();
            let _ = fs::remove_file(&self.tmp_path);
            return Err(format!(
                "Failed to create slice WAV: {}",
                sanitize_err(parent_dir, &e.to_string())
            ));
        }
        Ok(())
    }

    pub(super) fn finish_atomic(
        mut self,
        out_path: &Path,
        parent_dir: &Path,
    ) -> Result<String, String> {
        if self.micro_fade && !self.fade_tail_ring.is_empty() {
            let mut tail: Vec<f32> = std::mem::take(&mut self.fade_tail_ring).into_iter().collect();
            let tail_frames = tail.len() / self.out_channels.max(1);
            if self.emitted_frames == 0 {
                // Entire slice fits within <= 6ms: apply balanced fade-in/out clamped to total_frames / 2.
                apply_anti_click_micro_fade_f32(&mut tail, self.sample_rate, self.out_channels);
            } else {
                // Apply any remaining fade-in frames at head of tail, plus non-overlapping fade-out at end.
                for i in 0..tail_frames {
                    let global_idx = self.emitted_frames + i;
                    if global_idx >= self.fade_frames {
                        break;
                    }
                    let phase = (global_idx as f32) / (self.fade_frames as f32);
                    let gain = 0.5 * (1.0 - (std::f32::consts::PI * phase).cos());
                    let base = i * self.out_channels;
                    for c in 0..self.out_channels {
                        tail[base + c] *= gain;
                    }
                }
                let fade_n = self.fade_frames.min(tail_frames);
                for i in 0..fade_n {
                    let phase = (i as f32) / (fade_n as f32);
                    let gain = 0.5 * (1.0 - (std::f32::consts::PI * phase).cos());
                    let base = (tail_frames - 1 - i) * self.out_channels;
                    for c in 0..self.out_channels {
                        tail[base + c] *= gain;
                    }
                }
            }
            if let Some(ref mut w) = self.writer {
                if let Err(e) = w.write_f32_samples(&tail) {
                    self.writer.take();
                    return Err(format!(
                        "Failed to create slice WAV: {}",
                        sanitize_err(parent_dir, &e.to_string())
                    ));
                }
            }
        }
        let Some(writer) = self.writer.take() else {
            return Err("No audio frames could be decoded in the selected slice range".to_string());
        };
        if writer.sample_count() == 0 {
            drop(writer);
            return Err("No audio frames could be decoded in the selected slice range".to_string());
        }
        if let Err(e) = writer.finish() {
            return Err(format!(
                "Failed to create slice WAV: {}",
                sanitize_err(parent_dir, &e.to_string())
            ));
        }
        finalize_atomic_tmp_file(&self.tmp_path, out_path, parent_dir, false)
            .map_err(|e| format!("Failed to create slice WAV: {}", e))?;
        self.committed = true;
        Ok(out_path.to_string_lossy().to_string())
    }
}

pub fn transcode_audio_to_pcm_wav(
    source_path: &Path,
    cache_dir: &Path,
) -> Result<String, String> {
    if is_unc_or_network_path(&cache_dir.to_string_lossy())
        || has_ntfs_ads_colon(&cache_dir.to_string_lossy())
    {
        return Err("Network, UNC, and alternate data stream paths are not allowed".to_string());
    }
    validate_readable_audio_source(source_path)?;

    fs::create_dir_all(cache_dir).map_err(|e| {
        format!(
            "Failed to create playback fallback cache directory: {}",
            sanitize_err(cache_dir, &e.to_string())
        )
    })?;

    let meta = fs::metadata(source_path).ok();
    let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sample");
    let safe_stem: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let norm_lower = normalize_clean_path(&source_path.to_string_lossy()).to_lowercase();
    let hash_hex = format!(
        "{:016x}",
        fnv1a_hash64(&[
            norm_lower.as_bytes(),
            &[0xFF],
            &file_size.to_le_bytes(),
            &mtime.to_le_bytes(),
        ])
    );

    let out_file_name = format!("{}_{}.wav", safe_stem, hash_hex);
    let out_path = cache_dir.join(&out_file_name);

    if out_path.exists()
        && fs::metadata(&out_path)
            .map(|m| m.len() > 44)
            .unwrap_or(false)
    {
        return Ok(out_path.to_string_lossy().to_string());
    }

    let opened = open_audio_decoder(source_path).map_err(|e| sanitize_err(cache_dir, &e))?;
    let mut format = opened.format;
    let mut decoder = opened.decoder;
    let track_id = opened.track_id;
    let mut sample_rate = opened.sample_rate;
    let mut out_channels = opened.channels.clamp(0, 2);

    let tmp_path = make_atomic_tmp_path(&out_path, cache_dir);
    let mut wav_writer: Option<StreamingWavWriter> = None;
    let mut pkt_buf: Vec<f32> = Vec::with_capacity(4096);
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(_)) | Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => continue,
        };
        {
            let Some((spec, frames, samples)) =
                copy_packet_samples(&mut sample_buf_slot, decoded)
            else {
                continue;
            };
            if sample_rate == 0 {
                sample_rate = spec.rate;
            }
            let ch = spec.channels.count();
            if out_channels == 0 {
                out_channels = ch.clamp(1, 2);
            }
            if wav_writer.is_none() && sample_rate > 0 && out_channels > 0 {
                wav_writer = Some(
                    StreamingWavWriter::create(&tmp_path, sample_rate, out_channels as u16, 16)
                        .map_err(|e| {
                            format!(
                                "Failed to create converted PCM WAV: {}",
                                sanitize_err(cache_dir, &e.to_string())
                            )
                        })?,
                );
            }
            pkt_buf.clear();
            for f_idx in 0..frames {
                let frame_slice = &samples[f_idx * ch..(f_idx + 1) * ch];
                push_frame_downmixed_f32(frame_slice, out_channels, &mut pkt_buf);
            }
            if let Some(ref mut w) = wav_writer {
                if let Err(e) = w.write_f32_samples(&pkt_buf) {
                    drop(wav_writer.take());
                    let _ = fs::remove_file(&tmp_path);
                    return Err(format!(
                        "Failed to stream converted PCM WAV: {}",
                        sanitize_err(cache_dir, &e.to_string())
                    ));
                }
            }
        }
    }

    let Some(w) = wav_writer else {
        let _ = fs::remove_file(&tmp_path);
        return Err("No audio frames could be decoded from file".to_string());
    };
    if sample_rate == 0 || out_channels == 0 || w.sample_count() == 0 {
        drop(w);
        let _ = fs::remove_file(&tmp_path);
        return Err("No audio frames could be decoded from file".to_string());
    }
    if let Err(e) = w.finish() {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to finalize converted PCM WAV: {}",
            sanitize_err(cache_dir, &e.to_string())
        ));
    }
    finalize_atomic_tmp_file(&tmp_path, &out_path, cache_dir, true)
        .map_err(|e| format!("Failed to finalize converted PCM WAV: {}", e))?;

    Ok(out_path.to_string_lossy().to_string())
}
