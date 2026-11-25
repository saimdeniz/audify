// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import React from "react";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import { useSampleStore } from "../store/useSampleStore";
import type { AutoTagRule, Collection, SampleItem, Tag, TagFacet } from "../types";
import { canDropTaxonomyItem } from "../utils/taxonomyDragValidation";
import { buildTaxonomyIndex } from "../utils/taxonomyTree";
import { ActiveTaxonomyChips } from "./sample-table/ActiveTaxonomyChips";
import { SampleFilterToolbar } from "./sample-table/SampleFilterToolbar";
import { renderGenreCell, renderTagsCell } from "./sample-table/SampleTableRowCells";
import { CollectionsTab } from "./settings/CollectionsTab";
import { GenresTab } from "./settings/GenresTab";
import { TagLibrarySubtab } from "./settings/TagLibrarySubtab";
import { TagRulesSubtab } from "./settings/TagRulesSubtab";
import { CollectionsTreeTab } from "./sidebar/CollectionsTreeTab";
import { GenresSidebarTab } from "./sidebar/GenresSidebarTab";
import { TagsSidebarTab } from "./sidebar/TagsSidebarTab";

const STUDIO_FACETS: TagFacet[] = [
  { id: 1, slug: "category", name: "Category", color: "#3B82F6", sort_order: 0, is_system: true, domain: "tags", allow_nesting: true },
  { id: 2, slug: "genre", name: "Genre", color: "#8B5CF6", sort_order: 1, is_system: true, domain: "genres", allow_nesting: true },
  { id: 3, slug: "mood", name: "Mood", color: "#EC4899", sort_order: 2, is_system: true, domain: "genres", allow_nesting: false },
  { id: 4, slug: "source", name: "Source / Pack", color: "#64748B", sort_order: 3, is_system: true, domain: "tags", allow_nesting: false },
  { id: 5, slug: "material", name: "Material", color: "#14B8A6", sort_order: 4, is_system: false, domain: "tags", allow_nesting: true },
  { id: 6, slug: "era", name: "Era", color: "#F59E0B", sort_order: 5, is_system: false, domain: "genres", allow_nesting: false },
];

const STUDIO_TAGS: Tag[] = [
  { id: 1, name: "Animals", color: "#22C55E", effective_color: "#22C55E", sample_count: 1, rollup_count: 3, facet_id: 1, facet_slug: "category", parent_id: null, path: "/1/" },
  { id: 2, name: "Dog", color: "#22C55E", effective_color: "#22C55E", sample_count: 2, rollup_count: 2, facet_id: 1, facet_slug: "category", parent_id: 1, path: "/1/2/", color_inherited: true },
  { id: 30, name: "Pokemon", color: "#64748B", effective_color: "#64748B", sample_count: 4, rollup_count: 4, facet_id: 4, facet_slug: "source", parent_id: null, path: "/30/" },
  { id: 40, name: "Wood", color: "#14B8A6", effective_color: "#14B8A6", sample_count: 2, rollup_count: 2, facet_id: 5, facet_slug: "material", parent_id: null, path: "/40/" },
  { id: 10, name: "Electronic", color: "#8B5CF6", effective_color: "#8B5CF6", sample_count: 1, rollup_count: 4, facet_id: 2, facet_slug: "genre", parent_id: null, path: "/10/" },
  { id: 11, name: "Synthwave", color: "#8B5CF6", effective_color: "#8B5CF6", sample_count: 3, rollup_count: 3, facet_id: 2, facet_slug: "genre", parent_id: 10, path: "/10/11/", color_inherited: true },
  { id: 20, name: "Dark", color: "#EC4899", effective_color: "#EC4899", sample_count: 5, rollup_count: 5, facet_id: 3, facet_slug: "mood", parent_id: null, path: "/20/" },
  { id: 50, name: "80s", color: "#F59E0B", effective_color: "#F59E0B", sample_count: 2, rollup_count: 2, facet_id: 6, facet_slug: "era", parent_id: null, path: "/50/" },
];

const STUDIO_COLLECTIONS: Collection[] = [
  { id: 101, name: "SFX Packs", color: "#3B82F6", icon: "folder", created_at: "2026-11-24", sample_count: 12, parent_id: null, smart_query: null },
  { id: 102, name: "Impacts", color: "#3B82F6", icon: "folder", created_at: "2026-11-24", sample_count: 5, parent_id: 101, smart_query: null },
  { id: 103, name: "Short Kicks", color: "#3B82F6", icon: "zap", created_at: "2026-11-24", sample_count: 4, parent_id: null, smart_query: "kick <1s" },
];

