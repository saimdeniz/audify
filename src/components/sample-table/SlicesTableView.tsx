import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { SliceHistoryEntry } from "../../types";
import { startNativeSampleDrag } from "../../utils/drag";
import { safeGetItem } from "../../utils/localStorageSafe";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import { getVisibleSortedSlices } from "../../utils/slicePreview";
import { WaveformDisplayConfig } from "../MiniWaveform";
import { ColumnSortLabel } from "./ColumnSortLabel";
import { SliceContextMenu, SliceContextMenuState } from "./SliceContextMenu";
import { SlicesTableEmptyState } from "./SlicesTableEmptyState";
import { SliceColWidths, SliceTableRow } from "./SliceTableRow";
import { FIXED_WAVEFORM_WIDTH } from "./tableLayout";

const SLICE_ROW_HEIGHT = 32;

const DEFAULT_SLICE_COL_WIDTHS: SliceColWidths = {
  name: 240,
  source: 220,
  range: 148,
  dateAdded: 116,
};

const SLICE_COL_BOUNDS: Record<
  keyof SliceColWidths,
  { min: number; max: number }
> = {
  name: { min: 140, max: 600 },
  source: { min: 120, max: 520 },
  range: { min: 105, max: 280 },
  dateAdded: { min: 86, max: 220 },
};

function clampWidth(key: keyof SliceColWidths, val: unknown): number {
  const bounds = SLICE_COL_BOUNDS[key];
  const fallback = DEFAULT_SLICE_COL_WIDTHS[key];
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(val)));
}

function loadSliceColWidths(): SliceColWidths {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.sliceColumnWidthsV1);
    if (!raw) return { ...DEFAULT_SLICE_COL_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<SliceColWidths>;
    return {
      name: clampWidth("name", parsed.name),
      source: clampWidth("source", parsed.source),
      range: clampWidth("range", parsed.range),
      dateAdded: clampWidth("dateAdded", parsed.dateAdded),
    };
  } catch {
    return { ...DEFAULT_SLICE_COL_WIDTHS };
  }
}

