import { create } from "zustand";
import { Profile, SampleItem } from "../types";
import { clearCatalogSortCaches } from "../utils/catalogFilterCore";
import { createEmptyLayerRecipe } from "../utils/layerHelpers";
import { resetSharedListScrollAnchor } from "../utils/listScrollAnchor";
import { computeSmartCollectionCounts } from "../utils/smartCollectionCounts";
import { clearSmartSearchCache, executeSmartSearch } from "../utils/smartSearch";
import {
  clearCatalogWorkerPool,
  clearCatalogWorkerSearchCache,
  shouldUseCatalogWorker,
  syncCatalogWorkerPool,
  syncCatalogWorkerTaxonomy,
} from "../workers/catalogWorkerClient";
import {
  applyClientFacetFilters,
  filterBaseSamplesInMemory,
  reconcileSelectionAfterFilter,
  shouldPreserveDeckSelection,
} from "./filterEngine";
import {
  createInitialStoreState,
  EMPTY_SAMPLE_ID_SET,
} from "./initialStoreState";
import {
  applyProfileSettingsToStore,
  buildProfileSettingsJsonFromStore,
} from "./profileSettingsBridge";
import { resetPlayheadClock } from "./playheadClock";
import { createAiSlice, invalidateAiSliceAsyncState } from "./slices/aiSlice";
import { createCatalogMutationSlice } from "./slices/catalogMutationSlice";
import { createCatalogSyncSlice } from "./slices/catalogSyncSlice";
import {
  buildDuplicateOrderMap,
  createDuplicateSlice,
} from "./slices/duplicateSlice";
import { createFileOpsSlice } from "./slices/fileOpsSlice";
import { createFilterSlice } from "./slices/filterSlice";
import { createLayerSlice } from "./slices/layerSlice";
import { createLibrarySyncSlice } from "./slices/librarySyncSlice";
import {
  createPlaybackSlice,
  PlaybackSliceTimers,
} from "./slices/playbackSlice";
import { createProfileSlice } from "./slices/profileSlice";
import {
  createSettingsAndBinSlice,
  SettingsSliceTimers,
} from "./slices/settingsAndBinSlice";
import { createSliceHistorySlice } from "./slices/sliceHistorySlice";
import { createStatusNoticeController } from "./statusNoticeController";
import { persistNavigationFilters } from "./storageHelpers";
import {
  CreditToastPayload,
  SampleStoreState,
  SettingsTab,
  StatusNoticePayload,
  StoreSliceContext,
} from "./types";
import {
  bumpMemoryFilterSeq,
  dispatchWorkerInstantMemoryFilter,
  scheduleWorkerSmartCollectionCounts,
} from "./workerBridge";

