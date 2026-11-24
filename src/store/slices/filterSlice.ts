import { SampleRateFilter, SortDir, SortKey, TypeFilter } from "../../types";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { shouldUseCatalogWorker } from "../../workers/catalogWorkerClient";
import { applyClientFacetFilters, reconcileSelectionAfterFilter } from "../filterEngine";
import { resetPlayheadClock } from "../playheadClock";
import {
  AUDIFY_STORAGE_KEYS,
  loadSavedSort,
  persistNavigationFilters,
  safeRemoveItem,
  safeSetItem,
} from "../storageHelpers";
import type { MainFilterRequest, StoreSliceContext } from "../types";
import { bumpMemoryFilterSeq } from "../workerBridge";
import { cancelPendingSimilaritySearch } from "./aiSlice";

export function createFilterSlice(
  ctx: StoreSliceContext,
  opts: {
    setSearchDebounceTimer: (t: ReturnType<typeof setTimeout> | null) => void;
    clearSearchDebounceTimer: () => void;
    bumpFetchSeq: () => number;
  }
) {
  const { set, get, applyInstantMemoryFilter } = ctx;

  const restoredSortFromDuplicatesPatch = () => {
    const st = get();
    if (!st.duplicatesFilterActive || st.sortKey !== null) return {};
    const saved = loadSavedSort();
    return saved.key !== null ? { sortKey: saved.key, sortDir: saved.dir } : {};
  };

  const clearFilters = (preserveSimilarity: boolean) => {
    opts.clearSearchDebounceTimer();
    clearSmartSearchCache();
    if (!preserveSimilarity) {
      cancelPendingSimilaritySearch();
    }
    persistNavigationFilters(null, null, false, null);
    const prevSim = get().similaritySession;
    const restoreSort =
      preserveSimilarity || !prevSim ? restoredSortFromDuplicatesPatch() : {};
    set({
      searchQuery: "",
      folderFilter: null,
      selectedLicenseGroupId: null,
      binFilterActive: false,
      trashFilterActive: false,
      trashViewTab: "tracks",
      duplicatesFilterActive: false,
      slicesFilterActive: false,
      sliceFavoriteOnly: false,
      slicePitchOnly: false,
      batchRenameSliceIds: null,
      favoriteOnly: false,
      recentOnly: false,
      selectedTagIds: [],
      selectedGenre: null,
      selectedCollectionId: null,
      typeFilter: "all",
      srFilter: null,
      ...restoreSort,
      ...(!preserveSimilarity
        ? {
            similaritySession: null,
            ...(prevSim
              ? {
                  sortKey:
                    prevSim.prevSortKey === "match" ? null : prevSim.prevSortKey,
                  sortDir: prevSim.prevSortDir,
                }
              : {}),
          }
        : {}),
    });
    if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
      void get().fetchSamples({ preserveMultiSelect: false });
    }
  };

  const canOffloadFacetToWorker = (): boolean => {
    const st = get();
    if (st.trashFilterActive || !shouldUseCatalogWorker(st.allProfileSamples.length)) {
      return false;
    }
    if (st.selectedCollectionId !== null) {
      const activeCol = st.collections.find((c) => c.id === st.selectedCollectionId);
      if (!activeCol?.smart_query?.trim()) {
        return false;
      }
    }
    return true;
  };

  return {
    setSearchQuery: (q: string) => {
      set({ searchQuery: q });
      opts.clearSearchDebounceTimer();
      const cur = get();
      if (
        cur.slicesFilterActive ||
        (cur.trashFilterActive && cur.trashViewTab === "slices")
      ) {
        return;
      }
      if (q.trim() === "") {
        clearSmartSearchCache();
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      } else {
        const st = get();
        const activeCol =
          st.selectedCollectionId !== null
            ? st.collections.find((c) => c.id === st.selectedCollectionId) ?? null
            : null;
        const isManualCollection =
          st.selectedCollectionId !== null && !activeCol?.smart_query?.trim();
        if (
          st.allProfileSamples.length > 0 &&
          !isManualCollection &&
          !st.trashFilterActive
        ) {
          opts.setSearchDebounceTimer(
            setTimeout(() => {
              opts.setSearchDebounceTimer(null);
              applyInstantMemoryFilter({ preserveMultiSelect: true });
            }, 18)
          );
        } else {
          opts.setSearchDebounceTimer(
            setTimeout(() => {
              opts.setSearchDebounceTimer(null);
              void get().fetchSamples({ preserveMultiSelect: true });
            }, 65)
          );
        }
      }
    },

    setSmartSearchSynonyms: (smartSearchSynonyms: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.smartSearchSynonyms,
        String(smartSearchSynonyms)
      );
      set({
        smartSearchSynonyms,
        statusMessage: smartSearchSynonyms
          ? "Smart Search synonyms enabled (e.g. riser ~ build, hit ~ impact)"
          : "Smart Search synonyms disabled (strict keyword match)",
      });
      const st = get();
      const activeCol =
        st.selectedCollectionId !== null
          ? st.collections.find((c) => c.id === st.selectedCollectionId) ?? null
          : null;
      if (st.searchQuery.trim() !== "" || Boolean(activeCol?.smart_query?.trim())) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      }
      void get().persistActiveProfileSettings();
    },

    setFolderFilter: (folder: string | null) => {
      const st = get();
      const fav = st.favoriteOnly;
      const bin = st.binFilterActive;
      const dups = st.duplicatesFilterActive;
      const trash = st.trashFilterActive;
      const slices = st.slicesFilterActive;
      if (!trash && !bin && !slices && !dups) {
        persistNavigationFilters(folder, null, fav, null);
      }
      set({
        folderFilter: folder,
        selectedLicenseGroupId: null,
        binFilterActive: bin,
        trashFilterActive: trash,
        duplicatesFilterActive: dups,
        slicesFilterActive: slices,
        favoriteOnly: fav,
        recentOnly: false,
        selectedCollectionId: null,
      });
      if (slices || (trash && st.trashViewTab === "slices")) {
        return;
      }
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setFavoriteOnly: (fav: boolean) => {
      const restoreSort = restoredSortFromDuplicatesPatch();
      persistNavigationFilters(null, null, fav, null);
      set({
        favoriteOnly: fav,
        duplicatesFilterActive: false,
        slicesFilterActive: false,
        recentOnly: false,
        folderFilter: null,
        selectedLicenseGroupId: null,
        binFilterActive: false,
        trashFilterActive: false,
        selectedCollectionId: null,
        selectedTagIds: [],
        selectedGenre: null,
        ...restoreSort,
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setRecentOnly: (recent: boolean) => {
      const restoreSort = restoredSortFromDuplicatesPatch();
      persistNavigationFilters(null, null, false, null);
      set({
        recentOnly: recent,
        duplicatesFilterActive: false,
        slicesFilterActive: false,
        favoriteOnly: false,
        folderFilter: null,
        selectedLicenseGroupId: null,
        binFilterActive: false,
        trashFilterActive: false,
        selectedCollectionId: null,
        selectedTagIds: [],
        selectedGenre: null,
        ...restoreSort,
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    clearRecentSamples: () => {
      safeRemoveItem(AUDIFY_STORAGE_KEYS.recentSampleIds);
      const wasRecent = get().recentOnly;
      set({
        recentSampleIds: [],
        ...(wasRecent ? { recentOnly: false } : {}),
        statusMessage: "Cleared recently played history",
      });
      if (wasRecent) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }
    },

    toggleTagFilter: (tagId: number) => {
      const current = get().selectedTagIds;
      const exists = current.includes(tagId);
      const next = exists ? current.filter((id) => id !== tagId) : [...current, tagId];
      set({ selectedTagIds: next });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    selectOrToggleTagFilter: (tagId: number, append: boolean) => {
      const current = get().selectedTagIds;
      let next: number[];
      if (append) {
        next = current.includes(tagId)
          ? current.filter((id) => id !== tagId)
          : [...current, tagId];
      } else {
        next = current.length === 1 && current[0] === tagId ? [] : [tagId];
      }
      set({ selectedTagIds: next });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    clearTagFilters: () => {
      set({ selectedTagIds: [] });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    setSelectedGenre: (genre: string | null) => {
      const next = get().selectedGenre === genre ? null : genre;
      set({ selectedGenre: next });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    setCollectionFilter: (collectionId: number | null) => {
      const restoreSort = restoredSortFromDuplicatesPatch();
      persistNavigationFilters(null, null, false, collectionId);
      set({
        selectedCollectionId: collectionId,
        folderFilter: null,
        selectedLicenseGroupId: null,
        binFilterActive: false,
        trashFilterActive: false,
        duplicatesFilterActive: false,
        slicesFilterActive: false,
        favoriteOnly: false,
        recentOnly: false,
        ...restoreSort,
      });
      if (applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        return;
      }
      void get().fetchSamples({ preserveMultiSelect: false });
    },

    setTypeFilter: (typeFilter: TypeFilter) => {
      if (canOffloadFacetToWorker()) {
        set({ typeFilter });
        applyInstantMemoryFilter({ preserveMultiSelect: true });
        return;
      }
      bumpMemoryFilterSeq();
      opts.bumpFetchSeq();
      const {
        rawSamples,
        srFilter,
        sortKey,
        sortDir,
        similaritySession,
        selectedSample,
        selectedSampleIds,
      } = get();
      const filtered = applyClientFacetFilters(
        rawSamples,
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
        true
      );
      const selectionChanged =
        (reconciled.nextSelected?.id ?? null) !== (selectedSample?.id ?? null);
      if (selectionChanged) {
        resetPlayheadClock(0);
      }
      set({
        typeFilter,
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
    },

    setSrFilter: (srFilter: SampleRateFilter) => {
      if (canOffloadFacetToWorker()) {
        set({ srFilter });
        applyInstantMemoryFilter({ preserveMultiSelect: true });
        return;
      }
      bumpMemoryFilterSeq();
      opts.bumpFetchSeq();
      const {
        rawSamples,
        typeFilter,
        sortKey,
        sortDir,
        similaritySession,
        selectedSample,
        selectedSampleIds,
      } = get();
      const filtered = applyClientFacetFilters(
        rawSamples,
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
        true
      );
      const selectionChanged =
        (reconciled.nextSelected?.id ?? null) !== (selectedSample?.id ?? null);
      if (selectionChanged) {
        resetPlayheadClock(0);
      }
      set({
        srFilter,
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
    },

    // Header click cycles: asc -> desc -> default (or desc -> asc -> default for date columns).
    cycleSort: (key: SortKey) => {
      bumpMemoryFilterSeq();
      opts.bumpFetchSeq();
      const {
        sortKey,
        sortDir,
        rawSamples,
        typeFilter,
        srFilter,
        similaritySession,
        selectedSample,
      } = get();
      const descFirst =
        key === "match" || key === "dateModified" || key === "dateAdded";
      let nextKey: SortKey | null = key;
      let nextDir: SortDir = descFirst ? "desc" : "asc";
      if (sortKey === key) {
        if (key === "match") {
          nextDir = sortDir === "desc" ? "asc" : "desc";
        } else if (descFirst) {
          if (sortDir === "desc") {
            nextDir = "asc";
          } else {
            nextKey = null;
            nextDir = "asc";
          }
        } else if (sortDir === "asc") {
          nextDir = "desc";
        } else {
          nextKey = null;
          nextDir = "asc";
        }
      }
      if (nextKey !== "match") {
        if (nextKey) {
          safeSetItem(
            AUDIFY_STORAGE_KEYS.sort,
            JSON.stringify({ key: nextKey, dir: nextDir })
          );
        } else {
          safeRemoveItem(AUDIFY_STORAGE_KEYS.sort);
        }
      }
      if (canOffloadFacetToWorker()) {
        set({ sortKey: nextKey, sortDir: nextDir });
        applyInstantMemoryFilter({ preserveMultiSelect: true });
        return;
      }
      const nextSamples = applyClientFacetFilters(
        rawSamples,
        typeFilter,
        srFilter,
        nextKey,
        nextDir,
        similaritySession
      );
      const nextSelectedIndex = selectedSample
        ? nextSamples.findIndex((s) => s.id === selectedSample.id)
        : -1;
      set({
        sortKey: nextKey,
        sortDir: nextDir,
        samples: nextSamples,
        lastSelectedIndex: nextSelectedIndex >= 0 ? nextSelectedIndex : null,
      });
    },

    // Clears navigation/search/facet filters to return to All Files while keeping any active Similarity Search session intact
    selectAllFiles: () => clearFilters(true),

    resetAllFilters: () => clearFilters(false),

    applyMainFilterRequest: (req: MainFilterRequest) => {
      if (req.kind === "duplicates") {
        get().setDuplicatesFilterActive(true);
        return;
      }

      opts.clearSearchDebounceTimer();
      if (req.kind !== "search" || req.query.trim() === "") {
        clearSmartSearchCache();
      }

      const restoreSort = restoredSortFromDuplicatesPatch();
      const nextBase = {
        searchQuery: "",
        folderFilter: null as string | null,
        selectedLicenseGroupId: null as string | null,
        binFilterActive: false,
        trashFilterActive: false,
        duplicatesFilterActive: false,
        slicesFilterActive: false,
        favoriteOnly: false,
        recentOnly: false,
        selectedTagIds: [] as number[],
        selectedGenre: null as string | null,
        selectedCollectionId: null as number | null,
        ...restoreSort,
      };

      switch (req.kind) {
        case "collection":
          nextBase.selectedCollectionId = req.id;
          persistNavigationFilters(null, null, false, req.id);
          break;
        case "tag":
          nextBase.selectedTagIds = [req.id];
          persistNavigationFilters(null, null, false, null);
          break;
        case "genre":
          nextBase.selectedGenre = req.name;
          persistNavigationFilters(null, null, false, null);
          break;
        case "license":
          nextBase.selectedLicenseGroupId = req.id;
          persistNavigationFilters(null, req.id, false, null);
          break;
        case "search":
          nextBase.searchQuery = req.query;
          persistNavigationFilters(null, null, false, null);
          break;
        case "trash":
          nextBase.trashFilterActive = true;
          persistNavigationFilters(null, null, false, null);
          break;
      }

      set(nextBase);
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },
  };
}
