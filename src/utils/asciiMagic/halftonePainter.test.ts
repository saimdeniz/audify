// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlyphAtlas } from "./glyphAtlas";
import { paintText } from "./halftonePainter";

describe("halftonePainter block run coalescing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces horizontal block glyph runs via fillRect without allocating Path2D", () => {
    const path2dCtor = vi.fn();
    vi.stubGlobal("Path2D", path2dCtor);

    const fillRectCalls: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      fill: string;
    }> = [];
    const drawImage = vi.fn();
    let currentFill = "";

    const ctx = {
      font: "",
      textBaseline: "middle",
      set fillStyle(val: string) {
        currentFill = val;
      },
      get fillStyle() {
        return currentFill;
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        fillRectCalls.push({ x, y, w, h, fill: currentFill });
      },
      drawImage,
    } as unknown as CanvasRenderingContext2D;

    const fakeAtlasCanvas = document.createElement("canvas");
    const fakeAtlas = {
      key: "10x20@1",
      tw: 10,
      th: 20,
      canvas: fakeAtlasCanvas,
      reset: vi.fn(),
      tile: vi.fn(() => [0, 0] as const),
      dispose: vi.fn(),
    } as unknown as GlyphAtlas;

    paintText(
      ctx,
      {
        text: "███A██ █",
        color: "aaabab c",
        paletteOverride: null,
      },
      { a: "#112233", b: "#445566", c: "#778899" },
      0,
      0,
      10,
      20,
      "#ffffff",
      fakeAtlas,
      1
    );

    expect(path2dCtor).not.toHaveBeenCalled();
    // 3 contiguous 'a' blocks, glyph 'A' via atlas, 1 'a' block, 1 'b' block, space, 1 'c' block
    expect(fillRectCalls).toEqual([
      { x: 0, y: 0, w: 30.5, h: 20.5, fill: "#112233" },
      { x: 40, y: 0, w: 10.5, h: 20.5, fill: "#112233" },
      { x: 50, y: 0, w: 10.5, h: 20.5, fill: "#445566" },
      { x: 70, y: 0, w: 10.5, h: 20.5, fill: "#778899" },
    ]);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });
});
