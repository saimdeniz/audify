import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_STORAGE_KEYS,
  clampAiConfidence,
  clampAiSimilarityScore,
  clampAiSimilarityTopK,
  normalizeAiSimilarityScope,
  normalizeAiTaggingMode,
} from "../constants/aiConfig";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import {
  resolveAiSettingsFields,
  sanitizeAiProfileSettings,
} from "./aiSettingsBridge";
import { applyClientFacetFilters, applySort } from "./filterEngine";
import type { SampleItem, SimilaritySession } from "../types";

const invokeMock = vi.fn();

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
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "./useSampleStore";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/FolderA/Sample_${id}.wav`,
    file_name: `Sample_${id}.wav`,
    folder_path: "D:/SFX/FolderA",
    extension: "wav",
    file_size: 4096,
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
    created_at: "2026-11-13",
    tags: [],
    ...overrides,
  };
}

function makeModelStatusStub(overrides: Record<string, unknown> = {}) {
  return {
    model_id: "yamnet-v1",
    model_name: "YAMNet AudioSet ONNX",
    installed: true,
    runtime_installed: true,
    ready: true,
    model_sha256_ok: true,
    runtime_sha256_ok: true,
    is_custom_model: false,
    model_size_bytes: 15_000_000,
    runtime_size_bytes: 14_000_000,
    model_rel_path: "user/models/yamnet.onnx",
    runtime_rel_path: "user/models/bin/onnxruntime.dll",
    indexed_count: 3,
    total_profile_samples: 3,
    pending_suggestions_count: 0,
    embedding_bytes: 1536,
    embedding_dim: 128,
    last_avg_ms_per_clip: 6.4,
    ...overrides,
  };
}

describe("AI Audio config, settings bridge & filter engine", () => {
  it("clamps confidence, similarity score, Top-K and normalizes enums safely", () => {
    expect(clampAiConfidence(0.1)).toBe(0.25);
    expect(clampAiConfidence(0.99)).toBe(0.98);
    expect(clampAiConfidence(Number.NaN)).toBe(0.72);

    expect(clampAiSimilarityScore(0.2)).toBe(0.35);
    expect(clampAiSimilarityScore(1.5)).toBe(0.95);
    expect(clampAiSimilarityScore("invalid")).toBe(0.7);

    expect(clampAiSimilarityTopK(1)).toBe(10);
    expect(clampAiSimilarityTopK(999)).toBe(500);
    expect(clampAiSimilarityTopK(50)).toBe(50);

    expect(normalizeAiTaggingMode("vectors_only")).toBe("vectors_only");
    expect(normalizeAiTaggingMode("auto_apply")).toBe("auto_apply");
    expect(normalizeAiTaggingMode("unknown")).toBe("suggest");
    expect(normalizeAiSimilarityScope("folder")).toBe("folder");
    expect(normalizeAiSimilarityScope("anything")).toBe("profile");
  });

  it("sanitizes imported profile AI settings against corruption", () => {
    const payload: Record<string, unknown> = {
      aiAutoAnalyzeOnScan: "yes",
      aiTagConfidenceThreshold: 2.5,
      aiTaggingMode: "hacked",
      aiKnnTagLearning: "invalid_bool",
      aiSimilarityMinScore: 0.12,
      aiSimilarityTopK: 9999,
      aiSimilarityScope: "invalid_scope",
      aiSimilarityDurationMatch: "true",
    };
    sanitizeAiProfileSettings(payload);

    expect(payload.aiAutoAnalyzeOnScan).toBeUndefined();
    expect(payload.aiTagConfidenceThreshold).toBe(0.98);
    expect(payload.aiTaggingMode).toBe("suggest");
    expect(payload.aiKnnTagLearning).toBeUndefined();
    expect(payload.aiSimilarityMinScore).toBe(0.35);
    expect(payload.aiSimilarityTopK).toBe(500);
    expect(payload.aiSimilarityScope).toBe("profile");
    expect(payload.aiSimilarityDurationMatch).toBeUndefined();
  });

  it("resolves imported profile similarity TopK, scope, k-NN & durationMatch with storage parity", () => {
    const cur = {
      aiAutoAnalyzeOnScan: false,
      aiTagConfidenceThreshold: 0.72,
      aiTaggingMode: "suggest" as const,
      aiKnnTagLearning: true,
      aiSimilarityMinScore: 0.7,
      aiSimilarityTopK: 100,
      aiSimilarityScope: "profile" as const,
      aiSimilarityDurationMatch: false,
    };
    const resolved = resolveAiSettingsFields(
      {
        aiKnnTagLearning: false,
        aiSimilarityTopK: 200,
        aiSimilarityScope: "folder",
        aiSimilarityDurationMatch: true,
      },
      false,
      cur
    );

    expect(resolved.fields.aiKnnTagLearning).toBe(false);
    expect(resolved.fields.aiSimilarityTopK).toBe(200);
    expect(resolved.fields.aiSimilarityScope).toBe("folder");
    expect(resolved.fields.aiSimilarityDurationMatch).toBe(true);
    expect(resolved.storagePairs).toContainEqual([AI_STORAGE_KEYS.knnTagLearning, "false"]);
    expect(resolved.storagePairs).toContainEqual([AI_STORAGE_KEYS.similarityTopK, "200"]);
    expect(resolved.storagePairs).toContainEqual([AI_STORAGE_KEYS.similarityScope, "folder"]);
    expect(resolved.storagePairs).toContainEqual([AI_STORAGE_KEYS.similarityDurationMatch, "true"]);
  });

  it("filters and sorts similarity matches with anchor pinned on descending match sort", () => {
    const anchor = makeSample(10, { file_name: "Anchor.wav" });
    const strong = makeSample(20, { file_name: "Strong.wav" });
    const mid = makeSample(30, { file_name: "Mid.wav" });
    const weak = makeSample(40, { file_name: "Weak.wav" });
    const unrelated = makeSample(50, { file_name: "Unrelated.wav" });

    const session: SimilaritySession = {
      anchorSample: anchor,
      scoresById: new Map<number, number>([
        [10, 1],
        [20, 0.91],
        [30, 0.74],
        [40, 0.55],
      ]),
      minScore: 0.7,
      topK: 100,
      scope: "profile",
      scopeFolderPath: null,
      durationMatchOnly: false,
      elapsedMs: 1.2,
      scannedVectors: 4,
      prevSortKey: "name",
      prevSortDir: "asc",
    };

    const sortedDesc = applySort([mid, strong, anchor], "match", "desc", session);
    expect(sortedDesc.map((s) => s.id)).toEqual([10, 20, 30]);

    const sortedAsc = applySort([mid, strong, anchor], "match", "asc", session);
    expect(sortedAsc.map((s) => s.id)).toEqual([30, 20, 10]);

    const filtered = applyClientFacetFilters(
      [unrelated, weak, mid, strong, anchor],
      "all",
      null,
      "match",
      "desc",
      session
    );
    expect(filtered.map((s) => s.id)).toEqual([10, 20, 30]);
  });
});

describe("useSampleStore AI slice state transitions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    memoryStorage.clear();

    const s1 = makeSample(1, { file_name: "Laser_01.wav" });
    const s2 = makeSample(2, { file_name: "Laser_02.wav" });
    const s3 = makeSample(3, { file_name: "Snare_01.wav" });

    useSampleStore.setState({
      allProfileSamples: [s1, s2, s3],
      rawSamples: [s1, s2, s3],
      samples: [s1, s2, s3],
      searchQuery: "",
      folderFilter: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      trashFilterActive: false,
      selectedTagIds: [],
      selectedGenre: null,
      typeFilter: "all",
      srFilter: null,
      sortKey: "name",
      sortDir: "asc",
      similaritySession: null,
      aiSimilarityMinScore: 0.7,
      aiSimilarityTopK: 100,
      aiSimilarityScope: "profile",
      aiSuggestionsBySampleId: {},
      pendingAiSuggestionsCount: 0,
      aiModelStatus: makeModelStatusStub(),
    });
  });

  it("cycles match sort descending first without overwriting persisted audify_sort", () => {
    useSampleStore.setState({
      similaritySession: {
        anchorSample: makeSample(1),
        scoresById: new Map([
          [1, 1],
          [2, 0.88],
        ]),
        minScore: 0.7,
        topK: 100,
        scope: "profile",
        scopeFolderPath: null,
        durationMatchOnly: false,
        elapsedMs: 1.0,
        scannedVectors: 3,
        prevSortKey: "name",
        prevSortDir: "asc",
      },
      sortKey: "name",
      sortDir: "asc",
    });

    useSampleStore.getState().cycleSort("match");
    expect(useSampleStore.getState().sortKey).toBe("match");
    expect(useSampleStore.getState().sortDir).toBe("desc");
    expect(memoryStorage.getItem(AUDIFY_STORAGE_KEYS.sort)).toBeNull();

    useSampleStore.getState().cycleSort("match");
    expect(useSampleStore.getState().sortKey).toBe("match");
    expect(useSampleStore.getState().sortDir).toBe("asc");
  });

  it("runs findSimilarSamples and restores previous sort on clearSimilaritySearch", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "find_similar_samples") {
        return Promise.resolve({
          anchor_sample_id: 1,
          matches: [
            { sample_id: 2, score: 0.92 },
            { sample_id: 3, score: 0.76 },
          ],
          elapsed_ms: 0.85,
          scanned_vectors: 3,
        });
      }
      if (cmd === "get_ai_model_status") {
        return Promise.resolve(makeModelStatusStub());
      }
      return Promise.resolve([]);
    });

    const anchor = makeSample(1, { file_name: "Laser_01.wav" });
    await useSampleStore.getState().findSimilarSamples(anchor);

    const stateAfter = useSampleStore.getState();
    expect(stateAfter.similaritySession?.anchorSample.id).toBe(1);
    expect(stateAfter.similaritySession?.scoresById.get(2)).toBe(0.92);
    expect(stateAfter.sortKey).toBe("match");
    expect(stateAfter.sortDir).toBe("desc");
    expect(stateAfter.samples.map((s) => s.id)).toEqual([1, 2, 3]);

    useSampleStore.getState().clearSimilaritySearch();

    const restored = useSampleStore.getState();
    expect(restored.similaritySession).toBeNull();
    expect(restored.sortKey).toBe("name");
    expect(restored.sortDir).toBe("asc");
  });

  it("optimistically dismisses AI tag suggestion and forwards IPC payload", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "resolve_ai_tag_suggestion") return Promise.resolve();
      if (cmd === "get_ai_model_status") {
        return Promise.resolve(makeModelStatusStub({ pending_suggestions_count: 1 }));
      }
      return Promise.resolve([]);
    });

    useSampleStore.setState({
      aiSuggestionsBySampleId: {
        1: [
          {
            sample_id: 1,
            tag_name: "Laser",
            confidence: 0.91,
            model_id: "yamnet-v1",
            status: "pending",
          },
          {
            sample_id: 1,
            tag_name: "Sci-Fi",
            confidence: 0.84,
            model_id: "yamnet-v1",
            status: "pending",
          },
        ],
      },
      pendingAiSuggestionsCount: 2,
    });

    await useSampleStore.getState().resolveAiTagSuggestion(1, "Laser", false);

    const next = useSampleStore.getState();
    expect(next.pendingAiSuggestionsCount).toBe(1);
    expect(next.aiSuggestionsBySampleId[1].map((t) => t.tag_name)).toEqual([
      "Sci-Fi",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("resolve_ai_tag_suggestion", {
      sampleId: 1,
      tagName: "Laser",
      approve: false,
    });
  });

  it("toggles similarity scope & duration match and dismisses pending AI suggestions", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "find_similar_samples") {
        return Promise.resolve({
          anchor_sample_id: 1,
          matches: [{ sample_id: 2, score: 0.91 }],
          elapsed_ms: 0.5,
          scanned_vectors: 3,
        });
      }
      if (cmd === "dismiss_all_ai_tag_suggestions") {
        return Promise.resolve(2);
      }
      if (cmd === "get_ai_model_status") {
        return Promise.resolve(makeModelStatusStub({ pending_suggestions_count: 0 }));
      }
      return Promise.resolve([]);
    });

    const anchor = makeSample(1, { file_name: "Laser_01.wav" });
    await useSampleStore.getState().findSimilarSamples(anchor);
    expect(useSampleStore.getState().similaritySession?.durationMatchOnly).toBe(false);

    useSampleStore.getState().setAiSimilarityDurationMatch(true, true);
    useSampleStore.getState().setAiSimilarityScope("folder", true);
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("find_similar_samples", {
      sampleId: 1,
      minScore: 0.7,
      topK: 100,
      scopeFolderPath: "D:/SFX/FolderA",
      matchSimilarDuration: true,
    });

    await useSampleStore.getState().dismissAllAiTagSuggestions([1, 2]);
    expect(invokeMock).toHaveBeenCalledWith("dismiss_all_ai_tag_suggestions", {
      sampleIds: [1, 2],
    });
  });

  it("wires personal k-NN learning flag into analyze_samples_ai and standalone suggest_knn_ai_tags", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "analyze_samples_ai" || cmd === "suggest_knn_ai_tags") {
        return Promise.resolve({
          processed: 2,
          indexed: 2,
          suggestions_added: 3,
          tags_auto_applied: 0,
          canceled: false,
          avg_ms_per_clip: 0.4,
        });
      }
      if (cmd === "get_ai_model_status") {
        return Promise.resolve(makeModelStatusStub({ pending_suggestions_count: 3 }));
      }
      return Promise.resolve([]);
    });

    useSampleStore.getState().setAiKnnTagLearning(false);
    expect(useSampleStore.getState().aiKnnTagLearning).toBe(false);
    await useSampleStore.getState().analyzeSamplesAi({ sampleIds: [1, 2] });
    expect(invokeMock).toHaveBeenCalledWith(
      "analyze_samples_ai",
      expect.objectContaining({
        sampleIds: [1, 2],
        knnLearning: false,
      })
    );

    useSampleStore.getState().setAiKnnTagLearning(true);
    useSampleStore.getState().setAiTaggingMode("suggest");
    await useSampleStore.getState().runKnnTagLearning([1, 2]);
    expect(invokeMock).toHaveBeenCalledWith("suggest_knn_ai_tags", {
      sampleIds: [1, 2],
      confidenceThreshold: useSampleStore.getState().aiTagConfidenceThreshold,
      taggingMode: "suggest",
    });
  });

  it("uses expected AI storage key prefix constants", () => {
    for (const key of Object.values(AI_STORAGE_KEYS)) {
      expect(key.startsWith("audify_ai_")).toBe(true);
    }
  });

  it("merges scoped fetchAiTagSuggestions updates without wiping existing rows or capping >5k totals", async () => {
    useSampleStore.setState({
      activeProfile: {
        id: 1,
        name: "Default",
        color: "#22d3ee",
        settings_json: "{}",
        is_active: true,
        created_at: "2026-01-01",
      },
      aiSuggestionsBySampleId: {
        1: [
          {
            sample_id: 1,
            tag_name: "old_tag",
            confidence: 0.72,
            model_id: "yamnet-v1",
            status: "pending",
          },
        ],
        99: [
          {
            sample_id: 99,
            tag_name: "keep_me",
            confidence: 0.9,
            model_id: "knn-v1",
            status: "pending",
          },
        ],
      },
      pendingAiSuggestionsCount: 5500,
    });

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_ai_tag_suggestions" && Array.isArray(args?.sampleIds)) {
        return Promise.resolve([
          {
            sample_id: 1,
            tag_name: "laser",
            confidence: 0.88,
            model_id: "knn-v1",
            status: "pending",
          },
          {
            sample_id: 1,
            tag_name: "zap",
            confidence: 0.84,
            model_id: "knn-v1",
            status: "pending",
          },
        ]);
      }
      if (cmd === "suggest_knn_ai_tags") {
        return Promise.resolve({
          processed: 1,
          indexed: 1,
          suggestions_added: 2,
          tags_auto_applied: 0,
          canceled: false,
          avg_ms_per_clip: 0.2,
        });
      }
      if (cmd === "get_ai_model_status") {
        return Promise.resolve(makeModelStatusStub({ pending_suggestions_count: 5501 }));
      }
      return Promise.resolve([]);
    });

    await useSampleStore.getState().fetchAiTagSuggestions([1]);

    expect(invokeMock).toHaveBeenCalledWith("get_ai_tag_suggestions", {
      status: "pending",
      sampleIds: [1],
    });
    const state = useSampleStore.getState();
    expect(state.aiSuggestionsBySampleId[99]?.map((s) => s.tag_name)).toEqual(["keep_me"]);
    expect(state.aiSuggestionsBySampleId[1]?.map((s) => s.tag_name)).toEqual([
      "laser",
      "zap",
    ]);
    expect(state.pendingAiSuggestionsCount).toBe(5501);

    invokeMock.mockClear();
    await useSampleStore.getState().runKnnTagLearning([1]);
    expect(invokeMock).toHaveBeenCalledWith("get_ai_tag_suggestions", {
      status: "pending",
      sampleIds: [1],
    });

    const fullCappedRows = Array.from({ length: 5000 }, (_, i) => ({
      sample_id: i + 1,
      tag_name: "hit",
      confidence: 0.8,
      model_id: "yamnet-v1",
      status: "pending",
    }));
    invokeMock.mockImplementationOnce((cmd: string) => {
      if (cmd === "get_ai_tag_suggestions") return Promise.resolve(fullCappedRows);
      return Promise.resolve([]);
    });
    useSampleStore.setState({ pendingAiSuggestionsCount: 12345 });
    await useSampleStore.getState().fetchAiTagSuggestions();
    expect(useSampleStore.getState().pendingAiSuggestionsCount).toBe(12345);
  });

  it("skips heavy sample and suggestion loads in standalone Settings window", async () => {
    useSampleStore.setState({
      activeProfile: {
        id: 1,
        name: "Default",
        color: "#22d3ee",
        settings_json: "{}",
        is_active: true,
        created_at: "2026-01-01",
      },
    });
    const prevWindow = typeof window === "undefined" ? undefined : window;
    vi.stubGlobal("window", {
      ...(prevWindow ?? {}),
      location: { search: "?window=settings" },
    });
    try {
      invokeMock.mockClear();
      await useSampleStore.getState().fetchAiTagSuggestions();
      await useSampleStore.getState().reloadProfileSamples();
      expect(invokeMock).not.toHaveBeenCalledWith(
        "get_ai_tag_suggestions",
        expect.anything()
      );
      expect(invokeMock).not.toHaveBeenCalledWith(
        "query_samples",
        expect.anything()
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps similaritySession active when returning to All Files via selectAllFiles, while resetAllFilters clears it", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "find_similar_samples") {
        return Promise.resolve({
          anchor_sample_id: 1,
          matches: [
            { sample_id: 2, score: 0.92 },
            { sample_id: 3, score: 0.81 },
          ],
          elapsed_ms: 0.8,
          scanned_vectors: 3,
        });
      }
      return Promise.resolve([]);
    });

    const s1 = makeSample(1, { file_name: "Anchor.wav", folder_path: "D:/SFX/FolderA" });
    const s2 = makeSample(2, { file_name: "MatchA.wav", folder_path: "D:/SFX/FolderA" });
    const s3 = makeSample(3, { file_name: "MatchB.wav", folder_path: "D:/SFX/FolderB" });
    useSampleStore.setState({
      allProfileSamples: [s1, s2, s3],
      rawSamples: [s1, s2, s3],
      samples: [s1, s2, s3],
      sortKey: "name",
      sortDir: "asc",
    });

    await useSampleStore.getState().findSimilarSamples(s1);
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([1, 2, 3]);

    // Filter down to FolderB while Similarity Search is active
    useSampleStore.getState().setFolderFilter("D:/SFX/FolderB");
    expect(useSampleStore.getState().folderFilter).toBe("D:/SFX/FolderB");
    expect(useSampleStore.getState().samples.map((s) => s.id)).toEqual([3]);

    // Clicking sidebar "All Files" (`selectAllFiles`) returns to full profile matches without closing Similarity
    useSampleStore.getState().selectAllFiles();
    const afterAllFiles = useSampleStore.getState();
    expect(afterAllFiles.folderFilter).toBeNull();
    expect(afterAllFiles.similaritySession?.anchorSample.id).toBe(1);
    expect(afterAllFiles.sortKey).toBe("match");
    expect(afterAllFiles.samples.map((s) => s.id)).toEqual([1, 2, 3]);

    // Explicit "Reset all active filters" (`resetAllFilters`) exits Similarity and restores previous sort
    useSampleStore.getState().resetAllFilters();
    const afterReset = useSampleStore.getState();
    expect(afterReset.similaritySession).toBeNull();
    expect(afterReset.sortKey).toBe("name");
    expect(afterReset.samples.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});
