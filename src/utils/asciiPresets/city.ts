import {
  clamp01,
  createGridFrame,
  hash2,
  hexToRgb,
  mixRgb,
  paintGridBox,
  paintGridCircleRing,
  paintGridLine,
  paintGridMist,
  paintGridMoon,
  paintGridSun,
} from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

export function renderCityPreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, accentHex, themeMode: theme } = params;
  const accent = hexToRgb(accentHex);

  if (preset === "neon_skyline") {
    const g = createGridFrame(w, h, "#060816", "#151b38", "#090c20", { r: 96, g: 165, b: 250 }, 0.065, theme);
    const bodyRgb = { r: 17, g: 24, b: 48 };
    const borderRgb = { r: 59, g: 130, b: 246 };
    const cyan = { r: 56, g: 189, b: 248 };
    const warm = { r: 253, g: 224, b: 71 };
    const rose = { r: 244, g: 114, b: 182 };

    g.stars(t, { r: 203, g: 213, b: 225 }, 30, 0.48);
    const horizon = Math.floor(g.rows * 0.64);
    const towers: [number, number, number][] = [
      [0.04, 0.12, 0.34], [0.17, 0.13, 0.46], [0.31, 0.14, 0.54],
      [0.46, 0.15, 0.48], [0.62, 0.12, 0.38], [0.75, 0.13, 0.5], [0.88, 0.1, 0.32],
    ];

    for (let i = 0; i < towers.length; i++) {
      const [xf, wf, hf] = towers[i];
      const bx = Math.floor(g.cols * xf);
      const bw = Math.max(4, Math.floor(g.cols * wf));
      const bh = Math.max(5, Math.floor(g.rows * hf));
      const by = horizon - bh;
      paintGridBox(g, bx, by, bw, bh, borderRgb, bodyRgb, 0.88, "#");

      for (let r = by + 1; r < horizon - 1; r += 2) {
        for (let c = bx + 1; c < bx + bw - 1; c += 2) {
          if (hash2(c + i * 7, r) > 0.32) {
            g.put(c, r, "@", (c + r + i) % 3 === 0 ? warm : cyan, 0.86, 0.96);
          }
        }
      }
      const topX = bx + Math.floor(bw * 0.5);
      g.glowTile(topX, by - 1, 2.0, rose, 0.3);
      g.put(topX, by - 1, "*", rose, 0.94, 0.98);
    }

    paintGridLine(g, 0, horizon, g.cols - 1, horizon, "=", cyan, 0.85, 0.94);
    for (let y = horizon + 1; y < g.rows; y++) {
      const depth = (y - horizon) / Math.max(1, g.rows - horizon);
      for (let x = 1; x < g.cols - 1; x++) {
        const wave = Math.sin(x * 0.45 + t * 2.4 + y * 0.9);
        if (wave > 0.15) {
          const refRgb = x % 3 === 0 ? rose : x % 2 === 0 ? cyan : warm;
          g.put(x, y, wave > 0.55 ? "=" : "~", refRgb, (1 - depth * 0.65) * 0.65, 0.88);
        }
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "night_express") {
    const g = createGridFrame(w, h, "#070a16", "#171e38", "#0a0e20", { r: 251, g: 191, b: 36 }, 0.065, theme);
    const steel = { r: 100, g: 116, b: 139 };
    const darkSteel = { r: 30, g: 41, b: 59 };
    const warmGold = { r: 254, g: 240, b: 138 };
    const amber = { r: 245, g: 158, b: 11 };

    g.stars(t, { r: 226, g: 232, b: 240 }, 32, 0.52);
    const deckY = Math.floor(g.rows * 0.6);
    paintGridLine(g, 0, deckY, g.cols - 1, deckY, "=", steel, 0.88, 0.94);
    paintGridLine(g, 0, deckY + 1, g.cols - 1, deckY + 1, "#", darkSteel, 0.82, 0.85);

    for (let x = 3; x < g.cols; x += 7) {
      paintGridBox(g, x, deckY + 2, 2, g.rows - deckY - 2, steel, darkSteel, 0.84, "|");
    }

    const trainLen = Math.max(12, Math.floor(g.cols * 0.36));
    const headX = Math.floor((t * 10) % (g.cols + trainLen)) - trainLen;
    for (let k = 0; k < trainLen; k++) {
      const cx = headX + k;
      if (cx < 0 || cx >= g.cols) continue;
      const isWindow = k % 2 === 1 && k < trainLen - 1;
      g.put(cx, deckY - 1, isWindow ? "@" : "#", isWindow ? warmGold : amber, 0.94, 0.98);
      if (isWindow && k % 4 === 1) {
        g.glowTile(cx, deckY - 1, 2.1, amber, 0.28);
      }
      const refY = deckY + 3 + (k % 3);
      if (refY < g.rows) {
        g.put(cx, refY, "=", warmGold, 0.45, 0.82);
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "tokyo_alley") {
    const g = createGridFrame(w, h, "#10070c", "#25101b", "#140910", { r: 251, g: 113, b: 133 }, 0.065, theme);
    const wallRgb = { r: 28, g: 14, b: 28 };
    const wallBorder = { r: 88, g: 28, b: 68 };
    const neonRose = { r: 244, g: 63, b: 94 };
    const neonCyan = { r: 34, g: 211, b: 238 };
    const lanternGold = { r: 251, g: 191, b: 36 };

    const wallW = Math.max(5, Math.floor(g.cols * 0.22));
    const groundY = Math.floor(g.rows * 0.76);
    paintGridBox(g, 0, 0, wallW, groundY, wallBorder, wallRgb, 0.9, "#");
    paintGridBox(g, g.cols - wallW, 0, wallW, groundY, wallBorder, wallRgb, 0.9, "#");
    paintGridBox(g, wallW + 1, 3, 3, Math.floor(groundY * 0.55), neonRose, wallRgb, 0.88, "@");
    paintGridBox(g, g.cols - wallW - 4, 4, 3, Math.floor(groundY * 0.5), neonCyan, wallRgb, 0.88, "#");

    const wireY = Math.floor(g.rows * 0.26);
    paintGridLine(g, wallW, wireY, g.cols - wallW - 1, wireY, "-", wallBorder, 0.65, 0.85);
    for (let i = 0; i < 4; i++) {
      const lx = Math.round(wallW + ((i + 0.5) / 4) * (g.cols - wallW * 2) + Math.sin(t * 1.8 + i) * 0.6);
      const ly = wireY + 2;
      g.glowTile(lx, ly, 2.5, neonRose, 0.42);
      g.put(lx, wireY + 1, "|", lanternGold, 0.75, 0.9);
      g.put(lx, ly, "@", lanternGold, 0.95, 0.98);
    }

    for (let y = groundY; y < g.rows; y++) {
      for (let x = 2; x < g.cols - 2; x++) {
        const shimmer = Math.sin(x * 0.5 + t * 2.2 + y);
        if (shimmer > 0.1) {
          g.put(x, y, shimmer > 0.55 ? "=" : ":", x < g.cols * 0.5 ? neonRose : neonCyan, 0.52, 0.85);
        }
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "rooftop_lounge") {
    const g = createGridFrame(w, h, "#060a15", "#141d33", "#090e1c", { r: 147, g: 197, b: 253 }, 0.065, theme);
    const slate = { r: 51, g: 65, b: 85 };
    const darkSlate = { r: 15, g: 23, b: 42 };
    const warm = { r: 253, g: 224, b: 71 };
    const redBeacon = { r: 244, g: 63, b: 94 };

    g.stars(t, { r: 219, g: 234, b: 254 }, 36, 0.55);
    paintGridMoon(
      g, g.cols * 0.78, g.rows * 0.24, Math.min(g.cols, g.rows) * 0.15,
      { r: 254, g: 249, b: 195 }, warm, { r: 147, g: 197, b: 253 }
    );

    const railY = g.rows - 3;
    for (let i = 0; i < 5; i++) {
      const bx = Math.floor(g.cols * (0.06 + i * 0.18));
      const bw = Math.max(5, Math.floor(g.cols * 0.14));
      const bh = Math.floor(g.rows * (0.28 + (i % 3) * 0.1));
      paintGridBox(g, bx, railY - bh, bw, bh, slate, darkSlate, 0.82, "#");
    }

    const spireX = Math.floor(g.cols * 0.24);
    const spireTop = Math.floor(g.rows * 0.2);
    paintGridLine(g, spireX, spireTop, spireX, railY - 4, "|", slate, 0.85, 0.9);
    const blink = 0.5 + 0.5 * Math.sin(t * 3.4);
    g.glowTile(spireX, spireTop, 2.4, redBeacon, 0.45 * blink);
    g.put(spireX, spireTop, "*", redBeacon, 0.95, 0.98);

    paintGridLine(g, 0, railY, g.cols - 1, railY, "=", slate, 0.9, 0.95);
    for (let x = 1; x < g.cols; x += 4) {
      g.put(x, railY + 1, "|", slate, 0.85, 0.9);
      g.put(x, railY - 1, "@", warm, 0.88, 0.96);
    }
    g.flush(ctx);
    return;
  }

  if (preset === "subway_transit") {
    const g = createGridFrame(w, h, "#060b12", "#111d2e", "#08101a", { r: 56, g: 189, b: 248 }, 0.065, theme);
    const emerald = { r: 16, g: 185, b: 129 };
    const cyan = { r: 56, g: 189, b: 248 };
    const amber = { r: 251, g: 191, b: 36 };
    const white = { r: 248, g: 250, b: 252 };

    const y1 = Math.floor(g.rows * 0.3);
    const y2 = Math.floor(g.rows * 0.52);
    const y3 = Math.floor(g.rows * 0.74);
    const midX = Math.floor(g.cols * 0.5);

    paintGridLine(g, 2, y1, g.cols - 3, y1, "=", emerald, 0.78, 0.92);
    paintGridLine(g, 2, y3, g.cols - 3, y3, "=", cyan, 0.78, 0.92);
    paintGridLine(g, 4, y3, midX, y1, "/", amber, 0.78, 0.92);
    paintGridLine(g, midX, y1, g.cols - 4, y2, "\\", amber, 0.78, 0.92);

    for (const sx of [0.22, 0.5, 0.78]) {
      const cx = Math.floor(g.cols * sx);
      g.put(cx, y1, "o", white, 0.94, 0.98);
      g.put(cx, y3, "o", white, 0.94, 0.98);
    }

    const p1 = 2 + ((t * 7) % Math.max(1, g.cols - 5));
    const p2 = g.cols - 3 - ((t * 6) % Math.max(1, g.cols - 5));
    g.glowTile(p1, y1, 2.2, emerald, 0.42);
    g.put(p1, y1, "@", white, 0.98, 1);
    g.glowTile(p2, y3, 2.2, cyan, 0.42);
    g.put(p2, y3, "@", white, 0.98, 1);
    g.flush(ctx);
    return;
  }

  if (preset === "radio_tower") {
    const g = createGridFrame(w, h, "#080712", "#1a1732", "#0c0b1c", { r: 244, g: 63, b: 94 }, 0.065, theme);
    const crimson = { r: 244, g: 63, b: 94 };
    const steel = { r: 203, g: 213, b: 225 };
    g.stars(t, { r: 226, g: 232, b: 240 }, 30, 0.65);

    const cx = Math.floor(g.cols * 0.5);
    const topY = Math.floor(g.rows * 0.24);
    const botY = g.rows - 2;

    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.65 + i / 3) % 1;
      paintGridCircleRing(g, cx, topY, 2 + phase * Math.min(g.cols, g.rows) * 0.36, 0.75, crimson, (1 - phase) * 0.72, "o");
    }

    for (let y = topY; y <= botY; y++) {
      const halfSpan = Math.floor(((y - topY) / Math.max(1, botY - topY)) * 5);
      const rgb = y % 3 === 0 ? steel : crimson;
      g.put(cx - halfSpan, y, "/", rgb, 0.88, 0.95);
      g.put(cx + halfSpan, y, "\\", rgb, 0.88, 0.95);
      if (halfSpan >= 1 && y % 2 === 0) {
        paintGridLine(g, cx - halfSpan + 1, y, cx + halfSpan - 1, y, "X", rgb, 0.68, 0.88);
      }
    }

    const pulse = 0.55 + 0.45 * Math.sin(t * 3.6);
    g.glowTile(cx, topY - 1, 3.0, crimson, 0.5 * pulse);
    g.put(cx, topY - 1, "@", { r: 255, g: 241, b: 242 }, 0.98, 1);
    g.flush(ctx);
    return;
  }

  if (preset === "suspension_bridge") {
    const g = createGridFrame(w, h, "#050b18", "#12203b", "#081122", { r: 251, g: 191, b: 36 }, 0.065, theme);
    const crimson = { r: 239, g: 68, b: 68 };
    const gold = { r: 251, g: 191, b: 36 };
    const cyan = { r: 56, g: 189, b: 248 };

    g.stars(t, { r: 219, g: 234, b: 254 }, 30, 0.45);
    const deckY = Math.floor(g.rows * 0.62);
    const t1 = Math.floor(g.cols * 0.26);
    const t2 = Math.floor(g.cols * 0.74);
    const topY = Math.floor(g.rows * 0.2);

    for (const tx of [t1, t2]) {
      paintGridLine(g, tx - 1, topY, tx - 1, g.rows - 2, "|", crimson, 0.9, 0.95);
      paintGridLine(g, tx + 1, topY, tx + 1, g.rows - 2, "|", crimson, 0.9, 0.95);
      paintGridLine(g, tx - 1, topY + 3, tx + 1, topY + 3, "=", crimson, 0.88, 0.95);
      paintGridLine(g, tx - 1, deckY - 3, tx + 1, deckY - 3, "=", crimson, 0.88, 0.95);
    }

    for (let x = 0; x < g.cols; x++) {
      const norm =
        x < t1
          ? (t1 - x) / Math.max(1, t1)
          : x > t2
            ? (x - t2) / Math.max(1, g.cols - 1 - t2)
            : (x - (t1 + t2) * 0.5) / Math.max(1, (t2 - t1) * 0.5);
      const cy = Math.max(topY, Math.min(deckY - 1, Math.round(deckY - 1 - (1 - norm * norm) * (deckY - topY - 2))));
      g.put(x, cy, "*", gold, 0.88, 0.95);
      if (x % 3 === 0 && cy < deckY - 1) {
        paintGridLine(g, x, cy + 1, x, deckY - 1, "|", crimson, 0.42, 0.72);
      }
      const car = (x + Math.floor(t * 7)) % 6 === 0;
      g.put(x, deckY, car ? "*" : "=", car ? gold : crimson, 0.92, 0.96);
    }

    for (let y = deckY + 2; y < g.rows; y++) {
      for (let x = 2; x < g.cols - 2; x += 2) {
        if (Math.sin(x * 0.4 + t * 2.2 + y) > 0.25) {
          g.put(x, y, "~", x % 4 === 0 ? gold : cyan, 0.48, 0.82);
        }
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "rainy_crosswalk") {
    const g = createGridFrame(w, h, "#060912", "#141b30", "#090d1a", { r: 34, g: 211, b: 238 }, 0.065, theme);
    const emerald = { r: 16, g: 185, b: 129 };
    const amber = { r: 251, g: 191, b: 36 };
    const rose = { r: 244, g: 63, b: 94 };
    const white = { r: 241, g: 245, b: 249 };

    const signals: [number, { r: number; g: number; b: number }][] = [
      [0.25, emerald], [0.5, amber], [0.75, rose],
    ];
    paintGridLine(g, 0, 2, g.cols - 1, 2, "-", { r: 71, g: 85, b: 105 }, 0.65, 0.85);
    for (const [xf, rgb] of signals) {
      const sx = Math.floor(g.cols * xf);
      g.glowTile(sx, 3, 2.8, rgb, 0.45);
      g.put(sx, 3, "@", rgb, 0.96, 0.98);
    }

    const crossY = Math.floor(g.rows * 0.66);
    for (let x = 2; x < g.cols - 2; x += 4) {
      paintGridBox(g, x, crossY, 2, 3, white, { r: 148, g: 163, b: 184 }, 0.85, "=");
    }

    for (let i = 0; i < 28; i++) {
      const rx = Math.floor(hash2(i, 4.1) * g.cols);
      const ry = Math.floor((hash2(i, 9.7) * g.rows + t * 11) % g.rows);
      g.put(rx, ry, "|", { r: 125, g: 211, b: 252 }, 0.42, 0.85);
    }

    for (let y = crossY + 3; y < g.rows; y++) {
      for (let x = 2; x < g.cols - 2; x++) {
        const rgb = x < g.cols * 0.38 ? emerald : x < g.cols * 0.62 ? amber : rose;
        if (Math.sin(x * 0.5 + t * 2.5 + y) > 0.2) {
          g.put(x, y, "=", rgb, 0.48, 0.82);
        }
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "clocktower_fog") {
    const g = createGridFrame(w, h, "#090b15", "#191d32", "#0c0e1a", { r: 148, g: 163, b: 184 }, 0.065, theme);
    const stone = { r: 71, g: 85, b: 105 };
    const darkStone = { r: 30, g: 41, b: 59 };
    const gold = { r: 253, g: 224, b: 71 };
    const amber = { r: 245, g: 158, b: 11 };

    g.stars(t, { r: 203, g: 213, b: 225 }, 26, 0.5);
    const cx = Math.floor(g.cols * 0.5);
    const tw = Math.max(8, Math.floor(g.cols * 0.22));
    const tx = cx - Math.floor(tw * 0.5);
    const bodyTop = Math.floor(g.rows * 0.28);

    paintGridBox(g, tx, bodyTop, tw, g.rows - bodyTop, stone, darkStone, 0.88, "#");
    for (let s = 1; s <= 5; s++) {
      const half = Math.max(0, Math.floor((6 - s) * 0.8));
      paintGridLine(g, cx - half, bodyTop - s, cx + half, bodyTop - s, "^", stone, 0.88, 0.94);
    }

    const clockY = bodyTop + Math.floor((g.rows - bodyTop) * 0.32);
    const clockR = Math.max(2.5, Math.min(tw * 0.34, 4.2));
    paintGridSun(g, cx, clockY, clockR, gold, amber, gold, false);
    const handAng = t * 0.8;
    paintGridLine(
      g, cx, clockY, cx + Math.cos(handAng) * (clockR - 0.5), clockY + Math.sin(handAng) * (clockR - 0.5),
      "+", darkStone, 0.95, 0.98
    );

    paintGridMist(g, t, 0.72, 3.5, { r: 148, g: 163, b: 184 }, 0.65);
    g.flush(ctx);
    return;
  }

  if (preset === "harbor_cranes") {
    const g = createGridFrame(w, h, "#050c16", "#112036", "#081220", { r: 251, g: 146, b: 60 }, 0.065, theme);
    const orange = { r: 249, g: 115, b: 22 };
    const darkSteel = { r: 30, g: 41, b: 59 };
    const cyan = { r: 56, g: 189, b: 248 };
    const amber = { r: 251, g: 191, b: 36 };

    const pierY = Math.floor(g.rows * 0.64);
    paintGridLine(g, 0, pierY, g.cols - 1, pierY, "=", orange, 0.85, 0.92);

    for (const cFrac of [0.2, 0.48, 0.76]) {
      const cx = Math.floor(g.cols * cFrac);
      const topY = Math.floor(g.rows * 0.24);
      paintGridLine(g, cx - 2, topY, cx - 2, pierY, "|", orange, 0.88, 0.94);
      paintGridLine(g, cx + 2, topY, cx + 2, pierY, "|", orange, 0.88, 0.94);
      paintGridLine(g, cx - 4, topY + 1, cx + 7, topY + 1, "=", orange, 0.9, 0.96);
      paintGridLine(g, cx, topY - 2, cx + 6, topY + 1, "\\", orange, 0.75, 0.9);
      const trolleyX = cx + 3 + Math.round(Math.sin(t * 1.4 + cFrac * 6) * 2);
      paintGridLine(g, trolleyX, topY + 2, trolleyX, pierY - 3, ":", amber, 0.75, 0.9);
      g.put(trolleyX, pierY - 3, "@", amber, 0.94, 0.98);
      g.put(cx, topY - 2, "*", { r: 244, g: 63, b: 94 }, 0.95, 0.98);
    }

    paintGridBox(g, 3, pierY - 3, 6, 3, amber, darkSteel, 0.85, "#");
    paintGridBox(g, Math.floor(g.cols * 0.33), pierY - 3, 6, 3, cyan, darkSteel, 0.85, "#");

    for (let y = pierY + 1; y < g.rows; y++) {
      for (let x = 1; x < g.cols - 1; x += 2) {
        if (Math.sin(x * 0.45 + t * 2 + y) > 0.2) {
          g.put(x, y, "~", x % 4 === 0 ? orange : cyan, 0.5, 0.85);
        }
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "highway_trails") {
    const g = createGridFrame(w, h, "#080710", "#1b162a", "#0c0a16", { r: 244, g: 63, b: 94 }, 0.065, theme);
    const gold = { r: 254, g: 240, b: 138 };
    const crimson = { r: 244, g: 63, b: 94 };
    const roadRgb = { r: 51, g: 65, b: 85 };

    for (let y = 2; y < g.rows - 1; y++) {
      const p = (y - 2) / Math.max(1, g.rows - 3);
      const center = g.cols * (0.64 - p * 0.28 + Math.sin(p * Math.PI * 1.6) * 0.14);
      const halfSpan = 1.5 + p * 5.5;
      paintGridLine(g, center - halfSpan, y, center + halfSpan, y, ":", roadRgb, 0.38, 0.55);

      const headPulse = clamp01(0.55 + 0.45 * Math.sin(y * 0.65 - t * 6.5));
      const tailPulse = clamp01(0.55 + 0.45 * Math.sin(y * 0.65 + t * 6.5));
      const lx = center - halfSpan * 0.55;
      const rx = center + halfSpan * 0.55;
      g.put(lx, y, headPulse > 0.7 ? "@" : "*", gold, 0.7 + headPulse * 0.28, 0.98);
      g.put(rx, y, tailPulse > 0.7 ? "@" : "#", crimson, 0.7 + tailPulse * 0.28, 0.98);
      if (y % 4 === 0) {
        g.glowTile(lx, y, 2.0, gold, 0.26 * headPulse);
        g.glowTile(rx, y, 2.0, crimson, 0.26 * tailPulse);
      }
    }
    g.flush(ctx);
    return;
  }

  // Default: "monorail_glide"
  const g = createGridFrame(w, h, "#050a16", "#121f38", "#081020", { r: 56, g: 189, b: 248 }, 0.065, theme);
  const towerFill = { r: 15, g: 23, b: 42 };
  const towerBorder = { r: 51, g: 65, b: 85 };
  const cyan = { r: 56, g: 189, b: 248 };
  const podAccent = mixRgb(accent, { r: 250, g: 204, b: 21 }, 0.45);

  g.stars(t, { r: 186, g: 230, b: 253 }, 28, 0.5);
  for (let i = 0; i < 5; i++) {
    const bx = Math.floor(g.cols * (0.05 + i * 0.19));
    const bw = Math.max(5, Math.floor(g.cols * 0.14));
    const bh = Math.floor(g.rows * (0.42 + (i % 3) * 0.12));
    paintGridBox(g, bx, g.rows - bh, bw, bh, towerBorder, towerFill, 0.82, "#");
  }

  const railA = Math.floor(g.rows * 0.42);
  const railB = Math.floor(g.rows * 0.64);
  for (const px of [0.22, 0.5, 0.78]) {
    paintGridLine(g, Math.floor(g.cols * px), railA, Math.floor(g.cols * px), g.rows - 1, "|", towerBorder, 0.82, 0.9);
  }
  paintGridLine(g, 0, railA, g.cols - 1, railA, "=", towerBorder, 0.9, 0.95);
  paintGridLine(g, 0, railB, g.cols - 1, railB, "=", towerBorder, 0.9, 0.95);

  const len = 9;
  const xA = Math.floor((t * 9) % (g.cols + len)) - len;
  const xB = g.cols - Math.floor((t * 7.5) % (g.cols + len));
  for (let k = 0; k < len; k++) {
    const c1 = xA + k;
    const c2 = xB + k;
    if (c1 >= 0 && c1 < g.cols) g.put(c1, railA - 1, k === len - 1 ? "@" : "#", cyan, 0.95, 0.98);
    if (c2 >= 0 && c2 < g.cols) g.put(c2, railB - 1, k === 0 ? "@" : "#", podAccent, 0.95, 0.98);
  }
  g.flush(ctx);
}
