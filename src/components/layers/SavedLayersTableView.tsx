import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Layers, Plus, Trash2 } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerHistoryEntry } from "../../types";
import { beginDragOnMove, startNativeSampleDrag } from "../../utils/drag";
import { getVisibleSortedLayers } from "../../utils/layerHelpers";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import type { WaveformDisplayConfig } from "../MiniWaveform";
import { FIXED_WAVEFORM_WIDTH } from "../sample-table/tableLayout";
import {
  LayerContextMenuState,
  SavedLayerContextMenu,
} from "./SavedLayerContextMenu";
import {
  LAYER_COL_BOUNDS,
  loadLayerColWidths,
  SavedLayersTableHeader,
} from "./SavedLayersTableHeader";
import { LayerColWidths, SavedLayersTableRow } from "./SavedLayersTableRow";

/**
 * Saved Layers table rendered in `Tools -> Layers`, `Favorites -> Layers`, and `Trash -> Layers`.
 * Mirrors `SlicesTableView` & `SampleTable` 1:1 (`h-[26px]` sticky frosted header with vertical
 * column dividers & resizable columns, `h-[32px]` zebra rows, `FIXED_WAVEFORM_WIDTH`, no extra top bar).
 */
export const SavedLayersTableView: React.FC<{
  mode: "saved" | "favorites" | "trash";
}> = ({ mode }) => {
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const trashedLayerHistory = useSampleStore((s) => s.trashedLayerHistory);
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const layerHideMissing = useSampleStore((s) => s.layerHideMissing);
  const layerSortKey = useSampleStore((s) => s.layerSortKey);
  const layerSortDir = useSampleStore((s) => s.layerSortDir);
  const selectedLayerIds = useSampleStore((s) => s.selectedLayerIds);
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const accentColor = useSampleStore((s) => s.accentColor);
  const themeMode = useSampleStore((s) => s.themeMode);
  const enableMica = useSampleStore((s) => s.enableMica);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const waveformSensitivity = useSampleStore((s) => s.waveformSensitivity);
  const waveformStyle = useSampleStore((s) => s.waveformStyle);

  const fetchLayerHistory = useSampleStore((s) => s.fetchLayerHistory);
  const fetchTrashedLayers = useSampleStore((s) => s.fetchTrashedLayers);
  const cycleLayerSort = useSampleStore((s) => s.cycleLayerSort);
  const setLayerSelection = useSampleStore((s) => s.setLayerSelection);
  const selectLayerForPreview = useSampleStore((s) => s.selectLayerForPreview);
  const toggleLayerFavorite = useSampleStore((s) => s.toggleLayerFavorite);
  const toggleLayerFavoritesBatch = useSampleStore(
    (s) => s.toggleLayerFavoritesBatch
  );
  const openSavedLayerInEditor = useSampleStore((s) => s.openSavedLayerInEditor);
  const openBatchRenameLayersModal = useSampleStore(
    (s) => s.openBatchRenameLayersModal
  );
  const trashLayerFiles = useSampleStore((s) => s.trashLayerFiles);
  const restoreTrashedLayers = useSampleStore((s) => s.restoreTrashedLayers);
  const emptyTrashedLayers = useSampleStore((s) => s.emptyTrashedLayers);
  const setLayersWorkspaceTab = useSampleStore((s) => s.setLayersWorkspaceTab);
  const showInFolder = useSampleStore((s) => s.showInFolder);

  const [colWidths, setColWidths] = useState<LayerColWidths>(() =>
    loadLayerColWidths()
  );
  const [contextMenu, setContextMenu] = useState<LayerContextMenuState | null>(
    null
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const lastSelectedIdxRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    lastSelectedIdxRef.current = null;
  }, [mode, searchQuery, layerSortKey, layerSortDir, layerHideMissing]);

  useEffect(() => {
    if (mode === "trash") {
      void fetchTrashedLayers();
    } else if (useSampleStore.getState().layerHistory.length === 0) {
      void fetchLayerHistory();
    }
  }, [mode, fetchLayerHistory, fetchTrashedLayers]);

  const startColResize = useCallback(
    (colKey: keyof LayerColWidths, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeCleanupRef.current?.();
      const startX = e.clientX;
      const startW = colWidths[colKey];
      const bounds = LAYER_COL_BOUNDS[colKey];
      let latest = colWidths;

      const onMove = (ev: MouseEvent) => {
        const nextW = Math.max(
          bounds.min,
          Math.min(bounds.max, Math.round(startW + (ev.clientX - startX)))
        );
        setColWidths((prev) => {
          if (prev[colKey] === nextW) return prev;
          latest = { ...prev, [colKey]: nextW };
          return latest;
        });
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        resizeCleanupRef.current = null;
      };
      const onUp = () => {
        cleanup();
        safeSetItem(AUDIFY_STORAGE_KEYS.layerColumnWidthsV1, JSON.stringify(latest));
      };
      resizeCleanupRef.current = cleanup;
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [colWidths]
  );

  const waveformConfig = useMemo<WaveformDisplayConfig>(
    () => ({
      accentColor,
      themeMode,
      enableMica,
      waveformSensitivity,
      waveformStyle,
    }),
    [accentColor, themeMode, enableMica, waveformSensitivity, waveformStyle]
  );

  const sourceList = mode === "trash" ? trashedLayerHistory : layerHistory;
  const visibleLayers = useMemo(
    () =>
      getVisibleSortedLayers(sourceList, {
        searchQuery,
        favoriteOnly: mode === "favorites",
        hideMissing: mode === "saved" ? layerHideMissing : false,
        sortKey: layerSortKey,
        sortDir: layerSortDir,
      }),
    [sourceList, searchQuery, mode, layerHideMissing, layerSortKey, layerSortDir]
  );

  const selectedSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);
  const activeNormPath = selectedSample?.file_path
    ? normalizePathForMatch(selectedSample.file_path)
    : "";

  const rowVirtualizer = useVirtualizer({
    count: visibleLayers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 8,
    initialRect: { width: 900, height: 480 },
  });

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (visibleLayers.length > 0) {
          setLayerSelection(
            visibleLayers.map((l) => l.id),
            visibleLayers[0].id
          );
          lastSelectedIdxRef.current = 0;
        }
        return;
      }

      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        if (visibleLayers.length === 0) return;
        e.preventDefault();
        const curIdx =
          lastSelectedIdxRef.current ??
          visibleLayers.findIndex((l) => selectedSet.has(l.id));
        const nextIdx =
          e.key === "Home"
            ? 0
            : e.key === "End"
            ? visibleLayers.length - 1
            : e.key === "ArrowDown"
            ? curIdx < 0
              ? 0
              : Math.min(visibleLayers.length - 1, curIdx + 1)
            : curIdx <= 0
            ? 0
            : curIdx - 1;
        const target = visibleLayers[nextIdx];
        if (!target) return;
        lastSelectedIdxRef.current = nextIdx;
        setLayerSelection([target.id], target.id);
        rowVirtualizer.scrollToIndex(nextIdx, { align: "auto" });
        selectLayerForPreview(target, true);
        return;
      }

      if (e.key === " ") {
        if (visibleLayers.length === 0) return;
        e.preventDefault();
        const activeId = selectedLayerIds[0];
        const hit = visibleLayers.find((l) => l.id === activeId) ?? visibleLayers[0];
        if (!hit) return;
        const hitPath =
          hit.is_trashed && hit.trash_file_path ? hit.trash_file_path : hit.layer_path;
        if (activeNormPath && normalizePathForMatch(hitPath) === activeNormPath) {
          useSampleStore.getState().togglePlayPause();
        } else {
          setLayerSelection([hit.id], hit.id);
          selectLayerForPreview(hit, true);
        }
        return;
      }

      if (selectedLayerIds.length === 0) return;
      if (e.key === "F2" && mode !== "trash") {
        e.preventDefault();
        openBatchRenameLayersModal(selectedLayerIds);
      } else if (e.key === "Delete" && mode !== "trash" && enableAdvancedFileOps) {
        e.preventDefault();
        void trashLayerFiles(selectedLayerIds);
      } else if (
        e.key === "Enter" &&
        mode !== "trash" &&
        selectedLayerIds.length === 1
      ) {
        const hit = visibleLayers.find((l) => l.id === selectedLayerIds[0]);
        if (hit) {
          e.preventDefault();
          void openSavedLayerInEditor(hit);
        }
      }
    },
    [
      visibleLayers,
      selectedLayerIds,
      selectedSet,
      activeNormPath,
      mode,
      enableAdvancedFileOps,
      rowVirtualizer,
      setLayerSelection,
      selectLayerForPreview,
      openBatchRenameLayersModal,
      trashLayerFiles,
      openSavedLayerInEditor,
    ]
  );

  const handleRowMouseDown = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      entry: LayerHistoryEntry,
      isSelected: boolean
    ) => {
      if (e.button !== 0 || !entry.file_exists || mode === "trash") return;
      if ((e.target as HTMLElement).closest("button, input")) return;
      beginDragOnMove(e.clientX, e.clientY, () => {
        suppressClickRef.current = true;
        if (isSelected && selectedLayerIds.length > 1) {
          const dragPaths = visibleLayers
            .filter((item) => selectedSet.has(item.id) && item.file_exists)
            .map((item) => item.layer_path);
          if (dragPaths.length > 0) {
            void startNativeSampleDrag(dragPaths, `${dragPaths.length} layers`);
            return;
          }
        }
        void startNativeSampleDrag([entry.layer_path], entry.layer_name);
      });
    },
    [mode, selectedLayerIds.length, selectedSet, visibleLayers]
  );

  const handleRowClick = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      entry: LayerHistoryEntry,
      idx: number,
      isSelected: boolean,
      isCurrent: boolean
    ) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (e.shiftKey && lastSelectedIdxRef.current !== null) {
        const lo = Math.min(lastSelectedIdxRef.current, idx);
        const hi = Math.max(lastSelectedIdxRef.current, idx);
        const rangeIds = visibleLayers
          .slice(lo, hi + 1)
          .map((item) => item.id);
        const nextIds =
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...selectedLayerIds, ...rangeIds]))
            : rangeIds;
        setLayerSelection(nextIds, entry.id);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const next = isSelected
          ? selectedLayerIds.filter((id) => id !== entry.id)
          : [...selectedLayerIds, entry.id];
        lastSelectedIdxRef.current = idx;
        setLayerSelection(next, entry.id);
        return;
      }
      lastSelectedIdxRef.current = idx;
      setLayerSelection([entry.id], entry.id);
      if (isCurrent) {
        useSampleStore.getState().togglePlayPause();
      } else {
        selectLayerForPreview(entry, true);
      }
    },
    [selectedLayerIds, selectLayerForPreview, setLayerSelection, visibleLayers]
  );

  const handleRowDoubleClick = useCallback(
    (entry: LayerHistoryEntry) => {
      if (mode !== "trash") void openSavedLayerInEditor(entry);
    },
    [mode, openSavedLayerInEditor]
  );

  const handleRowContextMenu = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      entry: LayerHistoryEntry,
      isSelected: boolean
    ) => {
      e.preventDefault();
      setLayerSelection(
        isSelected ? selectedLayerIds : [entry.id],
        entry.id
      );
      setContextMenu({ entry, x: e.clientX, y: e.clientY });
    },
    [selectedLayerIds, setLayerSelection]
  );

  const handleToggleFavoriteRow = useCallback(
    (id: number) => {
      void toggleLayerFavorite(id);
    },
    [toggleLayerFavorite]
  );

  const handleOpenInEditorRow = useCallback(
    (entry: LayerHistoryEntry) => {
      void openSavedLayerInEditor(entry);
    },
    [openSavedLayerInEditor]
  );

  const totalMinWidth =
    34 + colWidths.name + FIXED_WAVEFORM_WIDTH + colWidths.structure + 78 + 84 + colWidths.updated;

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      <div
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-label="Saved layers"
        onKeyDown={handleGridKeyDown}
        className="flex-1 overflow-auto relative outline-none"
      >
        <div style={{ minWidth: `${totalMinWidth}px`, width: "100%" }} className="min-h-full flex flex-col">
          <SavedLayersTableHeader
            colWidths={colWidths}
            layerSortKey={layerSortKey}
            layerSortDir={layerSortDir}
            onCycleSort={cycleLayerSort}
            onStartColResize={startColResize}
          />

          {/* Rows or Unified Empty State (matching SlicesTableView & SampleTable 1:1) */}
          {visibleLayers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2 text-fg-3">
              <div className="w-10 h-10 rounded-md bg-surface-2 border border-line flex items-center justify-center text-accent-fg">
                {mode === "trash" ? (
                  <Trash2 className="w-5 h-5" />
                ) : (
                  <Layers className="w-5 h-5" />
                )}
              </div>
              <div className="text-[13px] font-medium text-fg">
                {mode === "trash"
                  ? searchQuery.trim()
                    ? "No trashed layers match your search"
                    : "No trashed layers"
                  : mode === "favorites"
                  ? searchQuery.trim()
                    ? "No favorite layers match your search"
                    : "No favorite layers yet"
                  : searchQuery.trim()
                  ? "No saved layers match your search"
                  : "No saved layers yet"}
              </div>
              <p className="text-[11.5px] text-fg-2 max-w-[380px]">
                {mode === "trash"
                  ? "Trashed layer mixes stay safely quarantined here until restored or emptied."
                  : mode === "favorites"
                  ? "Star your favorite multi-track layer mixes to find them instantly here."
                  : "Layer multiple SFX samples on a timeline, add fades/pitch/reverse, and export studio-ready WAVs."}
              </p>
              {searchQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => useSampleStore.getState().setSearchQuery("")}
                  className="mt-1 px-2.5 h-[24px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
                >
                  Clear Search
                </button>
              ) : (
                mode === "saved" && (
                  <button
                    type="button"
                    onClick={() => setLayersWorkspaceTab("editor")}
                    className="mt-1 h-[24px] px-3 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Open Timeline Editor</span>
                  </button>
                )
              )}
            </div>
          ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
            className="flex-1"
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const idx = vRow.index;
              const entry = visibleLayers[idx];
              if (!entry) return null;
              const activePath =
                entry.is_trashed && entry.trash_file_path
                  ? entry.trash_file_path
                  : entry.layer_path;
              const isCurrent =
                Boolean(activeNormPath) &&
                normalizePathForMatch(activePath) === activeNormPath;
              const isSelected = selectedSet.has(entry.id);

              return (
                <SavedLayersTableRow
                  key={entry.id}
                  entry={entry}
                  idx={idx}
                  topPx={vRow.start}
                  heightPx={vRow.size}
                  mode={mode}
                  isSelected={isSelected}
                  isCurrent={isCurrent}
                  isPlaying={isPlaying}
                  colWidths={colWidths}
                  waveformConfig={waveformConfig}
                  onMouseDownRow={handleRowMouseDown}
                  onClickRow={handleRowClick}
                  onDoubleClickRow={handleRowDoubleClick}
                  onContextMenuRow={handleRowContextMenu}
                  onToggleFavorite={handleToggleFavoriteRow}
                  onOpenInEditor={handleOpenInEditorRow}
                />
              );
            })}
          </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <SavedLayerContextMenu
          menu={contextMenu}
          mode={mode}
          allEntries={visibleLayers}
          selectedLayerIds={selectedLayerIds}
          selectedSet={selectedSet}
          onClose={() => setContextMenu(null)}
          onPreviewLayer={(e) => selectLayerForPreview(e, true)}
          onEditInLayers={(e) => void openSavedLayerInEditor(e)}
          onToggleFavorite={(id) => void toggleLayerFavorite(id)}
          onToggleFavoritesBatch={(ids, fav) =>
            void toggleLayerFavoritesBatch(ids, fav)
          }
          onOpenRenameModal={(ids) => openBatchRenameLayersModal(ids)}
          onRevealInExplorer={(p) => void showInFolder(p)}
          onTrashLayers={(ids) => void trashLayerFiles(ids)}
          onRestoreLayers={(ids) => void restoreTrashedLayers(ids)}
          onEmptyLayers={(ids) => void emptyTrashedLayers(ids)}
        />
      )}
    </div>
  );
};
