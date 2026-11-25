// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Collection, DuplicateScanResult, Library, SampleItem } from "../types";

const invokeMock = vi.fn();
const listenCallbacks = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: (payloadEvent: { payload: unknown }) => void) => {
    listenCallbacks.set(event, cb);
    return Promise.resolve(() => {});
  }),
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import {
  buildDuplicateOrderMap,
  formatDuplicateModeLabel,
  pruneDuplicateScanResult,
} from "../store/slices/duplicateSlice";
import { registerStoreListenersOnce } from "../store/slices/initListeners";
import { useSampleStore } from "../store/useSampleStore";
import { MasterVolumeControl } from "./common/MasterVolumeControl";
import { BottomStatusBar } from "./StatusBar";
import { ActiveFilterBanner } from "./sample-table/ActiveFilterBanner";
import { DragDropFeedbackOverlay } from "./sample-table/DragDropFeedbackOverlay";
import { DuplicateGeneralControls } from "./sample-table/DuplicateGeneralControls";
import { FilterDrawer } from "./sample-table/FilterDrawer";
import { FilterDrawerPanel } from "./sample-table/FilterDrawerPanels";
import { SampleTableRow } from "./sample-table/SampleTableRow";
import { DEFAULT_VISIBLE_COLS, DEFAULT_COL_WIDTHS } from "./sample-table/tableLayout";
import { AdvancedTab } from "./settings/AdvancedTab";
import { CollectionsTab } from "./settings/CollectionsTab";
import { buildFolderTreeByLibrary } from "./sidebar/folderTreeBuilder";
import { LibraryViewsSection } from "./sidebar/LibraryViewsSection";

function makeSample(
  id: number,
  fileName: string,
  folderPath: string,
  libraryId = 1,
  fileSize = 2048
): SampleItem {
  return {
    id,
    library_id: libraryId,
    file_path: `${folderPath}/${fileName}`,
    file_name: fileName,
    folder_path: folderPath,
    extension: "wav",
    duration_ms: 1200,
    sample_rate: 44100,
    channels: 2,
    bit_depth: 16,
    file_size: fileSize,
    is_loop: false,
    is_favorite: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    bpm: null,
    created_at: "2026-01-01 00:00:00",
    file_modified_at: 1700000000,
    previous_file_name: null,
    is_trashed: false,
    original_file_path: null,
    trashed_at: null,
    peaks_json: "[]",
    tags: [],
  };
}

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 1,
    name: "Main SFX",
    path: "C:/Audio/Main",
    is_global: true,
    is_read_only: false,
    sample_count: 100,
    last_scanned_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    parent_id: null,
    rule_path: null,
    smart_query: null,
    name: "Kicks",
    color: "#3b82f6",
    icon: "folder",
    created_at: "2026-01-01 00:00:00",
    sample_count: 12,
    ...overrides,
  };
}

function makeScanResult(): {
  scanResult: DuplicateScanResult;
  allSamples: SampleItem[];
} {
  const s1 = makeSample(101, "roar_keep.wav", "C:/Audio/Main/Monsters", 1, 4096);
  const s2 = makeSample(102, "roar_copy.wav", "C:/Audio/Main/Temp", 1, 4096);
  const s3 = makeSample(
    103,
    "roar_vault.wav",
    "C:/Audio/Vault/Protected",
    2,
    4096
  );

  return {
    allSamples: [s1, s2, s3],
    scanResult: {
      mode: "exact",
      scanned_samples: 3,
      groups_found: 1,
      duplicate_files_count: 2,
      reclaimable_bytes: 8192,
      elapsed_ms: 14,
      groups: [
        {
          group_id: "g1",
          match_kind: "exact",
          similarity_pct: 100,
          file_size: 4096,
          reclaimable_bytes: 8192,
          items: [
            {
              sample_id: s1.id,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s1.file_path,
              file_name: s1.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: true,
            },
            {
              sample_id: s2.id,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s2.file_path,
              file_name: s2.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: false,
            },
            {
              sample_id: s3.id,
              library_id: 2,
              library_name: "Read Only Vault",
              library_read_only: true,
              file_path: s3.file_path,
              file_name: s3.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: false,
            },
          ],
        },
      ],
    },
  };
}

