import { describe, expect, it } from "vitest";
import { LicenseGroup, SampleItem } from "../types";
import {
  applyClientFacetFilters,
  applySort,
  doesSampleMatchInitialView,
  filterBaseSamplesInMemory,
  reconcileSelectionAfterFilter,
  shouldPreserveDeckSelection,
} from "./filterEngine";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `C:/Audio/Folder/Sample_${id}.wav`,
    file_name: `Sample_${id}.wav`,
    folder_path: "C:/Audio/Folder",
    extension: "wav",
    file_size: 2048,
    duration_ms: 1500,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    is_loop: false,
    is_favorite: false,
    artist: "",
    album: "",
    year: "",
    genre: "",
    peaks_json: "[]",
    created_at: "2026-01-01",
    tags: [],
    ...overrides,
  };
}

describe("filterEngine in-memory filtering, sorting & selection reconciliation", () => {
  it("isolates folder prefix boundaries cleanly (SFX/Kick vs SFX/Kick_2) and enforces multi-tag AND logic", () => {
    const kick = makeSample(1, {
      file_name: "Kick_01.wav",
      folder_path: "C:\\SFX\\Kick",
      file_path: "C:\\SFX\\Kick\\Kick_01.wav",
      tags: [
        { id: 1, name: "Drum", color: "#F59E0B" },
        { id: 2, name: "Punchy", color: "#38BDF8" },
      ],
    });
    const kickSub = makeSample(2, {
      file_name: "Kick_Sub.wav",
      folder_path: "C:\\SFX\\Kick\\Layered",
      file_path: "C:\\SFX\\Kick\\Layered\\Kick_Sub.wav",
      tags: [{ id: 1, name: "Drum", color: "#F59E0B" }],
    });
    const kick2Sibling = makeSample(3, {
      file_name: "Kick_Alt.wav",
      folder_path: "C:\\SFX\\Kick_2",
      file_path: "C:\\SFX\\Kick_2\\Kick_Alt.wav",
      tags: [
        { id: 1, name: "Drum", color: "#F59E0B" },
        { id: 2, name: "Punchy", color: "#38BDF8" },
      ],
    });

    const resFolder = filterBaseSamplesInMemory(
      [kick, kickSub, kick2Sibling],
      "C:/SFX/Kick",
      false,
      false,
      [],
      [],
      null,
      null,
      [],
      false,
      []
    );
    expect(resFolder.map((s) => s.id)).toEqual([1, 2]);

    const resTagsAnd = filterBaseSamplesInMemory(
      [kick, kickSub, kick2Sibling],
      "C:/SFX/Kick",
      false,
      false,
      [],
      [1, 2],
      null,
      null,
      [],
      false,
      []
    );
    expect(resTagsAnd.map((s) => s.id)).toEqual([1]);
  });

  it("filters by genre, favorite, license group, bin, and preserves recentOnly playback order", () => {
    const groups: LicenseGroup[] = [
      {
        id: "lic-1",
        name: "Client Pack",
        color: "#10B981",
        folders: ["C:\\Licensed\\PackA"],
        template: "{file_name}",
        quoteMode: "auto",
      },
    ];
    const a = makeSample(10, {
      file_path: "C:\\Licensed\\PackA\\Pad.wav",
      folder_path: "C:\\Licensed\\PackA",
      genre: "Ambient",
      is_favorite: true,
    });
    const b = makeSample(20, {
      file_path: "C:\\Licensed\\PackB\\Drone.wav",
      folder_path: "C:\\Licensed\\PackB",
      genre: "Ambient",
      is_favorite: true,
    });
    const c = makeSample(30, {
      file_path: "C:\\Licensed\\PackA\\Lead.wav",
      folder_path: "C:\\Licensed\\PackA",
      genre: "Synthwave",
      is_favorite: true,
    });

    const licFiltered = filterBaseSamplesInMemory(
      [a, b, c],
      null,
      true,
      false,
      [],
      [],
      "ambient",
      "lic-1",
      groups,
      false,
      []
    );
    expect(licFiltered.map((s) => s.id)).toEqual([10]);

    const recentAndBin = filterBaseSamplesInMemory(
      [a, b, c],
      null,
      false,
      true,
      [30, 10, 20],
      [],
      null,
      null,
      [],
      true,
      [10, 30]
    );
    expect(recentAndBin.map((s) => s.id)).toEqual([30, 10]);
  });

  it("applies facet filters (loop/oneshot & sample rate) and sorts empty BPM/Key values last", () => {
    const s1 = makeSample(1, {
      file_name: "A_NoBpm.wav",
      is_loop: true,
      sample_rate: 48000,
      bpm: null,
      camelot_key: "",
    });
    const s2 = makeSample(2, {
      file_name: "B_Fast.wav",
      is_loop: true,
      sample_rate: 48000,
      bpm: 140,
      camelot_key: "10A",
    });
    const s3 = makeSample(3, {
      file_name: "C_Mid.wav",
      is_loop: true,
      sample_rate: 48000,
      bpm: 95,
      camelot_key: "2B",
    });
    const oneshot = makeSample(4, {
      file_name: "D_Hit.wav",
      is_loop: false,
      sample_rate: 44100,
      bpm: 120,
    });

    const filteredLoops = applyClientFacetFilters(
      [s1, s2, s3, oneshot],
      "loop",
      48000,
      "bpm",
      "asc"
    );
    expect(filteredLoops.map((s) => s.id)).toEqual([3, 2, 1]);

    const keyDesc = applySort([s1, s2, s3], "key", "desc");
    expect(keyDesc.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it("prunes invisible ghost IDs and recomputes anchor index cleanly on reconciliation", () => {
    const s1 = makeSample(1);
    const s2 = makeSample(2);
    const s3 = makeSample(3);

    // Refine inside view: preserve visible multi-select [2, 3], update primary if current (1) left view
    const refined = reconcileSelectionAfterFilter([s2, s3], s1, [1, 2, 3], true);
    expect(refined.nextSelected?.id).toBe(2);
    expect(refined.nextSelectedIds).toEqual([2, 3]);
    expect(refined.nextSelectedIndex).toBe(0);

    // Navigation view switch (preserveMultiSelect: false): collapse multi-select to primary only
    const switched = reconcileSelectionAfterFilter([s2, s3], s3, [2, 3], false);
    expect(switched.nextSelected?.id).toBe(3);
    expect(switched.nextSelectedIds).toEqual([3]);
    expect(switched.nextSelectedIndex).toBe(1);

    // Empty result clears everything safely when idle
    const empty = reconcileSelectionAfterFilter([], s3, [2, 3], true);
    expect(empty.nextSelected).toBeNull();
    expect(empty.nextSelectedIds).toEqual([]);
    expect(empty.nextSelectedIndex).toBeNull();
  });

  it("preserves active playing or Layers virtual deck selection across off-view tab switches", () => {
    const s1 = makeSample(1);
    const s2 = makeSample(2);
    const s3 = makeSample(3);
    const layerDraft = makeSample(-999_999, {
      file_name: "Layer_001.wav",
      file_path: "layer://draft",
    });

    // Playing track absent from new tab stays loaded on deck; off-view row IDs are cleared
    const playingTabSwitch = reconcileSelectionAfterFilter(
      [s2, s3],
      s1,
      [1],
      false,
      true
    );
    expect(playingTabSwitch.nextSelected?.id).toBe(1);
    expect(playingTabSwitch.nextSelectedIds).toEqual([]);
    expect(playingTabSwitch.nextSelectedIndex).toBeNull();

    // Playing track stays intact even when switching to an empty folder/tab
    const playingEmptyTab = reconcileSelectionAfterFilter([], s1, [1], false, true);
    expect(playingEmptyTab.nextSelected?.id).toBe(1);
    expect(playingEmptyTab.nextSelectedIds).toEqual([]);
    expect(playingEmptyTab.nextSelectedIndex).toBeNull();

    // Refining inside view while playing keeps visible multi-select without hijacking primary deck
    const playingRefine = reconcileSelectionAfterFilter(
      [s2, s3],
      s1,
      [1, 2, 3],
      true,
      true
    );
    expect(playingRefine.nextSelected?.id).toBe(1);
    expect(playingRefine.nextSelectedIds).toEqual([2, 3]);
    expect(playingRefine.nextSelectedIndex).toBeNull();

    // Helper rules: preserves any playing track OR virtual negative-ID sample inside Layers
    expect(
      shouldPreserveDeckSelection({
        isPlaying: true,
        selectedSample: s1,
        layersFilterActive: false,
      })
    ).toBe(true);
    expect(
      shouldPreserveDeckSelection({
        isPlaying: false,
        selectedSample: s1,
        layersFilterActive: false,
      })
    ).toBe(false);
    expect(
      shouldPreserveDeckSelection({
        isPlaying: false,
        selectedSample: layerDraft,
        layersFilterActive: true,
      })
    ).toBe(true);
    expect(
      shouldPreserveDeckSelection({
        isPlaying: false,
        selectedSample: layerDraft,
        layersFilterActive: false,
      })
    ).toBe(false);
  });

  it("sorts filenames with natural numeric order, case insensitivity, and non-ASCII fallback", () => {
    const a10 = makeSample(1, { file_name: "Kick_10.wav" });
    const a2 = makeSample(2, { file_name: "kick_2.wav" });
    const beta = makeSample(3, { file_name: "Beta.wav" });
    const turkish = makeSample(4, { file_name: "Çan_01.wav" });

    const sorted = applySort([a10, beta, a2, turkish], "name", "asc");
    expect(sorted.map((s) => s.id)).toEqual([3, 4, 2, 1]);
  });

  it("validates whether a saved startup sample matches active Stage 1 filters", () => {
    const nonFav = makeSample(1, { is_favorite: false, library_id: 1 });
    const fav = makeSample(2, { is_favorite: true, library_id: 1 });
    const trashed = makeSample(3, { is_favorite: true, is_trashed: true, library_id: 1 });
    const hiddenLib = makeSample(4, { is_favorite: true, library_id: 99 });

    const baseFilter = {
      visibleLibraryIds: new Set([1]),
      folderFilter: null,
      favoriteOnly: true,
      recentOnly: false,
      recentSampleIds: [],
      binFilterActive: false,
      binSampleIds: [],
      collectionId: null,
      licenseGroup: null,
      typeFilter: "all" as const,
      srFilter: null,
    };

    expect(doesSampleMatchInitialView(nonFav, baseFilter)).toBe(false);
    expect(doesSampleMatchInitialView(fav, baseFilter)).toBe(true);
    expect(doesSampleMatchInitialView(trashed, baseFilter)).toBe(false);
    expect(doesSampleMatchInitialView(hiddenLib, baseFilter)).toBe(false);
  });

  it("sorts dateModified and dateAdded while keeping missing timestamps last", () => {
    const oldest = makeSample(1, {
      file_name: "Alpha.wav",
      created_at: "2026-01-01 10:00:00",
      file_modified_at: 1000,
    });
    const newest = makeSample(2, {
      file_name: "Zulu.wav",
      created_at: "2026-11-15 10:00:00",
      file_modified_at: 3000,
    });
    const missingMtime = makeSample(3, {
      file_name: "Beta.wav",
      created_at: "2026-06-01 10:00:00",
      file_modified_at: null,
    });

    expect(
      applySort([oldest, missingMtime, newest], "dateModified", "desc").map(
        (s) => s.id
      )
    ).toEqual([2, 1, 3]);
    expect(
      applySort([newest, missingMtime, oldest], "dateModified", "asc").map(
        (s) => s.id
      )
    ).toEqual([1, 2, 3]);
    expect(
      applySort([oldest, missingMtime, newest], "dateAdded", "desc").map(
        (s) => s.id
      )
    ).toEqual([2, 3, 1]);
  });
});
