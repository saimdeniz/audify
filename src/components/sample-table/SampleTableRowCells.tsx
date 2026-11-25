import React from "react";
import { Plus, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { AiTagSuggestionItem, SampleItem, SampleTagBadge } from "../../types";
import {
  buildTaxonomyIndex,
  type TaxonomyIndex,
} from "../../utils/taxonomyTree";
import {
  renderAiSuggestionChip,
  renderBpmCell,
  renderDateCell,
  renderKeyCell,
  resolveAiSuggestionMeta,
} from "./SampleTableMetaCells";
import { RowPopoverPosition } from "./tableLayout";

export { renderBpmCell, renderDateCell, renderKeyCell };

const EMPTY_TAXONOMY_INDEX: TaxonomyIndex = buildTaxonomyIndex([]);

/**
 * Computes how many badge chips fit legibly inside a `GENRE` or `TAGS` cell of
 * given pixel `width` alongside the `+` button and optional `+N` overflow badge,
 * preventing chips from ever collapsing into unreadable hollow frames.
 */
export function computeVisibleBadgeLimit(
  cellWidth: number,
  totalBadges: number,
  maxCap = 2
): number {
  if (totalBadges <= 0) return 0;
  if (totalBadges === 1) return cellWidth >= 68 ? 1 : 0;
  const twoFitNoOverflow = totalBadges === 2 && cellWidth >= 142;
  const twoFitWithOverflow = totalBadges > 2 && cellWidth >= 172;
  if (maxCap >= 2 && (twoFitNoOverflow || twoFitWithOverflow)) {
    return 2;
  }
  return cellWidth >= 96 ? 1 : 0;
}

interface GenreCellParams {
  sample: SampleItem;
  width: number;
  selectedGenre: string | null;
  selectedTagSet: ReadonlySet<number>;
  isGenrePopoverOpen: boolean;
  genreColorMap: ReadonlyMap<string, string>;
  taxonomyIndex?: TaxonomyIndex;
  pendingAiTags?: AiTagSuggestionItem[];
  onOpenGenrePopover: (e: React.MouseEvent, sample: SampleItem) => void;
}

export function renderGenreCell({
  sample,
  width,
  selectedGenre,
  selectedTagSet,
  isGenrePopoverOpen,
  genreColorMap,
  taxonomyIndex = EMPTY_TAXONOMY_INDEX,
  pendingAiTags,
  onOpenGenrePopover,
}: GenreCellParams) {
  const genreBadges: SampleTagBadge[] = [];
  const moodBadges: SampleTagBadge[] = [];
  const customGenreBadges: SampleTagBadge[] = [];
  for (let i = 0; i < sample.tags.length; i++) {
    const b = sample.tags[i];
    const domain = taxonomyIndex.domainByTagId.get(b.id);
    if (domain !== "genres") continue;
    const facet = taxonomyIndex.facetByTagId.get(b.id);
    if (facet === "genre") genreBadges.push(b);
    else if (facet === "mood") moodBadges.push(b);
    else customGenreBadges.push(b);
  }
  const combined =
    genreBadges.length > 0 || moodBadges.length > 0 || customGenreBadges.length > 0
      ? [...genreBadges, ...moodBadges, ...customGenreBadges]
      : null;
  const genreAiSuggestions = pendingAiTags
    ? pendingAiTags.filter(
        (s) => resolveAiSuggestionMeta(s.tag_name, taxonomyIndex).isGenreDomain
      )
    : [];
  const existingGenreCount = combined ? combined.length : sample.genre ? 1 : 0;
  const visibleGenreAi = genreAiSuggestions.slice(
    0,
    existingGenreCount === 0 ? 2 : 1
  );
  const visibleGenreLimit = combined
    ? computeVisibleBadgeLimit(
        width - (visibleGenreAi.length > 0 ? 72 : 0),
        combined.length,
        2
      )
    : 0;

  return (
    <div
      key="genre"
      style={{ width: `${width}px` }}
      className="h-full px-1.5 flex items-center space-x-1 relative shrink-0 overflow-hidden border-r border-line"
    >
      {combined ? (
        <>
          {combined.slice(0, visibleGenreLimit).map((badge) => {
            const isFiltered =
              selectedTagSet.has(badge.id) ||
              (selectedGenre !== null &&
                selectedGenre.toLowerCase() === badge.name.toLowerCase());
            const facet = taxonomyIndex.facetByTagId.get(badge.id) ?? "genre";
            const crumb = taxonomyIndex.breadcrumbByTagId.get(badge.id) ?? badge.name;
            const color =
              taxonomyIndex.effectiveColorByTagId.get(badge.id) ||
              badge.color ||
              genreColorMap.get(badge.name.toLowerCase()) ||
              "#3B82F6";
            return (
              <span
                key={badge.id}
                data-tag-badge="true"
                onClick={(e) => {
                  e.stopPropagation();
                  const store = useSampleStore.getState();
                  if (e.altKey) {
                    store.toggleExcludeTagFilter(badge.id);
                  } else {
                    store.toggleTagFilter(badge.id);
                  }
                }}
                title={`${facet === "mood" ? "Mood" : "Genre"}: ${crumb}`}
                className={`group/genre inline-flex items-center space-x-1 text-[11px] h-[20px] px-1.5 rounded-xs border min-w-[44px] max-w-[104px] cursor-pointer shrink ${
                  isFiltered
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
                    : "bg-surface-badge border-line-strong text-fg-2 hover:text-fg hover:border-line-hover"
                }`}
                style={{
                  borderLeftColor: color,
                  borderLeftWidth: "2px",
                }}
              >
                <span className="truncate min-w-0">{badge.name}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void useSampleStore
                      .getState()
                      .unassignTag(sample.id, badge.id);
                  }}
                  className="hidden group-hover/genre:inline-flex items-center justify-center text-fg-2 hover:text-accent-fg ml-0.5 shrink-0"
                  title={`Remove ${badge.name}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
          {combined.length > visibleGenreLimit && (
            <button
              type="button"
              data-tag-badge="true"
              onClick={(e) => onOpenGenrePopover(e, sample)}
              className="h-[20px] px-1.5 bg-surface-3 hover:bg-accent-soft border border-line-strong hover:border-accent text-fg hover:text-accent-fg font-mono text-[10px] rounded-xs shrink-0 flex items-center justify-center"
              title={`Genres & Moods: ${combined.map((b) => b.name).join(", ")}`}
            >
              +{combined.length - visibleGenreLimit}
            </button>
          )}
        </>
      ) : (
        sample.genre && (
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
                genreColorMap.get(sample.genre.toLowerCase()) || "#3B82F6",
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
              className="hidden group-hover/genre:inline-flex items-center justify-center text-fg-2 hover:text-accent-fg ml-0.5 shrink-0"
              title="Clear genre"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        )
      )}

      {visibleGenreAi.map((suggestion) =>
        renderAiSuggestionChip(
          sample.id,
          suggestion,
          resolveAiSuggestionMeta(suggestion.tag_name, taxonomyIndex).breadcrumb
        )
      )}

      <button
        type="button"
        data-tag-badge="true"
        data-row-genre-btn={sample.id}
        onClick={(e) => onOpenGenrePopover(e, sample)}
        className={`w-[22px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
          isGenrePopoverOpen
            ? "bg-accent border-accent text-accent-on"
            : "bg-surface-badge border-line-strong hover:border-accent text-fg-2 hover:text-accent-fg"
        }`}
        title={
          combined || sample.genre
            ? "Manage genres & moods"
            : "Assign genre / mood"
        }
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface TagsCellParams {
  sample: SampleItem;
  width: number;
  selectedTagSet: ReadonlySet<number>;
  taxonomyIndex?: TaxonomyIndex;
  pendingAiTags?: AiTagSuggestionItem[];
  isTagPopoverOpen: boolean;
  onOpenTagPopover: (e: React.MouseEvent, sample: SampleItem) => void;
  onSetHoverOverflowTags: (pos: RowPopoverPosition | null) => void;
}

export function renderTagsCell({
  sample,
  width,
  selectedTagSet,
  taxonomyIndex = EMPTY_TAXONOMY_INDEX,
  pendingAiTags,
  isTagPopoverOpen,
  onOpenTagPopover,
  onSetHoverOverflowTags,
}: TagsCellParams) {
  const categorySourceTags = sample.tags.filter((b) => {
    return taxonomyIndex.domainByTagId.get(b.id) !== "genres";
  });
  const tagAiSuggestions = pendingAiTags
    ? pendingAiTags.filter(
        (s) => !resolveAiSuggestionMeta(s.tag_name, taxonomyIndex).isGenreDomain
      )
    : [];
  const visibleAiLimit = categorySourceTags.length === 0 ? 2 : 1;
  const visibleAiSuggestions = tagAiSuggestions.slice(0, visibleAiLimit);
  const visibleTagLimit = computeVisibleBadgeLimit(
    width - (visibleAiSuggestions.length > 0 ? 72 : 0),
    categorySourceTags.length,
    2
  );
  return (
    <div
      key="tags"
      style={{ width: `${width}px` }}
      className="h-full px-1.5 flex items-center space-x-1 relative shrink-0 overflow-hidden border-r border-line"
    >
      {categorySourceTags.slice(0, visibleTagLimit).map((badge) => {
        const isTagFiltered = selectedTagSet.has(badge.id);
        const facet = taxonomyIndex.facetByTagId.get(badge.id) ?? "category";
        const isSource = facet === "source";
        const crumb = taxonomyIndex.breadcrumbByTagId.get(badge.id) ?? badge.name;
        const color =
          taxonomyIndex.effectiveColorByTagId.get(badge.id) ?? badge.color;
        return (
          <span
            key={badge.id}
            data-tag-badge="true"
            onClick={(e) => {
              e.stopPropagation();
              const store = useSampleStore.getState();
              if (e.altKey) {
                store.toggleExcludeTagFilter(badge.id);
              } else {
                store.toggleTagFilter(badge.id);
              }
            }}
            title={crumb}
            className={`group/tag inline-flex items-center space-x-1 text-[11px] h-[20px] px-1.5 rounded-xs border min-w-[44px] max-w-[96px] cursor-pointer shrink ${
              isTagFiltered
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-badge border-line-strong text-fg-2 hover:text-fg hover:border-line-hover"
            }`}
            style={
              isSource
                ? undefined
                : {
                    borderLeftColor: color,
                    borderLeftWidth: "2px",
                  }
            }
          >
            <span className="truncate min-w-0">
              {isSource ? `#${badge.name}` : badge.name}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void useSampleStore.getState().unassignTag(sample.id, badge.id);
              }}
              className="hidden group-hover/tag:inline-flex items-center justify-center text-fg-2 hover:text-accent-fg ml-0.5 shrink-0"
              title={`Remove ${badge.name}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        );
      })}

      {categorySourceTags.length > visibleTagLimit && (
        <button
          type="button"
          data-tag-badge="true"
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSetHoverOverflowTags({
              sampleId: sample.id,
              x: Math.min(window.innerWidth - 230, Math.max(12, rect.left - 30)),
              y:
                rect.bottom + 90 > window.innerHeight
                  ? rect.top - 64
                  : rect.bottom + 4,
            });
          }}
          onMouseLeave={() => onSetHoverOverflowTags(null)}
          onClick={(e) => onOpenTagPopover(e, sample)}
          className="h-[20px] px-1.5 bg-surface-3 hover:bg-accent-soft border border-line-strong hover:border-accent text-fg hover:text-accent-fg font-mono text-[10px] rounded-xs shrink-0 flex items-center justify-center"
          title={`Tags: ${categorySourceTags.map((t) => taxonomyIndex.breadcrumbByTagId.get(t.id) ?? t.name).join(", ")}`}
        >
          +{categorySourceTags.length - visibleTagLimit}
        </button>
      )}

      {visibleAiSuggestions.map((suggestion) =>
        renderAiSuggestionChip(
          sample.id,
          suggestion,
          resolveAiSuggestionMeta(suggestion.tag_name, taxonomyIndex).breadcrumb
        )
      )}

      <button
        type="button"
        data-tag-badge="true"
        data-row-tag-btn={sample.id}
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
