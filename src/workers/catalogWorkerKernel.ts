import {
  applyClientFacetFilters,
  clearCatalogSortCaches,
  filterBaseSamplesInMemory,
} from "../utils/catalogFilterCore";
import { SampleItem, SimilaritySession } from "../types";
import { internSamplePool } from "../utils/sampleInterning";
import {
  pruneSmartSearchCache,
  setSmartSearchTaxonomy,
} from "../utils/search/sampleIndex";
import { computeSmartCollectionCounts } from "../utils/smartCollectionCounts";
import { clearSmartSearchCache, executeSmartSearch } from "../utils/smartSearch";
import type { TaxonomyWorkerIndex } from "../utils/taxonomyTree";
import type {
  CatalogWorkerRequest,
  CatalogWorkerResponse,
  CatalogWorkerSimilarityFilter,
} from "./catalogWorkerProtocol";

function createVirtualExternalAnchor(anchorSampleId: number): SampleItem {
  return {
    id: anchorSampleId,
    library_id: 0,
    file_path: "",
    file_name: "",
    folder_path: "",
    extension: "",
    duration_ms: 0,
    sample_rate: 0,
    channels: 0,
    bit_depth: 0,
    file_size: 0,
    is_favorite: false,
    is_loop: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    peaks_json: "[]",
    created_at: "",
    tags: [],
  };
}

function buildSimilaritySession(
  samplesById: Map<number, SampleItem>,
  sim: CatalogWorkerSimilarityFilter | null
): SimilaritySession | null {
  if (!sim) return null;
  const anchorSample =
    samplesById.get(sim.anchorSampleId) ??
    (sim.anchorSampleId <= 0
      ? createVirtualExternalAnchor(sim.anchorSampleId)
      : undefined);
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
  let taxonomyIndex: TaxonomyWorkerIndex | null = null;
  let hasActiveSearchQuery = false;

  return {
    getPoolSize: () => pool.length,

    handleMessage: (msg: CatalogWorkerRequest) => {
      if (msg.type === "set_pool") {
        poolEpoch = msg.poolEpoch;
        clearCatalogSortCaches();
        pool = internSamplePool(msg.samples);
        samplesById = new Map<number, SampleItem>();
        for (let i = 0; i < pool.length; i++) {
          samplesById.set(pool[i].id, pool[i]);
        }
        if (pool.length === 0) {
          hasActiveSearchQuery = false;
          clearSmartSearchCache();
        } else {
          pruneSmartSearchCache(samplesById);
        }
        return {
          response: { type: "pool_ack", poolEpoch },
          transfer: [],
        };
      }

      if (msg.type === "patch_pool") {
        poolEpoch = msg.poolEpoch;
        for (let i = 0; i < msg.updates.length; i++) {
          const { index, sample } = msg.updates[i];
          if (index >= 0 && index < pool.length) {
            const prev = pool[index];
            if (prev && prev.id !== sample.id && samplesById.get(prev.id) === prev) {
              samplesById.delete(prev.id);
            }
            pool[index] = sample;
            samplesById.set(sample.id, sample);
          }
        }
        return {
          response: { type: "pool_ack", poolEpoch },
          transfer: [],
        };
      }

      if (msg.type === "patch_mtimes") {
        poolEpoch = msg.poolEpoch;
        const count = Math.min(msg.ids.length, msg.mtimes.length);
        if (count > 0 && pool.length > 0) {
          const patchMap = new Map<number, number>();
          for (let i = 0; i < count; i++) {
            patchMap.set(msg.ids[i], msg.mtimes[i]);
          }
          for (let i = 0; i < pool.length; i++) {
            const item = pool[i];
            const mtime = patchMap.get(item.id);
            if (mtime !== undefined && item.file_modified_at !== mtime) {
              const patched = { ...item, file_modified_at: mtime };
              pool[i] = patched;
              samplesById.set(item.id, patched);
            }
          }
        }
        return {
          response: { type: "pool_ack", poolEpoch },
          transfer: [],
        };
      }

      if (msg.type === "remove_ids") {
        poolEpoch = msg.poolEpoch;
        if (msg.ids.length > 0 && pool.length > 0) {
          const removedSet = new Set<number>(msg.ids);
          for (const id of removedSet) {
            samplesById.delete(id);
          }
          const nextPool: SampleItem[] = [];
          for (let i = 0; i < pool.length; i++) {
            const item = pool[i];
            if (!removedSet.has(item.id)) {
              nextPool.push(item);
            }
          }
          pool = nextPool;
          if (pool.length === 0) {
            hasActiveSearchQuery = false;
            clearSmartSearchCache();
          }
        }
        return {
          response: { type: "pool_ack", poolEpoch },
          transfer: [],
        };
      }

      if (msg.type === "set_taxonomy") {
        taxonomyIndex = msg.taxonomy;
        setSmartSearchTaxonomy(taxonomyIndex);
        return {
          response: { type: "pool_ack", poolEpoch },
          transfer: [],
        };
      }

      if (msg.type === "clear_search_cache") {
        hasActiveSearchQuery = false;
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
          dupOrderMap,
          p.excludedTagIds,
          taxonomyIndex,
          p.tagMatchMode ?? "all"
        );

        const smartBaseResult = p.smartQuery
          ? executeSmartSearch(baseResult, p.smartQuery, p.smartSearchSynonyms)
          : baseResult;
        const trimmedSearch = p.searchQuery.trim();
        const searchedResult = trimmedSearch
          ? executeSmartSearch(smartBaseResult, p.searchQuery, p.smartSearchSynonyms)
          : smartBaseResult;
        hasActiveSearchQuery = Boolean(p.smartQuery || trimmedSearch);
        if (!hasActiveSearchQuery) {
          clearSmartSearchCache();
        }

        const simSession = buildSimilaritySession(samplesById, p.similarity);
        if (!p.sortKey) {
          clearCatalogSortCaches();
        }
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
      if (!hasActiveSearchQuery) {
        clearSmartSearchCache();
      }
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
