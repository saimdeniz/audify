import type {
  AsciiMagicFrame,
  AsciiMagicLook,
  AsciiMagicPalette,
  AsciiMagicPieceMeta,
} from "../../types";
import { ASCII_MAGIC_FONT, CELL_W, GlyphAtlas } from "./glyphAtlas";
import {
  boostHex,
  brightenHex,
  computeDensityGrid,
  cover,
  createShadeTester,
  liftPalette,
  lumHex,
  toHex,
} from "./looks";
import {
  B8,
  DotEntry,
  paintDitherStamped,
  PixelEntry,
  stampDots,
  stampPixels,
} from "./pixelStamper";
import { paintMicroCellGrid } from "./microPainter";

export type RenderMode = "text" | "circle" | "dither";

export function resolveRenderMode(
  meta: Pick<AsciiMagicPieceMeta, "look"> | null,
  look: AsciiMagicLook
): RenderMode {
  const effective = look === "original" ? meta?.look || "original" : look;
  if (effective === "dots") return "circle";
  if (effective === "dither") return "dither";
  return "text";
}

export interface PaintOptions {
  x: number;
  y: number;
  cw: number;
  ch: number;
  ink: string;
  dpr: number;
  invert?: boolean;
  size?: number;
  steps?: number;
  density?: number;
  gamma?: number;
  dotCurve?: number;
  dotMin?: number;
  lift?: boolean;
  all?: boolean;
  soft?: boolean;
  boost?: number;
  over?: boolean;
  atlas?: GlyphAtlas;
}

const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const LV: Record<string, number> = {
  "▁": 0.135,
  "▂": 0.257,
  "▃": 0.378,
  "▄": 0.51,
  "▅": 0.635,
  "▆": 0.757,
  "▇": 0.878,
  "█": 1,
};

export function paintText(
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  x: number,
  y: number,
  cw: number,
  ch: number,
  ink: string,
  atlas: GlyphAtlas | undefined,
  dpr: number,
  over = false,
  invert = false
): void {
  if (cw * dpr < 1.15 && Math.min(cw, ch) * dpr < 1.4) {
    paintMicroCellGrid(ctx, frame, palette, { x, y, cw, ch, ink, dpr, over, invert });
    return;
  }
  const T = frame.text.split("\n");
  const C = frame.color ? frame.color.split("\n") : null;

  if (atlas) {
    const key = `${cw}x${ch}@${dpr}`;
    if (atlas.key !== key) {
      atlas.reset(cw, ch, dpr);
      atlas.key = key;
    }
    let lastFill = "";
    for (let r = 0; r < T.length; r++) {
      const row = T[r];
      const col = C?.[r] ?? null;
      const ry = y + r * ch;
      let ci = 0;
      let runStart = -1;
      let runLen = 0;
      let runFill = "";

      const flushBlockRun = () => {
        if (runLen <= 0) return;
        if (lastFill !== runFill) {
          ctx.fillStyle = runFill;
          lastFill = runFill;
        }
        ctx.fillRect(x + runStart * cw, ry, runLen * cw + 0.5, ch + 0.5);
        runLen = 0;
        runStart = -1;
      };

      for (const g of row) {
        const k = col?.[ci];
        const c = ci++;
        if (g === " ") {
          flushBlockRun();
          continue;
        }
        const fill = (k && k !== " " && palette?.[k]) || ink;
        if (g === "█") {
          if (runLen > 0 && runFill === fill && c === runStart + runLen) {
            runLen++;
          } else {
            flushBlockRun();
            runStart = c;
            runLen = 1;
            runFill = fill;
          }
          continue;
        }
        flushBlockRun();
        const [sx, sy] = atlas.tile(g, fill);
        ctx.drawImage(
          atlas.canvas,
          sx,
          sy,
          atlas.tw,
          atlas.th,
          x + c * cw,
          ry,
          cw,
          ch
        );
      }
      flushBlockRun();
    }
    return;
  }

  ctx.font = `${cw / CELL_W}px ${ASCII_MAGIC_FONT}`;
  ctx.textBaseline = "middle";
  for (let r = 0; r < T.length; r++) {
    const row = [...T[r]];
    const col = C?.[r] ? [...C[r]] : null;
    for (let c = 0; c < row.length; c++) {
      const g = row[c];
      if (g === " ") continue;
      const k = col?.[c];
      ctx.fillStyle = (k && k !== " " && palette?.[k]) || ink;
      if (g === "█") {
        ctx.fillRect(x + c * cw, y + r * ch, Math.ceil(cw), Math.ceil(ch));
        continue;
      }
      ctx.fillText(g, x + c * cw, y + (r + 0.5) * ch);
    }
  }
}

