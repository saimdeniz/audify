import { beforeEach, describe, expect, it, vi } from "vitest";
import { Collection, SampleItem } from "../types";
import { computeSmartCollectionCounts } from "../utils/smartCollectionCounts";

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

import { useSampleStore } from "./useSampleStore";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `F:/sounds/sample_${id}.wav`,
    file_name: `sample_${id}.wav`,
    folder_path: "F:/sounds",
    extension: "wav",
    file_size: 12000,
    duration_ms: 1400,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    is_favorite: false,
    is_loop: false,
    bpm: null,
    musical_key: "",
    camelot_key: "",
    genre: "",
    artist: "",
    album: "",
    year: "",
    peaks_json: "[]",
    created_at: "2026-01-01",
    tags: [],
    ...overrides,
  };
}

function makeCollection(
  id: number,
  name: string,
  overrides: Partial<Collection> = {}
): Collection {
  return {
    id,
    parent_id: null,
    rule_path: null,
    smart_query: null,
    name,
    color: "#3b82f6",
    icon: "folder",
    created_at: "2026-01-01 00:00:00",
    sample_count: 0,
    ...overrides,
  };
}

describe("Smart Collections store integration", () => {
  const s1 = makeSample(1, {
    file_name: "Heavy_Kick_124.wav",
    bpm: 124,
    is_loop: false,
  });
  const s2 = makeSample(2, {
    file_name: "Soft_Kick_Loop_128.wav",
    bpm: 128,
    is_loop: true,
  });
  const s3 = makeSample(3, {
    file_name: "Cinematic_Riser_Long.wav",
    duration_ms: 5200,
  });

  beforeEach(() => {
    invokeMock.mockReset();
    useSampleStore.setState({
      allProfileSamples: [s1, s2, s3],
      rawSamples: [s1, s2, s3],
      samples: [s1, s2, s3],
      collections: [],
      tags: [],
      genres: [],
      searchQuery: "",
      smartSearchSynonyms: true,
      folderFilter: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      trashFilterActive: false,
      selectedTagIds: [],
      selectedGenre: null,
      typeFilter: "all",
      srFilter: null,
      sortKey: null,
      sortDir: "asc",
      selectedSample: null,
      selectedSampleIds: [],
      autoCreateCollectionSubfolders: false,
      collectionTemplates: [],
      statusMessage: null,
      statusNotice: null,
    });
  });

  it("computes live smart collection counts cleanly and honors synonym toggling", () => {
    const manualCol = makeCollection(1, "Favorites Bucket", { sample_count: 4 });
    const kickSmart = makeCollection(2, "Punchy Kicks", {
      icon: "zap",
      smart_query: "kick -loop bpm:120-130",
    });
    const buildSmart = makeCollection(3, "Riser / Build", {
      icon: "zap",
      smart_query: "build",
    });

    expect(computeSmartCollectionCounts([s1, s2, s3], [manualCol], true)).toEqual(
      {}
    );

    useSampleStore.setState({
      collections: [manualCol, kickSmart, buildSmart],
    });
    expect(useSampleStore.getState().smartCollectionCounts).toEqual({
      2: 1,
      3: 1,
    });

    // Disabling UCS synonyms switches `build` back to strict matching (0 hits for `Cinematic_Riser`)
    useSampleStore.getState().setSmartSearchSynonyms(false);
    expect(useSampleStore.getState().smartCollectionCounts).toEqual({
      2: 1,
      3: 0,
    });
  });

  it("filters smart collections in memory without invoking SQLite and composes with top-bar search", () => {
    const kickSmart = makeCollection(10, "All Kicks", {
      icon: "zap",
      smart_query: "kick",
    });
    useSampleStore.setState({ collections: [kickSmart] });

    useSampleStore.getState().setCollectionFilter(10);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1, 2]);

    // Composing a top-bar refinement narrows the smart collection further
    useSampleStore.setState({ searchQuery: "heavy" });
    useSampleStore.getState().setCollectionFilter(10);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1]);
  });

  it("skips subfolder auto-templates on Smart Collection creation and guards manual item/template calls", async () => {
    const smartCol = makeCollection(20, "Short Hits", {
      icon: "zap",
      smart_query: "<2s",
    });

    useSampleStore.setState({
      autoCreateCollectionSubfolders: true,
      collectionTemplates: [
        { id: "t1", name: "Drums", icon: "folder", folder_path: "" },
      ],
    });

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "create_collection") return smartCol;
      if (cmd === "get_profiles") return [];
      if (cmd === "get_libraries") return [];
      if (cmd === "get_tags") return [];
      if (cmd === "get_genres") return [];
      if (cmd === "get_collections") return [smartCol];
      if (cmd === "get_folder_tree_stats") return [];
      if (cmd === "get_trash_status") return null;
      return null;
    });

    const created = await useSampleStore
      .getState()
      .createCollection("Short Hits", undefined, "zap", null, null, "  <2s  ");

    expect(created?.id).toBe(20);
    const createCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "create_collection"
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][1]).toMatchObject({
      name: "Short Hits",
      icon: "zap",
      parentId: null,
      rulePath: null,
      smartQuery: "<2s",
    });

    invokeMock.mockClear();
    await useSampleStore.getState().addToCollection(20, s1.id);
    await useSampleStore.getState().addSamplesToCollectionBatch(20, [s1.id, s2.id]);
    await useSampleStore.getState().applyTemplatesToExistingCollection(20);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSampleStore.getState().statusNotice?.kind).toBe("info");
  });

  it("updates smart query via renameCollection and re-filters active smart collection view", async () => {
    const initialSmart = makeCollection(30, "Smart Kicks", {
      icon: "zap",
      smart_query: "kick",
    });
    const updatedSmart = makeCollection(30, "Smart Kicks", {
      icon: "zap",
      smart_query: "kick -loop",
    });

    useSampleStore.setState({
      collections: [initialSmart],
      selectedCollectionId: 30,
    });
    useSampleStore.getState().setCollectionFilter(30);
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1, 2]);

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "rename_collection") return updatedSmart;
      if (cmd === "get_profiles") return [];
      if (cmd === "get_libraries") return [];
      if (cmd === "get_tags") return [];
      if (cmd === "get_genres") return [];
      if (cmd === "get_collections") return [updatedSmart];
      if (cmd === "get_folder_tree_stats") return [];
      if (cmd === "get_trash_status") return null;
      return null;
    });

    const res = await useSampleStore
      .getState()
      .renameCollection(30, "Smart Kicks", "#3b82f6", "zap", null, "kick -loop");

    expect(res?.smart_query).toBe("kick -loop");
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1]);
    expect(useSampleStore.getState().smartCollectionCounts).toEqual({ 30: 1 });
  });
});
