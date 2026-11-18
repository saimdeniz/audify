import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import {
  AUDIFY_STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
} from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection } from "../../types";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { CollectionGroupItem } from "./CollectionGroupItem";

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
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isSearchOpen]);

  const [subfolderParentId, setSubfolderParentId] = useState<number | null>(
    null
  );
  const [newSubfolderName, setNewSubfolderName] = useState("");

  const [isSmartSectionOpen, setIsSmartSectionOpen] = useState<boolean>(
    () => safeGetItem(AUDIFY_STORAGE_KEYS.sidebarSmartCollectionsOpen) !== "false"
  );

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

  const { rootCollections, childrenByParentId } = useMemo(() => {
    const roots: typeof collections = [];
    const childrenMap = new Map<number, typeof collections>();

    for (const c of collections) {
      if (c.parent_id) {
        const list = childrenMap.get(c.parent_id) || [];
        list.push(c);
        childrenMap.set(c.parent_id, list);
      } else {
        roots.push(c);
      }
    }

    for (const [, list] of childrenMap.entries()) {
      list.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    }

    return { rootCollections: roots, childrenByParentId: childrenMap };
  }, [collections]);

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

  const toggleCollectionExpand = (id: number) => {
    setExpandedCollectionIds((prev) => {
      const current = prev[id] !== undefined ? prev[id] : true;
      return { ...prev, [id]: !current };
    });
  };

  const setAllCollectionsExpanded = (expanded: boolean) => {
    const next: Record<number, boolean> = {};
    for (const col of rootCollections) {
      next[col.id] = expanded;
    }
    setExpandedCollectionIds(next);
  };

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
  const showPinnedSmartSection = smartFilteredCollections.length > 0;
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
      <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
            COLLECTIONS ({collections.length.toLocaleString()})
          </span>
          {selectedCollectionId !== null && (
            <button
              type="button"
              onClick={() => setCollectionFilter(null)}
              className="w-[18px] h-[18px] text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 flex items-center justify-center shrink-0 transition-colors"
              title="Clear collection filter (Show all)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={() => setAllCollectionsExpanded(true)}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Expand All Collections"
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setAllCollectionsExpanded(false)}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Collapse All Collections"
          >
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
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
          <button
            type="button"
            onClick={() => {
              if (isSearchOpen && !collectionSearch.trim()) {
                setIsSearchOpen(false);
              } else {
                setIsSearchOpen(true);
                requestAnimationFrame(() => searchInputRef.current?.focus());
              }
            }}
            className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
              isSearchOpen || isSearching
                ? "bg-accent-soft border-accent text-accent-fg"
                : "border-transparent text-fg-3 hover:text-fg hover:bg-line"
            }`}
            title="Search collections"
          >
            <Search className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true, "collections")}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Manage Collections & Rules in Settings"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>

      {(isSearchOpen || isSearching) && (
        <div className="px-2 py-1.5 border-b border-line shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={collectionSearch}
              onChange={(e) => updateCollectionSearch(e.target.value)}
              onBlur={() => {
                if (!collectionSearch.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (collectionSearch.trim()) {
                    updateCollectionSearch("");
                  } else {
                    setIsSearchOpen(false);
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Filter collections..."
              className="w-full h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none"
            />
            {collectionSearch && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  updateCollectionSearch("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 text-fg-2 hover:text-fg"
                title="Clear filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1.5">
        {filteredRootCollections.length === 0 ? (
          rootCollections.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-2 select-none">
              <div className="w-8 h-8 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
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
        ) : normalFilteredCollections.length > 0 ? (
          <div className="text-[12px]">
            {normalFilteredCollections.map(renderCollectionGroup)}
          </div>
        ) : null}
      </div>

      {showPinnedSmartSection && (
        <div className="shrink-0 border-t border-line bg-surface-1 flex flex-col max-h-[42%]">
          <button
            type="button"
            onClick={() => setIsSmartSectionOpen((prev) => !prev)}
            aria-expanded={isSmartExpandedEffective}
            className="h-[26px] px-2.5 bg-surface-header hover:bg-surface-2 flex items-center justify-between text-left shrink-0 transition-colors cursor-pointer select-none"
            title={
              isSmartExpandedEffective
                ? "Collapse Smart collections"
                : "Expand Smart collections"
            }
          >
            <span className="flex items-center space-x-1.5 min-w-0">
              {isSmartExpandedEffective ? (
                <ChevronDown className="w-3 h-3 text-fg-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-fg-3 shrink-0" />
              )}
              <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
                SMART ({smartFilteredCollections.length.toLocaleString()})
              </span>
            </span>
          </button>
          {isSmartExpandedEffective && (
            <div className="overflow-y-auto py-1 text-[12px]">
              {smartFilteredCollections.map(renderCollectionGroup)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
