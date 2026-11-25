import React, { useMemo } from "react";
import { X } from "lucide-react";
import type { Tag, TagFacet, TagMatchMode } from "../../types";
import {
  getFacetLabel,
  getSharedTaxonomyIndex,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";

interface ActiveTaxonomyChipsProps {
  tags: readonly Tag[];
  tagFacets?: readonly TagFacet[];
  selectedTagIds: readonly number[];
  excludedTagIds: readonly number[];
  tagMatchMode?: TagMatchMode;
  onToggleMatchMode?: () => void;
  onRemoveSelected: (tagId: number) => void;
  onRemoveExcluded: (tagId: number) => void;
}

export const ActiveTaxonomyChips: React.FC<ActiveTaxonomyChipsProps> = React.memo(
  ({
    tags,
    tagFacets,
    selectedTagIds,
    excludedTagIds,
    tagMatchMode = "all",
    onToggleMatchMode,
    onRemoveSelected,
    onRemoveExcluded,
  }) => {
    const taxonomy = useMemo(
      () => getSharedTaxonomyIndex(tags, tagFacets),
      [tags, tagFacets]
    );

    const activeTags = useMemo(
      () =>
        selectedTagIds
          .map((id) => taxonomy.byId.get(id))
          .filter((t): t is Tag => Boolean(t)),
      [taxonomy, selectedTagIds]
    );

    const excludedTags = useMemo(
      () =>
        excludedTagIds
          .map((id) => taxonomy.byId.get(id))
          .filter((t): t is Tag => Boolean(t)),
      [taxonomy, excludedTagIds]
    );

    const hasMultiSameFacet = useMemo(() => {
      if (activeTags.length < 2) return false;
      const counts = new Map<string, number>();
      for (const t of activeTags) {
        const slug = resolveTagFacetSlug(t, tagFacets);
        const next = (counts.get(slug) ?? 0) + 1;
        if (next >= 2) return true;
        counts.set(slug, next);
      }
      return false;
    }, [activeTags, tagFacets]);

    if (activeTags.length === 0 && excludedTags.length === 0) return null;

    return (
      <>
        {hasMultiSameFacet && onToggleMatchMode && (
          <button
            type="button"
            onClick={onToggleMatchMode}
            data-tag-match-mode={tagMatchMode}
            className="inline-flex items-center h-[20px] px-1.5 rounded-[3px] border border-line-strong bg-surface-3 hover:border-accent hover:text-accent-fg text-fg-2 font-mono text-[9.5px] font-semibold uppercase tracking-wider shrink-0 transition-colors cursor-pointer"
            title={
              tagMatchMode === "any"
                ? "Matching ANY selected tag in the same facet (OR) — Click to switch to ALL (AND)"
                : "Matching ALL selected tags (AND) — Click to switch to ANY within same facet (OR)"
            }
          >
            {tagMatchMode === "any" ? "ANY" : "ALL"}
          </button>
        )}

        {activeTags.map((tag) => {
          const facet = resolveTagFacetSlug(tag, tagFacets);
          const facetLabel = getFacetLabel(facet, tagFacets).toUpperCase();
          const color = taxonomy.effectiveColorByTagId.get(tag.id) ?? tag.color;
          const breadcrumb = taxonomy.breadcrumbByTagId.get(tag.id) ?? tag.name;
          const children = taxonomy.childrenByParentId.get(tag.id) ?? [];
          const rollupNote =
            children.length > 0
              ? ` — includes sub-tags: ${children
                  .slice(0, 4)
                  .map((c) => c.name)
                  .join(", ")}${children.length > 4 ? "…" : ""}`
              : "";
          return (
            <span
              key={`pos-${tag.id}`}
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-accent/50 bg-accent-soft text-accent-fg text-[11px]"
              title={`${facetLabel}: ${breadcrumb}${rollupNote}`}
            >
              {facet === "source" ? (
                <span className="font-mono text-[10px] opacity-80">#</span>
              ) : (
                <span
                  className="w-2 h-2 rounded-[2px] shrink-0"
                  style={{ backgroundColor: color }}
                />
              )}
              <span className="truncate max-w-[140px]">{tag.name}</span>
              <button
                type="button"
                onClick={() => onRemoveSelected(tag.id)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
                title={`Remove ${breadcrumb} filter`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          );
        })}

        {excludedTags.map((tag) => {
          const breadcrumb = taxonomy.breadcrumbByTagId.get(tag.id) ?? tag.name;
          return (
            <span
              key={`neg-${tag.id}`}
              className="inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded-[3px] border border-dashed border-accent/60 bg-surface-3 text-fg text-[11px]"
              title={`Excluding: ${breadcrumb} (click × to restore)`}
            >
              <span className="font-mono text-[9px] uppercase tracking-wider text-accent-fg font-semibold">
                NOT
              </span>
              <span className="truncate max-w-[140px] line-through opacity-85">
                {tag.name}
              </span>
              <button
                type="button"
                onClick={() => onRemoveExcluded(tag.id)}
                className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2"
                title={`Remove NOT ${breadcrumb} filter`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          );
        })}
      </>
    );
  }
);
