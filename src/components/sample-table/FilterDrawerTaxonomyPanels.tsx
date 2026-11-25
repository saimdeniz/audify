import React, { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import type { Tag, TagFacet, TaxonomyDomain, TaxonomyFacetSlug } from "../../types";
import {
  getFacetsForDomain,
  getSharedTaxonomyIndex,
  getTagRollupCount,
  isFacetHierarchical,
  resolveTagFacetSlug,
  type TaxonomyIndex,
} from "../../utils/taxonomyTree";

interface FamilyCluster {
  root: Tag;
  descendants: Tag[];
}

interface FacetDrawerSection {
  facet: TagFacet;
  hierarchical: boolean;
  clusters: FamilyCluster[];
  standaloneItems: Tag[];
}

function collectSubtreeDescendants(
  rootId: number,
  taxonomy: TaxonomyIndex
): Tag[] {
  const out: Tag[] = [];
  const visit = (parentId: number) => {
    const kids = taxonomy.childrenByParentId.get(parentId) ?? [];
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      out.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return out;
}

interface DrawerTaxonomyPillProps {
  tag: Tag;
  facet: TagFacet;
  taxonomy: TaxonomyIndex;
  active: boolean;
  excluded: boolean;
  isClusterRoot?: boolean;
  onToggle: (e: React.MouseEvent, tag: Tag) => void;
}

const DrawerTaxonomyPill: React.FC<DrawerTaxonomyPillProps> = React.memo(
  ({
    tag,
    facet,
    taxonomy,
    active,
    excluded,
    isClusterRoot = false,
    onToggle,
  }) => {
    const isSource = facet.slug === "source";
    const swatchColor = taxonomy.effectiveColorByTagId.get(tag.id) ?? tag.color;
    const breadcrumb = taxonomy.breadcrumbByTagId.get(tag.id) ?? tag.name;
    const count = getTagRollupCount(tag);

    return (
      <button
        type="button"
        onClick={(e) => onToggle(e, tag)}
        title={`${facet.name}: ${breadcrumb} (${count.toLocaleString()}) · Click to filter · Alt+Click to exclude`}
        className={`h-[22px] px-2 rounded-[3px] border text-[11px] font-medium inline-flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
          excluded
            ? "bg-surface-2 border-line-strong text-fg-3 line-through"
            : active
            ? "bg-accent-soft border-accent text-accent-fg font-semibold"
            : isClusterRoot
            ? "bg-surface-3 border-line-strong text-fg hover:border-accent"
            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        }`}
      >
        {isSource ? (
          <span className="font-mono text-[10px] text-fg-3 shrink-0">#</span>
        ) : (
          <span
            className="w-2 h-2 rounded-[2px] shrink-0"
            style={{ backgroundColor: swatchColor }}
          />
        )}
        <span className={isClusterRoot ? "font-semibold" : undefined}>
          {tag.name}
        </span>
        <span className="font-mono text-[9.5px] text-fg-3 tabular-nums">
          {count.toLocaleString()}
        </span>
      </button>
    );
  }
);

const FilterDrawerDomainPanel: React.FC<{
  domain: TaxonomyDomain;
  compact?: boolean;
}> = ({ domain, compact = false }) => {
  const isGenres = domain === "genres";
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const selectedGenre = useSampleStore((s) =>
    isGenres ? s.selectedGenre : null
  );
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const excludedTagIds = useSampleStore((s) => s.excludedTagIds);
  const tagMatchMode = useSampleStore((s) => s.tagMatchMode);
  const setSelectedGenre = useSampleStore((s) => s.setSelectedGenre);
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);
  const toggleExcludeTagFilter = useSampleStore(
    (s) => s.toggleExcludeTagFilter
  );
  const setTagMatchMode = useSampleStore((s) => s.setTagMatchMode);
  const clearTagFilters = useSampleStore((s) => s.clearTagFilters);

  const [selectedFacetSlug, setSelectedFacetSlug] =
    useState<TaxonomyFacetSlug | null>(null);

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );
  const excludedTagSet = useMemo(
    () => new Set(excludedTagIds),
    [excludedTagIds]
  );
  const domainFacets = useMemo(
    () => getFacetsForDomain(tagFacets, domain),
    [tagFacets, domain]
  );
  const taxonomy = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );

  const sections = useMemo((): FacetDrawerSection[] => {
    const out: FacetDrawerSection[] = [];
    for (const facet of domainFacets) {
      const facetTags = tags.filter(
        (t) => resolveTagFacetSlug(t, tagFacets) === facet.slug
      );
      if (facetTags.length === 0) continue;

      const roots = (taxonomy.childrenByParentId.get(null) ?? []).filter(
        (t) => resolveTagFacetSlug(t, tagFacets) === facet.slug
      );
      const hierarchical = isFacetHierarchical(facet.slug, tagFacets);
      if (!hierarchical) {
        out.push({
          facet,
          hierarchical: false,
          clusters: [],
          standaloneItems: roots,
        });
        continue;
      }

      const clusters: FamilyCluster[] = [];
      const standaloneItems: Tag[] = [];

      for (const root of roots) {
        const descendants = collectSubtreeDescendants(root.id, taxonomy);
        if (descendants.length > 0) {
          clusters.push({ root, descendants });
        } else {
          standaloneItems.push(root);
        }
      }

      out.push({
        facet,
        hierarchical: true,
        clusters,
        standaloneItems,
      });
    }
    return out;
  }, [domainFacets, tags, tagFacets, taxonomy]);

  const { activeFacetSlugs, hasDomainActive, hasMultiSameFacet } =
    useMemo(() => {
      const slugSet = new Set(domainFacets.map((f) => f.slug));
      const activeSlugs = new Set<string>();
      let anyActive = false;
      if (isGenres && selectedGenre) {
        anyActive = true;
        activeSlugs.add("genre");
      }
      const facetSelectedCounts = new Map<string, number>();

      for (let i = 0; i < selectedTagIds.length; i++) {
        const tag = taxonomy.byId.get(selectedTagIds[i]);
        if (!tag) continue;
        const slug = resolveTagFacetSlug(tag, tagFacets);
        if (!slugSet.has(slug)) continue;
        anyActive = true;
        activeSlugs.add(slug);
        facetSelectedCounts.set(slug, (facetSelectedCounts.get(slug) ?? 0) + 1);
      }
      for (let i = 0; i < excludedTagIds.length; i++) {
        const tag = taxonomy.byId.get(excludedTagIds[i]);
        if (!tag) continue;
        const slug = resolveTagFacetSlug(tag, tagFacets);
        if (slugSet.has(slug)) {
          anyActive = true;
          activeSlugs.add(slug);
        }
      }

      let multiSame = false;
      for (const c of facetSelectedCounts.values()) {
        if (c >= 2) {
          multiSame = true;
          break;
        }
      }
      return {
        activeFacetSlugs: activeSlugs,
        hasDomainActive: anyActive,
        hasMultiSameFacet: multiSame,
      };
    }, [
      domainFacets,
      isGenres,
      selectedGenre,
      selectedTagIds,
      excludedTagIds,
      taxonomy,
      tagFacets,
    ]);

  if (sections.length === 0) {
    return (
      <span className="text-[11px] text-fg-3">
        {isGenres ? "No genres or moods available." : "No tags available."}
      </span>
    );
  }

  const activeSection =
    (selectedFacetSlug
      ? sections.find((s) => s.facet.slug === selectedFacetSlug)
      : null) ?? sections[0];

  const handleTogglePill = (e: React.MouseEvent, tag: Tag) => {
    if (isGenres && selectedGenre) {
      setSelectedGenre(null);
    }
    if (e.altKey) {
      toggleExcludeTagFilter(tag.id);
    } else {
      toggleTagFilter(tag.id);
    }
  };

  const isPillActive = (tag: Tag, facetSlug: string): boolean =>
    selectedTagSet.has(tag.id) ||
    (isGenres &&
      facetSlug === "genre" &&
      selectedGenre !== null &&
      selectedGenre.toLowerCase() === tag.name.toLowerCase());

  return (
    <div className="flex items-stretch gap-2.5 w-full h-full min-h-0">
      {/* Left: Fixed-width clickable uppercase text facet selector (zero layout shift on long names) */}
      <div
        className={`${
          compact ? "w-[96px]" : "w-[120px]"
        } shrink-0 border-r border-line-subtle pr-1.5 h-full overflow-y-auto flex flex-col gap-0.5 [&::-webkit-scrollbar]:w-[4px]`}
      >
        {sections.map(({ facet }) => {
          const isSelected = facet.slug === activeSection.facet.slug;
          const hasActive = activeFacetSlugs.has(facet.slug);
          return (
            <button
              key={facet.slug}
              type="button"
              data-drawer-facet-tab={facet.slug}
              aria-pressed={isSelected}
              onClick={() => setSelectedFacetSlug(facet.slug)}
              title={facet.name}
              className={`w-full h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase tracking-wider flex items-center justify-between gap-1 text-left transition-colors cursor-pointer shrink-0 ${
                isSelected
                  ? "bg-accent-soft text-accent-fg font-bold"
                  : "text-fg-3 hover:text-fg hover:bg-surface-2 font-semibold"
              }`}
            >
              <span className="truncate min-w-0">{facet.name}</span>
              {hasActive && (
                <span className="w-1.5 h-1.5 rounded-[1px] bg-accent shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: Independently scrollable tag area for the selected facet only */}
      <div
        data-drawer-facet={activeSection.facet.slug}
        className="flex-1 min-w-0 h-full overflow-y-auto flex items-start gap-2 pr-0.5"
      >
        <div className="flex-1 min-w-0 flex flex-col items-start gap-1.5">
          {activeSection.clusters.map(({ root, descendants }) => (
            <div
              key={`cluster-${root.id}`}
              data-drawer-cluster={root.name}
              className="inline-flex items-center gap-1 flex-wrap px-1 py-0.5 rounded-[4px] bg-surface-2 border border-line max-w-full"
            >
              <DrawerTaxonomyPill
                tag={root}
                facet={activeSection.facet}
                taxonomy={taxonomy}
                active={isPillActive(root, activeSection.facet.slug)}
                excluded={excludedTagSet.has(root.id)}
                isClusterRoot
                onToggle={handleTogglePill}
              />
              <ChevronRight className="w-3 h-3 text-fg-3 shrink-0" />
              {descendants.map((child) => (
                <DrawerTaxonomyPill
                  key={child.id}
                  tag={child}
                  facet={activeSection.facet}
                  taxonomy={taxonomy}
                  active={isPillActive(child, activeSection.facet.slug)}
                  excluded={excludedTagSet.has(child.id)}
                  onToggle={handleTogglePill}
                />
              ))}
            </div>
          ))}

          {activeSection.standaloneItems.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeSection.standaloneItems.map((item) => (
                <DrawerTaxonomyPill
                  key={item.id}
                  tag={item}
                  facet={activeSection.facet}
                  taxonomy={taxonomy}
                  active={isPillActive(item, activeSection.facet.slug)}
                  excluded={excludedTagSet.has(item.id)}
                  onToggle={handleTogglePill}
                />
              ))}
            </div>
          )}
        </div>

        {(hasMultiSameFacet || hasDomainActive) && (
          <div className="flex items-center gap-1 shrink-0 sticky top-0">
            {hasMultiSameFacet && (
              <button
                type="button"
                onClick={() =>
                  setTagMatchMode(tagMatchMode === "all" ? "any" : "all")
                }
                className="h-[22px] px-1.5 rounded-[3px] border border-accent/60 bg-accent-soft text-accent-fg font-mono text-[9.5px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                title={
                  tagMatchMode === "any"
                    ? "Matching ANY selected item in the same facet (OR) — Click to switch to ALL (AND)"
                    : "Matching ALL selected items (AND) — Click to switch to ANY within same facet (OR)"
                }
              >
                {tagMatchMode === "any" ? "ANY" : "ALL"}
              </button>
            )}
            {hasDomainActive && (
              <button
                type="button"
                onClick={() => {
                  if (isGenres && selectedGenre) setSelectedGenre(null);
                  clearTagFilters(domainFacets.map((f) => f.slug));
                }}
                className="h-[22px] px-1.5 rounded-[3px] border border-line bg-surface-3 hover:border-accent hover:text-accent-fg text-fg-2 font-mono text-[9.5px] inline-flex items-center gap-1 transition-colors cursor-pointer"
                title={
                  isGenres
                    ? "Clear active genre & mood filters"
                    : "Clear active tag filters"
                }
              >
                <X className="w-2.5 h-2.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const FilterDrawerGenrePanel: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => <FilterDrawerDomainPanel domain="genres" compact={compact} />;

export const FilterDrawerTagsPanel: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => <FilterDrawerDomainPanel domain="tags" compact={compact} />;
