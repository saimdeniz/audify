import { invoke } from "@tauri-apps/api/core";
import { SampleBpmKeyPatch, SampleItem } from "../../types";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  reconcileSelectionAfterFilter,
  shouldPreserveDeckSelection,
} from "../filterEngine";
import { resetPlayheadClock } from "../playheadClock";
import { StoreSliceContext } from "../types";

export function createCatalogSampleActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice, getProfileEpoch } = ctx;

  return {
    toggleFavorite: async (sampleId: number) => {
      const epoch = getProfileEpoch();
      try {
        const isFav = await invoke<boolean>("toggle_favorite", { sampleId });
        if (epoch !== getProfileEpoch()) return;
        set((state) => {
          const pool =
            state.allProfileSamples.length > 0
              ? state.allProfileSamples
              : state.rawSamples;
          const prevSample = pool.find((s) => s.id === sampleId);
          const wasFav = prevSample?.is_favorite ?? false;
          const favDelta = (isFav ? 1 : 0) - (wasFav ? 1 : 0);
          const nextFavoritesCount = Math.max(
            0,
            state.favoritesCount + favDelta
          );
          const updateList = (list: SampleItem[]) =>
            list.map((s) =>
              s.id === sampleId ? { ...s, is_favorite: isFav } : s
            );
          const nextAll = updateList(state.allProfileSamples);
          const nextRaw = updateList(state.rawSamples);
          const removedFromView = state.favoriteOnly && !isFav;
          const nextSamples = removedFromView
            ? state.samples.filter((s) => s.id !== sampleId)
            : updateList(state.samples);
          const candidateSelected =
            state.selectedSample?.id === sampleId
              ? { ...state.selectedSample, is_favorite: isFav }
              : state.selectedSample;

          if (removedFromView) {
            const reconciled = reconcileSelectionAfterFilter(
              nextSamples,
              candidateSelected,
              state.selectedSampleIds,
              true,
              shouldPreserveDeckSelection({
                isPlaying: state.isPlaying,
                selectedSample: candidateSelected,
                layersFilterActive: state.layersFilterActive,
              })
            );
            const selectionChanged =
              (reconciled.nextSelected?.id ?? null) !==
              (state.selectedSample?.id ?? null);
            if (selectionChanged) {
              resetPlayheadClock(0);
            }
            return {
              allProfileSamples: nextAll,
              rawSamples: nextRaw,
              samples: nextSamples,
              favoritesCount: nextFavoritesCount,
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
              statusMessage: "Removed sample from Favorites",
            };
          }

          return {
            allProfileSamples: nextAll,
            rawSamples: nextRaw,
            samples: nextSamples,
            favoritesCount: nextFavoritesCount,
            selectedSample: candidateSelected,
            statusMessage: isFav
              ? "Added sample to Favorites"
              : "Removed sample from Favorites",
          };
        });
      } catch (err) {
        console.error("Failed to toggle favorite:", err);
        emitNotice(`Favorite error: ${String(err)}`, "error");
      }
    },

    toggleSampleLoop: async (sampleId: number) => {
      const epoch = getProfileEpoch();
      try {
        const isLoop = await invoke<boolean>("toggle_sample_loop", { sampleId });
        if (epoch !== getProfileEpoch()) return;
        set((state) => {
          const updateList = (list: SampleItem[]) =>
            list.map((s) =>
              s.id === sampleId ? { ...s, is_loop: isLoop } : s
            );
          const nextAll = updateList(state.allProfileSamples);
          const nextRaw = updateList(state.rawSamples);
          const removedFromView =
            (state.typeFilter === "loop" && !isLoop) ||
            (state.typeFilter === "oneshot" && isLoop);
          const nextSamples = removedFromView
            ? state.samples.filter((s) => s.id !== sampleId)
            : updateList(state.samples);
          const candidateSelected =
            state.selectedSample?.id === sampleId
              ? { ...state.selectedSample, is_loop: isLoop }
              : state.selectedSample;

          if (removedFromView) {
            const reconciled = reconcileSelectionAfterFilter(
              nextSamples,
              candidateSelected,
              state.selectedSampleIds,
              true,
              shouldPreserveDeckSelection({
                isPlaying: state.isPlaying,
                selectedSample: candidateSelected,
                layersFilterActive: state.layersFilterActive,
              })
            );
            const selectionChanged =
              (reconciled.nextSelected?.id ?? null) !==
              (state.selectedSample?.id ?? null);
            if (selectionChanged) {
              resetPlayheadClock(0);
            }
            return {
              allProfileSamples: nextAll,
              rawSamples: nextRaw,
              samples: nextSamples,
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
              statusMessage: isLoop
                ? "Classified sample as Loop (↻)"
                : "Classified sample as One-Shot (→)",
            };
          }

          return {
            allProfileSamples: nextAll,
            rawSamples: nextRaw,
            samples: nextSamples,
            selectedSample: candidateSelected,
            statusMessage: isLoop
              ? "Classified sample as Loop (↻)"
              : "Classified sample as One-Shot (→)",
          };
        });
      } catch (err) {
        console.error("Failed to toggle sample loop class:", err);
        emitNotice(`Classify loop error: ${String(err)}`, "error");
      }
    },

    toggleFavoritesBatch: async (sampleIds: number[], favorite: boolean) => {
      if (sampleIds.length === 0) return;
      const epoch = getProfileEpoch();
      try {
        await invokeCommand("toggle_favorites_batch", { sampleIds, favorite });
        if (epoch !== getProfileEpoch()) return;
        const idSet = new Set(sampleIds);
        set((state) => {
          const pool =
            state.allProfileSamples.length > 0
              ? state.allProfileSamples
              : state.rawSamples;
          let favDelta = 0;
          for (const s of pool) {
            if (idSet.has(s.id) && s.is_favorite !== favorite) {
              favDelta += favorite ? 1 : -1;
            }
          }
          const nextFavoritesCount = Math.max(
            0,
            state.favoritesCount + favDelta
          );
          const updateList = (list: SampleItem[]) =>
            list.map((s) =>
              idSet.has(s.id) ? { ...s, is_favorite: favorite } : s
            );
          const nextAll = updateList(state.allProfileSamples);
          const nextRaw = updateList(state.rawSamples);
          const removedFromView = state.favoriteOnly && !favorite;
          const nextSamples = removedFromView
            ? state.samples.filter((s) => !idSet.has(s.id))
            : updateList(state.samples);
          const candidateSelected =
            state.selectedSample && idSet.has(state.selectedSample.id)
              ? { ...state.selectedSample, is_favorite: favorite }
              : state.selectedSample;

          if (removedFromView) {
            const reconciled = reconcileSelectionAfterFilter(
              nextSamples,
              candidateSelected,
              state.selectedSampleIds,
              true,
              shouldPreserveDeckSelection({
                isPlaying: state.isPlaying,
                selectedSample: candidateSelected,
                layersFilterActive: state.layersFilterActive,
              })
            );
            const selectionChanged =
              (reconciled.nextSelected?.id ?? null) !==
              (state.selectedSample?.id ?? null);
            if (selectionChanged) {
              resetPlayheadClock(0);
            }
            return {
              allProfileSamples: nextAll,
              rawSamples: nextRaw,
              samples: nextSamples,
              favoritesCount: nextFavoritesCount,
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
              statusMessage: `Removed ${sampleIds.length} samples from Favorites`,
            };
          }

          return {
            allProfileSamples: nextAll,
            rawSamples: nextRaw,
            samples: nextSamples,
            favoritesCount: nextFavoritesCount,
            selectedSample: candidateSelected,
            statusMessage: favorite
              ? `Added ${sampleIds.length} samples to Favorites`
              : `Removed ${sampleIds.length} samples from Favorites`,
          };
        });
      } catch (err) {
        console.error("Failed to batch toggle favorites:", err);
        emitNotice(`Batch favorite error: ${String(err)}`, "error");
      }
    },

    setSampleBpmKey: async (
      sampleIds: number[],
      opts: {
        bpm?: number | null;
        clearBpm?: boolean;
        musicalKey?: string | null;
        clearKey?: boolean;
      }
    ) => {
      if (sampleIds.length === 0) return;
      const epoch = getProfileEpoch();
      try {
        const patches = await invokeCommand("set_sample_bpm_key", {
          sampleIds,
          bpm: opts.bpm ?? null,
          clearBpm: Boolean(opts.clearBpm),
          musicalKey: opts.musicalKey ?? null,
          clearKey: Boolean(opts.clearKey),
        });
        if (epoch !== getProfileEpoch()) return;
        const patchMap = new Map<number, SampleBpmKeyPatch>();
        for (const p of patches) {
          patchMap.set(p.sample_id, p);
        }
        clearSmartSearchCache();

        set((state) => {
          const updateList = (list: SampleItem[]) =>
            list.map((s) => {
              const p = patchMap.get(s.id);
              return p
                ? {
                    ...s,
                    bpm: p.bpm,
                    musical_key: p.musical_key,
                    camelot_key: p.camelot_key,
                  }
                : s;
            });
          const selPatch = state.selectedSample
            ? patchMap.get(state.selectedSample.id)
            : undefined;
          return {
            allProfileSamples: updateList(state.allProfileSamples),
            rawSamples: updateList(state.rawSamples),
            samples: updateList(state.samples),
            selectedSample:
              state.selectedSample && selPatch
                ? {
                    ...state.selectedSample,
                    bpm: selPatch.bpm,
                    musical_key: selPatch.musical_key,
                    camelot_key: selPatch.camelot_key,
                  }
                : state.selectedSample,
            statusMessage:
              sampleIds.length > 1
                ? `Updated BPM / Key on ${sampleIds.length} samples`
                : "Updated sample BPM / Musical Key",
          };
        });

        if (
          get().searchQuery.trim() !== "" ||
          get().sortKey === "bpm" ||
          get().sortKey === "key"
        ) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to update sample BPM/Key:", err);
        emitNotice(`BPM / Key error: ${String(err)}`, "error");
      }
    },
  };
}
