import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAVEFORM_VIEWPORT,
  MAX_WAVEFORM_ZOOM,
  panWaveformViewportByScreenDelta,
  screenRatioToTrackRatio,
  trackRatioToScreenRatio,
  zoomWaveformViewportAt,
} from "./waveformViewport";

describe("waveformViewport", () => {
  it("keeps the track point under the cursor anchored when zooming in and out", () => {
    const cursor = 0.35;
    const zoomed = zoomWaveformViewportAt(DEFAULT_WAVEFORM_VIEWPORT, cursor, 4);
    expect(zoomed.zoom).toBeCloseTo(4, 5);
    expect(screenRatioToTrackRatio(cursor, zoomed)).toBeCloseTo(cursor, 5);

    const zoomedFurther = zoomWaveformViewportAt(zoomed, 0.7, 2);
    const before = screenRatioToTrackRatio(0.7, zoomed);
    const after = screenRatioToTrackRatio(0.7, zoomedFurther);
    expect(after).toBeCloseTo(before, 5);
  });

  it("clamps zoom to [1, MAX_WAVEFORM_ZOOM] and snaps near-1x back to default", () => {
    const maxed = zoomWaveformViewportAt(DEFAULT_WAVEFORM_VIEWPORT, 0.5, 500);
    expect(maxed.zoom).toBe(MAX_WAVEFORM_ZOOM);
    expect(maxed.startRatio).toBeGreaterThanOrEqual(0);
    expect(maxed.startRatio + 1 / maxed.zoom).toBeLessThanOrEqual(1 + 1e-6);

    const reset = zoomWaveformViewportAt({ zoom: 1.02, startRatio: 0.01 }, 0.5, 1);
    expect(reset).toEqual(DEFAULT_WAVEFORM_VIEWPORT);
  });

  it("pans within [0, 1 - 1/zoom] and round-trips screen/track coordinates", () => {
    const zoomed = { zoom: 4, startRatio: 0.25 };
    const pannedRight = panWaveformViewportByScreenDelta(zoomed, 0.5);
    expect(pannedRight.startRatio).toBeCloseTo(0.375, 5);

    const clampedEnd = panWaveformViewportByScreenDelta(zoomed, 10);
    expect(clampedEnd.startRatio).toBeCloseTo(0.75, 5);

    const clampedStart = panWaveformViewportByScreenDelta(zoomed, -10);
    expect(clampedStart.startRatio).toBe(0);

    const track = screenRatioToTrackRatio(0.6, zoomed);
    expect(trackRatioToScreenRatio(track, zoomed)).toBeCloseTo(0.6, 5);
  });
});
