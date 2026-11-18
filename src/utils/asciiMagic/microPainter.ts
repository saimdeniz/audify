import type { AsciiMagicFrame, AsciiMagicPalette } from "../../types";
import { CELL_W } from "./glyphAtlas";
import { cover, lumHex, toHex } from "./looks";
import { PixelEntry, stampPixels } from "./pixelStamper";

const scaledHexCache = new Map<string, string>();

export function clearMicroPainterCache(): void {
  scaledHexCache.clear();
}

function scaleHexBrightness(hex: string, factor: number): string {
  const q = Math.round(Math.max(0.05, Math.min(1.25, factor)) * 32) / 32;
  const key = `${hex}:${q}`;
  const cached = scaledHexCache.get(key);
  if (cached) return cached;

  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const nr = Math.max(0, Math.min(255, Math.round(r * q)));
  const ng = Math.max(0, Math.min(255, Math.round(g * q)));
  const nb = Math.max(0, Math.min(255, Math.round(b * q)));
  const out = `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;

  if (scaledHexCache.size > 4096) scaledHexCache.clear();
  scaledHexCache.set(key, out);
  return out;
}

export interface MicroPaintOptions {
  x: number;
  y: number;
  cw: number;
  ch: number;
  ink: string;
  dpr: number;
  over: boolean;
  invert?: boolean;
}

/**
 * Downsamples dense scenes (e.g. 192x108 into a 72x42 card thumbnail) directly
 * to screen pixels so sub-pixel halftone dots and tiny glyphs never disappear.
 */
export function paintMicroCellGrid(
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: MicroPaintOptions
): void {
  const { x, y, cw, ch, ink, dpr, over, invert } = opts;
  const T = frame.text.split("\n");
  const C = frame.color ? frame.color.split("\n") : null;
  const rows = T.length;
  const cols = T.reduce((m, row) => Math.max(m, [...row].length), 0);
  if (rows === 0 || cols === 0) return;

  const gridT = T.map((r) => [...r]);
  const gridC = C ? C.map((r) => [...r]) : null;
  const W = cols * cw;
  const H = rows * ch;
  const gw = Math.max(1, Math.min(cols, Math.round(W * dpr)));
  const gh = Math.max(1, Math.min(rows, Math.round(H * dpr)));
  const sx = W / gw;
  const sy = H / gh;

  const pix: PixelEntry[] = [];
  for (let j = 0; j < gh; j++) {
    const r0 = Math.max(0, Math.floor((j * sy) / ch));
    const r1 = Math.min(rows - 1, Math.max(r0, Math.ceil(((j + 1) * sy) / ch) - 1));
    for (let i = 0; i < gw; i++) {
      const c0 = Math.max(0, Math.floor((i * sx) / cw));
      const c1 = Math.min(cols - 1, Math.max(c0, Math.ceil(((i + 1) * sx) / cw) - 1));

      let sumWeight = 0;
      let count = 0;
      let bestScore = -1;
      let bestHex: string | null = null;

      for (let rr = r0; rr <= r1; rr++) {
        const row = gridT[rr];
        const crow = gridC?.[rr];
        for (let cc = c0; cc <= c1; cc++) {
          const chChar = row[cc];
          count++;
          if (!chChar || chChar === " ") continue;
          const k = crow?.[cc];
          const hx = toHex(k && k !== " " && palette ? palette[k] : null, ink);
          const cov = Math.max(0.18, cover(chChar) / 100);
          const score = cov * (invert ? 1 - lumHex(hx) * 0.55 : 0.35 + lumHex(hx) * 0.65);
          sumWeight += cov;
          if (score > bestScore) {
            bestScore = score;
            bestHex = hx;
          }
        }
      }

      if (!bestHex || count === 0) continue;
      const fillRatio = sumWeight / count;
      const brightness = invert
        ? 0.92 - 0.18 * fillRatio
        : 0.34 + 0.66 * Math.min(1, fillRatio * 1.15);
      pix.push({ i, j, hex: scaleHexBrightness(bestHex, brightness) });
    }
  }

  if (pix.length === 0) return;

  if (typeof ImageData !== "undefined" && typeof ctx.getImageData === "function") {
    try {
      stampPixels(ctx, pix, x, y, sx, sy, dpr, over);
      return;
    } catch {
      // Fall back to batched fillRect below if ImageData access fails
    }
  }

  for (const p of pix) {
    ctx.fillStyle = p.hex;
    ctx.fillRect(x + p.i * sx, y + p.j * sy, sx + 0.25, sy + 0.25);
  }
}

export function getMergedSquareGridDims(
  cols: number,
  rows: number
): { cols: number; rows: number } {
  const outCols = cols > 144 ? Math.round(cols * 0.7) : cols;
  const outRows = Math.max(1, Math.round((outCols * rows * CELL_W) / cols));
  return { cols: outCols, rows: outRows };
}
