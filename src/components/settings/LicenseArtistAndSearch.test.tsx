// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../constants/appInfo";
import type { ArtistStat, LicenseGroup, SampleItem } from "../../types";
import {
  generateBatchAttributionCredits,
  isSampleInLicenseGroup,
  matchSampleToLicenseGroup,
} from "../../utils/licenseFormat";
import { toggleArtistSearchFilter } from "../../utils/search/artistSearchHelpers";
import { getSearchAutocompleteSuggestions } from "../../utils/search/searchAutocomplete";
import { executeSmartSearch } from "../../utils/smartSearch";
import { LicenseLinkedArtistsSection } from "./LicenseLinkedArtistsSection";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { SampleTableRow } from "../sample-table/SampleTableRow";
import { DEFAULT_COL_WIDTHS, DEFAULT_COLUMN_ORDER, DEFAULT_VISIBLE_COLS } from "../sample-table/tableLayout";

function makeSample(overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id: 1,
    library_id: 1,
    file_path: "F:/Music/Random/Little Susie.mp3",
    file_name: "Little Susie.mp3",
    folder_path: "F:/Music/Random",
    extension: "mp3",
    duration_ms: 164000,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 16,
    file_size: 4000000,
    is_favorite: false,
    is_loop: false,
    genre: "Orchestral",
    artist: "Hampus Naeselius",
    album: "",
    year: "",
    peaks_json: "[]",
    created_at: "2026-11-26",
    tags: [],
    ...overrides,
  };
}

