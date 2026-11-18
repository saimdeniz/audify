import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { invokeCommand, normalizeSampleIds } from "./tauriCommands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("tauriCommands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("normalizeSampleIds deduplicates and filters invalid IDs preserving order", () => {
    expect(normalizeSampleIds(null)).toEqual([]);
    expect(normalizeSampleIds(undefined)).toEqual([]);
    expect(normalizeSampleIds([])).toEqual([]);
    expect(normalizeSampleIds([5, 2, 5, 0, -1, Number.NaN, 1.5, 9, 2])).toEqual([
      5, 2, 9,
    ]);
  });

  it("invokeCommand normalizes sampleIds before delegating to Tauri invoke", async () => {
    invokeMock.mockResolvedValueOnce({ "1": "peaks", "3": "peaks2" });

    const res = await invokeCommand("get_sample_peaks", {
      sampleIds: [1, 1, -4, 3],
    });

    expect(res).toEqual({ "1": "peaks", "3": "peaks2" });
    expect(invokeMock).toHaveBeenCalledWith("get_sample_peaks", {
      sampleIds: [1, 3],
    });
  });

  it("invokeCommand preserves explicit null sampleIds and non-sampleIds payloads", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await invokeCommand("stage_dropped_audio_files", {
      files: [{ file_name: "kick.wav", bytes: [1, 2, 3] }],
    });
    expect(invokeMock).toHaveBeenCalledWith("stage_dropped_audio_files", {
      files: [{ file_name: "kick.wav", bytes: [1, 2, 3] }],
    });

    invokeMock.mockResolvedValueOnce(undefined);
    await invokeCommand("toggle_favorites_batch", {
      sampleIds: null,
      favorite: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("toggle_favorites_batch", {
      sampleIds: null,
      favorite: true,
    });
  });
});
