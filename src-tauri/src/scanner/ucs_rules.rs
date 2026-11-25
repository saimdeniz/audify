use crate::db::{default_auto_tag_rules, AutoTagCategoryConfig, AutoTagRule};
use std::collections::{HashMap, HashSet};


pub fn parse_rules_from_settings(
    settings_json: &str,
) -> (Vec<AutoTagRule>, HashMap<String, AutoTagCategoryConfig>) {
    let mut rules = default_auto_tag_rules();
    let mut categories = HashMap::new();

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(settings_json) {
        if let Some(rules_val) = val.get("autoTagRules") {
            if let Ok(parsed_rules) = serde_json::from_value::<Vec<AutoTagRule>>(rules_val.clone())
            {
                if !parsed_rules.is_empty() {
                    rules = parsed_rules;
                }
            }
        }
        if let Some(cat_val) = val.get("autoTagCategories") {
            if let Ok(parsed_cats) =
                serde_json::from_value::<Vec<AutoTagCategoryConfig>>(cat_val.clone())
            {
                for c in parsed_cats {
                    let key = c.name.trim().to_lowercase();
                    if !key.is_empty() {
                        categories.insert(key, c);
                    }
                }
            }
        }
    }

    (rules, categories)
}

/// Folds Turkish and common accented Latin characters to standard lowercase ASCII equivalents.
/// E.g. 'ş' -> 's', 'ı' -> 'i', 'İ' -> 'i', 'ğ' -> 'g', 'ç' -> 'c', 'ö' -> 'o', 'ü' -> 'u'.
pub fn fold_turkish_to_ascii(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'ı' | 'I' | 'İ' | 'î' | 'Î' => out.push('i'),
            'ş' | 'Ş' => out.push('s'),
            'ğ' | 'Ğ' => out.push('g'),
            'ü' | 'Ü' | 'û' | 'Û' => out.push('u'),
            'ö' | 'Ö' | 'ô' | 'Ô' => out.push('o'),
            'ç' | 'Ç' => out.push('c'),
            'â' | 'Â' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => out.push('e'),
            other => {
                for lc in other.to_lowercase() {
                    out.push(lc);
                }
            }
        }
    }
    out
}

pub const UCS_CATID_MAP: &[(&str, &str)] = &[
    ("EXPL", "Explosion"),
    ("WHSH", "Whoosh"),
    ("SWSH", "Whoosh"),
    ("WEAP", "Weapons"),
    ("GUN", "Gunshot"),
    ("SWD", "Melee"),
    ("MAGC", "Magic"),
    ("SPLL", "Magic"),
    ("FIRE", "Fire"),
    ("WATR", "Water"),
    ("SCIFI", "Sci-Fi"),
    ("SCIF", "Sci-Fi"),
    ("SCI", "Sci-Fi"),
    ("UI", "UI"),
    ("ANML", "Animals"),
    ("MOSTR", "Monster"),
    ("CRTR", "Monster"),
    ("FOLY", "Foley"),
    ("FOOT", "Footsteps"),
    ("DOOR", "Door"),
    ("GLAS", "Glass"),
    ("WOOD", "Wood"),
    ("METL", "Metal"),
    ("CLTH", "Cloth"),
    ("WEAT", "Weather"),
    ("RAIN", "Weather"),
    ("WIND", "Weather"),
    ("AMB", "Ambience"),
    ("AMBN", "Ambience"),
    ("BGD", "Ambience"),
    ("IMPT", "Impact"),
    ("FITE", "Impact"),
    ("HIT", "Impact"),
    ("VOX", "Vocal"),
    ("VEHC", "Vehicles"),
    ("ALRM", "Alarm"),
    ("MUSC", "Music"),
    ("MCOM", "Music"),
    ("SONG", "Music"),
];

