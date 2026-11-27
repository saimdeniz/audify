import { hexToRgbTriplet } from "../../constants/themePalettes";
import type { LayerClipSpec, ThemeMode } from "../../types";
import { getClipPitchMode } from "./layersTimelineMath";

export type ClipFxBadgeKind = "missing" | "gain" | "pitch" | "reverse";

export interface ClipFxBadge {
  kind: ClipFxBadgeKind;
  label: string;
}

/**
 * Pure summary of non-default clip effects shown on the timeline clip header.
 * Keeps indicator presence deterministic and easy to unit-test.
 */
export function getClipActiveFxBadges(
  clip: LayerClipSpec,
  isMissing: boolean
): ClipFxBadge[] {
  const badges: ClipFxBadge[] = [];
  if (isMissing) {
    badges.push({ kind: "missing", label: "MISSING" });
  }
  if (Math.abs(clip.gainDb) >= 0.05) {
    const rounded = Math.round(clip.gainDb * 10) / 10;
    const text = Number.isInteger(rounded)
      ? `${rounded > 0 ? "+" : ""}${rounded}dB`
      : `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}dB`;
    badges.push({ kind: "gain", label: text });
  }
  if (Math.abs(clip.pitchSemitones) >= 0.01) {
    const st = Math.round(clip.pitchSemitones * 10) / 10;
    const prefix = st > 0 ? "+" : "";
    const modeSuffix = getClipPitchMode(clip) === "varispeed" ? " T" : "";
    badges.push({ kind: "pitch", label: `${prefix}${st}st${modeSuffix}` });
  }
  if (clip.reversed) {
    badges.push({ kind: "reverse", label: "REV" });
  }
  return badges;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Crisp 7×7px vector mini-glyphs (DPI-sharp, zero font/emoji drift). */
function drawFxBadgeIcon(
  ctx: CanvasRenderingContext2D,
  kind: ClipFxBadgeKind,
  x: number,
  cy: number,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "pitch") {
    // Up/down pitch arrows
    ctx.beginPath();
    ctx.moveTo(x + 3.5, cy - 3.2);
    ctx.lineTo(x + 1.3, cy - 0.8);
    ctx.moveTo(x + 3.5, cy - 3.2);
    ctx.lineTo(x + 5.7, cy - 0.8);
    ctx.moveTo(x + 3.5, cy + 3.2);
    ctx.lineTo(x + 1.3, cy + 0.8);
    ctx.moveTo(x + 3.5, cy + 3.2);
    ctx.lineTo(x + 5.7, cy + 0.8);
    ctx.stroke();
  } else if (kind === "gain") {
    // Three ascending studio gain bars
    ctx.fillRect(x + 0.5, cy + 0.5, 1.4, 2.5);
    ctx.fillRect(x + 2.8, cy - 1.2, 1.4, 4.2);
    ctx.fillRect(x + 5.1, cy - 3.0, 1.4, 6.0);
  } else if (kind === "reverse") {
    // Reverse playhead triangle
    ctx.beginPath();
    ctx.moveTo(x + 5.6, cy - 2.8);
    ctx.lineTo(x + 1.4, cy);
    ctx.lineTo(x + 5.6, cy + 2.8);
    ctx.closePath();
    ctx.fill();
  } else {
    // Missing alert triangle
    ctx.beginPath();
    ctx.moveTo(x + 3.5, cy - 3.0);
    ctx.lineTo(x + 6.3, cy + 2.6);
    ctx.lineTo(x + 0.7, cy + 2.6);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (maxWidth <= 4) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  const ellipsisW = ctx.measureText(ellipsis).width;
  if (ellipsisW >= maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid)).width + ellipsisW <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo > 0 ? `${text.slice(0, lo)}${ellipsis}` : "";
}

export interface DrawClipHeaderOptions {
  clip: LayerClipSpec;
  isMissing: boolean;
  clipLeft: number;
  clipTop: number;
  clipW: number;
  headerH: number;
  showWaveforms: boolean;
  themeMode: ThemeMode;
  accentColor: string;
  fgColor: string;
}

/**
 * Renders the clip title on the left and right-pinned DaVinci-style FX indicator
 * badges (Gain, Pitch, Reverse, Missing) so active clip effects remain visible
 * even on long filenames or zoomed-out clips.
 */
