import {
  createGridFrame,
  fbm1,
  hash2,
  hexToRgb,
  paintGridMist,
  paintGridMoon,
  paintGridPine,
  paintGridRidge,
} from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

export function renderCampSanctuaryPreset(params: AsciiRenderParams): boolean {
  const {
    ctx,
    width: w,
    height: h,
    timeSec: t,
    preset,
    accentHex: accent,
    themeMode: theme,
  } = params;

  switch (preset) {
    case "stargazer_tent": {
      const g = createGridFrame(
        w,
        h,
        "#050814",
        "#0c152c",
        "#080e1c",
        { r: 125, g: 155, b: 225 },
        0.055,
        theme
      );
      g.stars(t, { r: 226, g: 232, b: 240 }, Math.round(g.cols * 0.7), 0.65);

      const aRgb = hexToRgb(accent);
      const count = Math.round(g.cols * 1.4);
      for (let i = 0; i < count; i++) {
        const p = hash2(i, 41.2);
        const x = Math.round(p * (g.cols - 1));
        const y = Math.round(
          (0.58 - p * 0.52 + (hash2(i, 89.3) - 0.5) * 0.2) * g.rows
        );
        const tw = 0.28 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.2 + i));
        const col = i % 3 === 0 ? aRgb : { r: 199, g: 210, b: 254 };
        g.put(x, y, i % 4 === 0 ? "+" : ":", col, tw * 0.22, tw * 0.72);
      }

      const meteorP = (t * 0.22) % 1;
      if (meteorP < 0.24) {
        const mp = meteorP / 0.24;
        const mx = Math.round(g.cols * (0.18 + mp * 0.44));
        const my = Math.round(g.rows * (0.12 + mp * 0.2));
        g.put(mx, my, "*", { r: 254, g: 249, b: 195 }, (1 - mp) * 0.75, 1);
        g.put(
          mx - 1,
          my - 1,
          "\\",
          { r: 147, g: 197, b: 253 },
          (1 - mp) * 0.35,
          (1 - mp) * 0.8
        );
      }

      paintGridRidge(
        g,
        0.82,
        g.rows * 0.08,
        2.7,
        { r: 10, g: 17, b: 30 },
        { r: 71, g: 85, b: 105 },
        5
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.14),
        Math.round(g.rows * 0.86),
        Math.round(g.rows * 0.28),
        0,
        { r: 9, g: 16, b: 28 },
        { r: 100, g: 116, b: 139 }
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.86),
        Math.round(g.rows * 0.86),
        Math.round(g.rows * 0.3),
        0,
        { r: 9, g: 16, b: 28 },
        { r: 100, g: 116, b: 139 }
      );

      const tx = Math.round(g.cols * 0.52);
      const ty = Math.round(g.rows * 0.84);
      const th = Math.max(6, Math.round(g.rows * 0.26));
      const glow = 0.86 + 0.14 * Math.sin(t * 2.1);
      g.glowTile(
        tx,
        ty - Math.round(th * 0.35),
        7.5,
        { r: 251, g: 191, b: 36 },
        0.36 * glow
      );

      for (let r = 0; r < th; r++) {
        const frac = r / (th - 1);
        const halfW = Math.round(frac * th * 0.95);
        for (let dx = -halfW; dx <= halfW; dx++) {
          const isRim = Math.abs(dx) === halfW || r === 0;
          const isDoor = Math.abs(dx) <= Math.floor(halfW * 0.45) && r >= 2;
          if (isDoor) {
            g.put(
              tx + dx,
              ty - th + 1 + r,
              "@",
              { r: 254, g: 240, b: 138 },
              0.9 * glow,
              0.96
            );
          } else if (isRim) {
            g.put(
              tx + dx,
              ty - th + 1 + r,
              dx < 0 ? "/" : dx > 0 ? "\\" : "^",
              { r: 251, g: 191, b: 36 },
              0.82,
              0.9
            );
          } else {
            g.put(
              tx + dx,
              ty - th + 1 + r,
              "%",
              { r: 180, g: 95, b: 40 },
              0.78,
              0.65
            );
          }
        }
      }
      g.put(
        tx - Math.round(th * 1.1),
        ty - 1,
        "*",
        { r: 254, g: 240, b: 138 },
        0.92,
        1
      );

      g.flush(ctx);
      return true;
    }

    case "pine_breeze": {
      const g = createGridFrame(
        w,
        h,
        "#061314",
        "#0e2624",
        "#071415",
        { r: 94, g: 234, b: 212 },
        0.055,
        theme
      );
      g.stars(t, { r: 167, g: 243, b: 208 }, Math.round(g.cols * 0.35), 0.42);

      for (let y = 0; y < g.rows; y++) {
        for (let x = 0; x < g.cols; x++) {
          const beam = Math.sin((x - y * 0.55) * 0.32 - t * 0.25);
          if (beam > 0.72) {
            g.put(
              x,
              y,
              ":",
              { r: 153, g: 246, b: 228 },
              (beam - 0.72) * 0.36,
              0.22
            );
          }
        }
      }

      paintGridMist(g, t * 0.7, 0.74, 2.0, { r: 153, g: 246, b: 228 }, 0.26);
      paintGridRidge(
        g,
        0.9,
        g.rows * 0.05,
        3.1,
        { r: 8, g: 22, b: 20 },
        { r: 52, g: 211, b: 153 },
        4
      );

      const trees = [
        { x: 0.12, y: 0.9, h: 0.48, k: 0.8 },
        { x: 0.27, y: 0.89, h: 0.38, k: 1.0 },
        { x: 0.42, y: 0.91, h: 0.52, k: 0.65 },
        { x: 0.57, y: 0.89, h: 0.42, k: 1.1 },
        { x: 0.72, y: 0.92, h: 0.54, k: 0.75 },
        { x: 0.87, y: 0.9, h: 0.44, k: 0.95 },
      ];
      for (let i = 0; i < trees.length; i++) {
        const tr = trees[i];
        const sw = Math.sin(t * 1.1 * tr.k + tr.x * 7) * 0.55;
        paintGridPine(
          g,
          Math.round(g.cols * tr.x),
          Math.round(g.rows * tr.y),
          Math.round(g.rows * tr.h),
          sw,
          { r: 11, g: 36, b: 34 },
          { r: 110, g: 231, b: 183 }
        );
      }

      const motes = Math.round(g.cols * 0.5);
      const aRgb = hexToRgb(accent);
      for (let i = 0; i < motes; i++) {
        const p = (t * 0.16 + hash2(i, 4.1)) % 1;
        const x = Math.round(p * (g.cols - 1));
        const y = Math.round(
          (0.18 + hash2(i, 9.7) * 0.65) * g.rows + Math.sin(t * 1.9 + i) * 1.2
        );
        const a = Math.sin(p * Math.PI) * 0.82;
        g.put(
          x,
          y,
          i % 3 === 0 ? "+" : "·",
          i % 3 === 0 ? aRgb : { r: 217, g: 249, b: 157 },
          a * 0.35,
          a
        );
      }

      g.flush(ctx);
      return true;
    }

    case "lakeside_pier": {
      const g = createGridFrame(
        w,
        h,
        "#070c1a",
        "#111f36",
        "#07111e",
        { r: 125, g: 211, b: 252 },
        0.06,
        theme
      );
      g.stars(t, { r: 203, g: 213, b: 225 }, Math.round(g.cols * 0.55), 0.48);

      const mx = Math.round(g.cols * 0.5);
      const my = Math.round(g.rows * 0.24);
      paintGridMoon(
        g,
        mx,
        my,
        Math.max(3.5, g.rows * 0.14),
        { r: 254, g: 249, b: 195 },
        { r: 224, g: 242, b: 254 },
        { r: 125, g: 211, b: 252 }
      );

      const horY = Math.round(g.rows * 0.54);
      for (let x = 0; x < g.cols; x++) {
        const topY = Math.round(horY - fbm1(x * 0.11 + 4.3) * g.rows * 0.13);
        for (let y = topY; y < horY; y++) {
          g.put(
            x,
            y,
            y === topY ? "~" : ":",
            { r: 14, g: 26, b: 44 },
            0.8,
            0.42
          );
        }
      }

      for (let y = horY; y < g.rows; y++) {
        const depth = (y - horY) / Math.max(1, g.rows - horY);
        const halfSpan = Math.round(1 + depth * 5);
        const shift = Math.round(Math.sin(y * 0.5 - t * 2.2) * 1.1);
        for (let x = 0; x < g.cols; x++) {
          const dist = Math.abs(x - (mx + shift));
          if (dist <= halfSpan) {
            const fade = 1 - dist / (halfSpan + 1);
            const wave = 0.5 + 0.5 * Math.sin(y * 0.85 - t * 2.8 + x * 0.3);
            const a = (0.3 + fade * 0.5) * (0.55 + wave * 0.45);
            g.put(
              x,
              y,
              wave > 0.6 ? "=" : "~",
              { r: 186, g: 230, b: 253 },
              a * 0.48,
              a * 0.9
            );
          } else if ((x + y * 2) % 7 === 0) {
            g.put(x, y, "-", { r: 56, g: 189, b: 248 }, 0.08, 0.18);
          }
        }
      }

      const topRow = horY + 2;
      const pierWood = { r: 130, g: 96, b: 72 };
      const pierEdge = { r: 180, g: 145, b: 112 };
      for (let y = topRow; y < g.rows; y++) {
        const p = (y - topRow) / Math.max(1, g.rows - 1 - topRow);
        const halfW = Math.round(1.4 + p * (g.cols * 0.15));
        for (let dx = -halfW; dx <= halfW; dx++) {
          const isPost = Math.abs(dx) === halfW;
          const isPlank = y % 2 === 0;
          g.put(
            mx + dx,
            y,
            isPost ? "|" : isPlank ? "=" : "-",
            isPost ? pierEdge : pierWood,
            0.85,
            isPlank ? 0.72 : 0.45
          );
        }
      }

      const lx = mx + 2;
      const ly = topRow - 1;
      g.glowTile(lx, ly, 4.2, { r: 251, g: 191, b: 36 }, 0.38);
      g.put(lx, ly, "@", { r: 254, g: 240, b: 138 }, 0.95, 1);

      g.flush(ctx);
      return true;
    }

    case "forest_hammock": {
      const g = createGridFrame(
        w,
        h,
        "#06110e",
        "#0e221b",
        "#07140f",
        { r: 52, g: 211, b: 153 },
        0.055,
        theme
      );
      g.stars(t, { r: 187, g: 247, b: 208 }, Math.round(g.cols * 0.4), 0.45);

      const leftX = Math.round(g.cols * 0.14);
      const rightX = Math.round(g.cols * 0.86);
      const trunkCol = { r: 24, g: 46, b: 36 };
      for (let y = 0; y < g.rows; y++) {
        for (let dx = -2; dx <= 1; dx++) {
          g.put(leftX + dx, y, dx === 1 ? "|" : "#", trunkCol, 0.9, 0.65);
          g.put(rightX - dx, y, dx === 1 ? "|" : "#", trunkCol, 0.9, 0.65);
        }
      }

      const bulbs = 5;
      for (let i = 0; i < bulbs; i++) {
        const frac = (i + 1) / (bulbs + 1);
        const bx = Math.round(leftX + (rightX - leftX) * frac);
        const sag = Math.sin(frac * Math.PI) * g.rows * 0.11;
        const by = Math.round(g.rows * 0.22 + sag);
        g.glowTile(bx, by, 3.2, { r: 253, g: 224, b: 71 }, 0.34);
        g.put(bx, by, "*", { r: 254, g: 249, b: 195 }, 0.94, 1);
      }

      const rock = Math.sin(t * 1.1) * 0.85;
      for (let x = leftX + 2; x <= rightX - 2; x++) {
        const frac = (x - leftX - 2) / Math.max(1, rightX - leftX - 4);
        const y = Math.round(
          g.rows * 0.56 + Math.sin(frac * Math.PI) * (g.rows * 0.14 + rock)
        );
        g.put(
          x,
          y,
          frac < 0.18 ? "\\" : frac > 0.82 ? "/" : "=",
          { r: 167, g: 243, b: 208 },
          0.72,
          0.88
        );
        if (frac > 0.25 && frac < 0.75) {
          g.put(x, y - 1, "~", { r: 52, g: 211, b: 153 }, 0.35, 0.6);
        }
      }

      const aRgb = hexToRgb(accent);
      const flies = Math.round(g.cols * 0.28);
      for (let i = 0; i < flies; i++) {
        const fx = Math.round(
          g.cols * (0.22 + 0.56 * hash2(i, 12)) + Math.sin(t * 0.9 + i * 2) * 2.5
        );
        const fy = Math.round(
          g.rows * (0.34 + 0.48 * hash2(i, 31)) +
            Math.cos(t * 1.15 + i * 1.7) * 1.6
        );
        const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 3));
        const col = i % 3 === 0 ? aRgb : { r: 217, g: 249, b: 157 };
        g.glowTile(fx, fy, 2.2, col, 0.35 * pulse);
        g.put(fx, fy, "@", { r: 254, g: 249, b: 195 }, 0.9 * pulse, 1);
      }

      g.flush(ctx);
      return true;
    }

    default:
      return false;
  }
}
