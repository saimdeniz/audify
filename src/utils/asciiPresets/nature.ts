import {
  clamp01,
  createGridFrame,
  fbm1,
  hash2,
  hexToRgb,
  mixRgb,
  vnoise,
} from "./blueprintGrid";
import {
  paintGridCircleRing,
  paintGridCloud,
  paintGridLine,
  paintGridMist,
  paintGridMoon,
  paintGridPine,
  paintGridRidge,
  paintGridSun,
} from "./blueprintShapes";
import { AsciiRenderParams } from "./shared";

export function renderNaturePreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, accentHex, themeMode: theme } = params;
  const accent = hexToRgb(accentHex);

  switch (preset) {
    case "moonlit": {
      const g = createGridFrame(w, h, "#071026", "#101f44", "#172b58", hexToRgb("#6488d8"), 0.09, theme);
      g.stars(t, hexToRgb("#cbd5e1"), 48, 0.65);

      const mx = Math.round(g.cols * 0.74);
      const my = Math.round(g.rows * 0.26);
      const mRad = Math.max(4, Math.min(g.cols, g.rows) * 0.19);
      g.glowTile(mx - 1, my, mRad * 1.9, hexToRgb("#fef3c7"), 0.25);
      paintGridMoon(g, mx, my, mRad, hexToRgb("#fef9c3"), hexToRgb("#fde68a"), hexToRgb("#93c5fd"));

      const cBody = hexToRgb("#64748b");
      const cRim = hexToRgb("#cbd5e1");
      for (let i = 0; i < 3; i++) {
        const cx = ((g.cols * (0.2 + i * 0.34) + t * (0.65 + i * 0.18)) % (g.cols + 16)) - 8;
        const cy = Math.round(g.rows * (0.34 + (i % 2) * 0.12));
        paintGridCloud(g, cx, cy, 6.5 + (i % 2) * 2, 2.6, cBody, cRim, 0.78);
      }

      paintGridRidge(g, 0.72, 4.2, 2.1, hexToRgb("#0c1836"), hexToRgb("#4766a8"), 5);
      const waterY = Math.round(g.rows * 0.78);
      for (let y = waterY; y < g.rows; y++) {
        const p = (y - waterY) / Math.max(1, g.rows - waterY);
        for (let x = 0; x < g.cols; x++) {
          const refl = clamp01(1 - Math.abs(x - mx) / (4 + p * 10));
          const wave = Math.sin(x * 0.45 + t * 2.4 + y * 0.9);
          if (refl > 0.15 && wave > -0.2) {
            g.put(x, y, wave > 0.35 ? "=" : "~", hexToRgb("#fde68a"), refl * 0.55, 0.88);
          } else if ((x + y) % 3 === 0) {
            g.put(x, y, "~", hexToRgb("#3b5998"), 0.28, 0.45);
          }
        }
      }
      g.flush(ctx);
      return;
    }

    case "cloud_drift": {
      const g = createGridFrame(w, h, "#3b82f6", "#60a5fa", "#bae6fd", hexToRgb("#ffffff"), 0.1, theme);
      const sx = Math.round(g.cols * 0.22);
      const sy = Math.round(g.rows * 0.22);
      g.glowTile(sx, sy, Math.min(g.cols, g.rows) * 0.35, hexToRgb("#fef9c3"), 0.28);
      paintGridSun(
        g,
        sx,
        sy,
        Math.max(3, Math.min(g.cols, g.rows) * 0.13),
        hexToRgb("#ffffff"),
        hexToRgb("#fef08a"),
        hexToRgb("#e0f2fe")
      );

      const white = hexToRgb("#ffffff");
      const ice = hexToRgb("#dbeafe");
      for (let i = 0; i < 5; i++) {
        const speed = 0.55 + (i % 3) * 0.25;
        const cx = ((hash2(i, 4.2) * (g.cols + 18) + t * speed) % (g.cols + 18)) - 9;
        const cy = Math.round(g.rows * (0.2 + i * 0.14));
        paintGridCloud(g, cx, cy, 5.5 + (i % 3) * 2.2, 2.3 + (i % 2) * 0.8, white, ice, 0.88);
      }

      for (let i = 0; i < 16; i++) {
        const bx = Math.floor((hash2(i, 9.1) * g.cols + t * 1.8) % g.cols);
        const by = Math.floor(hash2(i, 15.3) * g.rows * 0.85);
        g.put(bx, by, i % 2 === 0 ? "~" : "·", white, 0.22, 0.65);
      }
      g.flush(ctx);
      return;
    }

    case "fireflies": {
      const g = createGridFrame(w, h, "#05100b", "#0d2319", "#081710", hexToRgb("#34d399"), 0.075, theme);
      g.stars(t, hexToRgb("#6ee7b7"), 28, 0.52);

      paintGridRidge(g, 0.84, g.rows * 0.16, 4.1, hexToRgb("#061811"), hexToRgb("#065f46"), 5);
      const reedRgb = hexToRgb("#059669");
      const tipRgb = hexToRgb("#34d399");
      for (let x = 1; x < g.cols - 1; x += 2) {
        const reedH = 3 + Math.floor(hash2(x, 3.7) * Math.max(4, g.rows * 0.3));
        const sway = Math.sin(t * 1.5 + x * 0.35);
        for (let r = 0; r < reedH; r++) {
          const frac = r / Math.max(1, reedH - 1);
          const dx = Math.round(sway * frac * frac * 1.2);
          const ch = r === reedH - 1 ? (dx > 0 ? "/" : dx < 0 ? "\\" : "*") : "|";
          g.put(x + dx, g.rows - 1 - r, ch, r >= reedH - 2 ? tipRgb : reedRgb, 0.58, r === reedH - 1 ? 0.88 : 0.72);
        }
      }

      const lime = hexToRgb("#bef264");
      const gold = hexToRgb("#fde047");
      for (let i = 0; i < 20; i++) {
        const bx = hash2(i, 1.9) * g.cols;
        const by = (0.16 + hash2(i, 7.4) * 0.68) * g.rows;
        const fx = (bx + Math.sin(t * 0.85 + i * 1.7) * 4.5 + g.cols) % g.cols;
        const fy = by + Math.sin(t * 1.7 + i * 2.3) * 2.2;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + i * 1.9);
        if (pulse > 0.25) {
          const col = i % 3 === 0 ? accent : i % 2 === 0 ? lime : gold;
          g.glowTile(fx, fy, 2.4 + pulse * 1.4, col, pulse * 0.42);
          g.put(fx, fy, "@", hexToRgb("#fef9c3"), 0.92, 1);
        }
      }
      g.flush(ctx);
      return;
    }

    case "autumn_breeze": {
      const g = createGridFrame(w, h, "#170b07", "#2e170f", "#1c0e09", hexToRgb("#fb923c"), 0.075, theme);
      paintGridRidge(g, 0.8, g.rows * 0.14, 4.2, hexToRgb("#26120b"), hexToRgb("#9a3412"), 4);

      const trunkRgb = hexToRgb("#4a2518");
      const tx = Math.round(g.cols * 0.2);
      paintGridLine(g, tx - 1, g.rows - 1, tx + 1, Math.round(g.rows * 0.32), "#", trunkRgb, 0.9, 0.9);
      paintGridLine(g, tx + 1, Math.round(g.rows * 0.42), Math.round(g.cols * 0.48), Math.round(g.rows * 0.2), "/", trunkRgb, 0.8, 0.85);
      paintGridLine(g, tx, Math.round(g.rows * 0.38), Math.round(g.cols * 0.06), Math.round(g.rows * 0.24), "\\", trunkRgb, 0.8, 0.85);

      const copper = hexToRgb("#ea580c");
      const amber = hexToRgb("#f59e0b");
      const crimson = hexToRgb("#dc2626");
      const tufts = [
        { cx: 0.2, cy: 0.22, rx: 0.18, ry: 0.15 },
        { cx: 0.4, cy: 0.18, rx: 0.15, ry: 0.12 },
        { cx: 0.08, cy: 0.26, rx: 0.1, ry: 0.1 },
      ];
      for (let y = 0; y < Math.round(g.rows * 0.46); y++) {
        for (let x = 0; x < Math.round(g.cols * 0.62); x++) {
          let inside = 0;
          for (const tf of tufts) {
            const d = Math.hypot((x - g.cols * tf.cx) / (g.cols * tf.rx), (y - g.rows * tf.cy) / (g.rows * tf.ry));
            if (d < 1.1) inside = Math.max(inside, 1.1 - d);
          }
          const n = vnoise(x * 0.32 + 1.4, y * 0.34 + 2.1);
          if (inside > 0 && inside * 0.75 + n * 0.55 > 0.56) {
            const col = (x + y) % 3 === 0 ? amber : (x + y) % 2 === 0 ? copper : crimson;
            const ch = n > 0.55 ? "@" : n > 0.35 ? "*" : "~";
            g.put(x, y, ch, col, 0.68, 0.88);
          }
        }
      }

      const glyphs = ["*", "~", "+"];
      for (let i = 0; i < 28; i++) {
        const lx = (hash2(i, 3.3) * g.cols + t * (1.8 + (i % 3) * 0.45)) % g.cols;
        const ly = (hash2(i, 8.9) * g.rows + t * (0.9 + (i % 2) * 0.35) + Math.sin(t * 2.1 + i) * 1.4) % g.rows;
        const col = i % 3 === 0 ? amber : i % 2 === 0 ? copper : crimson;
        g.put(lx, ly, glyphs[i % 3], col, 0.68, 0.92);
      }
      g.flush(ctx);
      return;
    }

    case "sakura_night": {
      const g = createGridFrame(w, h, "#13091c", "#291538", "#180d24", hexToRgb("#f472b6"), 0.08, theme);
      g.stars(t, hexToRgb("#fbcfe8"), 34, 0.6);

      const mx = Math.round(g.cols * 0.74);
      const my = Math.round(g.rows * 0.28);
      const mRad = Math.max(4, Math.min(g.cols, g.rows) * 0.18);
      g.glowTile(mx, my, mRad * 1.8, hexToRgb("#f9a8d4"), 0.26);
      paintGridSun(g, mx, my, mRad, hexToRgb("#fdf2f8"), hexToRgb("#fbcfe8"), hexToRgb("#f472b6"));

      const branchRgb = hexToRgb("#3b1d38");
      paintGridLine(g, 0, Math.round(g.rows * 0.36), Math.round(g.cols * 0.52), Math.round(g.rows * 0.18), "=", branchRgb, 0.85, 0.9);
      paintGridLine(g, Math.round(g.cols * 0.22), Math.round(g.rows * 0.28), Math.round(g.cols * 0.44), Math.round(g.rows * 0.38), "\\", branchRgb, 0.8, 0.85);

      const pink1 = hexToRgb("#f9a8d4");
      const pink2 = hexToRgb("#f472b6");
      for (let y = 0; y < Math.round(g.rows * 0.45); y++) {
        for (let x = 0; x < Math.round(g.cols * 0.58); x++) {
          const d = Math.hypot((x - g.cols * 0.26) / (g.cols * 0.32), (y - g.rows * 0.22) / (g.rows * 0.22));
          if (d < 1.05 && vnoise(x * 0.28, y * 0.28) > 0.34) {
            const ch = (x + y) % 3 === 0 ? "@" : (x + y) % 2 === 0 ? "*" : "+";
            g.put(x, y, ch, (x + y) % 2 === 0 ? pink1 : pink2, 0.72, 0.9);
          }
        }
      }

      const pondY = Math.round(g.rows * 0.78);
      for (let y = pondY; y < g.rows; y++) {
        for (let x = 0; x < g.cols; x++) {
          if (Math.sin(x * 0.4 + t * 2 + y) > 0.25) {
            g.put(x, y, "~", hexToRgb("#db2777"), 0.35, 0.68);
          }
        }
      }
      paintGridCircleRing(g, g.cols * 0.45, g.rows * 0.86, 1.5 + ((t * 1.4) % 4.5), 0.7, pink1, 0.45, "~", 2.2);

      for (let i = 0; i < 26; i++) {
        const px = (hash2(i, 5.1) * g.cols + t * 1.35) % g.cols;
        const py = (hash2(i, 11.7) * pondY + t * 0.85 + Math.sin(t * 2 + i) * 1.1) % pondY;
        g.put(px, py, i % 2 === 0 ? "*" : "+", pink1, 0.65, 0.92);
      }
      g.flush(ctx);
      return;
    }

    case "rainy_glass": {
      const g = createGridFrame(w, h, "#070d17", "#132238", "#0b1524", hexToRgb("#60a5fa"), 0.075, theme);
      const bokehColors = [
        hexToRgb("#38bdf8"),
        hexToRgb("#fbbf24"),
        hexToRgb("#fb7185"),
        hexToRgb("#a78bfa"),
        accent,
      ];
      for (let i = 0; i < 9; i++) {
        const bx = (0.12 + hash2(i, 2.3) * 0.78) * g.cols;
        const by = (0.32 + hash2(i, 6.7) * 0.42) * g.rows;
        const pulse = 0.72 + 0.28 * Math.sin(t * 1.3 + i * 1.7);
        const col = bokehColors[i % bokehColors.length];
        g.glowTile(bx, by, 2.6 + (i % 3) * 1.2, col, 0.38 * pulse);
        g.put(bx, by, "o", col, 0.55 * pulse, 0.82);
      }

      const rainRgb = hexToRgb("#93c5fd");
      const dropRgb = hexToRgb("#e0f2fe");
      for (let i = 0; i < 42; i++) {
        const speed = 4.5 + (i % 4) * 1.2;
        const ry = (hash2(i, 14.1) * g.rows + t * speed) % g.rows;
        const rx = (hash2(i, 9.8) * g.cols - ry * 0.25 + g.cols * 2) % g.cols;
        g.put(rx, ry, "/", rainRgb, 0.42, 0.82);
        g.put(rx + 0.3, ry - 1, ":", rainRgb, 0.25, 0.55);
      }

      for (let i = 0; i < 10; i++) {
        const dx = Math.floor(hash2(i, 21.4) * g.cols);
        const dy = Math.floor(((hash2(i, 31.2) * g.rows + t * 0.9) % (g.rows - 3)) + 2);
        g.put(dx, dy, "@", dropRgb, 0.65, 0.95);
        g.put(dx, dy - 1, "|", rainRgb, 0.38, 0.7);
        g.put(dx, dy - 2, "·", rainRgb, 0.2, 0.5);
      }
      g.flush(ctx);
      return;
    }

    case "thunder_peak": {
      const g = createGridFrame(w, h, "#070814", "#191b34", "#0d0f20", hexToRgb("#818cf8"), 0.08, theme);
      const cycle = (t * 0.48) % 1;
      const flash = cycle < 0.35 ? Math.sin((cycle / 0.35) * Math.PI) : 0.14 + 0.08 * Math.sin(t * 5);

      const cDark = hexToRgb("#1e1b4b");
      const cRim = mixRgb(hexToRgb("#6366f1"), hexToRgb("#e0e7ff"), flash * 0.85);
      paintGridCloud(g, g.cols * 0.22 + Math.sin(t * 0.35) * 1.5, g.rows * 0.2, 6.2, 2.7, cDark, cRim, 0.88);
      paintGridCloud(g, g.cols * 0.52 + Math.cos(t * 0.3) * 1.2, g.rows * 0.16, 8.2, 3.2, cDark, cRim, 0.92);
      paintGridCloud(g, g.cols * 0.8 + Math.sin(t * 0.4 + 2) * 1.5, g.rows * 0.23, 5.8, 2.5, cDark, cRim, 0.84);

      const bx = Math.round(g.cols * 0.54);
      const by = Math.round(g.rows * 0.21);
      const mx = bx - 4;
      const my = Math.round(g.rows * 0.42);
      const boltRgb = mixRgb(hexToRgb("#93c5fd"), hexToRgb("#f8fafc"), flash);
      const boltA = Math.max(0.28, flash);
      g.glowTile(mx, my, 5.5, hexToRgb("#818cf8"), boltA * 0.48);
      paintGridLine(g, bx, by, mx, my, "/", boltRgb, boltA, 1);
      paintGridLine(g, mx, my, bx + 2, Math.round(g.rows * 0.64), "\\", boltRgb, boltA, 1);
      paintGridLine(g, mx, my, mx - 5, my + 4, "/", hexToRgb("#a5b4fc"), boltA * 0.8, 0.92);

      paintGridRidge(g, 0.6, g.rows * 0.26, 1.4, hexToRgb("#111329"), mixRgb(hexToRgb("#6366f1"), hexToRgb("#e0e7ff"), flash * 0.65), 4);
      paintGridRidge(g, 0.78, g.rows * 0.14, 5.8, hexToRgb("#090a18"), hexToRgb("#4f46e5"), 5);
      g.flush(ctx);
      return;
    }

    case "desert_mirage": {
      const g = createGridFrame(w, h, "#180d08", "#361d11", "#24130b", hexToRgb("#f59e0b"), 0.08, theme);
      g.stars(t, hexToRgb("#fde68a"), 30, 0.52);

      const sRad = Math.max(2.6, Math.min(g.cols, g.rows) * 0.11);
      const mRad = Math.max(3, Math.min(g.cols, g.rows) * 0.14);
      paintGridSun(g, Math.round(g.cols * 0.28), Math.round(g.rows * 0.26), sRad, hexToRgb("#fef08a"), hexToRgb("#f59e0b"), hexToRgb("#ea580c"), false);
      paintGridMoon(g, Math.round(g.cols * 0.72), Math.round(g.rows * 0.24), mRad, hexToRgb("#ffedd5"), hexToRgb("#fb923c"), hexToRgb("#f97316"));

      paintGridRidge(g, 0.56, g.rows * 0.2, 1.2, hexToRgb("#451a03"), hexToRgb("#d97706"), 6);
      paintGridRidge(g, 0.7, g.rows * 0.18, 4.9, hexToRgb("#3b1506"), hexToRgb("#f59e0b"), 5);
      paintGridRidge(g, 0.83, g.rows * 0.14, 8.4, hexToRgb("#270e04"), hexToRgb("#fbbf24"), 4);

      for (let i = 0; i < 16; i++) {
        const wx = (hash2(i, 4.4) * g.cols + t * 2.4) % g.cols;
        const wy = Math.round(g.rows * (0.52 + hash2(i, 9.2) * 0.4));
        g.put(wx, wy, "~", hexToRgb("#fde68a"), 0.35, 0.72);
      }
      g.flush(ctx);
      return;
    }

    case "blizzard_pass": {
      const g = createGridFrame(w, h, "#08121d", "#172a3e", "#0e1b29", hexToRgb("#bae6fd"), 0.085, theme);
      g.stars(t, hexToRgb("#cbd5e1"), 24, 0.45);
      paintGridRidge(g, 0.56, g.rows * 0.26, 2.5, hexToRgb("#1e293b"), hexToRgb("#94a3b8"), 4);
      paintGridRidge(g, 0.74, g.rows * 0.16, 6.3, hexToRgb("#0f172a"), hexToRgb("#cbd5e1"), 5);

      const pDark = hexToRgb("#1e3a5f");
      const pRim = hexToRgb("#f8fafc");
      const trees = [
        [0.12, 0.38], [0.28, 0.26], [0.49, 0.42], [0.71, 0.29], [0.87, 0.4],
      ];
      for (let i = 0; i < trees.length; i++) {
        const [xf, hf] = trees[i];
        paintGridPine(g, Math.round(xf * g.cols), g.rows - 1, Math.round(g.rows * hf), Math.sin(t * 1.8 + i) * 1.0, pDark, pRim);
      }

      const snowRgb = hexToRgb("#f8fafc");
      const glyphs = ["*", "+", "·"];
      for (let i = 0; i < 48; i++) {
        const sx = (hash2(i, 2.7) * g.cols - t * (3.2 + (i % 3) * 0.8) + g.cols * 8) % g.cols;
        const sy = (hash2(i, 8.1) * g.rows + t * (1.9 + (i % 2) * 0.6)) % g.rows;
        g.put(sx, sy, glyphs[i % 3], snowRgb, 0.55, 0.9);
      }
      g.flush(ctx);
      return;
    }

    case "bamboo_wind": {
      const g = createGridFrame(w, h, "#05120d", "#0d291e", "#071912", hexToRgb("#34d399"), 0.075, theme);
      const rayRgb = hexToRgb("#6ee7b7");
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const band = Math.sin((c - r * 0.55) * 0.28 + t * 0.4);
          if (band > 0.65) g.put(c, r, "·", rayRgb, (band - 0.65) * 0.35, 0.4);
        }
      }

      const stalkRgb = hexToRgb("#10b981");
      const nodeRgb = hexToRgb("#a7f3d0");
      const leafRgb = hexToRgb("#34d399");
      for (let i = 0; i < 7; i++) {
        const baseX = Math.round(((i + 0.5) / 7) * g.cols);
        for (let y = 0; y < g.rows; y++) {
          const frac = 1 - y / g.rows;
          const sway = Math.round(Math.sin(t * 1.4 + i * 1.1 + frac * 1.8) * frac * 1.6);
          const x = baseX + sway;
          const isNode = (y + i * 2) % 5 === 0;
          g.put(x, y, isNode ? "+" : "|", isNode ? nodeRgb : stalkRgb, 0.78, 0.92);
          if (isNode && y > 2 && y < g.rows - 3) {
            const dir = i % 2 === 0 ? 1 : -1;
            g.put(x + dir, y, dir > 0 ? "/" : "\\", leafRgb, 0.62, 0.85);
            g.put(x + dir * 2, y - 1, "~", leafRgb, 0.48, 0.78);
          }
        }
      }

      paintGridMist(g, t, 0.82, 3.5, hexToRgb("#34d399"), 0.32);
      for (let i = 0; i < 16; i++) {
        const sx = (hash2(i, 6.2) * g.cols + Math.sin(t + i) * 2 + g.cols) % g.cols;
        const sy = (hash2(i, 13.4) * g.rows - t * 0.6 + g.rows * 4) % g.rows;
        g.put(sx, sy, "*", hexToRgb("#fde047"), 0.52, 0.88);
      }
      g.flush(ctx);
      return;
    }

    case "misty_falls": {
      const g = createGridFrame(w, h, "#06121b", "#112b3c", "#091a26", hexToRgb("#38bdf8"), 0.08, theme);
      const cliffBody = hexToRgb("#0f172a");
      const cliffRim = hexToRgb("#475569");
      const poolY = Math.round(g.rows * 0.76);

      for (let y = 3; y < poolY; y++) {
        const yFrac = y / poolY;
        const leftEdge = Math.round(g.cols * (0.28 + (fbm1(yFrac * 4.5 + 1.2) - 0.5) * 0.14 + yFrac * 0.06));
        const rightEdge = Math.round(g.cols * (0.72 + (fbm1(yFrac * 4.5 + 6.4) - 0.5) * 0.14 - yFrac * 0.06));
        for (let x = 0; x < g.cols; x++) {
          if (x < leftEdge || x > rightEdge) {
            const isRim = x === leftEdge - 1 || x === rightEdge + 1;
            g.put(x, y, isRim ? (x < leftEdge ? "\\" : "/") : (x + y) % 2 === 0 ? "#" : ":", isRim ? cliffRim : cliffBody, 0.82, 0.7);
          } else {
            const flow = vnoise(x * 0.35, y * 0.28 - t * 3.8);
            const isEdgeSpray = x <= leftEdge + 1 || x >= rightEdge - 1;
            const col = flow > 0.52 || isEdgeSpray ? hexToRgb("#e0f2fe") : hexToRgb("#38bdf8");
            const ch = flow > 0.62 ? "@" : flow > 0.38 ? "|" : ":";
            g.put(x, y, ch, col, 0.52 + flow * 0.35, 0.9);
          }
        }
      }
      paintGridPine(g, Math.round(g.cols * 0.14), 5, 5, 0, hexToRgb("#062c22"), hexToRgb("#34d399"));
      paintGridPine(g, Math.round(g.cols * 0.86), 5, 5, 0, hexToRgb("#062c22"), hexToRgb("#34d399"));

      g.glowTile(g.cols * 0.5, poolY, Math.min(g.cols, g.rows) * 0.26, hexToRgb("#7dd3fc"), 0.42);
      paintGridMist(g, t, 0.74, 3.8, hexToRgb("#bae6fd"), 0.55);

      for (let k = 0; k < 3; k++) {
        const rad = 2 + ((t * 2.2 + k * 3.5) % 10);
        paintGridCircleRing(g, g.cols * 0.5, poolY + 2, rad, 0.7, hexToRgb("#7dd3fc"), 0.45 * (1 - rad / 12), "~", 2.4);
      }
      g.flush(ctx);
      return;
    }

    case "aurora_veil":
    default: {
      const g = createGridFrame(w, h, "#040c15", "#0c2529", "#07171c", hexToRgb("#2dd4bf"), 0.08, theme);
      g.stars(t, hexToRgb("#ccfbf1"), 42, 0.65);

      const emerald = hexToRgb("#34d399");
      const cyan = hexToRgb("#22d3ee");
      const violet = hexToRgb("#a855f7");
      for (let x = 0; x < g.cols; x++) {
        const wave = Math.sin(x * 0.11 + t * 0.85) * 2.6 + (fbm1(x * 0.08 - t * 0.25) - 0.5) * 4;
        const baseY = Math.round(g.rows * 0.42 + wave);
        const curtainH = 6 + Math.round(vnoise(x * 0.15, t * 0.6) * 5);
        for (let dy = 0; dy < curtainH; dy++) {
          const y = baseY - dy;
          if (y < 1 || y >= g.rows) continue;
          const frac = dy / curtainH;
          const col = frac < 0.45 ? mixRgb(emerald, cyan, frac * 2) : mixRgb(cyan, violet, (frac - 0.45) * 1.8);
          const alpha = clamp01((1 - frac * 0.78) * 0.75);
          const ch = dy === 0 ? "@" : frac < 0.4 ? "|" : ":";
          g.put(x, y, ch, col, alpha, clamp01(alpha * 1.25));
        }
      }

      paintGridRidge(g, 0.74, 4.4, 3.3, hexToRgb("#06141c"), hexToRgb("#5eead4"), 5);
      g.flush(ctx);
      return;
    }
  }
}
