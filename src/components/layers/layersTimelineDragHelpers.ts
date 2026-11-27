import type { LayerClipSpec, LayerRecipe } from "../../types";
import {
  createSequentialLane,
  makeLayerClipId,
  MAX_LAYER_LANES,
} from "../../utils/layerHelpers";
import {
  applyLeftTrim,
  applyRightTrim,
  getClipRenderedDurationSec,
  resolveSameLaneOverlaps,
  snapTimeSec,
  TimelineClipHitZone,
} from "./layersTimelineMath";
import type { TimelineDropPreview } from "./layersTimelineRenderer";

export interface DraggedClipMeta {
  orig: LayerClipSpec;
  origLaneIndex: number;
  activeId: string;
}

export interface ActiveDragState {
  mode: "scrub" | "hand" | "marquee" | TimelineClipHitZone;
  clipId: string;
  startClientX: number;
  startClientY: number;
  origScrollLeft: number;
  origScrollTop: number;
  viewportLeft: number;
  viewportRight: number;
  viewportTop: number;
  origClip: LayerClipSpec | null;
  origLaneIndex: number;
  dragClips: DraggedClipMeta[];
  isAltClone: boolean;
  collapseToSingleOnClick: boolean;
  baseRecipe: LayerRecipe;
  dirty: boolean;
  pendingNewLanesCount: number;
  marqueeOriginX: number;
  marqueeOriginY: number;
  marqueeBaseSelected: string[];
  marqueeMode: "replace" | "add" | "toggle";
}

export const TIMELINE_EDGE_SCROLL_ZONE_PX = 36;
const MAX_EDGE_SCROLL_PX_PER_FRAME = 28;

/**
 * Computes horizontal edge auto-scroll velocity (px per 60fps frame) when dragging
 * near or past the left/right edges of the timeline viewport.
 */
export function computeEdgeAutoScrollStep(
  clientX: number,
  viewportLeft: number,
  viewportRight: number
): number {
  if (viewportRight <= viewportLeft) return 0;
  const leftDist = viewportLeft + TIMELINE_EDGE_SCROLL_ZONE_PX - clientX;
  if (leftDist > 0) {
    return -Math.min(MAX_EDGE_SCROLL_PX_PER_FRAME, 2.5 + leftDist * 0.28);
  }
  const rightDist = clientX - (viewportRight - TIMELINE_EDGE_SCROLL_ZONE_PX);
  if (rightDist > 0) {
    return Math.min(MAX_EDGE_SCROLL_PX_PER_FRAME, 2.5 + rightDist * 0.28);
  }
  return 0;
}

export function createBaseDragState(
  overrides: Partial<ActiveDragState> &
    Pick<
      ActiveDragState,
      "mode" | "startClientX" | "startClientY" | "origScrollLeft" | "origScrollTop" | "baseRecipe"
    >
): ActiveDragState {
  return {
    clipId: "",
    viewportLeft: 0,
    viewportRight: 0,
    viewportTop: 0,
    origClip: null,
    origLaneIndex: 0,
    dragClips: [],
    isAltClone: false,
    collapseToSingleOnClick: false,
    dirty: false,
    pendingNewLanesCount: 0,
    marqueeOriginX: 0,
    marqueeOriginY: 0,
    marqueeBaseSelected: [],
    marqueeMode: "replace",
    ...overrides,
  };
}

export function buildDraggedClipsList(
  recipe: LayerRecipe,
  targetIds: readonly string[],
  isAltClone: boolean
): DraggedClipMeta[] {
  const laneIdxById = new Map<string, number>();
  recipe.lanes.forEach((l, idx) => laneIdxById.set(l.id, idx));
  const idSet = new Set(targetIds);
  const result: DraggedClipMeta[] = [];
  for (const clip of recipe.clips) {
    if (!idSet.has(clip.id)) continue;
    const lIdx = laneIdxById.get(clip.laneId);
    if (lIdx === undefined) continue;
    result.push({
      orig: { ...clip },
      origLaneIndex: lIdx,
      activeId: isAltClone ? makeLayerClipId() : clip.id,
    });
  }
  return result;
}

export function combineMarqueeSelection(
  mode: "replace" | "add" | "toggle",
  baseSelected: readonly string[],
  hits: readonly string[]
): string[] {
  if (mode === "add") {
    return Array.from(new Set([...baseSelected, ...hits]));
  }
  if (mode === "toggle") {
    const next = new Set(baseSelected);
    for (const id of hits) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    return Array.from(next);
  }
  return [...hits];
}

