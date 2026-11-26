// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleItem, WaveformSensitivity } from "../../types";
import { samplePeakRange, sampleWaveformEnvelope } from "../../utils/waveformPeaks";
import { renderWaveformDeck } from "./waveformDeckRenderer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { WaveformDeckCanvas } from "./WaveformDeckCanvas";

function makeStub2dContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 32 })),
    setLineDash: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    globalAlpha: 1,
  };
}

function makeSample(overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id: 42,
    library_id: 1,
    file_path: "D:/SFX/ZoomPerfTest.wav",
    file_name: "ZoomPerfTest.wav",
    folder_path: "D:/SFX",
    extension: "wav",
    duration_ms: 8000,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 400000,
    is_favorite: false,
    is_loop: false,
    genre: "Ambient",
    artist: "",
    album: "",
    year: "",
    peaks_json: JSON.stringify([0.1, 0.5, 0.9, 0.3, 0.7, 0.2]),
    created_at: "2026-11-25",
    tags: [],
    ...overrides,
  };
}

describe("waveform zoom performance and layer reuse", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => makeStub2dContext() as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("allocates zero offscreen canvases during interactive zoom and reuses cached layers in-place on settle", () => {
    const mainCanvas = document.createElement("canvas");
    const origCreateElement = document.createElement.bind(document);
    let createdOffscreenCanvases = 0;

    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      if (tagName.toLowerCase() === "canvas") {
        createdOffscreenCanvases += 1;
      }
      return origCreateElement(tagName, options);
    }) as typeof document.createElement);

    const hiResPeaks = Array.from({ length: 2400 }, (_, i) =>
      Math.abs(Math.sin(i * 0.05))
    );
    const baseOpts = {
      sampleId: 42,
      peaksJson: "[]",
      hiResPeaks,
      effectiveDuration: 8,
      sliceRange: null,
      hoverRatio: null,
      hoverZone: "none" as const,
      themeMode: "dark" as const,
      accentColor: "#F59E0B",
      enableMica: false,
      waveformSensitivity: "logarithmic" as const,
      waveformStyle: "solid_baseline" as const,
      logicalWidth: 960,
      logicalHeight: 80,
      dpr: 1.5,
    };

    // 1. Initial idle render (no slice): allocates only base + played (2 canvases, lazy slice = null)
    const initialCache = renderWaveformDeck(mainCanvas, null, {
      ...baseOpts,
      viewport: { zoom: 1, startRatio: 0 },
      interactive: false,
    });
    expect(initialCache).not.toBeNull();
    expect(initialCache?.slice).toBeNull();
    expect(createdOffscreenCanvases).toBe(2);

    // 2. 20 consecutive interactive zoom/pan frames: ZERO canvas allocations, cache preserved
    let curCache = initialCache;
    for (let step = 1; step <= 20; step++) {
      curCache = renderWaveformDeck(mainCanvas, curCache, {
        ...baseOpts,
        viewport: { zoom: 1 + step * 0.5, startRatio: step * 0.01 },
        interactive: true,
      });
    }
    expect(createdOffscreenCanvases).toBe(2);
    expect(curCache).toBe(initialCache);

    // 3. Settle frame after zooming stops: reuses existing base & played canvases in-place (0 new allocations!)
    const settledCache = renderWaveformDeck(mainCanvas, curCache, {
      ...baseOpts,
      viewport: { zoom: 11, startRatio: 0.2 },
      interactive: false,
    });
    expect(settledCache).toBe(initialCache);
    expect(settledCache?.slice).toBeNull();
    expect(createdOffscreenCanvases).toBe(2);

    // 4. Adding a slice lazily allocates the 1 slice canvas and reuses it thereafter
    const withSliceCache = renderWaveformDeck(mainCanvas, settledCache, {
      ...baseOpts,
      sliceRange: { startSec: 2, endSec: 3.5 },
      viewport: { zoom: 11, startRatio: 0.2 },
      interactive: false,
    });
    expect(withSliceCache).toBe(initialCache);
    expect(withSliceCache?.slice).not.toBeNull();
    expect(createdOffscreenCanvases).toBe(3);

    // 5. preservePrevCache = true (active crossfade) allocates fresh layers without mutating prevCache
    const freshCache = renderWaveformDeck(mainCanvas, withSliceCache, {
      ...baseOpts,
      sliceRange: null,
      viewport: { zoom: 11, startRatio: 0.2 },
      interactive: false,
      preservePrevCache: true,
      waveformStyle: "symmetric",
    });
    expect(freshCache).not.toBe(withSliceCache);
    expect(createdOffscreenCanvases).toBe(5);
  });

  it("matches exact samplePeakRange + 3-tap smoothing via LUT without per-pixel Math.pow", () => {
    const peaks = new Float32Array(6000);
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] = Math.abs(Math.sin(i * 0.017) * Math.cos(i * 0.003));
    }
    const width = 512;
    const viewStart = 0.18;
    const viewSpan = 0.25;
    const sensitivities: WaveformSensitivity[] = [
      "logarithmic",
      "high_boost",
      "linear",
    ];
    const scratchRaw = new Float32Array(width);
    const scratchEnv = new Float32Array(width);

    for (const sensitivity of sensitivities) {
      sampleWaveformEnvelope(
        peaks,
        viewStart,
        viewSpan,
        width,
        sensitivity,
        scratchRaw,
        scratchEnv
      );

      const expectedRaw = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        expectedRaw[x] = samplePeakRange(
          peaks,
          viewStart + (x / width) * viewSpan,
          viewStart + ((x + 1) / width) * viewSpan,
          sensitivity
        );
      }
      for (let x = 0; x < width; x++) {
        const a = expectedRaw[Math.max(0, x - 1)];
        const c = expectedRaw[Math.min(width - 1, x + 1)];
        const expectedEnv = Math.max(
          expectedRaw[x] * 0.9,
          a * 0.2 + expectedRaw[x] * 0.6 + c * 0.2
        );
        expect(Math.abs(scratchEnv[x] - expectedEnv)).toBeLessThan(0.002);
      }
    }
  });

  it("coalesces burst wheel events into a single rAF draw without forced reflows and updates zoom pill", () => {
    vi.useFakeTimers();
    const rafQueue: FrameRequestCallback[] = [];
    let nextRafId = 1;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return nextRafId++;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const origResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const sample = makeSample();
    useSampleStore.setState({
      selectedSample: sample,
      durationSec: 8,
      sliceRange: null,
      isMiniDock: false,
      pitchSemitones: 0,
    });

    const { container } = render(<WaveformDeckCanvas />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    const waveBox = canvas!.parentElement as HTMLDivElement;

    // Simulate ResizeObserver/initial rect already measured
    const rectSpy = vi.spyOn(waveBox, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 80,
      width: 800,
      height: 80,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(waveBox, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(waveBox, "clientHeight", {
      configurable: true,
      value: 80,
    });

    // Seed containerRectRef via mouseEnter, then clear spy count
    fireEvent.mouseEnter(waveBox);
    rectSpy.mockClear();
    rafSpy.mockClear();
    rafQueue.length = 0;

    // Fire 10 rapid wheel events within the same animation frame
    act(() => {
      for (let i = 0; i < 10; i++) {
        const evt = new WheelEvent("wheel", {
          deltaY: -50,
          deltaMode: 0,
          clientX: 400,
          bubbles: true,
          cancelable: true,
        });
        waveBox.dispatchEvent(evt);
      }
    });

    // Zero forced getBoundingClientRect reflows during wheel burst!
    expect(rectSpy).not.toHaveBeenCalled();
    // All 10 wheel ticks coalesced into ONE single rAF draw!
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Header zoom badge reflects cumulative 1.28^5 ≈ 3.4x zoom cleanly
    const zoomResetBtn = screen.getByTitle(/Waveform horizontal zoom/i);
    expect(zoomResetBtn.textContent).toContain("3.4x");

    // Flush the single rAF and settle timer
    act(() => {
      while (rafQueue.length > 0) {
        const cb = rafQueue.shift()!;
        cb(16);
      }
      vi.advanceTimersByTime(150);
      while (rafQueue.length > 0) {
        const cb = rafQueue.shift()!;
        cb(166);
      }
    });

    // Clicking the zoom badge resets back to 1x and hides the pill
    fireEvent.click(zoomResetBtn);
    expect(screen.queryByTitle(/Waveform horizontal zoom/i)).toBeNull();

    globalThis.ResizeObserver = origResizeObserver;
    vi.useRealTimers();
  });
});
