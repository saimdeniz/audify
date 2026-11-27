import { SliceHistoryEntry, SliceSortKey } from "../../types";
import {
  getVisibleSortedSlices,
  sliceEntryToPreviewSample,
} from "../../utils/slicePreview";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { persistNavigationFilters } from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export function createSliceHistorySlice(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  type SliceActionsInstance = ReturnType<
    typeof import("./sliceHistoryActions").createSliceHistoryActions
  >;
  let cachedSliceActions: SliceActionsInstance | null = null;
  let pendingSliceActions: Promise<SliceActionsInstance | null> | null = null;
  const loadSliceActions = async (): Promise<SliceActionsInstance | null> => {
    if (cachedSliceActions) return cachedSliceActions;
    if (!pendingSliceActions) {
      pendingSliceActions = import("./sliceHistoryActions")
        .then((mod) => {
          if (typeof mod?.createSliceHistoryActions !== "function") {
            return null;
          }
          cachedSliceActions = mod.createSliceHistoryActions(ctx);
          return cachedSliceActions;
        })
        .catch(() => null)
        .finally(() => {
          pendingSliceActions = null;
        });
    }
    return pendingSliceActions;
  };

  const getCurrentVisibleSlices = () => {
    const st = get();
    const isTrashView = st.trashFilterActive && st.trashViewTab === "slices";
    const isUnifiedFavSlices = st.favoriteOnly && st.favoritesViewTab === "slices";
    return getVisibleSortedSlices(
      isTrashView ? st.trashedSliceHistory : st.sliceHistory,
      {
        searchQuery: st.searchQuery,
        folderFilter: st.folderFilter,
        sliceHideMissing: isTrashView ? false : st.sliceHideMissing,
        sliceFavoriteOnly: isTrashView
          ? false
          : isUnifiedFavSlices || st.sliceFavoriteOnly,
        slicePitchOnly: isTrashView || isUnifiedFavSlices ? false : st.slicePitchOnly,
        sliceSortKey: st.sliceSortKey,
        sliceSortDir: st.sliceSortDir,
      }
    );
  };

  const previewEntry = (entry: SliceHistoryEntry, shouldPlay = true) => {
    if (!entry.file_exists) {
      set({ activeSliceId: entry.id });
      emitNotice(
        `Slice file "${entry.slice_name}" is missing on disk`,
        "error"
      );
      return;
    }
    set({ activeSliceId: entry.id });
    get().selectSample(sliceEntryToPreviewSample(entry), shouldPlay);
  };

  return {
    setSlicesFilterActive: (active: boolean) => {
      if (active) {
        clearSmartSearchCache();
        persistNavigationFilters(null, null, false, null);
        set({
          slicesFilterActive: true,
          layersFilterActive: false,
          duplicatesFilterActive: false,
          trashFilterActive: false,
          trashViewTab: "tracks",
          binFilterActive: false,
          favoriteOnly: false,
          favoritesViewTab: "tracks",
          recentOnly: false,
          selectedSliceIds: [],
          activeSliceId: null,
          lastSelectedSliceIndex: null,
          folderFilter: null,
          selectedLicenseGroupId: null,
          selectedCollectionId: null,
          selectedTagIds: [],
          selectedGenre: null,
          sliceRange: null,
        });
        void get().fetchSliceHistory();
        void get().fetchSliceTrashStatus();
        return;
      }

      set({
        slicesFilterActive: false,
        folderFilter: null,
        batchRenameSliceIds: null,
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setSliceHideMissing: (sliceHideMissing: boolean) => {
      set({ sliceHideMissing });
    },

    setSliceFavoriteOnly: (sliceFavoriteOnly: boolean) => {
      set({ sliceFavoriteOnly });
    },

    setSlicePitchOnly: (slicePitchOnly: boolean) => {
      set({ slicePitchOnly });
    },

    cycleSliceSort: (key: SliceSortKey) => {
      const st = get();
      if (st.sliceSortKey !== key) {
        set({ sliceSortKey: key, sliceSortDir: "asc" });
      } else if (st.sliceSortDir === "asc") {
        set({ sliceSortDir: "desc" });
      } else {
        set({ sliceSortKey: null, sliceSortDir: "asc" });
      }
    },

    setSliceSelection: (
      selectedSliceIds: number[],
      activeSliceId: number | null,
      lastSelectedSliceIndex: number | null
    ) => {
      set({
        selectedSliceIds,
        activeSliceId,
        lastSelectedSliceIndex,
      });
    },

    selectAllSlices: () => {
      const visible = getCurrentVisibleSlices();
      if (visible.length === 0) return;
      const allIds = visible.map((s) => s.id);
      const st = get();
      const activeId =
        st.activeSliceId !== null && allIds.includes(st.activeSliceId)
          ? st.activeSliceId
          : allIds[0];
      set({
        selectedSliceIds: allIds,
        activeSliceId: activeId,
        lastSelectedSliceIndex: 0,
      });
      emitNotice(`Selected ${allIds.length} slices`, "info");
    },

    selectRelativeSlice: (delta: number) => {
      const visible = getCurrentVisibleSlices();
      if (visible.length === 0) return;
      const st = get();
      const curIdx =
        st.activeSliceId !== null
          ? visible.findIndex((s) => s.id === st.activeSliceId)
          : -1;
      const nextIdx =
        curIdx < 0
          ? delta > 0
            ? 0
            : visible.length - 1
          : Math.max(0, Math.min(visible.length - 1, curIdx + delta));
      const target = visible[nextIdx];
      if (!target) return;
      set({
        selectedSliceIds: [target.id],
        activeSliceId: target.id,
        lastSelectedSliceIndex: nextIdx,
      });
      previewEntry(target, st.autoPreview);
    },

    openBatchRenameSlicesModal: (sliceIds: number[]) => {
      if (!get().enableAdvancedFileOps) {
        emitNotice(
          "Safe Read-Only Mode is active — enable Write Mode in Settings → Advanced",
          "info"
        );
        return;
      }
      const validIds = Array.from(
        new Set(sliceIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      const historyMap = new Map(get().sliceHistory.map((s) => [s.id, s]));
      const existingIds = validIds.filter((id) => historyMap.get(id)?.file_exists);
      if (existingIds.length === 0) {
        emitNotice("Select an existing slice file to rename", "error");
        return;
      }
      set({ batchRenameSliceIds: existingIds });
    },

    closeBatchRenameSlicesModal: () => set({ batchRenameSliceIds: null }),

    fetchSliceHistory: async () => {
      const actions = await loadSliceActions();
      if (actions) await actions.fetchSliceHistory();
    },

    saveActiveSlice: async (customName?: string) => {
      const actions = await loadSliceActions();
      return actions ? actions.saveActiveSlice(customName) : null;
    },

    recordSliceExport: async (payload: {
      slicePath: string;
      sourceSampleId?: number | null;
      sourceFilePath: string;
      startSec: number;
      endSec: number;
      pitchSemitones?: number;
      applyMicroFade?: boolean;
    }) => {
      const actions = await loadSliceActions();
      return actions ? actions.recordSliceExport(payload) : null;
    },

    toggleSliceFavorite: async (sliceId: number) => {
      const actions = await loadSliceActions();
      if (actions) await actions.toggleSliceFavorite(sliceId);
    },

    toggleSliceFavoritesBatch: async (sliceIds: number[], isFavorite: boolean) => {
      const actions = await loadSliceActions();
      if (actions) await actions.toggleSliceFavoritesBatch(sliceIds, isFavorite);
    },

    batchRenameSlices: async (
      entries: Array<{ slice_id: number; new_stem: string }>,
      opts?: { isHistoryReplay?: boolean }
    ) => {
      const actions = await loadSliceActions();
      if (actions) await actions.batchRenameSlices(entries, opts);
    },

    clearMissingSlices: async () => {
      const actions = await loadSliceActions();
      return actions ? actions.clearMissingSlices() : 0;
    },

    trashSliceFiles: async (
      sliceIds: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => {
      const actions = await loadSliceActions();
      if (actions) await actions.trashSliceFiles(sliceIds, opts);
    },

    fetchSliceTrashStatus: async () => {
      const actions = await loadSliceActions();
      if (actions) await actions.fetchSliceTrashStatus();
    },

    fetchTrashedSlices: async () => {
      const actions = await loadSliceActions();
      if (actions) await actions.fetchTrashedSlices();
    },

    restoreTrashedSlices: async (
      sliceIds?: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => {
      const actions = await loadSliceActions();
      return actions ? actions.restoreTrashedSlices(sliceIds, opts) : [];
    },

    emptyTrashedSlices: async (sliceIds?: number[]) => {
      const actions = await loadSliceActions();
      return actions ? actions.emptyTrashedSlices(sliceIds) : null;
    },

    undoLastSliceOp: async () => {
      const actions = await loadSliceActions();
      if (actions) await actions.undoLastSliceOp();
    },

    redoLastSliceOp: async () => {
      const actions = await loadSliceActions();
      if (actions) await actions.redoLastSliceOp();
    },

    selectSliceForPreview: (entry: SliceHistoryEntry, shouldPlay = true) =>
      previewEntry(entry, shouldPlay),

    jumpToSliceSource: async (entry: SliceHistoryEntry) => {
      const actions = await loadSliceActions();
      if (actions) await actions.jumpToSliceSource(entry);
    },
  };
}
