import {
  AI_STORAGE_KEYS,
  clampAiConfidence,
  clampAiSimilarityScore,
  clampAiSimilarityTopK,
  normalizeAiSimilarityScope,
  normalizeAiTaggingMode,
} from "../../constants/aiConfig";
import type {
  AiModelStatus,
  AiSimilarityScope,
  AiTagSuggestionItem,
  AiTaggingMode,
  SampleItem,
  SimilaritySession,
} from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  isStandaloneSettingsWindow,
  postCrossWindowSync,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";
import type { AiModelLifecycleActions } from "./aiModelLifecycle";

export interface AiSliceActions {
  fetchAiModelStatus: () => Promise<AiModelStatus | null>;
  verifyAiModelIntegrity: () => Promise<void>;
  downloadAiModel: () => Promise<void>;
  cancelAiDownload: () => Promise<void>;
  importAiModelFile: (kind: "onnx" | "runtime_dll") => Promise<void>;
  removeAiModel: (opts?: {
    includeRuntime?: boolean;
    clearAiData?: boolean;
  }) => Promise<void>;
  setAiAutoAnalyzeOnScan: (enabled: boolean) => void;
  setAiTagConfidenceThreshold: (val: number) => void;
  setAiTaggingMode: (mode: AiTaggingMode) => void;
  setAiKnnTagLearning: (enabled: boolean) => void;
  setAiSimilarityMinScore: (score: number, reRunActiveSearch?: boolean) => void;
  setAiSimilarityTopK: (topK: number) => void;
  setAiSimilarityScope: (
    scope: AiSimilarityScope,
    reRunActiveSearch?: boolean
  ) => void;
  setAiSimilarityDurationMatch: (
    enabled: boolean,
    reRunActiveSearch?: boolean
  ) => void;
  analyzeSamplesAi: (opts?: {
    sampleIds?: number[];
    reanalyzeExisting?: boolean;
    silentIfNotReady?: boolean;
  }) => Promise<void>;
  runKnnTagLearning: (sampleIds?: number[]) => Promise<void>;
  cancelAiAnalysis: () => Promise<void>;
  fetchAiTagSuggestions: (sampleIds?: number[]) => Promise<void>;
  findSimilarSamples: (
    anchor: SampleItem,
    overrides?: {
      minScore?: number;
      topK?: number;
      scope?: AiSimilarityScope;
      durationMatchOnly?: boolean;
    }
  ) => Promise<void>;
  clearSimilaritySearch: () => void;
  resolveAiTagSuggestion: (
    sampleId: number,
    tagName: string,
    approve: boolean
  ) => Promise<void>;
  approveAllAiTagSuggestions: (sampleIds?: number[]) => Promise<void>;
  dismissAllAiTagSuggestions: (sampleIds?: number[]) => Promise<void>;
}

let similarityRefetchTimer: ReturnType<typeof setTimeout> | null = null;
let similaritySearchSeq = 0;
let aiSuggestionsSeq = 0;

export function invalidateAiSliceAsyncState(): void {
  similaritySearchSeq += 1;
  aiSuggestionsSeq += 1;
  if (similarityRefetchTimer !== null) {
    clearTimeout(similarityRefetchTimer);
    similarityRefetchTimer = null;
  }
}

function groupSuggestionsBySample(
  items: AiTagSuggestionItem[]
): Record<number, AiTagSuggestionItem[]> {
  const map: Record<number, AiTagSuggestionItem[]> = {};
  for (const item of items) {
    if (!map[item.sample_id]) {
      map[item.sample_id] = [item];
    } else {
      map[item.sample_id].push(item);
    }
  }
  return map;
}

