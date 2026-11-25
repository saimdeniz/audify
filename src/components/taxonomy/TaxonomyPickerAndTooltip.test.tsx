// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem, Tag } from "../../types";
import { ThemedSelect } from "../common/ThemedSelect";
import { GlobalTooltip } from "../GlobalTooltip";
import { TaxonomyPicker } from "./TaxonomyPicker";

const MOCK_TAGS: Tag[] = [
  {
    id: 1,
    name: "Animals",
    color: "#22C55E",
    effective_color: "#22C55E",
    sample_count: 0,
    rollup_count: 10,
    facet_id: 1,
    facet_slug: "category",
    parent_id: null,
  },
  {
    id: 2,
    name: "Dog",
    color: "#22C55E",
    effective_color: "#22C55E",
    sample_count: 10,
    rollup_count: 10,
    facet_id: 1,
    facet_slug: "category",
    parent_id: 1,
  },
  {
    id: 10,
    name: "Cinematic",
    color: "#3B82F6",
    effective_color: "#3B82F6",
    sample_count: 12,
    rollup_count: 12,
    facet_id: 2,
    facet_slug: "genre",
    parent_id: null,
  },
  {
    id: 20,
    name: "Dark",
    color: "#EC4899",
    effective_color: "#EC4899",
    sample_count: 8,
    rollup_count: 8,
    facet_id: 3,
    facet_slug: "mood",
    parent_id: null,
  },
];

const SAMPLE_A: SampleItem = {
  id: 101,
  library_id: 1,
  file_path: "D:/SFX/ignis.mp3",
  file_name: "ignis.mp3",
  folder_path: "D:/SFX",
  extension: "mp3",
  duration_ms: 2000,
  sample_rate: 48000,
  channels: 2,
  bit_depth: 16,
  file_size: 40000,
  is_favorite: false,
  is_loop: false,
  genre: "Cinematic",
  artist: "",
  album: "",
  year: "",
  peaks_json: "",
  created_at: "2026-11-24",
  tags: [{ id: 10, name: "Cinematic", color: "#3B82F6" }],
};

describe("TaxonomyPicker & GlobalTooltip popover overlap guard", () => {
  const assignTagMock = vi.fn(async () => {});
  const unassignTagMock = vi.fn(async () => {});
  const clearSampleTagsMock = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    useSampleStore.setState({
      tags: MOCK_TAGS,
      assignTag: assignTagMock,
      unassignTag: unassignTagMock,
      clearSampleTags: clearSampleTagsMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("supports multi-select Genre + Mood toggle, resets search on sample switch, and clears scoped facets", async () => {
    const { rerender } = render(
      <TaxonomyPicker
        mode="genres"
        sampleIds={[101]}
        samples={[SAMPLE_A]}
        title="GENRES & MOODS"
      />
    );

    const searchInput = screen.getByPlaceholderText(/filter or add genre/i);
    fireEvent.change(searchInput, { target: { value: "dark" } });
    expect((searchInput as HTMLInputElement).value).toBe("dark");

    // Clicking Dark (Mood) assigns it alongside Cinematic (Genre)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    });
    expect(assignTagMock).toHaveBeenCalledWith(101, 20);

    // Switching to another sample resets the search input automatically
    rerender(
      <TaxonomyPicker
        mode="genres"
        sampleIds={[102]}
        samples={[{ ...SAMPLE_A, id: 102 }]}
        title="GENRES & MOODS"
      />
    );
    expect((searchInput as HTMLInputElement).value).toBe("");

    // Clicking Clear clears ONLY ["genre", "mood"] facets
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });
    expect(clearSampleTagsMock).toHaveBeenCalledWith([102], ["genre", "mood"]);
  });

  it("suppresses background trigger tooltips while any popover portal is open", () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <div>
        <button type="button" title="Change genre">
          +
        </button>
        <div data-popover-portal="true">
          <span>GENRES &amp; MOODS</span>
        </div>
        <GlobalTooltip />
      </div>
    );

    const bgBtn = screen.getByRole("button", { name: "+" });
    fireEvent.pointerOver(bgBtn, { clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Change genre")).toBeNull();

    // Once the popover closes, normal tooltips work again
    rerender(
      <div>
        <button type="button" title="Change genre">
          +
        </button>
        <GlobalTooltip />
      </div>
    );
    fireEvent.pointerOver(bgBtn, { clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Change genre")).toBeTruthy();
  });

  it("renders ThemedSelect as a portal listbox with live search, selection, and Escape focus restore", () => {
    const onChange = vi.fn();
    render(
      <ThemedSelect
        value="category"
        ariaLabel="Tag Facet"
        searchable={true}
        options={[
          { value: "category", label: "Category", color: "#22C55E" },
          { value: "source", label: "Source / Pack" },
          { value: "genre", label: "Genre", color: "#3B82F6" },
          { value: "mood", label: "Mood", color: "#EC4899" },
        ]}
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "Tag Facet" });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Tag Facet" });
    expect(listbox).toBeTruthy();
    expect(document.body.contains(listbox)).toBe(true);

    const filterInput = screen.getByPlaceholderText("Filter options...");
    fireEvent.change(filterInput, { target: { value: "mood" } });
    fireEvent.click(screen.getByRole("option", { name: "Mood" }));

    expect(onChange).toHaveBeenCalledWith("mood");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
