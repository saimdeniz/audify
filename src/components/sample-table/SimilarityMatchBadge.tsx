import React from "react";

interface SimilarityMatchBadgeProps {
  isAnchor: boolean;
  matchScore: number | null;
  compact?: boolean;
}

/**
 * Shared similarity match badge (`ANCHOR` or `94%`) rendered identically
 * in both the main SampleTable and the Mini Dock list during AI similarity search.
 */
export const SimilarityMatchBadge: React.FC<SimilarityMatchBadgeProps> =
  React.memo(({ isAnchor, matchScore, compact = false }) => {
    if (isAnchor) {
      return (
        <span
          className={`${
            compact ? "px-1 py-0 text-[9.5px] leading-[15px]" : "px-1.5 py-0.5 text-[9.5px]"
          } rounded-xs border border-accent bg-accent-soft text-accent-fg font-mono font-bold uppercase tracking-tight shrink-0`}
        >
          ANCHOR
        </span>
      );
    }

    if (matchScore !== null) {
      const toneClass =
        matchScore >= 0.85
          ? "bg-ok/15 border-ok/50 text-ok"
          : matchScore >= 0.7
            ? "bg-accent-soft border-accent text-accent-fg"
            : "bg-surface-3 border-line text-fg-2";
      return (
        <span
          className={`${
            compact ? "px-1 py-0 text-[9.5px] leading-[15px]" : "px-1.5 py-0.5 text-[10px]"
          } rounded-xs border font-mono tabular-nums font-semibold shrink-0 ${toneClass}`}
        >
          {Math.round(matchScore * 100)}%
        </span>
      );
    }

    return <span className="text-fg-3 font-mono text-[10px]">—</span>;
  });

SimilarityMatchBadge.displayName = "SimilarityMatchBadge";
