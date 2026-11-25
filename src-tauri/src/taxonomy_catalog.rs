//! Single source of truth for Audify's Faceted & Nested Taxonomy (Category, Genre, Mood, Source).
//! Shared by SQLite v17 migration, auto-tag rules, UCS CatIDs, Lofty metadata extraction, and YAMNet AI.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FacetSpec {
    pub id: i64,
    pub slug: &'static str,
    pub name: &'static str,
    pub color: &'static str,
    pub sort_order: i64,
    pub domain: &'static str,
    pub allow_nesting: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanonicalTagSpec {
    pub name: &'static str,
    pub facet_slug: &'static str,
    pub parent_name: Option<&'static str>,
    pub color: &'static str,
    pub color_inherited: bool,
    pub aliases: &'static [&'static str],
    pub is_system: bool,
    pub sort_order: i64,
}

pub const FACET_CATEGORY_ID: i64 = 1;
pub const FACET_GENRE_ID: i64 = 2;
pub const FACET_MOOD_ID: i64 = 3;
pub const FACET_SOURCE_ID: i64 = 4;

pub const SYSTEM_FACETS: &[FacetSpec] = &[
    FacetSpec {
        id: FACET_CATEGORY_ID,
        slug: "category",
        name: "Category",
        color: "#22C55E",
        sort_order: 0,
        domain: "tags",
        allow_nesting: true,
    },
    FacetSpec {
        id: FACET_GENRE_ID,
        slug: "genre",
        name: "Genre",
        color: "#3B82F6",
        sort_order: 1,
        domain: "genres",
        allow_nesting: true,
    },
    FacetSpec {
        id: FACET_MOOD_ID,
        slug: "mood",
        name: "Mood",
        color: "#EC4899",
        sort_order: 2,
        domain: "genres",
        allow_nesting: false,
    },
    FacetSpec {
        id: FACET_SOURCE_ID,
        slug: "source",
        name: "Source / Pack",
        color: "#64748B",
        sort_order: 3,
        domain: "tags",
        allow_nesting: false,
    },
];

/// Curated 8-color studio family palette (replaces 32-color random DJB2 visual noise).
pub const FAMILY_COLOR_PALETTE: &[&str] = &[
    "#22C55E", // Nature / Animals
    "#EF4444", // Action / Weapons / Impact
    "#F59E0B", // Foley / Material
    "#14B8A6", // Ambience / Weather / Water
    "#0EA5E9", // Sci-Fi / UI / Tech / Vehicles
    "#8B5CF6", // Voice / Music / Instruments
    "#EC4899", // Mood / Dramatic
    "#64748B", // Neutral / General / Source
];

pub fn facet_id_for_slug(slug: &str) -> Option<i64> {
    let lower = slug.trim().to_ascii_lowercase();
    SYSTEM_FACETS
        .iter()
        .find(|f| f.slug == lower)
        .map(|f| f.id)
}

pub fn facet_spec_by_id(id: i64) -> &'static FacetSpec {
    SYSTEM_FACETS
        .iter()
        .find(|f| f.id == id)
        .unwrap_or(&SYSTEM_FACETS[0])
}

pub fn facet_spec_by_slug(slug: &str) -> Option<&'static FacetSpec> {
    let lower = slug.trim().to_ascii_lowercase();
    SYSTEM_FACETS.iter().find(|f| f.slug == lower)
}

fn djb2_hash_lower(text: &str) -> u32 {
    let mut hash: u32 = 5381;
    for b in text.trim().to_lowercase().bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(b as u32);
    }
    hash
}

