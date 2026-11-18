import type { AsciiPresetId } from "../types";

/**
 * Lightweight preset ID & auto-accent table kept separate from `asciiPresetsCore`
 * and `asciiPresetsExtended` so the main entry bundle avoids eager preset metadata.
 */
export const ASCII_PRESET_AUTO_ACCENTS: Readonly<Record<AsciiPresetId, string | null>> = {
  // Nature & Weather
  moonlit: "#38BDF8",
  cloud_drift: "#38BDF8",
  fireflies: "#10B981",
  autumn_breeze: "#F59E0B",
  sakura_night: "#EC4899",
  rainy_glass: "#06B6D4",
  thunder_peak: "#8B5CF6",
  desert_mirage: "#F59E0B",
  blizzard_pass: "#38BDF8",
  bamboo_wind: "#10B981",
  misty_falls: "#06B6D4",
  aurora_veil: "#14B8A6",

  // Camp & Wild
  aurora_cabin: "#10B981",
  campfire_night: "#F97316",
  alpine_mist: "#64748B",
  stargazer_tent: "#F59E0B",
  pine_breeze: "#10B981",
  lakeside_pier: "#EAB308",
  watchtower_ridge: "#F59E0B",
  canyon_arch: "#EA580C",
  nordic_fjord: "#0284C7",
  forest_hammock: "#10B981",
  highland_moor: "#64748B",
  glacier_camp: "#38BDF8",

  // Zen & Mechanical
  zen_rock_garden: "#94A3B8",
  zen_bonsai_moon: "#10B981",
  zen_incense_smoke: "#A855F7",
  zen_lotus_pond: "#EC4899",
  zen_wind_chime: "#38BDF8",
  zen_bamboo_shishi: "#10B981",
  zen_pendulum_wave: "#F59E0B",
  zen_tourbillon: "#F59E0B",
  zen_hourglass: "#EAB308",
  zen_orrery: "#F59E0B",
  zen_metronome: "#06B6D4",
  zen_mandala: "#F59E0B",

  // Ocean & Deep
  koi_pond: "#F97316",
  jellyfish: "#06B6D4",
  coral_reef: "#14B8A6",
  abyss_trench: "#0284C7",
  moon_tide: "#38BDF8",
  lighthouse_cove: "#EAB308",
  manta_glide: "#0EA5E9",
  biolum_surf: "#06B6D4",
  sunken_torii: "#14B8A6",
  arctic_floe: "#38BDF8",
  kelp_cathedral: "#10B981",
  whale_song: "#3B82F6",

  // Space & Cosmos
  deep_nebula: "#8B5CF6",
  orbital_rings: "#F59E0B",
  solar_eclipse: "#F59E0B",
  pulsar_beacon: "#06B6D4",
  star_warp: "#38BDF8",
  lunar_phase: "#38BDF8",
  black_hole: "#F97316",
  dyson_sphere: "#F59E0B",
  binary_sunset: "#F43F5E",
  wormhole_gate: "#3B82F6",
  orbital_station: "#38BDF8",
  exoplanet_aurora: "#14B8A6",

  // Cyber & Grid
  cyber_matrix: "#10B981",
  cyber_net_grid: "#EC4899",
  cyber_neural_core: "#06B6D4",
  cyber_terminal_hud: "#14B8A6",
  cyber_holo_globe: "#3B82F6",
  cyber_dna_helix: "#8B5CF6",
  cyber_radar_sweep: "#10B981",
  cyber_glitch_monolith: "#D946EF",
  cyber_drone_relay: "#0EA5E9",
  cyber_firewall: "#F43F5E",
  cyber_satellite_link: "#38BDF8",
  cyber_code_stream: "#06B6D4",

  // City & Transit
  neon_skyline: "#38BDF8",
  night_express: "#F59E0B",
  tokyo_alley: "#F43F5E",
  rooftop_lounge: "#3B82F6",
  subway_transit: "#10B981",
  radio_tower: "#F43F5E",
  suspension_bridge: "#F59E0B",
  rainy_crosswalk: "#06B6D4",
  clocktower_fog: "#EAB308",
  harbor_cranes: "#F97316",
  highway_trails: "#EF4444",
  monorail_glide: "#0EA5E9",

  // Retro & Arcade
  retro_outrun_sun: "#EC4899",
  retro_arcade_maze: "#EAB308",
  retro_cassette: "#F97316",
  retro_crt_tv: "#3B82F6",
  retro_gameboy: "#84CC16",
  retro_starfighter: "#3B82F6",
  retro_lava_lamp: "#F43F5E",
  retro_pinball: "#A855F7",
  retro_vapor_bust: "#06B6D4",
  retro_boombox: "#0EA5E9",
  retro_pong_court: "#94A3B8",
  retro_nixie_clock: "#10B981",

  // Studio & Synth (mirror user accent => null)
  studio_pulse: null,
  vinyl_groove: null,
  minimal_spectrum: null,
  tape_reels: null,
  sine_osc: null,
  modular_matrix: null,
  lissajous_scope: null,
  vu_needle_pair: null,
  midi_piano_roll: null,
  harmonic_circle: null,
  patch_cables: null,
  mastering_meters: null,
};

export const ASCII_PRESET_IDS: readonly AsciiPresetId[] = Object.keys(
  ASCII_PRESET_AUTO_ACCENTS
) as AsciiPresetId[];

export const VALID_ASCII_PRESETS: ReadonlySet<string> = new Set<string>(
  ASCII_PRESET_IDS
);
