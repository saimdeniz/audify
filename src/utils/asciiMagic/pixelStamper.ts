import type { AsciiMagicFrame, AsciiMagicPalette } from "../../types";
import { GlyphAtlas } from "./glyphAtlas";

export interface DotEntry {
  cx: number;
  cy: number;
  r: number;
  hex: string;
}

export interface PixelEntry {
  i: number;
  j: number;
  hex: string;
}

interface DotMask {
  R: number;
  n: number;
  a: Float32Array;
}

export const B8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
  14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];

const pixelImgCache = new WeakMap<HTMLCanvasElement, ImageData>();
const ditherCanvasCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const ditherAtlasCache = new WeakMap<HTMLCanvasElement, GlyphAtlas>();
const dotMasks = new Map<number, DotMask>();
const rgbCache = new Map<string, readonly [number, number, number]>();
const packedColorCache = new Map<string, number>();

export function clearPixelStamperGlobalCaches(): void {
  dotMasks.clear();
  rgbCache.clear();
  packedColorCache.clear();
}

export function releasePixelStamperCaches(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  pixelImgCache.delete(canvas);
  const off = ditherCanvasCache.get(canvas);
  if (off) {
    off.width = 0;
    off.height = 0;
    ditherCanvasCache.delete(canvas);
  }
  const atlas = ditherAtlasCache.get(canvas);
  if (atlas) {
    atlas.dispose();
    ditherAtlasCache.delete(canvas);
  }
}

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function packRgba(r: number, g: number, b: number): number {
  return (
    IS_LITTLE_ENDIAN
      ? (255 << 24) | (b << 16) | (g << 8) | r
      : (r << 24) | (g << 16) | (b << 8) | 255
  ) >>> 0;
}

function getRgb(hex: string): readonly [number, number, number] {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  const triple: readonly [number, number, number] = [
    parseInt(hex.slice(1, 3), 16) || 0,
    parseInt(hex.slice(3, 5), 16) || 0,
    parseInt(hex.slice(5, 7), 16) || 0,
  ];
  if (rgbCache.size > 4096) rgbCache.clear();
  rgbCache.set(hex, triple);
  return triple;
}

function getPixelBuffer(
  ctx: CanvasRenderingContext2D,
  over: boolean
): ImageData | null {
  const cv = ctx.canvas;
  const W = cv.width;
  const H = cv.height;
  if (W <= 0 || H <= 0) return null;
  if (over) {
    return ctx.getImageData(0, 0, W, H);
  }
  let img = pixelImgCache.get(cv);
  if (!img || img.width !== W || img.height !== H) {
    img = new ImageData(W, H);
    pixelImgCache.set(cv, img);
  } else {
    img.data.fill(0);
  }
  return img;
}

function getDotMask(radius: number, fx: number, fy: number): DotMask {
  const q = Math.round(radius * 4) / 4;
  const ox = Math.round(fx * 4) / 4;
  const oy = Math.round(fy * 4) / 4;
  const key = q * 100 + ox * 10 + oy;
  const cached = dotMasks.get(key);
  if (cached) return cached;

  const R = Math.ceil(q + 1);
  const n = R * 2 + 1;
  const a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let count = 0;
      for (let sj = 0; sj < 4; sj++) {
        for (let si = 0; si < 4; si++) {
          const dx = i - R + (si + 0.5) / 4 - ox;
          const dy = j - R + (sj + 0.5) / 4 - oy;
          if (dx * dx + dy * dy <= q * q) count++;
        }
      }
      a[j * n + i] = count / 16;
    }
  }
  const mask: DotMask = { R, n, a };
  if (dotMasks.size > 2048) dotMasks.clear();
  dotMasks.set(key, mask);
  return mask;
}

