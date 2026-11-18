import { describe, expect, it } from "vitest";
import type { AsciiMagicPieceMeta, AsciiMagicPreviewSnapshot } from "../../types";
import { renderPreviewThumbnail } from "./frameRenderer";
import { restyleMerged } from "./looks";
import { getMergedSquareGridDims } from "./microPainter";

function makeDenseSnapshot(look: "dots" | "original" = "dots"): AsciiMagicPreviewSnapshot {
  const cols = 192;
  const rows = 108;
  const textRows: string[] = [];
  const colorRows: string[] = [];
  for (let r = 0; r < rows; r++) {
    const ch = r < 54 ? "▒" : "█";
    const ck = r < 54 ? "a" : "b";
    textRows.push(ch.repeat(cols));
    colorRows.push(ck.repeat(cols));
  }
  const meta: AsciiMagicPieceMeta = {
    slug: "acropolis-hill-dusk",
    name: "Acropolis Hill at Dusk",
    category: "cities",
    cols,
    rows,
    fps: 15,
    cell: "square",
    look,
    still: false,
    dots: { soft: true },
    palette: { a: "#7a6a9a", b: "#ffe2a8" },
  };
  return {
    meta,
    frame: {
      text: textRows.join("\n"),
      color: colorRows.join("\n"),
      paletteOverride: null,
    },
  };
}

describe("frameRenderer micro-thumbnail & restyleMerged", () => {
  it("paints visible non-background pixels for 192x108 dots scene in 72x42 thumbnails (dark & light)", () => {
    const snap = makeDenseSnapshot("dots");
    for (const theme of ["dark", "light"] as const) {
      const fills: string[] = [];
      const bgFill = theme === "light" ? "#eef1f6" : "#0b0d12";
      const canvas = {
        width: 72,
        height: 42,
        getContext: () => ({
          canvas: null as unknown as HTMLCanvasElement,
          setTransform: () => {},
          clearRect: () => {},
          set fillStyle(val: string) {
            fills.push(val);
          },
          fillRect: () => {},
        }),
      } as unknown as HTMLCanvasElement;

      renderPreviewThumbnail(canvas, snap, "original", theme, 72, 42);
      const nonBgFills = fills.filter((c) => c.toLowerCase() !== bgFill);
      expect(nonBgFills.length).toBeGreaterThan(200);
    }
  });

  it("merges 192x108 square grid into balanced monospace proportions for ASCII look", () => {
    const snap = makeDenseSnapshot("dots");
    const dims = getMergedSquareGridDims(192, 108);
    expect(dims.cols).toBe(134);
    expect(dims.rows).toBe(45);

    const out = restyleMerged(snap.frame, snap.meta.palette, dims.cols, dims.rows, {
      look: "ascii",
      lift: false,
    });
    const outLines = out.frame.text.split("\n");
    expect(outLines).toHaveLength(45);
    expect(outLines[0]).toHaveLength(134);
    expect(outLines[44]).toContain("@");
  });
});
