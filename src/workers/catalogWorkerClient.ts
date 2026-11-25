import { Collection, SampleItem, Tag, TagFacet } from "../types";
import { getCachedSampleByIdMap } from "../utils/sampleLookup";
import { setSmartSearchTaxonomy } from "../utils/search/sampleIndex";
import {
  serializeTaxonomyForWorker,
  type TaxonomyWorkerIndex,
} from "../utils/taxonomyTree";
import {
  CATALOG_WORKER_THRESHOLD,
  type CatalogFilterQueryParams,
  type CatalogPoolPatchEntry,
  type CatalogWorkerRequest,
  type CatalogWorkerResponse,
} from "./catalogWorkerProtocol";

const MAX_INCREMENTAL_PATCH_UPDATES = 256;

let workerInstance: Worker | null = null;
let workerFailed = false;
let currentPoolEpoch = 0;
let lastPoolRef: SampleItem[] | null = null;
let lastTagsRef: readonly Tag[] | null = null;
let lastFacetsRef: readonly TagFacet[] | undefined = undefined;
let cachedTaxonomyIndex: TaxonomyWorkerIndex | null = null;

let filterSeqCounter = 0;
let countsSeqCounter = 0;

let pendingFilter: {
  requestSeq: number;
  poolEpoch: number;
  resolve: (
    result: { rawIds: Int32Array; filteredIds: Int32Array } | null
  ) => void;
} | null = null;

let pendingCounts: {
  requestSeq: number;
  poolEpoch: number;
  resolve: (counts: Record<number, number> | null) => void;
} | null = null;

