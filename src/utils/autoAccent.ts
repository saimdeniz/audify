import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AsciiMagicPreviewSnapshot } from "../types";
import {
  asciiMagicAccentCache,
  asciiMagicAccentEpoch,
  asciiMagicKeyEpochs,
  imageAccentCache,
  imageAccentEpoch,
  imageAccentKeyEpochs,
  pendingAsciiMagicAccentPromises,
  pendingImageAccentPromises,
  rememberBoundedAccentCache,
} from "./autoAccentCache";
import { normalizePathForMatch } from "./pathHelpers";
import { getWallpaperThumbnailUrl } from "./thumbnailCache";

export {
  clearAllAutoAccentCaches,
  evictAsciiMagicAutoAccentCache,
  evictAutoAccentCache,
  getCachedAsciiMagicAutoAccentHex,
  getPresetAutoAccentHex,
} from "./autoAccentCache";

const SAMPLE_GRID_SIZE = 28;
const HUE_BIN_COUNT = 24;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));

  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const toChannel = (t: number) => {
    const tt = ((t % 1) + 1) % 1;
    if (tt < 1 / 6) return Math.round((p + (q - p) * 6 * tt) * 255);
    if (tt < 0.5) return Math.round(q * 255);
    if (tt < 2 / 3) return Math.round((p + (q - p) * (2 / 3 - tt) * 6) * 255);
    return Math.round(p * 255);
  };

  const r = toChannel(hue + 1 / 3);
  const g = toChannel(hue);
  const b = toChannel(hue - 1 / 3);
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function createAccentHistogram() {
  const binWeights = new Float64Array(HUE_BIN_COUNT);
  const binWeightedHueSin = new Float64Array(HUE_BIN_COUNT);
  const binWeightedHueCos = new Float64Array(HUE_BIN_COUNT);
  const binWeightedSat = new Float64Array(HUE_BIN_COUNT);
  const binWeightedLig = new Float64Array(HUE_BIN_COUNT);

  let neutralWeight = 0;
  let neutralR = 0;
  let neutralG = 0;
  let neutralB = 0;

  return {
    addRgb(r: number, g: number, b: number, count = 1): void {
      if (count <= 0) return;
      const [h, s, l] = rgbToHsl(r, g, b);

      // Track fallback mid-tone pixels in case the source is monochrome/desaturated
      if (l >= 0.14 && l <= 0.88) {
        const mw = (1 - Math.abs(l - 0.5)) * count;
        neutralWeight += mw;
        neutralR += r * mw;
        neutralG += g * mw;
        neutralB += b * mw;
      }

      // Skip dull greys, clipped black, or near-white highlights for hue histogram
      if (s < 0.14 || l < 0.12 || l > 0.9) return;

      // Peak weight at healthy UI mid-lightness & vibrant saturation
      const ligBalance = 1 - Math.abs(l - 0.52) * 1.45;
      const w = s * s * Math.max(0.18, ligBalance) * count;
      const bin = Math.min(HUE_BIN_COUNT - 1, Math.floor(h * HUE_BIN_COUNT));

      const rad = h * Math.PI * 2;
      binWeights[bin] += w;
      binWeightedHueSin[bin] += Math.sin(rad) * w;
      binWeightedHueCos[bin] += Math.cos(rad) * w;
      binWeightedSat[bin] += s * w;
      binWeightedLig[bin] += l * w;
    },

    finalize(allowNeutralFallback: boolean): string | null {
      let bestBin = -1;
      let bestScore = 0;
      for (let i = 0; i < HUE_BIN_COUNT; i++) {
        // Include adjacent neighbor energy so split tones stay cohesive
        const prev = binWeights[(i - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT];
        const next = binWeights[(i + 1) % HUE_BIN_COUNT];
        const score = binWeights[i] + (prev + next) * 0.3;
        if (score > bestScore && binWeights[i] > 0) {
          bestScore = score;
          bestBin = i;
        }
      }

      if (bestBin >= 0 && binWeights[bestBin] > 0) {
        const w = binWeights[bestBin];
        const avgHue =
          Math.atan2(binWeightedHueSin[bestBin], binWeightedHueCos[bestBin]) /
          (Math.PI * 2);
        const avgSat = binWeightedSat[bestBin] / w;
        const avgLig = binWeightedLig[bestBin] / w;

        const calibratedSat = Math.max(0.54, Math.min(0.92, avgSat * 1.06));
        const calibratedLig = Math.max(0.46, Math.min(0.64, avgLig));
        return hslToHex(avgHue, calibratedSat, calibratedLig);
      }

      if (allowNeutralFallback && neutralWeight > 0) {
        const mr = Math.round(neutralR / neutralWeight);
        const mg = Math.round(neutralG / neutralWeight);
        const mb = Math.round(neutralB / neutralWeight);
        const [h, s, l] = rgbToHsl(mr, mg, mb);
        return hslToHex(h, Math.min(0.28, s), Math.max(0.45, Math.min(0.62, l)));
      }

      return null;
    },
  };
}

function parseCssColorToRgb(raw: string): [number, number, number] | null {
  const color = raw.trim();
  if (color[0] === "#") {
    if (color.length === 7) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r, g, b];
      }
    } else if (color.length === 4) {
      const r = parseInt(color[1] + color[1], 16);
      const g = parseInt(color[2] + color[2], 16);
      const b = parseInt(color[3] + color[3], 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r, g, b];
      }
    }
    return null;
  }
  const m = color.match(/\d+(\.\d+)?/g);
  if (m && m.length >= 3) {
    return [
      Math.max(0, Math.min(255, Math.round(Number(m[0])))),
      Math.max(0, Math.min(255, Math.round(Number(m[1])))),
      Math.max(0, Math.min(255, Math.round(Number(m[2])))),
    ];
  }
  return null;
}

