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
import type { SliceHistoryEntry } from "../types";
import { sliceEntryToPreviewSample } from "../utils/slicePreview";
import { ActiveFilterBanner } from "./sample-table/ActiveFilterBanner";
import { FilterDrawer } from "./sample-table/FilterDrawer";
import { SampleFilterToolbar } from "./sample-table/SampleFilterToolbar";
import { SlicesTableView } from "./sample-table/SlicesTableView";
import { TrashGeneralControls } from "./sample-table/TrashGeneralControls";

const GlobalShortcutsHarness = () => {
  useAppGlobalShortcuts();
  return null;
};

function makeTrashedSlice(
  over: Partial<SliceHistoryEntry> = {}
): SliceHistoryEntry {
  return {
    id: 77,
    slice_path: "D:/Exports/TrashedSnare.wav",
    slice_name: "TrashedSnare.wav",
    source_sample_id: 42,
    source_file_path: "F:/Sounds/drums.wav",
    source_file_name: "drums.wav",
    start_sec: 0.5,
    end_sec: 1.25,
    pitch_semitones: 0,
    micro_fade: true,
    duration_ms: 750,
    is_favorite: true,
    peaks_json: "[0.4,0.8,0.3]",
    sample_rate: 48000,
    channels: 2,
    bit_depth: 16,
    created_at: "2026-11-18T02:00:00Z",
    file_exists: true,
    is_trashed: true,
    trash_file_path: "C:/Audify/user/cache/slice_trash/77_1_TrashedSnare.wav",
    trashed_at: "2026-11-18T03:00:00Z",
    ...over,
  };
}

