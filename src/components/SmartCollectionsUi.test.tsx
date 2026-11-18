// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Collection } from "../types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../store/useSampleStore";
import { SampleBatchActionBar } from "./sample-table/SampleBatchActionBar";
import { SampleFilterToolbar } from "./sample-table/SampleFilterToolbar";
import { CollectionInspector } from "./settings/CollectionInspector";
import { CollectionGroupItem } from "./sidebar/CollectionGroupItem";
import { CollectionsTreeTab } from "./sidebar/CollectionsTreeTab";

function makeSmartCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 77,
    parent_id: null,
    rule_path: null,
    smart_query: "kick bpm:120-130",
    name: "House Kicks",
    color: "#3b82f6",
    icon: "zap",
    created_at: "2026-01-01 00:00:00",
    sample_count: 0,
    ...overrides,
  };
}

describe("Smart Collections UI components", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    useSampleStore.setState({
      searchQuery: "",
      smartSearchSynonyms: true,
      allProfileSamples: [],
      rawSamples: [],
      samples: [],
      collections: [],
      tags: [],
      selectedTagIds: [],
      selectedCollectionId: null,
      folderFilter: null,
      selectedLicenseGroupId: null,
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      trashFilterActive: false,
      typeFilter: "all",
      srFilter: null,
      similaritySession: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Save as Smart Collection trigger only when searchQuery is non-empty and saves query", async () => {
    const searchInputRef = createRef<HTMLInputElement>();
    const setShowSearchHelper = vi.fn();

    const { rerender } = render(
      <SampleFilterToolbar
        searchInputRef={searchInputRef}
        showSearchHelper={false}
        setShowSearchHelper={setShowSearchHelper}
      />
    );

    expect(
      screen.getByPlaceholderText("Search samples...")
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Save .* as a Smart Collection/i })
    ).toBeNull();

    useSampleStore.setState({ searchQuery: "  kick -loop  " });
    rerender(
      <SampleFilterToolbar
        searchInputRef={searchInputRef}
        showSearchHelper={false}
        setShowSearchHelper={setShowSearchHelper}
      />
    );

    const saveTrigger = screen.getByTitle(
      'Save "kick -loop" as a Smart Collection'
    );
    fireEvent.click(saveTrigger);

    const nameInput = screen.getByPlaceholderText("Collection name...");
    fireEvent.change(nameInput, { target: { value: "One-Shot Kicks" } });

    const createdCol = makeSmartCollection({
      id: 88,
      name: "One-Shot Kicks",
      smart_query: "kick -loop",
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "create_collection") return createdCol;
      if (cmd === "get_profiles") return [];
      if (cmd === "get_libraries") return [];
      if (cmd === "get_tags") return [];
      if (cmd === "get_genres") return [];
      if (cmd === "get_collections") return [createdCol];
      if (cmd === "get_folder_tree_stats") return [];
      if (cmd === "get_trash_status") return null;
      return null;
    });

    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        (call) => call[0] === "create_collection"
      );
      expect(createCall).toBeTruthy();
      expect(createCall![1]).toMatchObject({
        name: "One-Shot Kicks",
        icon: "zap",
        smartQuery: "kick -loop",
      });
    });
  });

  it("renders sidebar Smart Collection row with live match count and disables drop target / manual buttons", () => {
    const smartCol = makeSmartCollection();
    render(
      <CollectionGroupItem
        rootCol={smartCol}
        smartMatchCount={42}
        childList={[]}
        hasChildren={false}
        isExpanded={false}
        selectedCollectionId={null}
        autoRouteCollectionDrops={true}
        hasActiveSampleSelection={true}
        isDraggingInApp={false}
        inAppDragCount={0}
        dragHoverTarget={null}
        subfolderParentId={null}
        newSubfolderName=""
        setNewSubfolderName={vi.fn()}
        setSubfolderParentId={vi.fn()}
        setExpandedCollectionIds={vi.fn()}
        toggleCollectionExpand={vi.fn()}
        setCollectionFilter={vi.fn()}
        setDragHoverTarget={vi.fn()}
        handleQuickAddSelectedToCollection={vi.fn().mockResolvedValue(undefined)}
        handleCreateSubfolder={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("House Kicks")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.queryByTitle("New subfolder")).toBeNull();
    expect(screen.queryByTitle("Add selected track(s) to collection")).toBeNull();
    const rowEl = screen.getByText("House Kicks").closest("[data-sidebar-drop]");
    expect(rowEl).toBeNull();
  });

  it("renders Smart Collection Inspector with editable smart query and hides template/subfolder controls", async () => {
    const smartCol = makeSmartCollection();
    useSampleStore.setState({
      collections: [smartCol],
      allProfileSamples: [],
    });

    render(
      <CollectionInspector
        activeInspectedCollection={smartCol}
        subCollections={[]}
        confirmDeleteCollectionId={null}
        setConfirmDeleteCollectionId={vi.fn()}
      />
    );

    expect(screen.getByText("SMART COLLECTION INSPECTOR")).toBeTruthy();
    expect(screen.getByText("DYNAMIC")).toBeTruthy();
    expect(screen.queryByText(/SUB-FOLDERS/)).toBeNull();
    expect(
      screen.queryByTitle("Generate missing template sub-folders")
    ).toBeNull();

    const queryInput = screen.getByDisplayValue(
      "kick bpm:120-130"
    ) as HTMLInputElement;

    // Escape reverts unsaved edit without calling invoke
    fireEvent.change(queryInput, { target: { value: "snare" } });
    fireEvent.keyDown(queryInput, { key: "Escape" });
    expect(queryInput.value).toBe("kick bpm:120-130");
    expect(invokeMock).not.toHaveBeenCalled();

    // Commit edited query on blur/Enter
    const updatedCol = makeSmartCollection({ smart_query: "kick bpm:125-135" });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "rename_collection") return updatedCol;
      if (cmd === "get_profiles") return [];
      if (cmd === "get_libraries") return [];
      if (cmd === "get_tags") return [];
      if (cmd === "get_genres") return [];
      if (cmd === "get_collections") return [updatedCol];
      if (cmd === "get_folder_tree_stats") return [];
      if (cmd === "get_trash_status") return null;
      return null;
    });

    fireEvent.change(queryInput, { target: { value: "  kick bpm:125-135  " } });
    fireEvent.blur(queryInput);

    await waitFor(() => {
      const renameCall = invokeMock.mock.calls.find(
        (call) => call[0] === "rename_collection"
      );
      expect(renameCall).toBeTruthy();
      expect(renameCall![1]).toMatchObject({
        collectionId: 77,
        newName: "House Kicks",
        newSmartQuery: "kick bpm:125-135",
      });
    });
  });

  it("pins collapsible SMART section (without header Zap icon) only when Smart Collections exist", () => {
    const manualCol = makeSmartCollection({
      id: 10,
      name: "golgena",
      icon: "folder",
      smart_query: null,
      sample_count: 16,
    });
    const smartCol = makeSmartCollection({
      id: 11,
      name: "stt",
      smart_query: "<2s",
    });

    useSampleStore.setState({ collections: [manualCol] });
    const { rerender } = render(
      <CollectionsTreeTab dragHoverTarget={null} setDragHoverTarget={vi.fn()} />
    );

    expect(screen.getByText("golgena")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^SMART \(/i })).toBeNull();

    useSampleStore.setState({ collections: [manualCol, smartCol] });
    rerender(
      <CollectionsTreeTab dragHoverTarget={null} setDragHoverTarget={vi.fn()} />
    );

    const smartHeader = screen.getByRole("button", { name: /^SMART \(1\)$/i });
    expect(smartHeader.getAttribute("aria-expanded")).toBe("true");
    // Header uses only chevron + label text (no extra Zap icon inside header)
    expect(smartHeader.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("stt")).toBeTruthy();

    fireEvent.click(smartHeader);
    expect(smartHeader.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("stt")).toBeNull();
  });

  it("renders SampleBatchActionBar Trash icon with theme accent styling instead of danger red", () => {
    useSampleStore.setState({
      enableAdvancedFileOps: true,
      trashFilterActive: false,
      selectedCollectionId: null,
    });

    render(
      <SampleBatchActionBar
        selectedSampleIds={[1, 2]}
        selectedSampleObjects={[]}
        rootCollections={[]}
        childrenByParentId={new Map()}
        batchPopover={null}
        setBatchPopover={vi.fn()}
        onStartNativeDrag={vi.fn()}
      />
    );

    const trashBtn = screen.getByTitle("Move selected to Trash (Del)");
    const trashIcon = trashBtn.querySelector("svg");
    expect(trashBtn.className).not.toContain("danger");
    expect(trashIcon?.getAttribute("class")).toContain("text-accent-fg");
    expect(trashIcon?.getAttribute("class")).not.toContain("text-danger");
  });
});
