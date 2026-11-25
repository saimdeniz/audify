use super::AutoTagRule;
use crate::taxonomy_catalog::deterministic_family_color;

pub const STUDIO_COLOR_PALETTE: &[&str] = &[
    "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16", "#22C55E", "#10B981", "#14B8A6",
    "#06B6D4", "#0EA5E9", "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF", "#EC4899",
    "#F43F5E", "#FB7185", "#38BDF8", "#2DD4BF", "#4ADE80", "#A3E635", "#FACC15", "#FB923C",
    "#F87171", "#E879F9", "#C084FC", "#818CF8", "#60A5FA", "#0284C7", "#0D9488", "#059669",
];

pub fn deterministic_color_for_name(name: &str) -> &'static str {
    deterministic_family_color(name)
}

struct DefaultRuleSpec {
    id: &'static str,
    tag_name: &'static str,
    tag_color: &'static str,
    facet_slug: &'static str,
    parent_tag_name: Option<&'static str>,
    keywords: &'static [&'static str],
}

pub fn default_auto_tag_rules() -> Vec<AutoTagRule> {
    let rules_data: &[DefaultRuleSpec] = &[
        // ── Action & Combat ──────────────────────────────────────────────────
        DefaultRuleSpec {
            id: "rule-impact",
            tag_name: "Impact",
            tag_color: "#EF4444",
            facet_slug: "category",
            parent_tag_name: Some("Action & Combat"),
            keywords: &[
                "attack", "hit", "hits", "impact", "impacts", "hurt", "damage", "death", "die",
                "punch", "kick", "slam", "smash", "crash", "thud", "strike", "parry", "combat",
                "fight",
            ],
        },
        DefaultRuleSpec {
            id: "rule-whoosh",
            tag_name: "Whoosh",
            tag_color: "#EF4444",
            facet_slug: "category",
            parent_tag_name: Some("Action & Combat"),
            keywords: &[
                "whoosh", "whooshes", "swish", "swoosh", "flyby", "passby", "swing", "whip",
            ],
        },
        DefaultRuleSpec {
            id: "rule-explosion",
            tag_name: "Explosion",
            tag_color: "#EF4444",
            facet_slug: "category",
            parent_tag_name: Some("Action & Combat"),
            keywords: &[
                "explosion", "explosions", "explode", "blast", "boom", "detonation", "shockwave",
                "grenade", "bomb", "dynamite", "nuke",
            ],
        },
        DefaultRuleSpec {
            id: "rule-gunshot",
            tag_name: "Gunshot",
            tag_color: "#EF4444",
            facet_slug: "category",
            parent_tag_name: Some("Action & Combat"),
            keywords: &[
                "gunshot", "gun", "guns", "rifle", "pistol", "shotgun", "shoot", "shot", "bullet",
                "sniper", "artillery",
            ],
        },
        DefaultRuleSpec {
            id: "rule-melee",
            tag_name: "Melee",
            tag_color: "#EF4444",
            facet_slug: "category",
            parent_tag_name: Some("Action & Combat"),
            keywords: &[
                "sword", "swords", "blade", "slash", "arrow", "bow", "dagger", "axe", "spear",
                "melee",
            ],
        },
        DefaultRuleSpec {
            id: "rule-weapons",
            tag_name: "Weapons",
            tag_color: "#EF4444",
            facet_slug: "category",
            parent_tag_name: Some("Action & Combat"),
            keywords: &["weapons", "weapon", "reload", "holster", "cocking", "trigger"],
        },
        // ── Animals (2-level species rules) ──────────────────────────────────
        DefaultRuleSpec {
            id: "rule-animals-dog",
            tag_name: "Dog",
            tag_color: "#22C55E",
            facet_slug: "category",
            parent_tag_name: Some("Animals"),
            keywords: &["dog", "dogs", "bark", "wolf", "wolves", "howl", "puppy", "hound"],
        },
        DefaultRuleSpec {
            id: "rule-animals-bird",
            tag_name: "Bird",
            tag_color: "#22C55E",
            facet_slug: "category",
            parent_tag_name: Some("Animals"),
            keywords: &["bird", "birds", "chirp", "crow", "owl", "eagle", "hawk", "seagull"],
        },
        DefaultRuleSpec {
            id: "rule-animals-cat",
            tag_name: "Cat",
            tag_color: "#22C55E",
            facet_slug: "category",
            parent_tag_name: Some("Animals"),
            keywords: &["cat", "cats", "meow", "purr", "kitten", "feline"],
        },
        DefaultRuleSpec {
            id: "rule-animals-horse",
            tag_name: "Horse",
            tag_color: "#22C55E",
            facet_slug: "category",
            parent_tag_name: Some("Animals"),
            keywords: &["horse", "horses", "neigh", "gallop", "hooves"],
        },
        DefaultRuleSpec {
            id: "rule-animals-monster",
            tag_name: "Monster",
            tag_color: "#22C55E",
            facet_slug: "category",
            parent_tag_name: Some("Animals"),
            keywords: &["monster", "monsters", "creature", "creatures", "roar", "growl", "dragon", "beast"],
        },
        DefaultRuleSpec {
            id: "rule-animals-insect",
            tag_name: "Insect",
            tag_color: "#22C55E",
            facet_slug: "category",
            parent_tag_name: Some("Animals"),
            keywords: &["insect", "insects", "cricket", "bee", "wasp", "mosquito", "cicada"],
        },
        // ── Foley & Material ─────────────────────────────────────────────────
        DefaultRuleSpec {
            id: "rule-footsteps",
            tag_name: "Footsteps",
            tag_color: "#F59E0B",
            facet_slug: "category",
            parent_tag_name: Some("Foley"),
            keywords: &[
                "footsteps", "footstep", "steps", "step", "walk", "walking", "run", "running",
                "sneaker", "boot",
            ],
        },
        DefaultRuleSpec {
            id: "rule-door",
            tag_name: "Door",
            tag_color: "#F59E0B",
            facet_slug: "category",
            parent_tag_name: Some("Foley"),
            keywords: &["door", "doors", "knock", "creak", "drawer", "latch", "hinge"],
        },
        DefaultRuleSpec {
            id: "rule-glass",
            tag_name: "Glass",
            tag_color: "#F59E0B",
            facet_slug: "category",
            parent_tag_name: Some("Foley"),
            keywords: &["glass", "shatter", "bottle", "clink", "ceramic"],
        },
        DefaultRuleSpec {
            id: "rule-wood",
            tag_name: "Wood",
            tag_color: "#F59E0B",
            facet_slug: "category",
            parent_tag_name: Some("Foley"),
            keywords: &["wood", "wooden", "splinter", "plank", "twig", "branch"],
        },
        DefaultRuleSpec {
            id: "rule-metal",
            tag_name: "Metal",
            tag_color: "#F59E0B",
            facet_slug: "category",
            parent_tag_name: Some("Foley"),
            keywords: &["metal", "metallic", "clang", "chain", "coin", "coins", "keys"],
        },
        DefaultRuleSpec {
            id: "rule-cloth",
            tag_name: "Cloth",
            tag_color: "#F59E0B",
            facet_slug: "category",
            parent_tag_name: Some("Foley"),
            keywords: &["cloth", "fabric", "zipper", "leather", "rustle", "paper"],
        },
        // ── Nature & Ambience ────────────────────────────────────────────────
        DefaultRuleSpec {
            id: "rule-ambience",
            tag_name: "Ambience",
            tag_color: "#14B8A6",
            facet_slug: "category",
            parent_tag_name: Some("Nature & Ambience"),
            keywords: &[
                "ambience", "atmos", "atmosphere", "roomtone", "environment", "forest", "cave",
                "jungle", "night", "city",
            ],
        },
        DefaultRuleSpec {
            id: "rule-weather",
            tag_name: "Weather",
            tag_color: "#14B8A6",
            facet_slug: "category",
            parent_tag_name: Some("Nature & Ambience"),
            keywords: &[
                "weather", "wind", "rain", "thunder", "storm", "lightning", "snow", "ice",
                "blizzard", "tornado", "breeze",
            ],
        },
        DefaultRuleSpec {
            id: "rule-water",
            tag_name: "Water",
            tag_color: "#14B8A6",
            facet_slug: "category",
            parent_tag_name: Some("Nature & Ambience"),
            keywords: &[
                "water", "splash", "liquid", "bubble", "bubbles", "swim", "underwater", "ocean",
                "sea", "wave", "waves", "drip", "pour", "aqua", "surf",
            ],
        },
        DefaultRuleSpec {
            id: "rule-fire",
            tag_name: "Fire",
            tag_color: "#14B8A6",
            facet_slug: "category",
            parent_tag_name: Some("Nature & Ambience"),
            keywords: &[
                "fire", "flame", "flames", "burn", "burning", "torch", "ignite", "lava", "inferno",
                "fireball", "ember",
            ],
        },
        // ── Sci-Fi & Tech ────────────────────────────────────────────────────
        DefaultRuleSpec {
            id: "rule-scifi",
            tag_name: "Sci-Fi",
            tag_color: "#0EA5E9",
            facet_slug: "category",
            parent_tag_name: Some("Sci-Fi & Tech"),
            keywords: &[
                "laser", "lasers", "plasma", "scifi", "cyber", "robot", "mech", "glitch",
                "telemetry", "scanner", "beam", "warp", "alien", "spaceship", "electric", "zap",
                "spark", "electricity",
            ],
        },
        DefaultRuleSpec {
            id: "rule-ui",
            tag_name: "UI",
            tag_color: "#0EA5E9",
            facet_slug: "category",
            parent_tag_name: Some("Sci-Fi & Tech"),
            keywords: &[
                "ui", "hud", "menu", "button", "click", "clicks", "beep", "interface", "confirm",
                "cancel", "select", "notification", "cursor", "popup", "switch", "toggle",
            ],
        },
        DefaultRuleSpec {
            id: "rule-magic",
            tag_name: "Magic",
            tag_color: "#0EA5E9",
            facet_slug: "category",
            parent_tag_name: Some("Sci-Fi & Tech"),
            keywords: &[
                "magic", "magical", "spell", "spells", "cast", "casting", "heal", "healing",
                "buff", "debuff", "arcane", "mana", "portal", "teleport", "enchant", "sparkle",
                "sparkles", "shimmer", "chime", "fairy",
            ],
        },
        // ── Voice & Music ────────────────────────────────────────────────────
        DefaultRuleSpec {
            id: "rule-vocal",
            tag_name: "Vocal",
            tag_color: "#8B5CF6",
            facet_slug: "category",
            parent_tag_name: Some("Voice & Music"),
            keywords: &[
                "vocal", "vocals", "voice", "speech", "dialogue", "scream", "laugh", "whisper",
                "choir", "singing",
            ],
        },
        DefaultRuleSpec {
            id: "rule-music",
            tag_name: "Music",
            tag_color: "#8B5CF6",
            facet_slug: "category",
            parent_tag_name: Some("Voice & Music"),
            keywords: &[
                "music", "musical", "song", "melody", "chord", "piano", "guitar", "orchestra",
                "braam", "riser", "stinger", "jingle", "fanfare",
            ],
        },
        // ── Source / Pack ────────────────────────────────────────────────────
        DefaultRuleSpec {
            id: "rule-pokemon",
            tag_name: "Pokemon",
            tag_color: "#64748B",
            facet_slug: "source",
            parent_tag_name: None,
            keywords: &[
                "pokemon", "pkmn", "pokedex", "pokeball", "pikachu", "charizard", "mewtwo",
                "bulbasaur", "squirtle", "eevee",
            ],
        },
    ];

    rules_data
        .iter()
        .map(|spec| AutoTagRule {
            id: spec.id.to_string(),
            tag_name: spec.tag_name.to_string(),
            tag_color: spec.tag_color.to_string(),
            keywords: spec.keywords.iter().map(|s| (*s).to_string()).collect(),
            enabled: true,
            category: None,
            include_paths: None,
            exclude_paths: None,
            rel_include_paths: Vec::new(),
            rel_exclude_paths: Vec::new(),
            min_duration_ms: None,
            max_duration_ms: None,
            facet_slug: Some(spec.facet_slug.to_string()),
            parent_tag_name: spec.parent_tag_name.map(|p| p.to_string()),
        })
        .collect()
}
