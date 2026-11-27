import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus } from "lucide-react";
import { getPlayheadSec, subscribePlayhead } from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerRecipe, SampleItem } from "../../types";
import { useDevicePixelRatio } from "../../utils/devicePixelRatio";
import { MAX_LAYER_LANES } from "../../utils/layerHelpers";
import { requestPeaks, subscribePeaksCache } from "../../utils/peaksStore";
import { LayersLaneHeader } from "./LayersLaneHeader";
import {
  computePlayheadCenteredScrollLeft,
  getTimelineSpanSec,
  TIMELINE_RULER_HEIGHT,
  TimelineMarqueeRect,
} from "./layersTimelineMath";
import {
  renderFixedTimelineRuler,
  renderLayersTimelineCanvas,
  TimelineDropPreview,
} from "./layersTimelineRenderer";
import { useLayersTimelineInteractions } from "./useLayersTimelineInteractions";

export type TimelineFollowMode = "page" | "smooth" | "off";

interface LayersTimelineCanvasProps {
  recipe: LayerRecipe;
  selectedClipIds: string[];
  missingClipIds: string[];
  pxPerSec: number;
  laneHeight: number;
  laneHeaderWidth: number;
  snapEnabled: boolean;
  snapGridSec: number;
  followMode: TimelineFollowMode;
  onStartLaneHeaderResize: (e: React.MouseEvent) => void;
  onChangePxPerSec: (next: number) => void;
  onChangeLaneHeight: (next: number) => void;
  onFitAll: (viewportWidth: number) => void;
  onSelectClips: (clipIds: string[]) => void;
  onCommitRecipe: (next: LayerRecipe) => void;
  onAddLane: () => void;
  onToggleMute: (laneId: string) => void;
  onToggleSolo: (laneId: string) => void;
  onChangeLaneVolume: (laneId: string, db: number) => void;
  onRenameLane: (laneId: string, name: string) => void;
  onRemoveLane: (laneId: string) => void;
  onDropSamplesAt: (
    samples: SampleItem[],
    laneIndex: number,
    isNewLane: boolean,
    startSec: number
  ) => void;
  onSplitAtPlayhead: () => void;
  onCopySelected: () => void;
  onPasteAtPlayhead: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  viewportWidthRef: React.MutableRefObject<number>;
}

/**
 * Interactive 60fps DaVinci-style Timeline stage featuring a fixed `24px` top ruler,
 * resizable lane headers, exact 1:1 logical-to-CSS pixel canvas sizing (zero hit-test drift),
 * DaVinci mouse navigation (`useLayersTimelineInteractions`), and Ghost Lane drag-and-drop.
 */
