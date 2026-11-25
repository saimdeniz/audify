import React, { useCallback, useEffect, useRef, useState } from "react";
import { subscribePlayhead } from "../../store/playheadClock";
import { useSampleStore } from "../../store/useSampleStore";
import { useDevicePixelRatio } from "../../utils/devicePixelRatio";
import { preExportAudioSlice } from "../../utils/drag";
import { onError } from "../../utils/errors";
import { useHiResPeaks } from "../../utils/hiResPeaks";
import { usePeaksJson } from "../../utils/peaksStore";
import { useWaveformDeckInteractions } from "./useWaveformDeckInteractions";
import {
  startDeckHeaderSampleDrag,
  startDeckSliceDrag,
} from "./waveformDeckDrag";
import { WaveformDeckHeader } from "./WaveformDeckHeader";
import {
  buildWaveLayerStyleKey,
  disposeWaveLayerCache,
  HIRES_CROSSFADE_MS,
  renderWaveformDeck,
  WaveCrossfadeState,
  WaveLayerCache,
} from "./waveformDeckRenderer";
import {
  DEFAULT_WAVEFORM_VIEWPORT,
  WaveformViewport,
} from "./waveformViewport";
import { WaveformSimilarityDropOverlay } from "./WaveformSimilarityDropOverlay";

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
  const exportAudioPreset = useSampleStore((s) => s.exportAudioPreset);
  const exportLoudnessMode = useSampleStore((s) => s.exportLoudnessMode);
  const saveSliceShortcut = useSampleStore((s) => s.shortcuts.saveSlice);

  const saveActiveSlice = useSampleStore((s) => s.saveActiveSlice);
  const setSliceRange = useSampleStore((s) => s.setSliceRange);
  const setPitchSemitones = useSampleStore((s) => s.setPitchSemitones);

  const selectedPeaksJson = usePeaksJson(
    selectedSample?.id,
    selectedSample?.peaks_json
  );
  const hiResPeaks = useHiResPeaks(selectedSample?.file_path);
  const liveDpr = useDevicePixelRatio();

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
  const hoverRatioRef = useRef<number | null>(null);
  const [viewport, setViewportState] = useState<WaveformViewport>(
    DEFAULT_WAVEFORM_VIEWPORT
  );
  const viewportRef = useRef<WaveformViewport>(DEFAULT_WAVEFORM_VIEWPORT);

  const setViewport = useCallback((next: WaveformViewport) => {
    viewportRef.current = next;
    setViewportState(next);
  }, []);

  const handleResetZoom = useCallback(() => {
    setViewport(DEFAULT_WAVEFORM_VIEWPORT);
  }, [setViewport]);

  useEffect(() => {
    viewportRef.current = DEFAULT_WAVEFORM_VIEWPORT;
    setViewportState(DEFAULT_WAVEFORM_VIEWPORT);
  }, [selectedSample?.id]);
  const prefersReducedMotionRef = useRef<boolean>(false);
  const crossfadeRef = useRef<{
    sampleId: number;
    from: WaveLayerCache;
    styleSizeKey: string;
    startMs: number;
    rafId: number | null;
  } | null>(null);

  const cancelCrossfade = useCallback(() => {
    const cf = crossfadeRef.current;
    if (cf?.rafId !== null && cf?.rafId !== undefined) {
      window.cancelAnimationFrame(cf.rafId);
    }
    if (cf?.from && cf.from !== waveLayersRef.current) {
      disposeWaveLayerCache(cf.from);
    }
    crossfadeRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotionRef.current = mq.matches;
    const onChange = () => {
      prefersReducedMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const effectiveDuration = Math.max(
    0.05,
    durationSec || (selectedSample ? selectedSample.duration_ms / 1000 : 1)
  );

  const handleClearSlice = useCallback(() => {
    setSliceRange(null);
  }, [setSliceRange]);

  const handleResetPitch = useCallback(() => {
    setPitchSemitones(0);
  }, [setPitchSemitones]);

  const handleSaveSlice = useCallback(
    async (customName?: string) => {
      const saved = await saveActiveSlice(customName);
      return Boolean(saved);
    },
    [saveActiveSlice]
  );

  const handleSliceBadgeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || !selectedSample || !sliceRange) return;
      e.preventDefault();
      startDeckSliceDrag(selectedSample, sliceRange, e.clientX, e.clientY);
    },
    [selectedSample, sliceRange]
  );

  const handleHeaderSampleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || !selectedSample || selectedSample.is_trashed) return;
      e.preventDefault();
      startDeckHeaderSampleDrag(selectedSample, sliceRange, e.clientX, e.clientY);
    },
    [selectedSample, sliceRange]
  );

  useEffect(() => {
    return () => {
      cancelCrossfade();
      disposeWaveLayerCache(waveLayersRef.current);
      waveLayersRef.current = null;
    };
  }, [cancelCrossfade]);

  const handleCanvasDoubleClick = useCallback(() => {
    if (sliceRange) {
      setSliceRange(null);
    } else if (viewportRef.current.zoom > 1.01) {
      handleResetZoom();
    }
  }, [sliceRange, setSliceRange, handleResetZoom]);

  const drawWaveformRef = useRef<() => void>(() => {});
  const {
    hoverZone,
    dragMode,
    refreshContainerRect,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseLeave,
  } = useWaveformDeckInteractions({
    selectedSample,
    effectiveDuration,
    sliceRange,
    autoBinOnNleDrag,
    containerRef,
    containerRectRef,
    viewportRef,
    setViewport,
    hoverRatioRef,
    drawWaveformRef,
  });

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
        exportPreset: exportAudioPreset,
        loudnessMode: exportLoudnessMode,
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
    exportAudioPreset,
    exportLoudnessMode,
  ]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    if (canvasSizeRef.current.width <= 0 || canvasSizeRef.current.height <= 0) {
      canvasSizeRef.current = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
    }

    // Release offscreen & main canvas GPU backing stores whenever hidden or collapsed
    if (
      (typeof document !== "undefined" && document.visibilityState === "hidden") ||
      canvasSizeRef.current.width <= 0 ||
      canvasSizeRef.current.height <= 0
    ) {
      cancelCrossfade();
      if (waveLayersRef.current) {
        disposeWaveLayerCache(waveLayersRef.current);
        waveLayersRef.current = null;
      }
      if (canvas.width !== 0 || canvas.height !== 0) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }

    const currentSampleId = selectedSample?.id ?? null;
    const currentViewport = viewportRef.current;
    const currentStyleSizeKey = buildWaveLayerStyleKey({
      logicalWidth: canvasSizeRef.current.width,
      logicalHeight: canvasSizeRef.current.height,
      dpr: liveDpr,
      waveformSensitivity,
      waveformStyle,
      themeMode,
      accentColor,
      enableMica,
      viewport: currentViewport,
    });

    if (
      crossfadeRef.current &&
      (crossfadeRef.current.sampleId !== currentSampleId ||
        crossfadeRef.current.styleSizeKey !== currentStyleSizeKey ||
        hiResPeaks === null)
    ) {
      cancelCrossfade();
    }

    const prevLayers = waveLayersRef.current;
    const prefersReducedMotion = prefersReducedMotionRef.current;
    if (
      !prefersReducedMotion &&
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function" &&
      currentSampleId !== null &&
      hiResPeaks !== null &&
      prevLayers !== null &&
      prevLayers.sampleId === currentSampleId &&
      !prevLayers.isHiRes &&
      prevLayers.styleSizeKey === currentStyleSizeKey &&
      crossfadeRef.current === null
    ) {
      crossfadeRef.current = {
        sampleId: currentSampleId,
        from: prevLayers,
        styleSizeKey: currentStyleSizeKey,
        startMs: performance.now(),
        rafId: null,
      };
    }

    let crossfadeParam: WaveCrossfadeState | null = null;
    if (crossfadeRef.current) {
      const elapsed = performance.now() - crossfadeRef.current.startMs;
      if (elapsed >= HIRES_CROSSFADE_MS) {
        cancelCrossfade();
      } else {
        crossfadeParam = {
          from: crossfadeRef.current.from,
          progress: Math.max(0, Math.min(1, elapsed / HIRES_CROSSFADE_MS)),
        };
        if (crossfadeRef.current.rafId === null) {
          const activeCf = crossfadeRef.current;
          activeCf.rafId = window.requestAnimationFrame(() => {
            if (crossfadeRef.current === activeCf) {
              activeCf.rafId = null;
              drawWaveformRef.current();
            }
          });
        }
      }
    }

    const nextLayers = renderWaveformDeck(canvas, prevLayers, {
      sampleId: currentSampleId,
      peaksJson: selectedPeaksJson,
      hiResPeaks,
      effectiveDuration,
      sliceRange,
      viewport: currentViewport,
      hoverRatio: hoverRatioRef.current,
      hoverZone,
      themeMode,
      accentColor,
      enableMica,
      waveformSensitivity,
      waveformStyle,
      logicalWidth: canvasSizeRef.current.width,
      logicalHeight: canvasSizeRef.current.height,
      dpr: liveDpr,
      crossfade: crossfadeParam,
    });
    if (
      prevLayers &&
      prevLayers !== nextLayers &&
      crossfadeRef.current?.from !== prevLayers
    ) {
      disposeWaveLayerCache(prevLayers);
    }
    waveLayersRef.current = nextLayers;
  }, [
    selectedSample?.id,
    selectedPeaksJson,
    hiResPeaks,
    effectiveDuration,
    sliceRange,
    hoverZone,
    themeMode,
    accentColor,
    enableMica,
    waveformSensitivity,
    waveformStyle,
    cancelCrossfade,
    liveDpr,
  ]);

  drawWaveformRef.current = drawWaveform;

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform, viewport]);

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
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelCrossfade();
        if (waveLayersRef.current) {
          disposeWaveLayerCache(waveLayersRef.current);
          waveLayersRef.current = null;
        }
        const c = canvasRef.current;
        if (c && (c.width !== 0 || c.height !== 0)) {
          c.width = 0;
          c.height = 0;
        }
      } else {
        syncRect();
        drawWaveformRef.current();
      }
    };
    window.addEventListener("resize", syncRect);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncRect);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelCrossfade]);

  const canvasCursorClass =
    dragMode === "panning"
      ? "cursor-grabbing"
      : dragMode === "resize-start" ||
        dragMode === "resize-end" ||
        hoverZone === "slice-edge"
      ? "cursor-ew-resize"
      : hoverZone === "slice-body"
      ? "cursor-grab active:cursor-grabbing"
      : "cursor-crosshair";

  return (
    <div
      ref={deckPanelRef}
      data-waveform-similarity-drop="true"
      className="flex-1 flex flex-col bg-surface-0 relative overflow-hidden"
    >
      <WaveformDeckHeader
        selectedSample={selectedSample}
        isMiniDock={isMiniDock}
        effectiveDuration={effectiveDuration}
        sliceRange={sliceRange}
        zoomLevel={viewport.zoom}
        onResetZoom={handleResetZoom}
        pitchSemitones={pitchSemitones}
        onResetPitch={handleResetPitch}
        saveSliceShortcut={saveSliceShortcut}
        onClearSlice={handleClearSlice}
        onSaveSlice={handleSaveSlice}
        onSliceBadgeMouseDown={handleSliceBadgeMouseDown}
        onHeaderSampleMouseDown={handleHeaderSampleMouseDown}
      />

      <div
        ref={containerRef}
        onMouseEnter={refreshContainerRect}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        onDoubleClick={handleCanvasDoubleClick}
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
