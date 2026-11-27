import React, { useCallback, useMemo, useRef, useState } from "react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { Z_INDEX } from "../../constants/zIndex";
import { getPlayheadSec } from "../../store/playheadClock";
import { safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerClipSpec, SampleItem } from "../../types";
import {
  createSequentialLane,
  makeClipFromSample,
  makeLayerClipId,
  MAX_LAYER_LANES,
} from "../../utils/layerHelpers";
import { safeGetItem } from "../../utils/localStorageSafe";
import { LayerClipInspector } from "./LayerClipInspector";
import { LayersStudioHeaderBar } from "./LayersStudioHeaderBar";
import {
  LayersTimelineCanvas,
  TimelineFollowMode,
} from "./LayersTimelineCanvas";
import {
  computeFitAllPxPerSec,
  DEFAULT_LANE_HEADER_WIDTH,
  DEFAULT_LANE_HEIGHT,
  getClipPitchMode,
  getClipRenderedDurationSec,
  MAX_LANE_HEADER_WIDTH,
  MAX_LANE_HEIGHT,
  MIN_LANE_HEADER_WIDTH,
  MIN_LANE_HEIGHT,
  resolveSameLaneOverlaps,
  snapTimeSec,
  splitClipAtTimelineSec,
} from "./layersTimelineMath";
import { SavedLayersTableView } from "./SavedLayersTableView";
import { SaveLayerModal } from "./SaveLayerModal";

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
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapGridSec, setSnapGridSec] = useState(0.1);
  const [followMode, setFollowMode] = useState<TimelineFollowMode>("page");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
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
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        setIsResizingLaneHeader(false);
        safeSetItem(AUDIFY_STORAGE_KEYS.layerLaneHeaderWidthV1, String(latest));
      };
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

  const primarySelectedClip = useMemo(() => {
    if (layerDraftSelectedClipIds.length === 0) return null;
    const firstId = layerDraftSelectedClipIds[0];
    return layerDraftRecipe.clips.find((c) => c.id === firstId) ?? null;
  }, [layerDraftRecipe.clips, layerDraftSelectedClipIds]);

  const handleUpdatePrimaryClip = useCallback(
    (patch: Partial<LayerClipSpec>) => {
      if (layerDraftSelectedClipIds.length === 0) return;
      const selSet = new Set(layerDraftSelectedClipIds);
      const nextRaw = {
        ...layerDraftRecipe,
        clips: layerDraftRecipe.clips.map((c) =>
          selSet.has(c.id) ? { ...c, ...patch } : c
        ),
      };
      // If rendered duration may expand (Tape varispeed pitch or mode switch), enforce DaVinci overwrite cleanly
      const lengthMayChange =
        patch.pitchMode !== undefined ||
        (patch.pitchSemitones !== undefined &&
          nextRaw.clips.some(
            (c) => selSet.has(c.id) && getClipPitchMode(c) === "varispeed"
          ));
      const nextRecipe = lengthMayChange
        ? resolveSameLaneOverlaps(nextRaw, selSet, makeLayerClipId)
        : nextRaw;
      updateLayerDraftRecipe(nextRecipe);
    },
    [layerDraftRecipe, layerDraftSelectedClipIds, updateLayerDraftRecipe]
  );

  const handleSplitAtPlayhead = useCallback(() => {
    const targetId = primarySelectedClip?.id;
    if (!targetId) return;
    const res = splitClipAtTimelineSec(
      layerDraftRecipe,
      targetId,
      getPlayheadSec(),
      makeLayerClipId
    );
    if (!res) return;
    updateLayerDraftRecipe(res.recipe);
    setLayerDraftSelectedClipIds([res.rightClipId]);
  }, [
    layerDraftRecipe,
    primarySelectedClip,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
  ]);

  const handleCopySelected = useCallback(() => {
    if (layerDraftSelectedClipIds.length === 0) return;
    const selSet = new Set(layerDraftSelectedClipIds);
    const clips = layerDraftRecipe.clips.filter((c) => selSet.has(c.id));
    if (clips.length > 0) setLayerDraftClipboardClips(clips);
  }, [
    layerDraftRecipe.clips,
    layerDraftSelectedClipIds,
    setLayerDraftClipboardClips,
  ]);

  const handlePasteAtPlayhead = useCallback(() => {
    if (layerDraftClipboardClips.length === 0) return;
    const minStart = Math.min(...layerDraftClipboardClips.map((c) => c.startSec));
    const anchor = snapTimeSec(getPlayheadSec(), snapEnabled, snapGridSec);
    const validLaneIds = new Set(layerDraftRecipe.lanes.map((l) => l.id));
    const fallbackLaneId = layerDraftRecipe.lanes[0]?.id;
    if (!fallbackLaneId) return;

    const pasted: LayerClipSpec[] = layerDraftClipboardClips.map((c) => ({
      ...c,
      id: makeLayerClipId(),
      laneId: validLaneIds.has(c.laneId) ? c.laneId : fallbackLaneId,
      startSec: Math.max(0, anchor + (c.startSec - minStart)),
    }));
    const pastedIds = pasted.map((c) => c.id);
    updateLayerDraftRecipe(
      resolveSameLaneOverlaps(
        {
          ...layerDraftRecipe,
          clips: [...layerDraftRecipe.clips, ...pasted],
        },
        new Set(pastedIds),
        makeLayerClipId
      )
    );
    setLayerDraftSelectedClipIds(pastedIds);
  }, [
    layerDraftClipboardClips,
    layerDraftRecipe,
    snapEnabled,
    snapGridSec,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
  ]);

  const handleDuplicateSelected = useCallback(() => {
    if (layerDraftSelectedClipIds.length === 0) return;
    const selSet = new Set(layerDraftSelectedClipIds);
    const sourceClips = layerDraftRecipe.clips.filter((c) => selSet.has(c.id));
    if (sourceClips.length === 0) return;
    const minStart = Math.min(...sourceClips.map((c) => c.startSec));
    const maxEnd = Math.max(
      ...sourceClips.map((c) => c.startSec + getClipRenderedDurationSec(c))
    );
    const shiftSec = Math.max(0.05, maxEnd - minStart);
    const clones: LayerClipSpec[] = sourceClips.map((c) => ({
      ...c,
      id: makeLayerClipId(),
      startSec: c.startSec + shiftSec,
    }));
    const cloneIds = clones.map((c) => c.id);
    updateLayerDraftRecipe(
      resolveSameLaneOverlaps(
        {
          ...layerDraftRecipe,
          clips: [...layerDraftRecipe.clips, ...clones],
        },
        new Set(cloneIds),
        makeLayerClipId
      )
    );
    setLayerDraftSelectedClipIds(cloneIds);
  }, [
    layerDraftRecipe,
    layerDraftSelectedClipIds,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
  ]);

  const handleDeleteSelected = useCallback(() => {
    if (layerDraftSelectedClipIds.length === 0) return;
    const selSet = new Set(layerDraftSelectedClipIds);
    updateLayerDraftRecipe({
      ...layerDraftRecipe,
      clips: layerDraftRecipe.clips.filter((c) => !selSet.has(c.id)),
    });
    setLayerDraftSelectedClipIds([]);
  }, [
    layerDraftRecipe,
    layerDraftSelectedClipIds,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
  ]);

  const handleDropSamplesAt = useCallback(
    (
      droppedSamples: SampleItem[],
      laneIndex: number,
      isNewLane: boolean,
      startSec: number
    ) => {
      const valid = droppedSamples.filter((s) => Boolean(s?.file_path?.trim()));
      if (valid.length === 0) return;
      const nextLanes = [...layerDraftRecipe.lanes];
      const nextClips = [...layerDraftRecipe.clips];
      const addedIds: string[] = [];

      valid.forEach((sample, idx) => {
        const targetIdx = isNewLane ? nextLanes.length : laneIndex + idx;
        while (targetIdx >= nextLanes.length && nextLanes.length < MAX_LAYER_LANES) {
          nextLanes.push(createSequentialLane(nextLanes));
        }
        const lane = nextLanes[Math.min(targetIdx, nextLanes.length - 1)];
        if (!lane) return;
        const clip = makeClipFromSample(sample, lane.id, Math.max(0, startSec));
        addedIds.push(clip.id);
        nextClips.push(clip);
      });

      updateLayerDraftRecipe(
        resolveSameLaneOverlaps(
          {
            ...layerDraftRecipe,
            lanes: nextLanes,
            clips: nextClips,
          },
          new Set(addedIds),
          makeLayerClipId
        )
      );
      if (addedIds.length > 0) setLayerDraftSelectedClipIds(addedIds);
    },
    [layerDraftRecipe, updateLayerDraftRecipe, setLayerDraftSelectedClipIds]
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-0">
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
        onRenderAndPlay={() => void renderLayerDraftPreview({ autoplay: true })}
        onUndo={undoLayerDraft}
        onRedo={redoLayerDraft}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        onChangeSnapGridSec={setSnapGridSec}
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
        onFitAll={handleFitAll}
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
        onChangeLaneVolume={(laneId, volumeDb) =>
          updateLayerDraftRecipe({
            ...layerDraftRecipe,
            lanes: layerDraftRecipe.lanes.map((l) =>
              l.id === laneId ? { ...l, volumeDb } : l
            ),
          })
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
        onSplitAtPlayhead={handleSplitAtPlayhead}
        onCopySelected={handleCopySelected}
        onPasteAtPlayhead={handlePasteAtPlayhead}
        onDuplicateSelected={handleDuplicateSelected}
        onDeleteSelected={handleDeleteSelected}
        viewportWidthRef={viewportWidthRef}
      />

      <LayerClipInspector
        clip={primarySelectedClip}
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
        onConfirmSave={async (name, overwrite) => {
          await saveLayerDraft({ name, overwrite });
        }}
      />
    </div>
  );
};