fn hex_to_hsl(hex: &str) -> (f64, f64, f64) {
    let clean = hex.trim().trim_start_matches('#');
    let expanded;
    let six = if clean.len() == 3 {
        let b = clean.as_bytes();
        expanded = format!(
            "{}{}{}{}{}{}",
            b[0] as char, b[0] as char, b[1] as char, b[1] as char, b[2] as char, b[2] as char
        );
        expanded.as_str()
    } else if clean.len() == 6 {
        clean
    } else {
        "3B82F6"
    };
    let r = u8::from_str_radix(&six[0..2], 16).unwrap_or(0x3B) as f64 / 255.0;
    let g = u8::from_str_radix(&six[2..4], 16).unwrap_or(0x82) as f64 / 255.0;
    let b = u8::from_str_radix(&six[4..6], 16).unwrap_or(0xF6) as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let mut h = if (max - r).abs() < f64::EPSILON {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    h *= 60.0;
    (h, s, l)
}

fn hue_to_channel(p: f64, q: f64, mut t: f64) -> f64 {
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        p + (q - p) * 6.0 * t
    } else if t < 0.5 {
        q
    } else if t < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - t) * 6.0
    } else {
        p
    }
}

fn hsl_to_hex(h_deg: f64, s_raw: f64, l_raw: f64) -> String {
    let h = h_deg.rem_euclid(360.0) / 360.0;
    let s = s_raw.clamp(0.0, 1.0);
    let l = l_raw.clamp(0.0, 1.0);
    let (r, g, b) = if s <= 0.0001 {
        (l, l, l)
    } else {
        let q = if l < 0.5 {
            l * (1.0 + s)
        } else {
            l + s - l * s
        };
        let p = 2.0 * l - q;
        (
            hue_to_channel(p, q, h + 1.0 / 3.0),
            hue_to_channel(p, q, h),
            hue_to_channel(p, q, h - 1.0 / 3.0),
        )
    };
    let rb = (r * 255.0).round().clamp(0.0, 255.0) as u8;
    let gb = (g * 255.0).round().clamp(0.0, 255.0) as u8;
    let bb = (b * 255.0).round().clamp(0.0, 255.0) as u8;
    format!("#{:02X}{:02X}{:02X}", rb, gb, bb)
}

/// Picks a deterministic family color from the curated 8-color studio palette.
pub fn deterministic_family_color(name: &str) -> &'static str {
    let hash = djb2_hash_lower(name);
    FAMILY_COLOR_PALETTE[(hash as usize) % FAMILY_COLOR_PALETTE.len()]
}

/// Picks a deterministic, theme-legible color across the full 360° hue wheel (16M gamut)
/// for newly created custom root tags, genres, and moods.
pub fn deterministic_full_spectrum_color(name: &str) -> String {
    let hash = djb2_hash_lower(if name.trim().is_empty() { "audify" } else { name });
    let h = (hash % 360) as f64;
    let s = 0.62 + (((hash >> 9) % 23) as f64) / 100.0;
    let l = 0.50 + (((hash >> 15) % 15) as f64) / 100.0;
    hsl_to_hex(h, s, l)
}

/// Derives a harmonious tonal shade in the parent's color family for inherited sub-tags.
/// Mirrors `deriveChildTonalColor` in `src/utils/taxonomyColor.ts` pixel-for-pixel.
pub fn derive_child_tonal_color(parent_hex: &str, child_name: &str, depth: usize) -> String {
    const TONAL_SLOTS: [(f64, f64, f64); 7] = [
        (-14.0, 0.04, 0.06),
        (-7.0, -0.06, -0.05),
        (0.0, -0.08, 0.09),
        (7.0, 0.06, 0.04),
        (14.0, -0.04, -0.06),
        (-10.0, 0.02, 0.11),
        (10.0, 0.05, -0.03),
    ];
    let (h, s, l) = hex_to_hsl(parent_hex);
    let hash = djb2_hash_lower(if child_name.trim().is_empty() {
        "subtag"
    } else {
        child_name
    });
    let slot = TONAL_SLOTS[(hash as usize) % TONAL_SLOTS.len()];
    let depth_scale = if depth >= 3 { 0.75 } else { 1.0 };
    let depth_light_boost = if depth >= 3 { 0.03 } else { 0.0 };

    if s < 0.08 {
        let neutral_l = (l + slot.2 * 1.15 + depth_light_boost).clamp(0.42, 0.74);
        return hsl_to_hex(h, s, neutral_l);
    }

    let next_h = (h + slot.0 * depth_scale).rem_euclid(360.0);
    let next_s = (s + slot.1).clamp(0.44, 0.90);
    let next_l = (l + slot.2 + depth_light_boost).clamp(0.44, 0.72);
    hsl_to_hex(next_h, next_s, next_l)
}

