import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { FAMILY_COLOR_PALETTE } from "../../constants/palettes";
import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem, Tag, TaxonomyFacetSlug } from "../../types";
import { createTagOrSlashHierarchy } from "../../utils/taxonomySlashCreate";
import {
  getFacetsForDomain,
  getSharedTaxonomyIndex,
  getTagRollupCount,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";

export interface TaxonomyPickerProps {
  mode: "tags" | "genres";
  sampleIds: number[];
  samples?: readonly SampleItem[];
  compact?: boolean;
  title?: string;
  subtitle?: string;
  allowCreate?: boolean;
  selectedFilterTagIds?: ReadonlySet<number>;
  onFilterTagClick?: (tagId: number) => void;
  onClose?: () => void;
  closeOnSelect?: boolean;
}

export const TaxonomyPicker: React.FC<TaxonomyPickerProps> = ({
  mode,
  sampleIds,
  samples = [],
  compact = false,
  title,
  subtitle,
  allowCreate = true,
  selectedFilterTagIds,
  onFilterTagClick,
  onClose,
  closeOnSelect = false,
}) => {
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const createTag = useSampleStore((s) => s.createTag);
  const assignTag = useSampleStore((s) => s.assignTag);
  const unassignTag = useSampleStore((s) => s.unassignTag);
  const assignTagBatch = useSampleStore((s) => s.assignTagBatch);
  const unassignTagBatch = useSampleStore((s) => s.unassignTagBatch);
  const clearSampleTags = useSampleStore((s) => s.clearSampleTags);

  const [search, setSearch] = useState("");
  const [newColor, setNewColor] = useState<string>(
    mode === "genres" ? "#3B82F6" : FAMILY_COLOR_PALETTE[0]
  );
  const [createFacet, setCreateFacet] = useState<TaxonomyFacetSlug>(
    mode === "genres" ? "genre" : "category"
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sampleIdsKey = sampleIds.join(",");
  useEffect(() => {
    setSearch("");
    setCreateFacet(mode === "genres" ? "genre" : "category");
    window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
  }, [sampleIdsKey, mode]);

  const domainFacets = useMemo(
    () => getFacetsForDomain(tagFacets, mode),
    [tagFacets, mode]
  );
  const taxonomy = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );
  const allowedFacets: ReadonlySet<TaxonomyFacetSlug> = useMemo(
    () => new Set<TaxonomyFacetSlug>(domainFacets.map((f) => f.slug)),
    [domainFacets]
  );

  const isMulti = sampleIds.length > 1;
  const singleSample = samples.length === 1 ? samples[0] : null;

  const { fullyAssignedIds, partiallyAssignedIds, assignedBadges } = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of samples) {
      for (const b of s.tags) {
        const facet = taxonomy.facetByTagId.get(b.id) ?? "category";
        if (!allowedFacets.has(facet)) continue;
        counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
      }
    }
    const full = new Set<number>();
    const partial = new Set<number>();
    const sampleTotal = Math.max(1, samples.length);
    for (const [id, count] of counts) {
      if (count >= sampleTotal) full.add(id);
      else partial.add(id);
    }
    const badges = singleSample
      ? singleSample.tags.filter((b) =>
          allowedFacets.has(taxonomy.facetByTagId.get(b.id) ?? "category")
        )
      : [];
    return {
      fullyAssignedIds: full,
      partiallyAssignedIds: partial,
      assignedBadges: badges,
    };
  }, [samples, singleSample, taxonomy, allowedFacets]);

  const queryTrimmed = search.trim();
  const queryLower = queryTrimmed.toLowerCase();

  const groupedSections = useMemo(() => {
    return domainFacets.map((facet) => {
      const facetSlug = facet.slug;
      const items = tags
        .filter((t) => {
          if (resolveTagFacetSlug(t, tagFacets) !== facetSlug) return false;
          if (!queryLower) return true;
          const crumb = (taxonomy.breadcrumbByTagId.get(t.id) ?? t.name).toLowerCase();
          if (t.name.toLowerCase().includes(queryLower)) return true;
          if (crumb.includes(queryLower)) return true;
          return (t.aliases ?? []).some((a) =>
            a.toLowerCase().includes(queryLower)
          );
        })
        .sort((a, b) => {
          const aAss = fullyAssignedIds.has(a.id) ? 2 : partiallyAssignedIds.has(a.id) ? 1 : 0;
          const bAss = fullyAssignedIds.has(b.id) ? 2 : partiallyAssignedIds.has(b.id) ? 1 : 0;
          if (aAss !== bAss) return bAss - aAss;
          const aCount = getTagRollupCount(a);
          const bCount = getTagRollupCount(b);
          if (bCount !== aCount) return bCount - aCount;
          return (taxonomy.breadcrumbByTagId.get(a.id) ?? a.name).localeCompare(
            taxonomy.breadcrumbByTagId.get(b.id) ?? b.name
          );
        });
      return { facet, facetSlug, items };
    });
  }, [
    tags,
    tagFacets,
    domainFacets,
    queryLower,
    taxonomy,
    fullyAssignedIds,
    partiallyAssignedIds,
  ]);

  const exactMatchExists = useMemo(() => {
    if (!queryTrimmed) return true;
    const leafCandidate = queryTrimmed.includes("/")
      ? queryTrimmed.split("/").pop()?.trim().toLowerCase() ?? ""
      : queryLower;
    if (!leafCandidate) return true;
    return tags.some((t) => t.name.toLowerCase() === leafCandidate);
  }, [tags, queryTrimmed, queryLower]);

  const handleToggleTag = async (tag: Tag) => {
    if (sampleIds.length === 0) return;
    const isFull = fullyAssignedIds.has(tag.id);
    if (isMulti) {
      if (isFull) {
        await unassignTagBatch(sampleIds, tag.id);
      } else {
        await assignTagBatch(sampleIds, tag.id);
      }
    } else if (isFull) {
      await unassignTag(sampleIds[0], tag.id);
    } else {
      await assignTag(sampleIds[0], tag.id);
    }
    if (closeOnSelect) {
      onClose?.();
    }
  };

  const handleCreateAndAssign = async () => {
    if (!queryTrimmed || sampleIds.length === 0) return;
    const { created } = await createTagOrSlashHierarchy({
      rawInput: queryTrimmed,
      color: newColor,
      facetSlug: createFacet,
      tags,
      tagFacets,
      createTag,
    });
    if (created) {
      if (isMulti) {
        await assignTagBatch(sampleIds, created.id);
      } else {
        await assignTag(sampleIds[0], created.id);
      }
      setSearch("");
      if (closeOnSelect) onClose?.();
    }
  };

  const hasAnyAssigned =
    fullyAssignedIds.size > 0 || partiallyAssignedIds.size > 0;
  const clearFacetSlugs: TaxonomyFacetSlug[] = domainFacets.map((f) => f.slug);

  return (
    <div className="flex flex-col gap-2 text-[11.5px] text-fg min-w-0">
      {title && (
        <div className="flex items-center justify-between border-b border-line pb-1.5">
          <div className="min-w-0 flex-1 pr-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-accent-fg">
              {title}
            </div>
            {subtitle && (
              <div className="text-[11px] font-medium text-fg truncate">
                {subtitle}
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-line shrink-0"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {!compact && singleSample && assignedBadges.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-mono uppercase tracking-wider text-fg-head">
            {mode === "genres" ? "ASSIGNED GENRES & MOODS" : "ASSIGNED TAGS"} (
            {assignedBadges.length})
          </div>
          <div className="flex flex-wrap gap-1 max-h-[64px] overflow-y-auto">
            {assignedBadges.map((badge) => {
              const isFiltered = Boolean(selectedFilterTagIds?.has(badge.id));
              const crumb = taxonomy.breadcrumbByTagId.get(badge.id) ?? badge.name;
              const color =
                taxonomy.effectiveColorByTagId.get(badge.id) ?? badge.color;
              const isSource = taxonomy.facetByTagId.get(badge.id) === "source";
              return (
                <div
                  key={badge.id}
                  className={`inline-flex items-center space-x-1 text-[11px] h-[21px] px-1.5 rounded-xs border ${
                    isFiltered
                      ? "bg-accent-soft border-accent text-accent-fg"
                      : "bg-surface-badge border-line-strong text-fg"
                  }`}
                  style={
                    isSource
                      ? undefined
                      : { borderLeftColor: color, borderLeftWidth: "2px" }
                  }
                >
                  <button
                    type="button"
                    onClick={() => onFilterTagClick?.(badge.id)}
                    className="truncate max-w-[130px] text-left cursor-pointer"
                    title={crumb}
                  >
                    {isSource ? `#${badge.name}` : badge.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void unassignTag(singleSample.id, badge.id)}
                    className="text-fg-2 hover:text-accent-fg pl-0.5 flex items-center justify-center cursor-pointer"
                    title={`Remove ${badge.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1">
        <div className="relative flex-1 flex items-center">
          <Search className="w-3 h-3 text-fg-3 absolute left-2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && allowCreate && !exactMatchExists && queryTrimmed) {
                e.preventDefault();
                void handleCreateAndAssign();
              }
            }}
            placeholder={
              mode === "genres"
                ? "Filter or add genre / mood..."
                : "Filter or Parent/Tag..."
            }
            autoFocus={!compact}
            className="w-full h-[24px] bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none rounded-xs"
          />
          {search && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSearch("");
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 text-fg-2 hover:text-fg"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {(isMulti || hasAnyAssigned) && (
          <button
            type="button"
            onClick={async () => {
              await clearSampleTags(sampleIds, clearFacetSlugs);
              if (closeOnSelect) onClose?.();
            }}
            className="h-[24px] px-1.5 rounded-xs bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-[10px] font-mono text-fg-2 hover:text-accent-fg shrink-0 transition-colors"
            title={
              mode === "genres"
                ? "Clear all genres & moods"
                : "Clear all category & source tags"
            }
          >
            Clear
          </button>
        )}
      </div>

      {allowCreate && !exactMatchExists && queryTrimmed.length > 0 && (
        <div className="p-2 bg-surface-1 border border-accent/50 rounded-xs space-y-1.5">
          <div className="flex items-center justify-between gap-1 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {domainFacets.map((f) => (
                <button
                  key={f.slug}
                  type="button"
                  onClick={() => setCreateFacet(f.slug)}
                  className={`h-[18px] px-1.5 rounded-[2px] font-mono text-[9px] uppercase border transition-colors ${
                    createFacet === f.slug
                      ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                      : "bg-surface-3 border-line text-fg-3 hover:text-fg"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
            {createFacet !== "source" && (
              <div className="flex items-center gap-1">
                {FAMILY_COLOR_PALETTE.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-3 h-3 rounded-[2px] border shrink-0 ${
                      newColor === c
                        ? "border-fg ring-1 ring-line-strong"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    title={`Color ${c}`}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleCreateAndAssign()}
            className="w-full h-[24px] px-2 rounded-xs bg-accent text-accent-on font-medium text-[11px] flex items-center justify-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span className="truncate">
              Create &amp; assign &ldquo;{queryTrimmed}&rdquo;
            </span>
          </button>
        </div>
      )}

      <div
        className={`overflow-y-auto space-y-2 pr-0.5 ${
          compact ? "max-h-[190px]" : "max-h-[236px]"
        }`}
      >
        {groupedSections.map(({ facet, facetSlug, items }) => {
          if (items.length === 0) return null;
          const sectionTitle = facet.name.toUpperCase();
          return (
            <div key={facetSlug} className="space-y-1">
              <div className="font-mono text-[9px] uppercase tracking-wider text-fg-head px-0.5">
                {sectionTitle}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {items.map((tag) => {
                  const isFull = fullyAssignedIds.has(tag.id);
                  const isPartial = partiallyAssignedIds.has(tag.id);
                  const color =
                    taxonomy.effectiveColorByTagId.get(tag.id) ?? tag.color;
                  const crumb =
                    taxonomy.breadcrumbByTagId.get(tag.id) ?? tag.name;
                  const isChild = Boolean(tag.parent_id);
                  const isSource = facetSlug === "source";
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => void handleToggleTag(tag)}
                      title={crumb}
                      className={`h-[24px] px-1.5 rounded-xs border flex items-center justify-between text-[11px] min-w-0 transition-colors cursor-pointer ${
                        isFull
                          ? "bg-accent-soft border-accent text-accent-fg font-medium"
                          : isPartial
                          ? "bg-surface-3 border-accent/50 text-fg"
                          : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-hover"
                      }`}
                    >
                      <span className="flex items-center space-x-1.5 min-w-0 flex-1">
                        {isSource ? (
                          <span className="font-mono text-[10px] text-fg-3 shrink-0">
                            #
                          </span>
                        ) : (
                          <span
                            className="w-2 h-2 rounded-[2px] shrink-0"
                            style={{ backgroundColor: color }}
                          />
                        )}
                        <span className="truncate">
                          {queryLower && isChild ? crumb : tag.name}
                        </span>
                      </span>
                      {isFull ? (
                        <Check className="w-3 h-3 text-accent-fg shrink-0 ml-1" />
                      ) : isPartial ? (
                        <span className="font-mono text-[9px] text-accent-fg shrink-0 ml-1">
                          ~
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {groupedSections.every((s) => s.items.length === 0) && (
          <div className="py-3 text-center text-[11px] text-fg-3 font-mono">
            No matching {mode === "genres" ? "genres or moods" : "tags"}.
          </div>
        )}
      </div>
    </div>
  );
};
