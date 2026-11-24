use super::streaming::StreamingTrack;
use crate::audio::{copy_packet_samples, open_audio_decoder};
use crate::security::normalize_clean_path;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use symphonia::core::audio::{SampleBuffer, SignalSpec};

/// Tracks up to ~62s @ 48 kHz (~24 MiB stereo f32) decode straight into RAM so
/// the OS file handle closes immediately (zero Windows sharing violations) and
/// instant zero-latency seeking/looping is guaranteed.
pub const MAX_INMEM_FRAMES: usize = 3_000_000;

/// Small LRU cache for decoded short/medium samples (instant arrow-key browsing).
const MAX_CACHE_TRACKS: usize = 4;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;

#[inline]
fn clean_sample(raw: f32) -> f32 {
    if raw.is_finite() {
        raw.clamp(-4.0, 4.0)
    } else {
        0.0
    }
}

/// Converts interleaved arbitrary-channel PCM into interleaved stereo f32.
pub(crate) fn push_interleaved_stereo(samples: &[f32], ch_count: usize, out: &mut Vec<f32>) {
    match ch_count {
        0 => {}
        1 => {
            out.reserve(samples.len() * 2);
            for &raw in samples {
                let s = clean_sample(raw);
                out.push(s);
                out.push(s);
            }
        }
        2 => {
            out.reserve(samples.len());
            for frame in samples.as_chunks::<2>().0 {
                out.push(clean_sample(frame[0]));
                out.push(clean_sample(frame[1]));
            }
        }
        3 => {
            let frames = samples.len() / 3;
            out.reserve(frames * 2);
            let norm = 1.0 / (1.0 + 0.707_106_77);
            for frame in samples.as_chunks::<3>().0 {
                let c = clean_sample(frame[2]) * 0.707_106_77;
                let l = clean_sample(frame[0]) + c;
                let r = clean_sample(frame[1]) + c;
                out.push((l * norm).clamp(-4.0, 4.0));
                out.push((r * norm).clamp(-4.0, 4.0));
            }
        }
        4 => {
            // Quadraphonic (FL, FR, BL, BR): preserve both rear channels without dropping BR
            let frames = samples.len() / 4;
            out.reserve(frames * 2);
            let norm = 1.0 / (1.0 + 0.707_106_77);
            for frame in samples.as_chunks::<4>().0 {
                let l = clean_sample(frame[0]) + clean_sample(frame[2]) * 0.707_106_77;
                let r = clean_sample(frame[1]) + clean_sample(frame[3]) * 0.707_106_77;
                out.push((l * norm).clamp(-4.0, 4.0));
                out.push((r * norm).clamp(-4.0, 4.0));
            }
        }
        5 => {
            // 5.0 Surround (FL, FR, C, BL, BR)
            let frames = samples.len() / 5;
            out.reserve(frames * 2);
            let norm = 1.0 / (1.0 + 0.707_106_77 + 0.5);
            for frame in samples.as_chunks::<5>().0 {
                let c = clean_sample(frame[2]) * 0.707_106_77;
                let l = clean_sample(frame[0]) + c + clean_sample(frame[3]) * 0.5;
                let r = clean_sample(frame[1]) + c + clean_sample(frame[4]) * 0.5;
                out.push((l * norm).clamp(-4.0, 4.0));
                out.push((r * norm).clamp(-4.0, 4.0));
            }
        }
        ch => {
            let frames = samples.len() / ch;
            out.reserve(frames * 2);
            // ITU-R BS.775-style gain normalization prevents multi-channel sum clipping
            let norm = if ch >= 8 {
                1.0 / (1.0 + 0.707_106_77 + 0.5 + 0.5)
            } else if ch == 7 {
                1.0 / (1.0 + 0.707_106_77 + 0.35 + 0.5)
            } else {
                1.0 / (1.0 + 0.707_106_77 + 0.5)
            };
            for frame in samples.chunks_exact(ch) {
                let c = clean_sample(frame[2]) * 0.707_106_77;
                let mut l = clean_sample(frame[0]) + c;
                let mut r = clean_sample(frame[1]) + c;
                if ch == 7 {
                    // 6.1 Surround (FL, FR, C, LFE, BC, SL, SR)
                    let bc = clean_sample(frame[4]) * 0.35;
                    l += bc + clean_sample(frame[5]) * 0.5;
                    r += bc + clean_sample(frame[6]) * 0.5;
                } else {
                    if ch >= 6 {
                        l += clean_sample(frame[4]) * 0.5;
                        r += clean_sample(frame[5]) * 0.5;
                    }
                    if ch >= 8 {
                        l += clean_sample(frame[6]) * 0.5;
                        r += clean_sample(frame[7]) * 0.5;
                    }
                }
                out.push((l * norm).clamp(-4.0, 4.0));
                out.push((r * norm).clamp(-4.0, 4.0));
            }
        }
    }
}

