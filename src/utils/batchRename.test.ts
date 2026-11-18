import { describe, expect, it } from "vitest";
import type { SampleItem } from "../types";
import {
  buildBatchRenamePreview,
  DEFAULT_BATCH_RENAME_CONFIG,
} from "./batchRename";

function makeSample(
  id: number,
  fileName: string,
  folder = "F:/SFX/Drums",
  libraryId = 1,
  extra?: Partial<SampleItem>
): SampleItem {
  return {
    id,
    library_id: libraryId,
    file_path: `${folder}/${fileName}`,
    file_name: fileName,
    folder_path: folder,
    extension: fileName.split(".").pop() || "wav",
    duration_ms: 450,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 4096,
    is_favorite: false,
    is_loop: false,
    artist: "",
    album: "",
    year: "",
    genre: "Synth",
    bpm: 128,
    musical_key: "Am",
    camelot_key: "8A",
    peaks_json: "[]",
    created_at: "2026-11-13",
    tags: [],
    ...extra,
  };
}

describe("batchRename utilities", () => {
  it("supports Add First (prefix) & Add Last (suffix) cleanly", () => {
    const samples = [makeSample(1, "kick.wav"), makeSample(2, "snare.wav")];
    const res = buildBatchRenamePreview(samples, {
      ...DEFAULT_BATCH_RENAME_CONFIG,
      mode: "add",
      prefix: "SFX_",
      suffix: "_v1",
      caseMode: "lower",
    });

    expect(res.canApply).toBe(true);
    expect(res.changedCount).toBe(2);
    expect(res.rows.map((r) => r.newFileName)).toEqual([
      "sfx_kick_v1.wav",
      "sfx_snare_v1.wav",
    ]);
  });

  it("blocks duplicate target collisions unless autoDisambiguate is enabled", () => {
    const samples = [makeSample(1, "kick_a.wav"), makeSample(2, "kick_b.wav")];
    const colliding = buildBatchRenamePreview(samples, {
      ...DEFAULT_BATCH_RENAME_CONFIG,
      mode: "pattern",
      pattern: "Kick",
      autoDisambiguate: false,
    });

    expect(colliding.canApply).toBe(false);
    expect(colliding.collisionCount).toBe(2);
    expect(colliding.rows.every((r) => r.status === "duplicate")).toBe(true);

    const resolved = buildBatchRenamePreview(samples, {
      ...DEFAULT_BATCH_RENAME_CONFIG,
      mode: "pattern",
      pattern: "Kick",
      autoDisambiguate: true,
      zeroPad: 2,
    });

    expect(resolved.canApply).toBe(true);
    expect(resolved.collisionCount).toBe(0);
    expect(resolved.rows.map((r) => r.newFileName)).toEqual([
      "Kick_01.wav",
      "Kick_02.wav",
    ]);
  });

  it("detects Windows case-insensitive collisions against non-selected files in the same folder", () => {
    const selected = [makeSample(1, "Bass_01.wav")];
    const existingOther = makeSample(99, "sub.wav");

    const res = buildBatchRenamePreview(
      selected,
      {
        ...DEFAULT_BATCH_RENAME_CONFIG,
        mode: "replace",
        find: "Bass_01",
        replaceWith: "SUB",
      },
      { catalogSamples: [...selected, existingOther] }
    );

    expect(res.canApply).toBe(false);
    expect(res.collisionCount).toBe(1);
    expect(res.rows[0].status).toBe("duplicate");
  });

  it("expands pattern tokens ({folder}, {bpm}, {key}, {n}) and respects Read-Only Vaults", () => {
    const samples = [
      makeSample(1, "a.wav", "F:/Packs/Whoosh"),
      makeSample(2, "b.wav", "F:/Packs/Vault", 2),
    ];

    const res = buildBatchRenamePreview(
      samples,
      {
        ...DEFAULT_BATCH_RENAME_CONFIG,
        mode: "pattern",
        pattern: "{folder}_{bpm}_{key}_{n:03}",
        startNumber: 5,
        step: 5,
      },
      { readOnlyLibraryIds: new Set([2]) }
    );

    expect(res.canApply).toBe(true);
    expect(res.changedCount).toBe(1);
    expect(res.lockedCount).toBe(1);
    expect(res.rows[0].newFileName).toBe("Whoosh_128_Am_005.wav");
    expect(res.rows[1].status).toBe("vault_locked");
    expect(res.rows[1].newFileName).toBe("b.wav");
  });

  it("marks empty or reserved Windows device stems as invalid and prevents Apply", () => {
    const samples = [makeSample(1, "hihat.wav")];
    const res = buildBatchRenamePreview(samples, {
      ...DEFAULT_BATCH_RENAME_CONFIG,
      mode: "replace",
      find: "hihat",
      replaceWith: "CON",
    });

    expect(res.canApply).toBe(false);
    expect(res.invalidCount).toBe(1);
    expect(res.rows[0].status).toBe("invalid");
  });

  it("supports direct single-file rename mode with collision safeguard against sibling files", () => {
    const target = makeSample(1, "take_01.wav", "F:/Packs/Hits");
    const sibling = makeSample(2, "MainHit.wav", "F:/Packs/Hits");

    const blocked = buildBatchRenamePreview(
      [target],
      {
        ...DEFAULT_BATCH_RENAME_CONFIG,
        mode: "direct",
        directStem: "  mainhit  ",
        trimSpaces: true,
        caseMode: "title",
      },
      { catalogSamples: [target, sibling] }
    );
    expect(blocked.rows[0].newFileName).toBe("Mainhit.wav");
    expect(blocked.rows[0].status).toBe("duplicate");
    expect(blocked.canApply).toBe(false);

    const safe = buildBatchRenamePreview(
      [target],
      {
        ...DEFAULT_BATCH_RENAME_CONFIG,
        mode: "direct",
        directStem: "Boss Impact",
      },
      { catalogSamples: [target, sibling] }
    );
    expect(safe.rows[0].newFileName).toBe("Boss Impact.wav");
    expect(safe.rows[0].status).toBe("ready");
    expect(safe.canApply).toBe(true);
  });
});
