import React, { useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Folder,
  GripVertical,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useStudioPointerDrag } from "../../hooks/useStudioPointerDrag";
import { Collection } from "../../types";
import { StudioDragPill } from "../common/StudioDragPill";
import { QuickCreatePopover } from "../QuickCreatePopover";

export type CollectionFilterOption = "all" | "manual" | "smart";

interface CollectionsStudioTreeProps {
  collections: Collection[];
  rootCollections: Collection[];
  subCollectionsByParent: Record<number, Collection[]>;
  filteredRootCollections: Collection[];
  normalCollections: Collection[];
  smartCollections: Collection[];
  smartCollectionCounts: Record<number, number>;
  hasSamplePool: boolean;
  activeInspectedId: number | null;
  search: string;
  onSearchChange: (val: string) => void;
  filterKind: CollectionFilterOption;
  onFilterKindChange: (val: CollectionFilterOption) => void;
  isNormalOpen: boolean;
  isSmartOpen: boolean;
  onToggleNormalSection: () => void;
  onToggleSmartSection: () => void;
  expandedParentIds: Set<number>;
  onToggleParentExpand: (parentId: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onReparentCollection: (
    collectionId: number,
    parentId: number | null
  ) => Promise<void>;
  onSelectCollection: (colId: number) => void;
  onCreateSmartCollection: (name: string) => Promise<boolean>;
  onCreateRegularCollection: (name: string) => Promise<boolean>;
}

export const CollectionsStudioTree: React.FC<CollectionsStudioTreeProps> = ({
  collections,
  rootCollections,
  subCollectionsByParent,
  filteredRootCollections,
  normalCollections,
  smartCollections,
  smartCollectionCounts,
  hasSamplePool,
  activeInspectedId,
  search,
  onSearchChange,
  filterKind,
  onFilterKindChange,
  isNormalOpen,
  isSmartOpen,
  onToggleNormalSection,
  onToggleSmartSection,
  expandedParentIds,
  onToggleParentExpand,
  onExpandAll,
  onCollapseAll,
  onReparentCollection,
  onSelectCollection,
  onCreateSmartCollection,
  onCreateRegularCollection,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dropScope = "collections-studio";

  const canDropCollection = useCallback(
    (srcId: number, dropKey: string): boolean => {
      const srcCol = collections.find((c) => c.id === srcId);
      if (!srcCol || srcCol.smart_query?.trim()) return false;
      if (dropKey === "pill:manual" || dropKey === "sec:manual") {
        return srcCol.parent_id != null;
      }
      if (dropKey.startsWith("parent:")) {
        const targetId = Number(dropKey.slice(7));
        if (!Number.isFinite(targetId) || targetId === srcId) return false;
        const targetParent = collections.find((c) => c.id === targetId);
        if (
          !targetParent ||
          targetParent.parent_id != null ||
          targetParent.smart_query?.trim()
        ) {
          return false;
        }
        if ((subCollectionsByParent[srcId]?.length ?? 0) > 0) return false;
        return srcCol.parent_id !== targetId;
      }
      return false;
    },
    [collections, subCollectionsByParent]
  );

  const handleCollectionDrop = useCallback(
    async (srcId: number, dropKey: string) => {
      if (dropKey === "pill:manual" || dropKey === "sec:manual") {
        await onReparentCollection(srcId, null);
        return;
      }
      if (dropKey.startsWith("parent:")) {
        const targetId = Number(dropKey.slice(7));
        if (Number.isFinite(targetId) && targetId !== srcId) {
          await onReparentCollection(srcId, targetId);
        }
      }
    },
    [onReparentCollection]
  );

  const { dragState, beginPointerDrag } = useStudioPointerDrag<number>({
    scope: dropScope,
    scrollContainerRef,
    canDrop: canDropCollection,
    onDrop: handleCollectionDrop,
  });

  const draggingColId = dragState?.payload ?? null;
  const activeDropKey = dragState?.dropKey ?? null;

  const hasSearch = search.trim().length > 0;
  const qLower = search.trim().toLowerCase();
  const draggingIsSub =
    draggingColId !== null &&
    collections.some((c) => c.id === draggingColId && c.parent_id != null);

  const showNormalSection = filterKind === "all" || filterKind === "manual";
  const showSmartSection = filterKind === "all" || filterKind === "smart";

  const renderManualGroup = (col: Collection) => {
    const isSelected = activeInspectedId === col.id;
    const isDraggingSelf = draggingColId === col.id;
    const allChildren = subCollectionsByParent[col.id] || [];
    const visibleChildren =
      qLower && !col.name.toLowerCase().includes(qLower)
        ? allChildren.filter((c) => c.name.toLowerCase().includes(qLower))
        : allChildren;
    const hasChildren = allChildren.length > 0;
    const isExpanded = hasSearch ? true : expandedParentIds.has(col.id);
    const parentDropKey = `parent:${col.id}`;
    const isDropHover = activeDropKey === parentDropKey;

    return (
      <React.Fragment key={col.id}>
        <div
          data-studio-drop-scope={dropScope}
          data-studio-drop-key={parentDropKey}
          data-studio-drop-hint={`↳ Nest under ${col.name}`}
          onMouseDown={(e) => beginPointerDrag(e, col.id, { label: col.name })}
          onClick={() => onSelectCollection(col.id)}
          style={{ paddingLeft: "8px" }}
          className={`group/col h-[30px] pr-2.5 rounded-xs flex items-center justify-between cursor-grab active:cursor-grabbing text-[11px] transition-colors ${
            isDraggingSelf
              ? "opacity-45 bg-surface-2 border border-dashed border-accent"
              : isDropHover
              ? "bg-accent-soft border border-accent text-accent-fg ring-1 ring-accent"
              : isSelected
              ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
              : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
          }`}
        >
          <div className="flex items-center space-x-1.5 truncate min-w-0">
            {hasChildren ? (
              <button
                type="button"
                data-no-press-shift="true"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleParentExpand(col.id);
                }}
                className="w-3.5 h-3.5 flex items-center justify-center text-fg-3 hover:text-fg shrink-0 cursor-pointer"
                title={
                  isExpanded ? "Collapse sub-folders" : "Expand sub-folders"
                }
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            ) : (
              <span className="w-3.5 shrink-0 flex items-center justify-center">
                <GripVertical className="w-2.5 h-2.5 text-fg-faint opacity-0 group-hover/col:opacity-80 transition-opacity" />
              </span>
            )}
            <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
            <span className="font-medium truncate text-fg">{col.name}</span>
            {hasChildren && !isExpanded && (
              <span className="text-[9px] font-mono px-1 py-0.2 rounded-xs bg-surface-2 text-fg-3 border border-line shrink-0">
                +{allChildren.length} sub
              </span>
            )}
          </div>
          <span className="flex items-center gap-1.5 shrink-0 ml-2">
            {isDropHover && (
              <span className="font-mono text-[8.5px] text-accent-fg font-semibold">
                ↳ Nest
              </span>
            )}
            <span className="font-mono text-[9.5px] text-fg-3 tabular-nums">
              {col.sample_count.toLocaleString()}
            </span>
          </span>
        </div>

        {hasChildren &&
          isExpanded &&
          visibleChildren.map((sub) => {
            const isSubSelected = activeInspectedId === sub.id;
            const isSubDragging = draggingColId === sub.id;
            return (
              <div
                key={sub.id}
                onMouseDown={(e) =>
                  beginPointerDrag(e, sub.id, { label: sub.name })
                }
                onClick={() => onSelectCollection(sub.id)}
                style={{ paddingLeft: "24px" }}
                className={`group/sub h-[30px] pr-2.5 rounded-xs flex items-center justify-between cursor-grab active:cursor-grabbing text-[11px] transition-colors ${
                  isSubDragging
                    ? "opacity-45 bg-surface-2 border border-dashed border-accent"
                    : isSubSelected
                    ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
                    : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
                }`}
              >
                <div className="flex items-center space-x-1.5 truncate min-w-0">
                  <span className="w-3.5 shrink-0 flex items-center justify-center">
                    <GripVertical className="w-2.5 h-2.5 text-fg-faint opacity-0 group-hover/sub:opacity-80 transition-opacity" />
                  </span>
                  <Folder className="w-3 h-3 text-fg-3 shrink-0" />
                  <span className="font-medium truncate text-fg">
                    {sub.name}
                  </span>
                </div>
                <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-2 tabular-nums">
                  {sub.sample_count.toLocaleString()}
                </span>
              </div>
            );
          })}
      </React.Fragment>
    );
  };

