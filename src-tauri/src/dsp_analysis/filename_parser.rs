use crate::security::is_unc_or_network_path;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::ItemKey;
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BpmKeyResult {
    pub bpm: Option<f64>,
    pub musical_key: String,
    pub camelot_key: String,
}

/// Canonical pitch classes `0..12` starting at `C = 0`:
/// `0=C, 1=C#/Db, 2=D, 3=Eb, 4=E, 5=F, 6=F#, 7=G, 8=Ab, 9=A, 10=Bb, 11=B`
/// Official Mixed In Key Camelot Wheel mapping:
pub(super) const MAJOR_DISPLAY_AND_CAMELOT: [(&str, &str); 12] = [
    ("C", "8B"),   // 0: C major
    ("Db", "3B"),  // 1: Db / C# major
    ("D", "10B"),  // 2: D major
    ("Eb", "5B"),  // 3: Eb / D# major
    ("E", "12B"),  // 4: E major
    ("F", "7B"),   // 5: F major
    ("F#", "2B"),  // 6: F# / Gb major
    ("G", "9B"),   // 7: G major
    ("Ab", "4B"),  // 8: Ab / G# major
    ("A", "11B"),  // 9: A major
    ("Bb", "6B"),  // 10: Bb / A# major
    ("B", "1B"),   // 11: B major
];

pub(super) const MINOR_DISPLAY_AND_CAMELOT: [(&str, &str); 12] = [
    ("Cm", "5A"),   // 0: C minor
    ("C#m", "12A"), // 1: C# / Db minor
    ("Dm", "7A"),   // 2: D minor
    ("Ebm", "2A"),  // 3: Eb / D# minor
    ("Em", "9A"),   // 4: E minor
    ("Fm", "4A"),   // 5: F minor
    ("F#m", "11A"), // 6: F# / Gb minor
    ("Gm", "6A"),   // 7: G minor
    ("Abm", "1A"),  // 8: Ab / G# minor
    ("Am", "8A"),   // 9: A minor
    ("Bbm", "3A"),  // 10: Bb / A# minor
    ("Bm", "10A"),  // 11: B minor
];


/// Converts any musical key (`"Am"`, `"C# minor"`, `"Fmaj"`, `"Db"`, `"8A"`, `"11b"`)
/// into a canonical `(musical_key, camelot_key)` pair, or `None` if unrecognized.
pub fn normalize_musical_or_camelot_key(raw: &str) -> Option<(String, String)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 24 {
        return None;
    }

    // 1. Check Camelot notation `1A..12A` / `1B..12B`
    let upper = trimmed.to_ascii_uppercase();
    if let Some(num_str) = upper.strip_suffix('A') {
        if let Ok(n) = num_str.parse::<u8>() {
            if (1..=12).contains(&n) {
                let target_cam = format!("{}A", n);
                for &(mkey, cam) in &MINOR_DISPLAY_AND_CAMELOT {
                    if cam == target_cam {
                        return Some((mkey.to_string(), cam.to_string()));
                    }
                }
            }
        }
    } else if let Some(num_str) = upper.strip_suffix('B') {
        if let Ok(n) = num_str.parse::<u8>() {
            if (1..=12).contains(&n) {
                let target_cam = format!("{}B", n);
                for &(mkey, cam) in &MAJOR_DISPLAY_AND_CAMELOT {
                    if cam == target_cam {
                        return Some((mkey.to_string(), cam.to_string()));
                    }
                }
            }
        }
    }

    // 2. Parse standard Western note + accidental + mode
    let compact: String = trimmed
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect();
    if compact.is_empty() {
        return None;
    }

    let mut chars = compact.chars();
    let note_char = chars.next()?.to_ascii_uppercase();
    let base_pc: i32 = match note_char {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };

    let rest_raw: String = chars.collect();
    let (accidental_offset, mode_str) = if let Some(s) = rest_raw.strip_prefix('#') {
        (1, s)
    } else if let Some(s) = rest_raw.strip_prefix('♯') {
        (1, s)
    } else if let Some(s) = rest_raw.strip_prefix('b').or_else(|| rest_raw.strip_prefix('B')) {
        (-1, s)
    } else if let Some(s) = rest_raw.strip_prefix('♭') {
        (-1, s)
    } else {
        (0, rest_raw.as_str())
    };

    let pc = ((base_pc + accidental_offset).rem_euclid(12)) as usize;
    let mode_lower = mode_str.to_ascii_lowercase();
    let is_minor = match mode_lower.as_str() {
        "" | "maj" | "major" | "ionian" => false,
        "m" | "min" | "minor" | "aeolian" | "min7" => true,
        _ => return None,
    };

    let (mkey, cam) = if is_minor {
        MINOR_DISPLAY_AND_CAMELOT[pc]
    } else {
        MAJOR_DISPLAY_AND_CAMELOT[pc]
    };
    Some((mkey.to_string(), cam.to_string()))
}

