import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LayerHistoryEntry,
  LayerPreviewResult,
  LayerTrashSummary,
  PreparedLayerDragResult,
  SampleItem,
} from "../../types";
import {
  buildNextLayerRecipeForSamples,
  createLayerDraftVirtualSample,
  isLayerDraftSample,
  parseLayerRecipeJson,
} from "../../utils/layerHelpers";
import { seedPeaksCache } from "../../utils/peaksStore";
import { getPlayheadSec, resetPlayheadClock } from "../playheadClock";
import type { StoreSliceContext } from "../types";

export function createLayerActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice, getProfileEpoch } = ctx;

  let previewSeq = 0;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let historySeq = 0;

  const renderLayerDraftPreview = async (opts?: {
    autoplay?: boolean;
    startSec?: number;
  }): Promise<void> => {
    const reqSeq = ++previewSeq;
    const st = get();
    const recipe = st.layerDraftRecipe;
    if (recipe.clips.length === 0) {
      set({
        layerDraftPreview: null,
        isRenderingLayerPreview: false,
      });
      if (isLayerDraftSample(st.selectedSample)) {
        set({ isPlaying: false, durationSec: 0, currentTimeSec: 0 });
      }
      return;
    }

    set({ isRenderingLayerPreview: true });
    try {
      const shouldAutoplay =
        opts?.autoplay !== undefined
          ? opts.autoplay
          : isLayerDraftSample(st.selectedSample) && st.isPlaying;
      const startSec =
        opts?.startSec !== undefined
          ? Math.max(0, opts.startSec)
          : isLayerDraftSample(st.selectedSample)
          ? Math.max(0, getPlayheadSec())
          : 0;
      const result = await invoke<LayerPreviewResult>("preview_layer_mix", {
        recipe,
        autoplay: shouldAutoplay,
        startSec,
        volume: st.volume,
        looping: st.isLooping,
        normalizePreview: st.normalizePreview,
      });
      if (reqSeq !== previewSeq) return;

      const virtualSample = createLayerDraftVirtualSample(
        get().layerDraftName,
        result.durationSec,
        result.masterPeaks
      );
      seedPeaksCache([virtualSample]);
      const clampedPos = Math.min(result.durationSec, result.audioSync.positionSec || 0);
      resetPlayheadClock(clampedPos);
      set({
        isRenderingLayerPreview: false,
        layerDraftPreview: {
          durationSec: result.durationSec,
          masterPeaks: result.masterPeaks,
          lanePeaks: result.lanePeaks,
          peakDb: result.peakDb,
          clipped: result.clipped,
        },
        selectedSample: virtualSample,
        durationSec: result.durationSec,
        currentTimeSec: clampedPos,
        isPlaying: Boolean(result.audioSync.isPlaying),
        sliceRange: null,
      });
    } catch (err) {
      if (reqSeq !== previewSeq) return;
      set({ isRenderingLayerPreview: false });
      emitNotice(`Layer mix preview failed: ${String(err)}`, "error");
    }
  };

  const schedulePreviewRender = (opts?: { autoplay?: boolean }) => {
    if (previewDebounceTimer !== null) {
      clearTimeout(previewDebounceTimer);
    }
    previewDebounceTimer = setTimeout(() => {
      previewDebounceTimer = null;
      void renderLayerDraftPreview(opts);
    }, 55);
  };

  return {
    schedulePreviewRender,
    renderLayerDraftPreview,

    pickCustomLayerExportPath: async () => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Custom Layers Export Folder",
        });
        if (!selected || typeof selected !== "string") return;
        get().setCustomLayerExportPath(selected);
      } catch (err) {
        console.error("Failed to pick custom layers folder:", err);
      }
    },

    openLayersFolder: async () => {
      try {
        await invoke("open_layers_folder", {
          customDir: get().customLayerExportPath || null,
        });
      } catch (err) {
        emitNotice(`Open layers folder failed: ${String(err)}`, "error");
      }
    },

    fetchLayerHistory: async () => {
      const seq = ++historySeq;
      const epoch = getProfileEpoch();
      set({ isLoadingLayerHistory: true });
      try {
        const list = await invoke<LayerHistoryEntry[]>("list_layer_history");
        if (seq !== historySeq || epoch !== getProfileEpoch()) return;
        set({
          layerHistory: Array.isArray(list) ? list : [],
          isLoadingLayerHistory: false,
        });
      } catch {
        if (seq === historySeq) {
          set({ isLoadingLayerHistory: false });
        }
      }
    },

    fetchLayerTrashStatus: async () => {
      const epoch = getProfileEpoch();
      try {
        const summary = await invoke<LayerTrashSummary>("get_layer_trash_status");
        if (epoch !== getProfileEpoch()) return;
        set({
          trashedLayerCount: summary?.trashed_count ?? 0,
          trashedLayerTotalBytes: summary?.total_bytes ?? 0,
        });
      } catch {
        // Ignore non-Tauri test environments
      }
    },

    fetchTrashedLayers: async () => {
      const epoch = getProfileEpoch();
      set({ isLoadingLayerHistory: true });
      try {
        const [list, summary] = await Promise.all([
          invoke<LayerHistoryEntry[]>("list_trashed_layers"),
          invoke<LayerTrashSummary>("get_layer_trash_status").catch(() => null),
        ]);
        if (epoch !== getProfileEpoch()) return;
        const cleanList = Array.isArray(list) ? list : [];
        set({
          trashedLayerHistory: cleanList,
          trashedLayerCount:
            summary && typeof summary.trashed_count === "number"
              ? summary.trashed_count
              : cleanList.length,
          trashedLayerTotalBytes:
            summary && typeof summary.total_bytes === "number"
              ? summary.total_bytes
              : 0,
          isLoadingLayerHistory: false,
        });
      } catch {
        set({ isLoadingLayerHistory: false });
      }
    },

    toggleLayerFavorite: async (layerId: number) => {
      const prev = get().layerHistory;
      set({
        layerHistory: prev.map((item) =>
          item.id === layerId ? { ...item, is_favorite: !item.is_favorite } : item
        ),
      });
      try {
        const updated = await invoke<LayerHistoryEntry>("toggle_layer_favorite", {
          layerId,
        });
        set((state) => ({
          layerHistory: state.layerHistory.map((item) =>
            item.id === updated.id ? updated : item
          ),
        }));
      } catch (err) {
        set({ layerHistory: prev });
        emitNotice(`Failed updating layer favorite: ${String(err)}`, "error");
      }
    },

    toggleLayerFavoritesBatch: async (layerIds: number[], isFavorite: boolean) => {
      const cleanIds = Array.from(
        new Set(layerIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (cleanIds.length === 0) return;
      const idSet = new Set(cleanIds);
      const prev = get().layerHistory;
      set({
        layerHistory: prev.map((item) =>
          idSet.has(item.id) ? { ...item, is_favorite: isFavorite } : item
        ),
      });
      try {
        await invoke("toggle_layer_favorites_batch", {
          layerIds: cleanIds,
          isFavorite,
        });
      } catch (err) {
        set({ layerHistory: prev });
        emitNotice(`Failed updating layer favorites: ${String(err)}`, "error");
      }
    },

    renameLayerItem: async (layerId: number, newName: string) => {
      try {
        const updated = await invoke<LayerHistoryEntry>("rename_layer_item", {
          layerId,
          newName,
        });
        set((state) => ({
          layerHistory: state.layerHistory.map((item) =>
            item.id === updated.id ? updated : item
          ),
          ...(state.layerDraftEditingId === updated.id
            ? { layerDraftName: updated.layer_name.replace(/\.wav$/i, "") }
            : {}),
        }));
        emitNotice(`Renamed layer to "${updated.layer_name}"`, "success");
        return updated;
      } catch (err) {
        emitNotice(`Rename layer failed: ${String(err)}`, "error");
        return null;
      }
    },

    batchRenameLayers: async (
      entries: Array<{ layer_id: number; new_stem: string }>
    ) => {
      let renamedCount = 0;
      for (const entry of entries) {
        try {
          const updated = await invoke<LayerHistoryEntry>("rename_layer_item", {
            layerId: entry.layer_id,
            newName: entry.new_stem,
          });
          renamedCount++;
          set((state) => ({
            layerHistory: state.layerHistory.map((item) =>
              item.id === updated.id ? updated : item
            ),
            ...(state.layerDraftEditingId === updated.id
              ? { layerDraftName: updated.layer_name.replace(/\.wav$/i, "") }
              : {}),
          }));
        } catch (err) {
          emitNotice(`Rename layer failed: ${String(err)}`, "error");
        }
      }
      set({ batchRenameLayerIds: null });
      if (renamedCount > 0) {
        emitNotice(
          renamedCount === 1
            ? "Renamed layer file"
            : `Renamed ${renamedCount} layer files`,
          "success"
        );
      }
      return renamedCount;
    },

    clearMissingLayers: async () => {
      try {
        const removed = await invoke<number>("clear_missing_layers");
        await get().fetchLayerHistory();
        if (removed > 0) {
          emitNotice(`Removed ${removed} missing layer record(s)`, "info");
        }
        return removed;
      } catch (err) {
        emitNotice(`Failed clearing missing layers: ${String(err)}`, "error");
        return 0;
      }
    },

    trashLayerFiles: async (layerIds: number[]) => {
      const cleanIds = Array.from(
        new Set(layerIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (cleanIds.length === 0) return;
      try {
        const summary = await invoke<LayerTrashSummary>("trash_layer_files", {
          layerIds: cleanIds,
        });
        const trashedSet = new Set(summary.affected_ids);
        set((state) => ({
          layerHistory: state.layerHistory.filter((l) => !trashedSet.has(l.id)),
          selectedLayerIds: state.selectedLayerIds.filter(
            (id) => !trashedSet.has(id)
          ),
          trashedLayerCount: summary.trashed_count,
          trashedLayerTotalBytes: summary.total_bytes,
          ...(state.layerDraftEditingId !== null &&
          trashedSet.has(state.layerDraftEditingId)
            ? { layerDraftEditingId: null }
            : {}),
        }));
        emitNotice(
          `Moved ${summary.affected_count} layer(s) to Trash`,
          "info"
        );
      } catch (err) {
        emitNotice(`Move layer to Trash failed: ${String(err)}`, "error");
      }
    },

    restoreTrashedLayers: async (layerIds?: number[]) => {
      try {
        const summary = await invoke<LayerTrashSummary>(
          "restore_trashed_layer_files",
          { layerIds: layerIds ?? null }
        );
        const restoredSet = new Set(summary.affected_ids);
        set((state) => ({
          trashedLayerHistory: state.trashedLayerHistory.filter(
            (l) => !restoredSet.has(l.id)
          ),
          selectedLayerIds: state.selectedLayerIds.filter(
            (id) => !restoredSet.has(id)
          ),
          trashedLayerCount: summary.trashed_count,
          trashedLayerTotalBytes: summary.total_bytes,
        }));
        await get().fetchLayerHistory();
        emitNotice(
          `Restored ${summary.affected_count} layer(s) from Trash`,
          "success"
        );
        const st = get();
        if (
          st.trashFilterActive &&
          st.trashedCount === 0 &&
          st.trashedSliceCount === 0 &&
          summary.trashed_count === 0
        ) {
          set({ trashFilterActive: false, trashViewTab: "tracks" });
          if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
            void get().fetchSamples({ preserveMultiSelect: false });
          }
        }
      } catch (err) {
        emitNotice(`Restore layers failed: ${String(err)}`, "error");
      }
    },

    emptyTrashedLayers: async (layerIds?: number[]) => {
      try {
        const summary = await invoke<LayerTrashSummary>("empty_trashed_layers", {
          layerIds: layerIds ?? null,
        });
        const deletedSet = new Set(summary.affected_ids);
        set((state) => ({
          trashedLayerHistory: state.trashedLayerHistory.filter(
            (l) => !deletedSet.has(l.id)
          ),
          selectedLayerIds: state.selectedLayerIds.filter(
            (id) => !deletedSet.has(id)
          ),
          trashedLayerCount: summary.trashed_count,
          trashedLayerTotalBytes: summary.total_bytes,
        }));
        emitNotice(
          `Moved ${summary.affected_count} trashed layer(s) to Recycle Bin`,
          "info"
        );
        return summary;
      } catch (err) {
        emitNotice(`Empty layer trash failed: ${String(err)}`, "error");
        return null;
      }
    },

    sendSamplesToLayers: async (
      samples: SampleItem[],
      mode: "current" | "new" | "active-lane" = "current"
    ) => {
      const valid = samples.filter((s) => Boolean(s?.file_path?.trim()));
      if (valid.length === 0) return;

      const st = get();
      const prevRecipe = st.layerDraftRecipe;
      const { nextRecipe, nextName, nextEditingId, addedClipIds, isFresh } =
        buildNextLayerRecipeForSamples({
          prevRecipe,
          prevName: st.layerDraftName,
          prevEditingId: st.layerDraftEditingId,
          selectedClipIds: st.layerDraftSelectedClipIds,
          samples: valid,
          mode,
          playheadSec: getPlayheadSec(),
        });

      if (st.isMiniDock) {
        await get().toggleMiniDock();
      }

      set({
        layerDraftRecipe: nextRecipe,
        layerDraftName: nextName,
        layerDraftEditingId: nextEditingId,
        layerDraftDirty: true,
        layerDraftSelectedClipIds: addedClipIds,
        layerDraftMissingClipIds: [],
        layerDraftUndoStack: [...st.layerDraftUndoStack.slice(-59), prevRecipe],
        layerDraftRedoStack: [],
      });
      get().setLayersFilterActive(true, "editor");
      emitNotice(
        isFresh
          ? `Created new layer with ${addedClipIds.length} track(s)`
          : mode === "active-lane"
          ? `Added ${addedClipIds.length} track(s) to active lane at playhead`
          : `Appended ${addedClipIds.length} track(s) to current layer (Ctrl+Z to undo)`,
        "success"
      );
      await renderLayerDraftPreview({ autoplay: false, startSec: 0 });
    },

    openSavedLayerInEditor: async (entry: LayerHistoryEntry) => {
      const parsed = parseLayerRecipeJson(entry.recipe_json);
      if (!parsed || parsed.lanes.length === 0) {
        emitNotice("Saved layer recipe could not be loaded", "error");
        return;
      }

      if (get().isMiniDock) {
        await get().toggleMiniDock();
      }

      const missingIds = await invoke<string[]>("validate_layer_recipe_sources", {
        recipe: parsed,
      }).catch(() => [] as string[]);

      set({
        layerDraftName: entry.layer_name.replace(/\.wav$/i, ""),
        layerDraftEditingId: entry.id,
        layerDraftRecipe: parsed,
        layerDraftDirty: false,
        layerDraftSelectedClipIds: parsed.clips[0] ? [parsed.clips[0].id] : [],
        layerDraftMissingClipIds: missingIds,
        layerDraftUndoStack: [],
        layerDraftRedoStack: [],
      });
      get().setLayersFilterActive(true, "editor");

      if (missingIds.length > 0) {
        emitNotice(
          `${missingIds.length} source clip(s) missing on disk — saved .wav remains playable`,
          "info"
        );
      } else {
        await renderLayerDraftPreview({ autoplay: false, startSec: 0 });
      }
    },

    saveLayerDraft: async (opts?: { name?: string; overwrite?: boolean }) => {
      const st = get();
      if (st.layerDraftRecipe.clips.length === 0) {
        emitNotice("Add at least one clip before saving a layer", "error");
        return null;
      }
      const targetName = (opts?.name ?? st.layerDraftName).trim() || "Untitled_Layer";
      const overwriteId =
        opts?.overwrite && st.layerDraftEditingId !== null
          ? st.layerDraftEditingId
          : null;

      set({ isSavingLayer: true });
      try {
        const saved = await invoke<LayerHistoryEntry>("save_layer_mix", {
          recipe: st.layerDraftRecipe,
          name: targetName,
          overwriteLayerId: overwriteId,
          customDir: st.customLayerExportPath || null,
          exportPreset: st.exportAudioPreset,
          exportLoudnessMode: st.exportLoudnessMode,
        });
        set((state) => {
          const exists = state.layerHistory.some((h) => h.id === saved.id);
          const nextHistory = exists
            ? state.layerHistory.map((h) => (h.id === saved.id ? saved : h))
            : [saved, ...state.layerHistory];
          return {
            isSavingLayer: false,
            layerHistory: nextHistory,
            layerDraftName: saved.layer_name.replace(/\.wav$/i, ""),
            layerDraftEditingId: saved.id,
            layerDraftDirty: false,
          };
        });
        emitNotice(
          overwriteId
            ? `Updated layer "${saved.layer_name}"`
            : `Saved layer "${saved.layer_name}"`,
          "success"
        );
        return saved;
      } catch (err) {
        set({ isSavingLayer: false });
        emitNotice(`Failed saving layer: ${String(err)}`, "error");
        return null;
      }
    },

    prepareLayerDraftForNleDrag: async () => {
      const st = get();
      if (st.layerDraftRecipe.clips.length === 0) {
        emitNotice("Add at least one clip before dragging mix to NLE", "error");
        return null;
      }
      try {
        const res = await invoke<PreparedLayerDragResult>(
          "prepare_layer_drag_wav",
          {
            recipe: st.layerDraftRecipe,
            suggestedName: st.layerDraftName || "Layer_Mix",
            autoSave: st.autoSaveLayerOnNleDrag,
            customDir: st.customLayerExportPath || null,
            exportPreset: st.exportAudioPreset,
            exportLoudnessMode: st.exportLoudnessMode,
          }
        );
        if (res.savedRecord) {
          const saved = res.savedRecord;
          set((state) => ({
            layerHistory: [
              saved,
              ...state.layerHistory.filter((h) => h.id !== saved.id),
            ],
            layerDraftEditingId: saved.id,
            layerDraftDirty: false,
          }));
        }
        return res;
      } catch (err) {
        emitNotice(`Failed preparing mix for drag: ${String(err)}`, "error");
        return null;
      }
    },
  };
}
