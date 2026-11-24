import { invoke } from "@tauri-apps/api/core";
import {
  clampAiSimilarityScore,
  clampAiSimilarityTopK,
  normalizeAiSimilarityScope,
} from "../../constants/aiConfig";
import type {
  AiSimilarityScope,
  ExternalSimilaritySearchResult,
  SampleItem,
  SimilaritySession,
} from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import type { StoreSliceContext } from "../types";

export interface ExternalAudioSimilarityInput {
  probeId?: string;
  filePath?: string;
  fileName: string;
  rawBytes?: Uint8Array;
}

export interface SimilaritySearchOverrides {
  minScore?: number;
  topK?: number;
  scope?: AiSimilarityScope;
  durationMatchOnly?: boolean;
}

export interface SimilaritySeqTracker {
  bump: () => number;
  current: () => number;
}

export function buildExternalAnchorSample(
  fileName: string,
  filePath: string | undefined,
  durationMs: number
): SampleItem {
  const dotIdx = fileName.lastIndexOf(".");
  const ext = dotIdx > 0 ? fileName.slice(dotIdx + 1).toLowerCase() : "";
  return {
    id: -1,
    library_id: 0,
    file_path: filePath || fileName,
    file_name: fileName,
    folder_path: "",
    extension: ext,
    duration_ms: Math.max(0, durationMs),
    sample_rate: 0,
    channels: 0,
    bit_depth: 0,
    file_size: 0,
    is_favorite: false,
    is_loop: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    peaks_json: "[]",
    created_at: "",
    tags: [],
  };
}

export async function runFindSimilarSamples(
  ctx: StoreSliceContext,
  seq: SimilaritySeqTracker,
  anchor: SampleItem,
  overrides?: SimilaritySearchOverrides
): Promise<void> {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;
  const reqSeq = seq.bump();
  const epoch = ctx.getProfileEpoch();
  const minScore = clampAiSimilarityScore(
    overrides?.minScore ?? get().aiSimilarityMinScore
  );
  const topK = clampAiSimilarityTopK(overrides?.topK ?? get().aiSimilarityTopK);
  const scope = normalizeAiSimilarityScope(
    overrides?.scope ?? get().aiSimilarityScope
  );
  const durationMatchOnly =
    overrides?.durationMatchOnly ?? get().aiSimilarityDurationMatch;
  const scopeFolderPath = scope === "folder" ? anchor.folder_path : null;

  try {
    const res = await invokeCommand("find_similar_samples", {
      sampleId: anchor.id,
      minScore,
      topK,
      scopeFolderPath,
      matchSimilarDuration: durationMatchOnly,
    });
    if (reqSeq !== seq.current() || epoch !== ctx.getProfileEpoch()) {
      return;
    }

    const scoresById = new Map<number, number>();
    scoresById.set(anchor.id, 1);
    for (const m of res.matches) {
      scoresById.set(m.sample_id, m.score);
    }

    const existing = get().similaritySession;
    const prevSortKey = existing ? existing.prevSortKey : get().sortKey;
    const prevSortDir = existing ? existing.prevSortDir : get().sortDir;

    const nextSession: SimilaritySession = {
      anchorSample: anchor,
      scoresById,
      minScore,
      topK,
      scope,
      scopeFolderPath,
      durationMatchOnly,
      elapsedMs: res.elapsed_ms,
      scannedVectors: res.scanned_vectors,
      prevSortKey,
      prevSortDir,
    };

    set({
      similaritySession: nextSession,
      trashFilterActive: false,
      slicesFilterActive: false,
      duplicatesFilterActive: false,
      sortKey: "match",
      sortDir: "desc",
      statusMessage: `Found ${res.matches.length} similar sounds (${res.elapsed_ms.toFixed(1)} ms)`,
    });

    if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
      await get().fetchSamples({ preserveMultiSelect: false });
    }
    void get().fetchAiModelStatus();
  } catch (err) {
    if (reqSeq !== seq.current() || epoch !== ctx.getProfileEpoch()) {
      return;
    }
    emitNotice(`Similarity search failed: ${String(err)}`, "error");
  }
}

