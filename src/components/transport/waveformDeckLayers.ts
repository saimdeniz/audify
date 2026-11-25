import { WaveformSensitivity } from "../../types";
import { sampleWaveformEnvelope } from "../../utils/waveformPeaks";

export interface WaveLayerCache {
  key: string;
  sampleId: number | null;
  isHiRes: boolean;
  styleSizeKey: string;
  base: HTMLCanvasElement;
  slice: HTMLCanvasElement | null;
  played: HTMLCanvasElement;
  sliceReadyKey: string;
}

export interface WaveGeometry {
  width: number;
  height: number;
  targetW: number;
  targetH: number;
  dpr: number;
  isSolidBaseline: boolean;
  baselineY: number;
  maxWaveHeight: number;
  midY: number;
  maxHalfHeight: number;
}

export interface WaveColors {
  base: string;
  slice: string;
  played: string;
}

let scratchRaw = new Float32Array(0);
let scratchEnv = new Float32Array(0);

function ensureScratchCapacity(width: number): void {
  if (scratchRaw.length < width) {
    const nextCap = Math.max(width, 256);
    scratchRaw = new Float32Array(nextCap);
    scratchEnv = new Float32Array(nextCap);
  }
}

export function buildWaveformEnvelope(
  peaks: ArrayLike<number>,
  viewStart: number,
  viewSpan: number,
  width: number,
  sensitivity: WaveformSensitivity
): Float32Array {
  ensureScratchCapacity(width);
  sampleWaveformEnvelope(
    peaks,
    viewStart,
    viewSpan,
    width,
    sensitivity,
    scratchRaw,
    scratchEnv
  );
  return scratchEnv;
}

function traceWavePathOnContext(
  ctx: CanvasRenderingContext2D,
  env: Float32Array,
  geom: WaveGeometry
): void {
  const { width, isSolidBaseline, baselineY, maxWaveHeight, midY, maxHalfHeight } =
    geom;
  ctx.beginPath();
  if (isSolidBaseline) {
    ctx.moveTo(0, baselineY);
    for (let x = 0; x < width; x++) {
      const h = env[x] * maxWaveHeight;
      ctx.lineTo(x + 0.5, baselineY - (h > 1 ? h : 1));
    }
    ctx.lineTo(width, baselineY);
  } else {
    ctx.moveTo(0, midY);
    for (let x = 0; x < width; x++) {
      const half = env[x] * maxHalfHeight;
      ctx.lineTo(x + 0.5, midY - (half > 0.5 ? half : 0.5));
    }
    ctx.lineTo(width, midY);
    for (let x = width - 1; x >= 0; x--) {
      const half = env[x] * maxHalfHeight;
      ctx.lineTo(x + 0.5, midY + (half > 0.5 ? half : 0.5));
    }
  }
  ctx.closePath();
}

function createWavePath2D(
  env: Float32Array,
  geom: WaveGeometry
): Path2D | null {
  if (typeof Path2D !== "function") return null;
  const { width, isSolidBaseline, baselineY, maxWaveHeight, midY, maxHalfHeight } =
    geom;
  const path = new Path2D();
  if (isSolidBaseline) {
    path.moveTo(0, baselineY);
    for (let x = 0; x < width; x++) {
      const h = env[x] * maxWaveHeight;
      path.lineTo(x + 0.5, baselineY - (h > 1 ? h : 1));
    }
    path.lineTo(width, baselineY);
  } else {
    path.moveTo(0, midY);
    for (let x = 0; x < width; x++) {
      const half = env[x] * maxHalfHeight;
      path.lineTo(x + 0.5, midY - (half > 0.5 ? half : 0.5));
    }
    path.lineTo(width, midY);
    for (let x = width - 1; x >= 0; x--) {
      const half = env[x] * maxHalfHeight;
      path.lineTo(x + 0.5, midY + (half > 0.5 ? half : 0.5));
    }
  }
  path.closePath();
  return path;
}

function fillWaveShape(
  ctx: CanvasRenderingContext2D,
  path2d: Path2D | null,
  env: Float32Array,
  geom: WaveGeometry
): void {
  if (path2d) {
    ctx.fill(path2d);
  } else {
    traceWavePathOnContext(ctx, env, geom);
    ctx.fill();
  }
}

