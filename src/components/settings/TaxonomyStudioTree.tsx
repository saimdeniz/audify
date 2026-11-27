import React, { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Palette } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { useStudioPointerDrag } from "../../hooks/useStudioPointerDrag";
import type {
  Tag,
  TagFacet,
  TaxonomyDomain,
  TaxonomyFacetSlug,
} from "../../types";
import { canDropTaxonomyItem } from "../../utils/taxonomyDragValidation";
import {
  flattenTaxonomyTree,
  getSharedTaxonomyIndex,
  isFacetHierarchical,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";
import { StudioDragPill } from "../common/StudioDragPill";
import {
  loadPersistedBoolMap,
  savePersistedBoolMap,
} from "./settingsTreeStorage";
import {
  type FacetFilterOption,
  type StudioDragPayload,
  TaxonomyStudioHeaderBars,
} from "./TaxonomyStudioHeaderBars";
import { TaxonomyStudioRow } from "./TaxonomyStudioRow";

interface TaxonomyStudioTreeProps {
  domain: TaxonomyDomain;
  domainFacets: readonly TagFacet[];
  allFacets: readonly TagFacet[];
  domainTags: readonly Tag[];
  allTags: readonly Tag[];
  selectedTagId: number | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  facetFilter: FacetFilterOption;
  onFacetFilterChange: (f: FacetFilterOption) => void;
  expandedIds: ReadonlySet<number>;
  onToggleExpand: (id: number) => void;
  onExpandAll: (expandableIds: number[]) => void;
  onCollapseAll: () => void;
  onSelectTag: (id: number) => void;
  onCreateTag: (
    name: string,
    color: string,
    opts?: {
      facetSlug?: TaxonomyFacetSlug;
      parentId?: number | null;
      colorInherited?: boolean;
    }
  ) => Promise<Tag | null>;
  onUpdateTaxonomy: (
    tagId: number,
    patch: {
      facetSlug?: TaxonomyFacetSlug;
      parentId?: number | null;
      clearParent?: boolean;
      colorInherited?: boolean;
      sortOrder?: number;
    }
  ) => Promise<Tag | null>;
  onReorderItems?: (orderedTagIds: number[]) => Promise<void>;
  onReorderFacets?: (orderedFacetIds: number[]) => Promise<void>;
  onHarmonizeFacet?: (facetSlug: TaxonomyFacetSlug) => Promise<number>;
  onCreateFacet: (
    name: string,
    domain: TaxonomyDomain,
    color: string,
    allowNesting: boolean
  ) => Promise<TagFacet | null>;
  onUpdateFacet: (
    facetId: number,
    patch: { name?: string; color?: string; allowNesting?: boolean }
  ) => Promise<TagFacet | null>;
  onDeleteFacet: (facetId: number) => Promise<number | null>;
}

function insertRelativeId(
  ids: readonly number[],
  movingId: number,
  targetId: number,
  after: boolean
): number[] {
  const without = ids.filter((id) => id !== movingId);
  const idx = without.indexOf(targetId);
  if (idx < 0) return [...without, movingId];
  const insertAt = after ? idx + 1 : idx;
  without.splice(insertAt, 0, movingId);
  return without;
}

export const TaxonomyStudioTree: React.FC<TaxonomyStudioTreeProps> = ({
  domain,
  domainFacets,
  allFacets,
  domainTags,
  allTags,
  selectedTagId,
  searchQuery,
  onSearchChange,
  facetFilter,
  onFacetFilterChange,
  expandedIds,
  onToggleExpand,
  onExpandAll,
  onCollapseAll,
  onSelectTag,
  onCreateTag,
  onUpdateTaxonomy,
  onReorderItems,
  onReorderFacets,
  onHarmonizeFacet,
  onCreateFacet,
  onUpdateFacet,
  onDeleteFacet,
}) => {
  const sectionsStorageKey =
    domain === "genres"
      ? AUDIFY_STORAGE_KEYS.settingsGenreCollapsedSections
      : AUDIFY_STORAGE_KEYS.settingsTagLibCollapsedSections;
  const dropScope = `taxonomy-studio-${domain}`;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >(() => loadPersistedBoolMap(sectionsStorageKey));

  const updateCollapsedSections = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      setCollapsedSections((prev) => {
        const next = updater(prev);
        savePersistedBoolMap(sectionsStorageKey, next);
        return next;
      });
    },
    [sectionsStorageKey]
  );

  const taxonomyIndex = useMemo(
    () => getSharedTaxonomyIndex(allTags, allFacets),
    [allTags, allFacets]
  );

  const visibleFacets = useMemo(
    () =>
      facetFilter === "all"
        ? domainFacets
        : domainFacets.filter((f) => f.slug === facetFilter),
    [domainFacets, facetFilter]
  );

  const sectionedRows = useMemo(
    () =>
      visibleFacets.map((facet) => {
        const hierarchical = isFacetHierarchical(facet.slug, allFacets);
        const unharmonizedCount = hierarchical
          ? domainTags.reduce((count, t) => {
              if (
                t.parent_id != null &&
                !t.color_inherited &&
                resolveTagFacetSlug(t, allFacets) === facet.slug
              ) {
                return count + 1;
              }
              return count;
            }, 0)
          : 0;
        return {
          facet,
          hierarchical,
          unharmonizedCount,
          rows: flattenTaxonomyTree(
            allTags,
            facet.slug,
            expandedIds,
            searchQuery,
            {
              facets: allFacets,
            }
          ),
        };
      }),
    [visibleFacets, allFacets, domainTags, allTags, expandedIds, searchQuery]
  );

  const totalVisibleRows = useMemo(
    () => sectionedRows.reduce((sum, s) => sum + s.rows.length, 0),
    [sectionedRows]
  );

  const expandableIds = useMemo(() => {
    const parents = new Set<number>();
    for (const t of domainTags) {
      if (
        t.parent_id != null &&
        isFacetHierarchical(resolveTagFacetSlug(t, allFacets), allFacets)
      ) {
        parents.add(t.parent_id);
      }
    }
    return Array.from(parents);
  }, [domainTags, allFacets]);

  const handleExpandAllClick = useCallback(() => {
    updateCollapsedSections(() => ({}));
    onExpandAll(expandableIds);
  }, [onExpandAll, expandableIds, updateCollapsedSections]);

  const handleCollapseAllClick = useCallback(() => {
    const hasExpandedNode = expandableIds.some((id) => expandedIds.has(id));
    if (hasExpandedNode) {
      onCollapseAll();
      return;
    }
    updateCollapsedSections(() => {
      const next: Record<string, boolean> = {};
      for (const f of domainFacets) next[f.slug] = true;
      return next;
    });
  }, [
    expandableIds,
    expandedIds,
    onCollapseAll,
    domainFacets,
    updateCollapsedSections,
  ]);

  const isSearching = searchQuery.trim().length > 0;

  const canDropPayload = useCallback(
    (payload: StudioDragPayload, dropKey: string): boolean => {
      if (payload.kind === "facet") {
        if (!onReorderFacets) return false;
        if (dropKey.startsWith("fbefore:") || dropKey.startsWith("fafter:")) {
          const targetId = Number(dropKey.slice(dropKey.indexOf(":") + 1));
          return Number.isFinite(targetId) && targetId !== payload.id;
        }
        return false;
      }

      const srcId = payload.id;
      if (dropKey.startsWith("before:") || dropKey.startsWith("after:")) {
        if (isSearching || !onReorderItems) return false;
        const parts = dropKey.split(":");
        const targetFacet = parts[1] as TaxonomyFacetSlug;
        const targetId = Number(parts[2]);
        if (!Number.isFinite(targetId) || targetId === srcId) return false;
        const targetTag = taxonomyIndex.byId.get(targetId);
        const srcTag = taxonomyIndex.byId.get(srcId);
        if (!targetTag || !srcTag) return false;
        const targetParent = targetTag.parent_id ?? null;
        const srcFacet = taxonomyIndex.facetByTagId.get(srcId) ?? "category";
        if (
          srcFacet === targetFacet &&
          (srcTag.parent_id ?? null) === targetParent
        ) {
          return true;
        }
        if (targetParent === null) {
          return canDropTaxonomyItem(
            srcId,
            `sec:${targetFacet}`,
            taxonomyIndex,
            allFacets
          );
        }
        return canDropTaxonomyItem(
          srcId,
          `node:${targetFacet}:${targetParent}`,
          taxonomyIndex,
          allFacets
        );
      }

      return canDropTaxonomyItem(srcId, dropKey, taxonomyIndex, allFacets);
    },
    [taxonomyIndex, allFacets, isSearching, onReorderItems, onReorderFacets]
  );

  const handleStudioDrop = useCallback(
    async (payload: StudioDragPayload, dropKey: string) => {
      if (payload.kind === "facet") {
        if (!onReorderFacets) return;
        const isAfter = dropKey.startsWith("fafter:");
        const targetId = Number(dropKey.slice(dropKey.indexOf(":") + 1));
        if (!Number.isFinite(targetId) || targetId === payload.id) return;
        const currentIds = domainFacets.map((f) => f.id);
        const nextIds = insertRelativeId(currentIds, payload.id, targetId, isAfter);
        await onReorderFacets(nextIds);
        return;
      }

      const srcId = payload.id;
      if (dropKey.startsWith("before:") || dropKey.startsWith("after:")) {
        if (!onReorderItems) return;
        const isAfter = dropKey.startsWith("after:");
        const parts = dropKey.split(":");
        const targetFacet = parts[1] as TaxonomyFacetSlug;
        const targetId = Number(parts[2]);
        const targetTag = taxonomyIndex.byId.get(targetId);
        const srcTag = taxonomyIndex.byId.get(srcId);
        if (!targetTag || !srcTag) return;

        const targetParent = isFacetHierarchical(targetFacet, allFacets)
          ? (targetTag.parent_id ?? null)
          : null;
        const srcFacet = taxonomyIndex.facetByTagId.get(srcId) ?? "category";
        const srcParent = isFacetHierarchical(srcFacet, allFacets)
          ? (srcTag.parent_id ?? null)
          : null;

        if (srcFacet !== targetFacet || srcParent !== targetParent) {
          await onUpdateTaxonomy(srcId, {
            facetSlug: targetFacet,
            ...(targetParent !== null
              ? { parentId: targetParent }
              : { clearParent: true }),
            ...(targetFacet === "source" ? { colorInherited: true } : {}),
          });
        }

        const siblings = (
          taxonomyIndex.childrenByParentId.get(targetParent) ?? []
        ).filter(
          (t) =>
            (taxonomyIndex.facetByTagId.get(t.id) ?? "category") === targetFacet
        );
        const siblingIds = siblings.map((s) => s.id);
        const nextIds = insertRelativeId(siblingIds, srcId, targetId, isAfter);
        await onReorderItems(nextIds);
        return;
      }

      if (dropKey.startsWith("pill:") || dropKey.startsWith("sec:")) {
        const targetSlug = dropKey.slice(
          dropKey.indexOf(":") + 1
        ) as TaxonomyFacetSlug;
        await onUpdateTaxonomy(srcId, {
          facetSlug: targetSlug,
          clearParent: true,
          ...(targetSlug === "source" ? { colorInherited: true } : {}),
        });
        return;
      }

      if (dropKey.startsWith("node:")) {
        const parts = dropKey.split(":");
        const targetSlug = parts[1] as TaxonomyFacetSlug;
        const targetTagId = Number(parts[2]);
        if (!Number.isFinite(targetTagId) || srcId === targetTagId) return;
        const updated = await onUpdateTaxonomy(srcId, {
          facetSlug: targetSlug,
          parentId: targetTagId,
        });
        if (updated && !expandedIds.has(targetTagId)) {
          onToggleExpand(targetTagId);
        }
      }
    },
    [
      domainFacets,
      taxonomyIndex,
      allFacets,
      expandedIds,
      onToggleExpand,
      onUpdateTaxonomy,
      onReorderItems,
      onReorderFacets,
    ]
  );

  const { dragState, beginPointerDrag } =
    useStudioPointerDrag<StudioDragPayload>({
      scope: dropScope,
      scrollContainerRef,
      canDrop: canDropPayload,
      onDrop: handleStudioDrop,
    });

  const draggingTagId =
    dragState?.payload.kind === "tag" ? dragState.payload.id : null;
  const draggingFacetId =
    dragState?.payload.kind === "facet" ? dragState.payload.id : null;
  const activeDropKey = dragState?.dropKey ?? null;

  const isGenres = domain === "genres";
  const defaultFacetSlug: TaxonomyFacetSlug =
    facetFilter === "all" ? (isGenres ? "genre" : "category") : facetFilter;

  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
      <TaxonomyStudioHeaderBars
        domain={domain}
        dropScope={dropScope}
        domainFacets={domainFacets}
        allFacets={allFacets}
        domainTagsCount={domainTags.length}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        facetFilter={facetFilter}
        onFacetFilterChange={onFacetFilterChange}
        defaultFacetSlug={defaultFacetSlug}
        draggingTagId={draggingTagId}
        draggingFacetId={draggingFacetId}
        activeDropKey={activeDropKey}
        onExpandAllClick={handleExpandAllClick}
        onCollapseAllClick={handleCollapseAllClick}
        onBeginFacetDrag={beginPointerDrag}
        onCreateTag={onCreateTag}
        onSelectTag={onSelectTag}
        onCreateFacet={onCreateFacet}
        onUpdateFacet={onUpdateFacet}
        onDeleteFacet={onDeleteFacet}
      />

      {/* Collapsible Facet Sections + Pointer-Draggable Tree Rows */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-1.5 space-y-2 min-h-0 select-none"
      >
        {totalVisibleRows === 0 && draggingTagId === null ? (
          <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
            {domainTags.length === 0
              ? isGenres
                ? "No genres or moods created yet."
                : "No taxonomy tags created yet."
              : isGenres
              ? "No genres or moods match filter."
              : "No tags match filter."}
          </div>
        ) : (
          sectionedRows.map(({ facet, hierarchical, unharmonizedCount, rows }) => {
            if (
              rows.length === 0 &&
              draggingTagId === null &&
              facet.is_system
            ) {
              return null;
            }
            const isSectionOpen = isSearching || !collapsedSections[facet.slug];
            const secDropKey = `sec:${facet.slug}`;
            const isSecDropHover = activeDropKey === secDropKey;
            const isSource = facet.slug === "source";

            return (
              <div key={facet.slug} className="space-y-0.5">
                <div
                  data-studio-drop-scope={dropScope}
                  data-studio-drop-key={secDropKey}
                  data-studio-drop-hint={`↳ ${facet.name} root`}
                  onClick={() =>
                    updateCollapsedSections((prev) => ({
                      ...prev,
                      [facet.slug]: !prev[facet.slug],
                    }))
                  }
                  className={`h-[22px] px-1.5 rounded-xs font-mono text-[9px] uppercase tracking-wider flex items-center justify-between cursor-pointer transition-colors ${
                    isSecDropHover
                      ? "bg-accent-soft text-accent-fg ring-1 ring-accent"
                      : "text-fg-head hover:text-fg hover:bg-surface-2"
                  }`}
                  title={`Click to collapse · Drag an item here to move to ${facet.name} root`}
                >
                  <span className="flex items-center gap-1 min-w-0">
                    {isSectionOpen ? (
                      <ChevronDown className="w-3 h-3 shrink-0 text-fg-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3 shrink-0 text-fg-3" />
                    )}
                    <span className="truncate font-semibold">{facet.name}</span>
                    {!facet.is_system && (
                      <span className="text-[9.5px] text-fg-3 font-normal">
                        ({hierarchical ? "tree" : "flat"})
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {hierarchical &&
                      unharmonizedCount > 0 &&
                      onHarmonizeFacet && (
                        <button
                          type="button"
                          data-no-press-shift="true"
                          data-testid={`harmonize-facet-${facet.slug}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onHarmonizeFacet(facet.slug);
                          }}
                          className="h-[16px] px-1.5 rounded-[2px] bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent/50 text-accent-fg font-mono text-[9.5px] normal-case inline-flex items-center gap-1 transition-colors cursor-pointer"
                          title={`Match all ${unharmonizedCount} custom-colored sub-item(s) in ${facet.name} to their parent's color family`}
                        >
                          <Palette className="w-2.5 h-2.5 shrink-0" />
                          <span>Harmonize {unharmonizedCount}</span>
                        </button>
                      )}
                    {isSecDropHover && (
                      <span className="text-[9.5px] text-accent-fg font-semibold">
                        ↳ Root
                      </span>
                    )}
                    <span className="text-fg-3 tabular-nums">{rows.length}</span>
                  </span>
                </div>

                {isSectionOpen &&
                  (rows.length === 0 ? (
                    <div className="px-3 py-1.5 text-[10px] font-mono text-fg-3 italic">
                      Empty facet — drag an item here or click + above.
                    </div>
                  ) : (
                    rows.map(
                      ({
                        tag,
                        depth,
                        hasChildren,
                        isExpanded,
                        effectiveColor,
                      }) => (
                        <TaxonomyStudioRow
                          key={tag.id}
                          dropScope={dropScope}
                          facet={facet}
                          hierarchical={hierarchical}
                          isSource={isSource}
                          tag={tag}
                          depth={depth}
                          hasChildren={hasChildren}
                          isExpanded={isExpanded}
                          effectiveColor={effectiveColor}
                          isSelected={selectedTagId === tag.id}
                          isDraggingSelf={draggingTagId === tag.id}
                          activeDropKey={activeDropKey}
                          onSelectTag={onSelectTag}
                          onToggleExpand={onToggleExpand}
                          onBeginDrag={beginPointerDrag}
                        />
                      )
                    )
                  ))}
              </div>
            );
          })
        )}
      </div>

      <StudioDragPill dragState={dragState} />
    </div>
  );
};
