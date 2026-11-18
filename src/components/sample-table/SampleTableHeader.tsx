import React, { useRef, useState } from "react";
import { Star } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { useSampleStore } from "../../store/useSampleStore";
import { safeSetItem } from "../../store/storageHelpers";
import { SortKey } from "../../types";
import { ColumnSortLabel } from "./ColumnSortLabel";
import { HeaderColumnPicker } from "./HeaderColumnPicker";
import {
  COL_WIDTH_BOUNDS,
  ColumnId,
  FIXED_BPM_COL_WIDTH,
  FIXED_CLASS_COL_WIDTH,
  FIXED_FAV_COL_WIDTH,
  FIXED_FORMAT_COL_WIDTH,
  FIXED_KEY_COL_WIDTH,
  FIXED_MATCH_COL_WIDTH,
  FIXED_TIME_COL_WIDTH,
  FIXED_WAVEFORM_WIDTH,
  ResizableColKey,
  VisibleColumnsState,
} from "./tableLayout";

const SortHeader: React.FC<{
  label: string;
  sortId: SortKey;
  className?: string;
}> = ({ label, sortId, className = "" }) => {
  const sortKey = useSampleStore((s) => s.sortKey);
  const sortDir = useSampleStore((s) => s.sortDir);
  const cycleSort = useSampleStore((s) => s.cycleSort);
  const active = sortKey === sortId;
  return (
    <button
      type="button"
      onClick={() => cycleSort(sortId)}
      className={`group/hdr flex items-center justify-center tracking-wider uppercase font-semibold transition-colors active:scale-[0.98] ${
        active ? "text-accent-fg" : "text-fg-head hover:text-fg"
      } ${className}`}
    >
      <ColumnSortLabel label={label} active={active} sortDir={sortDir} />
    </button>
  );
};

interface SampleTableHeaderProps {
  headerRef: React.RefObject<HTMLDivElement>;
  columnsContentWidth: number;
  scrollbarGutterWidth?: number;
  isSimilarityMode?: boolean;
  columnOrder: ColumnId[];
  setColumnOrder: React.Dispatch<React.SetStateAction<ColumnId[]>>;
  visibleCols: VisibleColumnsState;
  toggleVisibleCol: (key: keyof VisibleColumnsState) => void;
  colWidths: Record<ResizableColKey, number>;
  setColWidths: React.Dispatch<
    React.SetStateAction<Record<ResizableColKey, number>>
  >;
  resetTableLayout: () => void;
  showColumnPicker: boolean;
  setShowColumnPicker: React.Dispatch<React.SetStateAction<boolean>>;
}

