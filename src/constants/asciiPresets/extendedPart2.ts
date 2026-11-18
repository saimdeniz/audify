import { AsciiPresetMeta } from "../../types";
import { defineAsciiPreset } from "./shared";

const STUDIO_LIGHT_SWATCH = {
  bgTop: "#eef2f6",
  bgBottom: "#dfe5ec",
};

export const EXTENDED_ASCII_PRESETS_PART_2: AsciiPresetMeta[] = [
  // ── 8. City & Nightlife (Part 2: 6) ───────────────────────────────────────
  defineAsciiPreset(
    "suspension_bridge",
    "city",
    "Harbor Bridge",
    "Sweeping suspension cables, pylons & bay reflections",
    "#060c1a",
    "#142340",
    ["╲  ║  ╱", "═╦═╬═╦═", "  ~~~  "],
    "#fcd34d",
    "#F59E0B"
  ),
  defineAsciiPreset(
    "rainy_crosswalk",
    "city",
    "Neon Crosswalk",
    "Perspective zebra stripes & traffic light reflections",
    "#070a14",
    "#161d33",
    ["  ● ○  ", " ═ ═ ═ ", "  ~ ~  "],
    "#22d3ee",
    "#06B6D4"
  ),
  defineAsciiPreset(
    "clocktower_fog",
    "city",
    "Clocktower Mist",
    "Illuminated clock face silhouette in drifting fog",
    "#0a0c16",
    "#1c2036",
    ["  ╭▲╮  ", "  │☼│~ ", " ~│ │  "],
    "#fde68a",
    "#EAB308"
  ),
  defineAsciiPreset(
    "harbor_cranes",
    "city",
    "Port Silhouette",
    "Distant container cranes, buoy lights & calm bay",
    "#060d18",
    "#13233b",
    [" ╔═╤═  ", " ║ │   ", " ~~~~~ "],
    "#fb923c",
    "#F97316"
  ),
  defineAsciiPreset(
    "highway_trails",
    "city",
    "Light Trails",
    "Curving overpass with red & white headlight arcs",
    "#090812",
    "#1e182e",
    ["  ╱══╲ ", " ╱ ·  ╲", "╱  ·   "],
    "#f87171",
    "#EF4444"
  ),
  defineAsciiPreset(
    "monorail_glide",
    "city",
    "Sky Monorail",
    "Sleek elevated monorail slicing between high-rises",
    "#060b18",
    "#14223d",
    ["│ ───▸│", "═══════", "│  │  │"],
    "#38bdf8",
    "#0EA5E9"
  ),

  // ── 9. Retro, Synth & Pixel Art (12) ──────────────────────────────────────
  defineAsciiPreset(
    "retro_outrun_sun",
    "retro",
    "Outrun Sunset",
    "Sliced synthwave sun over magenta horizon scanlines",
    "#14051c",
    "#3b0d36",
    [" ╭───╮ ", " ═════ ", "╱ ─┼─ ╲"],
    "#f472b6",
    "#EC4899"
  ),
  defineAsciiPreset(
    "retro_arcade_maze",
    "retro",
    "Arcade Chase",
    "Minimalist neon maze corridors & phosphor dots",
    "#040716",
    "#0e163b",
    ["┌──┬──┐", "│··ᗧ··│", "└──┴──┘"],
    "#facc15",
    "#EAB308"
  ),
  defineAsciiPreset(
    "retro_cassette",
    "retro",
    "Mixtape Deck",
    "Compact cassette window with turning tape spools",
    "#120b09",
    "#2b1913",
    ["┌─────┐", "│(◎─◎)│", "└─────┘"],
    "#fb923c",
    "#F97316"
  ),
  defineAsciiPreset(
    "retro_crt_tv",
    "retro",
    "Late Night CRT",
    "Minimal television frame with soft scanline bars",
    "#080a10",
    "#181d2b",
    ["┌─────┐", "│ ▒░▒ │", "└──┬──┘"],
    "#93c5fd",
    "#3B82F6"
  ),
  defineAsciiPreset(
    "retro_gameboy",
    "retro",
    "Handheld Dot",
    "Classic 4-shade olive pixel landscape & clouds",
    "#0f190b",
    "#233819",
    [" ─── · ", " ╱▲╲   ", "═══════"],
    "#a3e635",
    "#84CC16"
  ),
  defineAsciiPreset(
    "retro_starfighter",
    "retro",
    "8-Bit Starfighter",
    "Pixel starship cruising past scrolling starfield",
    "#050614",
    "#111538",
    [" ·  ✦  ", " ══▶ · ", "  ·  ∘ "],
    "#60a5fa",
    "#3B82F6"
  ),
  defineAsciiPreset(
    "retro_lava_lamp",
    "retro",
    "Lava Lounge",
    "Rising & merging warm metaball blobs in glass cone",
    "#160712",
    "#330f29",
    ["  ╱▲╲  ", " │ ● │ ", " ╰───╯ "],
    "#fb7185",
    "#F43F5E"
  ),
  defineAsciiPreset(
    "retro_pinball",
    "retro",
    "Neon Bumpers",
    "Glowing circular arcade bumpers & silver ball trail",
    "#0b061a",
    "#221142",
    [" (◎) (◎", "   ·•  ", " ╲   ╱ "],
    "#c084fc",
    "#A855F7"
  ),
  defineAsciiPreset(
    "retro_vapor_bust",
    "retro",
    "Vapor Column",
    "Classical column silhouettes & pastel dusk grid",
    "#120921",
    "#2d1847",
    [" ╦   ╦ ", " ║ ◯ ║ ", "╱─┼─┼─╲"],
    "#67e8f9",
    "#06B6D4"
  ),
  defineAsciiPreset(
    "retro_boombox",
    "retro",
    "Pixel Boombox",
    "Dual pulsing speaker cones & center LED equalizer",
    "#0c0a14",
    "#211b36",
    ["┌─┬─┬─┐", "│◎│≡│◎│", "└─┴─┴─┘"],
    "#38bdf8",
    "#0EA5E9"
  ),
  defineAsciiPreset(
    "retro_pong_court",
    "retro",
    "Classic Pong",
    "Minimalist center dashed line, paddles & pixel ball",
    "#06080c",
    "#141924",
    ["▌  ┊   ", "   ┊• ▐", "   ┊   "],
    "#e2e8f0",
    "#94A3B8"
  ),
  defineAsciiPreset(
    "retro_nixie_clock",
    "retro",
    "Space Invaders",
    "Starlit arcade fleet, glowing shields & laser fire",
    "#040712",
    "#0c142b",
    [" ▀▄█▄▀ ", " █████ ", " ▀ ▀ ▀ "],
    "#34d399",
    "#10B981"
  ),

  // ── 10. Studio & Audio Telemetry (12 — Adaptive Dark/Light) ───────────────
  defineAsciiPreset(
    "studio_pulse",
    "studio",
    "Studio Pulse",
    "Symmetric center-line waveform & crisp peak dots",
    "#0b0d13",
    "#161a24",
    ["  │┃│  ", "─┼┃█┃┼─", "  │┃│  "],
    "#38bdf8",
    "#38BDF8",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "vinyl_groove",
    "studio",
    "Vinyl Groove",
    "Concentric micro-grooves, center label & tonearm",
    "#0b0d13",
    "#161a24",
    [" ╭───╮╱", " │(◎)│ ", " ╰───╯ "],
    "#f59e0b",
    "#F59E0B",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "minimal_spectrum",
    "studio",
    "Harmonic Bars",
    "Fine LED-segment spectrum analyzer & peak holds",
    "#0b0d13",
    "#161a24",
    [" · ∘ · ", " ║ ║ ║ ", "═╬═╬═╬═"],
    "#10b981",
    "#10B981",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "tape_reels",
    "studio",
    "Analog Tape",
    "Dual rotating reel-to-reel flanges & stereo meter",
    "#0b0d13",
    "#161a24",
    ["(◎)─(◎)", " ╲───╱ ", " ═══── "],
    "#f97316",
    "#F97316",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "sine_osc",
    "studio",
    "Oscilloscope",
    "Dual phase-shifted harmonic sine waves over grid",
    "#0b0d13",
    "#161a24",
    [" ╭─╮   ", "─╯ ╰─╭─", "   ╰─╯ "],
    "#06b6d4",
    "#06B6D4",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "modular_matrix",
    "studio",
    "Step Matrix",
    "16-step sequencer grid with active nodes & playhead",
    "#0b0d13",
    "#161a24",
    ["▪ · ◈ ·", "· ◈ ▪ ·", "· · ◈ ▪"],
    "#a855f7",
    "#A855F7",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "lissajous_scope",
    "studio",
    "Phase Vectorscope",
    "Rotating 3D Lissajous stereo phase figure & reticle",
    "#0b0d13",
    "#161a24",
    [" ╭─┼─╮ ", "─┼(◈)┼─", " ╰─┼─╯ "],
    "#2dd4bf",
    "#14B8A6",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "vu_needle_pair",
    "studio",
    "Dual VU Meters",
    "Twin ballistic analog VU meter arcs & needles",
    "#0b0d13",
    "#161a24",
    ["╭──╮╭──", "│ ╱││╲ ", "╰──╯╰──"],
    "#fbbf24",
    "#F59E0B",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "midi_piano_roll",
    "studio",
    "MIDI Cascade",
    "Scrolling horizontal note blocks & playhead line",
    "#0b0d13",
    "#161a24",
    ["│ ▬▬   ", "│   ▬▬▬", "│ ▬▬   "],
    "#60a5fa",
    "#3B82F6",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "harmonic_circle",
    "studio",
    "Circle of Fifths",
    "Rotating harmonic pitch wheel & active chord triad",
    "#0b0d13",
    "#161a24",
    [" ╭─▲─╮ ", " │╱ ╲│ ", " ╰───╯ "],
    "#ec4899",
    "#EC4899",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "patch_cables",
    "studio",
    "Modular Patch",
    "Eurorack jack matrix with swaying catenary cords",
    "#0b0d13",
    "#161a24",
    [" ◎ ╮ ◎ ", " ◎ │ ◎ ", " ◎ ╰─◎ "],
    "#8b5cf6",
    "#8B5CF6",
    STUDIO_LIGHT_SWATCH
  ),
  defineAsciiPreset(
    "mastering_meters",
    "studio",
    "LUFS Telemetry",
    "Precision L/R/M/S loudness bars & phase correlation",
    "#0b0d13",
    "#161a24",
    [" ║ ║ │ ", " ║ ║ ┃ ", "─┴─┴─┴─"],
    "#34d399",
    "#10B981",
    STUDIO_LIGHT_SWATCH
  ),
];