describe("Sidebar persistence & strict Settings Studio domain separation", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
    useSampleStore.setState({
      tagFacets: STUDIO_FACETS,
      tags: STUDIO_TAGS,
      collections: STUDIO_COLLECTIONS,
      smartCollectionCounts: { 103: 4 },
      selectedTagIds: [],
      excludedTagIds: [],
      selectedGenre: null,
      selectedCollectionId: null,
      autoTagRules: [],
    });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({
      tagFacets: [],
      tags: [],
      collections: [],
      smartCollectionCounts: {},
    });
  });

  it("persists collapsed sidebar sections and expanded nodes across unmount/remount for Tags, Genres, and Collections", () => {
    const noop = vi.fn();

    // 1. TagsSidebarTab: collapse CATEGORY section & verify persistence across tab switch
    const tagsFirst = render(
      <TagsSidebarTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.getByText("Animals")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^CATEGORY \(/i }));
    expect(screen.queryByText("Animals")).toBeNull();
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.sidebarTagSectionsOpen)).toContain(
      '"category":false'
    );
    tagsFirst.unmount();

    const tagsSecond = render(
      <TagsSidebarTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.queryByText("Animals")).toBeNull();
    tagsSecond.unmount();

    // 2. GenresSidebarTab: expand nested Electronic -> Synthwave, collapse MOOD, persist across tab switch
    const genresFirst = render(
      <GenresSidebarTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.getByText("Electronic")).toBeTruthy();
    expect(screen.getByText("Dark")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Expand Genre Sections & Sub-genres"));
    expect(screen.getByText("Synthwave")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^MOOD \(1\)$/i }));
    expect(screen.queryByText("Dark")).toBeNull();
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.sidebarGenreSectionsOpen)).toContain(
      '"mood":false'
    );
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.sidebarExpandedTagIds)).toContain("10");
    genresFirst.unmount();

    const genresSecond = render(
      <GenresSidebarTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.getByText("Synthwave")).toBeTruthy();
    expect(screen.queryByText("Dark")).toBeNull();
    genresSecond.unmount();

    // 3. CollectionsTreeTab: collapse COLLECTIONS section, persist across tab switch
    const colsFirst = render(
      <CollectionsTreeTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.getByText("SFX Packs")).toBeTruthy();
    expect(screen.getByText("Short Kicks")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^COLLECTIONS \(/i }));
    expect(screen.queryByText("SFX Packs")).toBeNull();
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.sidebarManualCollectionsOpen)).toBe("false");
    colsFirst.unmount();

    const colsSecond = render(
      <CollectionsTreeTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.queryByText("SFX Packs")).toBeNull();
    expect(screen.getByText("Short Kicks")).toBeTruthy();
    colsSecond.unmount();
  });

  it("enforces strict domain separation between Tags Library and Genres studios with custom facets and nested sub-genres", () => {
    // Tags & Rules -> Library: shows Category, Source / Pack, Material; hides Genre, Mood, Era
    const tagsLib = render(<TagLibrarySubtab />);
    expect(screen.getByRole("button", { name: "ALL (4)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^CATEGORY$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^SOURCE \/ PACK$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^MATERIAL$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^GENRE$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^MOOD$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ERA$/i })).toBeNull();
    expect(screen.getByText("MERGE INTO ANOTHER TAG")).toBeTruthy();
    tagsLib.unmount();

    // Genres Studio: shows Genre, Mood, Era; hides Category, Source / Pack, Material; supports nested sub-genre & zero "TAG" wording
    const genresTab = render(<GenresTab />);
    expect(screen.getByRole("button", { name: "ALL (4)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^GENRE$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^MOOD$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^ERA$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^CATEGORY$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^SOURCE \/ PACK$/i })).toBeNull();
    expect(screen.getByText("Synthwave")).toBeTruthy();
    expect(screen.getByText("MERGE INTO ANOTHER GENRE")).toBeTruthy();
    expect(screen.queryByText(/MERGE INTO ANOTHER TAG/i)).toBeNull();
    expect(screen.getByTitle("Create sub-genre under Electronic")).toBeTruthy();
    genresTab.unmount();
  });

  it("renders CollectionsTab with filter pills, Expand/Collapse All, and inline sub-collections", () => {
    render(<CollectionsTab collectionsSubTab="list" />);
    expect(screen.getByRole("button", { name: "ALL (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "COLLECTIONS" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SMART" })).toBeTruthy();
    expect(screen.getAllByText("SFX Packs").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Impacts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Short Kicks")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "SMART" }));
    expect(screen.queryByTitle("Collapse sub-folders")).toBeNull();
    expect(screen.getAllByText("Short Kicks").length).toBeGreaterThanOrEqual(1);
  });

  it("persists Settings collapse/expand state across unmount/remount for Tags Library, Rules, Genres, and Collections", () => {
    // 1. TagLibrarySubtab: collapse nested items -> persists empty [] across remount (never snaps back open)
    const libFirst = render(<TagLibrarySubtab />);
    expect(screen.getByText("Dog")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Collapse Nested Items & Sections"));
    expect(screen.queryByText("Dog")).toBeNull();
    expect(
      localStorage.getItem(AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds)
    ).toBe("[]");
    libFirst.unmount();

    const libSecond = render(<TagLibrarySubtab />);
    expect(screen.queryByText("Dog")).toBeNull();
    libSecond.unmount();

    // 2. GenresTab: collapse Electronic -> persists across remount
    const genresFirst = render(<GenresTab />);
    expect(screen.getByText("Synthwave")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Collapse Nested Items & Sections"));
    expect(screen.queryByText("Synthwave")).toBeNull();
    genresFirst.unmount();

    const genresSecond = render(<GenresTab />);
    expect(screen.queryByText("Synthwave")).toBeNull();
    genresSecond.unmount();

    // 3. TagRulesSubtab: collapse rule group -> persists across remount
    const sampleRules: AutoTagRule[] = [
      {
        id: "r-impact",
        tag_name: "Impact",
        tag_color: "#EF4444",
        keywords: ["impact", "hit"],
        enabled: true,
        category: "Action & Combat",
        facet_slug: "category",
      },
    ];
    useSampleStore.setState({ autoTagRules: sampleRules });
    const rulesFirst = render(<TagRulesSubtab />);
    expect(screen.getAllByText("Impact").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTitle("Collapse All Rule Groups"));
    expect(
      localStorage.getItem(AUDIFY_STORAGE_KEYS.settingsRuleCollapsedCategories)
    ).toContain('"Action & Combat":true');
    rulesFirst.unmount();

    const rulesSecond = render(<TagRulesSubtab />);
    // Child rule row is hidden because Action & Combat group remained collapsed
    expect(screen.queryByText("2 kw")).toBeNull();
    rulesSecond.unmount();

    // 4. CollectionsTab: collapse sub-folders & sections -> persists across remount
    const colFirst = render(<CollectionsTab collectionsSubTab="list" />);
    fireEvent.click(screen.getByTitle("Collapse Sub-folders & Sections"));
    expect(
      localStorage.getItem(AUDIFY_STORAGE_KEYS.settingsColExpandedIds)
    ).toBe("[]");
    fireEvent.click(screen.getByTitle("Collapse Sub-folders & Sections"));
    expect(
      localStorage.getItem(AUDIFY_STORAGE_KEYS.settingsColSectionsOpen)
    ).toContain('"manual":false');
    colFirst.unmount();

    const colSecond = render(<CollectionsTab collectionsSubTab="list" />);
    expect(
      screen.getByRole("button", { name: "COLLECTIONS (1)" }).getAttribute("aria-expanded")
    ).toBe("false");
    colSecond.unmount();
  });

  it("supports pointer-based drag-and-drop in Settings Studios, renders floating pill, cancels on Escape, and enforces cycle/depth guards", async () => {
    const index = buildTaxonomyIndex(STUDIO_TAGS, STUDIO_FACETS);
    // Cycle / self / flat guards
    expect(canDropTaxonomyItem(1, "node:category:1", index, STUDIO_FACETS)).toBe(false);
    expect(canDropTaxonomyItem(1, "node:category:2", index, STUDIO_FACETS)).toBe(false);
    expect(canDropTaxonomyItem(40, "node:category:1", index, STUDIO_FACETS)).toBe(true);
    expect(canDropTaxonomyItem(40, "node:source:30", index, STUDIO_FACETS)).toBe(false);
    expect(canDropTaxonomyItem(2, "sec:category", index, STUDIO_FACETS)).toBe(true);
    expect(canDropTaxonomyItem(1, "sec:category", index, STUDIO_FACETS)).toBe(false);

    const origElementFromPoint = document.elementFromPoint;
    try {
      // 1. TagLibrarySubtab: drag Wood (40) onto Animals (node:category:1)
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "update_tag_taxonomy") return STUDIO_TAGS[3];
        if (cmd === "get_tags") return STUDIO_TAGS;
        if (cmd === "get_tag_facets") return STUDIO_FACETS;
        return [];
      });
      const lib = render(<TagLibrarySubtab />);
      const woodRow = screen.getByText("Wood").closest("div[class*='cursor-grab']")!;
      const animalsDropTarget = document.querySelector(
        '[data-studio-drop-key="node:category:1"]'
      )!;
      document.elementFromPoint = vi.fn(() => animalsDropTarget);

      fireEvent.mouseDown(woodRow, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 25, clientY: 25 });
      expect(screen.getByText("↳ Nest under Animals")).toBeTruthy();

      // Escape cancels without invoking IPC
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByText("↳ Nest under Animals")).toBeNull();
      expect(invokeMock).not.toHaveBeenCalledWith("update_tag_taxonomy", expect.anything());

      // Now perform full drag + drop
      fireEvent.mouseDown(woodRow, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 30, clientY: 30 });
      fireEvent.mouseUp(window, { clientX: 30, clientY: 30 });

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith(
          "update_tag_taxonomy",
          expect.objectContaining({
            tagId: 40,
            facetSlug: "category",
            parentId: 1,
          })
        );
      });
      lib.unmount();

      // 2. CollectionsTab: drag sub-collection Impacts (102) onto COLLECTIONS pill (promote to root)
      invokeMock.mockReset();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "reparent_collection") {
          return { ...STUDIO_COLLECTIONS[1], parent_id: null };
        }
        if (cmd === "get_collections") return STUDIO_COLLECTIONS;
        return [];
      });
      useSampleStore.setState({ collections: STUDIO_COLLECTIONS });
      const col = render(<CollectionsTab collectionsSubTab="list" />);
      const impactsRow = screen
        .getAllByText("Impacts")
        .map((el) => el.closest("div[class*='cursor-grab']"))
        .find(Boolean)!;
      const manualPill = document.querySelector('[data-studio-drop-key="pill:manual"]')!;
      document.elementFromPoint = vi.fn(() => manualPill);

      fireEvent.mouseDown(impactsRow, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 25, clientY: 25 });
      expect(screen.getByText("↳ Promote to Root")).toBeTruthy();
      fireEvent.mouseUp(window, { clientX: 25, clientY: 25 });

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("reparent_collection", {
          collectionId: 102,
          newParentId: null,
        });
      });
      col.unmount();
    } finally {
      document.elementFromPoint = origElementFromPoint;
    }
  });

  it("toggles multiple same-facet tags with AND/ANY chips, leaf-only drill-down cloud, stable sidebar titles, and AI domain routing", () => {
    // 1. Sidebar header shows stable total count without Hide-empty eye button & disables press shift
    const noop = vi.fn();
    const tagsView = render(
      <TagsSidebarTab dragHoverTarget={null} setDragHoverTarget={noop} />
    );
    expect(screen.getByText("TAGS (4)")).toBeTruthy();
    expect(screen.queryByTitle(/Hide empty/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /^CATEGORY \(2\)$/i }).getAttribute("data-no-press-shift")
    ).toBe("true");
    tagsView.unmount();

    // 2. SampleFilterToolbar: leaf-only + #Source prefix + no duplicates once selected
    const extraTags: Tag[] = [
      ...STUDIO_TAGS,
      { id: 3, name: "Mechanical", color: "#3B82F6", effective_color: "#3B82F6", sample_count: 5, rollup_count: 5, facet_id: 1, facet_slug: "category", parent_id: null, path: "/3/" },
      { id: 4, name: "Glass", color: "#14B8A6", effective_color: "#14B8A6", sample_count: 4, rollup_count: 4, facet_id: 1, facet_slug: "category", parent_id: null, path: "/4/" },
    ];
    const sample: SampleItem = {
      id: 901,
      library_id: 1,
      file_path: "F:/Audio/demo.wav",
      folder_path: "F:/Audio",
      file_name: "demo.wav",
      extension: "wav",
      duration_ms: 1200,
      sample_rate: 44100,
      channels: 2,
      bit_depth: 16,
      file_size: 10000,
      peaks_json: "[]",
      is_favorite: false,
      is_loop: false,
      genre: "",
      artist: "",
      album: "",
      year: "",
      tags: [
        { id: 3, name: "Mechanical", color: "#3B82F6" },
        { id: 4, name: "Glass", color: "#14B8A6" },
        { id: 30, name: "Pokemon", color: "#64748B" },
      ],
      created_at: "2026-11-24",
    };
    useSampleStore.setState({
      tags: extraTags,
      samples: [sample],
      allProfileSamples: [sample],
      selectedTagIds: [],
      tagMatchMode: "all",
    });
    const searchRef = React.createRef<HTMLInputElement>();
    const toolbar = render(
      <SampleFilterToolbar
        searchInputRef={searchRef}
        showSearchHelper={false}
        setShowSearchHelper={noop}
      />
    );
    // Parent container "Animals" is excluded from flat Quick Tag Cloud; leaf "Dog" & "#Pokemon" are shown
    expect(screen.queryByRole("button", { name: /^Animals/i })).toBeNull();
    expect(screen.getByRole("button", { name: /#.*Pokemon/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mechanical/i }));
    // Selected tag drops out of Quick Tag Cloud so it isn't duplicated with Active Filter chips below
    expect(screen.queryByRole("button", { name: /Mechanical/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Glass/i }));
    expect(useSampleStore.getState().selectedTagIds).toEqual([3, 4]);
    toolbar.unmount();

    // 3. ActiveTaxonomyChips: short labels + breadcrumb tooltip + ALL/ANY match mode toggle
    const onToggleMode = vi.fn();
    const chipsView = render(
      <ActiveTaxonomyChips
        tags={extraTags}
        tagFacets={STUDIO_FACETS}
        selectedTagIds={[2, 3]}
        excludedTagIds={[]}
        tagMatchMode="all"
        onToggleMatchMode={onToggleMode}
        onRemoveSelected={noop}
        onRemoveExcluded={noop}
      />
    );
    expect(screen.getByText("Dog")).toBeTruthy();
    expect(screen.queryByText("Animals ▸ Dog")).toBeNull();
    expect(screen.getByTitle(/CATEGORY: Animals ▸ Dog/i)).toBeTruthy();
    const matchBtn = screen.getByRole("button", { name: "ALL" });
    fireEvent.click(matchBtn);
    expect(onToggleMode).toHaveBeenCalledTimes(1);
    chipsView.unmount();

    // 4. renderGenreCell & renderTagsCell route genres-domain vs tags-domain AI suggestions with breadcrumb tooltips
    const index = buildTaxonomyIndex(extraTags, STUDIO_FACETS);
    const pendingAi = [
      {
        sample_id: 901,
        tag_name: "Electronic",
        confidence: 0.91,
        model_id: "yamnet-v1",
        status: "pending" as const,
      },
      {
        sample_id: 901,
        tag_name: "Dog",
        confidence: 0.87,
        model_id: "yamnet-v1",
        status: "pending" as const,
      },
    ];

    const genreCell = render(
      <>
        {renderGenreCell({
          sample,
          width: 190,
          selectedGenre: null,
          selectedTagSet: new Set(),
          isGenrePopoverOpen: false,
          genreColorMap: new Map(),
          taxonomyIndex: index,
          pendingAiTags: pendingAi,
          onOpenGenrePopover: noop,
        })}
      </>
    );
    expect(screen.getByText("Electronic")).toBeTruthy();
    expect(screen.queryByText("Dog")).toBeNull();
    genreCell.unmount();

    useSampleStore.setState({ selectedTagIds: [] });
    const tagsCell = render(
      <>
        {renderTagsCell({
          sample,
          width: 260,
          selectedTagSet: new Set(),
          taxonomyIndex: index,
          pendingAiTags: pendingAi,
          isTagPopoverOpen: false,
          onOpenTagPopover: noop,
          onSetHoverOverflowTags: noop,
        })}
      </>
    );
    expect(screen.getByText("Dog")).toBeTruthy();
    expect(screen.queryByText("Electronic")).toBeNull();
    expect(screen.getByTitle(/AI Suggestion \(87%\): Animals ▸ Dog/i)).toBeTruthy();

    // Plain clicking two row tag badges toggles both in selectedTagIds
    fireEvent.click(screen.getByText("Mechanical"));
    fireEvent.click(screen.getByText("Glass"));
    expect(useSampleStore.getState().selectedTagIds).toEqual([3, 4]);
    tagsCell.unmount();
  });
});