export const LayersTimelineCanvas: React.FC<LayersTimelineCanvasProps> = ({
  recipe,
  selectedClipIds,
  missingClipIds,
  pxPerSec,
  laneHeight,
  laneHeaderWidth,
  snapEnabled,
  snapGridSec,
  followMode,
  onStartLaneHeaderResize,
  onChangePxPerSec,
  onChangeLaneHeight,
  onFitAll,
  onSelectClips,
  onCommitRecipe,
  onAddLane,
  onToggleMute,
  onToggleSolo,
  onChangeLaneVolume,
  onRenameLane,
  onRemoveLane,
  onDropSamplesAt,
  onSplitAtPlayhead,
  onCopySelected,
  onPasteAtPlayhead,
  onDuplicateSelected,
  onDeleteSelected,
  viewportWidthRef,
}) => {
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);
  const enableMica = useSampleStore((s) => s.enableMica);
  const liveDpr = useDevicePixelRatio();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const vScrollRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);
  const rulerWrapRef = useRef<HTMLDivElement | null>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const scrollLeftRef = useRef(0);
  const prevPxPerSecRef = useRef(pxPerSec);
  const liveRecipeRef = useRef<LayerRecipe>(recipe);
  const hoveredClipIdRef = useRef<string | null>(null);
  const dropPreviewRef = useRef<TimelineDropPreview | null>(null);
  const marqueeRectRef = useRef<TimelineMarqueeRect | null>(null);
  const drawRef = useRef<() => void>(() => {});

  const [viewportWidth, setViewportWidth] = useState(640);
  const [vScrollHeight, setVScrollHeight] = useState(240);

  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const missingSet = useMemo(() => new Set(missingClipIds), [missingClipIds]);

  const sourceDurationBySampleId = useMemo(() => {
    const map = new Map<number, number>();
    const pool = useSampleStore.getState().allProfileSamples;
    const needed = new Set<number>();
    for (const c of recipe.clips) {
      if (c.sourceSampleId !== null) needed.add(c.sourceSampleId);
    }
    if (needed.size > 0 && pool.length > 0) {
      for (let i = 0; i < pool.length && map.size < needed.size; i++) {
        if (needed.has(pool[i].id)) {
          map.set(pool[i].id, Math.max(0.05, pool[i].duration_ms / 1000));
        }
      }
    }
    return map;
  }, [recipe.clips]);

  const setHorizontalScroll = useCallback((nextLeft: number) => {
    const clamped = Math.max(0, nextLeft);
    scrollLeftRef.current = clamped;
    if (hScrollRef.current) hScrollRef.current.scrollLeft = clamped;
    drawRef.current();
  }, []);

  const interactions = useLayersTimelineInteractions({
    recipe,
    selectedClipIds,
    selectedSet,
    pxPerSec,
    laneHeight,
    viewportWidth,
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
    onFitAll,
    onSelectClips,
    onCommitRecipe,
    onDropSamplesAt,
    onSplitAtPlayhead,
    onCopySelected,
    onPasteAtPlayhead,
    onDuplicateSelected,
    onDeleteSelected,
  });

  useEffect(() => {
    for (const clip of recipe.clips) {
      if (clip.sourceSampleId !== null && clip.sourceSampleId > 0) {
        requestPeaks(clip.sourceSampleId);
      }
    }
  }, [recipe.clips]);

  const timelineSpanSec = useMemo(() => getTimelineSpanSec(recipe, 8), [recipe]);
  const contentWidthPx = Math.max(
    viewportWidth,
    Math.ceil(timelineSpanSec * pxPerSec)
  );
  const lanesPixelHeight =
    (recipe.lanes.length + (interactions.ghostNewLaneVisible ? 1 : 0)) * laneHeight;
  const canvasLogicalHeight = Math.max(vScrollHeight, lanesPixelHeight + laneHeight);

  // Apply Playhead-centered horizontal scroll AFTER contentWidthPx updates in the DOM
  // so both Alt+Scroll and Zoom Slider never suffer premature browser scrollLeft clamping.
  useLayoutEffect(() => {
    const prevPx = prevPxPerSecRef.current;
    if (prevPx === pxPerSec) return;
    prevPxPerSecRef.current = pxPerSec;
    const nextLeft = computePlayheadCenteredScrollLeft(
      getPlayheadSec(),
      prevPx,
      pxPerSec,
      scrollLeftRef.current,
      viewportWidth,
      contentWidthPx
    );
    scrollLeftRef.current = nextLeft;
    if (hScrollRef.current) {
      hScrollRef.current.scrollLeft = nextLeft;
    }
    drawRef.current();
  }, [pxPerSec, contentWidthPx, viewportWidth]);

  const draw = useCallback(() => {
    const width = Math.max(100, Math.floor(viewportWidth));
    const playheadSec = getPlayheadSec();

    const rulerCanvas = rulerCanvasRef.current;
    if (rulerCanvas) {
      const rw = Math.floor(width * liveDpr);
      const rh = Math.floor(TIMELINE_RULER_HEIGHT * liveDpr);
      if (rulerCanvas.width !== rw || rulerCanvas.height !== rh) {
        rulerCanvas.width = rw;
        rulerCanvas.height = rh;
      }
      const rCtx = rulerCanvas.getContext("2d");
      if (rCtx) {
        renderFixedTimelineRuler(rCtx, {
          width,
          dpr: liveDpr,
          scrollLeftPx: scrollLeftRef.current,
          pxPerSec,
          playheadSec,
          themeMode,
          accentColor,
          enableMica,
        });
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const height = Math.max(laneHeight, Math.floor(canvasLogicalHeight));
    const targetW = Math.floor(width * liveDpr);
    const targetH = Math.floor(height * liveDpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderLayersTimelineCanvas(ctx, {
      width,
      height,
      dpr: liveDpr,
      scrollLeftPx: scrollLeftRef.current,
      pxPerSec,
      laneHeight,
      recipe: liveRecipeRef.current,
      selectedClipIds: selectedSet,
      missingClipIds: missingSet,
      hoveredClipId: hoveredClipIdRef.current,
      playheadSec,
      snapEnabled,
      snapGridSec,
      themeMode,
      accentColor,
      enableMica,
      dropPreview: dropPreviewRef.current,
      marqueeRect: marqueeRectRef.current,
      sourceDurationBySampleId,
    });
  }, [
    viewportWidth,
    canvasLogicalHeight,
    laneHeight,
    liveDpr,
    pxPerSec,
    selectedSet,
    missingSet,
    snapEnabled,
    snapGridSec,
    themeMode,
    accentColor,
    enableMica,
    sourceDurationBySampleId,
  ]);
  drawRef.current = draw;

  useEffect(() => {
    draw();
  }, [draw, recipe]);

  const followParamsRef = useRef({
    followMode,
    pxPerSec,
    viewportWidth,
    contentWidthPx,
  });
  followParamsRef.current = {
    followMode,
    pxPerSec,
    viewportWidth,
    contentWidthPx,
  };

  useEffect(() => {
    const unsubPlay = subscribePlayhead((sec) => {
      const { followMode: mode, pxPerSec: pps, viewportWidth: vw, contentWidthPx: cw } =
        followParamsRef.current;
      if (mode !== "off" && useSampleStore.getState().isPlaying) {
        const maxScroll = Math.max(0, cw - vw);
        if (maxScroll > 0) {
          const playheadPx = sec * pps;
          const curLeft = scrollLeftRef.current;
          let nextLeft: number | null = null;
          if (mode === "page") {
            // DaVinci Page Scroll: jump cleanly to next page when playhead leaves viewport
            if (playheadPx > curLeft + vw - 20 || playheadPx < curLeft) {
              nextLeft = Math.max(0, Math.min(maxScroll, playheadPx - vw * 0.12));
            }
          } else if (mode === "smooth") {
            const target = Math.max(0, Math.min(maxScroll, playheadPx - vw * 0.5));
            if (Math.abs(target - curLeft) >= 1) {
              nextLeft = target;
            }
          }
          if (nextLeft !== null && Math.abs(nextLeft - curLeft) >= 0.5) {
            scrollLeftRef.current = nextLeft;
            if (hScrollRef.current) hScrollRef.current.scrollLeft = nextLeft;
          }
        }
      }
      drawRef.current();
    });
    const unsubPeaks = subscribePeaksCache(() => drawRef.current());
    return () => {
      unsubPlay();
      unsubPeaks();
    };
  }, []);

  useEffect(() => {
    const cw = canvasWrapRef.current;
    const vs = vScrollRef.current;
    if (!cw || !vs) return;
    const sync = () => {
      const nextW = Math.max(100, Math.floor(cw.clientWidth));
      const nextH = Math.max(80, Math.floor(vs.clientHeight));
      viewportWidthRef.current = nextW;
      setViewportWidth((prev) => (prev === nextW ? prev : nextW));
      setVScrollHeight((prev) => (prev === nextH ? prev : nextH));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(cw);
    ro.observe(vs);
    return () => ro.disconnect();
  }, [viewportWidthRef]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={interactions.handleKeyDown}
      className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-0 focus:outline-none"
    >
      {/* FIXED / STICKY TOP RULER ROW */}
      <div
        style={{ height: TIMELINE_RULER_HEIGHT }}
        className="flex border-b border-line bg-surface-2 shrink-0 select-none"
      >
        <div
          style={{ width: laneHeaderWidth }}
          className="px-2.5 border-r border-line flex items-center justify-between shrink-0 relative"
        >
          <span className="font-mono text-[9.5px] uppercase tracking-wider font-semibold text-fg-head truncate">
            LANES ({recipe.lanes.length})
          </span>
          <button
            type="button"
            onClick={onAddLane}
            disabled={recipe.lanes.length >= MAX_LAYER_LANES}
            className="h-[18px] px-1.5 rounded-[2px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-40 text-[10px] font-medium inline-flex items-center gap-0.5 shrink-0 transition-colors cursor-pointer"
            title={`Add new audio lane (max ${MAX_LAYER_LANES})`}
          >
            <Plus className="w-2.5 h-2.5" />
            <span>Lane</span>
          </button>
          <div
            onMouseDown={onStartLaneHeaderResize}
            title="Drag to resize Lanes panel width"
            className="absolute top-0 bottom-0 right-[-3px] w-[6px] cursor-col-resize hover:bg-accent/60 z-20 transition-colors"
          />
        </div>

        <div
          ref={rulerWrapRef}
          onMouseDown={interactions.handleRulerMouseDown}
          className="flex-1 min-w-0 relative cursor-pointer overflow-hidden"
          title="Click or drag ruler to position playhead"
        >
          <canvas
            ref={rulerCanvasRef}
            className="block pointer-events-none"
            style={{ width: viewportWidth, height: TIMELINE_RULER_HEIGHT }}
          />
        </div>
      </div>

      {/* VERTICALLY SCROLLABLE SYNCHRONIZED LANES + 1:1 CANVAS */}
      <div
        ref={vScrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex relative"
      >
        <LayersLaneHeader
          lanes={recipe.lanes}
          widthPx={laneHeaderWidth}
          laneHeight={laneHeight}
          ghostNewLaneVisible={interactions.ghostNewLaneVisible}
          onStartResize={onStartLaneHeaderResize}
          onToggleMute={onToggleMute}
          onToggleSolo={onToggleSolo}
          onChangeVolume={onChangeLaneVolume}
          onRenameLane={onRenameLane}
          onRemoveLane={onRemoveLane}
        />

        <div
          ref={canvasWrapRef}
          onMouseDown={interactions.handleLaneMouseDown}
          onMouseMove={interactions.handleLaneMouseMoveHover}
          onMouseLeave={() => {
            if (hoveredClipIdRef.current !== null) {
              hoveredClipIdRef.current = null;
              drawRef.current();
            }
          }}
          onDragOver={interactions.handleDragOver}
          onDragLeave={interactions.clearDropPreview}
          onDrop={interactions.handleDrop}
          style={{ height: canvasLogicalHeight }}
          className={`flex-1 min-w-0 relative bg-surface-0 overflow-hidden ${interactions.cursorClass}`}
        >
          <canvas
            ref={canvasRef}
            className="block pointer-events-none"
            style={{ width: viewportWidth, height: canvasLogicalHeight }}
          />
          {recipe.clips.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[14px] flex justify-center px-4">
              <span className="px-2.5 py-1 rounded-[3px] bg-surface-1 border border-line text-[11px] text-fg-3">
                Drag tracks from the Sample Library above onto any lane (or
                below the last lane for a new lane), or right-click →{" "}
                <strong className="text-fg-2 font-medium">Layers</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* HORIZONTAL SCROLLBAR SYNCED WITH TIMELINE */}
      <div className="h-[11px] flex border-t border-line bg-surface-1 shrink-0">
        <div
          style={{ width: laneHeaderWidth }}
          className="border-r border-line shrink-0"
        />
        <div
          ref={hScrollRef}
          onScroll={(e) => {
            scrollLeftRef.current = e.currentTarget.scrollLeft;
            drawRef.current();
          }}
          className="flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: contentWidthPx, height: 1 }} />
        </div>
      </div>
    </div>
  );
};
