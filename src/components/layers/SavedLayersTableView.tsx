import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Layers,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { beginDragOnMove, startNativeSampleDrag } from "../../utils/drag";
import {
  formatDuration,
  formatSampleRateCompact,
  parseSqliteUtcMs,
  splitFileNameAndExt,
} from "../../utils/format";
import { getVisibleSortedLayers } from "../../utils/layerHelpers";
import { safeGetItem } from "../../utils/localStorageSafe";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import { MiniWaveform, WaveformDisplayConfig } from "../MiniWaveform";
import { ColumnSortLabel } from "../sample-table/ColumnSortLabel";
import { renderDateCell } from "../sample-table/SampleTableRowCells";
import { FIXED_WAVEFORM_WIDTH } from "../sample-table/tableLayout";
import {
  LayerContextMenuState,
  SavedLayerContextMenu,
} from "./SavedLayerContextMenu";

interface LayerColWidths {
  name: number;
  structure: number;
  updated: number;
}

const DEFAULT_LAYER_COL_WIDTHS: LayerColWidths = {
  name: 260,
  structure: 148,
  updated: 116,
};

const LAYER_COL_BOUNDS: Record<keyof LayerColWidths, { min: number; max: number }> = {
  name: { min: 150, max: 600 },
  structure: { min: 100, max: 280 },
  updated: { min: 86, max: 220 },
};

