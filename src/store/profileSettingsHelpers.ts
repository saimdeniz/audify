import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import {
  AutoTagCategoryConfig,
  AutoTagRule,
  ProfileSettings,
} from "../types";
import {
  ASCII_MAGIC_FIT_STORAGE_KEY,
  ASCII_MAGIC_LOOK_STORAGE_KEY,
  ASCII_MAGIC_SLUG_STORAGE_KEY,
  safeSetItem,
} from "./storageHelpers";
import { applyThemeAndAccentToDom } from "./themeDom";
import type { SampleStoreState, StoreGet, StoreSet } from "./types";

export function resolveBool(
  parsedVal: unknown,
  isBoot: boolean,
  bootVal: boolean,
  fallback: boolean
): boolean {
  if (typeof parsedVal === "boolean") return parsedVal;
  return isBoot ? bootVal : fallback;
}

export function resolveAutoTagCategories(
  parsedCategories: AutoTagCategoryConfig[] | undefined,
  autoTagRules: AutoTagRule[]
): AutoTagCategoryConfig[] {
  if (Array.isArray(parsedCategories)) return parsedCategories;
  const derived = Array.from(
    new Set(
      autoTagRules
        .map((r) => r.category)
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    )
  ).map((name) => ({ name, include_paths: [], exclude_paths: [] }));
  if (derived.length > 0) return derived;
  return [
    { name: "SFX", include_paths: [], exclude_paths: [] },
    { name: "Ambience", include_paths: [], exclude_paths: [] },
    { name: "Music", include_paths: [], exclude_paths: [] },
  ];
}

