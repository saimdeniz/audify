import React, { useCallback } from "react";
import { ArrowRight, Lock, RotateCw, Star, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { AiTagSuggestionItem, SampleItem } from "../../types";
import {
  formatDuration,
  formatSampleRateCompact,
  parseSqliteUtcMs,
  splitFileNameAndExt,
} from "../../utils/format";
import { MiniWaveform, WaveformDisplayConfig } from "../MiniWaveform";
import {
  renderBpmCell,
  renderDateCell,
  renderGenreCell,
  renderKeyCell,
  renderTagsCell,
} from "./SampleTableRowCells";
import {
  ColumnId,
  FIXED_CLASS_COL_WIDTH,
  FIXED_FAV_COL_WIDTH,
  FIXED_FORMAT_COL_WIDTH,
  FIXED_MATCH_COL_WIDTH,
  FIXED_TIME_COL_WIDTH,
  FIXED_WAVEFORM_WIDTH,
  ResizableColKey,
  RowPopoverPosition,
  VisibleColumnsState,
} from "./tableLayout";

interface SampleTableRowProps {
  sample: SampleItem;
  rowIndex: number;
  totalSamples: number;
  startOffsetPx: number;
  totalTableWidth: number;
  isSimilarityMode: boolean;
  matchScore: number | null;
  isSimilarityAnchor: boolean;
  duplicateRole?: "keep" | "extra";
  duplicateGroupLabel?: string;
  duplicateHighConfidence?: boolean;
  isDuplicateGroupStart?: boolean;
  isDuplicateAltGroup?: boolean;
  duplicateReadOnly?: boolean;
  pendingAiTags?: AiTagSuggestionItem[];
  isPrimarySelected: boolean;
  isRowSelected: boolean;
  isTagPopoverOpen: boolean;
  isGenrePopoverOpen: boolean;
  columnOrder: ColumnId[];
  visibleCols: VisibleColumnsState;
  colWidths: Record<ResizableColKey, number>;
  selectedCollectionId: number | null;
  selectedGenre: string | null;
  selectedTagSet: ReadonlySet<number>;
  genreColorMap: ReadonlyMap<string, string>;
  waveformDisplay: WaveformDisplayConfig;
  favoriteShortcutLabel?: string;
  onRowClick: (e: React.MouseEvent, sample: SampleItem, index: number) => void;
  onRowMouseDown: (e: React.MouseEvent, sample: SampleItem) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    sample: SampleItem,
    index: number
  ) => void;
  onOpenTagPopover: (e: React.MouseEvent, sample: SampleItem) => void;
  onOpenGenrePopover: (e: React.MouseEvent, sample: SampleItem) => void;
  onSetHoverOverflowTags: (pos: RowPopoverPosition | null) => void;
}

