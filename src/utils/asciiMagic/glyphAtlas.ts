import type { AsciiMagicPieceMeta } from "../../types";

export const ASCII_MAGIC_FONT =
  'Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

/** Width of one monospace cell as a fraction of the font size. */
export const CELL_W = 0.602;

/** Cell height / width: 1 for square-cell pieces, ~1.66 for text pieces. */
export function cellAspect(meta: Pick<AsciiMagicPieceMeta, "cell"> | null): number {
  return meta?.cell === "square" ? 1 : 1 / CELL_W;
}

const MAX_ATLAS_WIDTH = 1024;
const MAX_ATLAS_HEIGHT = 1024;

/**
 * Offscreen sprite atlas caching each `(glyph, hex)` pair so repeated cell drawing
 * uses cheap `drawImage` blits instead of tens of thousands of `fillText` calls.
 * Bounded to 1024x1024 so dynamic-palette animations never bloat GPU/RAM textures.
 */
export class GlyphAtlas {
  key = "";
  canvas: HTMLCanvasElement;
  tw = 1;
  th = 1;
  private ctx: CanvasRenderingContext2D;
  private cols = 1;
  private n = 0;
  private font = `12px ${ASCII_MAGIC_FONT}`;
  private map = new Map<string, readonly [number, number]>();

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable for GlyphAtlas");
    }
    this.ctx = ctx;
  }

  reset(cw: number, ch: number, dpr: number): void {
    this.tw = Math.max(1, Math.ceil(cw * dpr));
    this.th = Math.max(1, Math.ceil(ch * dpr));
    this.cols = Math.max(1, Math.floor(MAX_ATLAS_WIDTH / this.tw));
    this.n = 0;
    this.map.clear();
    this.canvas.width = this.cols * this.tw;
    this.canvas.height = Math.min(MAX_ATLAS_HEIGHT, Math.max(this.th * 4, 64));
    const ctx = this.canvas.getContext("2d");
    if (ctx) this.ctx = ctx;
    this.font = `${(cw / CELL_W) * dpr}px ${ASCII_MAGIC_FONT}`;
  }

  dispose(): void {
    this.map.clear();
    this.n = 0;
    this.key = "";
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  tile(glyph: string, color: string): readonly [number, number] {
    const cacheKey = `${glyph}\0${color}`;
    const existing = this.map.get(cacheKey);
    if (existing) return existing;

    let index = this.n++;
    let sx = (index % this.cols) * this.tw;
    let sy = Math.floor(index / this.cols) * this.th;

    if (sy + this.th > this.canvas.height) {
      if (this.canvas.height < MAX_ATLAS_HEIGHT) {
        const nextHeight = Math.min(
          MAX_ATLAS_HEIGHT,
          Math.max(this.canvas.height * 2, sy + this.th)
        );
        if (sy + this.th <= nextHeight) {
          const prev = this.canvas;
          const grown = document.createElement("canvas");
          grown.width = prev.width;
          grown.height = nextHeight;
          const grownCtx = grown.getContext("2d");
          if (grownCtx) {
            grownCtx.drawImage(prev, 0, 0);
            prev.width = 0;
            prev.height = 0;
            this.canvas = grown;
            this.ctx = grownCtx;
          }
        }
      }
      // If still exceeding MAX_ATLAS_HEIGHT, recycle the bounded atlas in-place
      if (sy + this.th > this.canvas.height) {
        this.map.clear();
        this.n = 1;
        index = 0;
        sx = 0;
        sy = 0;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(sx, sy, this.tw, this.th);
    c.clip();
    c.font = this.font;
    c.textBaseline = "middle";
    c.fillStyle = color;
    c.fillText(glyph, sx, sy + this.th / 2);
    c.restore();

    const coords: readonly [number, number] = [sx, sy];
    this.map.set(cacheKey, coords);
    return coords;
  }
}
