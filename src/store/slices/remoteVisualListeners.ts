import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import type { ThemeMode, WallpaperKind } from "../../types";
import { releaseBackdropTransitionCaches } from "../../utils/wallpaperCleanup";
import { preserveRecentLocalProfileFields } from "../remoteSettingsSync";
import {
  isLocalKeyRecentlyEdited,
  isStandaloneSettingsWindow,
  loadBootSettings,
  loadSavedAutoCreateCollectionSubfolders,
  loadSavedAutoRouteCollectionDrops,
  loadSavedBinSampleIds,
  loadSavedCollectionTemplates,
  loadSavedLicenseGroups,
  loadSavedSettingsTab,
  loadSavedShortcuts,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
  normalizeAsciiMotionSpeed,
  normalizeAsciiPreset,
  normalizeWallpaperKind,
} from "../storageHelpers";
import { applyThemeAndAccentToDom, applyVisualEffectsToDom } from "../themeDom";
import type { StoreGet, StoreSet } from "../types";

function areJsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function applyRemoteSettingsFromStorage(get: StoreGet, set: StoreSet): void {
  const snap = loadBootSettings();
  const candidate = {
    themeMode: snap.themeMode,
    accentColor: snap.accentColor,
    accentAuto: snap.accentAuto,
    waveformSensitivity: snap.waveformSensitivity,
    waveformStyle: snap.waveformStyle,
    playheadLatencyMs: snap.playheadLatencyMs,
    audioOutputDeviceId: snap.audioOutputDeviceId,
    enableMica: snap.enableMica,
    sidebarCompactHover: snap.sidebarCompactHover,
    themeTintIntensity: snap.themeTintIntensity,
    customBgImage: snap.customBgImage,
    customBgBlur: snap.customBgBlur,
    customBgOpacity: snap.customBgOpacity,
    wallpaperKind: snap.wallpaperKind,
    asciiPreset: snap.asciiPreset,
    asciiMagicSlug: snap.asciiMagicSlug,
    asciiMagicLook: snap.asciiMagicLook,
    asciiMagicFit: snap.asciiMagicFit,
    asciiMotionSpeed: snap.asciiMotionSpeed,
    enableLicensesSystem: snap.enableLicenses,
    autoBinOnNleDrag: snap.autoBinOnNleDrag,
    customSliceExportPath: snap.customSliceExportPath,
    customLayerExportPath: snap.customLayerExportPath,
    autoSaveLayerOnNleDrag: snap.autoSaveLayerOnNleDrag,
    smartSearchSynonyms: snap.smartSearchSynonyms,
    autoPreview: snap.autoPreview,
    isLooping: snap.isLooping,
    isShuffle: snap.isShuffle,
    volume: snap.volume,
    sliceMicroFade: snap.sliceMicroFade,
    exportAudioPreset: snap.exportAudioPreset,
    exportLoudnessMode: snap.exportLoudnessMode,
    skipLeadingSilence: snap.skipLeadingSilence,
    miniDockEdgePeek: snap.miniDockEdgePeek,
    miniDockEdgeSide: snap.miniDockEdgeSide,
    normalizePreview: snap.normalizePreview,
    autoAnalyzeBpmKey: snap.autoAnalyzeBpmKey,
    enableAdvancedFileOps: snap.enableAdvancedFileOps,
    confirmBeforeTrash: snap.confirmBeforeTrash,
    enableLiveFolderWatch: snap.enableLiveFolderWatch,
    aiAutoAnalyzeOnScan: snap.aiAutoAnalyzeOnScan,
    aiTagConfidenceThreshold: snap.aiTagConfidenceThreshold,
    aiTaggingMode: snap.aiTaggingMode,
    aiKnnTagLearning: snap.aiKnnTagLearning,
    aiSimilarityMinScore: snap.aiSimilarityMinScore,
    aiSimilarityTopK: snap.aiSimilarityTopK,
    aiSimilarityScope: snap.aiSimilarityScope,
    aiSimilarityDurationMatch: snap.aiSimilarityDurationMatch,
    shortcuts: loadSavedShortcuts(),
    licenseGroups: loadSavedLicenseGroups(),
    collectionTemplates: loadSavedCollectionTemplates(),
    autoCreateCollectionSubfolders: loadSavedAutoCreateCollectionSubfolders(),
    autoRouteCollectionDrops: loadSavedAutoRouteCollectionDrops(),
    binSampleIds: loadSavedBinSampleIds(),
  };

  const currentBefore = get();
  const initialProtected = preserveRecentLocalProfileFields(
    currentBefore,
    candidate
  );
  if (
    initialProtected.themeMode !== currentBefore.themeMode ||
    initialProtected.accentColor !== currentBefore.accentColor
  ) {
    applyThemeAndAccentToDom(
      initialProtected.themeMode,
      initialProtected.accentColor
    );
  }
  if (
    initialProtected.enableMica !== currentBefore.enableMica ||
    initialProtected.themeTintIntensity !== currentBefore.themeTintIntensity
  ) {
    applyVisualEffectsToDom(
      initialProtected.enableMica,
      initialProtected.themeTintIntensity
    );
  }

  const prevKind = currentBefore.wallpaperKind;
  let nextKind: WallpaperKind = prevKind;
  set((state) => {
    const protectedPatch = preserveRecentLocalProfileFields(state, candidate);
    nextKind = protectedPatch.wallpaperKind;

    const diff: Record<string, unknown> = {};
    for (const [key, nextVal] of Object.entries(protectedPatch)) {
      const prevVal = (state as unknown as Record<string, unknown>)[key];
      if (!areJsonEqual(prevVal, nextVal)) {
        diff[key] = nextVal;
      }
    }

    if (!isStandaloneSettingsWindow()) {
      const nextTab = loadSavedSettingsTab();
      if (nextTab !== state.settingsTab) {
        diff.settingsTab = nextTab;
      }
    }

    if (
      state.activeProfile &&
      state.activeProfile.color !== protectedPatch.accentColor
    ) {
      diff.activeProfile = {
        ...state.activeProfile,
        color: protectedPatch.accentColor,
      };
    }

    if (Object.keys(diff).length === 0) {
      return state;
    }
    return diff;
  });
  if (nextKind !== prevKind || nextKind === "none") {
    releaseBackdropTransitionCaches(prevKind, nextKind);
  }
}

