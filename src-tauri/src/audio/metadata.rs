use super::EmbeddedAudioMeta;
use crate::scanner::{extract_stem_and_near_folders, tokenize_audio_identifier};
use crate::security::{has_ntfs_ads_colon, is_unc_or_network_path};
use crate::taxonomy_catalog::sanitize_id3_genre_or_mood_typo;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::Accessor;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

struct GenreMoodRule {
    facet: &'static str,
    canonical: &'static str,
    keywords: &'static [&'static str],
}

const GENRE_MOOD_RULES: &[GenreMoodRule] = &[
    // ── MOOD FACET ───────────────────────────────────────────────────────────
    GenreMoodRule {
        facet: "mood",
        canonical: "Comedy",
        keywords: &[
            "comedy", "comedic", "funny", "quirky", "cartoon", "slapstick", "silly", "playful",
            "goofy",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Horror",
        keywords: &[
            "horror", "scary", "creepy", "eerie", "nightmare", "terror", "spooky", "haunted",
            "jumpscare",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Suspense",
        keywords: &[
            "suspense",
            "thriller",
            "tension",
            "tense",
            "mystery",
            "mysterious",
            "investigation",
            "stealth",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Action",
        keywords: &[
            "action", "chase", "battle", "adrenaline", "intense", "bossfight", "exciting",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Dramatic",
        keywords: &[
            "dramatic", "drama", "emotional", "tragic", "sentimental",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Sad",
        keywords: &["sad", "melancholy", "sorrow", "tender", "somber"],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Dark",
        keywords: &[
            "dark", "ominous", "gloomy", "dystopian", "brooding", "grim", "sinister",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Upbeat",
        keywords: &[
            "upbeat", "happy", "cheerful", "uplifting", "joyful", "bright", "energetic",
            "feelgood", "positive", "funky",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Chill",
        keywords: &[
            "chill", "chillout", "relax", "relaxing", "peaceful", "calm", "lounge", "downtempo",
        ],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Fantasy",
        keywords: &["fantasy", "medieval", "celtic", "magical", "fairy", "tavern"],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Epic",
        keywords: &["epic", "heroic", "adventurous", "grand", "triumphant"],
    },
    GenreMoodRule {
        facet: "mood",
        canonical: "Ethereal",
        keywords: &["ethereal", "blissful", "dreamy", "celestial"],
    },
    // ── GENRE FACET ──────────────────────────────────────────────────────────
    GenreMoodRule {
        facet: "genre",
        canonical: "Cinematic",
        keywords: &["cinematic", "trailer", "score", "blockbuster"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Soundtrack",
        keywords: &["soundtrack", "sountrack", "filmscore", "ost", "bgm"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Lo-Fi",
        keywords: &["lofi", "chillhop"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Orchestral",
        keywords: &["orchestral", "orchestra", "symphonic", "symphony"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Classical",
        keywords: &["classical", "opera", "baroque", "chamber"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Synthwave",
        keywords: &["synthwave", "retrowave", "cyberpunk"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Electronic",
        keywords: &[
            "electronic",
            "edm",
            "techno",
            "house",
            "trance",
            "dubstep",
            "electro",
            "dnb",
            "drumandbass",
            "electronica",
        ],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Ambient",
        keywords: &["ambient", "atmospheric", "drone", "meditation", "newage"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Rock",
        keywords: &["rock", "metal", "punk", "grunge", "indierock", "hardrock"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Pop",
        keywords: &["pop", "indiepop", "synthpop", "dancepop", "disco"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Hip-Hop",
        keywords: &["hiphop", "rap", "trap", "boombap"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Jazz",
        keywords: &["jazz", "blues", "swing", "bebop", "bossa", "bossanova", "soul"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Acoustic",
        keywords: &["acoustic", "folk", "country", "bluegrass", "ballad"],
    },
    GenreMoodRule {
        facet: "genre",
        canonical: "Retro",
        keywords: &["retro", "8bit", "chiptune", "arcade", "vintage"],
    },
];

fn push_unique_tag(out: &mut Vec<(String, String)>, facet: &str, canonical: &str) {
    if !out
        .iter()
        .any(|(f, n)| f == facet && n.eq_ignore_ascii_case(canonical))
    {
        out.push((facet.to_string(), canonical.to_string()));
    }
}

fn match_tokens_to_genres_and_moods(
    tokens: &HashSet<String>,
    raw_lower: &str,
    out: &mut Vec<(String, String)>,
) {
    if raw_lower.contains("lo-fi") || raw_lower.contains("lo fi") {
        push_unique_tag(out, "genre", "Lo-Fi");
    }
    if raw_lower.contains("hip-hop") || raw_lower.contains("hip hop") {
        push_unique_tag(out, "genre", "Hip-Hop");
    }
    if raw_lower.contains("new age") || raw_lower.contains("new-age") {
        push_unique_tag(out, "genre", "Ambient");
    }
    if raw_lower.contains("boom-bap") {
        push_unique_tag(out, "genre", "Hip-Hop");
    }

    for rule in GENRE_MOOD_RULES {
        if rule.keywords.iter().any(|kw| tokens.contains(*kw)) {
            push_unique_tag(out, rule.facet, rule.canonical);
        }
    }
}

fn sync_primary_genre_field(meta: &mut EmbeddedAudioMeta) {
    if let Some((_, g)) = meta.genre_mood_tags.iter().find(|(f, _)| f == "genre") {
        meta.genre = g.clone();
    } else if let Some((_, m)) = meta.genre_mood_tags.iter().find(|(f, _)| f == "mood") {
        meta.genre = m.clone();
    }
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
            for seg in raw.split([';', '/', ',', '|']) {
                let trimmed = seg.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let lower = trimmed.to_lowercase();
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
                if let Some((facet, canonical)) = sanitize_id3_genre_or_mood_typo(trimmed) {
                    push_unique_tag(&mut meta.genre_mood_tags, facet, canonical);
                    continue;
                }
                let embedded_tokens = tokenize_audio_identifier(&lower);
                match_tokens_to_genres_and_moods(
                    &embedded_tokens,
                    &lower,
                    &mut meta.genre_mood_tags,
                );
            }
        }
    }
    sync_primary_genre_field(meta);
}

fn fill_fallback_genre_from_path(meta: &mut EmbeddedAudioMeta, file_name: &str, file_path: &str) {
    let (raw_stem, raw_parent, raw_grandparent) =
        extract_stem_and_near_folders(file_path, file_name);
    let lower_stem = raw_stem.to_lowercase();
    let lower_parent = raw_parent.to_lowercase();
    let lower_grandparent = raw_grandparent.to_lowercase();

    let name_tokens = tokenize_audio_identifier(&lower_stem);
    match_tokens_to_genres_and_moods(&name_tokens, &lower_stem, &mut meta.genre_mood_tags);

    let mut folder_tokens = tokenize_audio_identifier(&lower_parent);
    for t in tokenize_audio_identifier(&lower_grandparent) {
        folder_tokens.insert(t);
    }
    let combined_folder = format!("{} {}", lower_parent, lower_grandparent);
    match_tokens_to_genres_and_moods(&folder_tokens, &combined_folder, &mut meta.genre_mood_tags);

    sync_primary_genre_field(meta);
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

/// Single-pass Lofty probe extracting both embedded metadata (artist/album/year/genre/mood) and
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
                && meta.genre_mood_tags.is_empty()
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
