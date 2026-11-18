import type {
  AsciiMagicFrame,
  AsciiMagicLook,
  AsciiMagicPalette,
  AsciiMagicPieceMeta,
  AsciiMagicPreviewSnapshot,
  ThemeMode,
} from "../../types";
import { CELL_W, cellAspect, GlyphAtlas } from "./glyphAtlas";
import {
  paintDitherImage,
  paintInvertedDots,
  paintText,
  paintTone,
  resolveRenderMode,
} from "./halftonePainter";
import {
  adaptPaletteForLightTheme,
  clearLooksCaches,
  restyleFrame,
  restyleMerged,
} from "./looks";
import { clearMicroPainterCache, getMergedSquareGridDims } from "./microPainter";
import {
  clearPixelStamperGlobalCaches,
  releasePixelStamperCaches,
} from "./pixelStamper";
import { registerWallpaperCacheCleaner } from "../wallpaperCacheRegistry";

const canvasAtlasMap = new WeakMap<HTMLCanvasElement, GlyphAtlas>();
let sharedThumbAtlas: GlyphAtlas | null = null;

function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

export function clearAsciiMagicRenderCaches(): void {
  if (sharedThumbAtlas) {
    sharedThumbAtlas.dispose();
    sharedThumbAtlas = null;
  }
  clearPixelStamperGlobalCaches();
  clearMicroPainterCache();
  clearLooksCaches();
}

registerWallpaperCacheCleaner("ascii_magic_render", clearAsciiMagicRenderCaches);

export function getAtlasForCanvas(canvas: HTMLCanvasElement): GlyphAtlas {
  let atlas = canvasAtlasMap.get(canvas);
  if (!atlas) {
    atlas = new GlyphAtlas();
    canvasAtlasMap.set(canvas, atlas);
  }
  return atlas;
}

export function releaseCanvasRenderCaches(
  canvas: HTMLCanvasElement | null,
  zeroCanvasDimensions = false
): void {
  if (!canvas) return;
  const atlas = canvasAtlasMap.get(canvas);
  if (atlas) {
    atlas.dispose();
    canvasAtlasMap.delete(canvas);
  }
  releasePixelStamperCaches(canvas);
  if (zeroCanvasDimensions) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export interface RenderFrameOptions {
  look: AsciiMagicLook;
  themeMode: ThemeMode;
  fit?: "cover" | "contain";
  margin?: number;
  bgFill?: string | null;
  atlas?: GlyphAtlas;
}

export function renderAsciiMagicFrame(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  meta: AsciiMagicPieceMeta,
  frame: AsciiMagicFrame,
  options: RenderFrameOptions
): void {
  if (cssWidth <= 0 || cssHeight <= 0) return;

  const isLight = options.themeMode === "light";
  const ink = isLight ? "#27272a" : "#e4e4e7";
  const fit = options.fit ?? "cover";
  const margin = options.margin ?? 0.02;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (options.bgFill) {
    ctx.fillStyle = options.bgFill;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  } else {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
  }

  const lines = frame.text.split("\n");
  const rawRows = Math.max(1, lines.length || meta.rows || 1);
  const rawCols = Math.max(
    1,
    lines[0] ? countCodePoints(lines[0]) : meta.cols || 1
  );

  const rawPalette: AsciiMagicPalette | null =
    frame.paletteOverride ?? meta.palette;
  const effectivePalette = isLight
    ? adaptPaletteForLightTheme(rawPalette)
    : rawPalette;

  const mode = resolveRenderMode(meta, options.look);
  const over = Boolean(options.bgFill);

  const isMergedSquareText =
    mode === "text" && options.look !== "original" && meta.cell === "square";
  const dims = isMergedSquareText
    ? getMergedSquareGridDims(rawCols, rawRows)
    : { cols: rawCols, rows: rawRows };
  const cols = dims.cols;
  const rows = dims.rows;
  const aspect = isMergedSquareText ? 1 / CELL_W : cellAspect(meta);
  const m = fit === "cover" ? 1 : 1 - margin * 2;
  const sx = (cssWidth * m) / cols;
  const sy = (cssHeight * m) / (rows * aspect);
  const cw = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  const ch = cw * aspect;
  const x = (cssWidth - cols * cw) / 2;
  const y = (cssHeight - rows * ch) / 2;

  if (mode === "text") {
    const atlas = options.atlas ?? getAtlasForCanvas(ctx.canvas);
    let targetFrame = frame;
    let targetPalette = effectivePalette;
    if (options.look !== "original") {
      const restyled = isMergedSquareText
        ? restyleMerged(frame, rawPalette, cols, rows, {
            look: options.look,
            lift: false,
          })
        : restyleFrame(frame, rawPalette, {
            look: options.look,
            lift: meta.cell === "square" ? false : undefined,
          });
      targetFrame = restyled.frame;
      targetPalette = isLight
        ? adaptPaletteForLightTheme(restyled.palette)
        : restyled.palette;
    }
    paintText(
      ctx,
      targetFrame,
      targetPalette,
      x,
      y,
      cw,
      ch,
      ink,
      atlas,
      dpr,
      over,
      isLight
    );
    return;
  }

  const paintOpts = {
    x,
    y,
    cw,
    ch,
    ink,
    dpr,
    invert: isLight,
    soft: meta.dots?.soft,
    lift: meta.cell === "square" ? false : undefined,
    over,
  };

  if (mode === "dither") {
    const atlas = options.atlas ?? getAtlasForCanvas(ctx.canvas);
    if (Math.abs(cw - ch) < 0.01) {
      paintTone(ctx, frame, effectivePalette, { ...paintOpts, atlas }, true);
    } else {
      paintDitherImage(ctx, frame, effectivePalette, { ...paintOpts, atlas });
    }
    return;
  }

  if (isLight) {
    paintInvertedDots(ctx, frame, effectivePalette, paintOpts);
  } else {
    paintTone(ctx, frame, effectivePalette, paintOpts, false);
  }
}

export interface PreviewThumbnailOptions {
  fit?: "cover" | "contain";
  margin?: number;
}

export function renderPreviewThumbnail(
  canvas: HTMLCanvasElement,
  snapshot: AsciiMagicPreviewSnapshot,
  look: AsciiMagicLook,
  themeMode: ThemeMode,
  cssWidth: number,
  cssHeight: number,
  options?: PreviewThumbnailOptions
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || cssWidth <= 0 || cssHeight <= 0) return;

  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  const targetW = Math.max(1, Math.round(cssWidth * dpr));
  const targetH = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  if (!sharedThumbAtlas && typeof document !== "undefined") {
    sharedThumbAtlas = new GlyphAtlas();
  }
  const fit = options?.fit ?? "contain";
  const margin = options?.margin ?? (fit === "cover" ? 0 : 0.05);
  const bgFill = themeMode === "light" ? "#eef1f6" : "#0b0d12";
  try {
    renderAsciiMagicFrame(ctx, cssWidth, cssHeight, dpr, snapshot.meta, snapshot.frame, {
      look,
      themeMode,
      fit,
      margin,
      bgFill,
      atlas: sharedThumbAtlas ?? undefined,
    });
  } finally {
    releaseCanvasRenderCaches(canvas, false);
    if (sharedThumbAtlas) {
      sharedThumbAtlas.dispose();
      sharedThumbAtlas = null;
    }
  }
}
