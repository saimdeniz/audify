import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import type { SampleStoreState } from "../store/useSampleStore";
import { copyTextToClipboard } from "../utils/clipboard";
import {
  isSafeGlobalShortcutInTextEntry,
  matchesShortcut,
} from "../utils/shortcuts";

function resolveTargetSliceIds(state: SampleStoreState): number[] {
  if (state.selectedSliceIds.length > 0) return state.selectedSliceIds;
  if (state.activeSliceId !== null) return [state.activeSliceId];
  return [];
}

function isSliceTableShowing(state: SampleStoreState): boolean {
  return (
    state.slicesFilterActive ||
    (state.trashFilterActive && state.trashViewTab === "slices")
  );
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
  state: SampleStoreState
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

  if (e.key === "ArrowDown" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    state.selectRelativeSlice(1);
    return true;
  }
  if (e.key === "ArrowUp" && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
