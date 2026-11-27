import { hexToRgbTriplet } from "../../constants/themePalettes";
import type { LayerClipSpec, LayerRecipe, ThemeMode } from "../../types";
import { getCanvasThemePalette, parsePeaks } from "../../utils/format";
import { getCachedPeaksJson } from "../../utils/peaksStore";
import { drawClipHeaderAndFxBadges } from "./layersClipFxBadges";
import {
  COMPACT_WAVEFORM_HIDE_HEIGHT,
  getClipRenderedDurationSec,
  TIMELINE_RULER_HEIGHT,
  TimelineMarqueeRect,
} from "./layersTimelineMath";

export interface TimelineDropPreview {
  laneIndex: number;
  isNewLane: boolean;
  startSec: number;
  durationSec: number;
  label: string;
}

export interface RenderFixedRulerParams {
  width: number;
  dpr: number;
  scrollLeftPx: number;
  pxPerSec: number;
  playheadSec: number;
  themeMode: ThemeMode;
  accentColor: string;
  enableMica: boolean;
}

export interface RenderLayersTimelineParams {
  width: number;
  height: number;
  dpr: number;
  scrollLeftPx: number;
  scrollTopPx: number;
  pxPerSec: number;
  laneHeight: number;
  recipe: LayerRecipe;
  selectedClipIds: ReadonlySet<string>;
  missingClipIds: ReadonlySet<string>;
  hoveredClipId: string | null;
  snapEnabled: boolean;
  snapGridSec: number;
  themeMode: ThemeMode;
  accentColor: string;
  enableMica: boolean;
  dropPreview: TimelineDropPreview | null;
  marqueeRect: TimelineMarqueeRect | null;
  sourceDurationBySampleId: ReadonlyMap<number, number>;
}

export interface RenderPlayheadOverlayParams {
  width: number;
  height: number;
  dpr: number;
  scrollLeftPx: number;
  pxPerSec: number;
  playheadSec: number;
  themeMode: ThemeMode;
  accentColor: string;
  enableMica: boolean;
}

function chooseRulerStepSec(pxPerSec: number): number {
  const candidates = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  for (const step of candidates) {
    if (step * pxPerSec >= 64) return step;
  }
  return 60;
}

