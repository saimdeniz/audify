use super::AutoTagRule;

pub const STUDIO_COLOR_PALETTE: &[&str] = &[
    "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16", "#22C55E", "#10B981", "#14B8A6",
    "#06B6D4", "#0EA5E9", "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF", "#EC4899",
    "#F43F5E", "#FB7185", "#38BDF8", "#2DD4BF", "#4ADE80", "#A3E635", "#FACC15", "#FB923C",
    "#F87171", "#E879F9", "#C084FC", "#818CF8", "#60A5FA", "#0284C7", "#0D9488", "#059669",
];

pub fn deterministic_color_for_name(name: &str) -> &'static str {
    let mut hash: u32 = 5381;
    for b in name.trim().to_lowercase().bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(b as u32);
    }
    STUDIO_COLOR_PALETTE[(hash as usize) % STUDIO_COLOR_PALETTE.len()]
}

pub fn default_auto_tag_rules() -> Vec<AutoTagRule> {
    let rules_data: &[(&str, &str, &str, &[&str])] = &[
        (
            "rule-combat",
            "Combat",
            "#EF4444",
            &[
                "attack", "hit", "hits", "impact", "impacts", "hurt", "damage", "death", "die",
                "punch", "kick", "slam", "smash", "crash", "thud", "strike", "block", "parry",
                "combat", "fight",
            ],
        ),
        (
            "rule-whoosh",
            "Whoosh",
            "#F59E0B",
            &[
                "whoosh", "whooshes", "swish", "swoosh", "flyby", "passby", "swing", "whip",
            ],
        ),
        (
            "rule-explosion",
            "Explosion",
            "#F97316",
            &[
                "explosion", "explosions", "explode", "blast", "boom", "detonation", "shockwave",
                "grenade", "bomb", "dynamite", "nuke",
            ],
        ),
        (
            "rule-weapons",
            "Weapons",
            "#DC2626",
            &[
                "weapons", "weapon", "gun", "guns", "sword", "swords", "blade", "slash", "shoot",
                "shot", "rifle", "pistol", "reload", "bullet", "arrow", "bow", "dagger", "axe",
                "spear",
            ],
        ),
        (
            "rule-magic",
            "Magic",
            "#A855F7",
            &[
                "magic", "magical", "spell", "spells", "cast", "casting", "heal", "healing",
                "buff", "debuff", "arcane", "mana", "portal", "teleport", "enchant", "sparkle",
                "sparkles", "shimmer", "chime", "fairy",
            ],
        ),
        (
            "rule-fire",
            "Fire",
            "#EA580C",
            &[
                "fire", "flame", "flames", "burn", "burning", "torch", "ignite", "lava", "inferno",
                "fireball", "ember",
            ],
        ),
        (
            "rule-water",
            "Water",
            "#0EA5E9",
            &[
                "water", "splash", "liquid", "bubble", "bubbles", "swim", "underwater", "ocean",
                "sea", "wave", "waves", "drip", "pour", "aqua", "surf",
            ],
        ),
        (
            "rule-scifi",
            "Sci-Fi",
            "#06B6D4",
            &[
                "laser", "lasers", "plasma", "scifi", "cyber", "synth", "robot", "mech", "glitch",
                "telemetry", "scanner", "beam", "warp", "alien", "spaceship", "electric", "zap",
                "spark", "electricity",
            ],
        ),
        (
            "rule-ui",
            "UI",
            "#38BDF8",
            &[
                "ui", "hud", "menu", "button", "click", "clicks", "beep", "interface", "confirm",
                "cancel", "select", "notification", "cursor", "popup", "switch", "toggle",
            ],
        ),
        (
            "rule-animals",
            "Animals",
            "#84CC16",
            &[
                "animals", "animal", "creature", "creatures", "monster", "monsters", "beast",
                "bird", "birds", "dog", "cat", "wolf", "roar", "growl", "bark", "horse", "insect",
                "snake", "dragon",
            ],
        ),
        (
            "rule-pokemon",
            "Pokemon",
            "#EAB308",
            &[
                "pokemon", "pkmn", "pokedex", "cries", "cry", "pikachu", "charizard", "mewtwo",
                "bulbasaur", "squirtle",
            ],
        ),
        (
            "rule-footsteps",
            "Footsteps",
            "#10B981",
            &[
                "footsteps", "footstep", "steps", "step", "walk", "walking", "run", "running",
                "sneaker", "boot", "foley", "cloth", "door", "wood", "glass", "metal",
            ],
        ),
        (
            "rule-weather",
            "Weather",
            "#64748B",
            &[
                "weather", "wind", "rain", "thunder", "storm", "lightning", "snow", "ice",
                "blizzard", "tornado", "breeze",
            ],
        ),
        (
            "rule-ambience",
            "Ambience",
            "#14B8A6",
            &[
                "ambience", "ambient", "atmos", "atmosphere", "drone", "roomtone", "environment",
                "forest", "cave", "jungle", "night", "city", "crowd",
            ],
        ),
        (
            "rule-music",
            "Music",
            "#3B82F6",
            &[
                "music", "musical", "song", "ost", "bgm", "melody", "chord", "piano", "guitar",
                "orchestra", "cinematic", "trailer", "braam", "riser", "stinger", "jingle",
                "fanfare",
            ],
        ),
    ];

    rules_data
        .iter()
        .map(|(id, name, color, kw)| AutoTagRule {
            id: (*id).to_string(),
            tag_name: (*name).to_string(),
            tag_color: (*color).to_string(),
            keywords: kw.iter().map(|s| (*s).to_string()).collect(),
            enabled: true,
            category: None,
            include_paths: None,
            exclude_paths: None,
            rel_include_paths: Vec::new(),
            rel_exclude_paths: Vec::new(),
            min_duration_ms: None,
            max_duration_ms: None,
        })
        .collect()
}
