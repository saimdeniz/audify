mod decode;
mod export;
pub mod layer_mixer;
mod layer_pcm_cache;
mod layer_recipe;
mod loudness;
mod metadata;
mod pcm_ops;
mod pitch_shift;
mod transcode;

pub(crate) use decode::{copy_packet_samples, open_audio_decoder, OpenedAudioDecoder};
pub use decode::{
    compute_bins_from_blocks, compute_hires_peaks, compute_preview_norm_gain,
    decode_audio_and_peaks, fallback_lofty_props,
};
pub use layer_mixer::{
    clear_layer_pcm_cache, evict_layer_pcm_cache_path, export_rendered_layer_wav,
    render_layer_mix, render_layer_mix_cancellable, LAYER_RENDER_CANCELLED_ERR, MAX_LAYER_CLIPS,
};
pub use layer_recipe::{
    validate_and_normalize_recipe, LanePeaksPreview, LayerClipSpec, LayerLaneSpec, LayerPitchMode,
    LayerRecipe, RenderedLayerMix, LAYER_MIX_SAMPLE_RATE,
};
#[cfg(test)]
pub use export::{export_wav_slice, export_wav_slice_with_options, export_wav_slice_with_preset};
pub use export::{
    build_default_slice_file_name_with_params, export_wav_slice_to_path_with_params,
    export_wav_slice_with_params, SliceExportParams,
};
pub use metadata::{
    detect_audio_genre, extract_embedded_audio_meta, extract_embedded_meta_and_bpm_key,
    extract_embedded_meta_batch, extract_embedded_meta_batch_with_progress,
    resolve_metadata_titles_validated,
};
pub use pcm_ops::write_wav_i16;
pub use transcode::transcode_audio_to_pcm_wav;

use crate::security::normalize_clean_path;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub const NUM_PEAK_BINS: usize = 600;

#[derive(Debug, Clone, Default)]
pub struct EmbeddedAudioMeta {
    pub genre: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    /// Detected canonical `(facet_slug, tag_name)` pairs across both `genre` and `mood` facets.
    pub genre_mood_tags: Vec<(String, String)>,
}