/// Computes the exact `-14 dBFS` active-RMS + peak-safe auto-gain multiplier
/// used across Audify (`[0.20 .. 1.0]`) in a single pass during decode.
pub(crate) struct NormGainAccumulator {
    pub(crate) sample_rate: u32,
    analyzed_frames: u64,
    active_rms_sq_sum: f64,
    active_blocks: usize,
    global_peak: f32,
}

impl NormGainAccumulator {
    pub(crate) fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate: sample_rate.max(1),
            analyzed_frames: 0,
            active_rms_sq_sum: 0.0,
            active_blocks: 0,
            global_peak: 0.0,
        }
    }

    pub(crate) fn feed_stereo(&mut self, stereo: &[f32]) {
        let max_frames = (self.sample_rate as u64).saturating_mul(12);
        if self.analyzed_frames >= max_frames {
            return;
        }
        for chunk in stereo.chunks(2048) {
            if self.analyzed_frames >= max_frames {
                break;
            }
            let mut sum_sq = 0.0_f64;
            for &raw_s in chunk {
                let s = raw_s.clamp(-2.0, 2.0);
                let a = s.abs();
                if a > self.global_peak {
                    self.global_peak = a;
                }
                sum_sq += (s as f64) * (s as f64);
            }
            let rms = (sum_sq / (chunk.len().max(1) as f64)).sqrt();
            if rms > 0.0025 {
                self.active_rms_sq_sum += rms * rms;
                self.active_blocks += 1;
            }
            self.analyzed_frames = self.analyzed_frames.saturating_add((chunk.len() / 2) as u64);
        }
    }

    pub(crate) fn current_gain(&self) -> f32 {
        if self.active_blocks == 0 {
            return 1.0;
        }
        let active_rms = (self.active_rms_sq_sum / (self.active_blocks as f64)).sqrt() as f32;
        if !active_rms.is_finite() || active_rms <= 0.001 {
            return 1.0;
        }
        let target_rms: f32 = 0.199_526; // -14.0 dBFS
        let desired = target_rms / active_rms;
        let peak_safe = if self.global_peak > 0.98 {
            0.95 / self.global_peak
        } else {
            1.0
        };
        desired.min(peak_safe).clamp(0.20, 1.0)
    }
}

/// Detects leading digital/room-floor silence on stereo interleaved f32 PCM.
/// Returns seconds to skip (with a 5ms pre-roll margin so transient attacks stay intact),
/// or `0.0` if the track starts promptly (<25ms) or is completely quiet.
pub(crate) fn detect_leading_silence_sec(samples: &[f32], sample_rate: u32) -> f64 {
    if sample_rate == 0 || samples.len() < 4 {
        return 0.0;
    }
    let total_frames = samples.len() / 2;
    let sr_f = sample_rate as f64;
    let duration_sec = (total_frames as f64) / sr_f;
    if duration_sec <= 0.08 {
        return 0.0;
    }

    const THRESHOLD: f32 = 0.005; // ~ -46 dBFS
    let max_scan_frames = total_frames.min((sample_rate as usize).saturating_mul(15));
    let mut first_active_frame: Option<usize> = None;

    for frame_idx in 0..max_scan_frames {
        let base = frame_idx * 2;
        if samples[base].abs() >= THRESHOLD || samples[base + 1].abs() >= THRESHOLD {
            first_active_frame = Some(frame_idx);
            break;
        }
    }

    let Some(active_frame) = first_active_frame else {
        return 0.0;
    };
    let preroll_frames = (sr_f * 0.005).round() as usize;
    let skip_frames = active_frame.saturating_sub(preroll_frames);
    let skip_sec = (skip_frames as f64) / sr_f;
    if skip_sec < 0.025 || skip_sec >= duration_sec - 0.05 {
        return 0.0;
    }
    skip_sec
}

