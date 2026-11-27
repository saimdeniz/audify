import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, Layers, Pause, Pencil, Play, Star } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerHistoryEntry } from "../../types";
import { beginDragOnMove, startNativeSampleDrag } from "../../utils/drag";
import { formatDuration } from "../../utils/format";
import { getVisibleSortedLayers } from "../../utils/layerHelpers";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import {
  LayerContextMenuState,
  SavedLayerContextMenu,
} from "../layers/SavedLayerContextMenu";

/**
 * Compact saved-layers list rendered inside Mini Dock (`Tools -> Layers`,
 * `Favorites -> Layers`, or `Trash -> Layers`).
 * Shares identical `h-[28px]` row rhythm, star geometry, and native OS NLE drag
 * with `MiniDockList`, plus a one-click `Edit` jump into Normal View's Editor.
 */
export const MiniDockLayersList: React.FC = () => {
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const trashedLayerHistory = useSampleStore((s) => s.trashedLayerHistory);
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const layerSortKey = useSampleStore((s) => s.layerSortKey);
  const layerSortDir = useSampleStore((s) => s.layerSortDir);

  const fetchLayerHistory = useSampleStore((s) => s.fetchLayerHistory);
  const fetchTrashedLayers = useSampleStore((s) => s.fetchTrashedLayers);
  const selectLayerForPreview = useSampleStore((s) => s.selectLayerForPreview);
  const toggleLayerFavorite = useSampleStore((s) => s.toggleLayerFavorite);
  const toggleLayerFavoritesBatch = useSampleStore(
    (s) => s.toggleLayerFavoritesBatch
  );
  const openSavedLayerInEditor = useSampleStore(
    (s) => s.openSavedLayerInEditor
  );
  const openBatchRenameLayersModal = useSampleStore(
    (s) => s.openBatchRenameLayersModal
  );
  const showInFolder = useSampleStore((s) => s.showInFolder);
  const trashLayerFiles = useSampleStore((s) => s.trashLayerFiles);
  const restoreTrashedLayers = useSampleStore((s) => s.restoreTrashedLayers);
  const emptyTrashedLayers = useSampleStore((s) => s.emptyTrashedLayers);

  const isTrashMode = trashFilterActive && trashViewTab === "layers";
  const isFavMode = favoriteOnly && favoritesViewTab === "layers";
  const suppressNextClickRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<LayerContextMenuState | null>(
    null
  );
  const emptySet = useMemo(() => new Set<number>(), []);

  useEffect(() => {
    if (isTrashMode) {
      void fetchTrashedLayers();
    } else if (useSampleStore.getState().layerHistory.length === 0) {
      void fetchLayerHistory();
    }
  }, [isTrashMode, fetchLayerHistory, fetchTrashedLayers]);

  const visibleLayers = useMemo(
    () =>
      getVisibleSortedLayers(isTrashMode ? trashedLayerHistory : layerHistory, {
        searchQuery,
        favoriteOnly: isTrashMode ? false : isFavMode,
        sortKey: layerSortKey,
        sortDir: layerSortDir,
      }),
    [
      isTrashMode,
      isFavMode,
      trashedLayerHistory,
      layerHistory,
      searchQuery,
      layerSortKey,
      layerSortDir,
    ]
  );

  const activeNormPath = selectedSample?.file_path
    ? normalizePathForMatch(selectedSample.file_path)
    : "";

  if (visibleLayers.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-center text-fg-3 gap-1.5">
        <Layers className="w-5 h-5 opacity-45" />
        <p className="text-[11.5px] font-medium text-fg-2">
          {isTrashMode
            ? "No trashed layers"
            : isFavMode
            ? "No favorite layers yet"
            : "No saved layers yet"}
        </p>
        <p className="text-[10.5px] text-fg-3 max-w-[240px]">
          Right-click any track and choose &ldquo;Send to Layers&rdquo; to mix custom SFX.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden divide-y divide-line-subtle">
      {visibleLayers.map((entry: LayerHistoryEntry) => {
        const activePath =
          entry.is_trashed && entry.trash_file_path
            ? entry.trash_file_path
            : entry.layer_path;
        const isCurrent =
          Boolean(activeNormPath) &&
          normalizePathForMatch(activePath) === activeNormPath;
        const rowPlaying = isCurrent && isPlaying;

        return (
          <div
            key={entry.id}
            onMouseDown={(e) => {
              if (e.button !== 0 || !entry.file_exists || isTrashMode) return;
              beginDragOnMove(e.clientX, e.clientY, () => {
                suppressNextClickRef.current = true;
                void startNativeSampleDrag([entry.layer_path], entry.layer_name);
              });
            }}
            onClick={() => {
              if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false;
                return;
              }
              if (isCurrent) {
                useSampleStore.getState().togglePlayPause();
              } else {
                selectLayerForPreview(entry, true);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ entry, x: e.clientX, y: e.clientY });
            }}
            className={`group h-[28px] px-2 flex items-center gap-1.5 border-l-2 transition-colors cursor-pointer ${
              isCurrent
                ? "bg-accent-soft border-accent text-fg"
                : "border-transparent hover:bg-surface-hover text-fg-2 hover:text-fg"
            }`}
            title={
              entry.file_exists
                ? `${entry.layer_name} · ${entry.lane_count} lanes · Drag to NLE`
                : `${entry.layer_name} (Missing on disk)`
            }
          >
            {!isTrashMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleLayerFavorite(entry.id);
                }}
                className={`w-[18px] h-[18px] rounded-[2px] flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  entry.is_favorite
                    ? "text-accent-fg"
                    : "text-fg-3 opacity-45 hover:opacity-100 hover:text-accent-fg"
                }`}
                title={
                  entry.is_favorite
                    ? "Remove from Favorites"
                    : "Add to Favorites"
                }
              >
                <Star
                  className={`w-3 h-3 ${entry.is_favorite ? "fill-current" : ""}`}
                />
              </button>
            )}

            <span className="w-[14px] flex items-center justify-center shrink-0 text-fg-3">
              {rowPlaying ? (
                <Pause className="w-2.5 h-2.5 text-accent-fg fill-current" />
              ) : (
                <Play className="w-2.5 h-2.5 fill-current" />
              )}
            </span>

            <span
              className={`flex-1 min-w-0 truncate text-[11.5px] ${
                isCurrent ? "font-semibold text-fg" : "font-normal"
              } ${!entry.file_exists ? "line-through opacity-55" : ""}`}
            >
              {entry.layer_name}
            </span>

            <span className="h-[16px] px-1 rounded-[2px] bg-surface-3 border border-line font-mono text-[9px] text-fg-3 inline-flex items-center shrink-0">
              {entry.lane_count}L
            </span>

            {isTrashMode ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void restoreTrashedLayers([entry.id]);
                }}
                className="h-[20px] px-1.5 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg inline-flex items-center gap-1 text-[10px] shrink-0 transition-colors cursor-pointer"
                title="Restore layer from Trash"
              >
                <ArchiveRestore className="w-2.5 h-2.5" />
                <span>Restore</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void openSavedLayerInEditor(entry);
                }}
                className="h-[20px] px-1.5 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg inline-flex items-center gap-1 text-[10px] shrink-0 transition-colors cursor-pointer"
                title="Open layer in Normal View Editor"
              >
                <Pencil className="w-2.5 h-2.5" />
                <span>Edit</span>
              </button>
            )}

            <span className="font-mono tabular-nums text-[10.5px] text-fg-3 w-[44px] text-right shrink-0">
              {formatDuration(entry.duration_ms)}
            </span>
          </div>
        );
      })}
      {contextMenu && (
        <SavedLayerContextMenu
          menu={contextMenu}
          mode={isTrashMode ? "trash" : isFavMode ? "favorites" : "saved"}
          allEntries={visibleLayers}
          selectedLayerIds={[contextMenu.entry.id]}
          selectedSet={emptySet}
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
