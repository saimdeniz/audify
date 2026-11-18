import {
  clamp01,
  fbm1,
  GridFrame,
  mixRgb,
  Rgb,
  vnoise,
} from "./blueprintGrid";

export function paintGridRidge(
  g: GridFrame,
  baseRowFrac: number,
  ampRows: number,
  seed: number,
  bodyRgb: Rgb,
  rimRgb: Rgb,
  stepMod = 5
): void {
  for (let x = 0; x < g.cols; x++) {
    const n = fbm1(x * 0.095 + seed);
    const topY = Math.round(g.rows * baseRowFrac - (n - 0.42) * ampRows);
    for (let y = Math.max(0, topY); y < g.rows; y++) {
      const depth = y - topY;
      if (depth === 0) {
        g.put(
          x,
          y,
          (x + Math.round(seed)) % 2 === 0 ? "^" : "=",
          rimRgb,
          0.52,
          0.72
        );
      } else if (depth === 1) {
        g.put(x, y, ":", mixRgb(rimRgb, bodyRgb, 0.65), 0.48, 0.55);
      } else {
        const ch =
          (x + y * 3) % stepMod === 0 ? "%" : (x + y) % 3 === 0 ? ":" : ".";
        g.put(x, y, ch, bodyRgb, 0.74, 0.34);
      }
    }
  }
}

export function paintGridPine(
  g: GridFrame,
  cx: number,
  baseY: number,
  heightRows: number,
  swayCells: number,
  darkRgb: Rgb,
  rimRgb: Rgb
): void {
  const layers = Math.max(5, Math.round(heightRows));
  for (let i = 0; i < layers; i++) {
    const frac = i / layers;
    const y = baseY - layers + i;
    const sw = Math.round(swayCells * Math.pow(1 - frac, 1.3));
    const halfW = Math.max(0, Math.floor(frac * heightRows * 0.34));
    for (let dx = -halfW; dx <= halfW; dx++) {
      const isEdge = Math.abs(dx) === halfW || i === 0;
      const ch =
        i === 0
          ? "^"
          : isEdge
            ? dx < 0
              ? "/"
              : "\\"
            : (i + dx) % 2 === 0
              ? "#"
              : "*";
      g.put(
        cx + sw + dx,
        y,
        ch,
        isEdge ? rimRgb : darkRgb,
        isEdge ? 0.65 : 0.85,
        isEdge ? 0.78 : 0.55
      );
    }
  }
  g.put(cx, baseY, "|", darkRgb, 0.85, 0.7);
}

export function paintGridMist(
  g: GridFrame,
  t: number,
  centerFrac: number,
  bandRows: number,
  rgb: Rgb,
  maxAlpha: number
): void {
  const centerY = g.rows * centerFrac;
  const minY = Math.max(0, Math.floor(centerY - bandRows));
  const maxY = Math.min(g.rows - 1, Math.ceil(centerY + bandRows));
  for (let y = minY; y <= maxY; y++) {
    const vy = 1 - Math.abs(y - centerY) / (bandRows + 0.5);
    for (let x = 0; x < g.cols; x++) {
      const n = vnoise(x * 0.14 - t * 0.45, y * 0.38);
      const a = clamp01(vy * (n - 0.25) * 1.4) * maxAlpha;
      if (a < 0.04) continue;
      const ch = n > 0.62 ? "=" : n > 0.46 ? "~" : ".";
      g.put(x, y, ch, rgb, a * 0.72, a * 1.15);
    }
  }
}

export function paintGridSun(
  g: GridFrame,
  cx: number,
  cy: number,
  radius: number,
  innerRgb: Rgb,
  midRgb: Rgb,
  haloRgb: Rgb,
  sliced = false
): void {
  const rOut = radius + 2.5;
  for (let dy = -Math.ceil(rOut); dy <= Math.ceil(rOut); dy++) {
    for (let dx = -Math.ceil(rOut); dx <= Math.ceil(rOut); dx++) {
      if (sliced && dy > 1 && Math.abs(dy) % 2 === 0) continue;
      const d = Math.hypot(dx, dy);
      if (d <= radius) {
        const core = clamp01(1 - (d / radius) * 0.6);
        const rgb = mixRgb(midRgb, innerRgb, core);
        g.put(
          cx + dx,
          cy + dy,
          core > 0.68 ? "@" : core > 0.35 ? "o" : "=",
          rgb,
          0.72 + core * 0.24,
          0.92
        );
      } else if (d <= rOut) {
        const k = clamp01(1 - (d - radius) / 2.5);
        if (k > 0.1) g.put(cx + dx, cy + dy, ".", haloRgb, k * 0.25, k * 0.45);
      }
    }
  }
}

