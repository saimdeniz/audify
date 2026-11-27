import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus } from "lucide-react";
import {
  getLayerDraftPlayheadSec,
  setLayerDraftPlayheadSec,
  subscribeLayerDraftPlayhead,
  subscribePlayhead,
} from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerRecipe, SampleItem } from "../../types";
import { useDevicePixelRatio } from "../../utils/devicePixelRatio";
import { isLayerDraftSample, MAX_LAYER_LANES } from "../../utils/layerHelpers";
import { requestPeaks, subscribePeaksCache } from "../../utils/peaksStore";
import { getCachedSampleByIdMap } from "../../utils/sampleLookup";
import { LayersLaneHeader } from "./LayersLaneHeader";
import { computePlayheadCenteredScrollLeft } from "./layersTimelineEditOps";
import {
  getTimelineSpanSec,
  TIMELINE_RULER_HEIGHT,
  TimelineMarqueeRect,
} from "./layersTimelineMath";
import {
  renderFixedTimelineRuler,
  renderLayersPlayheadOverlay,
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
  onSelectClips: (clipIds: string[]) => void;
  onCommitRecipe: (next: LayerRecipe) => void;
  onAddLane: () => void;
  onToggleMute: (laneId: string) => void;
  onToggleSolo: (laneId: string) => void;
  onChangeLaneVolume: (laneId: string, db: number, pushUndo?: boolean) => void;
  onRenameLane: (laneId: string, name: string) => void;
  onRemoveLane: (laneId: string) => void;
  onDropSamplesAt: (
    samples: SampleItem[],
    laneIndex: number,
    isNewLane: boolean,
    startSec: number
  ) => void;
  viewportWidthRef: React.MutableRefObject<number>;
}

