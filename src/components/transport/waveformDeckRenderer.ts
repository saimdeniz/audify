import { getPlayheadSec } from "../../store/playheadClock";
import {
  SliceRange,
  ThemeMode,
  WaveformSensitivity,
  WaveformStyle,
} from "../../types";
import { getCanvasThemePalette, parsePeaks } from "../../utils/format";
import {
  buildWaveformEnvelope,
  disposeWaveLayerCache,
  drawCompositeWaveLayers,
  drawDirectWaveform,
  updateOrReuseWaveLayerCache,
  WaveColors,
  WaveGeometry,
  WaveLayerCache,
} from "./waveformDeckLayers";
import {
  DEFAULT_WAVEFORM_VIEWPORT,
  trackRatioToScreenRatio,
  WaveformViewport,
} from "./waveformViewport";

export const HIRES_CROSSFADE_MS = 110;
export { disposeWaveLayerCache };
export type { WaveLayerCache, WaveformViewport };

export interface WaveCrossfadeState {
  from: WaveLayerCache;
  progress: number;
}

export interface RenderWaveformDeckOptions {
  sampleId: number | null;
  peaksJson: string;
  hiResPeaks: number[] | null;
  effectiveDuration: number;
  sliceRange: SliceRange | null;
  viewport?: WaveformViewport;
  hoverRatio: number | null;
  hoverZone: "none" | "slice-body" | "slice-edge";
  themeMode: ThemeMode;
  accentColor: string;
  enableMica: boolean;
  waveformSensitivity: WaveformSensitivity;
  waveformStyle: WaveformStyle;
  logicalWidth: number;
  logicalHeight: number;
  dpr?: number;
  crossfade?: WaveCrossfadeState | null;
  /** When true (during active wheel zoom / pan drag), draws directly without allocating offscreen layers. */
  interactive?: boolean;
  /** When true (prevCache is pinned by an active crossfade), allocates fresh layers instead of mutating prevCache. */
  preservePrevCache?: boolean;
}

export function buildWaveLayerStyleKey(opts: {
  logicalWidth: number;
  logicalHeight: number;
  dpr?: number;
  waveformSensitivity: WaveformSensitivity;
  waveformStyle: WaveformStyle;
  themeMode: ThemeMode;
  accentColor: string;
  enableMica: boolean;
  viewport?: WaveformViewport;
}): string {
  const width = Math.max(100, Math.floor(opts.logicalWidth));
  const height = Math.max(40, Math.floor(opts.logicalHeight));
  const dpr = opts.dpr ?? (window.devicePixelRatio || 1);
  const vp = opts.viewport ?? DEFAULT_WAVEFORM_VIEWPORT;
  const vpKey =
    vp.zoom <= 1
      ? "1:0"
      : `${vp.zoom.toFixed(3)}:${vp.startRatio.toFixed(5)}`;
  return [
    `${width}x${height}@${dpr}`,
    vpKey,
    opts.waveformSensitivity,
    opts.waveformStyle,
    opts.themeMode,
    opts.accentColor,
    opts.enableMica ? "mica" : "flat",
  ].join("|");
}

/**
 * Draws the interactive hi-res waveform deck onto `canvas`, using a zero-allocation
 * direct-draw fast path during active zoom/pan and persistent reusable offscreen layers
 * when idle or tracking the 60 Hz playhead.
 */
