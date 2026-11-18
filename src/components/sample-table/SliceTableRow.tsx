import React from "react";
import { AlertTriangle, ArrowUpRight, Scissors, Star, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { SliceHistoryEntry } from "../../types";
import {
  formatDuration,
  formatSampleRateCompact,
  parseSqliteUtcMs,
  splitFileNameAndExt,
} from "../../utils/format";
import { MiniWaveform, WaveformDisplayConfig } from "../MiniWaveform";
import { renderDateCell } from "./SampleTableRowCells";
import { FIXED_WAVEFORM_WIDTH } from "./tableLayout";

export interface SliceColWidths {
  name: number;
  source: number;
  range: number;
  dateAdded: number;
}

export interface SliceTableRowProps {
  entry: SliceHistoryEntry;
  index: number;
  topPx: number;
  heightPx: number;
  isSelected: boolean;
  isActiveRow: boolean;
  isPlayingRow: boolean;
  colWidths: SliceColWidths;
  waveformDisplayConfig: WaveformDisplayConfig;
  isTrashMode?: boolean;
  onRowClick: (
    e: React.MouseEvent,
    entry: SliceHistoryEntry,
    index: number
  ) => void;
  onRowDoubleClick: (entry: SliceHistoryEntry, index: number) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    entry: SliceHistoryEntry,
    index: number
  ) => void;
  onRowDragStart: (e: React.DragEvent, entry: SliceHistoryEntry) => void;
}

