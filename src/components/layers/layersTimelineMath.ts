import type { LayerClipSpec, LayerPitchMode, LayerRecipe } from "../../types";

export const TIMELINE_RULER_HEIGHT = 24;
export const MIN_LANE_HEIGHT = 28;
export const DEFAULT_LANE_HEIGHT = 52;
export const MAX_LANE_HEIGHT = 130;
/** At or below this lane height, clip waveforms hide cleanly (DaVinci compact style). */
export const COMPACT_WAVEFORM_HIDE_HEIGHT = 36;
export const MIN_LANE_HEADER_WIDTH = 120;
export const DEFAULT_LANE_HEADER_WIDTH = 176;
export const MAX_LANE_HEADER_WIDTH = 320;
export const MIN_CLIP_DURATION_SEC = 0.04;
export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 2400;

export type TimelineClipHitZone =
  | "body"
  | "trim-left"
  | "trim-right"
  | "fade-in"
  | "fade-out";

export interface TimelineClipHit {
  clip: LayerClipSpec;
  laneIndex: number;
  zone: TimelineClipHitZone;
}

export interface TimelineMarqueeRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Logarithmic conversion from 0..100 slider position to `pxPerSec` (4..2400). */
export function sliderValueToPxPerSec(sliderVal: number): number {
  const clamped = Math.max(0, Math.min(100, sliderVal));
  return Math.max(
    MIN_PX_PER_SEC,
    Math.min(
      MAX_PX_PER_SEC,
      Math.round(MIN_PX_PER_SEC * Math.pow(MAX_PX_PER_SEC / MIN_PX_PER_SEC, clamped / 100))
    )
  );
}

/** Logarithmic conversion from `pxPerSec` (4..2400) to 0..100 slider position. */
export function pxPerSecToSliderValue(pxPerSec: number): number {
  const clamped = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, pxPerSec));
  return Math.round(
    (Math.log(clamped / MIN_PX_PER_SEC) /
      Math.log(MAX_PX_PER_SEC / MIN_PX_PER_SEC)) *
      100
  );
}

/** Resolves a clip's pitch processing mode (defaults to DaVinci-style `"preserve"`). */
export function getClipPitchMode(clip: LayerClipSpec): LayerPitchMode {
  return clip.pitchMode === "varispeed" ? "varispeed" : "preserve";
}

/** Raw tape-style varispeed ratio (`2^(st/12)`), independent of pitch mode. */
export function getClipVarispeedRatio(clip: LayerClipSpec): number {
  const st = Number.isFinite(clip.pitchSemitones)
    ? Math.max(-24, Math.min(24, clip.pitchSemitones))
    : 0;
  return Math.abs(st) >= 0.01 ? Math.pow(2, st / 12) : 1;
}

/**
 * Effective timeline speed factor for clip duration, trim, and split math:
 * - `"preserve"` (Lock Length): always `1.0` so pitching never shrinks or stretches clips.
 * - `"varispeed"` (Tape): `2^(st/12)`.
 */
export function getClipPitchFactor(clip: LayerClipSpec): number {
  return getClipPitchMode(clip) === "varispeed" ? getClipVarispeedRatio(clip) : 1;
}

/** Effective rendered timeline duration of a clip after trim (+ varispeed stretch in Tape mode). */
export function getClipRenderedDurationSec(clip: LayerClipSpec): number {
  const sourceSpan = Math.max(
    MIN_CLIP_DURATION_SEC,
    clip.trimEndSec - clip.trimStartSec
  );
  const speed = getClipPitchFactor(clip);
  return Math.max(MIN_CLIP_DURATION_SEC, sourceSpan / speed);
}

/** Total timeline span (seconds) across all clips, with breathing runway. */
export function getTimelineSpanSec(recipe: LayerRecipe, minSpanSec = 6): number {
  let maxEnd = 0;
  for (const clip of recipe.clips) {
    const end = clip.startSec + getClipRenderedDurationSec(clip);
    if (end > maxEnd) maxEnd = end;
  }
  return Math.max(minSpanSec, Math.ceil((maxEnd + 1.5) * 2) / 2);
}

/** Computes Full Extent Zoom (`Fit All`) `pxPerSec` so the entire timeline fits inside `viewportWidth`. */
export function computeFitAllPxPerSec(
  recipe: LayerRecipe,
  viewportWidth: number
): number {
  const span = getTimelineSpanSec(recipe, 2);
  const usableW = Math.max(100, viewportWidth - 24);
  return Math.max(
    MIN_PX_PER_SEC,
    Math.min(MAX_PX_PER_SEC, Math.floor(usableW / span))
  );
}

