import { useEffect } from "react";
import { isStandaloneSettingsWindow } from "../store/storageHelpers";
import { useSampleStore } from "../store/useSampleStore";
import {
  isRangeSliderTarget,
  isSafeGlobalShortcutInTextEntry,
  isTextEntryTarget,
  matchesShortcut,
  shouldBlurSearchInputOnPointerDown,
} from "../utils/shortcuts";
import {
  isLayersSavedViewActive,
  isNonSampleTableViewActive,
  isSliceTableViewActive,
} from "../utils/viewModes";
import {
  handleDawListNavigationShortcut,
  handleDawTransportAndSliceShortcut,
} from "./dawShortcutsHelper";
import {
  handleCollectionOrTrashDelete,
  handleFileUtilityShortcuts,
  handleHardwareMediaKey,
  handleTransportShortcuts,
  handleUndoRedoShortcut,
} from "./globalShortcutHandlers";
import {
  handleF2RenameShortcut,
  handleMarkSliceInOutShortcut,
  handleRapidTaxonomyPickerShortcut,
  handleSliceModeKeyDown,
  handleSliceTextEntryUtility,
  handleSliceUndoRedoShortcut,
  handleToggleFavoriteShortcut,
} from "./sliceShortcutsHelper";

/**
 * Registers Audify's global keyboard shortcuts for settings, Mini Dock,
 * playback navigation, selection, and file operations.
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
        state.batchRenameLayerIds !== null ||
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

      const showingSlicesTable = isSliceTableViewActive(state);
      const showingLayersTable = isLayersSavedViewActive(state);
      const showingAltTable = isNonSampleTableViewActive(state);

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        if (showingLayersTable) {
          // Handled directly by SavedLayersTableView's grid keydown (do not leak onto background tracks)
          return;
        }
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
        if (showingLayersTable && state.selectedLayerIds.length > 1) {
          e.preventDefault();
          const keep = state.selectedLayerIds[0];
          state.setLayerSelection(keep !== undefined ? [keep] : [], keep ?? null);
          state.setStatusMessage("Cleared multi-layer selection");
          return;
        }
        if (!showingAltTable && state.selectedSampleIds.length > 1) {
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
        !showingAltTable &&
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
        !showingAltTable &&
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
      if (!showingAltTable && matchesShortcut(e, shortcuts.toggleFavorite)) {
        e.preventDefault();
        if (!e.repeat) handleToggleFavoriteShortcut(state);
        return;
      }
      if (handleRapidTaxonomyPickerShortcut(e, state)) {
        return;
      }

      if (handleF2RenameShortcut(e, state)) {
        return;
      }
      if (!showingAltTable && handleCollectionOrTrashDelete(e, state)) {
        return;
      }

      if (
        !e.repeat &&
        matchesShortcut(e, state.shortcuts.findSimilar ?? "Shift+Enter") &&
        !showingAltTable &&
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
        if (!showingAltTable && !state.trashFilterActive) {
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
