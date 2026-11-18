import { ThemeMode } from "../../types";
import { registerWallpaperCacheCleaner } from "../wallpaperCacheRegistry";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface GridCellPool {
  cap: number;
  gen: number;
  stamp: Uint32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  fa: Float32Array;
  ca: Float32Array;
  ch: string[];
}

const STAR_GLYPHS = ["·", ".", "+", "*", "·", ":"] as const;
let sharedGridPool: GridCellPool | null = null;
let sharedPoolBusy = false;

function allocGridPool(cap: number): GridCellPool {
  return {
    cap,
    gen: 0,
    stamp: new Uint32Array(cap),
    r: new Float32Array(cap),
    g: new Float32Array(cap),
    b: new Float32Array(cap),
    fa: new Float32Array(cap),
    ca: new Float32Array(cap),
    ch: new Array<string>(cap).fill(" "),
  };
}

function acquireGridPool(needed: number): { pool: GridCellPool; ownedByShared: boolean } {
  if (!sharedPoolBusy) {
    sharedPoolBusy = true;
    if (!sharedGridPool || sharedGridPool.cap < needed) {
      sharedGridPool = allocGridPool(Math.max(needed, 2048));
    }
    return { pool: sharedGridPool, ownedByShared: true };
  }
  return { pool: allocGridPool(needed), ownedByShared: false };
}

/**
 * Frees the pooled TypedArrays held for Built-in Blueprint ASCII rendering.
 */
export function clearBlueprintGridPool(): void {
  if (!sharedPoolBusy) {
    sharedGridPool = null;
  }
}

registerWallpaperCacheCleaner("ascii_preset_grid", clearBlueprintGridPool);

export interface GridFrame {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly offsetX: number;
  readonly offsetY: number;
  put: (
    cx: number,
    cy: number,
    ch: string,
    rgb: Rgb,
    fillA: number,
    chA?: number
  ) => void;
  glowTile: (
    cx: number,
    cy: number,
    radius: number,
    rgb: Rgb,
    maxAlpha: number
  ) => void;
  stars: (t: number, rgb: Rgb, count: number, yMaxFrac?: number) => void;
  flush: (ctx: CanvasRenderingContext2D) => void;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "").trim();
  const expanded =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const parsed = parseInt(expanded, 16);
  const num = Number.isNaN(parsed) ? 0x38bdf8 : parsed;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

export function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm1(x: number): number {
  return (
    vnoise(x, 0) * 0.56 +
    vnoise(x * 2.13, 11.4) * 0.29 +
    vnoise(x * 4.41, 27.1) * 0.15
  );
}

/**
 * Uniform square-cell Blueprint ASCII frame buffer.
 * Composes translucent padded tiles + crisp centered monospace glyphs over an
 * atmospheric backdrop gradient and subtle 1px architectural blueprint mesh.
 */
