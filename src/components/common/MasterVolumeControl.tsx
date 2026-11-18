import React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { formatVolumeDb } from "../../utils/format";

export interface MasterVolumeControlProps {
  volume: number;
  onToggleMute: () => void;
  onChangeVolume: (volume: number) => void;
  variant?: "transport" | "dock";
}

/**
 * Shared mute button + linear volume fader + dB readout used in both the
 * Transport Deck and the Mini Dock.
 */
export const MasterVolumeControl: React.FC<MasterVolumeControlProps> =
  React.memo(({ volume, onToggleMute, onChangeVolume, variant = "transport" }) => {
    const isMuted = volume <= 0.005;
    const isDock = variant === "dock";
    const dbLabel = formatVolumeDb(volume);

    return (
      <>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleMute}
          className={`${
            isDock ? "w-[20px] h-[22px]" : "w-5 h-5"
          } rounded-xs flex items-center justify-center shrink-0 transition-colors ${
            isMuted
              ? "text-accent-fg bg-accent-soft"
              : "text-fg-2 hover:text-fg hover:bg-surface-3"
          }`}
          aria-label={isMuted ? "Unmute" : "Mute"}
          title={
            isDock
              ? `${isMuted ? "Unmute (M)" : "Mute (M)"} · ${dbLabel}`
              : isMuted
                ? "Unmute"
                : "Mute"
          }
        >
          {isMuted ? (
            <VolumeX className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 shrink-0" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
          onMouseUp={(e) => e.currentTarget.blur()}
          className={
            isDock
              ? "flex-1 min-w-[44px] max-w-[88px] h-1 bg-line-strong rounded-none appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:rounded-[1px] [&::-webkit-slider-thumb]:cursor-pointer"
              : "flex-1 min-w-0 h-1 bg-line accent-accent cursor-pointer"
          }
          title={`Preview Volume (${dbLabel})`}
          aria-label="Master preview volume"
        />
        <span
          className={
            isDock
              ? "inline-block font-mono tabular-nums text-[10px] font-semibold text-fg-2 w-[38px] text-right shrink-0"
              : "font-mono tabular-nums text-[10.5px] text-fg w-[42px] text-right shrink-0"
          }
        >
          {dbLabel}
        </span>
      </>
    );
  });