function ensureCatalogWorker(): Worker | null {
  if (workerFailed || typeof Worker === "undefined") {
    return null;
  }
  if (workerInstance) {
    return workerInstance;
  }
  try {
    const w = new Worker(new URL("./catalogWorker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (event: MessageEvent<CatalogWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "filter_result") {
        if (
          pendingFilter &&
          pendingFilter.requestSeq === msg.requestSeq &&
          pendingFilter.poolEpoch === msg.poolEpoch
        ) {
          const resolve = pendingFilter.resolve;
          pendingFilter = null;
          resolve(
            msg.matched
              ? { rawIds: msg.rawIds, filteredIds: msg.filteredIds }
              : null
          );
        }
        return;
      }
      if (msg.type === "smart_counts_result") {
        if (
          pendingCounts &&
          pendingCounts.requestSeq === msg.requestSeq &&
          pendingCounts.poolEpoch === msg.poolEpoch
        ) {
          const resolve = pendingCounts.resolve;
          pendingCounts = null;
          resolve(msg.matched ? msg.counts : null);
        }
      }
    };
    w.onerror = () => {
      workerFailed = true;
      workerInstance?.terminate();
      workerInstance = null;
      if (pendingFilter) {
        const res = pendingFilter.resolve;
        pendingFilter = null;
        res(null);
      }
      if (pendingCounts) {
        const res = pendingCounts.resolve;
        pendingCounts = null;
        res(null);
      }
    };
    workerInstance = w;
    if (cachedTaxonomyIndex) {
      const taxMsg: CatalogWorkerRequest = {
        type: "set_taxonomy",
        taxonomy: cachedTaxonomyIndex,
      };
      w.postMessage(taxMsg);
    }
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

export function shouldUseCatalogWorker(sampleCount: number): boolean {
  return (
    sampleCount >= CATALOG_WORKER_THRESHOLD &&
    !workerFailed &&
    typeof Worker !== "undefined"
  );
}

export function clearCatalogWorkerPool(): void {
  if (lastPoolRef === null && !workerInstance) return;
  lastPoolRef = null;
  currentPoolEpoch += 1;
  if (pendingFilter) {
    const res = pendingFilter.resolve;
    pendingFilter = null;
    res(null);
  }
  if (pendingCounts) {
    const res = pendingCounts.resolve;
    pendingCounts = null;
    res(null);
  }
  if (workerInstance) {
    const msg: CatalogWorkerRequest = {
      type: "set_pool",
      poolEpoch: currentPoolEpoch,
      samples: [],
    };
    workerInstance.postMessage(msg);
  }
}

export function syncCatalogWorkerTaxonomy(
  tags: readonly Tag[],
  facets?: readonly TagFacet[]
): TaxonomyWorkerIndex | null {
  if (tags === lastTagsRef && facets === lastFacetsRef) {
    return cachedTaxonomyIndex;
  }
  lastTagsRef = tags;
  lastFacetsRef = facets;
  cachedTaxonomyIndex =
    tags.length > 0 || Boolean(facets && facets.length > 0)
      ? serializeTaxonomyForWorker(tags, facets)
      : null;
  setSmartSearchTaxonomy(cachedTaxonomyIndex);
  if (workerInstance) {
    const msg: CatalogWorkerRequest = {
      type: "set_taxonomy",
      taxonomy: cachedTaxonomyIndex,
    };
    workerInstance.postMessage(msg);
  }
  return cachedTaxonomyIndex;
}

export function getCachedTaxonomyWorkerIndex(
  tags: readonly Tag[],
  facets?: readonly TagFacet[]
): TaxonomyWorkerIndex | null {
  return syncCatalogWorkerTaxonomy(tags, facets);
}

export function clearCatalogWorkerSearchCache(): void {
  if (!workerInstance) return;
  const msg: CatalogWorkerRequest = { type: "clear_search_cache" };
  workerInstance.postMessage(msg);
}

/**
 * Patches `file_modified_at` in-place inside the worker via zero-copy transferable typed arrays
 * so startup mtime backfill never triggers full 50k+ `set_pool` structured clones.
 */
export function patchCatalogWorkerMtimes(
  nextPool: SampleItem[],
  patchMap: ReadonlyMap<number, number>
): number {
  if (!lastPoolRef || lastPoolRef.length !== nextPool.length || !workerInstance) {
    return syncCatalogWorkerPool(nextPool);
  }
  lastPoolRef = nextPool;
  currentPoolEpoch += 1;
  const size = patchMap.size;
  const ids = new Int32Array(size);
  const mtimes = new Float64Array(size);
  let idx = 0;
  for (const [id, mtime] of patchMap) {
    ids[idx] = id;
    mtimes[idx] = mtime;
    idx += 1;
  }
  const msg: CatalogWorkerRequest = {
    type: "patch_mtimes",
    poolEpoch: currentPoolEpoch,
    ids,
    mtimes,
  };
  workerInstance.postMessage(msg, [ids.buffer, mtimes.buffer]);
  return currentPoolEpoch;
}

function stripPeaksIfPresent(sample: SampleItem): SampleItem {
  return sample.peaks_json ? { ...sample, peaks_json: "" } : sample;
}

export function syncCatalogWorkerPool(pool: SampleItem[]): number {
  if (pool === lastPoolRef && currentPoolEpoch > 0) {
    return currentPoolEpoch;
  }
  const prevPool = lastPoolRef;
  lastPoolRef = pool;
  currentPoolEpoch += 1;

  const w = ensureCatalogWorker();
  if (!w) return currentPoolEpoch;

  // Incremental diff when only a small set of rows changed (favorite, tag, BPM, rename)
  // so single-row edits never structuredClone 50k–150k samples into the worker!
  if (
    prevPool &&
    prevPool.length === pool.length &&
    pool.length >= CATALOG_WORKER_THRESHOLD
  ) {
    const updates: CatalogPoolPatchEntry[] = [];
    let exceeded = false;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i] !== prevPool[i]) {
        if (updates.length >= MAX_INCREMENTAL_PATCH_UPDATES) {
          exceeded = true;
          break;
        }
        updates.push({ index: i, sample: stripPeaksIfPresent(pool[i]) });
      }
    }
    if (!exceeded) {
      if (updates.length > 0) {
        const msg: CatalogWorkerRequest = {
          type: "patch_pool",
          poolEpoch: currentPoolEpoch,
          updates,
        };
        w.postMessage(msg);
      } else {
        // Identical element references: keep worker epoch synced with an empty patch
        const msg: CatalogWorkerRequest = {
          type: "patch_pool",
          poolEpoch: currentPoolEpoch,
          updates: [],
        };
        w.postMessage(msg);
      }
      return currentPoolEpoch;
    }
  }

  // Incremental deletion diff when a small number of rows were trashed/removed
  // while keeping remaining references intact (avoids structured-cloning 50k–150k rows!).
  if (
    prevPool &&
    pool.length < prevPool.length &&
    prevPool.length - pool.length <= MAX_INCREMENTAL_PATCH_UPDATES &&
    pool.length >= CATALOG_WORKER_THRESHOLD
  ) {
    const removedIds: number[] = [];
    let j = 0;
    let cleanSubsequence = true;
    for (let i = 0; i < prevPool.length; i++) {
      if (j < pool.length && prevPool[i] === pool[j]) {
        j += 1;
      } else {
        removedIds.push(prevPool[i].id);
        if (removedIds.length > MAX_INCREMENTAL_PATCH_UPDATES) {
          cleanSubsequence = false;
          break;
        }
      }
    }
    if (cleanSubsequence && j === pool.length) {
      const msg: CatalogWorkerRequest = {
        type: "remove_ids",
        poolEpoch: currentPoolEpoch,
        ids: removedIds,
      };
      w.postMessage(msg);
      return currentPoolEpoch;
    }
  }

  const hasAnyPeaks = pool.some(
    (s) => typeof s.peaks_json === "string" && s.peaks_json.length > 0
  );
  const slimSamples = hasAnyPeaks ? pool.map(stripPeaksIfPresent) : pool;

  const msg: CatalogWorkerRequest = {
    type: "set_pool",
    poolEpoch: currentPoolEpoch,
    samples: slimSamples,
  };
  w.postMessage(msg);
  return currentPoolEpoch;
}

