import { describe, expect, it } from "vitest";
import {
  ASCII_PRESET_AUTO_ACCENTS,
  ASCII_PRESET_IDS,
} from "../constants/asciiPresetIds";
import { ASCII_PRESETS } from "../constants/asciiPresets";
import type { AsciiMagicPreviewSnapshot } from "../types";
import {
  cacheAsciiMagicAutoAccent,
  evictAsciiMagicAutoAccentCache,
  getCachedAsciiMagicAutoAccentHex,
  getPresetAutoAccentHex,
  pickAccentFromAsciiMagicSnapshot,
  pickAccentFromRgbaPixels,
} from "./autoAccent";

function makeSolidPixels(r: number, g: number, b: number, count = 20): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    arr[i * 4] = r;
    arr[i * 4 + 1] = g;
    arr[i * 4 + 2] = b;
    arr[i * 4 + 3] = 255;
  }
  return arr;
}

describe("autoAccent", () => {
  it("resolves vivid hex accents for every non-studio ASCII preset and null for studio scenes", () => {
    for (const preset of ASCII_PRESETS) {
      const hex = getPresetAutoAccentHex(preset.id);
      if (preset.category === "studio") {
        expect(hex, `${preset.id} is studio-adaptive and should defer to manual color`).toBeNull();
      } else {
        expect(hex, `${preset.id} should produce a valid hex accent`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("picks the dominant vibrant hue while ignoring dark letterbox borders", () => {
    // 16 pitch-black margin pixels + 8 bright cyan-blue center pixels
    const black = makeSolidPixels(6, 8, 12, 16);
    const cyan = makeSolidPixels(34, 180, 245, 8);
    const combined = new Uint8ClampedArray(black.length + cyan.length);
    combined.set(black, 0);
    combined.set(cyan, black.length);

    const hex = pickAccentFromRgbaPixels(combined);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);

    const r = parseInt(hex!.slice(1, 3), 16);
    const g = parseInt(hex!.slice(3, 5), 16);
    const b = parseInt(hex!.slice(5, 7), 16);
    expect(b).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(r);
  });

  it("handles monochrome images cleanly without returning NaN or empty values", () => {
    const slate = makeSolidPixels(120, 122, 128, 12);
    const hex = pickAccentFromRgbaPixels(slate);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("extracts dominant vibrant hue from ascii-magic snapshots while ignoring dark backgrounds and achromatic ink", () => {
    const duskSnapshot: AsciiMagicPreviewSnapshot = {
      meta: {
        slug: "acropolis-hill-dusk",
        name: "Acropolis Hill Dusk",
        category: "places",
        cols: 6,
        rows: 3,
        fps: 15,
        cell: "square",
        look: "original",
        still: false,
        dots: null,
        palette: {
          "0": "#070b14",
          "1": "#f59e0b",
          "2": "#e5e7eb",
        },
      },
      frame: {
        text: "██████\n██▄▄██\n  ████",
        color: "000000\n011110\n  2211",
        paletteOverride: null,
      },
    };

    const hex = pickAccentFromAsciiMagicSnapshot(duskSnapshot);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    const r = parseInt(hex!.slice(1, 3), 16);
    const g = parseInt(hex!.slice(3, 5), 16);
    const b = parseInt(hex!.slice(5, 7), 16);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);

    evictAsciiMagicAutoAccentCache("acropolis-hill-dusk");
    expect(getCachedAsciiMagicAutoAccentHex("acropolis-hill-dusk")).toBeNull();
    cacheAsciiMagicAutoAccent("acropolis-hill-dusk", duskSnapshot);
    expect(getCachedAsciiMagicAutoAccentHex("acropolis-hill-dusk")).toBe(hex);
    evictAsciiMagicAutoAccentCache("acropolis-hill-dusk");

    const monoSnapshot: AsciiMagicPreviewSnapshot = {
      ...duskSnapshot,
      meta: {
        ...duskSnapshot.meta,
        slug: "wireframe-mono",
        palette: { "0": "#18181b", "1": "#e4e4e7" },
      },
      frame: {
        text: "██████\n██████",
        color: "001100\n111111",
        paletteOverride: null,
      },
    };
    expect(pickAccentFromAsciiMagicSnapshot(monoSnapshot)).toBeNull();
  });

  it("keeps lightweight ASCII_PRESET_IDS and ASCII_PRESET_AUTO_ACCENTS synchronized 1:1 with ASCII_PRESETS", () => {
    expect(ASCII_PRESET_IDS).toEqual(ASCII_PRESETS.map((p) => p.id));
    expect(Object.keys(ASCII_PRESET_AUTO_ACCENTS).sort()).toEqual(
      [...ASCII_PRESET_IDS].sort()
    );
  });
});
