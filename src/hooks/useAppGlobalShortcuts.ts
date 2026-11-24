import { useEffect } from "react";
import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import { isStandaloneSettingsWindow } from "../store/storageHelpers";
import { useSampleStore } from "../store/useSampleStore";
import { resolveSamplesByIds } from "../utils/sampleLookup";
import {
  isHardwareMediaKey,
  isRangeSliderTarget,
  isSafeGlobalShortcutInTextEntry,
  isTextEntryTarget,
  matchesShortcut,
  shouldBlurSearchInputOnPointerDown,
} from "../utils/shortcuts";
import {
  handleDawListNavigationShortcut,
  handleDawTransportAndSliceShortcut,
} from "./dawShortcutsHelper";
import {
  handleF2RenameShortcut,
  handleMarkSliceInOutShortcut,
  handleSliceModeKeyDown,
  handleSliceTextEntryUtility,
  handleSliceUndoRedoShortcut,
  handleToggleFavoriteShortcut,
} from "./sliceShortcutsHelper";

type AppStoreState = ReturnType<typeof useSampleStore.getState>;

interface TransportShortcutEntry {
  shortcut: string;
  allowRepeat?: boolean;
  run: (state: AppStoreState) => void;
}

function getTransportShortcuts(state: AppStoreState): TransportShortcutEntry[] {
  const { shortcuts } = state;
  return [
    { shortcut: shortcuts.prevTrack, allowRepeat: true, run: (st) => st.selectRelativeSample(-1) },
    { shortcut: shortcuts.nextTrack, allowRepeat: true, run: (st) => st.selectRelativeSample(1) },
    { shortcut: shortcuts.stopPlayback, run: (st) => st.stopPlayback() },
    { shortcut: shortcuts.toggleShuffle, run: (st) => st.toggleShuffle() },
    { shortcut: shortcuts.toggleAutoPreview, run: (st) => st.toggleAutoPreview() },
    { shortcut: shortcuts.toggleMute, run: (st) => st.toggleMute() },
    { shortcut: shortcuts.playPause, run: (st) => st.togglePlayPause() },
    { shortcut: shortcuts.toggleLoop, run: (st) => st.toggleLooping() },
  ];
}

function handleHardwareMediaKey(e: KeyboardEvent, state: AppStoreState): boolean {
  if (!isHardwareMediaKey(e.key)) return false;
  e.preventDefault();
  if (e.repeat) return true;
  if (e.key === "MediaPlayPause" || e.key === "MediaPlay" || e.key === "MediaPause") {
    state.togglePlayPause();
  } else if (e.key === "MediaStop") {
    state.stopPlayback();
  } else if (e.key === "MediaTrackPrevious") {
    state.selectRelativeSample(-1);
  } else if (e.key === "MediaTrackNext") {
    state.selectRelativeSample(1);
  }
  return true;
}

function handleFileUtilityShortcuts(
  e: KeyboardEvent,
  state: AppStoreState,
  textEntryOnly: boolean
): boolean {
  const saveSliceKey =
    state.shortcuts.saveSlice ?? DEFAULT_SHORTCUTS.saveSlice ?? "";
  if (
    saveSliceKey &&
    (textEntryOnly
      ? isSafeGlobalShortcutInTextEntry(e, saveSliceKey)
      : matchesShortcut(e, saveSliceKey))
  ) {
    e.preventDefault();
    if (!e.repeat) {
      void state.saveActiveSlice();
    }
    return true;
  }

  const copyKey =
    state.shortcuts.copyFilePath ?? DEFAULT_SHORTCUTS.copyFilePath ?? "";
  if (
    copyKey &&
    (textEntryOnly
      ? isSafeGlobalShortcutInTextEntry(e, copyKey)
      : matchesShortcut(e, copyKey))
  ) {
    e.preventDefault();
    if (
      !e.repeat &&
      (state.selectedSampleIds.length > 0 || state.selectedSample)
    ) {
      void state.copySamplePaths();
    }
    return true;
  }

  const revealKey =
    state.shortcuts.showInFolder ?? DEFAULT_SHORTCUTS.showInFolder ?? "";
  if (
    revealKey &&
    (textEntryOnly
      ? isSafeGlobalShortcutInTextEntry(e, revealKey)
      : matchesShortcut(e, revealKey))
  ) {
    e.preventDefault();
    const targetSample =
      state.selectedSample ??
      (state.selectedSampleIds.length > 0
        ? resolveSamplesByIds(
            [state.selectedSampleIds[0]],
            state.samples,
            state.allProfileSamples
          )[0] ?? null
        : null);
    if (!e.repeat && targetSample) {
      void state.showInFolder(targetSample.file_path);
    }
    return true;
  }

  return false;
}

