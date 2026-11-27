import type { LayerClipSpec, LayerRecipe } from "../../types";
import {
  applyLeftTrim,
  applyRightTrim,
  DEFAULT_LANE_HEIGHT,
  getClipRenderedDurationSec,
  MIN_CLIP_DURATION_SEC,
  TimelineMarqueeRect,
} from "./layersTimelineMath";

const OVERLAP_EPSILON = 1e-4;

/**
 * DaVinci Resolve same-lane Overwrite Trim / Punch-In rule:
 * Clips in `priorityClipIds` take ownership of their timeline interval on their lane.
 * Any non-priority clip on the same lane is cleanly deleted (if fully covered),
 * trimmed at the boundary (if left/right covered), or split into two pieces around
 * the priority clip (if punched in the middle). Fully undoable as a single recipe step.
 */
export function resolveSameLaneOverlaps(
  recipe: LayerRecipe,
  priorityClipIds: ReadonlySet<string>,
  makeNewId: () => string
): LayerRecipe {
  if (priorityClipIds.size === 0 || recipe.clips.length <= 1) return recipe;

  const topByLane = new Map<string, Array<{ start: number; end: number }>>();
  const priorityClips: LayerClipSpec[] = [];
  const otherClips: LayerClipSpec[] = [];

  for (const clip of recipe.clips) {
    if (priorityClipIds.has(clip.id)) {
      priorityClips.push(clip);
      const start = clip.startSec;
      const end = start + getClipRenderedDurationSec(clip);
      const list = topByLane.get(clip.laneId);
      if (list) list.push({ start, end });
      else topByLane.set(clip.laneId, [{ start, end }]);
    } else {
      otherClips.push(clip);
    }
  }

  if (priorityClips.length === 0 || otherClips.length === 0) return recipe;

  const survivingOthers: LayerClipSpec[] = [];
  for (const other of otherClips) {
    const cutters = topByLane.get(other.laneId);
    if (!cutters || cutters.length === 0) {
      survivingOthers.push(other);
      continue;
    }

    let segments: LayerClipSpec[] = [other];
    for (const cut of cutters) {
      const nextSegments: LayerClipSpec[] = [];
      for (const seg of segments) {
        const segStart = seg.startSec;
        const segEnd = segStart + getClipRenderedDurationSec(seg);

        if (
          segEnd <= cut.start + OVERLAP_EPSILON ||
          segStart >= cut.end - OVERLAP_EPSILON
        ) {
          nextSegments.push(seg);
          continue;
        }

        // Case 1: Fully covered -> remove segment
        if (
          segStart >= cut.start - OVERLAP_EPSILON &&
          segEnd <= cut.end + OVERLAP_EPSILON
        ) {
          continue;
        }

        // Case 2: Left edge covered -> trim left up to cut.end
        if (segStart >= cut.start - OVERLAP_EPSILON && segEnd > cut.end) {
          const remaining = segEnd - cut.end;
          if (remaining >= MIN_CLIP_DURATION_SEC) {
            nextSegments.push({
              ...applyLeftTrim(seg, cut.end - segStart),
              fadeInSec: Math.min(seg.fadeInSec, remaining * 0.5),
            });
          }
          continue;
        }

        // Case 3: Right edge covered -> trim right back to cut.start
        if (segStart < cut.start && segEnd <= cut.end + OVERLAP_EPSILON) {
          const remaining = cut.start - segStart;
          if (remaining >= MIN_CLIP_DURATION_SEC) {
            nextSegments.push({
              ...applyRightTrim(seg, cut.start - segEnd),
              fadeOutSec: Math.min(seg.fadeOutSec, remaining * 0.5),
            });
          }
          continue;
        }

        // Case 4: Middle punched out -> split into left + right pieces
        const leftLen = cut.start - segStart;
        if (leftLen >= MIN_CLIP_DURATION_SEC) {
          nextSegments.push({
            ...applyRightTrim(seg, cut.start - segEnd),
            fadeOutSec: 0,
          });
        }
        const rightLen = segEnd - cut.end;
        if (rightLen >= MIN_CLIP_DURATION_SEC) {
          nextSegments.push({
            ...applyLeftTrim(seg, cut.end - segStart),
            id: makeNewId(),
            fadeInSec: 0,
          });
        }
      }
      segments = nextSegments;
      if (segments.length === 0) break;
    }

    for (const seg of segments) survivingOthers.push(seg);
  }

  return {
    ...recipe,
    clips: [...survivingOthers, ...priorityClips],
  };
}

