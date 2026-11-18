import { Collection, SampleItem } from "../types";
import { getCachedSampleByIdMap } from "../utils/sampleLookup";
import {
  CATALOG_WORKER_THRESHOLD,
  type CatalogFilterQueryParams,
  type CatalogWorkerRequest,
  type CatalogWorkerResponse,
} from "./catalogWorkerProtocol";

let workerInstance: Worker | null = null;
let workerFailed = false;
let currentPoolEpoch = 0;
let lastPoolRef: SampleItem[] | null = null;

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

export function syncCatalogWorkerPool(pool: SampleItem[]): number {
  if (pool === lastPoolRef && currentPoolEpoch > 0) {
    return currentPoolEpoch;
  }
  lastPoolRef = pool;
  currentPoolEpoch += 1;

  const w = ensureCatalogWorker();
  if (!w) return currentPoolEpoch;

  const hasAnyPeaks = pool.some(
    (s) => typeof s.peaks_json === "string" && s.peaks_json.length > 0
  );
  const slimSamples = hasAnyPeaks
    ? pool.map((s) =>
        s.peaks_json ? { ...s, peaks_json: "" } : s
      )
    : pool;

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