describe("License artist matching, clickable Artist column, and artist: autocomplete", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reports APP_VERSION as 1.0.4", () => {
    expect(APP_VERSION).toBe("1.0.4");
  });

  it("matches licenses by folder first and falls back to exact case-insensitive scanned artist metadata", () => {
    const folderGroup: LicenseGroup = {
      id: "lic-folder",
      name: "Scott Buckley",
      folders: ["F:/Music/Scott Buckley"],
      artists: [],
      template: '"{title}" by {artist}',
      quoteMode: "auto",
    };
    const artistGroup: LicenseGroup = {
      id: "lic-artist",
      name: "Kevin MacLeod",
      folders: ["F:/Music/Kevin MacLeod"],
      artists: ["Kevin MacLeod", "KevinMacLeod"],
      template: '"{title}" by {artist} (CC-BY)',
      quoteMode: "auto",
    };

    // 1. Folder priority wins even if artist metadata belongs to another group
    expect(
      matchSampleToLicenseGroup(
        "F:/Music/Scott Buckley/Collab.mp3",
        [artistGroup, folderGroup],
        "Kevin MacLeod"
      )?.id
    ).toBe("lic-folder");

    // 2. Scattered track in random folder matches exact case-insensitive artist metadata
    expect(
      isSampleInLicenseGroup(
        "F:/Music/Unsorted/Sneaky.mp3",
        artistGroup,
        "kevin macleod"
      )
    ).toBe(true);
    expect(
      isSampleInLicenseGroup(
        "F:/Music/Unsorted/AltSpell.mp3",
        artistGroup,
        "KevinMacLeod"
      )
    ).toBe(true);

    // 3. Partial substring must NOT false-match
    expect(
      isSampleInLicenseGroup(
        "F:/Music/Unsorted/Other.mp3",
        artistGroup,
        "Kevin"
      )
    ).toBe(false);

    // 4. Batch attribution combines folder-matched and artist-matched tracks cleanly
    const s1 = makeSample({
      id: 1,
      file_path: "F:/Music/Kevin MacLeod/Cipher.wav",
      file_name: "Cipher.wav",
      artist: "",
    });
    const s2 = makeSample({
      id: 2,
      file_path: "F:/Music/Random/Monkeys Spinning.mp3",
      file_name: "Monkeys Spinning.mp3",
      artist: "KevinMacLeod",
    });
    const res = generateBatchAttributionCredits([s1, s2], [folderGroup, artistGroup]);
    expect(res.matchedSampleCount).toBe(2);
    expect(res.artistCount).toBe(1);
    expect(res.text).toBe('"Cipher", "Monkeys Spinning" by Kevin MacLeod (CC-BY)');
  });

  it("toggles artist: search tokens while preserving existing search terms and supports artist: autocomplete", () => {
    expect(toggleArtistSearchFilter("", "Hampus Naeselius")).toBe(
      'artist:"Hampus Naeselius"'
    );
    expect(
      toggleArtistSearchFilter("Orchestral bpm:120", "Hampus Naeselius")
    ).toBe('Orchestral bpm:120 artist:"Hampus Naeselius"');
    expect(
      toggleArtistSearchFilter(
        'Orchestral bpm:120 artist:"Hampus Naeselius"',
        "Hampus Naeselius"
      )
    ).toBe("Orchestral bpm:120");
    expect(
      toggleArtistSearchFilter(
        'Orchestral artist:"Hampus Naeselius"',
        "Ludvig Moulin"
      )
    ).toBe('Orchestral artist:"Ludvig Moulin"');

    const stats: ArtistStat[] = [
      { artist: "Hampus Naeselius", count: 42 },
      { artist: "Jon Björk", count: 18 },
      { artist: "Ludvig Moulin", count: 9 },
    ];
    const ctx = getSearchAutocompleteSuggestions(
      "Orchestral artist:ham",
      21,
      [],
      [],
      [],
      [],
      stats
    );
    expect(ctx?.headerLabel).toBe("ARTISTS (artist:)");
    expect(ctx?.items[0]?.insertToken).toBe('artist:"Hampus Naeselius"');
    expect(ctx?.items[0]?.meta).toBe("42");

    const negCtx = getSearchAutocompleteSuggestions(
      "-artist:bjork",
      13,
      [],
      [],
      [],
      [],
      stats
    );
    expect(negCtx?.headerLabel).toBe("EXCLUDE ARTIST (-artist:)");
    expect(negCtx?.items[0]?.insertToken).toBe('-artist:"Jon Björk"');

    // End-to-end smart search with generated quoted token
    const samples = [
      makeSample({ id: 1, artist: "Hampus Naeselius", genre: "Orchestral" }),
      makeSample({ id: 2, artist: "Ludvig Moulin", genre: "Orchestral" }),
    ];
    const filtered = executeSmartSearch(
      samples,
      'Orchestral artist:"Hampus Naeselius"',
      false
    );
    expect(filtered.map((s) => s.id)).toEqual([1]);
  });

  it("picks and removes scanned artists inside LicenseLinkedArtistsSection", async () => {
    const updateSpy = vi.fn(async () => {});
    const group: LicenseGroup = {
      id: "lic-1",
      name: "Kevin MacLeod",
      folders: [],
      artists: ["Kevin MacLeod"],
      template: '"{title}" by {artist}',
      quoteMode: "auto",
    };
    const stats: ArtistStat[] = [
      { artist: "Kevin MacLeod", count: 1413 },
      { artist: "KevinMacLeod", count: 12 },
      { artist: "Scott Buckley", count: 259 },
    ];

    render(
      <LicenseLinkedArtistsSection
        activeLicenseGroup={group}
        artistStats={stats}
        updateLicenseGroup={updateSpy}
      />
    );

    const input = screen.getByPlaceholderText(/Pick scanned artist metadata/i);
    fireEvent.focus(input);

    // Already linked "Kevin MacLeod" is omitted from picker; "KevinMacLeod" is selectable
    const option = screen.getByRole("option", { name: /KevinMacLeod/i });
    fireEvent.mouseDown(option);

    expect(updateSpy).toHaveBeenCalledWith("lic-1", {
      artists: ["Kevin MacLeod", "KevinMacLeod"],
    });

    const removeBtn = screen.getByTitle("Unlink artist metadata");
    fireEvent.click(removeBtn);
    expect(updateSpy).toHaveBeenCalledWith("lic-1", { artists: [] });
  });

  it("filters by clicking the Artist text button in SampleTableRow without triggering row click", () => {
    const setSearchQuery = vi.fn();
    useSampleStore.setState({
      searchQuery: "Orchestral",
      setSearchQuery,
    });
    const onRowClick = vi.fn();

    render(
      <SampleTableRow
        sample={makeSample({ artist: "Hampus Naeselius" })}
        rowIndex={0}
        startOffsetPx={0}
        totalTableWidth={900}
        isSimilarityMode={false}
        matchScore={null}
        isSimilarityAnchor={false}
        isPrimarySelected={false}
        isRowSelected={false}
        isTagPopoverOpen={false}
        isGenrePopoverOpen={false}
        columnOrder={DEFAULT_COLUMN_ORDER}
        visibleCols={{ ...DEFAULT_VISIBLE_COLS, artist: true }}
        colWidths={DEFAULT_COL_WIDTHS}
        selectedCollectionId={null}
        selectedGenre={null}
        selectedTagSet={new Set()}
        genreColorMap={new Map()}
        waveformDisplay={{
          accentColor: "#F59E0B",
          themeMode: "dark",
          enableMica: false,
          waveformSensitivity: "logarithmic",
          waveformStyle: "solid_baseline",
        }}
        onRowClick={onRowClick}
        onRowMouseDown={vi.fn()}
        onRowContextMenu={vi.fn()}
        onOpenTagPopover={vi.fn()}
        onOpenGenrePopover={vi.fn()}
        onSetHoverOverflowTags={vi.fn()}
      />
    );

    const artistBtn = screen.getByRole("button", { name: "Hampus Naeselius" });
    expect(artistBtn.getAttribute("data-tag-badge")).toBe("true");
    fireEvent.click(artistBtn);

    expect(onRowClick).not.toHaveBeenCalled();
    expect(setSearchQuery).toHaveBeenCalledWith(
      'Orchestral artist:"Hampus Naeselius"'
    );
  });
});