export function renderWaveformDeck(
  canvas: HTMLCanvasElement,
  prevCache: WaveLayerCache | null,
  opts: RenderWaveformDeckOptions
): WaveLayerCache | null {
  const width = Math.max(100, Math.floor(opts.logicalWidth));
  const height = Math.max(40, Math.floor(opts.logicalHeight));
  const dpr = opts.dpr ?? (window.devicePixelRatio || 1);

  const targetW = Math.floor(width * dpr);
  const targetH = Math.floor(height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return prevCache;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const palette = getCanvasThemePalette(
    `${opts.themeMode}:${opts.enableMica}:${opts.accentColor}`
  );

  const viewport = opts.viewport ?? DEFAULT_WAVEFORM_VIEWPORT;
  const viewStart = viewport.startRatio;
  const viewSpan = 1 / Math.max(1, viewport.zoom);
  const visibleDuration = opts.effectiveDuration * viewSpan;
  const rulerDecimals = visibleDuration < 1.5 ? 3 : 2;

  // 1. Background Time Ruler Grid
  ctx.strokeStyle = palette.lineSubtle;
  ctx.lineWidth = 1;
  ctx.fillStyle = palette.fg3;
  ctx.font = '10px "JetBrains Mono", Consolas, monospace';

  const divisions = Math.max(4, Math.min(10, Math.floor(width / 68)));
  for (let i = 1; i < divisions; i++) {
    const x = Math.floor((width / divisions) * i) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    if (opts.sampleId !== null) {
      const secVal = (viewStart + (viewSpan / divisions) * i) * opts.effectiveDuration;
      const secLabel = secVal.toFixed(rulerDecimals) + "s";
      ctx.fillText(secLabel, x + 4, 11);
    }
  }

  const rulerHeight = 14;
  const usableHeight = Math.max(24, height - rulerHeight);
  const midY = Math.floor(rulerHeight + usableHeight * 0.5);
  const isSolidBaseline = opts.waveformStyle !== "symmetric";

  if (isSolidBaseline) {
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 3.5);
    ctx.lineTo(width, height - 3.5);
    ctx.stroke();
  }

  if (opts.sampleId === null) {
    ctx.fillStyle = palette.fg3;
    ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    ctx.fillText("No sample selected", 16, midY);
    ctx.restore();
    return null;
  }

  const peaks = opts.hiResPeaks ?? parsePeaks(opts.peaksJson);
  const livePlayheadSec = getPlayheadSec();
  const playheadRatio = Math.max(
    0,
    Math.min(1, livePlayheadSec / opts.effectiveDuration)
  );

  const sliceStartRatio = opts.sliceRange
    ? Math.max(0, Math.min(1, opts.sliceRange.startSec / opts.effectiveDuration))
    : null;
  const sliceEndRatio = opts.sliceRange
    ? Math.max(0, Math.min(1, opts.sliceRange.endSec / opts.effectiveDuration))
    : null;
  const playheadScreenRatio = trackRatioToScreenRatio(playheadRatio, viewport);
  const rawSliceStartScreen =
    sliceStartRatio !== null
      ? trackRatioToScreenRatio(sliceStartRatio, viewport)
      : null;
  const rawSliceEndScreen =
    sliceEndRatio !== null
      ? trackRatioToScreenRatio(sliceEndRatio, viewport)
      : null;
  const visSliceStartRatio =
    rawSliceStartScreen !== null && rawSliceEndScreen !== null
      ? Math.max(0, Math.min(1, rawSliceStartScreen))
      : null;
  const visSliceEndRatio =
    rawSliceStartScreen !== null && rawSliceEndScreen !== null
      ? Math.max(0, Math.min(1, rawSliceEndScreen))
      : null;
  const hasVisibleSlice =
    visSliceStartRatio !== null &&
    visSliceEndRatio !== null &&
    visSliceEndRatio > visSliceStartRatio;

  // 2. In/Out Slice Region
  if (
    rawSliceStartScreen !== null &&
    rawSliceEndScreen !== null &&
    rawSliceEndScreen > rawSliceStartScreen &&
    rawSliceEndScreen > 0 &&
    rawSliceStartScreen < 1
  ) {
    const sx = Math.floor(rawSliceStartScreen * width);
    const ex = Math.floor(rawSliceEndScreen * width);
    const visSx = Math.max(0, sx);
    const visEx = Math.min(width, ex);
    const visSliceW = Math.max(2, visEx - visSx);
    ctx.fillStyle =
      opts.hoverZone === "slice-body"
        ? palette.accentFillHover
        : palette.accentFillSoft;
    ctx.fillRect(visSx, 0, visSliceW, height);

    ctx.strokeStyle = palette.accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (sx >= -1 && sx <= width + 1) {
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, height);
    }
    if (ex >= -1 && ex <= width + 1) {
      ctx.moveTo(ex + 0.5, 0);
      ctx.lineTo(ex + 0.5, height);
    }
    ctx.stroke();

    ctx.fillStyle = palette.accentColor;
    if (sx >= -4 && sx <= width) {
      ctx.fillRect(sx, 0, 4, 12);
    }
    if (ex >= 0 && ex <= width + 4) {
      ctx.fillRect(Math.max(sx, ex - 4), 0, 4, 12);
    }

    if (visSliceW >= 78) {
      const badgeW = 72;
      const badgeX = Math.floor(visSx + (visSliceW - badgeW) / 2);
      ctx.fillStyle = palette.accentColor;
      ctx.fillRect(badgeX, 2, badgeW, 13);
      ctx.fillStyle = palette.accentOn;
      ctx.font = 'bold 9px "JetBrains Mono", Consolas, monospace';
      ctx.fillText("DRAG TO NLE", badgeX + 6, 11);
    }
  }

  // 3. Waveform Envelope (Direct Fast Path while Zooming/Panning, Cached Layers when Idle)
  const geom: WaveGeometry = {
    width,
    height,
    targetW,
    targetH,
    dpr,
    isSolidBaseline,
    baselineY: height - 4,
    maxWaveHeight: Math.min(72, Math.round(usableHeight * 0.84)),
    midY,
    maxHalfHeight: Math.max(10, usableHeight * 0.5 * 0.9),
  };
  const colors: WaveColors = {
    base: palette.fg2,
    slice: palette.fg,
    played: palette.accentColor,
  };
  const playedX = Math.floor(playheadScreenRatio * width);
  let nextLayers = prevCache;

  if (opts.interactive) {
    const env = buildWaveformEnvelope(
      peaks,
      viewStart,
      viewSpan,
      width,
      opts.waveformSensitivity
    );
    drawDirectWaveform(
      ctx,
      env,
      geom,
      colors,
      visSliceStartRatio,
      visSliceEndRatio,
      playedX
    );
  } else {
    const styleSizeKey = buildWaveLayerStyleKey(opts);
    const layerKey = [
      opts.sampleId,
      opts.hiResPeaks ? `hi${opts.hiResPeaks.length}` : opts.peaksJson.length,
      styleSizeKey,
      colors.base,
      colors.slice,
    ].join("|");

    const layers = updateOrReuseWaveLayerCache({
      prevCache,
      preservePrevCache: Boolean(opts.preservePrevCache),
      layerKey,
      sampleId: opts.sampleId,
      isHiRes: opts.hiResPeaks !== null,
      styleSizeKey,
      hasSlice: hasVisibleSlice,
      peaks,
      viewStart,
      viewSpan,
      sensitivity: opts.waveformSensitivity,
      geom,
      colors,
    });
    nextLayers = layers;

    const crossfade = opts.crossfade;
    if (
      crossfade &&
      crossfade.from !== layers &&
      crossfade.progress > 0 &&
      crossfade.progress < 1
    ) {
      const t = crossfade.progress;
      const alphaFrom = 1 - t * t;
      const alphaTo = Math.sqrt(t);
      drawCompositeWaveLayers(
        ctx,
        crossfade.from,
        width,
        height,
        visSliceStartRatio,
        visSliceEndRatio,
        playedX,
        alphaFrom
      );
      drawCompositeWaveLayers(
        ctx,
        layers,
        width,
        height,
        visSliceStartRatio,
        visSliceEndRatio,
        playedX,
        alphaTo
      );
    } else if (crossfade && crossfade.from !== layers && crossfade.progress <= 0) {
      drawCompositeWaveLayers(
        ctx,
        crossfade.from,
        width,
        height,
        visSliceStartRatio,
        visSliceEndRatio,
        playedX,
        1
      );
    } else {
      drawCompositeWaveLayers(
        ctx,
        layers,
        width,
        height,
        visSliceStartRatio,
        visSliceEndRatio,
        playedX,
        1
      );
    }
  }

  // 4. Playhead Line & Cap
  const px = Math.floor(playheadScreenRatio * width) + 0.5;
  if (px >= -6 && px <= width + 6) {
    ctx.strokeStyle = palette.accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    ctx.fillStyle = palette.accentColor;
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }

  // 5. Ghost Playhead on Hover
  if (opts.hoverRatio !== null) {
    const hoverScreenRatio = trackRatioToScreenRatio(opts.hoverRatio, viewport);
    if (hoverScreenRatio >= -0.01 && hoverScreenRatio <= 1.01) {
      const gx = Math.floor(hoverScreenRatio * width) + 0.5;
      ctx.strokeStyle = palette.fg2;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
      ctx.setLineDash([]);

      const hoverSec =
        (opts.hoverRatio * opts.effectiveDuration).toFixed(rulerDecimals) + "s";
      ctx.font = '10px "JetBrains Mono", Consolas, monospace';
      const labelW = Math.max(
        rulerDecimals === 3 ? 56 : 50,
        Math.ceil(ctx.measureText(hoverSec).width) + 8
      );
      const labelX = Math.min(width - labelW - 4, Math.max(4, gx + 5));
      ctx.fillStyle = palette.surface3;
      ctx.fillRect(labelX, height - 19, labelW, 15);
      ctx.strokeStyle = palette.lineStrong;
      ctx.strokeRect(labelX, height - 19, labelW, 15);
      ctx.fillStyle = palette.fg;
      ctx.fillText(hoverSec, labelX + 4, height - 8);
    }
  }

  // 6. Subtle Viewport Position Indicator when Zoomed In
  if (viewport.zoom > 1.01) {
    const trackY = height - 3;
    ctx.fillStyle = palette.lineSubtle;
    ctx.fillRect(0, trackY, width, 3);
    const thumbX = Math.floor(viewStart * width);
    const thumbW = Math.max(14, Math.ceil(viewSpan * width));
    ctx.fillStyle = palette.accentColor;
    ctx.fillRect(Math.min(width - thumbW, thumbX), trackY, thumbW, 3);
  }

  ctx.restore();
  return nextLayers;
}
