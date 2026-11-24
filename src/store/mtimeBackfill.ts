import { invoke } from "@tauri-apps/api/core";
import { SampleItem } from "../types";
import {
  patchCatalogWorkerMtimes,
  shouldUseCatalogWorker,
} from "../workers/catalogWorkerClient";
import type { StoreSliceContext } from "./types";

interface MtimeBackfillBatchResult {
  patches: { sample_id: number; file_modified_at: number }[];
  last_scanned_id: number;
  has_more: boolean;
}

let mtimeBackfillInFlight = false;

function patchSampleMtimes(
  list: SampleItem[],
  patchMap: ReadonlyMap<number, number>,
  sharedById: Map<number, SampleItem>
): SampleItem[] {
  let changed = false;
  const next = list.map((item) => {
    const mtime = patchMap.get(item.id);
    if (mtime === undefined || item.file_modified_at === mtime) {
      return item;
    }
    changed = true;
    const existing = sharedById.get(item.id);
    if (existing) {
      return existing;
    }
    const patched = { ...item, file_modified_at: mtime };
    sharedById.set(item.id, patched);
    return patched;
  });
  return changed ? next : list;
}

/**
 * Silently backfills `file_modified_at` in small batches after startup without blocking UI
 * or triggering audio re-decoding across existing libraries.
 */
export async function runStartupMtimeBackfill(
  ctx: Pick<StoreSliceContext, "set" | "get" | "applyInstantMemoryFilter"> & {
    getProfileEpoch?: () => number;
  }
): Promise<void> {
  if (mtimeBackfillInFlight) return;
  mtimeBackfillInFlight = true;
  const startEpoch = ctx.getProfileEpoch?.() ?? 0;
  const epochChanged = () =>
    ctx.getProfileEpoch ? ctx.getProfileEpoch() !== startEpoch : false;

const MTIME_FLUSH_THRESHOLD = 12000;

  try {
    let afterId = 0;
    let hasMore = true;
    let appliedTotal = 0;
    const pendingPatches = new Map<number, number>();

    const flushPendingPatches = () => {
      if (pendingPatches.size === 0 || epochChanged()) return;
      const patchMap = new Map(pendingPatches);
      pendingPatches.clear();
      ctx.set((st) => {
        // Share a single patched SampleItem reference across all 3 arrays + selectedSample
        // to avoid duplicating 50k+ objects (+27 MB heap spike) during startup backfill.
        const sharedById = new Map<number, SampleItem>();
        const nextAll = patchSampleMtimes(st.allProfileSamples, patchMap, sharedById);
        const nextRaw = patchSampleMtimes(st.rawSamples, patchMap, sharedById);
        const nextSamples = patchSampleMtimes(st.samples, patchMap, sharedById);
        const selMtime = st.selectedSample
          ? patchMap.get(st.selectedSample.id)
          : undefined;
        const nextSelected =
          st.selectedSample && selMtime !== undefined
            ? sharedById.get(st.selectedSample.id) ?? {
                ...st.selectedSample,
                file_modified_at: selMtime,
              }
            : st.selectedSample;
        if (
          nextAll === st.allProfileSamples &&
          nextRaw === st.rawSamples &&
          nextSamples === st.samples &&
          nextSelected === st.selectedSample
        ) {
          return {};
        }
        if (
          nextAll !== st.allProfileSamples &&
          shouldUseCatalogWorker(nextAll.length)
        ) {
          patchCatalogWorkerMtimes(nextAll, patchMap);
        }
        return {
          allProfileSamples: nextAll,
          rawSamples: nextRaw,
          samples: nextSamples,
          selectedSample: nextSelected,
          smartCollectionCounts: st.smartCollectionCounts,
        };
      });
    };

    while (hasMore) {
      if (epochChanged()) return;
      const res = await invoke<MtimeBackfillBatchResult>(
        "backfill_file_modified_dates",
        { afterId, batchSize: 1500 }
      );
      if (!res || epochChanged()) return;

      if (res.patches.length > 0) {
        for (const p of res.patches) {
          pendingPatches.set(p.sample_id, p.file_modified_at);
        }
        appliedTotal += res.patches.length;
        if (pendingPatches.size >= MTIME_FLUSH_THRESHOLD) {
          flushPendingPatches();
        }
      }

      hasMore = res.has_more && res.last_scanned_id > afterId;
      afterId = res.last_scanned_id;
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (epochChanged()) return;
      }
    }

    flushPendingPatches();

    if (
      appliedTotal > 0 &&
      !epochChanged() &&
      ctx.get().sortKey === "dateModified"
    ) {
      ctx.applyInstantMemoryFilter({ preserveMultiSelect: true });
    }
  } catch (err) {
    console.warn("Background mtime backfill error:", err);
  } finally {
    mtimeBackfillInFlight = false;
  }
}
