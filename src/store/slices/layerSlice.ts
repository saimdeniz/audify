import {
  LayerClipSpec,
  LayerHistoryEntry,
  LayerRecipe,
  LayerSortKey,
  LayerTrashSummary,
  LayersWorkspaceTab,
  PreparedLayerDragResult,
  SampleItem,
} from "../../types";
import {
  createEmptyLayerRecipe,
  isLayerDraftSample,
  layerEntryToPreviewSample,
  MAX_LAYER_CLIPS,
  setLayerDraftPreviewPending,
} from "../../utils/layerHelpers";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { resetLayerDraftPlayheadClock } from "../playheadClock";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export interface LayerSliceActions {
  setCustomLayerExportPath: (path: string) => void;
  pickCustomLayerExportPath: () => Promise<void>;
  openLayersFolder: () => Promise<void>;
  setAutoSaveLayerOnNleDrag: (enabled: boolean) => void;

  setLayersFilterActive: (
    active: boolean,
    initialTab?: LayersWorkspaceTab,
    opts?: { skipAutoRender?: boolean }
  ) => void;
  setLayersWorkspaceTab: (tab: LayersWorkspaceTab) => void;
  setLayersSplitLibraryOpen: (open: boolean) => void;
  setLayerHideMissing: (hide: boolean) => void;
  cycleLayerSort: (key: LayerSortKey) => void;
  setLayerSelection: (ids: number[], activeId: number | null) => void;
  selectLayerForPreview: (entry: LayerHistoryEntry, shouldPlay?: boolean) => void;

  fetchLayerHistory: () => Promise<void>;
  fetchLayerTrashStatus: () => Promise<void>;
  fetchTrashedLayers: () => Promise<void>;
  toggleLayerFavorite: (layerId: number) => Promise<void>;
  toggleLayerFavoritesBatch: (layerIds: number[], isFavorite: boolean) => Promise<void>;
  renameLayerItem: (layerId: number, newName: string) => Promise<LayerHistoryEntry | null>;
  openBatchRenameLayersModal: (layerIds: number[]) => void;
  closeBatchRenameLayersModal: () => void;
  batchRenameLayers: (
    entries: Array<{ layer_id: number; new_stem: string }>
  ) => Promise<number>;
  clearMissingLayers: () => Promise<number>;
  trashLayerFiles: (layerIds: number[]) => Promise<void>;
  restoreTrashedLayers: (layerIds?: number[]) => Promise<void>;
  emptyTrashedLayers: (layerIds?: number[]) => Promise<LayerTrashSummary | null>;

  sendSamplesToLayers: (
    samples: SampleItem[],
    mode?: "current" | "new" | "active-lane"
  ) => Promise<void>;
  openSavedLayerInEditor: (entry: LayerHistoryEntry) => Promise<void>;
  resetLayerDraft: () => void;
  setLayerDraftName: (name: string) => void;
  setLayerDraftSelectedClipIds: (clipIds: string[]) => void;
  setLayerDraftClipboardClips: (clips: LayerClipSpec[]) => void;
  updateLayerDraftRecipe: (
    nextRecipe: LayerRecipe,
    opts?: { pushUndo?: boolean; autoRender?: boolean; autoplay?: boolean }
  ) => void;
  undoLayerDraft: () => void;
  redoLayerDraft: () => void;
  renderLayerDraftPreview: (opts?: {
    autoplay?: boolean;
    startSec?: number;
  }) => Promise<void>;
  saveLayerDraft: (opts?: {
    name?: string;
    overwrite?: boolean;
  }) => Promise<LayerHistoryEntry | null>;
  prepareLayerDraftForNleDrag: () => Promise<PreparedLayerDragResult | null>;
}

