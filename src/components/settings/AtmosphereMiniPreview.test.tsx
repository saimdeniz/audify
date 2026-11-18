// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const loadRendererMock = vi.fn((_preset: string) => Promise.resolve(vi.fn()));
const renderPresetFrameMock = vi.fn();
const getPreviewMock = vi.fn();
const renderPreviewThumbnailMock = vi.fn();
const releaseCachesMock = vi.fn();
const sandboxCaptureMock = vi.fn();

vi.mock("../../utils/asciiWallpaperEngine", () => ({
  loadAsciiPresetRenderer: (preset: string) => loadRendererMock(preset),
  renderAsciiPresetFrame: (...args: unknown[]) => renderPresetFrameMock(...args),
}));

vi.mock("../../services/asciiMagicService", () => ({
  getAsciiMagicPreview: (slug: string) => getPreviewMock(slug),
  saveAsciiMagicPreview: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../utils/asciiMagic/frameRenderer", () => ({
  renderPreviewThumbnail: (...args: unknown[]) =>
    renderPreviewThumbnailMock(...args),
  releaseCanvasRenderCaches: (...args: unknown[]) => releaseCachesMock(...args),
}));

vi.mock("../../utils/asciiMagic/sandboxBridge", () => ({
  asciiMagicSandbox: {
    capturePiecePreview: (slug: string) => sandboxCaptureMock(slug),
  },
}));

import { useSampleStore } from "../../store/useSampleStore";
import { AtmosphereMiniPreview } from "./AtmosphereMiniPreview";

describe("AtmosphereMiniPreview static snapshots", () => {
  beforeEach(() => {
    loadRendererMock.mockClear();
    renderPresetFrameMock.mockClear();
    getPreviewMock.mockReset();
    renderPreviewThumbnailMock.mockClear();
    releaseCachesMock.mockClear();
    sandboxCaptureMock.mockReset();

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
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
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a single static frame for built-in ascii_preset without animation loops", async () => {
    useSampleStore.setState({
      wallpaperKind: "ascii_preset",
      asciiPreset: "aurora_cabin",
      themeMode: "dark",
      accentColor: "#38bdf8",
    });

    render(<AtmosphereMiniPreview />);

    await waitFor(() => {
      expect(loadRendererMock).toHaveBeenCalledWith("aurora_cabin");
      expect(renderPresetFrameMock).toHaveBeenCalledTimes(1);
    });
    expect(renderPresetFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "aurora_cabin",
        isPlaying: false,
      })
    );
  });

  it("renders cached catalog snapshot in ascii_magic mode without booting sandbox", async () => {
    const fakeSnap = {
      meta: {
        slug: "chai-stall-dawn",
        name: "Chai Stall",
        category: "street",
        cols: 10,
        rows: 5,
        fps: 15,
        cell: "mono" as const,
        look: "original" as const,
        still: false,
        dots: null,
        palette: { a: "#ffffff" },
      },
      frame: { text: "█", color: "a", paletteOverride: null },
    };
    getPreviewMock.mockResolvedValue(fakeSnap);

    useSampleStore.setState({
      wallpaperKind: "ascii_magic",
      asciiMagicSlug: "chai-stall-dawn",
      asciiMagicLook: "dots",
      asciiMagicFit: "cover",
      themeMode: "dark",
    });

    render(<AtmosphereMiniPreview />);

    await waitFor(() => {
      expect(getPreviewMock).toHaveBeenCalledWith("chai-stall-dawn");
      expect(renderPreviewThumbnailMock).toHaveBeenCalledTimes(1);
    });
    expect(sandboxCaptureMock).not.toHaveBeenCalled();
    expect(renderPreviewThumbnailMock).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      fakeSnap,
      "dots",
      "dark",
      320,
      180,
      { fit: "cover", margin: 0 }
    );
  });

  it("displays the matching style label and single-line compact footer for all presets and Custom", () => {
    const cases = [
      {
        label: "STUDIO MATTE",
        dotClass: "bg-fg-3",
        state: {
          wallpaperKind: "ascii_preset" as const,
          enableMica: false,
          themeTintIntensity: 0.15,
          customBgBlur: 0,
          customBgOpacity: 0.75,
        },
        metrics: "T 15% · B 0px · V 75%",
      },
      {
        label: "FROSTED MICA",
        dotClass: "bg-ok",
        state: {
          wallpaperKind: "ascii_preset" as const,
          enableMica: true,
          themeTintIntensity: 0.45,
          customBgBlur: 0,
          customBgOpacity: 0.75,
        },
        metrics: "T 45% · B 0px · V 75%",
      },
      {
        label: "SOFT AMBIENT",
        dotClass: "bg-ok",
        state: {
          wallpaperKind: "ascii_preset" as const,
          enableMica: true,
          themeTintIntensity: 0.25,
          customBgBlur: 6,
          customBgOpacity: 0.85,
        },
        metrics: "T 25% · B 6px · V 85%",
      },
      {
        label: "CUSTOM",
        dotClass: "bg-accent",
        state: {
          wallpaperKind: "ascii_preset" as const,
          enableMica: false,
          themeTintIntensity: 0,
          customBgBlur: 0,
          customBgOpacity: 0.75,
        },
        metrics: "T 0% · B 0px · V 75%",
      },
      {
        label: "CUSTOM",
        dotClass: "bg-ok",
        state: {
          wallpaperKind: "none" as const,
          enableMica: true,
          themeTintIntensity: 0.3,
          customBgBlur: 12,
          customBgOpacity: 0.9,
        },
        metrics: "Tint 30%",
      },
    ];

    for (const tc of cases) {
      cleanup();
      useSampleStore.setState(tc.state);
      const { getByTestId } = render(<AtmosphereMiniPreview />);

      const footer = getByTestId("preview-footer-bar");
      expect(footer.className).toContain("whitespace-nowrap");
      expect(footer.className).toContain("overflow-hidden");
      expect(getByTestId("preview-style-label").textContent).toBe(tc.label);
      expect(getByTestId("preview-style-dot").className).toContain(tc.dotClass);
      expect(getByTestId("preview-metrics").textContent).toBe(tc.metrics);
    }
  });
});
