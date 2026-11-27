import React, { Suspense, lazy, useMemo } from "react";
import { X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  folderNameFromPath,
  formatSampleRateKhz,
} from "../../utils/format";
import {
  extractSearchPrefixValues,
  removeSearchPrefixTokens,
} from "../../utils/searchPrefixHelpers";
import {
  ActiveFilterChip,
  ActiveFilterPrimaryChips,
} from "./ActiveFilterPrimaryChips";
import { ActiveTaxonomyChips } from "./ActiveTaxonomyChips";

export {
  extractSearchPrefixValues,
  removeSearchPrefixTokens,
  upsertSearchPrefixToken,
} from "../../utils/searchPrefixHelpers";

const SimilarityReferenceBanner = lazy(() =>
  import("./SimilarityReferenceBanner").then((m) => ({
    default: m.SimilarityReferenceBanner,
  }))
);

export const ActiveFilterBanner: React.FC = () => {
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const collections = useSampleStore((s) => s.collections);
  const selectedLicenseGroupId = useSampleStore(
    (s) => s.selectedLicenseGroupId
  );
  const licenseGroups = useSampleStore((s) => s.licenseGroups);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const recentOnly = useSampleStore((s) => s.recentOnly);
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const layersFilterActive = useSampleStore((s) => s.layersFilterActive);
  const layerHistoryCount = useSampleStore((s) => s.layerHistory.length);
  const sliceHistoryCount = useSampleStore((s) => s.sliceHistory.length);
  const sliceFavoriteOnly = useSampleStore((s) => s.sliceFavoriteOnly);
  const slicePitchOnly = useSampleStore((s) => s.slicePitchOnly);
  const setSliceFavoriteOnly = useSampleStore((s) => s.setSliceFavoriteOnly);
  const setSlicePitchOnly = useSampleStore((s) => s.setSlicePitchOnly);
  const duplicateScanResult = useSampleStore((s) => s.duplicateScanResult);
  const isScanningDuplicates = useSampleStore((s) => s.isScanningDuplicates);
  const duplicateScanProgress = useSampleStore(
    (s) => s.duplicateScanProgress
  );
  const duplicateScanError = useSampleStore((s) => s.duplicateScanError);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedTotalBytes = useSampleStore((s) => s.trashedTotalBytes);
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const trashedSliceTotalBytes = useSampleStore(
    (s) => s.trashedSliceTotalBytes
  );
  const trashedLayerCount = useSampleStore((s) => s.trashedLayerCount);
  const trashedLayerTotalBytes = useSampleStore(
    (s) => s.trashedLayerTotalBytes
  );
  const trashOpStatus = useSampleStore((s) => s.trashOpStatus);
  const typeFilter = useSampleStore((s) => s.typeFilter);
  const srFilter = useSampleStore((s) => s.srFilter);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const genres = useSampleStore((s) => s.genres);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const excludedTagIds = useSampleStore((s) => s.excludedTagIds);
  const tagMatchMode = useSampleStore((s) => s.tagMatchMode);
  const tags = useSampleStore((s) => s.tags);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const similaritySession = useSampleStore((s) => s.similaritySession);
  const aiSuggestionsBySampleId = useSampleStore(
    (s) => s.aiSuggestionsBySampleId
  );

  const setFolderFilter = useSampleStore((s) => s.setFolderFilter);
  const setCollectionFilter = useSampleStore((s) => s.setCollectionFilter);
  const setLicenseGroupFilter = useSampleStore((s) => s.setLicenseGroupFilter);
  const setFavoriteOnly = useSampleStore((s) => s.setFavoriteOnly);
  const setRecentOnly = useSampleStore((s) => s.setRecentOnly);
  const setBinFilterActive = useSampleStore((s) => s.setBinFilterActive);
  const setDuplicatesFilterActive = useSampleStore(
    (s) => s.setDuplicatesFilterActive
  );
  const setSlicesFilterActive = useSampleStore(
    (s) => s.setSlicesFilterActive
  );
  const setLayersFilterActive = useSampleStore(
    (s) => s.setLayersFilterActive
  );
  const setTrashFilterActive = useSampleStore((s) => s.setTrashFilterActive);
  const setTypeFilter = useSampleStore((s) => s.setTypeFilter);
  const setSrFilter = useSampleStore((s) => s.setSrFilter);
  const setSelectedGenre = useSampleStore((s) => s.setSelectedGenre);
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);
  const toggleExcludeTagFilter = useSampleStore(
    (s) => s.toggleExcludeTagFilter
  );
  const toggleTagMatchMode = useSampleStore((s) => s.toggleTagMatchMode);
  const setSearchQuery = useSampleStore((s) => s.setSearchQuery);
  const resetAllFilters = useSampleStore((s) => s.resetAllFilters);
  const setAiSimilarityMinScore = useSampleStore(
    (s) => s.setAiSimilarityMinScore
  );
  const setAiSimilarityScope = useSampleStore((s) => s.setAiSimilarityScope);
  const setAiSimilarityDurationMatch = useSampleStore(
    (s) => s.setAiSimilarityDurationMatch
  );
  const clearSimilaritySearch = useSampleStore((s) => s.clearSimilaritySearch);
  const approveAllAiTagSuggestions = useSampleStore(
    (s) => s.approveAllAiTagSuggestions
  );
  const dismissAllAiTagSuggestions = useSampleStore(
    (s) => s.dismissAllAiTagSuggestions
  );

  const activeCollection = useMemo(
    () =>
      selectedCollectionId !== null
        ? collections.find((c) => c.id === selectedCollectionId) || null
        : null,
    [collections, selectedCollectionId]
  );

  const activeLicenseGroup = useMemo(
    () =>
      selectedLicenseGroupId !== null
        ? licenseGroups.find((g) => g.id === selectedLicenseGroupId) || null
        : null,
    [licenseGroups, selectedLicenseGroupId]
  );

  const activeGenreObj = useMemo(
    () =>
      selectedGenre
        ? genres.find(
            (g) => g.name.toLowerCase() === selectedGenre.toLowerCase()
          ) || null
        : null,
    [genres, selectedGenre]
  );

  const bpmTokens = useMemo(
    () => extractSearchPrefixValues(searchQuery, "bpm:"),
    [searchQuery]
  );
  const keyTokens = useMemo(
    () => extractSearchPrefixValues(searchQuery, "key:"),
    [searchQuery]
  );

  const similarityPendingIds = useMemo(() => {
    if (!similaritySession) return [];
    const ids: number[] = [];
    for (const id of similaritySession.scoresById.keys()) {
      if ((aiSuggestionsBySampleId[id]?.length ?? 0) > 0) {
        ids.push(id);
      }
    }
    return ids;
  }, [similaritySession, aiSuggestionsBySampleId]);

  const hasOtherChip =
    Boolean(folderFilter) ||
    Boolean(activeCollection) ||
    Boolean(activeLicenseGroup) ||
    favoriteOnly ||
    recentOnly ||
    binFilterActive ||
    slicesFilterActive ||
    layersFilterActive ||
    duplicatesFilterActive ||
    trashFilterActive ||
    Boolean(trashOpStatus) ||
    typeFilter !== "all" ||
    srFilter !== null ||
    Boolean(selectedGenre) ||
    selectedTagIds.length > 0 ||
    excludedTagIds.length > 0 ||
    bpmTokens.length > 0 ||
    keyTokens.length > 0;

  const hasAnyChip =
    Boolean(similaritySession) ||
    hasOtherChip;

  if (!hasAnyChip) return null;

  const folderDisplayName = folderFilter
    ? folderNameFromPath(folderFilter, folderFilter)
    : null;

  return (
    <div className="flex flex-col shrink-0">
      {similaritySession && (
        <Suspense fallback={null}>
          <SimilarityReferenceBanner
            similaritySession={similaritySession}
            similarityPendingIds={similarityPendingIds}
            onChangeMinScore={(score) => setAiSimilarityMinScore(score, true)}
            onToggleScope={(scope) => setAiSimilarityScope(scope, true)}
            onToggleDurationMatch={(enabled) =>
              setAiSimilarityDurationMatch(enabled, true)
            }
            onApproveMatchedAi={(ids) => void approveAllAiTagSuggestions(ids)}
            onDismissMatchedAi={(ids) => void dismissAllAiTagSuggestions(ids)}
            onClearSimilarity={clearSimilaritySearch}
          />
        </Suspense>
      )}

      {hasOtherChip && (
        <div className="px-2 py-1 border-b border-line bg-surface-1 flex items-center gap-1.5 flex-wrap shrink-0">
          <ActiveFilterPrimaryChips
            folderFilter={folderFilter}
            folderDisplayName={folderDisplayName}
            activeCollection={activeCollection}
            activeLicenseGroup={activeLicenseGroup}
            favoriteOnly={favoriteOnly}
            favoritesViewTab={favoritesViewTab}
            recentOnly={recentOnly}
            binFilterActive={binFilterActive}
            trashFilterActive={trashFilterActive}
            trashViewTab={trashViewTab}
            trashOpStatus={trashOpStatus}
            trashedCount={trashedCount}
            trashedTotalBytes={trashedTotalBytes}
            trashedSliceCount={trashedSliceCount}
            trashedSliceTotalBytes={trashedSliceTotalBytes}
            trashedLayerCount={trashedLayerCount}
            trashedLayerTotalBytes={trashedLayerTotalBytes}
            layersFilterActive={layersFilterActive}
            layerHistoryCount={layerHistoryCount}
            slicesFilterActive={slicesFilterActive}
            sliceHistoryCount={sliceHistoryCount}
            sliceFavoriteOnly={sliceFavoriteOnly}
            slicePitchOnly={slicePitchOnly}
            duplicatesFilterActive={duplicatesFilterActive}
            isScanningDuplicates={isScanningDuplicates}
            duplicateScanProgress={duplicateScanProgress}
            duplicateScanError={duplicateScanError}
            duplicateScanResult={duplicateScanResult}
            onClearFolder={() => setFolderFilter(null)}
            onClearCollection={() => setCollectionFilter(null)}
            onClearLicenseGroup={() => setLicenseGroupFilter(null, null)}
            onClearFavorite={() => setFavoriteOnly(false)}
            onClearRecent={() => setRecentOnly(false)}
            onClearBin={() => setBinFilterActive(false)}
            onClearTrash={() => setTrashFilterActive(false)}
            onClearLayers={() => setLayersFilterActive(false)}
            onClearSlices={() => setSlicesFilterActive(false)}
            onClearSliceFavorite={() => setSliceFavoriteOnly(false)}
            onClearSlicePitch={() => setSlicePitchOnly(false)}
            onClearDuplicates={() => setDuplicatesFilterActive(false)}
          />

          {typeFilter !== "all" && (
            <ActiveFilterChip
              onRemove={() => setTypeFilter("all")}
              removeTitle="Remove Type filter"
            >
              <span>{typeFilter === "oneshot" ? "One-Shot" : "Loop"}</span>
            </ActiveFilterChip>
          )}

          {srFilter !== null && (
            <ActiveFilterChip
              mono
              onRemove={() => setSrFilter(null)}
              removeTitle="Remove Sample Rate filter"
            >
              <span>{formatSampleRateKhz(srFilter)} kHz</span>
            </ActiveFilterChip>
          )}

          {selectedGenre && (
            <ActiveFilterChip
              onRemove={() => setSelectedGenre(null)}
              removeTitle="Remove Genre filter"
            >
              <span
                className="w-2 h-2 rounded-[2px] shrink-0"
                style={{ backgroundColor: activeGenreObj?.color || "#8B5CF6" }}
              />
              <span>{selectedGenre}</span>
            </ActiveFilterChip>
          )}

          <ActiveTaxonomyChips
            tags={tags}
            tagFacets={tagFacets}
            selectedTagIds={selectedTagIds}
            excludedTagIds={excludedTagIds}
            tagMatchMode={tagMatchMode}
            onToggleMatchMode={toggleTagMatchMode}
            onRemoveSelected={toggleTagFilter}
            onRemoveExcluded={toggleExcludeTagFilter}
          />

          {bpmTokens.map((bpmVal) => (
            <ActiveFilterChip
              key={bpmVal}
              mono
              onRemove={() =>
                setSearchQuery(
                  removeSearchPrefixTokens(searchQuery, "bpm:", bpmVal)
                )
              }
              removeTitle="Remove BPM filter"
            >
              <span>{bpmVal.replace("-", "–")} BPM</span>
            </ActiveFilterChip>
          ))}

          {keyTokens.map((keyVal) => (
            <ActiveFilterChip
              key={keyVal}
              mono
              onRemove={() =>
                setSearchQuery(
                  removeSearchPrefixTokens(searchQuery, "key:", keyVal)
                )
              }
              removeTitle="Remove Key filter"
            >
              <span>Key: {keyVal.toUpperCase()}</span>
            </ActiveFilterChip>
          ))}

          <button
            type="button"
            onClick={resetAllFilters}
            className="ml-auto w-[20px] h-[20px] rounded-[3px] border border-line bg-surface-3 hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg inline-flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            title="Clear all active filters"
            aria-label="Clear all active filters"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