/**
 * Extracts a vibrant, readable theme accent hex from sampled RGBA pixel data.
 * Rejects deep shadows/blown-out highlights and boosts low-chroma washes slightly.
 */
export function pickAccentFromRgbaPixels(
  data: Uint8ClampedArray | number[],
  allowNeutralFallback = true
): string | null {
  if (!data || data.length < 4) return null;

  const histogram = createAccentHistogram();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    histogram.addRgb(data[i], data[i + 1], data[i + 2], 1);
  }
  return histogram.finalize(allowNeutralFallback);
}

/**
 * Extracts the dominant chromatic theme accent hex from an ascii-magic preview snapshot.
 * Monochrome/achromatic scenes return null so they cleanly retain the user's accent.
 */
export function pickAccentFromAsciiMagicSnapshot(
  snapshot: AsciiMagicPreviewSnapshot
): string | null {
  const palette = snapshot.frame.paletteOverride ?? snapshot.meta.palette;
  if (!palette) return null;

  const paletteRgb = new Map<string, [number, number, number]>();
  for (const [key, rawColor] of Object.entries(palette)) {
    if (!rawColor) continue;
    const parsed = parseCssColorToRgb(rawColor);
    if (parsed) paletteRgb.set(key, parsed);
  }
  if (paletteRgb.size === 0) return null;

  const keyCounts = new Map<string, number>();
  let totalColoredCells = 0;
  if (snapshot.frame.color) {
    const textLines = snapshot.frame.text.split("\n");
    const colorLines = snapshot.frame.color.split("\n");
    for (let r = 0; r < textLines.length; r++) {
      const colRow = colorLines[r];
      if (!colRow) continue;
      let ci = 0;
      for (const glyph of textLines[r]) {
        const key = colRow[ci++];
        if (glyph === " " || !key || key === " ") continue;
        if (paletteRgb.has(key)) {
          keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
          totalColoredCells++;
        }
      }
    }
  }

  const histogram = createAccentHistogram();
  if (totalColoredCells > 0) {
    for (const [key, count] of keyCounts) {
      const rgb = paletteRgb.get(key);
      if (rgb) histogram.addRgb(rgb[0], rgb[1], rgb[2], count);
    }
  } else {
    for (const rgb of paletteRgb.values()) {
      histogram.addRgb(rgb[0], rgb[1], rgb[2], 1);
    }
  }

  return histogram.finalize(false);
}

function loadCorsImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed for auto-accent"));
    img.src = url;
  });
}