function handleTransportShortcuts(
  e: KeyboardEvent,
  state: AppStoreState,
  textEntryOnly: boolean
): boolean {
  for (const entry of getTransportShortcuts(state)) {
    const matched = textEntryOnly
      ? isSafeGlobalShortcutInTextEntry(e, entry.shortcut)
      : matchesShortcut(e, entry.shortcut);
    if (!matched) continue;
    e.preventDefault();
    if (entry.allowRepeat || !e.repeat) {
      entry.run(state);
    }
    return true;
  }
  return false;
}

function handleUndoRedoShortcut(
  e: KeyboardEvent,
  state: AppStoreState
): boolean {
  if (!state.enableAdvancedFileOps || !(e.ctrlKey || e.metaKey) || e.altKey) {
    return false;
  }
  const lowerKey = e.key.toLowerCase();
  if (!e.shiftKey && lowerKey === "z") {
    e.preventDefault();
    if (!e.repeat) void state.undoLastFileOp();
    return true;
  }
  if ((!e.shiftKey && lowerKey === "y") || (e.shiftKey && lowerKey === "z")) {
    e.preventDefault();
    if (!e.repeat) void state.redoLastFileOp();
    return true;
  }
  return false;
}

function handleCollectionOrTrashDelete(
  e: KeyboardEvent,
  state: AppStoreState
): boolean {
  const {
    shortcuts,
    selectedCollectionId,
    selectedSampleIds,
    selectedSample,
  } = state;

  const removeKey =
    shortcuts.removeFromCollection ?? DEFAULT_SHORTCUTS.removeFromCollection;
  const isDefaultRemove = removeKey === DEFAULT_SHORTCUTS.removeFromCollection;
  const matchedRemoveFromCollection =
    removeKey !== "" &&
    (isDefaultRemove
      ? !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "Delete" || e.key === "Backspace")
      : matchesShortcut(e, removeKey));

  if (selectedCollectionId !== null && matchedRemoveFromCollection) {
    const activeCol = state.collections.find((c) => c.id === selectedCollectionId);
    if (activeCol?.smart_query?.trim()) {
      e.preventDefault();
      if (!e.repeat) {
        state.setStatusMessage(
          "Smart Collections are dynamic — switch to All Samples to trash files"
        );
      }
      return true;
    }
    const idsToRemove =
      selectedSampleIds.length > 0
        ? selectedSampleIds
        : selectedSample
        ? [selectedSample.id]
        : [];
    if (idsToRemove.length > 0) {
      e.preventDefault();
      if (!e.repeat) {
        void state.removeSamplesFromCollection(
          selectedCollectionId,
          idsToRemove
        );
      }
    }
    return true;
  }

  if (
    state.binFilterActive &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    (e.key === "Delete" || e.key === "Backspace")
  ) {
    const idsToRemove =
      selectedSampleIds.length > 0
        ? selectedSampleIds
        : selectedSample
        ? [selectedSample.id]
        : [];
    if (idsToRemove.length > 0) {
      e.preventDefault();
      if (!e.repeat) {
        state.removeSamplesFromBin(idsToRemove);
      }
    }
    return true;
  }

  if (
    selectedCollectionId === null &&
    !state.trashFilterActive &&
    !state.binFilterActive &&
    state.enableAdvancedFileOps &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    e.key === "Delete"
  ) {
    const idsToTrash =
      selectedSampleIds.length > 0
        ? selectedSampleIds
        : selectedSample
        ? [selectedSample.id]
        : [];
    if (idsToTrash.length > 0) {
      e.preventDefault();
      if (!e.repeat) {
        void state.requestMoveSamplesToTrash(idsToTrash);
      }
    }
    return true;
  }

  return false;
}

