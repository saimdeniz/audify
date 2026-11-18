import React from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { AiTagSuggestionItem, SampleItem } from "../../types";
import { formatSampleTimestamp } from "../../utils/format";
import {
  FIXED_BPM_COL_WIDTH,
  FIXED_KEY_COL_WIDTH,
  RowPopoverPosition,
} from "./tableLayout";

function togglePrefixedSearchToken(prefix: "bpm:" | "key:", tokenValue: string) {
  const state = useSampleStore.getState();
  const fullToken = `${prefix}${tokenValue}`;
  const parts = state.searchQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const exactIdx = parts.findIndex(
    (p) => p.toLowerCase() === fullToken.toLowerCase()
  );
  if (exactIdx >= 0) {
    parts.splice(exactIdx, 1);
    state.setSearchQuery(parts.join(" "));
    return;
  }
  const filtered = parts.filter((p) => !p.toLowerCase().startsWith(prefix));
  filtered.push(fullToken);
  state.setSearchQuery(filtered.join(" "));
}

interface GenreCellParams {
  sample: SampleItem;
  width: number;
  selectedGenre: string | null;
  isGenrePopoverOpen: boolean;
  genreColorMap: ReadonlyMap<string, string>;
  onOpenGenrePopover: (e: React.MouseEvent, sample: SampleItem) => void;
}

export function renderGenreCell({
  sample,
  width,
  selectedGenre,
  isGenrePopoverOpen,
  genreColorMap,
  onOpenGenrePopover,
}: GenreCellParams) {
  return (
    <div
      key="genre"
      style={{ width: `${width}px` }}
      className="h-full px-1.5 flex items-center space-x-1 relative shrink-0 overflow-hidden border-r border-line"
    >
      {sample.genre && (
        <span
          data-tag-badge="true"
          onClick={(e) => {
            e.stopPropagation();
            useSampleStore.getState().setSelectedGenre(sample.genre);
          }}
          title={`Genre: ${sample.genre}`}
          className={`group/genre inline-flex items-center space-x-1 text-[11px] h-[20px] px-1.5 rounded-xs border min-w-0 flex-1 max-w-full cursor-pointer shrink ${
            selectedGenre &&
            selectedGenre.toLowerCase() === sample.genre.toLowerCase()
              ? "bg-accent-soft border-accent text-accent-fg font-medium"
              : "bg-surface-badge border-line-strong text-fg-2 hover:text-fg hover:border-line-hover"
          }`}
          style={{
            borderLeftColor:
              genreColorMap.get(sample.genre.toLowerCase()) || "#8B5CF6",
            borderLeftWidth: "2px",
          }}
        >
          <span className="truncate min-w-0">{sample.genre}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void useSampleStore.getState().assignGenre(sample.id, "");
            }}
            className="hidden group-hover/genre:inline-flex items-center justify-center text-fg-2 hover:text-danger ml-0.5 shrink-0"
            title="Clear genre"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      )}

      <button
        type="button"
        data-tag-badge="true"
        onClick={(e) => onOpenGenrePopover(e, sample)}
        className={`w-[22px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
          isGenrePopoverOpen
            ? "bg-accent border-accent text-accent-on"
            : "bg-surface-badge border-line-strong hover:border-accent text-fg-2 hover:text-accent-fg"
        }`}
        title={sample.genre ? "Change genre" : "Assign genre"}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function renderBpmCell(sample: SampleItem) {
  const hasBpm =
    sample.bpm !== null &&
    sample.bpm !== undefined &&
    Number.isFinite(sample.bpm) &&
    sample.bpm > 0;
  const roundedTenth = hasBpm ? Math.round(sample.bpm! * 10) / 10 : 0;
  const bpmLabel = hasBpm
    ? Number.isInteger(roundedTenth)
      ? String(Math.round(roundedTenth))
      : roundedTenth.toFixed(1)
    : "";

  return (
    <div
      key="bpm"
      style={{ width: `${FIXED_BPM_COL_WIDTH}px` }}
      className="h-full px-1 flex items-center justify-center shrink-0 overflow-hidden border-r border-line"
    >
      {hasBpm ? (
        <button
          type="button"
          data-tag-badge="true"
          onClick={(e) => {
            e.stopPropagation();
            togglePrefixedSearchToken("bpm:", String(Math.round(sample.bpm!)));
          }}
          title={`Tempo: ${bpmLabel} BPM — Click to filter ~${Math.round(
            sample.bpm!
          )} BPM`}
          className="h-[20px] px-1.5 rounded-xs font-mono tabular-nums text-[11px] text-fg-2 hover:text-accent-fg hover:bg-surface-badge border border-transparent hover:border-line-strong transition-colors truncate"
        >
          {bpmLabel}
        </button>
      ) : (
        <span className="text-fg-3 font-mono text-[10px]">—</span>
      )}
    </div>
  );
}

