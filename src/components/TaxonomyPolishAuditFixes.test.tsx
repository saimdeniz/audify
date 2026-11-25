// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    show: () => Promise.resolve(),
    setFocus: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    startDragging: () => Promise.resolve(),
    minimize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import { useAppGlobalShortcuts } from "../hooks/useAppGlobalShortcuts";
import { useSampleStore } from "../store/useSampleStore";
import type { SampleItem, Tag, TagFacet } from "../types";
import { getSearchAutocompleteSuggestions } from "../utils/search/searchAutocomplete";
import {
  clearSmartSearchCache,
  executeSmartSearch,
  setSmartSearchTaxonomy,
} from "../utils/smartSearch";
import {
  flattenTaxonomyTree,
  serializeTaxonomyForWorker,
} from "../utils/taxonomyTree";
import { MiniDockTransport } from "./mini-dock/MiniDockTransport";
import { FilterDrawer } from "./sample-table/FilterDrawer";
import { SampleContextMenu } from "./sample-table/SampleContextMenu";
import type { ContextMenuState, RowPopoverPosition } from "./sample-table/tableLayout";
import { useSampleTableInteractions } from "./sample-table/useSampleTableInteractions";
import { SettingsSectionHeader } from "./settings/SettingsSectionHeader";
import { TagLibrarySubtab } from "./settings/TagLibrarySubtab";

const AUDIT_FACETS: TagFacet[] = [
  { id: 1, slug: "category", name: "Category", color: "#3B82F6", sort_order: 0, is_system: true, domain: "tags", allow_nesting: true },
  { id: 2, slug: "genre", name: "Genre", color: "#8B5CF6", sort_order: 1, is_system: true, domain: "genres", allow_nesting: true },
  { id: 3, slug: "mood", name: "Mood", color: "#EC4899", sort_order: 2, is_system: true, domain: "genres", allow_nesting: false },
  { id: 4, slug: "source", name: "Source / Pack", color: "#64748B", sort_order: 3, is_system: true, domain: "tags", allow_nesting: false },
  { id: 5, slug: "material", name: "Material", color: "#14B8A6", sort_order: 4, is_system: false, domain: "tags", allow_nesting: true },
  { id: 6, slug: "era", name: "Era", color: "#F59E0B", sort_order: 5, is_system: false, domain: "genres", allow_nesting: false },
];

const AUDIT_TAGS: Tag[] = [
  { id: 1, name: "Animals", color: "#22C55E", effective_color: "#22C55E", sample_count: 1, rollup_count: 4, facet_id: 1, facet_slug: "category", parent_id: null, path: "/1/" },
  { id: 2, name: "Dog", color: "#22C55E", effective_color: "#22C55E", sample_count: 3, rollup_count: 3, facet_id: 1, facet_slug: "category", parent_id: 1, path: "/1/2/", color_inherited: true },
  { id: 3, name: "Foley", color: "#10B981", effective_color: "#10B981", sample_count: 2, rollup_count: 2, facet_id: 1, facet_slug: "category", parent_id: null, path: "/3/" },
  { id: 10, name: "Electronic", color: "#8B5CF6", effective_color: "#8B5CF6", sample_count: 1, rollup_count: 4, facet_id: 2, facet_slug: "genre", parent_id: null, path: "/10/" },
  { id: 11, name: "Synthwave", color: "#8B5CF6", effective_color: "#8B5CF6", sample_count: 3, rollup_count: 3, facet_id: 2, facet_slug: "genre", parent_id: 10, path: "/10/11/", color_inherited: true },
  { id: 20, name: "Dark", color: "#EC4899", effective_color: "#EC4899", sample_count: 2, rollup_count: 2, facet_id: 3, facet_slug: "mood", parent_id: null, path: "/20/" },
  { id: 30, name: "Pokemon", color: "#64748B", effective_color: "#64748B", sample_count: 2, rollup_count: 2, facet_id: 4, facet_slug: "source", parent_id: null, path: "/30/" },
  { id: 40, name: "Metal", color: "#14B8A6", effective_color: "#14B8A6", sample_count: 1, rollup_count: 3, facet_id: 5, facet_slug: "material", parent_id: null, path: "/40/" },
  { id: 41, name: "Steel", color: "#14B8A6", effective_color: "#14B8A6", sample_count: 2, rollup_count: 2, facet_id: 5, facet_slug: "material", parent_id: 40, path: "/40/41/", color_inherited: true },
  { id: 50, name: "80s", color: "#F59E0B", effective_color: "#F59E0B", sample_count: 2, rollup_count: 2, facet_id: 6, facet_slug: "era", parent_id: null, path: "/50/" },
];

