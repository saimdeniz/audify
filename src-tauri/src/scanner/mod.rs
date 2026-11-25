mod auto_tag;
pub mod ucs_rules;

pub use auto_tag::match_auto_tags;
pub use ucs_rules::{
    extract_stem_and_near_folders, extract_ucs_cat_id, fold_turkish_to_ascii,
    parse_duration_directive, parse_rules_from_settings, tokenize_audio_identifier,
    UCS_CATID_MAP,
};

pub use crate::audio::{
    compute_hires_peaks, decode_audio_and_peaks, detect_audio_genre, extract_embedded_audio_meta,
    extract_embedded_meta_batch, fallback_lofty_props, transcode_audio_to_pcm_wav,
    EmbeddedAudioMeta, NUM_PEAK_BINS,
};
use crate::db::{AutoTagCategoryConfig, AutoTagRule};
use crate::security::{is_unc_or_network_path, normalize_clean_path};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use walkdir::WalkDir;

pub const SUPPORTED_EXTENSIONS: &[&str] =
    &["wav", "mp3", "flac", "ogg", "aif", "aiff", "m4a", "opus", "aac"];

/// Number of newly scanned files decoded & committed per SQLite batch so large initial
/// archives keep peak RAM bounded and survive unexpected shutdowns mid-scan.
pub const DEFAULT_SCAN_BATCH_SIZE: usize = 600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgressPayload {
    pub library_path: String,
    pub processed: usize,
    pub total: usize,
    pub percentage: f64,
    pub current_file: String,
}

#[derive(Debug, Clone)]
pub struct ScannedSample {
    pub file_path: String,
    pub file_name: String,
    pub extension: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub bit_depth: i64,
    pub file_size: i64,
    pub file_modified_at: Option<i64>,
    pub is_loop: bool,
    pub genre: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub bpm: Option<f64>,
    pub musical_key: String,
    pub camelot_key: String,
    pub peaks_json: String,
    pub auto_tags: Vec<String>,
    pub genre_mood_tags: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ExistingFileMeta {
    pub file_size: i64,
    pub file_modified_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct DirectoryScanOutput {
    pub scanned_samples: Vec<ScannedSample>,
    pub seen_paths: HashSet<String>,
    pub mtime_backfills: Vec<(String, i64)>,
}

#[derive(Debug, Clone)]
pub struct DirectoryScanSummary {
    pub seen_paths: HashSet<String>,
    pub mtime_backfills: Vec<(String, i64)>,
    pub total_scanned: usize,
}

/// Converts filesystem `Metadata::modified()` to Unix epoch milliseconds when available.
pub fn metadata_modified_ms(meta: &std::fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|st| st.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_millis()).ok())
}

/// Platform-aware path lookup key (case-insensitive on Windows).
pub fn path_lookup_key(path: &str) -> String {
    let norm = normalize_clean_path(path);
    if cfg!(windows) {
        norm.to_lowercase()
    } else {
        norm
    }
}

pub fn detect_is_loop(file_name: &str, file_path: &str, duration_ms: i64) -> bool {
    if (duration_ms > 0 && duration_ms < 350) || duration_ms > 45_000 {
        return false;
    }

    let (lower_stem, lower_parent, lower_grandparent) =
        extract_stem_and_near_folders(file_path, file_name);
    let name_tokens = tokenize_audio_identifier(&lower_stem);
    let parent_tokens = tokenize_audio_identifier(&lower_parent);
    let grand_tokens = tokenize_audio_identifier(&lower_grandparent);

    if name_tokens.contains("oneshot")
        || name_tokens.contains("stinger")
        || lower_stem.contains("one-shot")
        || lower_stem.contains("one_shot")
        || parent_tokens.contains("oneshots")
        || parent_tokens.contains("oneshot")
        || lower_parent.contains("one-shots")
        || lower_parent.contains("one shots")
    {
        return false;
    }

    let explicit_loop_in_name = name_tokens.contains("loop")
        || name_tokens.contains("loops")
        || name_tokens.contains("looped")
        || name_tokens.contains("loopable");

    let explicit_loop_folder = parent_tokens.contains("loop")
        || parent_tokens.contains("loops")
        || grand_tokens.contains("loops");

    if explicit_loop_in_name || explicit_loop_folder {
        return duration_ms == 0 || (350..=45_000).contains(&duration_ms);
    }

    if (1_200..=24_000).contains(&duration_ms) && name_tokens.contains("bpm") {
        let is_music_context = parent_tokens.contains("music")
            || parent_tokens.contains("songs")
            || parent_tokens.contains("song")
            || parent_tokens.contains("soundtrack")
            || parent_tokens.contains("ost")
            || parent_tokens.contains("bgm")
            || grand_tokens.contains("music")
            || grand_tokens.contains("soundtrack")
            || name_tokens.contains("ost")
            || name_tokens.contains("bgm")
            || name_tokens.contains("song")
            || name_tokens.contains("soundtrack")
            || name_tokens.contains("full")
            || name_tokens.contains("mix")
            || name_tokens.contains("master");

        if !is_music_context {
            return true;
        }
    }

    false
}

