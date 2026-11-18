import { invoke } from "@tauri-apps/api/core";
import { SampleItem } from "../types";
import type { StoreSliceContext } from "./types";

interface MtimeBackfillBatchResult {
  patches: { sample_id: number; file_modified_at: number }[];
  last_scanned_id: number;
  has_more: boolean;
}

let mtimeBackfillInFlight = false;

function patchSampleMtimes(
  list: SampleItem[],
  patchMap: ReadonlyMap<number, number>
): SampleItem[] {
  let changed = false;
  const next = list.map((item) => {
    const mtime = patchMap.get(item.id);
    if (mtime === undefined || item.file_modified_at === mtime) {
      return item;
    }
    changed = true;
    return { ...item, file_modified_at: mtime };
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

  try {
    let afterId = 0;
    let hasMore = true;
    let appliedTotal = 0;

    while (hasMore) {
      if (epochChanged()) return;
      const res = await invoke<MtimeBackfillBatchResult>(
        "backfill_file_modified_dates",
        { afterId, batchSize: 1500 }
      );
      if (!res || epochChanged()) return;

      if (res.patches.length > 0) {
        const patchMap = new Map<number, number>();
        for (const p of res.patches) {
          patchMap.set(p.sample_id, p.file_modified_at);
        }

        ctx.set((st) => {
          const nextAll = patchSampleMtimes(st.allProfileSamples, patchMap);
          const nextRaw = patchSampleMtimes(st.rawSamples, patchMap);
          const nextSamples = patchSampleMtimes(st.samples, patchMap);
          const selMtime = st.selectedSample
            ? patchMap.get(st.selectedSample.id)
            : undefined;
          const nextSelected =
            st.selectedSample && selMtime !== undefined
              ? { ...st.selectedSample, file_modified_at: selMtime }
              : st.selectedSample;
          return {
            allProfileSamples: nextAll,
            rawSamples: nextRaw,
            samples: nextSamples,
            selectedSample: nextSelected,
            smartCollectionCounts: st.smartCollectionCounts,
          };
        });
        appliedTotal += res.patches.length;
      }

      hasMore = res.has_more && res.last_scanned_id > afterId;
      afterId = res.last_scanned_id;
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (epochChanged()) return;
      }
    }

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
