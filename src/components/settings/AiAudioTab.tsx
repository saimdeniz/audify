import React, { useEffect } from "react";
import { Ban, Check, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import {
  AI_CONFIDENCE_BOUNDS,
  AI_SIMILARITY_SCORE_BOUNDS,
  DEFAULT_AI_CONFIDENCE_THRESHOLD,
} from "../../constants/aiConfig";
import { useSampleStore } from "../../store/useSampleStore";
import { formatBytesCompact } from "../../utils/format";
import { AiModelSetupCard } from "./AiModelSetupCard";
import { ToggleRow } from "./ToggleRow";

const TOP_K_OPTIONS = [25, 50, 100, 200] as const;

export const AiAudioTab: React.FC = () => {
  const aiModelStatus = useSampleStore((s) => s.aiModelStatus);
  const aiAutoAnalyzeOnScan = useSampleStore((s) => s.aiAutoAnalyzeOnScan);
  const aiTagConfidenceThreshold = useSampleStore(
    (s) => s.aiTagConfidenceThreshold
  );
  const aiTaggingMode = useSampleStore((s) => s.aiTaggingMode);
  const aiKnnTagLearning = useSampleStore((s) => s.aiKnnTagLearning);
  const aiSimilarityMinScore = useSampleStore((s) => s.aiSimilarityMinScore);
  const aiSimilarityTopK = useSampleStore((s) => s.aiSimilarityTopK);
  const aiSimilarityScope = useSampleStore((s) => s.aiSimilarityScope);
  const aiSimilarityDurationMatch = useSampleStore(
    (s) => s.aiSimilarityDurationMatch
  );
  const isAnalyzingAi = useSampleStore((s) => s.isAnalyzingAi);
  const aiIndexProgress = useSampleStore((s) => s.aiIndexProgress);
  const pendingAiSuggestionsCount = useSampleStore(
    (s) => s.pendingAiSuggestionsCount
  );

  const fetchAiModelStatus = useSampleStore((s) => s.fetchAiModelStatus);
  const setAiAutoAnalyzeOnScan = useSampleStore((s) => s.setAiAutoAnalyzeOnScan);
  const setAiTagConfidenceThreshold = useSampleStore(
    (s) => s.setAiTagConfidenceThreshold
  );
  const setAiTaggingMode = useSampleStore((s) => s.setAiTaggingMode);
  const setAiKnnTagLearning = useSampleStore((s) => s.setAiKnnTagLearning);
  const setAiSimilarityMinScore = useSampleStore((s) => s.setAiSimilarityMinScore);
  const setAiSimilarityTopK = useSampleStore((s) => s.setAiSimilarityTopK);
  const setAiSimilarityScope = useSampleStore((s) => s.setAiSimilarityScope);
  const setAiSimilarityDurationMatch = useSampleStore(
    (s) => s.setAiSimilarityDurationMatch
  );
  const analyzeSamplesAi = useSampleStore((s) => s.analyzeSamplesAi);
  const runKnnTagLearning = useSampleStore((s) => s.runKnnTagLearning);
  const cancelAiAnalysis = useSampleStore((s) => s.cancelAiAnalysis);
  const approveAllAiTagSuggestions = useSampleStore(
    (s) => s.approveAllAiTagSuggestions
  );
  const dismissAllAiTagSuggestions = useSampleStore(
    (s) => s.dismissAllAiTagSuggestions
  );

  useEffect(() => {
    void fetchAiModelStatus();
  }, [fetchAiModelStatus]);

  const ready = Boolean(aiModelStatus?.ready);

  const indexPct =
    aiModelStatus && aiModelStatus.total_profile_samples > 0
      ? Math.round(
          (aiModelStatus.indexed_count / aiModelStatus.total_profile_samples) *
            100
        )
      : 0;

  return (
    <div className="space-y-3">
      <AiModelSetupCard />

      {/* CARD 2: AUTO-TAGGING & BATCH INDEXING */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-accent-fg shrink-0" />
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg truncate">
              AUTO-TAGGING &amp; INDEXING
            </span>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              disabled={!ready || isAnalyzingAi}
              onClick={() => void analyzeSamplesAi({ reanalyzeExisting: true })}
              className="h-[22px] px-2 bg-surface-3 hover:bg-surface-hover hover:border-accent disabled:opacity-50 border border-line text-fg-2 hover:text-fg text-[10.5px] font-medium rounded-xs shrink-0 whitespace-nowrap cursor-pointer"
              title="Re-run ONNX tagging & embeddings across all profile samples"
            >
              Re-analyze all
            </button>
            {isAnalyzingAi ? (
              <button
                type="button"
                onClick={() => void cancelAiAnalysis()}
                className="h-[22px] px-2.5 bg-surface-3 hover:bg-surface-hover border border-line hover:border-accent text-fg hover:text-accent-fg text-[10.5px] font-semibold rounded-xs inline-flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
              >
                <X className="w-3 h-3 shrink-0" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!ready}
                onClick={() =>
                  void analyzeSamplesAi({ reanalyzeExisting: false })
                }
                className="h-[22px] px-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-on text-[10.5px] font-semibold rounded-xs inline-flex items-center space-x-1 transition-colors shrink-0 whitespace-nowrap cursor-pointer shadow-xs"
                title="Generate acoustic embeddings and tag suggestions for unindexed samples"
              >
                <RefreshCw className="w-3 h-3 shrink-0" />
                <span>Analyze missing</span>
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-line">
          {isAnalyzingAi && aiIndexProgress && (
            <div className="p-2.5 bg-surface-2 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-accent-fg font-semibold">
                  Indexing [{aiIndexProgress.processed}/{aiIndexProgress.total}]
                  — {aiIndexProgress.tags_suggested} tags ·{" "}
                  {aiIndexProgress.avg_ms_per_clip.toFixed(1)} ms/clip
                </span>
                <span className="text-fg tabular-nums">
                  {Math.round(aiIndexProgress.percentage)}%
                </span>
              </div>
              <div className="w-full h-[4px] bg-surface-0 border border-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, Math.round(aiIndexProgress.percentage))
                    )}%`,
                  }}
                />
              </div>
              {aiIndexProgress.current_file && (
                <div className="font-mono text-[10px] text-fg-2 truncate">
                  {aiIndexProgress.current_file}
                </div>
              )}
            </div>
          )}

          {/* Indexed Corpus Metric Strip */}
          <div className="px-3 py-2 bg-surface-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[10.5px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-2">
              <span className="whitespace-nowrap">
                Indexed:{" "}
                <strong className="text-fg tabular-nums">
                  {(aiModelStatus?.indexed_count || 0).toLocaleString()}
                </strong>{" "}
                /{" "}
                {(aiModelStatus?.total_profile_samples || 0).toLocaleString()}{" "}
                ({indexPct}%)
              </span>
              <span className="whitespace-nowrap">
                Vectors:{" "}
                <strong className="text-fg tabular-nums">
                  {formatBytesCompact(aiModelStatus?.embedding_bytes || 0)}
                </strong>
              </span>
              {(aiModelStatus?.last_avg_ms_per_clip || 0) > 0 && (
                <span className="whitespace-nowrap">
                  Speed:{" "}
                  <strong className="text-fg tabular-nums">
                    {aiModelStatus?.last_avg_ms_per_clip.toFixed(1)} ms/clip
                  </strong>
                </span>
              )}
            </div>
            <span className="text-[10px] text-fg-3 whitespace-nowrap">
              Manual tags (is_manual = 1) are always protected
            </span>
          </div>

          {/* Pending Review & k-NN Tag Learning Bar */}
          <div className="min-h-[38px] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="text-[12px] font-medium text-fg whitespace-nowrap">
                Tag review
              </span>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.5 rounded-xs border tabular-nums shrink-0 ${
                  pendingAiSuggestionsCount > 0
                    ? "bg-accent-soft text-accent-fg border-accent font-semibold"
                    : "bg-surface-2 text-fg-3 border-line"
                }`}
              >
                {pendingAiSuggestionsCount.toLocaleString()} pending
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {pendingAiSuggestionsCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => void approveAllAiTagSuggestions()}
                    className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg text-[11px] font-medium rounded-xs inline-flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
                    title={`Promote all ${pendingAiSuggestionsCount.toLocaleString()} pending AI suggestions into manual tags`}
                  >
                    <Check className="w-3 h-3 text-accent-fg shrink-0" />
                    <span>Approve All</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissAllAiTagSuggestions()}
                    className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium rounded-xs inline-flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
                    title={`Dismiss all ${pendingAiSuggestionsCount.toLocaleString()} pending AI tag suggestions without adding them as tags`}
                  >
                    <Ban className="w-3 h-3 shrink-0" />
                    <span>Dismiss All</span>
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={
                  isAnalyzingAi ||
                  aiTaggingMode === "vectors_only" ||
                  (aiModelStatus?.indexed_count ?? 0) === 0
                }
                onClick={() => void runKnnTagLearning()}
                className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 hover:border-accent disabled:opacity-50 border border-line text-fg-2 hover:text-fg text-[11px] font-medium rounded-xs inline-flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
                title={
                  aiTaggingMode === "vectors_only"
                    ? "Switch Tagging mode from Similarity Only to Suggest or Auto-Apply to run k-NN learning"
                    : "Suggest or apply tags across indexed sounds using cosine k-NN voting from your own manual tags (zero extra AI model)"
                }
              >
                <Sparkles className="w-3 h-3 text-accent-fg shrink-0" />
                <span>Learn Tags (k-NN)</span>
              </button>
            </div>
          </div>

          <ToggleRow
            label="Auto-analyze new samples on scan"
            checked={aiAutoAnalyzeOnScan}
            onChange={setAiAutoAnalyzeOnScan}
            title="Automatically run AI acoustic indexing on newly scanned files when AI Engine is ready"
          />

          <ToggleRow
            label="Self-learning k-NN tag suggestions"
            checked={aiKnnTagLearning}
            onChange={setAiKnnTagLearning}
            title="Blend YAMNet audio predictions with acoustic neighbor voting from your own manual tags (zero extra model download)"
          />

          {/* Confidence Threshold */}
          <div
            className={`h-[38px] px-3 flex items-center justify-between gap-3 transition-opacity ${
              aiTaggingMode === "vectors_only"
                ? "opacity-60 pointer-events-none"
                : ""
            }`}
          >
            <span className="text-[12px] font-medium text-fg shrink-0">
              Tag confidence threshold
            </span>
            <div className="flex items-center space-x-2 shrink-0">
              <input
                type="range"
                disabled={aiTaggingMode === "vectors_only"}
                min={AI_CONFIDENCE_BOUNDS.min}
                max={AI_CONFIDENCE_BOUNDS.max}
                step={0.01}
                value={aiTagConfidenceThreshold}
                onChange={(e) =>
                  setAiTagConfidenceThreshold(parseFloat(e.target.value))
                }
                className="w-[156px]"
              />
              <span className="font-mono tabular-nums text-[10.5px] font-semibold text-accent-fg bg-surface-2 border border-line rounded-xs w-[52px] h-[20px] inline-flex items-center justify-center">
                {Math.round(aiTagConfidenceThreshold * 100)}%
              </span>
              <button
                type="button"
                disabled={aiTaggingMode === "vectors_only"}
                onClick={() =>
                  setAiTagConfidenceThreshold(DEFAULT_AI_CONFIDENCE_THRESHOLD)
                }
                className="w-[22px] h-[20px] bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg-2 hover:text-fg rounded-xs inline-flex items-center justify-center cursor-pointer"
                title="Reset confidence threshold to 72%"
                aria-label="Reset confidence threshold to 72%"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Tagging Mode Segmented Control */}
          <div className="h-[40px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Tagging mode
            </span>
            <div className="flex items-center bg-surface-2 p-0.5 rounded-xs border border-line">
              {(
                [
                  {
                    id: "vectors_only",
                    label: "Similarity Only",
                    title:
                      "Extract acoustic similarity vectors without generating AI tag suggestions",
                  },
                  {
                    id: "suggest",
                    label: "Suggest Only",
                    title:
                      "Keep predicted AI tags as pending suggestions for manual review",
                  },
                  {
                    id: "auto_apply",
                    label: "Auto-Apply",
                    title:
                      "Automatically apply high-confidence AI tags to untouched samples",
                  },
                ] as const
              ).map((opt) => {
                const active = aiTaggingMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAiTaggingMode(opt.id)}
                    title={opt.title}
                    className={`h-[22px] px-2 font-mono text-[10.5px] rounded-xs transition-colors cursor-pointer ${
                      active
                        ? "bg-accent-soft text-accent-fg border border-accent font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* CARD 3: SIMILARITY SEARCH DEFAULTS */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg truncate">
            SIMILARITY SEARCH DEFAULTS
          </span>
          <span className="font-mono text-[10px] text-fg-3 shrink-0 whitespace-nowrap">
            128-dim Cosine Similarity (&lt; 2 ms cached)
          </span>
        </div>

        <div className="divide-y divide-line">
          {/* Default Similarity Scope */}
          <div className="h-[40px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Default similarity scope
            </span>
            <div className="flex items-center bg-surface-2 p-0.5 rounded-xs border border-line">
              {(
                [
                  { id: "profile", label: "Active Profile" },
                  { id: "folder", label: "Same Folder Only" },
                ] as const
              ).map((opt) => {
                const active = aiSimilarityScope === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAiSimilarityScope(opt.id)}
                    className={`h-[22px] px-2.5 font-mono text-[10.5px] rounded-xs transition-colors cursor-pointer ${
                      active
                        ? "bg-accent-soft text-accent-fg border border-accent font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <ToggleRow
            label="Prefer similar duration"
            checked={aiSimilarityDurationMatch}
            onChange={setAiSimilarityDurationMatch}
            title="Filter acoustic similarity matches to samples within an adaptive duration window (~0.35x - 2.5x anchor length)"
          />

          {/* Min Match Score */}
          <div className="h-[38px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Default minimum match score
            </span>
            <div className="flex items-center space-x-2 shrink-0">
              <input
                type="range"
                min={AI_SIMILARITY_SCORE_BOUNDS.min}
                max={AI_SIMILARITY_SCORE_BOUNDS.max}
                step={0.01}
                value={aiSimilarityMinScore}
                onChange={(e) =>
                  setAiSimilarityMinScore(parseFloat(e.target.value), false)
                }
                className="w-[156px]"
              />
              <span className="font-mono tabular-nums text-[10.5px] font-semibold text-accent-fg bg-surface-2 border border-line rounded-xs w-[52px] h-[20px] inline-flex items-center justify-center">
                {Math.round(aiSimilarityMinScore * 100)}%
              </span>
            </div>
          </div>

          {/* Top-K Limit */}
          <div className="h-[38px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Maximum similar matches (Top-K)
            </span>
            <div className="flex items-center space-x-1">
              {TOP_K_OPTIONS.map((k) => {
                const active = aiSimilarityTopK === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAiSimilarityTopK(k)}
                    className={`h-[22px] w-[42px] font-mono text-[10.5px] rounded-xs border transition-colors cursor-pointer ${
                      active
                        ? "bg-accent-soft text-accent-fg border-accent font-semibold"
                        : "bg-surface-2 text-fg-2 border-line hover:text-fg"
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