export function buildProfileStoragePairs(
  resolvedFields: Pick<
    SampleStoreState,
    | "themeMode"
    | "accentColor"
    | "accentAuto"
    | "waveformSensitivity"
    | "waveformStyle"
    | "playheadLatencyMs"
    | "audioOutputDeviceId"
    | "autoPreview"
    | "isLooping"
    | "isShuffle"
    | "volume"
    | "smartSearchSynonyms"
    | "autoBinOnNleDrag"
    | "binSampleIds"
    | "enableMica"
    | "sidebarCompactHover"
    | "themeTintIntensity"
    | "customBgImage"
    | "customBgBlur"
    | "customBgOpacity"
    | "wallpaperKind"
    | "asciiPreset"
    | "asciiMagicSlug"
    | "asciiMagicLook"
    | "asciiMagicFit"
    | "asciiMotionSpeed"
    | "shortcuts"
    | "enableLicensesSystem"
    | "licenseGroups"
    | "collectionTemplates"
    | "autoCreateCollectionSubfolders"
    | "autoRouteCollectionDrops"
    | "customSliceExportPath"
    | "sliceMicroFade"
    | "exportAudioPreset"
    | "skipLeadingSilence"
    | "miniDockEdgePeek"
    | "miniDockEdgeSide"
    | "normalizePreview"
    | "autoAnalyzeBpmKey"
    | "enableAdvancedFileOps"
    | "confirmBeforeTrash"
    | "enableLiveFolderWatch"
  >,
  aiStoragePairs: Array<[string, string]>
): Array<[string, string]> {
  return [
    [AUDIFY_STORAGE_KEYS.themeMode, resolvedFields.themeMode],
    [AUDIFY_STORAGE_KEYS.accentColor, resolvedFields.accentColor],
    [AUDIFY_STORAGE_KEYS.accentAuto, String(resolvedFields.accentAuto)],
    [AUDIFY_STORAGE_KEYS.waveformSensitivity, resolvedFields.waveformSensitivity],
    [AUDIFY_STORAGE_KEYS.waveformStyle, resolvedFields.waveformStyle],
    [
      AUDIFY_STORAGE_KEYS.playheadLatencyMs,
      resolvedFields.playheadLatencyMs === null
        ? "auto"
        : String(resolvedFields.playheadLatencyMs),
    ],
    [AUDIFY_STORAGE_KEYS.audioOutputDeviceId, resolvedFields.audioOutputDeviceId],
    [AUDIFY_STORAGE_KEYS.autoPreview, String(resolvedFields.autoPreview)],
    [AUDIFY_STORAGE_KEYS.isLooping, String(resolvedFields.isLooping)],
    [AUDIFY_STORAGE_KEYS.isShuffle, String(resolvedFields.isShuffle)],
    [AUDIFY_STORAGE_KEYS.volume, String(resolvedFields.volume)],
    [
      AUDIFY_STORAGE_KEYS.smartSearchSynonyms,
      String(resolvedFields.smartSearchSynonyms),
    ],
    [AUDIFY_STORAGE_KEYS.autoBinOnNleDrag, String(resolvedFields.autoBinOnNleDrag)],
    [AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(resolvedFields.binSampleIds)],
    [AUDIFY_STORAGE_KEYS.enableMica, String(resolvedFields.enableMica)],
    [
      AUDIFY_STORAGE_KEYS.sidebarCompactHover,
      String(resolvedFields.sidebarCompactHover),
    ],
    [
      AUDIFY_STORAGE_KEYS.themeTintIntensity,
      String(resolvedFields.themeTintIntensity),
    ],
    [AUDIFY_STORAGE_KEYS.customBgImage, resolvedFields.customBgImage],
    [AUDIFY_STORAGE_KEYS.customBgBlur, String(resolvedFields.customBgBlur)],
    [AUDIFY_STORAGE_KEYS.customBgOpacity, String(resolvedFields.customBgOpacity)],
    [AUDIFY_STORAGE_KEYS.wallpaperKind, resolvedFields.wallpaperKind],
    [AUDIFY_STORAGE_KEYS.asciiPreset, resolvedFields.asciiPreset],
    [ASCII_MAGIC_SLUG_STORAGE_KEY, resolvedFields.asciiMagicSlug],
    [ASCII_MAGIC_LOOK_STORAGE_KEY, resolvedFields.asciiMagicLook],
    [ASCII_MAGIC_FIT_STORAGE_KEY, resolvedFields.asciiMagicFit],
    [AUDIFY_STORAGE_KEYS.asciiMotionSpeed, String(resolvedFields.asciiMotionSpeed)],
    [AUDIFY_STORAGE_KEYS.shortcuts, JSON.stringify(resolvedFields.shortcuts)],
    [
      AUDIFY_STORAGE_KEYS.enableLicenses,
      String(resolvedFields.enableLicensesSystem),
    ],
    [AUDIFY_STORAGE_KEYS.licenseGroups, JSON.stringify(resolvedFields.licenseGroups)],
    [
      AUDIFY_STORAGE_KEYS.collectionTemplates,
      JSON.stringify(resolvedFields.collectionTemplates),
    ],
    [
      AUDIFY_STORAGE_KEYS.autoCreateSubfolders,
      String(resolvedFields.autoCreateCollectionSubfolders),
    ],
    [
      AUDIFY_STORAGE_KEYS.autoRouteCollectionDrops,
      String(resolvedFields.autoRouteCollectionDrops),
    ],
    [AUDIFY_STORAGE_KEYS.customSliceExportPath, resolvedFields.customSliceExportPath],
    [AUDIFY_STORAGE_KEYS.sliceMicroFade, String(resolvedFields.sliceMicroFade)],
    [AUDIFY_STORAGE_KEYS.exportAudioPreset, resolvedFields.exportAudioPreset],
    [
      AUDIFY_STORAGE_KEYS.skipLeadingSilence,
      String(resolvedFields.skipLeadingSilence),
    ],
    [
      AUDIFY_STORAGE_KEYS.miniDockEdgePeek,
      String(resolvedFields.miniDockEdgePeek),
    ],
    [AUDIFY_STORAGE_KEYS.miniDockEdgeSide, resolvedFields.miniDockEdgeSide],
    [AUDIFY_STORAGE_KEYS.normalizePreview, String(resolvedFields.normalizePreview)],
    [
      AUDIFY_STORAGE_KEYS.autoAnalyzeBpmKey,
      String(resolvedFields.autoAnalyzeBpmKey),
    ],
    [
      AUDIFY_STORAGE_KEYS.enableAdvancedFileOps,
      String(resolvedFields.enableAdvancedFileOps),
    ],
    [
      AUDIFY_STORAGE_KEYS.confirmBeforeTrash,
      String(resolvedFields.confirmBeforeTrash),
    ],
    [
      AUDIFY_STORAGE_KEYS.enableLiveFolderWatch,
      String(resolvedFields.enableLiveFolderWatch),
    ],
    ...aiStoragePairs,
  ];
}

