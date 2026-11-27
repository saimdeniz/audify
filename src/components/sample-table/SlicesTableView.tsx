import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { SliceHistoryEntry } from "../../types";
import { beginDragOnMove, startNativeSampleDrag } from "../../utils/drag";
import { safeGetItem } from "../../utils/localStorageSafe";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import { getVisibleSortedSlices } from "../../utils/slicePreview";
import { WaveformDisplayConfig } from "../MiniWaveform";
import { SliceContextMenu, SliceContextMenuState } from "./SliceContextMenu";
import { SlicesTableEmptyState } from "./SlicesTableEmptyState";
import { SlicesTableHeader } from "./SlicesTableHeader";
import { SliceColWidths, SliceTableRow } from "./SliceTableRow";
import { FIXED_WAVEFORM_WIDTH } from "./tableLayout";

const SLICE_ROW_HEIGHT = 34;

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
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const sliceSortKey = useSampleStore((s) => s.sliceSortKey);
  const sliceSortDir = useSampleStore((s) => s.sliceSortDir);
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const selectedSliceIds = useSampleStore((s) => s.selectedSliceIds);
  const activeSliceId = useSampleStore((s) => s.activeSliceId);
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isPlaying = useSampleStore((s) => s.isPlaying);

  const isSliceTrashMode = trashFilterActive && trashViewTab === "slices";
  const isSliceFavMode = favoriteOnly && favoritesViewTab === "slices";

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
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);
  const suppressNextRowClickRef = useRef(false);

  useEffect(() => {
    return () => {
      activeResizeCleanupRef.current?.();
    };
  }, []);

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
      activeResizeCleanupRef.current?.();
      const startX = e.clientX;
      const startW = colWidths[colKey];
      const bounds = SLICE_COL_BOUNDS[colKey];
      let latestWidths = colWidths;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const nextW = Math.max(
          bounds.min,
          Math.min(bounds.max, Math.round(startW + delta))
        );
        setColWidths((prev) => {
          if (prev[colKey] === nextW) return prev;
          const updated = { ...prev, [colKey]: nextW };
          latestWidths = updated;
          return updated;
        });
      };

      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        activeResizeCleanupRef.current = null;
      };

      const onUp = () => {
        cleanup();
        safeSetItem(
          AUDIFY_STORAGE_KEYS.sliceColumnWidthsV1,
          JSON.stringify(latestWidths)
        );
      };

      activeResizeCleanupRef.current = cleanup;
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
        folderFilter,
        sliceHideMissing: isSliceTrashMode ? false : sliceHideMissing,
        sliceFavoriteOnly: isSliceTrashMode
          ? false
          : isSliceFavMode || sliceFavoriteOnly,
        slicePitchOnly: isSliceTrashMode || isSliceFavMode ? false : slicePitchOnly,
        sliceSortKey,
        sliceSortDir,
      }),
    [
      activeSourceList,
      isSliceTrashMode,
      isSliceFavMode,
      searchQuery,
      folderFilter,
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

  const prevActiveSliceIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeSliceId === prevActiveSliceIdRef.current) return;
    prevActiveSliceIdRef.current = activeSliceId;
    if (activeSliceId === null) return;
    const idx = visibleSlices.findIndex((s) => s.id === activeSliceId);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [activeSliceId, visibleSlices, rowVirtualizer]);

  useEffect(() => {
    const st = useSampleStore.getState();
    if (st.lastSelectedSliceIndex !== null) {
      st.setSliceSelection(st.selectedSliceIds, st.activeSliceId, null);
    }
  }, [
    isSliceTrashMode,
    isSliceFavMode,
    searchQuery,
    folderFilter,
    sliceHideMissing,
    sliceFavoriteOnly,
    slicePitchOnly,
    sliceSortKey,
    sliceSortDir,
  ]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, entry: SliceHistoryEntry, index: number) => {
      if (suppressNextRowClickRef.current) {
        suppressNextRowClickRef.current = false;
        e.stopPropagation();
        return;
      }
      const st = useSampleStore.getState();
      if (e.shiftKey && st.lastSelectedSliceIndex !== null && visibleSlices.length > 0) {
        const anchor = Math.max(
          0,
          Math.min(visibleSlices.length - 1, st.lastSelectedSliceIndex)
        );
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const rangeIds = visibleSlices.slice(start, end + 1).map((s) => s.id);
        const merged =
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...st.selectedSliceIds, ...rangeIds]))
            : rangeIds;
        st.setSliceSelection(merged, entry.id, anchor);
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

  const handleRowMouseDown = useCallback(
    (e: React.MouseEvent, entry: SliceHistoryEntry) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;

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
      const finalPaths = paths.length > 0 ? paths : [entry.slice_path];

      beginDragOnMove(e.clientX, e.clientY, () => {
        suppressNextRowClickRef.current = true;
        window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
        void startNativeSampleDrag(finalPaths).finally(() => {
          window.setTimeout(() => {
            suppressNextRowClickRef.current = false;
          }, 60);
        });
      });
    },
    []
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      {/* Scrollable Table Container */}
      <div
        ref={parentRef}
        tabIndex={0}
        role="grid"
        aria-label="Saved slices"
        aria-multiselectable="true"
        className="flex-1 overflow-auto relative outline-none"
      >
        <div
          style={{ minWidth: `${totalTableMinWidth}px`, width: "100%" }}
          className="min-h-full flex flex-col"
        >
          <SlicesTableHeader
            colWidths={colWidths}
            sliceSortKey={sliceSortKey}
            sliceSortDir={sliceSortDir}
            onCycleSort={cycleSliceSort}
            onStartColResize={startSliceColResize}
          />

          {/* Virtualized Rows or Empty State */}
          {visibleSlices.length === 0 ? (
            <SlicesTableEmptyState
              isSliceTrashMode={isSliceTrashMode}
              isSliceFavMode={isSliceFavMode}
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
                    onRowMouseDown={handleRowMouseDown}
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
