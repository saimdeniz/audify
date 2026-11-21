use super::EmbeddedAudioMeta;
use crate::scanner::{extract_stem_and_near_folders, tokenize_audio_identifier};
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path};
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::Accessor;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

fn match_tokens_to_canonical_genre(tokens: &HashSet<String>, raw_lower: &str) -> Option<String> {
    let genre_rules: &[(&str, &[&str])] = &[
        (
            "Comedy",
            &[
                "comedy",
                "comedic",
                "funny",
                "quirky",
                "cartoon",
                "slapstick",
                "silly",
                "playful",
                "goofy",
            ],
        ),
        (
            "Horror",
            &[
                "horror",
                "scary",
                "creepy",
                "eerie",
                "nightmare",
                "terror",
                "spooky",
                "haunted",
                "jumpscare",
            ],
        ),
        (
            "Suspense",
            &[
                "suspense",
                "thriller",
                "tension",
                "tense",
                "mystery",
                "mysterious",
                "investigation",
                "stealth",
            ],
        ),
        (
            "Cinematic",
            &[
                "cinematic",
                "trailer",
                "score",
                "filmscore",
                "soundtrack",
                "blockbuster",
            ],
        ),
        (
            "Action",
            &[
                "action",
                "chase",
                "battle",
                "combat",
                "adrenaline",
                "intense",
                "bossfight",
            ],
        ),
        (
            "Dramatic",
            &[
                "dramatic",
                "drama",
                "emotional",
                "melancholy",
                "sad",
                "tragic",
                "sorrow",
                "sentimental",
            ],
        ),
        (
            "Dark",
            &[
                "dark",
                "ominous",
                "gloomy",
                "dystopian",
                "brooding",
                "grim",
                "sinister",
            ],
        ),
        (
            "Upbeat",
            &[
                "upbeat",
                "happy",
                "cheerful",
                "uplifting",
                "joyful",
                "bright",
                "energetic",
                "feelgood",
                "positive",
                "funky",
            ],
        ),
        ("Lo-Fi", &["lofi", "chillhop"]),
        (
            "Chill",
            &[
                "chill",
                "chillout",
                "relax",
                "relaxing",
                "peaceful",
                "calm",
                "lounge",
                "downtempo",
            ],
        ),
        (
            "Orchestral",
            &[
                "orchestral",
                "orchestra",
                "symphonic",
                "symphony",
                "classical",
                "strings",
                "brass",
                "choir",
            ],
        ),
        (
            "Electronic",
            &[
                "electronic",
                "edm",
                "synthwave",
                "techno",
                "house",
                "trance",
                "dubstep",
                "electro",
                "dnb",
                "drumandbass",
            ],
        ),
        (
            "Ambient",
            &[
                "ambient",
                "ambience",
                "atmosphere",
                "atmospheric",
                "drone",
                "meditation",
                "ethereal",
            ],
        ),
        (
            "Rock",
            &[
                "rock",
                "metal",
                "punk",
                "grunge",
                "indierock",
                "hardrock",
                "overdrive",
            ],
        ),
        ("Pop", &["pop", "indiepop", "synthpop", "dancepop"]),
        (
            "Hip-Hop",
            &["hiphop", "rap", "trap", "boom-bap", "boombap", "beats"],
        ),
        (
            "Jazz",
            &[
                "jazz",
                "blues",
                "swing",
                "bebop",
                "bossa",
                "bossanova",
                "soul",
            ],
        ),
        ("Retro", &["retro", "8bit", "chiptune", "arcade", "vintage"]),
        (
            "Fantasy",
            &[
                "fantasy", "medieval", "celtic", "magical", "fairy", "tavern",
            ],
        ),
        (
            "Sci-Fi",
            &["scifi", "cyberpunk", "futuristic", "space", "alien"],
        ),
    ];

    if raw_lower.contains("lo-fi") || raw_lower.contains("lo fi") {
        return Some("Lo-Fi".to_string());
    }
    if raw_lower.contains("hip-hop") || raw_lower.contains("hip hop") {
        return Some("Hip-Hop".to_string());
    }
    if raw_lower.contains("sci-fi") || raw_lower.contains("sci fi") {
        return Some("Sci-Fi".to_string());
    }

    for (canonical, keywords) in genre_rules {
        for kw in *keywords {
            if tokens.contains(*kw) {
                return Some((*canonical).to_string());
            }
        }
    }
    None
}

