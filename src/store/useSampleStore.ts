import { create } from "zustand";
import { DEFAULT_AUTO_TAG_RULES } from "../constants/autoTagRules";
import { Profile, SampleItem } from "../types";
import { computeSmartCollectionCounts } from "../utils/smartCollectionCounts";
import { clearSmartSearchCache, executeSmartSearch } from "../utils/smartSearch";
import {
  shouldUseCatalogWorker,
  syncCatalogWorkerPool,
} from "../workers/catalogWorkerClient";
import {
  bumpMemoryFilterSeq,
  dispatchWorkerInstantMemoryFilter,
  scheduleWorkerSmartCollectionCounts,
} from "./workerBridge";
import {
  applyClientFacetFilters,
  filterBaseSamplesInMemory,
  reconcileSelectionAfterFilter,
} from "./filterEngine";
import {
  applyProfileSettingsToStore,
  buildProfileSettingsJsonFromStore,
} from "./profileSettingsBridge";
import { createAiSlice, invalidateAiSliceAsyncState } from "./slices/aiSlice";
import { createCatalogMutationSlice } from "./slices/catalogMutationSlice";
import { createCatalogSyncSlice } from "./slices/catalogSyncSlice";
import {
  buildDuplicateOrderMap,
  createDuplicateSlice,
} from "./slices/duplicateSlice";
import { createFileOpsSlice } from "./slices/fileOpsSlice";
import { createFilterSlice } from "./slices/filterSlice";
import { createLibrarySyncSlice } from "./slices/librarySyncSlice";
import { createPlaybackSlice } from "./slices/playbackSlice";
import { createProfileSlice } from "./slices/profileSlice";
import {
  createSettingsAndBinSlice,
  SettingsSliceTimers,
} from "./slices/settingsAndBinSlice";
import { createSliceHistorySlice } from "./slices/sliceHistorySlice";
import {
  AUDIFY_STORAGE_KEYS,
  loadBootSettings,
  loadSavedActiveFolder,
  loadSavedActiveLicenseGroupId,
  loadSavedAutoCreateCollectionSubfolders,
  loadSavedAutoRouteCollectionDrops,
  loadSavedBinSampleIds,
  loadSavedCollectionId,
  loadSavedCollectionTemplates,
  loadSavedFavoriteOnly,
  loadSavedFolderStats,
  loadSavedLicenseGroups,
  loadSavedRecentSampleIds,
  loadSavedSettingsTab,
  loadSavedShortcuts,
  loadSavedSort,
  loadSavedTrashStatus,
  persistNavigationFilters,
  safeGetItem,
} from "./storageHelpers";
import {
  CreditToastPayload,
  SampleStoreState,
  SettingsTab,
  StatusNoticePayload,
  StoreSliceContext,
} from "./types";

export type {
  CreditToastPayload,
  SampleStoreState,
  SettingsTab,
  StatusNoticePayload,
};

const EMPTY_SAMPLE_ID_SET: ReadonlySet<number> = new Set();

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let noticeDismissTimer: ReturnType<typeof setTimeout> | null = null;
let currentFetchSeq = 0;
let currentProfileEpoch = 0;

