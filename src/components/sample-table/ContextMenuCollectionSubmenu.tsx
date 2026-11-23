import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Search,
  X,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection, SampleItem } from "../../types";
import { CollectionIcon } from "../CollectionIcon";
import { QuickCollectionForm } from "./QuickCollectionForm";
import { ContextMenuState } from "./tableLayout";

interface ContextMenuCollectionSubmenuProps {
  submenuPositionClass: string;
  targetIds: number[];
  isMultiContext: boolean;
  activeContextSample: SampleItem;
  targetSamplesList: SampleItem[];
  rootCollections: Collection[];
  childrenByParentId: ReadonlyMap<number, Collection[]>;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

export const ContextMenuCollectionSubmenu: React.FC<
  ContextMenuCollectionSubmenuProps
> = ({
  submenuPositionClass,
  targetIds,
  isMultiContext,
  activeContextSample,
  targetSamplesList,
  rootCollections,
  childrenByParentId,
  setContextMenu,
}) => {
  const autoRouteCollectionDrops = useSampleStore(
    (s) => s.autoRouteCollectionDrops
  );
  const addToCollection = useSampleStore((s) => s.addToCollection);
  const addSamplesToCollectionBatch = useSampleStore(
    (s) => s.addSamplesToCollectionBatch
  );
  const addAutoRoutedSamplesToCollection = useSampleStore(
    (s) => s.addAutoRoutedSamplesToCollection
  );

  const [collectionMenuSearch, setCollectionMenuSearch] = useState("");
  const [collapsedMenuColIds, setCollapsedMenuColIds] = useState<
    Record<number, boolean>
  >({});

  const manualRootCollections = useMemo(
    () => rootCollections.filter((root) => !root.smart_query?.trim()),
    [rootCollections]
  );

  const filteredRootCollections = useMemo(() => {
    const q = collectionMenuSearch.trim().toLowerCase();
    if (!q) return manualRootCollections;
    return manualRootCollections.filter((root) => {
      if (root.name.toLowerCase().includes(q)) return true;
      const children = childrenByParentId.get(root.id) || [];
      return children.some((c) => c.name.toLowerCase().includes(q));
    });
  }, [manualRootCollections, childrenByParentId, collectionMenuSearch]);

  const addToTargetCollection = async (collectionId: number) => {
    if (isMultiContext) {
      await addSamplesToCollectionBatch(collectionId, targetIds);
    } else {
      await addToCollection(collectionId, activeContextSample.id);
    }
    setContextMenu(null);
  };

  return (
    <div
      className={`absolute ${submenuPositionClass} w-[236px] bg-surface-2 border border-line-strong rounded-md text-fg shadow-2xl z-40 max-h-[340px] flex flex-col overflow-hidden`}
    >
      {manualRootCollections.length > 2 && (
        <div className="p-2 border-b border-line bg-surface-1 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3 h-3 text-fg-3 absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={collectionMenuSearch}
              onChange={(e) => setCollectionMenuSearch(e.target.value)}
              placeholder="Filter collections..."
              autoFocus
              className="w-full h-[22px] bg-surface-3 border border-line focus:border-accent pl-6 pr-5 text-[11px] text-fg placeholder:text-fg-3 outline-none rounded-xs"
            />
            {collectionMenuSearch && (
              <button
                type="button"
                onClick={() => setCollectionMenuSearch("")}
                className="absolute right-1.5 text-fg-3 hover:text-fg"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 divide-y divide-line-subtle">
        {filteredRootCollections.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-fg-3 italic text-center">
            No matching collections
          </div>
        ) : (
          filteredRootCollections.map((rootCol) => {
            const allChildren = childrenByParentId.get(rootCol.id) || [];
            const q = collectionMenuSearch.trim().toLowerCase();
            const children = q
              ? allChildren.filter(
                  (c) =>
                    c.name.toLowerCase().includes(q) ||
                    rootCol.name.toLowerCase().includes(q)
                )
              : allChildren;
            const hasChildren = allChildren.length > 0;
            const isCollapsed = q
              ? false
              : Boolean(collapsedMenuColIds[rootCol.id]);

            return (
              <div key={rootCol.id} className="py-0.5">
                <div className="flex items-center hover:bg-accent-soft group">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsedMenuColIds((prev) => ({
                          ...prev,
                          [rootCol.id]: !prev[rootCol.id],
                        }));
                      }}
                      className="w-5 h-6 flex items-center justify-center text-fg-3 hover:text-fg shrink-0"
                      title={
                        isCollapsed
                          ? "Expand subfolders"
                          : "Collapse subfolders"
                      }
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-accent-fg" />
                      )}
                    </button>
                  ) : (
                    <div className="w-2.5 shrink-0" />
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      if (hasChildren && autoRouteCollectionDrops) {
                        await addAutoRoutedSamplesToCollection(
                          rootCol.id,
                          isMultiContext
                            ? targetSamplesList
                            : [activeContextSample]
                        );
                        setContextMenu(null);
                      } else {
                        await addToTargetCollection(rootCol.id);
                      }
                    }}
                    className="flex-1 min-w-0 py-1.5 pr-2.5 flex items-center justify-between text-[11.5px] group-hover:text-accent-fg"
                    title={
                      hasChildren && autoRouteCollectionDrops
                        ? "Add to collection (auto-routes to subfolder by rules)"
                        : `Add to ${rootCol.name}`
                    }
                  >
                    <span className="flex items-center space-x-1.5 truncate min-w-0">
                      <CollectionIcon
                        icon={rootCol.icon}
                        className="w-3.5 h-3.5 shrink-0 text-accent-fg"
                      />
                      <span className="truncate font-medium">
                        {rootCol.name}
                      </span>
                    </span>

                    <span className="flex items-center space-x-1 shrink-0 ml-1">
                      {hasChildren && autoRouteCollectionDrops && (
                        <span className="text-[8px] font-mono text-accent-fg px-1 bg-accent-soft rounded-xs border border-accent/20">
                          Auto
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-fg-3">
                        {rootCol.sample_count}
                      </span>
                    </span>
                  </button>
                </div>

                {!isCollapsed && children.length > 0 && (
                  <div className="pl-5 pr-1.5 py-0.5 space-y-0.5 bg-surface-1">
                    {children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => void addToTargetCollection(child.id)}
                        className="w-full text-left px-2 py-1 rounded-xs hover:bg-accent-soft hover:text-accent-fg flex items-center justify-between text-[11px] text-fg-2"
                        title={`Add specifically to ${rootCol.name} > ${child.name}`}
                      >
                        <span className="flex items-center space-x-1.5 truncate min-w-0">
                          <CornerDownRight className="w-3 h-3 text-fg-3 shrink-0" />
                          <span className="w-2 h-2 rounded-[2px] shrink-0 shadow-xs bg-accent" />
                          <span className="truncate">{child.name}</span>
                        </span>
                        <span className="font-mono text-[9px] text-fg-3 shrink-0 ml-1">
                          {child.sample_count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <QuickCollectionForm
        placeholder="New collection..."
        submitTitle="Create & Add"
        className="p-1.5 border-t border-line flex items-center space-x-1 bg-surface-1 shrink-0"
        inputClassName="flex-1 min-w-0 h-[22px] bg-surface-3 border border-line px-1.5 text-[11px] text-fg outline-none rounded-sm"
        submitClassName="h-[22px] px-2 bg-accent text-accent-on font-mono text-[10px] font-bold shrink-0 whitespace-nowrap flex items-center justify-center rounded-sm"
        onCreated={addToTargetCollection}
      />
    </div>
  );
};
