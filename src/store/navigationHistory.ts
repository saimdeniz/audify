import type {
  FavoritesViewTab,
  LayersWorkspaceTab,
  SampleRateFilter,
  TagMatchMode,
  TrashViewTab,
  TypeFilter,
} from "../types";
import { isLayerDraftSample } from "../utils/layerHelpers";
import { getCachedSampleByIdMap } from "../utils/sampleLookup";
import { clearSmartSearchCache } from "../utils/smartSearch";
import { resetPlayheadClock } from "./playheadClock";
import { persistNavigationFilters } from "./storageHelpers";
import type { SampleStoreState } from "./types";
import { useSampleStore } from "./useSampleStore";

export const MAX_NAV_HISTORY = 40;

export interface NavigationSnapshot {
  folderFilter: string | null;
  favoriteOnly: boolean;
  favoritesViewTab: FavoritesViewTab;
  recentOnly: boolean;
  binFilterActive: boolean;
  slicesFilterActive: boolean;
  layersFilterActive: boolean;
  layersWorkspaceTab: LayersWorkspaceTab;
  duplicatesFilterActive: boolean;
  trashFilterActive: boolean;
  trashViewTab: TrashViewTab;
  selectedCollectionId: number | null;
  selectedLicenseGroupId: string | null;
  selectedTagIds: number[];
  excludedTagIds: number[];
  tagMatchMode: TagMatchMode;
  selectedGenre: string | null;
  typeFilter: TypeFilter;
  srFilter: SampleRateFilter;
  searchQuery: string;
  /** Last selected real sample ID while on this view (updated in-place, never spawns new history entries). */
  selectedSampleId: number | null;
}

export interface NavigationHistoryFlags {
  canGoBack: boolean;
  canGoForward: boolean;
  index: number;
  length: number;
}

export function captureNavigationSnapshot(
  state: SampleStoreState
): NavigationSnapshot {
  return {
    folderFilter: state.folderFilter,
    favoriteOnly: state.favoriteOnly,
    favoritesViewTab: state.favoritesViewTab,
    recentOnly: state.recentOnly,
    binFilterActive: state.binFilterActive,
    slicesFilterActive: state.slicesFilterActive,
    layersFilterActive: state.layersFilterActive,
    layersWorkspaceTab: state.layersWorkspaceTab,
    duplicatesFilterActive: state.duplicatesFilterActive,
    trashFilterActive: state.trashFilterActive,
    trashViewTab: state.trashViewTab,
    selectedCollectionId: state.selectedCollectionId,
    selectedLicenseGroupId: state.selectedLicenseGroupId,
    selectedTagIds: [...state.selectedTagIds],
    excludedTagIds: [...state.excludedTagIds],
    tagMatchMode: state.tagMatchMode,
    selectedGenre: state.selectedGenre,
    typeFilter: state.typeFilter,
    srFilter: state.srFilter,
    searchQuery: state.searchQuery,
    selectedSampleId:
      state.selectedSample && state.selectedSample.id > 0
        ? state.selectedSample.id
        : null,
  };
}

/**
 * Serializes all structural view/filter axes (excluding `searchQuery`) so
 * per-keystroke typing updates the current entry in-place rather than spamming
 * the Back/Forward stack.
 */
export function buildNavViewKey(snap: NavigationSnapshot): string {
  return JSON.stringify([
    snap.folderFilter,
    snap.favoriteOnly,
    snap.favoritesViewTab,
    snap.recentOnly,
    snap.binFilterActive,
    snap.slicesFilterActive,
    snap.layersFilterActive,
    snap.layersWorkspaceTab,
    snap.duplicatesFilterActive,
    snap.trashFilterActive,
    snap.trashViewTab,
    snap.selectedCollectionId,
    snap.selectedLicenseGroupId,
    snap.selectedTagIds,
    snap.excludedTagIds,
    snap.tagMatchMode,
    snap.selectedGenre,
    snap.typeFilter,
    snap.srFilter,
  ]);
}

let historyEntries: NavigationSnapshot[] = [];
let historyKeys: string[] = [];
let historyCursor = -1;
let trackedProfileId: number | null = null;
let wasInitialized = false;
let isRestoring = false;
let activeStoreUnsub: (() => void) | null = null;