export function drawClipHeaderAndFxBadges(
  ctx: CanvasRenderingContext2D,
  opts: DrawClipHeaderOptions
): void {
  const {
    clip,
    isMissing,
    clipLeft,
    clipTop,
    clipW,
    headerH,
    showWaveforms,
    themeMode,
    accentColor,
    fgColor,
  } = opts;

  const badges = getClipActiveFxBadges(clip, isMissing);
  const [ar, ag, ab] = hexToRgbTriplet(accentColor);
  const isLight = themeMode === "light";
  const isContrast = themeMode === "contrast";
  const pillFill = isContrast
    ? `rgba(${ar}, ${ag}, ${ab}, 0.28)`
    : isLight
    ? `rgba(${ar}, ${ag}, ${ab}, 0.20)`
    : `rgba(${ar}, ${ag}, ${ab}, 0.24)`;
  const pillBorder = isContrast
    ? accentColor
    : `rgba(${ar}, ${ag}, ${ab}, ${isLight ? 0.72 : 0.78})`;
  const warnFill = isLight
    ? "rgba(245, 158, 11, 0.24)"
    : "rgba(245, 158, 11, 0.28)";
  const warnBorder = "#F59E0B";

  // Ultra-narrow clip: draw a compact rounded-square FX corner indicator
  if (clipW < 26) {
    if (badges.length > 0 && clipW >= 12) {
      ctx.save();
      const sq = 5;
      const sx = clipLeft + clipW - sq - 2.5;
      const sy = clipTop + Math.max(2, (headerH - sq) * 0.5);
      ctx.fillStyle = isMissing ? warnBorder : accentColor;
      drawRoundedRectPath(ctx, sx, sy, sq, sq, 1.5);
      ctx.fill();
      ctx.restore();
    }
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipLeft + 2, clipTop, Math.max(0, clipW - 4), headerH);
  ctx.clip();

  const pillH = Math.min(11, Math.max(9, headerH - 3));
  const pillY = clipTop + (headerH - pillH) * 0.5;
  const pillCenterY = pillY + pillH * 0.5;
  const badgeFont = '600 8.5px "JetBrains Mono", Consolas, monospace';
  const titleFont = '600 9.5px "JetBrains Mono", Consolas, monospace';
  const titleY = showWaveforms
    ? clipTop + 10.5
    : clipTop + headerH * 0.5 + 3.2;

  let rightReservedW = 0;

  if (badges.length > 0) {
    ctx.font = badgeFont;
    const iconW = 7;
    const iconGap = 2.5;
    const padX = 3.5;
    const pillGap = 3;
    const pillWidths = badges.map(
      (b) => Math.ceil(ctx.measureText(b.label).width + iconW + iconGap + padX * 2)
    );
    const totalFullW =
      pillWidths.reduce((sum, w) => sum + w, 0) +
      pillGap * Math.max(0, badges.length - 1);

    if (clipW >= totalFullW + 38) {
      // Full right-pinned FX pills with icons & values
      let cursorX = clipLeft + clipW - 3.5;
      for (let i = badges.length - 1; i >= 0; i--) {
        const badge = badges[i];
        const w = pillWidths[i];
        cursorX -= w;
        const isWarn = badge.kind === "missing";
        ctx.fillStyle = isWarn ? warnFill : pillFill;
        ctx.strokeStyle = isWarn ? warnBorder : pillBorder;
        ctx.lineWidth = 0.85;
        drawRoundedRectPath(ctx, cursorX, pillY, w, pillH, 2);
        ctx.fill();
        ctx.stroke();

        const glyphColor = isWarn ? warnBorder : accentColor;
        drawFxBadgeIcon(ctx, badge.kind, cursorX + padX, pillCenterY, glyphColor);
        ctx.fillStyle = fgColor;
        ctx.fillText(
          badge.label,
          cursorX + padX + iconW + iconGap,
          pillCenterY + 2.9
        );
        cursorX -= pillGap;
      }
      rightReservedW = totalFullW + 7;
    } else {
      // Compact "FX" indicator pill pinned to the right edge
      const compactLabel = isMissing ? "!" : "FX";
      const compactW = isMissing ? 13 : 19;
      const cx = clipLeft + clipW - compactW - 3;
      ctx.fillStyle = isMissing ? warnFill : pillFill;
      ctx.strokeStyle = isMissing ? warnBorder : pillBorder;
      ctx.lineWidth = 0.85;
      drawRoundedRectPath(ctx, cx, pillY, compactW, pillH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isMissing ? warnBorder : fgColor;
      const tw = ctx.measureText(compactLabel).width;
      ctx.fillText(
        compactLabel,
        cx + (compactW - tw) * 0.5,
        pillCenterY + 2.9
      );
      rightReservedW = compactW + 6;
    }
  }

  // Left-aligned clip filename truncated cleanly before FX pill area
  const titleBudget = clipW - rightReservedW - 8;
  if (titleBudget >= 14) {
    ctx.font = titleFont;
    ctx.fillStyle = fgColor;
    const title = truncateTextToWidth(ctx, clip.sourceName, titleBudget);
    if (title) {
      ctx.fillText(title, clipLeft + 5, titleY);
    }
  }

  ctx.restore();
}