export function createLayerSlice(ctx: StoreSliceContext): LayerSliceActions {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  type LayerActionsInstance = ReturnType<
    typeof import("./layerActions").createLayerActions
  >;
  let cachedActions: LayerActionsInstance | null = null;
  let pendingActions: Promise<LayerActionsInstance | null> | null = null;

  const loadActions = async (): Promise<LayerActionsInstance | null> => {
    if (cachedActions) return cachedActions;
    if (!pendingActions) {
      pendingActions = import("./layerActions")
        .then((mod) => {
          if (typeof mod?.createLayerActions !== "function") return null;
          cachedActions = mod.createLayerActions(ctx);
          return cachedActions;
        })
        .catch(() => null)
        .finally(() => {
          pendingActions = null;
        });
    }
    return pendingActions;
  };

  return {
    setCustomLayerExportPath: (customLayerExportPath: string) => {
      const clean = customLayerExportPath.trim();
      safeSetItem(AUDIFY_STORAGE_KEYS.customLayerExportPath, clean);
      set({
        customLayerExportPath: clean,
        statusMessage: clean
          ? `Set custom layers export folder: ${clean}`
          : "Reset layers export folder to default (user/layers)",
      });
      void get().persistActiveProfileSettings();
    },

    pickCustomLayerExportPath: async () => {
      const actions = await loadActions();
      await actions?.pickCustomLayerExportPath();
    },

    openLayersFolder: async () => {
      const actions = await loadActions();
      await actions?.openLayersFolder();
    },

    setAutoSaveLayerOnNleDrag: (autoSaveLayerOnNleDrag: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.autoSaveLayerOnNleDrag,
        String(autoSaveLayerOnNleDrag)
      );
      set({
        autoSaveLayerOnNleDrag,
        statusMessage: autoSaveLayerOnNleDrag
          ? "Auto-save layer to disk on NLE drag enabled"
          : "Auto-save layer on NLE drag disabled (uses preview cache)",
      });
      void get().persistActiveProfileSettings();
    },

    setLayersFilterActive: (
      active: boolean,
      initialTab?: LayersWorkspaceTab,
      opts?: { skipAutoRender?: boolean }
    ) => {
      if (active) {
        const st = get();
        const nextTab = initialTab ?? st.layersWorkspaceTab;
        if (nextTab === "saved") {
          clearSmartSearchCache();
          persistNavigationFilters(null, null, false, null);
        }
        set({
          layersFilterActive: true,
          layersWorkspaceTab: nextTab,
          slicesFilterActive: false,
          duplicatesFilterActive: false,
          trashFilterActive: false,
          trashViewTab: "tracks",
          binFilterActive: false,
          favoriteOnly: false,
          ...(nextTab === "saved"
            ? {
                recentOnly: false,
                folderFilter: null,
                selectedLicenseGroupId: null,
                selectedCollectionId: null,
                selectedTagIds: [],
                selectedGenre: null,
              }
            : {}),
          ...(st.isPlaying ? {} : { sliceRange: null }),
        });
        void get().fetchLayerHistory();
        void get().fetchLayerTrashStatus();
        if (nextTab === "editor") {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
            void get().fetchSamples({ preserveMultiSelect: false });
          }
        }
        // Reload active mix into WASAPI whenever returning to Editor while idle (never interrupt live playback)
        const after = get();
        if (
          !opts?.skipAutoRender &&
          nextTab === "editor" &&
          after.layerDraftRecipe.clips.length > 0 &&
          after.layerDraftMissingClipIds.length === 0 &&
          !after.isPlaying &&
          (!after.layerDraftPreview || !isLayerDraftSample(after.selectedSample))
        ) {
          void get().renderLayerDraftPreview({ autoplay: false });
        }
        return;
      }

      set({
        layersFilterActive: false,
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setLayersWorkspaceTab: (layersWorkspaceTab: LayersWorkspaceTab) => {
      set({ layersWorkspaceTab });
      if (layersWorkspaceTab === "saved") {
        void get().fetchLayerHistory();
      } else {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
        const st = get();
        if (
          st.layerDraftRecipe.clips.length > 0 &&
          st.layerDraftMissingClipIds.length === 0 &&
          !st.isPlaying &&
          (!st.layerDraftPreview || !isLayerDraftSample(st.selectedSample))
        ) {
          void get().renderLayerDraftPreview({ autoplay: false });
        }
      }
    },

    setLayersSplitLibraryOpen: (layersSplitLibraryOpen: boolean) => {
      set({ layersSplitLibraryOpen });
    },

    setLayerHideMissing: (layerHideMissing: boolean) => {
      set({ layerHideMissing });
    },

    cycleLayerSort: (key: LayerSortKey) => {
      const st = get();
      if (st.layerSortKey !== key) {
        set({
          layerSortKey: key,
          layerSortDir: key === "updated" ? "desc" : "asc",
        });
      } else if (st.layerSortDir === "asc") {
        set({ layerSortDir: "desc" });
      } else {
        set({ layerSortKey: null, layerSortDir: "asc" });
      }
    },

    setLayerSelection: (selectedLayerIds: number[], activeLayerId: number | null) => {
      set({ selectedLayerIds, activeLayerId });
    },

    selectLayerForPreview: (entry: LayerHistoryEntry, shouldPlay = true) => {
      if (!entry.file_exists) {
        set({ activeLayerId: entry.id });
        emitNotice(
          `Layer file "${entry.layer_name}" is missing on disk`,
          "error"
        );
        return;
      }
      set({ activeLayerId: entry.id });
      get().selectSample(layerEntryToPreviewSample(entry), shouldPlay);
    },

    fetchLayerHistory: async () => {
      const actions = await loadActions();
      await actions?.fetchLayerHistory();
    },

    fetchLayerTrashStatus: async () => {
      const actions = await loadActions();
      await actions?.fetchLayerTrashStatus();
    },

    fetchTrashedLayers: async () => {
      const actions = await loadActions();
      await actions?.fetchTrashedLayers();
    },

    toggleLayerFavorite: async (layerId: number) => {
      const actions = await loadActions();
      await actions?.toggleLayerFavorite(layerId);
    },

    toggleLayerFavoritesBatch: async (layerIds: number[], isFavorite: boolean) => {
      const actions = await loadActions();
      await actions?.toggleLayerFavoritesBatch(layerIds, isFavorite);
    },

    renameLayerItem: async (layerId: number, newName: string) => {
      const actions = await loadActions();
      return actions ? actions.renameLayerItem(layerId, newName) : null;
    },

    openBatchRenameLayersModal: (layerIds: number[]) => {
      if (!get().enableAdvancedFileOps) return;
      const clean = Array.from(
        new Set(layerIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (clean.length === 0) return;
      set({ batchRenameLayerIds: clean });
    },

    closeBatchRenameLayersModal: () => set({ batchRenameLayerIds: null }),

    batchRenameLayers: async (
      entries: Array<{ layer_id: number; new_stem: string }>
    ) => {
      const actions = await loadActions();
      return actions ? actions.batchRenameLayers(entries) : 0;
    },

    clearMissingLayers: async () => {
      const actions = await loadActions();
      return actions ? actions.clearMissingLayers() : 0;
    },

    trashLayerFiles: async (layerIds: number[]) => {
      if (!get().enableAdvancedFileOps) {
        emitNotice(
          "Safe Read-Only Mode is active — enable Write Mode in Settings → Advanced to delete layers",
          "info"
        );
        return;
      }
      const actions = await loadActions();
      await actions?.trashLayerFiles(layerIds);
    },

    restoreTrashedLayers: async (layerIds?: number[]) => {
      const actions = await loadActions();
      await actions?.restoreTrashedLayers(layerIds);
    },

    emptyTrashedLayers: async (layerIds?: number[]) => {
      const actions = await loadActions();
      return actions ? actions.emptyTrashedLayers(layerIds) : null;
    },

    sendSamplesToLayers: async (
      samples: SampleItem[],
      mode: "current" | "new" | "active-lane" = "current"
    ) => {
      const actions = await loadActions();
      await actions?.sendSamplesToLayers(samples, mode);
    },

    openSavedLayerInEditor: async (entry: LayerHistoryEntry) => {
      const actions = await loadActions();
      await actions?.openSavedLayerInEditor(entry);
    },

    resetLayerDraft: () => {
      cachedActions?.cancelPendingPreview();
      setLayerDraftPreviewPending(false);
      const wasDraftSelected = isLayerDraftSample(get().selectedSample);
      resetLayerDraftPlayheadClock(0);
      set({
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
        ...(wasDraftSelected
          ? { isPlaying: false, durationSec: 0, currentTimeSec: 0 }
          : {}),
      });
      if (wasDraftSelected) {
        void loadActions().then((a) => a?.unloadDraftAudioIfActive());
      }
    },

    setLayerDraftName: (layerDraftName: string) => {
      set({ layerDraftName, layerDraftDirty: true });
    },

    setLayerDraftSelectedClipIds: (layerDraftSelectedClipIds: string[]) => {
      set({ layerDraftSelectedClipIds });
    },

    setLayerDraftClipboardClips: (layerDraftClipboardClips: LayerClipSpec[]) => {
      set({ layerDraftClipboardClips });
    },

    updateLayerDraftRecipe: (
      nextRecipe: LayerRecipe,
      opts?: { pushUndo?: boolean; autoRender?: boolean; autoplay?: boolean }
    ) => {
      if (nextRecipe.clips.length > MAX_LAYER_CLIPS) {
        emitNotice(
          `Layer mix reached the maximum limit of ${MAX_LAYER_CLIPS} clips`,
          "error"
        );
        return;
      }
      const pushUndo = opts?.pushUndo !== false;
      const prev = get().layerDraftRecipe;
      const undoStack = pushUndo
        ? [...get().layerDraftUndoStack.slice(-59), prev]
        : get().layerDraftUndoStack;
      set({
        layerDraftRecipe: nextRecipe,
        layerDraftDirty: true,
        layerDraftUndoStack: undoStack,
        ...(pushUndo ? { layerDraftRedoStack: [] } : {}),
      });
      if (opts?.autoRender !== false) {
        setLayerDraftPreviewPending(true);
        void loadActions().then((a) =>
          a?.schedulePreviewRender(
            opts?.autoplay !== undefined ? { autoplay: opts.autoplay } : undefined
          )
        );
      }
    },

    undoLayerDraft: () => {
      const st = get();
      if (st.layerDraftUndoStack.length === 0) return;
      const previous = st.layerDraftUndoStack[st.layerDraftUndoStack.length - 1];
      set({
        layerDraftRecipe: previous,
        layerDraftDirty: true,
        layerDraftUndoStack: st.layerDraftUndoStack.slice(0, -1),
        layerDraftRedoStack: [...st.layerDraftRedoStack.slice(-59), st.layerDraftRecipe],
      });
      setLayerDraftPreviewPending(true);
      void loadActions().then((a) => a?.schedulePreviewRender());
    },

    redoLayerDraft: () => {
      const st = get();
      if (st.layerDraftRedoStack.length === 0) return;
      const next = st.layerDraftRedoStack[st.layerDraftRedoStack.length - 1];
      set({
        layerDraftRecipe: next,
        layerDraftDirty: true,
        layerDraftRedoStack: st.layerDraftRedoStack.slice(0, -1),
        layerDraftUndoStack: [...st.layerDraftUndoStack.slice(-59), st.layerDraftRecipe],
      });
      setLayerDraftPreviewPending(true);
      void loadActions().then((a) => a?.schedulePreviewRender());
    },

    renderLayerDraftPreview: async (opts?: {
      autoplay?: boolean;
      startSec?: number;
    }) => {
      const actions = await loadActions();
      await actions?.renderLayerDraftPreview(opts);
    },

    saveLayerDraft: async (opts?: { name?: string; overwrite?: boolean }) => {
      const actions = await loadActions();
      return actions ? actions.saveLayerDraft(opts) : null;
    },

    prepareLayerDraftForNleDrag: async () => {
      const actions = await loadActions();
      return actions ? actions.prepareLayerDraftForNleDrag() : null;
    },
  };
}