pub struct DecodedTrack {
    pub path_norm: String,
    pub sample_rate: u32,
    pub total_frames: u64,
    pub samples: Vec<f32>,
    pub norm_gain: f32,
    pub leading_silence_sec: f64,
}

impl DecodedTrack {
    pub fn byte_len(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }

    #[inline]
    pub fn read_frame(&self, frame: i64) -> Option<(f32, f32)> {
        if frame < 0 || (frame as u64) >= self.total_frames {
            return None;
        }
        let idx = (frame as usize) * 2;
        if idx + 1 >= self.samples.len() {
            return None;
        }
        Some((self.samples[idx], self.samples[idx + 1]))
    }
}

#[derive(Clone)]
pub enum AudioSource {
    InMemory(Arc<DecodedTrack>),
    Streaming(Arc<StreamingTrack>),
}

impl AudioSource {
    pub fn path_norm(&self) -> &str {
        match self {
            Self::InMemory(t) => &t.path_norm,
            Self::Streaming(t) => &t.path_norm,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        match self {
            Self::InMemory(t) => t.sample_rate,
            Self::Streaming(t) => t.sample_rate,
        }
    }

    pub fn total_frames(&self) -> u64 {
        match self {
            Self::InMemory(t) => t.total_frames,
            Self::Streaming(t) => t.total_frames(),
        }
    }

    pub fn duration_sec(&self) -> f64 {
        let sr = self.sample_rate().max(1) as f64;
        (self.total_frames() as f64) / sr
    }

    pub fn norm_gain(&self) -> f32 {
        match self {
            Self::InMemory(t) => t.norm_gain,
            Self::Streaming(t) => t.norm_gain(),
        }
    }

    pub fn leading_silence_sec(&self) -> f64 {
        match self {
            Self::InMemory(t) => t.leading_silence_sec,
            Self::Streaming(_) => 0.0,
        }
    }

    pub fn is_eof(&self) -> bool {
        match self {
            Self::InMemory(_) => true,
            Self::Streaming(t) => t.is_eof(),
        }
    }

    #[inline]
    pub fn read_frame(&self, frame: i64) -> Option<(f32, f32)> {
        match self {
            Self::InMemory(t) => t.read_frame(frame),
            Self::Streaming(t) => t.read_frame_try(frame),
        }
    }

    pub fn notify_playhead(&self, frame: u64) {
        if let Self::Streaming(t) = self {
            t.advance_floor_try(frame);
        }
    }

    pub fn request_seek(&self, target_frame: u64) {
        if let Self::Streaming(t) = self {
            t.request_seek(target_frame);
        }
    }

    pub fn request_seek_nonblocking(&self, target_frame: u64) {
        if let Self::Streaming(t) = self {
            t.request_seek_nonblocking(target_frame);
        }
    }

    pub fn release_file_handle(&self) {
        if let Self::Streaming(t) = self {
            t.close_and_wait();
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
struct CacheIdentity {
    path_norm: String,
    file_size: u64,
    mtime_ms: u128,
}

impl CacheIdentity {
    fn from_path(path: &Path) -> Self {
        let path_norm = normalize_clean_path(&path.to_string_lossy()).to_lowercase();
        let meta = fs::metadata(path).ok();
        let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime_ms = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        Self {
            path_norm,
            file_size,
            mtime_ms,
        }
    }
}

#[derive(Default)]
pub struct TrackDecodeCache {
    entries: VecDeque<(CacheIdentity, Arc<DecodedTrack>)>,
    total_bytes: usize,
}

impl TrackDecodeCache {
    fn get(&mut self, id: &CacheIdentity) -> Option<Arc<DecodedTrack>> {
        let pos = self.entries.iter().position(|(k, _)| k == id)?;
        let entry = self.entries.remove(pos)?;
        let track = Arc::clone(&entry.1);
        self.entries.push_back(entry);
        Some(track)
    }

    fn insert(&mut self, id: CacheIdentity, track: Arc<DecodedTrack>) {
        let bytes = track.byte_len();
        if bytes > MAX_CACHE_BYTES {
            return;
        }
        self.evict_path(&id.path_norm);
        while self.entries.len() >= MAX_CACHE_TRACKS
            || self.total_bytes.saturating_add(bytes) > MAX_CACHE_BYTES
        {
            let Some((_, old)) = self.entries.pop_front() else {
                break;
            };
            self.total_bytes = self.total_bytes.saturating_sub(old.byte_len());
        }
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        self.entries.push_back((id, track));
    }

    pub fn evict_path(&mut self, path_norm: &str) {
        let target = path_norm.to_lowercase();
        let mut i = 0;
        while i < self.entries.len() {
            if self.entries[i].0.path_norm == target {
                if let Some((_, old)) = self.entries.remove(i) {
                    self.total_bytes = self.total_bytes.saturating_sub(old.byte_len());
                }
            } else {
                i += 1;
            }
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }
}

/// Opens a validated audio file via Symphonia using our hybrid memory model:
/// short/medium files (<= ~62s) decode into RAM and close their OS handle
/// immediately; long recordings stream incrementally through a bounded 4s ring.
pub fn open_audio_source(
    canon_path: &Path,
    cache: &mut TrackDecodeCache,
) -> Result<AudioSource, String> {
    let cache_id = CacheIdentity::from_path(canon_path);
    if let Some(hit) = cache.get(&cache_id) {
        return Ok(AudioSource::InMemory(hit));
    }

    let mut opened = open_audio_decoder(canon_path)?;
    let path_norm = cache_id.path_norm.clone();

    if let Some(n_frames) = opened.n_frames {
        if n_frames > MAX_INMEM_FRAMES as u64 && opened.sample_rate > 0 {
            let norm_acc = NormGainAccumulator::new(opened.sample_rate);
            let stream = StreamingTrack::spawn(
                canon_path.to_path_buf(),
                path_norm,
                opened,
                Vec::new(),
                norm_acc,
            );
            return Ok(AudioSource::Streaming(stream));
        }
    }

    let mut sr = opened.sample_rate;
    let mut norm_acc = NormGainAccumulator::new(if sr > 0 { sr } else { 44100 });
    let mut samples: Vec<f32> = Vec::with_capacity(
        opened
            .n_frames
            .map(|f| (f as usize).min(MAX_INMEM_FRAMES) * 2)
            .unwrap_or(65536),
    );
    let mut sample_buf_slot: Option<(SignalSpec, usize, SampleBuffer<f32>)> = None;

    loop {
        let packet = match opened.format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::ResetRequired) => {
                opened.decoder.reset();
                continue;
            }
            Err(_) => break,
        };
        if packet.track_id() != opened.track_id {
            continue;
        }
        match opened.decoder.decode(&packet) {
            Ok(decoded) => {
                let Some((spec, _frames, pcm)) = copy_packet_samples(&mut sample_buf_slot, decoded)
                else {
                    continue;
                };
                if sr == 0 {
                    sr = spec.rate;
                    norm_acc.sample_rate = sr.max(1);
                }
                let start_len = samples.len();
                push_interleaved_stereo(pcm, spec.channels.count().max(1), &mut samples);
                norm_acc.feed_stereo(&samples[start_len..]);

                if (samples.len() / 2) > MAX_INMEM_FRAMES {
                    opened.sample_rate = if sr > 0 { sr } else { 44100 };
                    let stream = StreamingTrack::spawn(
                        canon_path.to_path_buf(),
                        path_norm,
                        opened,
                        samples,
                        norm_acc,
                    );
                    return Ok(AudioSource::Streaming(stream));
                }
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                opened.decoder.reset();
            }
            Err(_) => {}
        }
    }

    if samples.is_empty() {
        return Err("Audio file contains no decodable PCM frames".to_string());
    }

    let total_frames = (samples.len() / 2) as u64;
    let safe_sr = sr.max(1);
    let leading_silence_sec = detect_leading_silence_sec(&samples, safe_sr);
    let decoded = Arc::new(DecodedTrack {
        path_norm,
        sample_rate: safe_sr,
        total_frames,
        samples,
        norm_gain: norm_acc.current_gain(),
        leading_silence_sec,
    });
    cache.insert(cache_id, Arc::clone(&decoded));
    Ok(AudioSource::InMemory(decoded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::write_wav_i16;
    use std::time::SystemTime;

    #[test]
    fn detects_leading_silence_with_preroll_and_ignores_all_silent_tracks() {
        let sr = 48_000u32;
        // 0.30s silence followed by 0.20s loud tone
        let mut samples = vec![0.0_f32; 48_000]; // 24,000 stereo frames = 0.50s
        for f in 14_400..24_000 {
            samples[f * 2] = 0.4;
            samples[f * 2 + 1] = 0.4;
        }
        let skipped = detect_leading_silence_sec(&samples, sr);
        // Expected ~0.295s (0.30s minus 5ms transient pre-roll)
        assert!(
            (skipped - 0.295).abs() < 0.003,
            "Expected ~0.295s skip, got {}",
            skipped
        );

        // Completely silent track must return 0.0
        let all_silent = vec![0.0001_f32; 48_000];
        assert_eq!(detect_leading_silence_sec(&all_silent, sr), 0.0);

        // Immediate transient (<25ms) must return 0.0
        let mut immediate = vec![0.0_f32; 48_000];
        immediate[200] = 0.5;
        assert_eq!(detect_leading_silence_sec(&immediate, sr), 0.0);
    }

    #[test]
    fn decodes_short_wav_into_ram_closes_handle_and_hits_lru_cache() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("audify_eng_dec_{}", nanos));
        fs::create_dir_all(&dir).unwrap();
        let wav_path = dir.join("kick.wav");
        let pcm: Vec<i16> = (0..4410)
            .map(|i| ((i as f32 * 0.1).sin() * 12000.0) as i16)
            .collect();
        write_wav_i16(&wav_path, 44_100, 1, &pcm).unwrap();

        let mut cache = TrackDecodeCache::default();
        let src1 = open_audio_source(&wav_path, &mut cache).unwrap();
        assert!(matches!(src1, AudioSource::InMemory(_)));
        assert_eq!(src1.sample_rate(), 44_100);
        assert_eq!(src1.total_frames(), 4410);
        assert!(src1.norm_gain() >= 0.20 && src1.norm_gain() <= 1.0);

        let src2 = open_audio_source(&wav_path, &mut cache).unwrap();
        assert_eq!(src2.total_frames(), 4410);

        // OS file handle closed immediately after decode -> Windows rename succeeds cleanly
        let renamed = dir.join("kick_renamed.wav");
        fs::rename(&wav_path, &renamed).unwrap();

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn quad_four_channel_downmix_preserves_back_right_channel() {
        // 4ch Quad frame: FL=0.0, FR=0.0, BL=0.0, BR=0.8 -> right output must contain BR energy
        let frame = [0.0_f32, 0.0, 0.0, 0.8];
        let mut out = Vec::new();
        push_interleaved_stereo(&frame, 4, &mut out);
        assert_eq!(out.len(), 2);
        assert!(out[0].abs() < 1e-6);
        assert!(
            (out[1] - 0.33137).abs() < 1e-3,
            "Expected BR energy (~0.331) in right channel, got {}",
            out[1]
        );
    }
}
