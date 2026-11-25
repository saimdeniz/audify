import React, { useEffect, useRef, useState } from "react";
import { resetPlayheadClock } from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem, SliceRange } from "../../types";
import { startNativeSliceDrag } from "../../utils/drag";
import { isSlicePreviewSample } from "../../utils/slicePreview";
import {
  computeWheelZoomFactor,
  panWaveformViewportByScreenDelta,
  screenRatioToTrackRatio,
  trackRatioToScreenRatio,
  WaveformViewport,
  zoomWaveformViewportAt,
} from "./waveformViewport";

export type CanvasDragMode =
  | "none"
  | "scrubbing"
  | "panning"
  | "creating"
  | "resize-start"
  | "resize-end";

interface UseWaveformDeckInteractionsParams {
  selectedSample: SampleItem | null;
  effectiveDuration: number;
  sliceRange: SliceRange | null;
  autoBinOnNleDrag: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerRectRef: React.MutableRefObject<{ left: number; width: number }>;
  viewportRef: React.MutableRefObject<WaveformViewport>;
  setViewport: (next: WaveformViewport, interactive?: boolean) => void;
  hoverRatioRef: React.MutableRefObject<number | null>;
  scheduleDraw: () => void;
}

export function useWaveformDeckInteractions({
  selectedSample,
  effectiveDuration,
  sliceRange,
  autoBinOnNleDrag,
  containerRef,
  containerRectRef,
  viewportRef,
  setViewport,
  hoverRatioRef,
  scheduleDraw,
}: UseWaveformDeckInteractionsParams) {
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const recordSliceExport = useSampleStore((s) => s.recordSliceExport);
  const requestSeek = useSampleStore((s) => s.requestSeek);
  const setSliceRange = useSampleStore((s) => s.setSliceRange);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  const [hoverZone, setHoverZone] = useState<
    "none" | "slice-body" | "slice-edge"
  >("none");
  const [dragMode, setDragMode] = useState<CanvasDragMode>("none");
  const regionAnchorSecRef = useRef<number | null>(null);
  const activeWindowCleanupRef = useRef<(() => void) | null>(null);
  const selectedSampleRef = useRef(selectedSample);
  selectedSampleRef.current = selectedSample;

  useEffect(() => {
    return () => {
      if (activeWindowCleanupRef.current) {
        activeWindowCleanupRef.current();
        activeWindowCleanupRef.current = null;
      }
    };
  }, []);

  const attachWindowDrag = (
    onMove: (evt: MouseEvent, cleanup: () => void) => void,
    onUp: (cleanup: () => void) => void
  ) => {
    const cleanup = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      if (activeWindowCleanupRef.current === cleanup) {
        activeWindowCleanupRef.current = null;
      }
    };
    const handleMove = (evt: MouseEvent) => onMove(evt, cleanup);
    const handleUp = () => onUp(cleanup);
    if (activeWindowCleanupRef.current) activeWindowCleanupRef.current();
    activeWindowCleanupRef.current = cleanup;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const refreshContainerRect = () => {
    const container = containerRef.current;
    if (!container) return containerRectRef.current;
    const box = container.getBoundingClientRect();
    containerRectRef.current = { left: box.left, width: box.width };
    return containerRectRef.current;
  };

  const clientXToTrackRatio = (
    clientX: number,
    rect: { left: number; width: number }
  ) => {
    const screenRatio = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width)
    );
    return screenRatioToTrackRatio(screenRatio, viewportRef.current);
  };

  const secToScreenX = (sec: number, rectWidth: number) =>
    trackRatioToScreenRatio(sec / effectiveDuration, viewportRef.current) *
    rectWidth;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!selectedSampleRef.current) return;
      let rect = containerRectRef.current;
      if (rect.width <= 0) {
        const box = container.getBoundingClientRect();
        rect = { left: box.left, width: box.width };
        containerRectRef.current = rect;
      }
      if (rect.width <= 0) return;

      const curVp = viewportRef.current;
      const hasHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);

      if (e.shiftKey || hasHorizontal) {
        if (curVp.zoom <= 1) return;
        e.preventDefault();
        const deltaPx = hasHorizontal ? e.deltaX : e.deltaY;
        const nextVp = panWaveformViewportByScreenDelta(
          curVp,
          (deltaPx / rect.width) * 0.45
        );
        if (nextVp.startRatio === curVp.startRatio) return;
        const screenRatio = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width)
        );
        hoverRatioRef.current = screenRatioToTrackRatio(screenRatio, nextVp);
        setViewport(nextVp, true);
        return;
      }

      if (Math.abs(e.deltaY) < 0.01) return;
      e.preventDefault();
      const cursorScreenRatio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      const zoomFactor = computeWheelZoomFactor(e.deltaY, e.deltaMode);
      const nextVp = zoomWaveformViewportAt(
        curVp,
        cursorScreenRatio,
        zoomFactor
      );
      if (
        nextVp.zoom === curVp.zoom &&
        nextVp.startRatio === curVp.startRatio
      ) {
        return;
      }
      hoverRatioRef.current = screenRatioToTrackRatio(
        cursorScreenRatio,
        nextVp
      );
      setViewport(nextVp, true);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [
    containerRef,
    containerRectRef,
    viewportRef,
    setViewport,
    hoverRatioRef,
  ]);

  const beginWindowPanDrag = (startClientX: number) => {
    const startVp = viewportRef.current;
    if (startVp.zoom <= 1) return;
    setDragMode("panning");
    attachWindowDrag(
      (moveEvt, cleanup) => {
        if ((moveEvt.buttons & 4) !== 4) {
          cleanup();
          setDragMode("none");
          return;
        }
        const rect =
          containerRectRef.current.width > 0
            ? containerRectRef.current
            : refreshContainerRect();
        if (rect.width <= 0) return;
        const dxScreenRatio = -(moveEvt.clientX - startClientX) / rect.width;
        const nextVp = panWaveformViewportByScreenDelta(startVp, dxScreenRatio);
        hoverRatioRef.current = clientXToTrackRatio(moveEvt.clientX, rect);
        setViewport(nextVp, true);
      },
      (cleanup) => {
        cleanup();
        setDragMode("none");
      }
    );
  };

  const beginWindowSliceDrag = (
    mode: Exclude<CanvasDragMode, "none" | "scrubbing" | "panning">,
    anchorSec: number | null,
    initialRange: SliceRange | null
  ) => {
    regionAnchorSecRef.current = anchorSec;
    setDragMode(mode);
    let latestRange = initialRange;
    if (initialRange) {
      setSliceRange(initialRange);
    }
    const dur = effectiveDuration;
    attachWindowDrag(
      (moveEvt) => {
        const rect =
          containerRectRef.current.width > 0
            ? containerRectRef.current
            : refreshContainerRect();
        if (rect.width <= 0) return;
        const ratio = clientXToTrackRatio(moveEvt.clientX, rect);
        hoverRatioRef.current = ratio;
        const currentSec = ratio * dur;
        if (mode === "creating" && regionAnchorSecRef.current !== null) {
          const startSec = Math.min(regionAnchorSecRef.current, currentSec);
          const endSec = Math.max(regionAnchorSecRef.current, currentSec);
          if (endSec - startSec >= 0.03) {
            latestRange = { startSec, endSec };
            setSliceRange(latestRange);
          }
        } else if (mode === "resize-start" && latestRange) {
          const nextStart = Math.max(
            0,
            Math.min(latestRange.endSec - 0.04, currentSec)
          );
          latestRange = { startSec: nextStart, endSec: latestRange.endSec };
          setSliceRange(latestRange);
        } else if (mode === "resize-end" && latestRange) {
          const nextEnd = Math.min(
            dur,
            Math.max(latestRange.startSec + 0.04, currentSec)
          );
          latestRange = { startSec: latestRange.startSec, endSec: nextEnd };
          setSliceRange(latestRange);
        }
        scheduleDraw();
      },
      (cleanup) => {
        cleanup();
        setDragMode("none");
        regionAnchorSecRef.current = null;
        if (latestRange) {
          requestSeek(latestRange.startSec, true);
        }
      }
    );
  };

  const beginWindowScrubDrag = (initialSec: number) => {
    setDragMode("scrubbing");
    const dur = effectiveDuration;
    let latestSec = initialSec;
    let lastDispatchedSec = initialSec;
    let lastSeekMs = performance.now();

    requestSeek(initialSec, true);

    attachWindowDrag(
      (moveEvt, cleanup) => {
        if ((moveEvt.buttons & 1) !== 1) {
          cleanup();
          setDragMode("none");
          if (Math.abs(latestSec - lastDispatchedSec) >= 0.002) {
            requestSeek(latestSec, false);
          }
          return;
        }
        const rect =
          containerRectRef.current.width > 0
            ? containerRectRef.current
            : refreshContainerRect();
        if (rect.width <= 0) return;
        const curRatio = clientXToTrackRatio(moveEvt.clientX, rect);
        hoverRatioRef.current = curRatio;
        latestSec = curRatio * dur;
        resetPlayheadClock(latestSec);
        scheduleDraw();

        const now = performance.now();
        if (now - lastSeekMs >= 24 && Math.abs(latestSec - lastDispatchedSec) >= 0.005) {
          lastSeekMs = now;
          lastDispatchedSec = latestSec;
          requestSeek(latestSec, false);
        }
      },
      (cleanup) => {
        cleanup();
        setDragMode("none");
        if (Math.abs(latestSec - lastDispatchedSec) >= 0.002) {
          requestSeek(latestSec, false);
        }
      }
    );
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedSample) return;
    const rect = refreshContainerRect();
    if (rect.width <= 0) return;

    if (e.button === 1) {
      e.preventDefault();
      beginWindowPanDrag(e.clientX);
      return;
    }

    const clickX = e.clientX - rect.left;
    const ratio = clientXToTrackRatio(e.clientX, rect);
    const clickedSec = ratio * effectiveDuration;

    if (isSlicePreviewSample(selectedSample)) {
      if (e.button === 0) {
        e.preventDefault();
        if (sliceRange) setSliceRange(null);
        beginWindowScrubDrag(clickedSec);
      } else if (e.button === 2) {
        if (sliceRange) setSliceRange(null);
        requestSeek(clickedSec, true);
      }
      return;
    }

    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      beginWindowSliceDrag("creating", clickedSec, {
        startSec: clickedSec,
        endSec: Math.min(effectiveDuration, clickedSec + 0.04),
      });
      return;
    }

    if (e.button !== 0) return;

    if (sliceRange && sliceRange.endSec - sliceRange.startSec > 0.03) {
      const sx = secToScreenX(sliceRange.startSec, rect.width);
      const ex = secToScreenX(sliceRange.endSec, rect.width);
      const edgeTolerancePx = 7;

      if (Math.abs(clickX - sx) <= edgeTolerancePx) {
        e.preventDefault();
        beginWindowSliceDrag("resize-start", null, sliceRange);
        return;
      }
      if (Math.abs(clickX - ex) <= edgeTolerancePx) {
        e.preventDefault();
        beginWindowSliceDrag("resize-end", null, sliceRange);
        return;
      }

      if (clickX > sx + edgeTolerancePx && clickX < ex - edgeTolerancePx) {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const snapSampleId = selectedSample.id;
        const snapPath = selectedSample.file_path;
        const snapName = selectedSample.file_name;
        const snapStart = sliceRange.startSec;
        const snapEnd = sliceRange.endSec;
        let dragStarted = false;

        attachWindowDrag(
          (moveEvt, cleanup) => {
            if (dragStarted) return;
            if ((moveEvt.buttons & 1) !== 1) {
              cleanup();
              return;
            }
            if (Math.hypot(moveEvt.clientX - startX, moveEvt.clientY - startY) >= 4) {
              dragStarted = true;
              cleanup();
              const snapPitch = useSampleStore.getState().pitchSemitones;
              const snapMicroFade = useSampleStore.getState().sliceMicroFade;
              const pitchTag =
                snapPitch !== 0
                  ? ` ${snapPitch > 0 ? `+${snapPitch}` : snapPitch}st`
                  : "";
              setStatusMessage(
                `Dragging slice [${snapStart.toFixed(2)}s – ${snapEnd.toFixed(
                  2
                )}s${pitchTag}]...`
              );
              startNativeSliceDrag(
                snapPath,
                snapStart,
                snapEnd,
                `${snapName} [${snapStart.toFixed(2)}s–${snapEnd.toFixed(
                  2
                )}s${pitchTag}]`,
                { pitchSemitones: snapPitch, applyMicroFade: snapMicroFade }
              )
                .then((res) => {
                  if (res?.droppedExternally) {
                    if (autoBinOnNleDrag) addSamplesToBin([snapSampleId]);
                    void recordSliceExport({
                      slicePath: res.exportedPath,
                      sourceSampleId: snapSampleId,
                      sourceFilePath: snapPath,
                      startSec: snapStart,
                      endSec: snapEnd,
                      pitchSemitones: snapPitch,
                      applyMicroFade: snapMicroFade,
                    });
                    setStatusMessage(
                      `Slice exported & dropped (${snapStart.toFixed(
                        2
                      )}s – ${snapEnd.toFixed(2)}s)`
                    );
                  } else {
                    setStatusMessage(null);
                  }
                })
                .catch(() => setStatusMessage(null));
            }
          },
          (cleanup) => {
            cleanup();
            if (!dragStarted) requestSeek(clickedSec, true);
          }
        );
        return;
      }
    }

    e.preventDefault();
    beginWindowScrubDrag(clickedSec);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragMode !== "none") return;
    const rect =
      containerRectRef.current.width > 0
        ? containerRectRef.current
        : refreshContainerRect();
    if (rect.width <= 0) return;
    const mouseX = e.clientX - rect.left;
    const ratio = clientXToTrackRatio(e.clientX, rect);
    hoverRatioRef.current = ratio;
    scheduleDraw();

    if (sliceRange && sliceRange.endSec - sliceRange.startSec > 0.03) {
      const sx = secToScreenX(sliceRange.startSec, rect.width);
      const ex = secToScreenX(sliceRange.endSec, rect.width);
      const edgeTolerancePx = 7;
      if (
        Math.abs(mouseX - sx) <= edgeTolerancePx ||
        Math.abs(mouseX - ex) <= edgeTolerancePx
      ) {
        setHoverZone((prev) => (prev === "slice-edge" ? prev : "slice-edge"));
      } else if (mouseX > sx && mouseX < ex) {
        setHoverZone((prev) => (prev === "slice-body" ? prev : "slice-body"));
      } else {
        setHoverZone((prev) => (prev === "none" ? prev : "none"));
      }
    } else {
      setHoverZone((prev) => (prev === "none" ? prev : "none"));
    }
  };

  const handleCanvasMouseLeave = () => {
    if (dragMode !== "none") return;
    hoverRatioRef.current = null;
    setHoverZone("none");
    scheduleDraw();
  };

  return {
    hoverZone,
    dragMode,
    refreshContainerRect,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseLeave,
  };
}
