import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizePathForMatch } from "./pathHelpers";
import { isGifWallpaperPath, isVideoWallpaperPath } from "./thumbnailCache";
import { registerWallpaperCacheCleaner } from "./wallpaperCacheRegistry";

const MAX_BLUR_CACHE_ENTRIES = 4;

const blurCache = new Map<string, string>();
const pendingBlurPromises = new Map<string, Promise<string | null>>();

let globalBlurEpoch = 0;
const keyBlurEpochs = new Map<string, number>();

function makeBlurCacheKey(filePath: string, blurPx: number): string {
  return `${normalizePathForMatch(filePath)}|${Math.round(blurPx)}`;
}

function isWriteStale(
  normPath: string,
  startGlobal: number,
  startKey: number
): boolean {
  return (
    startGlobal !== globalBlurEpoch ||
    (keyBlurEpochs.get(normPath) ?? 0) !== startKey
  );
}

function rememberBlurBlob(cacheKey: string, url: string): void {
  const prev = blurCache.get(cacheKey);
  if (prev && prev !== url && prev.startsWith("blob:")) {
    URL.revokeObjectURL(prev);
  }
  blurCache.delete(cacheKey);
  blurCache.set(cacheKey, url);
  while (blurCache.size > MAX_BLUR_CACHE_ENTRIES) {
    const oldestKey = blurCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldestUrl = blurCache.get(oldestKey);
    if (oldestUrl && oldestUrl.startsWith("blob:")) {
      URL.revokeObjectURL(oldestUrl);
    }
    blurCache.delete(oldestKey);
  }
}

export function canPreBlurWallpaper(filePath: string, blurPx: number): boolean {
  if (!filePath || blurPx <= 0) return false;
  if (filePath.startsWith("http") || filePath.startsWith("data:")) return false;
  return !isGifWallpaperPath(filePath) && !isVideoWallpaperPath(filePath);
}

export function getCachedBlurredWallpaperUrl(
  filePath: string,
  blurPx: number
): string | null {
  if (!canPreBlurWallpaper(filePath, blurPx)) return null;
  return blurCache.get(makeBlurCacheKey(filePath, blurPx)) ?? null;
}

function getBlurDownscaleFactor(blurPx: number): number {
  if (blurPx >= 14) return 1 / 3;
  if (blurPx >= 4) return 0.5;
  return 0.75;
}

function loadSourceImage(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Pre-blur source load failed"));
    img.src = url;
  });
}

function drawEdgeClampedSource(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement,
  drawW: number,
  drawH: number,
  pad: number
): void {
  // Center image at exact 1:1 coordinates inside padded frame
  ctx.drawImage(source, pad, pad, drawW, drawH);
  if (pad <= 0) return;

  const srcW = Math.max(1, source.naturalWidth || drawW);
  const srcH = Math.max(1, source.naturalHeight || drawH);

  // Replicate 1px edge strips (GPU CLAMP_TO_EDGE equivalent) to prevent edge darkening
  ctx.drawImage(source, 0, 0, srcW, 1, pad, 0, drawW, pad);
  ctx.drawImage(source, 0, srcH - 1, srcW, 1, pad, pad + drawH, drawW, pad);
  ctx.drawImage(source, 0, 0, 1, srcH, 0, pad, pad, drawH);
  ctx.drawImage(source, srcW - 1, 0, 1, srcH, pad + drawW, pad, pad, drawH);

  // 4 corners
  ctx.drawImage(source, 0, 0, 1, 1, 0, 0, pad, pad);
  ctx.drawImage(source, srcW - 1, 0, 1, 1, pad + drawW, 0, pad, pad);
  ctx.drawImage(source, 0, srcH - 1, 1, 1, 0, pad + drawH, pad, pad);
  ctx.drawImage(
    source,
    srcW - 1,
    srcH - 1,
    1,
    1,
    pad + drawW,
    pad + drawH,
    pad,
    pad
  );
}

/**
 * Generates an offscreen edge-clamped pre-blurred static wallpaper texture so
 * Chromium does not need a live full-viewport `backdrop-filter` GPU FBO pass.
 * Keeps exact 1:1 image framing with zero zoom shift and zero dark borders.
 */