export type {
  CreditToastPayload,
  SampleStoreState,
  SettingsTab,
  StatusNoticePayload,
};

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
    let patch = typeof partial === "function" ? partial(state) : partial;
    if (
      patch &&
      typeof patch === "object" &&
      patch.trashFilterActive === false &&
      state.trashedProfileSamples.length > 0 &&
      !("trashedProfileSamples" in patch)
    ) {
      patch = { ...patch, trashedProfileSamples: [] };
    }
    if (patch && typeof patch === "object") {
      const nextSearchQuery =
        "searchQuery" in patch && typeof patch.searchQuery === "string"
          ? patch.searchQuery
          : state.searchQuery;
      const nextColId =
        "selectedCollectionId" in patch
          ? patch.selectedCollectionId
          : state.selectedCollectionId;
      const nextCollections = patch.collections ?? state.collections;
      const prevCol =
        state.selectedCollectionId !== null
          ? state.collections.find((c) => c.id === state.selectedCollectionId) ??
            null
          : null;
      const nextCol =
        nextColId !== null && nextColId !== undefined
          ? nextCollections.find((c) => c.id === nextColId) ?? null
          : null;
      const hadActiveSearchOrSmart =
        state.searchQuery.trim() !== "" ||
        Boolean(prevCol?.smart_query?.trim());
      const hasActiveSearchOrSmart =
        nextSearchQuery.trim() !== "" ||
        Boolean(nextCol?.smart_query?.trim());
      if (hadActiveSearchOrSmart && !hasActiveSearchOrSmart) {
        clearCatalogWorkerSearchCache();
      }
    }
    if (
      patch &&
      typeof patch === "object" &&
      (("tags" in patch && patch.tags !== undefined && patch.tags !== state.tags) ||
        ("tagFacets" in patch &&
          patch.tagFacets !== undefined &&
          patch.tagFacets !== state.tagFacets))
    ) {
      const nextTags =
        "tags" in patch && patch.tags !== undefined ? patch.tags : state.tags;
      const nextFacets =
        "tagFacets" in patch && patch.tagFacets !== undefined
          ? patch.tagFacets
          : state.tagFacets;
      syncCatalogWorkerTaxonomy(nextTags, nextFacets);
    }
    if (
      patch &&
      typeof patch === "object" &&
      "allProfileSamples" in patch &&
      patch.allProfileSamples !== undefined &&
      patch.allProfileSamples !== state.allProfileSamples
    ) {
      if (shouldUseCatalogWorker(patch.allProfileSamples.length)) {
        syncCatalogWorkerPool(patch.allProfileSamples);
      } else {
        clearCatalogWorkerPool();
      }
    }
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

  const settingsTimers: SettingsSliceTimers = {
    flushPendingTint: () => {},
    cancelPendingTint: () => {},
    clearToastTimers: () => {},
  };
  const playbackTimers: PlaybackSliceTimers = {
    flushPendingVolume: () => {},
    cancelPendingVolume: () => {},
  };

  const {
    emitNotice,
    clearStatusNotice,
    pauseStatusNotice,
    resumeStatusNotice,
  } = createStatusNoticeController(set, get);

  const prepareForProfileTransition = async () => {
    clearSearchDebounceTimer();
    playbackTimers.flushPendingVolume();
    settingsTimers.flushPendingTint();
  };

  const resetFiltersOnProfileChange = (statusMessage: string) => {
    clearSearchDebounceTimer();
    persistNavigationFilters(null, null, false, null);
    clearSmartSearchCache();
    clearCatalogSortCaches();
    resetPlayheadClock(0);
    resetSharedListScrollAnchor();
    const prevSim = get().similaritySession;
    set({
      allProfileSamples: [],
      trashedProfileSamples: [],
      artistStats: [],
      licenseGroupMatchCounts: {},
      favoritesCount: 0,
      knownSampleIds: EMPTY_SAMPLE_ID_SET,
      selectedSample: null,
      isPlaying: false,
      currentTimeSec: 0,
      sliceRange: null,
      fileOpUndoStack: [],
      fileOpRedoStack: [],
      pendingTrashRequest: null,
      pendingFileConflictPrompt: null,
      batchRenameSampleIds: null,
      autoTagImpactPreview: null,
      canUndoAutoTagApply: false,
      aiSuggestionsBySampleId: {},
      pendingAiSuggestionsCount: 0,
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
      trashedLayerCount: 0,
      trashedLayerTotalBytes: 0,
      trashViewTab: "tracks",
      favoritesViewTab: "tracks",
      layersFilterActive: false,
      layersWorkspaceTab: "saved",
      layersSplitLibraryOpen: false,
      layerHistory: [],
      trashedLayerHistory: [],
      isLoadingLayerHistory: false,
      selectedLayerIds: [],
      activeLayerId: null,
      batchRenameLayerIds: null,
      layerDraftName: "Untitled_Layer",
      layerDraftEditingId: null,
      layerDraftRecipe: createEmptyLayerRecipe(),
      layerDraftDirty: false,
      layerDraftSelectedClipIds: [],
      layerDraftMissingClipIds: [],
      layerDraftUndoStack: [],
      layerDraftRedoStack: [],
      layerDraftPreview: null,
      isRenderingLayerPreview: false,
      isSavingLayer: false,
      isScanningDuplicates: false,
      duplicateScanProgress: null,
      duplicateScanResult: null,
      duplicateScanCache: {},
      duplicateScanError: null,
      favoriteOnly: false,
      recentOnly: false,
      selectedTagIds: [],
      excludedTagIds: [],
      tagMatchMode: "all",
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
      collections,
      selectedCollectionId,
      trashFilterActive,
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

    const runSyncMemoryFilter = () => {
      const live = get();
      const taxonomyIndex = syncCatalogWorkerTaxonomy(live.tags, live.tagFacets);
      const baseResult = filterBaseSamplesInMemory(
        live.allProfileSamples,
        live.folderFilter,
        live.favoriteOnly,
        live.recentOnly,
        live.recentSampleIds,
        live.selectedTagIds,
        live.selectedGenre,
        live.selectedLicenseGroupId,
        live.licenseGroups,
        live.binFilterActive,
        live.binSampleIds,
        buildDuplicateOrderMap(
          live.duplicatesFilterActive,
          live.duplicateScanResult
        ),
        live.excludedTagIds,
        taxonomyIndex,
        live.tagMatchMode
      );
      const smartBaseResult = smartQuery
        ? executeSmartSearch(baseResult, smartQuery, live.smartSearchSynonyms)
        : baseResult;
      const trimmedSearch = live.searchQuery.trim();
      const searchedResult =
        trimmedSearch !== ""
          ? executeSmartSearch(
              smartBaseResult,
              live.searchQuery,
              live.smartSearchSynonyms
            )
          : smartBaseResult;
      if (!smartQuery && trimmedSearch === "") {
        clearSmartSearchCache();
      }
      if (!live.sortKey) {
        clearCatalogSortCaches();
      }
      const filtered = applyClientFacetFilters(
        searchedResult,
        live.typeFilter,
        live.srFilter,
        live.sortKey,
        live.sortDir,
        live.similaritySession
      );
      const reconciled = reconcileSelectionAfterFilter(
        filtered,
        live.selectedSample,
        live.selectedSampleIds,
        preserveMultiSelect,
        shouldPreserveDeckSelection(live)
      );

      const selectionChanged =
        (reconciled.nextSelected?.id ?? null) !== (live.selectedSample?.id ?? null);
      if (selectionChanged) {
        resetPlayheadClock(0);
      }

      set({
        rawSamples: searchedResult,
        samples: filtered,
        selectedSample: reconciled.nextSelected,
        selectedSampleIds: reconciled.nextSelectedIds,
        lastSelectedIndex: reconciled.nextSelectedIndex,
        ...(selectionChanged
          ? {
              sliceRange: null,
              currentTimeSec: 0,
              durationSec: reconciled.nextSelected
                ? Math.max(0.01, reconciled.nextSelected.duration_ms / 1000)
                : 0,
            }
          : {}),
      });
    };

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
        onSyncFallback: runSyncMemoryFilter,
      });
      return true;
    }

    bumpMemoryFilterSeq();
    runSyncMemoryFilter();
    return true;
  };

  const sliceCtx: StoreSliceContext = {
    set,
    get,
    applyInstantMemoryFilter,
    applyProfileSettingsImmediately,
    buildCurrentProfileSettingsJson,
    bumpProfileEpoch: () => {
      playbackTimers.cancelPendingVolume();
      settingsTimers.cancelPendingTint();
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
    bumpFetchSeq: () => ++currentFetchSeq,
  });
  const profileSlice = createProfileSlice(sliceCtx);
  const playbackSlice = createPlaybackSlice(sliceCtx, playbackTimers);
  const catalogMutationSlice = createCatalogMutationSlice(sliceCtx);
  const settingsAndBinSlice = createSettingsAndBinSlice(sliceCtx, settingsTimers);
  const fileOpsSlice = createFileOpsSlice(sliceCtx);
  const duplicateSlice = createDuplicateSlice(sliceCtx);
  const aiSlice = createAiSlice(sliceCtx);
  const sliceHistorySlice = createSliceHistorySlice(sliceCtx);
  const layerSlice = createLayerSlice(sliceCtx);

  return {
    ...createInitialStoreState(),
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
    ...layerSlice,
    clearStatusNotice,
    pauseStatusNotice,
    resumeStatusNotice,
  };
});

export type { SampleItem };
