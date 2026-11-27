import React, { useMemo } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

/**
 * Right-side toolbar indicator for Slices view (redundant Favorites button removed
 * because unified Favorites -> Slices handles favorite slices context-aware).
 */
export const SliceToolbarChips: React.FC = () => {
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const slicePitchOnly = useSampleStore((s) => s.slicePitchOnly);
  const setSlicePitchOnly = useSampleStore((s) => s.setSlicePitchOnly);

  const { pitchCount, readyCount } = useMemo(() => {
    let pitch = 0;
    let ready = 0;
    for (const s of sliceHistory) {
      if (Math.abs(s.pitch_semitones) >= 0.01) pitch++;
      if (s.file_exists) ready++;
    }
    return { pitchCount: pitch, readyCount: ready };
  }, [sliceHistory]);

  return (
    <div className="flex-1 min-w-0 flex items-center justify-end gap-1.5 py-0.5">
      {pitchCount > 0 && (
        <button
          type="button"
          onClick={() => setSlicePitchOnly(!slicePitchOnly)}
          className={`h-[22px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
            slicePitchOnly
              ? "bg-accent-soft border-accent text-accent-fg font-medium"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
          }`}
          title="Show only pitch-shifted slices"
        >
          <SlidersHorizontal className="w-3 h-3 shrink-0" />
          <span>Pitch / FX</span>
          <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
            {pitchCount.toLocaleString()}
          </span>
        </button>
      )}

      <span className="text-[10.5px] font-mono tabular-nums text-fg-3 pl-1 shrink-0">
        {readyCount.toLocaleString()} ready
      </span>
    </div>
  );
};