describe("Unified Option C Slice Trash & Theme-Accent Empty Button", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
    useSampleStore.setState({
      hasInitialized: true,
      enableAdvancedFileOps: true,
      slicesFilterActive: false,
      trashFilterActive: false,
      trashViewTab: "tracks",
      sliceFavoriteOnly: false,
      slicePitchOnly: false,
      sliceHideMissing: false,
      trashedCount: 0,
      trashedTotalBytes: 0,
      trashedSliceCount: 0,
      trashedSliceTotalBytes: 0,
      sliceHistory: [],
      trashedSliceHistory: [],
      selectedSliceIds: [],
      activeSliceId: null,
      lastSelectedSliceIndex: null,
      batchRenameSliceIds: null,
      sliceOpUndoStack: [],
      sliceOpRedoStack: [],
      searchQuery: "",
      selectedSample: null,
    });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({
      slicesFilterActive: false,
      trashFilterActive: false,
      trashViewTab: "tracks",
      sliceHistory: [],
      trashedSliceHistory: [],
      trashedSliceCount: 0,
      trashedSliceTotalBytes: 0,
      selectedSliceIds: [],
      activeSliceId: null,
      sliceOpUndoStack: [],
      sliceOpRedoStack: [],
      selectedSample: null,
    });
  });

  it("maps trashed slice playback path to quarantined WAV while keeping active path clean", () => {
    const quarantined = makeTrashedSlice();
    const preview = sliceEntryToPreviewSample(quarantined);
    expect(preview.file_path).toBe(quarantined.trash_file_path);
    expect(preview.file_name).toBe("TrashedSnare.wav");

    const active = makeTrashedSlice({
      is_trashed: false,
      trash_file_path: null,
    });
    expect(sliceEntryToPreviewSample(active).file_path).toBe(active.slice_path);
  });

  it("auto-selects Slices tab in Trash when only slices are trashed and supports Restore & Empty", async () => {
    const trashedSlice = makeTrashedSlice();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_trashed_slices") return [trashedSlice];
      if (cmd === "get_slice_trash_status") {
        return {
          affected_count: 0,
          affected_ids: [],
          trashed_count: 1,
          total_bytes: 2048,
        };
      }
      if (cmd === "empty_trashed_slices") {
        return {
          affected_count: 1,
          affected_ids: [77],
          trashed_count: 0,
          total_bytes: 0,
        };
      }
      return [];
    });

    useSampleStore.setState({ trashedCount: 0, trashedSliceCount: 1 });
    useSampleStore.getState().setTrashFilterActive(true);

    expect(useSampleStore.getState().trashFilterActive).toBe(true);
    expect(useSampleStore.getState().trashViewTab).toBe("slices");

    const searchRef = createRef<HTMLInputElement>();
    const setHelper = vi.fn();
    render(
      <>
        <GlobalShortcutsHarness />
        <SampleFilterToolbar
          searchInputRef={searchRef}
          showSearchHelper={false}
          setShowSearchHelper={setHelper}
        />
        <ActiveFilterBanner />
        <SlicesTableView />
        <FilterDrawer />
      </>
    );

    expect(await screen.findByText("TrashedSnare")).toBeTruthy();
    expect(screen.getByText(/SLICE NAME/i)).toBeTruthy();
    expect(screen.getByText(/Trash · Slices · 1 slice/i)).toBeTruthy();

    const row = screen.getByRole("row");
    expect(row.getAttribute("draggable")).toBe("false");

    // Empty to Recycle Bin uses theme accent hover (never hardcoded red border/text)
    const emptyBtn = await screen.findByRole("button", {
      name: /Empty to Recycle Bin/i,
    });
    expect(emptyBtn.className).toContain("hover:bg-accent-soft");
    expect(emptyBtn.className).toContain("hover:border-accent");
    expect(emptyBtn.className).not.toContain("hover:text-danger");

    fireEvent.click(emptyBtn);
    expect(
      await screen.findByRole("dialog", { name: /Empty Recycle Bin/i })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Empty$/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("empty_trashed_slices", {
        sliceIds: null,
      });
    });
    expect(useSampleStore.getState().trashedSliceCount).toBe(0);
    expect(useSampleStore.getState().trashFilterActive).toBe(false);
  });

  it("keeps Slices toolbar free of Trash chip and supports F2/Del guards + Restore via main Trash -> Slices", async () => {
    const activeSlice = makeTrashedSlice({
      id: 12,
      slice_path: "D:/Exports/ActiveKick.wav",
      slice_name: "ActiveKick.wav",
      is_trashed: false,
      trash_file_path: null,
    });
    const trashedSlice = makeTrashedSlice({ id: 77 });
    let mockTrashed = [trashedSlice];
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_slice_history") return [activeSlice];
      if (cmd === "list_trashed_slices") return mockTrashed;
      if (cmd === "get_slice_trash_status") {
        return {
          affected_count: 0,
          affected_ids: [],
          trashed_count: mockTrashed.length,
          total_bytes: mockTrashed.length * 1024,
        };
      }
      if (cmd === "restore_trashed_slice_files") {
        mockTrashed = [];
        return [
          {
            ...trashedSlice,
            is_trashed: false,
            trash_file_path: null,
            trashed_at: null,
          },
        ];
      }
      return [];
    });

    useSampleStore.setState({ trashedCount: 0, trashedSliceCount: 1 });
    useSampleStore.getState().setSlicesFilterActive(true);
    const searchRef = createRef<HTMLInputElement>();
    const setHelper = vi.fn();
    render(
      <>
        <GlobalShortcutsHarness />
        <SampleFilterToolbar
          searchInputRef={searchRef}
          showSearchHelper={false}
          setShowSearchHelper={setHelper}
        />
        <ActiveFilterBanner />
        <SlicesTableView />
        <FilterDrawer />
      </>
    );

    expect(await screen.findByRole("button", { name: /Favorites/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Trash/i })).toBeNull();

    // Switch into main Trash (auto-selects Slices since trashedCount === 0 && trashedSliceCount === 1)
    useSampleStore.getState().setTrashFilterActive(true);
    expect(await screen.findByText("TrashedSnare")).toBeTruthy();

    fireEvent.click(screen.getByRole("row"));
    // Guard F2 & Delete in Slice Trash mode
    fireEvent.keyDown(window, { key: "F2" });
    expect(useSampleStore.getState().batchRenameSliceIds).toBeNull();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trash_slice_files",
      expect.anything()
    );

    fireEvent.contextMenu(screen.getByRole("row"));
    const restoreMenu = await screen.findByText("Restore from Trash");
    fireEvent.click(restoreMenu);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("restore_trashed_slice_files", {
        sliceIds: [77],
      });
      expect(useSampleStore.getState().trashedSliceCount).toBe(0);
      expect(
        useSampleStore.getState().sliceHistory.some((s) => s.id === 77)
      ).toBe(true);
    });
  });

  it("renders theme-accent hover on Track Trash Empty to Recycle Bin button", () => {
    useSampleStore.setState({
      trashFilterActive: true,
      trashViewTab: "tracks",
      trashedCount: 2,
      trashedTotalBytes: 4096,
    });
    render(<TrashGeneralControls />);
    const emptyBtn = screen.getByRole("button", {
      name: /Empty to Recycle Bin/i,
    });
    expect(emptyBtn.className).toContain("hover:bg-accent-soft");
    expect(emptyBtn.className).toContain("hover:border-accent");
    expect(emptyBtn.className).not.toContain("hover:text-danger");
  });
});
