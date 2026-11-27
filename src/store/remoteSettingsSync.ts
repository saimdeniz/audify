import { AI_STORAGE_KEYS } from "../constants/aiConfig";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import { isLocalKeyRecentlyEdited } from "./localStorageSafe";
import type { SampleStoreState } from "./types";

export const PROFILE_FIELD_STORAGE_KEYS = {
  themeMode: AUDIFY_STORAGE_KEYS.themeMode,
  accentColor: AUDIFY_STORAGE_KEYS.accentColor,
  accentAuto: AUDIFY_STORAGE_KEYS.accentAuto,
  waveformSensitivity: AUDIFY_STORAGE_KEYS.waveformSensitivity,
  waveformStyle: AUDIFY_STORAGE_KEYS.waveformStyle,
  playheadLatencyMs: AUDIFY_STORAGE_KEYS.playheadLatencyMs,
  audioOutputDeviceId: AUDIFY_STORAGE_KEYS.audioOutputDeviceId,
  sliceMicroFade: AUDIFY_STORAGE_KEYS.sliceMicroFade,
  exportAudioPreset: AUDIFY_STORAGE_KEYS.exportAudioPreset,
  exportLoudnessMode: AUDIFY_STORAGE_KEYS.exportLoudnessMode,
  skipLeadingSilence: AUDIFY_STORAGE_KEYS.skipLeadingSilence,
  miniDockEdgePeek: AUDIFY_STORAGE_KEYS.miniDockEdgePeek,
  miniDockEdgeSide: AUDIFY_STORAGE_KEYS.miniDockEdgeSide,
  normalizePreview: AUDIFY_STORAGE_KEYS.normalizePreview,
  autoAnalyzeBpmKey: AUDIFY_STORAGE_KEYS.autoAnalyzeBpmKey,
  enableAdvancedFileOps: AUDIFY_STORAGE_KEYS.enableAdvancedFileOps,
  confirmBeforeTrash: AUDIFY_STORAGE_KEYS.confirmBeforeTrash,
  enableLiveFolderWatch: AUDIFY_STORAGE_KEYS.enableLiveFolderWatch,
  autoPreview: AUDIFY_STORAGE_KEYS.autoPreview,
  isLooping: AUDIFY_STORAGE_KEYS.isLooping,
  isShuffle: AUDIFY_STORAGE_KEYS.isShuffle,
  volume: AUDIFY_STORAGE_KEYS.volume,
  smartSearchSynonyms: AUDIFY_STORAGE_KEYS.smartSearchSynonyms,
  autoBinOnNleDrag: AUDIFY_STORAGE_KEYS.autoBinOnNleDrag,
  binSampleIds: AUDIFY_STORAGE_KEYS.binSampleIds,
  enableMica: AUDIFY_STORAGE_KEYS.enableMica,
  sidebarCompactHover: AUDIFY_STORAGE_KEYS.sidebarCompactHover,
  themeTintIntensity: AUDIFY_STORAGE_KEYS.themeTintIntensity,
  customBgImage: AUDIFY_STORAGE_KEYS.customBgImage,
  customBgBlur: AUDIFY_STORAGE_KEYS.customBgBlur,
  customBgOpacity: AUDIFY_STORAGE_KEYS.customBgOpacity,
  wallpaperKind: AUDIFY_STORAGE_KEYS.wallpaperKind,
  asciiPreset: AUDIFY_STORAGE_KEYS.asciiPreset,
  asciiMagicSlug: AUDIFY_STORAGE_KEYS.asciiMagicSlug,
  asciiMagicLook: AUDIFY_STORAGE_KEYS.asciiMagicLook,
  asciiMagicFit: AUDIFY_STORAGE_KEYS.asciiMagicFit,
  asciiMotionSpeed: AUDIFY_STORAGE_KEYS.asciiMotionSpeed,
  shortcuts: AUDIFY_STORAGE_KEYS.shortcuts,
  enableLicensesSystem: AUDIFY_STORAGE_KEYS.enableLicenses,
  licenseGroups: AUDIFY_STORAGE_KEYS.licenseGroups,
  collectionTemplates: AUDIFY_STORAGE_KEYS.collectionTemplates,
  autoCreateCollectionSubfolders: AUDIFY_STORAGE_KEYS.autoCreateSubfolders,
  autoRouteCollectionDrops: AUDIFY_STORAGE_KEYS.autoRouteCollectionDrops,
  customSliceExportPath: AUDIFY_STORAGE_KEYS.customSliceExportPath,
  customLayerExportPath: AUDIFY_STORAGE_KEYS.customLayerExportPath,
  autoSaveLayerOnNleDrag: AUDIFY_STORAGE_KEYS.autoSaveLayerOnNleDrag,
  layerTopDeckView: AUDIFY_STORAGE_KEYS.layerTopDeckView,
  aiAutoAnalyzeOnScan: AI_STORAGE_KEYS.autoAnalyzeOnScan,
  aiTagConfidenceThreshold: AI_STORAGE_KEYS.tagConfidenceThreshold,
  aiTaggingMode: AI_STORAGE_KEYS.taggingMode,
  aiKnnTagLearning: AI_STORAGE_KEYS.knnTagLearning,
  aiSimilarityMinScore: AI_STORAGE_KEYS.similarityMinScore,
  aiSimilarityTopK: AI_STORAGE_KEYS.similarityTopK,
  aiSimilarityScope: AI_STORAGE_KEYS.similarityScope,
  aiSimilarityDurationMatch: AI_STORAGE_KEYS.similarityDurationMatch,
} as const;

type GuardableProfileField = keyof typeof PROFILE_FIELD_STORAGE_KEYS;

/**
 * Protects ALL profile-backed settings keys edited locally within the debounce window
 * from reverting during concurrent remote `settings`, `storage`, or `profile` syncs.
 */
export function preserveRecentLocalProfileFields<
  T extends Partial<SampleStoreState>,
>(currentState: SampleStoreState, candidate: T): T {
  const out = { ...candidate };
  const recordOut = out as unknown as Record<string, unknown>;
  const recordCurrent = currentState as unknown as Record<string, unknown>;

  for (const field of Object.keys(
    PROFILE_FIELD_STORAGE_KEYS
  ) as GuardableProfileField[]) {
    if (!(field in candidate)) continue;
    const storageKey = PROFILE_FIELD_STORAGE_KEYS[field];
    if (isLocalKeyRecentlyEdited(storageKey)) {
      recordOut[field] = recordCurrent[field];
      if (field === "volume" && "preMuteVolume" in candidate) {
        recordOut.preMuteVolume = currentState.preMuteVolume;
      }
    }
  }

  return out;
}
