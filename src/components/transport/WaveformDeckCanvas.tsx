import React, { useCallback, useEffect, useRef, useState } from "react";
import { subscribePlayhead } from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import { preExportAudioSlice, startNativeSliceDrag } from "../../utils/drag";
import { onError } from "../../utils/errors";
import { useHiResPeaks } from "../../utils/hiResPeaks";
import { usePeaksJson } from "../../utils/peaksStore";
import { isSlicePreviewSample } from "../../utils/slicePreview";
import { WaveformDeckHeader } from "./WaveformDeckHeader";
import { renderWaveformDeck, WaveLayerCache } from "./waveformDeckRenderer";
import { WaveformSimilarityDropOverlay } from "./WaveformSimilarityDropOverlay";

type CanvasDragMode = "none" | "creating" | "resize-start" | "resize-end";

export const WaveformDeckCanvas: React.FC = React.memo(() => {
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const isMiniDock = useSampleStore((s) => s.isMiniDock);
  const durationSec = useSampleStore((s) => s.durationSec);
  const sliceRange = useSampleStore((s) => s.sliceRange);
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);
  const enableMica = useSampleStore((s) => s.enableMica);
  const waveformSensitivity = useSampleStore((s) => s.waveformSensitivity);
  const waveformStyle = useSampleStore((s) => s.waveformStyle);
  const customSliceExportPath = useSampleStore((s) => s.customSliceExportPath);
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);
  const pitchSemitones = useSampleStore((s) => s.pitchSemitones);
  const sliceMicroFade = useSampleStore((s) => s.sliceMicroFade);
  const saveSliceShortcut = useSampleStore((s) => s.shortcuts.saveSlice);

  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const recordSliceExport = useSampleStore((s) => s.recordSliceExport);
  const saveActiveSlice = useSampleStore((s) => s.saveActiveSlice);
  const requestSeek = useSampleStore((s) => s.requestSeek);
  const setSliceRange = useSampleStore((s) => s.setSliceRange);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  const selectedPeaksJson = usePeaksJson(
    selectedSample?.id,
    selectedSample?.peaks_json
  );
  const hiResPeaks = useHiResPeaks(selectedSample?.file_path);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const deckPanelRef = useRef<HTMLDivElement | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const containerRectRef = useRef<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });
  const waveLayersRef = useRef<WaveLayerCache | null>(null);

  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [hoverZone, setHoverZone] = useState<
    "none" | "slice-body" | "slice-edge"
  >("none");
  const [dragMode, setDragMode] = useState<CanvasDragMode>("none");
  const regionAnchorSecRef = useRef<number | null>(null);
  const activeWindowCleanupRef = useRef<(() => void) | null>(null);

  const effectiveDuration = Math.max(
    0.05,
    durationSec || (selectedSample ? selectedSample.duration_ms / 1000 : 1)
  );

  const handleClearSlice = useCallback(() => {
    setSliceRange(null);
  }, [setSliceRange]);

  const handleSaveSlice = useCallback(
    async (customName?: string) => {
      const saved = await saveActiveSlice(customName);
      return Boolean(saved);
    },
    [saveActiveSlice]
  );

  useEffect(() => {
    return () => {
      if (activeWindowCleanupRef.current) {
        activeWindowCleanupRef.current();
        activeWindowCleanupRef.current = null;
      }
    };
  }, []);

  // Pre-export WAV slice in background whenever a valid sliceRange is idle
  useEffect(() => {
    const filePath = selectedSample?.file_path;
    const startSec = sliceRange?.startSec;
    const endSec = sliceRange?.endSec;
    if (
      !filePath ||
      startSec === undefined ||
      endSec === undefined ||
      dragMode !== "none" ||
      endSec - startSec <= 0.03
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      preExportAudioSlice(filePath, startSec, endSec, {
        pitchSemitones,
        applyMicroFade: sliceMicroFade,
        cacheOnly: true,
      }).catch(onError("slice pre-export"));
    }, 60);
    return () => window.clearTimeout(timer);
  }, [
    selectedSample?.file_path,
    sliceRange?.startSec,
    sliceRange?.endSec,
    dragMode,
    customSliceExportPath,
    pitchSemitones,
    sliceMicroFade,
  ]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Cache container dimensions via ResizeObserver so 60Hz playhead animation
    // avoids calling getBoundingClientRect() inside requestAnimationFrame.
    if (canvasSizeRef.current.width <= 0 || canvasSizeRef.current.height <= 0) {
      canvasSizeRef.current = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
    }

    waveLayersRef.current = renderWaveformDeck(canvas, waveLayersRef.current, {
      sampleId: selectedSample?.id ?? null,
      peaksJson: selectedPeaksJson,
      hiResPeaks,
      effectiveDuration,
      sliceRange,
      hoverRatio,
      hoverZone,
      themeMode,
      accentColor,
      enableMica,
      waveformSensitivity,
      waveformStyle,
      logicalWidth: canvasSizeRef.current.width,
      logicalHeight: canvasSizeRef.current.height,
    });
  }, [
    selectedSample?.id,
    selectedPeaksJson,
    hiResPeaks,
    effectiveDuration,
    sliceRange,
    hoverRatio,
    hoverZone,
    themeMode,
    accentColor,
    enableMica,
    waveformSensitivity,
    waveformStyle,
  ]);

  const drawWaveformRef = useRef(drawWaveform);
  drawWaveformRef.current = drawWaveform;

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  useEffect(() => {
    return subscribePlayhead(() => {
      drawWaveformRef.current();
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const syncRect = () => {
      const box = container.getBoundingClientRect();
      containerRectRef.current = { left: box.left, width: box.width };
    };
    canvasSizeRef.current = {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    syncRect();
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        canvasSizeRef.current = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
      }
      syncRect();
      drawWaveformRef.current();
    });
    ro.observe(container);
    window.addEventListener("resize", syncRect);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncRect);
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

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedSample) return;
    const rect = refreshContainerRect();
    if (rect.width <= 0) return;

    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const clickedSec = ratio * effectiveDuration;

    if (isSlicePreviewSample(selectedSample)) {
      if (e.button === 0 || e.button === 2) {
        if (sliceRange) setSliceRange(null);
        requestSeek(clickedSec, true);
      }
      return;
    }

    if (e.shiftKey || e.button === 2) {
      e.preventDefault();
      regionAnchorSecRef.current = clickedSec;
      setDragMode("creating");
      setSliceRange({
        startSec: clickedSec,
        endSec: Math.min(effectiveDuration, clickedSec + 0.04),
      });
      return;
    }

    if (e.button !== 0) return;

    if (sliceRange && sliceRange.endSec - sliceRange.startSec > 0.03) {
      const sx = (sliceRange.startSec / effectiveDuration) * rect.width;
      const ex = (sliceRange.endSec / effectiveDuration) * rect.width;
      const edgeTolerancePx = 7;

      if (Math.abs(clickX - sx) <= edgeTolerancePx) {
        e.preventDefault();
        setDragMode("resize-start");
        return;
      }
      if (Math.abs(clickX - ex) <= edgeTolerancePx) {
        e.preventDefault();
        setDragMode("resize-end");
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

    requestSeek(clickedSec, true);
    const startX = e.clientX;
    let promotedToSlice = false;

    attachWindowDrag(
      (moveEvt, cleanup) => {
        if (promotedToSlice) return;
        if ((moveEvt.buttons & 1) !== 1) {
          cleanup();
          return;
        }
        if (Math.abs(moveEvt.clientX - startX) >= 6) {
          promotedToSlice = true;
          cleanup();
          regionAnchorSecRef.current = clickedSec;
          setDragMode("creating");
          const curRatio = Math.max(
            0,
            Math.min(1, (moveEvt.clientX - rect.left) / rect.width)
          );
          const curSec = curRatio * effectiveDuration;
          const s0 = Math.min(clickedSec, curSec);
          const s1 = Math.max(clickedSec, curSec);
          if (s1 - s0 >= 0.03) {
            setSliceRange({ startSec: s0, endSec: s1 });
          }
        }
      },
      (cleanup) => cleanup()
    );
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect =
      containerRectRef.current.width > 0
        ? containerRectRef.current
        : refreshContainerRect();
    if (rect.width <= 0) return;
    const mouseX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, mouseX / rect.width));
    setHoverRatio(ratio);

    if (dragMode !== "none" && selectedSample) {
      const currentSec = ratio * effectiveDuration;
      if (dragMode === "creating" && regionAnchorSecRef.current !== null) {
        const startSec = Math.min(regionAnchorSecRef.current, currentSec);
        const endSec = Math.max(regionAnchorSecRef.current, currentSec);
        if (endSec - startSec >= 0.03) setSliceRange({ startSec, endSec });
      } else if (dragMode === "resize-start" && sliceRange) {
        const nextStart = Math.max(
          0,
          Math.min(sliceRange.endSec - 0.04, currentSec)
        );
        setSliceRange({ startSec: nextStart, endSec: sliceRange.endSec });
      } else if (dragMode === "resize-end" && sliceRange) {
        const nextEnd = Math.min(
          effectiveDuration,
          Math.max(sliceRange.startSec + 0.04, currentSec)
        );
        setSliceRange({ startSec: sliceRange.startSec, endSec: nextEnd });
      }
      return;
    }

    if (sliceRange && sliceRange.endSec - sliceRange.startSec > 0.03) {
      const sx = (sliceRange.startSec / effectiveDuration) * rect.width;
      const ex = (sliceRange.endSec / effectiveDuration) * rect.width;
      const edgeTolerancePx = 7;
      if (
        Math.abs(mouseX - sx) <= edgeTolerancePx ||
        Math.abs(mouseX - ex) <= edgeTolerancePx
      ) {
        setHoverZone("slice-edge");
      } else if (mouseX > sx && mouseX < ex) {
        setHoverZone("slice-body");
      } else {
        setHoverZone("none");
      }
    } else {
      setHoverZone("none");
    }
  };

  const handleCanvasMouseUp = () => {
    if (dragMode !== "none") {
      setDragMode("none");
      regionAnchorSecRef.current = null;
      if (sliceRange) requestSeek(sliceRange.startSec, true);
    }
  };

  const canvasCursorClass =
    dragMode === "resize-start" ||
    dragMode === "resize-end" ||
    hoverZone === "slice-edge"
      ? "cursor-ew-resize"
      : hoverZone === "slice-body"
      ? "cursor-grab active:cursor-grabbing"
      : "cursor-crosshair";

  return (
    <div
      ref={deckPanelRef}
      className="flex-1 flex flex-col bg-surface-0 relative overflow-hidden"
    >
      <WaveformDeckHeader
        selectedSample={selectedSample}
        isMiniDock={isMiniDock}
        effectiveDuration={effectiveDuration}
        sliceRange={sliceRange}
        saveSliceShortcut={saveSliceShortcut}
        onClearSlice={handleClearSlice}
        onSaveSlice={handleSaveSlice}
      />

      <div
        ref={containerRef}
        onMouseEnter={refreshContainerRect}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={() => {
          setHoverRatio(null);
          setHoverZone("none");
          if (dragMode !== "none") {
            setDragMode("none");
            regionAnchorSecRef.current = null;
          }
        }}
        onDoubleClick={handleClearSlice}
        onContextMenu={(e) => e.preventDefault()}
        className={`flex-1 relative overflow-hidden ${canvasCursorClass}`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full block"
        />
      </div>
      <WaveformSimilarityDropOverlay panelRef={deckPanelRef} />
    </div>
  );
});
