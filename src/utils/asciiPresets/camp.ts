import {
  clamp01,
  createGridFrame,
  hash2,
  hexToRgb,
  mixRgb,
  paintGridMist,
  paintGridPine,
  paintGridRidge,
  paintGridSun,
  vnoise,
} from "./blueprintGrid";
import { renderCampOutpostPreset } from "./campOutpost";
import { renderCampSanctuaryPreset } from "./campSanctuary";
import { AsciiRenderParams } from "./shared";

export function renderCampPreset(params: AsciiRenderParams): void {
  if (renderCampSanctuaryPreset(params)) return;

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
    case "aurora_cabin": {
      const g = createGridFrame(
        w,
        h,
        "#060b16",
        "#0b1829",
        "#08141c",
        { r: 100, g: 165, b: 220 },
        0.06,
        theme
      );
      g.stars(t, { r: 190, g: 220, b: 255 }, Math.round(g.cols * 0.7), 0.56);

      const teal = hexToRgb("#2dd4bf");
      const mint = mixRgb(teal, hexToRgb(accent), 0.35);
      const violet = { r: 167, g: 139, b: 250 };

      for (let x = 0; x < g.cols; x++) {
        const nx = x / g.cols;
        const baseRow =
          g.rows *
          (0.31 +
            0.08 * Math.sin(nx * 6.4 - t * 0.55) +
            0.04 * Math.cos(nx * 11 + t * 0.3));
        const curtainH = Math.round(
          g.rows * (0.16 + 0.09 * Math.sin(nx * 8.1 + t * 0.7))
        );
        const dens =
          0.45 +
          0.55 *
            Math.sin(nx * 9.5 + t * 0.4 + vnoise(nx * 5, t * 0.2) * 2);
        if (dens < 0.25) continue;

        for (let k = 0; k < curtainH; k++) {
          const p = k / curtainH;
          const y = Math.round(baseRow - k);
          const alpha = Math.pow(1 - p, 1.55) * dens * 0.85;
          if (alpha < 0.06) continue;
          const col = p < 0.5 ? mint : mixRgb(mint, violet, (p - 0.5) * 2);
          const ch = k === 0 ? "@" : p < 0.35 ? "#" : p < 0.68 ? "+" : ":";
          g.put(x, y, ch, col, alpha * 0.72, alpha * 0.95);
        }
      }

      paintGridRidge(
        g,
        0.76,
        g.rows * 0.22,
        3.2,
        { r: 14, g: 28, b: 42 },
        { r: 56, g: 189, b: 248 },
        6
      );
      paintGridRidge(
        g,
        0.85,
        g.rows * 0.08,
        9.7,
        { r: 8, g: 17, b: 25 },
        { r: 45, g: 212, b: 191 },
        5
      );

      const sw = Math.sin(t * 0.8) * 0.5;
      paintGridPine(
        g,
        Math.round(g.cols * 0.14),
        Math.round(g.rows * 0.88),
        Math.round(g.rows * 0.28),
        sw,
        { r: 12, g: 30, b: 36 },
        { r: 45, g: 212, b: 191 }
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.24),
        Math.round(g.rows * 0.9),
        Math.round(g.rows * 0.2),
        sw * 0.7,
        { r: 10, g: 25, b: 31 },
        { r: 34, g: 165, b: 158 }
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.86),
        Math.round(g.rows * 0.89),
        Math.round(g.rows * 0.3),
        -sw,
        { r: 12, g: 30, b: 36 },
        { r: 45, g: 212, b: 191 }
      );

      const cx = Math.round(g.cols * 0.62);
      const cy = Math.round(g.rows * 0.85);
      const timber = { r: 92, g: 64, b: 48 };
      const snowRim = { r: 186, g: 230, b: 253 };
      const winGlow = { r: 251, g: 191, b: 36 };
      const pulse = 0.82 + 0.18 * Math.sin(t * 2.1);

      g.glowTile(cx, cy - 2, 4.8, winGlow, 0.34 * pulse);

      for (let r = 0; r < 4; r++) {
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const isRim = Math.abs(dx) >= r;
          g.put(
            cx + dx,
            cy - 5 + r,
            isRim ? (dx < 0 ? "/" : "\\") : "=",
            isRim ? snowRim : timber,
            0.86,
            0.88
          );
        }
      }
      for (let r = 0; r < 3; r++) {
        for (let dx = -3; dx <= 3; dx++) {
          const isWin = r === 1 && (dx === -1 || dx === 0);
          const isDoor = r >= 1 && dx === 2;
          if (isWin) {
            g.put(
              cx + dx,
              cy - 2 + r,
              "@",
              { r: 254, g: 240, b: 138 },
              0.92 * pulse,
              1
            );
          } else if (isDoor) {
            g.put(
              cx + dx,
              cy - 2 + r,
              "|",
              { r: 160, g: 100, b: 60 },
              0.85,
              0.8
            );
          } else {
            g.put(cx + dx, cy - 2 + r, "#", timber, 0.85, 0.55);
          }
        }
      }

      const smokeCol = { r: 203, g: 213, b: 225 };
      for (let s = 0; s < 6; s++) {
        const p = (t * 0.38 + s / 6) % 1;
        const sy = Math.round(cy - 6 - p * 8);
        const sx = Math.round(
          cx + 2 + Math.sin(t * 1.6 + p * 5.2) * (0.4 + p * 1.4)
        );
        const a = (1 - p) * 0.65;
        g.put(sx, sy, p < 0.35 ? "o" : p < 0.7 ? "~" : ".", smokeCol, a * 0.5, a);
      }

      g.flush(ctx);
      break;
    }

    case "campfire_night": {
      const g = createGridFrame(
        w,
        h,
        "#08060c",
        "#140d0c",
        "#1c0e09",
        { r: 245, g: 158, b: 11 },
        0.045,
        theme
      );
      g.stars(t, { r: 226, g: 232, b: 240 }, Math.round(g.cols * 0.5), 0.5);

      paintGridPine(
        g,
        Math.round(g.cols * 0.11),
        Math.round(g.rows * 0.88),
        Math.round(g.rows * 0.42),
        0,
        { r: 18, g: 22, b: 26 },
        { r: 120, g: 95, b: 70 }
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.22),
        Math.round(g.rows * 0.9),
        Math.round(g.rows * 0.3),
        0,
        { r: 15, g: 18, b: 22 },
        { r: 95, g: 75, b: 60 }
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.88),
        Math.round(g.rows * 0.88),
        Math.round(g.rows * 0.44),
        0,
        { r: 18, g: 22, b: 26 },
        { r: 120, g: 95, b: 70 }
      );
      paintGridPine(
        g,
        Math.round(g.cols * 0.77),
        Math.round(g.rows * 0.9),
        Math.round(g.rows * 0.28),
        0,
        { r: 15, g: 18, b: 22 },
        { r: 95, g: 75, b: 60 }
      );

      paintGridRidge(
        g,
        0.86,
        g.rows * 0.05,
        5.2,
        { r: 22, g: 14, b: 10 },
        { r: 154, g: 52, b: 18 },
        4
      );

      const fx = Math.round(g.cols * 0.5);
      const fy = Math.round(g.rows * 0.8);
      const flick = 0.88 + 0.12 * Math.sin(t * 7.2);
      g.glowTile(fx, fy - 3, 9.5 * flick, { r: 249, g: 115, b: 22 }, 0.38);

      const woodRgb = { r: 145, g: 82, b: 48 };
      const stoneRgb = { r: 120, g: 113, b: 108 };
      for (let dx = -5; dx <= 5; dx++) {
        g.put(
          fx + dx,
          fy + 1,
          Math.abs(dx) > 3 ? "o" : "=",
          Math.abs(dx) > 3 ? stoneRgb : woodRgb,
          0.85,
          0.85
        );
        if (Math.abs(dx) <= 3) {
          g.put(
            fx + dx,
            fy,
            Math.abs(dx) === 3 ? "/" : "#",
            woodRgb,
            0.88,
            0.8
          );
        }
      }

      const flameH = Math.max(7, Math.round(g.rows * 0.3));
      for (let ry = 0; ry < flameH; ry++) {
        const rf = ry / (flameH - 1);
        const sway = Math.round(Math.sin(t * 5.2 + ry * 0.75) * rf * 1.4);
        const halfW =
          (1 - Math.pow(rf, 0.85)) * 4.2 + Math.sin(t * 6.8 - ry * 1.4) * 0.65;
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.abs(dx) / Math.max(0.4, halfW);
          if (dist > 1.05) continue;
          const heat = clamp01(
            (1 - rf * 0.72) * (1 - dist * 0.65) + 0.2 * Math.sin(t * 9 + dx + ry)
          );
          if (heat < 0.22) continue;
          const col =
            heat > 0.78
              ? { r: 254, g: 249, b: 195 }
              : heat > 0.56
                ? { r: 251, g: 146, b: 60 }
                : { r: 239, g: 68, b: 68 };
          const ch =
            heat > 0.78 ? "@" : heat > 0.58 ? "%" : heat > 0.4 ? "^" : "*";
          g.put(fx + dx + sway, fy - 1 - ry, ch, col, 0.72 + heat * 0.25, 0.96);
        }
      }

      const sparks = Math.round(g.cols * 0.35);
      for (let i = 0; i < sparks; i++) {
        const p = (t * (0.28 + hash2(i, 2) * 0.25) + hash2(i, 7)) % 1;
        const sy = Math.round(fy - 3 - p * g.rows * 0.55);
        const sx = Math.round(
          fx +
            (hash2(i, 14) - 0.5) * 9 +
            Math.sin(t * 2.5 + i * 1.8 + p * 6) * 2.2
        );
        const a = Math.pow(1 - p, 1.4) * 0.92;
        const sCol =
          p < 0.35 ? { r: 254, g: 240, b: 138 } : { r: 251, g: 146, b: 60 };
        g.put(sx, sy, p < 0.35 ? "*" : p < 0.7 ? "+" : ".", sCol, a * 0.45, a);
      }

      g.flush(ctx);
      break;
    }

    case "alpine_mist": {
      const g = createGridFrame(
        w,
        h,
        "#0e1726",
        "#23344d",
        "#182334",
        { r: 148, g: 163, b: 184 },
        0.055,
        theme
      );
      const sx = Math.round(g.cols * 0.74);
      const sy = Math.round(g.rows * 0.31);
      g.glowTile(sx, sy, 8.5, { r: 253, g: 164, b: 175 }, 0.26);
      paintGridSun(
        g,
        sx,
        sy,
        Math.max(2.4, g.rows * 0.11),
        { r: 254, g: 243, b: 199 },
        { r: 253, g: 186, b: 116 },
        { r: 253, g: 164, b: 175 }
      );

      paintGridRidge(
        g,
        0.49,
        g.rows * 0.24,
        1.5,
        { r: 34, g: 49, b: 70 },
        { r: 148, g: 163, b: 184 },
        6
      );
      paintGridMist(g, t, 0.54, 2.5, { r: 226, g: 232, b: 240 }, 0.42);
      paintGridRidge(
        g,
        0.65,
        g.rows * 0.2,
        6.2,
        { r: 22, g: 34, b: 50 },
        { r: 203, g: 213, b: 225 },
        5
      );
      paintGridMist(g, t * 1.25 + 4, 0.72, 3.0, { r: 241, g: 245, b: 249 }, 0.48);
      paintGridRidge(
        g,
        0.83,
        g.rows * 0.14,
        12.1,
        { r: 12, g: 21, b: 33 },
        mixRgb({ r: 100, g: 116, b: 139 }, hexToRgb(accent), 0.35),
        4
      );

      g.flush(ctx);
      break;
    }

    default:
      renderCampOutpostPreset(params);
      break;
  }
}
