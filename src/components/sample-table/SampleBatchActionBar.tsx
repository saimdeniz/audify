import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  ExternalLink,
  FileCheck2,
  Hash,
  Inbox,
  Layers,
  Music,
  Pencil,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection, SampleItem } from "../../types";
import { beginDragOnMove } from "../../utils/drag";
import { CollectionIcon } from "../CollectionIcon";
import { QuickCollectionForm } from "./QuickCollectionForm";

interface SampleBatchActionBarProps {
  selectedSampleIds: number[];
  selectedSampleObjects: SampleItem[];
  rootCollections: Collection[];
  childrenByParentId: ReadonlyMap<number, Collection[]>;
  batchPopover: "collection" | "tag" | "genre" | null;
  setBatchPopover: React.Dispatch<
    React.SetStateAction<"collection" | "tag" | "genre" | null>
  >;
  onStartNativeDrag: (paths: string[], sourceSample?: SampleItem) => void;
  compact?: boolean;
}

export const SampleBatchActionBar: React.FC<SampleBatchActionBarProps> = ({
  selectedSampleIds,
  selectedSampleObjects,
  rootCollections,
  childrenByParentId,
  batchPopover,
  setBatchPopover,
  onStartNativeDrag,
  compact = false,
}) => {
  const tags = useSampleStore((s) => s.tags);
  const genres = useSampleStore((s) => s.genres);
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const autoRouteCollectionDrops = useSampleStore(
    (s) => s.autoRouteCollectionDrops
  );

  const toggleFavoritesBatch = useSampleStore((s) => s.toggleFavoritesBatch);
  const addSamplesToCollectionBatch = useSampleStore(
    (s) => s.addSamplesToCollectionBatch
  );
  const addAutoRoutedSamplesToCollection = useSampleStore(
    (s) => s.addAutoRoutedSamplesToCollection
  );
  const assignTagBatch = useSampleStore((s) => s.assignTagBatch);
  const assignGenreBatch = useSampleStore((s) => s.assignGenreBatch);
  const removeSamplesFromCollection = useSampleStore(
    (s) => s.removeSamplesFromCollection
  );
  const requestMoveSamplesToTrash = useSampleStore(
    (s) => s.requestMoveSamplesToTrash
  );
  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const openBatchRenameModal = useSampleStore((s) => s.openBatchRenameModal);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const clearMultiSelection = useSampleStore((s) => s.clearMultiSelection);

  const [collapsedMenuColIds, setCollapsedMenuColIds] = useState<
    Record<number, boolean>
  >({});
  const collectionBtnRef = useRef<HTMLButtonElement | null>(null);
  const tagBtnRef = useRef<HTMLButtonElement | null>(null);
  const genreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!batchPopover) {
      setPopoverPos(null);
      return;
    }
    const update = () => {
      const trigger =
        batchPopover === "collection"
          ? collectionBtnRef.current
          : batchPopover === "tag"
            ? tagBtnRef.current
            : genreBtnRef.current;
      const rect = trigger?.getBoundingClientRect();
      if (!rect) return;
      const width = batchPopover === "collection" ? 236 : 210;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8)
      );
      const top = Math.max(8, rect.top - 8);
      setPopoverPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [batchPopover]);

  const allSelectedAreFavorites = useMemo(
    () =>
      selectedSampleObjects.length > 0 &&
      selectedSampleObjects.every((s) => s.is_favorite),
    [selectedSampleObjects]
  );

  if (selectedSampleIds.length <= 1) return null;

  const btnSquareClass = compact ? "w-[26px] h-[26px]" : "w-[34px] h-[34px]";
  const btnDropdownClass = compact
    ? "h-[26px] px-1.5 gap-1 text-[11px]"
    : "h-[34px] px-2.5 gap-1.5 text-[12px]";
  const iconClass = compact ? "w-[13.5px] h-[13.5px]" : "w-[17px] h-[17px]";
  const chevClass = compact ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <div
      data-mica-overlay="true"
      onClick={(e) => e.stopPropagation()}
      style={{ zIndex: Z_INDEX.batchBar }}
      className={`absolute left-1/2 -translate-x-1/2 w-max max-w-[96%] bg-surface-2 border border-accent/85 rounded-md flex items-center shadow-2xl whitespace-nowrap ${
        compact
          ? "bottom-2.5 px-2 py-1 gap-1"
          : "bottom-5 px-3 py-1.5 gap-2"
      }`}
    >
      <span
        className={`rounded-sm bg-accent/15 border border-accent/35 font-mono tabular-nums font-bold text-accent-fg inline-flex items-center justify-center whitespace-nowrap shrink-0 ${
          compact
            ? "min-w-[24px] h-[26px] px-1.5 text-[11px]"
            : "min-w-[30px] h-[34px] px-2.5 text-[13px]"
        }`}
        title={`${selectedSampleIds.length} tracks selected`}
      >
        {selectedSampleIds.length}
      </span>

      <div
        className={`w-[1px] bg-line shrink-0 ${
          compact ? "h-[16px]" : "h-[22px]"
        }`}
      />

      <button
        type="button"
        onClick={() =>
          void toggleFavoritesBatch(selectedSampleIds, !allSelectedAreFavorites)
        }
        className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
        title={
          allSelectedAreFavorites
            ? "Unfavorite selected (F)"
            : "Favorite selected (F)"
        }
      >
        <Star
          className={`${iconClass} text-accent-fg ${
            allSelectedAreFavorites ? "fill-current" : ""
          }`}
        />
      </button>

      <div className="shrink-0">
        <button
          ref={collectionBtnRef}
          type="button"
          onClick={() =>
            setBatchPopover(batchPopover === "collection" ? null : "collection")
          }
          className={`${btnDropdownClass} bg-surface-3 hover:border-accent border text-fg font-mono inline-flex items-center rounded-sm shrink-0 transition-colors ${
            batchPopover === "collection"
              ? "border-accent text-accent-fg"
              : "border-line"
          }`}
          title="Add selected to Collection"
        >
          <Layers className={`${iconClass} text-accent-fg`} />
          <ChevronDown className={chevClass} />
        </button>
        {batchPopover === "collection" &&
          popoverPos &&
          createPortal(
            <div
              data-context-menu-portal="true"
              data-popover-portal="true"
              data-mica-overlay="true"
              onClick={(e) => e.stopPropagation()}
              style={{
                top: popoverPos.top,
                left: popoverPos.left,
                transform: "translateY(-100%)",
                zIndex: Z_INDEX.floatingMenu,
              }}
              className="fixed w-[236px] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md p-2 space-y-1.5 shadow-2xl"
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-fg-head px-1">
                ADD TO COLLECTION ({selectedSampleIds.length})
              </div>
              <div className="max-h-[160px] overflow-y-auto space-y-0.5 pr-0.5">
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
                            setBatchPopover(null);
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
                              setBatchPopover(null);
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
                className="pt-1 border-t border-line flex items-center space-x-1"
                inputClassName="flex-1 min-w-0 h-[24px] bg-surface-3 border border-line px-2 text-[11.5px] text-fg outline-none rounded-sm"
                submitClassName="w-[24px] h-[24px] bg-accent text-accent-on font-mono text-[11px] font-bold shrink-0 flex items-center justify-center rounded-sm"
                onCreated={async (collectionId) => {
                  await addSamplesToCollectionBatch(
                    collectionId,
                    selectedSampleIds
                  );
                  setBatchPopover(null);
                }}
              />
            </div>,
            document.body
          )}
      </div>

      <div className="shrink-0">
        <button
          ref={tagBtnRef}
          type="button"
          onClick={() => setBatchPopover(batchPopover === "tag" ? null : "tag")}
          className={`${btnDropdownClass} bg-surface-3 hover:border-accent border text-fg font-mono inline-flex items-center rounded-sm shrink-0 transition-colors ${
            batchPopover === "tag"
              ? "border-accent text-accent-fg"
              : "border-line"
          }`}
          title="Assign Tag to selected"
        >
          <Hash className={`${iconClass} text-accent-fg`} />
          <ChevronDown className={chevClass} />
        </button>
        {batchPopover === "tag" &&
          popoverPos &&
          createPortal(
            <div
              data-context-menu-portal="true"
              data-popover-portal="true"
              data-mica-overlay="true"
              onClick={(e) => e.stopPropagation()}
              style={{
                top: popoverPos.top,
                left: popoverPos.left,
                transform: "translateY(-100%)",
                zIndex: Z_INDEX.floatingMenu,
              }}
              className="fixed w-[210px] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md p-2 space-y-1.5 shadow-2xl"
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-fg-head px-1">
                ASSIGN TAG ({selectedSampleIds.length})
              </div>
              <div className="max-h-[175px] overflow-y-auto space-y-0.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={async () => {
                      await assignTagBatch(selectedSampleIds, t.id);
                      setBatchPopover(null);
                    }}
                    className="w-full text-left px-2 py-1 text-[11.5px] text-fg hover:bg-accent-soft hover:text-accent-fg flex items-center space-x-2 rounded-xs"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-[3px] inline-block shrink-0"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
      </div>

      <div className="shrink-0">
        <button
          ref={genreBtnRef}
          type="button"
          onClick={() =>
            setBatchPopover(batchPopover === "genre" ? null : "genre")
          }
          className={`${btnDropdownClass} bg-surface-3 hover:border-accent border text-fg font-mono inline-flex items-center rounded-sm shrink-0 transition-colors ${
            batchPopover === "genre"
              ? "border-accent text-accent-fg"
              : "border-line"
          }`}
          title="Assign Genre / Mood to selected"
        >
          <Music className={`${iconClass} text-accent-fg`} />
          <ChevronDown className={chevClass} />
        </button>
        {batchPopover === "genre" &&
          popoverPos &&
          createPortal(
            <div
              data-context-menu-portal="true"
              data-popover-portal="true"
              data-mica-overlay="true"
              onClick={(e) => e.stopPropagation()}
              style={{
                top: popoverPos.top,
                left: popoverPos.left,
                transform: "translateY(-100%)",
                zIndex: Z_INDEX.floatingMenu,
              }}
              className="fixed w-[210px] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md p-2 space-y-1.5 shadow-2xl"
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-fg-head">
                  ASSIGN GENRE ({selectedSampleIds.length})
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await assignGenreBatch(selectedSampleIds, "");
                    setBatchPopover(null);
                  }}
                  className="text-[10px] font-mono text-fg-3 hover:text-accent-fg"
                  title="Clear genre on selected"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-[175px] overflow-y-auto space-y-0.5">
                {genres.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={async () => {
                      await assignGenreBatch(selectedSampleIds, g.name);
                      setBatchPopover(null);
                    }}
                    className="w-full text-left px-2 py-1 text-[11.5px] text-fg hover:bg-accent-soft hover:text-accent-fg flex items-center space-x-2 rounded-xs"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-[3px] inline-block shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
      </div>

      {trashFilterActive ? (
        <button
          type="button"
          onClick={() => void restoreSamplesFromTrash(selectedSampleIds)}
          className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg hover:text-accent-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
          title="Restore selected from Trash"
        >
          <ArchiveRestore className={`${iconClass} text-accent-fg`} />
        </button>
      ) : selectedCollectionId !== null ? (
        <button
          type="button"
          onClick={() =>
            void removeSamplesFromCollection(
              selectedCollectionId,
              selectedSampleIds
            )
          }
          className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg hover:text-accent-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
          title="Remove from collection (Del)"
        >
          <Trash2 className={`${iconClass} text-accent-fg`} />
        </button>
      ) : (
        enableAdvancedFileOps && (
          <button
            type="button"
            onClick={() => void requestMoveSamplesToTrash(selectedSampleIds)}
            className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg hover:text-accent-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
            title="Move selected to Trash (Del)"
          >
            <Trash2 className={`${iconClass} text-accent-fg`} />
          </button>
        )
      )}

      {enableAdvancedFileOps && !trashFilterActive && (
        <button
          type="button"
          onClick={() => openBatchRenameModal(selectedSampleIds)}
          className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg hover:text-accent-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
          title={`Batch rename ${selectedSampleIds.length} selected files`}
        >
          <Pencil className={`${iconClass} text-accent-fg`} />
        </button>
      )}

      <button
        type="button"
        onClick={() => addSamplesToBin(selectedSampleIds)}
        className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg inline-flex items-center justify-center rounded-sm shrink-0 active:scale-[0.97] transition-all`}
        title="Add selected to Session Bin (B)"
      >
        <Inbox className={`${iconClass} text-accent-fg`} />
      </button>

      {enableLicensesSystem && (
        <button
          type="button"
          onClick={() => copyAttributionForSamples(selectedSampleObjects)}
          className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg hover:text-accent-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
          title="Copy credits (Ctrl+Shift+C)"
        >
          <FileCheck2 className={`${iconClass} text-accent-fg`} />
        </button>
      )}

      <button
        type="button"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const paths = selectedSampleObjects.map((s) => s.file_path);
          if (paths.length > 0) {
            beginDragOnMove(e.clientX, e.clientY, () =>
              onStartNativeDrag(paths, selectedSampleObjects[0])
            );
          }
        }}
        className={`${
          compact
            ? "h-[26px] px-2 text-[11px] gap-1"
            : "h-[34px] px-3.5 text-[13px] gap-1.5"
        } bg-accent hover:bg-accent-hover text-accent-on font-mono font-bold inline-flex items-center rounded-sm cursor-grab whitespace-nowrap shrink-0 shadow-sm`}
        title="Drag selected to NLE / DAW"
      >
        <ExternalLink
          className={compact ? "w-[13px] h-[13px]" : "w-[16px] h-[16px]"}
        />
        <span>{selectedSampleIds.length}</span>
      </button>

      <button
        type="button"
        onClick={clearMultiSelection}
        className={`${btnSquareClass} text-fg-2 hover:text-fg hover:bg-surface-3 rounded-sm inline-flex items-center justify-center shrink-0 transition-colors`}
        title="Clear selection (Esc)"
      >
        <X className={iconClass} />
      </button>
    </div>
  );
};