/// Deterministic 64-bit FNV-1a hash across byte slices.
pub fn fnv1a_hash64(chunks: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for chunk in chunks {
        for &b in *chunk {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

/// Deterministic 8-char lowercase hex hash (XOR-folded 64-bit FNV-1a).
pub fn fnv1a_hex8(chunks: &[&[u8]]) -> String {
    let h64 = fnv1a_hash64(chunks);
    let h32 = ((h64 >> 32) as u32) ^ (h64 as u32);
    format!("{:08x}", h32)
}

/// Deterministic 8-char hash of `(normalize_clean_path(file_path).to_lowercase(), file_size, mtime_ms)`.
pub fn file_identity_hash8(path: &Path) -> String {
    let norm_lower = normalize_clean_path(&path.to_string_lossy()).to_lowercase();
    let meta = fs::metadata(path).ok();
    let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime_ms = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    fnv1a_hex8(&[
        norm_lower.as_bytes(),
        &[0xFF],
        &file_size.to_le_bytes(),
        &mtime_ms.to_le_bytes(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn write_test_wav_f32(path: &Path, sample_rate: u32, channels: u16, samples: &[f32]) {
        let mut f = File::create(path).unwrap();
        let data_bytes = (samples.len() * 4) as u32;
        let riff_size = 36 + data_bytes;
        let block_align = channels * 4;
        let byte_rate = sample_rate * (block_align as u32);
        f.write_all(b"RIFF").unwrap();
        f.write_all(&riff_size.to_le_bytes()).unwrap();
        f.write_all(b"WAVEfmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&3u16.to_le_bytes()).unwrap(); // IEEE float = 3
        f.write_all(&channels.to_le_bytes()).unwrap();
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&byte_rate.to_le_bytes()).unwrap();
        f.write_all(&block_align.to_le_bytes()).unwrap();
        f.write_all(&32u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&data_bytes.to_le_bytes()).unwrap();
        for &s in samples {
            f.write_all(&s.to_le_bytes()).unwrap();
        }
    }

    #[test]
    fn export_wav_slice_rejects_nan_infinity_and_invalid_ranges() {
        let root = std::env::temp_dir().join(format!("audify_slice_nan_{}", std::process::id()));
        let slices = root.join("slices");
        fs::create_dir_all(&slices).unwrap();
        let src = root.join("tone.wav");
        let samples: Vec<i16> = (0..44100).map(|i| ((i % 200) * 100) as i16).collect();
        write_wav_i16(&src, 44100, 1, &samples).unwrap();

        assert!(export_wav_slice(&src, &slices, f64::NAN, 0.5).is_err());
        assert!(export_wav_slice(&src, &slices, 0.0, f64::NAN).is_err());
        assert!(export_wav_slice(&src, &slices, 0.0, f64::INFINITY).is_err());
        assert!(export_wav_slice(&src, &slices, f64::NEG_INFINITY, 0.5).is_err());
        assert!(export_wav_slice(&src, &slices, -0.1, 0.5).is_err());
        assert!(export_wav_slice(&src, &slices, 0.5, 0.5).is_err());
        assert!(export_wav_slice(&src, &slices, 0.8, 0.2).is_err());
        assert!(export_wav_slice(&src, &slices, 0.0, 9999.0).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_wav_slice_produces_collision_free_hash_filenames() {
        let root = std::env::temp_dir().join(format!("audify_slice_hash_{}", std::process::id()));
        let dir_a = root.join("Pack_A");
        let dir_b = root.join("Pack_B");
        let slices = root.join("slices");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        fs::create_dir_all(&slices).unwrap();

        let file_a = dir_a.join("impact_01.wav");
        let file_b = dir_b.join("impact_01.wav");
        let samples_a: Vec<i16> = (0..22050).map(|_| 8000i16).collect();
        let samples_b: Vec<i16> = (0..22050).map(|_| -12000i16).collect();
        write_wav_i16(&file_a, 44100, 1, &samples_a).unwrap();
        write_wav_i16(&file_b, 44100, 1, &samples_b).unwrap();

        let out_a = export_wav_slice(&file_a, &slices, 0.0, 0.25).unwrap();
        let out_b = export_wav_slice(&file_b, &slices, 0.0, 0.25).unwrap();

        assert_ne!(out_a, out_b, "Two identically named files in different folders must not collide");
        assert!(Path::new(&out_a).is_file());
        assert!(Path::new(&out_b).is_file());
        assert!(out_a.contains("_slice_0.000s_0.250s.wav"));
        assert!(out_b.contains("_slice_0.000s_0.250s.wav"));

        let out_fine = export_wav_slice(&file_a, &slices, 0.0, 0.254).unwrap();
        assert_ne!(out_a, out_fine, "Sub-10ms slice edits must produce distinct filenames");
        assert!(out_fine.contains("_slice_0.000s_0.254s.wav"));

        let ads_path = dir_a.join("impact_01.wav:hidden");
        assert!(export_wav_slice(&ads_path, &slices, 0.0, 0.25).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn decode_peaks_and_transcode_survive_nan_and_downmix_multichannel() {
        let root = std::env::temp_dir().join(format!("audify_f32_nan_{}", std::process::id()));
        let cache = root.join("fallback");
        fs::create_dir_all(&cache).unwrap();

        // 6-channel float32 WAV containing NaN and Infinity samples
        let wav_6ch = root.join("surround_nan.wav");
        let mut samples = Vec::with_capacity(4096 * 6);
        for i in 0..4096 {
            if i == 100 {
                samples.extend_from_slice(&[
                    f32::NAN,
                    f32::INFINITY,
                    f32::NEG_INFINITY,
                    0.5,
                    -0.5,
                    0.25,
                ]);
            } else {
                samples.extend_from_slice(&[0.6, -0.4, 0.2, 0.1, 0.3, -0.3]);
            }
        }
        write_test_wav_f32(&wav_6ch, 48000, 6, &samples);

        let (_, sr, ch, _, peaks_json) = decode_audio_and_peaks(&wav_6ch).unwrap();
        assert_eq!(sr, 48000);
        assert_eq!(ch, 6);
        assert_ne!(peaks_json, "[]", "NaN/Inf samples must not wipe peaks_json to []");
        let parsed: Vec<f32> = serde_json::from_str(&peaks_json).unwrap();
        assert_eq!(parsed.len(), NUM_PEAK_BINS);

        // Transcode 6ch -> 2ch stereo PCM WAV
        let out_wav = transcode_audio_to_pcm_wav(&wav_6ch, &cache).unwrap();
        let header = fs::read(&out_wav).unwrap();
        assert_eq!(&header[0..4], b"RIFF");
        let out_channels = u16::from_le_bytes([header[22], header[23]]);
        assert_eq!(out_channels, 2, "6-channel surround must downmix to 2-channel stereo");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_wav_slice_with_options_applies_varispeed_pitch_and_3ms_microfade() {
        let root = std::env::temp_dir().join(format!("audify_pitch_fade_{}", std::process::id()));
        let slices = root.join("slices");
        fs::create_dir_all(&slices).unwrap();

        let src = root.join("dc_step.wav");
        // 0.50s of constant +10000 amplitude at 48 kHz mono (24000 samples)
        let samples = vec![10_000i16; 24_000];
        write_wav_i16(&src, 48000, 1, &samples).unwrap();

        // 1. +12 semitones (2x varispeed) should produce ~half as many PCM bytes
        let pitched_up =
            export_wav_slice_with_options(&src, &slices, 0.0, 0.40, Some(12.0), Some(false))
                .unwrap();
        let normal =
            export_wav_slice_with_options(&src, &slices, 0.0, 0.40, None, Some(false)).unwrap();
        let bytes_up = fs::read(&pitched_up).unwrap();
        let bytes_norm = fs::read(&normal).unwrap();
        let data_up = bytes_up.len() - 44;
        let data_norm = bytes_norm.len() - 44;
        assert!(
            (data_up as f64 - (data_norm as f64) * 0.5).abs() < 64.0,
            "+12st varispeed should halve exported frame count (up={}, norm={})",
            data_up,
            data_norm
        );

        // 1b. +24st (4x varispeed) and -24st (0.25x varispeed = Sononym 2-octave bounds)
        let pitched_up_24 =
            export_wav_slice_with_options(&src, &slices, 0.0, 0.40, Some(24.0), Some(false))
                .unwrap();
        let pitched_down_24 =
            export_wav_slice_with_options(&src, &slices, 0.0, 0.40, Some(-24.0), Some(false))
                .unwrap();
        let data_up_24 = fs::read(&pitched_up_24).unwrap().len() - 44;
        let data_down_24 = fs::read(&pitched_down_24).unwrap().len() - 44;
        assert!(
            (data_up_24 as f64 - (data_norm as f64) * 0.25).abs() < 64.0,
            "+24st varispeed should quarter exported frame count (up24={}, norm={})",
            data_up_24,
            data_norm
        );
        assert!(
            (data_down_24 as f64 - (data_norm as f64) * 4.0).abs() < 128.0,
            "-24st varispeed should quadruple exported frame count (down24={}, norm={})",
            data_down_24,
            data_norm
        );

        // Without micro-fade, first and last sample of DC signal remain ~10000
        let norm_first = i16::from_le_bytes([bytes_norm[44], bytes_norm[45]]);
        let norm_last = i16::from_le_bytes([
            bytes_norm[bytes_norm.len() - 2],
            bytes_norm[bytes_norm.len() - 1],
        ]);
        assert!(norm_first > 9000 && norm_last > 9000);

        // 2. With 3ms micro-fade enabled, first and last sample fade cleanly to ~0
        let faded =
            export_wav_slice_with_options(&src, &slices, 0.0, 0.40, None, Some(true)).unwrap();
        let bytes_faded = fs::read(&faded).unwrap();
        let faded_first = i16::from_le_bytes([bytes_faded[44], bytes_faded[45]]);
        let faded_last = i16::from_le_bytes([
            bytes_faded[bytes_faded.len() - 2],
            bytes_faded[bytes_faded.len() - 1],
        ]);
        assert_eq!(faded_first, 0, "3ms micro-fade must start at zero crossing");
        assert!(
            faded_last.abs() <= 100,
            "3ms micro-fade must ramp end down to zero (got {})",
            faded_last
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_wav_slice_preserves_24bit_and_supports_nle_48k_24bit_preset() {
        let root = std::env::temp_dir().join(format!("audify_24bit_nle_{}", std::process::id()));
        let slices = root.join("slices");
        fs::create_dir_all(&slices).unwrap();

        // 1. 44.1 kHz 16-bit mono source (0.50s = 22050 frames)
        let src_44k = root.join("sfx_44k16.wav");
        let samples_44k: Vec<i16> = (0..22_050)
            .map(|i| (((i as f32) * 0.05).sin() * 20_000.0) as i16)
            .collect();
        write_wav_i16(&src_44k, 44_100, 1, &samples_44k).unwrap();

        // Preset wav_24 keeps 44.1 kHz and outputs 24-bit PCM (3 bytes/sample)
        let out_24 = export_wav_slice_with_preset(
            &src_44k,
            &slices,
            0.0,
            0.25,
            None,
            Some(false),
            Some("wav_24"),
        )
        .unwrap();
        assert!(out_24.contains("_24b.wav"));
        let bytes_24 = fs::read(&out_24).unwrap();
        let sr_24 = u32::from_le_bytes([bytes_24[24], bytes_24[25], bytes_24[26], bytes_24[27]]);
        let bits_24 = u16::from_le_bytes([bytes_24[34], bytes_24[35]]);
        assert_eq!(sr_24, 44_100);
        assert_eq!(bits_24, 24);
        assert_eq!((bytes_24.len() - 44) % 3, 0);

        // Preset nle_48k_24 resamples 44.1 kHz -> 48 kHz and outputs 24-bit PCM
        let out_nle = export_wav_slice_with_preset(
            &src_44k,
            &slices,
            0.0,
            0.25,
            None,
            Some(false),
            Some("nle_48k_24"),
        )
        .unwrap();
        assert!(out_nle.contains("_48k24b.wav"));
        let bytes_nle = fs::read(&out_nle).unwrap();
        let sr_nle = u32::from_le_bytes([bytes_nle[24], bytes_nle[25], bytes_nle[26], bytes_nle[27]]);
        let bits_nle = u16::from_le_bytes([bytes_nle[34], bytes_nle[35]]);
        let frames_nle = (bytes_nle.len() - 44) / 3;
        assert_eq!(sr_nle, 48_000);
        assert_eq!(bits_nle, 24);
        assert!(
            (frames_nle as isize - 12_000).abs() <= 16,
            "0.25s resampled to 48kHz should yield ~12000 frames (got {})",
            frames_nle
        );

        // 2. 48 kHz 32-bit float source exported with "original" preserves lossless 24-bit (not 16-bit)
        let src_f32 = root.join("hi_res_32f.wav");
        let f32_samples: Vec<f32> = (0..12_000).map(|i| ((i as f32) * 0.02).sin() * 0.5).collect();
        write_test_wav_f32(&src_f32, 48_000, 1, &f32_samples);
        let out_orig_hi = export_wav_slice_with_preset(
            &src_f32,
            &slices,
            0.0,
            0.20,
            None,
            Some(false),
            Some("original"),
        )
        .unwrap();
        let bytes_orig_hi = fs::read(&out_orig_hi).unwrap();
        let bits_orig_hi = u16::from_le_bytes([bytes_orig_hi[34], bytes_orig_hi[35]]);
        assert_eq!(
            bits_orig_hi, 24,
            "Original preset must preserve 24-bit headroom on >16-bit lossless sources"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_wav_slice_with_loudness_normalization_boosts_quiet_sfx_and_tags_filename() {
        let root = std::env::temp_dir().join(format!("audify_loud_exp_{}", std::process::id()));
        let slices = root.join("slices");
        fs::create_dir_all(&slices).unwrap();

        // Quiet 48 kHz mono 1 kHz sine (~ -20 dBFS peak = ~3276 i16)
        let src = root.join("quiet_foley.wav");
        let quiet_samples: Vec<i16> = (0..48_000)
            .map(|i| (((i as f64) * 2.0 * std::f64::consts::PI * 1000.0 / 48_000.0).sin() * 3200.0) as i16)
            .collect();
        write_wav_i16(&src, 48_000, 1, &quiet_samples).unwrap();

        let out_peak = export_wav_slice_with_params(
            &src,
            &slices,
            &SliceExportParams {
                start_sec: 0.0,
                end_sec: 0.8,
                pitch_semitones: None,
                apply_micro_fade: Some(false),
                export_preset: Some("original"),
                loudness_mode: Some("peak_m1"),
            },
        )
        .unwrap();
        assert!(out_peak.contains("_pk1.wav"));
        let bytes = fs::read(&out_peak).unwrap();
        let max_abs = bytes[44..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| i16::from_le_bytes([c[0], c[1]]).unsigned_abs())
            .max()
            .unwrap_or(0);
        // -1 dBTP of 32767 is ~29203
        assert!(
            max_abs > 28_000 && max_abs <= 29_500,
            "Peak -1 dBTP export should boost quiet SFX to ~29203 (got {})",
            max_abs
        );

        let out_lufs = export_wav_slice_with_params(
            &src,
            &slices,
            &SliceExportParams {
                start_sec: 0.0,
                end_sec: 0.8,
                pitch_semitones: None,
                apply_micro_fade: Some(false),
                export_preset: Some("original"),
                loudness_mode: Some("lufs_m14"),
            },
        )
        .unwrap();
        assert!(out_lufs.contains("_lufs14.wav"));
        assert_ne!(out_lufs, out_peak);

        let _ = fs::remove_dir_all(&root);
    }
}