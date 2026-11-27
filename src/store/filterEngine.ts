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
 * Returns true when background table filtering / tab switching must keep the
 * currently loaded top-deck sample untouched:
 * - Any actively playing track/mix/slice (`isPlaying === true`) must never be cut
 *   or replaced by an unrelated track when browsing other tabs/folders/filters.
 * - Virtual Layers deck items (`id < 0`: live draft `-999999` or saved-layer preview)
 *   must stay pinned while inside the Layers workspace even when paused, preventing
 *   a 1-frame library fallback flash when toggling Saved ↔ Editor or searching.
 */
export function shouldPreserveDeckSelection(state: {
  isPlaying: boolean;
  selectedSample: SampleItem | null;
  layersFilterActive?: boolean;
}): boolean {
  if (!state.selectedSample) return false;
  if (state.isPlaying) return true;
  return state.selectedSample.id < 0 && Boolean(state.layersFilterActive);
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
 * - When `preserveCurrentSelection` is true, keeps `currentSelected` loaded on the
 *   top deck even if it does not belong to `filtered` (clearing off-view row IDs).
 */
export function reconcileSelectionAfterFilter(
  filtered: SampleItem[],
  currentSelected: SampleItem | null,
  currentSelectedIds: number[],
  preserveMultiSelect: boolean,
  preserveCurrentSelection = false
): ReconciledSelection {
  if (filtered.length === 0) {
    if (preserveCurrentSelection && currentSelected) {
      return {
        nextSelected: currentSelected,
        nextSelectedIds: [],
        nextSelectedIndex: null,
      };
    }
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
    } else if (preserveCurrentSelection) {
      nextSelected = currentSelected;
      nextSelectedIndex = -1;
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
  const isSelectedVisible = indexById.has(nextSelected.id);
  let nextSelectedIds: number[];
  if (preserveMultiSelect && currentSelectedIds.length > 1) {
    const visibleSelected = currentSelectedIds.filter((id) =>
      indexById.has(id)
    );
    if (visibleSelected.length > 0) {
      nextSelectedIds = visibleSelected;
      if (
        !preserveCurrentSelection &&
        (!isSelectedVisible || !visibleSelected.includes(nextSelected.id))
      ) {
        const firstVisIdx = indexById.get(visibleSelected[0])!;
        nextSelected = filtered[firstVisIdx];
        nextSelectedIndex = firstVisIdx;
      }
    } else {
      nextSelectedIds = isSelectedVisible ? [nextSelected.id] : [];
    }
  } else {
    nextSelectedIds = isSelectedVisible ? [nextSelected.id] : [];
  }

  return {
    nextSelected,
    nextSelectedIds,
    nextSelectedIndex: nextSelectedIndex >= 0 ? nextSelectedIndex : null,
  };
}
