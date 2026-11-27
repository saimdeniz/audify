import React from "react";
import {
  AlertTriangle,
  Copy,
  Gauge,
  Lock,
  RotateCcw,
  Scissors,
  Trash2,
} from "lucide-react";
import type { LayerClipSpec } from "../../types";
import { VarispeedPitchStepper } from "../common/VarispeedPitchStepper";
import {
  getClipPitchMode,
  getClipRenderedDurationSec,
  getClipVarispeedRatio,
} from "./layersTimelineMath";

interface LayerClipInspectorProps {
  clip: LayerClipSpec | null;
  selectedCount: number;
  isMissingSource: boolean;
  onUpdateClip: (patch: Partial<LayerClipSpec>) => void;
  onSplitAtPlayhead: () => void;
  onDuplicateClip: () => void;
  onDeleteClip: () => void;
}

/**
 * Uniform `h-[34px]` bottom Selected Clip Inspector bar inside Layers Editor.
 * Reuses Audify's shared `VarispeedPitchStepper` (wheel ±1st, Shift+wheel ±12st,
 * center click reset) and unified rectangular studio sliders (`src/index.css`).
 */
export const LayerClipInspector: React.FC<LayerClipInspectorProps> = ({
  clip,
  selectedCount,
  isMissingSource,
  onUpdateClip,
  onSplitAtPlayhead,
  onDuplicateClip,
  onDeleteClip,
}) => {
  if (!clip) {
    return (
      <div className="h-[34px] px-2.5 bg-surface-1 border-t border-line flex items-center justify-between text-[11px] text-fg-3 shrink-0">
        <span className="truncate">
          Drag on empty space to marquee-select · Shift+Drag lock time ·
          Alt+Drag clone · Press <kbd className="font-mono text-fg-2">S</kbd>{" "}
          to split
        </span>
        <span className="font-mono text-[10px] hidden lg:inline shrink-0 ml-2">
          Alt+Scroll Zoom · Shift+Scroll Height · Ctrl+Scroll Pan · Middle-Drag Hand
        </span>
      </div>
    );
  }

  const pitchMode = getClipPitchMode(clip);
  const isTapeMode = pitchMode === "varispeed";
  const isPitched = Math.abs(clip.pitchSemitones) >= 0.01;
  const speed = getClipVarispeedRatio(clip);
  const renderedDur = getClipRenderedDurationSec(clip);
  const pitchLabel = `${clip.pitchSemitones > 0 ? "+" : ""}${clip.pitchSemitones}st`;
  const pitchTooltip = isTapeMode
    ? isPitched
      ? `Pitch ${pitchLabel} · Tape Varispeed (${speed.toFixed(2)}x · ${renderedDur.toFixed(2)}s)`
      : `Pitch 0st · Tape Varispeed (${renderedDur.toFixed(2)}s)`
    : `Pitch ${pitchLabel} · Lock Length (${renderedDur.toFixed(2)}s fixed on timeline)`;

  return (
    <div className="h-[34px] px-2.5 bg-surface-1 border-t border-line flex items-center justify-between gap-2.5 text-[11px] shrink-0 overflow-x-auto">
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {isMissingSource && (
          <span
            className="h-[20px] px-1.5 rounded-[3px] bg-warn/15 border border-warn/50 text-warn font-mono text-[9.5px] inline-flex items-center gap-1 shrink-0"
            title="Source audio file is missing on disk"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Missing</span>
          </span>
        )}
        <span
          className="font-medium text-fg truncate max-w-[160px]"
          title={clip.sourcePath}
        >
          {clip.sourceName}
        </span>
        {selectedCount > 1 && (
          <span className="h-[18px] px-1.5 rounded-[2px] bg-accent-soft border border-accent/50 text-accent-fg font-mono text-[9.5px] font-semibold inline-flex items-center shrink-0">
            {selectedCount} clips
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {/* Gain dB (unified rectangular studio fader) */}
        <label className="flex items-center gap-1.5 text-fg-2">
          <span className="font-mono text-[10px] text-fg-3">GAIN</span>
          <input
            type="range"
            min={-24}
            max={12}
            step={0.5}
            value={clip.gainDb}
            onChange={(e) => onUpdateClip({ gainDb: Number(e.target.value) })}
            onDoubleClick={() => onUpdateClip({ gainDb: 0 })}
            className="w-[68px]"
            title="Clip gain in dB (double-click to reset)"
          />
          <span className="font-mono tabular-nums text-[10px] text-fg w-[40px] text-right">
            {clip.gainDb > 0 ? "+" : ""}
            {clip.gainDb.toFixed(1)}dB
          </span>
        </label>

        {/* Fixed-width Pitch Stepper + Lock/Tape Mode Toggle (zero layout shift on ± clicks) */}
        <div className="flex items-center gap-1.5" title={pitchTooltip}>
          <span className="font-mono text-[10px] text-fg-3">PITCH</span>
          <VarispeedPitchStepper
            pitchSemitones={clip.pitchSemitones}
            onChange={(next) =>
              onUpdateClip({
                pitchSemitones: Math.max(-24, Math.min(24, next)),
              })
            }
            variant="compact"
            titleOverride={pitchTooltip}
          />
          <button
            type="button"
            onClick={() =>
              onUpdateClip({
                pitchMode: isTapeMode ? "preserve" : "varispeed",
              })
            }
            aria-pressed={isTapeMode}
            className={`h-[22px] w-[54px] px-1.5 rounded-[3px] border font-mono text-[9.5px] font-semibold inline-flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
              isTapeMode
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-3 border-line text-fg-2 hover:text-fg"
            }`}
            title={
              isTapeMode
                ? `Tape (Varispeed): pitch changes clip speed & length (${speed.toFixed(2)}x · ${renderedDur.toFixed(2)}s). Click to switch to Lock Length.`
                : `Lock Length: pitch preserves exact clip duration on timeline (${renderedDur.toFixed(2)}s). Click to switch to Tape Varispeed.`
            }
          >
            {isTapeMode ? (
              <Gauge className="w-2.5 h-2.5 shrink-0" />
            ) : (
              <Lock className="w-2.5 h-2.5 shrink-0" />
            )}
            <span>{isTapeMode ? "Tape" : "Lock"}</span>
          </button>
        </div>

        {/* Reverse toggle */}
        <button
          type="button"
          onClick={() => onUpdateClip({ reversed: !clip.reversed })}
          className={`h-[22px] px-2 rounded-[3px] border font-mono text-[10px] font-semibold transition-colors cursor-pointer ${
            clip.reversed
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg"
          }`}
          title="Reverse clip playback"
        >
          REV
        </button>

        {/* Fade In / Out readout (fixed width prevents shifting right-aligned actions) */}
        <span className="font-mono tabular-nums text-[10px] text-fg-3 hidden xl:inline-block w-[114px] text-right shrink-0">
          FI {Math.round(clip.fadeInSec * 1000)}ms · FO{" "}
          {Math.round(clip.fadeOutSec * 1000)}ms
        </span>

        <div className="w-[1px] h-[16px] bg-line" />

        {/* Clip quick actions */}
        <button
          type="button"
          onClick={onSplitAtPlayhead}
          className="h-[22px] px-2 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[10.5px] inline-flex items-center gap-1 transition-colors cursor-pointer"
          title="Split selected clip at current playhead (S)"
        >
          <Scissors className="w-3 h-3" />
          <span>Split</span>
        </button>

        <button
          type="button"
          onClick={onDuplicateClip}
          className="h-[22px] px-2 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[10.5px] inline-flex items-center gap-1 transition-colors cursor-pointer"
          title="Duplicate selected clip (Ctrl+D)"
        >
          <Copy className="w-3 h-3" />
          <span>Dup</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateClip({
              gainDb: 0,
              pitchSemitones: 0,
              pitchMode: "preserve",
              reversed: false,
              fadeInSec: 0,
              fadeOutSec: 0,
            })
          }
          className="w-[22px] h-[22px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg flex items-center justify-center transition-colors cursor-pointer"
          title="Reset clip gain, pitch, reverse, and fades"
        >
          <RotateCcw className="w-3 h-3" />
        </button>

        <button
          type="button"
          onClick={onDeleteClip}
          className="w-[22px] h-[22px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg flex items-center justify-center transition-colors cursor-pointer"
          title="Remove clip from timeline (Del)"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