export function paintTone(
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: PaintOptions,
  dither = false
): void {
  const { x, y, cw, ch, ink, dpr } = opts;
  const size = (opts.size ?? 0.51) / 0.85;
  const density = Math.max(0.3, opts.density ?? 1.31);
  const lo = 0.04;
  const hi = 0.985;
  const g = 1.1 * Math.max(1, (opts.gamma ?? 0.35) / 0.35);
  const sat = 0.85;

  const T = frame.text.split("\n").map((r) => [...r]);
  const C = frame.color ? frame.color.split("\n").map((r) => [...r]) : null;
  const rows = T.length;
  const cols = T[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return;

  const vals = new Float32Array(rows * cols);
  const keys = new Array<string | null>(rows * cols);
  const overlayText: Array<readonly [number, number, string, string | null]> = [];
  const pictureLike = Boolean(opts.all) || Math.abs(cw - ch) < 0.01;
  const shade = pictureLike ? null : createShadeTester(T);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gch = T[r][c];
      const k = C?.[r]?.[c];
      const hx = k && k !== " " && palette ? palette[k] ?? null : null;
      const idx = r * cols + c;
      if (gch === " ") {
        vals[idx] = -1;
        continue;
      }
      if (!pictureLike && shade && !shade(gch)) {
        vals[idx] = -1;
        overlayText.push([r, c, gch, hx]);
        continue;
      }
      vals[idx] = (LV[gch] ?? cover(gch) / 100) * lumHex(hx);
      keys[idx] = toHex(hx, ink);
    }
  }

  let vmax = 0;
  let count = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > vmax) vmax = vals[i];
  }
  const HB = 512;
  const hist = new Uint32Array(HB);
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] >= 0) {
      hist[Math.min(HB - 1, Math.floor((vals[i] / (vmax || 1)) * HB))]++;
      count++;
    }
  }
  const percentile = (q: number): number => {
    let acc = 0;
    const want = q * count;
    for (let k = 0; k < HB; k++) {
      acc += hist[k];
      if (acc >= want) return ((k + 0.5) / HB) * vmax;
    }
    return vmax;
  };
  const a = percentile(lo);
  const b = Math.max(percentile(hi), a + 1e-4);

  const SIZES = [0.2, 0.5, 0.85, 1.32];
  const step = Math.min(cw, ch) / density;
  const unit = Math.min(cw, ch);
  if (!dither && 0.5 * unit * size * SIZES[SIZES.length - 1] < 0.42) {
    paintMicroCellGrid(ctx, frame, palette, {
      x,
      y,
      cw,
      ch,
      ink,
      dpr,
      over: Boolean(opts.over),
      invert: Boolean(opts.invert),
    });
    return;
  }
  const W = cols * cw;
  const H = rows * ch;
  const gx = Math.max(1, Math.round(W / step));
  const gy = Math.max(1, Math.round(H / step));
  const sx = W / gx;
  const sy = H / gy;

  const maxRadDev = 0.5 * unit * size * SIZES[SIZES.length - 1] * dpr;
  const canStamp = maxRadDev <= 6 && typeof ImageData !== "undefined";
  const pix: PixelEntry[] | null = dither ? [] : null;
  const dots: DotEntry[][] | null = !dither && canStamp ? SIZES.map(() => []) : null;
  const layers = !pix && !dots ? SIZES.map(() => new Map<string, Path2D>()) : null;

  const sample = (fx: number, fy: number): readonly [number, string | null, boolean] => {
    const c0 = Math.min(cols - 1, Math.max(0, Math.floor(fx)));
    const r0 = Math.min(rows - 1, Math.max(0, Math.floor(fy)));
    const c1 = Math.min(cols - 1, c0 + 1);
    const r1 = Math.min(rows - 1, r0 + 1);
    const tx = Math.min(1, Math.max(0, fx - c0));
    const ty = Math.min(1, Math.max(0, fy - r0));
    const valAt = (idx: number) => (vals[idx] < 0 ? 0 : vals[idx]);
    const val =
      valAt(r0 * cols + c0) * (1 - tx) * (1 - ty) +
      valAt(r0 * cols + c1) * tx * (1 - ty) +
      valAt(r1 * cols + c0) * (1 - tx) * ty +
      valAt(r1 * cols + c1) * tx * ty;
    const ni =
      Math.min(rows - 1, Math.max(0, Math.round(fy))) * cols +
      Math.min(cols - 1, Math.max(0, Math.round(fx)));
    return [val, keys[ni] ?? keys[r0 * cols + c0] ?? null, vals[ni] < 0 && vals[r0 * cols + c0] < 0];
  };

  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const px = (i + 0.5) * sx;
      const py = (j + 0.5) * sy;
      const useDirect = density === 1 && Math.abs(cw - ch) < 0.01 && j < rows && i < cols;
      const [v, hx, empty] = useDirect
        ? [vals[j * cols + i], keys[j * cols + i], vals[j * cols + i] < 0]
        : sample(px / cw - 0.5, py / ch - 0.5);
      if (empty || !hx) continue;

      const t = Math.pow(Math.min(1, Math.max(0, (v - a) / (b - a))), g);
      if (pix) {
        if (t > (B8[(j & 7) * 8 + (i & 7)] + 0.5) / 64) {
          pix.push({ i, j, hex: brightenHex(hx, sat) });
        }
        continue;
      }

      let lvl = Math.floor(t * SIZES.length - 0.5);
      const frac = t * SIZES.length - 0.5 - lvl;
      if (frac > (B4[(j & 3) * 4 + (i & 3)] + 0.5) / 16) lvl++;
      if (lvl < 0) continue;
      lvl = Math.min(SIZES.length - 1, lvl);
      const rad = 0.5 * unit * size * SIZES[lvl];
      if (rad < 0.3) continue;

      const fill = brightenHex(hx, sat);
      if (dots) {
        dots[lvl].push({ cx: (x + px) * dpr, cy: (y + py) * dpr, r: rad * dpr, hex: fill });
        continue;
      }
      if (layers) {
        const layerMap = layers[lvl];
        let path = layerMap.get(fill);
        if (!path) {
          path = new Path2D();
          layerMap.set(fill, path);
        }
        path.moveTo(x + px + rad, y + py);
        path.arc(x + px, y + py, rad, 0, Math.PI * 2);
      }
    }
  }

  if (pix) {
    stampPixels(ctx, pix, x, y, sx, sy, dpr, Boolean(opts.over));
  } else if (dots) {
    stampDots(ctx, dots, Boolean(opts.over));
  } else if (layers) {
    for (const layer of layers) {
      for (const [fill, path] of layer) {
        ctx.fillStyle = fill;
        ctx.fill(path);
      }
    }
  }

  if (overlayText.length > 0) {
    ctx.font = `${cw / CELL_W}px ${ASCII_MAGIC_FONT}`;
    ctx.textBaseline = "middle";
    for (const [r, c, gch, hx] of overlayText) {
      ctx.fillStyle = hx || ink;
      ctx.fillText(gch, x + c * cw, y + (r + 0.5) * ch);
    }
  }
}

