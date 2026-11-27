import { useCallback, useMemo } from "react";
import { getLayerDraftPlayheadSec } from "../../store/playheadClock";
import type { LayerClipSpec, LayerRecipe, SampleItem } from "../../types";
import {
  createSequentialLane,
  makeClipFromSample,
  makeLayerClipId,
  MAX_LAYER_CLIPS,
  MAX_LAYER_LANES,
} from "../../utils/layerHelpers";
import { resolveSameLaneOverlaps } from "./layersTimelineEditOps";
import {
  getClipPitchMode,
  getClipRenderedDurationSec,
  snapTimeSec,
  splitClipAtTimelineSec,
} from "./layersTimelineMath";

interface UseLayersStudioActionsParams {
  layerDraftRecipe: LayerRecipe;
  layerDraftSelectedClipIds: string[];
  layerDraftClipboardClips: LayerClipSpec[];
  snapEnabled: boolean;
  snapGridSec: number;
  updateLayerDraftRecipe: (
    next: LayerRecipe,
    opts?: { pushUndo?: boolean; autoRender?: boolean }
  ) => void;
  setLayerDraftSelectedClipIds: (ids: string[]) => void;
  setLayerDraftClipboardClips: (clips: LayerClipSpec[]) => void;
}

/**
 * Encapsulates clip editing commands for `LayersStudio` (multi-clip inspector updates,
 * multi-clip playhead split, copy/paste/duplicate/delete, and sample drop onto lanes).
 */
export function useLayersStudioActions(params: UseLayersStudioActionsParams) {
  const {
    layerDraftRecipe,
    layerDraftSelectedClipIds,
    layerDraftClipboardClips,
    snapEnabled,
    snapGridSec,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
    setLayerDraftClipboardClips,
  } = params;

  const selectedClips = useMemo(() => {
    if (layerDraftSelectedClipIds.length === 0) return [];
    const selSet = new Set(layerDraftSelectedClipIds);
    return layerDraftRecipe.clips.filter((c) => selSet.has(c.id));
  }, [layerDraftRecipe.clips, layerDraftSelectedClipIds]);

  const primarySelectedClip = useMemo(() => {
    if (layerDraftSelectedClipIds.length === 0) return null;
    const firstId = layerDraftSelectedClipIds[0];
    return layerDraftRecipe.clips.find((c) => c.id === firstId) ?? null;
  }, [layerDraftRecipe.clips, layerDraftSelectedClipIds]);

  const handleUpdatePrimaryClip = useCallback(
    (patch: Partial<LayerClipSpec>, opts?: { pushUndo?: boolean }) => {
      if (layerDraftSelectedClipIds.length === 0) return;
      const selSet = new Set(layerDraftSelectedClipIds);
      const nextRaw = {
        ...layerDraftRecipe,
        clips: layerDraftRecipe.clips.map((c) =>
          selSet.has(c.id) ? { ...c, ...patch } : c
        ),
      };
      const lengthMayChange =
        patch.pitchMode !== undefined ||
        (patch.pitchSemitones !== undefined &&
          nextRaw.clips.some(
            (c) => selSet.has(c.id) && getClipPitchMode(c) === "varispeed"
          ));
      const nextRecipe = lengthMayChange
        ? resolveSameLaneOverlaps(nextRaw, selSet, makeLayerClipId)
        : nextRaw;
      updateLayerDraftRecipe(nextRecipe, opts);
    },
    [layerDraftRecipe, layerDraftSelectedClipIds, updateLayerDraftRecipe]
  );

  const handleSplitAtPlayhead = useCallback(() => {
    if (layerDraftSelectedClipIds.length === 0) return;
    const playheadSec = getLayerDraftPlayheadSec();
    let working = layerDraftRecipe;
    const newRightIds: string[] = [];
    for (const clipId of layerDraftSelectedClipIds) {
      const res = splitClipAtTimelineSec(
        working,
        clipId,
        playheadSec,
        makeLayerClipId
      );
      if (res) {
        working = res.recipe;
        newRightIds.push(res.rightClipId);
      }
    }
    if (newRightIds.length === 0) return;
    updateLayerDraftRecipe(working);
    setLayerDraftSelectedClipIds(newRightIds);
  }, [
    layerDraftRecipe,
    layerDraftSelectedClipIds,
    updateLayerDraftRecipe,
    setLayerDraftSelectedClipIds,
  ]);

  const handleCopySelected = useCallback(() => {
    if (selectedClips.length > 0) setLayerDraftClipboardClips(selectedClips);
  }, [selectedClips, setLayerDraftClipboardClips]);

  const handlePasteAtPlayhead = useCallback(() => {
    if (layerDraftClipboardClips.length === 0) return;
    const remainingSlots = Math.max(0, MAX_LAYER_CLIPS - layerDraftRecipe.clips.length);
    if (remainingSlots <= 0) return;
    const sourceSlice = layerDraftClipboardClips.slice(0, remainingSlots);
    const minStart = Math.min(...sourceSlice.map((c) => c.startSec));
    const anchor = snapTimeSec(getLayerDraftPlayheadSec(), snapEnabled, snapGridSec);
    const validLaneIds = new Set(layerDraftRecipe.lanes.map((l) => l.id));
    const fallbackLaneId = layerDraftRecipe.lanes[0]?.id;
    if (!fallbackLaneId) return;

    const pasted: LayerClipSpec[] = sourceSlice.map((c) => ({
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
    if (selectedClips.length === 0) return;
    const remainingSlots = Math.max(0, MAX_LAYER_CLIPS - layerDraftRecipe.clips.length);
    if (remainingSlots <= 0) return;
    const sourceClips = selectedClips.slice(0, remainingSlots);
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
    selectedClips,
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
      const remainingSlots = Math.max(0, MAX_LAYER_CLIPS - layerDraftRecipe.clips.length);
      if (remainingSlots <= 0) return;
      const valid = droppedSamples
        .filter((s) => Boolean(s?.file_path?.trim()))
        .slice(0, remainingSlots);
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

  return {
    selectedClips,
    primarySelectedClip,
    handleUpdatePrimaryClip,
    handleSplitAtPlayhead,
    handleCopySelected,
    handlePasteAtPlayhead,
    handleDuplicateSelected,
    handleDeleteSelected,
    handleDropSamplesAt,
  };
}
