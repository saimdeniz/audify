import { describe, expect, it } from "vitest";
import type { LayerClipSpec, LayerRecipe } from "../../types";
import {
  createSequentialLane,
  getNextLaneNumber,
  LAYER_LANE_PALETTE,
  MAX_LAYER_LANES,
  pickLaneColor,
} from "../../utils/layerHelpers";
import {
  buildDraggedClipsList,
  computeBodyDragFrame,
  computeEdgeAutoScrollStep,
  createBaseDragState,
  finalizeDragCommitRecipe,
} from "./layersTimelineDragHelpers";
import {
  getClipActiveFxBadges,
  getFxBadgeWidthTemplate,
} from "./layersClipFxBadges";
import {
  computePlayheadCenteredScrollLeft,
  getClipsInMarqueeRect,
  getShiftClickRangeClipIds,
  resolveSameLaneOverlaps,
} from "./layersTimelineEditOps";
import {
  applyLeftTrim,
  applyRightTrim,
  computeFitAllPxPerSec,
  DEFAULT_LANE_HEIGHT,
  getClipPitchMode,
  getClipRenderedDurationSec,
  hitTestTimelineClip,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  pxPerSecToSliderValue,
  sliderValueToPxPerSec,
  snapTimeSec,
  splitClipAtTimelineSec,
} from "./layersTimelineMath";

const BASE_CLIP: LayerClipSpec = {
  id: "c1",
  laneId: "l1",
  sourceSampleId: 1,
  sourcePath: "F:/SFX/hit.wav",
  sourceName: "hit.wav",
  startSec: 1.0,
  trimStartSec: 0.2,
  trimEndSec: 1.2,
  fadeInSec: 0.1,
  fadeOutSec: 0.15,
  gainDb: 0,
  pitchSemitones: 0,
  reversed: false,
};

const BASE_RECIPE: LayerRecipe = {
  version: 1,
  lanes: [
    {
      id: "l1",
      name: "Lane 1",
      colorHex: "#38BDF8",
      volumeDb: 0,
      muted: false,
      solo: false,
    },
  ],
  clips: [BASE_CLIP],
  masterGainDb: 0,
  snapEnabled: true,
  snapGridSec: 0.25,
};

