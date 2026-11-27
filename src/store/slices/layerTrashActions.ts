import { invoke } from "@tauri-apps/api/core";
import type { LayerHistoryEntry, LayerTrashSummary } from "../../types";
import { resolveNextTrashViewState } from "../../utils/viewModes";
import type { StoreSliceContext } from "../types";

export function createLayerTrashActions(
  ctx: StoreSliceContext,
  releaseActiveAudioIfPathMatches: (rawPaths: string[]) => Promise<void>
) {
  const { set, get, applyInstantMemoryFilter, emitNotice, getProfileEpoch } = ctx;

  return {
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
        if (epoch === getProfileEpoch()) {
          set({ isLoadingLayerHistory: false });
        }
      }
    },

    trashLayerFiles: async (layerIds: number[]) => {
      const cleanIds = Array.from(
        new Set(layerIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (cleanIds.length === 0) return;
      const epoch = getProfileEpoch();
      const idSet = new Set(cleanIds);
      const targetPaths = get()
        .layerHistory.filter((l) => idSet.has(l.id))
        .map((l) => l.layer_path);
      await releaseActiveAudioIfPathMatches(targetPaths);

      try {
        const summary = await invoke<LayerTrashSummary>("trash_layer_files", {
          layerIds: cleanIds,
        });
        if (epoch !== getProfileEpoch()) return;
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
      const epoch = getProfileEpoch();
      try {
        const summary = await invoke<LayerTrashSummary>(
          "restore_trashed_layer_files",
          { layerIds: layerIds ?? null }
        );
        if (epoch !== getProfileEpoch()) return;
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
        const trashExitPatch = resolveNextTrashViewState(
          st.trashFilterActive,
          st.trashViewTab,
          {
            tracks: st.trashedCount,
            slices: st.trashedSliceCount,
            layers: summary.trashed_count,
          }
        );
        if (Object.keys(trashExitPatch).length > 0) {
          set(trashExitPatch);
          if (
            trashExitPatch.trashFilterActive === false ||
            trashExitPatch.trashViewTab === "tracks"
          ) {
            if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
              void get().fetchSamples({ preserveMultiSelect: false });
            }
          }
        }
      } catch (err) {
        emitNotice(`Restore layers failed: ${String(err)}`, "error");
      }
    },

    emptyTrashedLayers: async (layerIds?: number[]) => {
      const epoch = getProfileEpoch();
      try {
        const summary = await invoke<LayerTrashSummary>("empty_trashed_layers", {
          layerIds: layerIds ?? null,
        });
        if (epoch !== getProfileEpoch()) return summary;
        const deletedSet = new Set(summary.affected_ids);
        let shouldReloadTracks = false;
        set((state) => {
          const trashExitPatch = resolveNextTrashViewState(
            state.trashFilterActive,
            state.trashViewTab,
            {
              tracks: state.trashedCount,
              slices: state.trashedSliceCount,
              layers: summary.trashed_count,
            }
          );
          shouldReloadTracks =
            trashExitPatch.trashFilterActive === false ||
            trashExitPatch.trashViewTab === "tracks";
          return {
            trashedLayerHistory: state.trashedLayerHistory.filter(
              (l) => !deletedSet.has(l.id)
            ),
            selectedLayerIds: state.selectedLayerIds.filter(
              (id) => !deletedSet.has(id)
            ),
            trashedLayerCount: summary.trashed_count,
            trashedLayerTotalBytes: summary.total_bytes,
            ...trashExitPatch,
          };
        });
        if (shouldReloadTracks) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
            void get().fetchSamples({ preserveMultiSelect: false });
          }
        }
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
  };
}
