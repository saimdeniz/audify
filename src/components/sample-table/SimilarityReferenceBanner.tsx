import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Ban,
  CheckCheck,
  Clock,
  Folder,
  Layers,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { AiSimilarityScope, SimilaritySession } from "../../types";

interface SimilarityReferenceBannerProps {
  similaritySession: SimilaritySession;
  similarityPendingIds: number[];
  onChangeMinScore: (minScore: number) => void;
  onToggleScope: (scope: AiSimilarityScope) => void;
  onToggleDurationMatch: (enabled: boolean) => void;
  onApproveMatchedAi: (sampleIds: number[]) => void;
  onDismissMatchedAi: (sampleIds: number[]) => void;
  onClearSimilarity: () => void;
}

/**
 * Acoustic similarity search bar displaying the reference anchor sample,
 * match statistics, scope/duration filters, live minimum cosine similarity
 * slider, and quick AI suggestion cleanup.
 */
export const SimilarityReferenceBanner: React.FC<
  SimilarityReferenceBannerProps
> = ({
  similaritySession,
  similarityPendingIds,
  onChangeMinScore,
  onToggleScope,
  onToggleDurationMatch,
  onApproveMatchedAi,
  onDismissMatchedAi,
  onClearSimilarity,
}) => {
  const committedMinPct = Math.round(similaritySession.minScore * 100);
  const [draftMinPct, setDraftMinPct] = useState<number | null>(null);
  const isPointerDraggingRef = useRef(false);

  const isExternalAnchor =
    Boolean(similaritySession.externalSource) ||
    similaritySession.anchorSample.id <= 0;

  useEffect(() => {
    if (!isPointerDraggingRef.current) {
      setDraftMinPct(null);
    }
  }, [
    committedMinPct,
    similaritySession.anchorSample.id,
    similaritySession.externalSource?.probeId,
  ]);

  const displayMinPct = draftMinPct ?? committedMinPct;
  const similarityMatchCount = isExternalAnchor
    ? similaritySession.scoresById.size
    : Math.max(0, similaritySession.scoresById.size - 1);

  const handleSliderPointerDown = () => {
    isPointerDraggingRef.current = true;
    setDraftMinPct(committedMinPct);
  };

  const handleSliderPointerUp = () => {
    if (!isPointerDraggingRef.current) return;
    isPointerDraggingRef.current = false;
    const pending = draftMinPct;
    setDraftMinPct(null);
    if (pending !== null && pending !== committedMinPct) {
      onChangeMinScore(pending / 100);
    }
  };

  const handleSliderChange = (nextPct: number) => {
    setDraftMinPct(nextPct);
    onChangeMinScore(nextPct / 100);
  };

  return (
    <div className="px-2.5 h-[30px] border-b border-line bg-accent-soft flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-accent-fg shrink-0">
          <AudioLines className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Similar</span>
        </span>
        <span
          className="h-[22px] inline-flex items-center gap-1.5 px-2 rounded-xs border border-accent/50 bg-surface-2 text-accent-fg font-mono text-[11px] font-semibold truncate max-w-[250px]"
          title={
            isExternalAnchor
              ? `External reference file (read-only probe): ${similaritySession.anchorSample.file_path}`
              : similaritySession.anchorSample.file_path
          }
        >
          {isExternalAnchor && (
            <span className="px-1 py-[1px] rounded-[2px] bg-accent-soft border border-accent/50 text-[9px] uppercase tracking-wider shrink-0">
              EXT
            </span>
          )}
          <span className="truncate">
            {similaritySession.anchorSample.file_name}
          </span>
        </span>
        <span className="hidden md:inline font-mono tabular-nums text-[10.5px] text-fg-2 shrink-0 min-w-[118px]">
          {similarityMatchCount}{" "}
          {similarityMatchCount === 1 ? "match" : "matches"} ·{" "}
          {similaritySession.elapsedMs.toFixed(1)} ms
        </span>
      </div>

      {/* Quick actions sit LEFT of Min Match inside right-aligned group so slider X-coordinate stays locked */}
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        {similarityPendingIds.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => onApproveMatchedAi(similarityPendingIds)}
              className="h-[22px] px-1.5 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent/50 text-accent-fg font-mono text-[10.5px] font-semibold inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
              title={`Approve all ${similarityPendingIds.length} pending AI tag suggestions across matched samples`}
            >
              <CheckCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="tabular-nums">{similarityPendingIds.length}</span>
            </button>
            <button
              type="button"
              onClick={() => onDismissMatchedAi(similarityPendingIds)}
              className="h-[22px] px-1.5 rounded-xs bg-surface-2 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg font-mono text-[10.5px] font-semibold inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
              title={`Dismiss all ${similarityPendingIds.length} pending AI tag suggestions across matched samples`}
            >
              <Ban className="w-3 h-3 shrink-0" />
            </button>
          </>
        )}

        {!isExternalAnchor && (
          <button
            type="button"
            onClick={() =>
              onToggleScope(
                similaritySession.scope === "folder" ? "profile" : "folder"
              )
            }
            className={`h-[22px] px-2 rounded-xs border font-mono text-[10.5px] inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer ${
              similaritySession.scope === "folder"
                ? "bg-surface-2 border-accent text-accent-fg font-semibold"
                : "bg-surface-2 border-line hover:border-accent text-fg-2 hover:text-fg"
            }`}
            title={
              similaritySession.scope === "folder"
                ? "Scope: Same Folder Only (click to switch to Active Profile)"
                : "Scope: Active Profile (click to limit to Same Folder Only)"
            }
          >
            {similaritySession.scope === "folder" ? (
              <Folder className="w-3 h-3 shrink-0" />
            ) : (
              <Layers className="w-3 h-3 shrink-0" />
            )}
            <span className="hidden lg:inline">
              {similaritySession.scope === "folder" ? "Folder" : "Profile"}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            onToggleDurationMatch(!similaritySession.durationMatchOnly)
          }
          className={`h-[22px] px-2 rounded-xs border font-mono text-[10.5px] inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer ${
            similaritySession.durationMatchOnly
              ? "bg-surface-2 border-accent text-accent-fg font-semibold"
              : "bg-surface-2 border-line hover:border-accent text-fg-2 hover:text-fg"
          }`}
          title={
            similaritySession.durationMatchOnly
              ? "Duration match filter ON (~0.35x - 2.5x anchor length; click to disable)"
              : "Match similar duration only (~0.35x - 2.5x anchor length)"
          }
        >
          <Clock className="w-3 h-3 shrink-0" />
          <span className="hidden xl:inline">Duration</span>
        </button>

        <label
          className="inline-flex items-center gap-1.5 px-2 h-[22px] rounded-xs border border-line bg-surface-2 text-[10.5px] font-mono text-fg-2 shrink-0"
          title="Adjust minimum acoustic cosine similarity threshold (40% - 95%)"
        >
          <SlidersHorizontal className="w-3 h-3 text-fg-3 shrink-0" />
          <span className="text-fg-3 hidden sm:inline">Min</span>
          <input
            type="range"
            min={40}
            max={95}
            step={5}
            value={displayMinPct}
            onPointerDown={handleSliderPointerDown}
            onPointerUp={handleSliderPointerUp}
            onPointerCancel={handleSliderPointerUp}
            onBlur={handleSliderPointerUp}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            className="w-[74px] h-1 accent-accent cursor-pointer shrink-0"
          />
          <span className="tabular-nums text-accent-fg font-semibold w-[30px] text-right shrink-0">
            {displayMinPct}%
          </span>
        </label>

        <button
          type="button"
          onClick={onClearSimilarity}
          className="w-[22px] h-[22px] rounded-xs border border-line bg-surface-2 hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg inline-flex items-center justify-center transition-colors shrink-0"
          title="Clear similarity filter"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
