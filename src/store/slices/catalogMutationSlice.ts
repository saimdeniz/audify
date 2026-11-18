import { invoke } from "@tauri-apps/api/core";
import { SampleBpmKeyPatch, SampleItem } from "../../types";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
import { reconcileSelectionAfterFilter } from "../filterEngine";
import { AUDIFY_STORAGE_KEYS, safeSetItem } from "../storageHelpers";
import { SampleStoreState, StoreSliceContext } from "../types";

export function createCatalogMutationSlice(
  ctx: StoreSliceContext
): Pick<
  SampleStoreState,
  | "toggleFavorite"
  | "toggleSampleLoop"
  | "toggleFavoritesBatch"
  | "ensureFavorite"
  | "createTag"
  | "assignTag"
  | "unassignTag"
  | "assignTagBatch"
  | "clearSampleTags"
  | "renameTag"
  | "updateTagColor"
  | "deleteTag"
  | "createGenre"
  | "renameGenre"
  | "updateGenreColor"
  | "deleteGenre"
  | "assignGenre"
  | "assignGenreBatch"
  | "autoDetectGenres"
  | "setSampleBpmKey"
  | "createCollection"
  | "addToCollection"
  | "addSamplesToCollectionBatch"
  | "addAutoRoutedSamplesToCollection"
  | "removeSamplesFromCollection"
  | "renameCollection"
  | "deleteCollection"
  | "addCollectionTemplate"
  | "updateCollectionTemplate"
  | "deleteCollectionTemplate"
  | "resetCollectionTemplates"
  | "setAutoCreateCollectionSubfolders"
  | "setAutoRouteCollectionDrops"
  | "applyTemplatesToExistingCollection"
  | "pickFolderForCollectionTemplate"
