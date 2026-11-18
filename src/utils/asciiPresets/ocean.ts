import {
  clamp01,
  createGridFrame,
  fbm1,
  hash2,
  hexToRgb,
  mixRgb,
  paintGridCircleRing,
  paintGridCloud,
  paintGridLine,
  paintGridMist,
  paintGridMoon,
  paintGridPine,
  paintGridRidge,
  paintGridSun,
  vnoise,
} from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

export function renderOceanPreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, accentHex, themeMode: theme } = params;
  const accent = hexToRgb(accentHex);

  switch (preset) {
    case "koi_pond": {
      const g = createGridFrame(w, h, "#07231c", "#0e3a2e", "#092b22", hexToRgb("#6ee7b7"), 0.085, theme);
      for (let k = 0; k < 2; k++) {
        const rad = 2 + ((t * 1.6 + k * 4.5) % 9);
        const rx = k === 0 ? g.cols * 0.42 : g.cols * 0.62;
        const ry = k === 0 ? g.rows * 0.46 : g.rows * 0.58;
        paintGridCircleRing(g, rx, ry, rad, 0.65, hexToRgb("#34d399"), 0.35 * (1 - rad / 11), "~", 1.3);
      }

      const padDark = hexToRgb("#15803d");
      const padRim = hexToRgb("#4ade80");
      const lotusPink = hexToRgb("#f472b6");
      const pads: [number, number, number, number][] = [
        [0.14, 0.2, 4.5, 0.5],
        [0.27, 0.12, 3.2, -0.8],
        [0.85, 0.8, 4.8, -2.4],
        [0.71, 0.88, 3.4, 2.1],
      ];
      for (const [pxF, pyF, rad, notchA] of pads) {
        const px = Math.round(pxF * g.cols);
        const py = Math.round(pyF * g.rows);
        const rInt = Math.ceil(rad);
        for (let dy = -rInt; dy <= rInt; dy++) {
          for (let dx = -rInt; dx <= rInt; dx++) {
            const d = Math.hypot(dx, dy);
            if (d <= rad && Math.abs(Math.atan2(dy, dx) - notchA) > 0.28) {
              const isRim = d > rad - 1.1;
              g.put(px + dx, py + dy, isRim ? "o" : "#", isRim ? padRim : padDark, 0.82, 0.9);
            }
          }
        }
        g.put(px, py, "@", lotusPink, 0.92, 1);
      }

      const kois: [number, number, number, string, string][] = [
        [0.25, 0.36, 1, "#f97316", "#f8fafc"],
        [0.68, 0.62, -1, "#fbbf24", "#ef4444"],
        [0.45, 0.48, 1, "#fb7185", "#ffffff"],
      ];
      for (let i = 0; i < kois.length; i++) {
        const [sx, sy, dir, c1, c2] = kois[i];
        const col1 = hexToRgb(c1);
        const col2 = hexToRgb(c2);
        const hx = ((sx * g.cols + t * dir * (1.7 + i * 0.3)) % g.cols + g.cols) % g.cols;
        const hy = sy * g.rows + Math.sin(t * 1.3 + i * 2) * 1.6;
        for (let s = 0; s < 7; s++) {
          const cx = (hx - dir * s + g.cols) % g.cols;
          const cy = hy + Math.sin(t * 3.8 - s * 0.65 + i) * (s > 3 ? 1.1 : 0.5);
          const col = s >= 5 ? col2 : s % 2 === 0 ? col1 : col2;
          g.put(cx, cy, s === 0 ? "@" : s >= 5 ? "~" : "#", col, s >= 5 ? 0.68 : 0.9, 0.95);
          if (s === 1 || s === 2) g.put(cx, cy + 1, "#", col1, 0.78, 0.88);
          if (s === 2) {
            g.put(cx, cy - 1, "+", col2, 0.65, 0.85);
            g.put(cx, cy + 2, "+", col2, 0.65, 0.85);
          }
        }
      }
      g.flush(ctx);
      return;
    }

    case "jellyfish": {
      const g = createGridFrame(w, h, "#040a1a", "#0d1f3d", "#071226", hexToRgb("#60a5fa"), 0.08, theme);
      const specs: [number, number, typeof accent, typeof accent][] = [
        [0.26, 0.34, hexToRgb("#22d3ee"), hexToRgb("#67e8f9")],
        [0.52, 0.26, hexToRgb("#f472b6"), hexToRgb("#fbcfe8")],
        [0.76, 0.38, accent, hexToRgb("#e0f2fe")],
      ];
      for (let j = 0; j < specs.length; j++) {
        const [jx, jy, bellCol, rimCol] = specs[j];
        const cx = Math.round((jx + Math.sin(t * 0.5 + j) * 0.03) * g.cols);
        const cy = Math.round((jy + Math.sin(t * 2.1 + j * 2.1) * 0.03) * g.rows);
        g.glowTile(cx, cy, 5.5, bellCol, 0.32);

        for (let dy = -3; dy <= 0; dy++) {
          const span = Math.round(4 * Math.sqrt(Math.max(0.15, 1 - (dy / 3.4) ** 2)));
          for (let dx = -span; dx <= span; dx++) {
            const isRim = dy === 0 || Math.abs(dx) === span;
            g.put(cx + dx, cy + dy, isRim ? "o" : dy === -3 ? "@" : "#", isRim ? rimCol : bellCol, isRim ? 0.88 : 0.75, 0.95);
          }
        }
        for (let tx = -3; tx <= 3; tx += 2) {
          for (let ty = 1; ty <= 8; ty++) {
            const sway = Math.round(Math.sin(t * 2.8 - ty * 0.55 + tx + j) * 1.1);
            const fade = clamp01(1 - ty / 9.5);
            const ch = ty > 6 ? "~" : ty % 2 === 0 ? ":" : "|";
            g.put(cx + tx + sway, cy + ty, ch, mixRgb(bellCol, rimCol, 0.4), fade * 0.72, fade * 0.92);
          }
        }
      }
      for (let i = 0; i < 20; i++) {
        const bx = (hash2(i, 4.1) * g.cols + Math.sin(t + i) * 0.8 + g.cols) % g.cols;
        const by = (hash2(i, 9.3) * g.rows - t * 1.2 + g.rows * 6) % g.rows;
        g.put(bx, by, i % 3 === 0 ? "o" : "·", hexToRgb("#7dd3fc"), 0.35, 0.75);
      }
      g.flush(ctx);
      return;
    }

    case "coral_reef": {
      const g = createGridFrame(w, h, "#041520", "#0c3044", "#071e2c", hexToRgb("#2dd4bf"), 0.08, theme);
      const beamCol = hexToRgb("#5eead4");
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const b = Math.sin((c - r * 0.6) * 0.24 + t * 0.5);
          if (b > 0.68) g.put(c, r, "·", beamCol, (b - 0.68) * 0.32, 0.42);
        }
      }
      paintGridRidge(g, 0.78, 3.2, 2.7, hexToRgb("#082433"), hexToRgb("#14b8a6"), 4);

      const coralCols = [hexToRgb("#fb7185"), hexToRgb("#2dd4bf"), hexToRgb("#fbbf24")];
      for (let i = 0; i < 6; i++) {
        const cx = Math.round(((i + 0.6) / 6) * g.cols);
        const by = g.rows - 2;
        const col = coralCols[i % 3];
        const sway = Math.round(Math.sin(t * 1.5 + i) * 1.2);
        paintGridLine(g, cx, by, cx + sway, by - 5, "|", col, 0.82, 0.92);
        paintGridLine(g, cx, by - 2, cx - 2 + sway, by - 5, "/", col, 0.75, 0.88);
        paintGridLine(g, cx, by - 3, cx + 2 + sway, by - 6, "\\", col, 0.75, 0.88);
      }
      for (let i = 0; i < 10; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const fx = ((hash2(i, 5.2) * g.cols + t * dir * 2.2) % g.cols + g.cols) % g.cols;
        const fy = Math.round((0.2 + hash2(i, 8.4) * 0.45) * g.rows + Math.sin(t * 2 + i));
        g.put(fx, fy, dir > 0 ? ">" : "<", hexToRgb("#fb923c"), 0.82, 0.95);
        g.put(fx - dir, fy, "o", hexToRgb("#fde047"), 0.65, 0.85);
      }
      for (let i = 0; i < 14; i++) {
        const bx = Math.round(hash2(i, 12.1) * g.cols);
        const by = (hash2(i, 18.7) * g.rows - t * 1.6 + g.rows * 6) % g.rows;
        g.put(bx, by, i % 2 === 0 ? "o" : "·", hexToRgb("#bae6fd"), 0.38, 0.78);
      }
      g.flush(ctx);
      return;
    }

    case "abyss_trench": {
      const g = createGridFrame(w, h, "#02050c", "#071324", "#040a14", hexToRgb("#22d3ee"), 0.07, theme);
      const wallBody = hexToRgb("#040d1a");
      const wallRim = hexToRgb("#0e7490");
      for (let y = 0; y < g.rows; y++) {
        const lw = Math.round(g.cols * 0.22 + (fbm1(y * 0.14 + 1.1) - 0.4) * 6);
        const rw = Math.round(g.cols * 0.78 - (fbm1(y * 0.14 + 5.7) - 0.4) * 6);
        for (let x = 0; x < g.cols; x++) {
          if (x <= lw || x >= rw) {
            const isRim = x === lw || x === rw;
            g.put(x, y, isRim ? "|" : (x + y) % 3 === 0 ? "#" : ":", isRim ? wallRim : wallBody, 0.82, 0.72);
          }
        }
      }
      paintGridMist(g, t, 0.65, 4, hexToRgb("#0891b2"), 0.25);

      const bioCyan = hexToRgb("#22d3ee");
      const bioGreen = hexToRgb("#34d399");
      for (let i = 0; i < 4; i++) {
        const ox = g.cols * (0.36 + hash2(i, 2.4) * 0.28) + Math.sin(t * 0.75 + i * 2) * 2.5;
        const oy = g.rows * (0.22 + i * 0.18) + Math.cos(t * 1.1 + i) * 1.2;
        const glowCol = i % 2 === 0 ? bioCyan : bioGreen;
        g.glowTile(ox, oy, 3.4, glowCol, 0.46);
        g.put(ox - 1, oy, "(", glowCol, 0.62, 0.88);
        g.put(ox, oy, "@", hexToRgb("#ecfeff"), 0.94, 1);
        g.put(ox + 1, oy, ")", glowCol, 0.62, 0.88);
        g.put(ox, oy + 1, ":", glowCol, 0.4, 0.78);
      }
      for (let i = 0; i < 24; i++) {
        const sx = (0.26 + hash2(i, 7.7) * 0.48) * g.cols;
        const sy = (hash2(i, 13.9) * g.rows - t * 0.85 + g.rows * 4) % g.rows;
        g.put(sx, sy, i % 2 === 0 ? "*" : "·", bioCyan, 0.42, 0.8);
      }
      g.flush(ctx);
      return;
    }

    case "moon_tide": {
      const g = createGridFrame(w, h, "#050a17", "#0d1e38", "#071122", hexToRgb("#7dd3fc"), 0.08, theme);
      g.stars(t, hexToRgb("#e0f2fe"), 40, 0.5);

      const mx = Math.round(g.cols * 0.5);
      const my = Math.round(g.rows * 0.24);
      const mRad = Math.max(4, Math.min(g.cols, g.rows) * 0.16);
      g.glowTile(mx, my, mRad * 1.9, hexToRgb("#bae6fd"), 0.28);
      paintGridSun(g, mx, my, mRad, hexToRgb("#f8fafc"), hexToRgb("#e0f2fe"), hexToRgb("#7dd3fc"));

      const horY = Math.round(g.rows * 0.54);
      const silver = hexToRgb("#e0f2fe");
      const cyan = hexToRgb("#38bdf8");
      const deepWave = hexToRgb("#1e3a8a");
      for (let y = horY; y < g.rows; y++) {
        const p = (y - horY) / Math.max(1, g.rows - horY);
        const colSpan = 2.5 + p * (g.cols * 0.28);
        for (let x = 0; x < g.cols; x++) {
          const d = Math.abs(x - mx);
          const wave = Math.sin(x * 0.35 + t * 2.2 - y * 0.7);
          if (d <= colSpan && wave > -0.25) {
            const k = clamp01(1 - d / colSpan);
            g.put(x, y, wave > 0.3 ? "=" : "~", mixRgb(cyan, silver, k), 0.45 + k * 0.45, 0.92);
          } else if (y === horY || (wave > 0.45 && (x + y) % 2 === 0)) {
            g.put(x, y, y === horY ? "=" : "~", deepWave, 0.38, 0.65);
          }
        }
      }
      g.flush(ctx);
      return;
    }

    case "lighthouse_cove": {
      const g = createGridFrame(w, h, "#060b16", "#102038", "#081322", hexToRgb("#60a5fa"), 0.08, theme);
      g.stars(t, hexToRgb("#dbeafe"), 32, 0.55);
      paintGridCloud(g, g.cols * 0.68, g.rows * 0.2, 6.5, 2.2, hexToRgb("#1e293b"), hexToRgb("#64748b"), 0.7);

      const lx = Math.round(g.cols * 0.22);
      const ly = Math.round(g.rows * 0.3);
      const beamDir = Math.sin(t * 1.1) * 0.28;
      const gold = hexToRgb("#fde047");
      for (let y = 0; y < Math.round(g.rows * 0.72); y++) {
        for (let x = lx + 1; x < g.cols; x++) {
          const diff = Math.abs(Math.atan2(y - ly, x - lx) - beamDir);
          if (diff < 0.16) {
            const dist = Math.hypot(x - lx, y - ly) / g.cols;
            const k = clamp01((1 - diff / 0.16) * (1 - dist * 0.75));
            if (k > 0.08) g.put(x, y, k > 0.45 ? "+" : "·", gold, k * 0.52, k * 0.85);
          }
        }
      }

      paintGridRidge(g, 0.74, 3.8, 1.9, hexToRgb("#091526"), hexToRgb("#38bdf8"), 5);
      paintGridPine(g, Math.round(g.cols * 0.1), Math.round(g.rows * 0.68), 6, 0, hexToRgb("#0f172a"), hexToRgb("#334155"));

      const red = hexToRgb("#ef4444");
      const white = hexToRgb("#f8fafc");
      for (let r = ly; r <= Math.round(g.rows * 0.68); r++) {
        const halfW = r > ly + 4 ? 2 : 1;
        const stripeCol = Math.floor((r - ly) / 2) % 2 === 0 ? white : red;
        for (let dx = -halfW; dx <= halfW; dx++) {
          const isTop = r <= ly + 1;
          g.put(lx + dx, r, isTop ? "@" : "#", isTop ? gold : stripeCol, 0.92, 0.98);
        }
      }
      g.glowTile(lx, ly, 4, gold, 0.55);
      g.flush(ctx);
      return;
    }

    case "manta_glide": {
      const g = createGridFrame(w, h, "#041322", "#0c2b48", "#071c30", hexToRgb("#38bdf8"), 0.08, theme);
      const shaftCol = hexToRgb("#7dd3fc");
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const s = Math.sin((c - r * 0.5) * 0.22 + t * 0.4);
          if (s > 0.65) g.put(c, r, "·", shaftCol, (s - 0.65) * 0.35, 0.45);
        }
      }

      const mantas: [number, number, number][] = [
        [0.46, 0.44, 6],
        [0.72, 0.66, 4],
      ];
      const bodyRgb = hexToRgb("#0ea5e9");
      const wingRim = hexToRgb("#bae6fd");
      for (let m = 0; m < mantas.length; m++) {
        const [bx, by, span] = mantas[m];
        const cx = Math.round((bx + Math.sin(t * 0.55 + m * 2) * 0.14) * g.cols);
        const cy = Math.round((by + Math.cos(t * 0.75 + m * 2) * 0.06) * g.rows);
        const flap = Math.sin(t * 2.2 + m) * 0.8;
        for (let dy = -3; dy <= 3; dy++) {
          const wSpan = Math.max(0, span - Math.abs(dy) * 2);
          for (let dx = -wSpan; dx <= wSpan; dx++) {
            const wy = cy + dy + Math.round((Math.abs(dx) / Math.max(1, span)) * flap);
            const isRim = Math.abs(dx) === wSpan || Math.abs(dy) === 3;
            g.put(cx + dx, wy, isRim ? "~" : dy === 0 && Math.abs(dx) <= 1 ? "@" : "#", isRim ? wingRim : bodyRgb, 0.85, 0.95);
          }
        }
        paintGridLine(g, cx, cy + 3, cx - 2, cy + 7, "|", wingRim, 0.72, 0.88);
      }
      for (let i = 0; i < 22; i++) {
        const px = (hash2(i, 6.3) * g.cols - t * 1.1 + g.cols * 4) % g.cols;
        const py = hash2(i, 11.8) * g.rows;
        g.put(px, py, i % 2 === 0 ? "*" : "+", wingRim, 0.42, 0.82);
      }
      g.flush(ctx);
      return;
    }

    case "biolum_surf": {
      const g = createGridFrame(w, h, "#040a18", "#0a2040", "#061328", hexToRgb("#38bdf8"), 0.08, theme);
      g.stars(t, hexToRgb("#bae6fd"), 36, 0.48);
      paintGridMoon(g, Math.round(g.cols * 0.78), Math.round(g.rows * 0.2), 4, hexToRgb("#e0f2fe"), hexToRgb("#38bdf8"), hexToRgb("#0284c7"));
      paintGridRidge(g, 0.52, 4.2, 2.3, hexToRgb("#061024"), hexToRgb("#1d4ed8"), 5);

      const neon = hexToRgb("#00f5d4");
      const electric = hexToRgb("#38bdf8");
      for (let wIdx = 0; wIdx < 4; wIdx++) {
        const baseY = g.rows * (0.58 + wIdx * 0.1) + Math.sin(t * 1.6 + wIdx) * 0.8;
        for (let x = 0; x < g.cols; x++) {
          const wy = Math.round(baseY + Math.sin(x * 0.14 + t * 2.1 + wIdx * 1.4) * 1.2);
          const glow = 0.55 + 0.45 * vnoise(x * 0.25 - t * 1.8, wIdx * 3.1);
          g.put(x, wy, glow > 0.75 ? "@" : "=", neon, 0.85 * glow, 1);
          g.put(x, wy + 1, "~", electric, 0.52 * glow, 0.85);
          if (x % 6 === wIdx) g.glowTile(x, wy, 2.2, neon, 0.28 * glow);
        }
      }
      g.flush(ctx);
      return;
    }

    case "sunken_torii": {
      const g = createGridFrame(w, h, "#05151d", "#0d303e", "#08202a", hexToRgb("#38bdf8"), 0.08, theme);
      for (let x = 0; x < g.cols; x++) {
        if (Math.sin(x * 0.3 + t * 2.2) > 0.2) g.put(x, 1, "~", hexToRgb("#bae6fd"), 0.55, 0.88);
      }

      const cx = Math.round(g.cols * 0.5);
      const topY = Math.round(g.rows * 0.22);
      const waterY = Math.round(g.rows * 0.74);
      const vermilion = hexToRgb("#ef4444");
      const darkRed = hexToRgb("#b91c1c");
      const span = Math.max(7, Math.round(g.cols * 0.22));
      const pillarOff = Math.max(4, Math.round(span * 0.62));

      paintGridLine(g, cx - span - 1, topY, cx + span + 1, topY, "=", vermilion, 0.92, 0.98);
      paintGridLine(g, cx - span, topY + 1, cx + span, topY + 1, "#", darkRed, 0.88, 0.95);
      paintGridLine(g, cx - span + 1, topY + 4, cx + span - 1, topY + 4, "=", vermilion, 0.88, 0.95);
      paintGridLine(g, cx, topY + 1, cx, topY + 4, "#", vermilion, 0.88, 0.95);

      for (let y = topY + 1; y < waterY; y++) {
        g.put(cx - pillarOff, y, "|", vermilion, 0.9, 0.96);
        g.put(cx - pillarOff + 1, y, "#", darkRed, 0.85, 0.9);
        g.put(cx + pillarOff - 1, y, "#", darkRed, 0.85, 0.9);
        g.put(cx + pillarOff, y, "|", vermilion, 0.9, 0.96);
      }

      paintGridMist(g, t, 0.72, 3, hexToRgb("#2dd4bf"), 0.32);
      for (let y = waterY; y < g.rows; y++) {
        const jit = Math.round(Math.sin(y * 1.3 + t * 3) * 1.1);
        g.put(cx - pillarOff + jit, y, "~", vermilion, 0.45, 0.78);
        g.put(cx + pillarOff + jit, y, "~", vermilion, 0.45, 0.78);
      }
      g.flush(ctx);
      return;
    }

    case "arctic_floe": {
      const g = createGridFrame(w, h, "#06101e", "#112842", "#091829", hexToRgb("#bae6fd"), 0.085, theme);
      g.stars(t, hexToRgb("#e0f2fe"), 28, 0.45);
      paintGridMoon(g, Math.round(g.cols * 0.2), Math.round(g.rows * 0.2), 3.5, hexToRgb("#f8fafc"), hexToRgb("#bae6fd"), hexToRgb("#38bdf8"));

      const cx = Math.round(g.cols * 0.52);
      const waterY = Math.round(g.rows * 0.56);
      const iceWhite = hexToRgb("#f8fafc");
      const iceBlue = hexToRgb("#7dd3fc");
      const subBlue = hexToRgb("#0284c7");

      const topH = Math.round(g.rows * 0.36);
      for (let dy = 0; dy < topH; dy++) {
        const y = waterY - topH + dy;
        const hw = Math.round((dy / topH) * (g.cols * 0.2));
        for (let dx = -hw; dx <= hw; dx++) {
          const isEdge = Math.abs(dx) === hw || dy === 0;
          const ch = dy === 0 ? "^" : isEdge ? (dx < 0 ? "/" : "\\") : dx < 0 ? "@" : "#";
          g.put(cx + dx, y, ch, dx < 0 ? iceWhite : iceBlue, 0.85, 0.95);
        }
      }

      const botH = Math.round(g.rows * 0.34);
      for (let dy = 0; dy < botH; dy++) {
        const y = waterY + dy;
        const hw = Math.round((1 - dy / botH) * (g.cols * 0.22));
        for (let dx = -hw; dx <= hw; dx++) {
          const ch = dy === 0 ? "=" : (dx + dy) % 2 === 0 ? "#" : ":";
          g.put(cx + dx, y, ch, subBlue, 0.55 * (1 - dy / (botH + 2)), 0.78);
        }
      }
      for (let x = 0; x < g.cols; x++) {
        if (Math.abs(x - cx) > g.cols * 0.2) g.put(x, waterY, "=", iceBlue, 0.5, 0.82);
      }
      g.flush(ctx);
      return;
    }

    case "kelp_cathedral": {
      const g = createGridFrame(w, h, "#041310", "#0b2b24", "#061b17", hexToRgb("#34d399"), 0.08, theme);
      const rayCol = hexToRgb("#6ee7b7");
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const b = Math.sin((c - r * 0.45) * 0.25 + t * 0.45);
          if (b > 0.62) g.put(c, r, "·", rayCol, (b - 0.62) * 0.38, 0.45);
        }
      }

      const kelp1 = hexToRgb("#10b981");
      const kelp2 = hexToRgb("#059669");
      const tipCol = hexToRgb("#a7f3d0");
      for (let i = 0; i < 7; i++) {
        const baseX = Math.round(((i + 0.5) / 7) * g.cols);
        const topR = Math.round(g.rows * (0.12 + (i % 3) * 0.06));
        for (let y = topR; y < g.rows; y++) {
          const x = baseX + Math.round(Math.sin(t * 1.7 + y * 0.32 + i * 1.3) * 1.4);
          const col = i % 2 === 0 ? kelp1 : kelp2;
          g.put(x, y, y === topR ? "^" : "#", y === topR ? tipCol : col, 0.84, 0.92);
          if ((y + i) % 3 === 0) {
            const side = (y + i) % 2 === 0 ? 1 : -1;
            g.put(x + side, y, side > 0 ? "/" : "\\", tipCol, 0.65, 0.88);
            g.put(x + side * 2, y, "~", col, 0.48, 0.75);
          }
        }
      }
      for (let i = 0; i < 18; i++) {
        const mx = (hash2(i, 3.8) * g.cols + Math.sin(t + i) * 1.5 + g.cols) % g.cols;
        const my = (hash2(i, 9.4) * g.rows - t * 0.8 + g.rows * 4) % g.rows;
        g.put(mx, my, "*", hexToRgb("#fde047"), 0.52, 0.88);
      }
      g.flush(ctx);
      return;
    }

    case "whale_song":
    default: {
      const g = createGridFrame(w, h, "#030813", "#091a33", "#051020", hexToRgb("#60a5fa"), 0.08, theme);
      const wx = Math.round((0.46 + Math.sin(t * 0.35) * 0.08) * g.cols);
      const wy = Math.round((0.48 + Math.cos(t * 0.6) * 0.04) * g.rows);
      const sonarRgb = hexToRgb("#38bdf8");
      for (let k = 0; k < 3; k++) {
        const rad = 3 + ((t * 2.4 + k * 4.5) % 14);
        paintGridCircleRing(g, wx + 8, wy - 1, rad, 0.7, sonarRgb, 0.45 * (1 - rad / 17), "o", 1.25);
      }

      const whaleTop = hexToRgb("#38bdf8");
      const whaleBelly = hexToRgb("#bae6fd");
      for (let dx = -10; dx <= 8; dx++) {
        const halfH = Math.max(1, Math.round(Math.sin(((dx + 10) / 18) * Math.PI) * 3.2));
        const waveY = Math.round(Math.sin(t * 1.8 - dx * 0.22) * 0.7);
        for (let dy = -halfH; dy <= halfH; dy++) {
          const isBelly = dy > 0;
          const ch = isBelly ? "=" : dy === -halfH ? "~" : dx > 4 ? "@" : "#";
          g.put(wx + dx, wy + dy + waveY, ch, isBelly ? whaleBelly : whaleTop, 0.88, 0.95);
        }
      }
      paintGridLine(g, wx + 1, wy + 2, wx - 2, wy + 6, "/", whaleBelly, 0.85, 0.95);
      paintGridLine(g, wx - 10, wy, wx - 13, wy - 2, "\\", whaleTop, 0.85, 0.95);
      paintGridLine(g, wx - 10, wy, wx - 13, wy + 2, "/", whaleTop, 0.85, 0.95);

      for (let i = 0; i < 20; i++) {
        const px = (hash2(i, 5.5) * g.cols - t * 0.9 + g.cols * 4) % g.cols;
        const py = hash2(i, 14.2) * g.rows;
        g.put(px, py, vnoise(px * 0.2, py * 0.2) > 0.5 ? "+" : "·", whaleBelly, 0.35, 0.75);
      }
      g.flush(ctx);
      return;
    }
  }
}
