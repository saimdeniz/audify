import { invokeCommand } from "../../utils/tauriCommands";
import { isStandaloneSettingsWindow, postCrossWindowSync } from "../storageHelpers";
import type { StoreSliceContext } from "../types";

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
              syncCatalog: !isStandaloneSettingsWindow(),
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
