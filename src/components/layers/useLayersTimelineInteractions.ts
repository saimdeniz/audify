import React, { useCallback, useEffect, useRef, useState } from "react";
import { setLayerDraftPlayheadSec } from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerRecipe, SampleItem } from "../../types";
import { getActiveOsDragSample } from "../../utils/drag";
import { isLayerDraftSample } from "../../utils/layerHelpers";
import {
  ActiveDragState,
  buildDraggedClipsList,
  buildExternalDropPreview,
  createBaseDragState,
} from "./layersTimelineDragHelpers";
import { getShiftClickRangeClipIds } from "./layersTimelineEditOps";
import {
  hitTestTimelineClip,
  MAX_LANE_HEIGHT,
  MAX_PX_PER_SEC,
  MIN_LANE_HEIGHT,
  MIN_PX_PER_SEC,
  TimelineMarqueeRect,
} from "./layersTimelineMath";
import type { TimelineDropPreview } from "./layersTimelineRenderer";
import {
  DragPointerSnapshot,
  useTimelineDragLoop,
} from "./useTimelineDragLoop";

function getDraggedSamplesFromStore(): SampleItem[] {
  const st = useSampleStore.getState();
  if (st.inAppDragSamples.length > 0) return st.inAppDragSamples;
  if (st.inAppDragSample) return [st.inAppDragSample];
  const osDrag = getActiveOsDragSample();
  return osDrag?.sample ? [osDrag.sample] : [];
}

interface UseLayersTimelineInteractionsParams {
  recipe: LayerRecipe;
  selectedClipIds: string[];
  selectedSet: ReadonlySet<string>;
  pxPerSec: number;
  laneHeight: number;
  snapEnabled: boolean;
  snapGridSec: number;
  sourceDurationBySampleId: ReadonlyMap<number, number>;
  rootRef: React.RefObject<HTMLDivElement | null>;
  vScrollRef: React.RefObject<HTMLDivElement | null>;
  rulerWrapRef: React.RefObject<HTMLDivElement | null>;
  canvasWrapRef: React.RefObject<HTMLDivElement | null>;
  scrollLeftRef: React.MutableRefObject<number>;
  liveRecipeRef: React.MutableRefObject<LayerRecipe>;
  hoveredClipIdRef: React.MutableRefObject<string | null>;
  dropPreviewRef: React.MutableRefObject<TimelineDropPreview | null>;
  marqueeRectRef: React.MutableRefObject<TimelineMarqueeRect | null>;
  drawRef: React.MutableRefObject<() => void>;
  setHorizontalScroll: (nextLeft: number) => void;
  onChangePxPerSec: (next: number) => void;
  onChangeLaneHeight: (next: number) => void;
  onSelectClips: (clipIds: string[]) => void;
  onCommitRecipe: (next: LayerRecipe) => void;
  onDropSamplesAt: (
    samples: SampleItem[],
    laneIndex: number,
    isNewLane: boolean,
    startSec: number
  ) => void;
}

/**
 * Encapsulates DaVinci Resolve timeline interactions: playhead-centered `Alt+Scroll` zoom,
 * `Shift+Scroll` height, `Ctrl+Scroll` pan, pause-preserving ruler scrub, marquee multi-select,
 * `Shift+Click` range select, `Shift+Drag` vertical lock, `Alt+Drag` clone, Ghost Lane, and Overwrite Trim.
 */