/** Mixes a lane RGB color into an opaque surface base so overlapping clips never bleed text/waveforms. */
function buildOpaqueClipColor(
  r: number,
  g: number,
  b: number,
  mix: number,
  themeMode: ThemeMode
): string {
  const base =
    themeMode === "light" ? 244 : themeMode === "contrast" ? 12 : 20;
  const nr = Math.round(base * (1 - mix) + r * mix);
  const ng = Math.round(base * (1 - mix) + g * mix);
  const nb = Math.round(base * (1 - mix) + b * mix);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function drawClipWaveform(
  ctx: CanvasRenderingContext2D,
  clip: LayerClipSpec,
  clipX: number,
  bodyTop: number,
  clipW: number,
  bodyH: number,
  viewportWidth: number,
  strokeColor: string,
  sourceDurationSec: number
): void {
  const peaksJson = getCachedPeaksJson(clip.sourceSampleId);
  if (!peaksJson) return;
  const peaks = parsePeaks(peaksJson);
  if (peaks.length === 0) return;

  const safeSrcDur = Math.max(sourceDurationSec, clip.trimEndSec, 0.05);
  const startRatio = Math.max(0, Math.min(1, clip.trimStartSec / safeSrcDur));
  const endRatio = Math.max(
    startRatio + 0.001,
    Math.min(1, clip.trimEndSec / safeSrcDur)
  );
  const spanRatio = endRatio - startRatio;
  const gainLinear = Math.max(
    0.18,
    Math.min(1.5, Math.pow(10, (clip.gainDb || 0) / 20))
  );

  const midY = bodyTop + bodyH * 0.5;
  const maxHalf = Math.max(3, bodyH * 0.44);
  const totalCols = Math.max(2, Math.floor(clipW));
  const startCol = Math.max(0, Math.floor(-clipX));
  const endCol = Math.min(totalCols, Math.ceil(viewportWidth - clipX));

  ctx.fillStyle = strokeColor;
  for (let i = startCol; i < endCol; i++) {
    const t = totalCols > 1 ? i / (totalCols - 1) : 0;
    const norm = clip.reversed
      ? endRatio - t * spanRatio
      : startRatio + t * spanRatio;
    const idx = Math.max(
      0,
      Math.min(peaks.length - 1, Math.floor(norm * (peaks.length - 1)))
    );
    const amp = Math.min(1, Math.max(0.03, peaks[idx] * gainLinear));
    const h = Math.max(1, amp * maxHalf);
    ctx.fillRect(clipX + i, midY - h, 1, h * 2);
  }
}

/** Renders the fixed/sticky `24px` top time ruler that never scrolls away vertically. */
export function renderFixedTimelineRuler(
  ctx: CanvasRenderingContext2D,
  params: RenderFixedRulerParams
): void {
  const { width, dpr, scrollLeftPx, pxPerSec, playheadSec, themeMode, accentColor, enableMica } =
    params;
  const palette = getCanvasThemePalette(
    `${themeMode}:${enableMica}:${accentColor}`
  );
  const h = TIMELINE_RULER_HEIGHT;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, h);

  ctx.fillStyle = palette.surface2;
  ctx.fillRect(0, 0, width, h);

  const visStart = Math.max(0, scrollLeftPx / pxPerSec);
  const visEnd = (scrollLeftPx + width) / pxPerSec;
  const step = chooseRulerStepSec(pxPerSec);
  const firstTick = Math.floor(visStart / step) * step;
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;

  ctx.font = '10px "JetBrains Mono", Consolas, monospace';
  ctx.fillStyle = palette.fg3;
  ctx.strokeStyle = palette.lineStrong;
  ctx.lineWidth = 1;

  for (let t = firstTick; t <= visEnd + step; t += step) {
    const x = Math.floor(t * pxPerSec - scrollLeftPx) + 0.5;
    if (x < -12 || x > width + 12) continue;
    ctx.beginPath();
    ctx.moveTo(x, h - 7);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(decimals)}s`, x + 3, 14);
  }

  const px = Math.floor(playheadSec * pxPerSec - scrollLeftPx) + 0.5;
  if (px >= -8 && px <= width + 8) {
    ctx.fillStyle = palette.accentColor;
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = palette.accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 8);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Pure 60fps HTML5 2D canvas renderer for the lane rows area (`y = 0` = Lane 1 top).
 * Uses opaque clip bodies so overlapping clips never bleed text/waveforms, and hides
 * waveforms cleanly when `laneHeight <= 36px` (DaVinci Resolve compact lane style).
 */
export function renderLayersTimelineCanvas(
  ctx: CanvasRenderingContext2D,
  params: RenderLayersTimelineParams
): void {
  const {
    width,
    height,
    dpr,
    scrollLeftPx,
    scrollTopPx,
    pxPerSec,
    laneHeight,
    recipe,
    selectedClipIds,
    missingClipIds,
    hoveredClipId,
    snapEnabled,
    snapGridSec,
    themeMode,
    accentColor,
    enableMica,
    dropPreview,
    marqueeRect,
    sourceDurationBySampleId,
  } = params;

  const palette = getCanvasThemePalette(
    `${themeMode}:${enableMica}:${accentColor}`
  );
  const isLight = themeMode === "light";
  const showWaveforms = laneHeight > COMPACT_WAVEFORM_HIDE_HEIGHT;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const visibleStartSec = Math.max(0, scrollLeftPx / pxPerSec);
  const visibleEndSec = (scrollLeftPx + width) / pxPerSec;
  const firstVisibleLane = Math.max(0, Math.floor(scrollTopPx / laneHeight));
  const lastVisibleLane = Math.min(
    recipe.lanes.length - 1,
    Math.ceil((scrollTopPx + height) / laneHeight)
  );

  // 1. Visible lane row stripes & horizontal dividers (viewport-culled)
  for (let i = firstVisibleLane; i <= lastVisibleLane; i++) {
    const y = i * laneHeight - scrollTopPx;
    if (i % 2 === 1) {
      ctx.fillStyle = isLight
        ? "rgba(15, 23, 42, 0.025)"
        : "rgba(255, 255, 255, 0.018)";
      ctx.fillRect(0, y, width, laneHeight);
    }
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + laneHeight - 0.5);
    ctx.lineTo(width, y + laneHeight - 0.5);
    ctx.stroke();
  }

  // 2. Vertical Snap Grid lines
  const gridStep =
    snapEnabled && snapGridSec > 0 && snapGridSec * pxPerSec >= 12
      ? snapGridSec
      : chooseRulerStepSec(pxPerSec);
  const firstGrid = Math.floor(visibleStartSec / gridStep) * gridStep;
  ctx.strokeStyle = palette.lineSubtle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = firstGrid; t <= visibleEndSec + gridStep; t += gridStep) {
    const x = Math.floor(t * pxPerSec - scrollLeftPx) + 0.5;
    if (x < 0 || x > width) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();

  // 3. Lane index & Solo resolution
  const laneIndexById = new Map<string, number>();
  let hasSolo = false;
  for (let i = 0; i < recipe.lanes.length; i++) {
    laneIndexById.set(recipe.lanes[i].id, i);
    if (recipe.lanes[i].solo) hasSolo = true;
  }

  // Draw unselected clips first, selected clips last so selected clip always occludes cleanly
  const orderedClips = [...recipe.clips].sort(
    (a, b) => Number(selectedClipIds.has(a.id)) - Number(selectedClipIds.has(b.id))
  );

  // 4. Render Clips (Opaque bodies — viewport-culled horizontally & vertically)
  for (let i = 0; i < orderedClips.length; i++) {
    const clip = orderedClips[i];
    const laneIdx = laneIndexById.get(clip.laneId);
    if (
      laneIdx === undefined ||
      laneIdx < firstVisibleLane ||
      laneIdx > lastVisibleLane
    ) {
      continue;
    }
    const lane = recipe.lanes[laneIdx];
    const durSec = getClipRenderedDurationSec(clip);
    const clipLeft = clip.startSec * pxPerSec - scrollLeftPx;
    const clipW = Math.max(8, durSec * pxPerSec);
    if (clipLeft + clipW < -4 || clipLeft > width + 4) continue;

    const pad = laneHeight <= COMPACT_WAVEFORM_HIDE_HEIGHT ? 2 : 3;
    const clipTop = laneIdx * laneHeight - scrollTopPx + pad;
    const clipH = Math.max(16, laneHeight - pad * 2);
    const isSelected = selectedClipIds.has(clip.id);
    const isMissing = missingClipIds.has(clip.id);
    const isHovered = hoveredClipId === clip.id;
    const isDimmed = lane.muted || (hasSolo && !lane.solo);
    const [r, g, b] = hexToRgbTriplet(lane.colorHex);

    ctx.save();
    if (isDimmed) ctx.globalAlpha = 0.48;

    // Opaque body fill (prevents text/waveform bleed when clips overlap)
    ctx.fillStyle = buildOpaqueClipColor(
      r,
      g,
      b,
      isSelected ? (isLight ? 0.28 : 0.34) : isLight ? 0.16 : 0.21,
      themeMode
    );
    ctx.fillRect(clipLeft, clipTop, clipW, clipH);

    // Header tint bar
    const headerH = showWaveforms ? 14 : clipH;
    ctx.fillStyle = buildOpaqueClipColor(
      r,
      g,
      b,
      isSelected ? (isLight ? 0.36 : 0.44) : isLight ? 0.24 : 0.30,
      themeMode
    );
    ctx.fillRect(clipLeft, clipTop, clipW, headerH);

    // Waveform only when laneHeight > 36px (DaVinci compact style)
    if (showWaveforms && clipH > headerH + 6) {
      const srcDur =
        (clip.sourceDurationSec && clip.sourceDurationSec > 0
          ? clip.sourceDurationSec
          : undefined) ??
        (clip.sourceSampleId !== null
          ? sourceDurationBySampleId.get(clip.sourceSampleId)
          : undefined) ??
        Math.max(clip.trimEndSec, durSec);
      drawClipWaveform(
        ctx,
        clip,
        clipLeft + 1,
        clipTop + headerH + 1,
        Math.max(2, clipW - 2),
        clipH - headerH - 2,
        width,
        isLight ? `rgba(${r}, ${g}, ${b}, 0.88)` : `rgba(${r}, ${g}, ${b}, 0.94)`,
        srcDur
      );
    }

    // Fade-In & Fade-Out shaded ramp triangles
    const fadeInPx = Math.min(clipW * 0.5, clip.fadeInSec * pxPerSec);
    if (fadeInPx >= 2) {
      ctx.fillStyle = isLight ? "rgba(17, 18, 22, 0.16)" : "rgba(0, 0, 0, 0.38)";
      ctx.beginPath();
      ctx.moveTo(clipLeft, clipTop);
      ctx.lineTo(clipLeft + fadeInPx, clipTop);
      ctx.lineTo(clipLeft, clipTop + clipH);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = palette.fg2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(clipLeft, clipTop + clipH);
      ctx.lineTo(clipLeft + fadeInPx, clipTop);
      ctx.stroke();
    }

    const fadeOutPx = Math.min(clipW * 0.5, clip.fadeOutSec * pxPerSec);
    if (fadeOutPx >= 2) {
      ctx.fillStyle = isLight ? "rgba(17, 18, 22, 0.16)" : "rgba(0, 0, 0, 0.38)";
      ctx.beginPath();
      ctx.moveTo(clipLeft + clipW, clipTop);
      ctx.lineTo(clipLeft + clipW - fadeOutPx, clipTop);
      ctx.lineTo(clipLeft + clipW, clipTop + clipH);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = palette.fg2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(clipLeft + clipW - fadeOutPx, clipTop);
      ctx.lineTo(clipLeft + clipW, clipTop + clipH);
      ctx.stroke();
    }

    // Fade corner handles on selected or hovered clip
    if (isSelected || isHovered) {
      ctx.fillStyle = isSelected ? palette.accentColor : palette.fg2;
      ctx.fillRect(clipLeft + fadeInPx - 2, clipTop + 1, 5, 5);
      ctx.fillRect(clipLeft + clipW - fadeOutPx - 3, clipTop + 1, 5, 5);
    }

    // Clip title & right-pinned DaVinci-style FX indicator badges
    drawClipHeaderAndFxBadges(ctx, {
      clip,
      isMissing,
      clipLeft,
      clipTop,
      clipW,
      headerH,
      showWaveforms,
      themeMode,
      accentColor: palette.accentColor,
      fgColor: palette.fg,
    });

    // Clip border
    ctx.strokeStyle = isMissing
      ? "#F59E0B"
      : isSelected
      ? palette.accentColor
      : `rgba(${r}, ${g}, ${b}, 0.85)`;
    ctx.lineWidth = isSelected ? 1.5 : 1;
    if (isMissing) ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      Math.floor(clipLeft) + 0.5,
      Math.floor(clipTop) + 0.5,
      Math.max(4, Math.floor(clipW) - 1),
      clipH - 1
    );
    if (isMissing) ctx.setLineDash([]);
    ctx.restore();
  }

  // 5. Drag-and-Drop Ghost Preview (existing lane OR auto-create Ghost Lane below!)
  if (dropPreview && dropPreview.laneIndex >= 0) {
    const laneTop = dropPreview.laneIndex * laneHeight - scrollTopPx;
    if (laneTop + laneHeight >= -4 && laneTop <= height + 4) {
      const gx = dropPreview.startSec * pxPerSec - scrollLeftPx;
      const gw = Math.max(18, dropPreview.durationSec * pxPerSec);
      if (dropPreview.isNewLane) {
        ctx.fillStyle = palette.accentFillSoft;
        ctx.fillRect(0, laneTop, width, laneHeight);
        ctx.strokeStyle = palette.accentColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(0.5, laneTop + 0.5, width - 1, laneHeight - 1);
        ctx.setLineDash([]);
      }
      ctx.fillStyle = palette.accentFillHover;
      ctx.fillRect(gx, laneTop + 3, gw, Math.max(16, laneHeight - 6));
      ctx.strokeStyle = palette.accentColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(
        gx + 0.5,
        laneTop + 3.5,
        gw - 1,
        Math.max(15, laneHeight - 7)
      );
      ctx.setLineDash([]);
    }
  }

  // 5.5. Marquee / Rubber-Band Multi-Clip Selection Box
  if (marqueeRect) {
    const rx = Math.min(marqueeRect.x1, marqueeRect.x2) - scrollLeftPx;
    const ry = Math.min(marqueeRect.y1, marqueeRect.y2) - scrollTopPx;
    const rw = Math.abs(marqueeRect.x2 - marqueeRect.x1);
    const rh = Math.abs(marqueeRect.y2 - marqueeRect.y1);
    if (rw >= 2 || rh >= 2) {
      ctx.fillStyle = palette.accentFillSoft;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = palette.accentColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.floor(rx) + 0.5,
        Math.floor(ry) + 0.5,
        Math.max(1, Math.floor(rw) - 1),
        Math.max(1, Math.floor(rh) - 1)
      );
    }
  }

  ctx.restore();
}

/** Lightweight 60Hz overlay renderer drawing only the playhead vertical cursor line. */
export function renderLayersPlayheadOverlay(
  ctx: CanvasRenderingContext2D,
  params: RenderPlayheadOverlayParams
): void {
  const {
    width,
    height,
    dpr,
    scrollLeftPx,
    pxPerSec,
    playheadSec,
    themeMode,
    accentColor,
    enableMica,
  } = params;
  const palette = getCanvasThemePalette(
    `${themeMode}:${enableMica}:${accentColor}`
  );
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const px = Math.floor(playheadSec * pxPerSec - scrollLeftPx) + 0.5;
  if (px >= -2 && px <= width + 2) {
    ctx.strokeStyle = palette.accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }
  ctx.restore();
}