const flagListeners = new Set<() => void>();
let cachedFlags: NavigationHistoryFlags = {
  canGoBack: false,
  canGoForward: false,
  index: -1,
  length: 0,
};

function notifyFlagsIfChanged(): void {
  const canGoBack = historyCursor > 0;
  const canGoForward =
    historyCursor >= 0 && historyCursor < historyEntries.length - 1;
  const length = historyEntries.length;
  if (
    cachedFlags.canGoBack === canGoBack &&
    cachedFlags.canGoForward === canGoForward &&
    cachedFlags.index === historyCursor &&
    cachedFlags.length === length
  ) {
    return;
  }
  cachedFlags = {
    canGoBack,
    canGoForward,
    index: historyCursor,
    length,
  };
  for (const listener of flagListeners) {
    listener();
  }
}

function seedHistory(state: SampleStoreState): void {
  const snap = captureNavigationSnapshot(state);
  historyEntries = [snap];
  historyKeys = [buildNavViewKey(snap)];
  historyCursor = 0;
  trackedProfileId = state.activeProfile?.id ?? null;
  wasInitialized = state.hasInitialized;
  notifyFlagsIfChanged();
}

function areNumberArraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSameNavViewAxes(
  cur: NavigationSnapshot,
  state: SampleStoreState
): boolean {
  return (
    cur.folderFilter === state.folderFilter &&
    cur.favoriteOnly === state.favoriteOnly &&
    cur.favoritesViewTab === state.favoritesViewTab &&
    cur.recentOnly === state.recentOnly &&
    cur.binFilterActive === state.binFilterActive &&
    cur.slicesFilterActive === state.slicesFilterActive &&
    cur.layersFilterActive === state.layersFilterActive &&
    cur.layersWorkspaceTab === state.layersWorkspaceTab &&
    cur.duplicatesFilterActive === state.duplicatesFilterActive &&
    cur.trashFilterActive === state.trashFilterActive &&
    cur.trashViewTab === state.trashViewTab &&
    cur.selectedCollectionId === state.selectedCollectionId &&
    cur.selectedLicenseGroupId === state.selectedLicenseGroupId &&
    cur.tagMatchMode === state.tagMatchMode &&
    cur.selectedGenre === state.selectedGenre &&
    cur.typeFilter === state.typeFilter &&
    cur.srFilter === state.srFilter &&
    areNumberArraysEqual(cur.selectedTagIds, state.selectedTagIds) &&
    areNumberArraysEqual(cur.excludedTagIds, state.excludedTagIds)
  );
}

function recordStoreTransition(state: SampleStoreState): void {
  if (isRestoring) return;

  const profileId = state.activeProfile?.id ?? null;
  if (historyCursor < 0 || profileId !== trackedProfileId) {
    seedHistory(state);
    return;
  }

  // Replace the root entry while boot hydration is still settling so startup
  // restoration of saved folders/views never pollutes the Back stack.
  if (!wasInitialized) {
    seedHistory(state);
    return;
  }

  // O(1) shallow fast-path avoids allocating snapshots + JSON.stringify on every playhead/selection update
  const cur = historyEntries[historyCursor];
  if (cur && isSameNavViewAxes(cur, state)) {
    const nextSampleId =
      state.selectedSample && state.selectedSample.id > 0
        ? state.selectedSample.id
        : null;
    if (
      cur.searchQuery !== state.searchQuery ||
      (nextSampleId !== null && cur.selectedSampleId !== nextSampleId)
    ) {
      historyEntries[historyCursor] = {
        ...cur,
        searchQuery: state.searchQuery,
        selectedSampleId: nextSampleId ?? cur.selectedSampleId,
      };
    }
    return;
  }

  const snap = captureNavigationSnapshot(state);
  const key = buildNavViewKey(snap);
  const currentKey = historyKeys[historyCursor];

  if (key === currentKey) {
    if (
      cur.searchQuery !== snap.searchQuery ||
      (snap.selectedSampleId !== null &&
        cur.selectedSampleId !== snap.selectedSampleId)
    ) {
      historyEntries[historyCursor] = {
        ...cur,
        searchQuery: snap.searchQuery,
        selectedSampleId: snap.selectedSampleId ?? cur.selectedSampleId,
      };
    }
    return;
  }

  // Standard browser semantics: navigating to a new view after going Back drops Forward tail.
  if (historyCursor < historyEntries.length - 1) {
    historyEntries = historyEntries.slice(0, historyCursor + 1);
    historyKeys = historyKeys.slice(0, historyCursor + 1);
  }

  historyEntries.push(snap);
  historyKeys.push(key);
  if (historyEntries.length > MAX_NAV_HISTORY) {
    const excess = historyEntries.length - MAX_NAV_HISTORY;
    historyEntries.splice(0, excess);
    historyKeys.splice(0, excess);
  }
  historyCursor = historyEntries.length - 1;
  notifyFlagsIfChanged();
}

