import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Filter, Music, Plus } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { useSampleStore } from "../../store/useSampleStore";
import type { TaxonomyFacetSlug } from "../../types";
import {
  getFacetLabel,
  getFacetsForDomain,
  getSharedTaxonomyIndex,
  getTagRollupCount,
  isFacetHierarchical,
  MAX_TAXONOMY_DEPTH,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InspectorShell } from "./InspectorShell";
import {
  hasPersistedTreePref,
  loadPersistedIdSet,
  savePersistedIdSet,
} from "./settingsTreeStorage";
import { TagLibraryInspectorFields } from "./TagLibraryInspectorFields";
import { TaxonomyStudioTree } from "./TaxonomyStudioTree";
import { useMainFilterAction } from "./useMainFilterAction";

type FacetFilterOption = "all" | TaxonomyFacetSlug;

export const GenresTab: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const createTag = useSampleStore((s) => s.createTag);
  const renameTag = useSampleStore((s) => s.renameTag);
  const updateTagColor = useSampleStore((s) => s.updateTagColor);
  const updateTagTaxonomy = useSampleStore((s) => s.updateTagTaxonomy);
  const mergeTags = useSampleStore((s) => s.mergeTags);
  const deleteTag = useSampleStore((s) => s.deleteTag);
  const createTagFacet = useSampleStore((s) => s.createTagFacet);
  const updateTagFacet = useSampleStore((s) => s.updateTagFacet);
  const deleteTagFacet = useSampleStore((s) => s.deleteTagFacet);
  const reorderTagFacets = useSampleStore((s) => s.reorderTagFacets);
  const reorderTaxonomyItems = useSampleStore((s) => s.reorderTaxonomyItems);
  const harmonizeTaxonomyColors = useSampleStore(
    (s) => s.harmonizeTaxonomyColors
  );
  const sendFilterToMain = useMainFilterAction();

  const [genreManagerSearch, setGenreManagerSearch] = useState("");
  const [facetFilter, setFacetFilter] = useState<FacetFilterOption>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setConfirmDeleteId(null);
  }, [activeProfileId]);

  const domainFacets = useMemo(
    () => getFacetsForDomain(tagFacets, "genres"),
    [tagFacets]
  );
  const domainFacetSet = useMemo(
    () => new Set<TaxonomyFacetSlug>(domainFacets.map((f) => f.slug)),
    [domainFacets]
  );

  const taxonomy = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );

  const genreDomainTags = useMemo(
    () =>
      tags.filter((t) =>
        domainFacetSet.has(resolveTagFacetSlug(t, tagFacets))
      ),
    [tags, tagFacets, domainFacetSet]
  );

  const computeDefaultExpandedIds = useCallback(() => {
    const ids: number[] = [];
    for (const t of genreDomainTags) {
      if (
        !t.parent_id &&
        isFacetHierarchical(resolveTagFacetSlug(t, tagFacets), tagFacets)
      ) {
        ids.push(t.id);
      }
    }
    return ids;
  }, [genreDomainTags, tagFacets]);

  const [expandedIds, setExpandedIds] = useState<Set<number>>(() =>
    loadPersistedIdSet(
      AUDIFY_STORAGE_KEYS.settingsGenreExpandedIds,
      computeDefaultExpandedIds
    )
  );
  const hydratedDefaultRef = useRef<boolean>(
    hasPersistedTreePref(AUDIFY_STORAGE_KEYS.settingsGenreExpandedIds) ||
      genreDomainTags.length > 0
  );

  useEffect(() => {
    if (hydratedDefaultRef.current || genreDomainTags.length === 0) return;
    hydratedDefaultRef.current = true;
    if (!hasPersistedTreePref(AUDIFY_STORAGE_KEYS.settingsGenreExpandedIds)) {
      setExpandedIds(new Set(computeDefaultExpandedIds()));
    }
  }, [genreDomainTags.length, computeDefaultExpandedIds]);

  const activeItem = useMemo(() => {
    if (selectedId !== null) {
      const match = genreDomainTags.find((t) => t.id === selectedId);
      if (match) return match;
    }
    return genreDomainTags[0] || null;
  }, [genreDomainTags, selectedId]);

  const activeFacet = activeItem
    ? resolveTagFacetSlug(activeItem, tagFacets)
    : "genre";
  const activeFacetLabel = getFacetLabel(activeFacet, tagFacets);

  const canAddSubGenre = useMemo(() => {
    if (!activeItem) return false;
    if (!isFacetHierarchical(activeFacet, tagFacets)) return false;
    const depth = taxonomy.depthByTagId.get(activeItem.id) ?? 1;
    return depth < MAX_TAXONOMY_DEPTH;
  }, [activeItem, activeFacet, tagFacets, taxonomy]);

  const toggleExpand = useCallback((id: number) => {
    hydratedDefaultRef.current = true;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsGenreExpandedIds, next);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback((ids: number[]) => {
    hydratedDefaultRef.current = true;
    const next = new Set(ids);
    savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsGenreExpandedIds, next);
    setExpandedIds(next);
  }, []);

  const handleCollapseAll = useCallback(() => {
    hydratedDefaultRef.current = true;
    const next = new Set<number>();
    savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsGenreExpandedIds, next);
    setExpandedIds(next);
  }, []);

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
        {/* LEFT: GENRES, MOODS & CUSTOM GENRE FACETS TREE */}
        <TaxonomyStudioTree
          domain="genres"
          domainFacets={domainFacets}
          allFacets={tagFacets}
          domainTags={genreDomainTags}
          allTags={tags}
          selectedTagId={activeItem?.id ?? null}
          searchQuery={genreManagerSearch}
          onSearchChange={setGenreManagerSearch}
          facetFilter={facetFilter}
          onFacetFilterChange={setFacetFilter}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          onSelectTag={(id) => {
            setSelectedId(id);
            setConfirmDeleteId(null);
          }}
          onCreateTag={createTag}
          onUpdateTaxonomy={updateTagTaxonomy}
          onReorderItems={reorderTaxonomyItems}
          onReorderFacets={reorderTagFacets}
          onHarmonizeFacet={(slug) =>
            harmonizeTaxonomyColors({ facetSlug: slug })
          }
          onCreateFacet={createTagFacet}
          onUpdateFacet={updateTagFacet}
          onDeleteFacet={deleteTagFacet}
        />

        {/* RIGHT: GENRE / MOOD INSPECTOR */}
        <InspectorShell
          icon={<Music className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
          title={`${activeFacetLabel.toUpperCase()} INSPECTOR`}
          hasItem={Boolean(activeItem)}
          itemName={
            activeItem
              ? taxonomy.breadcrumbByTagId.get(activeItem.id) ?? activeItem.name
              : undefined
          }
          itemDotColor={
            activeItem
              ? taxonomy.effectiveColorByTagId.get(activeItem.id) ??
                activeItem.color
              : undefined
          }
          onFilter={
            activeItem
              ? () =>
                  sendFilterToMain({
                    kind: "tag",
                    id: activeItem.id,
                    label: activeItem.name,
                  })
              : undefined
          }
          filterTitle={
            activeItem
              ? `Filter sample table by "${activeItem.name}"`
              : undefined
          }
          canDelete={Boolean(activeItem)}
          isConfirmingDelete={
            Boolean(activeItem) && confirmDeleteId === activeItem?.id
          }
          onRequestDelete={() => activeItem && setConfirmDeleteId(activeItem.id)}
          onConfirmDelete={async () => {
            if (!activeItem) return;
            setConfirmDeleteId(null);
            await deleteTag(activeItem.id);
          }}
          onCancelDelete={() => setConfirmDeleteId(null)}
          deleteTitle={
            activeItem
              ? `Delete "${activeItem.name}" (sub-genres are promoted, never deleted)`
              : undefined
          }
          bodyClassName="flex-1 overflow-y-auto space-y-3 p-3 min-h-0 flex flex-col"
          emptyState={
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
              <Music className="w-8 h-8 opacity-40 text-accent-fg" />
              <div className="text-[11px] font-mono">
                No genre or mood selected.
              </div>
            </div>
          }
        >
          {activeItem && (
            <>
              <div className="h-[34px] px-3 bg-surface-soft border border-line rounded-xs flex items-center justify-between gap-2 shrink-0">
                <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                  LINKED TRACKS
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-accent-fg tabular-nums">
                    {getTagRollupCount(activeItem).toLocaleString()}
                    {getTagRollupCount(activeItem) !==
                      activeItem.sample_count && (
                      <span className="text-[9.5px] font-normal text-fg-3 ml-1">
                        ({activeItem.sample_count} direct)
                      </span>
                    )}
                  </span>

                  {canAddSubGenre && (
                    <QuickCreatePopover
                      title={`New Sub-genre under ${activeItem.name}`}
                      placeholder="e.g. Synthwave, Deep House..."
                      hasColor={false}
                      align="right"
                      buttonTitle={`Create sub-genre under ${activeItem.name}`}
                      buttonClassName="h-[20px] px-1.5 rounded-xs bg-accent/15 border border-accent/50 text-accent-fg hover:bg-accent hover:text-accent-on font-mono text-[9px] inline-flex items-center gap-0.5 transition-colors"
                      buttonIcon={
                        <>
                          <Plus className="w-2.5 h-2.5" />
                          <span>Sub-genre</span>
                        </>
                      }
                      onCreated={async (name) => {
                        const created = await createTag(
                          name,
                          taxonomy.effectiveColorByTagId.get(activeItem.id) ??
                            activeItem.color,
                          {
                            facetSlug: activeFacet,
                            parentId: activeItem.id,
                            colorInherited: true,
                          }
                        );
                        if (!created) return false;
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          next.add(activeItem.id);
                          return next;
                        });
                        setSelectedId(created.id);
                        return true;
                      }}
                    />
                  )}

                  {(activeFacet === "genre" || activeFacet === "mood") && (
                    <button
                      type="button"
                      onClick={() =>
                        void updateTagTaxonomy(activeItem.id, {
                          facetSlug: activeFacet === "mood" ? "genre" : "mood",
                          clearParent: true,
                        })
                      }
                      className="h-[20px] px-1.5 rounded-xs bg-surface-2 hover:bg-accent-soft border border-line hover:border-accent text-[9px] font-mono text-fg-2 hover:text-accent-fg inline-flex items-center gap-1 transition-colors cursor-pointer"
                      title={
                        activeFacet === "mood"
                          ? "Move to Genre"
                          : "Move to Mood"
                      }
                    >
                      <ArrowLeftRight className="w-2.5 h-2.5" />
                      <span>
                        {activeFacet === "mood" ? "→ Genre" : "→ Mood"}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <TagLibraryInspectorFields
                domain="genres"
                tag={activeItem}
                allTags={tags}
                facets={tagFacets}
                onRename={renameTag}
                onUpdateColor={updateTagColor}
                onUpdateTaxonomy={updateTagTaxonomy}
                onMerge={mergeTags}
                onHarmonizeParent={(parentTagId) =>
                  harmonizeTaxonomyColors({ parentTagId })
                }
                onSelectTagId={setSelectedId}
              />

              <div className="mt-auto pt-2 border-t border-line-subtle shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    sendFilterToMain({
                      kind: "tag",
                      id: activeItem.id,
                      label: activeItem.name,
                    })
                  }
                  className="w-full h-[28px] px-3 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg rounded-xs inline-flex items-center justify-center space-x-1.5 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <Filter className="w-3 h-3 text-accent-fg shrink-0" />
                  <span>Filter tracks by &ldquo;{activeItem.name}&rdquo;</span>
                </button>
              </div>
            </>
          )}
        </InspectorShell>
      </div>
    </div>
  );
};
