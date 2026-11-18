import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection } from "../../types";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { CollectionInspector } from "./CollectionInspector";
import { CollectionTemplatesPanel } from "./CollectionTemplatesPanel";

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

  const [collectionManagerSearch, setCollectionManagerSearch] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    number | null
  >(null);
  const [confirmDeleteCollectionId, setConfirmDeleteCollectionId] = useState<
    number | null
  >(null);
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [smartExpanded, setSmartExpanded] = useState(true);

  useEffect(() => {
    setSelectedCollectionId(null);
    setConfirmDeleteCollectionId(null);
  }, [activeProfileId]);

  const rootCollections = useMemo(
    () => collections.filter((c) => !c.parent_id),
    [collections]
  );

  const subCollectionsByParent = useMemo(() => {
    const map: Record<number, Collection[]> = {};
    for (const c of collections) {
      if (c.parent_id) {
        if (!map[c.parent_id]) map[c.parent_id] = [];
        map[c.parent_id].push(c);
      }
    }
    return map;
  }, [collections]);

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

  const orderedVisibleCollections = useMemo(
    () => [...normalCollections, ...smartCollections],
    [normalCollections, smartCollections]
  );

  const activeInspectedCollection = useMemo(() => {
    if (selectedCollectionId !== null) {
      const match = rootCollections.find((c) => c.id === selectedCollectionId);
      if (match) return match;
    }
    return orderedVisibleCollections[0] || rootCollections[0] || null;
  }, [rootCollections, selectedCollectionId, orderedVisibleCollections]);

  const hasSearch = collectionManagerSearch.trim().length > 0;
  const isNormalOpen = hasSearch
    ? normalCollections.length > 0
    : collectionsExpanded;
  const isSmartOpen = hasSearch
    ? smartCollections.length > 0
    : smartExpanded;

  const renderCollectionRow = (col: Collection) => {
    const isSelected = activeInspectedCollection?.id === col.id;
    const children = subCollectionsByParent[col.id] || [];
    const isSmart = Boolean(col.smart_query?.trim());
    return (
      <div
        key={col.id}
        onClick={() => {
          setSelectedCollectionId(col.id);
          setConfirmDeleteCollectionId(null);
        }}
        className={`h-[30px] px-2 rounded-xs flex items-center justify-between cursor-pointer text-[11px] transition-colors select-none ${
          isSelected
            ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
            : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
        }`}
      >
        <div className="flex items-center space-x-2 truncate min-w-0">
          {isSmart ? (
            <Zap className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          )}
          <span className="font-medium truncate text-fg">{col.name}</span>
          {isSmart ? (
            <span className="text-[8.5px] font-mono font-bold px-1 py-0.2 rounded-xs bg-accent-soft text-accent-fg border border-accent/40 shrink-0 uppercase tracking-wider">
              SMART
            </span>
          ) : (
            children.length > 0 && (
              <span className="text-[9px] font-mono px-1 py-0.2 rounded-xs bg-surface-2 text-fg-3 border border-line shrink-0">
                +{children.length} sub
              </span>
            )
          )}
        </div>
        <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-2">
          {isSmart
            ? hasSamplePool
              ? (smartCollectionCounts[col.id] ?? 0).toLocaleString()
              : "DYNAMIC"
            : col.sample_count.toLocaleString()}
        </span>
      </div>
    );
  };

  const handleCreateSmartCollection = async (name: string) => {
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
  };

  const collectionGroups = [
    {
      id: "normal" as const,
      label: "COLLECTIONS",
      items: normalCollections,
      expanded: isNormalOpen,
      onToggle: () => setCollectionsExpanded((prev) => !prev),
      emptyText: "No regular collections yet.",
    },
    {
      id: "smart" as const,
      label: "SMART COLLECTIONS",
      items: smartCollections,
      expanded: isSmartOpen,
      onToggle: () => setSmartExpanded((prev) => !prev),
      emptyText: "No smart collections yet.",
    },
  ];

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      {collectionsSubTab === "list" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
          <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
            <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={collectionManagerSearch}
                  onChange={(e) => setCollectionManagerSearch(e.target.value)}
                  placeholder="Search collections..."
                  className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
                />
                {collectionManagerSearch && (
                  <button
                    type="button"
                    onClick={() => setCollectionManagerSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <QuickCreatePopover
                title="New Smart Collection"
                placeholder="Name (also initial query)..."
                hasColor={false}
                buttonTitle="Create smart collection"
                buttonClassName="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg flex items-center justify-center shrink-0 transition-colors shadow-xs cursor-pointer"
                buttonIcon={<Zap className="w-3.5 h-3.5 text-accent-fg" />}
                onCreated={handleCreateSmartCollection}
              />

              <QuickCreatePopover
                title="New Collection"
                placeholder="Collection name..."
                hasColor={false}
                buttonTitle="Create collection"
                onCreated={async (name) => {
                  const created = await createCollection(name);
                  if (!created) return false;
                  setSelectedCollectionId(created.id);
                  setConfirmDeleteCollectionId(null);
                  return true;
                }}
              />
            </div>

            <div className="h-[26px] px-2.5 bg-surface-1 border-b border-line flex items-center justify-between text-[9.5px] font-mono text-fg-3 font-semibold shrink-0">
              <span>COLLECTIONS ({filteredRootCollections.length})</span>
              <span>TRACKS</span>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 space-y-2 min-h-0">
              {filteredRootCollections.length === 0 ? (
                <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
                  {rootCollections.length === 0
                    ? "No collections yet."
                    : "No collections match search."}
                </div>
              ) : (
                collectionGroups.map((group) => (
                  <div
                    key={group.id}
                    className="rounded-xs border border-line bg-surface-0 overflow-hidden group/cat transition-all"
                  >
                    <div className="h-[28px] px-2 flex items-center justify-between gap-1 select-none transition-colors bg-surface-1 hover:bg-surface-2">
                      <button
                        type="button"
                        aria-expanded={group.expanded}
                        aria-label={`${group.label} (${group.items.length})`}
                        onClick={group.onToggle}
                        className="flex items-center space-x-1.5 min-w-0 flex-1 h-full text-left cursor-pointer"
                        title={group.expanded ? "Collapse group" : "Expand group"}
                      >
                        <span className="w-4 h-4 flex items-center justify-center shrink-0 transition-colors text-fg-3 group-hover/cat:text-fg">
                          {group.expanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </span>
                        <span className="font-mono text-[10.5px] font-bold truncate text-fg">
                          {group.label}
                        </span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-xs bg-surface-3 text-fg-3">
                          {group.items.length}
                        </span>
                      </button>
                    </div>

                    {group.expanded && (
                      <div className="p-1 space-y-0.5">
                        {group.items.length === 0 ? (
                          <div className="py-2 px-3 text-[10px] font-mono text-fg-3 italic">
                            {group.emptyText}
                          </div>
                        ) : (
                          group.items.map(renderCollectionRow)
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <CollectionInspector
            activeInspectedCollection={activeInspectedCollection}
            subCollections={
              activeInspectedCollection
                ? subCollectionsByParent[activeInspectedCollection.id] || []
                : []
            }
            confirmDeleteCollectionId={confirmDeleteCollectionId}
            setConfirmDeleteCollectionId={setConfirmDeleteCollectionId}
          />
        </div>
      )}

      {collectionsSubTab === "templates" && <CollectionTemplatesPanel />}
    </div>
  );
};
