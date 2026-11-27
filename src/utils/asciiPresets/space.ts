import {
  clamp01,
  createGridFrame,
  hash2,
  hexToRgb,
  mixRgb,
  vnoise,
} from "./blueprintGrid";
import {
  paintGridCircleRing,
  paintGridLine,
  paintGridMoon,
  paintGridRidge,
  paintGridSun,
} from "./blueprintShapes";
import { AsciiRenderParams } from "./shared";

export function renderSpacePreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, themeMode: theme } = params;

  switch (preset) {
    case "deep_nebula": {
      const g = createGridFrame(w, h, "#060412", "#1b0d34", "#0b071e", hexToRgb("#c084fc"), 0.065, theme);
      g.stars(t, hexToRgb("#e9d5ff"), 42, 0.95);
      g.stars(t + 4.2, hexToRgb("#7dd3fc"), 18, 0.95);

      const magenta = hexToRgb("#e879f9");
      const violet = hexToRgb("#a855f7");
      const cyan = hexToRgb("#38bdf8");
      for (let y = 1; y < g.rows - 1; y++) {
        for (let x = 1; x < g.cols - 1; x++) {
          const nx = x / g.cols;
          const ny = y / g.rows;
          const n1 = vnoise(x * 0.14 + t * 0.18, y * 0.18 - t * 0.1);
          const n2 = vnoise(x * 0.27 - t * 0.12, y * 0.25 + 7.3);
          const fbm = n1 * 0.65 + n2 * 0.35;
          const ridge = 1 - Math.abs(ny - (0.25 + nx * 0.48 + (fbm - 0.5) * 0.35)) * 3.2;
          const cov = clamp01(ridge * fbm * 1.45);
          if (cov < 0.14) continue;
          const rgb = cov > 0.62 ? magenta : cov > 0.36 ? violet : cyan;
          const ch = cov > 0.72 ? "@" : cov > 0.52 ? "%" : cov > 0.35 ? "+" : cov > 0.22 ? ":" : "·";
          g.put(x, y, ch, rgb, cov * 0.78, Math.min(1, cov * 1.15));
        }
      }

      const cores = [
        { fx: 0.32, fy: 0.4, hex: "#fef08a" },
        { fx: 0.52, fy: 0.52, hex: "#f472b6" },
        { fx: 0.7, fy: 0.62, hex: "#7dd3fc" },
      ];
      for (const c of cores) {
        const cx = g.cols * c.fx;
        const cy = g.rows * c.fy;
        const rgb = hexToRgb(c.hex);
        g.glowTile(cx, cy, 3.6, rgb, 0.72);
        g.put(cx, cy, "@", rgb, 0.98, 1);
      }
      g.flush(ctx);
      return;
    }

    case "orbital_rings": {
      const g = createGridFrame(w, h, "#050712", "#131936", "#080b1c", hexToRgb("#93c5fd"), 0.065, theme);
      g.stars(t, hexToRgb("#e2e8f0"), 44, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const pRadius = Math.min(g.cols, g.rows) * 0.24;
      const ringR = pRadius * 1.55;
      const gold = hexToRgb("#fbbf24");
      const amber = hexToRgb("#f59e0b");

      paintGridCircleRing(g, cx, cy - 0.6, ringR, 0.75, amber, 0.55, "=", 2.1);
      paintGridSun(g, cx, cy, pRadius, hexToRgb("#93c5fd"), hexToRgb("#3b82f6"), hexToRgb("#1d4ed8"), true);

      const rMaxX = Math.ceil((ringR + 1.2) * 2.1);
      for (let dy = 0; dy <= Math.ceil(ringR + 1.2); dy++) {
        for (let dx = -rMaxX; dx <= rMaxX; dx++) {
          const d = Math.hypot(dx / 2.1, dy);
          if (Math.abs(d - ringR) <= 0.85) {
            g.put(cx + dx, cy + dy, "=", gold, 0.88, 0.96);
          }
        }
      }

      const mAng = t * 0.9;
      const mx = cx + Math.cos(mAng) * (ringR + 1.8) * 2.1;
      const my = cy + Math.sin(mAng) * (ringR + 1.8);
      g.glowTile(mx, my, 2.2, hexToRgb("#bae6fd"), 0.65);
      g.put(mx, my, "@", hexToRgb("#ffffff"), 0.98, 1);
      g.flush(ctx);
      return;
    }

    case "solar_eclipse": {
      const g = createGridFrame(w, h, "#050409", "#1a110a", "#09070c", hexToRgb("#fbbf24"), 0.065, theme);
      g.stars(t, hexToRgb("#fef3c7"), 38, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const R = Math.min(g.cols, g.rows) * 0.26;
      const coronaGold = hexToRgb("#fbbf24");
      const coronaWarm = hexToRgb("#f97316");

      g.glowTile(cx, cy, R * 1.85, coronaWarm, 0.62);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * 0.15;
        const rayLen = R * (1.35 + 0.22 * Math.sin(t * 2.1 + i * 1.7));
        paintGridLine(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(a) * rayLen * 1.2, cy + Math.sin(a) * rayLen, ":", coronaGold, 0.55, 0.85);
      }
      paintGridCircleRing(g, cx, cy, R + 0.5, 0.75, hexToRgb("#fef08a"), 0.92, "@", 1.12);

      const rInt = Math.ceil(R * 1.15);
      const darkMoon = hexToRgb("#09070c");
      for (let dy = -rInt; dy <= rInt; dy++) {
        for (let dx = -rInt; dx <= rInt; dx++) {
          if (Math.hypot(dx / 1.12, dy) <= R * 0.94) {
            g.put(cx + dx, cy + dy, "·", darkMoon, 0.96, 0.35);
          }
        }
      }

      const fx = cx + R * 0.78;
      const fy = cy - R * 0.62;
      g.glowTile(fx, fy, 4.2, hexToRgb("#fef08a"), 0.92);
      g.put(fx, fy, "@", hexToRgb("#ffffff"), 1, 1);
      g.flush(ctx);
      return;
    }

    case "pulsar_beacon": {
      const g = createGridFrame(w, h, "#040813", "#0d2038", "#06101e", hexToRgb("#38bdf8"), 0.065, theme);
      g.stars(t, hexToRgb("#bae6fd"), 40, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const cyan = hexToRgb("#38bdf8");
      const ice = hexToRgb("#bae6fd");

      for (let k = 0; k < 3; k++) {
        const r = 2.5 + ((t * 3.2 + k * 3.2) % 9.5);
        const fade = clamp01(1 - (r - 2.5) / 9.5);
        paintGridCircleRing(g, cx, cy, r, 0.55, cyan, fade * 0.62, "o", 1.45);
      }

      const wobble = Math.sin(t * 6) * 0.08;
      const jAng = -0.68 + wobble;
      const maxLen = Math.min(g.cols, g.rows) * 0.46;
      const dx = Math.cos(jAng) * maxLen * 1.3;
      const dy = Math.sin(jAng) * maxLen;
      paintGridLine(g, cx - dx, cy - dy, cx + dx, cy + dy, "/", ice, 0.85, 0.98);
      paintGridLine(g, cx - dx * 0.7, cy - dy * 0.7, cx + dx * 0.7, cy + dy * 0.7, "*", cyan, 0.9, 1);

      g.glowTile(cx, cy, 4.0, cyan, 0.88);
      g.put(cx, cy, "@", hexToRgb("#ffffff"), 1, 1);
      g.flush(ctx);
      return;
    }

    case "star_warp": {
      const g = createGridFrame(w, h, "#03050c", "#0a1226", "#050814", hexToRgb("#60a5fa"), 0.065, theme);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const maxR = Math.hypot(cx, cy);
      const cyan = hexToRgb("#38bdf8");
      const blue = hexToRgb("#60a5fa");
      const white = hexToRgb("#f8fafc");

      for (let i = 0; i < 42; i++) {
        const ang = hash2(i, 1.7) * Math.PI * 2;
        const speed = 0.45 + (i % 3) * 0.28;
        const prog = (hash2(i, 8.3) + t * speed) % 1;
        const r0 = 2.6 + Math.pow(prog, 1.85) * (maxR - 2.6);
        const streak = 1.0 + prog * 4.2;
        const r1 = r0 + streak;
        const x0 = cx + Math.cos(ang) * r0;
        const y0 = cy + Math.sin(ang) * r0 * 0.75;
        const x1 = cx + Math.cos(ang) * r1;
        const y1 = cy + Math.sin(ang) * r1 * 0.75;
        const rgb = prog > 0.7 ? white : prog > 0.38 ? cyan : blue;
        const ch = Math.abs(Math.cos(ang)) > 0.7 ? "=" : "*";
        paintGridLine(g, x0, y0, x1, y1, ch, rgb, 0.28 + prog * 0.65, 0.95);
        g.put(x1, y1, "@", white, prog * 0.92, 1);
      }
      g.flush(ctx);
      return;
    }

    case "lunar_phase": {
      const g = createGridFrame(w, h, "#050811", "#101a30", "#070c18", hexToRgb("#93c5fd"), 0.065, theme);
      g.stars(t, hexToRgb("#dbeafe"), 40, 0.78);
      paintGridMoon(g, g.cols * 0.5, g.rows * 0.34, Math.min(g.cols, g.rows) * 0.22, hexToRgb("#f8fafc"), hexToRgb("#bae6fd"), hexToRgb("#38bdf8"));

      const earthR = g.rows * 1.45;
      const earthCy = g.rows * 2.18;
      paintGridCircleRing(g, g.cols * 0.5, earthCy, earthR, 1.2, hexToRgb("#38bdf8"), 0.78, "=", 1.65);
      paintGridCircleRing(g, g.cols * 0.5, earthCy + 1.5, earthR, 1.8, hexToRgb("#1d4ed8"), 0.65, ":", 1.65);
      g.flush(ctx);
      return;
    }

    case "black_hole": {
      const g = createGridFrame(w, h, "#050308", "#1f0d1a", "#0a0510", hexToRgb("#fb923c"), 0.065, theme);
      g.stars(t, hexToRgb("#fed7aa"), 38, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const R = Math.min(g.cols, g.rows) * 0.25;
      const orange = hexToRgb("#f97316");
      const gold = hexToRgb("#fef08a");

      g.glowTile(cx, cy, R * 1.7, orange, 0.55);
      paintGridCircleRing(g, cx, cy, R, 0.85, orange, 0.88, "@", 1.15);

      const rInt = Math.ceil(R);
      const voidRgb = hexToRgb("#07040a");
      for (let dy = -rInt; dy <= rInt; dy++) {
        for (let dx = -rInt; dx <= rInt; dx++) {
          if (Math.hypot(dx / 1.15, dy) <= R * 0.84) {
            g.put(cx + dx, cy + dy, "·", voidRgb, 0.96, 0.25);
          }
        }
      }

      paintGridCircleRing(g, cx, cy + 0.4, R * 0.98, 0.75, gold, 0.92, "=", 2.4);
      g.flush(ctx);
      return;
    }

    case "dyson_sphere": {
      const g = createGridFrame(w, h, "#060913", "#162036", "#090e1c", hexToRgb("#fbbf24"), 0.065, theme);
      g.stars(t, hexToRgb("#fef3c7"), 36, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const R = Math.min(g.cols, g.rows) * 0.34;
      const gold = hexToRgb("#fbbf24");
      const cyan = hexToRgb("#38bdf8");
      const steel = hexToRgb("#94a3b8");

      paintGridSun(g, cx, cy, R * 0.42, hexToRgb("#fef08a"), gold, hexToRgb("#ea580c"));
      g.glowTile(cx, cy, R * 0.85, gold, 0.58);

      paintGridCircleRing(g, cx, cy, R * 0.72, 0.55, steel, 0.78, "#", 1.45);
      paintGridCircleRing(g, cx, cy, R * 0.92, 0.55, gold, 0.75, "=", 0.85);
      paintGridCircleRing(g, cx, cy, R, 0.55, cyan, 0.7, "o", 1.2);

      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.4;
        const nx = cx + Math.cos(a) * R * 1.2;
        const ny = cy + Math.sin(a) * R;
        paintGridLine(g, cx, cy, nx, ny, ":", cyan, 0.52, 0.85);
        g.put(nx, ny, "@", hexToRgb("#fef08a"), 0.95, 1);
      }
      g.flush(ctx);
      return;
    }

    case "binary_sunset": {
      const g = createGridFrame(w, h, "#16080b", "#34151b", "#1c0b0e", hexToRgb("#fb7185"), 0.065, theme);
      g.stars(t, hexToRgb("#fecdd3"), 28, 0.55);
      const minDim = Math.min(g.cols, g.rows);
      paintGridSun(g, g.cols * 0.36, g.rows * 0.44, minDim * 0.22, hexToRgb("#fecdd3"), hexToRgb("#f43f5e"), hexToRgb("#e11d48"), true);
      paintGridSun(g, g.cols * 0.64, g.rows * 0.28, minDim * 0.14, hexToRgb("#fef08a"), hexToRgb("#f59e0b"), hexToRgb("#fb7185"));

      paintGridRidge(g, 0.68, 3.2, 2.4, hexToRgb("#4c0519"), hexToRgb("#fb7185"));
      paintGridRidge(g, 0.8, 2.4, 8.7, hexToRgb("#2e0210"), hexToRgb("#fda4af"));
      g.flush(ctx);
      return;
    }

    case "wormhole_gate": {
      const g = createGridFrame(w, h, "#040916", "#0e2142", "#071124", hexToRgb("#38bdf8"), 0.07, theme);
      g.stars(t, hexToRgb("#bae6fd"), 34, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const maxR = Math.min(g.cols, g.rows) * 0.42;
      const cyan = hexToRgb("#38bdf8");
      const violet = hexToRgb("#c084fc");

      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 0.25;
        paintGridLine(g, cx, cy, cx + Math.cos(a) * maxR * 1.35, cy + Math.sin(a) * maxR, ":", cyan, 0.42, 0.75);
      }

      for (let k = 0; k < 4; k++) {
        const phase = 1 - ((t * 0.45 + k * 0.25) % 1);
        const r = 1.5 + phase * maxR;
        const rgb = mixRgb(violet, cyan, phase);
        paintGridCircleRing(g, cx, cy, r, 0.6, rgb, (1 - phase * 0.45) * 0.82, "o", 1.35);
      }

      g.glowTile(cx, cy, 4.2, violet, 0.82);
      g.put(cx, cy, "@", hexToRgb("#ffffff"), 1, 1);
      g.flush(ctx);
      return;
    }

    case "orbital_station": {
      const g = createGridFrame(w, h, "#040813", "#0e203d", "#061020", hexToRgb("#38bdf8"), 0.065, theme);
      g.stars(t, hexToRgb("#dbeafe"), 36, 0.72);
      paintGridRidge(g, 0.82, 2.2, 4.5, hexToRgb("#0c4a6e"), hexToRgb("#38bdf8"));

      const cx = g.cols * 0.5;
      const cy = g.rows * 0.42;
      const R = Math.min(g.cols, g.rows) * 0.28;
      const hullRgb = hexToRgb("#cbd5e1");
      const cyan = hexToRgb("#38bdf8");

      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + t * 0.42;
        const rx = cx + Math.cos(a) * R * 1.35;
        const ry = cy + Math.sin(a) * R;
        paintGridLine(g, cx, cy, rx, ry, "=", hexToRgb("#64748b"), 0.78, 0.9);
        const blink = Math.sin(t * 4 + i * 1.5) > 0;
        g.put(rx, ry, "@", blink ? cyan : hexToRgb("#fbbf24"), 0.95, 1);
      }

      paintGridCircleRing(g, cx, cy, R, 0.65, hullRgb, 0.88, "#", 1.35);
      g.glowTile(cx, cy, 2.8, cyan, 0.72);
      g.put(cx, cy, "@", hexToRgb("#ffffff"), 0.98, 1);
      g.flush(ctx);
      return;
    }

    case "exoplanet_aurora":
    default: {
      const g = createGridFrame(w, h, "#050f16", "#102834", "#08161e", hexToRgb("#2dd4bf"), 0.065, theme);
      g.stars(t, hexToRgb("#ccfbf1"), 34, 0.65);

      const teal = hexToRgb("#2dd4bf");
      const emerald = hexToRgb("#10b981");
      const skyCyan = hexToRgb("#38bdf8");
      const maxAuroraY = Math.floor(g.rows * 0.64);
      for (let x = 1; x < g.cols - 1; x++) {
        const wave = Math.sin(x * 0.18 + t * 0.9) * 2.2 + Math.cos(x * 0.09 - t * 0.6) * 1.5;
        const baseR = Math.round(g.rows * 0.22 + wave);
        const curtainH = Math.round(4 + vnoise(x * 0.22, t * 0.5) * 5);
        for (let dy = 0; dy < curtainH; dy++) {
          const y = baseR + dy;
          if (y < 1 || y >= maxAuroraY) continue;
          const k = 1 - dy / curtainH;
          const rgb = dy < 2 ? skyCyan : mixRgb(emerald, teal, k);
          g.put(x, y, k > 0.6 ? "|" : ":", rgb, k * 0.58, k * 0.92);
        }
      }

      paintGridMoon(g, g.cols * 0.22, g.rows * 0.26, 2.6, hexToRgb("#ccfbf1"), teal, skyCyan);
      paintGridMoon(g, g.cols * 0.52, g.rows * 0.18, 3.8, hexToRgb("#f0fdfa"), teal, emerald);
      paintGridMoon(g, g.cols * 0.78, g.rows * 0.28, 2.2, hexToRgb("#bae6fd"), skyCyan, teal);

      paintGridRidge(g, 0.72, 3.6, 5.2, hexToRgb("#115e59"), teal);
      paintGridRidge(g, 0.82, 2.5, 11.4, hexToRgb("#042f2e"), emerald);
      g.flush(ctx);
      return;
    }
  }
}