export function applyLiveVisualPatch(
  set: StoreSet,
  p: Record<string, unknown>
): void {
  let prevKind: WallpaperKind | null = null;
  let resolvedNextKind: WallpaperKind | null = null;
  const isProtected = (key: string): boolean => isLocalKeyRecentlyEdited(key);
  set((state) => {
    prevKind = state.wallpaperKind;
    const nextTheme: ThemeMode =
      !isProtected(AUDIFY_STORAGE_KEYS.themeMode) &&
      (p.themeMode === "light" ||
        p.themeMode === "contrast" ||
        p.themeMode === "dark")
        ? p.themeMode
        : state.themeMode;
    const nextMica =
      !isProtected(AUDIFY_STORAGE_KEYS.enableMica) &&
      typeof p.enableMica === "boolean"
        ? p.enableMica
        : state.enableMica;
    const nextTint =
      !isProtected(AUDIFY_STORAGE_KEYS.themeTintIntensity) &&
      typeof p.themeTintIntensity === "number"
        ? p.themeTintIntensity
        : state.themeTintIntensity;
    const nextAccent =
      !isProtected(AUDIFY_STORAGE_KEYS.accentColor) &&
      typeof p.accentColor === "string"
        ? p.accentColor
        : state.accentColor;
    const nextAccentAuto =
      !isProtected(AUDIFY_STORAGE_KEYS.accentAuto) &&
      typeof p.accentAuto === "boolean"
        ? p.accentAuto
        : state.accentAuto;

    if (nextTheme !== state.themeMode || nextAccent !== state.accentColor) {
      applyThemeAndAccentToDom(nextTheme, nextAccent);
    }
    if (nextMica !== state.enableMica || nextTint !== state.themeTintIntensity) {
      applyVisualEffectsToDom(nextMica, nextTint);
    }

    const nextBgImage =
      !isProtected(AUDIFY_STORAGE_KEYS.customBgImage) &&
      typeof p.customBgImage === "string"
        ? p.customBgImage
        : state.customBgImage;
    const nextWallpaperKind =
      !isProtected(AUDIFY_STORAGE_KEYS.wallpaperKind) &&
      p.wallpaperKind !== undefined
        ? normalizeWallpaperKind(p.wallpaperKind, nextBgImage)
        : undefined;
    resolvedNextKind = nextWallpaperKind ?? state.wallpaperKind;

    return {
      ...(!isProtected(AUDIFY_STORAGE_KEYS.themeMode) &&
      typeof p.themeMode === "string"
        ? { themeMode: nextTheme }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.enableMica) &&
      typeof p.enableMica === "boolean"
        ? { enableMica: p.enableMica }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.themeTintIntensity) &&
      typeof p.themeTintIntensity === "number"
        ? { themeTintIntensity: p.themeTintIntensity }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.accentAuto) &&
      typeof p.accentAuto === "boolean"
        ? { accentAuto: nextAccentAuto }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.accentColor) &&
      typeof p.accentColor === "string"
        ? {
            accentColor: nextAccent,
            activeProfile: state.activeProfile
              ? { ...state.activeProfile, color: nextAccent }
              : null,
            profiles: state.profiles.map((prof) =>
              state.activeProfile && prof.id === state.activeProfile.id
                ? { ...prof, color: nextAccent }
                : prof
            ),
          }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.customBgImage) &&
      typeof p.customBgImage === "string"
        ? { customBgImage: p.customBgImage }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.customBgBlur) &&
      typeof p.customBgBlur === "number"
        ? { customBgBlur: p.customBgBlur }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.customBgOpacity) &&
      typeof p.customBgOpacity === "number"
        ? { customBgOpacity: p.customBgOpacity }
        : {}),
      ...(nextWallpaperKind !== undefined
        ? { wallpaperKind: nextWallpaperKind }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiPreset) &&
      p.asciiPreset !== undefined
        ? { asciiPreset: normalizeAsciiPreset(p.asciiPreset) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMagicSlug) &&
      p.asciiMagicSlug !== undefined
        ? { asciiMagicSlug: normalizeAsciiMagicSlug(p.asciiMagicSlug) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMagicLook) &&
      p.asciiMagicLook !== undefined
        ? { asciiMagicLook: normalizeAsciiMagicLook(p.asciiMagicLook) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMagicFit) &&
      p.asciiMagicFit !== undefined
        ? { asciiMagicFit: normalizeAsciiMagicFit(p.asciiMagicFit) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMotionSpeed) &&
      typeof p.asciiMotionSpeed === "number"
        ? { asciiMotionSpeed: normalizeAsciiMotionSpeed(p.asciiMotionSpeed) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.volume) && typeof p.volume === "number"
        ? { volume: p.volume }
        : {}),
    };
  });
  if (
    prevKind !== null &&
    resolvedNextKind !== null &&
    (resolvedNextKind !== prevKind || p.wallpaperKind === "none")
  ) {
    releaseBackdropTransitionCaches(prevKind, resolvedNextKind);
  }
}