describe("Integrated Duplicates View & UI Polish", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset().mockImplementation((cmd: string) => {
      if (cmd === "get_trash_status") {
        return Promise.resolve({
          trashed_count: 0,
          total_bytes: 0,
          journal_entries: [],
        });
      }
      return Promise.resolve([]);
    });
    const lib1 = makeLibrary();
    const lib2 = makeLibrary({
      id: 2,
      name: "Read Only Vault",
      path: "C:/Audio/Vault",
      is_read_only: true,
    });
    const { allSamples } = makeScanResult();

    useSampleStore.setState({
      activeProfile: {
        id: 1,
        name: "Default",
        color: "#3b82f6",
        settings_json: "{}",
        is_active: true,
        created_at: "2026-01-01 00:00:00",
      },
      libraries: [lib1, lib2],
      allProfileSamples: allSamples,
      rawSamples: allSamples,
      samples: allSamples,
      collections: [],
      tags: [],
      genres: [],
      selectedTagIds: [],
      selectedGenre: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      folderFilter: null,
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      trashFilterActive: false,
      duplicatesFilterActive: false,
      duplicateScanMode: "exact",
      duplicateLibraryId: null,
      duplicateMinSimilarityPct: 97,
      duplicateExtrasMinPct: 98,
      isScanningDuplicates: false,
      duplicateScanProgress: null,
      duplicateScanResult: null,
      duplicateScanCache: {},
      duplicateScanError: null,
      enableAdvancedFileOps: false,
      confirmBeforeTrash: true,
      trashedCount: 0,
      trashedTotalBytes: 0,
      fileOpJournal: [],
      fileOpUndoStack: [],
      fileOpRedoStack: [],
      selectedSample: null,
      selectedSampleIds: [],
      searchQuery: "",
      similaritySession: null,
      sortKey: null,
      sortDir: "asc",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders MasterVolumeControl mute icon with semantic theme tokens instead of red", () => {
    render(
      <MasterVolumeControl
        volume={0}
        onToggleMute={vi.fn()}
        onChangeVolume={vi.fn()}
      />
    );
    const muteBtn = screen.getByTitle("Unmute");
    expect(muteBtn.className).toContain("text-accent-fg");
    expect(muteBtn.className).toContain("bg-accent-soft");
    expect(muteBtn.className).not.toContain("text-danger");
    expect(muteBtn.className).not.toContain("bg-danger");
  });

  it("splits Settings CollectionsTab into collapsible Collections and Smart Collections sections", () => {
    useSampleStore.setState({
      collections: [
        makeCollection({ id: 1, name: "Drum Kit", smart_query: null }),
        makeCollection({
          id: 2,
          name: "Short Impacts",
          smart_query: "<2s",
        }),
      ],
    });

    render(<CollectionsTab collectionsSubTab="list" />);

    const normalToggle = screen.getByRole("button", {
      name: /^COLLECTIONS \(1\)/i,
    });
    const smartToggle = screen.getByRole("button", {
      name: /^SMART COLLECTIONS \(1\)/i,
    });

    expect(screen.getAllByText("Drum Kit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Short Impacts").length).toBeGreaterThan(0);

    fireEvent.click(smartToggle);
    expect(smartToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Short Impacts")).toBeNull();

    fireEvent.click(normalToggle);
    expect(normalToggle.getAttribute("aria-expanded")).toBe("false");

    // Search automatically reveals matching items inside collapsed groups
    const searchInput = screen.getByPlaceholderText("Search collections...");
    fireEvent.change(searchInput, { target: { value: "Short" } });
    expect(smartToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("Short Impacts").length).toBeGreaterThan(0);
  });

  it("keeps AdvancedTab and LibraryViewsSection free of Duplicate Finder UI", () => {
    render(
      <>
        <AdvancedTab />
        <LibraryViewsSection
          isMiniOverlay={false}
          isAllActive={true}
          isDraggingInApp={false}
          inAppDragCount={0}
          dragHoverTarget={null}
          dropFlashTarget={null}
          favoriteOnly={false}
          recentOnly={false}
          totalSamplesCount={100}
          totalFavoritesCount={5}
          recentSamplesCount={3}
          setIsOverlayOpen={vi.fn()}
          selectAllFiles={vi.fn()}
          resetAllFilters={vi.fn()}
          setFavoriteOnly={vi.fn()}
          setRecentOnly={vi.fn()}
          clearRecentSamples={vi.fn()}
          updateDragHoverTarget={vi.fn()}
        />
      </>
    );

    expect(screen.queryByText("DUPLICATE FINDER")).toBeNull();
    expect(screen.getByText("Trash").previousSibling).toBeNull();
    expect(screen.queryByRole("button", { name: /Duplicates/i })).toBeNull();

    // Recent row aligns count identically to All Files / Favorites and swaps in X via absolute overlay on hover
    const recentBtn = screen.getByRole("button", { name: /Recent\s*3/i });
    expect(recentBtn.className).toContain("w-full");
    expect(recentBtn.className).toContain("px-2.5");
    expect(screen.getByText("3").className).toContain("group-hover:opacity-0");
    const clearRecentBtn = screen.getByRole("button", {
      name: "Clear recent history",
    });
    expect(clearRecentBtn.className).toContain("absolute");
    expect(clearRecentBtn.className).toContain("group-hover:opacity-100");
  });

  it("requires explicit Scan after configuring library/mode in Filters -> General -> Duplicates and reuses per-scope cache", async () => {
    const { scanResult } = makeScanResult();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "scan_duplicate_samples") {
        return Promise.resolve(scanResult);
      }
      return Promise.resolve([]);
    });

    render(
      <>
        <ActiveFilterBanner />
        <FilterDrawerPanel activeTab="general" bpmTokens={[]} keyTokens={[]} />
      </>
    );

    const dupBtn = screen.getByRole("button", { name: /^Duplicates$/i });
    fireEvent.click(dupBtn);

    // Entering Duplicates mode opens controls without kicking off an unwanted background scan
    expect(useSampleStore.getState().duplicatesFilterActive).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "scan_duplicate_samples",
      expect.anything()
    );
    expect(screen.getByRole("button", { name: /^Scan$/i })).toBeTruthy();

    // Must use custom portal dropdown instead of a native Win32 <select>
    expect(document.querySelector("select")).toBeNull();
    const scopeBtn = screen.getByRole("button", {
      name: "Duplicate library scope",
    });
    fireEvent.click(scopeBtn);
    expect(screen.getByRole("listbox", { name: "Library scope options" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Main SFX" }));
    expect(useSampleStore.getState().duplicateLibraryId).toBe(1);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "scan_duplicate_samples",
      expect.anything()
    );

    fireEvent.click(screen.getByRole("button", { name: /^Scan$/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("scan_duplicate_samples", {
        mode: "exact",
        libraryId: 1,
      });
      expect(useSampleStore.getState().duplicateScanResult?.groups_found).toBe(1);
    });
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([
      101, 102, 103,
    ]);
    expect(screen.getByRole("button", { name: /^Re-scan$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Select Extras/i }));
    // Keep copy (101) and Read-Only Vault copy (103) must stay unselected; writable extra (102) selected
    expect(useSampleStore.getState().selectedSampleIds).toEqual([102]);

    // Switching to an unscanned mode flips action button back to Scan without auto-scanning
    fireEvent.click(screen.getByRole("button", { name: /Similar Audio/i }));
    expect(useSampleStore.getState().duplicateScanMode).toBe("similar");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Scan$/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("scan_duplicate_samples", {
        mode: "similar",
        libraryId: 1,
        minSimilarityPct: 97,
      });
    });

    // Returning to an already-scanned (exact, 1) scope restores cached result cleanly without backend scan
    fireEvent.click(screen.getByRole("button", { name: /Exact \(SHA-256\)/i }));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /^Re-scan$/i })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Read-Only · Write Mode/i })
    );
    expect(useSampleStore.getState().settingsTab).toBe("advanced");
    expect(invokeMock).toHaveBeenCalledWith(
      "open_settings_window",
      expect.objectContaining({ tab: "advanced" })
    );

    // Single chip inside ActiveFilterBanner dismisses Duplicates cleanly
    expect(screen.getByText(/Duplicates · 1 group ·/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Exit Duplicates view/i }));
    expect(useSampleStore.getState().duplicatesFilterActive).toBe(false);
  });

  it("pre-selects matching library from active folder filter and renders compact Mini Dock controls without summary duplication", () => {
    const { scanResult } = makeScanResult();
    useSampleStore.setState({
      folderFilter: "C:/Audio/Main/Monsters",
      duplicateScanResult: scanResult,
      duplicateScanCache: { "exact:1": scanResult },
    });

    useSampleStore.getState().setDuplicatesFilterActive(true);
    expect(useSampleStore.getState().duplicateLibraryId).toBe(1);

    render(
      <FilterDrawerPanel
        activeTab="general"
        compact={true}
        bpmTokens={[]}
        keyTokens={[]}
      />
    );
    expect(screen.getByRole("button", { name: /^Exact$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Similar$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Extras \(1\)/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Read-Only$/i })).toBeTruthy();
    expect(screen.queryByText(/reclaimable/i)).toBeNull();
  });

  it("caches full trashed pool for dynamic Trash folder tree and filters Trash by original folder", async () => {
    const t1 = {
      ...makeSample(201, "cry_a.wav", "C:/Audio/Main/Pokemon", 1, 1024),
      file_path: "C:/Audio/Main/.audify_trash/cry_a.wav",
      original_file_path: "C:/Audio/Main/Pokemon/cry_a.wav",
      is_trashed: true,
    };
    const t2 = {
      ...makeSample(202, "boom_b.wav", "C:/Audio/Main/Explosions", 1, 2048),
      file_path: "C:/Audio/Main/.audify_trash/boom_b.wav",
      original_file_path: "C:/Audio/Main/Explosions/boom_b.wav",
      is_trashed: true,
    };

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "query_samples") return Promise.resolve([t1, t2]);
      return Promise.resolve([]);
    });

    useSampleStore.setState({ trashFilterActive: true, folderFilter: null });
    await useSampleStore.getState().fetchSamples();
    expect(useSampleStore.getState().trashedProfileSamples).toHaveLength(2);
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([201, 202]);

    // Selecting a subfolder while inside Trash stays in Trash and filters samples in memory while keeping trashedProfileSamples complete
    useSampleStore.getState().setFolderFilter("C:/Audio/Main/Pokemon");
    await waitFor(() => {
      expect(useSampleStore.getState().trashFilterActive).toBe(true);
      expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([201]);
      expect(useSampleStore.getState().trashedProfileSamples).toHaveLength(2);
    });
  });

  it("builds folder tree only for duplicate folders and prunes trashed duplicate groups cleanly", () => {
    const { scanResult, allSamples } = makeScanResult();
    const lib = makeLibrary();
    const treeByLib = buildFolderTreeByLibrary({
      displayLibraries: [lib],
      folderStats: [
        {
          library_id: 1,
          folder_path: "C:/Audio/Main/Monsters",
          count: 10,
        },
        {
          library_id: 1,
          folder_path: "C:/Audio/Main/UnrelatedEmptyOfDups",
          count: 50,
        },
      ],
      fallbackSamples: [],
      favoriteOnly: false,
      favoriteSamples: [],
      subsetSamples: allSamples,
    });

    const nodeNames = treeByLib[1].map((n) => n.name);
    expect(nodeNames).toEqual(["Monsters", "Temp"]);
    expect(nodeNames).not.toContain("UnrelatedEmptyOfDups");

    const orderMap = buildDuplicateOrderMap(true, scanResult);
    expect(orderMap?.get(101)).toBe(0);
    expect(orderMap?.get(102)).toBe(1);

    const prunedTwoLeft = pruneDuplicateScanResult(scanResult, new Set([102]));
    expect(prunedTwoLeft?.groups_found).toBe(1);
    expect(prunedTwoLeft?.duplicate_files_count).toBe(1);

    // Dropping down to 1 remaining file dissolves the group completely
    const prunedOneLeft = pruneDuplicateScanResult(
      scanResult,
      new Set([102, 103])
    );
    expect(prunedOneLeft?.groups_found).toBe(0);
    expect(prunedOneLeft?.duplicate_files_count).toBe(0);
  });

  it("auto-expands FilterDrawer to General with dynamic Trash controls and restores prior drawer state on exit", async () => {
    localStorage.setItem("audify_filter_drawer_open", "false");
    localStorage.setItem("audify_filter_drawer_tab", "type");

    useSampleStore.setState({
      trashFilterActive: false,
      trashedCount: 2,
      trashedTotalBytes: 4096,
      selectedSampleIds: [201],
    });

    const { rerender } = render(<FilterDrawer />);
    expect(screen.queryByRole("button", { name: /Restore All/i })).toBeNull();

    useSampleStore.setState({ trashFilterActive: true });
    rerender(<FilterDrawer />);

    await waitFor(() => {
      const restoreSelectedBtn = screen.getByRole("button", {
        name: /Restore \(1\)/i,
      });
      const restoreAllBtn = screen.getByRole("button", { name: /Restore All/i });
      const emptyBtn = screen.getByRole("button", {
        name: /Empty to Recycle Bin/i,
      });
      expect(restoreSelectedBtn.className).toContain("bg-accent-soft");
      expect(restoreSelectedBtn.className).not.toContain("text-ok");
      expect(restoreAllBtn.className).toContain("bg-surface-3");
      expect(restoreAllBtn.className).not.toContain("text-ok");
      expect(emptyBtn.className).toContain("bg-surface-3");
      expect(emptyBtn.className).not.toContain("bg-danger/15");
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Empty to Recycle Bin/i })
    );
    const emptyDialog = screen.getByRole("dialog", {
      name: /Empty Recycle Bin/i,
    });
    expect(emptyDialog.getAttribute("data-mica-overlay")).toBe("true");
    expect(emptyDialog.parentElement?.className).toContain(
      "audify-modal-backdrop"
    );
    expect(emptyDialog.textContent).toContain("2 files");
    expect(emptyDialog.textContent).toContain("4.0 KB");
    expect(
      screen.getByRole("button", { name: /Empty to Recycle Bin/i })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /Empty Recycle Bin/i })).toBeNull();

    useSampleStore.setState({ trashFilterActive: false });
    rerender(<FilterDrawer />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Restore All/i })).toBeNull();
    });
    expect(localStorage.getItem("audify_filter_drawer_open")).toBe("false");
    expect(localStorage.getItem("audify_filter_drawer_tab")).toBe("type");
  });

  it("renders Solution A calm zebra group shading and 1px neutral divider without border-t-2 shift on SampleTableRow", () => {
    const s = makeSample(301, "hit.wav", "C:/Audio/Main/Hits", 1, 1024);
    const { container } = render(
      <SampleTableRow
        sample={s}
        rowIndex={2}
        startOffsetPx={68}
        totalTableWidth={900}
        isSimilarityMode={false}
        matchScore={null}
        isSimilarityAnchor={false}
        duplicateRole="keep"
        duplicateGroupLabel="#G2"
        isDuplicateGroupStart={true}
        isDuplicateAltGroup={true}
        isPrimarySelected={false}
        isRowSelected={false}
        isTagPopoverOpen={false}
        isGenrePopoverOpen={false}
        columnOrder={["name", "waveform", "time"]}
        visibleCols={DEFAULT_VISIBLE_COLS}
        colWidths={DEFAULT_COL_WIDTHS}
        selectedCollectionId={null}
        selectedGenre={null}
        selectedTagSet={new Set()}
        genreColorMap={new Map()}
        waveformDisplay={{
          accentColor: "#38bdf8",
          themeMode: "dark",
          enableMica: false,
          waveformSensitivity: "logarithmic",
          waveformStyle: "solid_baseline",
        }}
        onRowClick={vi.fn()}
        onRowMouseDown={vi.fn()}
        onRowContextMenu={vi.fn()}
        onOpenTagPopover={vi.fn()}
        onOpenGenrePopover={vi.fn()}
        onSetHoverOverflowTags={vi.fn()}
      />
    );

    const row = container.querySelector('[role="row"]');
    expect(row?.className).toContain("audify-dup-group-start");
    expect(row?.className).toContain("audify-row-surface-alt");
    expect(row?.className).not.toContain("border-t-2");
    expect(row?.className).not.toContain("border-t-accent");
  });

  it("updates duplicate scan progress from duplicate-scan-progress events and renders live progress bars", () => {
    registerStoreListenersOnce({
      set: useSampleStore.setState,
      get: useSampleStore.getState,
      applyProfileSettingsImmediately: vi.fn(),
      bumpProfileEpoch: vi.fn(() => 1),
      getProfileEpoch: vi.fn(() => 1),
      resetFiltersOnProfileChange: vi.fn(),
    });
    const handler = listenCallbacks.get("duplicate-scan-progress");
    expect(handler).toBeTruthy();

    // Ignored when no duplicate scan is active (guards against late IPC events)
    handler?.({
      payload: {
        mode: "exact",
        stage: "done",
        stage_label: "Completed",
        processed: 100,
        total: 100,
        percentage: 100,
        current_file: "",
      },
    });
    expect(useSampleStore.getState().duplicateScanProgress).toBeNull();

    useSampleStore.setState({
      isScanningDuplicates: true,
      duplicatesFilterActive: true,
    });
    handler?.({
      payload: {
        mode: "exact",
        stage: "partial_hash",
        stage_label: "Step 2/3 · Sampling headers",
        processed: 120,
        total: 400,
        percentage: 45,
        current_file: "kick_01.wav",
      },
    });

    expect(useSampleStore.getState().duplicateScanProgress?.percentage).toBe(45);

    render(
      <>
        <ActiveFilterBanner />
        <DuplicateGeneralControls />
        <BottomStatusBar />
      </>
    );

    expect(
      screen.getAllByText("Step 2/3 · Sampling headers (45%)").length
    ).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/\[120\/400\]/)).toBeNull();
    expect(screen.getByText("kick_01.wav")).toBeTruthy();
  });

  it("filters Similar Audio Select Extras by similarity % threshold and passes minSimilarityPct on scan", async () => {
    const s1 = makeSample(101, "kick_main.wav", "C:/Audio/Main/Kicks", 1, 4096);
    const s2 = makeSample(102, "kick_copy.wav", "C:/Audio/Main/Kicks", 1, 4096);
    const s3 = makeSample(201, "snare_main.wav", "C:/Audio/Main/Snares", 1, 4096);
    const s4 = makeSample(202, "snare_alt.wav", "C:/Audio/Main/Snares", 1, 4096);

    const similarResult: DuplicateScanResult = {
      mode: "similar",
      scanned_samples: 4,
      groups_found: 2,
      duplicate_files_count: 2,
      reclaimable_bytes: 8192,
      elapsed_ms: 12,
      groups: [
        {
          group_id: "similar:101",
          match_kind: "near_duplicate",
          similarity_pct: 99,
          file_size: 4096,
          reclaimable_bytes: 4096,
          items: [
            {
              sample_id: 101,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s1.file_path,
              file_name: s1.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: true,
            },
            {
              sample_id: 102,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s2.file_path,
              file_name: s2.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: false,
            },
          ],
        },
        {
          group_id: "similar:201",
          match_kind: "near_duplicate",
          similarity_pct: 95,
          file_size: 4096,
          reclaimable_bytes: 4096,
          items: [
            {
              sample_id: 201,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s3.file_path,
              file_name: s3.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: true,
            },
            {
              sample_id: 202,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s4.file_path,
              file_name: s4.file_name,
              extension: "wav",
              duration_ms: 1200,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 4096,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: false,
            },
          ],
        },
      ],
    };

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "scan_duplicate_samples") {
        return Promise.resolve(similarResult);
      }
      return Promise.resolve([]);
    });

    useSampleStore.setState({
      allProfileSamples: [s1, s2, s3, s4],
      rawSamples: [s1, s2, s3, s4],
      samples: [s1, s2, s3, s4],
      duplicatesFilterActive: true,
      duplicateScanMode: "similar",
      duplicateMinSimilarityPct: 95,
      duplicateExtrasMinPct: 98,
      duplicateScanResult: similarResult,
      duplicateScanCache: { "similar:95:all": similarResult },
    });

    render(<DuplicateGeneralControls />);

    // With Extras threshold >= 98%, only the 99% group's extra (102) is counted & selected
    const extrasBtn = screen.getByRole("button", { name: /Select Extras \(1\)/i });
    fireEvent.click(extrasBtn);
    expect(useSampleStore.getState().selectedSampleIds).toEqual([102]);

    // Switching Extras threshold to All updates count to 2 and selects both [102, 202]
    fireEvent.click(
      screen.getByRole("button", {
        name: "Extras selection minimum similarity",
      })
    );
    fireEvent.click(screen.getByRole("option", { name: /All/i }));
    const allExtrasBtn = screen.getByRole("button", {
      name: /Select Extras \(2\)/i,
    });
    fireEvent.click(allExtrasBtn);
    expect(useSampleStore.getState().selectedSampleIds).toEqual([102, 202]);

    // Changing Min % dropdown sets scan threshold without auto-scanning until Scan is clicked
    fireEvent.click(
      screen.getByRole("button", { name: "Similar audio minimum similarity" })
    );
    fireEvent.click(screen.getByRole("option", { name: />= 98%/i }));
    expect(useSampleStore.getState().duplicateMinSimilarityPct).toBe(98);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "scan_duplicate_samples",
      expect.anything()
    );

    fireEvent.click(screen.getByRole("button", { name: /^Scan$/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("scan_duplicate_samples", {
        mode: "similar",
        libraryId: null,
        minSimilarityPct: 98,
      });
    });

    // Near-duplicate row badge renders % and highlights < 98% variations with warn styling
    const { container } = render(
      <SampleTableRow
        sample={s4}
        rowIndex={1}
        startOffsetPx={34}
        totalTableWidth={900}
        isSimilarityMode={false}
        matchScore={null}
        isSimilarityAnchor={false}
        duplicateRole="extra"
        duplicateGroupLabel="#G2 · 95%"
        duplicateHighConfidence={false}
        isPrimarySelected={false}
        isRowSelected={false}
        isTagPopoverOpen={false}
        isGenrePopoverOpen={false}
        columnOrder={["name", "waveform", "time"]}
        visibleCols={DEFAULT_VISIBLE_COLS}
        colWidths={DEFAULT_COL_WIDTHS}
        selectedCollectionId={null}
        selectedGenre={null}
        selectedTagSet={new Set()}
        genreColorMap={new Map()}
        waveformDisplay={{
          accentColor: "#38bdf8",
          themeMode: "dark",
          enableMica: false,
          waveformSensitivity: "logarithmic",
          waveformStyle: "solid_baseline",
        }}
        onRowClick={vi.fn()}
        onRowMouseDown={vi.fn()}
        onRowContextMenu={vi.fn()}
        onOpenTagPopover={vi.fn()}
        onOpenGenrePopover={vi.fn()}
        onSetHoverOverflowTags={vi.fn()}
      />
    );
    const badge = screen.getByText("#G2 · 95%");
    expect(badge.className).toContain("text-warn");
    expect(container.querySelector('[role="row"]')).toBeTruthy();
  });

  it("supports All (80%+ min) in Similar Audio scan dropdown and locks compact Mini Dock FilterDrawer to a single-row h-[74px]", async () => {
    const s1 = makeSample(101, "hat_clean.wav", "C:/Audio/Main/Hats", 1, 2048);
    const s2 = makeSample(102, "hat_copy.wav", "C:/Audio/Main/Temp", 1, 2048);

    const allSimResult: DuplicateScanResult = {
      mode: "similar",
      scanned_samples: 2,
      groups_found: 1,
      duplicate_files_count: 1,
      reclaimable_bytes: 2048,
      elapsed_ms: 8,
      groups: [
        {
          group_id: "similar:101",
          match_kind: "near_duplicate",
          similarity_pct: 99,
          file_size: 2048,
          reclaimable_bytes: 2048,
          items: [
            {
              sample_id: 101,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s1.file_path,
              file_name: s1.file_name,
              extension: "wav",
              duration_ms: 1000,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 2048,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: true,
            },
            {
              sample_id: 102,
              library_id: 1,
              library_name: "Main SFX",
              library_read_only: false,
              file_path: s2.file_path,
              file_name: s2.file_name,
              extension: "wav",
              duration_ms: 1000,
              sample_rate: 44100,
              channels: 2,
              bit_depth: 16,
              file_size: 2048,
              is_favorite: false,
              tag_count: 0,
              collection_count: 0,
              keep_suggested: false,
            },
          ],
        },
      ],
    };

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "scan_duplicate_samples") {
        return Promise.resolve(allSimResult);
      }
      return Promise.resolve([]);
    });

    useSampleStore.setState({
      allProfileSamples: [s1, s2],
      rawSamples: [s1, s2],
      samples: [s1, s2],
      duplicatesFilterActive: true,
      duplicateScanMode: "similar",
      duplicateMinSimilarityPct: 97,
      duplicateExtrasMinPct: 98,
      duplicateScanResult: null,
      duplicateScanCache: {},
    });

    const { unmount } = render(<DuplicateGeneralControls />);

    fireEvent.click(
      screen.getByRole("button", { name: "Similar audio minimum similarity" })
    );
    const allOption = screen.getByRole("option", { name: /All\s*80%\+ min/i });
    fireEvent.click(allOption);

    expect(useSampleStore.getState().duplicateMinSimilarityPct).toBe(80);
    expect(useSampleStore.getState().duplicateExtrasMinPct).toBe(98);
    expect(formatDuplicateModeLabel("similar", 80)).toBe(
      "Similar Audio (All 80%+)"
    );
    expect(
      screen.getByRole("button", { name: "Similar audio minimum similarity" })
        .textContent
    ).toContain("All");

    fireEvent.click(screen.getByRole("button", { name: /^Scan$/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("scan_duplicate_samples", {
        mode: "similar",
        libraryId: null,
        minSimilarityPct: 80,
      });
    });
    unmount();

    localStorage.setItem("audify_filter_drawer_open", "true");
    localStorage.setItem("audify_filter_drawer_tab", "general");
    const { container } = render(<FilterDrawer compact={true} />);

    const simBtn = await screen.findByRole("button", { name: /^Similar$/i });
    const drawerBody = screen.getByTestId("filter-drawer-body");
    expect(drawerBody.style.height).toBe("74px");
    expect(drawerBody.className).toContain("overflow-y-auto");
    expect(container.querySelector(".min-h-\\[68px\\]")).toBeNull();

    const controlsRow = simBtn.parentElement?.parentElement;
    expect(controlsRow?.className).toContain("flex-wrap");
    expect(controlsRow?.className).not.toContain("flex-nowrap");

    expect(
      screen.getByRole("button", { name: "Duplicate library scope" }).textContent
    ).toContain("All Libs");
    expect(
      screen.getByRole("button", { name: /Re-scan active duplicate scope/i })
        .textContent
    ).toBe("");
    expect(
      screen.getByRole("button", { name: /Extras \(1\)/i })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Extras selection minimum similarity",
      }).textContent
    ).toContain("98%+");
  });

  it("uses theme accent styling for DragDropFeedbackOverlay when dragging tracks over Trash", async () => {
    const sample = makeSample(401, "drop_me.wav", "C:/Audio/Main/Temp", 1, 2048);
    useSampleStore.setState({
      enableAdvancedFileOps: true,
      inAppDragSample: sample,
      inAppDragSamples: [sample],
    });

    render(<DragDropFeedbackOverlay />);
    window.dispatchEvent(
      new CustomEvent("audify:folder-drop-overlay", {
        detail: { isExternalFileDragActive: false, dragHoverTarget: "trash" },
      })
    );

    const highlight = await screen.findByText("Trash");
    expect(highlight.className).toContain("text-accent-fg");
    expect(highlight.className).not.toContain("text-danger");
    const circle = highlight.parentElement?.previousElementSibling;
    expect(circle?.className).toContain("text-accent-fg");
    expect(circle?.className).toContain("border-accent/60");
    expect(circle?.className).not.toContain("danger");
  });
});