export function renderKeyCell(sample: SampleItem) {
  const camelot = sample.camelot_key?.trim() || "";
  const musical = sample.musical_key?.trim() || "";
  const hasKey = Boolean(camelot || musical);
  const badgeText =
    camelot && musical ? `${camelot}·${musical}` : camelot || musical;

  return (
    <div
      key="key"
      style={{ width: `${FIXED_KEY_COL_WIDTH}px` }}
      className="h-full px-1 flex items-center justify-center shrink-0 overflow-hidden border-r border-line"
    >
      {hasKey ? (
        <button
          type="button"
          data-tag-badge="true"
          onClick={(e) => {
            e.stopPropagation();
            const harmonic =
              (e.ctrlKey || e.metaKey || e.altKey) && Boolean(camelot);
            togglePrefixedSearchToken(
              "key:",
              harmonic ? `~${camelot}` : camelot || musical
            );
          }}
          title={`Key: ${musical || camelot}${
            camelot && musical ? ` (${camelot})` : ""
          } — Click for exact key, Ctrl/Alt+Click for harmonic mix (~${
            camelot || musical
          })`}
          className="h-[20px] max-w-full px-1.5 rounded-xs bg-surface-badge border border-line-strong hover:border-accent text-fg-2 hover:text-accent-fg font-mono tabular-nums text-[10px] flex items-center justify-center truncate transition-colors"
        >
          <span className="truncate">{badgeText}</span>
        </button>
      ) : (
        <span className="text-fg-3 font-mono text-[10px]">—</span>
      )}
    </div>
  );
}

interface TagsCellParams {
  sample: SampleItem;
  width: number;
  selectedTagSet: ReadonlySet<number>;
  pendingAiTags?: AiTagSuggestionItem[];
  isTagPopoverOpen: boolean;
  onOpenTagPopover: (e: React.MouseEvent, sample: SampleItem) => void;
  onSetHoverOverflowTags: (pos: RowPopoverPosition | null) => void;
}

