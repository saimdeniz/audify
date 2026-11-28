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
  AiTaggingMode,
  SampleItem,
} from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import { safeSetItem } from "../storageHelpers";
import type { StoreSliceContext } from "../types";
import type { AiModelLifecycleActions } from "./aiModelLifecycle";
import type {
  ExternalAudioSimilarityInput,
  SimilaritySearchOverrides,
  SimilaritySeqTracker,
} from "./aiSimilarityActions";
import type { AiSeqTracker } from "./aiSuggestionActions";

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
    overrides?: SimilaritySearchOverrides
  ) => Promise<void>;
  findSimilarSamplesByExternalAudio: (
    input: ExternalAudioSimilarityInput,
    overrides?: Omit<SimilaritySearchOverrides, "scope">
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
let aiModelStatusSeq = 0;

const similaritySeqTracker: SimilaritySeqTracker = {
  bump: () => ++similaritySearchSeq,
  current: () => similaritySearchSeq,
};

const aiSuggestionsSeqTracker: AiSeqTracker = {
  bump: () => ++aiSuggestionsSeq,
  current: () => aiSuggestionsSeq,
};

const aiModelStatusSeqTracker: AiSeqTracker = {
  bump: () => ++aiModelStatusSeq,
  current: () => aiModelStatusSeq,
};

export function cancelPendingSimilaritySearch(): void {
  similaritySearchSeq += 1;
  if (similarityRefetchTimer !== null) {
    clearTimeout(similarityRefetchTimer);
    similarityRefetchTimer = null;
  }
}

export function invalidateAiSliceAsyncState(): void {
  cancelPendingSimilaritySearch();
  aiSuggestionsSeq += 1;
  aiModelStatusSeq += 1;
}

export function createAiSlice(ctx: StoreSliceContext): AiSliceActions {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  let cachedSuggestionMod: typeof import("./aiSuggestionActions") | null = null;
  const loadSuggestionMod = async () => {
    if (!cachedSuggestionMod) {
      cachedSuggestionMod = await import("./aiSuggestionActions");
    }
    return cachedSuggestionMod;
  };

  let cachedLifecycle: AiModelLifecycleActions | null = null;
  const loadLifecycle = async (): Promise<AiModelLifecycleActions> => {
    if (!cachedLifecycle) {
      const mod = await import("./aiModelLifecycle");
      cachedLifecycle = mod.createAiModelLifecycleActions(
        ctx,
        cancelPendingSimilaritySearch,
        aiModelStatusSeqTracker
      );
    }
    return cachedLifecycle;
  };

  let cachedSimilarityMod: typeof import("./aiSimilarityActions") | null = null;
  const loadSimilarityMod = async () => {
    if (!cachedSimilarityMod) {
      cachedSimilarityMod = await import("./aiSimilarityActions");
    }
    return cachedSimilarityMod;
  };

  return {
    fetchAiModelStatus: async () => {
      const reqSeq = aiModelStatusSeqTracker.bump();
      const lifecycle = await loadLifecycle();
      if (reqSeq !== aiModelStatusSeqTracker.current()) {
        return null;
      }
      return lifecycle.fetchAiModelStatus();
    },
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
            if (live.externalSource) {
              void get().findSimilarSamplesByExternalAudio(
                {
                  probeId: live.externalSource.probeId,
                  filePath: live.externalSource.filePath,
                  fileName: live.externalSource.fileName,
                },
                { minScore: clamped }
              );
            } else {
              void get().findSimilarSamples(live.anchorSample, {
                minScore: clamped,
              });
            }
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
      if (reRunActiveSearch && activeSession && !activeSession.externalSource) {
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
        if (activeSession.externalSource) {
          void get().findSimilarSamplesByExternalAudio(
            {
              probeId: activeSession.externalSource.probeId,
              filePath: activeSession.externalSource.filePath,
              fileName: activeSession.externalSource.fileName,
            },
            { durationMatchOnly: clean }
          );
        } else {
          void get().findSimilarSamples(activeSession.anchorSample, {
            durationMatchOnly: clean,
          });
        }
      }
    },

    analyzeSamplesAi: async (opts) => {
      if (get().isAnalyzingAi) return;
      const epoch = ctx.getProfileEpoch();
      const mod = cachedSuggestionMod ?? (await loadSuggestionMod());
      await mod.executeAnalyzeSamplesAi(ctx, epoch, opts);
    },

    runKnnTagLearning: async (sampleIds) => {
      const mod = cachedSuggestionMod ?? (await loadSuggestionMod());
      await mod.executeKnnTagLearning(ctx, sampleIds);
    },

    cancelAiAnalysis: async () => {
      try {
        await invokeCommand("cancel_ai_analysis", {});
      } catch (err) {
        console.error("Failed canceling AI analysis:", err);
      }
    },

    fetchAiTagSuggestions: async (sampleIds) => {
      const scopedIds =
        sampleIds && sampleIds.length > 0 ? sampleIds : undefined;
      const reqSeq = scopedIds
        ? aiSuggestionsSeqTracker.current()
        : aiSuggestionsSeqTracker.bump();
      const epoch = ctx.getProfileEpoch();
      const mod = cachedSuggestionMod ?? (await loadSuggestionMod());
      await mod.executeFetchAiTagSuggestions(
        ctx,
        aiSuggestionsSeqTracker,
        reqSeq,
        epoch,
        scopedIds
      );
    },

    findSimilarSamples: async (anchor, overrides) => {
      const mod = cachedSimilarityMod ?? (await loadSimilarityMod());
      await mod.runFindSimilarSamples(
        ctx,
        similaritySeqTracker,
        anchor,
        overrides
      );
    },

    findSimilarSamplesByExternalAudio: async (input, overrides) => {
      const mod = cachedSimilarityMod ?? (await loadSimilarityMod());
      await mod.runFindSimilarByExternalAudio(
        ctx,
        similaritySeqTracker,
        input,
        overrides
      );
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
      aiModelStatusSeqTracker.bump();
      const mod = cachedSuggestionMod ?? (await loadSuggestionMod());
      await mod.executeResolveAiTagSuggestion(ctx, sampleId, tagName, approve);
    },

    approveAllAiTagSuggestions: async (sampleIds) => {
      const mod = cachedSuggestionMod ?? (await loadSuggestionMod());
      await mod.runBatchSuggestionMutation(get, emitNotice, "approve", sampleIds);
    },

    dismissAllAiTagSuggestions: async (sampleIds) => {
      const mod = cachedSuggestionMod ?? (await loadSuggestionMod());
      await mod.runBatchSuggestionMutation(get, emitNotice, "dismiss", sampleIds);
    },
  };
}
