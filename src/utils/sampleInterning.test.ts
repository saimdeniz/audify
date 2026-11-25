import { describe, expect, it } from "vitest";
import type { SampleItem, Tag } from "../types";
import {
  internSamplePool,
  internSamplePoolWithStatus,
} from "./sampleInterning";

function makeWireSample(
  id: number,
  overrides: Partial<SampleItem> = {}
): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/Track_${id}.wav`,
    file_name: `Track_${id}.wav`,
    folder_path: "D:/SFX",
    extension: "wav",
    duration_ms: 1200,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 48000,
    is_favorite: false,
    is_loop: false,
    genre: "Electronic",
    artist: "",
    album: "",
    year: "",
    peaks_json: "",
    created_at: "2026-11-20",
    tags: [],
    ...overrides,
  };
}

describe("sampleInterning compact tag_ids hydration", () => {
  const dict: Tag[] = [
    { id: 1, name: "Impact", color: "#F59E0B", sample_count: 10 },
    { id: 2, name: "Ambient", color: "#38BDF8", sample_count: 5 },
  ];

  it("hydrates compact tag_ids into shared frozen tag arrays and strips tag_ids", () => {
    const s1 = makeWireSample(1, { tags: undefined as unknown as SampleItem["tags"], tag_ids: [2, 1] });
    const s2 = makeWireSample(2, { tags: undefined as unknown as SampleItem["tags"], tag_ids: [2, 1] });
    const s3 = makeWireSample(3, { tags: undefined as unknown as SampleItem["tags"] });

    const res = internSamplePoolWithStatus([s1, s2, s3], dict);
    expect(res.hadMissingTagIds).toBe(false);
    expect(s1.tags).toEqual([
      { id: 2, name: "Ambient", color: "#38BDF8" },
      { id: 1, name: "Impact", color: "#F59E0B" },
    ]);
    // Identical tag combinations share the exact same frozen array instance
    expect(s1.tags).toBe(s2.tags);
    expect(Object.isFrozen(s1.tags)).toBe(true);
    expect(s1.tag_ids).toBeUndefined();
    expect(s2.tag_ids).toBeUndefined();
    // Missing/empty tags wire field resolves to frozen empty array
    expect(s3.tags).toEqual([]);
    expect(Object.isFrozen(s3.tags)).toBe(true);
  });

  it("flags hadMissingTagIds and retains tag_ids for fallback hydration", () => {
    const s1 = makeWireSample(10, { tag_ids: [1, 999] });
    const first = internSamplePoolWithStatus([s1], dict);
    expect(first.hadMissingTagIds).toBe(true);
    expect(s1.tag_ids).toEqual([1, 999]);

    const updatedDict: Tag[] = [
      ...dict,
      { id: 999, name: "NewAutoTag", color: "#10B981", sample_count: 1 },
    ];
    const second = internSamplePoolWithStatus([s1], updatedDict);
    expect(second.hadMissingTagIds).toBe(false);
    expect(s1.tag_ids).toBeUndefined();
    expect(s1.tags.map((t) => t.name)).toEqual(["Impact", "NewAutoTag"]);
  });

  it("never throws TypeError on Pass-2 when mixed with already-frozen Pass-1 rows and keeps valid tags in worker without dictionary", () => {
    const resolvedRow = makeWireSample(1, {
      tags: undefined as unknown as SampleItem["tags"],
      tag_ids: [1, 2],
    });
    const missingRow = makeWireSample(2, {
      tags: undefined as unknown as SampleItem["tags"],
      tag_ids: [1, 999],
    });

    const first = internSamplePoolWithStatus([resolvedRow, missingRow], dict);
    expect(first.hadMissingTagIds).toBe(true);
    expect(Object.isFrozen(resolvedRow.tags)).toBe(true);
    expect(resolvedRow.tag_ids).toBeUndefined();
    expect(missingRow.tag_ids).toEqual([1, 999]);
    // Must not use `delete s.tag_ids` (own property key preserved as undefined for V8 fast shape)
    expect(Object.prototype.hasOwnProperty.call(resolvedRow, "tag_ids")).toBe(
      true
    );

    // Worker pass with NO dictionary must NOT wipe valid tags on rows that still carry unresolved tag_ids
    internSamplePool([resolvedRow, missingRow]);
    expect(missingRow.tags.map((t) => t.name)).toEqual(["Impact"]);
    expect(resolvedRow.tags.map((t) => t.name)).toEqual(["Impact", "Ambient"]);

    // Full Pass-2 (both with and without onlyUnresolvedTagIds) must never throw TypeError on frozen rows
    missingRow.tag_ids = [1, 999];
    const updatedDict: Tag[] = [
      ...dict,
      { id: 999, name: "NewAutoTag", color: "#10B981", sample_count: 1 },
    ];
    expect(() =>
      internSamplePoolWithStatus([resolvedRow, missingRow], updatedDict)
    ).not.toThrow();
    expect(missingRow.tags.map((t) => t.name)).toEqual(["Impact", "NewAutoTag"]);
    expect(resolvedRow.tags.map((t) => t.name)).toEqual(["Impact", "Ambient"]);
  });

  it("keeps non-compact tags payloads deduplicated and frozen", () => {
    const s1 = makeWireSample(1, {
      tags: [{ id: 1, name: "Impact", color: "#F59E0B" }],
    });
    const s2 = makeWireSample(2, {
      tags: [{ id: 1, name: "Impact", color: "#F59E0B" }],
    });
    internSamplePool([s1, s2]);
    expect(s1.tags).toBe(s2.tags);
    expect(s1.tags[0]).toBe(s2.tags[0]);
  });
});