/** Quantizes a timeline position in seconds when snap is enabled. */
export function snapTimeSec(
  sec: number,
  snapEnabled: boolean,
  snapGridSec: number
): number {
  const clamped = Math.max(0, sec);
  if (!snapEnabled || !Number.isFinite(snapGridSec) || snapGridSec <= 0) {
    return Math.round(clamped * 1000) / 1000;
  }
  return Math.round(clamped / snapGridSec) * snapGridSec;
}

/**
 * Hit-tests lane-area canvas coordinates `(x, y)` against clips and interactive handles.
 * Note: `y = 0` is the top of Lane 1 (the 24px Ruler is rendered in its own fixed header).
 */
export function hitTestTimelineClip(
  recipe: LayerRecipe,
  x: number,
  y: number,
  scrollLeftPx: number,
  pxPerSec: number,
  laneHeight = DEFAULT_LANE_HEIGHT
): TimelineClipHit | null {
  if (y < 0 || laneHeight <= 0) return null;
  const laneIndex = Math.floor(y / laneHeight);
  if (laneIndex < 0 || laneIndex >= recipe.lanes.length) return null;
  const lane = recipe.lanes[laneIndex];
  const localY = y - laneIndex * laneHeight;
  const absX = x + scrollLeftPx;

  for (let i = recipe.clips.length - 1; i >= 0; i--) {
    const clip = recipe.clips[i];
    if (clip.laneId !== lane.id) continue;
    const dur = getClipRenderedDurationSec(clip);
    const leftPx = clip.startSec * pxPerSec;
    const widthPx = Math.max(8, dur * pxPerSec);
    const rightPx = leftPx + widthPx;

    if (absX < leftPx - 4 || absX > rightPx + 4) continue;

    const fadeInHandleX =
      leftPx + Math.min(widthPx * 0.5, clip.fadeInSec * pxPerSec);
    const fadeOutHandleX =
      rightPx - Math.min(widthPx * 0.5, clip.fadeOutSec * pxPerSec);
    if (localY <= Math.min(18, laneHeight * 0.45)) {
      if (Math.abs(absX - fadeInHandleX) <= 8) {
        return { clip, laneIndex, zone: "fade-in" };
      }
      if (Math.abs(absX - fadeOutHandleX) <= 8) {
        return { clip, laneIndex, zone: "fade-out" };
      }
    }

    const edgeGrab = Math.min(8, widthPx * 0.25);
    if (absX <= leftPx + edgeGrab) {
      return { clip, laneIndex, zone: "trim-left" };
    }
    if (absX >= rightPx - edgeGrab) {
      return { clip, laneIndex, zone: "trim-right" };
    }
    return { clip, laneIndex, zone: "body" };
  }
  return null;
}

/** Splits a single clip cleanly at timeline position `splitSec`, adjusting trim bounds and fades. */
export function splitClipAtTimelineSec(
  recipe: LayerRecipe,
  clipId: string,
  splitSec: number,
  makeNewId: () => string
): { recipe: LayerRecipe; rightClipId: string } | null {
  const idx = recipe.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return null;
  const clip = recipe.clips[idx];
  const renderedDur = getClipRenderedDurationSec(clip);
  const offsetRendered = splitSec - clip.startSec;

  if (
    offsetRendered < MIN_CLIP_DURATION_SEC ||
    renderedDur - offsetRendered < MIN_CLIP_DURATION_SEC
  ) {
    return null;
  }

  const speed = getClipPitchFactor(clip);
  const offsetSource = offsetRendered * speed;
  const splitSourceSec = clip.reversed
    ? clip.trimEndSec - offsetSource
    : clip.trimStartSec + offsetSource;

  const leftClip: LayerClipSpec = clip.reversed
    ? {
        ...clip,
        trimStartSec: Math.max(clip.trimStartSec, splitSourceSec),
        fadeInSec: Math.min(clip.fadeInSec, offsetRendered),
        fadeOutSec: 0,
      }
    : {
        ...clip,
        trimEndSec: Math.min(clip.trimEndSec, splitSourceSec),
        fadeInSec: Math.min(clip.fadeInSec, offsetRendered),
        fadeOutSec: 0,
      };

  const rightId = makeNewId();
  const rightDur = renderedDur - offsetRendered;
  const rightClip: LayerClipSpec = clip.reversed
    ? {
        ...clip,
        id: rightId,
        startSec: splitSec,
        trimEndSec: Math.min(clip.trimEndSec, splitSourceSec),
        fadeInSec: 0,
        fadeOutSec: Math.min(clip.fadeOutSec, rightDur),
      }
    : {
        ...clip,
        id: rightId,
        startSec: splitSec,
        trimStartSec: Math.max(clip.trimStartSec, splitSourceSec),
        fadeInSec: 0,
        fadeOutSec: Math.min(clip.fadeOutSec, rightDur),
      };

  const nextClips = [...recipe.clips];
  nextClips.splice(idx, 1, leftClip, rightClip);
  return {
    recipe: { ...recipe, clips: nextClips },
    rightClipId: rightId,
  };
}

