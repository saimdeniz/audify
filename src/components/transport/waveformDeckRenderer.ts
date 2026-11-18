import { getPlayheadSec } from "../../store/playheadClock";
import {
  SliceRange,
  ThemeMode,
  WaveformSensitivity,
  WaveformStyle,
} from "../../types";
import {
  getCanvasThemePalette,
  parsePeaks,
  samplePeakRange,
} from "../../utils/format";

export interface WaveLayerCache {
  key: string;
  base: HTMLCanvasElement;
  slice: HTMLCanvasElement;
  played: HTMLCanvasElement;
}

export interface RenderWaveformDeckOptions {
  sampleId: number | null;
  peaksJson: string;
  hiResPeaks: number[] | null;
  effectiveDuration: number;
  sliceRange: SliceRange | null;
  hoverRatio: number | null;
  hoverZone: "none" | "slice-body" | "slice-edge";
  themeMode: ThemeMode;
  accentColor: string;
  enableMica: boolean;
  waveformSensitivity: WaveformSensitivity;
  waveformStyle: WaveformStyle;
  logicalWidth: number;
  logicalHeight: number;
}

/**
 * Draws the interactive hi-res waveform deck onto `canvas`, reusing cached
 * offscreen envelope layers when only the playhead or hover cursor moves.
 */
