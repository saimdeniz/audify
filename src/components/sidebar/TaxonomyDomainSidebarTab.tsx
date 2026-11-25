import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, Music, Plus } from "lucide-react";
import { FAMILY_COLOR_PALETTE } from "../../constants/palettes";
import { useStudioPointerDrag } from "../../hooks/useStudioPointerDrag";
import { AUDIFY_STORAGE_KEYS } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import type { Tag, TaxonomyDomain, TaxonomyFacetSlug } from "../../types";
import { canDropTaxonomyItem } from "../../utils/taxonomyDragValidation";
import { createTagOrSlashHierarchy } from "../../utils/taxonomySlashCreate";
import {
  flattenTaxonomyTree,
  getFacetsForDomain,
  getSharedTaxonomyIndex,
  isFacetHierarchical,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";
import { StudioDragPill } from "../common/StudioDragPill";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { TaxonomySidebarHeader } from "./TaxonomySidebarHeader";
import {
  TaxonomyFacetSectionHeader,
  TaxonomySidebarRow,
} from "./TaxonomySidebarRow";
import {
  loadSidebarExpandedTagIds,
  loadSidebarSectionMap,
  saveSidebarExpandedTagIds,
  saveSidebarSectionMap,
} from "./taxonomySidebarStorage";

const sessionSearchByDomain: Record<TaxonomyDomain, string> = {
  tags: "",
  genres: "",
};

export interface TaxonomyDomainSidebarTabProps {
  domain: TaxonomyDomain;
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
  dropFlashTarget?: string | null;
}

export const TaxonomyDomainSidebarTab: React.FC<
  TaxonomyDomainSidebarTabProps
> = ({ domain, dragHoverTarget, setDragHoverTarget, dropFlashTarget }) => {
  const isGenres = domain === "genres";
  const storageKey = isGenres
    ? AUDIFY_STORAGE_KEYS.sidebarGenreSectionsOpen
    : AUDIFY_STORAGE_KEYS.sidebarTagSectionsOpen;
  const dropScope = isGenres ? "sidebar-genres" : "sidebar-tags";
  const defaultFacetSlug: TaxonomyFacetSlug = isGenres ? "genre" : "category";

  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const excludedTagIds = useSampleStore((s) => s.excludedTagIds);
  const selectedGenre = useSampleStore((s) =>
    isGenres ? s.selectedGenre : null
  );
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );

  const selectOrToggleTagFilter = useSampleStore(
    (s) => s.selectOrToggleTagFilter
  );
  const toggleExcludeTagFilter = useSampleStore(
    (s) => s.toggleExcludeTagFilter
  );
  const clearTagFilters = useSampleStore((s) => s.clearTagFilters);
  const setSelectedGenre = useSampleStore((s) => s.setSelectedGenre);
  const createTag = useSampleStore((s) => s.createTag);
  const updateTagTaxonomy = useSampleStore((s) => s.updateTagTaxonomy);
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);

  const [searchQuery, setSearchQuery] = useState<string>(
    () => sessionSearchByDomain[domain]
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    () => sessionSearchByDomain[domain].trim().length > 0
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() =>
    loadSidebarSectionMap(storageKey)
  );
  const [expandedIds, setExpandedIds] = useState<Set<number>>(
    loadSidebarExpandedTagIds
  );

  const updateSearch = useCallback(
    (val: string) => {
      sessionSearchByDomain[domain] = val;
      setSearchQuery(val);
    },
    [domain]
  );

  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isSearchOpen]);

  const setSectionOpen = useCallback(
    (slug: string, open: boolean) => {
      setSectionsOpen((prev) => {
        const next = { ...prev, [slug]: open };
        saveSidebarSectionMap(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const toggleExpand = useCallback((tagId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      saveSidebarExpandedTagIds(next);
      return next;
    });
  }, []);

  const domainFacets = useMemo(
    () => getFacetsForDomain(tagFacets, domain),
    [tagFacets, domain]
  );
  const domainFacetSlugs = useMemo(
    () => domainFacets.map((f) => f.slug),
    [domainFacets]
  );
  const domainFacetSlugSet = useMemo(
    () => new Set<TaxonomyFacetSlug>(domainFacetSlugs),
    [domainFacetSlugs]
  );

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );
  const excludedTagSet = useMemo(
    () => new Set(excludedTagIds),
    [excludedTagIds]
  );

  const tabTags = useMemo(
    () =>
      tags.filter((t) =>
        domainFacetSlugSet.has(resolveTagFacetSlug(t, tagFacets))
      ),
    [tags, tagFacets, domainFacetSlugSet]
  );

  const hasActiveFilter = useMemo(
    () =>
      Boolean(selectedGenre) ||
      tabTags.some(
        (t) => selectedTagSet.has(t.id) || excludedTagSet.has(t.id)
      ),
    [selectedGenre, tabTags, selectedTagSet, excludedTagSet]
  );

  const facetSections = useMemo(
    () =>
      domainFacets.map((facet) => ({
        facet,
        hierarchical: isFacetHierarchical(facet.slug, tagFacets),
        totalCount: tabTags.filter(
          (t) => resolveTagFacetSlug(t, tagFacets) === facet.slug
        ).length,
        rows: flattenTaxonomyTree(tags, facet.slug, expandedIds, searchQuery, {
          selectedIds: selectedTagSet,
          excludedIds: excludedTagSet,
          facets: tagFacets,
        }),
      })),
    [
      domainFacets,
      tabTags,
      tags,
      tagFacets,
      expandedIds,
      searchQuery,
      selectedTagSet,
      excludedTagSet,
    ]
  );

  const expandableIds = useMemo(() => {
    const parentIds = new Set<number>();
    for (const t of tabTags) {
      if (
        t.parent_id != null &&
        isFacetHierarchical(resolveTagFacetSlug(t, tagFacets), tagFacets)
      ) {
        parentIds.add(t.parent_id);
      }
    }
    return Array.from(parentIds);
  }, [tabTags, tagFacets]);

  const handleExpandAll = useCallback(() => {
    const nextSections: Record<string, boolean> = {};
    for (const f of domainFacets) nextSections[f.slug] = true;
    setSectionsOpen(nextSections);
    saveSidebarSectionMap(storageKey, nextSections);
    if (expandableIds.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const id of expandableIds) next.add(id);
        saveSidebarExpandedTagIds(next);
        return next;
      });
    }
  }, [domainFacets, expandableIds, storageKey]);

  const handleCollapseAll = useCallback(() => {
    const hasExpandedInTab = expandableIds.some((id) => expandedIds.has(id));
    if (hasExpandedInTab) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const id of expandableIds) next.delete(id);
        saveSidebarExpandedTagIds(next);
        return next;
      });
      return;
    }
    const nextSections: Record<string, boolean> = {};
    for (const f of domainFacets) nextSections[f.slug] = false;
    setSectionsOpen(nextSections);
    saveSidebarSectionMap(storageKey, nextSections);
  }, [domainFacets, expandableIds, expandedIds, storageKey]);

  const visibleCount = useMemo(
    () => facetSections.reduce((acc, s) => acc + s.rows.length, 0),
    [facetSections]
  );
  const isSearching = searchQuery.trim().length > 0;

  const handleRowClick = useCallback(
    (e: React.MouseEvent, tag: Tag) => {
      if (isGenres && selectedGenre) {
        setSelectedGenre(null);
      }
      if (e.altKey) {
        e.preventDefault();
        toggleExcludeTagFilter(tag.id);
        return;
      }
      selectOrToggleTagFilter(tag.id, e.ctrlKey || e.metaKey);
    },
    [
      isGenres,
      selectedGenre,
      setSelectedGenre,
      selectOrToggleTagFilter,
      toggleExcludeTagFilter,
    ]
  );

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSettingsOpen(true, isGenres ? "genres" : "tags");
    },
    [isGenres, setSettingsOpen]
  );

  const handleRowMouseEnter = useCallback(
    (targetKey: string) => {
      if (isDraggingInApp) setDragHoverTarget(targetKey);
    },
    [isDraggingInApp, setDragHoverTarget]
  );

  const taxonomyIndex = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );

  const canDropItem = useCallback(
    (srcId: number, dropKey: string) =>
      canDropTaxonomyItem(srcId, dropKey, taxonomyIndex, tagFacets),
    [taxonomyIndex, tagFacets]
  );

  const handlePointerDrop = useCallback(
    async (srcId: number, dropKey: string) => {
      if (dropKey.startsWith("sec:")) {
        const targetFacet = dropKey.slice(4) as TaxonomyFacetSlug;
        await updateTagTaxonomy(srcId, {
          facetSlug: targetFacet,
          clearParent: true,
          ...(targetFacet === "source" ? { colorInherited: true } : {}),
        });
        return;
      }
      if (dropKey.startsWith("node:")) {
        const parts = dropKey.split(":");
        const targetFacet = parts[1] as TaxonomyFacetSlug;
        const targetTagId = Number(parts[2]);
        if (!Number.isFinite(targetTagId) || srcId === targetTagId) return;
        const updated = await updateTagTaxonomy(srcId, {
          facetSlug: targetFacet,
          parentId: targetTagId,
        });
        if (updated) {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            next.add(targetTagId);
            saveSidebarExpandedTagIds(next);
            return next;
          });
        }
      }
    },
    [updateTagTaxonomy]
  );

  const { dragState, beginPointerDrag } = useStudioPointerDrag<number>({
    scope: dropScope,
    scrollContainerRef,
    canDrop: canDropItem,
    onDrop: handlePointerDrop,
  });

  const draggingTagId = dragState?.payload ?? null;
  const activeDropKey = dragState?.dropKey ?? null;

  const handleRowPointerDragStart = useCallback(
    (
      e: React.MouseEvent,
      tag: Tag,
      effectiveColor: string,
      isSource: boolean
    ) => {
      if (isDraggingInApp) return;
      beginPointerDrag(e, tag.id, {
        label: tag.name,
        swatchColor: isSource ? undefined : effectiveColor,
        prefixSymbol: isSource ? "#" : undefined,
      });
    },
    [isDraggingInApp, beginPointerDrag]
  );

  const handleCreateInFacet = async (
    rawName: string,
    color: string | undefined,
    facetSlug: TaxonomyFacetSlug
  ) => {
    const fallbackColor = isGenres
      ? facetSlug === "mood"
        ? "#EC4899"
        : "#3B82F6"
      : FAMILY_COLOR_PALETTE[0];
    const { created, parentId } = await createTagOrSlashHierarchy({
      rawInput: rawName,
      color: color || fallbackColor,
      facetSlug,
      tags,
      tagFacets,
      createTag,
    });
    if (parentId !== null) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        saveSidebarExpandedTagIds(next);
        return next;
      });
    }
    return Boolean(created);
  };

  const headerPrefix = isGenres ? "GENRES" : "TAGS";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <TaxonomySidebarHeader
        title={
          isSearching
            ? `${headerPrefix} (${visibleCount.toLocaleString()}/${tabTags.length.toLocaleString()})`
            : `${headerPrefix} (${tabTags.length.toLocaleString()})`
        }
        hasActiveFilter={hasActiveFilter}
        clearFilterTitle={
          isGenres ? "Clear genre & mood filters" : "Clear tag filters"
        }
        onClearFilter={() => {
          if (isGenres && selectedGenre) setSelectedGenre(null);
          clearTagFilters(domainFacetSlugs);
        }}
        createAction={
          <QuickCreatePopover
            title={
              isGenres
                ? "New Genre (or Parent/Sub-genre)"
                : "New Tag (or Parent/Child)"
            }
            placeholder={
              isGenres ? "e.g. Electronic/Synthwave" : "e.g. Animals/Wolf"
            }
            hasColor={true}
            align="right"
            buttonTitle={
              isGenres
                ? "Create new genre or sub-genre"
                : "Create tag or sub-tag"
            }
            buttonClassName="w-[20px] h-[20px] rounded-xs font-mono text-[9px] bg-accent/15 border border-accent/50 text-accent-fg hover:bg-accent hover:text-accent-on flex items-center justify-center shrink-0 transition-colors"
            buttonIcon={<Plus className="w-3.5 h-3.5" />}
            onCreated={(name, color) =>
              handleCreateInFacet(name, color, defaultFacetSlug)
            }
          />
        }
        showExpandCollapse={tabTags.length > 0}
        expandAllTitle={
          isGenres
            ? "Expand Genre Sections & Sub-genres"
            : "Expand All Tag Sections & Categories"
        }
        collapseAllTitle={
          isGenres
            ? "Collapse Sub-genres & Sections"
            : "Collapse All Categories & Sections"
        }
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        isSearchOpen={isSearchOpen}
        isSearching={isSearching}
        searchQuery={searchQuery}
        searchPlaceholder={
          isGenres ? "Filter genres & moods..." : "Filter tags & aliases..."
        }
        searchButtonTitle={
          isGenres ? "Search genres & moods" : "Search tags & aliases"
        }
        searchInputRef={searchInputRef}
        onSearchChange={updateSearch}
        onSearchOpenChange={setIsSearchOpen}
        settingsTitle={
          isGenres
            ? "Manage Genres & Moods in Settings"
            : "Manage Taxonomy & Rules in Settings"
        }
        onOpenSettings={() => setSettingsOpen(true, isGenres ? "genres" : "tags")}
      />

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto py-1.5 select-none"
      >
        {tabTags.length === 0 ? (
          <div className="py-8 px-3 text-center space-y-2">
            <div className="w-8 h-8 mx-auto rounded-[3px] bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
              {isGenres ? (
                <Music className="w-4 h-4" />
              ) : (
                <Hash className="w-4 h-4" />
              )}
            </div>
            <div className="text-[11px] font-medium text-fg">
              {isGenres ? "No genres or moods yet" : "No tags yet"}
            </div>
            <div className="text-[10px] text-fg-3 leading-relaxed">
              {isGenres
                ? "Scan a music library or click + above to create genres and moods."
                : "Scan your audio library to auto-tag matching sounds, or click + above to create categories."}
            </div>
          </div>
        ) : visibleCount === 0 ? (
          <div className="py-4 text-center text-[11px] text-fg-3 font-mono">
            {isGenres
              ? "No genres or moods match filter."
              : "No tags match filter."}
          </div>
        ) : (
          <div className="flex flex-col">
            {facetSections.map(
              ({ facet, hierarchical, totalCount, rows }, idx) => {
                const showSection =
                  idx === 0 ||
                  rows.length > 0 ||
                  draggingTagId !== null ||
                  !facet.is_system;
                if (!showSection) return null;
                const isOpen = isSearching
                  ? true
                  : sectionsOpen[facet.slug] !== false;
                const dropKey = `sec:${facet.slug}`;
                const isSource = facet.slug === "source";
                return (
                  <div key={facet.slug}>
                    <TaxonomyFacetSectionHeader
                      label={facet.name.toUpperCase()}
                      count={isSearching ? rows.length : totalCount}
                      isOpen={isOpen}
                      isDropActive={activeDropKey === dropKey}
                      dropScope={dropScope}
                      dropKey={dropKey}
                      dropHint={`↳ ${facet.name} root`}
                      title={`Click to collapse · Drop an item here to move to ${facet.name}`}
                      rightExtra={
                        facet.slug !== defaultFacetSlug ? (
                          <QuickCreatePopover
                            title={`New ${facet.name}`}
                            placeholder={
                              hierarchical
                                ? "e.g. Parent/Child"
                                : `New ${facet.name}...`
                            }
                            hasColor={!isSource}
                            align="right"
                            buttonTitle={`Create in ${facet.name}`}
                            buttonClassName="w-[16px] h-[16px] rounded-[2px] text-fg-3 hover:text-accent-fg hover:bg-surface-3 flex items-center justify-center transition-colors"
                            buttonIcon={<Plus className="w-3 h-3" />}
                            onCreated={(name, color) =>
                              handleCreateInFacet(name, color, facet.slug)
                            }
                          />
                        ) : undefined
                      }
                      onToggle={() => setSectionOpen(facet.slug, !isOpen)}
                    />

                    {isOpen && rows.length > 0 && (
                      <div className="flex flex-col text-[12px]">
                        {rows.map((row) => {
                          const isSelected =
                            selectedTagSet.has(row.tag.id) ||
                            (isGenres &&
                              selectedGenre !== null &&
                              selectedGenre.toLowerCase() ===
                                row.tag.name.toLowerCase());
                          const targetKey = `tag-${row.tag.id}`;
                          const nodeDropKey = `node:${facet.slug}:${row.tag.id}`;
                          return (
                            <TaxonomySidebarRow
                              key={row.tag.id}
                              tag={row.tag}
                              depth={hierarchical ? row.depth : 0}
                              hasChildren={hierarchical && row.hasChildren}
                              isExpanded={hierarchical && row.isExpanded}
                              isSource={isSource}
                              flat={!hierarchical}
                              effectiveColor={row.effectiveColor}
                              breadcrumb={
                                isGenres
                                  ? `${facet.name}: ${row.breadcrumb}`
                                  : isSource
                                  ? `Source: ${row.breadcrumb}`
                                  : row.breadcrumb
                              }
                              dropLabelPrefix={isGenres ? facet.name : undefined}
                              isSelected={isSelected}
                              isExcluded={excludedTagSet.has(row.tag.id)}
                              isDraggingInApp={isDraggingInApp}
                              isDraggingSelf={draggingTagId === row.tag.id}
                              inAppDragCount={inAppDragCount}
                              isDropHover={
                                isDraggingInApp && dragHoverTarget === targetKey
                              }
                              isDropFlash={dropFlashTarget === targetKey}
                              isReparentHover={
                                hierarchical && activeDropKey === nodeDropKey
                              }
                              dropScope={hierarchical ? dropScope : undefined}
                              dropKey={hierarchical ? nodeDropKey : undefined}
                              dropHint={
                                hierarchical
                                  ? `↳ Nest under ${row.tag.name}`
                                  : undefined
                              }
                              onToggleExpand={
                                hierarchical ? toggleExpand : undefined
                              }
                              onClick={handleRowClick}
                              onContextMenu={handleRowContextMenu}
                              onMouseEnterTag={handleRowMouseEnter}
                              onPointerDragStart={handleRowPointerDragStart}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </div>
      <StudioDragPill dragState={dragState} />
    </div>
  );
};