function fillClippedWaveShape(
  ctx: CanvasRenderingContext2D,
  path2d: Path2D | null,
  env: Float32Array,
  geom: WaveGeometry,
  color: string,
  clipX: number,
  clipW: number
): void {
  if (clipW <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, 0, clipW, geom.height);
  ctx.clip();
  ctx.fillStyle = color;
  fillWaveShape(ctx, path2d, env, geom);
  ctx.restore();
}

/**
 * Zero-allocation direct-draw fast path used during active zoom/pan interaction.
 * Avoids creating, resizing, or rasterizing offscreen GPU canvas surfaces per wheel frame.
 */
export function drawDirectWaveform(
  ctx: CanvasRenderingContext2D,
  env: Float32Array,
  geom: WaveGeometry,
  colors: WaveColors,
  sliceStartRatio: number | null,
  sliceEndRatio: number | null,
  playedX: number
): void {
  const { width } = geom;
  const path2d = createWavePath2D(env, geom);
  const hasSlice =
    sliceStartRatio !== null &&
    sliceEndRatio !== null &&
    sliceEndRatio > sliceStartRatio;
  const clampedPlayed = Math.max(0, Math.min(width, playedX));

  if (!hasSlice && clampedPlayed <= 0) {
    ctx.fillStyle = colors.base;
    fillWaveShape(ctx, path2d, env, geom);
    return;
  }
  if (!hasSlice && clampedPlayed >= width) {
    ctx.fillStyle = colors.played;
    fillWaveShape(ctx, path2d, env, geom);
    return;
  }

  if (clampedPlayed > 0) {
    fillClippedWaveShape(ctx, path2d, env, geom, colors.played, 0, clampedPlayed);
  }

  if (clampedPlayed < width) {
    if (hasSlice) {
      const sx = Math.max(clampedPlayed, Math.floor(sliceStartRatio * width));
      const ex = Math.min(width, Math.ceil(sliceEndRatio * width));
      if (ex > sx) {
        if (sx > clampedPlayed) {
          fillClippedWaveShape(
            ctx,
            path2d,
            env,
            geom,
            colors.base,
            clampedPlayed,
            sx - clampedPlayed
          );
        }
        fillClippedWaveShape(ctx, path2d, env, geom, colors.slice, sx, ex - sx);
        if (ex < width) {
          fillClippedWaveShape(ctx, path2d, env, geom, colors.base, ex, width - ex);
        }
      } else {
        fillClippedWaveShape(
          ctx,
          path2d,
          env,
          geom,
          colors.base,
          clampedPlayed,
          width - clampedPlayed
        );
      }
    } else {
      fillClippedWaveShape(
        ctx,
        path2d,
        env,
        geom,
        colors.base,
        clampedPlayed,
        width - clampedPlayed
      );
    }
  }
}

function paintOffscreenLayer(
  existing: HTMLCanvasElement | null,
  path2d: Path2D | null,
  env: Float32Array,
  geom: WaveGeometry,
  color: string
): HTMLCanvasElement {
  const layer = existing ?? document.createElement("canvas");
  if (layer.width !== geom.targetW || layer.height !== geom.targetH) {
    layer.width = geom.targetW;
    layer.height = geom.targetH;
  }
  const lctx = layer.getContext("2d");
  if (!lctx) return layer;
  lctx.setTransform(geom.dpr, 0, 0, geom.dpr, 0, 0);
  lctx.clearRect(0, 0, geom.width, geom.height);
  lctx.fillStyle = color;
  fillWaveShape(lctx, path2d, env, geom);
  return layer;
}

export function disposeWaveLayerCache(cache: WaveLayerCache | null): void {
  if (!cache) return;
  cache.base.width = 0;
  cache.base.height = 0;
  if (cache.slice) {
    cache.slice.width = 0;
    cache.slice.height = 0;
  }
  cache.played.width = 0;
  cache.played.height = 0;
}

/**
 * Reuses existing offscreen canvas backing stores in-place whenever `preservePrevCache`
 * is false (no active crossfade pinning `prevCache`), and allocates `slice` lazily only
 * when a slice region is actually visible.
 */
