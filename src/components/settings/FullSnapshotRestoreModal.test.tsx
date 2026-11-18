// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { FullSnapshotRestoreModal } from "./FullSnapshotRestoreModal";

describe("FullSnapshotRestoreModal", () => {
  beforeEach(() => {
    useSampleStore.setState({ pendingSnapshotRestore: null });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({ pendingSnapshotRestore: null });
  });

  it("renders snapshot manifest metadata and handles Escape & restore confirm", () => {
    const clearMock = vi.fn();
    const confirmMock = vi.fn().mockResolvedValue(undefined);

    useSampleStore.setState({
      pendingSnapshotRestore: {
        filePath: "D:/Backups/studio_master.audify-backup.zip",
        manifest: {
          format: "audify-full-backup-v1",
          schema_version: 10,
          app_version: "0.2.0",
          created_at: "2026-11-14 14:30:00",
          active_profile_name: "Cinematic Mix",
          profile_count: 3,
          sample_count: 55120,
          image_count: 6,
        },
      },
      clearPendingSnapshotRestore: clearMock,
      confirmFullSnapshotRestore: confirmMock,
    });

    render(<FullSnapshotRestoreModal />);

    const dialog = screen.getByRole("dialog", {
      name: "Restore Full Library Snapshot",
    });
    expect(dialog).toBeTruthy();
    expect(screen.getByText("studio_master.audify-backup.zip")).toBeTruthy();
    expect(screen.getByText("Cinematic Mix")).toBeTruthy();
    expect(screen.getByText(/3 total profiles/)).toBeTruthy();
    expect(screen.getByText(/55,120 samples|55\.120 samples/)).toBeTruthy();
    expect(screen.getByText("6 wallpaper assets")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(clearMock).toHaveBeenCalledTimes(1);

    const confirmBtn = screen.getByRole("button", {
      name: /Restore Full Snapshot/,
    });
    fireEvent.click(confirmBtn);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
