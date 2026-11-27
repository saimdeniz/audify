import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import { useSampleStore } from "../store/useSampleStore";
import { resolveSamplesByIds } from "../utils/sampleLookup";
import {
  isHardwareMediaKey,
  isSafeGlobalShortcutInTextEntry,
  matchesShortcut,
} from "../utils/shortcuts";
import { isLayersEditorViewActive } from "../utils/viewModes";

export type AppStoreState = ReturnType<typeof useSampleStore.getState>;

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

export function handleHardwareMediaKey(e: KeyboardEvent, state: AppStoreState): boolean {
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

export function handleFileUtilityShortcuts(
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

export function handleTransportShortcuts(
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

export function handleUndoRedoShortcut(e: KeyboardEvent, state: AppStoreState): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  const isUndo = !e.shiftKey && k === "z";
  const isRedo = (!e.shiftKey && k === "y") || (e.shiftKey && k === "z");
  if (!isUndo && !isRedo) return false;

  const inLayersEditor = isLayersEditorViewActive(state);

  if (inLayersEditor) {
    e.preventDefault();
    if (!e.repeat) (isUndo ? state.undoLayerDraft : state.redoLayerDraft)();
    return true;
  }
  if (!state.enableAdvancedFileOps) return false;
  e.preventDefault();
  if (!e.repeat) void (isUndo ? state.undoLastFileOp : state.redoLastFileOp)();
  return true;
}

export function handleCollectionOrTrashDelete(
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
