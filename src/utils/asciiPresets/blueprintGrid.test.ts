import { describe, expect, it, vi } from "vitest";
import { clearBlueprintGridPool, createGridFrame } from "./blueprintGrid";

function createMockCtx() {
  const fillTexts: string[] = [];
  const fillRectCalls: Array<[number, number, number, number]> = [];
  let currentFill = "";

  const ctx = {
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    strokeStyle: "",
    lineWidth: 1,
    set fillStyle(val: string) {
      currentFill = val;
    },
    get fillStyle() {
      return currentFill;
    },
    createLinearGradient: () => ({
      addColorStop: vi.fn(),
    }),
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push([x, y, w, h]);
    },
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: (ch: string) => {
      fillTexts.push(ch);
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, fillTexts, fillRectCalls };
}

describe("blueprintGrid pooled buffer", () => {
  it("reuses typed buffers across frames without leaking cells from previous frames", () => {
    clearBlueprintGridPool();

    const m1 = createMockCtx();
    const f1 = createGridFrame(
      800,
      480,
      "#0b0e11",
      "#192026",
      "#0d1114",
      { r: 56, g: 189, b: 248 },
      0.07,
      "dark"
    );
    f1.put(2, 3, "*", { r: 255, g: 200, b: 100 }, 0.5, 0.9);
    f1.put(5, 4, "#", { r: 100, g: 200, b: 255 }, 0.4, 0.8);
    f1.flush(m1.ctx);
    expect(m1.fillTexts).toEqual(["*", "#"]);

    const m2 = createMockCtx();
    const f2 = createGridFrame(
      320,
      180,
      "#0b0e11",
      "#192026",
      "#0d1114",
      { r: 56, g: 189, b: 248 },
      0.07,
      "dark"
    );
    f2.put(1, 1, "+", { r: 120, g: 240, b: 180 }, 0.6, 0.9);
    f2.flush(m2.ctx);
    expect(m2.fillTexts).toEqual(["+"]);

    clearBlueprintGridPool();
  });
});