  const renderSmartRow = (col: Collection) => {
    const isSelected = activeInspectedId === col.id;
    return (
      <div
        key={col.id}
        onClick={() => onSelectCollection(col.id)}
        className={`h-[30px] px-2.5 rounded-xs flex items-center justify-between cursor-pointer text-[11px] transition-colors ${
          isSelected
            ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
            : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
        }`}
      >
        <div className="flex items-center space-x-2 truncate min-w-0">
          <Zap className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          <span className="font-medium truncate text-fg">{col.name}</span>
          <span className="text-[8.5px] font-mono font-bold px-1 py-0.2 rounded-xs bg-accent-soft text-accent-fg border border-accent/40 shrink-0 uppercase tracking-wider">
            SMART
          </span>
        </div>
        <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-2 tabular-nums">
          {hasSamplePool
            ? (smartCollectionCounts[col.id] ?? 0).toLocaleString()
            : "DYNAMIC"}
        </span>
      </div>
    );
  };

  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
      {/* Top Toolbar: Search + Expand/Collapse + Smart + Regular */}
      <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search collections..."
            className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onExpandAll}
          className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          title="Expand All Collections & Sub-folders"
        >
          <ChevronsDown className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onCollapseAll}
          className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          title="Collapse Sub-folders & Sections"
        >
          <ChevronsUp className="w-3.5 h-3.5" />
        </button>

        <QuickCreatePopover
          title="New Smart Collection"
          placeholder="Name (also initial query)..."
          hasColor={false}
          buttonTitle="Create smart collection"
          buttonClassName="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg flex items-center justify-center shrink-0 transition-colors shadow-xs cursor-pointer"
          buttonIcon={<Zap className="w-3.5 h-3.5 text-accent-fg" />}
          onCreated={onCreateSmartCollection}
        />

        <QuickCreatePopover
          title="New Collection"
          placeholder="Collection name..."
          hasColor={false}
          buttonTitle="Create collection"
          onCreated={onCreateRegularCollection}
        />
      </div>

      {/* Filter Pill Bar (Matching Tags & Genres Studios) */}
      <div className="px-2 py-1.5 bg-surface-sub border-b border-line flex items-center gap-1 flex-wrap shrink-0">
        <button
          type="button"
          onClick={() => onFilterKindChange("all")}
          className={`h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border transition-colors cursor-pointer ${
            filterKind === "all"
              ? "bg-accent-soft border-accent text-accent-fg font-semibold"
              : "bg-surface-2 border-line text-fg-3 hover:text-fg"
          }`}
        >
          ALL ({rootCollections.length})
        </button>
        <button
          type="button"
          data-studio-drop-scope={dropScope}
          data-studio-drop-key="pill:manual"
          data-studio-drop-hint="↳ Promote to Root"
          onClick={() => onFilterKindChange("manual")}
          className={`h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border transition-colors cursor-pointer ${
            activeDropKey === "pill:manual"
              ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-accent"
              : filterKind === "manual"
              ? "bg-accent-soft border-accent text-accent-fg font-semibold"
              : "bg-surface-2 border-line text-fg-3 hover:text-fg"
          }`}
          title={
            draggingIsSub
              ? "Drop here to promote sub-collection to top level"
              : "Show manual collections"
          }
        >
          COLLECTIONS
        </button>
        <button
          type="button"
          onClick={() => onFilterKindChange("smart")}
          className={`h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border transition-colors cursor-pointer ${
            filterKind === "smart"
              ? "bg-accent-soft border-accent text-accent-fg font-semibold"
              : "bg-surface-2 border-line text-fg-3 hover:text-fg"
          }`}
        >
          SMART
        </button>
      </div>

      {/* Sleek Library-Parity Collapsible Tree Sections */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-1.5 space-y-2 min-h-0 select-none"
      >
        {filteredRootCollections.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
            {rootCollections.length === 0
              ? "No collections yet."
              : "No collections match search."}
          </div>
        ) : (
          <>
            {showNormalSection && (
              <div className="space-y-0.5">
                <div className="shrink-0">
                  <button
                    type="button"
                    data-no-press-shift="true"
                    data-studio-drop-scope={dropScope}
                    data-studio-drop-key="sec:manual"
                    data-studio-drop-hint="↳ Promote to Root"
                    aria-expanded={isNormalOpen}
                    aria-label={`COLLECTIONS (${normalCollections.length})`}
                    onClick={onToggleNormalSection}
                    className={`w-full h-[22px] px-1.5 rounded-xs font-mono text-[9px] uppercase tracking-wider flex items-center justify-between cursor-pointer transition-colors ${
                      activeDropKey === "sec:manual"
                        ? "bg-accent-soft text-accent-fg ring-1 ring-accent"
                        : "text-fg-head hover:text-fg hover:bg-surface-2"
                    }`}
                    title="Click to collapse · Drag a sub-folder here to promote to top-level Collection"
                  >
                    <span className="flex items-center gap-1 min-w-0">
                      {isNormalOpen ? (
                        <ChevronDown className="w-3 h-3 shrink-0 text-fg-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0 text-fg-3" />
                      )}
                      <span className="truncate font-semibold">
                        COLLECTIONS
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {activeDropKey === "sec:manual" && (
                        <span className="text-[8.5px] text-accent-fg font-semibold">
                          ↳ Promote to Root
                        </span>
                      )}
                      <span className="text-fg-3 tabular-nums">
                        {normalCollections.length}
                      </span>
                    </span>
                  </button>
                </div>

                {isNormalOpen &&
                  (normalCollections.length === 0 ? (
                    <div className="py-2 px-3 text-[10px] font-mono text-fg-3 italic">
                      No regular collections yet.
                    </div>
                  ) : (
                    normalCollections.map(renderManualGroup)
                  ))}
              </div>
            )}

            {showSmartSection && (
              <div
                className={`space-y-0.5 ${
                  showNormalSection ? "pt-1.5 border-t border-line-subtle" : ""
                }`}
              >
                <div className="shrink-0">
                  <button
                    type="button"
                    data-no-press-shift="true"
                    aria-expanded={isSmartOpen}
                    aria-label={`SMART COLLECTIONS (${smartCollections.length})`}
                    onClick={onToggleSmartSection}
                    className="w-full h-[22px] px-1.5 rounded-xs font-mono text-[9px] uppercase tracking-wider text-fg-head hover:text-fg hover:bg-surface-2 flex items-center justify-between cursor-pointer transition-colors"
                    title={
                      isSmartOpen
                        ? "Collapse Smart Collections"
                        : "Expand Smart Collections"
                    }
                  >
                    <span className="flex items-center gap-1 min-w-0">
                      {isSmartOpen ? (
                        <ChevronDown className="w-3 h-3 shrink-0 text-fg-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0 text-fg-3" />
                      )}
                      <span className="truncate font-semibold">
                        SMART COLLECTIONS
                      </span>
                    </span>
                    <span className="text-fg-3 tabular-nums">
                      {smartCollections.length}
                    </span>
                  </button>
                </div>

                {isSmartOpen &&
                  (smartCollections.length === 0 ? (
                    <div className="py-2 px-3 text-[10px] font-mono text-fg-3 italic">
                      No smart collections yet.
                    </div>
                  ) : (
                    smartCollections.map(renderSmartRow)
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      <StudioDragPill dragState={dragState} iconKind="folder" />
    </div>
  );
};