function clearSearchDebounceTimer(): void {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

export const useSampleStore = create<SampleStoreState>((rawSet, get, api) => {
  const computePatchedState = (
    state: SampleStoreState,
    partial:
      | Partial<SampleStoreState>
      | ((s: SampleStoreState) => Partial<SampleStoreState> | SampleStoreState)
  ): Partial<SampleStoreState> | SampleStoreState => {
    const patch = typeof partial === "function" ? partial(state) : partial;
    if (
      patch &&
      typeof patch === "object" &&
      ("allProfileSamples" in patch ||
        "collections" in patch ||
        "smartSearchSynonyms" in patch) &&
      !("smartCollectionCounts" in patch)
    ) {
      const nextPool = patch.allProfileSamples ?? state.allProfileSamples;
      const nextCollections = patch.collections ?? state.collections;
      const nextSynonyms =
        patch.smartSearchSynonyms ?? state.smartSearchSynonyms;
      if ("allProfileSamples" in patch && shouldUseCatalogWorker(nextPool.length)) {
        syncCatalogWorkerPool(nextPool);
      }
      const hasSmartCollections = nextCollections.some((c) =>
        Boolean(c.smart_query?.trim())
      );
      if (hasSmartCollections) {
        if (shouldUseCatalogWorker(nextPool.length)) {
          scheduleWorkerSmartCollectionCounts(
            nextPool,
            get,
            (countsPatch) => rawSet(countsPatch)
          );
          return patch;
        }
        return {
          ...patch,
          smartCollectionCounts: computeSmartCollectionCounts(
            nextPool,
            nextCollections,
            nextSynonyms
          ),
        };
      }
      if (Object.keys(state.smartCollectionCounts).length > 0) {
        return {
          ...patch,
          smartCollectionCounts: {},
        };
      }
    }
    return patch;
  };

  const set: typeof rawSet = (partial, replace) => {
    if (replace) {
      rawSet(
        (state) => computePatchedState(state, partial) as SampleStoreState,
        true
      );
      return;
    }
    rawSet((state) => computePatchedState(state, partial));
  };
  api.setState = set;

  const boot = loadBootSettings();
  const initialSort = loadSavedSort();
  const initialTrashStatus = loadSavedTrashStatus();
  const settingsTimers: SettingsSliceTimers = {
    flushPendingTint: () => {},
    clearToastTimers: () => {},
  };

  const emitNotice = (
    message: string,
    kind: "info" | "success" | "error" = "info"
  ) => {
    if (noticeDismissTimer !== null) {
      clearTimeout(noticeDismissTimer);
      noticeDismissTimer = null;
    }
    const seq = (get().statusNotice?.seq || 0) + 1;
    set({
      statusMessage: message,
      statusNotice: { message, kind, seq },
    });
    noticeDismissTimer = setTimeout(() => {
      noticeDismissTimer = null;
      if (get().statusNotice?.seq === seq) {
        set({ statusNotice: null });
      }
    }, 4200);
  };

  const prepareForProfileTransition = async () => {
    clearSearchDebounceTimer();
    settingsTimers.flushPendingTint();
  };

  const resetFiltersOnProfileChange = (statusMessage: string) => {
    clearSearchDebounceTimer();
    persistNavigationFilters(null, null, false, null);
    clearSmartSearchCache();
    const prevSim = get().similaritySession;
    set({
      allProfileSamples: [],
      trashedProfileSamples: [],
      favoritesCount: 0,
      knownSampleIds: EMPTY_SAMPLE_ID_SET,
      searchQuery: "",
      folderFilter: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      binFilterActive: false,
      trashFilterActive: false,
      trashOpStatus: null,
      duplicatesFilterActive: false,
      slicesFilterActive: false,
      sliceHistory: [],
      trashedSliceHistory: [],
      isLoadingSliceHistory: false,
      sliceFavoriteOnly: false,
      slicePitchOnly: false,
      selectedSliceIds: [],
      activeSliceId: null,
      lastSelectedSliceIndex: null,
      batchRenameSliceIds: null,
      sliceOpUndoStack: [],
      sliceOpRedoStack: [],
      trashedSliceCount: 0,
      trashedSliceTotalBytes: 0,
      trashViewTab: "tracks",
      isScanningDuplicates: false,
      duplicateScanProgress: null,
      duplicateScanResult: null,
      duplicateScanCache: {},
      duplicateScanError: null,
      favoriteOnly: false,
      recentOnly: false,
      selectedTagIds: [],
      selectedGenre: null,
      selectedSampleIds: [],
      lastSelectedIndex: null,
      similaritySession: null,
      ...(prevSim
        ? {
            sortKey:
              prevSim.prevSortKey === "match" ? null : prevSim.prevSortKey,
            sortDir: prevSim.prevSortDir,
          }
        : {}),
      statusMessage,
    });
  };

  const applyProfileSettingsImmediately = (
    profile: Profile,
    opts?: { isInitialBoot?: boolean; isRemoteSync?: boolean }
  ) => {
    applyProfileSettingsToStore(profile, get, set, opts);
  };

  const buildCurrentProfileSettingsJson = (): string =>
    buildProfileSettingsJsonFromStore(get);

  const applyInstantMemoryFilter = (opts?: {
    preserveMultiSelect?: boolean;
  }): boolean => {
    const {
      allProfileSamples,
      searchQuery,
      smartSearchSynonyms,
      folderFilter,
      favoriteOnly,
      recentOnly,
      recentSampleIds,
      selectedTagIds,
      selectedGenre,
      collections,
      selectedCollectionId,
      selectedLicenseGroupId,
      licenseGroups,
      binFilterActive,
      binSampleIds,
      trashFilterActive,
      duplicatesFilterActive,
      duplicateScanResult,
      typeFilter,
      srFilter,
      sortKey,
      sortDir,
      similaritySession,
      selectedSample,
      selectedSampleIds,
    } = get();

    const activeCollection =
      selectedCollectionId !== null
        ? collections.find((c) => c.id === selectedCollectionId) ?? null
        : null;
    const smartQuery = activeCollection?.smart_query?.trim() || "";
    const isManualCollectionSelected =
      selectedCollectionId !== null && smartQuery === "";

    // Use <3ms client-side filtering whenever allProfileSamples is loaded
    // and no SQLite collection_items join or trash quarantine query is active.
    if (
      allProfileSamples.length === 0 ||
      isManualCollectionSelected ||
      trashFilterActive
    ) {
      return false;
    }

    // Advance unified query epoch so any older in-flight SQLite collection query or worker run is discarded!
    const fetchSeq = ++currentFetchSeq;
    const preserveMultiSelect = opts?.preserveMultiSelect ?? true;

    if (shouldUseCatalogWorker(allProfileSamples.length)) {
      dispatchWorkerInstantMemoryFilter({
        snapshotState: get(),
        smartQuery,
        preserveMultiSelect,
        fetchSeq,
        profileEpoch: currentProfileEpoch,
        getFetchSeq: () => currentFetchSeq,
        getProfileEpoch: () => currentProfileEpoch,
        getState: get,
        set,
      });
      return true;
    }

    bumpMemoryFilterSeq();

    const baseResult = filterBaseSamplesInMemory(
      allProfileSamples,
      folderFilter,
      favoriteOnly,
      recentOnly,
      recentSampleIds,
      selectedTagIds,
      selectedGenre,
      selectedLicenseGroupId,
      licenseGroups,
      binFilterActive,
      binSampleIds,
      buildDuplicateOrderMap(duplicatesFilterActive, duplicateScanResult)
    );
    const smartBaseResult = smartQuery
      ? executeSmartSearch(baseResult, smartQuery, smartSearchSynonyms)
      : baseResult;
    const trimmedSearch = searchQuery.trim();
    const searchedResult =
      trimmedSearch !== ""
        ? executeSmartSearch(smartBaseResult, searchQuery, smartSearchSynonyms)
        : smartBaseResult;
    if (!smartQuery && trimmedSearch === "") {
      clearSmartSearchCache();
    }
    const filtered = applyClientFacetFilters(
      searchedResult,
      typeFilter,
      srFilter,
      sortKey,
      sortDir,
      similaritySession
    );
    const reconciled = reconcileSelectionAfterFilter(
      filtered,
      selectedSample,
      selectedSampleIds,
      preserveMultiSelect
    );

    set({
      rawSamples: searchedResult,
      samples: filtered,
      selectedSample: reconciled.nextSelected,
      selectedSampleIds: reconciled.nextSelectedIds,
      lastSelectedIndex: reconciled.nextSelectedIndex,
      durationSec: reconciled.nextSelected
        ? Math.max(0.01, reconciled.nextSelected.duration_ms / 1000)
        : get().durationSec,
    });
    return true;
  };

  const sliceCtx: StoreSliceContext = {
    set,
    get,
    applyInstantMemoryFilter,
    applyProfileSettingsImmediately,
    buildCurrentProfileSettingsJson,
    bumpProfileEpoch: () => {
      invalidateAiSliceAsyncState();
      return ++currentProfileEpoch;
    },
    getProfileEpoch: () => currentProfileEpoch,
    prepareForProfileTransition,
    resetFiltersOnProfileChange,
    emitNotice,
  };

  const catalogSyncSlice = createCatalogSyncSlice(sliceCtx);
  const librarySyncSlice = createLibrarySyncSlice(sliceCtx, {
    bumpFetchSeq: () => ++currentFetchSeq,
    getFetchSeq: () => currentFetchSeq,
  });
  const filterSlice = createFilterSlice(sliceCtx, {
    setSearchDebounceTimer: (t) => {
      searchDebounceTimer = t;
    },
    clearSearchDebounceTimer,
  });
  const profileSlice = createProfileSlice(sliceCtx);
  const playbackSlice = createPlaybackSlice(sliceCtx);
  const catalogMutationSlice = createCatalogMutationSlice(sliceCtx);
  const settingsAndBinSlice = createSettingsAndBinSlice(sliceCtx, settingsTimers);
  const fileOpsSlice = createFileOpsSlice(sliceCtx);
  const duplicateSlice = createDuplicateSlice(sliceCtx);
  const aiSlice = createAiSlice(sliceCtx);
  const sliceHistorySlice = createSliceHistorySlice(sliceCtx);

  return {
    hasInitialized: false,
    profiles: [],
    activeProfile: null,
    libraries: [],
    allProfileSamples: [],
    trashedProfileSamples: [],
    rawSamples: [],
    samples: [],
    favoritesCount: 0,
    knownSampleIds: EMPTY_SAMPLE_ID_SET,
    tags: [],
    genres: [],
    collections: [],
    smartCollectionCounts: {},
    folderStats: loadSavedFolderStats(),

    searchQuery: "",
    smartSearchSynonyms: boot.smartSearchSynonyms,
    folderFilter: loadSavedActiveFolder(),
    favoriteOnly: loadSavedFavoriteOnly(),
    recentOnly: false,
    recentSampleIds: loadSavedRecentSampleIds(),
    selectedTagIds: [],
    selectedGenre: null,
    isDetectingGenres: false,
    selectedCollectionId: loadSavedCollectionId(),
    selectedLicenseGroupId: loadSavedActiveLicenseGroupId(),
    binFilterActive: false,
    trashFilterActive: false,
    typeFilter: "all",
    srFilter: null,

    sortKey: initialSort.key,
    sortDir: initialSort.dir,

    binSampleIds: loadSavedBinSampleIds(),
    autoBinOnNleDrag: boot.autoBinOnNleDrag,
    customSliceExportPath: boot.customSliceExportPath,
    slicesFilterActive: false,
    sliceHistory: [],
    trashedSliceHistory: [],
    isLoadingSliceHistory: false,
    sliceHideMissing: false,
    sliceFavoriteOnly: false,
    slicePitchOnly: false,
    sliceSortKey: null,
    sliceSortDir: "asc",
    selectedSliceIds: [],
    activeSliceId: null,
    lastSelectedSliceIndex: null,
    batchRenameSliceIds: null,
    sliceOpUndoStack: [],
    sliceOpRedoStack: [],
    enableAdvancedFileOps: boot.enableAdvancedFileOps,
    confirmBeforeTrash: boot.confirmBeforeTrash,
    pendingTrashRequest: null,
    pendingFileConflictPrompt: null,
    trashedCount: initialTrashStatus.count,
    trashedTotalBytes: initialTrashStatus.totalBytes,
    trashedSliceCount: 0,
    trashedSliceTotalBytes: 0,
    trashViewTab: "tracks",
    trashOpStatus: null,
    fileOpJournal: [],
    fileOpUndoStack: [],
    fileOpRedoStack: [],
    batchRenameSampleIds: null,
    duplicatesFilterActive: false,
    duplicateScanMode: "exact",
    duplicateLibraryId: null,
    duplicateMinSimilarityPct: 97,
    duplicateExtrasMinPct: 98,
    isScanningDuplicates: false,
    duplicateScanProgress: null,
    duplicateScanResult: null,
    duplicateScanCache: {},
    duplicateScanError: null,

    selectedSample: null,
    selectedSampleIds: [],
    lastSelectedIndex: null,
    isPlaying: false,
    isLooping: boot.isLooping,
    isShuffle: boot.isShuffle,
    shuffleHistory: [],
    autoPreview: boot.autoPreview,
    volume: boot.volume,
    preMuteVolume: boot.volume > 0.02 ? boot.volume : 0.9,
    pitchSemitones: 0,
    currentTimeSec: 0,
    durationSec: 0,
    sliceRange: null,
    seekRequest: null,
    playTriggerSeq: 0,

    isSettingsOpen: false,
    isSettingsWindowVisible: true,
    settingsTab: loadSavedSettingsTab(),
    themeMode: boot.themeMode,
    accentColor: boot.accentColor,
    accentAuto: boot.accentAuto,
    waveformSensitivity: boot.waveformSensitivity,
    waveformStyle: boot.waveformStyle,
    playheadLatencyMs: boot.playheadLatencyMs,
    audioOutputDeviceId: boot.audioOutputDeviceId,
    sliceMicroFade: boot.sliceMicroFade,
    normalizePreview: boot.normalizePreview,
    autoAnalyzeBpmKey: boot.autoAnalyzeBpmKey,
    enableLiveFolderWatch: boot.enableLiveFolderWatch,
    isAnalyzingBpmKey: false,
    bpmKeyProgress: null,
    isMiniDock: false,
    isMiniDockPinned: safeGetItem(AUDIFY_STORAGE_KEYS.miniDockPinned) !== "false",
    enableMica: boot.enableMica,
    themeTintIntensity: boot.themeTintIntensity,
    customBgImage: boot.customBgImage,
    customBgGallery: [],
    customBgBlur: boot.customBgBlur,
    customBgOpacity: boot.customBgOpacity,
    wallpaperKind: boot.wallpaperKind,
    asciiPreset: boot.asciiPreset,
    asciiMagicSlug: boot.asciiMagicSlug,
    asciiMagicLook: boot.asciiMagicLook,
    asciiMagicFit: boot.asciiMagicFit,
    asciiMotionSpeed: boot.asciiMotionSpeed,
    shortcuts: loadSavedShortcuts(),
    autoTagRules: [...DEFAULT_AUTO_TAG_RULES],
    autoTagCategories: [
      { name: "SFX", include_paths: [], exclude_paths: [] },
      { name: "Ambience", include_paths: [], exclude_paths: [] },
      { name: "Music", include_paths: [], exclude_paths: [] },
    ],
    autoTagRulesDirty: false,
    localBackups: [],
    pendingSnapshotRestore: null,
    enableLicensesSystem: boot.enableLicenses,
    licenseGroups: loadSavedLicenseGroups(),
    creditToast: null,
    statusNotice: null,
    collectionTemplates: loadSavedCollectionTemplates(),
    autoCreateCollectionSubfolders: loadSavedAutoCreateCollectionSubfolders(),
    autoRouteCollectionDrops: loadSavedAutoRouteCollectionDrops(),

    inAppDragSample: null,
    inAppDragSamples: [],

    isScanning: false,
    scanProgress: null,
    statusMessage: null,

    aiModelStatus: null,
    aiDownloadProgress: null,
    isDownloadingAiModel: false,
    isVerifyingAiModel: false,
    aiAutoAnalyzeOnScan: boot.aiAutoAnalyzeOnScan,
    aiTagConfidenceThreshold: boot.aiTagConfidenceThreshold,
    aiTaggingMode: boot.aiTaggingMode,
    aiKnnTagLearning: boot.aiKnnTagLearning,
    aiSimilarityMinScore: boot.aiSimilarityMinScore,
    aiSimilarityTopK: boot.aiSimilarityTopK,
    aiSimilarityScope: boot.aiSimilarityScope,
    aiSimilarityDurationMatch: boot.aiSimilarityDurationMatch,
    isAnalyzingAi: false,
    aiIndexProgress: null,
    similaritySession: null,
    aiSuggestionsBySampleId: {},
    pendingAiSuggestionsCount: 0,

    ...catalogSyncSlice,
    ...librarySyncSlice,
    ...filterSlice,
    ...profileSlice,
    ...playbackSlice,
    ...catalogMutationSlice,
    ...settingsAndBinSlice,
    ...fileOpsSlice,
    ...duplicateSlice,
    ...aiSlice,
    ...sliceHistorySlice,
  };
});

export type { SampleItem };
