import { AsciiPresetMeta } from "../../types";
import { defineAsciiPreset } from "./shared";

export const EXTENDED_ASCII_PRESETS_PART_1: AsciiPresetMeta[] = [
  // ── 6. Space & Sci-Fi (12) ────────────────────────────────────────────────
  defineAsciiPreset(
    "deep_nebula",
    "space",
    "Deep Nebula",
    "Wispy cosmic dust clouds, violet filaments & stars",
    "#060412",
    "#1d0e38",
    [" · ✦ ∘ ", " ∘ + · ", " ✦ · ∘ "],
    "#c4b5fd",
    "#8B5CF6"
  ),
  defineAsciiPreset(
    "orbital_rings",
    "space",
    "Ringed Planet",
    "Minimal sphere with tilted Saturnian particle rings",
    "#050712",
    "#151b38",
    ["  ·──· ", "─( ◯ )─", " ·──·  "],
    "#fcd34d",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "solar_eclipse",
    "space",
    "Solar Eclipse",
    "Total eclipse corona shimmer & diamond-ring flare",
    "#050409",
    "#1c120b",
    ["  ·✦·  ", " ·(●)· ", "  ·∘·  "],
    "#fde047",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "pulsar_beacon",
    "space",
    "Pulsar Horizon",
    "Relativistic polar jets & magnetic wave arcs",
    "#040914",
    "#0e233d",
    [" ╲ │ ╱ ", " ──◈── ", " ╱ │ ╲ "],
    "#38bdf8",
    "#06B6D4"
  ),
  defineAsciiPreset(
    "star_warp",
    "space",
    "Quiet Drift",
    "Three-layer parallax starfield drifting in deep space",
    "#03050c",
    "#0b1329",
    [" ·   ✦ ", "   ∘   ", " ✦   · "],
    "#e2e8f0",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "lunar_phase",
    "space",
    "Crescent Horizon",
    "Curved planetary limb & high-contrast waxing moon",
    "#050811",
    "#111c33",
    ["   ☽   ", "  · ·  ", "╭─────╮"],
    "#e0f2fe",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "black_hole",
    "space",
    "Event Horizon",
    "Gravitational lensing accretion disk & photon ring",
    "#050308",
    "#210e1c",
    ["  ╭─╮  ", "══(●)══", "  ╰─╯  "],
    "#fb923c",
    "#F97316"
  ),
  defineAsciiPreset(
    "dyson_sphere",
    "space",
    "Dyson Swarm",
    "Rotating geodesic collector rings around captive star",
    "#060913",
    "#182238",
    [" ╭─┬─╮ ", " ├(☼)┤ ", " ╰─┴─╯ "],
    "#fbbf24",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "binary_sunset",
    "space",
    "Twin Suns",
    "Two setting suns over alien desert horizon ridge",
    "#17090c",
    "#38171d",
    [" ◯     ", "   ○   ", "╱─────╲"],
    "#fca5a5",
    "#F43F5E"
  ),
  defineAsciiPreset(
    "wormhole_gate",
    "space",
    "Stargate Aperture",
    "Concentric warp gate rings & folding spacetime tunnel",
    "#040a18",
    "#102447",
    [" ╭───╮ ", " │(◈)│ ", " ╰───╯ "],
    "#60a5fa",
    "#3B82F6"
  ),
  defineAsciiPreset(
    "orbital_station",
    "space",
    "Ring Station",
    "Rotating wheel space station above glowing Earth limb",
    "#040914",
    "#0f2342",
    [" ╭─┼─╮ ", " ╰─┼─╯ ", "╭─────╮"],
    "#93c5fd",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "exoplanet_aurora",
    "space",
    "Alien Moons",
    "Three crescent moons aligned above alien ridge",
    "#061017",
    "#122b38",
    [" ☽ ◯ ☾ ", " │¦│¦│ ", "╱─────╲"],
    "#2dd4bf",
    "#14B8A6"
  ),

  // ── 7. Cyber & Terminal (12) ──────────────────────────────────────────────
  defineAsciiPreset(
    "cyber_matrix",
    "cyber",
    "Phosphor Rain",
    "Sparse katakana & hex digital rain columns",
    "#020d06",
    "#072412",
    [" │ 0 │ ", " 1 │ 7 ", " ✦ 9 │ "],
    "#4ade80",
    "#10B981"
  ),
  defineAsciiPreset(
    "cyber_net_grid",
    "cyber",
    "Vector Horizon",
    "Perspective laser grid & wireframe mountain skyline",
    "#090416",
    "#220c3b",
    [" ╱╲ ╱╲ ", "───────", "╱ │ ┼ ╲"],
    "#f472b6",
    "#EC4899"
  ),
  defineAsciiPreset(
    "cyber_neural_core",
    "cyber",
    "Synapse Graph",
    "Interconnected AI neural nodes & pulsing data links",
    "#040c18",
    "#0f2442",
    [" ◈───○ ", " │ ╲ │ ", " ○───◈ "],
    "#38bdf8",
    "#06B6D4"
  ),
  defineAsciiPreset(
    "cyber_terminal_hud",
    "cyber",
    "Kernel Telemetry",
    "Minimalist system hex stream, radar & status rails",
    "#050c0a",
    "#0e241e",
    ["[SYS:OK]", "0x4F ──", " ───▸  "],
    "#2dd4bf",
    "#14B8A6"
  ),
  defineAsciiPreset(
    "cyber_holo_globe",
    "cyber",
    "Wireframe Globe",
    "Rotating latitude/longitude sphere & orbital ping",
    "#040b17",
    "#0d2240",
    [" ╭─┬─╮ ", " ├─┼─┤ ", " ╰─┴─╯ "],
    "#60a5fa",
    "#3B82F6"
  ),
  defineAsciiPreset(
    "cyber_dna_helix",
    "cyber",
    "Bio-Helix",
    "Rotating double-strand ASCII helix & base rungs",
    "#060918",
    "#151d42",
    [" ╭───╮ ", "  ╲─╱  ", " ╭───╮ "],
    "#a78bfa",
    "#8B5CF6"
  ),
  defineAsciiPreset(
    "cyber_radar_sweep",
    "cyber",
    "Tactical Sonar",
    "Polar coordinate ring grid & rotating phosphor sweep",
    "#030e09",
    "#0a2619",
    [" ╭─┼─╮ ", " ─┼◈╱─ ", " ╰─┼─╯ "],
    "#34d399",
    "#10B981"
  ),
  defineAsciiPreset(
    "cyber_glitch_monolith",
    "cyber",
    "Dark Monolith",
    "Floating obsidian slab with scanline & hex aura",
    "#090612",
    "#1f1235",
    ["  ┌─┐  ", " ─│█│─ ", "  └─┘  "],
    "#e879f9",
    "#D946EF"
  ),
  defineAsciiPreset(
    "cyber_drone_relay",
    "cyber",
    "Skyline Drones",
    "Autonomous light paths weaving between dark towers",
    "#050a14",
    "#122038",
    [" ──▸ · ", "┌┐ ·◂──", "││ ┌┐  "],
    "#38bdf8",
    "#0EA5E9"
  ),
  defineAsciiPreset(
    "cyber_firewall",
    "cyber",
    "Hex Barrier",
    "Breathing hexagonal honeycomb lattice & pulse wave",
    "#120609",
    "#2e0f18",
    [" ⬡ ⬡ ⬡ ", "  ⬡ ⬡  ", " ⬡ ⬡ ⬡ "],
    "#fb7185",
    "#F43F5E"
  ),
  defineAsciiPreset(
    "cyber_satellite_link",
    "cyber",
    "Uplink Dish",
    "Parabolic telemetry dish transmitting beam to orbit",
    "#050b14",
    "#112238",
    ["    ✦  ", "  ╱·   ", " ╰┴╯   "],
    "#7dd3fc",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "cyber_code_stream",
    "cyber",
    "Binary Cascade",
    "Horizontal multi-speed data buses & packet nodes",
    "#040d12",
    "#0c2530",
    ["──◈────", "────∘──", "─◈─────"],
    "#22d3ee",
    "#06B6D4"
  ),

  // ── 8. City & Nightlife (Part 1: 6) ───────────────────────────────────────
  defineAsciiPreset(
    "neon_skyline",
    "city",
    "Neon Skyline",
    "Architectural line-art towers & water reflections",
    "#070918",
    "#181d3d",
    ["┌┐ ┌─┐ ", "││ │▪│ ", "── ~ ──"],
    "#38bdf8",
    "#38BDF8"
  ),
  defineAsciiPreset(
    "night_express",
    "city",
    "Night Express",
    "Elevated viaduct with gliding illuminated train",
    "#080b18",
    "#19203b",
    [" ▄▄▄▄▄ ", "═╤═══╤═", "  ~~~  "],
    "#fbbf24",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "tokyo_alley",
    "city",
    "Lantern Alley",
    "Quiet night alley with swaying warm lanterns",
    "#12080d",
    "#29121e",
    ["│╭◈─◈╮│", "│     │", "│  ~  │"],
    "#fb7185",
    "#F43F5E"
  ),
  defineAsciiPreset(
    "rooftop_lounge",
    "city",
    "Midnight Terrace",
    "Foreground railing, antennas & city horizon beacons",
    "#070b16",
    "#161f36",
    [" ┼   ┼ ", "┌┐┌─┐┌┐", "┬─┬─┬─┬"],
    "#93c5fd",
    "#3B82F6"
  ),
  defineAsciiPreset(
    "subway_transit",
    "city",
    "Metro Line",
    "Minimalist transit map geometry & station pulses",
    "#070c14",
    "#132033",
    ["─○───◉─", "  ╲ ╱  ", "───○───"],
    "#34d399",
    "#10B981"
  ),
  defineAsciiPreset(
    "radio_tower",
    "city",
    "Signal Spire",
    "Lattice broadcast spire, beacon & concentric waves",
    "#090814",
    "#1d1936",
    [" ( ✦ ) ", "  ╱┼╲  ", " ╱─┼─╲ "],
    "#f43f5e",
    "#F43F5E"
  ),
];