export async function runFindSimilarByExternalAudio(
  ctx: StoreSliceContext,
  seq: SimilaritySeqTracker,
  input: ExternalAudioSimilarityInput,
  overrides?: Omit<SimilaritySearchOverrides, "scope">
): Promise<void> {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;
  const reqSeq = seq.bump();
  const epoch = ctx.getProfileEpoch();
  const minScore = clampAiSimilarityScore(
    overrides?.minScore ?? get().aiSimilarityMinScore
  );
  const topK = clampAiSimilarityTopK(overrides?.topK ?? get().aiSimilarityTopK);
  const durationMatchOnly =
    overrides?.durationMatchOnly ?? get().aiSimilarityDurationMatch;

  if (!input.probeId) {
    set({
      externalSimilarityPendingFile: input.fileName,
      statusMessage: `Analyzing "${input.fileName}" for acoustic similarity...`,
    });
  }

  try {
    const res: ExternalSimilaritySearchResult =
      input.rawBytes && input.rawBytes.byteLength > 0
        ? await invoke<ExternalSimilaritySearchResult>(
            "find_similar_samples_by_external_audio_raw",
            input.rawBytes,
            {
              headers: {
                "x-file-name": encodeURIComponent(input.fileName),
                "x-min-score": String(minScore),
                "x-top-k": String(topK),
                "x-match-duration": durationMatchOnly ? "1" : "0",
              },
            }
          )
        : await invokeCommand("find_similar_samples_by_external_audio", {
            probeId: input.probeId ?? null,
            filePath: input.filePath ?? null,
            fileName: input.fileName,
            bytes: null,
            minScore,
            topK,
            scopeFolderPath: null,
            matchSimilarDuration: durationMatchOnly,
          });
    if (reqSeq !== seq.current() || epoch !== ctx.getProfileEpoch()) {
      return;
    }

    const scoresById = new Map<number, number>();
    for (const m of res.matches) {
      scoresById.set(m.sample_id, m.score);
    }

    const existing = get().similaritySession;
    const prevSortKey = existing ? existing.prevSortKey : get().sortKey;
    const prevSortDir = existing ? existing.prevSortDir : get().sortDir;

    const anchorSample = buildExternalAnchorSample(
      res.file_name,
      input.filePath,
      res.anchor_duration_ms
    );

    const nextSession: SimilaritySession = {
      anchorSample,
      externalSource: {
        probeId: res.probe_id,
        fileName: res.file_name,
        filePath: input.filePath,
        durationMs: res.anchor_duration_ms,
      },
      scoresById,
      minScore,
      topK,
      scope: "profile",
      scopeFolderPath: null,
      durationMatchOnly,
      elapsedMs: res.elapsed_ms,
      scannedVectors: res.scanned_vectors,
      prevSortKey,
      prevSortDir,
    };

    set({
      similaritySession: nextSession,
      externalSimilarityPendingFile: null,
      trashFilterActive: false,
      slicesFilterActive: false,
      duplicatesFilterActive: false,
      sortKey: "match",
      sortDir: "desc",
      statusMessage: `Found ${res.matches.length} similar sounds for "${res.file_name}" (${res.elapsed_ms.toFixed(1)} ms)`,
    });

    if (res.scanned_vectors === 0) {
      emitNotice(
        "No AI-indexed samples in active profile yet — analyze your library in Settings → AI first.",
        "info"
      );
    }

    if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
      await get().fetchSamples({ preserveMultiSelect: false });
    }
    void get().fetchAiModelStatus();
  } catch (err) {
    if (reqSeq !== seq.current() || epoch !== ctx.getProfileEpoch()) {
      return;
    }
    set({ externalSimilarityPendingFile: null });
    emitNotice(`External similarity search failed: ${String(err)}`, "error");
  } finally {
    if (
      reqSeq === seq.current() &&
      get().externalSimilarityPendingFile !== null
    ) {
      set({ externalSimilarityPendingFile: null });
    }
  }
}
