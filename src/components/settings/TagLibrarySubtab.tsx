import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, Plus, Sparkles, Tag as TagIcon } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { useSampleStore } from "../../store/useSampleStore";
import type { TaxonomyFacetSlug } from "../../types";
import {
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

export const TagLibrarySubtab: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const autoTagRules = useSampleStore((s) => s.autoTagRules);
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

  const [tagManagerSearch, setTagManagerSearch] = useState("");
  const [facetFilter, setFacetFilter] = useState<FacetFilterOption>("all");
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<number | null>(
    null
  );

  useEffect(() => {
    setSelectedTagId(null);
    setConfirmDeleteTagId(null);
  }, [activeProfileId]);

  const domainFacets = useMemo(
    () => getFacetsForDomain(tagFacets, "tags"),
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

  const domainTags = useMemo(
    () =>
      tags.filter((t) =>
        domainFacetSet.has(resolveTagFacetSlug(t, tagFacets))
      ),
    [tags, tagFacets, domainFacetSet]
  );

  const computeDefaultExpandedIds = useCallback(() => {
    const ids: number[] = [];
    for (const t of domainTags) {
      if (
        !t.parent_id &&
        isFacetHierarchical(resolveTagFacetSlug(t, tagFacets), tagFacets)
      ) {
        ids.push(t.id);
      }
    }
    return ids;
  }, [domainTags, tagFacets]);

  const [expandedIds, setExpandedIds] = useState<Set<number>>(() =>
    loadPersistedIdSet(
      AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds,
      computeDefaultExpandedIds
    )
  );
  const hydratedDefaultRef = useRef<boolean>(
    hasPersistedTreePref(AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds) ||
      domainTags.length > 0
  );

  // One-shot cold-boot hydration only if Settings mounted before IPC populated tags
  useEffect(() => {
    if (hydratedDefaultRef.current || domainTags.length === 0) return;
    hydratedDefaultRef.current = true;
    if (!hasPersistedTreePref(AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds)) {
      setExpandedIds(new Set(computeDefaultExpandedIds()));
    }
  }, [domainTags.length, computeDefaultExpandedIds]);

  const activeInspectedTag = useMemo(() => {
    if (selectedTagId !== null) {
      const match = domainTags.find((t) => t.id === selectedTagId);
      if (match) return match;
    }
    return domainTags[0] || null;
  }, [domainTags, selectedTagId]);

  const activeTagFacet = activeInspectedTag
    ? resolveTagFacetSlug(activeInspectedTag, tagFacets)
    : "category";

  const linkedAutoRule = useMemo(() => {
    if (!activeInspectedTag) return null;
    const lower = activeInspectedTag.name.trim().toLowerCase();
    return (
      autoTagRules.find((r) => r.tag_name.trim().toLowerCase() === lower) ||
      null
    );
  }, [autoTagRules, activeInspectedTag]);

  const canAddSubTag = useMemo(() => {
    if (!activeInspectedTag) return false;
    if (!isFacetHierarchical(activeTagFacet, tagFacets)) return false;
    const depth = taxonomy.depthByTagId.get(activeInspectedTag.id) ?? 1;
    return depth < MAX_TAXONOMY_DEPTH;
  }, [activeInspectedTag, activeTagFacet, tagFacets, taxonomy]);

  const toggleExpand = useCallback((id: number) => {
    hydratedDefaultRef.current = true;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds, next);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback((ids: number[]) => {
    hydratedDefaultRef.current = true;
    const next = new Set(ids);
    savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds, next);
    setExpandedIds(next);
  }, []);

  const handleCollapseAll = useCallback(() => {
    hydratedDefaultRef.current = true;
    const next = new Set<number>();
    savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsTagLibExpandedIds, next);
    setExpandedIds(next);
  }, []);

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
        {/* LEFT: TAGS TAXONOMY TREE */}
        <TaxonomyStudioTree
          domain="tags"
          domainFacets={domainFacets}
          allFacets={tagFacets}
          domainTags={domainTags}
          allTags={tags}
          selectedTagId={activeInspectedTag?.id ?? null}
          searchQuery={tagManagerSearch}
          onSearchChange={setTagManagerSearch}
          facetFilter={facetFilter}
          onFacetFilterChange={setFacetFilter}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          onSelectTag={(id) => {
            setSelectedTagId(id);
            setConfirmDeleteTagId(null);
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

        {/* RIGHT: TAG TAXONOMY INSPECTOR */}
        <InspectorShell
          icon={<TagIcon className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
          title="TAXONOMY INSPECTOR"
          hasItem={Boolean(activeInspectedTag)}
          itemName={
            activeInspectedTag
              ? taxonomy.breadcrumbByTagId.get(activeInspectedTag.id) ??
                activeInspectedTag.name
              : undefined
          }
          itemDotColor={
            activeInspectedTag && activeTagFacet !== "source"
              ? taxonomy.effectiveColorByTagId.get(activeInspectedTag.id) ??
                activeInspectedTag.color
              : undefined
          }
          onFilter={
            activeInspectedTag
              ? () =>
                  sendFilterToMain({
                    kind: "tag",
                    id: activeInspectedTag.id,
                    label: activeInspectedTag.name,
                  })
              : undefined
          }
          filterTitle={
            activeInspectedTag
              ? `Filter sample table by "${activeInspectedTag.name}"`
              : undefined
          }
          canDelete={Boolean(activeInspectedTag)}
          isConfirmingDelete={
            Boolean(activeInspectedTag) &&
            confirmDeleteTagId === activeInspectedTag?.id
          }
          onRequestDelete={() =>
            activeInspectedTag && setConfirmDeleteTagId(activeInspectedTag.id)
          }
          onConfirmDelete={async () => {
            if (!activeInspectedTag) return;
            setConfirmDeleteTagId(null);
            await deleteTag(activeInspectedTag.id);
          }}
          onCancelDelete={() => setConfirmDeleteTagId(null)}
          deleteTitle="Delete tag (sub-tags are promoted, never deleted)"
          bodyClassName="flex-1 overflow-y-auto space-y-3 p-3 min-h-0 flex flex-col"
          emptyState={
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
              <TagIcon className="w-8 h-8 opacity-40 text-accent-fg" />
              <div className="text-[11px] font-mono">No tag selected.</div>
            </div>
          }
        >
          {activeInspectedTag && (
            <>
              <div className="h-[34px] px-3 bg-surface-soft border border-line rounded-xs flex items-center justify-between gap-2 shrink-0">
                <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                  LINKED TRACKS
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-accent-fg tabular-nums">
                    {getTagRollupCount(activeInspectedTag).toLocaleString()}
                    {getTagRollupCount(activeInspectedTag) !==
                      activeInspectedTag.sample_count && (
                      <span className="text-[9.5px] font-normal text-fg-3 ml-1">
                        ({activeInspectedTag.sample_count} direct)
                      </span>
                    )}
                  </span>
                  {canAddSubTag && (
                    <QuickCreatePopover
                      title={`New Sub-tag under ${activeInspectedTag.name}`}
                      placeholder="Sub-tag name..."
                      hasColor={false}
                      align="right"
                      buttonTitle={`Create sub-tag under ${activeInspectedTag.name}`}
                      buttonClassName="h-[20px] px-1.5 rounded-xs bg-accent/15 border border-accent/50 text-accent-fg hover:bg-accent hover:text-accent-on font-mono text-[9px] inline-flex items-center gap-0.5 transition-colors"
                      buttonIcon={
                        <>
                          <Plus className="w-2.5 h-2.5" />
                          <span>Sub-tag</span>
                        </>
                      }
                      onCreated={async (name) => {
                        const created = await createTag(
                          name,
                          taxonomy.effectiveColorByTagId.get(
                            activeInspectedTag.id
                          ) ?? activeInspectedTag.color,
                          {
                            facetSlug: activeTagFacet,
                            parentId: activeInspectedTag.id,
                            colorInherited: true,
                          }
                        );
                        if (!created) return false;
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          next.add(activeInspectedTag.id);
                          return next;
                        });
                        setSelectedTagId(created.id);
                        return true;
                      }}
                    />
                  )}
                </div>
              </div>

              <TagLibraryInspectorFields
                domain="tags"
                tag={activeInspectedTag}
                allTags={tags}
                facets={tagFacets}
                onRename={renameTag}
                onUpdateColor={updateTagColor}
                onUpdateTaxonomy={updateTagTaxonomy}
                onMerge={mergeTags}
                onHarmonizeParent={(parentTagId) =>
                  harmonizeTaxonomyColors({ parentTagId })
                }
                onSelectTagId={setSelectedTagId}
              />

              <div className="bg-surface-soft border border-line rounded-xs p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5">
                    <Sparkles className="w-3 h-3 text-accent-fg shrink-0" />
                    <span className="text-[9.5px] font-mono font-semibold uppercase tracking-wider text-fg-3">
                      LINKED AUTO-TAG RULE
                    </span>
                  </div>
                  {linkedAutoRule ? (
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.2 rounded-xs border font-semibold ${
                        linkedAutoRule.enabled
                          ? "bg-accent-soft border-accent/50 text-accent-fg"
                          : "bg-surface-2 border-line text-fg-3"
                      }`}
                    >
                      {linkedAutoRule.enabled ? "ON" : "OFF"}
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono text-fg-3">
                      Manual / AI
                    </span>
                  )}
                </div>
                {linkedAutoRule ? (
                  <p className="text-[10px] font-mono text-fg-2 leading-relaxed line-clamp-2">
                    {(linkedAutoRule.keywords || []).join(", ") ||
                      "No keywords configured."}
                  </p>
                ) : (
                  <p className="text-[10px] text-fg-3 leading-relaxed">
                    No keyword rule targets &ldquo;{activeInspectedTag.name}
                    &rdquo;. Switch to <strong className="text-fg-2">Rules</strong>{" "}
                    above to automate it.
                  </p>
                )}
              </div>

              <div className="mt-auto pt-2 border-t border-line-subtle shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    sendFilterToMain({
                      kind: "tag",
                      id: activeInspectedTag.id,
                      label: activeInspectedTag.name,
                    })
                  }
                  className="w-full h-[28px] px-3 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg rounded-xs inline-flex items-center justify-center space-x-1.5 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <Filter className="w-3 h-3 text-accent-fg shrink-0" />
                  <span>
                    Filter tracks by &ldquo;{activeInspectedTag.name}&rdquo;
                  </span>
                </button>
              </div>
            </>
          )}
        </InspectorShell>
      </div>
    </div>
  );
};