/**
 * Registers Audify's global keyboard shortcuts for settings, Mini Dock,
 * playback navigation, selection, file operations, and quick tag 1-9 hotkeys.
 */
export function useAppGlobalShortcuts(): void {
  useEffect(() => {
    if (isStandaloneSettingsWindow()) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const state = useSampleStore.getState();
      if (state.pendingTrashRequest || state.pendingFileConflictPrompt) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isRecordingShortcut = target?.dataset?.shortcutRecorder === "true";
      const hasBlockingModal =
        isRecordingShortcut ||
        state.batchRenameSampleIds !== null ||
        state.batchRenameSliceIds !== null ||
        document.querySelector('[data-modal-portal="true"]') !== null;

      if (!hasBlockingModal && (e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        if (state.isMiniDock) {
          void state.toggleMiniDock().then(() => {
            useSampleStore.getState().setSettingsOpen(true);
          });
        } else {
          state.setSettingsOpen(!state.isSettingsOpen);
        }
        return;
      }

      const miniDockKey = state.shortcuts.toggleMiniDock ?? "Ctrl+M";

      // Allow modifier-chord toggleMiniDock (e.g. Ctrl+M) even when search input is focused
      if (
        !state.isSettingsOpen &&
        !hasBlockingModal &&
        miniDockKey &&
        isSafeGlobalShortcutInTextEntry(e, miniDockKey)
      ) {
        e.preventDefault();
        if (!e.repeat) void state.toggleMiniDock();
        return;
      }

      if (hasBlockingModal) return;
      if (!state.isSettingsOpen && handleHardwareMediaKey(e, state)) return;
      if (isTextEntryTarget(target)) {
        if (!state.isSettingsOpen) {
          if (!handleTransportShortcuts(e, state, true)) {
            if (!handleSliceTextEntryUtility(e, state)) {
              handleFileUtilityShortcuts(e, state, true);
            }
          }
        }
        return;
      }
      if (state.isSettingsOpen) return;

      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === "F1" || e.key === "?")
      ) {
        e.preventDefault();
        if (!e.repeat) {
          window.dispatchEvent(new CustomEvent("audify:toggle-shortcuts-cheatsheet"));
        }
        return;
      }

      if (handleSliceUndoRedoShortcut(e, state) || handleUndoRedoShortcut(e, state)) return;

      if (miniDockKey && matchesShortcut(e, miniDockKey)) {
        e.preventDefault();
        if (!e.repeat) void state.toggleMiniDock();
        return;
      }

      // Yield Escape if any floating portal popover or context menu is open
      if (
        e.key === "Escape" &&
        document.querySelector(
          "[data-color-picker-portal], [data-quick-create-portal], [data-context-menu-portal]"
        )
      ) {
        return;
      }

      if (
        state.enableLicensesSystem &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "c"
      ) {
        e.preventDefault();
        if (!e.repeat) void state.copyAttributionForSamples();
        return;
      }

      const showingSlicesTable =
        state.slicesFilterActive ||
        (state.trashFilterActive && state.trashViewTab === "slices");

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        if (!e.repeat) {
          if (showingSlicesTable) {
            state.selectAllSlices();
          } else {
            state.selectAllSamples();
          }
        }
        return;
      }

      if (e.key === "Escape") {
        if (state.sliceRange !== null) {
          e.preventDefault();
          state.setSliceRange(null);
          state.setStatusMessage("Cleared waveform slice");
          return;
        }
        if (showingSlicesTable && state.selectedSliceIds.length > 1) {
          e.preventDefault();
          const fallbackId =
            state.activeSliceId !== null &&
            state.selectedSliceIds.includes(state.activeSliceId)
              ? state.activeSliceId
              : state.selectedSliceIds[0];
          state.setSliceSelection(
            fallbackId !== undefined ? [fallbackId] : [],
            fallbackId ?? null,
            null
          );
          state.setStatusMessage("Cleared multi-slice selection");
          return;
        }
        if (!showingSlicesTable && state.selectedSampleIds.length > 1) {
          e.preventDefault();
          state.clearMultiSelection();
          return;
        }
        if (matchesShortcut(e, state.shortcuts.stopPlayback)) {
          e.preventDefault();
          state.stopPlayback();
        }
        return;
      }

      const isRangeSlider = isRangeSliderTarget(target);
      const hasOpenFloatingMenu =
        document.querySelector(
          "[data-context-menu-portal='true'], [data-popover-portal='true'], [data-color-picker-portal='true'], [data-quick-create-portal='true']"
        ) !== null;

      if (
        !hasOpenFloatingMenu &&
        handleSliceModeKeyDown(e, state, isRangeSlider)
      ) {
        return;
      }

      if (
        !isRangeSlider &&
        !hasOpenFloatingMenu &&
        handleDawListNavigationShortcut(e, state)
      ) {
        return;
      }

      if (
        !isRangeSlider &&
        !hasOpenFloatingMenu &&
        e.key === "ArrowDown" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        state.selectRelativeSample(1);
        return;
      }
      if (
        !isRangeSlider &&
        !hasOpenFloatingMenu &&
        e.key === "ArrowUp" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        state.selectRelativeSample(-1);
        return;
      }

      const {
        shortcuts,
        selectedSample,
        selectedSampleIds,
        sliceRange,
        tags,
      } = state;

      if (handleTransportShortcuts(e, state, false)) {
        return;
      }
      if (hasOpenFloatingMenu) {
        return;
      }
      if (handleDawTransportAndSliceShortcut(e, state)) {
        return;
      }
      if (handleFileUtilityShortcuts(e, state, false)) {
        return;
      }
      if (handleMarkSliceInOutShortcut(e, state)) {
        return;
      }
      if (matchesShortcut(e, shortcuts.clearSlice)) {
        if (sliceRange !== null) {
          e.preventDefault();
          state.setSliceRange(null);
          state.setStatusMessage("Cleared waveform slice");
        }
        return;
      }
      if (matchesShortcut(e, shortcuts.toggleFavorite)) {
        e.preventDefault();
        if (!e.repeat) handleToggleFavoriteShortcut(state);
        return;
      }

      if (handleF2RenameShortcut(e, state)) {
        return;
      }
      if (handleCollectionOrTrashDelete(e, state)) {
        return;
      }

      if (
        !e.repeat &&
        matchesShortcut(e, state.shortcuts.findSimilar ?? "Shift+Enter") &&
        !state.slicesFilterActive &&
        !state.trashFilterActive &&
        state.selectedSample &&
        state.selectedSample.id > 0 &&
        !state.selectedSample.is_trashed
      ) {
        e.preventDefault();
        void state.findSimilarSamples(state.selectedSample);
        return;
      }

      if (matchesShortcut(e, shortcuts.addToBin)) {
        if (!showingSlicesTable && !state.trashFilterActive) {
          const ids = (
            selectedSampleIds.length > 0
              ? selectedSampleIds
              : selectedSample
              ? [selectedSample.id]
              : []
          ).filter((id) => id > 0);
          if (ids.length > 0) {
            e.preventDefault();
            if (!e.repeat) state.addSamplesToBin(ids);
          }
        }
        return;
      }

      if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (state.slicesFilterActive || state.trashFilterActive) return;
        const idx = parseInt(e.key, 10) - 1;
        if (tags[idx]) {
          e.preventDefault();
          if (!e.repeat) {
            const targetTagIds = selectedSampleIds.filter((id) => id > 0);
            if (targetTagIds.length > 1) {
              void state.assignTagBatch(targetTagIds, tags[idx].id);
            } else if (selectedSample && selectedSample.id > 0) {
              void state.assignTag(selectedSample.id, tags[idx].id);
            }
          }
        }
        return;
      }

      // Never allow bare Space to scroll the virtualized sample list or click a focused button
      if (
        (e.key === " " || e.code === "Space") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      const active = document.activeElement;
      if (shouldBlurSearchInputOnPointerDown(active, e.target)) {
        active.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, []);
}
