import React, { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection, SampleItem } from "../../types";
import { CollectionIcon } from "../CollectionIcon";
import { TaxonomyPicker } from "../taxonomy/TaxonomyPicker";
import { QuickCollectionForm } from "./QuickCollectionForm";

export interface BatchPopoverCoords {
  bottom: number;
  left: number;
  maxHeight: number;
}

interface SampleBatchPopoversProps {
  batchPopover: "collection" | "tag" | "genre";
  popoverPos: BatchPopoverCoords;
  selectedSampleIds: number[];
  selectedSampleObjects: SampleItem[];
  rootCollections: Collection[];
  childrenByParentId: ReadonlyMap<number, Collection[]>;
  onClose: () => void;
}

export const SampleBatchPopovers: React.FC<SampleBatchPopoversProps> = ({
  batchPopover,
  popoverPos,
  selectedSampleIds,
  selectedSampleObjects,
  rootCollections,
  childrenByParentId,
  onClose,
}) => {
  const autoRouteCollectionDrops = useSampleStore(
    (s) => s.autoRouteCollectionDrops
  );
  const addSamplesToCollectionBatch = useSampleStore(
    (s) => s.addSamplesToCollectionBatch
  );
  const addAutoRoutedSamplesToCollection = useSampleStore(
    (s) => s.addAutoRoutedSamplesToCollection
  );

  const [collapsedMenuColIds, setCollapsedMenuColIds] = useState<
    Record<number, boolean>
  >({});

  const sharedStyle: React.CSSProperties = {
    bottom: popoverPos.bottom,
    left: popoverPos.left,
    maxHeight: popoverPos.maxHeight,
    zIndex: Z_INDEX.floatingMenu,
  };

  if (batchPopover === "collection") {
    return createPortal(
      <div
        data-context-menu-portal="true"
        data-popover-portal="true"
        data-mica-overlay="true"
        onClick={(e) => e.stopPropagation()}
        style={sharedStyle}
        className="fixed w-[236px] bg-surface-2 audify-overlay-surface border border-line-strong rounded-md p-2 flex flex-col gap-1.5 shadow-2xl overflow-hidden"
      >
        <div className="text-[10px] font-mono uppercase tracking-wider text-fg-head px-1 shrink-0">
          ADD TO COLLECTION ({selectedSampleIds.length})
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          {rootCollections
            .filter((c) => !c.smart_query?.trim())
            .map((rootCol) => {
              const children = childrenByParentId.get(rootCol.id) || [];
              const hasChildren = children.length > 0;
              const isCollapsed = Boolean(collapsedMenuColIds[rootCol.id]);

              return (
                <div key={rootCol.id} className="space-y-0.5">
                  <div className="flex items-center rounded-xs hover:bg-accent-soft group">
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
                        className="w-4 h-[26px] flex items-center justify-center text-fg-3 hover:text-fg shrink-0"
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
                      <div className="w-2 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (hasChildren && autoRouteCollectionDrops) {
                          await addAutoRoutedSamplesToCollection(
                            rootCol.id,
                            selectedSampleObjects
                          );
                        } else {
                          await addSamplesToCollectionBatch(
                            rootCol.id,
                            selectedSampleIds
                          );
                        }
                        onClose();
                      }}
                      className="flex-1 min-w-0 text-left px-1.5 py-1 text-[11.5px] text-fg hover:text-accent-fg flex items-center justify-between"
                      title={
                        hasChildren && autoRouteCollectionDrops
                          ? "Add to collection (auto-routes to subfolder by rules)"
                          : `Add to ${rootCol.name}`
                      }
                    >
                      <span className="flex items-center space-x-1.5 truncate">
                        <CollectionIcon
                          icon={rootCol.icon}
                          className="w-3.5 h-3.5 shrink-0 text-accent-fg"
                        />
                        <span className="truncate">{rootCol.name}</span>
                      </span>
                      <span className="flex items-center space-x-1 shrink-0 ml-1">
                        {hasChildren && autoRouteCollectionDrops && (
                          <span className="text-[8.5px] font-mono text-accent-fg px-1 bg-accent-soft rounded-xs border border-accent/20">
                            Auto
                          </span>
                        )}
                        <span className="font-mono text-[10.5px] text-fg-3">
                          {rootCol.sample_count}
                        </span>
                      </span>
                    </button>
                  </div>
                  {!isCollapsed &&
                    children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={async () => {
                          await addSamplesToCollectionBatch(
                            child.id,
                            selectedSampleIds
                          );
                          onClose();
                        }}
                        className="w-full text-left pl-5 pr-1.5 py-1 text-[11px] text-fg-2 hover:bg-accent-soft hover:text-accent-fg flex items-center justify-between"
                        title={`Add specifically to ${rootCol.name} > ${child.name}`}
                      >
                        <span className="flex items-center space-x-1.5 truncate">
                          <CornerDownRight className="w-2.5 h-2.5 text-fg-3 shrink-0" />
                          <span className="w-1.5 h-1.5 rounded-[2px] shrink-0 shadow-xs bg-accent" />
                          <span className="truncate">{child.name}</span>
                        </span>
                        <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-1">
                          {child.sample_count}
                        </span>
                      </button>
                    ))}
                </div>
              );
            })}
        </div>
        <QuickCollectionForm
          placeholder="New collection..."
          submitTitle="Create & Add Selected"
          className="pt-1 border-t border-line flex items-center space-x-1 shrink-0"
          inputClassName="flex-1 min-w-0 h-[24px] bg-surface-3 border border-line px-2 text-[11.5px] text-fg outline-none rounded-sm"
          submitClassName="w-[24px] h-[24px] bg-accent text-accent-on font-mono text-[11px] font-bold shrink-0 flex items-center justify-center rounded-sm"
          onCreated={async (collectionId) => {
            await addSamplesToCollectionBatch(collectionId, selectedSampleIds);
            onClose();
          }}
        />
      </div>,
      document.body
    );
  }

  if (batchPopover === "tag" || batchPopover === "genre") {
    const mode = batchPopover === "tag" ? "tags" : "genres";
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          mode === "tags" ? "Batch assign tags" : "Batch assign genres and moods"
        }
        data-context-menu-portal="true"
        data-popover-portal="true"
        data-mica-overlay="true"
        onClick={(e) => e.stopPropagation()}
        style={sharedStyle}
        className="fixed w-[264px] bg-surface-2 audify-overlay-surface border border-line-strong rounded-md p-2.5 shadow-2xl overflow-hidden"
      >
        <TaxonomyPicker
          mode={mode}
          sampleIds={selectedSampleIds}
          samples={selectedSampleObjects}
          title={
            mode === "tags"
              ? `ASSIGN TAGS (${selectedSampleIds.length})`
              : `GENRES & MOODS (${selectedSampleIds.length})`
          }
          onClose={onClose}
        />
      </div>,
      document.body
    );
  }
  return null;
};