export function computeBodyDragFrame(params: {
  drag: ActiveDragState;
  clientX: number;
  clientY: number;
  scrollDeltaPx?: number;
  shiftKey: boolean;
  ctrlOrMetaKey: boolean;
  pxPerSec: number;
  laneHeight: number;
  snapEnabled: boolean;
  snapGridSec: number;
}): {
  nextRecipe: LayerRecipe;
  needNewLanes: number;
  ghostPreview: TimelineDropPreview | null;
} {
  const {
    drag,
    clientX,
    clientY,
    scrollDeltaPx = 0,
    shiftKey,
    ctrlOrMetaKey,
    pxPerSec,
    laneHeight,
    snapEnabled,
    snapGridSec,
  } = params;
  const orig = drag.origClip!;
  const base = drag.baseRecipe;
  const deltaSec = (clientX - drag.startClientX + scrollDeltaPx) / pxPerSec;

  const rawLaneShift = Math.round((clientY - drag.startClientY) / laneHeight);
  const minOrigLane = Math.min(...drag.dragClips.map((d) => d.origLaneIndex));
  const maxOrigLane = Math.max(...drag.dragClips.map((d) => d.origLaneIndex));
  // Cap downward shift to match the single Ghost Lane preview (at most +1 new lane per drop)
  const maxAllowedTargetLane = Math.min(MAX_LAYER_LANES - 1, base.lanes.length);
  const maxAllowedShift = Math.max(0, maxAllowedTargetLane - maxOrigLane);
  const laneShift = Math.max(
    -minOrigLane,
    Math.min(maxAllowedShift, rawLaneShift)
  );
  const needNewLanes = Math.min(
    1,
    Math.max(0, maxOrigLane + laneShift - (base.lanes.length - 1))
  );

  // Shift+Drag locks horizontal time (DaVinci vertical-only move)
  const rawAnchorStart = shiftKey ? orig.startSec : Math.max(0, orig.startSec + deltaSec);
  const snappedAnchorStart = shiftKey
    ? orig.startSec
    : snapTimeSec(rawAnchorStart, snapEnabled && !ctrlOrMetaKey, snapGridSec);
  const minOrigStart = Math.min(...drag.dragClips.map((d) => d.orig.startSec));
  const clampedDeltaSec = Math.max(-minOrigStart, snappedAnchorStart - orig.startSec);

  let ghostPreview: TimelineDropPreview | null = null;
  if (needNewLanes > 0) {
    const leadClip =
      drag.dragClips.find((d) => d.origLaneIndex + laneShift >= base.lanes.length) ??
      drag.dragClips[0];
    ghostPreview = {
      laneIndex: base.lanes.length,
      isNewLane: true,
      startSec: Math.max(0, leadClip.orig.startSec + clampedDeltaSec),
      durationSec: getClipRenderedDurationSec(leadClip.orig),
      label: leadClip.orig.sourceName,
    };
  }

  const updatedByOrigId = new Map<string, LayerClipSpec>();
  const clonedClips: LayerClipSpec[] = [];
  for (const item of drag.dragClips) {
    const targetLaneIdx = Math.min(
      base.lanes.length - 1,
      Math.max(0, item.origLaneIndex + laneShift)
    );
    const moved: LayerClipSpec = {
      ...item.orig,
      id: item.activeId,
      laneId: base.lanes[targetLaneIdx].id,
      startSec: Math.max(0, item.orig.startSec + clampedDeltaSec),
    };
    if (drag.isAltClone) clonedClips.push(moved);
    else updatedByOrigId.set(item.orig.id, moved);
  }

  return {
    nextRecipe: {
      ...base,
      clips: drag.isAltClone
        ? [...base.clips, ...clonedClips]
        : base.clips.map((c) => updatedByOrigId.get(c.id) ?? c),
    },
    needNewLanes,
    ghostPreview,
  };
}

export function applyTrimOrFadeDrag(
  mode: Exclude<TimelineClipHitZone, "body">,
  orig: LayerClipSpec,
  deltaSec: number,
  sourceDurationBySampleId: ReadonlyMap<number, number>
): LayerClipSpec {
  if (mode === "trim-left") return applyLeftTrim(orig, deltaSec);
  if (mode === "trim-right") {
    const maxDur =
      orig.sourceSampleId !== null
        ? sourceDurationBySampleId.get(orig.sourceSampleId)
        : undefined;
    return applyRightTrim(orig, deltaSec, maxDur);
  }
  const maxFade = getClipRenderedDurationSec(orig) * 0.5;
  if (mode === "fade-in") {
    return { ...orig, fadeInSec: Math.max(0, Math.min(maxFade, orig.fadeInSec + deltaSec)) };
  }
  return { ...orig, fadeOutSec: Math.max(0, Math.min(maxFade, orig.fadeOutSec - deltaSec)) };
}