pub fn parse_bpm_value(raw: &str) -> Option<f64> {
    let cleaned = raw
        .trim()
        .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c.is_whitespace())
        .replace(',', ".");
    let val = cleaned.parse::<f64>().ok()?;
    if val.is_finite() && (35.0..=260.0).contains(&val) {
        Some((val * 10.0).round() / 10.0)
    } else {
        None
    }
}

/// Extracts BPM from filename tokens like `120bpm`, `120_bpm`, `128.5bpm`, `bpm_140`.
pub fn detect_bpm_from_filename(file_name: &str) -> Option<f64> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let lower = stem.to_ascii_lowercase();

    let parts: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '.')
        .filter(|s| !s.is_empty())
        .collect();

    for i in 0..parts.len() {
        let p = parts[i];
        if let Some(num_part) = p.strip_suffix("bpm") {
            if !num_part.is_empty() {
                if let Some(bpm) = parse_bpm_value(num_part) {
                    return Some(bpm);
                }
            } else if i > 0 {
                if let Some(bpm) = parse_bpm_value(parts[i - 1]) {
                    return Some(bpm);
                }
            }
        }
        if let Some(num_part) = p.strip_prefix("bpm") {
            if !num_part.is_empty() {
                if let Some(bpm) = parse_bpm_value(num_part) {
                    return Some(bpm);
                }
            } else if i + 1 < parts.len() {
                if let Some(bpm) = parse_bpm_value(parts[i + 1]) {
                    return Some(bpm);
                }
            }
        }
    }
    None
}

