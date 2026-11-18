import React from "react";
import {
  Pause,
  Play,
  Repeat,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Zap,
} from "lucide-react";
import { usePlayheadSec } from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import { formatSecondsCode } from "../../utils/format";
import { MasterVolumeControl } from "../common/MasterVolumeControl";
import { VarispeedPitchStepper } from "../common/VarispeedPitchStepper";

const PlayheadTimecodeReadout: React.FC = React.memo(() => {
  const playheadSec = usePlayheadSec();
  return (
    <span className="font-mono tabular-nums text-[12.5px] font-semibold text-accent-fg">
      {formatSecondsCode(playheadSec)}
    </span>
  );
});

export const TransportControls: React.FC = React.memo(() => {
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const isLooping = useSampleStore((s) => s.isLooping);
  const isShuffle = useSampleStore((s) => s.isShuffle);
  const autoPreview = useSampleStore((s) => s.autoPreview);
  const volume = useSampleStore((s) => s.volume);
  const pitchSemitones = useSampleStore((s) => s.pitchSemitones);
  const durationSec = useSampleStore((s) => s.durationSec);
  const sliceRange = useSampleStore((s) => s.sliceRange);

  const selectRelativeSample = useSampleStore((s) => s.selectRelativeSample);
  const togglePlayPause = useSampleStore((s) => s.togglePlayPause);
  const stopPlayback = useSampleStore((s) => s.stopPlayback);
  const toggleShuffle = useSampleStore((s) => s.toggleShuffle);
  const toggleLooping = useSampleStore((s) => s.toggleLooping);
  const toggleAutoPreview = useSampleStore((s) => s.toggleAutoPreview);
  const setVolume = useSampleStore((s) => s.setVolume);
  const toggleMute = useSampleStore((s) => s.toggleMute);
  const setPitchSemitones = useSampleStore((s) => s.setPitchSemitones);

  const effectiveDuration = Math.max(
    0.05,
    durationSec || (selectedSample ? selectedSample.duration_ms / 1000 : 1)
  );

  return (
    <div className="w-[296px] border-r border-line px-2.5 py-2 flex flex-col justify-between shrink-0 bg-surface-1">
      {/* Top Row: Grouped Transport Controls (Left) + Mode Toggles (Right) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectRelativeSample(-1)}
            className="h-[26px] w-[26px] flex items-center justify-center bg-surface-3 hover:bg-line text-fg-2 hover:text-fg border border-line rounded-sm shrink-0 transition-colors"
            title="Previous"
          >
            <SkipBack className="w-3.5 h-3.5 shrink-0" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={togglePlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            className={`h-[26px] w-[48px] flex items-center justify-center rounded-sm border shrink-0 transition-colors ${
              isPlaying
                ? "bg-accent text-accent-on border-accent"
                : "bg-surface-3 text-fg border-line hover:border-accent"
            }`}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-current shrink-0" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
            )}
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectRelativeSample(1)}
            className="h-[26px] w-[26px] flex items-center justify-center bg-surface-3 hover:bg-line text-fg-2 hover:text-fg border border-line rounded-sm shrink-0 transition-colors"
            title="Next"
          >
            <SkipForward className="w-3.5 h-3.5 shrink-0" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={stopPlayback}
            className="h-[26px] w-[26px] flex items-center justify-center bg-surface-3 hover:bg-line text-fg-2 hover:text-fg border border-line rounded-sm shrink-0 transition-colors"
            title="Stop"
          >
            <Square className="w-3 h-3 fill-current shrink-0" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleShuffle}
            className={`h-[26px] w-[26px] flex items-center justify-center rounded-sm border shrink-0 transition-colors ${
              isShuffle
                ? "bg-accent-soft text-accent-fg border-accent"
                : "bg-surface-3 text-fg-2 border-line hover:text-fg"
            }`}
            title="Shuffle"
          >
            <Shuffle className="w-3.5 h-3.5 shrink-0" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleLooping}
            className={`h-[26px] w-[26px] flex items-center justify-center rounded-sm border shrink-0 transition-colors ${
              isLooping
                ? "bg-accent-soft text-accent-fg border-accent"
                : "bg-surface-3 text-fg-2 border-line hover:text-fg"
            }`}
            title="Loop"
          >
            <Repeat className="w-3.5 h-3.5 shrink-0" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleAutoPreview}
            className={`h-[26px] w-[26px] flex items-center justify-center rounded-sm border shrink-0 transition-colors ${
              autoPreview
                ? "bg-accent-soft text-accent-fg border-accent"
                : "bg-surface-3 text-fg-2 border-line hover:text-fg"
            }`}
            title="Auto-Preview"
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* Middle Row: Refined Single-Line Studio LCD Readout */}
      <div className="h-[28px] bg-surface-0 border border-line rounded-md px-2.5 flex items-center justify-between font-mono tabular-nums">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <PlayheadTimecodeReadout />
          <span className="text-[11px] text-fg-3">
            / {formatSecondsCode(effectiveDuration)}
          </span>
        </div>

        {sliceRange ? (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-accent-soft text-accent-fg border border-accent text-[10px] shrink-0"
            title="Active In/Out Slice Range"
          >
            <Scissors className="w-2.5 h-2.5 shrink-0" />
            <span>
              {sliceRange.startSec.toFixed(2)}s–{sliceRange.endSec.toFixed(2)}s
            </span>
          </span>
        ) : (
          <span className="text-[10px] text-accent-fg shrink-0">FULL</span>
        )}
      </div>

      {/* Bottom Row: Master Volume Fader + Compact Varispeed Pitch Control */}
      <div className="flex items-center gap-1.5">
        <MasterVolumeControl
          volume={volume}
          onToggleMute={toggleMute}
          onChangeVolume={setVolume}
          variant="transport"
        />

        <span className="w-px h-3.5 bg-line shrink-0 mx-0.5" />

        <VarispeedPitchStepper
          pitchSemitones={pitchSemitones}
          onChange={setPitchSemitones}
          variant="compact"
        />
      </div>
    </div>
  );
});
