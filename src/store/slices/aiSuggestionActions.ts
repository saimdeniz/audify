import type { AiTagSuggestionItem } from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import { isStandaloneSettingsWindow, postCrossWindowSync } from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export interface AiSeqTracker {
  bump: () => number;
  current: () => number;
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

export async function executeAnalyzeSamplesAi(
  ctx: StoreSliceContext,
  epoch: number,
  opts?: {
    sampleIds?: number[];
    reanalyzeExisting?: boolean;
    silentIfNotReady?: boolean;
  }
): Promise<void> {
  const { set, get, emitNotice } = ctx;
  if (get().isAnalyzingAi || epoch !== ctx.getProfileEpoch()) return;

  if (opts?.silentIfNotReady) {
    const status = get().aiModelStatus ?? (await get().fetchAiModelStatus());
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
    const skippedSilent = summary.skipped_silent ?? 0;
    const tagSummary =
      taggingMode === "vectors_only"
        ? "similarity vectors only"
        : `${summary.suggestions_added + summary.tags_auto_applied} tags`;
    const silentSuffix =
      skippedSilent > 0 ? ` · ${skippedSilent} silent skipped` : "";
    const msg = summary.canceled
      ? `AI analysis canceled (${summary.indexed} indexed)`
      : summary.indexed === 0
      ? skippedSilent > 0
        ? `All analyzable samples are already AI indexed (${skippedSilent} silent ${skippedSilent === 1 ? "track" : "tracks"} skipped).`
        : "All active samples are already AI indexed."
      : `AI indexed ${summary.indexed} samples · ${tagSummary}${silentSuffix} (${summary.avg_ms_per_clip.toFixed(1)} ms/clip)`;
    set({
      isAnalyzingAi: false,
      aiIndexProgress: null,
      statusMessage: msg,
    });
    if (!(opts?.silentIfNotReady && summary.indexed === 0)) {
      emitNotice(
        msg,
        summary.indexed === 0 && skippedSilent > 0 ? "info" : "success"
      );
    }
  } catch (err) {
    set({ isAnalyzingAi: false, aiIndexProgress: null });
    if (epoch !== ctx.getProfileEpoch()) return;
    if (!opts?.silentIfNotReady) {
      emitNotice(`AI analysis failed: ${String(err)}`, "error");
    }
  }
}

export async function executeFetchAiTagSuggestions(
  ctx: StoreSliceContext,
  seqTracker: AiSeqTracker,
  reqSeq: number,
  epoch: number,
  sampleIds?: number[]
): Promise<void> {
  if (isStandaloneSettingsWindow()) return;
  const { set, get } = ctx;
  const scopedIds = sampleIds && sampleIds.length > 0 ? sampleIds : undefined;
  if (
    epoch !== ctx.getProfileEpoch() ||
    (!scopedIds && reqSeq !== seqTracker.current())
  ) {
    return;
  }
  try {
    const items = await invokeCommand("get_ai_tag_suggestions", {
      status: "pending",
      sampleIds: scopedIds ?? null,
    });
    if (
      epoch !== ctx.getProfileEpoch() ||
      (!scopedIds && reqSeq !== seqTracker.current())
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
}

export async function executeResolveAiTagSuggestion(
  ctx: StoreSliceContext,
  sampleId: number,
  tagName: string,
  approve: boolean
): Promise<void> {
  const { set, get, emitNotice } = ctx;
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
}

/**
 * Runs k-NN acoustic neighbor tag voting over already-indexed 128-dim vectors
 * using the user's own manual (`is_manual = 1`) labels as prototypes.
 */
export async function executeKnnTagLearning(
  ctx: StoreSliceContext,
  sampleIds?: number[]
): Promise<void> {
  const { set, get, emitNotice } = ctx;
  if (get().isAnalyzingAi) return;

  const taggingMode = get().aiTaggingMode;
  if (taggingMode === "vectors_only") {
    emitNotice(
      "Switch AI Tagging Mode from Similarity Only to Suggest or Auto-Apply to run k-NN learning.",
      "info"
    );
    return;
  }

  set({
    isAnalyzingAi: true,
    aiIndexProgress: null,
    statusMessage: "Learning tags from manual labels (k-NN)...",
  });

  try {
    const summary = await invokeCommand("suggest_knn_ai_tags", {
      sampleIds: sampleIds ?? null,
      confidenceThreshold: get().aiTagConfidenceThreshold,
      taggingMode,
    });

    const scopedIds = sampleIds && sampleIds.length > 0 ? sampleIds : undefined;
    await Promise.all([
      get().fetchAiTagSuggestions(scopedIds),
      get().fetchAiModelStatus(),
    ]);

    if (summary.tags_auto_applied > 0) {
      await get().refreshAfterCatalogMutation({
        reloadSamples: true,
        syncCatalog: true,
      });
    } else if (summary.suggestions_added > 0) {
      postCrossWindowSync("catalog");
    }

    const totalTags = summary.suggestions_added + summary.tags_auto_applied;
    const msg =
      totalTags > 0
        ? `k-NN learned ${totalTags} tag(s) across ${summary.indexed} indexed sounds (${summary.avg_ms_per_clip.toFixed(1)} ms/clip).`
        : summary.indexed === 0
        ? "No AI-indexed sounds in scope for k-NN learning."
        : `k-NN checked ${summary.indexed} indexed sounds — no new tag matches found (add manual tags to indexed sounds to teach it).`;

    set({
      isAnalyzingAi: false,
      aiIndexProgress: null,
      statusMessage: msg,
    });
    emitNotice(msg, totalTags > 0 ? "success" : "info");
  } catch (err) {
    set({ isAnalyzingAi: false, aiIndexProgress: null });
    emitNotice(`k-NN tag learning failed: ${String(err)}`, "error");
  }
}

export async function runBatchSuggestionMutation(
  get: StoreSliceContext["get"],
  emitNotice: StoreSliceContext["emitNotice"],
  action: "approve" | "dismiss",
  sampleIds?: number[]
): Promise<void> {
  try {
    const count =
      action === "approve"
        ? await invokeCommand("approve_all_ai_tag_suggestions", {
            sampleIds: sampleIds ?? null,
          })
        : await invokeCommand("dismiss_all_ai_tag_suggestions", {
            sampleIds: sampleIds ?? null,
          });

    const scopedIds = sampleIds && sampleIds.length > 0 ? sampleIds : undefined;
    await Promise.all([
      get().fetchAiTagSuggestions(scopedIds),
      get().fetchAiModelStatus(),
      ...(action === "approve"
        ? [
            get().refreshAfterCatalogMutation({
              reloadSamples: true,
              syncCatalog: true,
            }),
          ]
        : []),
    ]);

    if (action === "dismiss" && isStandaloneSettingsWindow() && count > 0) {
      postCrossWindowSync("catalog");
    }

    const msg =
      action === "approve"
        ? count > 0
          ? `Approved ${count} AI tag suggestion(s) as manual tags.`
          : "No pending AI suggestions to approve."
        : count > 0
        ? `Dismissed ${count} pending AI tag suggestion(s).`
        : "No pending AI suggestions to dismiss.";
    emitNotice(msg, "success");
  } catch (err) {
    const label = action === "approve" ? "approving" : "dismissing";
    emitNotice(`Failed ${label} AI suggestions: ${String(err)}`, "error");
  }
}