export const SampleTableRow: React.FC<SampleTableRowProps> = React.memo(
  ({
    sample,
    rowIndex,
    totalSamples,
    startOffsetPx,
    totalTableWidth,
    isSimilarityMode,
    matchScore,
    isSimilarityAnchor,
    duplicateRole,
    duplicateGroupLabel,
    duplicateHighConfidence = true,
    isDuplicateGroupStart = false,
    isDuplicateAltGroup = false,
    duplicateReadOnly = false,
    pendingAiTags,
    isPrimarySelected,
    isRowSelected,
    isTagPopoverOpen,
    isGenrePopoverOpen,
    columnOrder,
    visibleCols,
    colWidths,
    selectedCollectionId,
    selectedGenre,
    selectedTagSet,
    genreColorMap,
    waveformDisplay,
    favoriteShortcutLabel,
    onRowClick,
    onRowMouseDown,
    onRowContextMenu,
    onOpenTagPopover,
    onOpenGenrePopover,
    onSetHoverOverflowTags,
  }) => {
    const handleScrubRatio = useCallback(
      (ratio: number) => {
        const state = useSampleStore.getState();
        state.selectSample(sample, true);
        const targetSec = (sample.duration_ms / 1000) * ratio;
        state.requestSeek(targetSec, true);
      },
      [sample]
    );

    const { stem, ext } = splitFileNameAndExt(sample.file_name);

    return (
      <div
        role="option"
        aria-selected={isRowSelected}
        aria-posinset={rowIndex + 1}
        aria-setsize={totalSamples}
        aria-label={sample.file_name}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          minWidth: `${totalTableWidth}px`,
          width: "100%",
          height: "34px",
          transform: `translateY(${startOffsetPx}px)`,
        }}
        onClick={(e) => onRowClick(e, sample, rowIndex)}
        onMouseDown={(e) => onRowMouseDown(e, sample)}
        onContextMenu={(e) => onRowContextMenu(e, sample, rowIndex)}
        className={`group flex items-center text-[13px] border-b border-line-subtle cursor-pointer ${
          isDuplicateGroupStart ? "audify-dup-group-start" : ""
        } ${
          isRowSelected
            ? "bg-accent-soft border-l-2 border-l-accent"
            : isDuplicateAltGroup
            ? "audify-row-surface-alt border-l-2 border-l-transparent"
            : "audify-row-surface border-l-2 border-l-transparent"
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void useSampleStore.getState().toggleFavorite(sample.id);
          }}
          style={{ width: `${FIXED_FAV_COL_WIDTH}px` }}
          className={`h-full flex items-center justify-center shrink-0 border-r border-line ${
            sample.is_favorite
              ? "text-accent-fg"
              : "text-fg-3 hover:text-fg-2"
          }`}
          title={
            favoriteShortcutLabel
              ? `Toggle Favorite (${favoriteShortcutLabel})`
              : "Toggle Favorite"
          }
        >
          <Star
            className={`w-3.5 h-3.5 ${
              sample.is_favorite ? "fill-current" : ""
            }`}
          />
        </button>

        {isSimilarityMode && (
          <div
            style={{ width: `${FIXED_MATCH_COL_WIDTH}px` }}
            className="h-full px-1 flex items-center justify-center shrink-0 border-r border-line overflow-hidden"
            title={
              isSimilarityAnchor
                ? "Similarity Search Reference Anchor (100%)"
                : matchScore !== null
                ? `Acoustic Cosine Similarity: ${(matchScore * 100).toFixed(1)}%`
                : "No match score"
            }
          >
            {isSimilarityAnchor ? (
              <span className="px-1.5 py-0.5 rounded-xs border border-accent bg-accent-soft text-accent-fg font-mono text-[9px] font-bold uppercase tracking-tight">
                ANCHOR
              </span>
            ) : matchScore !== null ? (
              <span
                className={`px-1.5 py-0.5 rounded-xs border font-mono tabular-nums text-[10px] font-semibold ${
                  matchScore >= 0.85
                    ? "bg-ok/15 border-ok/50 text-ok"
                    : matchScore >= 0.7
                    ? "bg-accent-soft border-accent text-accent-fg"
                    : "bg-surface-3 border-line text-fg-2"
                }`}
              >
                {Math.round(matchScore * 100)}%
              </span>
            ) : (
              <span className="text-fg-3 font-mono text-[10px]">—</span>
            )}
          </div>
        )}

        {columnOrder.map((colId) => {
          switch (colId) {
            case "class":
              if (!visibleCols.class) return null;
              return (
                <div
                  key="class"
                  style={{ width: `${FIXED_CLASS_COL_WIDTH}px` }}
                  className="h-full flex items-center justify-center shrink-0 overflow-hidden border-r border-line"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void useSampleStore.getState().toggleSampleLoop(sample.id);
                    }}
                    className={`w-[22px] h-[20px] rounded-xs border flex items-center justify-center transition-colors ${
                      sample.is_loop
                        ? "bg-accent-soft border-accent/60 text-accent-fg hover:border-accent"
                        : "bg-surface-2 border-line text-fg-3 hover:text-fg hover:border-line-strong"
                    }`}
                    aria-label={
                      sample.is_loop
                        ? "Class: Loop (Click to switch to One-Shot)"
                        : "Class: One-Shot (Click to switch to Loop)"
                    }
                    title={
                      sample.is_loop
                        ? "Class: Loop (Click to switch to One-Shot)"
                        : "Class: One-Shot (Click to switch to Loop)"
                    }
                  >
                    {sample.is_loop ? (
                      <RotateCw className="w-3 h-3" />
                    ) : (
                      <ArrowRight className="w-3 h-3" />
                    )}
                  </button>
                </div>
              );

            case "name":
              return (
                <div
                  key="name"
                  style={{ width: `${colWidths.name}px` }}
                  className="h-full px-2 truncate flex items-center justify-between space-x-1.5 min-w-0 shrink-0 overflow-hidden border-r border-line"
                >
                  <div className="truncate flex items-center space-x-1.5 min-w-0">
                    {duplicateGroupLabel && (
                      <span
                        className={`px-1 py-0.2 rounded-xs border font-mono text-[9px] shrink-0 ${
                          duplicateHighConfidence
                            ? "bg-surface-2 border-line text-fg-3"
                            : "bg-warn/10 border-warn/40 text-warn"
                        }`}
                        title={
                          duplicateHighConfidence
                            ? "Exact or high-confidence audio duplicate group"
                            : "Lower-similarity variation (<98%) — review before deleting"
                        }
                      >
                        {duplicateGroupLabel}
                      </span>
                    )}
                    {duplicateRole === "keep" && (
                      <span
                        className="px-1 py-0.2 rounded-xs bg-ok/15 border border-ok/40 text-ok font-mono text-[9px] font-bold shrink-0"
                        title="Suggested keep copy (protected from Select Suggested Extras)"
                      >
                        KEEP
                      </span>
                    )}
                    {duplicateReadOnly && (
                      <span
                        title="Protected Read-Only Vault library"
                        className="text-fg-3 shrink-0 inline-flex items-center"
                      >
                        <Lock className="w-2.5 h-2.5" />
                      </span>
                    )}
                    <span
                      className="truncate text-fg font-normal"
                      title={
                        sample.is_trashed && sample.original_file_path
                          ? `Moved to Trash from: ${sample.original_file_path}`
                          : sample.previous_file_name
                          ? `${sample.file_path}\n(Renamed from: ${sample.previous_file_name})`
                          : sample.file_path
                      }
                    >
                      {stem}
                      <span className="text-fg-3">{ext}</span>
                    </span>
                  </div>

                  {selectedCollectionId !== null && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void useSampleStore
                          .getState()
                          .removeSamplesFromCollection(
                            selectedCollectionId,
                            [sample.id]
                          );
                      }}
                      className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] flex items-center justify-center bg-surface-3 hover:bg-accent hover:text-accent-on hover:border-accent border border-line text-fg-2 rounded-sm shrink-0"
                      title="Remove from Collection (Del)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );

            case "waveform":
              return (
                <div
                  key="waveform"
                  style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
                  className="h-full px-2 flex items-center overflow-hidden border-r border-line shrink-0"
                >
                  <MiniWaveform
                    sampleId={sample.id}
                    peaksJson={sample.peaks_json}
                    isSelected={isPrimarySelected}
                    isActiveTrack={isPrimarySelected}
                    durationSec={sample.duration_ms / 1000}
                    width={FIXED_WAVEFORM_WIDTH - 16}
                    displayConfig={waveformDisplay}
                    onScrubRatio={handleScrubRatio}
                  />
                </div>
              );

            case "artist":
              if (!visibleCols.artist) return null;
              return (
                <div
                  key="artist"
                  style={{ width: `${colWidths.artist}px` }}
                  className="h-full px-2 flex items-center justify-center text-center truncate text-[11.5px] text-fg-2 shrink-0 overflow-hidden border-r border-line"
                  title={sample.artist || undefined}
                >
                  {sample.artist || (
                    <span className="text-fg-3 font-mono text-[10px]">
                      —
                    </span>
                  )}
                </div>
              );

            case "album":
              if (!visibleCols.album) return null;
              return (
                <div
                  key="album"
                  style={{ width: `${colWidths.album}px` }}
                  className="h-full px-2 flex items-center justify-center text-center truncate text-[11.5px] text-fg-2 shrink-0 overflow-hidden border-r border-line"
                  title={sample.album || undefined}
                >
                  {sample.album || (
                    <span className="text-fg-3 font-mono text-[10px]">
                      —
                    </span>
                  )}
                </div>
              );

            case "year":
              if (!visibleCols.year) return null;
              return (
                <div
                  key="year"
                  style={{ width: `${colWidths.year}px` }}
                  className="h-full px-2 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 overflow-hidden truncate border-r border-line"
                  title={sample.year || undefined}
                >
                  {sample.year || (
                    <span className="text-fg-3 text-[10px]">—</span>
                  )}
                </div>
              );

            case "genre":
              if (!visibleCols.genre) return null;
              return renderGenreCell({
                sample,
                width: colWidths.genre,
                selectedGenre,
                isGenrePopoverOpen,
                genreColorMap,
                onOpenGenrePopover,
              });

            case "bpm":
              if (!visibleCols.bpm) return null;
              return renderBpmCell(sample);

            case "key":
              if (!visibleCols.key) return null;
              return renderKeyCell(sample);

            case "tags":
              if (!visibleCols.tags) return null;
              return renderTagsCell({
                sample,
                width: colWidths.tags,
                selectedTagSet,
                pendingAiTags,
                isTagPopoverOpen,
                onOpenTagPopover,
                onSetHoverOverflowTags,
              });

            case "time":
              if (!visibleCols.time) return null;
              return (
                <div
                  key="time"
                  style={{ width: `${FIXED_TIME_COL_WIDTH}px` }}
                  className="h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 overflow-hidden whitespace-nowrap border-r border-line"
                >
                  {formatDuration(sample.duration_ms)}
                </div>
              );

            case "format":
              if (!visibleCols.format) return null;
              return (
                <div
                  key="format"
                  style={{ width: `${FIXED_FORMAT_COL_WIDTH}px` }}
                  className="h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-3 shrink-0 overflow-hidden whitespace-nowrap border-r border-line"
                >
                  {formatSampleRateCompact(
                    sample.sample_rate,
                    sample.bit_depth
                  )}
                </div>
              );

            case "dateModified":
              if (!visibleCols.dateModified) return null;
              return renderDateCell(
                "dateModified",
                sample.file_modified_at,
                colWidths.dateModified
              );

            case "dateAdded":
              if (!visibleCols.dateAdded) return null;
              return renderDateCell(
                "dateAdded",
                parseSqliteUtcMs(sample.created_at),
                colWidths.dateAdded
              );

            default:
              return null;
          }
        })}

        <div className="w-[28px] shrink-0" />
      </div>
    );
  }
);
