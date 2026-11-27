import React, { useCallback, useEffect, useRef, useState } from "react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { Z_INDEX } from "../../constants/zIndex";
import { getLayerDraftPlayheadSec } from "../../store/playheadClock";
import { safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import {
  createSequentialLane,
  isLayerDraftPreviewPending,
  isLayerDraftSample,
  MAX_LAYER_LANES,
} from "../../utils/layerHelpers";
import { safeGetItem } from "../../utils/localStorageSafe";
import { LayerClipInspector } from "./LayerClipInspector";
import { LayersStudioHeaderBar } from "./LayersStudioHeaderBar";
import {
  LayersTimelineCanvas,
  TimelineFollowMode,
} from "./LayersTimelineCanvas";
import { dispatchTimelineKeyDown } from "./layersTimelineDragHelpers";
import {
  computeFitAllPxPerSec,
  DEFAULT_LANE_HEADER_WIDTH,
  DEFAULT_LANE_HEIGHT,
  MAX_LANE_HEADER_WIDTH,
  MAX_LANE_HEIGHT,
  MIN_LANE_HEADER_WIDTH,
  MIN_LANE_HEIGHT,
} from "./layersTimelineMath";
import { SavedLayersTableView } from "./SavedLayersTableView";
import { SaveLayerModal } from "./SaveLayerModal";
import { useLayersStudioActions } from "./useLayersStudioActions";

function loadClampedInt(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = safeGetItem(key);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * Lazy-loaded Layers Studio mounted inside `SampleTable` main stage.
 * - `Favorites -> Layers`, `Trash -> Layers`, and `Tools -> Layers (Saved)` render
 *   the unified `SavedLayersTableView` directly (zero duplicate top bar!).
 * - `Editor` renders the DaVinci-inspired Timeline Dock (meant to pair below Audify's
 *   real SampleTable in split mode, or full-height when Library is hidden).
 */
export const LayersStudio: React.FC = () => {
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const layersWorkspaceTab = useSampleStore((s) => s.layersWorkspaceTab);
  const layersSplitLibraryOpen = useSampleStore((s) => s.layersSplitLibraryOpen);
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const layerDraftName = useSampleStore((s) => s.layerDraftName);
  const layerDraftEditingId = useSampleStore((s) => s.layerDraftEditingId);
  const layerDraftRecipe = useSampleStore((s) => s.layerDraftRecipe);
  const layerDraftDirty = useSampleStore((s) => s.layerDraftDirty);
  const layerDraftSelectedClipIds = useSampleStore(
    (s) => s.layerDraftSelectedClipIds
  );
  const layerDraftMissingClipIds = useSampleStore(
    (s) => s.layerDraftMissingClipIds
  );
  const layerDraftClipboardClips = useSampleStore(
    (s) => s.layerDraftClipboardClips
  );
  const canUndo = useSampleStore((s) => s.layerDraftUndoStack.length > 0);
  const canRedo = useSampleStore((s) => s.layerDraftRedoStack.length > 0);
  const layerDraftPreview = useSampleStore((s) => s.layerDraftPreview);
  const isRenderingLayerPreview = useSampleStore(
    (s) => s.isRenderingLayerPreview
  );
  const isSavingLayer = useSampleStore((s) => s.isSavingLayer);

  const setLayersWorkspaceTab = useSampleStore((s) => s.setLayersWorkspaceTab);
  const setLayersSplitLibraryOpen = useSampleStore(
    (s) => s.setLayersSplitLibraryOpen
  );
  const setLayerDraftSelectedClipIds = useSampleStore(
    (s) => s.setLayerDraftSelectedClipIds
  );
  const setLayerDraftClipboardClips = useSampleStore(
    (s) => s.setLayerDraftClipboardClips
  );
  const updateLayerDraftRecipe = useSampleStore(
    (s) => s.updateLayerDraftRecipe
  );
  const undoLayerDraft = useSampleStore((s) => s.undoLayerDraft);
  const redoLayerDraft = useSampleStore((s) => s.redoLayerDraft);
  const resetLayerDraft = useSampleStore((s) => s.resetLayerDraft);
  const renderLayerDraftPreview = useSampleStore(
    (s) => s.renderLayerDraftPreview
  );
  const saveLayerDraft = useSampleStore((s) => s.saveLayerDraft);
  const prepareLayerDraftForNleDrag = useSampleStore(
    (s) => s.prepareLayerDraftForNleDrag
  );

  const [pxPerSec, setPxPerSec] = useState(120);
  const [followMode, setFollowMode] = useState<TimelineFollowMode>("page");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const snapEnabled = layerDraftRecipe.snapEnabled ?? true;
  const snapGridSec =
    layerDraftRecipe.snapGridSec > 0 ? layerDraftRecipe.snapGridSec : 0.1;
  const [laneHeight, setLaneHeight] = useState(() =>
    loadClampedInt(
      AUDIFY_STORAGE_KEYS.layerLaneHeightV1,
      DEFAULT_LANE_HEIGHT,
      MIN_LANE_HEIGHT,
      MAX_LANE_HEIGHT
    )
  );
  const [laneHeaderWidth, setLaneHeaderWidth] = useState(() =>
    loadClampedInt(
      AUDIFY_STORAGE_KEYS.layerLaneHeaderWidthV1,
      DEFAULT_LANE_HEADER_WIDTH,
      MIN_LANE_HEADER_WIDTH,
      MAX_LANE_HEADER_WIDTH
    )
  );
  const viewportWidthRef = useRef(640);
  const laneHeaderResizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => laneHeaderResizeCleanupRef.current?.(), []);

  const handleToggleSnap = useCallback(() => {
    updateLayerDraftRecipe(
      { ...layerDraftRecipe, snapEnabled: !snapEnabled },
      { pushUndo: false, autoRender: false }
    );
  }, [layerDraftRecipe, snapEnabled, updateLayerDraftRecipe]);

  const handleChangeSnapGridSec = useCallback(
    (nextGrid: number) => {
      updateLayerDraftRecipe(
        { ...layerDraftRecipe, snapGridSec: nextGrid },
        { pushUndo: false, autoRender: false }
      );
    },
    [layerDraftRecipe, updateLayerDraftRecipe]
  );

  const handleChangeLaneHeight = useCallback((next: number) => {
    const clamped = Math.max(
      MIN_LANE_HEIGHT,
      Math.min(MAX_LANE_HEIGHT, Math.round(next))
    );
    setLaneHeight(clamped);
    safeSetItem(AUDIFY_STORAGE_KEYS.layerLaneHeightV1, String(clamped));
  }, []);

  const [isResizingLaneHeader, setIsResizingLaneHeader] = useState(false);

  const handleStartLaneHeaderResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      laneHeaderResizeCleanupRef.current?.();
      const startX = e.clientX;
      const startW = laneHeaderWidth;
      let latest = startW;
      setIsResizingLaneHeader(true);
      const onMove = (ev: MouseEvent) => {
        latest = Math.max(
          MIN_LANE_HEADER_WIDTH,
          Math.min(MAX_LANE_HEADER_WIDTH, Math.round(startW + (ev.clientX - startX)))
        );
        setLaneHeaderWidth(latest);
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        setIsResizingLaneHeader(false);
        laneHeaderResizeCleanupRef.current = null;
      };
      const onUp = () => {
        cleanup();
        safeSetItem(AUDIFY_STORAGE_KEYS.layerLaneHeaderWidthV1, String(latest));
      };
      laneHeaderResizeCleanupRef.current = cleanup;
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [laneHeaderWidth]
  );

  const handleFitAll = useCallback(
    (widthOverride?: number) => {
      const vw = widthOverride ?? viewportWidthRef.current;
      setPxPerSec(computeFitAllPxPerSec(layerDraftRecipe, vw));
    },
    [layerDraftRecipe]
  );

  const {
    selectedClips,
    primarySelectedClip,
    handleUpdatePrimaryClip,
    handleSplitAtPlayhead,
    handleCopySelected,
    handlePasteAtPlayhead,
    handleDuplicateSelected,
    handleDeleteSelected,
    handleDropSamplesAt,
  } = useLayersStudioActions({
    layerDraftRecipe,
    layerDraftSelectedClipIds,
    layerDraftClipboardClips,
    snapEnabled,
    snapGridSec,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
    setLayerDraftClipboardClips,
  });

  const handleStudioKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (saveModalOpen) return;
      dispatchTimelineKeyDown(e, {
        recipe: layerDraftRecipe,
        viewportWidth: viewportWidthRef.current,
        onFitAll: handleFitAll,
        onSelectClips: setLayerDraftSelectedClipIds,
        onCopySelected: handleCopySelected,
        onPasteAtPlayhead: handlePasteAtPlayhead,
        onDuplicateSelected: handleDuplicateSelected,
        onSplitAtPlayhead: handleSplitAtPlayhead,
        onDeleteSelected: handleDeleteSelected,
        onUndo: undoLayerDraft,
        onRedo: redoLayerDraft,
        onPlayOrRenderDraft: () => {
          const st = useSampleStore.getState();
          if (
            isLayerDraftSample(st.selectedSample) &&
            !st.isRenderingLayerPreview &&
            !isLayerDraftPreviewPending()
          ) {
            st.togglePlayPause();
          } else {
            void renderLayerDraftPreview({
              autoplay: true,
              startSec: getLayerDraftPlayheadSec(),
            });
          }
        },
      });
    },
    [
      saveModalOpen,
      layerDraftRecipe,
      handleFitAll,
      setLayerDraftSelectedClipIds,
      handleCopySelected,
      handlePasteAtPlayhead,
      handleDuplicateSelected,
      handleSplitAtPlayhead,
      handleDeleteSelected,
      undoLayerDraft,
      redoLayerDraft,
      renderLayerDraftPreview,
    ]
  );

  // Unified Trash, Favorites, and Saved views render SavedLayersTableView directly (Slices 1:1 parity)
  if (trashFilterActive && trashViewTab === "layers") {
    return <SavedLayersTableView mode="trash" />;
  }
  if (favoriteOnly && favoritesViewTab === "layers") {
    return <SavedLayersTableView mode="favorites" />;
  }
  if (layersWorkspaceTab !== "editor") {
    return <SavedLayersTableView mode="saved" />;
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={handleStudioKeyDown}
      className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-0 outline-none"
    >
      <LayersStudioHeaderBar
        savedCount={layerHistory.length}
        layerDraftName={layerDraftName}
        layerDraftDirty={layerDraftDirty}
        layerDraftEditingId={layerDraftEditingId}
        hasClips={layerDraftRecipe.clips.length > 0}
        canUndo={canUndo}
        canRedo={canRedo}
        isRenderingLayerPreview={isRenderingLayerPreview}
        isSavingLayer={isSavingLayer}
        layersSplitLibraryOpen={layersSplitLibraryOpen}
        layerDraftPreview={layerDraftPreview}
        pxPerSec={pxPerSec}
        laneHeight={laneHeight}
        snapEnabled={snapEnabled}
        snapGridSec={snapGridSec}
        followMode={followMode}
        onOpenSavedView={() => setLayersWorkspaceTab("saved")}
        onToggleSplitLibrary={() =>
          setLayersSplitLibraryOpen(!layersSplitLibraryOpen)
        }
        onRenderAndPlay={() =>
          void renderLayerDraftPreview({
            autoplay: true,
            startSec: getLayerDraftPlayheadSec(),
          })
        }
        onUndo={undoLayerDraft}
        onRedo={redoLayerDraft}
        onToggleSnap={handleToggleSnap}
        onChangeSnapGridSec={handleChangeSnapGridSec}
        onCycleFollowMode={() =>
          setFollowMode((m) =>
            m === "page" ? "smooth" : m === "smooth" ? "off" : "page"
          )
        }
        onFitAll={() => handleFitAll()}
        onChangePxPerSec={setPxPerSec}
        onChangeLaneHeight={handleChangeLaneHeight}
        onPrepareNleDrag={prepareLayerDraftForNleDrag}
        onOpenSaveModal={() => setSaveModalOpen(true)}
        onResetDraft={resetLayerDraft}
      />

      <LayersTimelineCanvas
        recipe={layerDraftRecipe}
        selectedClipIds={layerDraftSelectedClipIds}
        missingClipIds={layerDraftMissingClipIds}
        pxPerSec={pxPerSec}
        laneHeight={laneHeight}
        laneHeaderWidth={laneHeaderWidth}
        snapEnabled={snapEnabled}
        snapGridSec={snapGridSec}
        followMode={followMode}
        onStartLaneHeaderResize={handleStartLaneHeaderResize}
        onChangePxPerSec={setPxPerSec}
        onChangeLaneHeight={handleChangeLaneHeight}
        onSelectClips={setLayerDraftSelectedClipIds}
        onCommitRecipe={updateLayerDraftRecipe}
        onAddLane={() => {
          if (layerDraftRecipe.lanes.length >= MAX_LAYER_LANES) return;
          updateLayerDraftRecipe({
            ...layerDraftRecipe,
            lanes: [
              ...layerDraftRecipe.lanes,
              createSequentialLane(layerDraftRecipe.lanes),
            ],
          });
        }}
        onToggleMute={(laneId) =>
          updateLayerDraftRecipe({
            ...layerDraftRecipe,
            lanes: layerDraftRecipe.lanes.map((l) =>
              l.id === laneId ? { ...l, muted: !l.muted } : l
            ),
          })
        }
        onToggleSolo={(laneId) =>
          updateLayerDraftRecipe({
            ...layerDraftRecipe,
            lanes: layerDraftRecipe.lanes.map((l) =>
              l.id === laneId ? { ...l, solo: !l.solo } : l
            ),
          })
        }
        onChangeLaneVolume={(laneId, volumeDb, pushUndo) =>
          updateLayerDraftRecipe(
            {
              ...layerDraftRecipe,
              lanes: layerDraftRecipe.lanes.map((l) =>
                l.id === laneId ? { ...l, volumeDb } : l
              ),
            },
            pushUndo === undefined ? undefined : { pushUndo }
          )
        }
        onRenameLane={(laneId, name) =>
          updateLayerDraftRecipe({
            ...layerDraftRecipe,
            lanes: layerDraftRecipe.lanes.map((l) =>
              l.id === laneId ? { ...l, name } : l
            ),
          })
        }
        onRemoveLane={(laneId) => {
          if (layerDraftRecipe.lanes.length <= 1) return;
          updateLayerDraftRecipe({
            ...layerDraftRecipe,
            lanes: layerDraftRecipe.lanes.filter((l) => l.id !== laneId),
            clips: layerDraftRecipe.clips.filter((c) => c.laneId !== laneId),
          });
        }}
        onDropSamplesAt={handleDropSamplesAt}
        viewportWidthRef={viewportWidthRef}
      />

      <LayerClipInspector
        clip={primarySelectedClip}
        selectedClips={selectedClips}
        selectedCount={layerDraftSelectedClipIds.length}
        isMissingSource={
          primarySelectedClip !== null &&
          layerDraftMissingClipIds.includes(primarySelectedClip.id)
        }
        onUpdateClip={handleUpdatePrimaryClip}
        onSplitAtPlayhead={handleSplitAtPlayhead}
        onDuplicateClip={handleDuplicateSelected}
        onDeleteClip={handleDeleteSelected}
      />

      {isResizingLaneHeader && (
        <div
          aria-hidden="true"
          style={{ zIndex: Z_INDEX.floatingMenu }}
          className="fixed inset-0 cursor-col-resize select-none"
        />
      )}

      <SaveLayerModal
        open={saveModalOpen}
        initialName={layerDraftName}
        editingLayerId={layerDraftEditingId}
        existingLayers={layerHistory}
        isSaving={isSavingLayer}
        onClose={() => setSaveModalOpen(false)}
        onConfirmSave={async (name, overwrite) =>
          Boolean(await saveLayerDraft({ name, overwrite }))
        }
      />
    </div>
  );
};