describe("layersTimelineMath", () => {
  it("keeps exact clip duration in default Lock (preserve) mode and scales in Tape (varispeed) mode", () => {
    expect(getClipPitchMode(BASE_CLIP)).toBe("preserve");
    expect(getClipRenderedDurationSec(BASE_CLIP)).toBeCloseTo(1.0, 5);
    // Default Lock Length mode: duration stays 1.0s across ±24st
    expect(
      getClipRenderedDurationSec({ ...BASE_CLIP, pitchSemitones: 12 })
    ).toBeCloseTo(1.0, 5);
    expect(
      getClipRenderedDurationSec({ ...BASE_CLIP, pitchSemitones: 24 })
    ).toBeCloseTo(1.0, 5);
    expect(
      getClipRenderedDurationSec({ ...BASE_CLIP, pitchSemitones: -24 })
    ).toBeCloseTo(1.0, 5);

    // Explicit Tape (varispeed) mode: +12st halves duration, -12st doubles duration
    expect(
      getClipRenderedDurationSec({
        ...BASE_CLIP,
        pitchSemitones: 12,
        pitchMode: "varispeed",
      })
    ).toBeCloseTo(0.5, 5);
    expect(
      getClipRenderedDurationSec({
        ...BASE_CLIP,
        pitchSemitones: -12,
        pitchMode: "varispeed",
      })
    ).toBeCloseTo(2.0, 5);
  });

  it("summarizes active clip FX badges (Gain, Pitch, Reverse, Missing) deterministically", () => {
    expect(getClipActiveFxBadges(BASE_CLIP, false)).toEqual([]);

    const fxBadges = getClipActiveFxBadges(
      {
        ...BASE_CLIP,
        gainDb: 3.5,
        pitchSemitones: -7,
        pitchMode: "preserve",
        reversed: true,
      },
      false
    );
    expect(fxBadges).toEqual([
      { kind: "gain", label: "+3.5dB" },
      { kind: "pitch", label: "-7st" },
      { kind: "reverse", label: "REV" },
    ]);

    const tapeBadges = getClipActiveFxBadges(
      {
        ...BASE_CLIP,
        gainDb: -6,
        pitchSemitones: 12,
        pitchMode: "varispeed",
      },
      true
    );
    expect(tapeBadges).toEqual([
      { kind: "missing", label: "MISSING" },
      { kind: "gain", label: "-6.0dB" },
      { kind: "pitch", label: "+12st T" },
    ]);

    // Fixed-width badge templates prevent frame jitter when Gain/Pitch values change width
    expect(getFxBadgeWidthTemplate({ kind: "gain", label: "-6.0dB" })).toBe("-24.0dB");
    expect(getFxBadgeWidthTemplate({ kind: "gain", label: "-10.5dB" })).toBe("-24.0dB");
    expect(getFxBadgeWidthTemplate({ kind: "pitch", label: "+4st" })).toBe("+24st");
    expect(getFxBadgeWidthTemplate({ kind: "pitch", label: "-12st" })).toBe("+24st");
    expect(getFxBadgeWidthTemplate({ kind: "pitch", label: "+4st T" })).toBe("+24st T");
  });

  it("snaps time cleanly to grid when enabled and preserves precision when disabled", () => {
    expect(snapTimeSec(1.14, true, 0.25)).toBeCloseTo(1.25, 5);
    expect(snapTimeSec(1.14, false, 0.25)).toBeCloseTo(1.14, 5);
    expect(snapTimeSec(-0.5, true, 0.1)).toBe(0);
  });

  it("splits clips non-destructively at playhead preserving source continuity", () => {
    const res = splitClipAtTimelineSec(BASE_RECIPE, "c1", 1.4, () => "c2");
    expect(res).not.toBeNull();
    const [left, right] = res!.recipe.clips;
    expect(left.startSec).toBeCloseTo(1.0, 5);
    expect(left.trimStartSec).toBeCloseTo(0.2, 5);
    expect(left.trimEndSec).toBeCloseTo(0.6, 5);
    expect(right.id).toBe("c2");
    expect(right.startSec).toBeCloseTo(1.4, 5);
    expect(right.trimStartSec).toBeCloseTo(0.6, 5);
    expect(right.trimEndSec).toBeCloseTo(1.2, 5);
    expect(left.fadeOutSec).toBe(0);
    expect(right.fadeInSec).toBe(0);
  });

  it("trims left and right edges without inverting bounds or fades", () => {
    const trimmedL = applyLeftTrim(BASE_CLIP, 0.3);
    expect(trimmedL.startSec).toBeCloseTo(1.3, 5);
    expect(trimmedL.trimStartSec).toBeCloseTo(0.5, 5);

    const trimmedR = applyRightTrim(BASE_CLIP, -0.4, 2.0);
    expect(trimmedR.trimEndSec).toBeCloseTo(0.8, 5);
  });

  it("hit-tests fade handles, trim edges, and clip body at 1:1 lane coordinates", () => {
    // Lane 1 starts at y = 0 (fixed ruler is outside lane canvas)
    const hitFadeIn = hitTestTimelineClip(
      BASE_RECIPE,
      110,
      8,
      0,
      100,
      DEFAULT_LANE_HEIGHT
    );
    expect(hitFadeIn?.zone).toBe("fade-in");

    const hitBody = hitTestTimelineClip(
      BASE_RECIPE,
      150,
      30,
      0,
      100,
      DEFAULT_LANE_HEIGHT
    );
    expect(hitBody?.zone).toBe("body");

    const hitRight = hitTestTimelineClip(
      BASE_RECIPE,
      198,
      30,
      0,
      100,
      DEFAULT_LANE_HEIGHT
    );
    expect(hitRight?.zone).toBe("trim-right");
  });

  it("maps logarithmic DaVinci zoom slider across 4..2400 px/s and computes Fit All", () => {
    expect(sliderValueToPxPerSec(0)).toBe(MIN_PX_PER_SEC);
    expect(sliderValueToPxPerSec(100)).toBe(MAX_PX_PER_SEC);
    expect(pxPerSecToSliderValue(sliderValueToPxPerSec(50))).toBe(50);

    const fit = computeFitAllPxPerSec(BASE_RECIPE, 824);
    expect(fit).toBeGreaterThanOrEqual(MIN_PX_PER_SEC);
    expect(fit).toBeLessThanOrEqual(MAX_PX_PER_SEC);
  });

  it("enforces DaVinci same-lane Overwrite Trim (delete, trim left/right, punch-out split)", () => {
    const lane2 = { ...BASE_RECIPE.lanes[0], id: "l2", name: "Lane 2" };
    const mk = (id: string, laneId: string, startSec: number, durSec: number): LayerClipSpec => ({
      ...BASE_CLIP,
      id,
      laneId,
      startSec,
      trimStartSec: 0,
      trimEndSec: durSec,
      fadeInSec: 0,
      fadeOutSec: 0,
    });

    // Case 1: Full cover removes underlying clip on same lane, leaves other lane untouched
    const fullRecipe: LayerRecipe = {
      ...BASE_RECIPE,
      lanes: [BASE_RECIPE.lanes[0], lane2],
      clips: [mk("under", "l1", 1.0, 1.0), mk("otherLane", "l2", 1.0, 1.0), mk("top", "l1", 0.5, 3.0)],
    };
    const resFull = resolveSameLaneOverlaps(fullRecipe, new Set(["top"]), () => "split-1");
    expect(resFull.clips.map((c) => c.id).sort()).toEqual(["otherLane", "top"]);

    // Case 2: Left edge covered -> trims underlying left edge cleanly to top end
    const leftCover: LayerRecipe = {
      ...BASE_RECIPE,
      clips: [mk("under", "l1", 1.0, 2.0), mk("top", "l1", 0.5, 1.0)],
    };
    const resLeft = resolveSameLaneOverlaps(leftCover, new Set(["top"]), () => "split-2");
    const trimmedLeft = resLeft.clips.find((c) => c.id === "under")!;
    expect(trimmedLeft.startSec).toBeCloseTo(1.5, 4);
    expect(getClipRenderedDurationSec(trimmedLeft)).toBeCloseTo(1.5, 4);

    // Case 3: Right edge covered -> trims underlying right edge cleanly to top start
    const rightCover: LayerRecipe = {
      ...BASE_RECIPE,
      clips: [mk("under", "l1", 1.0, 2.0), mk("top", "l1", 2.2, 1.5)],
    };
    const resRight = resolveSameLaneOverlaps(rightCover, new Set(["top"]), () => "split-3");
    const trimmedRight = resRight.clips.find((c) => c.id === "under")!;
    expect(trimmedRight.startSec).toBeCloseTo(1.0, 4);
    expect(getClipRenderedDurationSec(trimmedRight)).toBeCloseTo(1.2, 4);

    // Case 4: Middle punch-out -> splits underlying clip into left + right around top
    const punchRecipe: LayerRecipe = {
      ...BASE_RECIPE,
      clips: [mk("under", "l1", 0.0, 5.0), mk("top", "l1", 1.5, 1.0)],
    };
    const resPunch = resolveSameLaneOverlaps(punchRecipe, new Set(["top"]), () => "right-piece");
    expect(resPunch.clips.map((c) => c.id).sort()).toEqual(["right-piece", "top", "under"]);
    const leftP = resPunch.clips.find((c) => c.id === "under")!;
    const rightP = resPunch.clips.find((c) => c.id === "right-piece")!;
    expect(leftP.startSec).toBeCloseTo(0.0, 4);
    expect(getClipRenderedDurationSec(leftP)).toBeCloseTo(1.5, 4);
    expect(rightP.startSec).toBeCloseTo(2.5, 4);
    expect(getClipRenderedDurationSec(rightP)).toBeCloseTo(2.5, 4);
  });

  it("supports marquee box selection and 2D Shift+Click range selection across lanes", () => {
    const lane2 = { ...BASE_RECIPE.lanes[0], id: "l2", name: "Lane 2" };
    const lane3 = { ...BASE_RECIPE.lanes[0], id: "l3", name: "Lane 3" };
    const mk = (id: string, laneId: string, startSec: number, durSec: number): LayerClipSpec => ({
      ...BASE_CLIP,
      id,
      laneId,
      startSec,
      trimStartSec: 0,
      trimEndSec: durSec,
    });
    const multiRecipe: LayerRecipe = {
      ...BASE_RECIPE,
      lanes: [BASE_RECIPE.lanes[0], lane2, lane3],
      clips: [
        mk("a", "l1", 0.5, 1.0),
        mk("b", "l2", 1.2, 1.0),
        mk("c", "l2", 3.0, 1.0),
        mk("d", "l3", 4.5, 1.0),
      ],
    };

    // Marquee covering x=[100..260] (1.0s..2.6s at 100px/s), y=[10..90] (Lane 1 & Lane 2)
    const marqueeHits = getClipsInMarqueeRect(
      multiRecipe,
      { x1: 100, y1: 10, x2: 260, y2: 90 },
      100,
      DEFAULT_LANE_HEIGHT
    );
    expect(marqueeHits).toEqual(["a", "b"]);

    // Shift+Click between "a" (L1, 0.5s) and "c" (L2, 3.0s) selects a, b, c (not d on L3)
    const shiftHits = getShiftClickRangeClipIds(multiRecipe, "a", "c");
    expect(shiftHits).toEqual(["a", "b", "c"]);
  });

  it("keeps playhead locked at screen X when zooming (DaVinci Playhead-centered zoom)", () => {
    // Playhead at 3s, prevPx=100, scrollLeft=100 => playheadScreenX = 200px
    // Zoom to 200px/s => 3*200 - 200 = 400px scrollLeft
    const nextScroll = computePlayheadCenteredScrollLeft(3.0, 100, 200, 100, 800, 3000);
    expect(nextScroll).toBeCloseTo(400, 3);

    // Off-screen playhead centers in viewport
    const centered = computePlayheadCenteredScrollLeft(10.0, 100, 200, 0, 800, 4000);
    expect(centered).toBeCloseTo(1600, 3);
  });

  it("assigns sequential Lane N names without duplicates after lane deletion", () => {
    const l1 = { ...BASE_RECIPE.lanes[0], id: "a", name: "Lane 1" };
    const l3 = { ...BASE_RECIPE.lanes[0], id: "c", name: "Lane 3" };
    expect(getNextLaneNumber([l1, l3])).toBe(2);
    expect(createSequentialLane([l1, l3]).name).toBe("Lane 2");
  });

  it("caps downward Ghost Lane drag creation to +1 lane per drop up to 64 lanes", () => {
    expect(MAX_LAYER_LANES).toBe(64);
    const drag = createBaseDragState({
      mode: "body",
      clipId: "c1",
      origClip: BASE_CLIP,
      origLaneIndex: 0,
      dragClips: buildDraggedClipsList(BASE_RECIPE, ["c1"], false),
      startClientX: 100,
      startClientY: 20,
      origScrollLeft: 0,
      origScrollTop: 0,
      baseRecipe: BASE_RECIPE,
    });

    // Dragging far downward (5 lane heights) still previews & commits strictly +1 new lane
    const frame = computeBodyDragFrame({
      drag,
      clientX: 100,
      clientY: 20 + DEFAULT_LANE_HEIGHT * 5,
      shiftKey: false,
      ctrlOrMetaKey: false,
      pxPerSec: 100,
      laneHeight: DEFAULT_LANE_HEIGHT,
      snapEnabled: false,
      snapGridSec: 0.1,
    });
    expect(frame.needNewLanes).toBe(1);
    expect(frame.ghostPreview?.isNewLane).toBe(true);
    expect(frame.ghostPreview?.laneIndex).toBe(1);

    drag.pendingNewLanesCount = frame.needNewLanes;
    const committed = finalizeDragCommitRecipe(
      drag,
      frame.nextRecipe,
      20 + DEFAULT_LANE_HEIGHT * 5,
      DEFAULT_LANE_HEIGHT
    );
    expect(committed.lanes).toHaveLength(2);
    expect(committed.clips[0].laneId).toBe(committed.lanes[1].id);
  });

  it("computes accelerated edge auto-scroll velocity near left/right timeline edges", () => {
    expect(computeEdgeAutoScrollStep(300, 100, 600)).toBe(0);
    expect(computeEdgeAutoScrollStep(110, 100, 600)).toBeLessThan(0);
    expect(computeEdgeAutoScrollStep(50, 100, 600)).toBeLessThan(
      computeEdgeAutoScrollStep(110, 100, 600)
    );
    expect(computeEdgeAutoScrollStep(590, 100, 600)).toBeGreaterThan(0);
    expect(computeEdgeAutoScrollStep(660, 100, 600)).toBeGreaterThan(
      computeEdgeAutoScrollStep(590, 100, 600)
    );
  });

  it("uses curated 8-color palette for Lanes 1-8 and unique 16M hex colors across Lanes 9-64", () => {
    const colors = Array.from({ length: 64 }, (_, i) => pickLaneColor(i));
    expect(colors.slice(0, 8)).toEqual([...LAYER_LANE_PALETTE]);
    for (const hex of colors) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(new Set(colors).size).toBe(64);
  });

  it("untrims reversed clips leftward up to sourceDurationSec and caps right trim for external clips", () => {
    const revClip: LayerClipSpec = {
      ...BASE_CLIP,
      sourceSampleId: null,
      sourceDurationSec: 2.0,
      startSec: 1.0,
      trimStartSec: 0.2,
      trimEndSec: 1.2,
      reversed: true,
    };
    const untrimmedLeft = applyLeftTrim(revClip, -0.5, revClip.sourceDurationSec);
    expect(untrimmedLeft.startSec).toBeCloseTo(0.5, 5);
    expect(untrimmedLeft.trimEndSec).toBeCloseTo(1.7, 5);

    // Expanding past maxSourceDurationSec clamps cleanly to 2.0s
    const clampedLeft = applyLeftTrim(revClip, -1.5, revClip.sourceDurationSec);
    expect(clampedLeft.trimEndSec).toBeCloseTo(2.0, 5);

    // Right trim on external clip (sourceSampleId: null) falls back to clip.sourceDurationSec
    const extClip: LayerClipSpec = {
      ...BASE_CLIP,
      sourceSampleId: null,
      sourceDurationSec: 1.5,
      trimStartSec: 0.2,
      trimEndSec: 1.0,
      reversed: false,
    };
    const cappedRight = applyRightTrim(extClip, 2.0);
    expect(cappedRight.trimEndSec).toBeCloseTo(1.5, 5);
  });

  it("prioritizes selected clips in hit-test Z-order and protects trim edges when fade is 0", () => {
    const c1: LayerClipSpec = {
      ...BASE_CLIP,
      id: "c1",
      startSec: 1.0,
      trimStartSec: 0,
      trimEndSec: 1.0,
      fadeInSec: 0,
      fadeOutSec: 0,
    };
    const c2: LayerClipSpec = {
      ...c1,
      id: "c2",
    };
    const recipe: LayerRecipe = { ...BASE_RECIPE, clips: [c1, c2] };
    // Even though c2 is later in array, selecting c1 gives c1 Z-order priority
    const hitSelected = hitTestTimelineClip(
      recipe,
      150,
      25,
      0,
      100,
      DEFAULT_LANE_HEIGHT,
      new Set(["c1"])
    );
    expect(hitSelected?.clip.id).toBe("c1");

    // Near bottom-left edge with fadeIn=0 must resolve to trim-left (not fade-in)
    const hitLeftEdge = hitTestTimelineClip(
      recipe,
      102,
      30,
      0,
      100,
      DEFAULT_LANE_HEIGHT
    );
    expect(hitLeftEdge?.zone).toBe("trim-left");
  });
});
