import { createGridFrame, Rgb } from "./blueprintGrid";
import { AsciiRenderParams } from "./shared";

const DIGITS_3X5: Record<number, number[]> = {
  0: [7, 5, 5, 5, 7],
  1: [2, 6, 2, 2, 7],
  2: [7, 1, 7, 4, 7],
  3: [7, 1, 7, 1, 7],
  4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7],
  6: [7, 4, 7, 5, 7],
  7: [7, 1, 2, 2, 2],
  8: [7, 5, 7, 5, 7],
  9: [7, 5, 7, 1, 7],
};

function paintDigit3x5(
  put: (x: number, y: number, ch: string, rgb: Rgb, fa: number, ca?: number) => void,
  x0: number,
  y0: number,
  digit: number,
  rgb: Rgb,
  ch = "@"
): void {
  const rows = DIGITS_3X5[((digit % 10) + 10) % 10] ?? DIGITS_3X5[0];
  for (let r = 0; r < 5; r++) {
    const bits = rows[r];
    for (let c = 0; c < 3; c++) {
      if ((bits >> (2 - c)) & 1) {
        put(x0 + c, y0 + r, ch, rgb, 0.92, 0.98);
      }
    }
  }
}

/**
 * Renders arcade-themed retro ASCII scenes (Pong court and Space Invaders fleet).
 */