#[allow(clippy::too_many_arguments)]
pub fn scan_directory_in_batches<FP, FW, FB>(
    library_path: &str,
    scan_root: &Path,
    existing_files: &HashMap<String, ExistingFileMeta>,
    force_rebuild: bool,
    rules: &[AutoTagRule],
    categories: &HashMap<String, AutoTagCategoryConfig>,
    batch_size: usize,
    on_progress: FP,
    on_walk_complete: FW,
    mut on_batch: FB,
) -> Result<DirectoryScanSummary, String>
where
    FP: Fn(ScanProgressPayload) + Sync,
    FW: FnOnce(&HashSet<String>) -> Result<(), String>,
    FB: FnMut(Vec<ScannedSample>) -> Result<(), String>,
{
    let mut audio_files: Vec<(PathBuf, String, i64, Option<i64>)> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();
    let mut mtime_backfills: Vec<(String, i64)> = Vec::new();

    for entry in WalkDir::new(scan_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(".audify_trash")
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let raw_str = path.to_string_lossy();
        if is_unc_or_network_path(&raw_str) {
            continue;
        }
        let path_str = normalize_clean_path(&raw_str);
        let lower_path = path_str.to_lowercase();
        if lower_path.contains("program files")
            || lower_path.contains("windows/system32")
            || lower_path.contains("/.audify_trash/")
        {
            continue;
        }

        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };

        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let meta_opt = entry.metadata().ok();
        let file_size = meta_opt.as_ref().map(|m| m.len() as i64).unwrap_or(0);
        let file_modified_at = meta_opt.as_ref().and_then(metadata_modified_ms);
        seen_paths.insert(path_str.clone());

        if !force_rebuild {
            let lookup_key = path_lookup_key(&path_str);
            if let Some(old_meta) = existing_files.get(&lookup_key) {
                if old_meta.file_size == file_size {
                    match (old_meta.file_modified_at, file_modified_at) {
                        (Some(old_ms), Some(disk_ms)) if old_ms == disk_ms => continue,
                        (Some(_), None) | (None, None) => continue,
                        (None, Some(disk_ms)) => {
                            mtime_backfills.push((lookup_key, disk_ms));
                            continue;
                        }
                        (Some(_), Some(_)) => {
                            // External edit kept identical byte length: fall through to re-scan.
                        }
                    }
                }
            }
        }

        audio_files.push((path.to_path_buf(), path_str, file_size, file_modified_at));
    }

    on_walk_complete(&seen_paths)?;

    let total = audio_files.len();
    if total == 0 {
        on_progress(ScanProgressPayload {
            library_path: library_path.to_string(),
            processed: 0,
            total: 0,
            percentage: 100.0,
            current_file: String::new(),
        });
        return Ok(DirectoryScanSummary {
            seen_paths,
            mtime_backfills,
            total_scanned: 0,
        });
    }

    let processed_counter = AtomicUsize::new(0);
    let chunk_size = batch_size.max(1);

    for chunk in audio_files.chunks(chunk_size) {
        let batch_samples: Vec<ScannedSample> = chunk
            .par_iter()
            .map(|(path, path_str, file_size, file_modified_at)| {
                let file_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let extension = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let (duration_ms, sample_rate, channels, bit_depth, peaks_json) =
                    match decode_audio_and_peaks(path) {
                        Some(res) => res,
                        None => {
                            let (d, sr, ch, bd) = fallback_lofty_props(path);
                            (d, sr, ch, bd, "[]".to_string())
                        }
                    };

                let is_loop = detect_is_loop(&file_name, path_str, duration_ms);
                let (meta, fast_bpm_key) = crate::audio::extract_embedded_meta_and_bpm_key(
                    Some(path),
                    &file_name,
                    path_str,
                );
                let auto_tags = match_auto_tags(
                    path_str,
                    &file_name,
                    duration_ms,
                    is_loop,
                    rules,
                    categories,
                );

                let done = processed_counter.fetch_add(1, Ordering::Relaxed) + 1;
                if done == 1 || done == total || done.is_multiple_of(15) {
                    let pct = ((done as f64 / total as f64) * 100.0).clamp(0.0, 100.0);
                    on_progress(ScanProgressPayload {
                        library_path: library_path.to_string(),
                        processed: done,
                        total,
                        percentage: pct,
                        current_file: file_name.clone(),
                    });
                }

                ScannedSample {
                    file_path: path_str.clone(),
                    file_name,
                    extension,
                    duration_ms,
                    sample_rate,
                    channels,
                    bit_depth,
                    file_size: *file_size,
                    file_modified_at: *file_modified_at,
                    is_loop,
                    genre: meta.genre,
                    artist: meta.artist,
                    album: meta.album,
                    year: meta.year,
                    bpm: fast_bpm_key.bpm,
                    musical_key: fast_bpm_key.musical_key,
                    camelot_key: fast_bpm_key.camelot_key,
                    peaks_json,
                    auto_tags,
                    genre_mood_tags: meta.genre_mood_tags,
                }
            })
            .collect();

        if !batch_samples.is_empty() {
            on_batch(batch_samples)?;
        }
    }

    Ok(DirectoryScanSummary {
        seen_paths,
        mtime_backfills,
        total_scanned: total,
    })
}

