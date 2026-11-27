import {
  clamp01,
  createGridFrame,
  hash2,
  hexToRgb,
  mixRgb,
  Rgb,
} from "./blueprintGrid";
import {
  paintGridBox,
  paintGridCircleRing,
  paintGridLine,
} from "./blueprintShapes";
import { AsciiRenderParams } from "./shared";

export function renderStudioPreset(params: AsciiRenderParams): void {
  const {
    ctx,
    width: w,
    height: h,
    timeSec: t,
    preset,
    accentHex,
    themeMode: theme,
    isPlaying,
  } = params;

  const g = createGridFrame(
    w,
    h,
    "#0b0d13",
    "#121620",
    "#161a24",
    { r: 148, g: 163, b: 184 },
    0.055,
    theme,
    true
  );

  const accent = hexToRgb(accentHex || "#38bdf8");
  const cyan: Rgb = { r: 56, g: 189, b: 248 };
  const amber: Rgb = { r: 251, g: 191, b: 36 };
  const green: Rgb = { r: 52, g: 211, b: 153 };
  const rose: Rgb = { r: 244, g: 63, b: 94 };
  const slate: Rgb = { r: 100, g: 116, b: 139 };
  const panel: Rgb = { r: 30, g: 41, b: 59 };
  const motion = isPlaying === false ? 0.35 : 1;

  switch (preset) {
    case "studio_pulse": {
      const midY = Math.floor(g.rows * 0.5);
      paintGridLine(g, 1, midY, g.cols - 2, midY, "=", slate, 0.55, 0.85);
      const maxHalf = Math.max(2, Math.floor(g.rows * 0.38));

      for (let c = 2; c < g.cols - 2; c++) {
        const nx = (c - 2) / Math.max(1, g.cols - 5);
        const env = Math.sin(nx * Math.PI);
        const wave =
          Math.abs(
            Math.sin(c * 0.28 - t * 3.4) * 0.65 +
              Math.cos(c * 0.56 + t * 2.1) * 0.35
          ) *
          env *
          motion;
        const halfH = Math.round(wave * maxHalf);
        g.put(c, midY, "=", accent, 0.9, 0.96);

        for (let d = 1; d <= halfH; d++) {
          const frac = d / Math.max(1, maxHalf);
          const rgb = mixRgb(accent, cyan, frac);
          const ch = d === halfH ? "=" : "|";
          const fa = 0.86 - frac * 0.28;
          g.put(c, midY - d, ch, rgb, fa, 0.94);
          g.put(c, midY + d, ch, rgb, fa * 0.88, 0.9);
        }
        const peakD = Math.min(
          maxHalf + 1,
          halfH + 1 + Math.round(Math.abs(Math.sin(c * 0.4 + t * 1.2)) * 1.6)
        );
        if (peakD > 1 && c % 2 === 0) {
          g.put(c, midY - peakD, "+", amber, 0.72, 0.95);
          g.put(c, midY + peakD, "·", cyan, 0.62, 0.9);
        }
      }
      break;
    }

    case "vinyl_groove": {
      const cx = Math.round(g.cols * 0.44);
      const cy = Math.round(g.rows * 0.5);
      const maxR = Math.max(4, Math.min(g.cols * 0.34, g.rows * 0.42));

      paintGridCircleRing(g, cx, cy, maxR, 0.85, slate, 0.88, "#");
      for (let r = maxR - 2; r > 2.6; r -= 2) {
        paintGridCircleRing(g, cx, cy, r, 0.65, mixRgb(slate, cyan, 0.35), 0.65, "o");
      }
      const sheenAng = t * 1.5 * motion;
      for (const side of [-1, 1]) {
        paintGridLine(
          g,
          cx + Math.cos(sheenAng) * 2.5 * side,
          cy + Math.sin(sheenAng) * 2.5 * side,
          cx + Math.cos(sheenAng) * (maxR - 1) * side,
          cy + Math.sin(sheenAng) * (maxR - 1) * side,
          "*",
          cyan,
          0.75,
          0.95
        );
      }
      paintGridCircleRing(g, cx, cy, 2.1, 1.3, mixRgb(accent, amber, 0.5), 0.92, "@");
      g.put(cx, cy, "o", { r: 248, g: 250, b: 252 }, 0.95, 1);

      const px = Math.round(g.cols * 0.82);
      const py = Math.round(g.rows * 0.2);
      const ex = px - 2;
      const ey = Math.round(g.rows * 0.6);
      const sx = Math.round(cx + maxR * 0.68);
      const sy = Math.round(cy + maxR * 0.35);
      paintGridBox(g, px - 1, py - 1, 3, 3, slate, panel, 0.9, "#");
      paintGridLine(g, px, py, ex, ey, "|", slate, 0.88, 0.95);
      paintGridLine(g, ex, ey, sx, sy, "/", amber, 0.92, 0.98);
      g.glowTile(sx, sy, 2.2, amber, 0.45);
      g.put(sx, sy, "@", amber, 0.96, 1);
      break;
    }

    case "minimal_spectrum": {
      const bands = 16;
      const baseY = g.rows - 2;
      const maxH = Math.max(4, g.rows - 4);
      const availW = g.cols - 4;

      for (let b = 0; b < bands; b++) {
        const bx = 2 + Math.floor((b / bands) * availW);
        const bw = Math.max(1, Math.floor(availW / bands) - 1);
        const raw =
          Math.abs(
            Math.sin(b * 0.52 + t * 2.9) * 0.68 +
              Math.cos(b * 0.83 - t * 2.1) * 0.32
          ) * motion;
        const barH = Math.max(1, Math.round(clamp01(0.14 + raw * 0.86) * maxH));

        for (let d = 0; d < barH; d++) {
          const frac = d / maxH;
          const rgb = frac > 0.76 ? amber : frac > 0.42 ? cyan : green;
          const ch = frac > 0.76 ? "@" : frac > 0.42 ? "=" : "#";
          for (let dx = 0; dx < bw; dx++) {
            g.put(bx + dx, baseY - d, ch, rgb, 0.84, 0.94);
          }
        }
        const capH = Math.min(
          maxH,
          barH + 1 + Math.round(Math.abs(Math.sin(b + t * 1.4)) * 1.5)
        );
        for (let dx = 0; dx < bw; dx++) {
          g.put(bx + dx, baseY - capH, "=", amber, 0.92, 0.98);
        }
      }
      break;
    }

    case "tape_reels": {
      const cy = Math.round(g.rows * 0.4);
      const lx = Math.round(g.cols * 0.3);
      const rx = Math.round(g.cols * 0.7);
      const rr = Math.max(3, Math.min(g.cols * 0.16, g.rows * 0.3));

      for (const cx of [lx, rx]) {
        paintGridCircleRing(g, cx, cy, rr, 0.85, slate, 0.88, "#");
        paintGridCircleRing(g, cx, cy, rr * 0.55, 0.7, accent, 0.82, "o");
        for (let k = 0; k < 3; k++) {
          const ang = t * 1.6 * motion + (k * Math.PI * 2) / 3;
          paintGridLine(
            g,
            cx,
            cy,
            cx + Math.cos(ang) * (rr - 0.5),
            cy + Math.sin(ang) * (rr - 0.5),
            "*",
            slate,
            0.88,
            0.95
          );
        }
        g.put(cx, cy, "@", amber, 0.95, 1);
      }

      const guideY = Math.min(g.rows - 4, Math.round(cy + rr + 2));
      const hx = Math.round(g.cols * 0.5);
      paintGridLine(g, lx, cy + rr, lx + 3, guideY, "\\", amber, 0.85, 0.95);
      paintGridLine(g, lx + 3, guideY, rx - 3, guideY, "=", amber, 0.88, 0.95);
      paintGridLine(g, rx - 3, guideY, rx, cy + rr, "/", amber, 0.85, 0.95);
      paintGridBox(g, hx - 3, guideY - 2, 7, 3, slate, panel, 0.92, "#");

      const meterW = Math.round((g.cols - 12) * (0.4 + 0.45 * Math.abs(Math.sin(t * 3.2)) * motion));
      paintGridLine(g, 6, g.rows - 2, 6 + meterW, g.rows - 2, "=", green, 0.88, 0.95);
      break;
    }

    case "sine_osc": {
      const midY = Math.floor(g.rows * 0.5);
      const midX = Math.floor(g.cols * 0.5);
      paintGridLine(g, 1, midY, g.cols - 2, midY, "-", slate, 0.42, 0.75);
      paintGridLine(g, midX, 1, midX, g.rows - 2, "|", slate, 0.42, 0.75);

      const amp = g.rows * 0.32 * motion;
      let prevY1 = midY;
      let prevY2 = midY;
      for (let x = 1; x < g.cols - 1; x++) {
        const y1 = Math.round(
          midY +
            (Math.sin(x * 0.22 - t * 3.2) * 0.75 +
              Math.cos(x * 0.11 + t * 1.7) * 0.25) *
              amp
        );
        const y2 = Math.round(
          midY + Math.sin(x * 0.17 + t * 2.4 + 1.3) * amp * 0.78
        );
        if (x > 1) {
          paintGridLine(g, x - 1, prevY1, x, y1, "~", cyan, 0.85, 0.95);
          paintGridLine(g, x - 1, prevY2, x, y2, "o", accent, 0.82, 0.94);
        }
        g.put(x, y1, "@", cyan, 0.94, 0.98);
        g.put(x, y2, "o", accent, 0.88, 0.95);
        if (x % 9 === 0) {
          g.glowTile(x, y1, 2.2, cyan, 0.35);
        }
        prevY1 = y1;
        prevY2 = y2;
      }
      break;
    }

    case "modular_matrix": {
      const colsCount = 8;
      const rowsCount = 4;
      const playStep = Math.floor(t * (isPlaying === false ? 1.5 : 4.5)) % colsCount;
      const startX = Math.max(2, Math.floor(g.cols * 0.1));
      const spanX = g.cols - startX * 2;
      const startY = Math.max(2, Math.floor(g.rows * 0.16));
      const spanY = g.rows - startY * 2;

      for (let r = 0; r < rowsCount; r++) {
        const py = startY + Math.floor((r / (rowsCount - 1)) * (spanY - 2));
        for (let c = 0; c < colsCount; c++) {
          const px = startX + Math.floor((c / (colsCount - 1)) * (spanX - 2));
          const active = hash2(c * 3 + 1, r * 7 + 5) > 0.36;
          const isHead = c === playStep;
          const rgb = isHead
            ? active
              ? amber
              : cyan
            : active
              ? accent
              : slate;
          const fa = isHead ? 0.95 : active ? 0.82 : 0.38;
          const ch = isHead ? "@" : active ? "#" : ":";
          if (isHead && active) {
            g.glowTile(px + 0.5, py + 0.5, 2.8, amber, 0.45);
          }
          paintGridBox(g, px, py, 2, 2, rgb, rgb, fa, ch);
        }
      }
      break;
    }

    case "lissajous_scope": {
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const rad = Math.min(g.cols, g.rows) * 0.38;
      paintGridCircleRing(g, cx, cy, rad, 0.7, slate, 0.55, "·");
      const diag = rad * 0.7;
      paintGridLine(g, cx - diag, cy - diag, cx + diag, cy + diag, "\\", slate, 0.38, 0.7);
      paintGridLine(g, cx - diag, cy + diag, cx + diag, cy - diag, "/", slate, 0.38, 0.7);

      const scale = rad * (0.68 + 0.24 * motion);
      const pts = 84;
      for (let i = 0; i < pts; i++) {
        const frac = i / pts;
        const s = frac * Math.PI * 2;
        const px = cx + Math.sin(3 * s + t * 1.8 * motion) * scale * 1.15;
        const py = cy + Math.sin(4 * s) * scale * 0.88;
        const rgb = mixRgb(accent, cyan, frac);
        const ch = i > pts - 8 ? "@" : i > pts * 0.5 ? "o" : ":";
        g.put(px, py, ch, rgb, 0.45 + frac * 0.5, 0.95);
        if (i === pts - 1) {
          g.glowTile(px, py, 2.6, cyan, 0.5);
        }
      }
      break;
    }

    case "vu_needle_pair": {
      const mw = Math.max(10, Math.floor((g.cols - 7) * 0.5));
      const mh = Math.max(8, g.rows - 4);
      const my = Math.floor((g.rows - mh) * 0.5);
      const leftX = 2;
      const rightX = g.cols - 2 - mw;

      for (let m = 0; m < 2; m++) {
        const mx = m === 0 ? leftX : rightX;
        const mcx = mx + mw * 0.5;
        const pivotY = my + mh - 2;
        const arcR = Math.min(mw * 0.42, mh - 3);

        paintGridBox(g, mx, my, mw, mh, slate, panel, 0.82, "#");
        g.glowTile(mcx, my + mh * 0.55, arcR * 0.85, amber, 0.32);

        for (let i = 0; i <= 12; i++) {
          const frac = i / 12;
          const ang = -Math.PI * 0.5 + (frac - 0.5) * 1.5;
          const ax = mcx + Math.cos(ang) * arcR;
          const ay = pivotY + Math.sin(ang) * arcR;
          g.put(ax, ay, frac > 0.72 ? "+" : "·", frac > 0.72 ? rose : green, 0.85, 0.95);
        }

        const swing =
          Math.sin(t * 3.4 + m * 1.2) * 0.55 * motion +
          Math.cos(t * 5.1 - m) * 0.18 * motion;
        const nAng = -Math.PI * 0.5 + swing;
        const nx = mcx + Math.cos(nAng) * (arcR - 0.5);
        const ny = pivotY + Math.sin(nAng) * (arcR - 0.5);
        paintGridLine(g, mcx, pivotY, nx, ny, "/", amber, 0.94, 0.98);
        g.put(mcx, pivotY, "@", accent, 0.96, 1);
      }
      break;
    }

    case "midi_piano_roll": {
      const keyW = 5;
      for (let r = 1; r < g.rows - 1; r++) {
        const isBlack = r % 3 === 1;
        for (let c = 1; c <= keyW; c++) {
          const rgb = isBlack && c < keyW - 1 ? panel : { r: 226, g: 232, b: 240 };
          g.put(c, r, isBlack ? "=" : "#", rgb, 0.88, 0.92);
        }
      }

      const playX = keyW + 4;
      const rollW = Math.max(8, g.cols - keyW - 3);
      for (let lane = 0; lane < 7; lane++) {
        const ry = 2 + Math.floor((lane / 6) * Math.max(1, g.rows - 5));
        const len = 4 + (lane % 3) * 2;
        const offset = Math.floor(hash2(lane, 9.1) * rollW);
        const headX =
          keyW +
          2 +
          (((offset - Math.floor(t * 6 * motion)) % rollW + rollW) % rollW);
        for (let k = 0; k < len; k++) {
          const nx = keyW + 2 + ((headX - keyW - 2 + k) % rollW);
          const hit = Math.abs(nx - playX) <= 1;
          if (hit) g.glowTile(playX, ry, 2.2, amber, 0.42);
          g.put(nx, ry, hit ? "@" : "=", hit ? amber : accent, hit ? 0.96 : 0.84, 0.95);
        }
      }
      paintGridLine(g, playX, 1, playX, g.rows - 2, "|", amber, 0.9, 0.98);
      break;
    }

    case "harmonic_circle": {
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const rOut = Math.min(g.cols, g.rows) * 0.39;
      const rIn = rOut * 0.58;
      paintGridCircleRing(g, cx, cy, rOut, 0.75, slate, 0.68, "o");
      paintGridCircleRing(g, cx, cy, rIn, 0.65, slate, 0.5, "·");

      const root = Math.floor(t * 1.4 * motion) % 12;
      const triad = [root, (root + 4) % 12, (root + 7) % 12];
      const pts: [number, number][] = [];

      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 - Math.PI * 0.5;
        const nx = cx + Math.cos(ang) * rOut;
        const ny = cy + Math.sin(ang) * rOut;
        pts.push([nx, ny]);
        g.put(nx, ny, "o", slate, 0.85, 0.95);
      }

      for (let k = 0; k < 3; k++) {
        const [x0, y0] = pts[triad[k]];
        const [x1, y1] = pts[triad[(k + 1) % 3]];
        paintGridLine(g, x0, y0, x1, y1, "*", k === 0 ? accent : cyan, 0.88, 0.96);
        g.glowTile(x0, y0, 2.6, amber, 0.5);
        g.put(x0, y0, "@", amber, 0.96, 1);
      }
      break;
    }

    case "patch_cables": {
      for (let r = 2; r < g.rows - 2; r += 3) {
        for (let c = 3; c < g.cols - 3; c += 4) {
          g.put(c, r, "o", slate, 0.65, 0.9);
        }
      }

      const cables: [number, number, number, number, Rgb][] = [
        [0.16, 0.24, 0.62, 0.32, accent],
        [0.28, 0.32, 0.82, 0.26, cyan],
        [0.18, 0.52, 0.74, 0.58, amber],
        [0.38, 0.22, 0.86, 0.54, rose],
      ];

      for (let i = 0; i < cables.length; i++) {
        const [fx0, fy0, fx1, fy1, rgb] = cables[i];
        const x0 = Math.round(fx0 * g.cols);
        const y0 = Math.round(fy0 * g.rows);
        const x1 = Math.round(fx1 * g.cols);
        const y1 = Math.round(fy1 * g.rows);
        const sag = 3.2 + i * 0.7 + Math.sin(t * 2.2 * motion + i) * 0.9;
        const steps = Math.max(12, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.4));

        for (let s = 0; s <= steps; s++) {
          const p = s / steps;
          const cx = x0 + (x1 - x0) * p;
          const cy = y0 + (y1 - y0) * p + 4 * p * (1 - p) * sag;
          g.put(cx, cy, s === 0 || s === steps ? "@" : "~", rgb, 0.9, 0.96);
        }
        g.glowTile(x0, y0, 2.2, rgb, 0.45);
        g.glowTile(x1, y1, 2.2, rgb, 0.45);
      }
      break;
    }

    default: {
      // mastering_meters
      const fracs = [0.24, 0.41, 0.59, 0.76];
      const baseY = g.rows - 4;
      const maxH = Math.max(4, baseY - 2);
      const targetY = Math.max(2, baseY - Math.round(maxH * 0.74));
      paintGridLine(g, 3, targetY, g.cols - 4, targetY, "-", amber, 0.5, 0.85);

      for (let i = 0; i < fracs.length; i++) {
        const cx = Math.round(g.cols * fracs[i]);
        const lvl = clamp01(
          (0.32 +
            0.62 *
              Math.abs(
                Math.sin(t * 2.7 + i * 0.9) * 0.7 +
                  Math.cos(t * 4.1 - i * 1.3) * 0.3
              )) *
            motion
        );
        const barH = Math.max(2, Math.round(lvl * maxH));

        for (let d = 0; d < maxH; d++) {
          const y = baseY - d;
          const frac = d / maxH;
          if (d < barH) {
            const rgb = frac > 0.82 ? rose : frac > 0.62 ? amber : green;
            const ch = frac > 0.82 ? "@" : "#";
            g.put(cx, y, ch, rgb, 0.9, 0.96);
            g.put(cx + 1, y, ch, mixRgb(rgb, cyan, 0.25), 0.86, 0.94);
          } else {
            g.put(cx, y, ":", panel, 0.45, 0.65);
            g.put(cx + 1, y, ":", panel, 0.45, 0.65);
          }
        }
      }

      const corrY = g.rows - 2;
      paintGridLine(g, 6, corrY, g.cols - 7, corrY, "=", slate, 0.55, 0.8);
      const corrX = Math.round(
        g.cols * (0.55 + Math.sin(t * 1.9) * 0.22 * motion)
      );
      g.glowTile(corrX, corrY, 2.4, cyan, 0.48);
      g.put(corrX, corrY, "@", cyan, 0.96, 1);
      break;
    }
  }

  g.flush(ctx);
}