export function useLayersTimelineInteractions(
  params: UseLayersTimelineInteractionsParams
) {
  const {
    recipe,
    selectedClipIds,
    selectedSet,
    pxPerSec,
    laneHeight,
    snapEnabled,
    snapGridSec,
    sourceDurationBySampleId,
    rootRef,
    vScrollRef,
    rulerWrapRef,
    canvasWrapRef,
    scrollLeftRef,
    liveRecipeRef,
    hoveredClipIdRef,
    dropPreviewRef,
    marqueeRectRef,
    drawRef,
    setHorizontalScroll,
    onChangePxPerSec,
    onChangeLaneHeight,
    onSelectClips,
    onCommitRecipe,
    onDropSamplesAt,
  } = params;

  const requestSeek = useSampleStore((s) => s.requestSeek);
  const dragRef = useRef<ActiveDragState | null>(null);
  const lastDragPointerRef = useRef<DragPointerSnapshot | null>(null);
  const anchorClipIdRef = useRef<string | null>(null);
  const [ghostNewLaneVisible, setGhostNewLaneVisible] = useState(false);
  const [cursorClass, setCursorClass] = useState("cursor-default");

  if (!dragRef.current) {
    liveRecipeRef.current = recipe;
  }

  useEffect(() => {
    const vs = vScrollRef.current;
    if (!vs) return;
    const onWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.24 : 1 / 1.24;
        const nextPx = Math.max(
          MIN_PX_PER_SEC,
          Math.min(MAX_PX_PER_SEC, Math.round(pxPerSec * factor))
        );
        if (nextPx !== pxPerSec) onChangePxPerSec(nextPx);
      } else if (e.shiftKey) {
        e.preventDefault();
        const nextH = Math.max(
          MIN_LANE_HEIGHT,
          Math.min(MAX_LANE_HEIGHT, laneHeight + (e.deltaY < 0 ? 8 : -8))
        );
        if (nextH !== laneHeight) onChangeLaneHeight(nextH);
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setHorizontalScroll(scrollLeftRef.current + e.deltaY * 0.9);
      }
    };
    vs.addEventListener("wheel", onWheel, { passive: false });
    return () => vs.removeEventListener("wheel", onWheel);
  }, [
    vScrollRef,
    scrollLeftRef,
    pxPerSec,
    laneHeight,
    onChangePxPerSec,
    onChangeLaneHeight,
    setHorizontalScroll,
  ]);

  const getLaneCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = canvasWrapRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [canvasWrapRef]
  );

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    rootRef.current?.focus();
    const rect = rulerWrapRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 0;
    const targetSec = Math.max(0, (x + scrollLeftRef.current) / pxPerSec);
    setLayerDraftPlayheadSec(targetSec);
    const st = useSampleStore.getState();
    if (isLayerDraftSample(st.selectedSample)) {
      requestSeek(targetSec, st.isPlaying);
    }
    lastDragPointerRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
      ctrlOrMetaKey: e.ctrlKey || e.metaKey,
    };
    dragRef.current = createBaseDragState({
      mode: "scrub",
      startClientX: e.clientX,
      startClientY: e.clientY,
      origScrollLeft: scrollLeftRef.current,
      origScrollTop: vScrollRef.current?.scrollTop ?? 0,
      viewportLeft: rect?.left ?? 0,
      viewportRight: rect?.right ?? 0,
      baseRecipe: recipe,
    });
  };

  const handleLaneMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    rootRef.current?.focus();
    if (e.button === 1) {
      e.preventDefault();
      dragRef.current = createBaseDragState({
        mode: "hand",
        startClientX: e.clientX,
        startClientY: e.clientY,
        origScrollLeft: scrollLeftRef.current,
        origScrollTop: vScrollRef.current?.scrollTop ?? 0,
        baseRecipe: recipe,
      });
      setCursorClass("cursor-grabbing");
      return;
    }

    if (e.button !== 0) return;
    const wrapRect = canvasWrapRef.current?.getBoundingClientRect();
    const x = wrapRect ? e.clientX - wrapRect.left : 0;
    const y = wrapRect ? e.clientY - wrapRect.top : 0;
    lastDragPointerRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
      ctrlOrMetaKey: e.ctrlKey || e.metaKey,
    };
    const hit = hitTestTimelineClip(
      recipe,
      x,
      y,
      scrollLeftRef.current,
      pxPerSec,
      laneHeight,
      selectedSet
    );

    if (!hit) {
      const marqueeMode = e.shiftKey
        ? "add"
        : e.ctrlKey || e.metaKey
        ? "toggle"
        : "replace";
      if (marqueeMode === "replace") onSelectClips([]);
      dragRef.current = createBaseDragState({
        mode: "marquee",
        startClientX: e.clientX,
        startClientY: e.clientY,
        origScrollLeft: scrollLeftRef.current,
        origScrollTop: vScrollRef.current?.scrollTop ?? 0,
        viewportLeft: wrapRect?.left ?? 0,
        viewportRight: wrapRect?.right ?? 0,
        viewportTop: wrapRect?.top ?? 0,
        baseRecipe: recipe,
        marqueeOriginX: x + scrollLeftRef.current,
        marqueeOriginY: Math.max(0, y),
        marqueeBaseSelected: [...selectedClipIds],
        marqueeMode,
      });
      setCursorClass("cursor-crosshair");
      return;
    }

    let nextSelectedIds = selectedClipIds;
    let collapseToSingleOnClick = false;
    const isCtrl = e.ctrlKey || e.metaKey;

    if (e.shiftKey && !isCtrl && !e.altKey) {
      const anchor = anchorClipIdRef.current ?? selectedClipIds[0] ?? hit.clip.id;
      nextSelectedIds = getShiftClickRangeClipIds(recipe, anchor, hit.clip.id);
      onSelectClips(nextSelectedIds);
    } else if (isCtrl) {
      const wasSelected = selectedSet.has(hit.clip.id);
      nextSelectedIds = wasSelected
        ? selectedClipIds.filter((id) => id !== hit.clip.id)
        : [...selectedClipIds, hit.clip.id];
      anchorClipIdRef.current = hit.clip.id;
      onSelectClips(nextSelectedIds);
      if (wasSelected) {
        return;
      }
    } else if (!selectedSet.has(hit.clip.id)) {
      nextSelectedIds = [hit.clip.id];
      anchorClipIdRef.current = hit.clip.id;
      onSelectClips(nextSelectedIds);
    } else if (selectedClipIds.length > 1) {
      collapseToSingleOnClick = !e.altKey;
    }

    const isAltClone = hit.zone === "body" && e.altKey;
    const targetIds =
      hit.zone === "body" && nextSelectedIds.includes(hit.clip.id)
        ? nextSelectedIds
        : [hit.clip.id];

    dragRef.current = createBaseDragState({
      mode: hit.zone,
      clipId: hit.clip.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origScrollLeft: scrollLeftRef.current,
      origScrollTop: vScrollRef.current?.scrollTop ?? 0,
      viewportLeft: wrapRect?.left ?? 0,
      viewportRight: wrapRect?.right ?? 0,
      origClip: { ...hit.clip },
      origLaneIndex: hit.laneIndex,
      dragClips: buildDraggedClipsList(recipe, targetIds, isAltClone),
      isAltClone,
      collapseToSingleOnClick,
      baseRecipe: recipe,
    });
    if (isAltClone) setCursorClass("cursor-copy");
  };

  useTimelineDragLoop({
    pxPerSec,
    laneHeight,
    snapEnabled,
    snapGridSec,
    sourceDurationBySampleId,
    dragRef,
    lastDragPointerRef,
    anchorClipIdRef,
    vScrollRef,
    scrollLeftRef,
    liveRecipeRef,
    dropPreviewRef,
    marqueeRectRef,
    drawRef,
    requestSeek,
    setHorizontalScroll,
    setCursorClass,
    setGhostNewLaneVisible,
    onSelectClips,
    onCommitRecipe,
  });

  const handleLaneMouseMoveHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const { x, y } = getLaneCoords(e.clientX, e.clientY);
    const hit = hitTestTimelineClip(
      recipe,
      x,
      y,
      scrollLeftRef.current,
      pxPerSec,
      laneHeight,
      selectedSet
    );
    const nextHover = hit?.clip.id ?? null;
    if (nextHover !== hoveredClipIdRef.current) {
      hoveredClipIdRef.current = nextHover;
      drawRef.current();
    }
    setCursorClass(
      !hit
        ? "cursor-default"
        : hit.zone === "body"
        ? e.altKey
          ? "cursor-copy"
          : "cursor-grab"
        : "cursor-ew-resize"
    );
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const dragged = getDraggedSamplesFromStore();
    if (dragged.length === 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const { x, y } = getLaneCoords(e.clientX, e.clientY);
    const preview = buildExternalDropPreview({
      x,
      y,
      scrollLeft: scrollLeftRef.current,
      pxPerSec,
      laneHeight,
      laneCount: recipe.lanes.length,
      snapEnabled,
      bypassSnap: e.ctrlKey || e.metaKey,
      snapGridSec,
      leadFileName: dragged[0].file_name,
      leadDurationMs: dragged[0].duration_ms,
    });
    dropPreviewRef.current = preview;
    setGhostNewLaneVisible(preview.isNewLane);
    drawRef.current();
  };

  const clearDropPreview = () => {
    if (dropPreviewRef.current || ghostNewLaneVisible) {
      dropPreviewRef.current = null;
      setGhostNewLaneVisible(false);
      drawRef.current();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const dragged = getDraggedSamplesFromStore();
    const preview = dropPreviewRef.current;
    clearDropPreview();
    if (dragged.length === 0 || !preview) return;
    e.preventDefault();
    e.stopPropagation();
    onDropSamplesAt(dragged, preview.laneIndex, preview.isNewLane, preview.startSec);
  };

  return {
    ghostNewLaneVisible,
    cursorClass,
    handleRulerMouseDown,
    handleLaneMouseDown,
    handleLaneMouseMoveHover,
    handleDragOver,
    clearDropPreview,
    handleDrop,
  };
}
