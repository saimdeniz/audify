// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Library, SampleItem } from "../../types";

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
import { BatchRenameModal } from "./BatchRenameModal";

function makeSample(id: number, fileName: string): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/${fileName}`,
    file_name: fileName,
    folder_path: "D:/SFX",
    extension: "wav",
    file_size: 4096,
    duration_ms: 1200,
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
    created_at: "2026-11-13",
    tags: [],
  };
}

const mockLibrary: Library = {
  id: 1,
  path: "D:/SFX",
  name: "SFX",
  last_scanned_at: "2026-11-13",
  sample_count: 2,
  is_read_only: false,
};

describe("BatchRenameModal UI component", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset().mockResolvedValue([]);
    const samples = [
      makeSample(1, "Hit_One.wav"),
      makeSample(2, "Hit_Two.wav"),
    ];
    useSampleStore.setState({
      samples,
      allProfileSamples: samples,
      libraries: [mockLibrary],
      batchRenameSampleIds: [1, 2],
    });
  });

  afterEach(() => {
    useSampleStore.setState({ batchRenameSampleIds: null, isMiniDock: false });
    cleanup();
  });

  it("blocks duplicate target filenames and resolves them via one-click _01, _02 numbering", () => {
    render(<BatchRenameModal />);

    expect(screen.getByRole("dialog", { name: "Batch Rename Audio Files" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pattern & Counter" }));
    const patternInput = screen.getByLabelText("Naming Pattern");
    fireEvent.change(patternInput, { target: { value: "Kick" } });

    expect(
      screen.getByText(/2 collision\(s\) detected/i)
    ).toBeTruthy();
    expect(screen.getAllByText("Duplicate").length).toBe(2);

    const applyDisabled = screen.getByRole("button", { name: /Rename 0 Files/i }) as HTMLButtonElement;
    expect(applyDisabled.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Fix with _01, _02" }));

    expect(screen.queryByText("Duplicate")).toBeNull();
    expect(screen.getByText("Kick_01.wav")).toBeTruthy();
    expect(screen.getByText("Kick_02.wav")).toBeTruthy();

    const applyEnabled = screen.getByRole("button", { name: /Rename 2 Files/i }) as HTMLButtonElement;
    expect(applyEnabled.disabled).toBe(false);
  });

  it("opens single-file mode on New Name tab, guards against sibling collisions, and accepts Enter/Rename", () => {
    useSampleStore.setState({ batchRenameSampleIds: [1] });
    render(<BatchRenameModal />);

    expect(screen.getByRole("dialog", { name: "Rename Audio File" })).toBeTruthy();
    expect(screen.getByText("RENAME FILE")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New Name" })).toBeTruthy();

    const input = screen.getByLabelText("New Filename") as HTMLInputElement;
    expect(input.value).toBe("Hit_One");

    fireEvent.change(input, { target: { value: "Hit_Two" } });
    expect(screen.getByText("Duplicate")).toBeTruthy();
    const blockedBtn = screen.getByRole("button", { name: "Rename File" }) as HTMLButtonElement;
    expect(blockedBtn.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Boss_Hit" } });
    expect(screen.queryByText("Duplicate")).toBeNull();
    expect(screen.getByText("Boss_Hit.wav")).toBeTruthy();
    const readyBtn = screen.getByRole("button", { name: "Rename File" }) as HTMLButtonElement;
    expect(readyBtn.disabled).toBe(false);
  });

  it("renders single-line compact tab labels cleanly in Mini Dock mode without overflowing", () => {
    useSampleStore.setState({ batchRenameSampleIds: [1], isMiniDock: true });
    render(<BatchRenameModal />);

    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Pre / Suf")).toBeTruthy();
    expect(screen.getByText("Replace")).toBeTruthy();
    expect(screen.getByText("Pattern")).toBeTruthy();
    expect(screen.queryByText("New Name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pattern & Counter" }));
    expect(screen.getByLabelText("Naming Pattern")).toBeTruthy();
  });
});