fn populate_embedded_meta_from_tagged(
    tagged: &lofty::file::TaggedFile,
    meta: &mut EmbeddedAudioMeta,
) {
    for tag in tagged.tags() {
        if meta.artist.is_empty() {
            if let Some(a) = tag
                .artist()
                .map(|c| c.into_owned())
                .or_else(|| {
                    tag.get_string(&lofty::tag::ItemKey::AlbumArtist)
                        .map(|s| s.to_string())
                })
                .or_else(|| {
                    tag.get_string(&lofty::tag::ItemKey::Composer)
                        .map(|s| s.to_string())
                })
            {
                let s = a.trim().to_string();
                if !s.is_empty() {
                    meta.artist = s;
                }
            }
        }

        if meta.album.is_empty() {
            if let Some(al) = tag.album() {
                let s = al.trim().to_string();
                if !s.is_empty() {
                    meta.album = s;
                }
            }
        }

        if meta.year.is_empty() {
            if let Some(y) = tag.year() {
                if (1900..=2100).contains(&y) {
                    meta.year = y.to_string();
                }
            }
            if meta.year.is_empty() {
                if let Some(raw_date) = tag
                    .get_string(&lofty::tag::ItemKey::Year)
                    .or_else(|| tag.get_string(&lofty::tag::ItemKey::RecordingDate))
                    .or_else(|| tag.get_string(&lofty::tag::ItemKey::OriginalReleaseDate))
                {
                    let digits: String = raw_date
                        .trim()
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    if digits.len() == 4 {
                        meta.year = digits;
                    }
                }
            }
        }

        if meta.genre.is_empty() {
            let mut raw_candidates: Vec<String> = Vec::new();
            if let Some(g) = tag.genre() {
                let s = g.trim().to_string();
                if !s.is_empty() {
                    raw_candidates.push(s);
                }
            }
            if let Some(m) = tag.get_string(&lofty::tag::ItemKey::Mood) {
                let s = m.trim().to_string();
                if !s.is_empty() {
                    raw_candidates.push(s);
                }
            }

            for raw in raw_candidates {
                let lower = raw.to_lowercase();
                if lower == "other"
                    || lower == "unknown"
                    || lower == "sfx"
                    || lower == "sound effect"
                    || lower == "sound effects"
                    || lower == "none"
                    || lower
                        .chars()
                        .all(|c| c.is_numeric() || c == '(' || c == ')')
                {
                    continue;
                }
                let embedded_tokens = tokenize_audio_identifier(&lower);
                if let Some(canonical) = match_tokens_to_canonical_genre(&embedded_tokens, &lower) {
                    meta.genre = canonical;
                    break;
                }
                let first_seg = raw
                    .split([';', '/', ',', '|'])
                    .next()
                    .unwrap_or("")
                    .trim();
                if first_seg.len() >= 3 && first_seg.len() <= 22 {
                    meta.genre = first_seg.to_string();
                    break;
                }
            }
        }
    }
}

fn fill_fallback_genre_from_path(meta: &mut EmbeddedAudioMeta, file_name: &str, file_path: &str) {
    if meta.genre.is_empty() {
        let (lower_stem, lower_parent, lower_grandparent) =
            extract_stem_and_near_folders(file_path, file_name);
        let name_tokens = tokenize_audio_identifier(&lower_stem);
        if let Some(g) = match_tokens_to_canonical_genre(&name_tokens, &lower_stem) {
            meta.genre = g;
        } else {
            let mut folder_tokens = tokenize_audio_identifier(&lower_parent);
            for t in tokenize_audio_identifier(&lower_grandparent) {
                folder_tokens.insert(t);
            }
            let combined_folder = format!("{} {}", lower_parent, lower_grandparent);
            if let Some(g) = match_tokens_to_canonical_genre(&folder_tokens, &combined_folder) {
                meta.genre = g;
            }
        }
    }
}

