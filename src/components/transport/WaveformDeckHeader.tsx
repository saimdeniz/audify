import React, { useEffect, useRef } from "react";
import { BookmarkPlus, GripVertical, Scissors, X } from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { getPlayheadSec, subscribePlayhead } from "../../store/playheadClock";
import { SampleItem, SliceRange } from "../../types";
import { formatSampleSpecsFull, formatSecondsCode } from "../../utils/format";
import { transposeMusicalKey } from "../../utils/search/musicalKey";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { isSlicePreviewSample } from "../../utils/slicePreview";
import { QuickCreatePopover } from "../QuickCreatePopover";

function formatBpmCompact(bpm: number): string {
  const rounded = Math.round(bpm * 10) / 10;
  return Math.abs(rounded - Math.round(rounded)) < 0.05
    ? String(Math.round(rounded))
    : rounded.toFixed(1);
}

const WaveformTimecodeReadout: React.FC<{ effectiveDuration: number }> =
  React.memo(({ effectiveDuration }) => {
    const timeRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
      const el = timeRef.current;
      let lastFormatted = formatSecondsCode(getPlayheadSec());
      if (el) {
        el.textContent = lastFormatted;
      }
      return subscribePlayhead((sec) => {
        const nextFormatted = formatSecondsCode(sec);
        if (nextFormatted !== lastFormatted) {
          lastFormatted = nextFormatted;
          if (timeRef.current) {
            timeRef.current.textContent = nextFormatted;
          }
        }
      });
    }, []);

    return (
      <span className="font-mono tabular-nums text-[11px] font-semibold text-accent-fg shrink-0">
        <span ref={timeRef}>{formatSecondsCode(getPlayheadSec())}</span>
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
  zoomLevel?: number;
  onResetZoom?: () => void;
  pitchSemitones?: number;
  onResetPitch?: () => void;
  saveSliceShortcut?: string;
  onClearSlice: () => void;
  onSaveSlice?: (customName?: string) => Promise<boolean | void> | boolean | void;
  onSliceBadgeMouseDown?: (e: React.MouseEvent) => void;
  onHeaderSampleMouseDown?: (e: React.MouseEvent) => void;
}