export function renderWaveformDeck(
  canvas: HTMLCanvasElement,
  prevCache: WaveLayerCache | null,
  opts: RenderWaveformDeckOptions
): WaveLayerCache | null {
  const width = Math.max(100, Math.floor(opts.logicalWidth));
  const height = Math.max(40, Math.floor(opts.logicalHeight));
  const dpr = window.devicePixelRatio || 1;

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
      const secLabel =
        ((opts.effectiveDuration / divisions) * i).toFixed(2) + "s";
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
    return prevCache;
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

  // 2. In/Out Slice Region
  if (
    sliceStartRatio !== null &&
    sliceEndRatio !== null &&
    sliceEndRatio > sliceStartRatio
  ) {
    const sx = Math.floor(sliceStartRatio * width);
    const ex = Math.floor(sliceEndRatio * width);
    const sliceW = Math.max(2, ex - sx);
    ctx.fillStyle =
      opts.hoverZone === "slice-body"
        ? palette.accentFillHover
        : palette.accentFillSoft;
    ctx.fillRect(sx, 0, sliceW, height);

    ctx.strokeStyle = palette.accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, 0);
    ctx.lineTo(sx + 0.5, height);
    ctx.moveTo(ex + 0.5, 0);
    ctx.lineTo(ex + 0.5, height);
    ctx.stroke();

    ctx.fillStyle = palette.accentColor;
    ctx.fillRect(sx, 0, 4, 12);
    ctx.fillRect(Math.max(sx, ex - 4), 0, 4, 12);

    if (sliceW >= 78) {
      const badgeW = 72;
      const badgeX = Math.floor(sx + (sliceW - badgeW) / 2);
      ctx.fillStyle = palette.accentColor;
      ctx.fillRect(badgeX, 2, badgeW, 13);
      ctx.fillStyle = palette.accentOn;
      ctx.font = 'bold 9px "JetBrains Mono", Consolas, monospace';
      ctx.fillText("DRAG TO NLE", badgeX + 6, 11);
    }
  }

  // 3. Cached Offscreen Envelope Layers
  const baselineY = height - 4;
  const maxWaveHeight = Math.min(72, Math.round(usableHeight * 0.84));
  const maxHalfHeight = Math.max(10, usableHeight * 0.5 * 0.9);
  const unplayedBarColor = palette.fg2;
  const sliceBarColor = palette.fg;

  const layerKey = [
    opts.sampleId,
    opts.hiResPeaks ? `hi${opts.hiResPeaks.length}` : opts.peaksJson.length,
    `${width}x${height}@${dpr}`,
    opts.waveformSensitivity,
    opts.waveformStyle,
    opts.themeMode,
    opts.accentColor,
    opts.enableMica ? "mica" : "flat",
    unplayedBarColor,
    sliceBarColor,
  ].join("|");

  let layers = prevCache;
  if (!layers || layers.key !== layerKey) {
    const raw = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      raw[x] = samplePeakRange(
        peaks,
        x / width,
        (x + 1) / width,
        opts.waveformSensitivity
      );
    }
    const env = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const a = raw[Math.max(0, x - 1)];
      const c = raw[Math.min(width - 1, x + 1)];
      env[x] = Math.max(raw[x] * 0.9, a * 0.2 + raw[x] * 0.6 + c * 0.2);
    }

    const buildLayer = (color: string): HTMLCanvasElement => {
      const layer = document.createElement("canvas");
      layer.width = targetW;
      layer.height = targetH;
      const lctx = layer.getContext("2d");
      if (!lctx) return layer;
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.fillStyle = color;

      if (isSolidBaseline) {
        lctx.beginPath();
        lctx.moveTo(0, baselineY);
        for (let x = 0; x < width; x++) {
          lctx.lineTo(x + 0.5, baselineY - Math.max(1, env[x] * maxWaveHeight));
        }
        lctx.lineTo(width, baselineY);
        lctx.closePath();
        lctx.fill();
      } else {
        lctx.beginPath();
        lctx.moveTo(0, midY);
        for (let x = 0; x < width; x++) {
          lctx.lineTo(x + 0.5, midY - Math.max(0.5, env[x] * maxHalfHeight));
        }
        lctx.lineTo(width, midY);
        for (let x = width - 1; x >= 0; x--) {
          lctx.lineTo(x + 0.5, midY + Math.max(0.5, env[x] * maxHalfHeight));
        }
        lctx.closePath();
        lctx.fill();
      }
      return layer;
    };

    layers = {
      key: layerKey,
      base: buildLayer(unplayedBarColor),
      slice: buildLayer(sliceBarColor),
      played: buildLayer(opts.accentColor),
    };
  }

  ctx.drawImage(layers.base, 0, 0, width, height);
  if (
    sliceStartRatio !== null &&
    sliceEndRatio !== null &&
    sliceEndRatio > sliceStartRatio
  ) {
    const sx = Math.floor(sliceStartRatio * width);
    const ex = Math.ceil(sliceEndRatio * width);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, 0, Math.max(1, ex - sx), height);
    ctx.clip();
    ctx.drawImage(layers.slice, 0, 0, width, height);
    ctx.restore();
  }
  const playedX = Math.floor(playheadRatio * width);
  if (playedX > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedX, height);
    ctx.clip();
    ctx.drawImage(layers.played, 0, 0, width, height);
    ctx.restore();
  }

  // 4. Playhead Line & Cap
  const px = Math.floor(playheadRatio * width) + 0.5;
  ctx.strokeStyle = opts.accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, height);
  ctx.stroke();

  ctx.fillStyle = opts.accentColor;
  ctx.beginPath();
  ctx.moveTo(px - 5, 0);
  ctx.lineTo(px + 5, 0);
  ctx.lineTo(px, 7);
  ctx.closePath();
  ctx.fill();

  // 5. Ghost Playhead on Hover
  if (opts.hoverRatio !== null) {
    const gx = Math.floor(opts.hoverRatio * width) + 0.5;
    ctx.strokeStyle = palette.fg2;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
    ctx.setLineDash([]);

    const hoverSec = (opts.hoverRatio * opts.effectiveDuration).toFixed(2) + "s";
    const labelW = 50;
    const labelX = Math.min(width - labelW - 4, Math.max(4, gx + 5));
    ctx.fillStyle = palette.surface3;
    ctx.fillRect(labelX, height - 19, labelW, 15);
    ctx.strokeStyle = palette.lineStrong;
    ctx.strokeRect(labelX, height - 19, labelW, 15);
    ctx.fillStyle = palette.fg;
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(hoverSec, labelX + 4, height - 8);
  }

  ctx.restore();
  return layers;
}
