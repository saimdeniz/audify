import { invoke } from "@tauri-apps/api/core";
import { SampleItem, Tag, TagFacet } from "../../types";
import {
  isSampleInLicenseGroup,
  normalizePathForMatch,
} from "../../utils/format";
import { internSamplePoolWithStatus } from "../../utils/sampleInterning";
import { executeSmartSearch } from "../../utils/smartSearch";
import {
  applyClientFacetFilters,
  reconcileSelectionAfterFilter,
  shouldPreserveDeckSelection,
} from "../filterEngine";
import { resetPlayheadClock } from "../playheadClock";
import { isStandaloneSettingsWindow } from "../storageHelpers";
import type { StoreSliceContext } from "../types";
import { SAMPLE_QUERY_LIMIT, summarizeSamplePool } from "./catalogSyncSlice";
import { buildDuplicateOrderMap } from "./duplicateSlice";

export function createLibrarySyncSlice(
  ctx: StoreSliceContext,
  opts: {
    bumpFetchSeq: () => number;
    getFetchSeq: () => number;
  }
) {
  const { set, get, applyInstantMemoryFilter, getProfileEpoch } = ctx;

  let cachedMaintActions: ReturnType<
    typeof import("./libraryMaintenanceActions").createLibraryMaintenanceActions
  > | null = null;
  const loadMaintActions = async () => {
    if (!cachedMaintActions) {
      const mod = await import("./libraryMaintenanceActions");
      cachedMaintActions = mod.createLibraryMaintenanceActions(ctx);
    }
    return cachedMaintActions;
  };

  return {
    fetchSamples: async (fetchOpts?: { preserveMultiSelect?: boolean }) => {
      if (isStandaloneSettingsWindow()) return;
      const {
        searchQuery,
        folderFilter,
        favoriteOnly,
        selectedTagIds,
        excludedTagIds,
        tagMatchMode,
        collections,
        selectedCollectionId,
        trashFilterActive,
        allProfileSamples,
      } = get();

      const preserveMultiSelect = fetchOpts?.preserveMultiSelect ?? true;
      const activeCollection =
        selectedCollectionId !== null
          ? collections.find((c) => c.id === selectedCollectionId) ?? null
          : null;
      const smartQuery = activeCollection?.smart_query?.trim() || "";
      const isManualCollectionSelected =
        selectedCollectionId !== null && smartQuery === "";
      const requiresSqlCollectionOrTrash =
        trashFilterActive || isManualCollectionSelected;

      // Fast path: <3ms in-memory filtering & Smart Search v2 when allProfileSamples is loaded
      // and no Collection join or Trash Quarantine view is active
      if (allProfileSamples.length > 0 && !requiresSqlCollectionOrTrash) {
        applyInstantMemoryFilter({ preserveMultiSelect });
        return;
      }

      const fetchSeq = opts.bumpFetchSeq();
      const epoch = getProfileEpoch();

      try {
        const sqlSearchQuery = requiresSqlCollectionOrTrash
          ? null
          : searchQuery.trim()
          ? searchQuery.trim()
          : null;
        const useCompactTags = get().tags.length > 0;
        const resultRaw = await invoke<SampleItem[]>("query_samples", {
          searchQuery: sqlSearchQuery,
          folderFilter: trashFilterActive ? null : folderFilter,
          favoriteOnly: trashFilterActive ? false : favoriteOnly,
          tagIds: trashFilterActive ? [] : selectedTagIds,
          excludedTagIds: trashFilterActive ? [] : excludedTagIds,
          tagMatchMode: trashFilterActive ? "all" : tagMatchMode,
          collectionId:
            trashFilterActive || smartQuery !== "" ? null : selectedCollectionId,
          limit: SAMPLE_QUERY_LIMIT,
          offset: 0,
          includePeaks: false,
          trashedOnly: trashFilterActive,
          ...(useCompactTags ? { compactTags: true } : {}),
        });

        // Discard stale responses from superseded queries or profile switches
        if (fetchSeq !== opts.getFetchSeq() || epoch !== getProfileEpoch()) {
          return;
        }

        const internRes = internSamplePoolWithStatus(resultRaw, get().tags);
        if (internRes.hadMissingTagIds) {
          const [freshTags, freshFacets] = await Promise.all([
            invoke<Tag[]>("get_tags").catch(() => null),
            invoke<TagFacet[]>("get_tag_facets").catch(() => null),
          ]);
          if (fetchSeq !== opts.getFetchSeq() || epoch !== getProfileEpoch()) {
            return;
          }
          if ((freshTags && freshTags.length > 0) || (freshFacets && freshFacets.length > 0)) {
            set({
              ...(freshTags && freshTags.length > 0 ? { tags: freshTags } : {}),
              ...(freshFacets && freshFacets.length > 0 ? { tagFacets: freshFacets } : {}),
            });
            if (freshTags && freshTags.length > 0) {
              internSamplePoolWithStatus(resultRaw, freshTags, {
                onlyUnresolvedTagIds: true,
              });
            }
          }
        }

        // Re-read current facet/sort/filter state at resolution time
        const live = get();
        const normTrashFolder =
          live.trashFilterActive && live.folderFilter
            ? normalizePathForMatch(live.folderFilter)
            : null;
        const normTrashPrefix = normTrashFolder ? `${normTrashFolder}/` : null;
        const folderStageRaw = normTrashFolder
          ? resultRaw.filter((s) => {
              const fp = normalizePathForMatch(s.folder_path);
              return fp === normTrashFolder || fp.startsWith(normTrashPrefix!);
            })
          : resultRaw;
        const activeLicenseGroup = live.selectedLicenseGroupId
          ? live.licenseGroups.find((g) => g.id === live.selectedLicenseGroupId) ||
            null
          : null;
        const licenseFiltered = activeLicenseGroup
          ? folderStageRaw.filter((s) =>
              isSampleInLicenseGroup(
                s.folder_path || s.file_path,
                activeLicenseGroup,
                s.artist
              )
            )
          : folderStageRaw;
        const binIdSet = live.binFilterActive ? new Set(live.binSampleIds) : null;
        const binFiltered = binIdSet
          ? licenseFiltered.filter((s) => binIdSet.has(s.id))
          : licenseFiltered;
        const recentOrderMap = live.recentOnly
          ? new Map(live.recentSampleIds.map((id, idx) => [id, idx]))
          : null;
        const recentFiltered = recentOrderMap
          ? binFiltered
              .filter((s) => recentOrderMap.has(s.id))
              .sort(
                (a, b) =>
                  (recentOrderMap.get(a.id) ?? 9999) -
                  (recentOrderMap.get(b.id) ?? 9999)
              )
          : binFiltered;
        const duplicateOrderMap = buildDuplicateOrderMap(
          live.duplicatesFilterActive,
          live.duplicateScanResult
        );
        const duplicateFiltered = duplicateOrderMap
          ? recentFiltered
              .filter((s) => duplicateOrderMap.has(s.id))
              .sort(
                (a, b) =>
                  (duplicateOrderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                  (duplicateOrderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER)
              )
          : recentFiltered;
        const activeGenreLower = live.selectedGenre
          ? live.selectedGenre.toLowerCase()
          : null;
        const genreFiltered = activeGenreLower
          ? duplicateFiltered.filter(
              (s) =>
                (s.genre || "").toLowerCase() === activeGenreLower ||
                s.tags.some((t) => t.name.toLowerCase() === activeGenreLower)
            )
          : duplicateFiltered;

        const liveSmartCol =
          selectedCollectionId !== null
            ? live.collections.find((c) => c.id === selectedCollectionId) ?? null
            : null;
        const liveSmartQuery = liveSmartCol?.smart_query?.trim() || "";
        const smartStageResult = liveSmartQuery
          ? executeSmartSearch(
              genreFiltered,
              liveSmartQuery,
              live.smartSearchSynonyms
            )
          : genreFiltered;
        const result =
          live.searchQuery.trim() !== ""
            ? executeSmartSearch(
                smartStageResult,
                live.searchQuery,
                live.smartSearchSynonyms
              )
            : smartStageResult;

        const filtered = applyClientFacetFilters(
          result,
          live.typeFilter,
          live.srFilter,
          live.sortKey,
          live.sortDir,
          live.similaritySession
        );

        const reconciled = reconcileSelectionAfterFilter(
          filtered,
          live.selectedSample,
          live.selectedSampleIds,
          preserveMultiSelect,
          shouldPreserveDeckSelection(live)
        );

        const isUnfilteredQuery =
          !live.searchQuery.trim() &&
          folderFilter === null &&
          !favoriteOnly &&
          !live.recentOnly &&
          selectedTagIds.length === 0 &&
          excludedTagIds.length === 0 &&
          live.selectedGenre === null &&
          selectedCollectionId === null &&
          live.selectedLicenseGroupId === null &&
          !live.binFilterActive &&
          !live.trashFilterActive &&
          !live.duplicatesFilterActive;

        const poolSummary = isUnfilteredQuery
          ? summarizeSamplePool(
              resultRaw,
              new Set<number>([...live.recentSampleIds, ...live.binSampleIds])
            )
          : null;
        const trashPoolPatch = live.trashFilterActive
          ? { trashedProfileSamples: resultRaw }
          : {};

        const selectionChanged =
          (reconciled.nextSelected?.id ?? null) !==
          (live.selectedSample?.id ?? null);
        if (selectionChanged) {
          resetPlayheadClock(0);
        }

        set({
          ...(poolSummary
            ? {
                allProfileSamples: resultRaw,
                favoritesCount: poolSummary.favCount,
                knownSampleIds: poolSummary.knownIds,
              }
            : {}),
          ...trashPoolPatch,
          rawSamples: result,
          samples: filtered,
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
        });
      } catch (err) {
        console.error("Failed to query samples:", err);
      }
    },

    addAndScanFolder: async () => (await loadMaintActions()).addAndScanFolder(),

    scanSpecificPath: async (path: string, forceRebuild = false) =>
      (await loadMaintActions()).scanSpecificPath(path, forceRebuild),

    syncFolderIncremental: async (libraryPath: string, targetFolder?: string) =>
      (await loadMaintActions()).syncFolderIncremental(
        libraryPath,
        targetFolder
      ),

    setLibraryProfileScope: async (
      libraryId: number,
      isGlobal: boolean,
      assignedToProfile: boolean
    ) =>
      (await loadMaintActions()).setLibraryProfileScope(
        libraryId,
        isGlobal,
        assignedToProfile
      ),

    removeLibrary: async (libraryId: number) =>
      (await loadMaintActions()).removeLibrary(libraryId),

    relinkLibraryFolder: async (libraryId: number) =>
      (await loadMaintActions()).relinkLibraryFolder(libraryId),

    analyzeLibraryBpmAndKey: async (
      libraryId: number | null = null,
      overwrite = false
    ) =>
      (await loadMaintActions()).analyzeLibraryBpmAndKey(libraryId, overwrite),

    rebuildAllLibraries: async () =>
      (await loadMaintActions()).rebuildAllLibraries(),
  };
}
