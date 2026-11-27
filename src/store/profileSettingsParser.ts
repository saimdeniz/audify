import {
  ASCII_MAGIC_FIT_STORAGE_KEY,
  ASCII_MAGIC_LOOK_STORAGE_KEY,
  ASCII_MAGIC_SLUG_STORAGE_KEY,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
} from "../constants/asciiMagic";
import { VALID_ASCII_PRESETS } from "../constants/asciiPresetIds";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import {
  AsciiMagicFit,
  AsciiMagicLook,
  AsciiPresetId,
  ExportAudioPreset,
  ExportLoudnessMode,
  MiniDockEdgeSide,
  ProfileSettings,
  ThemeMode,
  WallpaperKind,
  WaveformSensitivity,
  WaveformStyle,
} from "../types";
import {
  loadAiBootSettings,
  sanitizeAiProfileSettings,
  type AiBootSettingsSnapshot,
} from "./aiSettingsBridge";
import { safeGetItem } from "./localStorageSafe";

export function normalizeAsciiPreset(raw: unknown): AsciiPresetId {
  if (typeof raw === "string" && VALID_ASCII_PRESETS.has(raw)) {
    return raw as AsciiPresetId;
  }
  return "moonlit";
}

export function normalizeWallpaperKind(
  raw: unknown,
  customBgImage = ""
): WallpaperKind {
  if (
    raw === "none" ||
    raw === "image" ||
    raw === "ascii_preset" ||
    raw === "ascii_magic"
  ) {
    return raw;
  }
  if (raw === "ascii_custom") {
    return "ascii_preset";
  }
  return customBgImage.trim().length > 0 ? "image" : "none";
}

export function normalizeAsciiMotionSpeed(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(2, Number(n.toFixed(2))));
}

export function hasActiveVisualBackdrop(
  wallpaperKind: WallpaperKind,
  customBgImage: string,
  asciiMagicSlug = ""
): boolean {
  if (wallpaperKind === "ascii_preset") return true;
  if (wallpaperKind === "ascii_magic") {
    return asciiMagicSlug.trim().length > 0;
  }
  if (wallpaperKind === "image") {
    return customBgImage.trim().length > 0;
  }
  return false;
}

export interface BootSettingsSnapshot extends AiBootSettingsSnapshot {
  themeMode: ThemeMode;
  accentColor: string;
  accentAuto: boolean;
  waveformSensitivity: WaveformSensitivity;
  waveformStyle: WaveformStyle;
  playheadLatencyMs: number | null;
  audioOutputDeviceId: string;
  enableMica: boolean;
  sidebarCompactHover: boolean;
  themeTintIntensity: number;
  customBgImage: string;
  customBgBlur: number;
  customBgOpacity: number;
  wallpaperKind: WallpaperKind;
  asciiPreset: AsciiPresetId;
  asciiMagicSlug: string;
  asciiMagicLook: AsciiMagicLook;
  asciiMagicFit: AsciiMagicFit;
  asciiMotionSpeed: number;
  enableLicenses: boolean;
  autoBinOnNleDrag: boolean;
  customSliceExportPath: string;
  customLayerExportPath: string;
  autoSaveLayerOnNleDrag: boolean;
  smartSearchSynonyms: boolean;
  autoPreview: boolean;
  isLooping: boolean;
  isShuffle: boolean;
  volume: number;
  sliceMicroFade: boolean;
  exportAudioPreset: ExportAudioPreset;
  exportLoudnessMode: ExportLoudnessMode;
  skipLeadingSilence: boolean;
  miniDockEdgePeek: boolean;
  miniDockEdgeSide: MiniDockEdgeSide;
  normalizePreview: boolean;
  autoAnalyzeBpmKey: boolean;
  enableAdvancedFileOps: boolean;
  confirmBeforeTrash: boolean;
  enableLiveFolderWatch: boolean;
}

function parseBoundedNumber(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
  round = false
): number {
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(min, Math.min(max, parsed));
  return round ? Math.round(clamped) : clamped;
}