export const SliceTableRow: React.FC<SliceTableRowProps> = React.memo(
  ({
    entry,
    index,
    topPx,
    heightPx,
    isSelected,
    isActiveRow,
    isPlayingRow,
    colWidths,
    waveformDisplayConfig,
    isTrashMode = false,
    onRowClick,
    onRowDoubleClick,
    onRowContextMenu,
    onRowDragStart,
  }) => {
    const { stem: sliceStem, ext: sliceExt } = splitFileNameAndExt(
      entry.slice_name
    );

    const hasPitch = Math.abs(entry.pitch_semitones) >= 0.01;
    const pitchLabel =
      entry.pitch_semitones > 0
        ? `+${Math.round(entry.pitch_semitones)}st`
        : `${Math.round(entry.pitch_semitones)}st`;

    return (
      <div
        role="row"
        aria-selected={isSelected}
        draggable={!isTrashMode && entry.file_exists}
        onDragStart={(e) => onRowDragStart(e, entry)}
        onClick={(e) => onRowClick(e, entry, index)}
        onDoubleClick={() => onRowDoubleClick(entry, index)}
        onContextMenu={(e) => onRowContextMenu(e, entry, index)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${heightPx}px`,
          transform: `translateY(${topPx}px)`,
        }}
        className={`group flex items-center text-[11.5px] border-b border-line transition-colors cursor-pointer select-none ${
          isActiveRow || isSelected
            ? "bg-accent-soft text-fg border-l-2 border-l-accent"
            : index % 2 === 1
              ? "audify-row-surface-alt hover:bg-surface-hover text-fg border-l-2 border-l-transparent"
              : "audify-row-surface hover:bg-surface-hover text-fg border-l-2 border-l-transparent"
        } ${!entry.file_exists ? "opacity-55" : ""}`}
      >
        {/* 1. Favorite Star (34px) */}
        <button
          type="button"
          disabled={isTrashMode}
          aria-label={
            isTrashMode
              ? "Favorite status preserved in Trash"
              : entry.is_favorite
              ? "Remove slice from favorites"
              : "Add slice to favorites"
          }
          onClick={(e) => {
            e.stopPropagation();
            if (!isTrashMode) {
              void useSampleStore.getState().toggleSliceFavorite(entry.id);
            }
          }}
          className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line ${
            isTrashMode ? "cursor-default opacity-60" : "cursor-pointer"
          }`}
          title={
            isTrashMode
              ? "Favorites are preserved until restored or emptied"
              : entry.is_favorite
              ? "Remove slice from Favorites (F)"
              : "Add slice to Favorites (F)"
          }
        >
          <Star
            className={`w-3.5 h-3.5 transition-colors ${
              entry.is_favorite
                ? "text-accent-fg fill-current"
                : isTrashMode
                  ? "text-fg-3"
                  : "text-fg-3 hover:text-fg-2"
            }`}
          />
        </button>

        {/* 2. Slice Name (resizable pixel width matching Main SampleTable) */}
        <div
          style={{ width: `${colWidths.name}px` }}
          className="h-full px-2.5 flex items-center gap-1.5 min-w-0 shrink-0 overflow-hidden border-r border-line"
          title={
            isTrashMode
              ? `Quarantined slice · Original: ${entry.slice_path}`
              : entry.slice_path
          }
        >
          {entry.file_exists ? (
            isTrashMode ? (
              <Trash2 className="w-3 h-3 text-accent-fg shrink-0" />
            ) : (
              <Scissors className="w-3 h-3 text-accent-fg shrink-0" />
            )
          ) : (
            <span
              title={
                isTrashMode
                  ? "Quarantined slice WAV is missing from disk"
                  : "Slice WAV file is missing from disk"
              }
            >
              <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
            </span>
          )}
          <div className="truncate font-medium tracking-tight min-w-0">
            <span className="text-fg">{sliceStem}</span>
            {sliceExt && (
              <span className="text-fg-2 font-normal">{sliceExt}</span>
            )}
          </div>
        </div>

        {/* 3. MiniWaveform (FIXED_WAVEFORM_WIDTH = 220px) */}
        <div
          style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
          className="h-full px-2 flex items-center shrink-0 overflow-hidden border-r border-line"
        >
          <MiniWaveform
            sampleId={-Math.max(1, entry.id)}
            peaksJson={entry.peaks_json || "[]"}
            isSelected={isActiveRow}
            isActiveTrack={isPlayingRow}
            durationSec={entry.duration_ms / 1000}
            width={FIXED_WAVEFORM_WIDTH - 16}
            displayConfig={waveformDisplayConfig}
          />
        </div>

        {/* 4. Source Track (resizable pixel width + hover ↗ action) */}
        <div
          style={{ width: `${colWidths.source}px` }}
          onClick={(e) => {
            e.stopPropagation();
            void useSampleStore.getState().jumpToSliceSource(entry);
          }}
          className="group/source h-full px-2.5 flex items-center justify-between gap-1.5 min-w-0 shrink-0 overflow-hidden border-r border-line hover:bg-surface-2 transition-colors"
          title={`Open original source "${entry.source_file_name}" and re-select ${entry.start_sec.toFixed(
            2
          )}s–${entry.end_sec.toFixed(2)}s`}
        >
          <span className="truncate text-[11px] text-fg-2 group-hover/source:text-accent-fg group-hover/source:underline transition-colors min-w-0">
            {entry.source_file_name}
          </span>
          <ArrowUpRight className="w-3.5 h-3.5 text-fg-3 group-hover/source:text-accent-fg opacity-60 group-hover/source:opacity-100 shrink-0 transition-all" />
        </div>

        {/* 5. Range / FX (resizable pixel width) */}
        <div
          style={{ width: `${colWidths.range}px` }}
          className="h-full px-2 flex items-center gap-1 shrink-0 overflow-hidden border-r border-line font-mono text-[10.5px] text-fg-2 tabular-nums"
        >
          <span className="truncate">
            {entry.start_sec.toFixed(2)}–{entry.end_sec.toFixed(2)}s
          </span>
          {hasPitch && (
            <span className="px-1 py-0.2 rounded-[2px] bg-accent-soft border border-accent text-accent-fg text-[9.5px] shrink-0">
              {pitchLabel}
            </span>
          )}
          {entry.micro_fade && (
            <span
              className="px-1 py-0.2 rounded-[2px] bg-surface-3 border border-line text-fg-3 text-[9px] shrink-0"
              title="Micro-fade applied"
            >
              fade
            </span>
          )}
        </div>

        {/* 6. Duration / Time (78px) */}
        <div className="w-[78px] h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 overflow-hidden whitespace-nowrap border-r border-line">
          {formatDuration(entry.duration_ms / 1000)}
        </div>

        {/* 7. Format / Sample Rate (84px) */}
        <div className="w-[84px] h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-3 shrink-0 overflow-hidden whitespace-nowrap border-r border-line">
          {formatSampleRateCompact(
            entry.sample_rate > 0 ? entry.sample_rate : 48000,
            entry.bit_depth > 0 ? entry.bit_depth : 16
          )}
        </div>

        {/* 8. Added Date (resizable pixel width matching Main SampleTable) */}
        {renderDateCell(
          "dateAdded",
          parseSqliteUtcMs(entry.created_at),
          colWidths.dateAdded
        )}
      </div>
    );
  }
);