/**
 * Returns IDs of all clips whose rendered rectangle intersects the given marquee box
 * (coordinates are in timeline-content space: `x` includes `scrollLeftPx`, `y = 0` at Lane 1 top).
 */
export function getClipsInMarqueeRect(
  recipe: LayerRecipe,
  rect: TimelineMarqueeRect,
  pxPerSec: number,
  laneHeight = DEFAULT_LANE_HEIGHT
): string[] {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);

  const laneIndexById = new Map<string, number>();
  for (let i = 0; i < recipe.lanes.length; i++) {
    laneIndexById.set(recipe.lanes[i].id, i);
  }

  const hits: string[] = [];
  for (const clip of recipe.clips) {
    const laneIdx = laneIndexById.get(clip.laneId);
    if (laneIdx === undefined) continue;
    const clipLeft = clip.startSec * pxPerSec;
    const clipRight =
      clipLeft + Math.max(8, getClipRenderedDurationSec(clip) * pxPerSec);
    const clipTop = laneIdx * laneHeight + 2;
    const clipBottom = (laneIdx + 1) * laneHeight - 2;

    if (
      clipRight >= minX &&
      clipLeft <= maxX &&
      clipBottom >= minY &&
      clipTop <= maxY
    ) {
      hits.push(clip.id);
    }
  }
  return hits;
}

/**
 * Standard 2D timeline Shift+Click range selection between `anchorClipId` and `targetClipId`.
 * Selects all clips falling inside the lane + time span connecting the two clips.
 */
export function getShiftClickRangeClipIds(
  recipe: LayerRecipe,
  anchorClipId: string,
  targetClipId: string
): string[] {
  const laneIndexById = new Map<string, number>();
  for (let i = 0; i < recipe.lanes.length; i++) {
    laneIndexById.set(recipe.lanes[i].id, i);
  }
  const anchor = recipe.clips.find((c) => c.id === anchorClipId);
  const target = recipe.clips.find((c) => c.id === targetClipId);
  if (!anchor || !target) return target ? [target.id] : [];

  const anchorLane = laneIndexById.get(anchor.laneId);
  const targetLane = laneIndexById.get(target.laneId);
  if (anchorLane === undefined || targetLane === undefined) return [target.id];

  const minLane = Math.min(anchorLane, targetLane);
  const maxLane = Math.max(anchorLane, targetLane);
  const minSec = Math.min(anchor.startSec, target.startSec);
  const maxSec = Math.max(
    anchor.startSec + getClipRenderedDurationSec(anchor),
    target.startSec + getClipRenderedDurationSec(target)
  );

  const selected: string[] = [];
  for (const clip of recipe.clips) {
    const lIdx = laneIndexById.get(clip.laneId);
    if (lIdx === undefined || lIdx < minLane || lIdx > maxLane) continue;
    const cStart = clip.startSec;
    const cEnd = cStart + getClipRenderedDurationSec(clip);
    if (
      cEnd >= minSec - OVERLAP_EPSILON &&
      cStart <= maxSec + OVERLAP_EPSILON
    ) {
      selected.push(clip.id);
    }
  }
  return selected.length > 0 ? selected : [target.id];
}

/**
 * DaVinci Resolve Playhead-centered horizontal scroll calculation on zoom change.
 * Preserves playhead screen X position when visible, or centers playhead in the viewport
 * when off-screen, returning a scrollLeft clamped cleanly to `[0, maxScroll]`.
 */
export function computePlayheadCenteredScrollLeft(
  playheadSec: number,
  prevPxPerSec: number,
  nextPxPerSec: number,
  currentScrollLeft: number,
  viewportWidth: number,
  nextContentWidthPx: number
): number {
  const maxScroll = Math.max(0, nextContentWidthPx - viewportWidth);
  if (maxScroll <= 0) return 0;
  const playheadScreenX = playheadSec * prevPxPerSec - currentScrollLeft;
  const anchorScreenX =
    playheadScreenX >= 0 && playheadScreenX <= viewportWidth
      ? playheadScreenX
      : viewportWidth * 0.5;
  const rawNext = playheadSec * nextPxPerSec - anchorScreenX;
  return Math.max(0, Math.min(maxScroll, rawNext));
}
