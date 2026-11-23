import { describe, expect, it } from "vitest";
import {
  computeInterpolatedPlayheadSec,
  type PlayheadAnchor,
} from "./nativeAudioClient";

describe("nativeAudioClient monotonic playhead interpolation", () => {
  it("advances linearly by playbackRate and subtracts latency cleanly", () => {
    const anchor: PlayheadAnchor = {
      positionSec: 1.0,
      anchorMs: 1000,
      playbackRate: 2.0, // +12 semitones
      durationSec: 10.0,
      isPlaying: true,
      outputLatencyMs: 20,
    };

    // 250ms elapsed at 2x speed = +0.50s -> 1.50s - 0.02s latency = 1.48s
    const autoPos = computeInterpolatedPlayheadSec(
      anchor,
      1250,
      null,
      null,
      false
    );
    expect(autoPos).toBeCloseTo(1.48, 4);

    // Manual override latency (50ms) supersedes outputLatencyMs
    const manualPos = computeInterpolatedPlayheadSec(
      anchor,
      1250,
      50,
      null,
      false
    );
    expect(manualPos).toBeCloseTo(1.45, 4);
  });

  it("wraps seamlessly inside an active looping slice and clamps when non-looping", () => {
    const anchor: PlayheadAnchor = {
      positionSec: 0.45,
      anchorMs: 1000,
      playbackRate: 1.0,
      durationSec: 4.0,
      isPlaying: true,
      outputLatencyMs: 0,
    };
    const slice = { startSec: 0.2, endSec: 0.5 };

    // 100ms elapsed -> 0.55s wraps over [0.2, 0.5] (span 0.3s) -> 0.25s
    const wrapped = computeInterpolatedPlayheadSec(
      anchor,
      1100,
      0,
      slice,
      true
    );
    expect(wrapped).toBeCloseTo(0.25, 4);

    // Non-looping clamps cleanly at slice endSec (0.5s)
    const clamped = computeInterpolatedPlayheadSec(
      anchor,
      1100,
      0,
      slice,
      false
    );
    expect(clamped).toBeCloseTo(0.5, 4);
  });

  it("holds position steady when paused", () => {
    const anchor: PlayheadAnchor = {
      positionSec: 2.25,
      anchorMs: 1000,
      playbackRate: 1.5,
      durationSec: 5.0,
      isPlaying: false,
      outputLatencyMs: 10,
    };
    const pos = computeInterpolatedPlayheadSec(anchor, 5000, 0, null, false);
    expect(pos).toBeCloseTo(2.25, 4);
  });
});
