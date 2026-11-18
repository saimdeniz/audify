import {
  clamp01,
  createGridFrame,
  hash2,
  hexToRgb,
  mixRgb,
  paintGridBox,
  paintGridCircleRing,
  paintGridLine,
  paintGridRidge,
  paintGridSun,
} from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

export function renderCyberPreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, accentHex, themeMode: theme } = params;
  const accent = hexToRgb(accentHex);

  if (preset === "cyber_matrix") {
    const g = createGridFrame(w, h, "#020c06", "#062010", "#031209", { r: 34, g: 197, b: 94 }, 0.065, theme);
    const headRgb = { r: 220, g: 252, b: 231 };
    const midEmerald = { r: 34, g: 197, b: 94 };
    const deepEmerald = { r: 16, g: 110, b: 56 };
    const glyphs = ["@", "1", "0", "#", ":", "."];

    for (let x = 0; x < g.cols; x++) {
      if (hash2(x, 7.1) < 0.22) continue;
      const speed = 3.2 + hash2(x, 13.7) * 5.4;
      const trailLen = 6 + Math.floor(hash2(x, 29.3) * 6);
      const cycle = g.rows + trailLen + 4;
      const headY = Math.floor((t * speed + hash2(x, 41.9) * cycle) % cycle) - 2;

      if (x % 4 === 0 && headY >= 0 && headY < g.rows) {
        g.glowTile(x, headY, 2.1, midEmerald, 0.24);
      }

      for (let k = 0; k < trailLen; k++) {
        const y = headY - k;
        if (y < 0 || y >= g.rows) continue;
        if (k === 0) {
          g.put(x, y, glyphs[Math.floor(t * 6 + x) % 3], headRgb, 0.92, 0.98);
        } else {
          const fade = clamp01(1 - k / trailLen);
          const rgb = mixRgb(deepEmerald, midEmerald, fade);
          const ch =
            k < 3
              ? (x + y + Math.floor(t * 4)) % 2 === 0
                ? "1"
                : "0"
              : k < trailLen - 2
                ? "#"
                : k === trailLen - 2
                  ? ":"
                  : ".";
          g.put(x, y, ch, rgb, fade * 0.72, 0.25 + fade * 0.7);
        }
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_net_grid") {
    const g = createGridFrame(w, h, "#080415", "#1f0b36", "#0d0620", { r: 232, g: 121, b: 249 }, 0.065, theme);
    const cyan = { r: 34, g: 211, b: 238 };
    const magenta = { r: 244, g: 114, b: 182 };
    const violet = { r: 76, g: 29, b: 149 };

    g.stars(t, { r: 245, g: 208, b: 254 }, 30, 0.46);
    paintGridSun(
      g,
      g.cols * 0.5,
      g.rows * 0.36,
      Math.min(g.cols, g.rows) * 0.19,
      { r: 253, g: 224, b: 71 },
      magenta,
      { r: 192, g: 38, b: 211 },
      true
    );
    paintGridRidge(g, 0.54, 4.2, 2.3, violet, cyan, 4);

    const hY = Math.floor(g.rows * 0.58);
    paintGridLine(g, 0, hY, g.cols - 1, hY, "=", magenta, 0.88, 0.95);

    const cx = g.cols * 0.5;
    for (let i = -6; i <= 6; i++) {
      paintGridLine(g, cx + i * 1.4, hY, cx + i * (g.cols * 0.14), g.rows - 1, "/", cyan, 0.46, 0.76);
    }

    const scroll = (t * 2.6) % 1;
    for (let step = 1; step <= 6; step++) {
      const p = Math.pow((step - scroll * 0.85) / 6, 1.45);
      const ry = Math.round(hY + p * (g.rows - 1 - hY));
      if (ry > hY && ry < g.rows) {
        paintGridLine(g, 0, ry, g.cols - 1, ry, "=", mixRgb(magenta, cyan, p), clamp01(0.32 + p * 0.52), 0.85);
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_neural_core") {
    const g = createGridFrame(w, h, "#040b16", "#0d213d", "#061224", { r: 56, g: 189, b: 248 }, 0.065, theme);
    const axonRgb = { r: 14, g: 165, b: 233 };
    const nodeRgb = { r: 125, g: 211, b: 252 };
    const pulseRgb = mixRgb({ r: 250, g: 204, b: 21 }, accent, 0.35);

    const baseNodes: [number, number][] = [
      [0.2, 0.28], [0.38, 0.18], [0.64, 0.2], [0.82, 0.34],
      [0.5, 0.48], [0.24, 0.68], [0.54, 0.78], [0.78, 0.66],
    ];
    const nodes = baseNodes.map(([nx, ny], i) => ({
      x: g.cols * nx + Math.sin(t * 1.3 + i * 1.7) * 1.4,
      y: g.rows * ny + Math.cos(t * 1.1 + i * 2.1) * 1.1,
    }));

    const links: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [0, 4], [1, 4], [2, 4], [3, 4],
      [0, 5], [4, 5], [4, 6], [4, 7], [5, 6], [6, 7], [3, 7],
    ];

    for (let i = 0; i < links.length; i++) {
      const [aIdx, bIdx] = links[i];
      const na = nodes[aIdx];
      const nb = nodes[bIdx];
      paintGridLine(g, na.x, na.y, nb.x, nb.y, ":", axonRgb, 0.36, 0.68);
      const p = (t * (0.65 + (i % 4) * 0.18) + i * 0.23) % 1;
      g.put(na.x + (nb.x - na.x) * p, na.y + (nb.y - na.y) * p, i % 2 === 0 ? "*" : "@", pulseRgb, 0.9, 0.98);
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const pulse = 0.55 + 0.45 * Math.sin(t * 2.4 + i * 1.3);
      g.glowTile(n.x, n.y, 2.6 + pulse * 0.9, axonRgb, 0.32 * pulse);
      g.put(n.x, n.y, "@", nodeRgb, 0.92, 0.98);
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_terminal_hud") {
    const g = createGridFrame(w, h, "#040b09", "#0c211b", "#061310", { r: 45, g: 212, b: 191 }, 0.065, theme);
    const borderRgb = { r: 20, g: 184, b: 166 };
    const fillRgb = { r: 6, g: 48, b: 38 };
    const brightTeal = { r: 153, g: 246, b: 228 };
    const amber = { r: 251, g: 191, b: 36 };

    const leftW = Math.max(10, Math.floor(g.cols * 0.52));
    const topH = Math.max(6, Math.floor(g.rows * 0.58));
    paintGridBox(g, 1, 1, leftW, topH, borderRgb, fillRgb, 0.45, "#");
    paintGridBox(g, 1, topH + 2, leftW, Math.max(3, g.rows - topH - 3), borderRgb, fillRgb, 0.42, "=");

    const scroll = Math.floor(t * 3.5);
    for (let r = 3; r < topH - 1; r++) {
      const len = 3 + Math.floor(hash2(r + scroll, 9.2) * Math.max(2, leftW - 6));
      for (let c = 3; c < 3 + len && c < leftW - 1; c++) {
        const isHot = (c + r + scroll) % 7 === 0;
        g.put(c, r, isHot ? "=" : ":", isHot ? brightTeal : borderRgb, isHot ? 0.82 : 0.52, 0.9);
      }
    }

    const meterY = Math.min(g.rows - 2, topH + 3);
    const meterFill = Math.floor((leftW - 4) * (0.62 + 0.32 * Math.sin(t * 1.9)));
    for (let c = 3; c < leftW - 1; c++) {
      const active = c - 3 < meterFill;
      g.put(c, meterY, active ? "#" : ".", active ? amber : borderRgb, active ? 0.85 : 0.3, 0.92);
    }

    const rCx = g.cols * 0.76;
    const rCy = g.rows * 0.5;
    const rad = Math.min(g.cols * 0.2, g.rows * 0.34) * (0.92 + 0.08 * Math.sin(t * 2.6));
    paintGridCircleRing(g, rCx, rCy, rad, 0.85, brightTeal, 0.78, "o");
    paintGridCircleRing(g, rCx, rCy, rad * 0.52, 0.75, amber, 0.72, "+");
    paintGridLine(g, rCx - rad - 2, rCy, rCx + rad + 2, rCy, "-", borderRgb, 0.48, 0.8);
    paintGridLine(g, rCx, rCy - rad - 2, rCx, rCy + rad + 2, "|", borderRgb, 0.48, 0.8);
    g.put(rCx, rCy, "@", amber, 0.94, 0.98);
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_holo_globe") {
    const g = createGridFrame(w, h, "#040a16", "#0c1f3b", "#061122", { r: 56, g: 189, b: 248 }, 0.065, theme);
    const cyan = { r: 56, g: 189, b: 248 };
    const deepBlue = { r: 14, g: 116, b: 144 };
    const pingRgb = { r: 250, g: 204, b: 21 };

    g.stars(t, { r: 186, g: 230, b: 253 }, 32, 0.95);
    const cx = g.cols * 0.5;
    const cy = g.rows * 0.5;
    const rad = Math.min(g.cols, g.rows) * 0.35;

    g.glowTile(cx, cy, rad * 1.15, deepBlue, 0.24);
    for (const lat of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const ly = Math.round(cy + lat * rad);
      const halfSpan = Math.sqrt(Math.max(0, 1 - lat * lat)) * rad;
      paintGridLine(g, cx - halfSpan, ly, cx + halfSpan, ly, "=", deepBlue, 0.52, 0.82);
    }

    for (let i = 0; i < 3; i++) {
      const sx = Math.max(0.18, Math.abs(Math.cos(t * 0.75 + (i * Math.PI) / 3)));
      paintGridCircleRing(g, cx, cy, rad, 0.75, cyan, 0.58, ":", sx);
    }
    paintGridCircleRing(g, cx, cy, rad, 0.95, cyan, 0.88, "o", 1);

    const orbAng = t * 1.35;
    const ox = cx + Math.cos(orbAng) * (rad * 1.28);
    const oy = cy + Math.sin(orbAng) * (rad * 0.45);
    g.glowTile(ox, oy, 2.4, pingRgb, 0.45);
    g.put(ox, oy, "@", pingRgb, 0.95, 0.98);
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_dna_helix") {
    const g = createGridFrame(w, h, "#060816", "#131b3d", "#090d22", { r: 129, g: 140, b: 248 }, 0.065, theme);
    const strandA = { r: 56, g: 189, b: 248 };
    const strandB = { r: 217, g: 70, b: 239 };
    const rungRgb = { r: 99, g: 102, b: 241 };

    const cy = g.rows * 0.5;
    const amp = g.rows * 0.28;
    for (let x = 2; x < g.cols - 2; x++) {
      const phase = x * 0.24 + t * 2.1;
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      const y1 = cy + s * amp;
      const y2 = cy - s * amp;

      if (x % 3 === 0) {
        paintGridLine(g, x, y1, x, y2, Math.abs(s) > 0.45 ? "|" : ":", rungRgb, 0.48, 0.78);
      }
      if (x % 6 === 0) {
        g.glowTile(x, y1, 2.0, strandA, 0.26);
        g.glowTile(x, y2, 2.0, strandB, 0.26);
      }
      const front1 = c >= 0;
      g.put(x, y1, front1 ? "@" : "o", strandA, front1 ? 0.92 : 0.65, 0.96);
      g.put(x, y2, !front1 ? "@" : "o", strandB, !front1 ? 0.92 : 0.65, 0.96);
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_radar_sweep") {
    const g = createGridFrame(w, h, "#030d08", "#092317", "#05140d", { r: 16, g: 185, b: 129 }, 0.07, theme);
    const emerald = { r: 16, g: 185, b: 129 };
    const brightMint = { r: 167, g: 243, b: 208 };
    const blipRgb = { r: 250, g: 204, b: 21 };

    const cx = g.cols * 0.5;
    const cy = g.rows * 0.5;
    const maxR = Math.min(g.cols, g.rows) * 0.41;

    paintGridLine(g, cx - maxR - 2, cy, cx + maxR + 2, cy, "-", emerald, 0.38, 0.7);
    paintGridLine(g, cx, cy - maxR - 1, cx, cy + maxR + 1, "|", emerald, 0.38, 0.7);
    for (const frac of [0.35, 0.68, 1]) {
      paintGridCircleRing(g, cx, cy, maxR * frac, 0.78, emerald, 0.56, "o");
    }

    const ang = t * 1.4;
    for (let trail = 5; trail >= 0; trail--) {
      const a = ang - trail * 0.09;
      const fade = (6 - trail) / 6;
      paintGridLine(
        g, cx, cy, cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR,
        trail === 0 ? "*" : ":", trail === 0 ? brightMint : emerald, fade * 0.75, 0.92
      );
    }

    const blips: [number, number][] = [[0.45, 0.8], [-0.55, -0.45], [0.62, -0.52]];
    for (let i = 0; i < blips.length; i++) {
      const [bx, by] = blips[i];
      const tx = cx + bx * maxR;
      const ty = cy + by * maxR;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2 + i * 2.1);
      g.glowTile(tx, ty, 2.4, emerald, 0.38 * pulse);
      g.put(tx, ty, "@", blipRgb, 0.92, 0.98);
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_glitch_monolith") {
    const g = createGridFrame(w, h, "#080510", "#1c1030", "#0c081a", { r: 217, g: 70, b: 239 }, 0.065, theme);
    const magenta = { r: 232, g: 121, b: 249 };
    const cyan = { r: 34, g: 211, b: 238 };
    const slabFill = { r: 28, g: 14, b: 54 };

    for (let r = 2; r < g.rows - 2; r += 3) {
      const scanX = Math.floor((t * (6 + (r % 4) * 2) + r * 5) % g.cols);
      paintGridLine(g, 0, r, g.cols - 1, r, "-", slabFill, 0.35, 0.55);
      paintGridLine(g, scanX, r, Math.min(g.cols - 1, scanX + 7), r, "=", cyan, 0.72, 0.9);
    }

    const mw = Math.max(8, Math.floor(g.cols * 0.24));
    const mh = Math.max(8, Math.floor(g.rows * 0.62));
    const mx = Math.floor((g.cols - mw) * 0.5);
    const my = Math.floor((g.rows - mh) * 0.5 + Math.sin(t * 1.6) * 0.8);

    g.glowTile(g.cols * 0.5, g.rows * 0.5, Math.max(mw, mh) * 0.68, magenta, 0.3);
    paintGridBox(g, mx, my, mw, mh, magenta, { r: 16, g: 8, b: 32 }, 0.92, "#");
    for (let r = my + 1; r < my + mh - 1; r++) {
      for (let c = mx + 2; c < mx + mw - 2; c += 2) {
        if ((r + c + Math.floor(t * 3)) % 5 === 0) {
          g.put(c, r, (r + c) % 2 === 0 ? "|" : ":", magenta, 0.35, 0.78);
        }
      }
    }

    const shift = Math.sin(t * 4.5) > 0.35 ? 1 : -1;
    for (const gr of [my + Math.floor(mh * 0.34), my + Math.floor(mh * 0.66)]) {
      paintGridLine(g, mx + shift, gr, mx + mw - 1 + shift, gr, "@", cyan, 0.9, 0.98);
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_drone_relay") {
    const g = createGridFrame(w, h, "#050912", "#101d34", "#07101e", { r: 56, g: 189, b: 248 }, 0.065, theme);
    const towerBorder = { r: 51, g: 65, b: 85 };
    const towerFill = { r: 15, g: 23, b: 42 };
    const cyan = { r: 56, g: 189, b: 248 };
    const amber = { r: 251, g: 191, b: 36 };

    g.stars(t, { r: 148, g: 163, b: 184 }, 26, 0.55);
    const specs: [number, number, number][] = [
      [0.08, 0.16, 0.56], [0.3, 0.15, 0.68], [0.54, 0.17, 0.6], [0.78, 0.15, 0.72],
    ];
    for (let i = 0; i < specs.length; i++) {
      const [xf, wf, hf] = specs[i];
      const bx = Math.floor(g.cols * xf);
      const bw = Math.max(5, Math.floor(g.cols * wf));
      const bh = Math.max(6, Math.floor(g.rows * hf));
      const by = g.rows - bh;
      paintGridBox(g, bx, by, bw, bh, towerBorder, towerFill, 0.86, "#");
      const antX = bx + Math.floor(bw * 0.5);
      paintGridLine(g, antX, Math.max(1, by - 3), antX, by - 1, "|", towerBorder, 0.78, 0.9);
      g.put(antX, Math.max(1, by - 3), "*", i % 2 === 0 ? cyan : amber, 0.92, 0.98);
    }

    for (let d = 0; d < 4; d++) {
      const dir = d % 2 === 0 ? 1 : -1;
      const rawX = (t * (5.5 + d * 1.4) + d * 11) % (g.cols + 8);
      const dx = dir > 0 ? Math.floor(rawX) - 4 : g.cols + 3 - Math.floor(rawX);
      const dy = Math.round(g.rows * (0.2 + d * 0.14) + Math.sin(t * 2 + d) * 1.2);
      const rgb = d % 2 === 0 ? cyan : amber;
      g.glowTile(dx, dy, 2.2, rgb, 0.34);
      g.put(dx, dy, "@", rgb, 0.95, 0.98);
      for (let tail = 1; tail <= 5; tail++) {
        g.put(dx - dir * tail, dy, "-", rgb, (6 - tail) * 0.13, 0.85);
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_firewall") {
    const g = createGridFrame(w, h, "#100509", "#240c16", "#14060c", { r: 244, g: 63, b: 94 }, 0.065, theme);
    const crimson = { r: 225, g: 29, b: 72 };
    const hotAmber = { r: 251, g: 191, b: 36 };
    const shieldCyan = { r: 56, g: 189, b: 248 };
    const pulseX = g.cols * (0.5 + 0.38 * Math.sin(t * 0.85));
    const pulseY = g.rows * 0.5;
    const waveR = (t * 7.5) % (g.cols * 0.85);

    for (let r = 1; r < g.rows - 1; r += 3) {
      const off = ((r - 1) / 3) % 2 === 0 ? 0 : 3;
      for (let c = 2 + off; c < g.cols - 3; c += 6) {
        const dWave = clamp01(1 - Math.abs(Math.hypot(c - pulseX, (r - pulseY) * 1.4) - waveR) / 4.2);
        const rgb = dWave > 0.5 ? mixRgb(hotAmber, shieldCyan, (dWave - 0.5) * 1.8) : mixRgb(crimson, hotAmber, dWave);
        const fa = 0.28 + dWave * 0.62;
        if (dWave > 0.6) g.glowTile(c, r, 2.2, rgb, dWave * 0.32);
        g.put(c, r, dWave > 0.55 ? "@" : "+", rgb, fa, 0.92);
        g.put(c - 1, r + 1, "/", rgb, fa * 0.72, 0.78);
        g.put(c + 1, r + 1, "\\", rgb, fa * 0.72, 0.78);
        g.put(c, r + 2, "-", rgb, fa * 0.65, 0.75);
      }
    }
    g.flush(ctx);
    return;
  }

  if (preset === "cyber_satellite_link") {
    const g = createGridFrame(w, h, "#040a12", "#0f1f34", "#07111e", { r: 56, g: 189, b: 248 }, 0.065, theme);
    const slate = { r: 100, g: 116, b: 139 };
    const cyan = { r: 56, g: 189, b: 248 };
    const gold = { r: 250, g: 204, b: 21 };

    g.stars(t, { r: 186, g: 230, b: 253 }, 34, 0.72);
    paintGridRidge(g, 0.78, 3.2, 4.1, { r: 15, g: 23, b: 42 }, slate, 5);

    const dishX = Math.floor(g.cols * 0.22);
    const dishY = Math.floor(g.rows * 0.68);
    paintGridBox(g, dishX - 2, dishY + 1, 5, 4, slate, { r: 30, g: 41, b: 59 }, 0.85, "#");
    paintGridLine(g, dishX - 3, dishY - 1, dishX, dishY + 1, "\\", slate, 0.88, 0.95);
    paintGridLine(g, dishX, dishY + 1, dishX + 3, dishY - 2, "/", slate, 0.88, 0.95);
    g.put(dishX + 1, dishY - 1, "o", cyan, 0.92, 0.98);

    const satX = Math.round(g.cols * 0.78 + Math.sin(t * 0.9) * 1.5);
    const satY = Math.round(g.rows * 0.22 + Math.cos(t * 1.1) * 0.8);
    paintGridLine(g, dishX + 1, dishY - 1, satX, satY, ":", cyan, 0.35, 0.7);

    for (let p = 0; p < 4; p++) {
      const frac = (t * 0.85 + p * 0.25) % 1;
      g.put(dishX + 1 + (satX - (dishX + 1)) * frac, dishY - 1 + (satY - (dishY - 1)) * frac, "*", gold, 0.92, 0.98);
    }

    g.glowTile(satX, satY, 2.8, cyan, 0.38);
    paintGridLine(g, satX - 3, satY, satX + 3, satY, "=", slate, 0.85, 0.92);
    g.put(satX, satY, "@", gold, 0.96, 0.98);
    g.flush(ctx);
    return;
  }

  // Default: "cyber_code_stream"
  const g = createGridFrame(w, h, "#040c11", "#0b222c", "#06131a", { r: 34, g: 211, b: 238 }, 0.065, theme);
  const busRgb = { r: 14, g: 116, b: 144 };
  const packetCyan = { r: 103, g: 232, b: 249 };
  const packetAccent = mixRgb(accent, { r: 250, g: 204, b: 21 }, 0.4);

  for (const jFrac of [0.28, 0.5, 0.72]) {
    const jx = Math.floor(g.cols * jFrac);
    paintGridLine(g, jx, 1, jx, g.rows - 2, "|", busRgb, 0.32, 0.62);
  }

  for (let lane = 0; lane < 6; lane++) {
    const ly = Math.round(((lane + 1) / 7) * (g.rows - 1));
    paintGridLine(g, 0, ly, g.cols - 1, ly, "-", busRgb, 0.38, 0.68);
    const dir = lane % 2 === 0 ? 1 : -1;
    const head = Math.floor((t * (6 + (lane % 3) * 2.2) + lane * 9) % g.cols);
    const rgb = lane % 2 === 0 ? packetCyan : packetAccent;

    for (let k = 0; k < 6; k++) {
      const cx = (head - dir * k + g.cols * 2) % g.cols;
      g.put(cx, ly, k === 0 ? "@" : k < 3 ? "#" : "=", rgb, ((6 - k) / 6) * 0.9, 0.96);
    }
    for (const jFrac of [0.28, 0.5, 0.72]) {
      g.put(Math.floor(g.cols * jFrac), ly, "+", packetCyan, 0.78, 0.92);
    }
  }
  g.flush(ctx);
}