export async function getBlurredWallpaperUrl(
  filePath: string,
  blurPx: number
): Promise<string | null> {
  const roundedBlur = Math.round(blurPx);
  if (!canPreBlurWallpaper(filePath, roundedBlur)) return null;
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }

  const cacheKey = makeBlurCacheKey(filePath, roundedBlur);
  const existing = blurCache.get(cacheKey);
  if (existing) return existing;

  const pending = pendingBlurPromises.get(cacheKey);
  if (pending) return pending;

  const normPath = normalizePathForMatch(filePath);
  const startGlobal = globalBlurEpoch;
  const startKey = keyBlurEpochs.get(normPath) ?? 0;

  const promise = (async (): Promise<string | null> => {
    try {
      const probeCanvas = document.createElement("canvas");
      const probeCtx = probeCanvas.getContext("2d");
      if (!probeCtx || typeof probeCtx.filter !== "string") {
        return null;
      }

      const assetUrl = convertFileSrc(filePath);
      const img = await loadSourceImage(assetUrl);
      if (isWriteStale(normPath, startGlobal, startKey)) return null;

      const natW = Math.max(1, img.naturalWidth || 1);
      const natH = Math.max(1, img.naturalHeight || 1);
      const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      const maxW = Math.min(
        1920,
        Math.max(1280, Math.round((window.screen?.width || 1920) * dpr))
      );
      const maxH = Math.min(
        1080,
        Math.max(720, Math.round((window.screen?.height || 1080) * dpr))
      );

      const fitScale = Math.min(1, maxW / natW, maxH / natH);
      const downscale = getBlurDownscaleFactor(roundedBlur);
      const drawW = Math.max(32, Math.round(natW * fitScale * downscale));
      const drawH = Math.max(32, Math.round(natH * fitScale * downscale));

      // Scale blur radius proportionally to canvas downscale factor
      const scaledBlur = Math.max(0.5, roundedBlur * downscale);
      const pad = Math.min(96, Math.ceil(scaledBlur * 2.5));

      const padded = document.createElement("canvas");
      padded.width = drawW + pad * 2;
      padded.height = drawH + pad * 2;
      const paddedCtx = padded.getContext("2d", { alpha: false });
      if (!paddedCtx) {
        padded.width = 0;
        padded.height = 0;
        return null;
      }
      drawEdgeClampedSource(paddedCtx, img, drawW, drawH, pad);

      const out = document.createElement("canvas");
      out.width = drawW;
      out.height = drawH;
      const outCtx = out.getContext("2d", { alpha: false });
      if (!outCtx) {
        padded.width = 0;
        padded.height = 0;
        out.width = 0;
        out.height = 0;
        return null;
      }

      outCtx.filter = `blur(${scaledBlur.toFixed(2)}px)`;
      outCtx.drawImage(padded, -pad, -pad);

      padded.width = 0;
      padded.height = 0;

      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, "image/jpeg", 0.9)
      );
      out.width = 0;
      out.height = 0;
      if (!blob) return null;

      if (isWriteStale(normPath, startGlobal, startKey)) {
        return null;
      }

      const blobUrl = URL.createObjectURL(blob);
      rememberBlurBlob(cacheKey, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      pendingBlurPromises.delete(cacheKey);
    }
  })();

  pendingBlurPromises.set(cacheKey, promise);
  return promise;
}

export function evictBlurredWallpaperCache(filePath: string): void {
  if (!filePath) return;
  const norm = normalizePathForMatch(filePath);
  const prefix = `${norm}|`;
  keyBlurEpochs.set(norm, (keyBlurEpochs.get(norm) ?? 0) + 1);
  for (const [k, url] of Array.from(blurCache.entries())) {
    if (k.startsWith(prefix)) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
      blurCache.delete(k);
    }
  }
  for (const k of Array.from(pendingBlurPromises.keys())) {
    if (k.startsWith(prefix)) {
      pendingBlurPromises.delete(k);
    }
  }
}

export function clearBlurredWallpaperCache(): void {
  globalBlurEpoch += 1;
  keyBlurEpochs.clear();
  for (const url of blurCache.values()) {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
  blurCache.clear();
  pendingBlurPromises.clear();
}

registerWallpaperCacheCleaner("wallpaper_blur", clearBlurredWallpaperCache);
