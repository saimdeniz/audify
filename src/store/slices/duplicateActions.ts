import { invoke } from "@tauri-apps/api/core";
import { DuplicateScanMode, DuplicateScanResult } from "../../types";
import type { StoreSliceContext } from "../types";
import {
  makeDuplicateScopeKey,
  putDuplicateScanCache,
} from "./duplicateHelpers";

export function createDuplicateAsyncActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, getProfileEpoch, emitNotice } = ctx;
  let activeScanSeq = 0;

  const refreshDuplicateView = (preserveMultiSelect = false) => {
    if (!applyInstantMemoryFilter({ preserveMultiSelect })) {
      void get().fetchSamples({ preserveMultiSelect });
    }
  };

  return {
    scanDuplicates: async (
      modeOverride?: DuplicateScanMode,
      libraryIdOverride?: number | null,
      minSimilarityPctOverride?: number
    ) => {
      const st = get();
      const mode = modeOverride ?? st.duplicateScanMode;
      const libraryId =
        libraryIdOverride !== undefined
          ? libraryIdOverride
          : st.duplicateLibraryId;
      const minPct =
        minSimilarityPctOverride !== undefined
          ? minSimilarityPctOverride
          : st.duplicateMinSimilarityPct;
      const scanSeq = ++activeScanSeq;
      const epoch = getProfileEpoch();

      set({
        duplicateScanMode: mode,
        duplicateLibraryId: libraryId,
        duplicateMinSimilarityPct: minPct,
        isScanningDuplicates: true,
        duplicateScanProgress: null,
        duplicateScanError: null,
      });

      try {
        const res = await invoke<DuplicateScanResult>("scan_duplicate_samples", {
          mode,
          libraryId,
          ...(mode === "similar" ? { minSimilarityPct: minPct } : {}),
        });
        if (scanSeq !== activeScanSeq || epoch !== getProfileEpoch()) {
          return;
        }
        const scopeKey = makeDuplicateScopeKey(mode, libraryId, minPct);
        set((prev) => ({
          duplicateScanResult: res,
          duplicateScanCache: putDuplicateScanCache(
            prev.duplicateScanCache,
            scopeKey,
            res
          ),
          isScanningDuplicates: false,
          duplicateScanProgress: null,
          duplicateScanError: null,
        }));
        if (get().duplicatesFilterActive) {
          refreshDuplicateView(false);
        }
      } catch (err) {
        if (scanSeq !== activeScanSeq || epoch !== getProfileEpoch()) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        set({
          isScanningDuplicates: false,
          duplicateScanProgress: null,
          duplicateScanError: message,
        });
        emitNotice(`Duplicate scan failed: ${message}`, "error");
      }
    },
  };
}
