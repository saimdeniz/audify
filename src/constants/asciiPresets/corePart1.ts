import { AsciiPresetMeta } from "../../types";
import { defineAsciiPreset } from "./shared";

export const CORE_ASCII_PRESETS_PART_1: AsciiPresetMeta[] = [
  // ── 1. Nature & Weather (12) ──────────────────────────────────────────────
  defineAsciiPreset(
    "moonlit",
    "nature",
    "Moonlit",
    "Crescent moon, silent hills & silver water shimmer",
    "#060916",
    "#182242",
    ["·  ☽ · ", " ╱───╲ ", " ~ ─ ~ "],
    "#e0f2fe",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "cloud_drift",
    "nature",
    "Cloud Drift",
    "Minimalist twilight cloud ribbons & calm breeze",
    "#0e1b33",
    "#28466e",
    [" ─── · ", "～～───", " · ─── "],
    "#bae6fd",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "fireflies",
    "nature",
    "Fireflies",
    "Breathing amber fireflies above swaying reeds",
    "#06100c",
    "#13261d",
    [" · ✦  ∘", "∘  · ✦ ", "│/│\\│/│"],
    "#fde047",
    "#10B981"
  ),
  defineAsciiPreset(
    "autumn_breeze",
    "nature",
    "Autumn Breeze",
    "Slender canopy boughs & drifting copper leaves",
    "#160c08",
    "#331b11",
    ["─┬─╲ · ", "  ~ ∘ ~", " ·  ~ ·"],
    "#fdba74",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "sakura_night",
    "nature",
    "Sakura Night",
    "Blossom branch, hazy moon & pink petal ripples",
    "#140b1c",
    "#2d1739",
    ["─╲✿ · ○", "  ✿  · ", " ( · ) "],
    "#f9a8d4",
    "#EC4899"
  ),
  defineAsciiPreset(
    "rainy_glass",
    "nature",
    "Rainy Glass",
    "Fine diagonal rain streaks & soft city bokeh",
    "#070d17",
    "#15243b",
    [" │ ╵ │ ", "╵  │  :", " ∘ · ○ "],
    "#93c5fd",
    "#06B6D4"
  ),
  defineAsciiPreset(
    "thunder_peak",
    "nature",
    "Thunder Peak",
    "Storm ridge silhouette with branching lightning",
    "#080914",
    "#1c1d36",
    ["  ⚡╱   ", " ╱─╲╱╲ ", " │ ╵ │ "],
    "#c4b5fd",
    "#8B5CF6"
  ),
  defineAsciiPreset(
    "desert_mirage",
    "nature",
    "Desert Dunes",
    "Sweeping crescent dunes, twin moons & heat haze",
    "#1a0f0a",
    "#3d2214",
    [" · ○ ∘ ", " ╱───╲ ", "╱─────╲"],
    "#fcd34d",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "blizzard_pass",
    "nature",
    "Snowfall Pines",
    "Silent snow-dusted conifers & gentle flurries",
    "#09131e",
    "#1b2e42",
    [" * ·  *", " · ▲ · ", "  ╱│╲  "],
    "#e2e8f0",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "bamboo_wind",
    "nature",
    "Bamboo Grove",
    "Tall swaying emerald stalks & sunlit forest motes",
    "#05130e",
    "#0f2e22",
    ["│ ┼ │ ┼", "┼ │ ┼ │", "│ · │ ∘"],
    "#6ee7b7",
    "#10B981"
  ),
  defineAsciiPreset(
    "misty_falls",
    "nature",
    "Misty Cascade",
    "Sheer cliff waterfall, rising spray & plunge pool",
    "#07131c",
    "#132e40",
    ["─┐║║┌──", "  ║║ · ", " ~∘~~· "],
    "#7dd3fc",
    "#06B6D4"
  ),
  defineAsciiPreset(
    "aurora_veil",
    "nature",
    "Polar Ribbon",
    "High-altitude emerald & violet aurora curtains",
    "#050d16",
    "#0e292d",
    [" │¦│·¦ ", " ·│¦│· ", " ╱───╲ "],
    "#5eead4",
    "#14B8A6"
  ),

  // ── 3. Camp & Sanctuary (12) ──────────────────────────────────────────────
  defineAsciiPreset(
    "aurora_cabin",
    "camp",
    "Aurora Cabin",
    "Lit timber cabin beneath northern light curtains",
    "#05101a",
    "#0f2d2a",
    [" │¦│·¦ ", "  ╱▲╲  ", "  │▪│  "],
    "#34d399",
    "#10B981"
  ),
  defineAsciiPreset(
    "campfire_night",
    "camp",
    "Campfire",
    "Timber teepee, rising glowing embers & dark pines",
    "#140b07",
    "#2b160d",
    ["  · ✦  ", "  ╱▲╲  ", " ═════ "],
    "#fb923c",
    "#F97316"
  ),
  defineAsciiPreset(
    "alpine_mist",
    "camp",
    "Alpine Ridge",
    "Three layered mountain contours & valley mist",
    "#09101d",
    "#1a2940",
    [" ╱╲ ╱╲ ", " ───── ", "╱  ~~~╲"],
    "#cbd5e1",
    "#64748B"
  ),
  defineAsciiPreset(
    "stargazer_tent",
    "camp",
    "Stargazer Field",
    "Milky Way dust band & warm glowing A-frame tent",
    "#070b19",
    "#151f3d",
    [" · ✦ · ", "  ╱▲╲  ", " ╱───╲ "],
    "#fcd34d",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "pine_breeze",
    "camp",
    "Pine Sanctuary",
    "Swaying layered evergreen silhouettes & spores",
    "#06120f",
    "#102a23",
    [" ▲  ▲  ", "╱│╲╱│╲ ", " │  │  "],
    "#34d399",
    "#10B981"
  ),
  defineAsciiPreset(
    "lakeside_pier",
    "camp",
    "Midnight Pier",
    "Wooden dock, hanging lantern & golden water shimmer",
    "#07101c",
    "#13273f",
    [" ╭◈    ", "═╤═══  ", "  ~ ~  "],
    "#fde047",
    "#EAB308"
  ),
  defineAsciiPreset(
    "watchtower_ridge",
    "camp",
    "Fire Lookout",
    "Timber lookout tower atop mountain crest & stars",
    "#0b0f1c",
    "#1e263d",
    ["  ┌▲┐  ", "  │▪│  ", " ╱───╲ "],
    "#fbbf24",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "canyon_arch",
    "camp",
    "Red Canyon",
    "Desert stone arch framing starry sky & camp ember",
    "#190b08",
    "#381810",
    [" ╭───╮ ", " │ ✦ │ ", "─┴───┴─"],
    "#f97316",
    "#EA580C"
  ),
  defineAsciiPreset(
    "nordic_fjord",
    "camp",
    "Nordic Fjord",
    "Steep fjord cliffs, mirrored stars & sailboat",
    "#06101c",
    "#122a42",
    ["╲  ·  ╱", " ╲ ◢ ╱ ", " ───── "],
    "#7dd3fc",
    "#0284C7"
  ),
  defineAsciiPreset(
    "forest_hammock",
    "camp",
    "Lantern Hammock",
    "Warm string lights & hammock slung between pines",
    "#07120e",
    "#152c22",
    ["│·∘·∘·│", "│ ╰─╯ │", "│     │"],
    "#fde047",
    "#10B981"
  ),
  defineAsciiPreset(
    "highland_moor",
    "camp",
    "Misty Moor",
    "Standing monolith stones on misty moonlit hill",
    "#090f18",
    "#1a2736",
    [" · ☽ · ", " ║ ║ ║ ", " ───── "],
    "#94a3b8",
    "#64748B"
  ),
  defineAsciiPreset(
    "glacier_camp",
    "camp",
    "Basecamp Peaks",
    "Expedition tents beneath serrated ice peaks",
    "#07111e",
    "#162d47",
    [" ╱▲╲╱▲╲", " ──────", "  ▲  ▲ "],
    "#bae6fd",
    "#38BDF8"
  ),
];
