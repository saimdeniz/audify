import React from "react";
import { Check, FolderPlus, FolderTree, Plus, X, Zap } from "lucide-react";
import { Collection } from "../../types";
import { getSidebarTreeIndentPx, SidebarTreeRow } from "./SidebarTreeRow";

interface CollectionGroupItemProps {
  rootCol: Collection;
  smartMatchCount?: number;
  childList: Collection[];
  hasChildren: boolean;
  isExpanded: boolean;
  selectedCollectionId: number | null;
  autoRouteCollectionDrops: boolean;
  hasActiveSampleSelection: boolean;
  isDraggingInApp: boolean;
  inAppDragCount: number;
  dragHoverTarget: string | null;
  dropFlashTarget?: string | null;
  subfolderParentId: number | null;
  newSubfolderName: string;
  setNewSubfolderName: (val: string) => void;
  setSubfolderParentId: React.Dispatch<React.SetStateAction<number | null>>;
  setExpandedCollectionIds: React.Dispatch<
    React.SetStateAction<Record<number, boolean>>
  >;
  toggleCollectionExpand: (id: number) => void;
  setCollectionFilter: (id: number | null) => void;
  setDragHoverTarget: (target: string | null) => void;
  handleQuickAddSelectedToCollection: (
    e: React.MouseEvent,
    collectionId: number,
    canAutoRoute: boolean
  ) => Promise<void>;
  handleCreateSubfolder: (parentId: number, e: React.FormEvent) => Promise<void>;
}

