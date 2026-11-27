import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizePathForMatch } from "./pathHelpers";
import { registerWallpaperCacheCleaner } from "./wallpaperCacheRegistry";

const MAX_CACHE_ENTRIES = 64;
const MAX_VIEWPORT_CACHE_ENTRIES = 6;

const thumbMemoryCache = new Map<string, string>();
const pendingThumbPromises = new Map<string, Promise<string>>();

const viewportMemoryCache = new Map<string, string>();
const pendingViewportPromises = new Map<string, Promise<string>>();

let globalThumbEpoch = 0;
let globalViewportEpoch = 0;
const keyEvictEpochs = new Map<string, number>();

function isThumbWriteStale(key: string, startGlobal: number, startKey: number): boolean {
  return startGlobal !== globalThumbEpoch || (keyEvictEpochs.get(key) ?? 0) !== startKey;
}

function isViewportWriteStale(key: string, startGlobal: number, startKey: number): boolean {
  return startGlobal !== globalViewportEpoch || (keyEvictEpochs.get(key) ?? 0) !== startKey;
}

function normalizeKey(filePath: string): string {
  return normalizePathForMatch(filePath);
}

export function isGifWallpaperPath(filePath: string): boolean {
  return /\.gif(?:[?#].*)?$/i.test(filePath.trim());
}

export function isVideoWallpaperPath(filePath: string): boolean {
  return /\.(?:mp4|webm)(?:[?#].*)?$/i.test(filePath.trim());
}

export function getVideoWallpaperExtBadge(
  filePath: string
): "MP4" | "WEBM" | null {
  const trimmed = filePath.trim();
  if (/\.webm(?:[?#].*)?$/i.test(trimmed)) return "WEBM";
  if (/\.mp4(?:[?#].*)?$/i.test(trimmed)) return "MP4";
  return null;
}

function rememberBlobUrl(
  map: Map<string, string>,
  key: string,
  url: string,
  maxEntries = MAX_CACHE_ENTRIES
) {
  const prev = map.get(key);
  if (prev && prev !== url && prev.startsWith("blob:")) {
    URL.revokeObjectURL(prev);
  }
  map.delete(key);
  map.set(key, url);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    const oldestUrl = map.get(oldestKey);
    if (oldestUrl && oldestUrl.startsWith("blob:")) {
      URL.revokeObjectURL(oldestUrl);
    }
    map.delete(oldestKey);
  }
}

/**
 * Concurrency-limited background task queue with main-thread yielding.
 * Ensures that decoding multiple 4K/8K images never saturates the CPU, GPU, or UI thread.
 */
class DecodeQueue {
  private running = 0;
  private queue: (() => Promise<void>)[] = [];

  constructor(private concurrency: number = 2) {}

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await new Promise((r) => setTimeout(r, 8));
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      this.process();
    });
  }

  private process() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;
      task().finally(() => {
        this.running--;
        this.process();
      });
    }
  }
}

const decodeQueue = new DecodeQueue(2);

function loadCrossOriginImage(assetUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  return new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = assetUrl;
  });
}

function getViewportDisplayCeiling(): { maxW: number; maxH: number } {
  if (typeof window === "undefined") {
    return { maxW: 1920, maxH: 1080 };
  }
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const rawW = window.screen?.width ? Math.round(window.screen.width * dpr) : 1920;
  const rawH = window.screen?.height ? Math.round(window.screen.height * dpr) : 1080;
  return {
    maxW: Math.max(1280, Math.min(3840, rawW)),
    maxH: Math.max(720, Math.min(2160, rawH)),
  };
}

async function decodeResizedImageBlobUrl(
  img: HTMLImageElement,
  assetUrl: string,
  outWidth: number,
  outHeight: number,
  quality: number
): Promise<string> {
  const bitmap = await createImageBitmap(img, {
    resizeWidth: outWidth,
    resizeHeight: outHeight,
    resizeQuality: "high",
  });

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    bitmap.close();
    return assetUrl;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const outBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!outBlob) return assetUrl;
  return URL.createObjectURL(outBlob);
}

/**
 * Captures a single first-frame 320x180 JPEG poster from an MP4/WebM loop wallpaper
 * and immediately releases the video decoder surface so gallery tiles cost ~20 KB.
 */
async function captureVideoPosterBlobUrl(assetUrl: string): Promise<string> {
  if (typeof document === "undefined") return "";
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";

  const releaseVideo = () => {
    video.onloadeddata = null;
    video.onseeked = null;
    video.onerror = null;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      // ignore cleanup failures in non-browser runtimes
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = window.setTimeout(
        () => done(new Error("Video poster timeout")),
        4500
      );
      video.onloadeddata = () => done();
      video.onerror = () => done(new Error("Video poster load failed"));
      video.src = assetUrl;
      video.load();
    });

    const natW = Math.max(1, video.videoWidth || 320);
    const natH = Math.max(1, video.videoHeight || 180);
    const scale = Math.min(1, Math.max(320 / natW, 180 / natH));
    const outW = Math.max(1, Math.round(natW * scale));
    const outH = Math.max(1, Math.round(natH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      return "";
    }
    ctx.drawImage(video, 0, 0, outW, outH);
    const outBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86)
    );
    canvas.width = 0;
    canvas.height = 0;
    return outBlob ? URL.createObjectURL(outBlob) : "";
  } finally {
    releaseVideo();
  }
}

