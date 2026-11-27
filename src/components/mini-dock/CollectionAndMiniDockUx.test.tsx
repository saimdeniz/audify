// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, SampleItem } from "../../types";
import {
  getSharedListScrollAnchor,
  recordSharedListScrollAnchor,
  resetSharedListScrollAnchor,
  resolveRestoredScrollTarget,
} from "../../utils/listScrollAnchor";

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

import { useSampleStore } from "../../store/useSampleStore";
import { MiniDockList } from "./MiniDockList";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/Track_${id}.wav`,
    file_name: `Track_${id}.wav`,
    folder_path: "D:/SFX",
    extension: "wav",
    duration_ms: 4200,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 400000,
    is_favorite: false,
    is_loop: false,
    genre: "Electronic",
    artist: "",
    album: "",
    year: "",
    bpm: 124,
    musical_key: "Am",
    camelot_key: "8A",
    peaks_json: "[]",
    created_at: "2026-11-26",
    tags: [],
    ...overrides,
  };
}

function makeCollection(id: number, name: string, count: number): Collection {
  return {
    id,
    name,
    color: "#38BDF8",
    icon: "layers",
    parent_id: null,
    rule_path: null,
    smart_query: null,
    created_at: "2026-11-26",
    sample_count: count,
  };
}

describe("Mini Dock badge cleanup, instant collections, and seamless scroll sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetSharedListScrollAnchor();
  });

  afterEach(() => {
    cleanup();
    resetSharedListScrollAnchor();
  });

  it("removes optimistically from collection immediately without calling heavy refreshSidebarData and rolls back on IPC error", async () => {
    const s1 = makeSample(1);
    const s2 = makeSample(2);
    const col = makeCollection(10, "Favorites Mix", 2);

    let resolveRemove!: (val: Collection) => void;
    const removePromise = new Promise<Collection>((res) => {
      resolveRemove = res;
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "remove_samples_from_collection") return removePromise;
      if (cmd === "get_collections") {
        return Promise.resolve([{ ...col, sample_count: 1 }]);
      }
      return Promise.resolve([]);
    });

    useSampleStore.setState({
      collections: [col],
      selectedCollectionId: 10,
      rawSamples: [s1, s2],
      samples: [s1, s2],
      selectedSample: s1,
      selectedSampleIds: [1],
      lastSelectedIndex: 0,
    });

    const pending = useSampleStore.getState().removeSamplesFromCollection(10, [1]);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "remove_samples_from_collection",
        expect.objectContaining({ collectionId: 10, sampleIds: [1] })
      );
    });

    // While backend IPC is still unresolved, UI must already have removed row #1 optimistically!
    const midState = useSampleStore.getState();
    expect(midState.samples.map((s) => s.id)).toEqual([2]);
    expect(midState.selectedSample?.id).toBe(2);
    expect(midState.collections[0].sample_count).toBe(1);

    resolveRemove({ ...col, sample_count: 1 });
    await pending;

    const invokedCommands = invokeMock.mock.calls.map((c) => c[0]);
    expect(invokedCommands).toContain("remove_samples_from_collection");
    expect(invokedCommands).toContain("get_collections");
    expect(invokedCommands).not.toContain("get_folder_tree_stats");
    expect(invokedCommands).not.toContain("get_tags");

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "remove_samples_from_collection") {
        return Promise.reject(new Error("DB locked"));
      }
      return Promise.resolve([]);
    });
    await useSampleStore.getState().removeSamplesFromCollection(10, [2]);
    const rolledBack = useSampleStore.getState();
    expect(rolledBack.samples.map((s) => s.id)).toEqual([2]);
    expect(rolledBack.collections[0].sample_count).toBe(1);
    expect(rolledBack.statusNotice?.kind).toBe("error");
  });

  it("adds to collection quickly via get_collections without heavy folder tree / tag scans", async () => {
    const col = makeCollection(11, "Trailer Hits", 5);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "add_samples_to_collection_batch") {
        return Promise.resolve({ ...col, sample_count: 7 });
      }
      if (cmd === "get_collections") {
        return Promise.resolve([{ ...col, sample_count: 7 }]);
      }
      return Promise.resolve([]);
    });

    useSampleStore.setState({
      collections: [col],
      selectedCollectionId: null,
    });

    await useSampleStore.getState().addSamplesToCollectionBatch(11, [101, 102]);
    expect(useSampleStore.getState().collections[0].sample_count).toBe(7);
    const invokedCommands = invokeMock.mock.calls.map((c) => c[0]);
    expect(invokedCommands).not.toContain("get_folder_tree_stats");
    expect(invokedCommands).not.toContain("get_tags");
  });

  it("focuses the playing track on view switch when playing, and follows scroll anchor when paused/stopped", () => {
    const list = Array.from({ length: 200 }, (_, i) => makeSample(i + 1));
    recordSharedListScrollAnchor(151, 150);

    expect(
      resolveRestoredScrollTarget({
        samples: list,
        selectedSampleId: 20,
        isPlaying: true,
        anchor: getSharedListScrollAnchor(),
      })
    ).toEqual({ index: 19, align: "center" });

    expect(
      resolveRestoredScrollTarget({
        samples: list,
        selectedSampleId: 20,
        isPlaying: false,
        anchor: getSharedListScrollAnchor(),
      })
    ).toEqual({ index: 150, align: "start" });

    expect(
      resolveRestoredScrollTarget({
        samples: list,
        selectedSampleId: null,
        isPlaying: false,
        anchor: getSharedListScrollAnchor(),
      })
    ).toEqual({ index: 150, align: "start" });

    const filteredList = [makeSample(20), makeSample(21)];
    expect(
      resolveRestoredScrollTarget({
        samples: filteredList,
        selectedSampleId: 20,
        isPlaying: false,
        anchor: getSharedListScrollAnchor(),
      })
    ).toEqual({ index: 0, align: "center" });
  });

  it("renders MiniDockList rows cleanly without BPM or Camelot Key badges", () => {
    const s = makeSample(55, {
      file_name: "8-bit_Tavern.mp3",
      bpm: 117,
      camelot_key: "7A",
      musical_key: "Dm",
    });
    useSampleStore.setState({
      samples: [s],
      selectedSample: s,
      selectedSampleIds: [55],
      isPlaying: false,
      similaritySession: null,
      duplicatesFilterActive: false,
    });

    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 400,
      right: 360,
      width: 360,
      height: 400,
      toJSON: () => ({}),
    });

    const { container } = render(
      <MiniDockList
        onStartSampleDrag={vi.fn(async () => {})}
        onOpenContextMenu={vi.fn()}
        batchPopover={null}
        setBatchPopover={vi.fn()}
      />
    );

    expect(container.textContent).not.toContain("117");
    expect(container.textContent).not.toContain("7A");

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
  });
});