/// Safely extracts Musical Key from filename tokens WITHOUT misclassifying SFX take suffixes
/// like `Impact_01a.wav` or `Radio_AM_Noise.wav`.
/// - Explicit unambiguous suffixes (`Cmaj`, `Amin`, `F#m`, `C#m`, `Bbm`, `Ebm`, `Abm`, `G#m`, `D#m`)
///   are always accepted.
/// - Short two-letter minor tokens (`Am`, `Cm`, `Dm`, `Em`, `Fm`, `Gm`, `Bm`) or Camelot (`8A`)
///   are accepted ONLY when the filename also contains a BPM marker or an explicit `key` prefix.
pub fn detect_key_from_filename(file_name: &str, has_bpm_in_name: bool) -> Option<(String, String)> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);

    let raw_tokens: Vec<&str> = stem
        .split(|c: char| {
            c.is_whitespace()
                || matches!(c, '_' | '-' | '(' | ')' | '[' | ']' | '.' | ',' | '/')
        })
        .filter(|s| !s.is_empty())
        .collect();

    for (idx, &tok) in raw_tokens.iter().enumerate() {
        let prev_is_key_label = idx > 0 && raw_tokens[idx - 1].eq_ignore_ascii_case("key");
        let lower = tok.to_ascii_lowercase();

        if let Some(rest) = lower.strip_prefix("key") {
            if !rest.is_empty() {
                if let Some(res) = normalize_musical_or_camelot_key(rest) {
                    return Some(res);
                }
            }
        }

        // Unambiguous sharp/flat minor or explicit `maj`/`min` suffix
        let has_explicit_mode = lower.ends_with("maj")
            || lower.ends_with("major")
            || lower.ends_with("min")
            || lower.ends_with("minor");
        let bytes = tok.as_bytes();
        // Require lowercase `b` for flat accidental (e.g. `Ebm`, `Bbm`) so all-caps acronyms
        // like `EBM`, `DBM`, `ABM`, `BBM`, `GBM` are never misclassified as flat-minor keys.
        let has_accidental_minor = !bytes.is_empty()
            && bytes[0].is_ascii_uppercase()
            && (tok.contains('#')
                || (bytes.len() == 3 && bytes[1] == b'b' && bytes[2] == b'm'));

        if has_explicit_mode || has_accidental_minor {
            if let Some(res) = normalize_musical_or_camelot_key(tok) {
                return Some(res);
            }
        }

        if prev_is_key_label || has_bpm_in_name {
            // Accept canonical `Am`, uppercase `AM` (when paired with BPM), flat majors `Db`/`Eb`/`Bb`, or Camelot `8A`
            let looks_like_short_minor = bytes.len() == 2
                && bytes[0].is_ascii_uppercase()
                && bytes[1].eq_ignore_ascii_case(&b'm');
            let looks_like_flat_major =
                bytes.len() == 2 && bytes[0].is_ascii_uppercase() && bytes[1] == b'b';
            let looks_like_camelot = bytes.len() >= 2
                && bytes.len() <= 3
                && matches!(bytes[bytes.len() - 1], b'A' | b'B')
                && bytes[..bytes.len() - 1].iter().all(|b| b.is_ascii_digit());

            if prev_is_key_label
                || looks_like_short_minor
                || looks_like_flat_major
                || looks_like_camelot
            {
                if let Some(res) = normalize_musical_or_camelot_key(tok) {
                    return Some(res);
                }
            }
        }
    }

    None
}

/// Fast non-DSP metadata (`TBPM` / `TKEY`) + filename parser safe to run during normal library scans.
pub fn extract_fast_bpm_and_key(path: Option<&Path>, file_name: &str) -> BpmKeyResult {
    let mut out = BpmKeyResult::default();

    if let Some(p) = path {
        let raw = p.to_string_lossy();
        let is_safe_regular = !is_unc_or_network_path(&raw)
            && !crate::security::has_ntfs_ads_colon(&raw)
            && std::fs::symlink_metadata(p)
                .map(|m| !m.file_type().is_symlink() && m.is_file())
                .unwrap_or(false);
        if is_safe_regular {
            if let Ok(probed) = Probe::open(p) {
                if let Ok(tagged) = probed.read() {
                    extract_bpm_key_from_tagged_file(&tagged, &mut out);
                }
            }
        }
    }

    fill_bpm_key_from_filename(file_name, &mut out);
    out
}

pub(crate) fn extract_bpm_key_from_tagged_file(
    tagged: &lofty::file::TaggedFile,
    out: &mut BpmKeyResult,
) {
    for tag in tagged.tags() {
        if out.bpm.is_none() {
            if let Some(raw_bpm) = tag
                .get_string(&ItemKey::Bpm)
                .or_else(|| tag.get_string(&ItemKey::IntegerBpm))
            {
                out.bpm = parse_bpm_value(raw_bpm);
            }
        }
        if out.musical_key.is_empty() {
            if let Some(raw_key) = tag.get_string(&ItemKey::InitialKey) {
                if let Some((mkey, cam)) = normalize_musical_or_camelot_key(raw_key) {
                    out.musical_key = mkey;
                    out.camelot_key = cam;
                }
            }
        }
    }
}

pub(crate) fn fill_bpm_key_from_filename(file_name: &str, out: &mut BpmKeyResult) {
    let name_bpm = detect_bpm_from_filename(file_name);
    if out.bpm.is_none() {
        out.bpm = name_bpm;
    }
    if out.musical_key.is_empty() {
        if let Some((mkey, cam)) = detect_key_from_filename(file_name, out.bpm.is_some()) {
            out.musical_key = mkey;
            out.camelot_key = cam;
        }
    }
}

