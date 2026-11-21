// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          index,
          key: index,
          start: index * size,
          size,
          end: (index + 1) * size,
        })),
      scrollToIndex: vi.fn(),
    };
  },
}));

import { useAppGlobalShortcuts } from "../hooks/useAppGlobalShortcuts";
import { useSampleStore } from "../store/useSampleStore";
import type { SampleItem, SliceHistoryEntry } from "../types";
import { preExportAudioSlice } from "../utils/drag";
import { sliceEntryToPreviewSample } from "../utils/slicePreview";
import { BatchRenameModal } from "./modals/BatchRenameModal";
import { ActiveFilterBanner } from "./sample-table/ActiveFilterBanner";
import { FilterDrawer } from "./sample-table/FilterDrawer";
import { SampleFilterToolbar } from "./sample-table/SampleFilterToolbar";
import { SlicesTableView } from "./sample-table/SlicesTableView";
import { TransportControls } from "./transport/TransportControls";
import { WaveformDeckHeader } from "./transport/WaveformDeckHeader";

const GlobalShortcutsHarness = () => {
  useAppGlobalShortcuts();
  return null;
};

function makeSample(over: Partial<SampleItem> = {}): SampleItem {
  return {
    id: 42,
    library_id: 1,
    file_path: "F:/Sounds/wolf_rztowy_01.wav",
    file_name: "wolf_rztowy_01.wav",
    folder_path: "F:/Sounds",
    extension: "wav",
    duration_ms: 4000,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 16,
    file_size: 384000,
    is_favorite: false,
    is_loop: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    bpm: null,
    musical_key: "",
    camelot_key: "",
    peaks_json: "[]",
    created_at: "2026-11-18T00:00:00Z",
    tags: [],
    ...over,
  };
}

function makeSliceEntry(over: Partial<SliceHistoryEntry> = {}): SliceHistoryEntry {
  return {
    id: 10,
    slice_path: "D:/Exports/WolfBark.wav",
    slice_name: "WolfBark.wav",
    source_sample_id: 42,
    source_file_path: "F:/Sounds/wolf_rztowy_01.wav",
    source_file_name: "wolf_rztowy_01.wav",
    start_sec: 1.2,
    end_sec: 2.85,
    pitch_semitones: 2,
    micro_fade: true,
    duration_ms: 1470,
    is_favorite: false,
    peaks_json: "[0.3,0.7,0.5]",
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    created_at: "2026-11-18T01:00:00Z",
    file_exists: true,
    ...over,
  };
}

