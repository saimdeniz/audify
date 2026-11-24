import { invoke } from "@tauri-apps/api/core";
import { DuplicateScanMode, DuplicateScanResult, Library } from "../../types";
import { filterVisibleLibraries, normalizePathForMatch } from "../../utils/format";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { loadSavedSort, persistNavigationFilters } from "../storageHelpers";
import type { StoreSliceContext } from "../types";

const MAX_DUPLICATE_SCAN_CACHE_ENTRIES = 2;

function putDuplicateScanCache(
  prev: Record<string, DuplicateScanResult>,
  scopeKey: string,
  result: DuplicateScanResult
): Record<string, DuplicateScanResult> {
  const keys = Object.keys(prev).filter((k) => k !== scopeKey);
  while (keys.length >= MAX_DUPLICATE_SCAN_CACHE_ENTRIES) {
    keys.shift();
  }
  const next: Record<string, DuplicateScanResult> = {};
  for (const k of keys) {
    next[k] = prev[k];
  }
  next[scopeKey] = result;
  return next;
}

export function makeDuplicateScopeKey(
  mode: DuplicateScanMode,
  libraryId: number | null,
  minSimilarityPct = 97
): string {
  return mode === "similar"
    ? `similar:${minSimilarityPct}:${libraryId ?? "all"}`
    : `exact:${libraryId ?? "all"}`;
}

export function resolveDuplicateScopeLabel(
  libraries: Library[],
  libraryId: number | null
): string {
  if (libraryId === null) return "All Libraries";
  return (
    filterVisibleLibraries(libraries).find((l) => l.id === libraryId)?.name ??
    "All Libraries"
  );
}

export function formatDuplicateModeLabel(
  mode: DuplicateScanMode,
  minSimilarityPct?: number
): string {
  if (mode !== "similar") return "Exact (SHA-256)";
  if (minSimilarityPct === 80) return "Similar Audio (All 80%+)";
  return minSimilarityPct !== undefined
    ? `Similar Audio (>= ${minSimilarityPct}%)`
    : "Similar Audio";
}

export function pruneDuplicateScanCache(
  cache: Record<string, DuplicateScanResult>,
  removedIds: ReadonlySet<number>
): Record<string, DuplicateScanResult> {
  if (removedIds.size === 0) return cache;
  let changed = false;
  const next: Record<string, DuplicateScanResult> = {};
  for (const [key, res] of Object.entries(cache)) {
    const pruned = pruneDuplicateScanResult(res, removedIds);
    if (pruned !== res) changed = true;
    if (pruned) {
      next[key] = pruned;
    }
  }
  return changed ? next : cache;
}

export interface DuplicateSampleMeta {
  orderIndex: number;
  groupId: string;
  groupNumber: number;
  matchKind: string;
  similarityPct: number;
  keepSuggested: boolean;
  libraryReadOnly: boolean;
}

const EMPTY_DUPLICATE_META_MAP: ReadonlyMap<number, DuplicateSampleMeta> =
  new Map();
const EMPTY_DUPLICATE_ORDER_MAP: ReadonlyMap<number, number> = new Map();

export function buildDuplicateMetaBySampleId(
  result: DuplicateScanResult | null
): ReadonlyMap<number, DuplicateSampleMeta> {
  if (!result || result.groups.length === 0) {
    return EMPTY_DUPLICATE_META_MAP;
  }
  const map = new Map<number, DuplicateSampleMeta>();
  let orderIndex = 0;
  for (let gIdx = 0; gIdx < result.groups.length; gIdx++) {
    const group = result.groups[gIdx];
    const groupNumber = gIdx + 1;
    for (const entry of group.items) {
      if (!map.has(entry.sample_id)) {
        map.set(entry.sample_id, {
          orderIndex,
          groupId: group.group_id,
          groupNumber,
          matchKind: group.match_kind,
          similarityPct: group.similarity_pct,
          keepSuggested: entry.keep_suggested,
          libraryReadOnly: entry.library_read_only,
        });
      }
      orderIndex += 1;
    }
  }
  return map;
}

export function buildDuplicateOrderMap(
  duplicatesFilterActive: boolean,
  result: DuplicateScanResult | null
): ReadonlyMap<number, number> | null {
  if (!duplicatesFilterActive) return null;
  if (!result || result.groups.length === 0) return EMPTY_DUPLICATE_ORDER_MAP;
  const order = new Map<number, number>();
  let idx = 0;
  for (const group of result.groups) {
    for (const entry of group.items) {
      if (!order.has(entry.sample_id)) {
        order.set(entry.sample_id, idx);
      }
      idx += 1;
    }
  }
  return order;
}

export function collectSuggestedExtraDuplicateIds(
  result: DuplicateScanResult | null,
  visibleSampleIds?: ReadonlySet<number>,
  minSimilarityPct = 0
): number[] {
  if (!result || result.groups.length === 0) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const group of result.groups) {
    if (minSimilarityPct > 0 && group.similarity_pct < minSimilarityPct) {
      continue;
    }
    for (const entry of group.items) {
      if (entry.keep_suggested || entry.library_read_only) continue;
      if (visibleSampleIds && !visibleSampleIds.has(entry.sample_id)) continue;
      if (!seen.has(entry.sample_id)) {
        seen.add(entry.sample_id);
        ids.push(entry.sample_id);
      }
    }
  }
  return ids;
}

export function pruneDuplicateScanResult(
  result: DuplicateScanResult | null,
  removedIds: ReadonlySet<number>
): DuplicateScanResult | null {
  if (!result || removedIds.size === 0) return result;
  const nextGroups = result.groups
    .map((group) => {
      const remaining = group.items.filter(
        (entry) => !removedIds.has(entry.sample_id)
      );
      if (remaining.length < 2) return null;
      const hasKeep = remaining.some((entry) => entry.keep_suggested);
      const normalizedItems = hasKeep
        ? remaining
        : remaining.map((entry, idx) => ({
            ...entry,
            keep_suggested: idx === 0,
          }));
      const reclaimableBytes = normalizedItems.reduce(
        (sum, entry) => sum + (entry.keep_suggested ? 0 : entry.file_size),
        0
      );
      return {
        ...group,
        items: normalizedItems,
        reclaimable_bytes: reclaimableBytes,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  return {
    ...result,
    groups_found: nextGroups.length,
    duplicate_files_count: nextGroups.reduce(
      (sum, g) => sum + Math.max(0, g.items.length - 1),
      0
    ),
    reclaimable_bytes: nextGroups.reduce(
      (sum, g) => sum + g.reclaimable_bytes,
      0
    ),
    groups: nextGroups,
  };
}

export function createDuplicateSlice(ctx: StoreSliceContext) {
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
        selectedSample: firstSample,
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
