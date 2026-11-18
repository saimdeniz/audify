import React from "react";
import {
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Square,
  Zap,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { beginDragOnMove, startNativeSliceDrag } from "../../utils/drag";
import { MasterVolumeControl } from "../common/MasterVolumeControl";
import { VarispeedPitchStepper } from "../common/VarispeedPitchStepper";

export const MiniDockTransport: React.FC = () => {
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const isLooping = useSampleStore((s) => s.isLooping);
  const autoPreview = useSampleStore((s) => s.autoPreview);
  const volume = useSampleStore((s) => s.volume);
  const pitchSemitones = useSampleStore((s) => s.pitchSemitones);
  const sliceRange = useSampleStore((s) => s.sliceRange);
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);

  const togglePlayPause = useSampleStore((s) => s.togglePlayPause);
  const stopPlayback = useSampleStore((s) => s.stopPlayback);
  const selectRelativeSample = useSampleStore((s) => s.selectRelativeSample);
  const toggleLooping = useSampleStore((s) => s.toggleLooping);
  const toggleAutoPreview = useSampleStore((s) => s.toggleAutoPreview);
  const toggleMute = useSampleStore((s) => s.toggleMute);
  const setVolume = useSampleStore((s) => s.setVolume);
  const setPitchSemitones = useSampleStore((s) => s.setPitchSemitones);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const recordSliceExport = useSampleStore((s) => s.recordSliceExport);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  const handleSliceBadgeMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !selectedSample || !sliceRange) return;
    e.preventDefault();
    const sample = selectedSample;
    const range = sliceRange;
    beginDragOnMove(e.clientX, e.clientY, () => {
      const { pitchSemitones: p, sliceMicroFade: mf } =
        useSampleStore.getState();
      const dur = Math.max(0.05, range.endSec - range.startSec).toFixed(2);
      const label = `Slice (${dur}s) · ${sample.file_name}`;
      void startNativeSliceDrag(
        sample.file_path,
        range.startSec,
        range.endSec,
        label,
        { pitchSemitones: p, applyMicroFade: mf }
      ).then((res) => {
        if (res?.droppedExternally && autoBinOnNleDrag && sample.id > 0) {
          addSamplesToBin([sample.id]);
        }
        if (res?.droppedExternally) {
          void recordSliceExport({
            slicePath: res.exportedPath,
            sourceSampleId: sample.id > 0 ? sample.id : null,
            sourceFilePath: sample.file_path,
            startSec: range.startSec,
            endSec: range.endSec,
            pitchSemitones: p,
            applyMicroFade: mf,
          });
          setStatusMessage(`Exported slice (${dur}s) to timeline`);
        }
      });
    });
  };

  return (
    <div className="bg-surface-1 border-b border-line px-2 h-[38px] flex items-center justify-between gap-1.5 shrink-0">
      <div className="flex items-center space-x-1 shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => selectRelativeSample(-1)}
          className="w-[26px] h-[26px] bg-surface-3 hover:border-line-hover border border-line-strong rounded-sm flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
          title="Previous Sample"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePlayPause}
          className={`w-[36px] h-[26px] border rounded-sm flex items-center justify-center transition-colors shadow-xs ${
            isPlaying
              ? "bg-accent text-accent-on border-accent"
              : "bg-accent-soft hover:bg-accent text-accent-fg hover:text-accent-on border-accent/80"
          }`}
          title="Play / Pause (Space)"
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => selectRelativeSample(1)}
          className="w-[26px] h-[26px] bg-surface-3 hover:border-line-hover border border-line-strong rounded-sm flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
          title="Next Sample"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={stopPlayback}
          className="w-[26px] h-[26px] bg-surface-3 hover:border-line-hover border border-line-strong rounded-sm flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
          title="Stop"
        >
          <Square className="w-3 h-3 fill-current" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleLooping}
          className={`w-[26px] h-[26px] border rounded-sm flex items-center justify-center transition-colors ${
            isLooping
              ? "bg-accent-soft text-accent-fg border-accent"
              : "bg-surface-3 border-line-strong text-fg-2 hover:text-fg"
          }`}
          title="Loop Playback (L)"
        >
          <Repeat className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleAutoPreview}
          className={`w-[26px] h-[26px] border rounded-sm flex items-center justify-center transition-colors ${
            autoPreview
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line-strong text-fg-2 hover:text-fg"
          }`}
          title="Auto-Play on Select"
        >
          <Zap className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Varispeed Pitch Stepper (±24st) */}
      <VarispeedPitchStepper
        pitchSemitones={pitchSemitones}
        onChange={setPitchSemitones}
        variant="dock"
      />

      {/* Inline Volume + dB Readout + Quick Drag Slice Pill */}
      <div className="flex items-center space-x-1 flex-1 min-w-[68px] justify-end">
        <MasterVolumeControl
          volume={volume}
          onToggleMute={toggleMute}
          onChangeVolume={setVolume}
          variant="dock"
        />

        {selectedSample && sliceRange && (
          <div
            onMouseDown={handleSliceBadgeMouseDown}
            title="Drag WAV slice straight into DaVinci Resolve / Premiere Pro"
            className="h-[22px] px-1.5 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent text-accent-fg font-mono text-[9.5px] font-semibold flex items-center space-x-1 cursor-grab active:cursor-grabbing shrink-0 transition-colors"
          >
            <Scissors className="w-3 h-3 shrink-0" />
            <span>
              {(sliceRange.endSec - sliceRange.startSec).toFixed(1)}s
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