export function updateOrReuseWaveLayerCache(params: {
  prevCache: WaveLayerCache | null;
  preservePrevCache: boolean;
  layerKey: string;
  sampleId: number | null;
  isHiRes: boolean;
  styleSizeKey: string;
  hasSlice: boolean;
  peaks: ArrayLike<number>;
  viewStart: number;
  viewSpan: number;
  sensitivity: WaveformSensitivity;
  geom: WaveGeometry;
  colors: WaveColors;
}): WaveLayerCache {
  const {
    prevCache,
    preservePrevCache,
    layerKey,
    sampleId,
    isHiRes,
    styleSizeKey,
    hasSlice,
    peaks,
    viewStart,
    viewSpan,
    sensitivity,
    geom,
    colors,
  } = params;

  if (prevCache && prevCache.key === layerKey) {
    if (hasSlice && prevCache.sliceReadyKey !== layerKey) {
      const env = buildWaveformEnvelope(
        peaks,
        viewStart,
        viewSpan,
        geom.width,
        sensitivity
      );
      const path2d = createWavePath2D(env, geom);
      prevCache.slice = paintOffscreenLayer(
        prevCache.slice,
        path2d,
        env,
        geom,
        colors.slice
      );
      prevCache.sliceReadyKey = layerKey;
    }
    return prevCache;
  }

  const env = buildWaveformEnvelope(
    peaks,
    viewStart,
    viewSpan,
    geom.width,
    sensitivity
  );
  const path2d = createWavePath2D(env, geom);

  const canReuse = !preservePrevCache && prevCache !== null;
  const base = paintOffscreenLayer(
    canReuse ? prevCache.base : null,
    path2d,
    env,
    geom,
    colors.base
  );
  const played = paintOffscreenLayer(
    canReuse ? prevCache.played : null,
    path2d,
    env,
    geom,
    colors.played
  );

  let slice: HTMLCanvasElement | null = canReuse ? prevCache.slice : null;
  let sliceReadyKey = "";
  if (hasSlice) {
    slice = paintOffscreenLayer(slice, path2d, env, geom, colors.slice);
    sliceReadyKey = layerKey;
  }

  if (canReuse && prevCache) {
    prevCache.key = layerKey;
    prevCache.sampleId = sampleId;
    prevCache.isHiRes = isHiRes;
    prevCache.styleSizeKey = styleSizeKey;
    prevCache.base = base;
    prevCache.played = played;
    prevCache.slice = slice;
    prevCache.sliceReadyKey = sliceReadyKey;
    return prevCache;
  }

  return {
    key: layerKey,
    sampleId,
    isHiRes,
    styleSizeKey,
    base,
    slice,
    played,
    sliceReadyKey,
  };
}

function drawClippedLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  clipX: number,
  clipW: number,
  width: number,
  height: number
): void {
  if (clipW <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, 0, clipW, height);
  ctx.clip();
  ctx.drawImage(img, 0, 0, width, height);
  ctx.restore();
}

export function drawCompositeWaveLayers(
  ctx: CanvasRenderingContext2D,
  layers: WaveLayerCache,
  width: number,
  height: number,
  sliceStartRatio: number | null,
  sliceEndRatio: number | null,
  playedX: number,
  alpha: number
): void {
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const hasSlice =
    layers.slice !== null &&
    sliceStartRatio !== null &&
    sliceEndRatio !== null &&
    sliceEndRatio > sliceStartRatio;
  const clampedPlayed = Math.max(0, Math.min(width, playedX));

  if (clampedPlayed > 0) {
    drawClippedLayer(ctx, layers.played, 0, clampedPlayed, width, height);
  }

  if (clampedPlayed < width) {
    if (hasSlice && layers.slice) {
      const sx = Math.max(clampedPlayed, Math.floor(sliceStartRatio * width));
      const ex = Math.min(width, Math.ceil(sliceEndRatio * width));
      if (ex > sx) {
        if (sx > clampedPlayed) {
          drawClippedLayer(
            ctx,
            layers.base,
            clampedPlayed,
            sx - clampedPlayed,
            width,
            height
          );
        }
        drawClippedLayer(ctx, layers.slice, sx, ex - sx, width, height);
        if (ex < width) {
          drawClippedLayer(ctx, layers.base, ex, width - ex, width, height);
        }
      } else {
        drawClippedLayer(
          ctx,
          layers.base,
          clampedPlayed,
          width - clampedPlayed,
          width,
          height
        );
      }
    } else if (clampedPlayed === 0) {
      ctx.drawImage(layers.base, 0, 0, width, height);
    } else {
      drawClippedLayer(
        ctx,
        layers.base,
        clampedPlayed,
        width - clampedPlayed,
        width,
        height
      );
    }
  }

  ctx.restore();
}