export const CollectionGroupItem: React.FC<CollectionGroupItemProps> = ({
  rootCol,
  smartMatchCount,
  childList,
  hasChildren,
  isExpanded,
  selectedCollectionId,
  autoRouteCollectionDrops,
  hasActiveSampleSelection,
  isDraggingInApp,
  inAppDragCount,
  dragHoverTarget,
  dropFlashTarget,
  subfolderParentId,
  newSubfolderName,
  setNewSubfolderName,
  setSubfolderParentId,
  setExpandedCollectionIds,
  toggleCollectionExpand,
  setCollectionFilter,
  setDragHoverTarget,
  handleQuickAddSelectedToCollection,
  handleCreateSubfolder,
}) => {
  const isSmartCollection = Boolean(rootCol.smart_query?.trim());
  const rootTotalCount = isSmartCollection
    ? smartMatchCount ?? rootCol.sample_count
    : rootCol.sample_count +
      childList.reduce((acc, c) => acc + c.sample_count, 0);
  const isRootSelected = selectedCollectionId === rootCol.id;
  const isAncestorOfSelected = childList.some(
    (c) => c.id === selectedCollectionId
  );
  const rootTargetKey = `col-${rootCol.id}`;
  const isRootDropHover =
    !isSmartCollection && isDraggingInApp && dragHoverTarget === rootTargetKey;
  const isRootDropFlash = !isSmartCollection && dropFlashTarget === rootTargetKey;
  const willAutoRoute = hasChildren && autoRouteCollectionDrops;

  return (
    <div>
      <SidebarTreeRow
        depth={0}
        label={rootCol.name}
        count={rootTotalCount}
        hasChildren={!isSmartCollection && hasChildren}
        isExpanded={isExpanded}
        isSelected={isRootSelected}
        isAncestorOfSelected={isAncestorOfSelected}
        isDragHover={isRootDropHover}
        isDropFlashing={isRootDropFlash}
        onToggleExpand={() => toggleCollectionExpand(rootCol.id)}
        toggleTitle={isExpanded ? "Collapse collection" : "Expand collection"}
        data-sidebar-drop={isSmartCollection ? undefined : rootTargetKey}
        icon={
          isSmartCollection ? (
            <Zap
              className={`w-3.5 h-3.5 shrink-0 ${
                isRootSelected
                  ? "text-accent-fg"
                  : "text-accent-fg opacity-85 group-hover:opacity-100"
              }`}
            />
          ) : undefined
        }
        title={
          isSmartCollection
            ? `${rootCol.name} (Smart Collection: ${rootCol.smart_query})`
            : rootCol.rule_path
            ? `${rootCol.name} (Smart Route: ${rootCol.rule_path})`
            : rootCol.name
        }
        dropHint={
          isRootDropHover
            ? willAutoRoute
              ? inAppDragCount > 1
                ? `＋ Route (${inAppDragCount})`
                : "＋ Route"
              : inAppDragCount > 1
              ? `＋ Add (${inAppDragCount})`
              : "＋ Add"
            : null
        }
        onClick={() => setCollectionFilter(isRootSelected ? null : rootCol.id)}
        onMouseEnter={() => {
          if (isDraggingInApp && !isSmartCollection) {
            setDragHoverTarget(rootTargetKey);
          }
        }}
        afterLabel={
          !isSmartCollection && rootCol.rule_path ? (
            <span
              title={`Smart Route folder rule: ${rootCol.rule_path}`}
              className="opacity-0 group-hover:opacity-80 transition-opacity"
            >
              <FolderTree className="w-3 h-3 text-fg-3 shrink-0 ml-0.5" />
            </span>
          ) : undefined
        }
        actions={
          !isDraggingInApp && !isSmartCollection ? (
            <>
              {hasActiveSampleSelection && (
                <button
                  type="button"
                  onClick={(e) =>
                    void handleQuickAddSelectedToCollection(
                      e,
                      rootCol.id,
                      hasChildren
                    )
                  }
                  className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0"
                  title="Add selected track(s) to collection"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedCollectionIds((prev) => ({
                    ...prev,
                    [rootCol.id]: true,
                  }));
                  setSubfolderParentId((prev) =>
                    prev === rootCol.id ? null : rootCol.id
                  );
                  setNewSubfolderName("");
                }}
                className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0"
                title="New subfolder"
              >
                <FolderPlus className="w-3 h-3" />
              </button>
            </>
          ) : undefined
        }
      />

      {subfolderParentId === rootCol.id && (
        <form
          onSubmit={(e) => void handleCreateSubfolder(rootCol.id, e)}
          style={{
            paddingLeft: `${getSidebarTreeIndentPx(1) + 22}px`,
          }}
          className="h-[26px] pr-2 flex items-center gap-1 bg-surface-3 border-l-2 border-accent"
        >
          <input
            type="text"
            value={newSubfolderName}
            onChange={(e) => setNewSubfolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSubfolderParentId(null);
                setNewSubfolderName("");
              }
            }}
            placeholder="Subfolder name..."
            autoFocus
            className="flex-1 min-w-0 h-[20px] rounded-xs bg-surface-1 border border-accent px-1.5 text-[11px] text-fg outline-none"
          />
          <button
            type="submit"
            className="w-[18px] h-[18px] rounded-xs bg-accent text-accent-on flex items-center justify-center shrink-0"
            title="Create subfolder"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSubfolderParentId(null);
              setNewSubfolderName("");
            }}
            className="w-[18px] h-[18px] rounded-xs bg-surface-2 border border-line text-fg-2 hover:text-fg flex items-center justify-center shrink-0"
            title="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        </form>
      )}

      {isExpanded &&
        childList.map((child) => {
          const isChildSelected = selectedCollectionId === child.id;
          const childTargetKey = `col-${child.id}`;
          const isChildDropHover =
            isDraggingInApp && dragHoverTarget === childTargetKey;
          const isChildDropFlash = dropFlashTarget === childTargetKey;

          return (
            <SidebarTreeRow
              key={child.id}
              depth={1}
              label={child.name}
              count={child.sample_count}
              hasChildren={false}
              isExpanded={false}
              isSelected={isChildSelected}
              isDragHover={isChildDropHover}
              isDropFlashing={isChildDropFlash}
              data-sidebar-drop={childTargetKey}
              title={
                child.rule_path
                  ? `${rootCol.name} / ${child.name} (Auto-route folder rule: ${child.rule_path})`
                  : `${rootCol.name} / ${child.name}`
              }
              dropHint={
                isChildDropHover
                  ? inAppDragCount > 1
                    ? `＋ Add (${inAppDragCount})`
                    : "＋ Add"
                  : null
              }
              onClick={() =>
                setCollectionFilter(isChildSelected ? null : child.id)
              }
              onMouseEnter={() => {
                if (isDraggingInApp) setDragHoverTarget(childTargetKey);
              }}
              afterLabel={
                child.rule_path ? (
                  <span
                    title={`Auto-route folder rule: ${child.rule_path}`}
                    className="opacity-0 group-hover:opacity-80 transition-opacity"
                  >
                    <FolderTree className="w-3 h-3 text-fg-3 shrink-0 ml-0.5" />
                  </span>
                ) : undefined
              }
              actions={
                hasActiveSampleSelection && !isDraggingInApp ? (
                  <button
                    type="button"
                    onClick={(e) =>
                      void handleQuickAddSelectedToCollection(
                        e,
                        child.id,
                        false
                      )
                    }
                    className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0"
                    title="Add selected track(s) to subfolder"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                ) : undefined
              }
            />
          );
        })}
    </div>
  );
};