export function paintGridMoon(
  g: GridFrame,
  cx: number,
  cy: number,
  radius: number,
  innerRgb: Rgb,
  midRgb: Rgb,
  haloRgb: Rgb
): void {
  const rOut = radius + 2.2;
  for (let dy = -Math.ceil(rOut); dy <= Math.ceil(rOut); dy++) {
    for (let dx = -Math.ceil(rOut); dx <= Math.ceil(rOut); dx++) {
      const d1 = Math.hypot(dx, dy);
      const d2 = Math.hypot(dx - radius * 0.52, dy + radius * 0.18);
      if (d1 <= radius && d2 >= radius * 0.82) {
        const core = clamp01(1 - (d1 / radius) * 0.45);
        const rgb = mixRgb(midRgb, innerRgb, core);
        const ch = core > 0.7 ? "@" : core > 0.45 ? "o" : "=";
        g.put(cx + dx, cy + dy, ch, rgb, 0.75 + core * 0.2, 0.92);
      } else if (d1 <= rOut && d2 >= radius * 0.72) {
        const k = clamp01(1 - (d1 - radius * 0.85) / 2.6);
        if (k > 0.1) g.put(cx + dx, cy + dy, ".", haloRgb, k * 0.22, k * 0.42);
      }
    }
  }
}

export function paintGridCloud(
  g: GridFrame,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  bodyRgb: Rgb,
  rimRgb: Rgb,
  alphaScale = 0.82
): void {
  const rw = Math.ceil(halfW);
  const rh = Math.ceil(halfH);
  for (let dy = -rh; dy <= rh; dy++) {
    for (let dx = -rw; dx <= rw; dx++) {
      // Stepped flat-bottomed cumulus silhouette matching Cloud Drift / Moonlit video
      const ny = dy / Math.max(1, halfH);
      const nx = dx / Math.max(1, halfW);
      const lobe =
        Math.hypot(nx * 0.9, ny + 0.15) <= 0.95 ||
        Math.hypot((nx + 0.42) * 1.35, ny - 0.15) <= 0.78 ||
        Math.hypot((nx - 0.42) * 1.35, ny - 0.1) <= 0.82;
      if (!lobe || ny > 0.65) continue;
      const dist = Math.min(1, Math.hypot(nx * 0.85, ny * 0.9));
      const core = clamp01(1 - dist * 0.75);
      const rgb = mixRgb(rimRgb, bodyRgb, core);
      const ch = core > 0.65 ? "@" : core > 0.4 ? "o" : "~";
      g.put(
        cx + dx,
        cy + dy,
        ch,
        rgb,
        (0.35 + core * 0.55) * alphaScale,
        0.9 * alphaScale
      );
    }
  }
}

export function paintGridCircleRing(
  g: GridFrame,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  rgb: Rgb,
  fillA: number,
  ch = "o",
  scaleX = 1
): void {
  const rMax = Math.ceil((radius + thickness) * Math.max(1, scaleX));
  const rMaxY = Math.ceil(radius + thickness);
  for (let dy = -rMaxY; dy <= rMaxY; dy++) {
    for (let dx = -rMax; dx <= rMax; dx++) {
      const d = Math.hypot(dx / scaleX, dy);
      const diff = Math.abs(d - radius);
      if (diff <= thickness) {
        const k = clamp01(1 - diff / (thickness + 0.35));
        g.put(cx + dx, cy + dy, ch, rgb, fillA * k, Math.min(1, fillA * k * 1.3));
      }
    }
  }
}

export function paintGridLine(
  g: GridFrame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ch: string,
  rgb: Rgb,
  fillA: number,
  chA?: number
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    g.put(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p, ch, rgb, fillA, chA);
  }
}

export function paintGridBox(
  g: GridFrame,
  x0: number,
  y0: number,
  wCells: number,
  hCells: number,
  borderRgb: Rgb,
  fillRgb: Rgb,
  fillA: number,
  borderCh = "#"
): void {
  const xStart = Math.round(x0);
  const yStart = Math.round(y0);
  const wInt = Math.max(1, Math.round(wCells));
  const hInt = Math.max(1, Math.round(hCells));
  for (let r = 0; r < hInt; r++) {
    for (let c = 0; c < wInt; c++) {
      const isBorder = r === 0 || r === hInt - 1 || c === 0 || c === wInt - 1;
      g.put(
        xStart + c,
        yStart + r,
        isBorder ? borderCh : ":",
        isBorder ? borderRgb : fillRgb,
        isBorder ? Math.min(0.95, fillA + 0.18) : fillA,
        isBorder ? 0.9 : 0.45
      );
    }
  }
}
