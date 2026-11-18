import { describe, expect, it, vi } from "vitest";
import {
  ASCII_CATEGORY_LABELS,
  ASCII_PRESETS,
} from "../constants/asciiPresets";
import { renderAsciiPresetFrame } from "./asciiWallpaperEngine";

function createMockCanvasCtx() {
  let currentFill = "";
  const drawCalls: { ch: string; x: number; y: number; fill: string }[] = [];
  const gradientStops: string[] = [];

  const ctx = {
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    set fillStyle(val: string) {
      currentFill = val;
    },
    get fillStyle() {
      return currentFill;
    },
    createLinearGradient: () => ({
      addColorStop: (_offset: number, color: string) => {
        gradientStops.push(color);
      },
    }),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: (ch: string, x: number, y: number) => {
      drawCalls.push({ ch, x, y, fill: currentFill });
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, drawCalls, gradientStops };
}

const ADAPTIVE_PRESETS = new Set<string>(
  ASCII_PRESETS.filter((p) => p.category === "studio").map((p) => p.id)
);

describe("renderAsciiPresetFrame", () => {
  it("provides 12 presets across all 9 categories (108 total) and renders Dark, Light & compact frames cleanly", async () => {
    expect(ASCII_CATEGORY_LABELS.length).toBe(9);
    expect(ASCII_PRESETS.length).toBe(108);

    for (const cat of ASCII_CATEGORY_LABELS) {
      const catPresets = ASCII_PRESETS.filter((p) => p.category === cat.id);
      expect(
        catPresets.length,
        `Category ${cat.id} should have 12 presets`
      ).toBe(12);
    }

    for (const preset of ASCII_PRESETS) {
      if (ADAPTIVE_PRESETS.has(preset.id)) {
        expect(
          preset.swatchGradientLight?.length ?? 0,
          `${preset.id} should define a Light mode card swatch`
        ).toBeGreaterThan(10);
      } else {
        expect(
          preset.swatchGradientLight,
          `${preset.id} scenic swatch should stay unaltered across themes`
        ).toBeUndefined();
      }

      const darkMock = createMockCanvasCtx();
      await renderAsciiPresetFrame({
        ctx: darkMock.ctx,
        width: 960,
        height: 540,
        timeSec: 2.4,
        preset: preset.id,
        accentHex: "#38BDF8",
        themeMode: "dark",
        isPlaying: true,
      });

      expect(
        darkMock.drawCalls.length,
        `${preset.id} should render ASCII characters in dark mode`
      ).toBeGreaterThan(8);

      const lightMock = createMockCanvasCtx();
      await renderAsciiPresetFrame({
        ctx: lightMock.ctx,
        width: 960,
        height: 540,
        timeSec: 2.4,
        preset: preset.id,
        accentHex: "#38BDF8",
        themeMode: "light",
        isPlaying: true,
      });

      expect(
        lightMock.drawCalls.length,
        `${preset.id} should render ASCII characters in light mode`
      ).toBeGreaterThan(8);

      if (ADAPTIVE_PRESETS.has(preset.id)) {
        expect(
          lightMock.gradientStops,
          `${preset.id} light mode backdrop should adapt from dark mode`
        ).not.toEqual(darkMock.gradientStops);
      } else {
        expect(
          lightMock.gradientStops,
          `${preset.id} scenic artwork should stay consistent in light mode`
        ).toEqual(darkMock.gradientStops);
      }

      const compactMock = createMockCanvasCtx();
      await renderAsciiPresetFrame({
        ctx: compactMock.ctx,
        width: 260,
        height: 146,
        timeSec: 1.1,
        preset: preset.id,
        accentHex: "#F59E0B",
        themeMode: "light",
        isPlaying: false,
      });

      expect(
        compactMock.drawCalls.length,
        `${preset.id} should also render in compact preview`
      ).toBeGreaterThan(5);
    }
  });
});