const fn cat_root(
    name: &'static str,
    color: &'static str,
    aliases: &'static [&'static str],
    sort_order: i64,
) -> CanonicalTagSpec {
    CanonicalTagSpec {
        name,
        facet_slug: "category",
        parent_name: None,
        color,
        color_inherited: false,
        aliases,
        is_system: true,
        sort_order,
    }
}

const fn cat_child(
    name: &'static str,
    parent: &'static str,
    color: &'static str,
    aliases: &'static [&'static str],
    sort_order: i64,
) -> CanonicalTagSpec {
    CanonicalTagSpec {
        name,
        facet_slug: "category",
        parent_name: Some(parent),
        color,
        color_inherited: true,
        aliases,
        is_system: false,
        sort_order,
    }
}

const fn facet_tag(
    name: &'static str,
    facet_slug: &'static str,
    color: &'static str,
    aliases: &'static [&'static str],
    sort_order: i64,
) -> CanonicalTagSpec {
    CanonicalTagSpec {
        name,
        facet_slug,
        parent_name: None,
        color,
        color_inherited: false,
        aliases,
        is_system: false,
        sort_order,
    }
}

const fn source_tag(
    name: &'static str,
    aliases: &'static [&'static str],
    sort_order: i64,
) -> CanonicalTagSpec {
    CanonicalTagSpec {
        name,
        facet_slug: "source",
        parent_name: None,
        color: "#64748B",
        color_inherited: true,
        aliases,
        is_system: false,
        sort_order,
    }
}