> {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  let cachedTaxonomyActions: ReturnType<
    typeof import("./catalogTaxonomyActions").createCatalogTaxonomyActions
  > | null = null;
  const loadTaxonomyActions = async () => {
    if (!cachedTaxonomyActions) {
      const mod = await import("./catalogTaxonomyActions");
      cachedTaxonomyActions = mod.createCatalogTaxonomyActions(ctx);
    }
    return cachedTaxonomyActions;
  };

  let cachedCollectionActions: ReturnType<
    typeof import("./catalogCollectionActions").createCatalogCollectionActions
  > | null = null;
  const loadCollectionActions = async () => {
    if (!cachedCollectionActions) {
      const mod = await import("./catalogCollectionActions");
      cachedCollectionActions = mod.createCatalogCollectionActions(ctx);
    }
    return cachedCollectionActions;
  };

  let cachedTemplateActions: ReturnType<
    typeof import("./collectionTemplateActions").createCollectionTemplateActions
  > | null = null;
  const loadTemplateActions = async () => {
    if (!cachedTemplateActions) {
      const mod = await import("./collectionTemplateActions");
      cachedTemplateActions = mod.createCollectionTemplateActions(ctx);
    }
    return cachedTemplateActions;
  };

  return {
    toggleFavorite: async (sampleId: number) => {
      try {
        const isFav = await invoke<boolean>("toggle_favorite", { sampleId });
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
              true
            );
            return {
              allProfileSamples: nextAll,
              rawSamples: nextRaw,
              samples: nextSamples,
              favoritesCount: nextFavoritesCount,
              selectedSample: reconciled.nextSelected,
              selectedSampleIds: reconciled.nextSelectedIds,
              lastSelectedIndex: reconciled.nextSelectedIndex,
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
      try {
        const isLoop = await invoke<boolean>("toggle_sample_loop", { sampleId });
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
              true
            );
            return {
              allProfileSamples: nextAll,
              rawSamples: nextRaw,
              samples: nextSamples,
              selectedSample: reconciled.nextSelected,
              selectedSampleIds: reconciled.nextSelectedIds,
              lastSelectedIndex: reconciled.nextSelectedIndex,
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
      try {
        await invokeCommand("toggle_favorites_batch", { sampleIds, favorite });
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
              true
            );
            return {
              allProfileSamples: nextAll,
              rawSamples: nextRaw,
              samples: nextSamples,
              favoritesCount: nextFavoritesCount,
              selectedSample: reconciled.nextSelected,
              selectedSampleIds: reconciled.nextSelectedIds,
              lastSelectedIndex: reconciled.nextSelectedIndex,
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

    ensureFavorite: async (sample: SampleItem) => {
      if (sample.is_favorite) {
        set({
          statusMessage: `"${sample.file_name}" is already in Favorites`,
        });
        return;
      }
      await get().toggleFavorite(sample.id);
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
      try {
        const patches = await invokeCommand("set_sample_bpm_key", {
          sampleIds,
          bpm: opts.bpm ?? null,
          clearBpm: Boolean(opts.clearBpm),
          musicalKey: opts.musicalKey ?? null,
          clearKey: Boolean(opts.clearKey),
        });
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

    createTag: async (name, color) =>
      (await loadTaxonomyActions()).createTag(name, color),
    assignTag: async (sampleId, tagId) =>
      (await loadTaxonomyActions()).assignTag(sampleId, tagId),
    unassignTag: async (sampleId, tagId) =>
      (await loadTaxonomyActions()).unassignTag(sampleId, tagId),
    assignTagBatch: async (sampleIds, tagId) =>
      (await loadTaxonomyActions()).assignTagBatch(sampleIds, tagId),
    clearSampleTags: async (sampleIds) =>
      (await loadTaxonomyActions()).clearSampleTags(sampleIds),
    renameTag: async (tagId, newName) =>
      (await loadTaxonomyActions()).renameTag(tagId, newName),
    updateTagColor: async (tagId, newColor) =>
      (await loadTaxonomyActions()).updateTagColor(tagId, newColor),
    deleteTag: async (tagId) =>
      (await loadTaxonomyActions()).deleteTag(tagId),
    createGenre: async (name, color) =>
      (await loadTaxonomyActions()).createGenre(name, color),
    renameGenre: async (genreId, newName) =>
      (await loadTaxonomyActions()).renameGenre(genreId, newName),
    updateGenreColor: async (genreId, newColor) =>
      (await loadTaxonomyActions()).updateGenreColor(genreId, newColor),
    deleteGenre: async (genreId) =>
      (await loadTaxonomyActions()).deleteGenre(genreId),
    assignGenre: async (sampleId, genreName) =>
      (await loadTaxonomyActions()).assignGenre(sampleId, genreName),
    assignGenreBatch: async (sampleIds, genreName) =>
      (await loadTaxonomyActions()).assignGenreBatch(sampleIds, genreName),
    autoDetectGenres: async () =>
      (await loadTaxonomyActions()).autoDetectGenres(),

    createCollection: async (
      name,
      color,
      icon,
      parentId,
      rulePath,
      smartQuery
    ) =>
      (await loadCollectionActions()).createCollection(
        name,
        color,
        icon,
        parentId,
        rulePath,
        smartQuery
      ),
    addToCollection: async (collectionId, sampleId) =>
      (await loadCollectionActions()).addToCollection(collectionId, sampleId),
    addSamplesToCollectionBatch: async (collectionId, sampleIds) =>
      (await loadCollectionActions()).addSamplesToCollectionBatch(
        collectionId,
        sampleIds
      ),
    addAutoRoutedSamplesToCollection: async (targetCollectionId, samplesToAdd) =>
      (await loadCollectionActions()).addAutoRoutedSamplesToCollection(
        targetCollectionId,
        samplesToAdd
      ),
    removeSamplesFromCollection: async (collectionId, sampleIds) =>
      (await loadCollectionActions()).removeSamplesFromCollection(
        collectionId,
        sampleIds
      ),
    renameCollection: async (
      collectionId,
      newName,
      newColor,
      newIcon,
      newRulePath,
      newSmartQuery
    ) =>
      (await loadCollectionActions()).renameCollection(
        collectionId,
        newName,
        newColor,
        newIcon,
        newRulePath,
        newSmartQuery
      ),
    deleteCollection: async (collectionId) =>
      (await loadCollectionActions()).deleteCollection(collectionId),

    addCollectionTemplate: async (template) =>
      (await loadTemplateActions()).addCollectionTemplate(template),
    updateCollectionTemplate: async (id, patch) =>
      (await loadTemplateActions()).updateCollectionTemplate(id, patch),
    deleteCollectionTemplate: async (id) =>
      (await loadTemplateActions()).deleteCollectionTemplate(id),
    resetCollectionTemplates: async () =>
      (await loadTemplateActions()).resetCollectionTemplates(),
    setAutoCreateCollectionSubfolders: (
      autoCreateCollectionSubfolders: boolean
    ) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.autoCreateSubfolders,
        String(autoCreateCollectionSubfolders)
      );
      set({
        autoCreateCollectionSubfolders,
        statusMessage: autoCreateCollectionSubfolders
          ? "Auto-create sub-folders on new collections enabled"
          : "Auto-create sub-folders on new collections disabled",
      });
      void get().persistActiveProfileSettings();
    },
    setAutoRouteCollectionDrops: (autoRouteCollectionDrops: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.autoRouteCollectionDrops,
        String(autoRouteCollectionDrops)
      );
      set({
        autoRouteCollectionDrops,
        statusMessage: autoRouteCollectionDrops
          ? "Smart path routing on collection drop enabled"
          : "Smart path routing on collection drop disabled",
      });
      void get().persistActiveProfileSettings();
    },
    applyTemplatesToExistingCollection: async (collectionId) =>
      (await loadTemplateActions()).applyTemplatesToExistingCollection(
        collectionId
      ),
    pickFolderForCollectionTemplate: async () =>
      (await loadTemplateActions()).pickFolderForCollectionTemplate(),
  };
}