export function loadBootSettings(): BootSettingsSnapshot {
  const rawTheme = safeGetItem(AUDIFY_STORAGE_KEYS.themeMode);
  const themeMode: ThemeMode =
    rawTheme === "light" || rawTheme === "contrast" || rawTheme === "dark"
      ? rawTheme
      : "dark";
  const accentColor = safeGetItem(AUDIFY_STORAGE_KEYS.accentColor) || "#F59E0B";
  const accentAuto = safeGetItem(AUDIFY_STORAGE_KEYS.accentAuto) === "true";

  const rawSens = safeGetItem(AUDIFY_STORAGE_KEYS.waveformSensitivity);
  const waveformSensitivity: WaveformSensitivity =
    rawSens === "linear" || rawSens === "high_boost" || rawSens === "logarithmic"
      ? rawSens
      : "logarithmic";

  const rawStyle = safeGetItem(AUDIFY_STORAGE_KEYS.waveformStyle);
  const waveformStyle: WaveformStyle =
    rawStyle === "symmetric" || rawStyle === "solid_baseline"
      ? rawStyle
      : "solid_baseline";

  const savedPlayheadLatencyRaw = safeGetItem(AUDIFY_STORAGE_KEYS.playheadLatencyMs);
  const playheadLatencyMs: number | null =
    savedPlayheadLatencyRaw !== null &&
    savedPlayheadLatencyRaw.trim() !== "" &&
    savedPlayheadLatencyRaw !== "auto" &&
    Number.isFinite(Number(savedPlayheadLatencyRaw))
      ? Math.max(-100, Math.min(500, Number(savedPlayheadLatencyRaw)))
      : null;

  const audioOutputDeviceId =
    safeGetItem(AUDIFY_STORAGE_KEYS.audioOutputDeviceId) || "default";

  const enableMica = safeGetItem(AUDIFY_STORAGE_KEYS.enableMica) === "true";

  const themeTintIntensity = parseBoundedNumber(
    safeGetItem(AUDIFY_STORAGE_KEYS.themeTintIntensity),
    0,
    0,
    1
  );

  const customBgImage = safeGetItem(AUDIFY_STORAGE_KEYS.customBgImage) || "";
  const customBgBlur = parseBoundedNumber(
    safeGetItem(AUDIFY_STORAGE_KEYS.customBgBlur),
    16,
    0,
    48,
    true
  );

  const customBgOpacity = parseBoundedNumber(
    safeGetItem(AUDIFY_STORAGE_KEYS.customBgOpacity),
    0.22,
    0,
    1
  );

  const wallpaperKind = normalizeWallpaperKind(
    safeGetItem(AUDIFY_STORAGE_KEYS.wallpaperKind),
    customBgImage
  );
  const asciiPreset = normalizeAsciiPreset(
    safeGetItem(AUDIFY_STORAGE_KEYS.asciiPreset)
  );
  const asciiMagicSlug = normalizeAsciiMagicSlug(
    safeGetItem(ASCII_MAGIC_SLUG_STORAGE_KEY)
  );
  const asciiMagicLook = normalizeAsciiMagicLook(
    safeGetItem(ASCII_MAGIC_LOOK_STORAGE_KEY)
  );
  const asciiMagicFit = normalizeAsciiMagicFit(
    safeGetItem(ASCII_MAGIC_FIT_STORAGE_KEY)
  );
  const rawSpeed = safeGetItem(AUDIFY_STORAGE_KEYS.asciiMotionSpeed);
  const asciiMotionSpeed =
    rawSpeed !== null && rawSpeed.trim() !== ""
      ? normalizeAsciiMotionSpeed(rawSpeed)
      : 1;

  const enableLicenses = safeGetItem(AUDIFY_STORAGE_KEYS.enableLicenses) === "true";
  const sidebarCompactHover =
    safeGetItem(AUDIFY_STORAGE_KEYS.sidebarCompactHover) === "true";
  const autoBinOnNleDrag =
    safeGetItem(AUDIFY_STORAGE_KEYS.autoBinOnNleDrag) === "true";
  const customSliceExportPath =
    safeGetItem(AUDIFY_STORAGE_KEYS.customSliceExportPath) || "";
  const customLayerExportPath =
    safeGetItem(AUDIFY_STORAGE_KEYS.customLayerExportPath) || "";
  const autoSaveLayerOnNleDrag =
    safeGetItem(AUDIFY_STORAGE_KEYS.autoSaveLayerOnNleDrag) === "true";
  const smartSearchSynonyms =
    safeGetItem(AUDIFY_STORAGE_KEYS.smartSearchSynonyms) !== "false";

  const rawAutoPreview = safeGetItem(AUDIFY_STORAGE_KEYS.autoPreview);
  const autoPreview = rawAutoPreview === null ? true : rawAutoPreview === "true";
  const isLooping = safeGetItem(AUDIFY_STORAGE_KEYS.isLooping) === "true";
  const isShuffle = safeGetItem(AUDIFY_STORAGE_KEYS.isShuffle) === "true";

  const volume = parseBoundedNumber(
    safeGetItem(AUDIFY_STORAGE_KEYS.volume),
    0.9,
    0,
    1
  );

  // Strictly default OFF (false) per user preference
  const sliceMicroFade = safeGetItem(AUDIFY_STORAGE_KEYS.sliceMicroFade) === "true";
  const rawExportPreset = safeGetItem(AUDIFY_STORAGE_KEYS.exportAudioPreset);
  const exportAudioPreset: ExportAudioPreset =
    rawExportPreset === "wav_24" || rawExportPreset === "nle_48k_24"
      ? rawExportPreset
      : "original";
  const rawLoudness = safeGetItem(AUDIFY_STORAGE_KEYS.exportLoudnessMode);
  const exportLoudnessMode: ExportLoudnessMode =
    rawLoudness === "peak_m1" ||
    rawLoudness === "lufs_m14" ||
    rawLoudness === "lufs_m24"
      ? rawLoudness
      : "off";
  const skipLeadingSilence =
    safeGetItem(AUDIFY_STORAGE_KEYS.skipLeadingSilence) === "true";
  const miniDockEdgePeek =
    safeGetItem(AUDIFY_STORAGE_KEYS.miniDockEdgePeek) === "true";
  const rawEdgeSide = safeGetItem(AUDIFY_STORAGE_KEYS.miniDockEdgeSide);
  const miniDockEdgeSide: MiniDockEdgeSide =
    rawEdgeSide === "left" ? "left" : "right";
  const normalizePreview =
    safeGetItem(AUDIFY_STORAGE_KEYS.normalizePreview) === "true";
  const autoAnalyzeBpmKey =
    safeGetItem(AUDIFY_STORAGE_KEYS.autoAnalyzeBpmKey) === "true";
  const enableAdvancedFileOps =
    safeGetItem(AUDIFY_STORAGE_KEYS.enableAdvancedFileOps) === "true";
  const confirmBeforeTrash =
    safeGetItem(AUDIFY_STORAGE_KEYS.confirmBeforeTrash) !== "false";
  const enableLiveFolderWatch =
    safeGetItem(AUDIFY_STORAGE_KEYS.enableLiveFolderWatch) !== "false";

  return {
    themeMode,
    accentColor,
    accentAuto,
    waveformSensitivity,
    waveformStyle,
    playheadLatencyMs,
    audioOutputDeviceId,
    enableMica,
    sidebarCompactHover,
    themeTintIntensity,
    customBgImage,
    customBgBlur,
    customBgOpacity,
    wallpaperKind,
    asciiPreset,
    asciiMagicSlug,
    asciiMagicLook,
    asciiMagicFit,
    asciiMotionSpeed,
    enableLicenses,
    autoBinOnNleDrag,
    customSliceExportPath,
    customLayerExportPath,
    autoSaveLayerOnNleDrag,
    smartSearchSynonyms,
    autoPreview,
    isLooping,
    isShuffle,
    volume,
    sliceMicroFade,
    exportAudioPreset,
    exportLoudnessMode,
    skipLeadingSilence,
    miniDockEdgePeek,
    miniDockEdgeSide,
    normalizePreview,
    autoAnalyzeBpmKey,
    enableAdvancedFileOps,
    confirmBeforeTrash,
    enableLiveFolderWatch,
    ...loadAiBootSettings(),
  };
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function sanitizeParsedProfileSettings(
  raw: Record<string, unknown>
): ProfileSettings {
  const out: Record<string, unknown> = { ...raw };

  if (
    out.themeMode !== undefined &&
    out.themeMode !== "dark" &&
    out.themeMode !== "light" &&
    out.themeMode !== "contrast"
  ) {
    delete out.themeMode;
  }
  if (
    out.accentColor !== undefined &&
    (typeof out.accentColor !== "string" ||
      !HEX_COLOR_RE.test(out.accentColor.trim()))
  ) {
    delete out.accentColor;
  }
  if (
    out.waveformSensitivity !== undefined &&
    out.waveformSensitivity !== "linear" &&
    out.waveformSensitivity !== "logarithmic" &&
    out.waveformSensitivity !== "high_boost"
  ) {
    delete out.waveformSensitivity;
  }
  if (
    out.waveformStyle !== undefined &&
    out.waveformStyle !== "symmetric" &&
    out.waveformStyle !== "solid_baseline"
  ) {
    delete out.waveformStyle;
  }
  if (
    out.exportAudioPreset !== undefined &&
    out.exportAudioPreset !== "original" &&
    out.exportAudioPreset !== "wav_24" &&
    out.exportAudioPreset !== "nle_48k_24"
  ) {
    delete out.exportAudioPreset;
  }
  if (
    out.exportLoudnessMode !== undefined &&
    out.exportLoudnessMode !== "off" &&
    out.exportLoudnessMode !== "peak_m1" &&
    out.exportLoudnessMode !== "lufs_m14" &&
    out.exportLoudnessMode !== "lufs_m24"
  ) {
    delete out.exportLoudnessMode;
  }
  if (
    out.miniDockEdgeSide !== undefined &&
    out.miniDockEdgeSide !== "right" &&
    out.miniDockEdgeSide !== "left"
  ) {
    delete out.miniDockEdgeSide;
  }

  for (const numKey of [
    "volume",
    "themeTintIntensity",
    "customBgBlur",
    "customBgOpacity",
    "asciiMotionSpeed",
    "playheadLatencyMs",
  ]) {
    if (
      out[numKey] !== undefined &&
      out[numKey] !== null &&
      (typeof out[numKey] !== "number" || !Number.isFinite(out[numKey]))
    ) {
      delete out[numKey];
    }
  }

  for (const boolKey of [
    "accentAuto",
    "autoPreview",
    "isLooping",
    "isShuffle",
    "enableMica",
    "sidebarCompactHover",
    "enableLicensesSystem",
    "autoBinOnNleDrag",
    "smartSearchSynonyms",
    "sliceMicroFade",
    "skipLeadingSilence",
    "miniDockEdgePeek",
    "normalizePreview",
    "autoAnalyzeBpmKey",
    "enableAdvancedFileOps",
    "confirmBeforeTrash",
    "enableLiveFolderWatch",
    "autoCreateCollectionSubfolders",
    "autoRouteCollectionDrops",
    "autoSaveLayerOnNleDrag",
  ]) {
    if (out[boolKey] !== undefined && typeof out[boolKey] !== "boolean") {
      delete out[boolKey];
    }
  }

  for (const arrKey of [
    "autoTagCategories",
    "autoTagRules",
    "licenseGroups",
    "collectionTemplates",
  ]) {
    if (out[arrKey] !== undefined && !Array.isArray(out[arrKey])) {
      delete out[arrKey];
    }
  }

  if (out.asciiMagicSlug !== undefined) {
    if (typeof out.asciiMagicSlug !== "string") {
      delete out.asciiMagicSlug;
    } else {
      const normalized = normalizeAsciiMagicSlug(out.asciiMagicSlug);
      out.asciiMagicSlug = normalized;
    }
  }
  if (out.asciiMagicLook !== undefined) {
    out.asciiMagicLook = normalizeAsciiMagicLook(out.asciiMagicLook);
  }
  if (out.asciiMagicFit !== undefined) {
    out.asciiMagicFit = normalizeAsciiMagicFit(out.asciiMagicFit);
  }

  sanitizeAiProfileSettings(out);

  return out as ProfileSettings;
}

export function parseProfileSettings(settingsJson: string): ProfileSettings {
  try {
    const parsed: unknown = JSON.parse(settingsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return sanitizeParsedProfileSettings(parsed as Record<string, unknown>);
    }
  } catch {
    // Ignore malformed JSON
  }
  return {};
}