function loadLayerColWidths(): LayerColWidths {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.layerColumnWidthsV1);
    if (!raw) return { ...DEFAULT_LAYER_COL_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<LayerColWidths>;
    const clamp = (k: keyof LayerColWidths) => {
      const v = parsed[k];
      const b = LAYER_COL_BOUNDS[k];
      return typeof v === "number" && Number.isFinite(v)
        ? Math.max(b.min, Math.min(b.max, Math.round(v)))
        : DEFAULT_LAYER_COL_WIDTHS[k];
    };
    return {
      name: clamp("name"),
      structure: clamp("structure"),
      updated: clamp("updated"),
    };
  } catch {
    return { ...DEFAULT_LAYER_COL_WIDTHS };
  }
}

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
  const suppressClickRef = useRef(false);
  const lastSelectedIdxRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

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

  const totalMinWidth =
    34 + colWidths.name + FIXED_WAVEFORM_WIDTH + colWidths.structure + 78 + 84 + colWidths.updated;

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      <div
        tabIndex={0}
        role="grid"
        aria-label="Saved layers"
        onKeyDown={(e) => {
          if (selectedLayerIds.length === 0) return;
          if (e.key === "F2" && mode !== "trash") {
            e.preventDefault();
            openBatchRenameLayersModal(selectedLayerIds);
          } else if (e.key === "Delete" && mode !== "trash") {
            e.preventDefault();
            void trashLayerFiles(selectedLayerIds);
          } else if (e.key === "Enter" && mode !== "trash" && selectedLayerIds.length === 1) {
            const hit = visibleLayers.find((l) => l.id === selectedLayerIds[0]);
            if (hit) {
              e.preventDefault();
              void openSavedLayerInEditor(hit);
            }
          }
        }}
        className="flex-1 overflow-auto relative outline-none"
      >
        <div style={{ minWidth: `${totalMinWidth}px`, width: "100%" }} className="min-h-full flex flex-col">
          {/* Sticky Header matching SampleTableHeader & SlicesTableView 1:1 */}
          <div className="h-[26px] sticky top-0 z-20 bg-surface-header audify-frosted-bar border-b border-line border-l-2 border-l-transparent flex items-center text-[10px] font-semibold uppercase tracking-wider text-fg-head shrink-0 select-none">
            <button
              type="button"
              onClick={() => cycleLayerSort("fav")}
              className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line hover:text-fg transition-colors cursor-pointer ${
                layerSortKey === "fav" ? "text-accent-fg" : ""
              }`}
              title="Sort by Favorite Layers"
            >
              <Star className="w-3.5 h-3.5" />
            </button>

            <div
              style={{ width: `${colWidths.name}px` }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.colResize) return;
                cycleLayerSort("name");
              }}
              className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
                layerSortKey === "name" ? "text-accent-fg" : ""
              }`}
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel label="LAYER NAME" active={layerSortKey === "name"} sortDir={layerSortDir} />
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startColResize("name", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
              />
            </div>

            <div
              style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
              className="h-full px-1 flex items-center justify-center shrink-0 border-r border-line"
            >
              WAVEFORM
            </div>

            <div
              style={{ width: `${colWidths.structure}px` }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.colResize) return;
                cycleLayerSort("lanes");
              }}
              className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
                layerSortKey === "lanes" ? "text-accent-fg" : ""
              }`}
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel label="STRUCTURE" active={layerSortKey === "lanes"} sortDir={layerSortDir} />
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startColResize("structure", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={() => cycleLayerSort("duration")}
              className={`group/hdr w-[78px] h-full px-1 flex items-center justify-center shrink-0 border-r border-line cursor-pointer ${
                layerSortKey === "duration" ? "text-accent-fg" : ""
              }`}
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1 hover:bg-surface-3 hover:text-fg transition-colors">
                <ColumnSortLabel label="TIME" active={layerSortKey === "duration"} sortDir={layerSortDir} />
              </div>
            </button>

            <div className="w-[84px] h-full px-1 flex items-center justify-center shrink-0 border-r border-line">
              FMT/SR
            </div>

            <div
              style={{ width: `${colWidths.updated}px` }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.colResize) return;
                cycleLayerSort("updated");
              }}
              className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 cursor-pointer ${
                layerSortKey === "updated" ? "text-accent-fg" : ""
              }`}
            >
              <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
                <ColumnSortLabel label="UPDATED" active={layerSortKey === "updated"} sortDir={layerSortDir} />
              </div>
              <div
                data-col-resize="true"
                onMouseDown={(e) => startColResize("updated", e)}
                className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
              />
            </div>
          </div>

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
          <div className="flex-1">
            {visibleLayers.map((entry, idx) => {
              const activePath =
                entry.is_trashed && entry.trash_file_path
                  ? entry.trash_file_path
                  : entry.layer_path;
              const isCurrent =
                Boolean(activeNormPath) &&
                normalizePathForMatch(activePath) === activeNormPath;
              const isSelected = selectedSet.has(entry.id);
              const { stem, ext } = splitFileNameAndExt(entry.layer_name);
              const updatedMs = parseSqliteUtcMs(entry.updated_at || entry.created_at);

              return (
                <div
                  key={entry.id}
                  role="row"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    if (e.button !== 0 || !entry.file_exists || mode === "trash") return;
                    if ((e.target as HTMLElement).closest("button, input")) return;
                    beginDragOnMove(e.clientX, e.clientY, () => {
                      suppressClickRef.current = true;
                      void startNativeSampleDrag([entry.layer_path], entry.layer_name);
                    });
                  }}
                  onClick={(e) => {
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
                  }}
                  onDoubleClick={() => {
                    if (mode !== "trash") void openSavedLayerInEditor(entry);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLayerSelection(
                      isSelected ? selectedLayerIds : [entry.id],
                      entry.id
                    );
                    setContextMenu({ entry, x: e.clientX, y: e.clientY });
                  }}
                  className={`group h-[34px] flex items-center text-[11.5px] border-b border-line transition-colors cursor-pointer select-none ${
                    isCurrent || isSelected
                      ? "bg-accent-soft text-fg border-l-2 border-l-accent"
                      : idx % 2 === 1
                      ? "audify-row-surface-alt hover:bg-surface-hover text-fg border-l-2 border-l-transparent"
                      : "audify-row-surface hover:bg-surface-hover text-fg border-l-2 border-l-transparent"
                  } ${!entry.file_exists ? "opacity-55" : ""}`}
                >
                  <button
                    type="button"
                    disabled={mode === "trash"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode !== "trash") void toggleLayerFavorite(entry.id);
                    }}
                    className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line ${
                      mode === "trash" ? "cursor-default opacity-60" : "cursor-pointer"
                    }`}
                    title={
                      mode === "trash"
                        ? "Favorites are preserved in Trash"
                        : entry.is_favorite
                        ? "Remove layer from Favorites"
                        : "Add layer to Favorites"
                    }
                  >
                    <Star
                      className={`w-3.5 h-3.5 transition-colors ${
                        entry.is_favorite
                          ? "text-accent-fg fill-current"
                          : "text-fg-3 hover:text-fg-2"
                      }`}
                    />
                  </button>

                  <div
                    style={{ width: `${colWidths.name}px` }}
                    className="h-full px-2.5 flex items-center gap-1.5 min-w-0 shrink-0 overflow-hidden border-r border-line"
                    title={`${entry.layer_path} · Double-click to open in Layers Editor`}
                  >
                    {entry.file_exists ? (
                      mode === "trash" ? (
                        <Trash2 className="w-3 h-3 text-accent-fg shrink-0" />
                      ) : (
                        <Layers className="w-3 h-3 text-accent-fg shrink-0" />
                      )
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
                    )}

                    <div className="flex-1 truncate text-[13px] font-normal min-w-0">
                      <span className="text-fg">{stem}</span>
                      {ext && <span className="text-fg-3">{ext}</span>}
                    </div>

                    {mode !== "trash" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openSavedLayerInEditor(entry);
                        }}
                        className="w-[20px] h-[20px] rounded-[2px] opacity-0 group-hover:opacity-100 hover:bg-surface-3 text-fg-3 hover:text-accent-fg flex items-center justify-center shrink-0 transition-opacity cursor-pointer"
                        title="Open in Layers Editor"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div
                    style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
                    className="h-full px-2 flex items-center shrink-0 overflow-hidden border-r border-line"
                  >
                    <MiniWaveform
                      sampleId={-Math.max(1, entry.id)}
                      peaksJson={entry.peaks_json || "[]"}
                      isSelected={isCurrent}
                      isActiveTrack={isCurrent && isPlaying}
                      durationSec={entry.duration_ms / 1000}
                      width={FIXED_WAVEFORM_WIDTH - 16}
                      displayConfig={waveformConfig}
                    />
                  </div>

                  <div
                    style={{ width: `${colWidths.structure}px` }}
                    className="h-full px-2.5 flex items-center font-mono text-[10.5px] text-fg-2 shrink-0 border-r border-line truncate"
                  >
                    {entry.lane_count} {entry.lane_count === 1 ? "lane" : "lanes"} ·{" "}
                    {entry.clip_count} {entry.clip_count === 1 ? "clip" : "clips"}
                  </div>

                  <div className="w-[78px] h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-2 shrink-0 border-r border-line">
                    {formatDuration(entry.duration_ms)}
                  </div>

                  <div className="w-[84px] h-full px-1.5 flex items-center justify-center text-center font-mono tabular-nums text-[11px] text-fg-3 shrink-0 border-r border-line">
                    {formatSampleRateCompact(
                      entry.sample_rate > 0 ? entry.sample_rate : 48000,
                      entry.bit_depth > 0 ? entry.bit_depth : 16
                    )}
                  </div>

                  {renderDateCell("dateAdded", updatedMs, colWidths.updated)}
                </div>
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