pub const CANONICAL_TAGS: &[CanonicalTagSpec] = &[
    // ── CATEGORY ROOTS (Level 1 — System Family Anchors) ──────────────────────
    cat_root("Animals", "#22C55E", &["Creature", "Creatures", "Beast"], 10),
    cat_root("Action & Combat", "#EF4444", &["Fight", "Battle"], 20),
    cat_root("Foley", "#F59E0B", &["Material", "Props"], 30),
    cat_root("Nature & Ambience", "#14B8A6", &["Nature", "Environment", "Atmos"], 40),
    cat_root("Sci-Fi & Tech", "#0EA5E9", &["Tech", "Futuristic"], 50),
    cat_root("Voice & Music", "#8B5CF6", &["Instruments", "Instrument"], 60),
    // ── CATEGORY CHILDREN (Level 2 — Inherit Parent Family Color) ────────────
    // Animals
    cat_child("Dog", "Animals", "#22C55E", &["Bark", "Wolf", "Canine"], 11),
    cat_child("Cat", "Animals", "#22C55E", &["Meow", "Feline"], 12),
    cat_child("Bird", "Animals", "#22C55E", &["Birds", "Chirp", "Crow", "Owl"], 13),
    cat_child("Horse", "Animals", "#22C55E", &["Gallop", "Neigh"], 14),
    cat_child("Insect", "Animals", "#22C55E", &["Bee", "Cricket", "Bug"], 15),
    cat_child("Monster", "Animals", "#22C55E", &["Roar", "Dragon", "Growl"], 16),
    cat_child("Wildlife", "Animals", "#22C55E", &["Frog", "Snake", "Livestock", "Whale"], 17),
    // Action & Combat
    cat_child("Impact", "Action & Combat", "#EF4444", &["Combat", "Hit", "Punch", "Crash", "Thud"], 21),
    cat_child("Weapons", "Action & Combat", "#EF4444", &["Weapon", "Reload"], 22),
    cat_child("Gunshot", "Action & Combat", "#EF4444", &["Gun", "Rifle", "Pistol", "Shot"], 23),
    cat_child("Melee", "Action & Combat", "#EF4444", &["Sword", "Blade", "Slash", "Arrow"], 24),
    cat_child("Explosion", "Action & Combat", "#EF4444", &["Blast", "Boom", "Bomb"], 25),
    cat_child("Whoosh", "Action & Combat", "#EF4444", &["Swish", "Swoosh", "Whip", "Passby"], 26),
    // Foley
    cat_child("Footsteps", "Foley", "#F59E0B", &["Steps", "Walk", "Run"], 31),
    cat_child("Cloth", "Foley", "#F59E0B", &["Fabric", "Zipper", "Rustle"], 32),
    cat_child("Door", "Foley", "#F59E0B", &["Knock", "Creak", "Drawer"], 33),
    cat_child("Glass", "Foley", "#F59E0B", &["Shatter", "Clink"], 34),
    cat_child("Wood", "Foley", "#F59E0B", &["Splinter", "Chop"], 35),
    cat_child("Metal", "Foley", "#F59E0B", &["Clang", "Coin", "Keys", "Cutlery"], 36),
    cat_child("Body & Crowd", "Foley", "#F59E0B", &["Crowd", "Clap", "Heartbeat", "Applause"], 37),
    // Nature & Ambience
    cat_child("Ambience", "Nature & Ambience", "#14B8A6", &["Roomtone", "Atmosphere", "Forest"], 41),
    cat_child("Weather", "Nature & Ambience", "#14B8A6", &["Wind", "Rain", "Thunder", "Storm"], 42),
    cat_child("Water", "Nature & Ambience", "#14B8A6", &["Splash", "Ocean", "Liquid", "River"], 43),
    cat_child("Fire", "Nature & Ambience", "#14B8A6", &["Flame", "Burn", "Crackle"], 44),
    cat_child("Noise", "Nature & Ambience", "#14B8A6", &["Static", "Hum", "Rumble"], 45),
    // Sci-Fi & Tech
    cat_child("Sci-Fi", "Sci-Fi & Tech", "#0EA5E9", &["Laser", "Plasma", "Cyber", "Robot"], 51),
    cat_child("UI", "Sci-Fi & Tech", "#0EA5E9", &["HUD", "Menu", "Click", "Beep", "Notification"], 52),
    cat_child("Mechanical", "Sci-Fi & Tech", "#0EA5E9", &["Clock", "Gears", "Tool", "Machinery"], 53),
    cat_child("Vehicles", "Sci-Fi & Tech", "#0EA5E9", &["Car", "Engine", "Train", "Aircraft"], 54),
    cat_child("Alarm", "Sci-Fi & Tech", "#0EA5E9", &["Siren", "Buzzer", "Ringtone"], 55),
    cat_child("Magic", "Sci-Fi & Tech", "#0EA5E9", &["Spell", "Arcane", "Sparkle", "Portal"], 56),
    // Voice & Music
    cat_child("Vocal", "Voice & Music", "#8B5CF6", &["Voice", "Speech", "Singing", "Dialogue"], 61),
    cat_child("Music", "Voice & Music", "#8B5CF6", &["Melody", "Jingle", "Stinger"], 62),
    cat_child("Drums", "Voice & Music", "#8B5CF6", &["Kick", "Snare", "Percussion", "Cymbal", "Hi-Hat"], 63),
    cat_child("Bass", "Voice & Music", "#8B5CF6", &["Sub", "808"], 64),
    cat_child("Guitar", "Voice & Music", "#8B5CF6", &["Strum", "Ukulele", "Banjo"], 65),
    cat_child("Piano", "Voice & Music", "#8B5CF6", &["Keys", "Keyboard", "Organ"], 66),
    cat_child("Synth", "Voice & Music", "#8B5CF6", &["Synthesizer", "Pad", "Arp"], 67),
    cat_child("Orchestra", "Voice & Music", "#8B5CF6", &["Strings", "Brass", "Woodwind", "Violin"], 68),
    cat_child("Bell", "Voice & Music", "#8B5CF6", &["Chime", "Gong"], 69),
    // ── GENRE FACET ──────────────────────────────────────────────────────────
    facet_tag("Ambient", "genre", "#14B8A6", &["Drone", "New-Age"], 100),
    facet_tag("Cinematic", "genre", "#F59E0B", &["Trailer", "Score", "Blockbuster"], 101),
    facet_tag("Soundtrack", "genre", "#F59E0B", &["Sountrack", "OST", "Filmscore", "BGM"], 102),
    facet_tag("Electronic", "genre", "#0EA5E9", &["EDM", "Techno", "House", "Dubstep", "DnB"], 103),
    facet_tag("Rock", "genre", "#EF4444", &["Metal", "Punk", "Grunge"], 104),
    facet_tag("Jazz", "genre", "#F59E0B", &["Blues", "Swing", "Soul", "Funk"], 105),
    facet_tag("Pop", "genre", "#0EA5E9", &["Disco", "Dance"], 106),
    facet_tag("Hip-Hop", "genre", "#8B5CF6", &["HipHop", "Rap", "Trap", "Boombap"], 107),
    facet_tag("Orchestral", "genre", "#8B5CF6", &["Symphonic", "Symphony"], 108),
    facet_tag("Classical", "genre", "#8B5CF6", &["Opera", "Chamber"], 109),
    facet_tag("Lo-Fi", "genre", "#8B5CF6", &["LoFi", "Chillhop"], 110),
    facet_tag("Acoustic", "genre", "#22C55E", &["Folk", "Country", "Bluegrass"], 111),
    facet_tag("Synthwave", "genre", "#EC4899", &["Cyberpunk", "Retrowave"], 112),
    facet_tag("Retro", "genre", "#14B8A6", &["8bit", "Chiptune", "Arcade", "Vintage"], 113),
    // ── MOOD FACET ───────────────────────────────────────────────────────────
    facet_tag("Dark", "mood", "#EC4899", &["Ominous", "Brooding", "Gloomy", "Sinister"], 200),
    facet_tag("Horror", "mood", "#EF4444", &["Scary", "Creepy", "Eerie", "Spooky"], 201),
    facet_tag("Dramatic", "mood", "#EC4899", &["Drama", "Emotional", "Tragic"], 202),
    facet_tag("Suspense", "mood", "#8B5CF6", &["Thriller", "Tense", "Tension", "Mystery"], 203),
    facet_tag("Action", "mood", "#EF4444", &["Adrenaline", "Intense", "Chase", "Exciting"], 204),
    facet_tag("Upbeat", "mood", "#22C55E", &["Happy", "Cheerful", "Uplifting", "Energetic"], 205),
    facet_tag("Chill", "mood", "#14B8A6", &["Calm", "Relaxing", "Peaceful", "Downtempo"], 206),
    facet_tag("Fantasy", "mood", "#8B5CF6", &["Medieval", "Celtic", "Tavern"], 207),
    facet_tag("Epic", "mood", "#F59E0B", &["Heroic", "Grand", "Adventurous"], 208),
    facet_tag("Sad", "mood", "#0EA5E9", &["Melancholy", "Sorrow", "Tender"], 209),
    facet_tag("Comedy", "mood", "#22C55E", &["Funny", "Quirky", "Cartoon", "Playful"], 210),
    facet_tag("Ethereal", "mood", "#0EA5E9", &["Dreamy", "Blissful", "Celestial"], 211),
    // ── SOURCE / PACK FACET (Uncolored `#`) ──────────────────────────────────
    source_tag("Pokemon", &["PKMN", "Pokedex"], 300),
];