export const WaveformDeckHeader: React.FC<WaveformDeckHeaderProps> = React.memo(
  ({
    selectedSample,
    isMiniDock,
    effectiveDuration,
    sliceRange,
    zoomLevel = 1,
    onResetZoom,
    pitchSemitones = 0,
    onResetPitch,
    saveSliceShortcut,
    onClearSlice,
    onSaveSlice,
    onSliceBadgeMouseDown,
    onHeaderSampleMouseDown,
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
    const isPitched = Math.abs(pitchSemitones) >= 0.01;
    const transposedKey =
      selectedSample && isPitched
        ? transposeMusicalKey(
            selectedSample.musical_key || selectedSample.camelot_key || "",
            pitchSemitones
          )
        : null;
    const rawBpm = selectedSample?.bpm;
    const hasBpm =
      typeof rawBpm === "number" && Number.isFinite(rawBpm) && rawBpm > 0;
    const pitchFactor = isPitched ? Math.pow(2, pitchSemitones / 12) : 1;
    const effectiveBpm =
      isPitched && hasBpm ? rawBpm * pitchFactor : null;
    const signedSt =
      pitchSemitones > 0 ? `+${pitchSemitones}` : String(pitchSemitones);
    const bpmArrow =
      hasBpm && effectiveBpm !== null
        ? `${formatBpmCompact(rawBpm)} → ${formatBpmCompact(effectiveBpm)}`
        : null;
    const baseDurationSec = sliceRange
      ? Math.max(0.01, sliceRange.endSec - sliceRange.startSec)
      : effectiveDuration;
    const effectiveVarispeedDur =
      isPitched && baseDurationSec > 0 ? baseDurationSec / pitchFactor : null;
    const pitchPillLabel = (() => {
      if (transposedKey && bpmArrow && effectiveBpm !== null) {
        return isMiniDock
          ? `${signedSt}st · ${transposedKey.fromKey}→${transposedKey.toKey} · ${formatBpmCompact(effectiveBpm)}`
          : `Pitch ${signedSt}st · ${transposedKey.fromKey} → ${transposedKey.toKey} · ${bpmArrow} BPM`;
      }
      if (transposedKey) {
        return isMiniDock
          ? `${signedSt}st · ${transposedKey.fromKey}→${transposedKey.toKey}`
          : `Pitch ${signedSt}st · ${transposedKey.fromKey} → ${transposedKey.toKey}`;
      }
      if (bpmArrow) {
        return isMiniDock
          ? `${signedSt}st · ${bpmArrow}`
          : `Pitch ${signedSt}st · ${bpmArrow} BPM`;
      }
      return isMiniDock ? `${signedSt}st · WAV` : `Pitch ${signedSt}st · WAV`;
    })();
    const pitchPillTitle = (() => {
      const parts: string[] = [];
      if (transposedKey) {
        parts.push(
          `Transposed key: ${transposedKey.fromKey} (${transposedKey.fromCamelot}) → ${transposedKey.toKey} (${transposedKey.toCamelot})`
        );
      }
      if (bpmArrow) {
        parts.push(
          `Effective varispeed BPM: ${bpmArrow} (${(pitchFactor * 100).toFixed(1)}% speed)`
        );
      }
      if (effectiveVarispeedDur !== null) {
        parts.push(
          `Effective ${sliceRange ? "slice " : ""}duration: ${effectiveVarispeedDur.toFixed(2)}s (${(pitchFactor * 100).toFixed(1)}% speed)`
        );
      }
      if (parts.length > 0) {
        return `${parts.join(" · ")} · Drag exports rendered WAV. Click to reset pitch to 0st.`;
      }
      return "Global pitch is active — dragging samples to your NLE exports a rendered WAV using your Export Format preset. Click to reset pitch to 0st.";
    })();

    return (
      <div
        className={`h-[22px] bg-surface-1 border-b border-line-subtle flex items-center justify-between text-[11px] gap-2 ${
          isMiniDock ? "px-2.5" : "px-3"
        }`}
      >
        <div
          onMouseDown={
            selectedSample && !selectedSample.is_trashed
              ? onHeaderSampleMouseDown
              : undefined
          }
          title={
            selectedSample && !selectedSample.is_trashed
              ? sliceRange
                ? "Drag directly onto NLE / DAW timeline (exports active slice)"
                : Math.abs(pitchSemitones) >= 0.01
                ? "Drag directly onto NLE / DAW timeline (exports pitched WAV)"
                : "Drag directly onto NLE / DAW timeline or sidebar"
              : undefined
          }
          className={`group/deckdrag flex items-center space-x-1.5 truncate min-w-0 ${
            selectedSample && !selectedSample.is_trashed && onHeaderSampleMouseDown
              ? "cursor-grab active:cursor-grabbing"
              : ""
          }`}
        >
          {selectedSample && !selectedSample.is_trashed && onHeaderSampleMouseDown && (
            <GripVertical className="w-3 h-3 text-fg-3 group-hover/deckdrag:text-accent-fg shrink-0 transition-colors" />
          )}
          <span className="font-medium text-fg text-[12px] truncate">
            {selectedSample ? selectedSample.file_name : "Audify — Ready"}
          </span>
          {selectedSample && !isMiniDock && (
            <span className="text-fg-3 font-mono text-[11px] truncate hidden sm:inline">
              {selectedSample.folder_path}
            </span>
          )}
        </div>

        <div
          className={`flex items-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 ${
            isMiniDock ? "gap-1.5" : "space-x-2.5"
          }`}
        >
          {zoomLevel > 1.03 && onResetZoom && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onResetZoom}
              title="Waveform horizontal zoom (Wheel to zoom, Middle-drag to pan). Click to reset to 1x."
              className="h-[18px] px-1.5 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent text-accent-fg font-mono text-[9.5px] font-semibold inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
            >
              <span>{zoomLevel >= 10 ? `${Math.round(zoomLevel)}x` : `${zoomLevel.toFixed(1)}x`}</span>
              <X className="w-2.5 h-2.5 shrink-0" />
            </button>
          )}
          {isPitched && onResetPitch && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onResetPitch}
              title={pitchPillTitle}
              className={`h-[18px] px-1.5 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent text-accent-fg font-mono text-[9.5px] font-semibold inline-flex items-center gap-1 min-w-0 shrink-0 transition-colors cursor-pointer ${
                isMiniDock ? "max-w-[165px]" : ""
              }`}
            >
              <span className="truncate">{pitchPillLabel}</span>
              <X className="w-2.5 h-2.5 shrink-0" />
            </button>
          )}
          {selectedSample && isMiniDock && (
            <WaveformTimecodeReadout effectiveDuration={effectiveDuration} />
          )}
          {selectedSample && !sliceRange && !isMiniDock && (
            <span className="text-[10px] text-fg-3 hidden xl:inline">
              {isSlicePreviewSample(selectedSample)
                ? "Slice preview · Use ↗ on row for source"
                : "Right-drag to slice · I / O mark"}
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
            isMiniDock &&
            onSliceBadgeMouseDown && (
              <div
                onMouseDown={onSliceBadgeMouseDown}
                title="Drag WAV slice straight into DaVinci Resolve / Premiere Pro"
                className="h-[18px] px-1.5 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent text-accent-fg font-mono text-[9.5px] font-semibold inline-flex items-center gap-0.5 cursor-grab active:cursor-grabbing shrink-0 transition-colors"
              >
                <Scissors className="w-2.5 h-2.5 shrink-0" />
                <span>
                  {(sliceRange.endSec - sliceRange.startSec).toFixed(1)}s
                </span>
              </div>
            )}
          {sliceRange &&
            selectedSample &&
            !isSlicePreviewSample(selectedSample) &&
            onSaveSlice && (
            <QuickCreatePopover
              title="Save Slice"
              placeholder="Slice filename..."
              hasColor={false}
              defaultValue={suggestedSliceName}
              buttonTitle={saveButtonTitle}
              buttonClassName={
                isMiniDock
                  ? "w-[18px] h-[18px] text-accent-fg hover:bg-accent-soft rounded-xs border border-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  : "h-[18px] px-1.5 text-accent-fg hover:bg-accent-soft rounded-xs border border-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              }
              buttonIcon={<BookmarkPlus className="w-3 h-3" />}
              buttonLabel={isMiniDock ? undefined : "Save"}
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
