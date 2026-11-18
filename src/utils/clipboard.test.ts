import { describe, expect, it } from "vitest";
import { SampleItem } from "../types";
import {
  formatPathsForClipboard,
  resolveTargetSamples,
  toOsDisplayPath,
} from "./clipboard";
import { resolveSamplesByIds } from "./sampleLookup";

function makeSample(id: number, file_path: string): SampleItem {
  return {
    id,
    library_id: 1,
    file_path,
    file_name: `${id}.wav`,
    folder_path: "F:/data/sounds",
    extension: "wav",
    duration_ms: 1000,
    sample_rate: 44100,
    channels: 2,
    bit_depth: 16,
    file_size: 1024,
    is_favorite: false,
    is_loop: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    peaks_json: "[]",
    created_at: "2026-11-15 10:00:00",
    tags: [],
  };
}

describe("clipboard path utilities", () => {
  it("converts Windows drive forward-slash paths to backslashes cleanly", () => {
    expect(toOsDisplayPath("F:/data/sounds/sfx/0.wav")).toBe(
      "F:\\data\\sounds\\sfx\\0.wav"
    );
    expect(toOsDisplayPath("c:/temp/kick.wav")).toBe("c:\\temp\\kick.wav");
    expect(toOsDisplayPath("c1:/not-a-drive/kick.wav")).toBe(
      "c1:/not-a-drive/kick.wav"
    );
    expect(toOsDisplayPath("/Volumes/Audio/kick.wav")).toBe(
      "/Volumes/Audio/kick.wav"
    );
  });

  it("deduplicates and joins multiple sample paths with newlines", () => {
    expect(
      formatPathsForClipboard([
        "F:/Audio/kick.wav",
        "F:/Audio/snare.wav",
        "F:/Audio/kick.wav",
      ])
    ).toBe("F:\\Audio\\kick.wav\nF:\\Audio\\snare.wav");
  });

  it("resolves target samples in priority order: explicit > multi-select > selected", () => {
    const s1 = makeSample(1, "F:/Audio/a.wav");
    const s2 = makeSample(2, "F:/Audio/b.wav");
    const s3 = makeSample(3, "F:/Audio/c.wav");

    expect(resolveTargetSamples([s1, s2, s3], [s1, s2], [1, 2], s3, [s3])).toEqual([
      s3,
    ]);
    expect(resolveTargetSamples([s1, s2, s3], [s1, s2], [2, 1], s3)).toEqual([
      s2,
      s1,
    ]);
    expect(resolveTargetSamples([s1, s2], [s1, s2], [], s2)).toEqual([s2]);
    expect(resolveTargetSamples([s1], [s1], [], null)).toEqual([]);
  });

  it("resolves ordered samples by ID with primary list precedence over fallback", () => {
    const s1Primary = makeSample(1, "F:/Audio/primary.wav");
    const s1Fallback = makeSample(1, "F:/Audio/stale.wav");
    const s2 = makeSample(2, "F:/Audio/b.wav");
    const s3 = makeSample(3, "F:/Audio/c.wav");

    expect(
      resolveSamplesByIds([3, 1, 99], [s1Primary, s2], [s1Fallback, s3])
    ).toEqual([s3, s1Primary]);
    expect(resolveSamplesByIds([], [s1Primary])).toEqual([]);
  });
});