export function createGridFrame(
  w: number,
  h: number,
  topHex: string,
  midHex: string,
  botHex: string,
  gridRgb: Rgb,
  gridAlpha: number,
  themeMode: ThemeMode,
  adaptiveLight = false
): GridFrame {
  const targetCols = w >= 720 ? 64 : w >= 420 ? 48 : 32;
  const cell = Math.max(7, Math.floor(w / targetCols));
  const cols = Math.max(8, Math.ceil(w / cell));
  const rows = Math.max(6, Math.ceil(h / cell));
  const offsetX = Math.floor((w - cols * cell) * 0.5);
  const offsetY = Math.floor((h - rows * cell) * 0.5);
  const isLightStudio = adaptiveLight && themeMode === "light";

  const needed = cols * rows;
  const { pool, ownedByShared } = acquireGridPool(needed);
  pool.gen += 1;
  if (pool.gen >= 0xffff_fffe) {
    pool.stamp.fill(0);
    pool.gen = 1;
  }
  const gen = pool.gen;
  const { stamp, r: cr, g: cg, b: cb, fa: cfa, ca: cca, ch: cch } = pool;

  const gridLines: GridFrame = {
    w,
    h,
    cell,
    cols,
    rows,
    offsetX,
    offsetY,
    put(cx, cy, ch, rgb, fillA, chA) {
      const x = Math.round(cx);
      const y = Math.round(cy);
      if (x < 0 || x >= cols || y < 0 || y >= rows) return;
      const fa = clamp01(fillA);
      const ca = clamp01(
        chA !== undefined ? chA : Math.min(1, fa * 1.15 + 0.18)
      );
      if (fa <= 0.01 && ca <= 0.02) return;
      const idx = y * cols + x;
      if (stamp[idx] !== gen) {
        stamp[idx] = gen;
        cr[idx] = rgb.r;
        cg[idx] = rgb.g;
        cb[idx] = rgb.b;
        cfa[idx] = fa;
        cca[idx] = ca;
        cch[idx] = ch;
      } else {
        const inv = 1 - fa;
        cr[idx] = cr[idx] * inv + rgb.r * fa;
        cg[idx] = cg[idx] * inv + rgb.g * fa;
        cb[idx] = cb[idx] * inv + rgb.b * fa;
        cfa[idx] = clamp01(fa + cfa[idx] * inv);
        if (ca >= cca[idx] * 0.72 && ch !== " ") cch[idx] = ch;
        cca[idx] = Math.max(cca[idx], ca);
      }
    },
    glowTile(cx, cy, radius, rgb, maxAlpha) {
      const rInt = Math.ceil(radius);
      for (let dy = -rInt; dy <= rInt; dy++) {
        for (let dx = -rInt; dx <= rInt; dx++) {
          const dist = Math.hypot(dx, dy);
          if (dist > radius) continue;
          const k = Math.pow(1 - dist / radius, 1.7) * maxAlpha;
          if (k < 0.025) continue;
          const ch = k > 0.35 ? "+" : k > 0.14 ? ":" : "·";
          this.put(cx + dx, cy + dy, ch, rgb, k * 0.75, k * 0.9);
        }
      }
    },
    stars(t, rgb, count, yMaxFrac = 0.68) {
      const maxRow = Math.max(2, Math.floor(rows * yMaxFrac));
      for (let i = 0; i < count; i++) {
        const sx = Math.floor(hash2(i * 1.7, 3.1) * cols);
        const sy = Math.floor(hash2(i * 2.9, 8.7) * maxRow);
        const tw =
          0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 1.4 + hash2(i, 19.3) * 6.28));
        const ch = STAR_GLYPHS[i % STAR_GLYPHS.length];
        this.put(sx, sy, ch, rgb, tw * 0.14, tw * 0.78);
      }
    },
    flush(ctx) {
      try {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        if (isLightStudio) {
          grad.addColorStop(0, "#eef2f6");
          grad.addColorStop(0.55, "#e5ebf2");
          grad.addColorStop(1, "#dce4ed");
        } else {
          grad.addColorStop(0, topHex);
          grad.addColorStop(0.55, midHex);
          grad.addColorStop(1, botHex);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        const gRgb = isLightStudio ? { r: 71, g: 85, b: 105 } : gridRgb;
        const gAlpha = isLightStudio ? 0.07 : gridAlpha;
        ctx.strokeStyle = `rgba(${gRgb.r},${gRgb.g},${gRgb.b},${gAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) {
          const x = offsetX + c * cell + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        for (let r = 0; r <= rows; r++) {
          const y = offsetY + r * cell + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();

        const fontSize = Math.max(7, Math.floor(cell * 0.68));
        ctx.font = `${fontSize}px "Cascadia Mono", "JetBrains Mono", Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const pad = cell >= 11 ? 1 : 0.5;
        const inner = Math.max(2, cell - pad * 2);

        let lastFillRgba = "";
        for (let r = 0; r < rows; r++) {
          const rowBase = r * cols;
          const py = offsetY + r * cell;
          for (let c = 0; c < cols; c++) {
            const idx = rowBase + c;
            if (stamp[idx] !== gen) continue;
            const px = offsetX + c * cell;
            const rr = Math.round(cr[idx]);
            const gg = Math.round(cg[idx]);
            const bb = Math.round(cb[idx]);
            const fa = cfa[idx];
            if (fa > 0.015) {
              const style = `rgba(${rr},${gg},${bb},${fa.toFixed(3)})`;
              if (style !== lastFillRgba) {
                ctx.fillStyle = style;
                lastFillRgba = style;
              }
              ctx.fillRect(px + pad, py + pad, inner, inner);
            }
            const glyph = cch[idx];
            const ca = cca[idx];
            if (glyph && glyph !== " " && ca > 0.03) {
              const gr = isLightStudio
                ? Math.max(15, rr - 55)
                : Math.min(255, rr + 55);
              const gg2 = isLightStudio
                ? Math.max(20, gg - 55)
                : Math.min(255, gg + 55);
              const gb = isLightStudio
                ? Math.max(30, bb - 55)
                : Math.min(255, bb + 55);
              const glyphStyle = `rgba(${gr},${gg2},${gb},${ca.toFixed(3)})`;
              if (glyphStyle !== lastFillRgba) {
                ctx.fillStyle = glyphStyle;
                lastFillRgba = glyphStyle;
              }
              ctx.fillText(glyph, px + cell * 0.5, py + cell * 0.54);
            }
          }
        }
      } finally {
        if (ownedByShared) {
          sharedPoolBusy = false;
        }
      }
    },
  };
  return gridLines;
}

export * from "./blueprintShapes";