pub fn scan_directory_with_progress<F>(
    library_path: &str,
    scan_root: &Path,
    existing_files: &HashMap<String, ExistingFileMeta>,
    force_rebuild: bool,
    rules: &[AutoTagRule],
    categories: &HashMap<String, AutoTagCategoryConfig>,
    on_progress: F,
) -> DirectoryScanOutput
where
    F: Fn(ScanProgressPayload) + Sync,
{
    let mut scanned = Vec::new();
    let summary = scan_directory_in_batches(
        library_path,
        scan_root,
        existing_files,
        force_rebuild,
        rules,
        categories,
        usize::MAX,
        on_progress,
        |_| Ok(()),
        |batch| {
            scanned.extend(batch);
            Ok(())
        },
    )
    .unwrap_or_else(|_| DirectoryScanSummary {
        seen_paths: HashSet::new(),
        mtime_backfills: Vec::new(),
        total_scanned: 0,
    });

    DirectoryScanOutput {
        scanned_samples: scanned,
        seen_paths: summary.seen_paths,
        mtime_backfills: summary.mtime_backfills,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_fold_turkish_to_ascii() {
        assert_eq!(fold_turkish_to_ascii("Rüzgar_Uğultusu"), "ruzgar_ugultusu");
        assert_eq!(fold_turkish_to_ascii("Silah_Ateşi"), "silah_atesi");
        assert_eq!(fold_turkish_to_ascii("Çığlık_Ve_Adım"), "ciglik_ve_adim");
        assert_eq!(fold_turkish_to_ascii("Örnek_Şarkı"), "ornek_sarki");
    }

    #[test]
    fn test_extract_ucs_cat_id() {
        assert_eq!(
            extract_ucs_cat_id("EXPLDsgn_MassiveBlast_01.wav"),
            Some("Explosion")
        );
        assert_eq!(extract_ucs_cat_id("WHSH_FastAir_BM02.wav"), Some("Whoosh"));
        assert_eq!(extract_ucs_cat_id("UIClick_Select_01.wav"), Some("UI"));
        assert_eq!(
            extract_ucs_cat_id("AMBUrbn_Traffic_5min.wav"),
            Some("Ambience")
        );
        assert_eq!(
            extract_ucs_cat_id("WEAPGun_Rifle_Shot.wav"),
            Some("Weapons")
        );
        assert_eq!(extract_ucs_cat_id("Regular_Sound_File.wav"), None);
    }

    #[test]
    fn test_duration_parsing() {
        assert_eq!(
            parse_duration_directive("@dur<2s"),
            Some((None, Some(2000)))
        );
        assert_eq!(
            parse_duration_directive("@dur>15s"),
            Some((Some(15000), None))
        );
        assert_eq!(
            parse_duration_directive("@<1.5s"),
            Some((None, Some(1500)))
        );
        assert_eq!(
            parse_duration_directive("@>30s"),
            Some((Some(30000), None))
        );
        assert_eq!(parse_duration_directive("normal_keyword"), None);
    }

    #[test]
    fn test_match_auto_tags_duration_and_and_operator() {
        let rules = vec![
            AutoTagRule {
                id: "r1".to_string(),
                tag_name: "ShortWhoosh".to_string(),
                tag_color: "#F59E0B".to_string(),
                keywords: vec!["whoosh".to_string(), "@dur<2s".to_string()],
                enabled: true,
                category: None,
                include_paths: None,
                exclude_paths: None,
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
                min_duration_ms: None,
                max_duration_ms: Some(2000),
                facet_slug: None,
                parent_tag_name: None,
            },
            AutoTagRule {
                id: "r2".to_string(),
                tag_name: "MetalImpact".to_string(),
                tag_color: "#DC2626".to_string(),
                keywords: vec!["metal + impact".to_string()],
                enabled: true,
                category: None,
                include_paths: None,
                exclude_paths: None,
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
                min_duration_ms: None,
                max_duration_ms: None,
                facet_slug: None,
                parent_tag_name: None,
            },
            AutoTagRule {
                id: "r3".to_string(),
                tag_name: "WeatherTR".to_string(),
                tag_color: "#64748B".to_string(),
                keywords: vec!["yagmur".to_string()],
                enabled: true,
                category: None,
                include_paths: None,
                exclude_paths: None,
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
                min_duration_ms: None,
                max_duration_ms: None,
                facet_slug: None,
                parent_tag_name: None,
            },
            AutoTagRule {
                id: "r4".to_string(),
                tag_name: "Explosion".to_string(),
                tag_color: "#F97316".to_string(),
                keywords: vec!["bomb".to_string()],
                enabled: true,
                category: None,
                include_paths: None,
                exclude_paths: None,
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
                min_duration_ms: None,
                max_duration_ms: None,
                facet_slug: None,
                parent_tag_name: None,
            },
        ];
        let cats = HashMap::new();

        let matched = match_auto_tags(
            "C:/Sounds/Whoosh_01.wav",
            "Whoosh_01.wav",
            1200,
            false,
            &rules,
            &cats,
        );
        assert!(matched.contains(&"ShortWhoosh".to_string()));

        let matched_long = match_auto_tags(
            "C:/Sounds/Whoosh_01.wav",
            "Whoosh_01.wav",
            3500,
            false,
            &rules,
            &cats,
        );
        assert!(!matched_long.contains(&"ShortWhoosh".to_string()));

        let matched_both = match_auto_tags(
            "C:/Sounds/Metal_Impact_Hit.wav",
            "Metal_Impact_Hit.wav",
            500,
            false,
            &rules,
            &cats,
        );
        assert!(matched_both.contains(&"MetalImpact".to_string()));

        let matched_only_metal = match_auto_tags(
            "C:/Sounds/Metal_Scrape.wav",
            "Metal_Scrape.wav",
            500,
            false,
            &rules,
            &cats,
        );
        assert!(!matched_only_metal.contains(&"MetalImpact".to_string()));

        let matched_tr = match_auto_tags(
            "C:/Sounds/Yağmur_Sesi.wav",
            "Yağmur_Sesi.wav",
            1000,
            false,
            &rules,
            &cats,
        );
        assert!(matched_tr.contains(&"WeatherTR".to_string()));

        let matched_ucs = match_auto_tags(
            "C:/Sounds/EXPLDsgn_DeepBlast.wav",
            "EXPLDsgn_DeepBlast.wav",
            2000,
            false,
            &rules,
            &cats,
        );
        assert!(matched_ucs.contains(&"Explosion".to_string()));
    }

    #[test]
    fn test_category_vs_rule_scope_override_and_union_exclude() {
        let mut categories = HashMap::new();
        categories.insert(
            "sfx".to_string(),
            AutoTagCategoryConfig {
                name: "SFX".to_string(),
                include_paths: vec!["C:/Audio/SFX".to_string()],
                exclude_paths: vec!["C:/Audio/SFX/Raw".to_string()],
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
            },
        );

        let rules = vec![
            // Inherits SFX category include_paths & exclude_paths
            AutoTagRule {
                id: "r-inherit".to_string(),
                tag_name: "InheritWhoosh".to_string(),
                tag_color: "#F59E0B".to_string(),
                keywords: vec!["whoosh".to_string()],
                enabled: true,
                category: Some("SFX".to_string()),
                include_paths: None,
                exclude_paths: Some(vec!["C:/Audio/SFX/Scratch".to_string()]),
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
                min_duration_ms: None,
                max_duration_ms: None,
                facet_slug: None,
                parent_tag_name: None,
            },
            // Rule include_paths overrides category include_paths, while exclusions remain union
            AutoTagRule {
                id: "r-override".to_string(),
                tag_name: "OverrideImpact".to_string(),
                tag_color: "#EF4444".to_string(),
                keywords: vec!["impact".to_string()],
                enabled: true,
                category: Some("sfx".to_string()), // mixed/lowercase check
                include_paths: Some(vec!["C:/Audio/Custom".to_string()]),
                exclude_paths: Some(vec!["C:/Audio/Custom/Draft".to_string()]),
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
                min_duration_ms: None,
                max_duration_ms: None,
                facet_slug: None,
                parent_tag_name: None,
            },
        ];

        // Inherited include works inside C:/Audio/SFX
        let sfx_ok = match_auto_tags(
            "C:/Audio/SFX/Whoosh_01.wav",
            "Whoosh_01.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(sfx_ok.contains(&"InheritWhoosh".to_string()));

        // Outside category include fails for inherited rule
        let outside = match_auto_tags(
            "C:/Audio/Music/Whoosh_Intro.wav",
            "Whoosh_Intro.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(!outside.contains(&"InheritWhoosh".to_string()));

        // Category exclude blocks inherited rule, and rule exclude also blocks it
        let cat_excluded = match_auto_tags(
            "C:/Audio/SFX/Raw/Whoosh_Raw.wav",
            "Whoosh_Raw.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(!cat_excluded.contains(&"InheritWhoosh".to_string()));

        let rule_excluded = match_auto_tags(
            "C:/Audio/SFX/Scratch/Whoosh_Scratch.wav",
            "Whoosh_Scratch.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(!rule_excluded.contains(&"InheritWhoosh".to_string()));

        // Rule override allows Custom folder outside category include, while rejecting category's own SFX folder
        let custom_ok = match_auto_tags(
            "C:/Audio/Custom/Impact_01.wav",
            "Impact_01.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(custom_ok.contains(&"OverrideImpact".to_string()));

        let sfx_not_in_override = match_auto_tags(
            "C:/Audio/SFX/Impact_02.wav",
            "Impact_02.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(!sfx_not_in_override.contains(&"OverrideImpact".to_string()));

        // Category exclude + rule exclude union both apply even when include is overridden
        let rule_override_draft = match_auto_tags(
            "C:/Audio/Custom/Draft/Impact_Draft.wav",
            "Impact_Draft.wav",
            500,
            false,
            &rules,
            &categories,
        );
        assert!(!rule_override_draft.contains(&"OverrideImpact".to_string()));

        let mut categories_for_union = HashMap::new();
        categories_for_union.insert(
            "sfx".to_string(),
            AutoTagCategoryConfig {
                name: "SFX".to_string(),
                include_paths: vec!["C:/Audio/SFX".to_string()],
                exclude_paths: vec!["BlockedSub".to_string()],
                rel_include_paths: Vec::new(),
                rel_exclude_paths: Vec::new(),
            },
        );
        let union_hit = match_auto_tags(
            "C:/Audio/Custom/BlockedSub/Impact_03.wav",
            "Impact_03.wav",
            500,
            false,
            &rules,
            &categories_for_union,
        );
        assert!(!union_hit.contains(&"OverrideImpact".to_string()));
    }

    #[test]
    fn test_scope_relative_paths_and_settings_parser_case_insensitive() {
        let settings = r##"{
            "autoTagCategories": [{
                "name": "Music",
                "include_paths": [],
                "exclude_paths": [],
                "rel_include_paths": ["Music/Stems"],
                "rel_exclude_paths": ["Music/Stems/Raw"]
            }],
            "autoTagRules": [{
                "id": "r-rel",
                "tag_name": "CombatMusic",
                "tag_color": "#22C55E",
                "keywords": ["battle"],
                "enabled": true,
                "category": "music"
            }]
        }"##;
        let (rules, cats) = parse_rules_from_settings(settings);

        let matched = match_auto_tags(
            "D:/NewDrive/Library/Music/Stems/BattleTheme.wav",
            "BattleTheme.wav",
            60000,
            false,
            &rules,
            &cats,
        );
        assert_eq!(matched, vec!["CombatMusic".to_string()]);

        let excluded = match_auto_tags(
            "D:/NewDrive/Library/Music/Stems/Raw/BattleTheme.wav",
            "BattleTheme.wav",
            60000,
            false,
            &rules,
            &cats,
        );
        assert!(excluded.is_empty());
    }

    #[test]
    fn test_duration_ms_directive_and_camelcase_mixed_keyword_matching() {
        let settings = r##"{
            "autoTagRules": [
                {
                    "id": "ms",
                    "tag_name": "SubHalfSec",
                    "tag_color": "#22C55E",
                    "keywords": ["@dur<500ms"],
                    "enabled": true
                },
                {
                    "id": "camel",
                    "tag_name": "Heavy",
                    "tag_color": "#3B82F6",
                    "keywords": ["heavy"],
                    "enabled": true
                },
                {
                    "id": "mixed",
                    "tag_name": "KickDrum",
                    "tag_color": "#F59E0B",
                    "keywords": ["Kick-Drum"],
                    "enabled": true
                }
            ]
        }"##;
        let (rules, cats) = parse_rules_from_settings(settings);

        let hits_short = match_auto_tags(
            "D:/Packs/HeavyKick.wav",
            "HeavyKick.wav",
            320,
            false,
            &rules,
            &cats,
        );
        assert!(hits_short.contains(&"SubHalfSec".to_string()));
        assert!(hits_short.contains(&"Heavy".to_string()));

        let hits_mixed = match_auto_tags(
            "D:/Packs/kick_drum_01.wav",
            "kick_drum_01.wav",
            900,
            false,
            &rules,
            &cats,
        );
        assert!(!hits_mixed.contains(&"SubHalfSec".to_string()));
        assert!(hits_mixed.contains(&"KickDrum".to_string()));
    }

    #[test]
    fn test_ucs_catid_avoids_english_false_positives_and_scope_respects_boundaries() {
        // Common English filenames MUST NOT trigger UCS CatIDs
        for false_pos in [
            "Rainbow.wav",
            "Rainbow_Loop.wav",
            "Window_Break.wav",
            "RAINBOW_Loop.wav",
            "WINDOW_Break.wav",
            "FOOTBALL_Crowd.wav",
            "Amber_Pad.wav",
            "Scissors_Cut.wav",
            "Football_Crowd.wav",
        ] {
            assert_eq!(
                extract_ucs_cat_id(false_pos),
                None,
                "Unexpected UCS match for {}",
                false_pos
            );
        }

        // Genuine UCS CatIDs still match
        assert_eq!(extract_ucs_cat_id("AMB_Forest.wav"), Some("Ambience"));
        assert_eq!(extract_ucs_cat_id("AMBBird_Park.wav"), Some("Ambience"));
        assert_eq!(extract_ucs_cat_id("RAIN_Heavy.wav"), Some("Weather"));
        assert_eq!(extract_ucs_cat_id("SCIFI_Laser.wav"), Some("Sci-Fi"));
        assert_eq!(extract_ucs_cat_id("EXPL_BigBoom.wav"), Some("Explosion"));

        // Category scope path filter MUST require directory segment boundaries
        let settings = r##"{
            "autoTagCategories": [{
                "name": "SFX",
                "include_paths": ["D:/Packs/SFX"],
                "exclude_paths": ["Raw"]
            }],
            "autoTagRules": [{
                "id": "r-hit",
                "tag_name": "Hit",
                "tag_color": "#EF4444",
                "keywords": ["hit"],
                "enabled": true,
                "category": "SFX"
            }]
        }"##;
        let (rules, cats) = parse_rules_from_settings(settings);

        // `SFX` include must NOT match `SFX_Old`
        assert!(match_auto_tags(
            "D:/Packs/SFX_Old/Hit_01.wav",
            "Hit_01.wav",
            500,
            false,
            &rules,
            &cats
        )
        .is_empty());

        // `Raw` exclude must NOT match filename substring `strawberry_hit.wav`
        assert_eq!(
            match_auto_tags(
                "D:/Packs/SFX/strawberry_hit.wav",
                "strawberry_hit.wav",
                500,
                false,
                &rules,
                &cats
            ),
            vec!["Hit".to_string()]
        );

        // `Raw` exclude DOES match actual `Raw` folder
        assert!(match_auto_tags(
            "D:/Packs/SFX/Raw/Hit_01.wav",
            "Hit_01.wav",
            500,
            false,
            &rules,
            &cats
        )
        .is_empty());
    }
}
