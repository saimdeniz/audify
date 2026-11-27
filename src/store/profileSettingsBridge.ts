import { DEFAULT_AUTO_TAG_RULES } from "../constants/autoTagRules";
import { DEFAULT_COLLECTION_TEMPLATES } from "../constants/collections";
import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import {
  AsciiMagicFit,
  AsciiMagicLook,
  AsciiPresetId,
  AutoTagRule,
  CollectionRuleTemplate,
  ExportAudioPreset,
  ExportLoudnessMode,
  KeyboardShortcuts,
  LicenseGroup,
  MiniDockEdgeSide,
  Profile,
  ThemeMode,
  WallpaperKind,
  WaveformSensitivity,
  WaveformStyle,
} from "../types";
import {
  getCachedAsciiMagicAutoAccentHex,
  getPresetAutoAccentHex,
} from "../utils/autoAccentCache";
import { resolveAiSettingsFields } from "./aiSettingsBridge";
import {
  buildProfileSettingsJsonFromStore,
  buildProfileStoragePairs,
  resolveAutoTagCategories,
  resolveBool,
  scheduleAsyncAutoBackdropAccent,
} from "./profileSettingsHelpers";
import { preserveRecentLocalProfileFields } from "./remoteSettingsSync";
import {
  ASCII_MAGIC_SLUG_STORAGE_KEY,
  deduplicateTemplates,
  isLocalKeyRecentlyEdited,
  loadSavedAutoCreateCollectionSubfolders,
  loadSavedAutoRouteCollectionDrops,
  loadSavedBinSampleIds,
  loadSavedCollectionTemplates,
  mergeShortcutsWithDefaults,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
  normalizeAsciiMotionSpeed,
  normalizeAsciiPreset,
  normalizeWallpaperKind,
  parseProfileSettings,
  safeSetItem,
} from "./storageHelpers";
import { applyThemeAndAccentToDom, applyVisualEffectsToDom } from "./themeDom";
import type { StoreGet, StoreSet } from "./types";
import { releaseBackdropTransitionCaches } from "../utils/wallpaperCleanup";

export { buildProfileSettingsJsonFromStore };