function makeAuditSample(
  id: number,
  fileName: string,
  tagIds: number[],
  genre = ""
): SampleItem {
  const byId = new Map(AUDIT_TAGS.map((t) => [t.id, t]));
  return {
    id,
    library_id: 1,
    file_path: `C:/Audio/${fileName}`,
    file_name: fileName,
    folder_path: "C:/Audio",
    extension: "wav",
    duration_ms: 850,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 40960,
    is_favorite: false,
    is_loop: false,
    genre,
    artist: "",
    album: "",
    year: "",
    peaks_json: "[]",
    created_at: "2026-11-24",
    tags: tagIds.map((tid) => {
      const t = byId.get(tid)!;
      return { id: t.id, name: t.name, color: t.effective_color || t.color };
    }),
  };
}

describe("Master Polish & Audit Fix Suite (Phases 1-6)", () => {
  const origState = useSampleStore.getState();

  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
    clearSmartSearchCache();
    useSampleStore.setState({
      tagFacets: AUDIT_FACETS,
      tags: AUDIT_TAGS,
      genres: [],
      selectedTagIds: [],
      excludedTagIds: [],
      selectedGenre: null,
      tagMatchMode: "all",
      shortcuts: { ...DEFAULT_SHORTCUTS },
      isSettingsOpen: false,
      batchRenameSampleIds: null,
    });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    useSampleStore.setState({
      tagFacets: origState.tagFacets,
      tags: origState.tags,
      genres: origState.genres,
      selectedTagIds: origState.selectedTagIds,
      excludedTagIds: origState.excludedTagIds,
      selectedGenre: origState.selectedGenre,
      tagMatchMode: origState.tagMatchMode,
      shortcuts: origState.shortcuts,
      assignTagBatch: origState.assignTagBatch,
      unassignTagBatch: origState.unassignTagBatch,
      harmonizeTaxonomyColors: origState.harmonizeTaxonomyColors,
      refreshAutoTagImpactPreview: origState.refreshAutoTagImpactPreview,
      undoLastAutoTagApply: origState.undoLastAutoTagApply,
      autoTagRulesDirty: origState.autoTagRulesDirty,
      autoTagImpactPreview: origState.autoTagImpactPreview,
      canUndoAutoTagApply: origState.canUndoAutoTagApply,
    });
  });

  it("B1: multi-select SampleContextMenu displays checkmarks and unassigns shared tags & genres", async () => {
    const unassignTagBatch = vi.fn().mockResolvedValue(undefined);
    const assignTagBatch = vi.fn().mockResolvedValue(undefined);

    const s1 = makeAuditSample(101, "bark_01.wav", [2, 11], "Synthwave"); // Dog + Synthwave
    const s2 = makeAuditSample(102, "bark_02.wav", [2, 3, 20], "Dark"); // Dog + Foley + Dark
    const sampleMap = new Map<number, SampleItem>([
      [101, s1],
      [102, s2],
    ]);

    useSampleStore.setState({
      samples: [s1, s2],
      allProfileSamples: [s1, s2],
      selectedSample: s1,
      selectedSampleIds: [101, 102],
      unassignTagBatch,
      assignTagBatch,
    });

    const setContextMenu = vi.fn();
    const ctxState: ContextMenuState = {
      x: 120,
      y: 120,
      sample: s1,
      targetIds: [101, 102],
      subMenu: "tag",
    };

    const view = render(
      <SampleContextMenu
        contextMenu={ctxState}
        setContextMenu={setContextMenu}
        sampleByIdMap={sampleMap}
        rootCollections={[]}
        childrenByParentId={new Map()}
      />
    );

    // Shortcut hints T and G appear on submenu triggers
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByText("G")).toBeTruthy();

    // Dog is assigned to ALL selected samples -> clicking Dog unassigns from [101, 102]
    const dogOption = screen.getByRole("button", { name: /^Dog\b/i });
    fireEvent.click(dogOption);
    await waitFor(() => {
      expect(unassignTagBatch).toHaveBeenCalledWith([101, 102], 2);
    });

    // Foley is partial (only on 102) -> clicking Foley assigns to all [101, 102]
    const foleyOption = screen.getByRole("button", { name: /^Foley\b/i });
    fireEvent.click(foleyOption);
    await waitFor(() => {
      expect(assignTagBatch).toHaveBeenCalledWith([101, 102], 3);
    });

    view.unmount();
  });

  it("B3: Smart Search & Autocomplete index nested sub-genre ancestors and custom facet operators", () => {
    setSmartSearchTaxonomy(serializeTaxonomyForWorker(AUDIT_TAGS, AUDIT_FACETS));

    const sSynthSteel = makeAuditSample(1, "cyber_hit.wav", [11, 41, 50], "Synthwave");
    const sDarkFoley = makeAuditSample(2, "cave_step.wav", [3, 20], "Dark");
    const pool = [sSynthSteel, sDarkFoley];

    // Nested sub-genre ancestor rollup: genre:electronic matches Synthwave (child of Electronic)
    expect(executeSmartSearch(pool, "genre:electronic").map((s) => s.id)).toEqual([1]);
    // Custom genres-domain facet ("era") matches both genre:80s and era:80s
    expect(executeSmartSearch(pool, "genre:80s").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(pool, "era:80s").map((s) => s.id)).toEqual([1]);
    // Custom tags-domain nested facet ("material"): material:metal rolls up Steel (41), -material:steel excludes it
    expect(executeSmartSearch(pool, "material:metal").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(pool, "-material:steel").map((s) => s.id)).toEqual([2]);

    // Autocomplete suggests custom facet values for both positive (`material:`) and negated (`-era:`) operators
    const valCtx = getSearchAutocompleteSuggestions(
      "material:ste",
      12,
      AUDIT_TAGS,
      [],
      [],
      AUDIT_FACETS
    );
    expect(valCtx?.headerLabel).toContain("MATERIAL (material:)");
    expect(valCtx?.items[0]?.insertToken).toBe("material:Steel");
    expect(valCtx?.items[0]?.label).toBe("Metal ▸ Steel");

    const negEraCtx = getSearchAutocompleteSuggestions(
      "-era:8",
      6,
      AUDIT_TAGS,
      [],
      [],
      AUDIT_FACETS
    );
    expect(negEraCtx?.headerLabel).toContain("EXCLUDE ERA (-era:)");
    expect(negEraCtx?.items[0]?.insertToken).toBe("-era:80s");
    expect(negEraCtx?.items[0]?.kind).toBe("genre");
  });

  it("Studio Drag-to-Reorder: flattenTaxonomyTree honors explicit negative sort_order before rollup popularity", () => {
    const reorderedTags: Tag[] = AUDIT_TAGS.map((t) => {
      if (t.id === 3) return { ...t, sort_order: -10_000 }; // Foley (rollup 2) pinned BEFORE Animals (rollup 4)
      if (t.id === 1) return { ...t, sort_order: -9_990 };
      return t;
    });
    const flat = flattenTaxonomyTree(
      reorderedTags,
      "category",
      new Set<number>([1]),
      "",
      { facets: AUDIT_FACETS }
    );
    expect(flat.map((n) => n.tag.name)).toEqual(["Foley", "Animals", "Dog"]);
  });

  it("Phase 4: FilterDrawer uses fixed-width left clickable facet column, uniform height, and resize handle", async () => {
    // Only Synthwave (genres-domain) is selected -> Genre tab dot active, Tags tab dot inactive
    useSampleStore.setState({ selectedTagIds: [11] });

    const drawer = render(<FilterDrawer />);
    const genreTabBtn = screen.getByRole("button", { name: /^Genre$/i });
    const tagsTabBtn = screen.getByRole("button", { name: /^Tags$/i });
    expect(genreTabBtn.querySelector(".bg-accent")).toBeTruthy();
    expect(tagsTabBtn.querySelector(".bg-accent")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Expand filter drawer/i }));

    // Uniform default 88px body height across tabs (zero vertical jump)
    const drawerBody = screen.getByTestId("filter-drawer-body");
    expect(drawerBody.style.height).toBe("88px");

    // Drag resize handle upward by 60px -> expands to 148px & persists; double-click resets to 88px
    const resizeHandle = screen.getByTestId("filter-drawer-resize-handle");
    fireEvent.pointerDown(resizeHandle, { button: 0, clientY: 300 });
    fireEvent.pointerMove(window, { clientY: 240 });
    fireEvent.pointerUp(window);
    expect(drawerBody.style.height).toBe("148px");
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.filterDrawerHeight)).toBe("148");
    fireEvent.doubleClick(resizeHandle);
    expect(drawerBody.style.height).toBe("88px");

    // Switch to Genre tab: left column has clickable Genre / Mood / Era headings; right shows selected facet only
    fireEvent.click(genreTabBtn);
    await waitFor(() => {
      expect(document.querySelector("[data-drawer-facet='genre']")).toBeTruthy();
    });
    expect(document.querySelector("[data-drawer-facet-tab='genre']")).toBeTruthy();
    expect(document.querySelector("[data-drawer-facet-tab='mood']")).toBeTruthy();
    expect(document.querySelector("[data-drawer-facet-tab='era']")).toBeTruthy();
    expect(document.querySelector("[data-drawer-cluster='Electronic']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Synthwave/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Dark/i })).toBeNull();

    // Click Mood text heading on left -> right pane switches strictly to Mood
    fireEvent.click(document.querySelector("[data-drawer-facet-tab='mood']")!);
    expect(document.querySelector("[data-drawer-facet='mood']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dark/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Synthwave/i })).toBeNull();

    // Switch to Tags tab: left column has Category / Source / Pack / Material; clicking Material switches right pane
    fireEvent.click(tagsTabBtn);
    await waitFor(() => {
      expect(document.querySelector("[data-drawer-facet='category']")).toBeTruthy();
    });
    expect(document.querySelector("[data-drawer-cluster='Animals']")).toBeTruthy();
    expect(document.querySelector("[data-drawer-cluster='Metal']")).toBeNull();
    fireEvent.click(document.querySelector("[data-drawer-facet-tab='material']")!);
    expect(document.querySelector("[data-drawer-facet='material']")).toBeTruthy();
    expect(document.querySelector("[data-drawer-cluster='Metal']")).toBeTruthy();

    drawer.unmount();

    // Compact Mini Dock FilterDrawer defaults to 74px and supports independent resize + double-click reset
    const compactDrawer = render(<FilterDrawer compact />);
    const compactBody = screen.getByTestId("filter-drawer-body");
    expect(compactBody.style.height).toBe("74px");
    const compactHandle = screen.getByTestId("filter-drawer-resize-handle");
    fireEvent.pointerDown(compactHandle, { button: 0, clientY: 300 });
    fireEvent.pointerMove(window, { clientY: 250 });
    fireEvent.pointerUp(window);
    expect(compactBody.style.height).toBe("124px");
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.filterDrawerCompactHeight)).toBe("124");
    fireEvent.doubleClick(compactHandle);
    expect(compactBody.style.height).toBe("74px");
    compactDrawer.unmount();

    // MiniDockTransport Play button matches Normal View: neutral when idle, accent when playing
    useSampleStore.setState({ isPlaying: false });
    const dockIdle = render(<MiniDockTransport />);
    const playIdleBtn = screen.getByRole("button", { name: /^Play$/i });
    expect(playIdleBtn.className).toContain("bg-surface-3");
    expect(playIdleBtn.className).not.toContain("bg-accent-soft");
    dockIdle.unmount();

    useSampleStore.setState({ isPlaying: true });
    const dockPlaying = render(<MiniDockTransport />);
    const pauseBtn = screen.getByRole("button", { name: /^Pause$/i });
    expect(pauseBtn.className).toContain("bg-accent");
    dockPlaying.unmount();
  });

  it("Color Harmony UX: Studio facet header Harmonize button and inspector contextual Use parent shade button", async () => {
    const harmonizeTaxonomyColors = vi.fn().mockResolvedValue(1);
    const customColoredTags: Tag[] = AUDIT_TAGS.map((t) =>
      t.id === 2 ? { ...t, color_inherited: false, color: "#EF4444" } : t
    );

    useSampleStore.setState({
      tags: customColoredTags,
      tagFacets: AUDIT_FACETS,
      harmonizeTaxonomyColors,
    });

    const studio = render(<TagLibrarySubtab />);

    // Facet header shows 1-click "Harmonize 1" for Category (Dog has custom override)
    const facetHarmonizeBtn = screen.getByTestId("harmonize-facet-category");
    expect(facetHarmonizeBtn.textContent).toContain("Harmonize 1");
    fireEvent.click(facetHarmonizeBtn);
    await waitFor(() => {
      expect(harmonizeTaxonomyColors).toHaveBeenCalledWith({
        facetSlug: "category",
      });
    });

    // Clicking custom-colored child Dog shows contextual "Use parent shade" button (no checkbox clutter)
    fireEvent.click(screen.getByText("Dog"));
    expect(screen.getByRole("button", { name: /Use parent shade/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();

    // Clicking auto-shaded child Steel shows "auto shade" badge and no "Use parent shade" button or checkbox
    fireEvent.click(screen.getByText("Steel"));
    expect(screen.getByText("auto shade")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use parent shade/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    studio.unmount();
  });

  it("Phase 5: T and G shortcuts open row-anchored Tag & Genre pickers and ignore focused text inputs", () => {
    const s1 = makeAuditSample(77, "impact_01.wav", [2]);
    useSampleStore.setState({
      samples: [s1],
      allProfileSamples: [s1],
      selectedSample: s1,
      selectedSampleIds: [77],
      shortcuts: { ...DEFAULT_SHORTCUTS, openTagPicker: "t", openGenrePicker: "g" },
    });

    const rowEl = document.createElement("div");
    rowEl.setAttribute("data-sample-row-id", "77");
    const tagBtn = document.createElement("button");
    tagBtn.setAttribute("data-row-tag-btn", "true");
    tagBtn.getBoundingClientRect = () =>
      ({ left: 420, right: 440, top: 180, bottom: 200, width: 20, height: 20, x: 420, y: 180, toJSON: () => ({}) }) as DOMRect;
    const genreBtn = document.createElement("button");
    genreBtn.setAttribute("data-row-genre-btn", "true");
    genreBtn.getBoundingClientRect = () =>
      ({ left: 300, right: 320, top: 180, bottom: 200, width: 20, height: 20, x: 300, y: 180, toJSON: () => ({}) }) as DOMRect;
    rowEl.append(genreBtn, tagBtn);
    document.body.appendChild(rowEl);

    const captured: {
      tag: RowPopoverPosition | null;
      genre: RowPopoverPosition | null;
    } = { tag: null, genre: null };

    const setRowTagPopover = vi.fn((updater: React.SetStateAction<RowPopoverPosition | null>) => {
      captured.tag = typeof updater === "function" ? updater(captured.tag) : updater;
    });
    const setRowGenrePopover = vi.fn((updater: React.SetStateAction<RowPopoverPosition | null>) => {
      captured.genre = typeof updater === "function" ? updater(captured.genre) : updater;
    });

    const searchInputRef = React.createRef<HTMLInputElement>();

    renderHook(() => useAppGlobalShortcuts());
    renderHook(() =>
      useSampleTableInteractions({
        samples: [s1],
        autoBinOnNleDrag: false,
        searchInputRef,
        rowTagPopover: null,
        setRowTagPopover,
        rowGenrePopover: null,
        setRowGenrePopover,
        setHoverOverflowTags: vi.fn(),
        contextMenu: null,
        setContextMenu: vi.fn(),
        batchPopover: null,
        setBatchPopover: vi.fn(),
        showSearchHelper: false,
        setShowSearchHelper: vi.fn(),
        showColumnPicker: false,
        setShowColumnPicker: vi.fn(),
      })
    );

    // Typing 't' inside an <input> does NOT open the tag picker
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
    });
    expect(setRowTagPopover).not.toHaveBeenCalled();

    // Pressing 't' and 'g' when row/body is focused opens Tag & Genre popovers anchored to row 77
    input.blur();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
    });
    expect(captured.tag?.sampleId).toBe(77);

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true, cancelable: true }));
    });
    expect(captured.genre?.sampleId).toBe(77);
  });

  it("Phase 6: SettingsSectionHeader renders Apply rules impact badge and 1-click Undo button", async () => {
    const refreshImpact = vi.fn().mockResolvedValue(undefined);
    const undoApply = vi.fn().mockResolvedValue(undefined);

    useSampleStore.setState({
      settingsTab: "tags",
      autoTagRulesDirty: true,
      autoTagImpactPreview: {
        affected_samples: 5,
        added_links: 7,
        removed_links: 2,
        can_undo: true,
      },
      canUndoAutoTagApply: true,
      refreshAutoTagImpactPreview: refreshImpact,
      undoLastAutoTagApply: undoApply,
    });

    const header = render(
      <SettingsSectionHeader
        collectionsSubTab="list"
        setCollectionsSubTab={vi.fn()}
        tagsSubTab="rules"
        setTagsSubTab={vi.fn()}
        onClearShortcutRecording={vi.fn()}
      />
    );

    const badge = screen.getByTestId("auto-tag-impact-badge");
    expect(badge.textContent).toContain("~5");
    expect(badge.textContent).toContain("+7");
    expect(badge.textContent).toContain("-2");
    const undoBtn = screen.getByRole("button", { name: /^Undo$/i });
    fireEvent.click(undoBtn);
    await waitFor(() => {
      expect(undoApply).toHaveBeenCalledTimes(1);
    });

    header.unmount();
  });
});
