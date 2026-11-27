import { SampleItem } from "../../types";
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
  | "createTagFacet"
  | "updateTagFacet"
  | "deleteTagFacet"
  | "reorderTagFacets"
  | "reorderTaxonomyItems"
  | "harmonizeTaxonomyColors"
  | "createTag"
  | "assignTag"
  | "unassignTag"
  | "assignTagBatch"
  | "unassignTagBatch"
  | "clearSampleTags"
  | "renameTag"
  | "updateTagColor"
  | "updateTagTaxonomy"
  | "mergeTags"
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
  | "reparentCollection"
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
  const { set, get } = ctx;

  let cachedSampleActions: ReturnType<
    typeof import("./catalogSampleActions").createCatalogSampleActions
  > | null = null;
  const loadSampleActions = async () => {
    if (!cachedSampleActions) {
      const mod = await import("./catalogSampleActions");
      cachedSampleActions = mod.createCatalogSampleActions(ctx);
    }
    return cachedSampleActions;
  };

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
    toggleFavorite: async (sampleId: number) =>
      (await loadSampleActions()).toggleFavorite(sampleId),
    toggleSampleLoop: async (sampleId: number) =>
      (await loadSampleActions()).toggleSampleLoop(sampleId),
    toggleFavoritesBatch: async (sampleIds: number[], favorite: boolean) =>
      (await loadSampleActions()).toggleFavoritesBatch(sampleIds, favorite),
    ensureFavorite: async (sample: SampleItem) => {
      if (sample.is_favorite) {
        set({
          statusMessage: `"${sample.file_name}" is already in Favorites`,
        });
        return;
      }
      await get().toggleFavorite(sample.id);
    },
    setSampleBpmKey: async (sampleIds, opts) =>
      (await loadSampleActions()).setSampleBpmKey(sampleIds, opts),

    createTagFacet: async (name, domain, color, allowNesting) =>
      (await loadTaxonomyActions()).createTagFacet(
        name,
        domain,
        color,
        allowNesting
      ),
    updateTagFacet: async (facetId, patch) =>
      (await loadTaxonomyActions()).updateTagFacet(facetId, patch),
    deleteTagFacet: async (facetId) =>
      (await loadTaxonomyActions()).deleteTagFacet(facetId),
    reorderTagFacets: async (orderedFacetIds) =>
      (await loadTaxonomyActions()).reorderTagFacets(orderedFacetIds),
    reorderTaxonomyItems: async (orderedTagIds) =>
      (await loadTaxonomyActions()).reorderTaxonomyItems(orderedTagIds),

    harmonizeTaxonomyColors: async (opts) =>
      (await loadTaxonomyActions()).harmonizeTaxonomyColors(opts),
    createTag: async (name, color, opts) =>
      (await loadTaxonomyActions()).createTag(name, color, opts),
    assignTag: async (sampleId, tagId) =>
      (await loadTaxonomyActions()).assignTag(sampleId, tagId),
    unassignTag: async (sampleId, tagId) =>
      (await loadTaxonomyActions()).unassignTag(sampleId, tagId),
    assignTagBatch: async (sampleIds, tagId) =>
      (await loadTaxonomyActions()).assignTagBatch(sampleIds, tagId),
    unassignTagBatch: async (sampleIds, tagId) =>
      (await loadTaxonomyActions()).unassignTagBatch(sampleIds, tagId),
    clearSampleTags: async (sampleIds, facetSlugs) =>
      (await loadTaxonomyActions()).clearSampleTags(sampleIds, facetSlugs),
    renameTag: async (tagId, newName) =>
      (await loadTaxonomyActions()).renameTag(tagId, newName),
    updateTagColor: async (tagId, newColor) =>
      (await loadTaxonomyActions()).updateTagColor(tagId, newColor),
    updateTagTaxonomy: async (tagId, patch) =>
      (await loadTaxonomyActions()).updateTagTaxonomy(tagId, patch),
    mergeTags: async (sourceTagId, targetTagId, addSourceAsAlias) =>
      (await loadTaxonomyActions()).mergeTags(
        sourceTagId,
        targetTagId,
        addSourceAsAlias
      ),
    deleteTag: async (tagId) =>
      (await loadTaxonomyActions()).deleteTag(tagId),
    createGenre: async (name, color, facetSlug) =>
      (await loadTaxonomyActions()).createGenre(name, color, facetSlug),
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
    reparentCollection: async (collectionId, newParentId) =>
      (await loadCollectionActions()).reparentCollection(
        collectionId,
        newParentId
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
