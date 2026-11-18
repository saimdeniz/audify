import React from "react";
import { BookmarkPlus, X } from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { usePlayheadSec } from "../../store/playheadClock";
import { SampleItem, SliceRange } from "../../types";
import { formatSampleSpecsFull, formatSecondsCode } from "../../utils/format";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { isSlicePreviewSample } from "../../utils/slicePreview";
import { QuickCreatePopover } from "../QuickCreatePopover";

const WaveformTimecodeReadout: React.FC<{ effectiveDuration: number }> =
  React.memo(({ effectiveDuration }) => {
    const playheadSec = usePlayheadSec();
    return (
      <span className="font-mono tabular-nums text-[11px] font-semibold text-accent-fg shrink-0">
        {formatSecondsCode(playheadSec)}
        <span className="text-fg-2 font-normal">
          {" "}
          / {formatSecondsCode(effectiveDuration)}
        </span>
      </span>
    );
  });

interface WaveformDeckHeaderProps {
  selectedSample: SampleItem | null;
  isMiniDock: boolean;
  effectiveDuration: number;
  sliceRange: SliceRange | null;
  saveSliceShortcut?: string;
  onClearSlice: () => void;
  onSaveSlice?: (customName?: string) => Promise<boolean | void> | boolean | void;
}

export const WaveformDeckHeader: React.FC<WaveformDeckHeaderProps> = React.memo(
  ({
    selectedSample,
    isMiniDock,
    effectiveDuration,
    sliceRange,
    saveSliceShortcut,
    onClearSlice,
    onSaveSlice,
  }) => {
    const saveShortcutLabel = formatShortcutDisplay(
      saveSliceShortcut ?? DEFAULT_SHORTCUTS.saveSlice ?? ""
    );
    const saveButtonTitle = saveShortcutLabel
      ? `Save slice to export folder & Slices tab (${saveShortcutLabel})`
      : "Save slice to export folder & Slices tab";
    const suggestedSliceName =
      selectedSample && sliceRange
        ? `${selectedSample.file_name.replace(/\.[^.]+$/, "")}_${sliceRange.startSec.toFixed(
            2
          )}-${sliceRange.endSec.toFixed(2)}s`
        : "";

    return (
      <div className="h-[22px] bg-surface-1 border-b border-line-subtle px-3 flex items-center justify-between text-[11px] gap-2">
        <div className="flex items-center space-x-2 truncate min-w-0">
          <span className="font-medium text-fg text-[12px] truncate">
            {selectedSample ? selectedSample.file_name : "Audify — Ready"}
          </span>
          {selectedSample && !isMiniDock && (
            <span className="text-fg-3 font-mono text-[11px] truncate hidden sm:inline">
              {selectedSample.folder_path}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2.5 font-mono tabular-nums text-[11px] text-fg-2 shrink-0">
          {selectedSample && isMiniDock && (
            <WaveformTimecodeReadout effectiveDuration={effectiveDuration} />
          )}
          {selectedSample && !sliceRange && !isMiniDock && (
            <span className="text-[10px] text-fg-3 hidden xl:inline">
              {isSlicePreviewSample(selectedSample)
                ? "Slice preview · Use ↗ on row for source"
                : "Drag waveform to slice"}
            </span>
          )}
          {selectedSample && (
            <span className="hidden sm:inline">
              {formatSampleSpecsFull(
                selectedSample.sample_rate,
                selectedSample.bit_depth,
                selectedSample.channels
              )}
            </span>
          )}
          {sliceRange &&
            selectedSample &&
            !isSlicePreviewSample(selectedSample) &&
            onSaveSlice &&
            !isMiniDock && (
            <QuickCreatePopover
              title="Save Slice"
              placeholder="Slice filename..."
              hasColor={false}
              defaultValue={suggestedSliceName}
              buttonTitle={saveButtonTitle}
              buttonClassName="h-[18px] px-1.5 text-accent-fg hover:bg-accent-soft rounded-xs border border-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              buttonIcon={<BookmarkPlus className="w-3 h-3" />}
              buttonLabel="Save"
              onCreated={(name) => onSaveSlice(name)}
            />
          )}
          {sliceRange && (
            <button
              type="button"
              onClick={onClearSlice}
              className="w-[18px] h-[18px] text-accent-fg hover:bg-accent-soft rounded-xs border border-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              title="Clear Slice"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }
);
