import React, { useEffect } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerRecipe } from "../../types";
import {
  ActiveDragState,
  applyTrimOrFadeDrag,
  combineMarqueeSelection,
  computeBodyDragFrame,
  computeEdgeAutoScrollStep,
  finalizeDragCommitRecipe,
} from "./layersTimelineDragHelpers";
import {
  getClipsInMarqueeRect,
  TimelineMarqueeRect,
} from "./layersTimelineMath";
import type { TimelineDropPreview } from "./layersTimelineRenderer";

export interface DragPointerSnapshot {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlOrMetaKey: boolean;
}

interface UseTimelineDragLoopParams {
  pxPerSec: number;
  laneHeight: number;
  snapEnabled: boolean;
  snapGridSec: number;
  sourceDurationBySampleId: ReadonlyMap<number, number>;
  dragRef: React.MutableRefObject<ActiveDragState | null>;
  lastDragPointerRef: React.MutableRefObject<DragPointerSnapshot | null>;
  anchorClipIdRef: React.MutableRefObject<string | null>;
  vScrollRef: React.RefObject<HTMLDivElement | null>;
  scrollLeftRef: React.MutableRefObject<number>;
  liveRecipeRef: React.MutableRefObject<LayerRecipe>;
  dropPreviewRef: React.MutableRefObject<TimelineDropPreview | null>;
  marqueeRectRef: React.MutableRefObject<TimelineMarqueeRect | null>;
  drawRef: React.MutableRefObject<() => void>;
  requestSeek: (timeSec: number, playImmediately?: boolean) => void;
  setHorizontalScroll: (next: number) => void;
  setCursorClass: (cls: string) => void;
  setGhostNewLaneVisible: (v: boolean) => void;
  onSelectClips: (ids: string[]) => void;
  onCommitRecipe: (next: LayerRecipe) => void;
}

/**
 * Manages active window-level pointer drag sessions (`scrub`, `hand`, `marquee`,
 * `body`, `trim`, `fade`) and runs 60fps accelerated Edge Auto-Scroll when
 * dragging near/beyond the horizontal edges of the timeline viewport.
 */