export function applyProfileSettingsToStore(
  profile: Profile,
  get: StoreGet,
  set: StoreSet,
  opts?: { isInitialBoot?: boolean; isRemoteSync?: boolean }
): void {
  const isBoot = Boolean(opts?.isInitialBoot);
  const isRemoteSync = Boolean(opts?.isRemoteSync);
  const preserveLocal = (storageKey: string) =>
    isRemoteSync && isLocalKeyRecentlyEdited(storageKey);
  const syncStorage = (key: string, value: string) => {
    if (isRemoteSync && isLocalKeyRecentlyEdited(key)) return;
    safeSetItem(key, value, { broadcast: false, markEdited: false });
  };

  const cur = get();
  const parsed = parseProfileSettings(profile.settings_json);

  const themeMode: ThemeMode =
    parsed.themeMode === "light" ||
    parsed.themeMode === "contrast" ||
    parsed.themeMode === "dark"
      ? parsed.themeMode
      : isBoot
      ? cur.themeMode
      : "dark";

  const accentAuto = resolveBool(parsed.accentAuto, isBoot, cur.accentAuto, false);
  let accentColor = profile.color || parsed.accentColor || "#F59E0B";

  const waveformSensitivity: WaveformSensitivity =
    parsed.waveformSensitivity === "linear" ||
    parsed.waveformSensitivity === "high_boost" ||
    parsed.waveformSensitivity === "logarithmic"
      ? parsed.waveformSensitivity
      : isBoot
      ? cur.waveformSensitivity
      : "logarithmic";

  const waveformStyle: WaveformStyle =
    parsed.waveformStyle === "symmetric" || parsed.waveformStyle === "solid_baseline"
      ? parsed.waveformStyle
      : isBoot
      ? cur.waveformStyle
      : "solid_baseline";

  const playheadLatencyMs: number | null =
    parsed.playheadLatencyMs === null
      ? null
      : typeof parsed.playheadLatencyMs === "number" &&
        Number.isFinite(parsed.playheadLatencyMs)
      ? Math.max(-100, Math.min(500, parsed.playheadLatencyMs))
      : isBoot
      ? cur.playheadLatencyMs
      : null;

  const audioOutputDeviceId =
    typeof parsed.audioOutputDeviceId === "string" && parsed.audioOutputDeviceId.length > 0
      ? parsed.audioOutputDeviceId
      : isBoot
      ? cur.audioOutputDeviceId
      : "default";

  const autoPreview = resolveBool(parsed.autoPreview, isBoot, cur.autoPreview, true);
  const isLooping = resolveBool(parsed.isLooping, isBoot, cur.isLooping, false);
  const isShuffle = resolveBool(parsed.isShuffle, isBoot, cur.isShuffle, false);
  const volume =
    typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
      ? Math.max(0, Math.min(1, parsed.volume))
      : isBoot
      ? cur.volume
      : 0.9;

  const smartSearchSynonyms = resolveBool(
    parsed.smartSearchSynonyms,
    isBoot,
    cur.smartSearchSynonyms,
    true
  );
  const autoBinOnNleDrag = resolveBool(
    parsed.autoBinOnNleDrag,
    isBoot,
    cur.autoBinOnNleDrag,
    false
  );
  const binSampleIds: number[] = Array.isArray(parsed.binSampleIds)
    ? parsed.binSampleIds.filter((id): id is number => typeof id === "number")
    : isBoot
    ? loadSavedBinSampleIds()
    : [];

  const enableMica = resolveBool(parsed.enableMica, isBoot, cur.enableMica, false);
  const sidebarCompactHover = resolveBool(
    parsed.sidebarCompactHover,
    isBoot,
    cur.sidebarCompactHover,
    false
  );
  const themeTintIntensity =
    typeof parsed.themeTintIntensity === "number" &&
    Number.isFinite(parsed.themeTintIntensity)
      ? Math.max(0, Math.min(1, parsed.themeTintIntensity))
      : isBoot
      ? cur.themeTintIntensity
      : 0;

  const customBgImage =
    typeof parsed.customBgImage === "string"
      ? parsed.customBgImage
      : isBoot
      ? cur.customBgImage
      : "";
  const customBgBlur =
    typeof parsed.customBgBlur === "number" && Number.isFinite(parsed.customBgBlur)
      ? Math.max(0, Math.min(48, Math.round(parsed.customBgBlur)))
      : isBoot
      ? cur.customBgBlur
      : 16;
  const customBgOpacity =
    typeof parsed.customBgOpacity === "number" && Number.isFinite(parsed.customBgOpacity)
      ? Math.max(0, Math.min(1, parsed.customBgOpacity))
      : isBoot
      ? cur.customBgOpacity
      : 0.22;

  const wallpaperKind: WallpaperKind =
    parsed.wallpaperKind !== undefined
      ? normalizeWallpaperKind(parsed.wallpaperKind, customBgImage)
      : isBoot && parsed.customBgImage === undefined
      ? cur.wallpaperKind
      : normalizeWallpaperKind(undefined, customBgImage);

  const asciiPreset: AsciiPresetId =
    parsed.asciiPreset !== undefined
      ? normalizeAsciiPreset(parsed.asciiPreset)
      : isBoot
      ? cur.asciiPreset
      : "moonlit";

  const asciiMagicSlug: string =
    parsed.asciiMagicSlug !== undefined
      ? normalizeAsciiMagicSlug(parsed.asciiMagicSlug)
      : isBoot
      ? cur.asciiMagicSlug
      : "";

  const asciiMagicLook: AsciiMagicLook =
    parsed.asciiMagicLook !== undefined
      ? normalizeAsciiMagicLook(parsed.asciiMagicLook)
      : isBoot
      ? cur.asciiMagicLook
      : "original";

  const asciiMagicFit: AsciiMagicFit =
    parsed.asciiMagicFit !== undefined
      ? normalizeAsciiMagicFit(parsed.asciiMagicFit)
      : isBoot
      ? cur.asciiMagicFit
      : "contain";

  const effectiveWallpaperKindForAuto = preserveLocal(
    AUDIFY_STORAGE_KEYS.wallpaperKind
  )
    ? cur.wallpaperKind
    : wallpaperKind;
  const effectiveAsciiPresetForAuto = preserveLocal(
    AUDIFY_STORAGE_KEYS.asciiPreset
  )
    ? cur.asciiPreset
    : asciiPreset;
  const effectiveMagicSlugForAuto = preserveLocal(ASCII_MAGIC_SLUG_STORAGE_KEY)
    ? cur.asciiMagicSlug
    : asciiMagicSlug;
  const effectiveAccentAuto = preserveLocal(AUDIFY_STORAGE_KEYS.accentAuto)
    ? cur.accentAuto
    : accentAuto;

  if (
    effectiveAccentAuto &&
    !preserveLocal(AUDIFY_STORAGE_KEYS.accentColor)
  ) {
    const syncAuto =
      effectiveWallpaperKindForAuto === "ascii_preset"
        ? getPresetAutoAccentHex(effectiveAsciiPresetForAuto)
        : effectiveWallpaperKindForAuto === "ascii_magic" &&
          effectiveMagicSlugForAuto
        ? getCachedAsciiMagicAutoAccentHex(effectiveMagicSlugForAuto)
        : null;
    if (syncAuto) {
      accentColor = syncAuto;
    }
  }

  const asciiMotionSpeed =
    typeof parsed.asciiMotionSpeed === "number" && Number.isFinite(parsed.asciiMotionSpeed)
      ? normalizeAsciiMotionSpeed(parsed.asciiMotionSpeed)
      : isBoot
      ? cur.asciiMotionSpeed
      : 1;

  const shortcuts: KeyboardShortcuts = parsed.shortcuts
    ? mergeShortcutsWithDefaults(parsed.shortcuts)
    : isBoot
    ? mergeShortcutsWithDefaults(cur.shortcuts)
    : { ...DEFAULT_SHORTCUTS };

  // Respect intentionally empty `[]` arrays when user clears all rules/categories/templates
  const autoTagRules: AutoTagRule[] = Array.isArray(parsed.autoTagRules)
    ? parsed.autoTagRules
    : [...DEFAULT_AUTO_TAG_RULES];
  const autoTagCategories = resolveAutoTagCategories(parsed.autoTagCategories, autoTagRules);

  const enableLicensesSystem = resolveBool(
    parsed.enableLicensesSystem,
    isBoot,
    cur.enableLicensesSystem,
    false
  );
  const licenseGroups: LicenseGroup[] = Array.isArray(parsed.licenseGroups)
    ? parsed.licenseGroups
    : isBoot
    ? cur.licenseGroups
    : [];

  const collectionTemplates: CollectionRuleTemplate[] = Array.isArray(parsed.collectionTemplates)
    ? deduplicateTemplates(parsed.collectionTemplates)
    : isBoot
    ? loadSavedCollectionTemplates()
    : [...DEFAULT_COLLECTION_TEMPLATES];

  const autoCreateCollectionSubfolders =
    typeof parsed.autoCreateCollectionSubfolders === "boolean"
      ? parsed.autoCreateCollectionSubfolders
      : isBoot
      ? loadSavedAutoCreateCollectionSubfolders()
      : false;
  const autoRouteCollectionDrops =
    typeof parsed.autoRouteCollectionDrops === "boolean"
      ? parsed.autoRouteCollectionDrops
      : isBoot
      ? loadSavedAutoRouteCollectionDrops()
      : true;

  const customSliceExportPath =
    typeof parsed.customSliceExportPath === "string"
      ? parsed.customSliceExportPath
      : isBoot
      ? cur.customSliceExportPath
      : "";
  const customLayerExportPath =
    typeof parsed.customLayerExportPath === "string"
      ? parsed.customLayerExportPath
      : isBoot
      ? cur.customLayerExportPath
      : "";
  const autoSaveLayerOnNleDrag = resolveBool(
    parsed.autoSaveLayerOnNleDrag,
    isBoot,
    cur.autoSaveLayerOnNleDrag,
    false
  );

  const sliceMicroFade = resolveBool(parsed.sliceMicroFade, isBoot, cur.sliceMicroFade, false);
  const exportAudioPreset: ExportAudioPreset =
    parsed.exportAudioPreset === "wav_24" ||
    parsed.exportAudioPreset === "nle_48k_24" ||
    parsed.exportAudioPreset === "original"
      ? parsed.exportAudioPreset
      : isBoot
      ? cur.exportAudioPreset
      : "original";
  const exportLoudnessMode: ExportLoudnessMode =
    parsed.exportLoudnessMode === "peak_m1" ||
    parsed.exportLoudnessMode === "lufs_m14" ||
    parsed.exportLoudnessMode === "lufs_m24" ||
    parsed.exportLoudnessMode === "off"
      ? parsed.exportLoudnessMode
      : isBoot
      ? cur.exportLoudnessMode
      : "off";
  const skipLeadingSilence = resolveBool(
    parsed.skipLeadingSilence,
    isBoot,
    cur.skipLeadingSilence,
    false
  );
  const miniDockEdgePeek = resolveBool(
    parsed.miniDockEdgePeek,
    isBoot,
    cur.miniDockEdgePeek,
    false
  );
  const miniDockEdgeSide: MiniDockEdgeSide =
    parsed.miniDockEdgeSide === "left" || parsed.miniDockEdgeSide === "right"
      ? parsed.miniDockEdgeSide
      : isBoot
      ? cur.miniDockEdgeSide
      : "right";
  const normalizePreview = resolveBool(
    parsed.normalizePreview,
    isBoot,
    cur.normalizePreview,
    false
  );
  const autoAnalyzeBpmKey = resolveBool(
    parsed.autoAnalyzeBpmKey,
    isBoot,
    cur.autoAnalyzeBpmKey,
    false
  );
  const enableAdvancedFileOps = resolveBool(
    parsed.enableAdvancedFileOps,
    isBoot,
    cur.enableAdvancedFileOps,
    false
  );
  const confirmBeforeTrash = resolveBool(
    parsed.confirmBeforeTrash,
    isBoot,
    cur.confirmBeforeTrash,
    true
  );
  const enableLiveFolderWatch = resolveBool(
    parsed.enableLiveFolderWatch,
    isBoot,
    cur.enableLiveFolderWatch,
    true
  );
  const aiResolved = resolveAiSettingsFields(parsed, isBoot, cur);

  const candidateFields = {
    themeMode,
    accentColor,
    accentAuto,
    waveformSensitivity,
    waveformStyle,
    playheadLatencyMs,
    audioOutputDeviceId,
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
    autoPreview,
    isLooping,
    isShuffle,
    volume,
    preMuteVolume: volume > 0.02 ? volume : cur.preMuteVolume,
    smartSearchSynonyms,
    autoBinOnNleDrag,
    binSampleIds,
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
    shortcuts,
    enableLicensesSystem,
    licenseGroups,
    collectionTemplates,
    autoCreateCollectionSubfolders,
    autoRouteCollectionDrops,
    customSliceExportPath,
    customLayerExportPath,
    autoSaveLayerOnNleDrag,
    ...aiResolved.fields,
  };

  const resolvedFields = isRemoteSync
    ? preserveRecentLocalProfileFields(cur, candidateFields)
    : candidateFields;

  const storagePairs = buildProfileStoragePairs(
    resolvedFields,
    aiResolved.storagePairs
  );
  for (const [key, value] of storagePairs) {
    syncStorage(key, value);
  }

  applyThemeAndAccentToDom(resolvedFields.themeMode, resolvedFields.accentColor);
  applyVisualEffectsToDom(
    resolvedFields.enableMica,
    resolvedFields.themeTintIntensity
  );

  const preserveDirtyRules = isRemoteSync && cur.autoTagRulesDirty;

  set({
    activeProfile: { ...profile, color: resolvedFields.accentColor },
    ...resolvedFields,
    autoTagRules: preserveDirtyRules ? cur.autoTagRules : autoTagRules,
    autoTagCategories: preserveDirtyRules
      ? cur.autoTagCategories
      : autoTagCategories,
    autoTagRulesDirty: preserveDirtyRules ? true : false,
  });

  if (resolvedFields.wallpaperKind !== cur.wallpaperKind) {
    releaseBackdropTransitionCaches(
      cur.wallpaperKind,
      resolvedFields.wallpaperKind
    );
  }

  scheduleAsyncAutoBackdropAccent(
    resolvedFields,
    preserveLocal(AUDIFY_STORAGE_KEYS.accentColor),
    get,
    set
  );
}