export function runCatalogWorkerFilter(
  poolEpoch: number,
  params: CatalogFilterQueryParams
): Promise<{ rawIds: Int32Array; filteredIds: Int32Array } | null> {
  const w = ensureCatalogWorker();
  if (!w) return Promise.resolve(null);

  if (pendingFilter) {
    pendingFilter.resolve(null);
    pendingFilter = null;
  }

  const requestSeq = ++filterSeqCounter;
  return new Promise((resolve) => {
    pendingFilter = { requestSeq, poolEpoch, resolve };
    const msg: CatalogWorkerRequest = {
      type: "filter_query",
      requestSeq,
      poolEpoch,
      params,
    };
    w.postMessage(msg);
  });
}

export function runCatalogWorkerSmartCounts(
  poolEpoch: number,
  collections: Collection[],
  enableSynonyms: boolean
): Promise<Record<number, number> | null> {
  const w = ensureCatalogWorker();
  if (!w) return Promise.resolve(null);

  if (pendingCounts) {
    pendingCounts.resolve(null);
    pendingCounts = null;
  }

  const requestSeq = ++countsSeqCounter;
  return new Promise((resolve) => {
    pendingCounts = { requestSeq, poolEpoch, resolve };
    const msg: CatalogWorkerRequest = {
      type: "smart_counts",
      requestSeq,
      poolEpoch,
      collections,
      enableSynonyms,
    };
    w.postMessage(msg);
  });
}

export function hydrateSamplesFromIds(
  pool: readonly SampleItem[],
  ids: Int32Array
): SampleItem[] {
  const byId = getCachedSampleByIdMap(pool);
  const out: SampleItem[] = [];
  for (let i = 0; i < ids.length; i++) {
    const sample = byId.get(ids[i]);
    if (sample) {
      out.push(sample);
    }
  }
  return out;
}
