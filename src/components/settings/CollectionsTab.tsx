import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection } from "../../types";
import { buildCollectionHierarchy } from "../../utils/collectionTree";
import { CollectionInspector } from "./CollectionInspector";
import {
  CollectionFilterOption,
  CollectionsStudioTree,
} from "./CollectionsStudioTree";
import { CollectionTemplatesPanel } from "./CollectionTemplatesPanel";
import {
  hasPersistedTreePref,
  loadPersistedBoolMap,
  loadPersistedIdSet,
  savePersistedBoolMap,
  savePersistedIdSet,
} from "./settingsTreeStorage";

interface CollectionsTabProps {
  collectionsSubTab: "list" | "templates";
}

export const CollectionsTab: React.FC<CollectionsTabProps> = ({
  collectionsSubTab,
}) => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const collections = useSampleStore((s) => s.collections);
  const smartCollectionCounts = useSampleStore((s) => s.smartCollectionCounts);
  const hasSamplePool = useSampleStore((s) => s.allProfileSamples.length > 0);
  const createCollection = useSampleStore((s) => s.createCollection);
  const reparentCollection = useSampleStore((s) => s.reparentCollection);

  const [collectionManagerSearch, setCollectionManagerSearch] = useState("");
  const [filterKind, setFilterKind] = useState<CollectionFilterOption>("all");
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    number | null
  >(null);
  const [confirmDeleteCollectionId, setConfirmDeleteCollectionId] = useState<
    number | null
  >(null);
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>(() =>
    loadPersistedBoolMap(AUDIFY_STORAGE_KEYS.settingsColSectionsOpen, {
      manual: true,
      smart: true,
    })
  );
  const collectionsExpanded = sectionOpen.manual !== false;
  const smartExpanded = sectionOpen.smart !== false;

  const updateSectionsOpen = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      setSectionOpen((prev) => {
        const next = updater(prev);
        savePersistedBoolMap(AUDIFY_STORAGE_KEYS.settingsColSectionsOpen, next);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    setSelectedCollectionId(null);
    setConfirmDeleteCollectionId(null);
  }, [activeProfileId]);

  const { rootCollections, subCollectionsByParent } = useMemo(() => {
    const { rootCollections: roots, childrenByParentId } =
      buildCollectionHierarchy(collections);
    const subMap: Record<number, Collection[]> = {};
    for (const [pid, list] of childrenByParentId.entries()) {
      subMap[pid] = list;
    }
    return { rootCollections: roots, subCollectionsByParent: subMap };
  }, [collections]);

  const [expandedParentIds, setExpandedParentIds] = useState<Set<number>>(() =>
    loadPersistedIdSet(AUDIFY_STORAGE_KEYS.settingsColExpandedIds, () =>
      Object.keys(subCollectionsByParent).map(Number)
    )
  );
  const hydratedDefaultRef = useRef<boolean>(
    hasPersistedTreePref(AUDIFY_STORAGE_KEYS.settingsColExpandedIds) ||
      Object.keys(subCollectionsByParent).length > 0
  );

  useEffect(() => {
    const parentIdsWithSubs = Object.keys(subCollectionsByParent).map(Number);
    if (hydratedDefaultRef.current || parentIdsWithSubs.length === 0) return;
    hydratedDefaultRef.current = true;
    if (!hasPersistedTreePref(AUDIFY_STORAGE_KEYS.settingsColExpandedIds)) {
      setExpandedParentIds(new Set(parentIdsWithSubs));
    }
  }, [subCollectionsByParent]);

  const filteredRootCollections = useMemo(() => {
    const q = collectionManagerSearch.trim().toLowerCase();
    if (!q) return rootCollections;
    return rootCollections.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      const children = subCollectionsByParent[c.id] || [];
      return children.some((sub) => sub.name.toLowerCase().includes(q));
    });
  }, [rootCollections, subCollectionsByParent, collectionManagerSearch]);

  const { normalCollections, smartCollections } = useMemo(() => {
    const normal: Collection[] = [];
    const smart: Collection[] = [];
    for (const col of filteredRootCollections) {
      if (col.smart_query?.trim()) smart.push(col);
      else normal.push(col);
    }
    return { normalCollections: normal, smartCollections: smart };
  }, [filteredRootCollections]);

  const orderedVisibleCollections = useMemo(() => {
    if (filterKind === "manual") return normalCollections;
    if (filterKind === "smart") return smartCollections;
    return [...normalCollections, ...smartCollections];
  }, [filterKind, normalCollections, smartCollections]);

  const activeInspectedCollection = useMemo(() => {
    if (selectedCollectionId !== null) {
      const match = collections.find((c) => c.id === selectedCollectionId);
      if (match) return match;
    }
    return orderedVisibleCollections[0] || rootCollections[0] || null;
  }, [
    collections,
    rootCollections,
    selectedCollectionId,
    orderedVisibleCollections,
  ]);

  const hasSearch = collectionManagerSearch.trim().length > 0;
  const isNormalOpen = hasSearch
    ? normalCollections.length > 0
    : collectionsExpanded;
  const isSmartOpen = hasSearch ? smartCollections.length > 0 : smartExpanded;

  const toggleParentExpand = useCallback((parentId: number) => {
    hydratedDefaultRef.current = true;
    setExpandedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsColExpandedIds, next);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    hydratedDefaultRef.current = true;
    updateSectionsOpen(() => ({ manual: true, smart: true }));
    const next = new Set(Object.keys(subCollectionsByParent).map(Number));
    savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsColExpandedIds, next);
    setExpandedParentIds(next);
  }, [subCollectionsByParent, updateSectionsOpen]);

  const handleCollapseAll = useCallback(() => {
    hydratedDefaultRef.current = true;
    if (expandedParentIds.size > 0 && collectionsExpanded) {
      const empty = new Set<number>();
      savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsColExpandedIds, empty);
      setExpandedParentIds(empty);
      return;
    }
    updateSectionsOpen(() => ({ manual: false, smart: false }));
  }, [expandedParentIds.size, collectionsExpanded, updateSectionsOpen]);

  const handleReparentCollection = useCallback(
    async (collectionId: number, parentId: number | null) => {
      const updated = await reparentCollection(collectionId, parentId);
      if (updated && parentId !== null) {
        hydratedDefaultRef.current = true;
        setExpandedParentIds((prev) => {
          const next = new Set(prev);
          next.add(parentId);
          savePersistedIdSet(AUDIFY_STORAGE_KEYS.settingsColExpandedIds, next);
          return next;
        });
      }
    },
    [reparentCollection]
  );

  const handleSelectCollection = useCallback((colId: number) => {
    setSelectedCollectionId(colId);
    setConfirmDeleteCollectionId(null);
  }, []);

  const handleCreateSmartCollection = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!clean) return false;
      const created = await createCollection(
        clean,
        undefined,
        "zap",
        null,
        null,
        clean
      );
      if (!created) return false;
      setSelectedCollectionId(created.id);
      setConfirmDeleteCollectionId(null);
      return true;
    },
    [createCollection]
  );

  const handleCreateRegularCollection = useCallback(
    async (name: string) => {
      const created = await createCollection(name);
      if (!created) return false;
      setSelectedCollectionId(created.id);
      setConfirmDeleteCollectionId(null);
      return true;
    },
    [createCollection]
  );

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      {collectionsSubTab === "list" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
          <CollectionsStudioTree
            collections={collections}
            rootCollections={rootCollections}
            subCollectionsByParent={subCollectionsByParent}
            filteredRootCollections={filteredRootCollections}
            normalCollections={normalCollections}
            smartCollections={smartCollections}
            smartCollectionCounts={smartCollectionCounts}
            hasSamplePool={hasSamplePool}
            activeInspectedId={activeInspectedCollection?.id ?? null}
            search={collectionManagerSearch}
            onSearchChange={setCollectionManagerSearch}
            filterKind={filterKind}
            onFilterKindChange={setFilterKind}
            isNormalOpen={isNormalOpen}
            isSmartOpen={isSmartOpen}
            onToggleNormalSection={() =>
              updateSectionsOpen((prev) => ({
                ...prev,
                manual: prev.manual === false,
              }))
            }
            onToggleSmartSection={() =>
              updateSectionsOpen((prev) => ({
                ...prev,
                smart: prev.smart === false,
              }))
            }
            expandedParentIds={expandedParentIds}
            onToggleParentExpand={toggleParentExpand}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            onReparentCollection={handleReparentCollection}
            onSelectCollection={handleSelectCollection}
            onCreateSmartCollection={handleCreateSmartCollection}
            onCreateRegularCollection={handleCreateRegularCollection}
          />

          <CollectionInspector
            activeInspectedCollection={activeInspectedCollection}
            subCollections={
              activeInspectedCollection
                ? subCollectionsByParent[activeInspectedCollection.id] || []
                : []
            }
            allCollections={collections}
            confirmDeleteCollectionId={confirmDeleteCollectionId}
            setConfirmDeleteCollectionId={setConfirmDeleteCollectionId}
            onSelectCollectionId={setSelectedCollectionId}
          />
        </div>
      )}

      {collectionsSubTab === "templates" && <CollectionTemplatesPanel />}
    </div>
  );
};