export function scheduleAsyncAutoBackdropAccent(
  resolvedFields: Pick<
    SampleStoreState,
    "accentAuto" | "wallpaperKind" | "customBgImage" | "asciiMagicSlug"
  >,
  preserveLocalAccent: boolean,
  get: StoreGet,
  set: StoreSet
): void {
  const asyncAutoBackdrop =
    resolvedFields.accentAuto && !preserveLocalAccent
      ? resolvedFields.wallpaperKind === "image" &&
        resolvedFields.customBgImage.trim().length > 0
        ? ({ kind: "image", target: resolvedFields.customBgImage } as const)
        : resolvedFields.wallpaperKind === "ascii_magic" &&
          resolvedFields.asciiMagicSlug.trim().length > 0
        ? ({ kind: "ascii_magic", target: resolvedFields.asciiMagicSlug } as const)
        : null
      : null;

  if (!asyncAutoBackdrop) return;

  void import("../utils/autoAccent")
    .then((mod) =>
      asyncAutoBackdrop.kind === "image"
        ? mod.extractDominantImageAccent(asyncAutoBackdrop.target)
        : mod.extractDominantAsciiMagicAccent(asyncAutoBackdrop.target)
    )
    .then((extracted) => {
    if (!extracted) return;
    const live = get();
    if (
      !live.accentAuto ||
      live.wallpaperKind !== asyncAutoBackdrop.kind ||
      (asyncAutoBackdrop.kind === "image"
        ? live.customBgImage !== asyncAutoBackdrop.target
        : live.asciiMagicSlug !== asyncAutoBackdrop.target)
    ) {
      return;
    }
    applyThemeAndAccentToDom(live.themeMode, extracted);
    safeSetItem(AUDIFY_STORAGE_KEYS.accentColor, extracted, {
      broadcast: false,
      markEdited: false,
    });
    set((state: SampleStoreState) => ({
      accentColor: extracted,
      activeProfile: state.activeProfile
        ? { ...state.activeProfile, color: extracted }
        : null,
    }));
  });
}

export function buildProfileSettingsJsonFromStore(get: StoreGet): string {
  const s = get();
  const payload: ProfileSettings = {
    themeMode: s.themeMode,
    accentColor: s.accentColor,
    accentAuto: s.accentAuto,
    waveformSensitivity: s.waveformSensitivity,
    waveformStyle: s.waveformStyle,
    playheadLatencyMs: s.playheadLatencyMs,
    audioOutputDeviceId: s.audioOutputDeviceId,
    sliceMicroFade: s.sliceMicroFade,
    exportAudioPreset: s.exportAudioPreset,
    skipLeadingSilence: s.skipLeadingSilence,
    miniDockEdgePeek: s.miniDockEdgePeek,
    miniDockEdgeSide: s.miniDockEdgeSide,
    normalizePreview: s.normalizePreview,
    autoAnalyzeBpmKey: s.autoAnalyzeBpmKey,
    autoPreview: s.autoPreview,
    isLooping: s.isLooping,
    isShuffle: s.isShuffle,
    volume: s.volume,
    smartSearchSynonyms: s.smartSearchSynonyms,
    autoBinOnNleDrag: s.autoBinOnNleDrag,
    binSampleIds: s.binSampleIds,
    enableMica: s.enableMica,
    sidebarCompactHover: s.sidebarCompactHover,
    themeTintIntensity: s.themeTintIntensity,
    customBgImage: s.customBgImage,
    customBgBlur: s.customBgBlur,
    customBgOpacity: s.customBgOpacity,
    wallpaperKind: s.wallpaperKind,
    asciiPreset: s.asciiPreset,
    asciiMagicSlug: s.asciiMagicSlug,
    asciiMagicLook: s.asciiMagicLook,
    asciiMagicFit: s.asciiMagicFit,
    asciiMotionSpeed: s.asciiMotionSpeed,
    shortcuts: s.shortcuts,
    autoTagRules: s.autoTagRules,
    autoTagCategories: s.autoTagCategories,
    enableLicensesSystem: s.enableLicensesSystem,
    licenseGroups: s.licenseGroups,
    collectionTemplates: s.collectionTemplates,
    autoCreateCollectionSubfolders: s.autoCreateCollectionSubfolders,
    autoRouteCollectionDrops: s.autoRouteCollectionDrops,
    customSliceExportPath: s.customSliceExportPath,
    enableAdvancedFileOps: s.enableAdvancedFileOps,
    confirmBeforeTrash: s.confirmBeforeTrash,
    enableLiveFolderWatch: s.enableLiveFolderWatch,
    aiAutoAnalyzeOnScan: s.aiAutoAnalyzeOnScan,
    aiTagConfidenceThreshold: s.aiTagConfidenceThreshold,
    aiTaggingMode: s.aiTaggingMode,
    aiKnnTagLearning: s.aiKnnTagLearning,
    aiSimilarityMinScore: s.aiSimilarityMinScore,
    aiSimilarityTopK: s.aiSimilarityTopK,
    aiSimilarityScope: s.aiSimilarityScope,
    aiSimilarityDurationMatch: s.aiSimilarityDurationMatch,
  };
  return JSON.stringify(payload);
}
