import { SampleItem } from "../types";
import { computeSmartCollectionCounts } from "../utils/smartCollectionCounts";
import {
  hydrateSamplesFromIds,
  runCatalogWorkerFilter,
  runCatalogWorkerSmartCounts,
  syncCatalogWorkerPool,
} from "../workers/catalogWorkerClient";
import { reconcileSelectionAfterFilter } from "./filterEngine";
import { buildDuplicateOrderMap } from "./slices/duplicateSlice";
import type { SampleStoreState } from "./types";

let smartCountsDispatchQueued = false;
let latestMemFilterSeq = 0;

export function bumpMemoryFilterSeq(): void {
  latestMemFilterSeq += 1;
}

export function scheduleWorkerSmartCollectionCounts(
  nextPool: SampleItem[],
  getState: () => SampleStoreState,
  applyCountsRaw: (partial: Partial<SampleStoreState>) => void
): void {
  syncCatalogWorkerPool(nextPool);
  if (smartCountsDispatchQueued) return;
  smartCountsDispatchQueued = true;

  queueMicrotask(() => {
    smartCountsDispatchQueued = false;
    const live = getState();
    const liveSmart = live.collections.filter((c) => Boolean(c.smart_query?.trim()));
    if (liveSmart.length === 0 || live.allProfileSamples.length === 0) {
      applyCountsRaw({ smartCollectionCounts: {} });
      return;
    }
    const currentEpoch = syncCatalogWorkerPool(live.allProfileSamples);
    void runCatalogWorkerSmartCounts(
      currentEpoch,
      live.collections,
      live.smartSearchSynonyms
    ).then((counts) => {
      const now = getState();
      if (
        now.allProfileSamples !== live.allProfileSamples ||
        now.collections !== live.collections ||
        now.smartSearchSynonyms !== live.smartSearchSynonyms
      ) {
        return;
      }
      if (!counts) {
        // Worker crashed/disabled mid-request: fall back synchronously so counts never freeze stale
        applyCountsRaw({
          smartCollectionCounts: computeSmartCollectionCounts(
            now.allProfileSamples,
            now.collections,
            now.smartSearchSynonyms
          ),
        });
        return;
      }
      applyCountsRaw({ smartCollectionCounts: counts });
    });
  });
}

export function dispatchWorkerInstantMemoryFilter(params: {
  snapshotState: SampleStoreState;
  smartQuery: string;
  preserveMultiSelect: boolean;
  fetchSeq: number;
  profileEpoch: number;
  getFetchSeq: () => number;
  getProfileEpoch: () => number;
  getState: () => SampleStoreState;
  set: (partial: Partial<SampleStoreState>) => void;
  onSyncFallback: () => void;
}): void {
  const {
    snapshotState,
    smartQuery,
    preserveMultiSelect,
    fetchSeq,
    profileEpoch,
    getFetchSeq,
    getProfileEpoch,
    getState,
    set,
    onSyncFallback,
  } = params;

  const {
    allProfileSamples,
    searchQuery,
    smartSearchSynonyms,
    folderFilter,
    favoriteOnly,
    recentOnly,
    recentSampleIds,
    selectedTagIds,
    selectedGenre,
    selectedLicenseGroupId,
    licenseGroups,
    binFilterActive,
    binSampleIds,
    duplicatesFilterActive,
    duplicateScanResult,
    typeFilter,
    srFilter,
    sortKey,
    sortDir,
    similaritySession,
  } = snapshotState;

  const poolEpoch = syncCatalogWorkerPool(allProfileSamples);
  const memSeq = ++latestMemFilterSeq;
  const dupOrderMap = buildDuplicateOrderMap(
    duplicatesFilterActive,
    duplicateScanResult
  );

  void runCatalogWorkerFilter(poolEpoch, {
    folderFilter,
    favoriteOnly,
    recentOnly,
    recentSampleIds,
    selectedTagIds,
    selectedGenre,
    selectedLicenseGroupId,
    licenseGroups,
    binFilterActive,
    binSampleIds,
    duplicateOrderIds: dupOrderMap ? Array.from(dupOrderMap.keys()) : null,
    smartQuery,
    searchQuery,
    smartSearchSynonyms,
    typeFilter,
    srFilter,
    sortKey,
    sortDir,
    similarity: similaritySession
      ? {
          anchorSampleId: similaritySession.anchorSample.id,
          minScore: similaritySession.minScore,
          scoresEntries: Array.from(similaritySession.scoresById.entries()),
        }
      : null,
  }).then((res) => {
    if (
      memSeq !== latestMemFilterSeq ||
      fetchSeq !== getFetchSeq() ||
      profileEpoch !== getProfileEpoch()
    ) {
      return;
    }

    const live = getState();
    if (live.allProfileSamples !== allProfileSamples || live.trashFilterActive) {
      return;
    }

    if (!res) {
      // Worker failed/terminated unexpectedly: run main-thread fallback so table never stalls
      onSyncFallback();
      return;
    }

    const searchedResult = hydrateSamplesFromIds(allProfileSamples, res.rawIds);
    const filtered =
      res.rawIds.length === res.filteredIds.length &&
      sortKey === null &&
      typeFilter === "all" &&
      srFilter === null
        ? searchedResult
        : hydrateSamplesFromIds(allProfileSamples, res.filteredIds);

    const reconciled = reconcileSelectionAfterFilter(
      filtered,
      live.selectedSample,
      live.selectedSampleIds,
      preserveMultiSelect
    );

    set({
      rawSamples: searchedResult,
      samples: filtered,
      selectedSample: reconciled.nextSelected,
      selectedSampleIds: reconciled.nextSelectedIds,
      lastSelectedIndex: reconciled.nextSelectedIndex,
      durationSec: reconciled.nextSelected
        ? Math.max(0.01, reconciled.nextSelected.duration_ms / 1000)
        : live.durationSec,
    });
  });
}