export function renderTagsCell({
  sample,
  width,
  selectedTagSet,
  pendingAiTags,
  isTagPopoverOpen,
  onOpenTagPopover,
  onSetHoverOverflowTags,
}: TagsCellParams) {
  const visibleAiLimit = sample.tags.length === 0 ? 2 : 1;
  const visibleAiSuggestions = pendingAiTags
    ? pendingAiTags.slice(0, visibleAiLimit)
    : [];
  return (
    <div
      key="tags"
      style={{ width: `${width}px` }}
      className="h-full px-1.5 flex items-center space-x-1 relative shrink-0 overflow-hidden border-r border-line"
    >
      {sample.tags.slice(0, 2).map((badge) => {
        const isTagFiltered = selectedTagSet.has(badge.id);
        return (
          <span
            key={badge.id}
            data-tag-badge="true"
            onClick={(e) => {
              e.stopPropagation();
              useSampleStore
                .getState()
                .selectOrToggleTagFilter(badge.id, e.ctrlKey || e.metaKey);
            }}
            title={`Filter: ${badge.name}`}
            className={`group/tag inline-flex items-center space-x-1 text-[11px] h-[20px] px-1.5 rounded-xs border min-w-0 max-w-[76px] cursor-pointer shrink ${
              isTagFiltered
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-badge border-line-strong text-fg-2 hover:text-fg hover:border-line-hover"
            }`}
            style={{
              borderLeftColor: badge.color,
              borderLeftWidth: "2px",
            }}
          >
            <span className="truncate min-w-0">{badge.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void useSampleStore.getState().unassignTag(sample.id, badge.id);
              }}
              className="hidden group-hover/tag:inline-flex items-center justify-center text-fg-2 hover:text-danger ml-0.5 shrink-0"
              title={`Remove ${badge.name}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        );
      })}

      {sample.tags.length > 2 && (
        <button
          type="button"
          data-tag-badge="true"
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSetHoverOverflowTags({
              sampleId: sample.id,
              x: Math.min(window.innerWidth - 220, Math.max(12, rect.left - 30)),
              y:
                rect.bottom + 90 > window.innerHeight
                  ? rect.top - 64
                  : rect.bottom + 4,
            });
          }}
          onMouseLeave={() => onSetHoverOverflowTags(null)}
          onClick={(e) => onOpenTagPopover(e, sample)}
          className="h-[20px] px-1.5 bg-surface-3 hover:bg-accent-soft border border-line-strong hover:border-accent text-fg hover:text-accent-fg font-mono text-[10px] rounded-xs shrink-0 flex items-center justify-center"
          title={`Tags: ${sample.tags.map((t) => t.name).join(", ")}`}
        >
          +{sample.tags.length - 2}
        </button>
      )}

      {visibleAiSuggestions.map((suggestion) => (
        <span
          key={`ai-${suggestion.tag_name}`}
          data-tag-badge="true"
          onClick={(e) => e.stopPropagation()}
          title={`AI Suggestion (${Math.round(
            suggestion.confidence * 100
          )}%): ${suggestion.tag_name} — Approve or Dismiss`}
          className="inline-flex items-center gap-1 text-[10.5px] h-[20px] pl-1.5 pr-0.5 rounded-xs border border-dashed border-accent bg-accent-soft text-accent-fg min-w-0 max-w-[104px] shrink"
        >
          <Sparkles className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate min-w-0">{suggestion.tag_name}</span>
          <button
            type="button"
            data-tag-badge="true"
            onClick={(e) => {
              e.stopPropagation();
              void useSampleStore
                .getState()
                .resolveAiTagSuggestion(sample.id, suggestion.tag_name, true);
            }}
            className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-accent-fg hover:bg-accent-soft shrink-0"
            title={`Approve AI tag "${suggestion.tag_name}"`}
          >
            <Check className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            data-tag-badge="true"
            onClick={(e) => {
              e.stopPropagation();
              void useSampleStore
                .getState()
                .resolveAiTagSuggestion(sample.id, suggestion.tag_name, false);
            }}
            className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-danger hover:bg-danger/15 shrink-0"
            title={`Dismiss AI tag "${suggestion.tag_name}"`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      <button
        type="button"
        data-tag-badge="true"
        onClick={(e) => onOpenTagPopover(e, sample)}
        className={`w-[22px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
          isTagPopoverOpen
            ? "bg-accent border-accent text-accent-on"
            : "bg-surface-badge border-line-strong hover:border-accent text-fg-2 hover:text-accent-fg"
        }`}
        title="Manage tags"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function renderDateCell(
  colKey: "dateModified" | "dateAdded",
  epochMs: number | null | undefined,
  width: number
) {
  const { short, full } = formatSampleTimestamp(epochMs);
  return (
    <div
      key={colKey}
      style={{ width: `${width}px` }}
      title={full || undefined}
      className="h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 overflow-hidden whitespace-nowrap border-r border-line"
    >
      <span className="truncate">{short}</span>
    </div>
  );
}
