import {
  createGridFrame,
  fbm1,
  hash2,
  hexToRgb,
  mixRgb,
  paintGridMist,
  paintGridMoon,
  paintGridRidge,
} from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

export function renderCampOutpostPreset(params: AsciiRenderParams): void {
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
    case "watchtower_ridge": {
      const g = createGridFrame(
        w,
        h,
        "#070b14",
        "#111a2b",
        "#0a1019",
        { r: 148, g: 163, b: 184 },
        0.055,
        theme
      );
      g.stars(t, { r: 180, g: 200, b: 225 }, Math.round(g.cols * 0.55), 0.55);

      const flashPhase = (t * 0.18) % 1;
      const storm =
        flashPhase > 0.84 && flashPhase < 0.92
          ? Math.sin(((flashPhase - 0.84) / 0.08) * Math.PI)
          : 0;
      const cloudRgb = mixRgb(
        { r: 100, g: 116, b: 139 },
        hexToRgb(accent),
        storm * 0.85
      );
      paintGridMist(g, t * 0.45, 0.34, 2.2, cloudRgb, 0.36 + storm * 0.42);

      paintGridRidge(
        g,
        0.77,
        g.rows * 0.28,
        7.6,
        { r: 14, g: 20, b: 32 },
        { r: 71, g: 85, b: 105 },
        5
      );

      const tx = Math.round(g.cols * 0.67);
      const by = Math.round(g.rows * 0.72);
      const pulse = 0.72 + 0.28 * Math.sin(t * 2.2);
      const steel = { r: 148, g: 163, b: 184 };
      g.glowTile(tx, by - 7, 5.2, { r: 251, g: 146, b: 60 }, 0.34 * pulse);

      const sweepAngle = Math.sin(t * 0.85) * 0.14;
      for (let d = 2; d < Math.round(g.cols * 0.28); d++) {
        const bx = tx - d;
        const byBeam = Math.round(by - 7 + d * sweepAngle);
        const a = (1 - d / (g.cols * 0.3)) * 0.28;
        g.put(bx, byBeam, "~", { r: 254, g: 240, b: 138 }, a, a * 1.2);
      }

      for (let dx = -2; dx <= 2; dx++) {
        g.put(tx + dx, by - 9, Math.abs(dx) === 2 ? "/" : "=", steel, 0.88, 0.85);
      }
      for (let dx = -2; dx <= 2; dx++) {
        const isBeacon = Math.abs(dx) <= 1;
        g.put(
          tx + dx,
          by - 8,
          isBeacon ? "@" : "|",
          isBeacon ? { r: 253, g: 224, b: 71 } : steel,
          0.9,
          1
        );
        g.put(tx + dx, by - 7, "=", steel, 0.85, 0.8);
      }
      for (let r = 0; r < 6; r++) {
        const spread = 1 + Math.floor(r / 3);
        g.put(
          tx - spread,
          by - 6 + r,
          r % 2 === 0 ? "/" : "|",
          steel,
          0.72,
          0.8
        );
        g.put(
          tx + spread,
          by - 6 + r,
          r % 2 === 0 ? "\\" : "|",
          steel,
          0.72,
          0.8
        );
        if (r % 2 === 1) g.put(tx, by - 6 + r, "X", steel, 0.45, 0.65);
      }

      g.flush(ctx);
      break;
    }

    case "canyon_arch": {
      const g = createGridFrame(
        w,
        h,
        "#0e0814",
        "#29141d",
        "#1e0f0c",
        { r: 234, g: 88, b: 12 },
        0.055,
        theme
      );
      g.stars(t, { r: 254, g: 215, b: 170 }, Math.round(g.cols * 0.75), 0.78);

      paintGridRidge(
        g,
        0.76,
        g.rows * 0.12,
        2.2,
        { r: 52, g: 22, b: 24 },
        { r: 154, g: 52, b: 18 },
        6
      );

      const ax = Math.round(g.cols * 0.56);
      const ay = Math.round(g.rows * 0.85);
      const rxOut = g.cols * 0.3;
      const ryOut = g.rows * 0.62;
      const rxIn = g.cols * 0.18;
      const ryIn = g.rows * 0.46;

      for (let y = 0; y < g.rows; y++) {
        for (let x = 0; x < g.cols; x++) {
          const isGround = y >= ay;
          const dOut = Math.hypot((x - ax) / rxOut, (y - ay) / ryOut);
          const dIn = Math.hypot((x - ax) / rxIn, (y - ay) / ryIn);
          const isArch = dOut <= 1.0 && dIn >= 1.02 && y <= ay;
          const isButte = x > ax + rxIn * 1.15 && y > g.rows * 0.54;
          if (isGround || isArch || isButte) {
            const strata = Math.sin(y * 0.85) * 0.5 + 0.5;
            const col = mixRgb(
              { r: 90, g: 34, b: 22 },
              { r: 194, g: 65, b: 12 },
              strata
            );
            const isRim = isArch && (dOut > 0.86 || dIn < 1.15);
            g.put(
              x,
              y,
              isRim ? "=" : (x + y) % 3 === 0 ? "#" : ":",
              col,
              0.88,
              isRim ? 0.78 : 0.44
            );
          }
        }
      }

      const fx = ax;
      const fy = ay;
      const flick = 0.85 + 0.15 * Math.sin(t * 6.8);
      g.glowTile(fx, fy - 1, 4.5 * flick, { r: 251, g: 146, b: 60 }, 0.38);
      g.put(fx, fy - 1, "^", { r: 254, g: 240, b: 138 }, 0.95, 1);
      g.put(fx - 1, fy, "=", { r: 234, g: 88, b: 12 }, 0.85, 0.8);
      g.put(fx + 1, fy, "=", { r: 234, g: 88, b: 12 }, 0.85, 0.8);
      for (let s = 0; s < 5; s++) {
        const p = (t * 0.35 + s / 5) % 1;
        g.put(
          Math.round(fx + Math.sin(t * 2 + s) * 1.1),
          Math.round(fy - 2 - p * 5),
          "·",
          { r: 251, g: 191, b: 36 },
          (1 - p) * 0.5,
          1 - p
        );
      }

      const cx = Math.round(g.cols * 0.16);
      const cy = ay;
      const cCol = { r: 124, g: 45, b: 18 };
      for (let r = 0; r < 5; r++) g.put(cx, cy - r, "|", cCol, 0.9, 0.8);
      g.put(cx - 1, cy - 2, "-", cCol, 0.85, 0.8);
      g.put(cx - 2, cy - 3, "|", cCol, 0.85, 0.8);
      g.put(cx + 1, cy - 3, "-", cCol, 0.85, 0.8);
      g.put(cx + 2, cy - 4, "|", cCol, 0.85, 0.8);

      g.flush(ctx);
      break;
    }

    case "nordic_fjord": {
      const g = createGridFrame(
        w,
        h,
        "#06111a",
        "#102433",
        "#07141e",
        { r: 56, g: 189, b: 248 },
        0.055,
        theme
      );
      g.stars(t, { r: 186, g: 230, b: 253 }, Math.round(g.cols * 0.35), 0.35);
      const waterY = Math.round(g.rows * 0.62);

      for (
        let x = Math.round(g.cols * 0.25);
        x <= Math.round(g.cols * 0.75);
        x++
      ) {
        const topY = Math.round(waterY - fbm1(x * 0.14 + 2.1) * g.rows * 0.22);
        for (let y = topY; y < waterY; y++) {
          const isSnow = y - topY <= 1;
          g.put(
            x,
            y,
            isSnow ? "^" : ":",
            isSnow ? { r: 186, g: 230, b: 253 } : { r: 22, g: 45, b: 64 },
            isSnow ? 0.6 : 0.78,
            isSnow ? 0.8 : 0.35
          );
        }
      }

      for (let y = 0; y < waterY; y++) {
        const leftEnd = Math.round(g.cols * (0.16 + (y / waterY) * 0.18));
        const rightStart = Math.round(g.cols * (0.84 - (y / waterY) * 0.2));
        for (let x = 0; x <= leftEnd; x++) {
          g.put(
            x,
            y,
            x === leftEnd ? "\\" : (x + y) % 3 === 0 ? "#" : ":",
            { r: 18, g: 34, b: 50 },
            0.88,
            0.54
          );
        }
        for (let x = rightStart; x < g.cols; x++) {
          g.put(
            x,
            y,
            x === rightStart ? "/" : (x + y) % 3 === 0 ? "#" : ":",
            { r: 14, g: 28, b: 42 },
            0.88,
            0.52
          );
        }
      }

      const wfX = Math.round(g.cols * 0.21);
      g.glowTile(wfX, waterY - 1, 2.8, { r: 186, g: 230, b: 253 }, 0.36);
      for (let y = Math.round(g.rows * 0.2); y < waterY; y++) {
        const flow = (((y - t * 9) % 3) + 3) % 3;
        g.put(
          wfX,
          y,
          flow < 1 ? "@" : "|",
          { r: 224, g: 242, b: 254 },
          0.74,
          0.92
        );
        g.put(
          wfX + 1,
          y,
          flow >= 1 ? ":" : "|",
          { r: 125, g: 211, b: 252 },
          0.48,
          0.75
        );
      }
      g.put(wfX - 1, waterY, "~", { r: 224, g: 242, b: 254 }, 0.65, 0.9);
      g.put(wfX, waterY, "~", { r: 224, g: 242, b: 254 }, 0.75, 0.95);
      g.put(wfX + 1, waterY, "~", { r: 224, g: 242, b: 254 }, 0.65, 0.9);

      for (let y = waterY; y < g.rows; y++) {
        for (let x = 0; x < g.cols; x++) {
          if ((x + y * 2) % 6 === 0) {
            g.put(x, y, "~", { r: 14, g: 116, b: 144 }, 0.24, 0.38);
          }
        }
      }

      const bx = Math.round(g.cols * (0.48 + 0.13 * Math.sin(t * 0.28)));
      const by = Math.round(waterY + (g.rows - waterY) * 0.42);
      g.glowTile(bx, by - 1, 2.4, { r: 251, g: 191, b: 36 }, 0.3);
      g.put(bx, by - 2, "*", { r: 254, g: 240, b: 138 }, 0.92, 1);
      g.put(bx, by - 1, "|", { r: 203, g: 213, b: 225 }, 0.8, 0.9);
      for (let dx = -3; dx <= 3; dx++) {
        g.put(
          bx + dx,
          by,
          Math.abs(dx) === 3 ? (dx < 0 ? "\\" : "/") : "=",
          { r: 226, g: 232, b: 240 },
          0.9,
          0.95
        );
      }
      for (let k = 1; k <= 4; k++) {
        const a = (1 - k / 5) * 0.48;
        g.put(bx - 2 - k, by + k, "~", { r: 125, g: 211, b: 252 }, a, a * 1.2);
        g.put(bx + 2 + k, by + k, "~", { r: 125, g: 211, b: 252 }, a, a * 1.2);
      }

      g.flush(ctx);
      break;
    }

    case "highland_moor": {
      const g = createGridFrame(
        w,
        h,
        "#111720",
        "#1e2938",
        "#121820",
        { r: 148, g: 163, b: 184 },
        0.055,
        theme
      );
      paintGridMoon(
        g,
        Math.round(g.cols * 0.32),
        Math.round(g.rows * 0.22),
        Math.max(2.6, g.rows * 0.11),
        { r: 226, g: 232, b: 240 },
        { r: 148, g: 163, b: 184 },
        { r: 100, g: 116, b: 139 }
      );

      paintGridRidge(
        g,
        0.66,
        g.rows * 0.16,
        4.4,
        { r: 21, g: 28, b: 38 },
        { r: 100, g: 116, b: 139 },
        5
      );
      paintGridRidge(
        g,
        0.8,
        g.rows * 0.08,
        10.8,
        { r: 13, g: 18, b: 26 },
        { r: 71, g: 85, b: 105 },
        4
      );
      paintGridMist(g, t * 0.8, 0.72, 2.4, { r: 203, g: 213, b: 225 }, 0.35);

      const stones = [
        { x: 0.29, y: 0.79, h: 4, w: 2, runic: false },
        { x: 0.45, y: 0.77, h: 6, w: 2, runic: true },
        { x: 0.6, y: 0.78, h: 5, w: 2, runic: false },
        { x: 0.74, y: 0.8, h: 3, w: 2, runic: false },
      ];
      const aRgb = hexToRgb(accent);
      const rPulse = 0.45 + 0.45 * Math.sin(t * 1.5);
      for (const st of stones) {
        const sx = Math.round(g.cols * st.x);
        const sy = Math.round(g.rows * st.y);
        for (let r = 0; r < st.h; r++) {
          for (let dx = 0; dx < st.w; dx++) {
            g.put(
              sx + dx,
              sy - r,
              r === st.h - 1 ? "=" : "#",
              { r: 100, g: 116, b: 139 },
              0.85,
              0.68
            );
          }
        }
        if (st.runic) {
          g.glowTile(sx, sy - 3, 3.6, aRgb, 0.28 * rPulse);
          g.put(sx, sy - 3, "@", aRgb, 0.9 * rPulse, 1);
        }
      }

      for (let x = 2; x < g.cols - 2; x += 3) {
        g.put(
          x,
          g.rows - 2,
          Math.sin(t * 2.2 + x * 0.3) > 0 ? "/" : "|",
          { r: 148, g: 163, b: 184 },
          0.32,
          0.55
        );
      }

      g.flush(ctx);
      break;
    }

    case "glacier_camp":
    default: {
      const g = createGridFrame(
        w,
        h,
        "#050d1c",
        "#0c2240",
        "#09192e",
        { r: 125, g: 211, b: 252 },
        0.06,
        theme
      );
      g.stars(t, { r: 224, g: 242, b: 254 }, Math.round(g.cols * 0.65), 0.5);

      paintGridRidge(
        g,
        0.58,
        g.rows * 0.32,
        8.8,
        { r: 15, g: 42, b: 72 },
        { r: 224, g: 242, b: 254 },
        6
      );
      paintGridRidge(
        g,
        0.79,
        g.rows * 0.12,
        15.2,
        { r: 10, g: 28, b: 48 },
        { r: 186, g: 230, b: 253 },
        5
      );

      const tents = [0.38, 0.53];
      for (let i = 0; i < tents.length; i++) {
        const tx = Math.round(g.cols * tents[i]);
        const ty = Math.round(g.rows * 0.77);
        const glow = 0.85 + 0.15 * Math.sin(t * 2.3 + i * 1.4);
        g.glowTile(tx, ty - 1, 4.5, { r: 251, g: 146, b: 60 }, 0.36 * glow);
        g.put(tx - 1, ty - 2, "/", { r: 251, g: 146, b: 60 }, 0.92 * glow, 0.9);
        g.put(tx, ty - 2, "-", { r: 251, g: 146, b: 60 }, 0.95 * glow, 0.9);
        g.put(tx + 1, ty - 2, "\\", { r: 251, g: 146, b: 60 }, 0.92 * glow, 0.9);
        g.put(tx - 1, ty - 1, "#", { r: 249, g: 115, b: 22 }, 0.92 * glow, 0.85);
        g.put(tx, ty - 1, "@", { r: 254, g: 240, b: 138 }, 0.96 * glow, 1);
        g.put(tx + 1, ty - 1, "#", { r: 249, g: 115, b: 22 }, 0.92 * glow, 0.85);
      }

      const flakes = Math.round(g.cols * 0.55);
      for (let i = 0; i < flakes; i++) {
        const p = (t * (0.28 + hash2(i, 5) * 0.22) + hash2(i, 19)) % 1;
        const sx = Math.round(p * (g.cols - 1));
        const sy = Math.round(
          (0.24 + hash2(i, 29) * 0.56) * g.rows + Math.sin(t * 2.5 + i) * 0.8
        );
        g.put(
          sx,
          sy,
          i % 3 === 0 ? "-" : "·",
          { r: 224, g: 242, b: 254 },
          Math.sin(p * Math.PI) * 0.4,
          0.82
        );
      }

      g.flush(ctx);
      break;
    }
  }
}