/**
 * Returns a fast aspect-preserving HiDPI static thumbnail URL for any wallpaper tile
 * (extracting first-frame JPEG posters for GIF and MP4/WebM to avoid multi-decoder RAM spikes).
 */
export async function getWallpaperThumbnailUrl(filePath: string): Promise<string> {
  if (!filePath) return "";
  const key = normalizeKey(filePath);
  const existing = thumbMemoryCache.get(key);
  if (existing) {
    return existing;
  }
  const pending = pendingThumbPromises.get(key);
  if (pending) {
    return pending;
  }

  const startGlobal = globalThumbEpoch;
  const startKey = keyEvictEpochs.get(key) ?? 0;

  if (isVideoWallpaperPath(filePath)) {
    const videoPromise = decodeQueue.add(async () => {
      const assetUrl = convertFileSrc(filePath);
      try {
        const posterUrl = await captureVideoPosterBlobUrl(assetUrl);
        if (isThumbWriteStale(key, startGlobal, startKey)) {
          if (posterUrl.startsWith("blob:")) {
            URL.revokeObjectURL(posterUrl);
          }
          return "";
        }
        if (posterUrl) {
          rememberBlobUrl(thumbMemoryCache, key, posterUrl);
        }
        return posterUrl;
      } catch {
        return "";
      } finally {
        pendingThumbPromises.delete(key);
      }
    });
    pendingThumbPromises.set(key, videoPromise);
    return videoPromise;
  }

  const promise = decodeQueue.add(async () => {
    const assetUrl = convertFileSrc(filePath);
    try {
      const img = await loadCrossOriginImage(assetUrl);
      const natW = Math.max(1, img.naturalWidth || 320);
      const natH = Math.max(1, img.naturalHeight || 180);
      // Scale proportionally to cover 320x180 without stretching non-16:9 images
      const scale = Math.min(1, Math.max(320 / natW, 180 / natH));
      const outW = Math.max(1, Math.round(natW * scale));
      const outH = Math.max(1, Math.round(natH * scale));
      const thumbUrl = await decodeResizedImageBlobUrl(
        img,
        assetUrl,
        outW,
        outH,
        0.88
      );
      if (isThumbWriteStale(key, startGlobal, startKey)) {
        if (thumbUrl.startsWith("blob:")) {
          URL.revokeObjectURL(thumbUrl);
        }
        return "";
      }
      rememberBlobUrl(thumbMemoryCache, key, thumbUrl);
      return thumbUrl;
    } catch {
      if (!isThumbWriteStale(key, startGlobal, startKey)) {
        rememberBlobUrl(thumbMemoryCache, key, assetUrl);
      }
      return assetUrl;
    } finally {
      pendingThumbPromises.delete(key);
    }
  });

  pendingThumbPromises.set(key, promise);
  return promise;
}

/**
 * Returns the original asset URL for crisp native rendering when the wallpaper fits
 * within the display ceiling, or proportionally downscales huge >4K/8K textures cleanly.
 */
