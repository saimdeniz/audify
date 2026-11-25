import { Check, Sparkles, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import type { AiTagSuggestionItem, SampleItem } from "../../types";
import { formatSampleTimestamp } from "../../utils/format";
import type { TaxonomyIndex } from "../../utils/taxonomyTree";
import { FIXED_BPM_COL_WIDTH, FIXED_KEY_COL_WIDTH } from "./tableLayout";

const FALLBACK_AI_GENRE_NAMES = new Set([
  "pop", "hip-hop", "rock", "jazz", "acoustic", "classical", "electronic",
  "ambient", "soundtrack", "cinematic", "synthwave", "orchestral", "lo-fi",
  "upbeat", "sad", "action", "horror", "dark", "epic", "fantasy",
  "dramatic", "suspense", "ethereal", "comedy", "chill",
]);

export function resolveAiSuggestionMeta(
  tagName: string,
  taxonomyIndex: TaxonomyIndex
): { isGenreDomain: boolean; breadcrumb: string } {
  const lower = tagName.trim().toLowerCase();
  const existing = taxonomyIndex.byLowerName.get(lower);
  if (existing) {
    return {
      isGenreDomain: taxonomyIndex.domainByTagId.get(existing.id) === "genres",
      breadcrumb: taxonomyIndex.breadcrumbByTagId.get(existing.id) ?? existing.name,
    };
  }
  return {
    isGenreDomain: FALLBACK_AI_GENRE_NAMES.has(lower),
    breadcrumb: tagName,
  };
}

export function renderAiSuggestionChip(
  sampleId: number,
  suggestion: AiTagSuggestionItem,
  breadcrumb: string
) {
  return (
    <span
      key={`ai-${suggestion.tag_name}`}
      data-tag-badge="true"
      onClick={(e) => e.stopPropagation()}
      title={`AI Suggestion (${Math.round(
        suggestion.confidence * 100
      )}%): ${breadcrumb} — Approve or Dismiss`}
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
            .resolveAiTagSuggestion(sampleId, suggestion.tag_name, true);
        }}
        className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-accent-fg hover:bg-accent-soft shrink-0"
        title={`Approve AI tag "${breadcrumb}"`}
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
            .resolveAiTagSuggestion(sampleId, suggestion.tag_name, false);
        }}
        className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-accent-soft shrink-0"
        title={`Dismiss AI tag "${breadcrumb}"`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

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
