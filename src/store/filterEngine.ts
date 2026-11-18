import { SampleItem } from "../types";
import { normalizePathForMatch } from "../utils/format";
import { loadSavedLastSample } from "./storageHelpers";

export {
  applyClientFacetFilters,
  applySort,
  doesSampleMatchInitialView,
  filterBaseSamplesInMemory,
  type InitialSampleViewFilter,
} from "../utils/catalogFilterCore";

export interface ReconciledSelection {
  nextSelected: SampleItem | null;
  nextSelectedIds: number[];
  nextSelectedIndex: number | null;
}

/**
 * Reconciles primary selection, multi-selection, and Shift-anchor index after any
 * filter, search, sort, or view switch.
 *
 * - Never leaves invisible ("ghost") off-screen IDs in `selectedSampleIds`.
 * - Resets multi-selection to `[nextSelected.id]` when switching navigation views
 *   (`preserveMultiSelect: false`), while keeping visible multi-selections intact
 *   when refining within the current view (`preserveMultiSelect: true`).
 * - Always recomputes `lastSelectedIndex` against the new `filtered` list.
 */
export function reconcileSelectionAfterFilter(
  filtered: SampleItem[],
  currentSelected: SampleItem | null,
  currentSelectedIds: number[],
  preserveMultiSelect: boolean
): ReconciledSelection {
  if (filtered.length === 0) {
    return {
      nextSelected: null,
      nextSelectedIds: [],
      nextSelectedIndex: null,
    };
  }

  let nextSelected: SampleItem | null = null;
  let nextSelectedIndex = -1;

  // Build O(1) index map for fast lookup across 55k+ items
  const indexById = new Map<number, number>();
  for (let i = 0; i < filtered.length; i++) {
    indexById.set(filtered[i].id, i);
  }

  // 1. Keep currently selected/playing track if it is visible in the new filtered set
  if (currentSelected) {
    const curIdx = indexById.get(currentSelected.id);
    if (curIdx !== undefined) {
      nextSelected = filtered[curIdx];
      nextSelectedIndex = curIdx;
    }
  }

  // 2. Otherwise check saved last played sample if present in filtered
  if (!nextSelected) {
    const savedLast = loadSavedLastSample();
    if (savedLast.id !== null) {
      const savedIdx = indexById.get(savedLast.id);
      if (savedIdx !== undefined) {
        nextSelected = filtered[savedIdx];
        nextSelectedIndex = savedIdx;
      }
    }
    if (!nextSelected && savedLast.path !== null) {
      const normSavedPath = normalizePathForMatch(savedLast.path);
      for (let i = 0; i < filtered.length; i++) {
        if (normalizePathForMatch(filtered[i].file_path) === normSavedPath) {
          nextSelected = filtered[i];
          nextSelectedIndex = i;
          break;
        }
      }
    }
  }

  // 3. Fallback to the first visible sample in the new view
  if (!nextSelected) {
    nextSelected = filtered[0];
    nextSelectedIndex = 0;
  }

  // 4. Prune multi-selection strictly to visible rows (eliminating Ghost Multi-Selection)
  let nextSelectedIds: number[];
  if (preserveMultiSelect && currentSelectedIds.length > 1) {
    const visibleSelected = currentSelectedIds.filter((id) =>
      indexById.has(id)
    );
    if (visibleSelected.length > 0) {
      nextSelectedIds = visibleSelected;
      if (!indexById.has(nextSelected.id) || !visibleSelected.includes(nextSelected.id)) {
        const firstVisIdx = indexById.get(visibleSelected[0])!;
        nextSelected = filtered[firstVisIdx];
        nextSelectedIndex = firstVisIdx;
      }
    } else {
      nextSelectedIds = [nextSelected.id];
    }
  } else {
    nextSelectedIds = [nextSelected.id];
  }

  return {
    nextSelected,
    nextSelectedIds,
    nextSelectedIndex: nextSelectedIndex >= 0 ? nextSelectedIndex : null,
  };
}