export const SampleTableHeader: React.FC<SampleTableHeaderProps> = ({
  headerRef,
  columnsContentWidth,
  scrollbarGutterWidth = 0,
  isSimilarityMode = false,
  columnOrder,
  setColumnOrder,
  visibleCols,
  toggleVisibleCol,
  colWidths,
  setColWidths,
  resetTableLayout,
  showColumnPicker,
  setShowColumnPicker,
}) => {
  const [draggedColId, setDraggedColId] = useState<ColumnId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    colId: ColumnId;
    side: "left" | "right";
  } | null>(null);
  const dropTargetRef = useRef<{
    colId: ColumnId;
    side: "left" | "right";
  } | null>(null);
  const suppressNextSortClickRef = useRef(false);

  const startColResize = (colKey: ResizableColKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { min: minW, max: maxW } = COL_WIDTH_BOUNDS[colKey];
    const startX = e.clientX;
    const startW = colWidths[colKey];

    const onMove = (moveEvt: MouseEvent) => {
      const delta = moveEvt.clientX - startX;
      const nextW = Math.max(minW, Math.min(maxW, Math.round(startW + delta)));
      setColWidths((prev) => {
        const updated = { ...prev, [colKey]: nextW };
        safeSetItem(AUDIFY_STORAGE_KEYS.columnWidthsV3, JSON.stringify(updated), {
          broadcast: false,
          markEdited: false,
        });
        return updated;
      });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startColHeaderReorderDrag = (colId: ColumnId, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-col-resize]")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let activeDrag = false;

    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggedColId(null);
      setDropTarget(null);
      dropTargetRef.current = null;
      document.body.style.cursor = "";
    };

    const onMove = (moveEvt: MouseEvent) => {
      if ((moveEvt.buttons & 1) !== 1) {
        cleanup();
        return;
      }
      if (
        !activeDrag &&
        Math.hypot(moveEvt.clientX - startX, moveEvt.clientY - startY) >= 6
      ) {
        activeDrag = true;
        suppressNextSortClickRef.current = true;
        setDraggedColId(colId);
        document.body.style.cursor = "grabbing";
      }
      if (activeDrag) {
        const el = document.elementFromPoint(
          moveEvt.clientX,
          moveEvt.clientY
        ) as HTMLElement | null;
        const headerCell = el?.closest(
          "[data-col-header-id]"
        ) as HTMLElement | null;
        const targetColId = headerCell?.getAttribute(
          "data-col-header-id"
        ) as ColumnId | null;
        if (targetColId && targetColId !== colId) {
          const rect = headerCell!.getBoundingClientRect();
          const side =
            moveEvt.clientX < rect.left + rect.width / 2 ? "left" : "right";
          dropTargetRef.current = { colId: targetColId, side };
          setDropTarget({ colId: targetColId, side });
        } else {
          dropTargetRef.current = null;
          setDropTarget(null);
        }
      }
    };

    const onUp = () => {
      const targetDrop = dropTargetRef.current;
      cleanup();
      if (activeDrag && targetDrop && targetDrop.colId !== colId) {
        setColumnOrder((prev) => {
          const fromIdx = prev.indexOf(colId);
          if (fromIdx === -1) return prev;
          const withoutDragged = prev.filter((c) => c !== colId);
          const targetIdx = withoutDragged.indexOf(targetDrop.colId);
          if (targetIdx === -1) return prev;
          const insertIdx =
            targetDrop.side === "left" ? targetIdx : targetIdx + 1;
          const next = [...withoutDragged];
          next.splice(insertIdx, 0, colId);
          safeSetItem(AUDIFY_STORAGE_KEYS.columnOrderV2, JSON.stringify(next), {
            broadcast: false,
            markEdited: false,
          });
          return next;
        });
      }
      setTimeout(() => {
        suppressNextSortClickRef.current = false;
      }, 40);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onClickCapture={(e) => {
        if (suppressNextSortClickRef.current) {
          e.stopPropagation();
          e.preventDefault();
          suppressNextSortClickRef.current = false;
        }
      }}
      className="h-[26px] bg-surface-header audify-frosted-bar border-b border-line flex items-center text-[10px] font-semibold uppercase tracking-wider text-fg-head shrink-0 select-none relative z-20"
    >
      <div
        ref={headerRef}
        className="flex-1 h-full overflow-hidden flex items-center"
      >
        <div
          style={{
            minWidth: `${columnsContentWidth + scrollbarGutterWidth}px`,
            width: "100%",
          }}
          className="h-full flex items-center border-l-2 border-l-transparent"
        >
          <div
            style={{ width: `${FIXED_FAV_COL_WIDTH}px` }}
            className="h-full flex items-center justify-center shrink-0 border-r border-line"
          >
            <Star className="w-3.5 h-3.5" />
          </div>

          {isSimilarityMode && (
            <div
              style={{ width: `${FIXED_MATCH_COL_WIDTH}px` }}
              className="group/hdr h-full px-0.5 flex items-center justify-center border-r border-line bg-accent-soft shrink-0 select-none"
              title="Acoustic Cosine Similarity Match Score"
            >
              <div className="h-[22px] w-full flex items-center justify-center px-1">
                <SortHeader label="MATCH" sortId="match" className="w-full" />
              </div>
            </div>
          )}

          {columnOrder.map((colId) => {
            const isBeingDragged = draggedColId === colId;
            const isDropLeft =
              dropTarget?.colId === colId && dropTarget.side === "left";
            const isDropRight =
              dropTarget?.colId === colId && dropTarget.side === "right";
            const dropIndicatorClass = isDropLeft
              ? "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-accent before:z-20 bg-accent/10"
              : isDropRight
              ? "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-accent after:z-20 bg-accent/10"
              : "";
            const pillStyleClass = isBeingDragged
              ? "bg-accent/20 border border-accent/40 text-accent-fg opacity-75 shadow-xs"
              : "hover:bg-surface-3 hover:text-fg text-fg-head active:bg-accent/20 active:text-accent-fg active:border-accent/40";

            switch (colId) {
              case "class":
                if (!visibleCols.class) return null;
                return (
                  <div
                    key="class"
                    data-col-header-id="class"
                    onMouseDown={(e) => startColHeaderReorderDrag("class", e)}
                    style={{ width: `${FIXED_CLASS_COL_WIDTH}px` }}
                    className={`group/hdr h-full px-0.5 flex items-center justify-center border-r border-line relative shrink-0 cursor-grab active:cursor-grabbing select-none ${dropIndicatorClass}`}
                    title="Class"
                  >
                    <div
                      className={`h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1 transition-colors border border-transparent ${pillStyleClass}`}
                    >
                      <SortHeader
                        label="CLASS"
                        sortId="class"
                        className="w-full justify-center text-center min-w-0"
                      />
                    </div>
                  </div>
                );

              case "name":
                return (
                  <div
                    key="name"
                    data-col-header-id="name"
                    onMouseDown={(e) => startColHeaderReorderDrag("name", e)}
                    style={{ width: `${colWidths.name}px` }}
                    className={`group/hdr h-full px-1 flex items-center justify-center relative shrink-0 border-r border-line cursor-grab active:cursor-grabbing select-none ${dropIndicatorClass}`}
                    title="File Name"
                  >
                    <div
                      className={`h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 transition-colors border border-transparent ${pillStyleClass}`}
                    >
                      <SortHeader
                        label="FILE NAME"
                        sortId="name"
                        className="w-full justify-center text-center truncate min-w-0"
                      />
                    </div>
                    <div
                      data-col-resize="true"
                      onMouseDown={(e) => startColResize("name", e)}
                      className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
                      title="Resize"
                    />
                  </div>
                );

              case "waveform":
                return (
                  <div
                    key="waveform"
                    data-col-header-id="waveform"
                    onMouseDown={(e) =>
                      startColHeaderReorderDrag("waveform", e)
                    }
                    style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
                    className={`h-full px-1 flex items-center justify-center relative border-r border-line shrink-0 cursor-grab active:cursor-grabbing select-none ${dropIndicatorClass}`}
                    title="Waveform"
                  >
                    <div
                      className={`h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 transition-colors border border-transparent ${pillStyleClass}`}
                    >
                      <span className="truncate">WAVEFORM</span>
                    </div>
                  </div>
                );

              case "artist":
              case "album":
              case "year":
              case "genre":
              case "tags":
              case "dateModified":
              case "dateAdded": {
                if (!visibleCols[colId]) return null;
                const resizableMeta: {
                  title: string;
                  label: string;
                  sortId?: SortKey;
                  compact?: boolean;
                } = {
                  artist: { title: "Artist", label: "ARTIST", sortId: "artist" as const },
                  album: { title: "Album", label: "ALBUM", sortId: "album" as const },
                  year: {
                    title: "Year",
                    label: "YEAR",
                    sortId: "year" as const,
                  },
                  genre: { title: "Genre", label: "GENRE", sortId: "genre" as const },
                  tags: { title: "Tags", label: "TAGS" },
                  dateModified: {
                    title: "Date Modified (Disk)",
                    label: "MODIFIED",
                    sortId: "dateModified" as const,
                  },
                  dateAdded: {
                    title: "Date Added to Library",
                    label: "ADDED",
                    sortId: "dateAdded" as const,
                  },
                }[colId];
                const isNarrowResizable = colId === "year";
                return (
                  <div
                    key={colId}
                    data-col-header-id={colId}
                    onMouseDown={(e) => startColHeaderReorderDrag(colId, e)}
                    style={{ width: `${colWidths[colId]}px` }}
                    className={`${
                      resizableMeta.sortId ? "group/hdr " : ""
                    }h-full ${
                      isNarrowResizable ? "px-0.5" : "px-1"
                    } flex items-center justify-center relative shrink-0 border-r border-line cursor-grab active:cursor-grabbing select-none ${dropIndicatorClass}`}
                    title={resizableMeta.title}
                  >
                    <div
                      className={`h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] ${
                        isNarrowResizable ? "px-1" : "px-1.5"
                      } transition-colors border border-transparent ${pillStyleClass}`}
                    >
                      {resizableMeta.sortId ? (
                        <SortHeader
                          label={resizableMeta.label}
                          sortId={resizableMeta.sortId}
                          className="w-full justify-center text-center truncate min-w-0"
                        />
                      ) : (
                        <span className="truncate">{resizableMeta.label}</span>
                      )}
                    </div>
                    <div
                      data-col-resize="true"
                      onMouseDown={(e) => startColResize(colId, e)}
                      className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
                      title="Resize"
                    />
                  </div>
                );
              }

              case "bpm":
              case "key":
              case "time":
              case "format": {
                if (!visibleCols[colId]) return null;
                const fixedMeta = {
                  bpm: {
                    width: `${FIXED_BPM_COL_WIDTH}px`,
                    title: "Tempo (BPM)",
                    label: "BPM",
                    sortId: "bpm" as const,
                    outerPx: "px-0.5",
                    innerPx: "px-1",
                  },
                  key: {
                    width: `${FIXED_KEY_COL_WIDTH}px`,
                    title: "Musical Key / Camelot",
                    label: "KEY",
                    sortId: "key" as const,
                    outerPx: "px-0.5",
                    innerPx: "px-1",
                  },
                  time: {
                    width: `${FIXED_TIME_COL_WIDTH}px`,
                    title: "Time",
                    label: "TIME",
                    sortId: "duration" as const,
                    outerPx: "px-1",
                    innerPx: "px-1",
                  },
                  format: {
                    width: `${FIXED_FORMAT_COL_WIDTH}px`,
                    title: "Format / SR",
                    label: "FMT/SR",
                    sortId: "sample_rate" as const,
                    outerPx: "px-0.5",
                    innerPx: "px-1",
                  },
                }[colId];
                return (
                  <div
                    key={colId}
                    data-col-header-id={colId}
                    onMouseDown={(e) => startColHeaderReorderDrag(colId, e)}
                    style={{ width: fixedMeta.width }}
                    className={`group/hdr h-full ${fixedMeta.outerPx} flex items-center justify-center relative shrink-0 border-r border-line cursor-grab active:cursor-grabbing select-none ${dropIndicatorClass}`}
                    title={fixedMeta.title}
                  >
                    <div
                      className={`h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] ${fixedMeta.innerPx} transition-colors border border-transparent ${pillStyleClass}`}
                    >
                      <SortHeader
                        label={fixedMeta.label}
                        sortId={fixedMeta.sortId}
                        className="w-full justify-center text-center truncate min-w-0"
                      />
                    </div>
                  </div>
                );
              }

              default:
                return null;
            }
          })}
          {scrollbarGutterWidth > 0 && (
            <div
              style={{ width: `${scrollbarGutterWidth}px` }}
              className="shrink-0"
            />
          )}
        </div>
      </div>

      {/* COLUMN VISIBILITY & LAYOUT RESET PICKER BUTTON (Pinned 28px top-right) */}
      <HeaderColumnPicker
        showColumnPicker={showColumnPicker}
        setShowColumnPicker={setShowColumnPicker}
        visibleCols={visibleCols}
        toggleVisibleCol={toggleVisibleCol}
        resetTableLayout={resetTableLayout}
      />
    </div>
  );
};