fn open_safe_lofty_tagged_file(path: Option<&Path>) -> Option<lofty::file::TaggedFile> {
    let p = path?;
    let raw = p.to_string_lossy();
    let is_safe_regular = !is_unc_or_network_path(&raw)
        && !has_ntfs_ads_colon(&raw)
        && fs::symlink_metadata(p)
            .map(|m| !m.file_type().is_symlink() && m.is_file())
            .unwrap_or(false);
    if !is_safe_regular {
        return None;
    }
    Probe::open(p).ok()?.read().ok()
}

/// Single-pass Lofty probe extracting both embedded metadata (artist/album/year/genre) and
/// fast BPM/Key tags (`TBPM`/`TKEY`) + filename heuristics without opening the file twice.
pub fn extract_embedded_meta_and_bpm_key(
    path: Option<&Path>,
    file_name: &str,
    file_path: &str,
) -> (EmbeddedAudioMeta, crate::dsp_analysis::BpmKeyResult) {
    let mut meta = EmbeddedAudioMeta::default();
    let mut bpm_key = crate::dsp_analysis::BpmKeyResult::default();

    if let Some(tagged) = open_safe_lofty_tagged_file(path) {
        populate_embedded_meta_from_tagged(&tagged, &mut meta);
        crate::dsp_analysis::extract_bpm_key_from_tagged_file(&tagged, &mut bpm_key);
    }

    fill_fallback_genre_from_path(&mut meta, file_name, file_path);
    crate::dsp_analysis::fill_bpm_key_from_filename(file_name, &mut bpm_key);
    (meta, bpm_key)
}

pub fn extract_embedded_audio_meta(
    path: Option<&Path>,
    file_name: &str,
    file_path: &str,
) -> EmbeddedAudioMeta {
    let mut meta = EmbeddedAudioMeta::default();
    if let Some(tagged) = open_safe_lofty_tagged_file(path) {
        populate_embedded_meta_from_tagged(&tagged, &mut meta);
    }
    fill_fallback_genre_from_path(&mut meta, file_name, file_path);
    meta
}

pub fn detect_audio_genre(path: Option<&Path>, file_name: &str, file_path: &str) -> String {
    extract_embedded_audio_meta(path, file_name, file_path).genre
}

pub fn extract_embedded_meta_batch(
    items: &[(i64, String, String)],
) -> Vec<(i64, EmbeddedAudioMeta)> {
    items
        .par_iter()
        .filter_map(|(id, file_path, file_name)| {
            if is_unc_or_network_path(file_path) || has_ntfs_ads_colon(file_path) {
                return None;
            }
            let p = Path::new(file_path);
            let path_opt = if fs::symlink_metadata(p)
                .map(|m| !m.file_type().is_symlink() && m.is_file())
                .unwrap_or(false)
            {
                Some(p)
            } else {
                None
            };
            let meta = extract_embedded_audio_meta(path_opt, file_name, file_path);
            if meta.genre.is_empty()
                && meta.artist.is_empty()
                && meta.album.is_empty()
                && meta.year.is_empty()
            {
                None
            } else {
                Some((*id, meta))
            }
        })
        .collect()
}

pub fn resolve_metadata_titles_validated(
    validated_pairs: &[(String, std::path::PathBuf)],
) -> HashMap<String, String> {
    validated_pairs
        .par_iter()
        .filter_map(|(orig_key, canon_path)| {
            let probed = Probe::open(canon_path).ok()?;
            let tagged = probed.read().ok()?;
            let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
            let title = tag.title()?.trim().to_string();
            if title.is_empty() {
                None
            } else {
                Some((orig_key.clone(), title))
            }
        })
        .collect()
}