/** Trims the left edge of a clip non-destructively while shifting `startSec` smoothly. */
export function applyLeftTrim(
  clip: LayerClipSpec,
  deltaRenderedSec: number
): LayerClipSpec {
  const speed = getClipPitchFactor(clip);
  const renderedDur = getClipRenderedDurationSec(clip);
  const maxAdvance = renderedDur - MIN_CLIP_DURATION_SEC;
  const minRetreat = -Math.min(
    clip.startSec,
    clip.reversed ? 0 : clip.trimStartSec / speed
  );
  const clampedDelta = Math.max(minRetreat, Math.min(maxAdvance, deltaRenderedSec));
  const nextStart = Math.max(0, clip.startSec + clampedDelta);
  const nextRendered = Math.max(MIN_CLIP_DURATION_SEC, renderedDur - clampedDelta);

  if (clip.reversed) {
    const nextTrimEnd = Math.max(
      clip.trimStartSec + MIN_CLIP_DURATION_SEC * speed,
      clip.trimEndSec - clampedDelta * speed
    );
    return {
      ...clip,
      startSec: nextStart,
      trimEndSec: nextTrimEnd,
      fadeInSec: Math.min(clip.fadeInSec, nextRendered),
      fadeOutSec: Math.min(clip.fadeOutSec, nextRendered),
    };
  }

  const nextTrimStart = Math.max(
    0,
    Math.min(
      clip.trimEndSec - MIN_CLIP_DURATION_SEC * speed,
      clip.trimStartSec + clampedDelta * speed
    )
  );
  return {
    ...clip,
    startSec: nextStart,
    trimStartSec: nextTrimStart,
    fadeInSec: Math.min(clip.fadeInSec, nextRendered),
    fadeOutSec: Math.min(clip.fadeOutSec, nextRendered),
  };
}

/** Trims the right edge of a clip non-destructively (clamped to source duration if known). */
export function applyRightTrim(
  clip: LayerClipSpec,
  deltaRenderedSec: number,
  maxSourceDurationSec?: number
): LayerClipSpec {
  const speed = getClipPitchFactor(clip);
  const minSourceSpan = MIN_CLIP_DURATION_SEC * speed;
  const maxSourceEnd =
    maxSourceDurationSec && maxSourceDurationSec > 0
      ? maxSourceDurationSec
      : Number.POSITIVE_INFINITY;

  if (clip.reversed) {
    const nextTrimStart = Math.max(
      0,
      Math.min(
        clip.trimEndSec - minSourceSpan,
        clip.trimStartSec - deltaRenderedSec * speed
      )
    );
    const nextRendered = Math.max(
      MIN_CLIP_DURATION_SEC,
      (clip.trimEndSec - nextTrimStart) / speed
    );
    return {
      ...clip,
      trimStartSec: nextTrimStart,
      fadeInSec: Math.min(clip.fadeInSec, nextRendered),
      fadeOutSec: Math.min(clip.fadeOutSec, nextRendered),
    };
  }

  const nextTrimEnd = Math.max(
    clip.trimStartSec + minSourceSpan,
    Math.min(maxSourceEnd, clip.trimEndSec + deltaRenderedSec * speed)
  );
  const nextRendered = Math.max(
    MIN_CLIP_DURATION_SEC,
    (nextTrimEnd - clip.trimStartSec) / speed
  );
  return {
    ...clip,
    trimEndSec: nextTrimEnd,
    fadeInSec: Math.min(clip.fadeInSec, nextRendered),
    fadeOutSec: Math.min(clip.fadeOutSec, nextRendered),
  };
}

export {
  computePlayheadCenteredScrollLeft,
  getClipsInMarqueeRect,
  getShiftClickRangeClipIds,
  resolveSameLaneOverlaps,
} from "./layersTimelineEditOps";
