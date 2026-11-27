import React, { useRef } from "react";
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
  selectedClips?: LayerClipSpec[];
  selectedCount: number;
  isMissingSource: boolean;
  onUpdateClip: (patch: Partial<LayerClipSpec>, opts?: { pushUndo?: boolean }) => void;
  onSplitAtPlayhead: () => void;
  onDuplicateClip: () => void;
  onDeleteClip: () => void;
}

/**
 * Uniform `h-[34px]` bottom Selected Clip Inspector bar inside Layers Editor.
 * Reuses Audify's shared `VarispeedPitchStepper` (wheel ±1st, Shift+wheel ±12st,
 * center click reset), coalesces Gain drags into a single Undo snapshot, and
 * surfaces `"Mixed"` readouts when multi-selected clips differ.
 */
export const LayerClipInspector: React.FC<LayerClipInspectorProps> = ({
  clip,
  selectedClips,
  selectedCount,
  isMissingSource,
  onUpdateClip,
  onSplitAtPlayhead,
  onDuplicateClip,
  onDeleteClip,
}) => {
  const gainUndoCapturedRef = useRef(false);

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

  const group =
    selectedClips && selectedClips.length > 0 ? selectedClips : [clip];
  const isMulti = group.length > 1 || selectedCount > 1;
  const gainMixed =
    group.length > 1 && group.some((c) => Math.abs(c.gainDb - clip.gainDb) > 0.05);
  const pitchMixed =
    group.length > 1 &&
    group.some((c) => Math.abs(c.pitchSemitones - clip.pitchSemitones) > 0.01);
  const pitchMode = getClipPitchMode(clip);
  const pitchModeMixed =
    group.length > 1 && group.some((c) => getClipPitchMode(c) !== pitchMode);
  const reversedMixed =
    group.length > 1 && group.some((c) => c.reversed !== clip.reversed);
  const fadeMixed =
    group.length > 1 &&
    group.some(
      (c) =>
        Math.round(c.fadeInSec * 1000) !== Math.round(clip.fadeInSec * 1000) ||
        Math.round(c.fadeOutSec * 1000) !== Math.round(clip.fadeOutSec * 1000)
    );

  const isTapeMode = pitchMode === "varispeed";
  const isPitched = Math.abs(clip.pitchSemitones) >= 0.01;
  const speed = getClipVarispeedRatio(clip);
  const renderedDur = getClipRenderedDurationSec(clip);
  const pitchLabel = `${clip.pitchSemitones > 0 ? "+" : ""}${clip.pitchSemitones}st`;
  const pitchTooltip = pitchMixed
    ? `Mixed pitch values across ${selectedCount} clips — use ± or click to unify`
    : isTapeMode
    ? isPitched
      ? `Pitch ${pitchLabel} · Tape Varispeed (${speed.toFixed(2)}x · ${renderedDur.toFixed(2)}s)`
      : `Pitch 0st · Tape Varispeed (${renderedDur.toFixed(2)}s)`
    : `Pitch ${pitchLabel} · Lock Length (${renderedDur.toFixed(2)}s fixed on timeline)`;

  return (
    <div className="h-[34px] px-2.5 bg-surface-1 border-t border-line flex items-center justify-between gap-2 text-[11px] shrink-0 overflow-x-auto">
      <div className="flex items-center gap-2 min-w-0 shrink">
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
          className="font-medium text-fg truncate max-w-[140px]"
          title={clip.sourcePath}
        >
          {clip.sourceName}
        </span>
        {isMulti && (
          <span className="h-[18px] px-1.5 rounded-[2px] bg-accent-soft border border-accent/50 text-accent-fg font-mono text-[9.5px] font-semibold inline-flex items-center shrink-0">
            {selectedCount} clips
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Gain dB (unified rectangular studio fader with single-Undo drag coalescing) */}
        <label className="flex items-center gap-1.5 text-fg-2">
          <span className="font-mono text-[10px] text-fg-3 hidden md:inline">
            GAIN
          </span>
          <input
            type="range"
            aria-label="Clip gain in dB"
            min={-24}
            max={12}
            step={0.5}
            value={clip.gainDb}
            onPointerDown={() => {
              gainUndoCapturedRef.current = false;
            }}
            onPointerUp={() => {
              gainUndoCapturedRef.current = false;
            }}
            onChange={(e) => {
              const shouldPushUndo = !gainUndoCapturedRef.current;
              gainUndoCapturedRef.current = true;
              onUpdateClip(
                { gainDb: Number(e.target.value) },
                { pushUndo: shouldPushUndo }
              );
            }}
            onDoubleClick={() => onUpdateClip({ gainDb: 0 }, { pushUndo: true })}
            className="w-[62px]"
            title="Clip gain in dB (double-click to reset)"
          />
          <span className="font-mono tabular-nums text-[10px] text-fg w-[40px] text-right">
            {gainMixed
              ? "Mixed"
              : `${clip.gainDb > 0 ? "+" : ""}${clip.gainDb.toFixed(1)}dB`}
          </span>
        </label>

        {/* Fixed-width Pitch Stepper + Lock/Tape Mode Toggle (zero layout shift on ± clicks) */}
        <div className="flex items-center gap-1.5" title={pitchTooltip}>
          <span className="font-mono text-[10px] text-fg-3 hidden md:inline">
            PITCH
          </span>
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
            aria-pressed={pitchModeMixed ? "mixed" : isTapeMode}
            aria-label={
              pitchModeMixed
                ? "Pitch mode: Mixed (Lock Length / Tape Varispeed)"
                : isTapeMode
                ? "Pitch mode: Tape Varispeed"
                : "Pitch mode: Lock Length"
            }
            className={`relative h-[22px] w-[22px] rounded-[3px] border inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
              isTapeMode || pitchModeMixed
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-3 border-line text-fg-2 hover:text-fg"
            }`}
            title={
              pitchModeMixed
                ? "Selected clips use mixed Lock/Tape modes — click to unify"
                : isTapeMode
                ? `Tape (Varispeed): pitch changes clip speed & length (${speed.toFixed(2)}x · ${renderedDur.toFixed(2)}s). Click to switch to Lock Length.`
                : `Lock Length: pitch preserves exact clip duration on timeline (${renderedDur.toFixed(2)}s). Click to switch to Tape Varispeed.`
            }
          >
            {isTapeMode ? (
              <Gauge className="w-3 h-3 shrink-0" />
            ) : (
              <Lock className="w-3 h-3 shrink-0" />
            )}
            {pitchModeMixed && (
              <span
                aria-hidden="true"
                className="absolute top-[2px] right-[2px] w-[4px] h-[4px] rounded-[1px] bg-accent"
              />
            )}
          </button>
        </div>

        {/* Reverse toggle */}
        <button
          type="button"
          aria-pressed={reversedMixed ? "mixed" : clip.reversed}
          onClick={() => onUpdateClip({ reversed: !clip.reversed })}
          className={`h-[22px] px-2 rounded-[3px] border font-mono text-[10px] font-semibold transition-colors cursor-pointer ${
            clip.reversed || reversedMixed
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg"
          }`}
          title={
            reversedMixed
              ? "Mixed reverse states — click to unify"
              : "Reverse clip playback"
          }
        >
          {reversedMixed ? "REV*" : "REV"}
        </button>

        {/* Fade In / Out readout (fixed width prevents shifting right-aligned actions) */}
        <span className="font-mono tabular-nums text-[10px] text-fg-3 hidden xl:inline-block w-[114px] text-right shrink-0">
          {fadeMixed
            ? "Fades: Mixed"
            : `FI ${Math.round(clip.fadeInSec * 1000)}ms · FO ${Math.round(
                clip.fadeOutSec * 1000
              )}ms`}
        </span>

        <div className="w-[1px] h-[16px] bg-line" />

        {/* Clip quick actions */}
        <button
          type="button"
          onClick={onSplitAtPlayhead}
          className="h-[22px] px-2 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[10.5px] inline-flex items-center gap-1 transition-colors cursor-pointer"
          title="Split selected clip(s) at timeline playhead (S)"
        >
          <Scissors className="w-3 h-3" />
          <span className="hidden sm:inline">Split</span>
        </button>

        <button
          type="button"
          onClick={onDuplicateClip}
          className="h-[22px] px-2 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[10.5px] inline-flex items-center gap-1 transition-colors cursor-pointer"
          title="Duplicate selected clip(s) (Ctrl+D)"
        >
          <Copy className="w-3 h-3" />
          <span className="hidden sm:inline">Dup</span>
        </button>

        <button
          type="button"
          aria-label="Reset clip effects"
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
          aria-label="Remove clip from timeline"
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
