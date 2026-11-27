import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import { getPlayheadSec } from "../store/playheadClock";
import type { SampleStoreState } from "../store/useSampleStore";
import { copyTextToClipboard } from "../utils/clipboard";
import { formatSecondsCode } from "../utils/format";
import {
  isSafeGlobalShortcutInTextEntry,
  matchesShortcut,
} from "../utils/shortcuts";
import { isSlicePreviewSample } from "../utils/slicePreview";
import {
  isLayersSavedViewActive,
  isSliceTableViewActive,
} from "../utils/viewModes";

function resolveTargetSliceIds(state: SampleStoreState): number[] {
  if (state.selectedSliceIds.length > 0) return state.selectedSliceIds;
  if (state.activeSliceId !== null) return [state.activeSliceId];
  return [];
}

function isSliceTableShowing(state: SampleStoreState): boolean {
  return isSliceTableViewActive(state);
}

function isSliceTrashActive(state: SampleStoreState): boolean {
  return state.trashFilterActive && state.trashViewTab === "slices";
}

export function handleSliceUndoRedoShortcut(
  e: KeyboardEvent,
  state: SampleStoreState
): boolean {
  if (
    !isSliceTableShowing(state) ||
    !state.enableAdvancedFileOps ||
    !(e.ctrlKey || e.metaKey) ||
    e.altKey
  ) {
    return false;
  }
  const lowerKey = e.key.toLowerCase();
  if (!e.shiftKey && lowerKey === "z") {
    e.preventDefault();
    if (!e.repeat) void state.undoLastSliceOp();
    return true;
  }
  if ((!e.shiftKey && lowerKey === "y") || (e.shiftKey && lowerKey === "z")) {
    e.preventDefault();
    if (!e.repeat) void state.redoLastSliceOp();
    return true;
  }
  return false;
}

export function handleSliceTextEntryUtility(
  e: KeyboardEvent,
  state: SampleStoreState
): boolean {
  if (!isSliceTableShowing(state) || isSliceTrashActive(state)) return false;
  const copyKey =
    state.shortcuts.copyFilePath ?? DEFAULT_SHORTCUTS.copyFilePath ?? "";
  if (copyKey && isSafeGlobalShortcutInTextEntry(e, copyKey)) {
    e.preventDefault();
    if (!e.repeat) {
      const targetIds = new Set(resolveTargetSliceIds(state));
      const paths = state.sliceHistory
        .filter((s) => targetIds.has(s.id))
        .map((s) => s.slice_path);
      if (paths.length > 0) void copyTextToClipboard(paths.join("\n"));
    }
    return true;
  }
  const revealKey =
    state.shortcuts.showInFolder ?? DEFAULT_SHORTCUTS.showInFolder ?? "";
  if (revealKey && isSafeGlobalShortcutInTextEntry(e, revealKey)) {
    e.preventDefault();
    if (!e.repeat) {
      const targetId = resolveTargetSliceIds(state)[0];
      const entry = state.sliceHistory.find((s) => s.id === targetId);
      if (entry?.file_exists) void state.showInFolder(entry.slice_path);
    }
    return true;
  }
  return false;
}