export async function getWallpaperViewportUrl(filePath: string): Promise<string> {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("data:")) {
    return filePath;
  }
  const key = normalizeKey(filePath);
  const existing = viewportMemoryCache.get(key);
  if (existing) {
    return existing;
  }
  if (isGifWallpaperPath(filePath) || isVideoWallpaperPath(filePath)) {
    const assetUrl = convertFileSrc(filePath);
    rememberBlobUrl(viewportMemoryCache, key, assetUrl, MAX_VIEWPORT_CACHE_ENTRIES);
    return assetUrl;
  }
  const pending = pendingViewportPromises.get(key);
  if (pending) {
    return pending;
  }

  const startGlobal = globalViewportEpoch;
  const startKey = keyEvictEpochs.get(key) ?? 0;

  const promise = decodeQueue.add(async () => {
    const assetUrl = convertFileSrc(filePath);
    try {
      const img = await loadCrossOriginImage(assetUrl);
      const natW = Math.max(1, img.naturalWidth || 0);
      const natH = Math.max(1, img.naturalHeight || 0);
      const { maxW, maxH } = getViewportDisplayCeiling();

      // Native HD / QHD images render directly without downscaling or recompression
      if (natW <= maxW && natH <= maxH) {
        if (isViewportWriteStale(key, startGlobal, startKey)) {
          return "";
        }
        rememberBlobUrl(viewportMemoryCache, key, assetUrl, MAX_VIEWPORT_CACHE_ENTRIES);
        return assetUrl;
      }

      const scale = Math.min(maxW / natW, maxH / natH);
      const outW = Math.max(1, Math.round(natW * scale));
      const outH = Math.max(1, Math.round(natH * scale));
      const url = await decodeResizedImageBlobUrl(
        img,
        assetUrl,
        outW,
        outH,
        0.94
      );
      if (isViewportWriteStale(key, startGlobal, startKey)) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
        return "";
      }
      rememberBlobUrl(viewportMemoryCache, key, url, MAX_VIEWPORT_CACHE_ENTRIES);
      return url;
    } catch {
      if (!isViewportWriteStale(key, startGlobal, startKey)) {
        rememberBlobUrl(viewportMemoryCache, key, assetUrl, MAX_VIEWPORT_CACHE_ENTRIES);
      }
      return assetUrl;
    } finally {
      pendingViewportPromises.delete(key);
    }
  });

  pendingViewportPromises.set(key, promise);
  return promise;
}

/**
 * Returns synchronously cached thumbnail URL if already generated, otherwise null.
 */
export function getCachedThumbnailUrl(filePath: string): string | null {
  if (!filePath) return null;
  return thumbMemoryCache.get(normalizeKey(filePath)) || null;
}

/**
 * Returns synchronously cached viewport URL if already generated, otherwise null.
 */
export function getCachedViewportUrl(filePath: string): string | null {
  if (!filePath) return null;
  if (filePath.startsWith("http") || filePath.startsWith("data:")) return filePath;
  return viewportMemoryCache.get(normalizeKey(filePath)) || null;
}

/**
 * Clears cache and revokes Blob URLs for a deleted image.
 */
export function evictThumbnailCache(filePath: string) {
  if (!filePath) return;
  const key = normalizeKey(filePath);
  for (const candidate of [key, filePath]) {
    keyEvictEpochs.set(candidate, (keyEvictEpochs.get(candidate) ?? 0) + 1);
    const existingThumb = thumbMemoryCache.get(candidate);
    if (existingThumb && existingThumb.startsWith("blob:")) {
      URL.revokeObjectURL(existingThumb);
    }
    thumbMemoryCache.delete(candidate);
    pendingThumbPromises.delete(candidate);

    const existingViewport = viewportMemoryCache.get(candidate);
    if (existingViewport && existingViewport.startsWith("blob:")) {
      URL.revokeObjectURL(existingViewport);
    }
    viewportMemoryCache.delete(candidate);
    pendingViewportPromises.delete(candidate);
  }
}

/**
 * Releases cached wallpaper URLs immediately (revoking Object URLs to reclaim Chromium memory).
 */
export function clearWallpaperMediaCaches(
  scope: "viewport" | "all" = "viewport"
): void {
  globalViewportEpoch += 1;
  for (const url of viewportMemoryCache.values()) {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
  viewportMemoryCache.clear();
  pendingViewportPromises.clear();

  if (scope === "all") {
    globalThumbEpoch += 1;
    keyEvictEpochs.clear();
    for (const url of thumbMemoryCache.values()) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
    thumbMemoryCache.clear();
    pendingThumbPromises.clear();
  }
}

registerWallpaperCacheCleaner("wallpaper_media_viewport", () => {
  clearWallpaperMediaCaches("viewport");
});
registerWallpaperCacheCleaner("wallpaper_media_all", () => {
  clearWallpaperMediaCaches("all");
});