function applyNavigationSnapshot(snap: NavigationSnapshot): void {
  const st = useSampleStore.getState();
  const validCollectionId =
    snap.selectedCollectionId !== null &&
    st.collections.some((c) => c.id === snap.selectedCollectionId)
      ? snap.selectedCollectionId
      : null;
  const validLicenseGroupId =
    snap.selectedLicenseGroupId !== null &&
    st.licenseGroups.some((g) => g.id === snap.selectedLicenseGroupId)
      ? snap.selectedLicenseGroupId
      : null;

  // Sync pruned collection/license IDs back into the current history slot so a later
  // debounced search update sees an identical nav key instead of wiping the Forward stack.
  if (
    historyCursor >= 0 &&
    historyCursor < historyEntries.length &&
    (validCollectionId !== snap.selectedCollectionId ||
      validLicenseGroupId !== snap.selectedLicenseGroupId)
  ) {
    const prunedSnap: NavigationSnapshot = {
      ...snap,
      selectedCollectionId: validCollectionId,
      selectedLicenseGroupId: validLicenseGroupId,
    };
    historyEntries[historyCursor] = prunedSnap;
    historyKeys[historyCursor] = buildNavViewKey(prunedSnap);
  }

  const shouldPersistNav =
    !snap.trashFilterActive &&
    !snap.binFilterActive &&
    !snap.slicesFilterActive &&
    !snap.duplicatesFilterActive &&
    !(snap.layersFilterActive && snap.layersWorkspaceTab === "saved");

  if (shouldPersistNav) {
    persistNavigationFilters(
      snap.folderFilter,
      validLicenseGroupId,
      snap.favoriteOnly,
      validCollectionId
    );
  }

  if (snap.searchQuery.trim() === "") {
    clearSmartSearchCache();
  }

  const isTrackTableView =
    !snap.slicesFilterActive &&
    !(snap.layersFilterActive && snap.layersWorkspaceTab === "saved") &&
    !(snap.trashFilterActive && snap.trashViewTab !== "tracks") &&
    !(snap.favoriteOnly && snap.favoritesViewTab !== "tracks");

  // Restore last-selected track silently via O(1) lookup map (never auto-plays or interrupts live audio)
  const restoredTrack =
    isTrackTableView && !st.isPlaying && snap.selectedSampleId !== null
      ? getCachedSampleByIdMap(
          snap.trashFilterActive
            ? st.trashedProfileSamples
            : st.allProfileSamples
        ).get(snap.selectedSampleId) ?? null
      : null;
  if (restoredTrack) {
    resetPlayheadClock(0);
  }

  const trimmedSnapQuery = snap.searchQuery.trim();
  const nextSortPatch =
    trimmedSnapQuery.length > 0
      ? { sortKey: "match" as const, sortDir: "desc" as const }
      : st.sortKey === "match"
      ? { sortKey: null, sortDir: "asc" as const }
      : {};

  isRestoring = true;
  try {
    useSampleStore.setState({
      folderFilter: snap.folderFilter,
      favoriteOnly: snap.favoriteOnly,
      favoritesViewTab: snap.favoritesViewTab,
      recentOnly: snap.recentOnly,
      binFilterActive: snap.binFilterActive,
      slicesFilterActive: snap.slicesFilterActive,
      layersFilterActive: snap.layersFilterActive,
      layersWorkspaceTab: snap.layersWorkspaceTab,
      duplicatesFilterActive: snap.duplicatesFilterActive,
      trashFilterActive: snap.trashFilterActive,
      trashViewTab: snap.trashViewTab,
      selectedCollectionId: validCollectionId,
      selectedLicenseGroupId: validLicenseGroupId,
      selectedTagIds: [...snap.selectedTagIds],
      excludedTagIds: [...snap.excludedTagIds],
      tagMatchMode: snap.tagMatchMode,
      selectedGenre: snap.selectedGenre,
      typeFilter: snap.typeFilter,
      srFilter: snap.srFilter,
      searchQuery: snap.searchQuery,
      ...nextSortPatch,
      ...(restoredTrack
        ? {
            selectedSample: restoredTrack,
            selectedSampleIds: [restoredTrack.id],
            durationSec: Math.max(0.01, restoredTrack.duration_ms / 1000),
            sliceRange: null,
            currentTimeSec: 0,
          }
        : {}),
      similaritySession: null,
      batchRenameSampleIds: null,
      batchRenameSliceIds: null,
      batchRenameLayerIds: null,
    });

    const next = useSampleStore.getState();
    if (snap.trashFilterActive) {
      if (snap.trashViewTab === "slices") {
        void next.fetchTrashedSlices();
      } else if (snap.trashViewTab === "layers") {
        void next.fetchTrashedLayers();
      } else {
        void next.refreshTrashStatus();
        void next.fetchSamples({ preserveMultiSelect: false });
      }
      return;
    }

    if (snap.slicesFilterActive) {
      void next.fetchSliceHistory();
      return;
    }

    if (snap.layersFilterActive) {
      void next.fetchLayerHistory();
      if (snap.layersWorkspaceTab === "editor" && !next.isMiniDock) {
        next.setSearchQuery(snap.searchQuery);
        if (
          !next.isPlaying &&
          next.layerDraftRecipe.clips.length > 0 &&
          !isLayerDraftSample(next.selectedSample)
        ) {
          void next.renderLayerDraftPreview({ autoplay: false });
        }
      }
      return;
    }

    if (snap.favoriteOnly && snap.favoritesViewTab === "slices") {
      void next.fetchSliceHistory();
      return;
    }

    if (snap.favoriteOnly && snap.favoritesViewTab === "layers") {
      void next.fetchLayerHistory();
      return;
    }

    next.setSearchQuery(snap.searchQuery);
  } finally {
    isRestoring = false;
  }
}

