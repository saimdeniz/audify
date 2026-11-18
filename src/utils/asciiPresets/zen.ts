import {
  clamp01, createGridFrame, hash2, hexToRgb, mixRgb,
  paintGridBox, paintGridCircleRing, paintGridCloud, paintGridLine, paintGridMist, paintGridSun,
} from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

export function renderZenPreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, themeMode: theme } = params;
  switch (preset) {
    case "zen_rock_garden": {
      const g = createGridFrame(w, h, "#0b0e11", "#192026", "#0d1114", hexToRgb("#94a3b8"), 0.07, theme);
      const sandRgb = hexToRgb("#334155");
      const crestRgb = hexToRgb("#cbd5e1");
      const stoneDark = hexToRgb("#475569");
      const stoneLight = hexToRgb("#94a3b8");
      const mossRgb = hexToRgb("#10b981");
      for (let y = 2; y < g.rows - 2; y += 3) {
        for (let x = 2; x < g.cols - 2; x++) {
          const wave = Math.sin(x * 0.24 + t * 0.45 + y * 0.35);
          const ch = wave > 0.25 ? "~" : "-";
          g.put(x, y, ch, mixRgb(sandRgb, crestRgb, 0.28), 0.16, 0.45);
        }
      }
      const stones = [
        { cx: g.cols * 0.34, cy: g.rows * 0.48, rx: 4.2, ry: 2.8, rings: 4 },
        { cx: g.cols * 0.68, cy: g.rows * 0.56, rx: 3.2, ry: 2.2, rings: 3 },
      ];
      for (let s = 0; s < stones.length; s++) {
        const st = stones[s];
        const pulse = 0.28 * Math.sin(t * 0.9 + s * 1.7);
        for (let r = 1; r <= st.rings; r++) {
          paintGridCircleRing(g, st.cx, st.cy, st.ry + r * 2.2 + pulse, 0.52, crestRgb, 0.4 - r * 0.06, "~", 1.55);
        }
        const rxI = Math.ceil(st.rx);
        const ryI = Math.ceil(st.ry);
        for (let dy = -ryI; dy <= ryI; dy++) {
          for (let dx = -rxI; dx <= rxI; dx++) {
            const d = Math.hypot(dx / st.rx, dy / st.ry);
            if (d > 1) continue;
            const shade = clamp01(1 - d * 0.65 - dy * 0.15);
            const isMoss = dy <= 0 && d < 0.72 && (dx + dy) % 2 === 0;
            const rgb = isMoss ? mossRgb : mixRgb(stoneDark, stoneLight, shade);
            const ch = isMoss ? "@" : d < 0.45 ? "#" : d < 0.8 ? "o" : ":";
            g.put(st.cx + dx, st.cy + dy, ch, rgb, 0.88, 0.92);
          }
        }
      }
      g.flush(ctx);
      return;
    }
    case "zen_bonsai_moon": {
      const g = createGridFrame(w, h, "#0b0d17", "#1c2136", "#0d101b", hexToRgb("#f472b6"), 0.065, theme);
      g.stars(t, hexToRgb("#e2e8f0"), 34, 0.72);
      const cx = g.cols * 0.52;
      const cy = g.rows * 0.44;
      const moonR = Math.min(g.cols, g.rows) * 0.28;
      paintGridSun(g, cx, cy, moonR, hexToRgb("#fef3c7"), hexToRgb("#fde68a"), hexToRgb("#f59e0b"));
      const baseY = Math.round(g.rows * 0.82);
      paintGridBox(g, cx - 6, baseY, 12, 2, hexToRgb("#94a3b8"), hexToRgb("#334155"), 0.88, "=");
      const barkRgb = hexToRgb("#92400e");
      const sway = Math.sin(t * 1.1) * 0.6;
      const midX = cx - 2.5 + sway * 0.4;
      const midY = g.rows * 0.6;
      const topX = cx + 1 + sway;
      const topY = g.rows * 0.42;
      paintGridLine(g, cx - 1, baseY, midX, midY, "#", barkRgb, 0.9, 0.95);
      paintGridLine(g, cx, baseY, midX + 1, midY, "#", barkRgb, 0.85, 0.9);
      paintGridLine(g, midX, midY, topX, topY, "/", barkRgb, 0.88, 0.92);
      paintGridLine(g, midX, midY, cx - 5 + sway, midY - 2, "\\", barkRgb, 0.85, 0.9);
      paintGridLine(g, topX, topY + 1, cx + 5 + sway, topY + 2, "/", barkRgb, 0.85, 0.9);
      const leafBody = hexToRgb("#10b981");
      const sakuraRim = hexToRgb("#f472b6");
      paintGridCloud(g, cx - 5 + sway, midY - 2.5, 4.2, 2.0, leafBody, sakuraRim, 0.92);
      paintGridCloud(g, cx + 5 + sway, topY + 1.5, 4.0, 1.9, sakuraRim, hexToRgb("#fbcfe8"), 0.9);
      paintGridCloud(g, topX, topY - 1.2, 5.2, 2.2, leafBody, sakuraRim, 0.94);
      for (let i = 0; i < 10; i++) {
        const px = (hash2(i, 4.1) * g.cols + t * (1.2 + (i % 3) * 0.4)) % g.cols;
        const py = (hash2(i, 9.3) * g.rows * 0.75 + t * 0.7) % (g.rows * 0.85);
        g.put(px, py, i % 2 === 0 ? "*" : "·", sakuraRim, 0.55, 0.9);
      }
      g.flush(ctx);
      return;
    }
    case "zen_incense_smoke": {
      const g = createGridFrame(w, h, "#100d14", "#231c2b", "#120f17", hexToRgb("#c084fc"), 0.065, theme);
      paintGridMist(g, t, 0.28, 3, hexToRgb("#a855f7"), 0.2);
      const cx = Math.floor(g.cols * 0.5);
      const dishY = Math.round(g.rows * 0.82);
      const tipY = Math.round(g.rows * 0.68);

      const violet = hexToRgb("#c084fc");
      const rose = hexToRgb("#f472b6");
      for (let y = 1; y < tipY; y++) {
        const prog = (tipY - y) / Math.max(1, tipY);
        const amp = 0.6 + prog * 4.2;
        const phase = prog * 7.2 - t * 1.6;
        const x1 = cx + Math.sin(phase) * amp;
        const x2 = cx + Math.cos(phase * 0.95) * (amp * 0.88);
        const alpha = clamp01((1 - prog * 0.62) * 0.72);
        const ch1 = prog < 0.35 ? "o" : prog < 0.7 ? "~" : ":";
        const ch2 = prog < 0.35 ? "~" : prog < 0.7 ? ":" : "·";
        g.put(x1, y, ch1, violet, alpha, alpha * 1.2);
        g.put(x1 + (prog > 0.4 ? 1 : 0), y, "·", violet, alpha * 0.45, alpha * 0.8);
        g.put(x2, y, ch2, rose, alpha * 0.85, alpha * 1.15);
      }

      paintGridLine(g, cx, dishY, cx, tipY, "|", hexToRgb("#d97706"), 0.85, 0.9);
      g.glowTile(cx, tipY, 3.2, hexToRgb("#f97316"), 0.75);
      g.put(cx, tipY, "@", hexToRgb("#fef08a"), 0.98, 1);
      paintGridBox(g, cx - 4, dishY, 9, 2, hexToRgb("#d97706"), hexToRgb("#78350f"), 0.9, "=");
      g.flush(ctx);
      return;
    }

    case "zen_lotus_pond": {
      const g = createGridFrame(w, h, "#090f16", "#162534", "#0b131c", hexToRgb("#38bdf8"), 0.065, theme);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.56;
      const rippleRgb = hexToRgb("#38bdf8");
      for (let k = 0; k < 3; k++) {
        const r = 3.5 + ((t * 1.6 + k * 3.2) % 9.5);
        const fade = clamp01(1 - (r - 3.5) / 9.5);
        paintGridCircleRing(g, cx, cy, r, 0.55, rippleRgb, fade * 0.45, "~", 1.55);
      }

      const padDark = hexToRgb("#059669");
      const padRim = hexToRgb("#34d399");
      const pads = [
        { x: g.cols * 0.23, y: g.rows * 0.64, rx: 3.4, ry: 1.8 },
        { x: g.cols * 0.77, y: g.rows * 0.5, rx: 3.0, ry: 1.6 },
      ];
      for (const p of pads) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            if (dx > 0 && dy === 0) continue;
            const d = Math.hypot(dx / p.rx, dy / p.ry);
            if (d <= 1) {
              g.put(p.x + dx, p.y + dy, d > 0.7 ? "o" : "=", d > 0.7 ? padRim : padDark, 0.82, 0.9);
            }
          }
        }
      }

      const outerPink = hexToRgb("#ec4899");
      const midPink = hexToRgb("#f472b6");
      const innerWhite = hexToRgb("#fbcfe8");
      for (let dy = -3; dy <= 2; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const d = Math.hypot(dx * 0.75, dy * 1.15);
          if (d > 3.6) continue;
          const rgb = d > 2.4 ? outerPink : d > 1.3 ? midPink : innerWhite;
          const ch = dy < -1 && dx === 0 ? "^" : dx < -1 ? "/" : dx > 1 ? "\\" : "@";
          g.put(cx + dx, cy + dy, ch, rgb, 0.88, 0.95);
        }
      }
      g.glowTile(cx, cy, 3.6, hexToRgb("#fbbf24"), 0.65);
      g.put(cx, cy, "*", hexToRgb("#fef08a"), 0.98, 1);

      for (let i = 0; i < 8; i++) {
        const mx = (hash2(i, 2.3) * g.cols + Math.sin(t + i) * 2 + g.cols) % g.cols;
        const my = (hash2(i, 7.1) * g.rows - t * 0.6 + g.rows * 10) % g.rows;
        g.put(mx, my, "*", hexToRgb("#fde68a"), 0.5, 0.9);
      }
      g.flush(ctx);
      return;
    }

    case "zen_wind_chime": {
      const g = createGridFrame(w, h, "#07111b", "#14293d", "#091622", hexToRgb("#7dd3fc"), 0.065, theme);
      g.stars(t, hexToRgb("#bae6fd"), 26, 0.78);
      paintGridBox(g, 0, 0, g.cols, 2, hexToRgb("#92400e"), hexToRgb("#451a03"), 0.88, "=");

      const cx = g.cols * 0.5;
      const sway = Math.sin(t * 1.6);
      const bellX = cx + sway * 1.5;
      const bellY = g.rows * 0.36;

      for (let k = 0; k < 2; k++) {
        const r = 3.5 + ((t * 2.2 + k * 4) % 8);
        const a = clamp01(1 - (r - 3.5) / 8) * 0.42;
        paintGridCircleRing(g, bellX, bellY, r, 0.5, hexToRgb("#7dd3fc"), a, "o", 1.25);
      }

      paintGridLine(g, cx, 2, bellX, bellY - 2, "|", hexToRgb("#cbd5e1"), 0.7, 0.9);
      const glassRgb = hexToRgb("#38bdf8");
      const floralRgb = hexToRgb("#f472b6");
      for (let dy = -2; dy <= 1; dy++) {
        const halfW = dy === -2 ? 1 : dy === -1 ? 2 : 3;
        for (let dx = -halfW; dx <= halfW; dx++) {
          const isFloral = dy === 0 && Math.abs(dx) <= 1;
          g.put(bellX + dx, bellY + dy, isFloral ? "@" : "o", isFloral ? floralRgb : glassRgb, 0.85, 0.95);
        }
      }

      const slipTopX = bellX + sway * 1.2;
      const slipTopY = bellY + 3;
      const slipBotX = slipTopX + sway * 1.8;
      const slipBotY = Math.min(g.rows - 2, bellY + 8);
      paintGridLine(g, bellX, bellY + 1, slipTopX, slipTopY, "|", hexToRgb("#e2e8f0"), 0.75, 0.9);
      paintGridBox(g, slipBotX - 1, slipTopY, 3, Math.max(3, slipBotY - slipTopY), hexToRgb("#fef08a"), hexToRgb("#f59e0b"), 0.88, "*");
      g.flush(ctx);
      return;
    }

    case "zen_bamboo_shishi": {
      const g = createGridFrame(w, h, "#06110d", "#122920", "#081712", hexToRgb("#34d399"), 0.065, theme);
      paintGridMist(g, t, 0.35, 3, hexToRgb("#10b981"), 0.18);
      const bambooRgb = hexToRgb("#10b981");
      const bambooDark = hexToRgb("#047857");
      const waterRgb = hexToRgb("#38bdf8");

      const spoutEndX = Math.round(g.cols * 0.36);
      const spoutY = Math.round(g.rows * 0.24);
      paintGridBox(g, 2, spoutY, spoutEndX - 1, 2, bambooRgb, bambooDark, 0.88, "=");

      const pivotX = g.cols * 0.48;
      const pivotY = g.rows * 0.54;
      const tilt = Math.sin(t * 1.4) * 2.2;
      const leftX = pivotX - 6;
      const leftY = pivotY - 1.5 - tilt;
      const rightX = pivotX + 6;
      const rightY = pivotY + 1.5 + tilt;

      for (let y = spoutY + 2; y <= Math.round(leftY); y++) {
        const ch = (y + Math.floor(t * 8)) % 2 === 0 ? "|" : ":";
        g.put(spoutEndX, y, ch, waterRgb, 0.82, 0.95);
      }

      paintGridLine(g, pivotX, pivotY, pivotX, g.rows * 0.78, "|", hexToRgb("#92400e"), 0.88, 0.9);
      paintGridLine(g, leftX, leftY, rightX, rightY, "=", bambooRgb, 0.92, 0.96);
      paintGridLine(g, leftX, leftY + 1, rightX, rightY + 1, "#", bambooDark, 0.85, 0.9);

      const basinX = g.cols * 0.64;
      const basinY = g.rows * 0.78;
      if (tilt > 0.4) {
        paintGridLine(g, rightX, rightY + 1, basinX, basinY, ":", waterRgb, 0.78, 0.95);
      }
      for (let k = 0; k < 3; k++) {
        const r = 2 + ((t * 2.1 + k * 2.5) % 6.5);
        const fade = clamp01(1 - (r - 2) / 6.5);
        paintGridCircleRing(g, basinX, basinY, r, 0.5, waterRgb, fade * 0.55, "~", 1.5);
      }
      g.flush(ctx);
      return;
    }

    case "zen_pendulum_wave": {
      const g = createGridFrame(w, h, "#0b0e16", "#1a2133", "#0d111b", hexToRgb("#fbbf24"), 0.065, theme);
      const topY = 2;
      paintGridLine(g, Math.round(g.cols * 0.14), topY, Math.round(g.cols * 0.86), topY, "=", hexToRgb("#94a3b8"), 0.82, 0.95);
      const amber = hexToRgb("#fbbf24");
      const cyan = hexToRgb("#38bdf8");
      const wireRgb = hexToRgb("#64748b");
      const count = 9;
      for (let i = 0; i < count; i++) {
        const frac = i / (count - 1);
        const ax = g.cols * (0.18 + frac * 0.64);
        const freq = 1.35 + i * 0.11;
        const ang = Math.sin(t * freq) * 0.48;
        const len = g.rows * (0.42 + frac * 0.28);
        const bx = ax + Math.sin(ang) * len * 0.55;
        const by = topY + Math.cos(ang) * len * 0.78;
        paintGridLine(g, ax, topY + 1, bx, by, "|", wireRgb, 0.45, 0.75);
        const bobRgb = mixRgb(amber, cyan, frac);
        g.glowTile(bx, by, 2.5, bobRgb, 0.55);
        g.put(bx, by, "@", bobRgb, 0.96, 1);
      }
      g.flush(ctx);
      return;
    }

    case "zen_tourbillon": {
      const g = createGridFrame(w, h, "#110e0a", "#261f15", "#14100c", hexToRgb("#fbbf24"), 0.07, theme);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const R = Math.min(g.cols, g.rows) * 0.36;
      const bronze = hexToRgb("#d97706");
      const gold = hexToRgb("#fbbf24");
      const ruby = hexToRgb("#f43f5e");

      paintGridCircleRing(g, cx, cy, R, 0.7, bronze, 0.82, "#", 1.15);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * 0.25;
        g.put(cx + Math.cos(a) * (R + 1.2) * 1.15, cy + Math.sin(a) * (R + 1.2), "*", gold, 0.78, 0.95);
      }
      paintGridCircleRing(g, cx, cy, R * 0.65, 0.55, gold, 0.75, "o", 1.15);

      const cageAng = t * 0.95;
      const dx = Math.cos(cageAng) * R * 0.9 * 1.15;
      const dy = Math.sin(cageAng) * R * 0.9;
      paintGridLine(g, cx - dx, cy - dy, cx + dx, cy + dy, "=", gold, 0.88, 0.95);

      const pulseR = R * (0.28 + 0.08 * Math.sin(t * 4.2));
      paintGridCircleRing(g, cx, cy, pulseR, 0.5, hexToRgb("#fde68a"), 0.7, "@", 1.15);
      g.glowTile(cx, cy, 3.2, ruby, 0.75);
      g.put(cx, cy, "@", ruby, 0.98, 1);
      g.flush(ctx);
      return;
    }

    case "zen_hourglass": {
      const g = createGridFrame(w, h, "#120e09", "#281e13", "#14100a", hexToRgb("#fbbf24"), 0.065, theme);
      const cx = Math.floor(g.cols * 0.5);
      const midY = Math.floor(g.rows * 0.5);
      const halfH = Math.max(4, Math.floor(g.rows * 0.34));
      const maxW = Math.max(4, Math.floor(g.cols * 0.16));
      const woodRgb = hexToRgb("#b45309");
      const glassRgb = hexToRgb("#94a3b8");
      const sandRgb = hexToRgb("#fbbf24");

      paintGridBox(g, cx - maxW - 1, midY - halfH - 1, maxW * 2 + 3, 2, woodRgb, woodRgb, 0.9, "=");
      paintGridBox(g, cx - maxW - 1, midY + halfH, maxW * 2 + 3, 2, woodRgb, woodRgb, 0.9, "=");

      const cycle = (t * 0.15) % 1;
      for (let dy = -halfH + 1; dy <= halfH - 1; dy++) {
        const distY = Math.abs(dy) / halfH;
        const wBulb = Math.max(1, Math.round(distY * maxW));
        const y = midY + dy;
        g.put(cx - wBulb, y, dy < 0 ? "\\" : "/", glassRgb, 0.82, 0.95);
        g.put(cx + wBulb, y, dy < 0 ? "/" : "\\", glassRgb, 0.82, 0.95);

        const hasUpperSand = dy < 0 && distY > cycle * 0.85 && distY < 0.92;
        const hasLowerSand = dy > 0 && distY > 1 - (0.2 + cycle * 0.75);
        if (hasUpperSand || hasLowerSand) {
          for (let dx = -wBulb + 1; dx <= wBulb - 1; dx++) {
            g.put(cx + dx, y, (dx + y) % 2 === 0 ? "@" : ":", sandRgb, 0.85, 0.95);
          }
        }
      }

      g.glowTile(cx, midY, 2.8, sandRgb, 0.6);
      for (let y = midY; y < midY + halfH; y++) {
        const ch = (y + Math.floor(t * 10)) % 2 === 0 ? "|" : "*";
        g.put(cx, y, ch, hexToRgb("#fef08a"), 0.88, 1);
      }
      g.flush(ctx);
      return;
    }

    case "zen_orrery": {
      const g = createGridFrame(w, h, "#090d18", "#182138", "#0b101e", hexToRgb("#fbbf24"), 0.065, theme);
      g.stars(t, hexToRgb("#fef3c7"), 28, 0.95);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      paintGridSun(g, cx, cy, 2.6, hexToRgb("#fef08a"), hexToRgb("#f59e0b"), hexToRgb("#d97706"));
      g.glowTile(cx, cy, 4.5, hexToRgb("#fbbf24"), 0.55);

      const brassRing = hexToRgb("#b45309");
      const planets = [
        { rFrac: 0.18, speed: 1.3, hex: "#38bdf8", moon: false },
        { rFrac: 0.29, speed: 0.82, hex: "#f472b6", moon: true },
        { rFrac: 0.4, speed: 0.48, hex: "#34d399", moon: true },
      ];
      const minDim = Math.min(g.cols / 1.6, g.rows);
      for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        const r = minDim * p.rFrac;
        paintGridCircleRing(g, cx, cy, r, 0.45, brassRing, 0.48, "·", 1.6);
        const ang = t * p.speed + i * 2.1;
        const px = cx + Math.cos(ang) * r * 1.6;
        const py = cy + Math.sin(ang) * r;
        const pRgb = hexToRgb(p.hex);
        g.glowTile(px, py, 2.2, pRgb, 0.6);
        g.put(px, py, "@", pRgb, 0.96, 1);
        if (p.moon) {
          const mAng = t * 3.2 + i;
          g.put(px + Math.cos(mAng) * 2.2, py + Math.sin(mAng) * 1.5, "*", hexToRgb("#e2e8f0"), 0.85, 1);
        }
      }
      g.flush(ctx);
      return;
    }

    case "zen_metronome": {
      const g = createGridFrame(w, h, "#0c0f16", "#1d2333", "#0e121b", hexToRgb("#38bdf8"), 0.065, theme);
      const cx = Math.floor(g.cols * 0.5);
      const topY = Math.round(g.rows * 0.16);
      const botY = Math.round(g.rows * 0.85);
      const pivotY = Math.round(g.rows * 0.72);
      const woodFill = hexToRgb("#2c1810");
      const rimRgb = hexToRgb("#d97706");
      const brassRgb = hexToRgb("#fbbf24");

      for (let y = topY; y <= botY; y++) {
        const frac = (y - topY) / Math.max(1, botY - topY);
        const halfW = Math.round(2 + frac * 7);
        for (let dx = -halfW; dx <= halfW; dx++) {
          const isEdge = Math.abs(dx) === halfW || y === topY || y === botY;
          const isBase = y >= pivotY + 1 && !isEdge;
          const isScale = !isEdge && dx === 0 && y > topY + 1 && y < pivotY && y % 2 === 0;
          const ch = isEdge ? (dx < 0 ? "/" : dx > 0 ? "\\" : "=") : isScale ? "-" : isBase ? "=" : ":";
          const col = isEdge ? rimRgb : isScale ? brassRgb : woodFill;
          g.put(cx + dx, y, ch, col, isEdge ? 0.9 : isBase ? 0.75 : 0.42, isEdge || isScale ? 0.9 : 0.55);
        }
      }

      const swing = Math.sin(t * 3.2) * 0.58;
      const rodLen = pivotY - topY + 1;
      const tipX = cx + Math.sin(swing) * rodLen * 0.85;
      const tipY = pivotY - Math.cos(swing) * rodLen * 0.85;
      const weightX = cx + Math.sin(swing) * rodLen * 0.52;
      const weightY = pivotY - Math.cos(swing) * rodLen * 0.52;

      paintGridLine(g, cx, pivotY, tipX, tipY, "|", hexToRgb("#e2e8f0"), 0.88, 0.95);
      const cyan = hexToRgb("#38bdf8");
      const beatPulse = Math.abs(Math.cos(t * 3.2));
      if (beatPulse < 0.45) {
        paintGridCircleRing(g, tipX, tipY, 2.2 + (0.45 - beatPulse) * 4, 0.45, cyan, 0.45, "~", 1.2);
      }
      g.glowTile(weightX, weightY, 2.8, cyan, 0.75);
      g.put(weightX, weightY, "@", hexToRgb("#bae6fd"), 0.98, 1);
      g.flush(ctx);
      return;
    }

    case "zen_mandala":
    default: {
      const g = createGridFrame(w, h, "#100b18", "#251936", "#130d1d", hexToRgb("#f59e0b"), 0.07, theme);
      const cx = g.cols * 0.5;
      const cy = g.rows * 0.5;
      const minDim = Math.min(g.cols, g.rows);
      const gold = hexToRgb("#f59e0b");
      const magenta = hexToRgb("#ec4899");
      const violet = hexToRgb("#c084fc");

      g.glowTile(cx, cy, minDim * 0.34, magenta, 0.42);
      g.glowTile(cx, cy, minDim * 0.18, gold, 0.68);

      const ringColors = [gold, magenta, violet];
      for (let k = 0; k < 3; k++) {
        const breathe = 0.45 * Math.sin(t * 1.4 - k * 0.9);
        const r = minDim * (0.16 + k * 0.1) + breathe;
        paintGridCircleRing(g, cx, cy, r, 0.55, ringColors[k], 0.78, k % 2 === 0 ? "o" : "*", 1.2);
      }

      const outerR = minDim * 0.36;
      const midR = minDim * 0.24;
      for (let i = 0; i < 8; i++) {
        const a1 = (i / 8) * Math.PI * 2 + t * 0.35;
        const a2 = ((i + 0.5) / 8) * Math.PI * 2 + t * 0.35;
        const ox = cx + Math.cos(a1) * outerR * 1.2;
        const oy = cy + Math.sin(a1) * outerR;
        const mx = cx + Math.cos(a2) * midR * 1.2;
        const my = cy + Math.sin(a2) * midR;
        paintGridLine(g, cx, cy, ox, oy, ":", gold, 0.58, 0.85);
        paintGridLine(g, ox, oy, mx, my, "+", magenta, 0.72, 0.92);
        g.put(ox, oy, "@", hexToRgb("#fef08a"), 0.95, 1);
      }
      g.put(cx, cy, "@", hexToRgb("#fef08a"), 0.98, 1);
      g.flush(ctx);
      return;
    }
  }
}
