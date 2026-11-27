import {
  clamp01,
  createGridFrame,
  mixRgb,
  Rgb,
} from "./blueprintGrid";
import {
  paintGridBox,
  paintGridCircleRing,
  paintGridCloud,
  paintGridLine,
  paintGridRidge,
  paintGridSun,
} from "./blueprintShapes";
import { renderRetroArcadePreset } from "./retroArcade";
import { AsciiRenderParams } from "./shared";

export function renderRetroPreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, themeMode: theme } = params;

  switch (preset) {
    case "retro_outrun_sun": {
      const g = createGridFrame(w, h, "#12041a", "#350b30", "#16051e", { r: 244, g: 114, b: 182 }, 0.065, theme);
      g.stars(t, { r: 251, g: 207, b: 232 }, 36, 0.52);
      const sunR = Math.max(4, Math.min(g.cols, g.rows) * 0.25);
      paintGridSun(
        g,
        Math.round(g.cols * 0.5),
        Math.round(g.rows * 0.37),
        sunR,
        { r: 254, g: 240, b: 138 },
        { r: 251, g: 146, b: 60 },
        { r: 244, g: 114, b: 182 },
        true
      );
      paintGridRidge(g, 0.58, g.rows * 0.14, 2.3, { r: 22, g: 6, b: 34 }, { r: 232, g: 121, b: 249 }, 5);
      const hRow = Math.floor(g.rows * 0.58);
      const magenta: Rgb = { r: 232, g: 121, b: 249 };
      const cyan: Rgb = { r: 56, g: 189, b: 248 };
      const floorBg: Rgb = { r: 18, g: 5, b: 30 };
      for (let r = hRow; r < g.rows; r++) {
        const dy = r - hRow;
        const span = Math.max(1, g.rows - hRow);
        const scroll = (Math.pow(dy / span, 0.72) * 6 - ((t * 1.4) % 1) + 6) % 1;
        const isHLine = dy === 0 || scroll < 0.22;
        for (let c = 0; c < g.cols; c++) {
          if (isHLine) {
            g.put(c, r, "=", dy === 0 ? magenta : mixRgb(magenta, cyan, dy / span), dy === 0 ? 0.92 : 0.65, 0.92);
          } else {
            g.put(c, r, ".", floorBg, 0.88, 0.25);
          }
        }
      }
      const cx = g.cols * 0.5;
      for (let i = -5; i <= 5; i++) {
        const bx = cx + i * (g.cols * 0.14);
        paintGridLine(g, cx + i * 1.2, hRow, bx, g.rows - 1, i < 0 ? "/" : i > 0 ? "\\" : "|", cyan, 0.62, 0.88);
      }
      g.flush(ctx);
      return;
    }

    case "retro_arcade_maze": {
      const g = createGridFrame(w, h, "#030614", "#0b1234", "#050818", { r: 59, g: 130, b: 246 }, 0.065, theme);
      const wallRgb: Rgb = { r: 37, g: 99, b: 235 };
      const wallFill: Rgb = { r: 15, g: 23, b: 62 };
      const midY = Math.floor(g.rows * 0.5);
      const midX = Math.floor(g.cols * 0.5);
      const boxW = Math.max(5, Math.floor(g.cols * 0.34));
      const boxH = Math.max(2, midY - 4);
      paintGridBox(g, 2, 1, boxW, boxH, wallRgb, wallFill, 0.72, "=");
      paintGridBox(g, g.cols - 2 - boxW, 1, boxW, boxH, wallRgb, wallFill, 0.72, "=");
      paintGridBox(g, 2, midY + 3, boxW, boxH, wallRgb, wallFill, 0.72, "=");
      paintGridBox(g, g.cols - 2 - boxW, midY + 3, boxW, boxH, wallRgb, wallFill, 0.72, "=");

      const pelletRgb: Rgb = { r: 254, g: 240, b: 138 };
      for (let c = 2; c < g.cols - 2; c += 2) g.put(c, midY, "·", pelletRgb, 0.42, 0.95);
      for (let r = 2; r < g.rows - 2; r += 2) g.put(midX, r, "·", pelletRgb, 0.42, 0.95);

      const span = Math.max(6, g.cols - 8);
      const pacX = 4 + Math.floor((t * 6.5) % span);
      const yellow: Rgb = { r: 250, g: 204, b: 21 };
      const redGhost: Rgb = { r: 244, g: 63, b: 94 };
      const cyanGhost: Rgb = { r: 34, g: 211, b: 238 };
      g.glowTile(pacX, midY, 2.8, yellow, 0.45);
      g.put(pacX, midY, "@", yellow, 0.95, 0.98);
      g.put(pacX - 1, midY, Math.floor(t * 8) % 2 === 0 ? "C" : "o", yellow, 0.85, 0.95);

      const g1X = 4 + ((pacX - 6 + span) % span);
      const g2X = 4 + ((pacX + 5) % span);
      g.glowTile(g1X, midY, 2.5, redGhost, 0.42);
      g.put(g1X, midY, "@", redGhost, 0.95, 0.98);
      g.put(g1X, midY + 1, "^", redGhost, 0.78, 0.92);
      g.glowTile(g2X, midY, 2.5, cyanGhost, 0.42);
      g.put(g2X, midY, "@", cyanGhost, 0.95, 0.98);
      g.put(g2X, midY + 1, "^", cyanGhost, 0.78, 0.92);
      g.flush(ctx);
      return;
    }

    case "retro_cassette": {
      const g = createGridFrame(w, h, "#100908", "#241510", "#130b09", { r: 251, g: 146, b: 60 }, 0.06, theme);
      const bw = Math.max(20, Math.round(g.cols * 0.68));
      const bh = Math.max(11, Math.round(g.rows * 0.66));
      const bx = Math.round((g.cols - bw) * 0.5);
      const by = Math.round((g.rows - bh) * 0.5);
      const shellBorder: Rgb = { r: 234, g: 88, b: 12 };
      paintGridBox(g, bx, by, bw, bh, shellBorder, { r: 43, g: 24, b: 16 }, 0.84, "#");

      const amber: Rgb = { r: 251, g: 146, b: 60 };
      const coral: Rgb = { r: 244, g: 63, b: 94 };
      for (let c = bx + 2; c < bx + bw - 2; c++) {
        g.put(c, by + 2, "=", amber, 0.82, 0.92);
        g.put(c, by + 3, "=", coral, 0.78, 0.9);
      }

      const sy = Math.round(by + bh * 0.52);
      const lx = Math.round(bx + bw * 0.31);
      const rx = Math.round(bx + bw * 0.69);
      const sr = Math.max(2.1, Math.min(bw * 0.12, bh * 0.22));
      paintGridBox(g, lx - 1, sy - 2, rx - lx + 3, 5, { r: 148, g: 163, b: 184 }, { r: 15, g: 23, b: 42 }, 0.85, "=");
      const hubRgb: Rgb = { r: 254, g: 240, b: 138 };
      for (const sx of [lx, rx]) {
        paintGridCircleRing(g, sx, sy, sr, 0.75, hubRgb, 0.9, "o");
        for (let k = 0; k < 3; k++) {
          const ang = t * 1.8 + (k * Math.PI * 2) / 3;
          paintGridLine(g, sx, sy, sx + Math.cos(ang) * sr, sy + Math.sin(ang) * sr, "*", amber, 0.88, 0.95);
        }
      }
      const trapW = Math.max(8, Math.round(bw * 0.46));
      paintGridBox(g, Math.round(g.cols * 0.5 - trapW * 0.5), by + bh - 3, trapW, 3, shellBorder, { r: 28, g: 16, b: 12 }, 0.9, "=");
      g.flush(ctx);
      return;
    }

    case "retro_crt_tv": {
      const g = createGridFrame(w, h, "#07090f", "#151a28", "#090c14", { r: 96, g: 165, b: 250 }, 0.06, theme);
      const bw = Math.max(20, Math.round(g.cols * 0.68));
      const bh = Math.max(11, Math.round(g.rows * 0.68));
      const bx = Math.round((g.cols - bw) * 0.5);
      const by = Math.round((g.rows - bh) * 0.55);
      const cabBorder: Rgb = { r: 100, g: 116, b: 139 };
      paintGridLine(g, g.cols * 0.5, by, g.cols * 0.36, Math.max(0, by - 4), "\\", cabBorder, 0.75, 0.9);
      paintGridLine(g, g.cols * 0.5, by, g.cols * 0.64, Math.max(0, by - 4), "/", cabBorder, 0.75, 0.9);
      paintGridBox(g, bx, by, bw, bh, cabBorder, { r: 30, g: 41, b: 59 }, 0.86, "#");

      const scrW = Math.max(10, Math.floor(bw * 0.72));
      const scrH = Math.max(6, bh - 4);
      const sx = bx + 2;
      const sy = by + 2;
      const smpte: Rgb[] = [
        { r: 248, g: 250, b: 252 },
        { r: 250, g: 204, b: 21 },
        { r: 34, g: 211, b: 238 },
        { r: 74, g: 222, b: 128 },
        { r: 244, g: 114, b: 182 },
        { r: 244, g: 63, b: 94 },
        { r: 59, g: 130, b: 246 },
      ];
      const scanRow = sy + (Math.floor(t * 5) % scrH);
      for (let r = 0; r < scrH; r++) {
        const isScan = sy + r === scanRow;
        for (let c = 0; c < scrW; c++) {
          const barIdx = Math.min(smpte.length - 1, Math.floor((c / scrW) * smpte.length));
          const isWave = r === Math.floor(scrH * 0.5) + Math.round(Math.sin(c * 0.45 - t * 3.2) * 1.4);
          const rgb = isWave ? { r: 255, g: 255, b: 255 } : smpte[barIdx];
          g.put(sx + c, sy + r, isWave ? "@" : isScan ? "=" : "#", rgb, isScan || isWave ? 0.94 : 0.74, 0.92);
        }
      }
      const dialX = bx + scrW + 4;
      if (dialX < bx + bw - 1) {
        g.put(dialX, sy + 1, "@", { r: 251, g: 191, b: 36 }, 0.9, 0.95);
        g.put(dialX, sy + 3, "o", { r: 148, g: 163, b: 184 }, 0.85, 0.95);
      }
      g.flush(ctx);
      return;
    }

    case "retro_gameboy": {
      const g = createGridFrame(w, h, "#0e180a", "#1f3316", "#12200d", { r: 163, g: 230, b: 53 }, 0.075, theme);
      const gbLight: Rgb = { r: 163, g: 230, b: 53 };
      const gbMid: Rgb = { r: 101, g: 163, b: 13 };
      const gbDark: Rgb = { r: 54, g: 83, b: 20 };

      for (let i = 0; i < 3; i++) {
        const cx = ((i * 0.36 + t * 0.04) % 1.2) * g.cols - g.cols * 0.1;
        paintGridCloud(g, cx, g.rows * (0.22 + (i % 2) * 0.12), 5.5, 2.3, gbLight, gbMid, 0.88);
      }
      paintGridRidge(g, 0.66, g.rows * 0.12, 1.4, gbDark, gbMid, 4);
      paintGridRidge(g, 0.78, g.rows * 0.08, 3.7, gbMid, gbLight, 3);

      const sx = Math.round(g.cols * 0.5);
      const sy = Math.round(g.rows * 0.44 - Math.abs(Math.sin(t * 3.2)) * 3.2);
      g.glowTile(sx, sy, 3.2, gbLight, 0.45);
      paintGridBox(g, sx - 2, sy - 2, 5, 5, gbLight, gbMid, 0.92, "@");
      g.put(sx, sy, "*", gbLight, 0.98, 1);
      g.flush(ctx);
      return;
    }

    case "retro_starfighter": {
      const g = createGridFrame(w, h, "#040512", "#0f1334", "#06081a", { r: 96, g: 165, b: 250 }, 0.065, theme);
      g.stars(t * 1.8, { r: 203, g: 213, b: 225 }, 44, 0.96);
      const sx = Math.round(g.cols * 0.26);
      const sy = Math.round(g.rows * (0.5 + Math.sin(t * 2.1) * 0.14));
      const hull: Rgb = { r: 226, g: 232, b: 240 };
      const wing: Rgb = { r: 56, g: 189, b: 248 };
      const flame: Rgb = { r: 251, g: 146, b: 60 };
      const laser: Rgb = { r: 250, g: 204, b: 21 };

      g.glowTile(sx - 4, sy - 1, 2.2, flame, 0.55);
      g.glowTile(sx - 4, sy + 1, 2.2, flame, 0.55);
      g.put(sx - 4, sy - 1, "*", flame, 0.95, 0.98);
      g.put(sx - 4, sy + 1, "*", flame, 0.95, 0.98);

      paintGridLine(g, sx - 2, sy - 3, sx + 1, sy - 1, "\\", wing, 0.88, 0.95);
      paintGridLine(g, sx - 2, sy + 3, sx + 1, sy + 1, "/", wing, 0.88, 0.95);
      paintGridLine(g, sx - 3, sy, sx + 4, sy, "#", hull, 0.95, 0.98);
      g.put(sx + 2, sy, "@", { r: 244, g: 63, b: 94 }, 0.95, 0.98);
      g.put(sx + 5, sy, ">", wing, 0.95, 0.98);

      for (let b = 0; b < 3; b++) {
        const bx = sx + 7 + ((Math.floor(t * 18) + b * 8) % Math.max(8, g.cols - sx - 10));
        g.put(bx, sy, "=", laser, 0.95, 0.98);
        g.put(bx + 1, sy, "*", laser, 0.95, 0.98);
      }
      const ax = Math.round(g.cols * 0.78);
      const ay = Math.round(g.rows * (0.5 + Math.cos(t * 1.9) * 0.18));
      const alienRgb: Rgb = { r: 244, g: 114, b: 182 };
      g.glowTile(ax, ay, 2.8, alienRgb, 0.4);
      paintGridBox(g, ax - 1, ay - 1, 3, 3, alienRgb, { r: 80, g: 7, b: 36 }, 0.9, "@");
      g.flush(ctx);
      return;
    }

    case "retro_lava_lamp": {
      const g = createGridFrame(w, h, "#140610", "#2e0d24", "#180814", { r: 244, g: 114, b: 182 }, 0.065, theme);
      const cx = g.cols * 0.5;
      const topY = Math.max(1, Math.round(g.rows * 0.1));
      const botY = Math.min(g.rows - 2, Math.round(g.rows * 0.82));
      const capW = Math.max(3, Math.round(g.cols * 0.08));
      const midW = Math.max(6, Math.round(g.cols * 0.18));
      const chrome: Rgb = { r: 148, g: 163, b: 184 };

      const blobs = [
        { x: cx + Math.sin(t * 1.1) * 1.8, y: g.rows * (0.48 + Math.sin(t * 0.85) * 0.22), r: 3.4 },
        { x: cx + Math.cos(t * 1.4) * 1.6, y: g.rows * (0.52 + Math.cos(t * 0.95 + 1.2) * 0.2), r: 3.1 },
        { x: cx + Math.sin(t * 0.9 + 2) * 1.2, y: g.rows * (0.36 + Math.sin(t * 1.25 + 2.4) * 0.16), r: 2.6 },
        { x: cx, y: botY - 1.5, r: 3.6 },
      ];
      const rose: Rgb = { r: 244, g: 63, b: 94 };
      const coral: Rgb = { r: 251, g: 146, b: 60 };
      const gold: Rgb = { r: 254, g: 240, b: 138 };

      for (let y = topY + 2; y < botY; y++) {
        const frac = (y - topY) / Math.max(1, botY - topY);
        const halfW = capW + (midW - capW) * Math.sin(frac * Math.PI * 0.88);
        for (let x = Math.ceil(cx - halfW); x <= Math.floor(cx + halfW); x++) {
          let field = 0;
          for (const b of blobs) {
            field += (b.r * b.r) / Math.max(0.35, (x - b.x) * (x - b.x) + (y - b.y) * (y - b.y));
          }
          if (field >= 1) {
            const k = clamp01((field - 1) * 0.55);
            const rgb = k > 0.55 ? mixRgb(coral, gold, (k - 0.55) * 2) : mixRgb(rose, coral, k * 1.8);
            g.put(x, y, k > 0.6 ? "@" : k > 0.28 ? "o" : "=", rgb, 0.78 + k * 0.2, 0.95);
          }
        }
      }
      paintGridLine(g, cx - capW, topY + 2, cx - midW, botY - 2, "/", chrome, 0.85, 0.95);
      paintGridLine(g, cx + capW, topY + 2, cx + midW, botY - 2, "\\", chrome, 0.85, 0.95);
      paintGridBox(g, cx - capW, topY, capW * 2 + 1, 2, chrome, chrome, 0.9, "#");
      paintGridBox(g, cx - midW + 1, botY, (midW - 1) * 2 + 1, 3, chrome, { r: 71, g: 85, b: 105 }, 0.9, "#");
      g.flush(ctx);
      return;
    }

    case "retro_pinball": {
      const g = createGridFrame(w, h, "#0a0518", "#1e0f3d", "#0d0720", { r: 192, g: 132, b: 252 }, 0.065, theme);
      const bumpers: [number, number, Rgb][] = [
        [g.cols * 0.34, g.rows * 0.32, { r: 244, g: 114, b: 182 }],
        [g.cols * 0.66, g.rows * 0.32, { r: 56, g: 189, b: 248 }],
        [g.cols * 0.5, g.rows * 0.52, { r: 250, g: 204, b: 21 }],
      ];
      for (const [bx, by, rgb] of bumpers) {
        g.glowTile(bx, by, 4.2, rgb, 0.42);
        paintGridCircleRing(g, bx, by, 2.5, 0.8, rgb, 0.9, "@");
      }

      const fy = Math.round(g.rows * 0.82);
      const flipRgb: Rgb = { r: 56, g: 189, b: 248 };
      paintGridLine(g, g.cols * 0.26, fy - 1, g.cols * 0.45, fy + Math.round(Math.sin(t * 4.5) * 1.4), "=", flipRgb, 0.92, 0.98);
      paintGridLine(g, g.cols * 0.74, fy - 1, g.cols * 0.55, fy + Math.round(Math.cos(t * 4.5) * 1.4), "=", flipRgb, 0.92, 0.98);

      const silver: Rgb = { r: 248, g: 250, b: 252 };
      for (let s = 5; s >= 0; s--) {
        const ts = t - s * 0.045;
        const px = g.cols * (0.5 + Math.sin(ts * 2.9) * 0.28);
        const py = g.rows * (0.48 + Math.cos(ts * 3.7) * 0.26);
        const fade = (6 - s) / 6;
        if (s === 0) g.glowTile(px, py, 2.6, silver, 0.55);
        g.put(px, py, s === 0 ? "@" : s < 3 ? "o" : "·", silver, fade * 0.92, fade);
      }
      g.flush(ctx);
      return;
    }

    case "retro_vapor_bust": {
      const g = createGridFrame(w, h, "#11081f", "#291542", "#150a26", { r: 103, g: 232, b: 249 }, 0.065, theme);
      paintGridSun(
        g,
        Math.round(g.cols * 0.5),
        Math.round(g.rows * 0.36),
        Math.max(4, Math.min(g.cols, g.rows) * 0.22),
        { r: 103, g: 232, b: 249 },
        { r: 244, g: 114, b: 182 },
        { r: 192, g: 132, b: 252 },
        true
      );

      const floorY = Math.floor(g.rows * 0.65);
      const pink: Rgb = { r: 232, g: 121, b: 249 };
      const teal: Rgb = { r: 34, g: 211, b: 238 };
      for (let r = floorY; r < g.rows; r++) {
        const v = Math.floor((r - floorY) * 0.6 + t * 2);
        for (let c = 0; c < g.cols; c++) {
          const u = Math.floor((c - g.cols * 0.5) / Math.max(2, 1 + (r - floorY) * 0.25));
          const odd = ((u + v) & 1) !== 0;
          g.put(c, r, odd ? "#" : "=", odd ? pink : teal, odd ? 0.72 : 0.45, 0.85);
        }
      }

      const marble: Rgb = { r: 233, g: 213, b: 255 };
      const shade: Rgb = { r: 168, g: 85, b: 247 };
      for (const fracX of [0.18, 0.82]) {
        const cx = Math.round(g.cols * fracX);
        const top = Math.round(g.rows * 0.16);
        paintGridBox(g, cx - 3, top, 7, 2, marble, shade, 0.92, "@");
        for (let y = top + 2; y < floorY; y++) {
          g.put(cx - 1, y, "|", marble, 0.88, 0.95);
          g.put(cx, y, "|", shade, 0.82, 0.9);
          g.put(cx + 1, y, "|", marble, 0.88, 0.95);
        }
        paintGridBox(g, cx - 3, floorY - 1, 7, 2, marble, shade, 0.92, "=");
      }
      g.flush(ctx);
      return;
    }

    case "retro_boombox": {
      const g = createGridFrame(w, h, "#0b0913", "#1e1832", "#0e0c18", { r: 56, g: 189, b: 248 }, 0.065, theme);
      const bw = Math.max(22, Math.round(g.cols * 0.76));
      const bh = Math.max(10, Math.round(g.rows * 0.56));
      const bx = Math.round((g.cols - bw) * 0.5);
      const by = Math.round((g.rows - bh) * 0.56);
      const chrome: Rgb = { r: 148, g: 163, b: 184 };

      const hw = Math.round(bw * 0.48);
      const hx = Math.round((g.cols - hw) * 0.5);
      paintGridLine(g, hx, by - 3, hx + hw, by - 3, "=", chrome, 0.9, 0.95);
      paintGridLine(g, hx, by - 3, hx, by, "|", chrome, 0.9, 0.95);
      paintGridLine(g, hx + hw, by - 3, hx + hw, by, "|", chrome, 0.9, 0.95);
      paintGridBox(g, bx, by, bw, bh, chrome, { r: 30, g: 24, b: 50 }, 0.86, "#");

      const wy = Math.round(by + bh * 0.54);
      const wr = Math.max(2.4, Math.min(bw * 0.14, bh * 0.34)) + Math.sin(t * 6) * 0.35;
      const cyan: Rgb = { r: 56, g: 189, b: 248 };
      for (const wx of [Math.round(bx + bw * 0.24), Math.round(bx + bw * 0.76)]) {
        g.glowTile(wx, wy, wr + 1.5, cyan, 0.38);
        paintGridCircleRing(g, wx, wy, wr, 0.8, cyan, 0.9, "o");
        g.put(wx, wy, "@", { r: 250, g: 204, b: 21 }, 0.95, 0.98);
      }

      const eqX0 = Math.round(g.cols * 0.5) - 4;
      const eqBase = by + bh - 3;
      for (let b = 0; b < 5; b++) {
        const barH = Math.max(1, Math.round((0.35 + 0.65 * Math.abs(Math.sin(t * 4.2 + b * 1.1))) * (bh - 5)));
        for (let d = 0; d < barH; d++) {
          const rgb: Rgb = d > barH * 0.65 ? { r: 244, g: 114, b: 182 } : { r: 74, g: 222, b: 128 };
          g.put(eqX0 + b * 2, eqBase - d, "=", rgb, 0.9, 0.95);
        }
      }
      g.flush(ctx);
      return;
    }

    case "retro_pong_court":
    default: {
      renderRetroArcadePreset(params);
    }
  }
}
