// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, SampleItem } from "../types";

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

import { runStartupMtimeBackfill } from "./mtimeBackfill";
import { useSampleStore } from "./useSampleStore";

function makeProfile(id: number, name: string, color: string): Profile {
  return {
    id,
    name,
    color,
    is_active: id === 1,
    created_at: "2026-01-01",
    settings_json: JSON.stringify({ accentColor: color, themeMode: "dark" }),
  };
}

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `C:/Audio/S_${id}.wav`,
    file_name: `S_${id}.wav`,
    folder_path: "C:/Audio",
    extension: "wav",
    file_size: 1024,
    duration_ms: 1000,
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

describe("profile switch serialization, mtimeBackfill epoch guard, and catalogSync optimizations", () => {
  const origSearch = window.location.search;

  beforeEach(() => {
    invokeMock.mockReset();
    window.history.replaceState({}, "", "/");
    useSampleStore.setState({
      profiles: [],
      activeProfile: null,
      allProfileSamples: [],
      rawSamples: [],
      samples: [],
      selectedSample: null,
      selectedSampleIds: [],
      selectedCollectionId: null,
      trashFilterActive: false,
      accentColor: "#F59E0B",
      themeMode: "dark",
    });
  });

  afterEach(() => {
    window.history.replaceState({}, "", origSearch || "/");
  });

  it("defers applyProfileSettingsImmediately until switch_profile IPC succeeds and serializes concurrent transitions", async () => {
    const p1 = makeProfile(1, "Default", "#F59E0B");
    const p2 = makeProfile(2, "Cinematic", "#38BDF8");
    const p3 = makeProfile(3, "Foley", "#10B981");

    useSampleStore.setState({
      profiles: [p1, p2, p3],
      activeProfile: p1,
      accentColor: "#F59E0B",
    });

    let resolveSwitch2!: (p: Profile) => void;
    let activeProfileId = 1;
    const callOrder: string[] = [];

    invokeMock.mockImplementation((cmd: string, args?: { profileId?: number }) => {
      if (cmd === "switch_profile") {
        callOrder.push(`switch:${args?.profileId}`);
        if (args?.profileId === 2) {
          return new Promise<Profile>((resolve) => {
            resolveSwitch2 = (prof) => {
              activeProfileId = prof.id;
              resolve(prof);
            };
          });
        }
        activeProfileId = args?.profileId ?? 3;
        return Promise.resolve({ ...p3, is_active: true });
      }
      if (cmd === "get_profiles") {
        return Promise.resolve(
          [p1, p2, p3].map((p) => ({ ...p, is_active: p.id === activeProfileId }))
        );
      }
      if (
        cmd === "get_libraries" ||
        cmd === "get_tags" ||
        cmd === "get_genres" ||
        cmd === "get_collections" ||
        cmd === "get_folder_tree_stats" ||
        cmd === "query_samples" ||
        cmd === "get_ai_tag_suggestions"
      ) {
        return Promise.resolve([]);
      }
      if (cmd === "get_trash_status") {
        return Promise.resolve({ trashed_count: 0, total_bytes: 0, journal_entries: [] });
      }
      if (cmd === "get_ai_model_status") {
        return Promise.resolve({ ready: false });
      }
      return Promise.resolve(null);
    });

    const sw2 = useSampleStore.getState().switchProfile(2);
    const sw3 = useSampleStore.getState().switchProfile(3);

    // Must wait for flushPendingPersist promise tick, then invoke switch:2 WITHOUT changing accent prematurely
    await vi.waitFor(() => {
      expect(callOrder).toContain("switch:2");
    });
    expect(callOrder).not.toContain("switch:3");
    expect(useSampleStore.getState().accentColor).toBe("#F59E0B");
    expect(useSampleStore.getState().activeProfile?.id).toBe(1);

    resolveSwitch2({ ...p2, is_active: true });
    await Promise.all([sw2, sw3]);

    expect(callOrder).toEqual(["switch:2", "switch:3"]);
    expect(useSampleStore.getState().activeProfile?.id).toBe(3);
    expect(useSampleStore.getState().accentColor).toBe("#10B981");
  });

  it("keeps previous profile settings intact if switch_profile IPC rejects", async () => {
    const p1 = makeProfile(1, "Default", "#F59E0B");
    const p2 = makeProfile(2, "Broken", "#38BDF8");
    useSampleStore.setState({
      profiles: [p1, p2],
      activeProfile: p1,
      accentColor: "#F59E0B",
    });

    invokeMock.mockRejectedValueOnce(new Error("SQLite locked"));
    await useSampleStore.getState().switchProfile(2);

    expect(useSampleStore.getState().activeProfile?.id).toBe(1);
    expect(useSampleStore.getState().accentColor).toBe("#F59E0B");
  });

  it("aborts mtime backfill immediately when profile epoch advances mid-flight", async () => {
    const oldSample = makeSample(1, { file_modified_at: null });
    const newProfileSample = makeSample(99, { file_modified_at: 42 });
    useSampleStore.setState({
      allProfileSamples: [oldSample],
      rawSamples: [oldSample],
      samples: [oldSample],
    });

    let epoch = 1;
    let resolveBackfill!: (val: {
      patches: { sample_id: number; file_modified_at: number }[];
      last_scanned_id: number;
      has_more: boolean;
    }) => void;

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "backfill_file_modified_dates") {
        return new Promise((resolve) => {
          resolveBackfill = resolve;
        });
      }
      return Promise.resolve(null);
    });

    const job = runStartupMtimeBackfill({
      set: useSampleStore.setState,
      get: useSampleStore.getState,
      applyInstantMemoryFilter: vi.fn(() => true),
      getProfileEpoch: () => epoch,
    });

    // Simulate switching profile while first batch IPC is in flight
    epoch = 2;
    useSampleStore.setState({
      allProfileSamples: [newProfileSample],
      rawSamples: [newProfileSample],
      samples: [newProfileSample],
    });
    resolveBackfill({
      patches: [{ sample_id: 99, file_modified_at: 9999 }],
      last_scanned_id: 99,
      has_more: true,
    });
    await job;

    expect(useSampleStore.getState().samples[0].file_modified_at).toBe(42);
  });

  it("skips get_folder_tree_stats in standalone Settings window and avoids double query_samples when empty", async () => {
    window.history.replaceState({}, "", "?window=settings");
    invokeMock.mockImplementation((cmd: string) => {
      if (
        cmd === "get_profiles" ||
        cmd === "get_libraries" ||
        cmd === "get_tags" ||
        cmd === "get_genres" ||
        cmd === "get_collections" ||
        cmd === "get_folder_tree_stats" ||
        cmd === "query_samples"
      ) {
        return Promise.resolve([]);
      }
      if (cmd === "get_trash_status") {
        return Promise.resolve({ trashed_count: 0, total_bytes: 0, journal_entries: [] });
      }
      return Promise.resolve(null);
    });

    await useSampleStore.getState().refreshSidebarData();
    expect(
      invokeMock.mock.calls.some((c) => c[0] === "get_folder_tree_stats")
    ).toBe(false);

    // Main window reloadProfileSamples with 0 samples must only query_samples once (no fallback fetchSamples)
    invokeMock.mockClear();
    window.history.replaceState({}, "", "/");
    await useSampleStore.getState().reloadProfileSamples({ skipFolderStats: true });
    const queryCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "query_samples"
    );
    expect(queryCalls).toHaveLength(1);
    expect(
      invokeMock.mock.calls.some((c) => c[0] === "get_folder_tree_stats")
    ).toBe(false);
  });
});
