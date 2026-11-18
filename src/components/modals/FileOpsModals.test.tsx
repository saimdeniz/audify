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
import { FileOpsModals } from "./FileOpsModals";

describe("FileOpsModals collision dialog", () => {
  beforeEach(() => {
    localStorage.clear();
    useSampleStore.setState({
      pendingTrashRequest: null,
      pendingFileConflictPrompt: null,
    });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({
      pendingTrashRequest: null,
      pendingFileConflictPrompt: null,
    });
  });

  it("truncates long suggested filenames in Keep Both button and handles Escape", () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined);
    const longSuggestedName =
      "Ultra_Long_Cinematic_Modular_Ambience_Recording_Take_042_Master_Stem (2).wav";

    useSampleStore.setState({
      pendingFileConflictPrompt: {
        mode: "move",
        sampleIds: [1],
        targetLibraryId: 1,
        targetFolderPath: "D:/SFX/Dest",
        skippedDuplicates: [],
        conflicts: [
          {
            source_path:
              "D:/SFX/Src/Ultra_Long_Cinematic_Modular_Ambience_Recording_Take_042_Master_Stem.wav",
            sample_id: 1,
            file_name:
              "Ultra_Long_Cinematic_Modular_Ambience_Recording_Take_042_Master_Stem.wav",
            suggested_new_name: longSuggestedName,
            source_size: 4096,
            existing_size: 2048,
            target_folder: "D:/SFX/Dest",
          },
        ],
      },
      resolvePendingFileConflict: resolveMock,
    });

    render(<FileOpsModals />);

    const dialog = screen.getByRole("dialog", { name: "File Name Collision" });
    expect(dialog).toBeTruthy();

    const keepBothBtn = screen.getByRole("button", {
      name: new RegExp(longSuggestedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
    expect(keepBothBtn.className).toContain("max-w-[195px]");
    expect(keepBothBtn.getAttribute("title")).toContain(longSuggestedName);

    const span = keepBothBtn.querySelector("span.truncate");
    expect(span).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(resolveMock).toHaveBeenCalledWith("cancel");
  });
});
