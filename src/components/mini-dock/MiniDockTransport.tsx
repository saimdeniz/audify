import React from "react";
import {
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Zap,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { MasterVolumeControl } from "../common/MasterVolumeControl";
import { VarispeedPitchStepper } from "../common/VarispeedPitchStepper";

export const MiniDockTransport: React.FC = () => {
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const isShuffle = useSampleStore((s) => s.isShuffle);
  const isLooping = useSampleStore((s) => s.isLooping);
  const autoPreview = useSampleStore((s) => s.autoPreview);
  const volume = useSampleStore((s) => s.volume);
  const pitchSemitones = useSampleStore((s) => s.pitchSemitones);

  const togglePlayPause = useSampleStore((s) => s.togglePlayPause);
  const stopPlayback = useSampleStore((s) => s.stopPlayback);
  const selectRelativeSample = useSampleStore((s) => s.selectRelativeSample);
  const toggleShuffle = useSampleStore((s) => s.toggleShuffle);
  const toggleLooping = useSampleStore((s) => s.toggleLooping);
  const toggleAutoPreview = useSampleStore((s) => s.toggleAutoPreview);
  const toggleMute = useSampleStore((s) => s.toggleMute);
  const setVolume = useSampleStore((s) => s.setVolume);
  const setPitchSemitones = useSampleStore((s) => s.setPitchSemitones);

  return (
    <div className="bg-surface-1 border-b border-line px-1.5 h-[36px] flex items-center justify-between gap-1 shrink-0 overflow-hidden">
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => selectRelativeSample(-1)}
          className="w-[23px] h-[24px] bg-surface-3 hover:border-line-hover border border-line-strong rounded-sm flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
          title="Previous Sample"
        >
          <SkipBack className="w-3 h-3" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePlayPause}
          aria-label={isPlaying ? "Pause" : "Play"}
          className={`w-[30px] h-[24px] border rounded-sm flex items-center justify-center transition-colors shadow-xs ${
            isPlaying
              ? "bg-accent text-accent-on border-accent"
              : "bg-surface-3 text-fg border-line-strong hover:border-accent"
          }`}
          title="Play / Pause (Space)"
        >
          {isPlaying ? (
            <Pause className="w-3 h-3 fill-current" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => selectRelativeSample(1)}
          className="w-[23px] h-[24px] bg-surface-3 hover:border-line-hover border border-line-strong rounded-sm flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
          title="Next Sample"
        >
          <SkipForward className="w-3 h-3" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={stopPlayback}
          className="w-[22px] h-[24px] bg-surface-3 hover:border-line-hover border border-line-strong rounded-sm flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
          title="Stop"
        >
          <Square className="w-2.5 h-2.5 fill-current" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleShuffle}
          className={`w-[22px] h-[24px] border rounded-sm flex items-center justify-center transition-colors ${
            isShuffle
              ? "bg-accent-soft text-accent-fg border-accent"
              : "bg-surface-3 border-line-strong text-fg-2 hover:text-fg"
          }`}
          title="Shuffle Playback (S)"
        >
          <Shuffle className="w-3 h-3" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleLooping}
          className={`w-[22px] h-[24px] border rounded-sm flex items-center justify-center transition-colors ${
            isLooping
              ? "bg-accent-soft text-accent-fg border-accent"
              : "bg-surface-3 border-line-strong text-fg-2 hover:text-fg"
          }`}
          title="Loop Playback (L)"
        >
          <Repeat className="w-3 h-3" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleAutoPreview}
          className={`w-[22px] h-[24px] border rounded-sm flex items-center justify-center transition-colors ${
            autoPreview
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line-strong text-fg-2 hover:text-fg"
          }`}
          title="Auto-Play on Select"
        >
          <Zap className="w-3 h-3" />
        </button>
      </div>

      {/* Varispeed Pitch Stepper (±24st) */}
      <VarispeedPitchStepper
        pitchSemitones={pitchSemitones}
        onChange={setPitchSemitones}
        variant="dock"
      />

      {/* Inline Volume (stable across all Mini Dock widths; slice controls live on WaveformDeckHeader) */}
      <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
        <MasterVolumeControl
          volume={volume}
          onToggleMute={toggleMute}
          onChangeVolume={setVolume}
          variant="dock"
        />
      </div>
    </div>
  );
};