/// Exact case-insensitive lookup by canonical tag name.
pub fn lookup_canonical_by_name(raw_name: &str) -> Option<&'static CanonicalTagSpec> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    CANONICAL_TAGS
        .iter()
        .find(|spec| spec.name.eq_ignore_ascii_case(trimmed))
}

/// Case-insensitive lookup by canonical tag name OR known alias/typo (e.g. `"Sountrack"` -> `Soundtrack`,
/// `"Voice"` -> `Vocal`). Prefers exact canonical name matches over alias matches.
pub fn lookup_canonical_or_alias(raw_name: &str) -> Option<&'static CanonicalTagSpec> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(exact) = lookup_canonical_by_name(trimmed) {
        return Some(exact);
    }
    CANONICAL_TAGS.iter().find(|spec| {
        spec.aliases
            .iter()
            .any(|alias| alias.eq_ignore_ascii_case(trimmed))
    })
}

/// Normalizes known corrupted ID3 genre/mood strings (e.g. `"Sountrack"` -> `("genre", "Soundtrack")`).
pub fn sanitize_id3_genre_or_mood_typo(raw: &str) -> Option<(&'static str, &'static str)> {
    let clean = raw.trim().to_ascii_lowercase();
    if clean.is_empty() {
        return None;
    }
    let normalized = match clean.as_str() {
        "sountrack" | "soudtrack" | "soundtrak" | "soundtrck" | "ost" | "film score" => {
            "Soundtrack"
        }
        "elecronic" | "electonic" | "electronica" => "Electronic",
        "hiphop" | "hip hop" => "Hip-Hop",
        "lofi" | "lo fi" => "Lo-Fi",
        "ambience" | "atmos" | "atmospheric" => "Ambient",
        "cinematics" => "Cinematic",
        "orchestra" => "Orchestral",
        "classic" => "Classical",
        "dramatics" => "Dramatic",
        "suspenful" | "suspenseful" => "Suspense",
        "comedic" => "Comedy",
        "scary" => "Horror",
        _ => "",
    };
    if !normalized.is_empty() {
        if let Some(spec) = lookup_canonical_by_name(normalized) {
            return Some((spec.facet_slug, spec.name));
        }
    }
    lookup_canonical_or_alias(raw)
        .filter(|spec| matches!(spec.facet_slug, "genre" | "mood"))
        .map(|spec| (spec.facet_slug, spec.name))
}