export function useTimelineDragLoop(params: UseTimelineDragLoopParams): void {
  const {
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
  } = params;

  useEffect(() => {
    let edgeScrollRafId: number | null = null;

    const applyDragAtPointer = (
      drag: ActiveDragState,
      clientX: number,
      clientY: number,
      shiftKey: boolean,
      ctrlOrMetaKey: boolean
    ) => {
      if (drag.mode === "scrub") {
        const x = clientX - drag.viewportLeft;
        requestSeek(
          Math.max(0, (x + scrollLeftRef.current) / pxPerSec),
          useSampleStore.getState().isPlaying
        );
        return;
      }

      if (drag.mode === "hand") {
        setHorizontalScroll(drag.origScrollLeft - (clientX - drag.startClientX));
        if (vScrollRef.current) {
          vScrollRef.current.scrollTop = Math.max(
            0,
            drag.origScrollTop - (clientY - drag.startClientY)
          );
        }
        return;
      }

      if (drag.mode === "marquee") {
        const x = clientX - drag.viewportLeft;
        const y = clientY - drag.viewportTop;
        const rect: TimelineMarqueeRect = {
          x1: drag.marqueeOriginX,
          y1: drag.marqueeOriginY,
          x2: x + scrollLeftRef.current,
          y2: Math.max(0, y),
        };
        marqueeRectRef.current = rect;
        drag.dirty = true;
        const hits = getClipsInMarqueeRect(drag.baseRecipe, rect, pxPerSec, laneHeight);
        onSelectClips(
          combineMarqueeSelection(drag.marqueeMode, drag.marqueeBaseSelected, hits)
        );
        drawRef.current();
        return;
      }

      const orig = drag.origClip;
      if (!orig) return;
      const scrollDeltaPx = scrollLeftRef.current - drag.origScrollLeft;
      if (
        !drag.dirty &&
        Math.hypot(
          clientX - drag.startClientX + scrollDeltaPx,
          clientY - drag.startClientY
        ) < 3
      ) {
        return;
      }

      if (drag.mode === "body") {
        const { nextRecipe, needNewLanes, ghostPreview } = computeBodyDragFrame({
          drag,
          clientX,
          clientY,
          scrollDeltaPx,
          shiftKey,
          ctrlOrMetaKey,
          pxPerSec,
          laneHeight,
          snapEnabled,
          snapGridSec,
        });
        drag.pendingNewLanesCount = needNewLanes;
        if (ghostPreview) {
          setGhostNewLaneVisible(true);
          dropPreviewRef.current = ghostPreview;
        } else if (dropPreviewRef.current) {
          setGhostNewLaneVisible(false);
          dropPreviewRef.current = null;
        }
        drag.dirty = true;
        liveRecipeRef.current = nextRecipe;
        drawRef.current();
        return;
      }

      const deltaSec = (clientX - drag.startClientX + scrollDeltaPx) / pxPerSec;
      const updated = applyTrimOrFadeDrag(
        drag.mode,
        orig,
        deltaSec,
        sourceDurationBySampleId
      );
      drag.dirty = true;
      liveRecipeRef.current = {
        ...drag.baseRecipe,
        clips: drag.baseRecipe.clips.map((c) => (c.id === drag.clipId ? updated : c)),
      };
      drawRef.current();
    };

    const canEdgeAutoScroll = (mode: ActiveDragState["mode"]) =>
      mode !== "hand" && mode !== "fade-in" && mode !== "fade-out";

    const runEdgeAutoScrollTick = () => {
      edgeScrollRafId = null;
      const drag = dragRef.current;
      const ptr = lastDragPointerRef.current;
      if (!drag || !ptr || !canEdgeAutoScroll(drag.mode)) return;

      const step = computeEdgeAutoScrollStep(
        ptr.clientX,
        drag.viewportLeft,
        drag.viewportRight
      );
      if (step === 0) return;

      const before = scrollLeftRef.current;
      setHorizontalScroll(before + step);
      if (scrollLeftRef.current !== before) {
        applyDragAtPointer(
          drag,
          ptr.clientX,
          ptr.clientY,
          ptr.shiftKey,
          ptr.ctrlOrMetaKey
        );
      }
      edgeScrollRafId = window.requestAnimationFrame(runEdgeAutoScrollTick);
    };

    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      lastDragPointerRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        ctrlOrMetaKey: e.ctrlKey || e.metaKey,
      };
      applyDragAtPointer(
        drag,
        e.clientX,
        e.clientY,
        e.shiftKey,
        e.ctrlKey || e.metaKey
      );
      if (
        edgeScrollRafId === null &&
        canEdgeAutoScroll(drag.mode) &&
        computeEdgeAutoScrollStep(e.clientX, drag.viewportLeft, drag.viewportRight) !== 0
      ) {
        edgeScrollRafId = window.requestAnimationFrame(runEdgeAutoScrollTick);
      }
    };

    const onUp = (e: MouseEvent) => {
      if (edgeScrollRafId !== null) {
        window.cancelAnimationFrame(edgeScrollRafId);
        edgeScrollRafId = null;
      }
      lastDragPointerRef.current = null;
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setCursorClass("cursor-default");

      if (drag.mode === "marquee") {
        marqueeRectRef.current = null;
        drawRef.current();
        return;
      }
      if (dropPreviewRef.current) {
        dropPreviewRef.current = null;
        setGhostNewLaneVisible(false);
      }
      if (!drag.dirty) {
        if (drag.collapseToSingleOnClick && drag.clipId) {
          anchorClipIdRef.current = drag.clipId;
          onSelectClips([drag.clipId]);
        }
        return;
      }
      if (drag.mode === "scrub" || drag.mode === "hand") return;

      const committed = finalizeDragCommitRecipe(
        drag,
        liveRecipeRef.current,
        e.clientY,
        laneHeight
      );
      if (drag.mode === "body" && drag.isAltClone) {
        const clonedIds = drag.dragClips.map((d) => d.activeId);
        anchorClipIdRef.current = clonedIds[0] ?? null;
        onSelectClips(clonedIds);
      }
      onCommitRecipe(committed);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      if (edgeScrollRafId !== null) {
        window.cancelAnimationFrame(edgeScrollRafId);
        edgeScrollRafId = null;
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [
    pxPerSec,
    laneHeight,
    snapEnabled,
    snapGridSec,
    requestSeek,
    vScrollRef,
    scrollLeftRef,
    liveRecipeRef,
    dropPreviewRef,
    marqueeRectRef,
    drawRef,
    setHorizontalScroll,
    setCursorClass,
    setGhostNewLaneVisible,
    onSelectClips,
    onCommitRecipe,
    sourceDurationBySampleId,
    dragRef,
    lastDragPointerRef,
    anchorClipIdRef,
  ]);
}