export function createAiSlice(ctx: StoreSliceContext): AiSliceActions {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  let cachedLifecycle: AiModelLifecycleActions | null = null;
  const loadLifecycle = async (): Promise<AiModelLifecycleActions> => {
    if (!cachedLifecycle) {
      const mod = await import("./aiModelLifecycle");
      cachedLifecycle = mod.createAiModelLifecycleActions(ctx);
    }
    return cachedLifecycle;
  };

  return {
    fetchAiModelStatus: async () => (await loadLifecycle()).fetchAiModelStatus(),
    verifyAiModelIntegrity: async () =>
      (await loadLifecycle()).verifyAiModelIntegrity(),
    downloadAiModel: async () => (await loadLifecycle()).downloadAiModel(),
    cancelAiDownload: async () => (await loadLifecycle()).cancelAiDownload(),
    importAiModelFile: async (kind) =>
      (await loadLifecycle()).importAiModelFile(kind),
    removeAiModel: async (opts) => (await loadLifecycle()).removeAiModel(opts),

    setAiAutoAnalyzeOnScan: (enabled) => {
      safeSetItem(AI_STORAGE_KEYS.autoAnalyzeOnScan, String(enabled));
      set({ aiAutoAnalyzeOnScan: enabled });
      void get().persistActiveProfileSettings();
    },

    setAiTagConfidenceThreshold: (val) => {
      const clamped = clampAiConfidence(val);
      safeSetItem(AI_STORAGE_KEYS.tagConfidenceThreshold, String(clamped));
      set({ aiTagConfidenceThreshold: clamped });
      void get().persistActiveProfileSettings();
    },

    setAiTaggingMode: (mode) => {
      const clean = normalizeAiTaggingMode(mode);
      safeSetItem(AI_STORAGE_KEYS.taggingMode, clean);
      set({ aiTaggingMode: clean });
      void get().persistActiveProfileSettings();
    },

    setAiKnnTagLearning: (enabled) => {
      safeSetItem(AI_STORAGE_KEYS.knnTagLearning, String(enabled));
      set({ aiKnnTagLearning: enabled });
      void get().persistActiveProfileSettings();
    },

    setAiSimilarityMinScore: (score, reRunActiveSearch = false) => {
      const clamped = clampAiSimilarityScore(score);
      safeSetItem(AI_STORAGE_KEYS.similarityMinScore, String(clamped));
      const activeSession = get().similaritySession;
      set({
        aiSimilarityMinScore: clamped,
        ...(activeSession
          ? { similaritySession: { ...activeSession, minScore: clamped } }
          : {}),
      });

      if (similarityRefetchTimer !== null) {
        clearTimeout(similarityRefetchTimer);
        similarityRefetchTimer = null;
      }

      if (reRunActiveSearch && activeSession) {
        const epoch = ctx.getProfileEpoch();
        similarityRefetchTimer = setTimeout(() => {
          similarityRefetchTimer = null;
          if (epoch !== ctx.getProfileEpoch()) return;
          void get().persistActiveProfileSettings();
          const live = get().similaritySession;
          if (live) {
            void get().findSimilarSamples(live.anchorSample, {
              minScore: clamped,
            });
          }
        }, 120);
      } else {
        void get().persistActiveProfileSettings();
      }
    },

    setAiSimilarityTopK: (topK) => {
      const clamped = clampAiSimilarityTopK(topK);
      safeSetItem(AI_STORAGE_KEYS.similarityTopK, String(clamped));
      set({ aiSimilarityTopK: clamped });
      void get().persistActiveProfileSettings();
    },

    setAiSimilarityScope: (scope, reRunActiveSearch = false) => {
      const clean = normalizeAiSimilarityScope(scope);
      safeSetItem(AI_STORAGE_KEYS.similarityScope, clean);
      const activeSession = get().similaritySession;
      set({ aiSimilarityScope: clean });
      void get().persistActiveProfileSettings();
      if (reRunActiveSearch && activeSession) {
        void get().findSimilarSamples(activeSession.anchorSample, {
          scope: clean,
        });
      }
    },

    setAiSimilarityDurationMatch: (enabled, reRunActiveSearch = false) => {
      const clean = Boolean(enabled);
      safeSetItem(AI_STORAGE_KEYS.similarityDurationMatch, String(clean));
      const activeSession = get().similaritySession;
      set({ aiSimilarityDurationMatch: clean });
      void get().persistActiveProfileSettings();
      if (reRunActiveSearch && activeSession) {
        void get().findSimilarSamples(activeSession.anchorSample, {
          durationMatchOnly: clean,
        });
      }
    },

    analyzeSamplesAi: async (opts) => {
      if (get().isAnalyzingAi) return;
      const epoch = ctx.getProfileEpoch();

      if (opts?.silentIfNotReady) {
        const status =
          get().aiModelStatus ?? (await get().fetchAiModelStatus());
        if (epoch !== ctx.getProfileEpoch() || !status?.ready) return;
      }

      const taggingMode = get().aiTaggingMode;
      set({
        isAnalyzingAi: true,
        aiIndexProgress: {
          processed: 0,
          total: opts?.sampleIds?.length ?? 0,
          percentage: 0,
          current_file: "Preparing ONNX audio analysis...",
          indexed_count: 0,
          tags_suggested: 0,
          avg_ms_per_clip: 0,
        },
        statusMessage: "Running local AI audio analysis...",
      });

      try {
        const summary = await invokeCommand("analyze_samples_ai", {
          sampleIds: opts?.sampleIds ?? null,
          confidenceThreshold: get().aiTagConfidenceThreshold,
          autoApply: taggingMode === "auto_apply",
          taggingMode,
          reanalyzeExisting: opts?.reanalyzeExisting ?? false,
          knnLearning: get().aiKnnTagLearning,
        });
        if (epoch !== ctx.getProfileEpoch()) {
          set({ isAnalyzingAi: false, aiIndexProgress: null });
          return;
        }
        const scopedSampleIds =
          opts?.sampleIds && opts.sampleIds.length > 0 ? opts.sampleIds : undefined;
        await Promise.all([
          get().fetchAiTagSuggestions(scopedSampleIds),
          get().fetchAiModelStatus(),
        ]);
        if (epoch !== ctx.getProfileEpoch()) {
          set({ isAnalyzingAi: false, aiIndexProgress: null });
          return;
        }
        if (summary.tags_auto_applied > 0) {
          await get().refreshAfterCatalogMutation({
            reloadSamples: true,
            syncCatalog: true,
          });
        } else if (summary.indexed > 0 || summary.suggestions_added > 0) {
          postCrossWindowSync("catalog");
        }
        if (epoch !== ctx.getProfileEpoch()) {
          set({ isAnalyzingAi: false, aiIndexProgress: null });
          return;
        }
        const tagSummary =
          taggingMode === "vectors_only"
            ? "similarity vectors only"
            : `${summary.suggestions_added + summary.tags_auto_applied} tags`;
        const msg = summary.canceled
          ? `AI analysis canceled (${summary.indexed} indexed)`
          : summary.indexed === 0
          ? "All active samples are already AI indexed."
          : `AI indexed ${summary.indexed} samples · ${tagSummary} (${summary.avg_ms_per_clip.toFixed(1)} ms/clip)`;
        set({
          isAnalyzingAi: false,
          aiIndexProgress: null,
          statusMessage: msg,
        });
        if (!(opts?.silentIfNotReady && summary.indexed === 0)) {
          emitNotice(msg, "success");
        }
      } catch (err) {
        set({ isAnalyzingAi: false, aiIndexProgress: null });
        if (epoch !== ctx.getProfileEpoch()) return;
        if (!opts?.silentIfNotReady) {
          emitNotice(`AI analysis failed: ${String(err)}`, "error");
        }
      }
    },

    runKnnTagLearning: async (sampleIds) => {
      const { executeKnnTagLearning } = await import("./aiSuggestionActions");
      await executeKnnTagLearning(ctx, sampleIds);
    },

    cancelAiAnalysis: async () => {
      try {
        await invokeCommand("cancel_ai_analysis", {});
      } catch (err) {
        console.error("Failed canceling AI analysis:", err);
      }
    },

    fetchAiTagSuggestions: async (sampleIds) => {
      if (isStandaloneSettingsWindow()) return;
      const scopedIds =
        sampleIds && sampleIds.length > 0 ? sampleIds : undefined;
      const reqSeq = scopedIds ? aiSuggestionsSeq : ++aiSuggestionsSeq;
      const epoch = ctx.getProfileEpoch();
      try {
        const items = await invokeCommand("get_ai_tag_suggestions", {
          status: "pending",
          sampleIds: scopedIds ?? null,
        });
        if (
          epoch !== ctx.getProfileEpoch() ||
          (!scopedIds && reqSeq !== aiSuggestionsSeq)
        ) {
          return;
        }
        if (!Array.isArray(items)) return;
        const grouped = groupSuggestionsBySample(items);

        if (scopedIds) {
          const nextMap = { ...get().aiSuggestionsBySampleId };
          let deltaCount = 0;
          for (const sid of scopedIds) {
            if (nextMap[sid]) {
              deltaCount -= nextMap[sid].length;
              delete nextMap[sid];
            }
          }
          for (const [sidStr, list] of Object.entries(grouped)) {
            const sid = Number(sidStr);
            nextMap[sid] = list;
            deltaCount += list.length;
          }
          set((state) => ({
            aiSuggestionsBySampleId: nextMap,
            pendingAiSuggestionsCount: Math.max(
              0,
              state.pendingAiSuggestionsCount + deltaCount
            ),
          }));
          return;
        }

        set((state) => ({
          aiSuggestionsBySampleId: grouped,
          pendingAiSuggestionsCount:
            items.length < 5000
              ? items.length
              : Math.max(items.length, state.pendingAiSuggestionsCount),
        }));
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return;
        console.error("Failed fetching AI tag suggestions:", err);
      }
    },

    findSimilarSamples: async (anchor, overrides) => {
      const reqSeq = ++similaritySearchSeq;
      const epoch = ctx.getProfileEpoch();
      const minScore = clampAiSimilarityScore(
        overrides?.minScore ?? get().aiSimilarityMinScore
      );
      const topK = clampAiSimilarityTopK(
        overrides?.topK ?? get().aiSimilarityTopK
      );
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
        if (reqSeq !== similaritySearchSeq || epoch !== ctx.getProfileEpoch()) {
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
        const liveMinScore = clampAiSimilarityScore(
          overrides?.minScore ?? existing?.minScore ?? minScore
        );

        const nextSession: SimilaritySession = {
          anchorSample: anchor,
          scoresById,
          minScore: liveMinScore,
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
          sortKey: "match",
          sortDir: "desc",
          statusMessage: `Found ${res.matches.length} similar sounds (${res.elapsed_ms.toFixed(1)} ms)`,
        });

        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          await get().fetchSamples({ preserveMultiSelect: false });
        }
        void get().fetchAiModelStatus();
      } catch (err) {
        if (reqSeq !== similaritySearchSeq || epoch !== ctx.getProfileEpoch()) {
          return;
        }
        emitNotice(`Similarity search failed: ${String(err)}`, "error");
      }
    },

    clearSimilaritySearch: () => {
      similaritySearchSeq += 1;
      if (similarityRefetchTimer !== null) {
        clearTimeout(similarityRefetchTimer);
        similarityRefetchTimer = null;
      }
      const existing = get().similaritySession;
      if (!existing) return;

      const restoredKey =
        existing.prevSortKey === "match" ? null : existing.prevSortKey;
      set({
        similaritySession: null,
        sortKey: restoredKey,
        sortDir: existing.prevSortDir,
        statusMessage: "Cleared acoustic similarity filter",
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    resolveAiTagSuggestion: async (sampleId, tagName, approve) => {
      const curMap = get().aiSuggestionsBySampleId;
      const list = curMap[sampleId] || [];
      const remaining = list.filter(
        (item) => item.tag_name.toLowerCase() !== tagName.toLowerCase()
      );
      const nextMap = { ...curMap };
      if (remaining.length > 0) {
        nextMap[sampleId] = remaining;
      } else {
        delete nextMap[sampleId];
      }
      const nextCount = Math.max(
        0,
        get().pendingAiSuggestionsCount - (list.length - remaining.length)
      );
      set({
        aiSuggestionsBySampleId: nextMap,
        pendingAiSuggestionsCount: nextCount,
      });

      try {
        await invokeCommand("resolve_ai_tag_suggestion", {
          sampleId,
          tagName,
          approve,
        });
        if (approve) {
          await get().refreshAfterCatalogMutation({
            reloadSamples: true,
            syncCatalog: true,
          });
        } else {
          postCrossWindowSync("catalog");
        }
        void get().fetchAiModelStatus();
      } catch (err) {
        await get().fetchAiTagSuggestions();
        emitNotice(`Failed updating AI tag suggestion: ${String(err)}`, "error");
      }
    },

    approveAllAiTagSuggestions: async (sampleIds) => {
      const { runBatchSuggestionMutation } = await import(
        "./aiSuggestionActions"
      );
      await runBatchSuggestionMutation(get, emitNotice, "approve", sampleIds);
    },

    dismissAllAiTagSuggestions: async (sampleIds) => {
      const { runBatchSuggestionMutation } = await import(
        "./aiSuggestionActions"
      );
      await runBatchSuggestionMutation(get, emitNotice, "dismiss", sampleIds);
    },
  };
}