/// Returns true when a legacy genre name belongs in the `mood` facet instead of `genre`.
pub fn is_canonical_mood_name(raw_name: &str) -> bool {
    lookup_canonical_or_alias(raw_name)
        .is_some_and(|spec| spec.facet_slug == "mood")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_child_tonal_color_stays_in_parent_hue_family_and_varies_siblings() {
        let parent_blue = "#3B82F6";
        let (parent_h, _, _) = hex_to_hsl(parent_blue);

        let dog = derive_child_tonal_color(parent_blue, "Dog", 2);
        let bird = derive_child_tonal_color(parent_blue, "Bird", 2);
        let horse = derive_child_tonal_color(parent_blue, "Horse", 2);

        // Must be distinct shades (not identical 1:1 copy of parent)
        assert_ne!(dog, parent_blue);
        assert_ne!(dog, bird);

        // All siblings must remain inside parent's Blue hue neighborhood (within +/- 16 deg)
        for shade in [&dog, &bird, &horse] {
            let (h, s, l) = hex_to_hsl(shade);
            let mut delta = (h - parent_h).abs();
            if delta > 180.0 {
                delta = 360.0 - delta;
            }
            assert!(delta <= 16.5, "shade {} drifted {} deg from parent", shade, delta);
            assert!((0.40..=0.92).contains(&s), "saturation out of legible band: {}", s);
            assert!((0.40..=0.76).contains(&l), "lightness out of legible band: {}", l);
        }

        // Changing parent color dynamically cascades into the new hue family
        let dog_pink = derive_child_tonal_color("#EC4899", "Dog", 2);
        assert_ne!(dog, dog_pink);
    }

    #[test]
    fn deterministic_full_spectrum_color_generates_valid_distinct_16m_hexes() {
        let mut unique = std::collections::HashSet::new();
        for i in 0..32 {
            let hex = deterministic_full_spectrum_color(&format!("CustomGenre_{}", i));
            assert_eq!(hex.len(), 7);
            assert!(hex.starts_with('#'));
            unique.insert(hex);
        }
        // Must far exceed the old 8-color cap
        assert!(unique.len() > 16, "expected full-spectrum variety, got {}", unique.len());
    }
}