export function stampDots(
  ctx: CanvasRenderingContext2D,
  layers: DotEntry[][],
  over: boolean
): void {
  const img = getPixelBuffer(ctx, over);
  if (!img) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const d = img.data;

  for (const layer of layers) {
    for (const dot of layer) {
      const bx = Math.floor(dot.cx);
      const by = Math.floor(dot.cy);
      const mask = getDotMask(dot.r, dot.cx - bx - 0.5, dot.cy - by - 0.5);
      const [r, g, b] = getRgb(dot.hex);
      const x0 = bx - mask.R;
      const y0 = by - mask.R;
      for (let j = 0; j < mask.n; j++) {
        const yy = y0 + j;
        if (yy < 0 || yy >= H) continue;
        for (let i = 0; i < mask.n; i++) {
          const xx = x0 + i;
          if (xx < 0 || xx >= W) continue;
          const cov = mask.a[j * mask.n + i];
          if (cov <= 0) continue;
          const o = (yy * W + xx) * 4;
          const prevA = d[o + 3] / 255;
          const nextA = cov + prevA * (1 - cov);
          d[o] = (r * cov + d[o] * prevA * (1 - cov)) / nextA;
          d[o + 1] = (g * cov + d[o + 1] * prevA * (1 - cov)) / nextA;
          d[o + 2] = (b * cov + d[o + 2] * prevA * (1 - cov)) / nextA;
          d[o + 3] = nextA * 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function stampPixels(
  ctx: CanvasRenderingContext2D,
  pix: PixelEntry[],
  x: number,
  y: number,
  sx: number,
  sy: number,
  dpr: number,
  over: boolean
): void {
  const img = getPixelBuffer(ctx, over);
  if (!img) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const d32 = new Uint32Array(img.data.buffer);

  for (const p of pix) {
    let packed = packedColorCache.get(p.hex);
    if (packed === undefined) {
      const [r, g, b] = getRgb(p.hex);
      packed = packRgba(r, g, b);
      if (packedColorCache.size > 4096) packedColorCache.clear();
      packedColorCache.set(p.hex, packed);
    }
    const x0 = Math.max(0, Math.round((x + p.i * sx) * dpr));
    const x1 = Math.min(W, Math.round((x + (p.i + 1) * sx) * dpr));
    const y0 = Math.max(0, Math.round((y + p.j * sy) * dpr));
    const y1 = Math.min(H, Math.round((y + (p.j + 1) * sy) * dpr));
    for (let yy = y0; yy < y1; yy++) {
      d32.fill(packed, yy * W + x0, yy * W + x1);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export interface DitherStampOptions {
  x: number;
  y: number;
  cw: number;
  ch: number;
  ink: string;
  dpr: number;
  density?: number;
  gamma?: number;
  over?: boolean;
  atlas?: GlyphAtlas;
}

export type TextPainterFn = (
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  x: number,
  y: number,
  cw: number,
  ch: number,
  ink: string,
  atlas: GlyphAtlas | undefined,
  dpr: number
) => void;

export function paintDitherStamped(
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: DitherStampOptions,
  paintTextFn: TextPainterFn
): void {
  const { x, y, cw, ch, ink, dpr } = opts;
  const density = Math.max(0.3, opts.density ?? 1.31);
  const sat = 0.85;
  const T = frame.text.split("\n");
  const cols = T[0] ? [...T[0]].length : 0;
  const rows = T.length;
  if (cols === 0 || rows === 0) return;

  const px = Math.max(1 / dpr, Math.min(cw, ch) / (2.6 * density));
  const kc = Math.max(1, (opts.gamma ?? 0.35) / 0.35);
  const gw = Math.max(1, Math.ceil((cols * cw) / px));
  const gh = Math.max(1, Math.ceil((rows * ch) / px));

  const mainCanvas = ctx.canvas;
  let off = ditherCanvasCache.get(mainCanvas);
  if (!off) {
    off = document.createElement("canvas");
    ditherCanvasCache.set(mainCanvas, off);
  }
  if (off.width !== gw || off.height !== gh) {
    off.width = gw;
    off.height = gh;
  }
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (!octx) return;

  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, gw, gh);
  octx.setTransform(1 / px, 0, 0, 1 / px, 0, 0);

  let atlas = opts.atlas ?? ditherAtlasCache.get(mainCanvas);
  if (!atlas) {
    atlas = new GlyphAtlas();
    ditherAtlasCache.set(mainCanvas, atlas);
  }
  paintTextFn(octx, frame, palette, 0, 0, cw, ch, ink, atlas, dpr);

  const src = octx.getImageData(0, 0, gw, gh).data;
  const img = getPixelBuffer(ctx, Boolean(opts.over));
  if (!img) return;
  const d32 = new Uint32Array(img.data.buffer);
  const W = mainCanvas.width;
  const H = mainCanvas.height;

  for (let j = 0; j < gh; j++) {
    const y0 = Math.max(0, Math.round((y + j * px) * dpr));
    const y1 = Math.min(H, Math.round((y + (j + 1) * px) * dpr));
    if (y1 <= y0) continue;
    for (let i = 0; i < gw; i++) {
      const q = (j * gw + i) * 4;
      const a = src[q + 3];
      if (a < 6 || Math.pow(a / 255, kc) <= (B8[(j & 7) * 8 + (i & 7)] + 0.5) / 64) {
        continue;
      }
      const r = src[q];
      const g = src[q + 1];
      const b = src[q + 2];
      const mx = Math.max(r, g, b, 1);
      const f = (255 / mx) * sat + (1 - sat);
      const packed = packRgba(
        Math.min(255, Math.round(r * f)),
        Math.min(255, Math.round(g * f)),
        Math.min(255, Math.round(b * f))
      );
      const x0 = Math.max(0, Math.round((x + i * px) * dpr));
      const x1 = Math.min(W, Math.round((x + (i + 1) * px) * dpr));
      for (let yy = y0; yy < y1; yy++) {
        d32.fill(packed, yy * W + x0, yy * W + x1);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
