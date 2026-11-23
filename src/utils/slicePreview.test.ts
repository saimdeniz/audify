import { describe, expect, it } from "vitest";
import type { SliceHistoryEntry } from "../types";
import { getVisibleSortedSlices, matchesSliceSourceFolder } from "./slicePreview";

function makeEntry(overrides: Partial<SliceHistoryEntry>): SliceHistoryEntry {
  return {
    id: 1,
    slice_path: "F:/Audify/user/slices/s1.wav",
    slice_name: "s1.wav",
    source_sample_id: 10,
    source_file_path: "D:/Sounds/SFX/Whoosh/hit_01.wav",
    source_file_name: "hit_01.wav",
    start_sec: 0,
    end_sec: 1,
    pitch_semitones: 0,
    micro_fade: false,
    duration_ms: 1000,
    is_favorite: false,
    peaks_json: "[]",
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    created_at: "2026-11-23T00:00:00Z",
    file_exists: true,
    ...overrides,
  };
}

describe("slicePreview folder filtering", () => {
  it("matches exact source folder and nested subfolders case-insensitively without sibling collision", () => {
    expect(
      matchesSliceSourceFolder("D:\\Sounds\\SFX\\Whoosh\\hit.wav", "d:/sounds/sfx")
    ).toBe(true);
    expect(
      matchesSliceSourceFolder("D:/Sounds/SFX/hit.wav", "D:/Sounds/SFX")
    ).toBe(true);
    expect(
      matchesSliceSourceFolder("D:/Sounds/SFX_Extra/hit.wav", "D:/Sounds/SFX")
    ).toBe(false);
  });

  it("filters visible slices by source folderFilter without losing search/sort", () => {
    const list = [
      makeEntry({ id: 1, source_file_path: "D:/Sounds/Ambience/rain.wav" }),
      makeEntry({ id: 2, source_file_path: "D:/Sounds/SFX/Whoosh/wind.wav" }),
      makeEntry({ id: 3, source_file_path: "D:/Sounds/SFX/Impact/boom.wav" }),
    ];
    const filtered = getVisibleSortedSlices(list, {
      searchQuery: "",
      folderFilter: "D:/Sounds/SFX",
      sliceHideMissing: false,
      sliceFavoriteOnly: false,
      slicePitchOnly: false,
      sliceSortKey: null,
      sliceSortDir: "asc",
    });
    expect(filtered.map((s) => s.id)).toEqual([2, 3]);
  });
});
