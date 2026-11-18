// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Profile, SampleItem } from "../types";

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

import * as storageHelpers from "./storageHelpers";
import { useSampleStore } from "./useSampleStore";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/FolderA/Sample_${id}.wav`,
    file_name: `Sample_${id}.wav`,
    folder_path: "D:/SFX/FolderA",
    extension: "wav",
    file_size: 4096,
    duration_ms: 2000,
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

describe("useSampleStore architecture & race guards", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useSampleStore.setState({
      profiles: [],
      activeProfile: null,
      allProfileSamples: [],
      rawSamples: [],
      samples: [],
      collections: [],
      tags: [],
      genres: [],
      searchQuery: "",
      folderFilter: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      binSampleIds: [],
      selectedTagIds: [],
      selectedGenre: null,
      typeFilter: "all",
      srFilter: null,
      sortKey: null,
      sortDir: "asc",
      selectedSample: null,
      selectedSampleIds: [],
      lastSelectedIndex: null,
      localBackups: [],
    });
  });

  it("discards stale async Collection query when user immediately clicks All Files (unified query epoch)", async () => {
    const allItems = [
      makeSample(1, { folder_path: "D:/SFX/FolderA" }),
      makeSample(2, { folder_path: "D:/SFX/FolderB" }),
      makeSample(3, { folder_path: "D:/SFX/FolderB" }),
    ];
    useSampleStore.setState({
      allProfileSamples: allItems,
      rawSamples: allItems,
      samples: allItems,
    });

    let resolveCollectionQuery!: (items: SampleItem[]) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "query_samples") {
        return new Promise<SampleItem[]>((resolve) => {
          resolveCollectionQuery = resolve;
        });
      }
      return Promise.resolve([]);
    });

    // 1. User clicks Collection #99 -> starts slow async SQLite query
    useSampleStore.getState().setCollectionFilter(99);

    // 2. Before SQLite finishes, user clicks "All Files" (folderFilter: null) -> instant in-memory filter
    useSampleStore.getState().setFolderFilter(null);
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1, 2, 3]);

    // 3. Stale Collection #99 query finally resolves with only [makeSample(1)]
    resolveCollectionQuery([allItems[0]]);
    await Promise.resolve();
    await Promise.resolve();

    // Must NOT overwrite All Files view!
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("eliminates Ghost Multi-Selection when switching folders and prunes invisible selections on search", () => {
    const items = [
      makeSample(10, {
        file_name: "Kick_Heavy.wav",
        folder_path: "D:/SFX/Drums",
        file_path: "D:/SFX/Drums/Kick_Heavy.wav",
      }),
      makeSample(11, {
        file_name: "Snare_Tight.wav",
        folder_path: "D:/SFX/Drums",
        file_path: "D:/SFX/Drums/Snare_Tight.wav",
      }),
      makeSample(20, {
        file_name: "Whoosh_Fast.wav",
        folder_path: "D:/SFX/Whooshes",
        file_path: "D:/SFX/Whooshes/Whoosh_Fast.wav",
      }),
    ];
    useSampleStore.setState({
      allProfileSamples: items,
      rawSamples: items,
      samples: items,
      selectedSample: items[0],
      selectedSampleIds: [10, 11],
      lastSelectedIndex: 0,
    });

    // Refine search within view -> Snare_Tight (11) is hidden, so selectedSampleIds must prune to [10]
    useSampleStore.getState().setSearchQuery("");
    useSampleStore.setState({ selectedSampleIds: [10, 11] });
    useSampleStore.getState().setTypeFilter("oneshot");
    expect(useSampleStore.getState().selectedSampleIds).toEqual([10, 11]);

    // Switch folder to D:/SFX/Whooshes -> Ghost IDs [10, 11] from Drums MUST be cleared!
    useSampleStore.getState().setFolderFilter("D:/SFX/Whooshes");
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([20]);
    expect(useSampleStore.getState().selectedSampleIds).toEqual([20]);
    expect(useSampleStore.getState().lastSelectedIndex).toBe(0);
  });

  it("recomputes lastSelectedIndex after cycleSort so Shift+Click range selection stays accurate", () => {
    const items = [
      makeSample(1, { file_name: "C_Third.wav" }),
      makeSample(2, { file_name: "A_First.wav" }),
      makeSample(3, { file_name: "B_Second.wav" }),
    ];
    useSampleStore.setState({
      allProfileSamples: items,
      rawSamples: items,
      samples: items,
      selectedSample: items[0], // C_Third at index 0 before sort
      selectedSampleIds: [1],
      lastSelectedIndex: 0,
    });

    useSampleStore.getState().cycleSort("name"); // asc -> A_First (0), B_Second (1), C_Third (2)
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([2, 3, 1]);
    expect(useSampleStore.getState().lastSelectedIndex).toBe(2);
  });

  it("isolates binSampleIds and intentionally empty [] rules/templates across profiles without wiping localBackups", async () => {
    const profileA: Profile = {
      id: 1,
      name: "Studio A",
      color: "#F59E0B",
      is_active: true,
      created_at: "2026-01-01",
      settings_json: JSON.stringify({
        binSampleIds: [101, 102],
        autoTagRules: [],
        collectionTemplates: [],
      }),
    };
    const profileB: Profile = {
      id: 2,
      name: "Studio B",
      color: "#3B82F6",
      is_active: false,
      created_at: "2026-01-02",
      settings_json: JSON.stringify({
        binSampleIds: [205],
        autoTagRules: [],
        collectionTemplates: [],
      }),
    };

    useSampleStore.setState({
      profiles: [profileA, profileB],
      activeProfile: profileA,
      binSampleIds: [101, 102],
      localBackups: [
        {
          file_name: "snap.json",
          file_path: "C:/backups/snap.json",
          profile_name: "Studio A",
          created_at: "2026-01-01",
          timestamp_ms: 1000,
          file_size: 512,
          is_auto: false,
        },
      ],
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "switch_profile") {
        return Promise.resolve({ ...profileB, is_active: true });
      }
      if (cmd === "get_profiles") return Promise.resolve([profileA, { ...profileB, is_active: true }]);
      if (cmd === "get_libraries") return Promise.resolve([]);
      if (cmd === "get_tags") return Promise.resolve([]);
      if (cmd === "get_genres") return Promise.resolve([]);
      if (cmd === "get_collections") return Promise.resolve([]);
      if (cmd === "get_folder_tree_stats") return Promise.resolve([]);
      if (cmd === "query_samples") return Promise.resolve([makeSample(205)]);
      if (cmd === "update_profile") return Promise.resolve({ ...profileB, is_active: true });
      return Promise.resolve(null);
    });

    await useSampleStore.getState().switchProfile(2);

    // Profile B has its own bin [205] and keeps intentionally empty [] autoTagRules & collectionTemplates!
    expect(useSampleStore.getState().binSampleIds).toEqual([205]);
    expect(useSampleStore.getState().autoTagRules).toEqual([]);
    expect(useSampleStore.getState().collectionTemplates).toEqual([]);

    // Resetting auto-tag rules must NOT wipe localBackups!
    await useSampleStore.getState().resetAutoTagRules();
    expect(useSampleStore.getState().localBackups.length).toBe(1);
  });

  it("resets selectedCollectionId when parent collection of active child sub-folder is deleted", async () => {
    useSampleStore.setState({
      collections: [
        {
          id: 10,
          name: "Parent Project",
          color: "",
          icon: "folder",
          parent_id: null,
          rule_path: null,
          sample_count: 5,
          created_at: "",
        },
        {
          id: 11,
          name: "Child SFX",
          color: "",
          icon: "folder",
          parent_id: 10,
          rule_path: null,
          sample_count: 5,
          created_at: "",
        },
      ],
      selectedCollectionId: 11,
      allProfileSamples: [makeSample(1)],
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "delete_collection") return Promise.resolve(null);
      if (cmd === "get_profiles") return Promise.resolve([]);
      if (cmd === "get_libraries") return Promise.resolve([]);
      if (cmd === "get_tags") return Promise.resolve([]);
      if (cmd === "get_genres") return Promise.resolve([]);
      if (cmd === "get_collections") return Promise.resolve([]);
      if (cmd === "get_folder_tree_stats") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    await useSampleStore.getState().deleteCollection(10);
    expect(useSampleStore.getState().selectedCollectionId).toBeNull();
  });

  it("defaults optional audio processing toggles to false and clamps varispeed pitch to [-24, 24]", async () => {
    const state = useSampleStore.getState();
    expect(state.sliceMicroFade).toBe(false);
    expect(state.normalizePreview).toBe(false);
    expect(state.autoAnalyzeBpmKey).toBe(false);
    expect(state.pitchSemitones).toBe(0);

    state.setPitchSemitones(18);
    expect(useSampleStore.getState().pitchSemitones).toBe(18);
    state.setPitchSemitones(36);
    expect(useSampleStore.getState().pitchSemitones).toBe(24);
    state.setPitchSemitones(-30);
    expect(useSampleStore.getState().pitchSemitones).toBe(-24);
    state.setPitchSemitones(0);

    const s1 = makeSample(1, { bpm: null, musical_key: "", camelot_key: "" });
    useSampleStore.setState({
      allProfileSamples: [s1],
      rawSamples: [s1],
      samples: [s1],
      selectedSample: s1,
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "set_sample_bpm_key") {
        return Promise.resolve([
          { sample_id: 1, bpm: 128, musical_key: "Am", camelot_key: "8A" },
        ]);
      }
      return Promise.resolve(null);
    });

    await useSampleStore
      .getState()
      .setSampleBpmKey([1], { bpm: 128, musicalKey: "Am" });
    expect(useSampleStore.getState().samples[0].bpm).toBe(128);
    expect(useSampleStore.getState().samples[0].musical_key).toBe("Am");
    expect(useSampleStore.getState().samples[0].camelot_key).toBe("8A");
  });

  it("applies external MainFilterRequest cleanly without toggling active tag/genre off", () => {
    const tagUi = { id: 9, name: "UI", color: "#38BDF8", sample_count: 1 };
    const samples = [
      makeSample(1, { tags: [tagUi], genre: "Ambient" }),
      makeSample(2, { tags: [], genre: "Rock" }),
    ];
    useSampleStore.setState({
      allProfileSamples: samples,
      rawSamples: samples,
      samples,
      selectedTagIds: [9],
      trashFilterActive: true,
      binFilterActive: true,
      folderFilter: "D:/SFX/FolderA",
      favoriteOnly: true,
    });

    // Re-applying the already active tag must NOT toggle it off, and must clear Trash/Bin/Folder/Favorite
    useSampleStore.getState().applyMainFilterRequest({ kind: "tag", id: 9, label: "UI" });
    let state = useSampleStore.getState();
    expect(state.selectedTagIds).toEqual([9]);
    expect(state.trashFilterActive).toBe(false);
    expect(state.binFilterActive).toBe(false);
    expect(state.folderFilter).toBeNull();
    expect(state.favoriteOnly).toBe(false);
    expect(state.samples.map((s) => s.id)).toEqual([1]);

    // Switching to genre is non-toggling even if invoked twice
    useSampleStore.getState().applyMainFilterRequest({ kind: "genre", name: "Rock" });
    useSampleStore.getState().applyMainFilterRequest({ kind: "genre", name: "Rock" });
    state = useSampleStore.getState();
    expect(state.selectedGenre).toBe("Rock");
    expect(state.selectedTagIds).toEqual([]);
    expect(state.samples.map((s) => s.id)).toEqual([2]);

    // Switching to trash sets trashFilterActive without disturbing unrelated state
    invokeMock.mockResolvedValue([]);
    useSampleStore.getState().applyMainFilterRequest({ kind: "trash" });
    state = useSampleStore.getState();
    expect(state.trashFilterActive).toBe(true);
    expect(state.selectedGenre).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith(
      "query_samples",
      expect.objectContaining({ trashedOnly: true })
    );
  });

  it("updates category scope paths, renames categories, and marks autoTagRulesDirty", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "Default",
      color: "#0EA5E9",
      settings_json: "{}",
      is_active: true,
      created_at: 0,
    });
    useSampleStore.setState({
      activeProfile: {
        id: 1,
        name: "Default",
        color: "#0EA5E9",
        settings_json: "{}",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      libraries: [
        {
          id: 1,
          name: "AudioLib",
          path: "C:/AudioLib",
          last_scanned_at: "2026-01-01T00:00:00Z",
          sample_count: 10,
          is_global: true,
          is_read_only: false,
        },
      ],
      autoTagCategories: [
        { name: "SFX", include_paths: [], exclude_paths: [] },
      ],
      autoTagRules: [
        {
          id: "r1",
          tag_name: "Whoosh",
          tag_color: "#F59E0B",
          keywords: ["whoosh"],
          enabled: true,
          category: "SFX",
        },
      ],
      autoTagRulesDirty: false,
    });

    await useSampleStore
      .getState()
      .setAutoTagCategoryPaths(
        "SFX",
        ["C:/AudioLib/SFX"],
        ["C:/AudioLib/SFX/Raw"]
      );

    let state = useSampleStore.getState();
    expect(state.autoTagRulesDirty).toBe(true);
    expect(state.autoTagCategories[0]).toEqual(
      expect.objectContaining({
        name: "SFX",
        include_paths: ["C:/AudioLib/SFX"],
        exclude_paths: ["C:/AudioLib/SFX/Raw"],
        rel_include_paths: ["SFX"],
        rel_exclude_paths: ["SFX/Raw"],
      })
    );

    await useSampleStore.getState().renameAutoTagCategory("SFX", "FoleyFX");
    state = useSampleStore.getState();
    expect(state.autoTagCategories[0].name).toBe("FoleyFX");
    expect(state.autoTagRules[0].category).toBe("FoleyFX");
  });

  it("initializes Stage 1 with peaks, quick stats, and ignores off-filter saved sample", async () => {
    vi.useFakeTimers();
    const loadSavedSpy = vi
      .spyOn(storageHelpers, "loadSavedLastSample")
      .mockReturnValue({
        id: 202,
        path: "D:/SFX/FolderA/1-108.mp3",
      });
    try {
      const favTrack = makeSample(201, {
        file_name: "Achievement.mp3",
        is_favorite: true,
        peaks_json: "[0.2,0.7]",
      });
      const nonFavLast = makeSample(202, {
        file_name: "1-108.mp3",
        file_path: "D:/SFX/FolderA/1-108.mp3",
        is_favorite: false,
        peaks_json: "[0.1,0.4]",
      });

      useSampleStore.setState({
        hasInitialized: false,
        favoriteOnly: true,
        recentSampleIds: [201, 9999],
      });

      invokeMock.mockImplementation((cmd: string) => {
        switch (cmd) {
          case "get_profiles":
            return Promise.resolve([
              {
                id: 1,
                name: "Studio",
                color: "#F59E0B",
                settings_json: "{}",
                is_active: true,
                created_at: "2026-01-01",
              },
            ]);
          case "get_libraries":
            return Promise.resolve([
              {
                id: 1,
                path: "D:/SFX",
                name: "SFX",
                last_scanned_at: "2026-01-01",
                sample_count: 55195,
                is_global: true,
                assigned_to_profile: true,
              },
            ]);
          case "query_samples":
            return Promise.resolve([favTrack]);
          case "get_sample_by_id_or_path":
            return Promise.resolve(nonFavLast);
          case "get_profile_quick_stats":
            return Promise.resolve({
              favorites_count: 71,
              existing_sample_ids: [201],
            });
          default:
            return Promise.resolve([]);
        }
      });

      await useSampleStore.getState().initialize();

      const st = useSampleStore.getState();
      expect(st.hasInitialized).toBe(true);
      expect(st.favoritesCount).toBe(71);
      expect(st.knownSampleIds.has(201)).toBe(true);
      expect(st.samples.map((s) => s.id)).toEqual([201]);
      expect(st.selectedSample?.id).toBe(201);
      expect(invokeMock).toHaveBeenCalledWith(
        "query_samples",
        expect.objectContaining({ includePeaks: true, limit: 150 })
      );
      expect(invokeMock).toHaveBeenCalledWith(
        "get_sample_by_id_or_path",
        expect.objectContaining({ includePeaks: true })
      );
    } finally {
      loadSavedSpy.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("preserves and reloads per-profile favoritesCount when switching to a zero-favorite profile and back", async () => {
    const primary: Profile = {
      id: 1,
      name: "Studio",
      color: "#F59E0B",
      settings_json: "{}",
      is_active: true,
      created_at: "2026-10-27",
    };
    const relink: Profile = {
      id: 2,
      name: "DaVinci Relink - Editor",
      color: "#38BDF8",
      settings_json: "{}",
      is_active: false,
      created_at: "2026-11-15",
    };

    let currentActiveId = 1;
    useSampleStore.setState({
      profiles: [primary, relink],
      activeProfile: primary,
      favoriteOnly: true,
      allProfileSamples: [makeSample(10, { is_favorite: true }), makeSample(11)],
      favoritesCount: 1,
    });

    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "switch_profile") {
        const pid = (args as { profileId: number }).profileId;
        currentActiveId = pid;
        return Promise.resolve({
          ...(pid === 1 ? primary : relink),
          is_active: true,
        });
      }
      if (cmd === "get_profiles") {
        return Promise.resolve([
          { ...primary, is_active: currentActiveId === 1 },
          { ...relink, is_active: currentActiveId === 2 },
        ]);
      }
      if (cmd === "query_samples") {
        return Promise.resolve(
          currentActiveId === 1
            ? [makeSample(10, { is_favorite: true }), makeSample(11)]
            : [makeSample(10, { is_favorite: false }), makeSample(11)]
        );
      }
      return Promise.resolve([]);
    });

    await useSampleStore.getState().switchProfile(2);
    expect(useSampleStore.getState().activeProfile?.id).toBe(2);
    expect(useSampleStore.getState().favoritesCount).toBe(0);
    expect(useSampleStore.getState().favoriteOnly).toBe(false);

    await useSampleStore.getState().switchProfile(1);
    expect(useSampleStore.getState().activeProfile?.id).toBe(1);
    expect(useSampleStore.getState().favoritesCount).toBe(1);
    expect(
      useSampleStore.getState().allProfileSamples.find((s) => s.id === 10)?.is_favorite
    ).toBe(true);
  });

  it("ignores stale debounced persist writes if another window switches the active profile first", async () => {
    vi.useFakeTimers();
    try {
      const primary: Profile = {
        id: 1,
        name: "Studio",
        color: "#F59E0B",
        settings_json: "{}",
        is_active: true,
        created_at: "2026-10-27",
      };
      const secondary: Profile = {
        id: 2,
        name: "Editor",
        color: "#38BDF8",
        settings_json: "{}",
        is_active: true,
        created_at: "2026-11-15",
      };

      invokeMock.mockResolvedValue(secondary);
      useSampleStore.setState({
        profiles: [primary, secondary],
        activeProfile: primary,
      });

      const persistPromise = useSampleStore.getState().persistActiveProfileSettings(false);
      // Simulate Settings window switching activeProfile before the 350ms debounce fires
      useSampleStore.setState({ activeProfile: secondary });

      vi.advanceTimersByTime(400);
      await persistPromise;

      expect(invokeMock).not.toHaveBeenCalledWith(
        "update_profile",
        expect.anything()
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("cycles date columns descending first and supports clearing shortcuts cleanly", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    if (typeof globalThis.navigator === "undefined") {
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        configurable: true,
        writable: true,
      });
    }
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    const older = makeSample(1, {
      file_path: "F:/data/sounds/older.wav",
      created_at: "2026-10-01 12:00:00",
      file_modified_at: 1000,
    });
    const newer = makeSample(2, {
      file_path: "F:/data/sounds/newer.wav",
      created_at: "2026-11-15 12:00:00",
      file_modified_at: 5000,
    });

    useSampleStore.setState({
      rawSamples: [older, newer],
      samples: [older, newer],
      allProfileSamples: [older, newer],
      selectedSampleIds: [1, 2],
    });

    // First click on dateModified sorts newest first (desc), then asc, then clears
    useSampleStore.getState().cycleSort("dateModified");
    expect(useSampleStore.getState().sortKey).toBe("dateModified");
    expect(useSampleStore.getState().sortDir).toBe("desc");
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([2, 1]);

    useSampleStore.getState().cycleSort("dateModified");
    expect(useSampleStore.getState().sortDir).toBe("asc");
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1, 2]);

    useSampleStore.getState().cycleSort("dateModified");
    expect(useSampleStore.getState().sortKey).toBeNull();

    // copySamplePaths converts forward-slash drive paths to Windows backslashes
    await useSampleStore.getState().copySamplePaths();
    expect(writeTextMock).toHaveBeenCalledWith(
      "F:\\data\\sounds\\older.wav\nF:\\data\\sounds\\newer.wav"
    );

    // Clearing a shortcut sets empty string and mergeShortcutsWithDefaults preserves ""
    useSampleStore.getState().setShortcut("copyFilePath", "");
    expect(useSampleStore.getState().shortcuts.copyFilePath).toBe("");
    const merged = storageHelpers.mergeShortcutsWithDefaults({
      copyFilePath: "",
    });
    expect(merged.copyFilePath).toBe("");
    expect(merged.showInFolder).toBe("Ctrl+Shift+E");

    // Canonical collision checks reject reserved global chords and cross-variant conflicts
    const prevPlay = useSampleStore.getState().shortcuts.playPause;
    useSampleStore.getState().setShortcut("playPause", "Ctrl+,");
    expect(useSampleStore.getState().shortcuts.playPause).toBe(prevPlay);
    useSampleStore.getState().setShortcut("playPause", "Control+Z");
    expect(useSampleStore.getState().shortcuts.playPause).toBe(prevPlay);
    useSampleStore.getState().setShortcut("playPause", "F2");
    expect(useSampleStore.getState().shortcuts.playPause).toBe(prevPlay);

    useSampleStore.getState().setShortcut("playPause", "Ctrl+Space");
    expect(useSampleStore.getState().shortcuts.playPause).toBe("Ctrl+Space");
    const prevStop = useSampleStore.getState().shortcuts.stopPlayback;
    useSampleStore.getState().setShortcut("stopPlayback", "Control+ ");
    expect(useSampleStore.getState().shortcuts.stopPlayback).toBe(prevStop);
  });

  it("decrements favoritesCount cleanly when trashing favorites and restores original library_id in MOVE journal undo", async () => {
    const { journalEntryToHistoryItem } = await import("./slices/fileOpsHistoryHelpers");

    const fav = makeSample(101, {
      library_id: 2,
      file_path: "E:/DstLib/kick.wav",
      file_name: "kick.wav",
      is_favorite: true,
    });
    const nonFav = makeSample(102, {
      library_id: 2,
      file_path: "E:/DstLib/snare.wav",
      file_name: "snare.wav",
      is_favorite: false,
    });

    useSampleStore.setState({
      libraries: [
        { id: 1, name: "SrcLib", path: "D:/SrcLib", last_scanned_at: "", sample_count: 1, is_global: true, is_read_only: false },
        { id: 2, name: "DstLib", path: "E:/DstLib", last_scanned_at: "", sample_count: 2, is_global: true, is_read_only: false },
      ],
      allProfileSamples: [fav, nonFav],
      rawSamples: [fav, nonFav],
      samples: [fav, nonFav],
      favoritesCount: 3,
      selectedSample: fav,
      selectedSampleIds: [101],
    });

    const moveItem = journalEntryToHistoryItem(
      {
        id: 1,
        op_type: "MOVE",
        sample_id: 101,
        old_path: "D:/SrcLib/sub/kick.wav",
        new_path: "E:/DstLib/kick.wav",
        old_name: "kick.wav",
        new_name: "kick.wav",
        created_at: "",
        can_undo: true,
      },
      useSampleStore.getState
    );
    expect(moveItem?.kind).toBe("move");
    if (moveItem?.kind === "move") {
      expect(moveItem.moves[0].old_library_id).toBe(1);
      expect(moveItem.moves[0].new_library_id).toBe(2);
    }

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "move_samples_to_trash") {
        return {
          affected_count: 1,
          affected_ids: [101],
          trashed_count: 1,
          total_bytes: 4096,
        };
      }
      if (cmd === "list_trashed_samples") return [];
      if (cmd === "get_trash_status") {
        return { trashed_count: 1, total_bytes: 4096 };
      }
      if (cmd === "get_profile_quick_stats") {
        return { total_count: 1, favorites_count: 2, trashed_count: 1, trashed_bytes: 4096 };
      }
      return undefined;
    });

    await useSampleStore.getState().moveSamplesToTrash([101]);
    expect(useSampleStore.getState().favoritesCount).toBe(2);
  });
});