export function initNavigationHistory(): () => void {
  if (activeStoreUnsub) {
    return activeStoreUnsub;
  }
  seedHistory(useSampleStore.getState());
  const unsub = useSampleStore.subscribe((state) => {
    recordStoreTransition(state);
  });
  activeStoreUnsub = () => {
    unsub();
    activeStoreUnsub = null;
  };
  return activeStoreUnsub;
}

export function navigateHistoryBack(): boolean {
  if (historyCursor <= 0) return false;
  historyCursor -= 1;
  notifyFlagsIfChanged();
  applyNavigationSnapshot(historyEntries[historyCursor]);
  return true;
}

export function navigateHistoryForward(): boolean {
  if (historyCursor < 0 || historyCursor >= historyEntries.length - 1) {
    return false;
  }
  historyCursor += 1;
  notifyFlagsIfChanged();
  applyNavigationSnapshot(historyEntries[historyCursor]);
  return true;
}

export function getNavigationHistoryFlags(): NavigationHistoryFlags {
  return cachedFlags;
}

export function subscribeNavigationHistoryFlags(
  listener: () => void
): () => void {
  flagListeners.add(listener);
  return () => {
    flagListeners.delete(listener);
  };
}

/** Test-only helper to cleanly tear down singleton state between test cases. */
export function resetNavigationHistoryForTest(): void {
  if (activeStoreUnsub) {
    activeStoreUnsub();
  }
  historyEntries = [];
  historyKeys = [];
  historyCursor = -1;
  trackedProfileId = null;
  wasInitialized = false;
  isRestoring = false;
  notifyFlagsIfChanged();
}