export function renderRetroArcadePreset(params: AsciiRenderParams): void {
  const { ctx, width: w, height: h, timeSec: t, preset, themeMode: theme } = params;

  if (preset === "retro_pong_court") {
    const g = createGridFrame(w, h, "#05070b", "#111620", "#070a10", { r: 148, g: 163, b: 184 }, 0.06, theme);
    const white: Rgb = { r: 248, g: 250, b: 252 };
    const slate: Rgb = { r: 100, g: 116, b: 139 };
    const cyan: Rgb = { r: 56, g: 189, b: 248 };
    const midX = Math.floor(g.cols * 0.5);
    for (let r = 1; r < g.rows - 1; r += 2) g.put(midX, r, "|", slate, 0.65, 0.9);
    paintDigit3x5(g.put, midX - 6, 2, Math.floor(t * 0.4) % 10, white, "#");
    paintDigit3x5(g.put, midX + 4, 2, (Math.floor(t * 0.4) + 3) % 10, white, "#");

    const ballPhase = (Math.sin(t * 2.4) + 1) * 0.5;
    const bx = 4 + ballPhase * (g.cols - 9);
    const by = g.rows * (0.5 + Math.sin(t * 3.7) * 0.3);
    g.glowTile(bx, by, 2.5, cyan, 0.5);
    g.put(bx, by, "@", cyan, 0.96, 1);

    const lPadY = Math.round(g.rows * 0.5 + (by - g.rows * 0.5) * (1 - ballPhase));
    const rPadY = Math.round(g.rows * 0.5 + (by - g.rows * 0.5) * ballPhase);
    for (let dy = -2; dy <= 2; dy++) {
      g.put(2, lPadY + dy, "#", white, 0.95, 0.98);
      g.put(g.cols - 3, rPadY + dy, "#", white, 0.95, 0.98);
    }
    g.flush(ctx);
    return;
  }

  const g = createGridFrame(w, h, "#040712", "#0c142b", "#060916", { r: 56, g: 189, b: 248 }, 0.065, theme);
  g.stars(t, { r: 148, g: 163, b: 184 }, 38, 0.78);

  const pink: Rgb = { r: 244, g: 114, b: 182 };
  const cyan: Rgb = { r: 56, g: 189, b: 248 };
  const amber: Rgb = { r: 251, g: 191, b: 36 };
  const green: Rgb = { r: 52, g: 211, b: 153 };
  const rose: Rgb = { r: 251, g: 113, b: 133 };
  const white: Rgb = { r: 224, g: 242, b: 254 };

  const ufoX = Math.round(((t * 6.5) % (g.cols + 18)) - 9);
  const ufoY = 1;
  g.glowTile(ufoX, ufoY, 3.2, rose, 0.34);
  for (let dx = -2; dx <= 2; dx++) {
    g.put(ufoX + dx, ufoY, Math.abs(dx) === 2 ? "/" : "=", rose, 0.88, 0.95);
  }
  for (let dx = -3; dx <= 3; dx++) {
    g.put(ufoX + dx, ufoY + 1, dx === 0 ? "@" : Math.abs(dx) === 3 ? (dx < 0 ? "<" : ">") : "#", rose, 0.92, 0.98);
  }

  const colCount = g.cols >= 74 ? 7 : g.cols >= 44 ? 5 : 3;
  const rowCount = g.rows >= 32 ? 4 : g.rows >= 23 ? 3 : 2;
  const spacingX = g.cols >= 58 ? 8 : 7;
  const rowStepY = g.rows >= 25 ? 5 : 4;
  const formW = (colCount - 1) * spacingX + 5;
  const marchAmp = Math.max(1.5, Math.min(6.5, (g.cols - formW) * 0.28));
  const marchX = Math.round((g.cols - formW) * 0.5 + Math.sin(t * 1.1) * marchAmp);
  const step = Math.floor(t * 2.1) % 2;
  const sprites: [number[], number[], Rgb][] = [
    [[4, 14, 27, 10], [4, 14, 27, 17], pink],
    [[10, 31, 21, 10], [27, 31, 21, 17], cyan],
    [[14, 31, 21, 10], [14, 31, 21, 27], amber],
  ];

  const fleetTopY = Math.max(4, Math.round(4 + Math.max(0, (g.rows - 26) * 0.14)));
  for (let r = 0; r < rowCount; r++) {
    const spriteIdx = r === 0 ? 0 : r >= rowCount - 1 ? 2 : 1;
    const [f0, f1, col] = sprites[spriteIdx];
    const bits = step === 0 ? f0 : f1;
    const baseY = fleetTopY + r * rowStepY;
    for (let c = 0; c < colCount; c++) {
      const bx = marchX + c * spacingX;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 5; sx++) {
          if ((bits[sy] >> (4 - sx)) & 1) {
            g.put(bx + sx, baseY + sy, sy === 1 && (sx === 1 || sx === 3) ? "#" : "@", col, 0.9, 0.96);
          }
        }
      }
    }
  }

  if (g.rows >= 21) {
    const shieldY = g.rows - 6;
    const shieldFracs = g.cols >= 70 ? [0.18, 0.39, 0.61, 0.82] : [0.24, 0.5, 0.76];
    for (const frac of shieldFracs) {
      const sx = Math.round(g.cols * frac);
      g.glowTile(sx, shieldY, 2.8, green, 0.24);
      for (let dx = -2; dx <= 2; dx++) {
        g.put(sx + dx, shieldY, Math.abs(dx) === 2 ? (dx < 0 ? "/" : "\\") : "#", green, 0.86, 0.95);
        if (dx !== 0) g.put(sx + dx, shieldY + 1, "@", green, 0.88, 0.95);
      }
    }
  }

  const shipX = Math.round(g.cols * (0.5 + 0.32 * Math.sin(t * 0.92)));
  const shipY = g.rows - 2;
  g.glowTile(shipX, shipY, 3, cyan, 0.42);
  g.put(shipX, shipY - 1, "^", white, 0.98, 1);
  for (let dx = -2; dx <= 2; dx++) g.put(shipX + dx, shipY, "#", cyan, 0.92, 0.98);

  const shotCycle = (t * 0.95) % 1;
  const shotX = Math.round(g.cols * (0.5 + 0.32 * Math.sin((t - shotCycle / 0.95) * 0.92)));
  const shotY = Math.round(shipY - 2 - shotCycle * (shipY - 5));
  g.glowTile(shotX, shotY, 2.2, white, 0.45);
  g.put(shotX, shotY, "@", white, 0.98, 1);
  g.put(shotX, shotY + 1, "|", cyan, 0.8, 0.92);

  const dropStartY = fleetTopY + (rowCount - 1) * rowStepY + 4;
  const dropPhase = t * 0.72 + 0.45;
  const dropCycle = dropPhase % 1;
  const dropSpan = Math.max(4, shipY - 2 - dropStartY);
  const dropY = Math.round(dropStartY + dropCycle * dropSpan);
  const dropX = marchX + 2 + (((Math.floor(dropPhase) * 3 + 1) % colCount) * spacingX);
  if (dropY < g.rows - 2) {
    g.put(dropX, dropY, (dropCycle * 10) % 2 < 1 ? "/" : "\\", amber, 0.88, 0.96);
    g.put(dropX, dropY - 1, ":", rose, 0.5, 0.85);
  }

  g.flush(ctx);
}