export function cacheAsciiMagicAutoAccent(
  slug: string,
  snapshot: AsciiMagicPreviewSnapshot
): string | null {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  const hex = pickAccentFromAsciiMagicSnapshot(snapshot);
  if (hex) {
    rememberBoundedAccentCache(asciiMagicAccentCache, key, hex);
  }
  return hex;
}

/**
 * Extracts and caches the dominant chromatic theme accent color for an installed
 * ascii-magic catalog scene via its saved preview snapshot (or sandbox fallback).
 */
export async function extractDominantAsciiMagicAccent(
  slug: string
): Promise<string | null> {
  const key = slug.trim().toLowerCase();
  if (!key) return null;

  const cached = asciiMagicAccentCache.get(key);
  if (cached) return cached;

  const pending = pendingAsciiMagicAccentPromises.get(key);
  if (pending) return pending;

  const startEpoch = asciiMagicAccentEpoch;
  const startKeyEpoch = asciiMagicKeyEpochs.get(key) ?? 0;

  const task = (async (): Promise<string | null> => {
    try {
      let snapshot: AsciiMagicPreviewSnapshot | null = null;
      try {
        const raw = await invoke<string | null>("get_ascii_magic_preview", {
          slug: key,
        });
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<AsciiMagicPreviewSnapshot>;
          if (
            parsed &&
            parsed.meta &&
            parsed.frame &&
            typeof parsed.frame.text === "string"
          ) {
            snapshot = parsed as AsciiMagicPreviewSnapshot;
          }
        }
      } catch {
        // Ignore invoke errors in non-Tauri or missing preview scenarios
      }

      if (!snapshot && typeof window !== "undefined") {
        const { asciiMagicSandbox } = await import("./asciiMagic/sandboxBridge");
        snapshot = await asciiMagicSandbox.capturePiecePreview(key);
        void invoke("save_ascii_magic_preview", {
          slug: key,
          previewJson: JSON.stringify(snapshot),
        }).catch(() => {});
      }

      if (!snapshot) return null;
      const hex = pickAccentFromAsciiMagicSnapshot(snapshot);
      if (
        hex &&
        startEpoch === asciiMagicAccentEpoch &&
        (asciiMagicKeyEpochs.get(key) ?? 0) === startKeyEpoch
      ) {
        rememberBoundedAccentCache(asciiMagicAccentCache, key, hex);
      }
      return hex;
    } catch {
      return null;
    } finally {
      pendingAsciiMagicAccentPromises.delete(key);
    }
  })();

  pendingAsciiMagicAccentPromises.set(key, task);
  return task;
}

/**
 * Extracts and caches the dominant vibrant theme accent color for a wallpaper image.
 */
export async function extractDominantImageAccent(
  filePath: string
): Promise<string | null> {
  if (!filePath || typeof document === "undefined") return null;

  const key = normalizePathForMatch(filePath);
  const cached = imageAccentCache.get(key);
  if (cached) return cached;

  const pending = pendingImageAccentPromises.get(key);
  if (pending) return pending;

  const startEpoch = imageAccentEpoch;
  const startKeyEpoch = imageAccentKeyEpochs.get(key) ?? 0;

  const task = (async (): Promise<string | null> => {
    try {
      const thumbUrl =
        filePath.startsWith("data:") ||
        filePath.startsWith("blob:") ||
        filePath.startsWith("http://") ||
        filePath.startsWith("https://")
          ? filePath
          : (await getWallpaperThumbnailUrl(filePath)) ||
            convertFileSrc(filePath);

      const img = await loadCorsImage(thumbUrl);
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_GRID_SIZE;
      canvas.height = SAMPLE_GRID_SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, SAMPLE_GRID_SIZE, SAMPLE_GRID_SIZE);
      const pixels = ctx.getImageData(0, 0, SAMPLE_GRID_SIZE, SAMPLE_GRID_SIZE).data;
      const hex = pickAccentFromRgbaPixels(pixels);
      if (
        hex &&
        startEpoch === imageAccentEpoch &&
        (imageAccentKeyEpochs.get(key) ?? 0) === startKeyEpoch
      ) {
        rememberBoundedAccentCache(imageAccentCache, key, hex);
      }
      return hex;
    } catch {
      return null;
    } finally {
      pendingImageAccentPromises.delete(key);
    }
  })();

  pendingImageAccentPromises.set(key, task);
  return task;
}