export const SlicesTableView: React.FC = () => {
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const trashedSliceHistory = useSampleStore((s) => s.trashedSliceHistory);
  const isLoadingSliceHistory = useSampleStore((s) => s.isLoadingSliceHistory);
  const sliceHideMissing = useSampleStore((s) => s.sliceHideMissing);
  const sliceFavoriteOnly = useSampleStore((s) => s.sliceFavoriteOnly);
  const slicePitchOnly = useSampleStore((s) => s.slicePitchOnly);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const sliceSortKey = useSampleStore((s) => s.sliceSortKey);
  const sliceSortDir = useSampleStore((s) => s.sliceSortDir);
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const selectedSliceIds = useSampleStore((s) => s.selectedSliceIds);
  const activeSliceId = useSampleStore((s) => s.activeSliceId);
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isPlaying = useSampleStore((s) => s.isPlaying);

  const isSliceTrashMode = trashFilterActive && trashViewTab === "slices";

  const accentColor = useSampleStore((s) => s.accentColor);
  const themeMode = useSampleStore((s) => s.themeMode);
  const enableMica = useSampleStore((s) => s.enableMica);
  const waveformSensitivity = useSampleStore((s) => s.waveformSensitivity);
  const waveformStyle = useSampleStore((s) => s.waveformStyle);

  const fetchSliceHistory = useSampleStore((s) => s.fetchSliceHistory);
  const fetchTrashedSlices = useSampleStore((s) => s.fetchTrashedSlices);
  const cycleSliceSort = useSampleStore((s) => s.cycleSliceSort);

  const [colWidths, setColWidths] = useState<SliceColWidths>(() =>
    loadSliceColWidths()
  );
  const [contextMenu, setContextMenu] = useState<SliceContextMenuState | null>(
    null
  );
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isSliceTrashMode) {
      void fetchTrashedSlices();
    } else if (useSampleStore.getState().sliceHistory.length === 0) {
      void fetchSliceHistory();
    }
  }, [isSliceTrashMode, fetchSliceHistory, fetchTrashedSlices]);

  const startSliceColResize = useCallback(
    (colKey: keyof SliceColWidths, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = colWidths[colKey];
      const bounds = SLICE_COL_BOUNDS[colKey];

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const nextW = Math.max(
          bounds.min,
          Math.min(bounds.max, Math.round(startW + delta))
        );
        setColWidths((prev) => {
          const updated = { ...prev, [colKey]: nextW };
          safeSetItem(
            AUDIFY_STORAGE_KEYS.sliceColumnWidthsV1,
            JSON.stringify(updated)
          );
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
    },
    [colWidths]
  );

  const waveformDisplayConfig = useMemo<WaveformDisplayConfig>(
    () => ({
      accentColor,
      themeMode,
      enableMica,
      waveformSensitivity,
      waveformStyle,
    }),
    [
      accentColor,
      themeMode,
      enableMica,
      waveformSensitivity,
      waveformStyle,
    ]
  );

  const activeSourceList = isSliceTrashMode ? trashedSliceHistory : sliceHistory;

  const visibleSlices = useMemo(
    () =>
      getVisibleSortedSlices(activeSourceList, {
        searchQuery,
        sliceHideMissing: isSliceTrashMode ? false : sliceHideMissing,
        sliceFavoriteOnly: isSliceTrashMode ? false : sliceFavoriteOnly,
        slicePitchOnly: isSliceTrashMode ? false : slicePitchOnly,
        sliceSortKey,
        sliceSortDir,
      }),
    [
      activeSourceList,
      isSliceTrashMode,
      searchQuery,
      sliceHideMissing,
      sliceFavoriteOnly,
      slicePitchOnly,
      sliceSortKey,
      sliceSortDir,
    ]
  );

  const sliceByIdMap = useMemo(
    () => new Map(activeSourceList.map((s) => [s.id, s])),
    [activeSourceList]
  );

  const selectedSliceIdSet = useMemo(
    () => new Set(selectedSliceIds),
    [selectedSliceIds]
  );

  const activeSampleNormPath = useMemo(
    () =>
      selectedSample?.file_path
        ? normalizePathForMatch(selectedSample.file_path)
        : "",
    [selectedSample?.file_path]
  );

  const totalTableMinWidth =
    2 +
    34 +
    colWidths.name +
    FIXED_WAVEFORM_WIDTH +
    colWidths.source +
    colWidths.range +
    78 +
    84 +
    colWidths.dateAdded;

  const rowVirtualizer = useVirtualizer({
    count: visibleSlices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => SLICE_ROW_HEIGHT,
    overscan: 14,
  });

  useEffect(() => {
    if (activeSliceId === null) return;
    const idx = visibleSlices.findIndex((s) => s.id === activeSliceId);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [activeSliceId, visibleSlices, rowVirtualizer]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, entry: SliceHistoryEntry, index: number) => {
      const st = useSampleStore.getState();
      if (e.shiftKey && st.lastSelectedSliceIndex !== null) {
        const start = Math.min(st.lastSelectedSliceIndex, index);
        const end = Math.max(st.lastSelectedSliceIndex, index);
        const rangeIds = visibleSlices.slice(start, end + 1).map((s) => s.id);
        const merged = Array.from(new Set([...st.selectedSliceIds, ...rangeIds]));
        st.setSliceSelection(merged, entry.id, index);
        st.selectSliceForPreview(entry, false);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const exists = st.selectedSliceIds.includes(entry.id);
        const nextIds = exists
          ? st.selectedSliceIds.filter((id) => id !== entry.id)
          : [...st.selectedSliceIds, entry.id];
        st.setSliceSelection(
          nextIds,
          entry.id,
          exists ? st.lastSelectedSliceIndex : index
        );
        if (!exists) st.selectSliceForPreview(entry, false);
        return;
      }

      st.setSliceSelection([entry.id], entry.id, index);
      st.selectSliceForPreview(entry, st.autoPreview);
    },
    [visibleSlices]
  );

  const handleRowDoubleClick = useCallback((entry: SliceHistoryEntry) => {
    useSampleStore.getState().selectSliceForPreview(entry, true);
  }, []);

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, entry: SliceHistoryEntry, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      const st = useSampleStore.getState();
      let targetIds = st.selectedSliceIds;
      if (!targetIds.includes(entry.id)) {
        targetIds = [entry.id];
        st.setSliceSelection([entry.id], entry.id, index);
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        entry,
        targetIds,
      });
    },
    []
  );

  const handleRowDragStart = useCallback(
    (e: React.DragEvent, entry: SliceHistoryEntry) => {
      e.preventDefault();
      const st = useSampleStore.getState();
      const inTrash = st.trashFilterActive && st.trashViewTab === "slices";
      if (!entry.file_exists || entry.is_trashed || inTrash) return;
      const isPart = st.selectedSliceIds.includes(entry.id);
      const paths = isPart
        ? st.sliceHistory
            .filter(
              (s) => st.selectedSliceIds.includes(s.id) && s.file_exists
            )
            .map((s) => s.slice_path)
        : [entry.slice_path];
      void startNativeSampleDrag(
        paths.length > 0 ? paths : [entry.slice_path]
      );
    },
    []
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      {/* Scrollable Table Container */}
      <div
        ref={parentRef}
        tabIndex={0}
        role="listbox"
        aria-label="Saved slices"
        aria-multiselectable="true"
        className="flex-1 overflow-auto relative outline-none"
      >
        <div
          style={{ minWidth: `${totalTableMinWidth}px`, width: "100%" }}
          className="min-h-full flex flex-col"
        >
          {/* Sticky Column Header matching SampleTableHeader */}
          <div className="h-[26px] sticky top-0 z-20 bg-surface-header audify-frosted-bar border-b border-line border-l-2 border-l-transparent flex items-center text-[10px] font-semibold uppercase tracking-wider text-fg-head shrink-0 select-none">
            {/* 1. Fav (34px) */}
            <button
              type="button"
              onClick={() => cycleSliceSort("fav")}
              className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line hover:text-fg transition-colors cursor-pointer ${
                sliceSortKey === "fav" ? "text-accent-fg" : ""
              }`}
              title="Sort by Favorite Slices"
            >
              <Star className="w-3.5 h-3.5" />
            </button>

            {/* 2. Slice Name (Resizable) */}
            <div
              style={{ width: `${colWidths.name}px` }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.colResize) return;
                cycleSliceSort("name");
              }}
              className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
                sliceSortKey === "name" ? "text-accent-fg" : ""
              }`}
              title="Slice Name"
            >
              <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel
                  label="SLICE NAME"
                  active={sliceSortKey === "name"}
                  sortDir={sliceSortDir}
                />
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startSliceColResize("name", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
                title="Drag to resize Slice Name column"
              />
            </div>

            {/* 3. Waveform (Fixed 220px) */}
            <div
              style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
              className="h-full px-1 flex items-center justify-center shrink-0 border-r border-line"
              title="Waveform"
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5">
                WAVEFORM
              </div>
            </div>

            {/* 4. Source Track (Resizable) */}
            <div
              style={{ width: `${colWidths.source}px` }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.colResize) return;
                cycleSliceSort("source");
              }}
              className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
                sliceSortKey === "source" ? "text-accent-fg" : ""
              }`}
              title="Source Track (Click ↗ on row to jump back)"
            >
              <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel
                  label="SOURCE TRACK"
                  active={sliceSortKey === "source"}
                  sortDir={sliceSortDir}
                />
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startSliceColResize("source", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
                title="Drag to resize Source Track column"
              />
            </div>

            {/* 5. Range / FX (Resizable) */}
            <div
              style={{ width: `${colWidths.range}px` }}
              className="relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line"
              title="Slice Range & FX"
            >
              <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 min-w-0">
                <span className="truncate">RANGE / FX</span>
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startSliceColResize("range", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
                title="Drag to resize Range / FX column"
              />
            </div>

            {/* 6. Time (Fixed 78px) */}
            <div
              style={{ width: "78px" }}
              onClick={() => cycleSliceSort("duration")}
              className={`group/hdr h-full px-1 flex items-center justify-center shrink-0 border-r border-line cursor-pointer ${
                sliceSortKey === "duration" ? "text-accent-fg" : ""
              }`}
              title="Duration"
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel
                  label="TIME"
                  active={sliceSortKey === "duration"}
                  sortDir={sliceSortDir}
                />
              </div>
            </div>

            {/* 7. FMT/SR (Fixed 84px, Sortable) */}
            <div
              style={{ width: "84px" }}
              onClick={() => cycleSliceSort("format")}
              className={`group/hdr h-full px-1 flex items-center justify-center shrink-0 border-r border-line cursor-pointer ${
                sliceSortKey === "format" ? "text-accent-fg" : ""
              }`}
              title="Format / Sample Rate"
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-0.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel
                  label="FMT/SR"
                  active={sliceSortKey === "format"}
                  sortDir={sliceSortDir}
                />
              </div>
            </div>

            {/* 8. Added (Resizable, Sortable) */}
            <div
              style={{ width: `${colWidths.dateAdded}px` }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.colResize) return;
                cycleSliceSort("created");
              }}
              className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
                sliceSortKey === "created" ? "text-accent-fg" : ""
              }`}
              title="Created Date"
            >
              <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel
                  label="ADDED"
                  active={sliceSortKey === "created"}
                  sortDir={sliceSortDir}
                />
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startSliceColResize("dateAdded", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
                title="Drag to resize Added column"
              />
            </div>
          </div>

          {/* Virtualized Rows or Empty State */}
          {visibleSlices.length === 0 ? (
            <SlicesTableEmptyState
              isSliceTrashMode={isSliceTrashMode}
              isLoadingSliceHistory={isLoadingSliceHistory}
              searchQuery={searchQuery}
              sliceFavoriteOnly={sliceFavoriteOnly}
              slicePitchOnly={slicePitchOnly}
              sliceHideMissing={sliceHideMissing}
              trashedCount={trashedCount}
            />
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const entry = visibleSlices[virtualRow.index];
                if (!entry) return null;
                const isSelected = selectedSliceIdSet.has(entry.id);
                const rowMediaPath =
                  isSliceTrashMode && entry.trash_file_path
                    ? entry.trash_file_path
                    : entry.slice_path;
                const isRowPathActive =
                  activeSampleNormPath.length > 0 &&
                  normalizePathForMatch(rowMediaPath) === activeSampleNormPath;
                const isActiveRow =
                  activeSliceId === entry.id || isRowPathActive;
                const isPlayingRow = isRowPathActive && isPlaying;

                return (
                  <SliceTableRow
                    key={entry.id}
                    entry={entry}
                    index={virtualRow.index}
                    topPx={virtualRow.start}
                    heightPx={virtualRow.size}
                    isSelected={isSelected}
                    isActiveRow={isActiveRow}
                    isPlayingRow={isPlayingRow}
                    colWidths={colWidths}
                    waveformDisplayConfig={waveformDisplayConfig}
                    isTrashMode={isSliceTrashMode}
                    onRowClick={handleRowClick}
                    onRowDoubleClick={handleRowDoubleClick}
                    onRowContextMenu={handleRowContextMenu}
                    onRowDragStart={handleRowDragStart}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <SliceContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          sliceByIdMap={sliceByIdMap}
          isTrashMode={isSliceTrashMode}
        />
      )}
    </div>
  );
};
