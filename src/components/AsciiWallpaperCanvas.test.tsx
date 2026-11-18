// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { AsciiWallpaperCanvas } from "./AsciiWallpaperCanvas";
import { setAppFocusedState } from "../utils/appFocusMonitor";
import type { AsciiRenderParams } from "../utils/asciiPresets/shared";

const rendererSpy = vi.fn<(params: AsciiRenderParams) => void>();

vi.mock("../utils/asciiWallpaperEngine", () => ({
  getCachedAsciiPresetRenderer: () => rendererSpy,
  loadAsciiPresetRenderer: () => Promise.resolve(rendererSpy),
}));

describe("AsciiWallpaperCanvas motionSpeed Pause -> Resume lifecycle", () => {
  let nextRafId = 1;
  let rafQueue = new Map<number, FrameRequestCallback>();
  let nowMs = 1000;

  class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }

  const flushRafFrame = (stepMs: number) => {
    nowMs += stepMs;
    const pending = Array.from(rafQueue.entries());
    rafQueue.clear();
    for (const [, cb] of pending) {
      cb(nowMs);
    }
  };

  beforeEach(() => {
    rendererSpy.mockClear();
    nextRafId = 1;
    rafQueue = new Map();
    nowMs = 1000;

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        width: 320,
        height: 180,
        top: 0,
        left: 0,
        right: 320,
        bottom: 180,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          save: vi.fn(),
          setTransform: vi.fn(),
          restore: vi.fn(),
        }) as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    setAppFocusedState(true);
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const lastRenderedTime = () => {
    const calls = rendererSpy.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1][0].timeSec : 0;
  };

  it("restarts the RAF loop after transitioning from Pause (0) back to Calm/Normal/Lively", () => {
    const { rerender } = render(
      <AsciiWallpaperCanvas
        wallpaperKind="ascii_preset"
        asciiPreset="aurora_cabin"
        motionSpeed={1}
        accentHex="#38bdf8"
        themeMode="dark"
      />
    );

    const initialCalls = rendererSpy.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    // Advance while playing -> timeSec moves forward
    act(() => {
      flushRafFrame(40);
      flushRafFrame(40);
    });
    const activeTime = lastRenderedTime();
    expect(activeTime).toBeGreaterThan(2.4);

    // Pause -> queue drains and RAF loop stops
    rerender(
      <AsciiWallpaperCanvas
        wallpaperKind="ascii_preset"
        asciiPreset="aurora_cabin"
        motionSpeed={0}
        accentHex="#38bdf8"
        themeMode="dark"
      />
    );
    act(() => {
      flushRafFrame(40);
      flushRafFrame(40);
    });
    expect(rafQueue.size).toBe(0);
    const pausedCalls = rendererSpy.mock.calls.length;

    // Extra ticks while paused do not render frames
    act(() => {
      flushRafFrame(40);
    });
    expect(rendererSpy.mock.calls.length).toBe(pausedCalls);

    // Resume at Calm (0.5) -> loop must restart and continue advancing timeSec
    rerender(
      <AsciiWallpaperCanvas
        wallpaperKind="ascii_preset"
        asciiPreset="aurora_cabin"
        motionSpeed={0.5}
        accentHex="#38bdf8"
        themeMode="dark"
      />
    );
    expect(rafQueue.size).toBeGreaterThan(0);

    const pausedTime = lastRenderedTime();
    act(() => {
      flushRafFrame(40);
      flushRafFrame(40);
      flushRafFrame(40);
    });

    const resumedTime = lastRenderedTime();
    expect(rendererSpy.mock.calls.length).toBeGreaterThan(pausedCalls + 1);
    expect(resumedTime).toBeGreaterThan(pausedTime);
    expect(rafQueue.size).toBeGreaterThan(0);
  });

  it("starts animating when mounted at Pause (0) and later switched to Lively (1.5)", () => {
    const { rerender } = render(
      <AsciiWallpaperCanvas
        wallpaperKind="ascii_preset"
        asciiPreset="aurora_cabin"
        motionSpeed={0}
        accentHex="#38bdf8"
        themeMode="dark"
      />
    );
    // Drain the coalesced initial static redraw; RAF loop itself must not stay active
    act(() => {
      flushRafFrame(40);
      flushRafFrame(40);
    });
    expect(rafQueue.size).toBe(0);
    const startTime = lastRenderedTime();

    rerender(
      <AsciiWallpaperCanvas
        wallpaperKind="ascii_preset"
        asciiPreset="aurora_cabin"
        motionSpeed={1.5}
        accentHex="#38bdf8"
        themeMode="dark"
      />
    );
    expect(rafQueue.size).toBeGreaterThan(0);

    act(() => {
      flushRafFrame(40);
      flushRafFrame(40);
    });
    const runningTime = lastRenderedTime();
    expect(runningTime).toBeGreaterThan(startTime);
  });

  it("pauses RAF frames when Audify loses app-wide focus and resumes when focus returns", () => {
    render(
      <AsciiWallpaperCanvas
        wallpaperKind="ascii_preset"
        asciiPreset="aurora_cabin"
        motionSpeed={1}
        accentHex="#38bdf8"
        themeMode="dark"
      />
    );

    act(() => {
      flushRafFrame(40);
    });
    expect(rafQueue.size).toBeGreaterThan(0);

    // App goes to background -> RAF stops without stopping motionSpeed setting
    act(() => {
      setAppFocusedState(false);
    });
    expect(rafQueue.size).toBe(0);
    const pausedCalls = rendererSpy.mock.calls.length;

    act(() => {
      flushRafFrame(40);
    });
    expect(rendererSpy.mock.calls.length).toBe(pausedCalls);

    // App regains focus -> RAF resumes cleanly
    act(() => {
      setAppFocusedState(true);
    });
    expect(rafQueue.size).toBeGreaterThan(0);
    act(() => {
      flushRafFrame(40);
    });
    expect(rendererSpy.mock.calls.length).toBeGreaterThan(pausedCalls);
  });
});
