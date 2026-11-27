import React, {
  Suspense,
  lazy,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  Hash,
  Inbox,
  Layers,
  LayoutGrid,
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
import type { BatchPopoverCoords } from "./SampleBatchPopovers";

const LazySampleBatchPopovers = lazy(() =>
  import("./SampleBatchPopovers").then((m) => ({
    default: m.SampleBatchPopovers,
  }))
);

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
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const isSmartCollectionActive = useSampleStore((s) =>
    s.selectedCollectionId !== null
      ? Boolean(
          s.collections
            .find((c) => c.id === s.selectedCollectionId)
            ?.smart_query?.trim()
        )
      : false
  );
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);

  const toggleFavoritesBatch = useSampleStore((s) => s.toggleFavoritesBatch);
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
  const sendSamplesToLayers = useSampleStore((s) => s.sendSamplesToLayers);
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const clearMultiSelection = useSampleStore((s) => s.clearMultiSelection);

  const collectionBtnRef = useRef<HTMLButtonElement | null>(null);
  const tagBtnRef = useRef<HTMLButtonElement | null>(null);
  const genreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<BatchPopoverCoords | null>(null);

  useLayoutEffect(() => {
    if (!batchPopover) {
      setPopoverPos(null);
      return;
    }
    const getTrigger = () =>
      batchPopover === "collection"
        ? collectionBtnRef.current
        : batchPopover === "tag"
          ? tagBtnRef.current
          : genreBtnRef.current;
    const update = () => {
      const rect = getTrigger()?.getBoundingClientRect();
      if (!rect) return;
      const width = batchPopover === "collection" ? 236 : 210;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8)
      );
      const bottom = Math.max(8, window.innerHeight - rect.top + 8);
      const maxHeight = Math.max(96, Math.min(260, rect.top - 16));
      setPopoverPos((prev) =>
        prev &&
        prev.bottom === bottom &&
        prev.left === left &&
        prev.maxHeight === maxHeight
          ? prev
          : { bottom, left, maxHeight }
      );
    };
    const onScroll = (ev: Event) => {
      const trigger = getTrigger();
      if (!trigger) return;
      const target = ev.target;
      if (
        target === window ||
        target === document ||
        (target instanceof Node && target.contains(trigger))
      ) {
        update();
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [batchPopover]);

  const handleClosePopover = useCallback(
    () => setBatchPopover(null),
    [setBatchPopover]
  );

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
          <LayoutGrid className={`${iconClass} text-accent-fg`} />
          <ChevronDown className={chevClass} />
        </button>
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
      </div>

      {batchPopover && popoverPos && (
        <Suspense fallback={null}>
          <LazySampleBatchPopovers
            batchPopover={batchPopover}
            popoverPos={popoverPos}
            selectedSampleIds={selectedSampleIds}
            selectedSampleObjects={selectedSampleObjects}
            rootCollections={rootCollections}
            childrenByParentId={childrenByParentId}
            onClose={handleClosePopover}
          />
        </Suspense>
      )}

      {trashFilterActive ? (
        <button
          type="button"
          onClick={() => void restoreSamplesFromTrash(selectedSampleIds)}
          className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg hover:text-accent-fg inline-flex items-center justify-center rounded-sm shrink-0 transition-colors`}
          title="Restore selected from Trash"
        >
          <ArchiveRestore className={`${iconClass} text-accent-fg`} />
        </button>
      ) : selectedCollectionId !== null && !isSmartCollectionActive ? (
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

      {!trashFilterActive && (
        <button
          type="button"
          onClick={() => void sendSamplesToLayers(selectedSampleObjects)}
          className={`${btnSquareClass} bg-surface-3 hover:border-accent border border-line text-fg inline-flex items-center justify-center rounded-sm shrink-0 active:scale-[0.97] transition-all`}
          title={`Send ${selectedSampleIds.length} tracks to Layers Editor`}
        >
          <Layers className={`${iconClass} text-accent-fg`} />
        </button>
      )}

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
