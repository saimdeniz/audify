// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Profile, SampleItem, TrashActionSummary } from "../types";

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

import {
  AUDIFY_STORAGE_KEYS,
  LAST_SELECTED_SAMPLE_PATH_KEY,
  loadSavedTrashStatus,
  safeGetItem,
  safeRemoveItem,
  saveTrashStatus,
} from "./storageHelpers";
import { useSampleStore } from "./useSampleStore";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `C:/Audio/Sample_${id}.wav`,
    file_name: `Sample_${id}.wav`,
    folder_path: "C:/Audio",
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

describe("fileOpsSlice Undo/Redo atomicity & persistActiveProfileSettings sequential lock", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useSampleStore.setState({
      profiles: [],
      activeProfile: null,
      allProfileSamples: [],
      rawSamples: [],
      samples: [],
      selectedSample: null,
      selectedSampleIds: [],
      fileOpUndoStack: [],
      fileOpRedoStack: [],
      fileOpJournal: [],
      trashedCount: 0,
      trashedTotalBytes: 0,
      trashOpStatus: null,
      enableAdvancedFileOps: true,
      confirmBeforeTrash: false,
    });
  });

  it("preserves fileOpUndoStack when Tauri invoke rejects, and pops only after await resolves", async () => {
    const s1 = makeSample(1, {
      file_name: "Kick_New.wav",
      file_path: "C:/Audio/Kick_New.wav",
      previous_file_name: "Kick_Old.wav",
    });
    const undoRenameItem = {
      kind: "rename" as const,
      sampleId: 1,
      oldStem: "Kick_Old",
      newStem: "Kick_New",
      oldFileName: "Kick_Old.wav",
      newFileName: "Kick_New.wav",
    };

    useSampleStore.setState({
      allProfileSamples: [s1],
      rawSamples: [s1],
      samples: [s1],
      selectedSample: s1,
      fileOpUndoStack: [undoRenameItem],
      fileOpRedoStack: [],
    });

    // 1. Rejection on undo must leave stack untouched and NOT push to redo
    invokeMock.mockRejectedValueOnce(new Error("File is locked by DAW"));
    const failedOk = await useSampleStore.getState().undoLastFileOp();
    expect(failedOk).toBe(false);
    expect(useSampleStore.getState().fileOpUndoStack).toHaveLength(1);
    expect(useSampleStore.getState().fileOpRedoStack).toHaveLength(0);

    // 2. Successful undo pops undo stack and pushes onto redo stack
    const restoredSample = makeSample(1, {
      file_name: "Kick_Old.wav",
      file_path: "C:/Audio/Kick_Old.wav",
      previous_file_name: "Kick_New.wav",
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "rename_sample_file") return Promise.resolve(restoredSample);
      if (cmd === "get_trash_status") {
        return Promise.resolve({ trashed_count: 0, total_bytes: 0, journal_entries: [] });
      }
      return Promise.resolve(null);
    });

    const undoOk = await useSampleStore.getState().undoLastFileOp();
    expect(undoOk).toBe(true);
    expect(useSampleStore.getState().fileOpUndoStack).toHaveLength(0);
    expect(useSampleStore.getState().fileOpRedoStack).toHaveLength(1);
    expect(useSampleStore.getState().samples[0].file_name).toBe("Kick_Old.wav");

    // 3. Rejection on redo must leave redo stack intact and NOT push back to undo
    invokeMock.mockRejectedValueOnce(new Error("Disk write error"));
    const redoFailed = await useSampleStore.getState().redoLastFileOp();
    expect(redoFailed).toBe(false);
    expect(useSampleStore.getState().fileOpRedoStack).toHaveLength(1);
    expect(useSampleStore.getState().fileOpUndoStack).toHaveLength(0);

    // 4. Successful redo restores undo stack
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "rename_sample_file") return Promise.resolve(s1);
      if (cmd === "get_trash_status") {
        return Promise.resolve({ trashed_count: 0, total_bytes: 0, journal_entries: [] });
      }
      return Promise.resolve(null);
    });

    const redoOk = await useSampleStore.getState().redoLastFileOp();
    expect(redoOk).toBe(true);
    expect(useSampleStore.getState().fileOpRedoStack).toHaveLength(0);
    expect(useSampleStore.getState().fileOpUndoStack).toHaveLength(1);
  });

  it("preserves trash undo stack on failure and restores cleanly when invoke resolves", async () => {
    const undoTrashItem = {
      kind: "trash" as const,
      sampleIds: [7],
      label: '"Snare.wav"',
    };
    useSampleStore.setState({
      fileOpUndoStack: [undoTrashItem],
      fileOpRedoStack: [],
    });

    invokeMock.mockRejectedValueOnce(new Error("Quarantine missing"));
    expect(await useSampleStore.getState().undoLastFileOp()).toBe(false);
    expect(useSampleStore.getState().fileOpUndoStack).toHaveLength(1);

    const summary: TrashActionSummary = {
      affected_count: 1,
      affected_ids: [7],
      trashed_count: 0,
      total_bytes: 0,
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "restore_samples_from_trash") return Promise.resolve(summary);
      if (cmd === "query_samples" || cmd === "get_folder_tree_stats" || cmd === "get_profiles" || cmd === "get_libraries" || cmd === "get_tags" || cmd === "get_genres" || cmd === "get_collections") {
        return Promise.resolve([]);
      }
      if (cmd === "get_trash_status") {
        return Promise.resolve({ trashed_count: 0, total_bytes: 0, journal_entries: [] });
      }
      return Promise.resolve(null);
    });

    expect(await useSampleStore.getState().undoLastFileOp()).toBe(true);
    expect(useSampleStore.getState().fileOpUndoStack).toHaveLength(0);
    expect(useSampleStore.getState().fileOpRedoStack).toHaveLength(1);
  });

  it("serializes concurrent persistActiveProfileSettings calls via inFlight lock without dropping edits", async () => {
    const profile1: Profile = {
      id: 1,
      name: "Studio",
      color: "#F59E0B",
      is_active: true,
      created_at: "2026-01-01",
      settings_json: "{}",
    };
    useSampleStore.setState({
      profiles: [profile1],
      activeProfile: profile1,
      accentColor: "#111111",
    });

    let activeInvokes = 0;
    let maxConcurrentInvokes = 0;
    const savedColors: string[] = [];
    let releaseFirst!: (val: Profile) => void;

    invokeMock.mockImplementation((cmd: string, args?: { color?: string; settingsJson?: string }) => {
      if (cmd !== "update_profile") return Promise.resolve(null);
      activeInvokes += 1;
      maxConcurrentInvokes = Math.max(maxConcurrentInvokes, activeInvokes);
      savedColors.push(args?.color ?? "");

      if (savedColors.length === 1) {
        return new Promise<Profile>((resolve) => {
          releaseFirst = (val: Profile) => {
            activeInvokes -= 1;
            resolve(val);
          };
        });
      }
      activeInvokes -= 1;
      return Promise.resolve({
        ...profile1,
        color: args?.color ?? "#222222",
        settings_json: args?.settingsJson ?? "{}",
      });
    });

    const p1 = useSampleStore.getState().persistActiveProfileSettings(true);
    // Simulate rapid second change while first SQLite write is still in flight
    useSampleStore.setState({ accentColor: "#222222" });
    const p2 = useSampleStore.getState().persistActiveProfileSettings(true);

    // Must NOT start a parallel update_profile while #1 is in flight
    expect(savedColors).toEqual(["#111111"]);
    expect(maxConcurrentInvokes).toBe(1);

    releaseFirst({ ...profile1, color: "#111111" });
    await Promise.all([p1, p2]);

    // Must have flushed #2 sequentially afterward with updated #222222
    expect(maxConcurrentInvokes).toBe(1);
    expect(savedColors).toEqual(["#111111", "#222222"]);
    expect(useSampleStore.getState().activeProfile?.color).toBe("#222222");
  });

  it("writes LAST_SELECTED_SAMPLE_PATH_KEY on rename and cleans bin/recent without double fetch on emptyAudifyTrash", async () => {
    const s1 = makeSample(10, {
      file_name: "OldName.wav",
      file_path: "C:/Audio/OldName.wav",
    });
    const s2 = makeSample(11, {
      file_name: "KeepBin.wav",
      file_path: "C:/Audio/KeepBin.wav",
    });
    const renamed = makeSample(10, {
      file_name: "NewName.wav",
      file_path: "C:/Audio/NewName.wav",
      previous_file_name: "OldName.wav",
    });
    useSampleStore.setState({
      allProfileSamples: [s1, s2],
      rawSamples: [s1, s2],
      samples: [s1, s2],
      selectedSample: s1,
      binSampleIds: [10, 11],
      recentSampleIds: [10, 12],
      trashFilterActive: true,
    });

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "rename_sample_file") return Promise.resolve(renamed);
      if (cmd === "get_trash_status") {
        return Promise.resolve({
          trashed_count: 1,
          total_bytes: 2048,
          journal_entries: [],
        });
      }
      if (cmd === "empty_audify_trash") {
        return Promise.resolve({
          affected_count: 1,
          affected_ids: [10],
          trashed_count: 1,
          total_bytes: 1024,
        });
      }
      if (cmd === "query_samples") {
        return Promise.resolve(args?.trashFilter ? [] : [s2]);
      }
      if (
        cmd === "get_profiles" ||
        cmd === "get_libraries" ||
        cmd === "get_tags" ||
        cmd === "get_genres" ||
        cmd === "get_collections" ||
        cmd === "get_folder_tree_stats"
      ) {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    try {
      await useSampleStore.getState().renameSampleFile(10, "NewName");
      expect(safeGetItem(LAST_SELECTED_SAMPLE_PATH_KEY)).toBe(
        "C:/Audio/NewName.wav"
      );

      await useSampleStore.getState().emptyAudifyTrash([10]);
      expect(useSampleStore.getState().binSampleIds).toEqual([11]);
      expect(useSampleStore.getState().recentSampleIds).toEqual([12]);
      expect(JSON.parse(safeGetItem(AUDIFY_STORAGE_KEYS.binSampleIds) || "[]")).toEqual([
        11,
      ]);

      // Must NOT fire redundant double query_samples when trashFilterActive stays true
      const queryCalls = invokeMock.mock.calls.filter(
        (c) => c[0] === "query_samples"
      );
      expect(queryCalls).toHaveLength(2);
    } finally {
      safeRemoveItem(LAST_SELECTED_SAMPLE_PATH_KEY, {
        broadcast: false,
        markEdited: false,
      });
      safeRemoveItem(AUDIFY_STORAGE_KEYS.binSampleIds, {
        broadcast: false,
        markEdited: false,
      });
      safeRemoveItem(AUDIFY_STORAGE_KEYS.recentSampleIds, {
        broadcast: false,
        markEdited: false,
      });
    }
  });

  it("tracks trashOpStatus while async emptyAudifyTrash is in flight, blocks overlapping ops, and clears status on failure", async () => {
    const s1 = makeSample(20);
    useSampleStore.setState({
      trashedCount: 2284,
      trashedTotalBytes: 1024 * 1024,
      samples: [s1],
    });

    let resolveEmpty!: (val: TrashActionSummary) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "empty_audify_trash") {
        return new Promise<TrashActionSummary>((resolve) => {
          resolveEmpty = resolve;
        });
      }
      if (cmd === "get_trash_status") {
        return Promise.resolve({
          trashed_count: 0,
          total_bytes: 0,
          journal_entries: [],
        });
      }
      return Promise.resolve([]);
    });

    const p1 = useSampleStore.getState().emptyAudifyTrash();
    await new Promise((r) => setTimeout(r, 0));
    expect(useSampleStore.getState().trashOpStatus).toEqual({
      kind: "emptying",
      count: 2284,
    });

    // Concurrent restore/trash must no-op while emptying is running
    const pConcurrent = useSampleStore.getState().restoreSamplesFromTrash();
    expect(await pConcurrent).toBeNull();

    resolveEmpty({
      affected_count: 2284,
      affected_ids: [20],
      trashed_count: 0,
      total_bytes: 0,
    });
    await p1;
    expect(useSampleStore.getState().trashOpStatus).toBeNull();

    // Error must also release trashOpStatus cleanly in finally
    useSampleStore.setState({ trashedCount: 5 });
    invokeMock.mockRejectedValueOnce(new Error("SHFileOperationW failed"));
    const failed = await useSampleStore.getState().emptyAudifyTrash();
    expect(failed).toBeNull();
    expect(useSampleStore.getState().trashOpStatus).toBeNull();
  });

  it("persists trashedCount and trashedTotalBytes via localStorage cache to eliminate startup rail icon shift", async () => {
    localStorage.removeItem(AUDIFY_STORAGE_KEYS.cachedTrashStatus);
    expect(loadSavedTrashStatus()).toEqual({ count: 0, totalBytes: 0 });

    localStorage.setItem(AUDIFY_STORAGE_KEYS.cachedTrashStatus, "{broken");
    expect(loadSavedTrashStatus()).toEqual({ count: 0, totalBytes: 0 });

    saveTrashStatus(3, 12288);
    expect(loadSavedTrashStatus()).toEqual({ count: 3, totalBytes: 12288 });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_trash_status") {
        return Promise.resolve({
          trashed_count: 1,
          total_bytes: 2900,
          journal_entries: [],
        });
      }
      return Promise.resolve([]);
    });

    await useSampleStore.getState().refreshTrashStatus();
    expect(useSampleStore.getState().trashedCount).toBe(1);
    expect(useSampleStore.getState().trashedTotalBytes).toBe(2900);
    expect(loadSavedTrashStatus()).toEqual({ count: 1, totalBytes: 2900 });
  });
});