export function finalizeDragCommitRecipe(
  drag: ActiveDragState,
  liveRecipe: LayerRecipe,
  releaseClientY: number,
  laneHeight: number
): LayerRecipe {
  let committed = liveRecipe;

  if (drag.mode === "body" && drag.pendingNewLanesCount > 0) {
    const nextLanes = [...committed.lanes];
    const toCreate = Math.min(1, drag.pendingNewLanesCount);
    for (let i = 0; i < toCreate && nextLanes.length < MAX_LAYER_LANES; i++) {
      nextLanes.push(createSequentialLane(nextLanes));
    }
    const rawLaneShift = Math.round((releaseClientY - drag.startClientY) / laneHeight);
    const minOrigLane = Math.min(...drag.dragClips.map((d) => d.origLaneIndex));
    const maxOrigLane = Math.max(...drag.dragClips.map((d) => d.origLaneIndex));
    const laneShift = Math.max(
      -minOrigLane,
      Math.min(nextLanes.length - 1 - maxOrigLane, rawLaneShift)
    );
    const targetLaneByActiveId = new Map<string, string>();
    for (const item of drag.dragClips) {
      const idx = Math.max(0, Math.min(nextLanes.length - 1, item.origLaneIndex + laneShift));
      targetLaneByActiveId.set(item.activeId, nextLanes[idx].id);
    }
    committed = {
      ...committed,
      lanes: nextLanes,
      clips: committed.clips.map((c) => {
        const newLaneId = targetLaneByActiveId.get(c.id);
        return newLaneId ? { ...c, laneId: newLaneId } : c;
      }),
    };
  }

  if (drag.mode === "body" || drag.mode === "trim-left" || drag.mode === "trim-right") {
    const priorityIds = new Set(
      drag.mode === "body" ? drag.dragClips.map((d) => d.activeId) : [drag.clipId]
    );
    committed = resolveSameLaneOverlaps(committed, priorityIds, makeLayerClipId);
  }

  return committed;
}

export interface TimelineKeyCommandHandlers {
  recipe: LayerRecipe;
  viewportWidth: number;
  onFitAll: (width: number) => void;
  onSelectClips: (ids: string[]) => void;
  onCopySelected: () => void;
  onPasteAtPlayhead: () => void;
  onDuplicateSelected: () => void;
  onSplitAtPlayhead: () => void;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPlayOrRenderDraft: () => void;
}

export function dispatchTimelineKeyDown(
  e: {
    target: EventTarget | null;
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  h: TimelineKeyCommandHandlers
): void {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  const intercept = () => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (e.shiftKey && !mod && key === "z") {
    intercept();
    h.onFitAll(h.viewportWidth);
  } else if (mod && key === "z") {
    intercept();
    if (e.shiftKey) h.onRedo();
    else h.onUndo();
  } else if (mod && key === "y") {
    intercept();
    h.onRedo();
  } else if (mod && key === "a") {
    intercept();
    h.onSelectClips(h.recipe.clips.map((c) => c.id));
  } else if (mod && key === "c") {
    intercept();
    h.onCopySelected();
  } else if (mod && key === "v") {
    intercept();
    h.onPasteAtPlayhead();
  } else if (mod && key === "d") {
    intercept();
    h.onDuplicateSelected();
  } else if (!mod && key === "s") {
    intercept();
    h.onSplitAtPlayhead();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    intercept();
    h.onDeleteSelected();
  } else if (e.key === " ") {
    intercept();
    h.onPlayOrRenderDraft();
  }
}

export function buildExternalDropPreview(params: {
  x: number;
  y: number;
  scrollLeft: number;
  pxPerSec: number;
  laneHeight: number;
  laneCount: number;
  snapEnabled: boolean;
  bypassSnap: boolean;
  snapGridSec: number;
  leadFileName: string;
  leadDurationMs: number;
}): TimelineDropPreview {
  const {
    x,
    y,
    scrollLeft,
    pxPerSec,
    laneHeight,
    laneCount,
    snapEnabled,
    bypassSnap,
    snapGridSec,
    leadFileName,
    leadDurationMs,
  } = params;
  const rawLane = Math.floor(Math.max(0, y) / laneHeight);
  const isNewLane = rawLane >= laneCount && laneCount < MAX_LAYER_LANES;
  const laneIndex = isNewLane
    ? laneCount
    : Math.max(0, Math.min(laneCount - 1, rawLane));
  return {
    laneIndex,
    isNewLane,
    startSec: snapTimeSec(
      Math.max(0, (x + scrollLeft) / pxPerSec),
      snapEnabled && !bypassSnap,
      snapGridSec
    ),
    durationSec: Math.max(0.25, (leadDurationMs || 1200) / 1000),
    label: leadFileName,
  };
}