describe("Slices UI Unification, Favorites, Undo/Redo & Guards", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
    useSampleStore.setState({
      allProfileSamples: [makeSample()],
      rawSamples: [makeSample()],
      samples: [makeSample()],
      tags: [{ id: 1, name: "DeadTagShouldHide", color: "#3b82f6", sample_count: 99 }],
      selectedSample: makeSample(),
      selectedSampleIds: [42],
      slicesFilterActive: false,
      enableAdvancedFileOps: true,
      duplicatesFilterActive: false,
      trashFilterActive: false,
      binFilterActive: false,
      favoriteOnly: false,
      recentOnly: false,
      sliceHideMissing: false,
      sliceFavoriteOnly: false,
      slicePitchOnly: false,
      sliceSortKey: null,
      sliceSortDir: "asc",
      selectedSliceIds: [],
      activeSliceId: null,
      lastSelectedSliceIndex: null,
      batchRenameSliceIds: null,
      batchRenameSampleIds: null,
      sliceOpUndoStack: [],
      sliceOpRedoStack: [],
      sliceHistory: [],
      sliceRange: null,
      pitchSemitones: 0,
      sliceMicroFade: true,
      customSliceExportPath: "D:/Exports",
    });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({
      slicesFilterActive: false,
      sliceHistory: [],
      sliceHideMissing: false,
      sliceFavoriteOnly: false,
      slicePitchOnly: false,
      selectedSliceIds: [],
      activeSliceId: null,
      batchRenameSliceIds: null,
      sliceOpUndoStack: [],
      sliceOpRedoStack: [],
      sliceRange: null,
      pitchSemitones: 0,
    });
  });

  it("renders General mode buttons in order and SliceGeneralControls with clean 'Open Folder' label", async () => {
    localStorage.setItem("audify_filter_drawer_open", "true");
    localStorage.setItem("audify_filter_drawer_tab", "general");

    const ready = makeSliceEntry({ id: 10 });
    const missing = makeSliceEntry({
      id: 11,
      slice_path: "D:/Exports/Gone.wav",
      slice_name: "Gone.wav",
      file_exists: false,
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_slice_history") return [ready, missing];
      if (cmd === "clear_missing_slices") return 1;
      return null;
    });

    render(<FilterDrawer />);

    const favBtn = await screen.findByRole("button", { name: /Favorites/i });
    const binBtn = screen.getByRole("button", { name: /Session Bin/i });
    const recBtn = screen.getByRole("button", { name: /Recent/i });
    const slicesBtn = screen.getByRole("button", { name: /^Slices$/i });
    const dupBtn = screen.getByRole("button", { name: /^Duplicates$/i });

    expect(
      favBtn.compareDocumentPosition(binBtn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      binBtn.compareDocumentPosition(recBtn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      recBtn.compareDocumentPosition(slicesBtn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      slicesBtn.compareDocumentPosition(dupBtn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(slicesBtn);
    expect(useSampleStore.getState().slicesFilterActive).toBe(true);
    expect(await screen.findByText(/1 ready · 1 missing/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open Folder$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Export Folder/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Clear Missing \(1\)/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("clear_missing_slices", {});
    });
  });

  it("unifies Slices table, toolbar chips, context menu, BatchRenameModal, Ctrl+Z Undo/Redo, and Source jump", async () => {
    const s1 = makeSliceEntry({ id: 10 });
    const renamed = makeSliceEntry({
      id: 10,
      slice_path: "D:/Exports/CleanBark.wav",
      slice_name: "CleanBark.wav",
    });
    const favored = makeSliceEntry({ id: 10, is_favorite: true });

    useSampleStore.setState({
      slicesFilterActive: true,
      sliceHistory: [s1],
    });

    invokeMock.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "batch_rename_slices") {
        const typedArgs = args as {
          entries: Array<{ slice_id: number; new_stem: string }>;
        };
        const targetStem = typedArgs.entries[0]?.new_stem;
        if (targetStem === "WolfBark") {
          return [{ old_record: renamed, updated_record: s1 }];
        }
        return [{ old_record: s1, updated_record: renamed }];
      }
      if (cmd === "toggle_slice_favorite") return favored;
      if (cmd === "trash_slice_files") return [10];
      if (cmd === "restore_trashed_slice_files") return [renamed];
      return null;
    });

    const searchInputRef = createRef<HTMLInputElement>();
    render(
      <>
        <SampleFilterToolbar
          searchInputRef={searchInputRef}
          showSearchHelper={false}
          setShowSearchHelper={vi.fn()}
        />
        <SlicesTableView />
        <BatchRenameModal />
      </>
    );

    // Dead main-library tag pills are hidden; slice Favorites chip is active
    expect(screen.queryByText("DeadTagShouldHide")).toBeNull();
    expect(screen.getByPlaceholderText("Search slices by name or source track...")).toBeTruthy();

    expect(await screen.findByText("WolfBark")).toBeTruthy();
    expect(screen.getByText(".wav")).toBeTruthy();
    expect(screen.getByText("wolf_rztowy_01.wav")).toBeTruthy();
    expect(screen.getByText("00:01.47")).toBeTruthy();
    expect(screen.getByText("48k/24b")).toBeTruthy();
    expect(screen.getByText("1.20–2.85s")).toBeTruthy();
    expect(screen.getByText("+2st")).toBeTruthy();
    // "Remove from History" X button no longer exists
    expect(screen.queryByTitle(/Remove from Slices history/i)).toBeNull();

    // Right-click menu uses unified SampleContextMenu design & opens BatchRenameModal
    fireEvent.contextMenu(screen.getByText("WolfBark"));
    expect(screen.queryByText("Remove from History")).toBeNull();
    fireEvent.click(await screen.findByText("Rename Slice File..."));

    expect(await screen.findByText("RENAME SLICE")).toBeTruthy();
    const renameInput = screen.getByDisplayValue("WolfBark") as HTMLInputElement;
    fireEvent.change(renameInput, { target: { value: "CleanBark" } });
    fireEvent.click(screen.getByRole("button", { name: /^Rename Slice$/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("batch_rename_slices", {
        entries: [{ slice_id: 10, new_stem: "CleanBark" }],
      });
    });
    expect(await screen.findByText("CleanBark")).toBeTruthy();
    expect(useSampleStore.getState().sliceOpUndoStack.length).toBe(1);

    // Ctrl+Z Undo reverts rename cleanly
    await useSampleStore.getState().undoLastSliceOp();
    expect(await screen.findByText("WolfBark")).toBeTruthy();
    expect(useSampleStore.getState().sliceOpRedoStack.length).toBe(1);

    // Ctrl+Y Redo reapplies rename cleanly
    await useSampleStore.getState().redoLastSliceOp();
    expect(await screen.findByText("CleanBark")).toBeTruthy();

    // Move to Trash & Undo restore
    fireEvent.contextMenu(screen.getByText("CleanBark"));
    fireEvent.click(await screen.findByText("Move to Trash"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trash_slice_files", {
        sliceIds: [10],
      });
      expect(useSampleStore.getState().sliceHistory.length).toBe(0);
    });

    await useSampleStore.getState().undoLastSliceOp();
    expect(await screen.findByText("CleanBark")).toBeTruthy();

    // Favorite toggle via row star
    fireEvent.click(screen.getByLabelText("Add slice to favorites"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("toggle_slice_favorite", {
        sliceId: 10,
      });
      expect(useSampleStore.getState().sliceHistory[0].is_favorite).toBe(true);
    });

    // Click source filename to jump back to original track & restore range
    fireEvent.click(screen.getByText("wolf_rztowy_01.wav"));
    await waitFor(() => {
      const st = useSampleStore.getState();
      expect(st.slicesFilterActive).toBe(false);
      expect(st.selectedSample?.id).toBe(42);
      expect(st.sliceRange).toEqual({ startSec: 1.2, endSec: 2.85 });
      expect(st.pitchSemitones).toBe(2);
    });
  });

  it("blocks Save Slice & recursive slicing on slice preview samples while preserving cacheOnly preExport", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const sample = makeSample();
    const previewSlice = sliceEntryToPreviewSample(makeSliceEntry());

    const { rerender } = render(
      <WaveformDeckHeader
        selectedSample={sample}
        isMiniDock={false}
        effectiveDuration={4}
        sliceRange={null}
        onClearSlice={vi.fn()}
        onSaveSlice={onSave}
      />
    );
    expect(
      screen.queryByTitle(/Save slice to export folder & Slices tab/i)
    ).toBeNull();

    // Slice preview sample shows non-sliceable hint and hides Save Slice even if range passed
    rerender(
      <WaveformDeckHeader
        selectedSample={previewSlice}
        isMiniDock={false}
        effectiveDuration={1.47}
        sliceRange={{ startSec: 0.1, endSec: 0.5 }}
        onClearSlice={vi.fn()}
        onSaveSlice={onSave}
      />
    );
    expect(
      screen.queryByTitle(/Save slice to export folder & Slices tab/i)
    ).toBeNull();

    useSampleStore.setState({
      selectedSample: previewSlice,
      sliceRange: { startSec: 0.1, endSec: 0.5 },
    });
    const blocked = await useSampleStore.getState().saveActiveSlice("SubSlice");
    expect(blocked).toBeNull();

    rerender(
      <WaveformDeckHeader
        selectedSample={sample}
        isMiniDock={false}
        effectiveDuration={4}
        sliceRange={{ startSec: 1.2, endSec: 2.85 }}
        onClearSlice={vi.fn()}
        onSaveSlice={onSave}
      />
    );

    fireEvent.click(screen.getByTitle(/Save slice to export folder & Slices tab/i));
    const input = await screen.findByDisplayValue("wolf_rztowy_01_1.20-2.85s");
    fireEvent.change(input, { target: { value: "CustomWolf" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("CustomWolf");
    });

    invokeMock.mockResolvedValue("F:/Audify/user/cache/slices/preview.wav");
    await preExportAudioSlice("F:/Sounds/wolf_rztowy_01.wav", 0.5, 1.5, {
      pitchSemitones: 0,
      applyMicroFade: true,
      cacheOnly: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("export_audio_slice", {
      filePath: "F:/Sounds/wolf_rztowy_01.wav",
      startSec: 0.5,
      endSec: 1.5,
      customDir: null,
      pitchSemitones: null,
      applyMicroFade: true,
      cacheOnly: true,
    });
  });

  it("enforces Safe Read-Only Mode in Slices (accent Read-Only button + locked context menu items) and supports column resize", async () => {
    localStorage.setItem("audify_filter_drawer_open", "true");
    localStorage.setItem("audify_filter_drawer_tab", "general");
    const entry = makeSliceEntry({ id: 10 });
    const entry2 = makeSliceEntry({
      id: 11,
      slice_path: "D:/Exports/WolfHowl.wav",
      slice_name: "WolfHowl.wav",
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_slice_history") return [entry, entry2];
      return null;
    });

    useSampleStore.setState({
      slicesFilterActive: true,
      enableAdvancedFileOps: false,
      activeSliceId: 10,
      selectedSliceIds: [10],
      sliceHistory: [entry, entry2],
    });

    render(
      <>
        <ActiveFilterBanner />
        <FilterDrawer />
        <SlicesTableView />
      </>
    );

    // Only a single "Slices · 2" chip bar from ActiveFilterBanner (never duplicated inside SlicesTableView)
    expect(screen.getAllByText(/Slices · 2/i)).toHaveLength(1);

    // Header and both active/inactive rows share border-l-2 so vertical column dividers align
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("border-l-2");
    expect(rows[0].className).toContain("border-l-accent");
    expect(rows[1].className).toContain("border-l-2");
    expect(rows[1].className).toContain("border-l-transparent");

    const readOnlyBtn = await screen.findByRole("button", {
      name: /Read-Only · Write Mode/i,
    });
    expect(readOnlyBtn.className).toContain("bg-accent-soft");
    expect(readOnlyBtn.className).toContain("text-accent-fg");

    // Verify 4 resizable column handles exist in SlicesTableView
    const resizeHandles = document.querySelectorAll('[data-col-resize="true"]');
    expect(resizeHandles.length).toBe(4);
    fireEvent.mouseDown(resizeHandles[0], { clientX: 240 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    expect(localStorage.getItem("audify_slice_column_widths_v1")).toContain(
      '"name":300'
    );

    // Right-click slice row in Read-Only mode: context menu stays clean (Rename & Move to Trash hidden)
    const sliceRow = await screen.findByText("WolfBark");
    fireEvent.contextMenu(sliceRow);

    expect(
      await screen.findByRole("menuitem", { name: /Preview Slice/i })
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /Rename Slice File/i })
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Move to Trash/i })
    ).toBeNull();

    // Pressing Escape closes the context menu
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Slice actions" })).toBeNull();

    // Re-open context menu and click outside -> closes cleanly
    fireEvent.contextMenu(sliceRow);
    expect(
      await screen.findByRole("menu", { name: "Slice actions" })
    ).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Slice actions" })).toBeNull();

    // Direct store calls are also guarded in Safe Read-Only mode
    useSampleStore.getState().openBatchRenameSlicesModal([10]);
    expect(useSampleStore.getState().batchRenameSliceIds).toBeNull();
  });

  it("supports customizable Ctrl+S Save Slice shortcut, fixes Slices Ctrl+A/Esc, guards virtual IDs, and uses theme accent controls", async () => {
    const entry1 = makeSliceEntry({ id: 10, slice_name: "WolfBark" });
    const entry2 = makeSliceEntry({
      id: 11,
      slice_name: "WolfHowl",
      slice_path: "F:/Audify/user/slices/WolfHowl.wav",
    });
    const savedReply = makeSliceEntry({
      id: 12,
      slice_name: "wolf_rztowy_01_1.20-2.85s",
      slice_path: "F:/Audify/user/slices/wolf_rztowy_01_1.20-2.85s.wav",
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "save_slice_to_export") {
        return Promise.resolve(savedReply);
      }
      return Promise.resolve(null);
    });

    const sourceSample = makeSample();
    useSampleStore.setState({
      selectedSample: sourceSample,
      sliceRange: { startSec: 1.2, endSec: 2.85 },
      isLooping: true,
      slicesFilterActive: false,
      sliceHistory: [entry1, entry2],
      binSampleIds: [],
    });

    render(
      <>
        <GlobalShortcutsHarness />
        <TransportControls />
        <WaveformDeckHeader
          selectedSample={sourceSample}
          isMiniDock={false}
          effectiveDuration={4}
          sliceRange={{ startSec: 1.2, endSec: 2.85 }}
          saveSliceShortcut="Ctrl+S"
          onClearSlice={vi.fn()}
          onSaveSlice={vi.fn()}
        />
      </>
    );

    // Clear Slice [X] and Loop + active slice pill follow theme accent, never ok green
    const clearBtn = screen.getByTitle("Clear Slice");
    expect(clearBtn.className).toContain("text-accent-fg");
    expect(clearBtn.className).not.toContain("text-ok");
    const loopBtn = screen.getByTitle("Loop");
    expect(loopBtn.className).toContain("bg-accent-soft");
    expect(loopBtn.className).not.toContain("text-ok");
    const saveBtn = screen.getByTitle(/Save slice to export folder & Slices tab \(Ctrl\+S\)/i);
    expect(saveBtn).toBeTruthy();

    // Ctrl+S invokes save_slice_to_export via global shortcut
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_slice_to_export",
        expect.objectContaining({ filePath: sourceSample.file_path })
      );
    });

    // Slices mode: Ctrl+A selects all slices, Escape reduces multi-slice selection back to active slice
    useSampleStore.setState({
      slicesFilterActive: true,
      activeSliceId: 10,
      selectedSliceIds: [10],
      sliceRange: null,
      selectedSample: sliceEntryToPreviewSample(entry1),
    });

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(useSampleStore.getState().selectedSliceIds).toEqual([12, 10, 11]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSampleStore.getState().selectedSliceIds).toEqual([10]);

    // Virtual slice IDs are rejected from Session Bin even if passed directly or via 'B'
    fireEvent.keyDown(window, { key: "b" });
    useSampleStore.getState().addSamplesToBin([-10, 0]);
    expect(useSampleStore.getState().binSampleIds).toEqual([]);
  });
});