export function handleSliceModeKeyDown(
  e: KeyboardEvent,
  state: SampleStoreState,
  isRangeSlider = false
): boolean {
  if (!isSliceTableShowing(state)) return false;
  const inTrash = isSliceTrashActive(state);

  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    e.key.toLowerCase() === "a"
  ) {
    e.preventDefault();
    if (!e.repeat) state.selectAllSlices();
    return true;
  }

  if (
    !isRangeSlider &&
    e.key === "ArrowDown" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    e.preventDefault();
    state.selectRelativeSlice(1);
    return true;
  }
  if (
    !isRangeSlider &&
    e.key === "ArrowUp" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    e.preventDefault();
    state.selectRelativeSlice(-1);
    return true;
  }

  const targetIds = resolveTargetSliceIds(state);

  if (inTrash) {
    if (
      e.key === "F2" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      if (!e.repeat) {
        state.setStatusMessage("Restore slice from Trash before renaming");
      }
      return true;
    }
    if (
      e.key === "Delete" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      if (!e.repeat && targetIds.length > 0) {
        state.setStatusMessage(
          "Slice is already in Trash — use Restore or Empty to Recycle Bin"
        );
      }
      return true;
    }
    if (matchesShortcut(e, state.shortcuts.toggleFavorite)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  const copyKey =
    state.shortcuts.copyFilePath ?? DEFAULT_SHORTCUTS.copyFilePath ?? "";
  if (copyKey && matchesShortcut(e, copyKey)) {
    e.preventDefault();
    if (!e.repeat && targetIds.length > 0) {
      const idSet = new Set(targetIds);
      const paths = state.sliceHistory
        .filter((s) => idSet.has(s.id))
        .map((s) => s.slice_path);
      if (paths.length > 0) {
        void copyTextToClipboard(paths.join("\n")).then((ok) => {
          if (ok) {
            state.setStatusMessage(
              paths.length === 1
                ? "Copied slice file path"
                : `Copied ${paths.length} slice paths`
            );
          }
        });
      }
    }
    return true;
  }

  const revealKey =
    state.shortcuts.showInFolder ?? DEFAULT_SHORTCUTS.showInFolder ?? "";
  if (revealKey && matchesShortcut(e, revealKey)) {
    e.preventDefault();
    if (!e.repeat && targetIds.length > 0) {
      const entry = state.sliceHistory.find((s) => s.id === targetIds[0]);
      if (entry?.file_exists) void state.showInFolder(entry.slice_path);
    }
    return true;
  }

  if (matchesShortcut(e, state.shortcuts.toggleFavorite)) {
    e.preventDefault();
    if (!e.repeat && targetIds.length > 0) {
      if (targetIds.length > 1) {
        const idSet = new Set(targetIds);
        const targets = state.sliceHistory.filter((s) => idSet.has(s.id));
        const allFav = targets.length > 0 && targets.every((s) => s.is_favorite);
        void state.toggleSliceFavoritesBatch(targetIds, !allFav);
      } else {
        void state.toggleSliceFavorite(targetIds[0]);
      }
    }
    return true;
  }

  if (
    e.key === "F2" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    e.preventDefault();
    if (!e.repeat && targetIds.length > 0) {
      if (!state.enableAdvancedFileOps) {
        state.setStatusMessage(
          "F2 Rename is disabled in Safe Read-Only Mode (Enable Write Mode in Settings > Advanced)"
        );
        return true;
      }
      state.openBatchRenameSlicesModal(targetIds);
    }
    return true;
  }

  if (
    e.key === "Delete" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    e.preventDefault();
    if (!e.repeat && targetIds.length > 0) {
      if (!state.enableAdvancedFileOps) {
        state.setStatusMessage(
          "Delete is disabled in Safe Read-Only Mode (Enable Write Mode in Settings > Advanced)"
        );
        return true;
      }
      void state.trashSliceFiles(targetIds);
    }
    return true;
  }

  return false;
}

export function handleMarkSliceInOutShortcut(
  e: KeyboardEvent,
  state: SampleStoreState
): boolean {
  const sample = state.selectedSample;
  if (!sample || isSlicePreviewSample(sample)) return false;

  const markInKey =
    state.shortcuts.markSliceIn ?? DEFAULT_SHORTCUTS.markSliceIn ?? "";
  const markOutKey =
    state.shortcuts.markSliceOut ?? DEFAULT_SHORTCUTS.markSliceOut ?? "";

  const matchedIn = Boolean(markInKey && matchesShortcut(e, markInKey));
  const matchedOut = Boolean(markOutKey && matchesShortcut(e, markOutKey));
  if (!matchedIn && !matchedOut) return false;

  e.preventDefault();
  if (e.repeat) return true;

  const duration = Math.max(
    0.05,
    state.durationSec || (sample.duration_ms > 0 ? sample.duration_ms / 1000 : 1)
  );
  const minSpan = Math.min(0.04, duration * 0.5);
  const nowSec = Math.max(0, Math.min(duration, getPlayheadSec()));
  const cur = state.sliceRange;

  if (matchedIn) {
    const startSec = Math.min(nowSec, Math.max(0, duration - minSpan));
    const endSec =
      cur && cur.endSec - startSec >= minSpan ? cur.endSec : duration;
    state.setSliceRange({ startSec, endSec });
    state.setStatusMessage(`Marked Slice In: ${formatSecondsCode(startSec)}`);
    return true;
  }

  const endSec = Math.max(minSpan, Math.min(duration, nowSec));
  const startSec =
    cur && endSec - cur.startSec >= minSpan ? cur.startSec : 0;
  state.setSliceRange({ startSec, endSec });
  state.setStatusMessage(`Marked Slice Out: ${formatSecondsCode(endSec)}`);
  return true;
}

export function handleF2RenameShortcut(
  e: KeyboardEvent,
  state: SampleStoreState
): boolean {
  if (isLayersSavedViewActive(state) || isSliceTableViewActive(state)) {
    return false;
  }
  if (
    e.key !== "F2" ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.shiftKey
  ) {
    return false;
  }
  e.preventDefault();
  if (e.repeat) return true;
  if (state.trashFilterActive) {
    state.setStatusMessage("Restore file from Trash before renaming");
    return true;
  }
  if (!state.enableAdvancedFileOps) {
    state.setStatusMessage(
      "F2 Rename is disabled in Safe Read-Only Mode (Enable in Settings > Advanced)"
    );
    return true;
  }
  if (state.selectedSampleIds.length > 1) {
    state.openBatchRenameModal(state.selectedSampleIds);
    return true;
  }
  const { selectedSample } = state;
  if (selectedSample) {
    const lib = state.libraries.find((l) => l.id === selectedSample.library_id);
    if (lib?.is_read_only) {
      state.setStatusMessage(
        `Library "${lib.name}" is locked as a Protected Read-Only Vault`
      );
      return true;
    }
    state.openBatchRenameModal([selectedSample.id]);
  }
  return true;
}

export function handleToggleFavoriteShortcut(state: SampleStoreState): void {
  const { selectedSampleIds, selectedSample, samples } = state;
  if (selectedSampleIds.length > 1) {
    const idSet = new Set(selectedSampleIds);
    let hasAny = false;
    let allFav = true;
    for (let i = 0; i < samples.length; i++) {
      if (idSet.has(samples[i].id)) {
        hasAny = true;
        if (!samples[i].is_favorite) {
          allFav = false;
          break;
        }
      }
    }
    void state.toggleFavoritesBatch(selectedSampleIds, !(hasAny && allFav));
  } else if (selectedSample) {
    void state.toggleFavorite(selectedSample.id);
  }
}

export function handleRapidTaxonomyPickerShortcut(
  e: KeyboardEvent,
  state: SampleStoreState
): boolean {
  if (
    isSliceTableViewActive(state) ||
    isLayersSavedViewActive(state) ||
    state.trashFilterActive
  ) {
    return false;
  }
  if (state.selectedSampleIds.length === 0 && !state.selectedSample) {
    return false;
  }
  const tagKey =
    state.shortcuts.openTagPicker ?? DEFAULT_SHORTCUTS.openTagPicker ?? "";
  const genreKey =
    state.shortcuts.openGenrePicker ?? DEFAULT_SHORTCUTS.openGenrePicker ?? "";
  const matchedTag = Boolean(tagKey && matchesShortcut(e, tagKey));
  const matchedGenre =
    !matchedTag && Boolean(genreKey && matchesShortcut(e, genreKey));
  if (!matchedTag && !matchedGenre) return false;

  e.preventDefault();
  if (!e.repeat) {
    window.dispatchEvent(
      new CustomEvent("audify:open-row-taxonomy-picker", {
        detail: { mode: matchedTag ? "tags" : "genres" },
      })
    );
  }
  return true;
}