/// Extracts the Category ID (CatID) from a Universal Category System (UCS) filename.
/// Requires an underscore separator (`<CatID>_<Description>`) and enforces exact match
/// or a valid UCS subcategory boundary (all-uppercase CatID or uppercase/digit suffix start)
/// so regular English words (`Rainbow.wav`, `Window_Break.wav`, `Amber_Pad.wav`,
/// `Scissors_Cut.wav`, `Football_Crowd.wav`) are never misclassified.
pub fn extract_ucs_cat_id(file_name: &str) -> Option<&'static str> {
    let (prefix, _rest) = file_name.split_once('_')?;
    if prefix.is_empty() || prefix.len() > 15 || !prefix.is_ascii() {
        return None;
    }
    let upper = prefix.to_ascii_uppercase();
    for &(cat_code, tag_name) in UCS_CATID_MAP {
        if upper == cat_code {
            return Some(tag_name);
        }
        if upper.starts_with(cat_code) {
            let cat_part = &prefix[..cat_code.len()];
            let suffix = &prefix[cat_code.len()..];
            let cat_is_upper = cat_part.bytes().all(|b| b.is_ascii_uppercase());
            let starts_digit_or_hyphen = suffix
                .as_bytes()
                .first()
                .is_some_and(|b| b.is_ascii_digit() || *b == b'-');
            let is_camel_subcat = cat_is_upper
                && suffix
                    .as_bytes()
                    .first()
                    .is_some_and(|b| b.is_ascii_uppercase())
                && suffix.bytes().any(|b| b.is_ascii_lowercase());
            if starts_digit_or_hyphen || is_camel_subcat {
                return Some(tag_name);
            }
        }
    }
    None
}

/// Parses inline duration directives like `@dur<2s`, `@dur>15s`, `@<1.5s`, `@>30s`, `@dur<2000`.
pub fn parse_duration_directive(kw: &str) -> Option<(Option<i64>, Option<i64>)> {
    let trimmed = kw.trim().to_lowercase();
    let s = trimmed.strip_prefix('@')?;
    let s = s.strip_prefix("dur").unwrap_or(s).trim();

    if let Some(rest) = s.strip_prefix("<=").or_else(|| s.strip_prefix('<')) {
        let ms = parse_duration_value_ms(rest)?;
        return Some((None, Some(ms)));
    }
    if let Some(rest) = s.strip_prefix(">=").or_else(|| s.strip_prefix('>')) {
        let ms = parse_duration_value_ms(rest)?;
        return Some((Some(ms), None));
    }
    None
}

fn parse_duration_value_ms(val_str: &str) -> Option<i64> {
    let s = val_str.trim();
    if let Some(ms_str) = s.strip_suffix("ms").or_else(|| s.strip_suffix("MS")) {
        ms_str.trim().parse().ok()
    } else if let Some(sec_str) = s.strip_suffix('s').or_else(|| s.strip_suffix('S')) {
        let sec: f64 = sec_str.trim().parse().ok()?;
        if !sec.is_finite() || sec < 0.0 {
            return None;
        }
        Some((sec * 1000.0) as i64)
    } else {
        let num: f64 = s.parse().ok()?;
        if !num.is_finite() || num < 0.0 {
            return None;
        }
        if num < 100.0 {
            Some((num * 1000.0) as i64)
        } else {
            Some(num as i64)
        }
    }
}

/// Splits an audio filename or folder name into lowercase word tokens.
pub fn tokenize_audio_identifier(text: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let folded = fold_turkish_to_ascii(text);

    for source in [text, folded.as_str()] {
        for raw_chunk in source.split(|c: char| !c.is_alphanumeric()) {
            if raw_chunk.is_empty() {
                continue;
            }
            tokens.insert(raw_chunk.to_lowercase());

            let chars: Vec<char> = raw_chunk.chars().collect();
            let mut sub_start = 0;
            for i in 1..chars.len() {
                let prev = chars[i - 1];
                let curr = chars[i];
                let next_is_lower = i + 1 < chars.len() && chars[i + 1].is_lowercase();

                let split_here = (prev.is_lowercase() && curr.is_uppercase())
                    || (prev.is_uppercase() && curr.is_uppercase() && next_is_lower)
                    || (prev.is_alphabetic() && curr.is_numeric())
                    || (prev.is_numeric() && curr.is_alphabetic());

                if split_here {
                    let part: String = chars[sub_start..i].iter().collect();
                    if !part.is_empty() {
                        tokens.insert(part.to_lowercase());
                    }
                    sub_start = i;
                }
            }
            if sub_start > 0 && sub_start < chars.len() {
                let part: String = chars[sub_start..].iter().collect();
                if !part.is_empty() {
                    tokens.insert(part.to_lowercase());
                }
            }
        }
    }
    tokens
}

pub fn extract_stem_and_near_folders(
    file_path: &str,
    file_name: &str,
) -> (String, String, String) {
    let stem = file_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(file_name)
        .to_string();

    let norm = file_path.replace('\\', "/");
    let parts: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    let parent = if parts.len() >= 2 {
        parts[parts.len() - 2].to_string()
    } else {
        String::new()
    };
    let grandparent = if parts.len() >= 3 {
        parts[parts.len() - 3].to_string()
    } else {
        String::new()
    };
    (stem, parent, grandparent)
}

