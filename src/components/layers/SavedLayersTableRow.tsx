import React from "react";
import { AlertTriangle, Layers, Pencil, Star, Trash2 } from "lucide-react";
import type { LayerHistoryEntry } from "../../types";
import {
  formatDuration,
  formatSampleRateCompact,
  parseSqliteUtcMs,
  splitFileNameAndExt,
} from "../../utils/format";
import { MiniWaveform, WaveformDisplayConfig } from "../MiniWaveform";
import { renderDateCell } from "../sample-table/SampleTableRowCells";
import { FIXED_WAVEFORM_WIDTH } from "../sample-table/tableLayout";

export interface LayerColWidths {
  name: number;
  structure: number;
  updated: number;
}

interface SavedLayersTableRowProps {
  entry: LayerHistoryEntry;
  idx: number;
  topPx: number;
  heightPx: number;
  mode: "saved" | "favorites" | "trash";
  isSelected: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  colWidths: LayerColWidths;
  waveformConfig: WaveformDisplayConfig;
  onMouseDownRow: (
    e: React.MouseEvent<HTMLDivElement>,
    entry: LayerHistoryEntry,
    isSelected: boolean
  ) => void;
  onClickRow: (
    e: React.MouseEvent<HTMLDivElement>,
    entry: LayerHistoryEntry,
    idx: number,
    isSelected: boolean,
    isCurrent: boolean
  ) => void;
  onDoubleClickRow: (entry: LayerHistoryEntry) => void;
  onContextMenuRow: (
    e: React.MouseEvent<HTMLDivElement>,
    entry: LayerHistoryEntry,
    isSelected: boolean
  ) => void;
  onToggleFavorite: (id: number) => void;
  onOpenInEditor: (entry: LayerHistoryEntry) => void;
}

/**
 * Memoized virtualized row for `SavedLayersTableView`.
 */
export const SavedLayersTableRow: React.FC<SavedLayersTableRowProps> = React.memo(
  ({
    entry,
    idx,
    topPx,
    heightPx,
    mode,
    isSelected,
    isCurrent,
    isPlaying,
    colWidths,
    waveformConfig,
    onMouseDownRow,
    onClickRow,
    onDoubleClickRow,
    onContextMenuRow,
    onToggleFavorite,
    onOpenInEditor,
  }) => {
    const { stem, ext } = splitFileNameAndExt(entry.layer_name);
    const updatedMs = parseSqliteUtcMs(entry.updated_at || entry.created_at);

    return (
      <div
        role="row"
        aria-selected={isSelected}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${heightPx}px`,
          transform: `translateY(${topPx}px)`,
        }}
        onMouseDown={(e) => onMouseDownRow(e, entry, isSelected)}
        onClick={(e) => onClickRow(e, entry, idx, isSelected, isCurrent)}
        onDoubleClick={() => onDoubleClickRow(entry)}
        onContextMenu={(e) => onContextMenuRow(e, entry, isSelected)}
        className={`group h-[34px] flex items-center text-[11.5px] border-b border-line transition-colors cursor-pointer select-none ${
          isCurrent || isSelected
            ? "bg-accent-soft text-fg border-l-2 border-l-accent"
            : idx % 2 === 1
            ? "audify-row-surface-alt hover:bg-surface-hover text-fg border-l-2 border-l-transparent"
            : "audify-row-surface hover:bg-surface-hover text-fg border-l-2 border-l-transparent"
        } ${!entry.file_exists ? "opacity-55" : ""}`}
      >
        <button
          type="button"
          disabled={mode === "trash"}
          onClick={(e) => {
            e.stopPropagation();
            if (mode !== "trash") onToggleFavorite(entry.id);
          }}
          className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line ${
            mode === "trash" ? "cursor-default opacity-60" : "cursor-pointer"
          }`}
          title={
            mode === "trash"
              ? "Favorites are preserved in Trash"
              : entry.is_favorite
              ? "Remove layer from Favorites"
              : "Add layer to Favorites"
          }
          aria-label={
            entry.is_favorite
              ? "Remove layer from Favorites"
              : "Add layer to Favorites"
          }
          aria-pressed={entry.is_favorite}
        >
          <Star
            className={`w-3.5 h-3.5 transition-colors ${
              entry.is_favorite
                ? "text-accent-fg fill-current"
                : "text-fg-3 hover:text-fg-2"
            }`}
          />
        </button>

        <div
          style={{ width: `${colWidths.name}px` }}
          className="h-full px-2.5 flex items-center gap-1.5 min-w-0 shrink-0 overflow-hidden border-r border-line"
          title={`${entry.layer_path} · Double-click to open in Layers Editor`}
        >
          {entry.file_exists ? (
            mode === "trash" ? (
              <Trash2 className="w-3 h-3 text-accent-fg shrink-0" />
            ) : (
              <Layers className="w-3 h-3 text-accent-fg shrink-0" />
            )
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
          )}

          <div className="flex-1 truncate text-[13px] font-normal min-w-0">
            <span className="text-fg">{stem}</span>
            {ext && <span className="text-fg-3">{ext}</span>}
          </div>

          {mode !== "trash" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInEditor(entry);
              }}
              className="w-[20px] h-[20px] rounded-[2px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 text-fg-3 hover:text-accent-fg flex items-center justify-center shrink-0 transition-opacity cursor-pointer"
              title="Open in Layers Editor"
              aria-label={`Open ${entry.layer_name} in Layers Editor`}
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>

        <div
          style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
          className="h-full px-2 flex items-center shrink-0 overflow-hidden border-r border-line"
        >
          <MiniWaveform
            sampleId={-Math.max(1, entry.id)}
            peaksJson={entry.peaks_json || "[]"}
            isSelected={isCurrent}
            isActiveTrack={isCurrent && isPlaying}
            durationSec={entry.duration_ms / 1000}
            width={FIXED_WAVEFORM_WIDTH - 16}
            displayConfig={waveformConfig}
          />
        </div>

        <div
          style={{ width: `${colWidths.structure}px` }}
          className="h-full px-2.5 flex items-center font-mono text-[10.5px] text-fg-2 shrink-0 border-r border-line truncate"
        >
          {entry.lane_count} {entry.lane_count === 1 ? "lane" : "lanes"} ·{" "}
          {entry.clip_count} {entry.clip_count === 1 ? "clip" : "clips"}
        </div>

        <div className="w-[78px] h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 border-r border-line">
          {formatDuration(entry.duration_ms)}
        </div>

        <div className="w-[84px] h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-3 shrink-0 border-r border-line">
          {formatSampleRateCompact(
            entry.sample_rate > 0 ? entry.sample_rate : 48000,
            entry.bit_depth > 0 ? entry.bit_depth : 16
          )}
        </div>

        {renderDateCell("dateAdded", updatedMs, colWidths.updated)}
      </div>
    );
  }
);
SavedLayersTableRow.displayName = "SavedLayersTableRow";
