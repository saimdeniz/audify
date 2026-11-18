import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../types";

const invokeMock = vi.fn();
const saveMock = vi.fn();
const openMock = vi.fn();

const memoryStorage = (() => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
})();

vi.stubGlobal("localStorage", memoryStorage);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
  save: (...args: unknown[]) => saveMock(...args),
}));

import { useSampleStore } from "./useSampleStore";

function makeProfileStub(id = 1, name = "Studio"): Profile {
  return {
    id,
    name,
    color: "#38BDF8",
    settings_json: "{}",
    is_active: true,
    created_at: "2026-11-14",
  };
}

describe("backupExportActions 2-tier export & snapshot restore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    saveMock.mockReset();
    openMock.mockReset();
    memoryStorage.clear();
    const prof = makeProfileStub(7, "Main Studio");
    useSampleStore.setState({
      activeProfile: prof,
      profiles: [prof],
      localBackups: [],
      pendingSnapshotRestore: null,
      persistActiveProfileSettings: vi.fn().mockResolvedValue(undefined),
      refreshAfterCatalogMutation: vi.fn().mockResolvedValue(undefined),
      loadCustomBgGallery: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("exports compact .audify-profile packages with shareSafe and includeAiTags flags", async () => {
    saveMock.mockResolvedValueOnce("D:/Exports/main-studio.audify-profile");
    invokeMock.mockResolvedValueOnce(undefined);

    await useSampleStore.getState().exportProfileJson();

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "main-studio.audify-profile",
      })
    );
    expect(invokeMock).toHaveBeenCalledWith("export_profile_to_file", {
      profileId: 7,
      filePath: "D:/Exports/main-studio.audify-profile",
      shareSafe: false,
      includeAiTags: false,
    });

    saveMock.mockResolvedValueOnce("D:/Exports/main-studio-with-ai.audify-profile");
    invokeMock.mockResolvedValueOnce(undefined);

    await useSampleStore
      .getState()
      .exportProfileJson(undefined, { includeAiTags: true, shareSafe: true });

    expect(saveMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultPath: "main-studio-with-ai.audify-profile",
      })
    );
    expect(invokeMock).toHaveBeenLastCalledWith("export_profile_to_file", {
      profileId: 7,
      filePath: "D:/Exports/main-studio-with-ai.audify-profile",
      shareSafe: true,
      includeAiTags: true,
    });
  });

  it("creates full DB snapshots and inspects/confirms snapshot restores", async () => {
    const snapEntry = {
      file_name: "snapshot_library_2026-11-14.audify-backup.zip",
      file_path: "user/backups/snapshot_library_2026-11-14.audify-backup.zip",
      profile_name: "All Profiles (2)",
      created_at: "2026-11-14 12:00:00",
      timestamp_ms: 1794670000000,
      file_size: 2048000,
      is_auto: false,
      kind: "snapshot" as const,
      sample_count: 55000,
      includes_ai_tags: true,
    };

    invokeMock
      .mockResolvedValueOnce(snapEntry)
      .mockResolvedValueOnce([snapEntry]);

    await useSampleStore.getState().createFullSnapshotBackup();

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "create_full_snapshot_backup"
    );
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_backups");
    expect(useSampleStore.getState().localBackups).toEqual([snapEntry]);

    const manifest = {
      format: "audify-full-backup-v1",
      schema_version: 10,
      app_version: "0.2.0",
      created_at: "2026-11-14 12:00:00",
      active_profile_name: "Main Studio",
      profile_count: 2,
      sample_count: 55000,
      image_count: 4,
    };

    invokeMock.mockResolvedValueOnce(manifest);
    await useSampleStore
      .getState()
      .openFullSnapshotRestorePrompt(snapEntry.file_path);

    expect(invokeMock).toHaveBeenLastCalledWith("inspect_full_snapshot_file", {
      filePath: snapEntry.file_path,
    });
    expect(useSampleStore.getState().pendingSnapshotRestore).toEqual({
      filePath: snapEntry.file_path,
      manifest,
    });

    const restoredProfile = makeProfileStub(1, "Restored Studio");
    invokeMock
      .mockResolvedValueOnce({
        active_profile: restoredProfile,
        profile_count: 2,
        sample_count: 55000,
        tag_count: 140,
        collection_count: 12,
        restored_images: 4,
      })
      .mockResolvedValueOnce([snapEntry]);

    await useSampleStore.getState().confirmFullSnapshotRestore();

    expect(invokeMock).toHaveBeenCalledWith(
      "restore_full_snapshot_from_file",
      { filePath: snapEntry.file_path }
    );
    expect(useSampleStore.getState().pendingSnapshotRestore).toBeNull();
    expect(
      useSampleStore.getState().refreshAfterCatalogMutation
    ).toHaveBeenCalledWith({
      syncCatalog: true,
      refreshTrash: true,
    });
  });
});