export function paintInvertedDots(
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: PaintOptions
): void {
  const { x, y, cw, ch, ink } = opts;
  const size = opts.size ?? 0.85;
  const steps = opts.steps ?? 3;
  const { T, C, D } = computeDensityGrid(frame, palette, {
    ...opts,
    gamma: (opts.gamma ?? 0.75) * (opts.dotCurve ?? 1.9),
  });
  const minDot = opts.dotMin ?? 0.22;
  const pal = opts.lift === false ? palette : liftPalette(palette);
  const sub = Math.max(1, Math.round(ch / cw));
  const sh = ch / sub;
  const unit = Math.min(cw, sh);
  if (0.5 * unit * size < 0.35) {
    paintMicroCellGrid(ctx, frame, pal, {
      x,
      y,
      cw,
      ch,
      ink,
      dpr: opts.dpr,
      over: Boolean(opts.over),
      invert: true,
    });
    return;
  }
  const paths = new Map<string, Path2D>();
  const overlayText: Array<readonly [number, number]> = [];

  for (let r = 0; r < T.length; r++) {
    const row = T[r];
    const dr = D[r];
    for (let c = 0; c < row.length; c++) {
      const d = dr[c];
      if (d < 0) {
        if (row[c] !== " ") overlayText.push([r, c]);
        continue;
      }
      const k = C?.[r]?.[c];
      const col = toHex(k && k !== " " && pal ? pal[k] : null, ink);
      let path = paths.get(col);
      if (!path) {
        path = new Path2D();
        paths.set(col, path);
      }
      const v0 = 1 - d;
      if (v0 < 0.06) continue;
      const v = steps ? Math.ceil(v0 * steps) / steps : v0;
      const half = 0.5 * unit * size * (minDot + (1 - minDot) * v);
      if (half < 0.15) continue;
      for (let s = 0; s < sub; s++) {
        const cx = x + (c + 0.5) * cw;
        const cy = y + r * ch + (s + 0.5) * sh;
        path.moveTo(cx + half, cy);
        path.arc(cx, cy, half, 0, Math.PI * 2);
      }
    }
  }

  for (const [col, path] of paths) {
    ctx.fillStyle = opts.boost ? boostHex(col, opts.boost) : col;
    ctx.fill(path);
  }

  if (overlayText.length > 0) {
    ctx.font = `${cw / CELL_W}px ${ASCII_MAGIC_FONT}`;
    ctx.textBaseline = "middle";
    for (const [r, c] of overlayText) {
      const k = C?.[r]?.[c];
      ctx.fillStyle = (k && k !== " " && palette?.[k]) || ink;
      ctx.fillText(T[r][c], x + c * cw, y + (r + 0.5) * ch);
    }
  }
}

export function paintDitherImage(
  ctx: CanvasRenderingContext2D,
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: PaintOptions
): void {
  paintDitherStamped(ctx, frame, palette, opts, paintText);
}
