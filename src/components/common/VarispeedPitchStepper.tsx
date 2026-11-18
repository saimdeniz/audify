import React from "react";

export interface VarispeedPitchStepperProps {
  pitchSemitones: number;
  onChange: (nextPitch: number) => void;
  variant?: "compact" | "dock";
}

/**
 * Shared ±24 semitone varispeed pitch stepper supporting click (±1st),
 * Shift+click (±12st), mouse wheel, and click-center reset to 0st.
 */
export const VarispeedPitchStepper: React.FC<VarispeedPitchStepperProps> =
  React.memo(({ pitchSemitones, onChange, variant = "compact" }) => {
    const pitchDisplay =
      pitchSemitones > 0 ? `+${pitchSemitones}st` : `${pitchSemitones}st`;
    const isDock = variant === "dock";

    return (
      <div
        onWheel={(e) => {
          e.preventDefault();
          const step = e.shiftKey ? 12 : 1;
          const delta = e.deltaY < 0 ? step : -step;
          onChange(pitchSemitones + delta);
        }}
        className={
          isDock
            ? `h-[25px] inline-flex items-center rounded-xs border font-mono text-[10px] tabular-nums shrink-0 ${
                pitchSemitones !== 0
                  ? "bg-accent-soft border-accent text-accent-fg"
                  : "bg-surface-3 border-line-strong text-fg"
              }`
            : `h-[20px] rounded-xs border flex items-center shrink-0 transition-colors ${
                pitchSemitones !== 0
                  ? "border-accent bg-accent-soft text-accent-fg"
                  : "border-line bg-surface-3 text-fg-2"
              }`
        }
        title={
          isDock
            ? "Varispeed Pitch (±24st) — Click/scroll ±1st, Shift ±12st, click center to reset"
            : "Varispeed Pitch (±24st — click/scroll ±1st, Shift ±12st, click center to reset, drags pitched WAV to NLE)"
        }
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onChange(pitchSemitones - (e.shiftKey ? 12 : 1))}
          disabled={pitchSemitones <= -24}
          className={`w-[16px] h-full flex items-center justify-center font-mono text-[11px] leading-none hover:text-fg hover:bg-surface-hover disabled:opacity-35 ${
            isDock ? "text-fg-2" : ""
          }`}
          title="Pitch down (-1st, Shift -12st)"
        >
          -
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(0)}
          className={
            isDock
              ? "px-1 h-full flex items-center justify-center font-semibold min-w-[34px] border-x border-line"
              : "w-[38px] h-full flex items-center justify-center font-mono tabular-nums text-[10px] font-semibold tracking-tight hover:text-fg"
          }
          title="Reset pitch to 0st"
        >
          {pitchDisplay}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onChange(pitchSemitones + (e.shiftKey ? 12 : 1))}
          disabled={pitchSemitones >= 24}
          className={`w-[16px] h-full flex items-center justify-center font-mono text-[11px] leading-none hover:text-fg hover:bg-surface-hover disabled:opacity-35 ${
            isDock ? "text-fg-2" : ""
          }`}
          title="Pitch up (+1st, Shift +12st)"
        >
          +
        </button>
      </div>
    );
  });
