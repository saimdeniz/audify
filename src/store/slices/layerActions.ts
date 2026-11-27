import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LayerHistoryEntry,
  LayerPreviewResult,
  PreparedLayerDragResult,
  SampleItem,
} from "../../types";
import {
  buildNextLayerRecipeForSamples,
  createLayerDraftVirtualSample,
  isLayerDraftSample,
  layerEntryToPreviewSample,
  MAX_LAYER_CLIPS,
  parseLayerRecipeJson,
  setLayerDraftPreviewPending,
} from "../../utils/layerHelpers";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import {
  getLayerDraftPlayheadSec,
  resetLayerDraftPlayheadClock,
  resetPlayheadClock,
  setLayerDraftPlayheadSec,
} from "../playheadClock";
import type { StoreSliceContext } from "../types";
import { createLayerTrashActions } from "./layerTrashActions";

export function createLayerActions(ctx: StoreSliceContext) {
  const { set, get, emitNotice, getProfileEpoch } = ctx;

  let previewSeq = 0;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let historySeq = 0;

  const cancelPendingPreview = () => {
    if (previewDebounceTimer !== null) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
    setLayerDraftPreviewPending(false);
    previewSeq++;
  };

  const unloadDraftAudioIfActive = async () => {
    await invoke("native_audio_unload").catch(() => {});
  };

  const releaseActiveAudioIfPathMatches = async (rawPaths: string[]) => {
    const selectedPath = get().selectedSample?.file_path;
    if (!selectedPath || rawPaths.length === 0) return;
    const normSel = normalizePathForMatch(selectedPath);
    const matched = rawPaths.some((p) => normalizePathForMatch(p) === normSel);
    if (!matched) return;
    if (get().isPlaying) {
      set({ isPlaying: false });
    }
    await invoke("native_audio_unload").catch(() => {});
  };

  const renderLayerDraftPreview = async (opts?: {
    autoplay?: boolean;
    startSec?: number;
  }): Promise<void> => {
    if (previewDebounceTimer !== null) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
    const reqSeq = ++previewSeq;
    const epoch = getProfileEpoch();
    const st = get();
    const recipe = st.layerDraftRecipe;
    if (recipe.clips.length === 0) {
      setLayerDraftPreviewPending(false);
      resetLayerDraftPlayheadClock(0);
      const wasDraft = isLayerDraftSample(st.selectedSample);
      set({
        layerDraftPreview: null,
        isRenderingLayerPreview: false,
        ...(wasDraft ? { isPlaying: false, durationSec: 0, currentTimeSec: 0 } : {}),
      });
      if (wasDraft) {
        await unloadDraftAudioIfActive();
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
          : Math.max(0, getLayerDraftPlayheadSec());
      const result = await invoke<LayerPreviewResult>("preview_layer_mix", {
        recipe,
        autoplay: shouldAutoplay,
        startSec,
        volume: st.volume,
        looping: st.isLooping,
        normalizePreview: st.normalizePreview,
      });
      if (reqSeq !== previewSeq || epoch !== getProfileEpoch()) return;
      if (result.audioSync?.event === "superseded") {
        set({ isRenderingLayerPreview: false });
        return;
      }

      setLayerDraftPreviewPending(false);
      const virtualSample = createLayerDraftVirtualSample(
        get().layerDraftName,
        result.durationSec,
        result.masterPeaks
      );
      const clampedPos = Math.min(result.durationSec, result.audioSync.positionSec || 0);
      resetPlayheadClock(clampedPos);
      setLayerDraftPlayheadSec(clampedPos);
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
      if (reqSeq !== previewSeq || epoch !== getProfileEpoch()) return;
      setLayerDraftPreviewPending(false);
      set({ isRenderingLayerPreview: false });
      emitNotice(`Layer mix preview failed: ${String(err)}`, "error");
    }
  };

  const schedulePreviewRender = (opts?: { autoplay?: boolean }) => {
    setLayerDraftPreviewPending(true);
    if (previewDebounceTimer !== null) {
      clearTimeout(previewDebounceTimer);
    }
    previewDebounceTimer = setTimeout(() => {
      previewDebounceTimer = null;
      void renderLayerDraftPreview(opts);
    }, 55);
  };

  const trashActions = createLayerTrashActions(
    ctx,
    releaseActiveAudioIfPathMatches
  );

  return {
    ...trashActions,
    cancelPendingPreview,
    unloadDraftAudioIfActive,
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
        if (seq === historySeq && epoch === getProfileEpoch()) {
          set({ isLoadingLayerHistory: false });
        }
      }
    },

    toggleLayerFavorite: async (layerId: number) => {
      const epoch = getProfileEpoch();
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
        if (epoch !== getProfileEpoch()) return;
        set((state) => ({
          layerHistory: state.layerHistory.map((item) =>
            item.id === updated.id ? updated : item
          ),
        }));
      } catch (err) {
        if (epoch === getProfileEpoch()) set({ layerHistory: prev });
        emitNotice(`Failed updating layer favorite: ${String(err)}`, "error");
      }
    },

    toggleLayerFavoritesBatch: async (layerIds: number[], isFavorite: boolean) => {
      const cleanIds = Array.from(
        new Set(layerIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (cleanIds.length === 0) return;
      const epoch = getProfileEpoch();
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
        if (epoch === getProfileEpoch()) set({ layerHistory: prev });
        emitNotice(`Failed updating layer favorites: ${String(err)}`, "error");
      }
    },

    renameLayerItem: async (layerId: number, newName: string) => {
      const epoch = getProfileEpoch();
      const existing = get().layerHistory.find((h) => h.id === layerId);
      if (existing) {
        await releaseActiveAudioIfPathMatches([existing.layer_path]);
      }
      try {
        const updated = await invoke<LayerHistoryEntry>("rename_layer_item", {
          layerId,
          newName,
        });
        if (epoch !== getProfileEpoch()) return updated;
        set((state) => {
          const matchesSelected =
            existing &&
            state.selectedSample &&
            normalizePathForMatch(state.selectedSample.file_path) ===
              normalizePathForMatch(existing.layer_path);
          return {
            layerHistory: state.layerHistory.map((item) =>
              item.id === updated.id ? updated : item
            ),
            ...(matchesSelected
              ? { selectedSample: layerEntryToPreviewSample(updated) }
              : {}),
            ...(state.layerDraftEditingId === updated.id
              ? { layerDraftName: updated.layer_name.replace(/\.wav$/i, "") }
              : {}),
          };
        });
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
      const epoch = getProfileEpoch();
      const byId = new Map(get().layerHistory.map((h) => [h.id, h]));
      const targetPaths = entries
        .map((e) => byId.get(e.layer_id)?.layer_path)
        .filter((p): p is string => Boolean(p));
      await releaseActiveAudioIfPathMatches(targetPaths);

      let renamedCount = 0;
      for (const entry of entries) {
        try {
          const prevEntry = byId.get(entry.layer_id);
          const updated = await invoke<LayerHistoryEntry>("rename_layer_item", {
            layerId: entry.layer_id,
            newName: entry.new_stem,
          });
          renamedCount++;
          if (epoch !== getProfileEpoch()) continue;
          set((state) => {
            const matchesSelected =
              prevEntry &&
              state.selectedSample &&
              normalizePathForMatch(state.selectedSample.file_path) ===
                normalizePathForMatch(prevEntry.layer_path);
            return {
              layerHistory: state.layerHistory.map((item) =>
                item.id === updated.id ? updated : item
              ),
              ...(matchesSelected
                ? { selectedSample: layerEntryToPreviewSample(updated) }
                : {}),
              ...(state.layerDraftEditingId === updated.id
                ? { layerDraftName: updated.layer_name.replace(/\.wav$/i, "") }
                : {}),
            };
          });
        } catch (err) {
          emitNotice(`Rename layer failed: ${String(err)}`, "error");
        }
      }
      if (epoch === getProfileEpoch()) {
        set({ batchRenameLayerIds: null });
      }
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
          playheadSec: getLayerDraftPlayheadSec(),
        });

      if (addedClipIds.length === 0) {
        emitNotice(
          `Layer mix reached the maximum limit of ${MAX_LAYER_CLIPS} clips`,
          "error"
        );
        return;
      }

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
      get().setLayersFilterActive(true, "editor", { skipAutoRender: true });
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

      const epoch = getProfileEpoch();
      if (get().isMiniDock) {
        await get().toggleMiniDock();
      }

      const missingIds = await invoke<string[]>("validate_layer_recipe_sources", {
        recipe: parsed,
      }).catch(() => [] as string[]);
      if (epoch !== getProfileEpoch()) return;

      cancelPendingPreview();
      resetLayerDraftPlayheadClock(0);
      set({
        layerDraftName: entry.layer_name.replace(/\.wav$/i, ""),
        layerDraftEditingId: entry.id,
        layerDraftRecipe: parsed,
        layerDraftDirty: false,
        layerDraftSelectedClipIds: parsed.clips[0] ? [parsed.clips[0].id] : [],
        layerDraftMissingClipIds: missingIds,
        layerDraftUndoStack: [],
        layerDraftRedoStack: [],
        layerDraftPreview: null,
      });
      get().setLayersFilterActive(true, "editor", { skipAutoRender: true });

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
      const epoch = getProfileEpoch();
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
        if (epoch !== getProfileEpoch()) return saved;
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
        if (epoch === getProfileEpoch()) {
          set({ isSavingLayer: false });
        }
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
      const epoch = getProfileEpoch();
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
        if (res.savedRecord && epoch === getProfileEpoch()) {
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