/**
 * Interactive 60fps DaVinci-style Timeline stage featuring a fixed `24px` top ruler,
 * resizable lane headers, viewport-sized sticky scene canvas (immune to 16,384px GPU
 * height limits), a separate 60Hz playhead overlay canvas, clamped horizontal scrolling,
 * and Split-mode independent draft playhead tracking.
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
  onSelectClips,
  onCommitRecipe,
  onAddLane,
  onToggleMute,
  onToggleSolo,
  onChangeLaneVolume,
  onRenameLane,
  onRemoveLane,
  onDropSamplesAt,
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
  const playheadCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const scrollLeftRef = useRef(0);
  const scrollTopRef = useRef(0);
  const maxScrollRef = useRef(0);
  const prevPxPerSecRef = useRef(pxPerSec);
  const liveRecipeRef = useRef<LayerRecipe>(recipe);
  const hoveredClipIdRef = useRef<string | null>(null);
  const dropPreviewRef = useRef<TimelineDropPreview | null>(null);
  const marqueeRectRef = useRef<TimelineMarqueeRect | null>(null);
  const drawSceneRef = useRef<() => void>(() => {});
  const drawPlayheadRef = useRef<() => void>(() => {});

  const [viewportWidth, setViewportWidth] = useState(640);
  const [vScrollHeight, setVScrollHeight] = useState(240);

  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const missingSet = useMemo(() => new Set(missingClipIds), [missingClipIds]);

  // O(1) lookup via shared sample map ONLY for legacy saved clips missing `sourceDurationSec`
  const sourceDurationBySampleId = useMemo(() => {
    const map = new Map<number, number>();
    let needsLookup = false;
    for (const c of recipe.clips) {
      if (
        c.sourceSampleId !== null &&
        !(c.sourceDurationSec && c.sourceDurationSec > 0)
      ) {
        needsLookup = true;
        break;
      }
    }
    if (!needsLookup) return map;
    const sampleMap = getCachedSampleByIdMap(
      useSampleStore.getState().allProfileSamples
    );
    for (const c of recipe.clips) {
      if (c.sourceSampleId !== null && !map.has(c.sourceSampleId)) {
        const hit = sampleMap.get(c.sourceSampleId);
        if (hit) {
          map.set(c.sourceSampleId, Math.max(0.05, hit.duration_ms / 1000));
        }
      }
    }
    return map;
  }, [recipe.clips]);

  const timelineSpanSec = useMemo(() => getTimelineSpanSec(recipe, 8), [recipe]);
  const contentWidthPx = Math.max(
    viewportWidth,
    Math.ceil(timelineSpanSec * pxPerSec)
  );
  maxScrollRef.current = Math.max(0, contentWidthPx - viewportWidth);

  const setHorizontalScroll = useCallback((nextLeft: number) => {
    const clamped = Math.max(0, Math.min(maxScrollRef.current, nextLeft));
    if (Math.abs(clamped - scrollLeftRef.current) < 0.01) return;
    scrollLeftRef.current = clamped;
    if (hScrollRef.current) hScrollRef.current.scrollLeft = clamped;
    drawSceneRef.current();
    drawPlayheadRef.current();
  }, []);

  const drawBothRef = useRef<() => void>(() => {});
  drawBothRef.current = () => {
    drawSceneRef.current();
    drawPlayheadRef.current();
  };

  const interactions = useLayersTimelineInteractions({
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
    drawRef: drawBothRef,
    setHorizontalScroll,
    onChangePxPerSec,
    onChangeLaneHeight,
    onSelectClips,
    onCommitRecipe,
    onDropSamplesAt,
  });

  useEffect(() => {
    for (const clip of recipe.clips) {
      if (clip.sourceSampleId !== null && clip.sourceSampleId > 0) {
        requestPeaks(clip.sourceSampleId);
      }
    }
  }, [recipe.clips]);

  const lanesPixelHeight =
    (recipe.lanes.length + (interactions.ghostNewLaneVisible ? 1 : 0)) * laneHeight;
  const canvasLogicalHeight = Math.max(vScrollHeight, lanesPixelHeight + laneHeight);
  const stickyViewportH = Math.max(laneHeight, Math.min(vScrollHeight, canvasLogicalHeight));

  // Re-clamp horizontal scroll whenever content shrinks or viewport expands, and keep playhead-centered zoom.
  useLayoutEffect(() => {
    const maxScroll = Math.max(0, contentWidthPx - viewportWidth);
    maxScrollRef.current = maxScroll;
    const prevPx = prevPxPerSecRef.current;
    if (prevPx !== pxPerSec) {
      prevPxPerSecRef.current = pxPerSec;
      const nextLeft = computePlayheadCenteredScrollLeft(
        getLayerDraftPlayheadSec(),
        prevPx,
        pxPerSec,
        scrollLeftRef.current,
        viewportWidth,
        contentWidthPx
      );
      scrollLeftRef.current = nextLeft;
      if (hScrollRef.current) hScrollRef.current.scrollLeft = nextLeft;
      drawBothRef.current();
      return;
    }
    if (scrollLeftRef.current > maxScroll) {
      scrollLeftRef.current = maxScroll;
      if (hScrollRef.current) hScrollRef.current.scrollLeft = maxScroll;
      drawBothRef.current();
    }
  }, [pxPerSec, contentWidthPx, viewportWidth]);

  const drawPlayheadAndRuler = useCallback(() => {
    const width = Math.max(100, Math.floor(viewportWidth));
    const height = Math.max(laneHeight, Math.floor(stickyViewportH));
    const playheadSec = getLayerDraftPlayheadSec();

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

    const phCanvas = playheadCanvasRef.current;
    if (phCanvas) {
      const pw = Math.floor(width * liveDpr);
      const ph = Math.floor(height * liveDpr);
      if (phCanvas.width !== pw || phCanvas.height !== ph) {
        phCanvas.width = pw;
        phCanvas.height = ph;
      }
      const pCtx = phCanvas.getContext("2d");
      if (pCtx) {
        renderLayersPlayheadOverlay(pCtx, {
          width,
          height,
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
  }, [
    viewportWidth,
    stickyViewportH,
    laneHeight,
    liveDpr,
    pxPerSec,
    themeMode,
    accentColor,
    enableMica,
  ]);
  drawPlayheadRef.current = drawPlayheadAndRuler;

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(100, Math.floor(viewportWidth));
    const height = Math.max(laneHeight, Math.floor(stickyViewportH));
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
      scrollTopPx: scrollTopRef.current,
      pxPerSec,
      laneHeight,
      recipe: liveRecipeRef.current,
      selectedClipIds: selectedSet,
      missingClipIds: missingSet,
      hoveredClipId: hoveredClipIdRef.current,
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
    stickyViewportH,
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
  drawSceneRef.current = drawScene;

  useEffect(() => {
    drawScene();
    drawPlayheadAndRuler();
  }, [drawScene, drawPlayheadAndRuler, recipe]);

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
    const unsubMainPlay = subscribePlayhead((sec) => {
      const st = useSampleStore.getState();
      // Only mirror global playhead into Layers timeline when the Layers Draft itself is active!
      if (!isLayerDraftSample(st.selectedSample)) return;
      setLayerDraftPlayheadSec(sec);
    });

    const unsubDraftPlay = subscribeLayerDraftPlayhead((sec) => {
      const { followMode: mode, pxPerSec: pps, viewportWidth: vw, contentWidthPx: cw } =
        followParamsRef.current;
      const st = useSampleStore.getState();
      let scrolled = false;
      if (mode !== "off" && st.isPlaying && isLayerDraftSample(st.selectedSample)) {
        const maxScroll = Math.max(0, cw - vw);
        if (maxScroll > 0) {
          const playheadPx = sec * pps;
          const curLeft = scrollLeftRef.current;
          let nextLeft: number | null = null;
          if (mode === "page") {
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
            scrolled = true;
          }
        }
      }
      if (scrolled) drawSceneRef.current();
      drawPlayheadRef.current();
    });

    const unsubPeaks = subscribePeaksCache(() => drawSceneRef.current());
    return () => {
      unsubMainPlay();
      unsubDraftPlay();
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
      tabIndex={-1}
      className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-0 outline-none"
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
          title="Click or drag ruler to position timeline playhead"
        >
          <canvas
            ref={rulerCanvasRef}
            className="block pointer-events-none"
            style={{ width: viewportWidth, height: TIMELINE_RULER_HEIGHT }}
          />
        </div>
      </div>

      {/* VERTICALLY SCROLLABLE SYNCHRONIZED LANES + VIEWPORT-SIZED STICKY CANVAS */}
      <div
        ref={vScrollRef}
        onScroll={(e) => {
          scrollTopRef.current = e.currentTarget.scrollTop;
          drawSceneRef.current();
        }}
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
              drawSceneRef.current();
            }
          }}
          onDragOver={interactions.handleDragOver}
          onDragLeave={interactions.clearDropPreview}
          onDrop={interactions.handleDrop}
          style={{ height: canvasLogicalHeight }}
          className={`flex-1 min-w-0 relative bg-surface-0 ${interactions.cursorClass}`}
        >
          <div
            style={{ height: stickyViewportH }}
            className="sticky top-0 left-0 w-full overflow-hidden pointer-events-none"
          >
            <canvas
              ref={canvasRef}
              className="block"
              style={{ width: viewportWidth, height: stickyViewportH }}
            />
            <canvas
              ref={playheadCanvasRef}
              className="block absolute inset-0"
              style={{ width: viewportWidth, height: stickyViewportH }}
            />
          </div>
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
            scrollLeftRef.current = Math.min(
              maxScrollRef.current,
              e.currentTarget.scrollLeft
            );
            drawBothRef.current();
          }}
          className="flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: contentWidthPx, height: 1 }} />
        </div>
      </div>
    </div>
  );
};
