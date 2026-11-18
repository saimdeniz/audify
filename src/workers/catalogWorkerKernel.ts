import {
  applyClientFacetFilters,
  filterBaseSamplesInMemory,
} from "../utils/catalogFilterCore";
import { SampleItem, SimilaritySession } from "../types";
import { computeSmartCollectionCounts } from "../utils/smartCollectionCounts";
import { clearSmartSearchCache, executeSmartSearch } from "../utils/smartSearch";
import type {
  CatalogWorkerRequest,
  CatalogWorkerResponse,
  CatalogWorkerSimilarityFilter,
} from "./catalogWorkerProtocol";

function buildSimilaritySession(
  samplesById: Map<number, SampleItem>,
  sim: CatalogWorkerSimilarityFilter | null
): SimilaritySession | null {
  if (!sim) return null;
  const anchorSample = samplesById.get(sim.anchorSampleId);
  if (!anchorSample) return null;
  return {
    anchorSample,
    minScore: sim.minScore,
    scoresById: new Map<number, number>(sim.scoresEntries),
    scope: "profile",
    durationMatchOnly: false,
    topK: 0,
    scopeFolderPath: null,
    elapsedMs: 0,
    scannedVectors: 0,
    prevSortKey: null,
    prevSortDir: "asc",
  };
}

function toIdArray(items: readonly SampleItem[]): Int32Array {
  const out = new Int32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    out[i] = items[i].id;
  }
  return out;
}

export interface CatalogWorkerKernel {
  handleMessage: (msg: CatalogWorkerRequest) => {
    response: CatalogWorkerResponse;
    transfer: Transferable[];
  };
  getPoolSize: () => number;
}

/**
 * Pure stateful worker kernel holding an immutable snapshot of `allProfileSamples`
 * for the active `poolEpoch`. Isolated from DOM/WebWorker APIs so unit tests and
 * benchmarks can exercise the exact same filtering & counting code paths directly.
 */
export function createCatalogWorkerKernel(): CatalogWorkerKernel {
  let poolEpoch = 0;
  let pool: SampleItem[] = [];
  let samplesById = new Map<number, SampleItem>();

  return {
    getPoolSize: () => pool.length,

    handleMessage: (msg: CatalogWorkerRequest) => {
      if (msg.type === "set_pool") {
        poolEpoch = msg.poolEpoch;
        pool = msg.samples;
        samplesById = new Map<number, SampleItem>();
        for (let i = 0; i < pool.length; i++) {
          samplesById.set(pool[i].id, pool[i]);
        }
        clearSmartSearchCache();
        return {
          response: { type: "pool_ack", poolEpoch },
          transfer: [],
        };
      }

      if (msg.type === "filter_query") {
        if (msg.poolEpoch !== poolEpoch) {
          const emptyRaw = new Int32Array(0);
          const emptyFiltered = new Int32Array(0);
          return {
            response: {
              type: "filter_result",
              requestSeq: msg.requestSeq,
              poolEpoch: msg.poolEpoch,
              matched: false,
              rawIds: emptyRaw,
              filteredIds: emptyFiltered,
            },
            transfer: [emptyRaw.buffer, emptyFiltered.buffer],
          };
        }

        const p = msg.params;
        const dupOrderMap = p.duplicateOrderIds
          ? new Map<number, number>(p.duplicateOrderIds.map((id, idx) => [id, idx]))
          : null;

        const baseResult = filterBaseSamplesInMemory(
          pool,
          p.folderFilter,
          p.favoriteOnly,
          p.recentOnly,
          p.recentSampleIds,
          p.selectedTagIds,
          p.selectedGenre,
          p.selectedLicenseGroupId,
          p.licenseGroups,
          p.binFilterActive,
          p.binSampleIds,
          dupOrderMap
        );

        const smartBaseResult = p.smartQuery
          ? executeSmartSearch(baseResult, p.smartQuery, p.smartSearchSynonyms)
          : baseResult;
        const trimmedSearch = p.searchQuery.trim();
        const searchedResult = trimmedSearch
          ? executeSmartSearch(smartBaseResult, p.searchQuery, p.smartSearchSynonyms)
          : smartBaseResult;

        const simSession = buildSimilaritySession(samplesById, p.similarity);
        const filtered = applyClientFacetFilters(
          searchedResult,
          p.typeFilter,
          p.srFilter,
          p.sortKey,
          p.sortDir,
          simSession
        );

        const rawIds = toIdArray(searchedResult);
        const filteredIds =
          filtered === searchedResult ? new Int32Array(rawIds) : toIdArray(filtered);

        return {
          response: {
            type: "filter_result",
            requestSeq: msg.requestSeq,
            poolEpoch: msg.poolEpoch,
            matched: true,
            rawIds,
            filteredIds,
          },
          transfer: [rawIds.buffer, filteredIds.buffer],
        };
      }

      if (msg.poolEpoch !== poolEpoch) {
        return {
          response: {
            type: "smart_counts_result",
            requestSeq: msg.requestSeq,
            poolEpoch: msg.poolEpoch,
            matched: false,
            counts: {},
          },
          transfer: [],
        };
      }

      const counts = computeSmartCollectionCounts(
        pool,
        msg.collections,
        msg.enableSynonyms
      );
      return {
        response: {
          type: "smart_counts_result",
          requestSeq: msg.requestSeq,
          poolEpoch: msg.poolEpoch,
          matched: true,
          counts,
        },
        transfer: [],
      };
    },
  };
}
