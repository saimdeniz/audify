export type ThemeMode = "dark" | "light" | "contrast";
export type AsciiPresetId = "isobars" | "spectrum" | "horizon";

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
  rgb: string;
  /** Darkened readable RGB on Light surfaces */
  lightFgRgb: string;
  /** Text color on solid accent fill */
  onHex: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: "amber", label: "Studio Amber", hex: "#F59E0B", rgb: "245 158 11", lightFgRgb: "180 83 9", onHex: "#0D0D0F" },
  { id: "cyan", label: "Signal Cyan", hex: "#06B6D4", rgb: "6 182 212", lightFgRgb: "14 116 144", onHex: "#0D0D0F" },
  { id: "emerald", label: "Fairlight Mint", hex: "#10B981", rgb: "16 185 129", lightFgRgb: "4 120 87", onHex: "#0D0D0F" },
  { id: "rose", label: "Tape Rose", hex: "#F43F5E", rgb: "244 63 94", lightFgRgb: "190 18 60", onHex: "#FFFFFF" },
  { id: "violet", label: "Synth Violet", hex: "#8B5CF6", rgb: "139 92 246", lightFgRgb: "109 40 217", onHex: "#FFFFFF" },
] as const;

export const SITE_CONFIG = {
  appName: "Audify",
  version: "v1.0.1",
  releaseDate: "2026",
  platform: "Windows 10 / 11 (64-bit)",
  portableSize: "22.1 MB Portable .exe",
  licenseSpdx: "GPL-3.0",
  licenseName: "GNU General Public License v3.0",
  downloadUrl: "#download",
  directDownloadUrl: "https://github.com/saimdeniz/audify/releases/latest/download/Audify.exe",
  sha256SumsUrl: "https://github.com/saimdeniz/audify/releases/latest/download/SHA256SUMS.txt",
  githubLatestApiUrl: "https://api.github.com/repos/saimdeniz/audify/releases/latest",
  githubReleasesUrl: "https://github.com/saimdeniz/audify/releases/latest",
  githubRepoUrl: "https://github.com/saimdeniz/audify",
  licenseUrl: "https://github.com/saimdeniz/audify/blob/main/LICENSE",
  thirdPartyNoticesUrl: "https://github.com/saimdeniz/audify/blob/main/THIRD_PARTY_NOTICES.md",
  sha256: "737C78929EF2E787FF51C62BEF60D7D9CEBB3688F3686F56A73EC4CCB0AB7623",
} as const;
