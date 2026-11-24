import type { AiSimilarityScope, AiTaggingMode } from "./aiAndSearch";

export type CollectionIconId =
  | "layers"
  | "folder"
  | "music"
  | "zap"
  | "flame"
  | "sparkles"
  | "film"
  | "gamepad"
  | "disc"
  | "shield"
  | "headphones"
  | "radio"
  | "heart"
  | "bookmark"
  | "archive";

export interface CollectionRuleTemplate {
  id: string;
  name: string;
  color?: string;
  icon?: CollectionIconId;
  folder_path?: string;
  rel_folder_path?: string;
}

export type ThemeMode = "dark" | "light" | "contrast";
export type WaveformSensitivity = "logarithmic" | "high_boost" | "linear";
export type WaveformStyle = "solid_baseline" | "symmetric";
export type ExportAudioPreset = "original" | "wav_24" | "nle_48k_24";
export type ExportLoudnessMode = "off" | "peak_m1" | "lufs_m14" | "lufs_m24";
export type MiniDockEdgeSide = "right" | "left";

export type WallpaperKind = "none" | "image" | "ascii_preset" | "ascii_magic";
export type AsciiMagicLook =
  | "original"
  | "dots"
  | "ascii"
  | "dense"
  | "blocks"
  | "dither";
export type AsciiMagicFit = "contain" | "cover";

export type AsciiPresetCategory =
  | "nature"
  | "camp"
  | "zen"
  | "ocean"
  | "space"
  | "cyber"
  | "city"
  | "retro"
  | "studio";

export type AsciiPresetId =
  // Nature & Weather (12)
  | "moonlit"
  | "cloud_drift"
  | "fireflies"
  | "autumn_breeze"
  | "sakura_night"
  | "rainy_glass"
  | "thunder_peak"
  | "desert_mirage"
  | "blizzard_pass"
  | "bamboo_wind"
  | "misty_falls"
  | "aurora_veil"
  // Camp & Sanctuary (12)
  | "aurora_cabin"
  | "campfire_night"
  | "alpine_mist"
  | "stargazer_tent"
  | "pine_breeze"
  | "lakeside_pier"
  | "watchtower_ridge"
  | "canyon_arch"
  | "nordic_fjord"
  | "forest_hammock"
  | "highland_moor"
  | "glacier_camp"
  // Zen, Sanctuary & Horology/Kinetic (12)
  | "zen_rock_garden"
  | "zen_bonsai_moon"
  | "zen_incense_smoke"
  | "zen_lotus_pond"
  | "zen_wind_chime"
  | "zen_bamboo_shishi"
  | "zen_pendulum_wave"
  | "zen_tourbillon"
  | "zen_hourglass"
  | "zen_orrery"
  | "zen_metronome"
  | "zen_mandala"
  // Ocean & Abyss (12)
  | "koi_pond"
  | "jellyfish"
  | "coral_reef"
  | "abyss_trench"
  | "moon_tide"
  | "lighthouse_cove"
  | "manta_glide"
  | "biolum_surf"
  | "sunken_torii"
  | "arctic_floe"
  | "kelp_cathedral"
  | "whale_song"
  // Space & Sci-Fi (12)
  | "deep_nebula"
  | "orbital_rings"
  | "solar_eclipse"
  | "pulsar_beacon"
  | "star_warp"
  | "lunar_phase"
  | "black_hole"
  | "dyson_sphere"
  | "binary_sunset"
  | "wormhole_gate"
  | "orbital_station"
  | "exoplanet_aurora"
  // Cyber & Terminal (12)
  | "cyber_matrix"
  | "cyber_net_grid"
  | "cyber_neural_core"
  | "cyber_terminal_hud"
  | "cyber_holo_globe"
  | "cyber_dna_helix"
  | "cyber_radar_sweep"
  | "cyber_glitch_monolith"
  | "cyber_drone_relay"
  | "cyber_firewall"
  | "cyber_satellite_link"
  | "cyber_code_stream"
  // City & Nightlife (12)
  | "neon_skyline"
  | "night_express"
  | "tokyo_alley"
  | "rooftop_lounge"
  | "subway_transit"
  | "radio_tower"
  | "suspension_bridge"
  | "rainy_crosswalk"
  | "clocktower_fog"
  | "harbor_cranes"
  | "highway_trails"
  | "monorail_glide"
  // Retro, Synth & Pixel Art (12)
  | "retro_outrun_sun"
  | "retro_arcade_maze"
  | "retro_cassette"
  | "retro_crt_tv"
  | "retro_gameboy"
  | "retro_starfighter"
  | "retro_lava_lamp"
  | "retro_pinball"
  | "retro_vapor_bust"
  | "retro_boombox"
  | "retro_pong_court"
  | "retro_nixie_clock"
  // Studio & Audio Telemetry (12)
  | "studio_pulse"
  | "vinyl_groove"
  | "minimal_spectrum"
  | "tape_reels"
  | "sine_osc"
  | "modular_matrix"
  | "lissajous_scope"
  | "vu_needle_pair"
  | "midi_piano_roll"
  | "harmonic_circle"
  | "patch_cables"
  | "mastering_meters";

