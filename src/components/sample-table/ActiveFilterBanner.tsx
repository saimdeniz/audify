import React, { Suspense, lazy, useMemo } from "react";
import {
  CopyCheck,
  FileCheck2,
  Folder,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  Loader2,
  Scissors,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  folderNameFromPath,
  formatBytesCompact,
  formatSampleRateKhz,
} from "../../utils/format";
import {
  extractSearchPrefixValues,
  removeSearchPrefixTokens,
} from "../../utils/searchPrefixHelpers";
import { formatTrashOpLabel } from "../../utils/trashStatusFormat";
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
          {folderFilter && (
            <span
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]"
              title={`Folder: ${folderFilter}`}
            >
              <Folder className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[160px]">{folderDisplayName}</span>
              <button
                type="button"
                onClick={() => setFolderFilter(null)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove folder filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {activeCollection && (
            <span
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]"
              title={
                activeCollection.smart_query
                  ? `Smart Collection: ${activeCollection.smart_query}`
                  : undefined
              }
            >
              {activeCollection.smart_query ? (
                <Zap className="w-3 h-3 shrink-0" />
              ) : (
                <LayoutGrid className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate max-w-[150px]">
                {activeCollection.name}
              </span>
              <button
                type="button"
                onClick={() => setCollectionFilter(null)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove collection filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {activeLicenseGroup && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
              <FileCheck2 className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[150px]">
                {activeLicenseGroup.name}
              </span>
              <button
                type="button"
                onClick={() => setLicenseGroupFilter(null, null)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove license filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {favoriteOnly && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
              <Star className="w-3 h-3 fill-current shrink-0" />
              <span>
                {favoritesViewTab === "slices"
                  ? "Favorites · Slices"
                  : favoritesViewTab === "layers"
                  ? "Favorites · Layers"
                  : "Favorites"}
              </span>
              <button
                type="button"
                onClick={() => setFavoriteOnly(false)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Favorites filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {recentOnly && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
              <History className="w-3 h-3 shrink-0" />
              <span>Recent</span>
              <button
                type="button"
                onClick={() => setRecentOnly(false)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Recent filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {binFilterActive && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
              <Inbox className="w-3 h-3 shrink-0" />
              <span>Session Bin</span>
              <button
                type="button"
                onClick={() => setBinFilterActive(false)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Session Bin filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {trashFilterActive ? (
            <span
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]"
              title="Trash — Favorites, Tags, Genres & Collections are preserved until emptied"
            >
              {trashOpStatus ? (
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              ) : (
                <Trash2 className="w-3 h-3 shrink-0" />
              )}
              <span>
                {trashOpStatus
                  ? `Trash · ${formatTrashOpLabel(trashOpStatus)}`
                  : trashViewTab === "slices"
                    ? `Trash · Slices · ${trashedSliceCount.toLocaleString()} ${
                        trashedSliceCount === 1 ? "slice" : "slices"
                      } · ${formatBytesCompact(trashedSliceTotalBytes)}`
                    : trashViewTab === "layers"
                      ? `Trash · Layers · ${trashedLayerCount.toLocaleString()} ${
                          trashedLayerCount === 1 ? "layer" : "layers"
                        } · ${formatBytesCompact(trashedLayerTotalBytes)}`
                      : `Trash · ${trashedCount.toLocaleString()} ${
                          trashedCount === 1 ? "file" : "files"
                        } · ${formatBytesCompact(trashedTotalBytes)}`}
              </span>
              {!trashOpStatus && (
                <button
                  type="button"
                  onClick={() => setTrashFilterActive(false)}
                  className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                  title="Exit Trash view"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          ) : (
            trashOpStatus && (
              <span className="inline-flex items-center gap-1.5 h-[20px] px-2 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span>{formatTrashOpLabel(trashOpStatus)}</span>
              </span>
            )
          )}

          {layersFilterActive && (
            <span
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent bg-accent-soft text-accent-fg text-[11px]"
              title="Layers Multi-Track SFX Studio"
            >
              <Layers className="w-3 h-3 shrink-0" />
              <span>
                Layers · {layerHistoryCount.toLocaleString()} saved
              </span>
              <button
                type="button"
                onClick={() => setLayersFilterActive(false)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Exit Layers Studio"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {slicesFilterActive && (
            <>
              <span
                className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent bg-accent-soft text-accent-fg text-[11px]"
                title="Saved slices · Click row to preview · Click Source Track (↗) to open original track · F2 Rename · Del Trash · Ctrl+Z Undo"
              >
                <Scissors className="w-3 h-3 shrink-0" />
                <span>Slices · {sliceHistoryCount.toLocaleString()}</span>
                <button
                  type="button"
                  onClick={() => setSlicesFilterActive(false)}
                  className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                  title="Exit Slices view"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
              {sliceFavoriteOnly && (
                <span className="inline-flex items-center gap-1 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
                  <Star className="w-3 h-3 fill-current shrink-0" />
                  <span>Favorites</span>
                  <button
                    type="button"
                    onClick={() => setSliceFavoriteOnly(false)}
                    className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                    title="Clear slice favorites filter"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              )}
              {slicePitchOnly && (
                <span className="inline-flex items-center gap-1 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
                  <span>Pitch / FX</span>
                  <button
                    type="button"
                    onClick={() => setSlicePitchOnly(false)}
                    className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                    title="Clear slice pitch filter"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              )}
            </>
          )}

          {duplicatesFilterActive && (
            <span
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]"
              title={
                duplicateScanError
                  ? `Duplicate scan failed: ${duplicateScanError}`
                  : duplicateScanResult
                  ? `${duplicateScanResult.groups_found} groups · ${duplicateScanResult.duplicate_files_count} extra files (${formatBytesCompact(duplicateScanResult.reclaimable_bytes)})`
                  : "Duplicates filter active"
              }
            >
              <CopyCheck className="w-3 h-3 shrink-0" />
              <span>
                {isScanningDuplicates
                  ? duplicateScanProgress
                    ? `${duplicateScanProgress.stage_label} (${Math.min(
                        100,
                        Math.max(0, Math.round(duplicateScanProgress.percentage))
                      )}%)`
                    : "Scanning duplicates..."
                  : duplicateScanError
                  ? "Duplicates (Error)"
                  : duplicateScanResult
                  ? `Duplicates · ${duplicateScanResult.groups_found.toLocaleString()} ${
                      duplicateScanResult.groups_found === 1 ? "group" : "groups"
                    } · ${formatBytesCompact(duplicateScanResult.reclaimable_bytes)}`
                  : "Duplicates"}
              </span>
              <button
                type="button"
                onClick={() => setDuplicatesFilterActive(false)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Exit Duplicates view"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {typeFilter !== "all" && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
              <span>{typeFilter === "oneshot" ? "One-Shot" : "Loop"}</span>
              <button
                type="button"
                onClick={() => setTypeFilter("all")}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Type filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {srFilter !== null && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px] font-mono">
              <span>{formatSampleRateKhz(srFilter)} kHz</span>
              <button
                type="button"
                onClick={() => setSrFilter(null)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Sample Rate filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {selectedGenre && (
            <span className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]">
              <span
                className="w-2 h-2 rounded-[2px] shrink-0"
                style={{ backgroundColor: activeGenreObj?.color || "#8B5CF6" }}
              />
              <span>{selectedGenre}</span>
              <button
                type="button"
                onClick={() => setSelectedGenre(null)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Genre filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
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
            <span
              key={bpmVal}
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px] font-mono"
            >
              <span>{bpmVal.replace("-", "–")} BPM</span>
              <button
                type="button"
                onClick={() =>
                  setSearchQuery(
                    removeSearchPrefixTokens(searchQuery, "bpm:", bpmVal)
                  )
                }
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove BPM filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}

          {keyTokens.map((keyVal) => (
            <span
              key={keyVal}
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px] font-mono"
            >
              <span>Key: {keyVal.toUpperCase()}</span>
              <button
                type="button"
                onClick={() =>
                  setSearchQuery(
                    removeSearchPrefixTokens(searchQuery, "key:", keyVal)
                  )
                }
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title="Remove Key filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
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
