// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import { resetPlayheadClock } from "../store/playheadClock";
import { useSampleStore } from "../store/useSampleStore";
import { useAppGlobalShortcuts } from "./useAppGlobalShortcuts";

describe("useAppGlobalShortcuts search focus & playback transport", () => {
  const originalState = useSampleStore.getState();

  beforeEach(() => {
    document.body.replaceChildren();
    invokeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    useSampleStore.setState({
      shortcuts: originalState.shortcuts,
      togglePlayPause: originalState.togglePlayPause,
      stopPlayback: originalState.stopPlayback,
      selectRelativeSample: originalState.selectRelativeSample,
      isSettingsOpen: originalState.isSettingsOpen,
      isMiniDock: originalState.isMiniDock,
      toggleMiniDock: originalState.toggleMiniDock,
      batchRenameSampleIds: originalState.batchRenameSampleIds,
      pendingTrashRequest: originalState.pendingTrashRequest,
      pendingFileConflictPrompt: originalState.pendingFileConflictPrompt,
      selectedCollectionId: originalState.selectedCollectionId,
      selectedSample: originalState.selectedSample,
      selectedSampleIds: originalState.selectedSampleIds,
      allProfileSamples: originalState.allProfileSamples,
      samples: originalState.samples,
      trashFilterActive: originalState.trashFilterActive,
      binFilterActive: originalState.binFilterActive,
      enableAdvancedFileOps: originalState.enableAdvancedFileOps,
      removeSamplesFromCollection: originalState.removeSamplesFromCollection,
      requestMoveSamplesToTrash: originalState.requestMoveSamplesToTrash,
      findSimilarSamples: originalState.findSimilarSamples,
      copySamplePaths: originalState.copySamplePaths,
      showInFolder: originalState.showInFolder,
    });
  });

  it("blurs focused search input on prevented row mousedown so Space pauses immediately", () => {
    const togglePlayPause = vi.fn();
    useSampleStore.setState({
      shortcuts: { ...DEFAULT_SHORTCUTS, playPause: " " },
      togglePlayPause,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
    });

    const wrapper = document.createElement("div");
    wrapper.dataset.searchKeepFocus = "true";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.dataset.searchInput = "true";
    const keepButton = document.createElement("button");
    wrapper.append(searchInput, keepButton);

    const sampleRow = document.createElement("div");
    sampleRow.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    document.body.append(wrapper, sampleRow);
    renderHook(() => useAppGlobalShortcuts());

    // Clicking inside search wrapper keeps focus in search input
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);
    keepButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(searchInput);

    // While typing in search input, bare Space still types rather than pausing
    const typingSpace = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    searchInput.dispatchEvent(typingSpace);
    expect(togglePlayPause).not.toHaveBeenCalled();

    // Clicking a sample row (even with preventDefault + stopPropagation) blurs search input
    sampleRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.body);

    // Pressing Space immediately triggers play/pause (whether target is document.body or window)
    const pauseSpace = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(pauseSpace);
    expect(togglePlayPause).toHaveBeenCalledTimes(1);
    expect(pauseSpace.defaultPrevented).toBe(true);

    const windowSpace = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(windowSpace);
    expect(togglePlayPause).toHaveBeenCalledTimes(2);
    expect(windowSpace.defaultPrevented).toBe(true);
  });

  it("supports hardware MediaPlayPause and custom modifier shortcuts while search input is focused", () => {
    const togglePlayPause = vi.fn();
    const stopPlayback = vi.fn();
    useSampleStore.setState({
      shortcuts: {
        ...DEFAULT_SHORTCUTS,
        playPause: "Ctrl+Space",
        stopPlayback: "F8",
      },
      togglePlayPause,
      stopPlayback,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
    });

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.dataset.searchInput = "true";
    document.body.appendChild(searchInput);
    searchInput.focus();

    renderHook(() => useAppGlobalShortcuts());

    const mediaPause = new KeyboardEvent("keydown", {
      key: "MediaPlayPause",
      code: "MediaPlayPause",
      bubbles: true,
      cancelable: true,
    });
    searchInput.dispatchEvent(mediaPause);
    expect(togglePlayPause).toHaveBeenCalledTimes(1);

    const ctrlSpace = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    searchInput.dispatchEvent(ctrlSpace);
    expect(togglePlayPause).toHaveBeenCalledTimes(2);

    const f8Stop = new KeyboardEvent("keydown", {
      key: "F8",
      code: "F8",
      bubbles: true,
      cancelable: true,
    });
    searchInput.dispatchEvent(f8Stop);
    expect(stopPlayback).toHaveBeenCalledTimes(1);
  });

  it("dispatches copySamplePaths and showInFolder shortcuts and ignores unbound empty shortcuts", () => {
    const copySamplePaths = vi.fn().mockResolvedValue(undefined);
    const showInFolder = vi.fn().mockResolvedValue(undefined);
    const sample = {
      id: 42,
      library_id: 1,
      file_path: "F:/data/sounds/kick.wav",
      file_name: "kick.wav",
      folder_path: "F:/data/sounds",
      extension: "wav",
      duration_ms: 500,
      sample_rate: 44100,
      channels: 2,
      bit_depth: 16,
      file_size: 1024,
      is_favorite: false,
      is_loop: false,
      genre: "",
      artist: "",
      album: "",
      year: "",
      peaks_json: "[]",
      created_at: "2026-11-15 10:00:00",
      tags: [],
    };
    useSampleStore.setState({
      shortcuts: {
        ...DEFAULT_SHORTCUTS,
        copyFilePath: "Ctrl+Shift+P",
        showInFolder: "Ctrl+Shift+E",
      },
      selectedSample: sample,
      selectedSampleIds: [42],
      copySamplePaths,
      showInFolder,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
    });

    renderHook(() => useAppGlobalShortcuts());

    const copyEvt = new KeyboardEvent("keydown", {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(copyEvt);
    expect(copySamplePaths).toHaveBeenCalledTimes(1);
    expect(copyEvt.defaultPrevented).toBe(true);

    const revealEvt = new KeyboardEvent("keydown", {
      key: "E",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(revealEvt);
    expect(showInFolder).toHaveBeenCalledWith("F:/data/sounds/kick.wav");
    expect(revealEvt.defaultPrevented).toBe(true);

    // Clearing copyFilePath to "" keeps it strictly disabled instead of falling back to default
    useSampleStore.setState({
      shortcuts: {
        ...DEFAULT_SHORTCUTS,
        copyFilePath: "",
      },
    });
    const unboundEvt = new KeyboardEvent("keydown", {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(unboundEvt);
    expect(copySamplePaths).toHaveBeenCalledTimes(1);
  });

  it("keeps unbound toggleMiniDock/findSimilar disabled, blocks toggleMiniDock when settings open, and prevents default on empty selection", () => {
    const toggleMiniDock = vi.fn().mockResolvedValue(undefined);
    const findSimilarSamples = vi.fn().mockResolvedValue(undefined);
    const copySamplePaths = vi.fn().mockResolvedValue(undefined);
    const showInFolder = vi.fn().mockResolvedValue(undefined);
    const sample = {
      id: 77,
      library_id: 1,
      file_path: "F:/data/sounds/snare.wav",
      file_name: "snare.wav",
      folder_path: "F:/data/sounds",
      extension: "wav",
      duration_ms: 400,
      sample_rate: 44100,
      channels: 2,
      bit_depth: 16,
      file_size: 1024,
      is_favorite: false,
      is_loop: false,
      genre: "",
      artist: "",
      album: "",
      year: "",
      peaks_json: "[]",
      created_at: "2026-11-15 10:00:00",
      tags: [],
    };

    useSampleStore.setState({
      shortcuts: {
        ...DEFAULT_SHORTCUTS,
        toggleMiniDock: "",
        findSimilar: "",
      },
      selectedSample: sample,
      selectedSampleIds: [],
      toggleMiniDock,
      findSimilarSamples,
      copySamplePaths,
      showInFolder,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
    });

    renderHook(() => useAppGlobalShortcuts());

    // Cleared ("") bindings must NOT fall back to defaults
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "m", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(toggleMiniDock).not.toHaveBeenCalled();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(findSimilarSamples).not.toHaveBeenCalled();

    // When bound, isSettingsOpen blocks toggleMiniDock
    useSampleStore.setState({
      shortcuts: { ...DEFAULT_SHORTCUTS, toggleMiniDock: "Ctrl+M" },
      isSettingsOpen: true,
    });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "m", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(toggleMiniDock).not.toHaveBeenCalled();

    // Even with empty selection, matched copyFilePath / showInFolder calls preventDefault;
    // when selectedSample is null but selectedSampleIds[0] exists, showInFolder resolves sample from pool.
    useSampleStore.setState({
      isSettingsOpen: false,
      selectedSample: null,
      selectedSampleIds: [],
      samples: [sample],
      allProfileSamples: [sample],
    });
    const emptyCopy = new KeyboardEvent("keydown", {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(emptyCopy);
    expect(emptyCopy.defaultPrevented).toBe(true);
    expect(copySamplePaths).not.toHaveBeenCalled();

    useSampleStore.setState({ selectedSampleIds: [77] });
    const fallbackReveal = new KeyboardEvent("keydown", {
      key: "E",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(fallbackReveal);
    expect(fallbackReveal.defaultPrevented).toBe(true);
    expect(showInFolder).toHaveBeenCalledWith("F:/data/sounds/snare.wav");
  });

  it("respects cleared or rebound removeFromCollection, guards Shift+Delete, and skips listener in Settings window", () => {
    const removeSamplesFromCollection = vi.fn().mockResolvedValue(undefined);
    const requestMoveSamplesToTrash = vi.fn().mockResolvedValue(undefined);
    const togglePlayPause = vi.fn();

    useSampleStore.setState({
      shortcuts: { ...DEFAULT_SHORTCUTS, removeFromCollection: "" },
      selectedCollectionId: 5,
      selectedSampleIds: [1],
      removeSamplesFromCollection,
      requestMoveSamplesToTrash,
      togglePlayPause,
      trashFilterActive: false,
      binFilterActive: false,
      enableAdvancedFileOps: true,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
    });

    const { unmount } = renderHook(() => useAppGlobalShortcuts());

    // Cleared removeFromCollection must ignore Delete and Backspace inside collection
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
    );
    expect(removeSamplesFromCollection).not.toHaveBeenCalled();

    // Default Delete outside collection ignores Shift+Delete
    useSampleStore.setState({ selectedCollectionId: null });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(requestMoveSamplesToTrash).not.toHaveBeenCalled();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    );
    expect(requestMoveSamplesToTrash).toHaveBeenCalledWith([1]);

    // Standalone Settings window skips registering global shortcut listener
    unmount();
    const origSearch = window.location.search;
    try {
      window.history.replaceState({}, "", "?window=settings");
      renderHook(() => useAppGlobalShortcuts());
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true })
      );
      expect(togglePlayPause).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, "", origSearch || "/");
    }
  });

  it("marks waveform slice In (I / Turkish ı) and Out (O) from the current playhead", () => {
    const sample = {
      id: 99,
      library_id: 1,
      file_path: "F:/data/sounds/music.wav",
      file_name: "music.wav",
      folder_path: "F:/data/sounds",
      extension: "wav",
      duration_ms: 10000,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
      file_size: 960000,
      is_favorite: false,
      is_loop: false,
      genre: "",
      artist: "",
      album: "",
      year: "",
      peaks_json: "[]",
      created_at: "",
      tags: [],
    };
    const setSliceRange = vi.fn((range) => useSampleStore.setState({ sliceRange: range }));
    useSampleStore.setState({
      shortcuts: { ...DEFAULT_SHORTCUTS },
      selectedSample: sample,
      durationSec: 10,
      sliceRange: null,
      setSliceRange,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
      pendingTrashRequest: null,
      pendingFileConflictPrompt: null,
    });

    renderHook(() => useAppGlobalShortcuts());

    resetPlayheadClock(2.5);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ı", code: "KeyI", bubbles: true, cancelable: true })
    );
    expect(useSampleStore.getState().sliceRange).toEqual({
      startSec: 2.5,
      endSec: 10,
    });

    resetPlayheadClock(6.25);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", code: "KeyO", bubbles: true, cancelable: true })
    );
    expect(useSampleStore.getState().sliceRange).toEqual({
      startSec: 2.5,
      endSec: 6.25,
    });

    // Extending Out forward after scrubbing past the previous Out point
    resetPlayheadClock(8.0);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", code: "KeyO", bubbles: true, cancelable: true })
    );
    expect(useSampleStore.getState().sliceRange).toEqual({
      startSec: 2.5,
      endSec: 8.0,
    });
  });

  it("supports DAW keyboard muscle memory: Shift+Arrows, PageDown, Seek, Alt slice trim, Home/End, and Enter replay", () => {
    const mk = (id: number) => ({
      id,
      library_id: 1,
      file_path: `F:/data/sounds/track_${id}.wav`,
      file_name: `track_${id}.wav`,
      folder_path: "F:/data/sounds",
      extension: "wav",
      duration_ms: 10000,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
      file_size: 960000,
      is_favorite: false,
      is_loop: false,
      genre: "",
      artist: "",
      album: "",
      year: "",
      peaks_json: "[]",
      created_at: "",
      tags: [],
    });
    const list = Array.from({ length: 20 }, (_, i) => mk(i + 1));
    const selectRelativeSample = vi.fn();
    const requestSeek = vi.fn();
    const setSliceRange = vi.fn((range) =>
      useSampleStore.setState({ sliceRange: range })
    );

    useSampleStore.setState({
      shortcuts: { ...DEFAULT_SHORTCUTS },
      samples: list,
      selectedSample: list[0],
      selectedSampleIds: [1],
      lastSelectedIndex: null,
      isPlaying: false,
      durationSec: 10,
      sliceRange: { startSec: 2.0, endSec: 5.0 },
      selectRelativeSample,
      requestSeek,
      setSliceRange,
      isSettingsOpen: false,
      batchRenameSampleIds: null,
      pendingTrashRequest: null,
      pendingFileConflictPrompt: null,
    });

    renderHook(() => useAppGlobalShortcuts());

    // Shift+ArrowDown extends selection from 1 -> [1, 2] even when lastSelectedIndex was null
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(useSampleStore.getState().selectedSampleIds).toEqual([1, 2]);
    expect(useSampleStore.getState().selectedSample?.id).toBe(2);

    // Restore sliceRange (cleared on row change) to test seek, trim, Enter & Home/End
    useSampleStore.setState({ sliceRange: { startSec: 2.0, endSec: 5.0 } });

    // PageDown jumps +15 rows
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true })
    );
    expect(selectRelativeSample).toHaveBeenCalledWith(15);

    // ArrowRight seeks +0.5s, Shift+ArrowLeft seeks -0.1s
    resetPlayheadClock(3.0);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
    );
    expect(requestSeek).toHaveBeenCalledWith(3.5, false);

    resetPlayheadClock(3.5);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(requestSeek).toHaveBeenCalledWith(3.4, false);

    // Alt+ArrowRight nudges slice end +50ms; Alt+Shift+ArrowLeft nudges slice start -50ms
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true })
    );
    expect(useSampleStore.getState().sliceRange).toEqual({
      startSec: 2.0,
      endSec: 5.05,
    });

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(useSampleStore.getState().sliceRange).toEqual({
      startSec: 1.95,
      endSec: 5.05,
    });

    // Enter replays from active slice start (1.95s) with autoPlay=true
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    expect(requestSeek).toHaveBeenCalledWith(1.95, true);

    // Home jumps to slice start (1.95s); without slice jumps to 0s
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })
    );
    expect(requestSeek).toHaveBeenCalledWith(1.95, false);

    useSampleStore.setState({ sliceRange: null });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })
    );
    expect(requestSeek).toHaveBeenCalledWith(0, false);
  });
});