export interface AsciiPresetMeta {
  id: AsciiPresetId;
  category: AsciiPresetCategory;
  name: string;
  subtitle: string;
  swatchGradient: string;
  /** Optional Light-mode swatch override used by abstract Studio scenes. */
  swatchGradientLight?: string;
  previewGlyphs: string[];
  /** Optional accent color for stylized card glyphs. */
  previewTint?: string;
  previewTintLight?: string;
  /** Optional curated dynamic accent hex when Accent Auto is enabled. */
  autoAccentHex?: string;
}

export interface AccentColorOption {
  id: string;
  name: string;
  hex: string;
  rowBgDark: string;
  rowBgLight: string;
}

export interface KeyboardShortcuts {
  playPause: string;
  stopPlayback: string;
  prevTrack: string;
  nextTrack: string;
  toggleShuffle: string;
  toggleLoop: string;
  toggleAutoPreview: string;
  toggleMute: string;
  toggleFavorite: string;
  markSliceIn?: string;
  markSliceOut?: string;
  saveSlice?: string;
  clearSlice: string;
  removeFromCollection: string;
  addToBin: string;
  copyFilePath?: string;
  showInFolder?: string;
  findSimilar?: string;
  toggleMiniDock?: string;
}

export type LicenseQuoteMode = "auto" | "multi_only" | "always" | "never";

export interface LicenseGroup {
  id: string;
  name: string;
  color?: string;
  icon?: CollectionIconId;
  folders: string[];
  rel_folders?: string[];
  template: string;
  quoteMode: LicenseQuoteMode;
}

export interface AutoTagCategoryConfig {
  name: string;
  include_paths?: string[];
  exclude_paths?: string[];
  rel_include_paths?: string[];
  rel_exclude_paths?: string[];
}

export interface AutoTagRule {
  id: string;
  tag_name: string;
  tag_color: string;
  keywords: string[];
  enabled: boolean;
  category?: string;
  include_paths?: string[];
  exclude_paths?: string[];
  rel_include_paths?: string[];
  rel_exclude_paths?: string[];
  min_duration_ms?: number;
  max_duration_ms?: number;
}

export interface AutoTagPreviewResult {
  match_count: number;
  sample_names: string[];
}

export interface ProfileSettings {
  themeMode?: ThemeMode;
  accentColor?: string;
  accentAuto?: boolean;
  waveformSensitivity?: WaveformSensitivity;
  waveformStyle?: WaveformStyle;
  playheadLatencyMs?: number | null;
  audioOutputDeviceId?: string;
  autoPreview?: boolean;
  isLooping?: boolean;
  isShuffle?: boolean;
  volume?: number;
  sliceMicroFade?: boolean;
  exportAudioPreset?: ExportAudioPreset;
  exportLoudnessMode?: ExportLoudnessMode;
  skipLeadingSilence?: boolean;
  miniDockEdgePeek?: boolean;
  miniDockEdgeSide?: MiniDockEdgeSide;
  normalizePreview?: boolean;
  autoAnalyzeBpmKey?: boolean;
  smartSearchSynonyms?: boolean;
  autoBinOnNleDrag?: boolean;
  binSampleIds?: number[];
  enableMica?: boolean;
  sidebarCompactHover?: boolean;
  themeTintIntensity?: number;
  customBgImage?: string;
  customBgBlur?: number;
  customBgOpacity?: number;
  wallpaperKind?: WallpaperKind;
  asciiPreset?: AsciiPresetId;
  asciiMagicSlug?: string;
  asciiMagicLook?: AsciiMagicLook;
  asciiMagicFit?: AsciiMagicFit;
  asciiMotionSpeed?: number;
  shortcuts?: KeyboardShortcuts;
  autoTagRules?: AutoTagRule[];
  autoTagCategories?: AutoTagCategoryConfig[];
  enableLicensesSystem?: boolean;
  licenseGroups?: LicenseGroup[];
  collectionTemplates?: CollectionRuleTemplate[];
  autoCreateCollectionSubfolders?: boolean;
  autoRouteCollectionDrops?: boolean;
  customSliceExportPath?: string;
  enableAdvancedFileOps?: boolean;
  confirmBeforeTrash?: boolean;
  enableLiveFolderWatch?: boolean;
  aiAutoAnalyzeOnScan?: boolean;
  aiTagConfidenceThreshold?: number;
  aiTaggingMode?: AiTaggingMode;
  aiKnnTagLearning?: boolean;
  aiSimilarityMinScore?: number;
  aiSimilarityTopK?: number;
  aiSimilarityScope?: AiSimilarityScope;
  aiSimilarityDurationMatch?: boolean;
}

export interface Profile {
  id: number;
  name: string;
  color: string;
  settings_json: string;
  is_active: boolean;
  created_at: string;
}

export interface ProfileQuickStats {
  favorites_count: number;
  existing_sample_ids: number[];
}
