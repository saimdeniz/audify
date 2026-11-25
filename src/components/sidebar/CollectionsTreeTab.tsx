import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Plus } from "lucide-react";
import {
  AUDIFY_STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
} from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection } from "../../types";
import { buildCollectionHierarchy } from "../../utils/collectionTree";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { CollectionGroupItem } from "./CollectionGroupItem";
import { TaxonomySidebarHeader } from "./TaxonomySidebarHeader";
import { TaxonomyFacetSectionHeader } from "./TaxonomySidebarRow";

let sessionCollectionSearch = "";

interface CollectionsTreeTabProps {
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
  dropFlashTarget?: string | null;
}

export const CollectionsTreeTab: React.FC<CollectionsTreeTabProps> = ({
  dragHoverTarget,
  setDragHoverTarget,
  dropFlashTarget,
}) => {
  const collections = useSampleStore((s) => s.collections);
  const smartCollectionCounts = useSampleStore(
    (s) => s.smartCollectionCounts
  );
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const autoRouteCollectionDrops = useSampleStore(
    (s) => s.autoRouteCollectionDrops
  );
  const hasActiveSampleSelection = useSampleStore(
    (s) => s.selectedSampleIds.length > 0 || s.selectedSample !== null
  );
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );
  const setCollectionFilter = useSampleStore((s) => s.setCollectionFilter);
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const createCollection = useSampleStore((s) => s.createCollection);

  const [collectionSearch, setCollectionSearch] = useState<string>(
    () => sessionCollectionSearch
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    () => sessionCollectionSearch.trim().length > 0
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const updateCollectionSearch = (val: string) => {
    sessionCollectionSearch = val;
    setCollectionSearch(val);
  };

  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isSearchOpen]);

  const [subfolderParentId, setSubfolderParentId] = useState<number | null>(
    null
  );
  const [newSubfolderName, setNewSubfolderName] = useState("");

  const [isManualSectionOpen, setIsManualSectionOpen] = useState<boolean>(
    () => safeGetItem(AUDIFY_STORAGE_KEYS.sidebarManualCollectionsOpen) !== "false"
  );
  const [isSmartSectionOpen, setIsSmartSectionOpen] = useState<boolean>(
    () => safeGetItem(AUDIFY_STORAGE_KEYS.sidebarSmartCollectionsOpen) !== "false"
  );

  useEffect(() => {
    safeSetItem(
      AUDIFY_STORAGE_KEYS.sidebarManualCollectionsOpen,
      String(isManualSectionOpen),
      { broadcast: false, markEdited: false }
    );
  }, [isManualSectionOpen]);

  useEffect(() => {
    safeSetItem(
      AUDIFY_STORAGE_KEYS.sidebarSmartCollectionsOpen,
      String(isSmartSectionOpen),
      { broadcast: false, markEdited: false }
    );
  }, [isSmartSectionOpen]);

  const [expandedCollectionIds, setExpandedCollectionIds] = useState<
    Record<number, boolean>
  >(() => {
    try {
      const raw = safeGetItem(AUDIFY_STORAGE_KEYS.expandedColIds);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const t = setTimeout(() => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.expandedColIds,
        JSON.stringify(expandedCollectionIds),
        { broadcast: false, markEdited: false }
      );
    }, 120);
    return () => clearTimeout(t);
  }, [expandedCollectionIds]);

  const { rootCollections, childrenByParentId } = useMemo(
    () => buildCollectionHierarchy(collections),
    [collections]
  );

  const filteredRootCollections = useMemo(() => {
    const q = collectionSearch.trim().toLowerCase();
    if (!q) return rootCollections;
    return rootCollections.filter((root) => {
      if (root.name.toLowerCase().includes(q)) return true;
      const children = childrenByParentId.get(root.id) || [];
      return children.some((child) => child.name.toLowerCase().includes(q));
    });
  }, [rootCollections, childrenByParentId, collectionSearch]);

  const { normalFilteredCollections, smartFilteredCollections } = useMemo(() => {
    const normal: Collection[] = [];
    const smart: Collection[] = [];
    for (const col of filteredRootCollections) {
      if (col.smart_query?.trim()) smart.push(col);
      else normal.push(col);
    }
    return {
      normalFilteredCollections: normal,
      smartFilteredCollections: smart,
    };
  }, [filteredRootCollections]);

  const toggleCollectionExpand = useCallback((id: number) => {
    setExpandedCollectionIds((prev) => {
      const current = prev[id] !== undefined ? prev[id] : true;
      return { ...prev, [id]: !current };
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setIsManualSectionOpen(true);
    setIsSmartSectionOpen(true);
    const next: Record<number, boolean> = {};
    for (const col of rootCollections) {
      next[col.id] = true;
    }
    setExpandedCollectionIds(next);
  }, [rootCollections]);

  const handleCollapseAll = useCallback(() => {
    const parentsWithChildren = rootCollections.filter(
      (col) => (childrenByParentId.get(col.id)?.length ?? 0) > 0
    );
    const anyParentOpen =
      isManualSectionOpen &&
      parentsWithChildren.some((col) => expandedCollectionIds[col.id] !== false);
    if (anyParentOpen) {
      const next: Record<number, boolean> = {};
      for (const col of rootCollections) {
        next[col.id] = false;
      }
      setExpandedCollectionIds(next);
      return;
    }
    setIsManualSectionOpen(false);
    setIsSmartSectionOpen(false);
  }, [
    rootCollections,
    childrenByParentId,
    isManualSectionOpen,
    expandedCollectionIds,
  ]);

  const handleCreateSubfolder = async (
    parentId: number,
    e: React.FormEvent
  ) => {
    e.preventDefault();
    const trimmed = newSubfolderName.trim();
    if (!trimmed) return;
    const created = await createCollection(trimmed, undefined, "folder", parentId);
    if (created) {
      setNewSubfolderName("");
      setSubfolderParentId(null);
      setExpandedCollectionIds((prev) => ({ ...prev, [parentId]: true }));
    }
  };

  const handleQuickAddSelectedToCollection = async (
    e: React.MouseEvent,
    collectionId: number,
    canAutoRoute: boolean
  ) => {
    e.stopPropagation();
    const state = useSampleStore.getState();
    const source =
      state.allProfileSamples.length > 0
        ? state.allProfileSamples
        : state.rawSamples;

    let targetSamples = state.selectedSample ? [state.selectedSample] : [];
    if (state.selectedSampleIds.length > 0) {
      const idSet = new Set(state.selectedSampleIds);
      targetSamples = source.filter((s) => idSet.has(s.id));
    }
    if (targetSamples.length === 0) return;

    if (canAutoRoute && state.autoRouteCollectionDrops) {
      await state.addAutoRoutedSamplesToCollection(collectionId, targetSamples);
    } else if (targetSamples.length > 1) {
      await state.addSamplesToCollectionBatch(
        collectionId,
        targetSamples.map((s) => s.id)
      );
    } else {
      await state.addToCollection(collectionId, targetSamples[0].id);
    }
  };

  const isSearching = collectionSearch.trim().length > 0;
  const qLower = collectionSearch.trim().toLowerCase();
  const isManualExpandedEffective = isSearching ? true : isManualSectionOpen;
  const isSmartExpandedEffective = isSearching ? true : isSmartSectionOpen;

  const renderCollectionGroup = (rootCol: Collection) => {
    const allChildList = childrenByParentId.get(rootCol.id) || [];
    const childList =
      qLower && !rootCol.name.toLowerCase().includes(qLower)
        ? allChildList.filter((c) => c.name.toLowerCase().includes(qLower))
        : allChildList;
    const hasChildren = allChildList.length > 0;
    const isExpanded = qLower
      ? true
      : expandedCollectionIds[rootCol.id] !== undefined
      ? expandedCollectionIds[rootCol.id]
      : true;

    return (
      <CollectionGroupItem
        key={rootCol.id}
        rootCol={rootCol}
        smartMatchCount={smartCollectionCounts[rootCol.id]}
        childList={childList}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        selectedCollectionId={selectedCollectionId}
        autoRouteCollectionDrops={autoRouteCollectionDrops}
        hasActiveSampleSelection={hasActiveSampleSelection}
        isDraggingInApp={isDraggingInApp}
        inAppDragCount={inAppDragCount}
        dragHoverTarget={dragHoverTarget}
        dropFlashTarget={dropFlashTarget}
        subfolderParentId={subfolderParentId}
        newSubfolderName={newSubfolderName}
        setNewSubfolderName={setNewSubfolderName}
        setSubfolderParentId={setSubfolderParentId}
        setExpandedCollectionIds={setExpandedCollectionIds}
        toggleCollectionExpand={toggleCollectionExpand}
        setCollectionFilter={setCollectionFilter}
        setDragHoverTarget={setDragHoverTarget}
        handleQuickAddSelectedToCollection={handleQuickAddSelectedToCollection}
        handleCreateSubfolder={handleCreateSubfolder}
      />
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <TaxonomySidebarHeader
        title={
          isSearching
            ? `COLLECTIONS (${filteredRootCollections.length.toLocaleString()}/${collections.length.toLocaleString()})`
            : `COLLECTIONS (${collections.length.toLocaleString()})`
        }
        hasActiveFilter={selectedCollectionId !== null}
        clearFilterTitle="Clear collection filter (Show all)"
        onClearFilter={() => setCollectionFilter(null)}
        createAction={
          <QuickCreatePopover
            title="New Collection"
            placeholder="Collection name..."
            hasColor={false}
            align="right"
            buttonTitle="Create new collection"
            buttonClassName="w-[20px] h-[20px] rounded-xs font-mono text-[9px] bg-accent/15 border border-accent/50 text-accent-fg hover:bg-accent hover:text-accent-on flex items-center justify-center shrink-0 transition-colors"
            buttonIcon={<Plus className="w-3.5 h-3.5" />}
            onCreated={async (name) => {
              const created = await createCollection(name);
              return Boolean(created);
            }}
          />
        }
        showExpandCollapse={rootCollections.length > 0}
        expandAllTitle="Expand All Collections & Sections"
        collapseAllTitle="Collapse Sub-collections & Sections"
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        isSearchOpen={isSearchOpen}
        isSearching={isSearching}
        searchQuery={collectionSearch}
        searchPlaceholder="Filter collections..."
        searchButtonTitle="Search collections"
        searchInputRef={searchInputRef}
        onSearchChange={updateCollectionSearch}
        onSearchOpenChange={setIsSearchOpen}
        settingsTitle="Manage Collections & Rules in Settings"
        onOpenSettings={() => setSettingsOpen(true, "collections")}
      />

      <div className="flex-1 overflow-y-auto py-1.5 select-none">
        {filteredRootCollections.length === 0 ? (
          rootCollections.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-2">
              <div className="w-8 h-8 mx-auto rounded-[3px] bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
                <LayoutGrid className="w-4 h-4" />
              </div>
              <div className="text-[11px] font-medium text-fg">
                No collections yet
              </div>
              <div className="text-[10px] text-fg-3 leading-relaxed">
                Create collections to organize favorite sounds, or click + above
                to create one.
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-[11px] text-fg-3 font-mono">
              No collections match filter.
            </div>
          )
        ) : (
          <div className="flex flex-col">
            {normalFilteredCollections.length > 0 && (
              <div>
                <TaxonomyFacetSectionHeader
                  label="COLLECTIONS"
                  count={normalFilteredCollections.length}
                  isOpen={isManualExpandedEffective}
                  title={
                    isManualExpandedEffective
                      ? "Collapse manual collections"
                      : "Expand manual collections"
                  }
                  onToggle={() => setIsManualSectionOpen((prev) => !prev)}
                />
                {isManualExpandedEffective && (
                  <div className="flex flex-col text-[12px]">
                    {normalFilteredCollections.map(renderCollectionGroup)}
                  </div>
                )}
              </div>
            )}

            {smartFilteredCollections.length > 0 && (
              <div>
                <TaxonomyFacetSectionHeader
                  label="SMART"
                  count={smartFilteredCollections.length}
                  isOpen={isSmartExpandedEffective}
                  title={
                    isSmartExpandedEffective
                      ? "Collapse Smart collections"
                      : "Expand Smart collections"
                  }
                  onToggle={() => setIsSmartSectionOpen((prev) => !prev)}
                />
                {isSmartExpandedEffective && (
                  <div className="flex flex-col text-[12px]">
                    {smartFilteredCollections.map(renderCollectionGroup)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
