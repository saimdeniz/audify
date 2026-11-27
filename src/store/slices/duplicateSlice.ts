import { DuplicateScanMode } from "../../types";
import { filterVisibleLibraries, normalizePathForMatch } from "../../utils/format";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { loadSavedSort, persistNavigationFilters } from "../storageHelpers";
import type { StoreSliceContext } from "../types";
import {
  collectSuggestedExtraDuplicateIds,
  makeDuplicateScopeKey,
} from "./duplicateHelpers";

export {
  buildDuplicateMetaBySampleId,
  buildDuplicateOrderMap,
  collectSuggestedExtraDuplicateIds,
  formatDuplicateModeLabel,
  makeDuplicateScopeKey,
  pruneDuplicateScanCache,
  pruneDuplicateScanResult,
  resolveDuplicateScopeLabel,
} from "./duplicateHelpers";
export type { DuplicateSampleMeta } from "./duplicateHelpers";

export function createDuplicateSlice(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  let cachedAsyncActions: ReturnType<
    typeof import("./duplicateActions").createDuplicateAsyncActions
  > | null = null;
  const loadAsyncActions = async () => {
    if (!cachedAsyncActions) {
      const mod = await import("./duplicateActions");
      cachedAsyncActions = mod.createDuplicateAsyncActions(ctx);
    }
    return cachedAsyncActions;
  };

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
    ) =>
      (await loadAsyncActions()).scanDuplicates(
        modeOverride,
        libraryIdOverride,
        minSimilarityPctOverride
      ),

    setDuplicateScope: (
      modeOverride?: DuplicateScanMode,
      libraryIdOverride?: number | null,
      minSimilarityPctOverride?: number
    ) => {
      const st = get();
      if (st.isScanningDuplicates) return;
      const nextMode = modeOverride ?? st.duplicateScanMode;
      const nextLibraryId =
        libraryIdOverride !== undefined
          ? libraryIdOverride
          : st.duplicateLibraryId;
      const nextMinPct =
        minSimilarityPctOverride !== undefined
          ? minSimilarityPctOverride
          : st.duplicateMinSimilarityPct;
      const scopeKey = makeDuplicateScopeKey(nextMode, nextLibraryId, nextMinPct);
      const cached = st.duplicateScanCache[scopeKey] ?? null;
      const nextExtrasMin =
        nextMode === "similar" &&
        minSimilarityPctOverride !== undefined &&
        st.duplicateExtrasMinPct > 0 &&
        nextMinPct > st.duplicateExtrasMinPct
          ? nextMinPct
          : st.duplicateExtrasMinPct;

      set({
        duplicateScanMode: nextMode,
        duplicateLibraryId: nextLibraryId,
        duplicateMinSimilarityPct: nextMinPct,
        duplicateExtrasMinPct: nextExtrasMin,
        duplicateScanResult: cached,
        duplicateScanError: null,
      });
      if (get().duplicatesFilterActive) {
        refreshDuplicateView(false);
      }
    },

    setDuplicateExtrasMinPct: (pct: number) => {
      set({ duplicateExtrasMinPct: pct });
    },

    setDuplicatesFilterActive: (active: boolean) => {
      clearSmartSearchCache();
      persistNavigationFilters(null, null, false, null);

      if (active) {
        const prevState = get();
        let nextLibraryId = prevState.duplicateLibraryId;
        if (prevState.folderFilter) {
          const normFolder = normalizePathForMatch(prevState.folderFilter);
          const matchedLib = filterVisibleLibraries(prevState.libraries).find(
            (lib) => {
              const normLib = normalizePathForMatch(lib.path);
              return (
                normLib.length > 0 &&
                (normFolder === normLib || normFolder.startsWith(`${normLib}/`))
              );
            }
          );
          if (matchedLib) {
            nextLibraryId = matchedLib.id;
          }
        }
        const scopeKey = makeDuplicateScopeKey(
          prevState.duplicateScanMode,
          nextLibraryId,
          prevState.duplicateMinSimilarityPct
        );
        const nextResult =
          nextLibraryId === prevState.duplicateLibraryId
            ? prevState.duplicateScanCache[scopeKey] ??
              prevState.duplicateScanResult
            : prevState.duplicateScanCache[scopeKey] ?? null;

        set({
          duplicatesFilterActive: true,
          duplicateLibraryId: nextLibraryId,
          duplicateScanResult: nextResult,
          duplicateScanError: null,
          favoriteOnly: false,
          recentOnly: false,
          folderFilter: null,
          selectedLicenseGroupId: null,
          binFilterActive: false,
          trashFilterActive: false,
          slicesFilterActive: false,
          layersFilterActive: false,
          selectedCollectionId: null,
          selectedTagIds: [],
          selectedGenre: null,
          sortKey: null,
        });
        refreshDuplicateView(false);
        return;
      }

      const wasSortNull = get().sortKey === null;
      const savedSort = loadSavedSort();
      set({
        duplicatesFilterActive: false,
        folderFilter: null,
        ...(wasSortNull && savedSort.key !== null
          ? { sortKey: savedSort.key, sortDir: savedSort.dir }
          : {}),
      });
      refreshDuplicateView(false);
    },

    selectSuggestedDuplicateExtras: (minSimilarityPctOverride?: number) => {
      const st = get();
      if (!st.duplicateScanResult) return;
      const visibleIds =
        st.samples.length > 0 ? new Set(st.samples.map((s) => s.id)) : undefined;
      const effectiveMinPct =
        st.duplicateScanMode === "similar"
          ? minSimilarityPctOverride ?? st.duplicateExtrasMinPct
          : 0;
      const extraIds = collectSuggestedExtraDuplicateIds(
        st.duplicateScanResult,
        visibleIds,
        effectiveMinPct
      );
      if (extraIds.length === 0) {
        emitNotice(
          effectiveMinPct > 0
            ? `No writable extra copies at >= ${effectiveMinPct}% similarity — try lowering the Extras threshold`
            : "No writable suggested extra copies available in the current view",
          "info"
        );
        return;
      }
      const extraSet = new Set(extraIds);
      const firstIndex = st.samples.findIndex((s) => extraSet.has(s.id));
      const firstSample =
        firstIndex >= 0
          ? st.samples[firstIndex]
          : st.allProfileSamples.find((s) => extraSet.has(s.id)) ??
            st.selectedSample;
      set({
        selectedSampleIds: extraIds,
        selectedSample: st.isPlaying ? st.selectedSample : firstSample,
        lastSelectedIndex: firstIndex >= 0 ? firstIndex : null,
      });
      emitNotice(
        st.enableAdvancedFileOps
          ? `Selected ${extraIds.length} suggested duplicate copy(ies) — press Del or Trash to remove`
          : `Selected ${extraIds.length} duplicate copy(ies) — enable Write Mode in Settings → Advanced to delete`,
        "info"
      );
    },
  };
}
