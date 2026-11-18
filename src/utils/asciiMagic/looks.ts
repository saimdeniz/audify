import type { AsciiMagicFrame, AsciiMagicLook, AsciiMagicPalette } from "../../types";

// Ink coverage (0..100) of each safe glyph in Menlo, measured once in a canvas.
// Packed as glyph + one char code: coverage = (code - 48) / 0.74.
const PACKED =
  "0L1@2C3D4E5E6H7?8J9H!9\":#I$G%F&H'5(<)<*@+<,7-7.5/<:8;:<===>=?=@NAFBKCADIEFFCGFHHIBJ@KHL?MMNNOHPEQJRISET@UFVDWLXEY@ZE[=\\<]>^:_7`2aDbGc=dGeCf@gIhDi>j@kDl=mFnAoBpGqFr;s@t?uAv?wDx@yCz?{@|=}@~:─7━=│=┃G┄6┅:┆;┇E┈5┉9┊:┋C┌:┍=┎@┏C┐:┑=┒@┓C└:┕=┖?┗A┘:┙=┚?┛A├@┝C┞E┟E┠J┡G┢H┣L┤@┥C┦E┧E┨J┩G┪H┫L┬>┭@┮@┯C┰C┱E┲E┳H┴=┵@┶@┷B┸A┹D┺D┻F┼C┽E┾E┿H╀H╁H╂M╃J╄J╅K╆K╇K╈M╉N╊N╋Q╌7╍<╎;╏D═?║I╒?╓B╔E╕?╖B╗E╘=╙@╚C╛=╜@╝C╞C╟K╠M╡C╢K╣M╤D╥D╦H╧C╨B╩F╪I╫N╬Q╭:╮:╯9╰9╱>╲>╳K╴4╵6╶4╷7╸7╹;╺7╻=╼:╽C╾:╿B▀V▁:▂C▃L▄V▅_▆h▇q█z▉s▊j▋`▌V▍M▎C▏9▐V░C▒[▓p▔:▕9▖C▗C▘C▙h▚V▛h▜h▝C▞V▟h·3•9●T○@◦5■\\□C▪C▫<◆H◇?▲H△?▼H▽@◀G▶G►@◄@≈=≡C°7✓8✗@♥N×=÷;±A→9←9↑9↓:↗:↘:↙:↖:";

const COVER: Record<string, number> = {
  " ": 0,
  "░": 25,
  "▒": 50,
  "▓": 75,
  "█": 100,
};
for (let i = 0; i < PACKED.length; i += 2) {
  COVER[PACKED[i]] = (PACKED.charCodeAt(i + 1) - 48) / 0.74;
}

export function isShade(code: number): boolean {
  return code >= 0x2580 && code <= 0x259f;
}

export function cover(ch: string): number {
  if (ch in COVER) return COVER[ch];
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x2800 && c <= 0x28ff) {
    let n = 0;
    let b = c - 0x2800;
    while (b) {
      n += b & 1;
      b >>= 1;
    }
    return n * 7;
  }
  return 30;
}

export const LOOK_CHARS: Record<AsciiMagicLook, string | null> = {
  original: null,
  dots: " ·•●",
  ascii: " .,-~:;=!*#$@",
  dense:
    " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  dither: " █",
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function ditherChar(d: number, x: number, y: number): string {
  return d > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? "█" : " ";
}

const CACHE_CAP = 4096;

function setBoundedCache<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= CACHE_CAP && !map.has(key)) {
    map.clear();
  }
  map.set(key, value);
}

const rampCache = new Map<string, string[]>();

export function buildRamp(chars: string): string[] {
  const cached = rampCache.get(chars);
  if (cached) return cached;
  const uniq = Array.from(new Set([...chars])).filter(
    (c) => c !== "\n" && c !== "\t"
  );
  const sorted = uniq.sort((a, b) => cover(a) - cover(b));
  if (sorted[0] !== " ") sorted.unshift(" ");
  setBoundedCache(rampCache, chars, sorted);
  return sorted;
}

const hexCache = new Map<string, string>();

export function toHex(color: string | null | undefined, fallback = "#e4e4e7"): string {
  if (!color) return fallback;
  if (color[0] === "#" && color.length === 7) return color;
  const cached = hexCache.get(color);
  if (cached) return cached;
  let hex = fallback;
  if (color[0] === "#" && color.length === 4) {
    hex = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  } else {
    const m = color.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) {
      hex =
        "#" +
        m
          .slice(0, 3)
          .map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, "0"))
          .join("");
    }
  }
  setBoundedCache(hexCache, color, hex);
  return hex;
}

const lumCache = new Map<string, number>();

export function lumHex(hex: string | null | undefined): number {
  if (!hex || hex[0] !== "#" || hex.length < 7) return 0.88;
  const cached = lumCache.get(hex);
  if (cached !== undefined) return cached;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  setBoundedCache(lumCache, hex, l);
  return l;
}

const liftCache = new WeakMap<AsciiMagicPalette, AsciiMagicPalette>();

export function liftPalette(
  palette: AsciiMagicPalette | null
): AsciiMagicPalette | null {
  if (!palette) return palette;
  const cached = liftCache.get(palette);
  if (cached) return cached;
  const out: AsciiMagicPalette = {};
  for (const [k, rawHex] of Object.entries(palette)) {
    if (!rawHex || rawHex[0] !== "#" || rawHex.length < 7) {
      out[k] = rawHex;
      continue;
    }
    const r = parseInt(rawHex.slice(1, 3), 16) / 255;
    const g = parseInt(rawHex.slice(3, 5), 16) / 255;
    const b = parseInt(rawHex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    let h = 0;
    if (d) {
      h =
        mx === r
          ? ((g - b) / d + 6) % 6
          : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    }
    const L = Math.max(l, 0.2 + 0.5 * Math.sqrt(l));
    const C = (1 - Math.abs(2 * L - 1)) * sat;
    const X = C * (1 - Math.abs((h % 2) - 1));
    const m = L - C / 2;
    const [R, G, B] =
      h < 1
        ? [C, X, 0]
        : h < 2
        ? [X, C, 0]
        : h < 3
        ? [0, C, X]
        : h < 4
        ? [0, X, C]
        : h < 5
        ? [X, 0, C]
        : [C, 0, X];
    out[k] =
      "#" +
      [R, G, B]
        .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0"))
        .join("");
  }
  liftCache.set(palette, out);
  return out;
}

const lightPaletteCache = new WeakMap<AsciiMagicPalette, AsciiMagicPalette>();

/** Darken very pale hex entries so bright stars/highlights remain legible on Light backgrounds. */
export function adaptPaletteForLightTheme(
  palette: AsciiMagicPalette | null
): AsciiMagicPalette | null {
  if (!palette) return palette;
  const cached = lightPaletteCache.get(palette);
  if (cached) return cached;
  const out: AsciiMagicPalette = {};
  for (const [k, rawHex] of Object.entries(palette)) {
    if (!rawHex || rawHex[0] !== "#" || rawHex.length < 7) {
      out[k] = rawHex;
      continue;
    }
    const l = lumHex(rawHex);
    if (l <= 0.68) {
      out[k] = rawHex;
      continue;
    }
    const scale = 0.52 / l;
    const r = Math.round(parseInt(rawHex.slice(1, 3), 16) * scale);
    const g = Math.round(parseInt(rawHex.slice(3, 5), 16) * scale);
    const b = Math.round(parseInt(rawHex.slice(5, 7), 16) * scale);
    out[k] = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  lightPaletteCache.set(palette, out);
  return out;
}

const brightCache = new Map<string, string>();

export function brightenHex(hex: string, k: number): string {
  const key = `${hex}:${k}`;
  const cached = brightCache.get(key);
  if (cached) return cached;
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const mx = Math.max(r, g, b, 1);
  const f = (255 / mx) * k + (1 - k);
  const out =
    "#" +
    [r, g, b]
      .map((c) => Math.round(Math.min(255, c * f)).toString(16).padStart(2, "0"))
      .join("");
  if (brightCache.size > 4096) brightCache.clear();
  brightCache.set(key, out);
  return out;
}

const boostCache = new Map<string, string>();

export function boostHex(hex: string, factor: number): string {
  const key = `${hex}:${factor}`;
  const cached = boostCache.get(key);
  if (cached) return cached;
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const mx = Math.max(r, g, b, 1);
  const k = Math.min(factor, 255 / mx);
  const out =
    "#" +
    [r, g, b]
      .map((c) => Math.round(c * k).toString(16).padStart(2, "0"))
      .join("");
  if (boostCache.size > 4096) boostCache.clear();
  boostCache.set(key, out);
  return out;
}

const RAMP_PUNCT = new Set(".,:;-~=+*!#%@$&");

function isRampShaded(rows: string[][]): boolean {
  let ink = 0;
  let ramp = 0;
  let alnum = 0;
  for (const row of rows) {
    for (const ch of row) {
      if (ch === " ") continue;
      ink++;
      if (RAMP_PUNCT.has(ch)) {
        ramp++;
      } else {
        const c = ch.charCodeAt(0);
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
          alnum++;
        }
      }
    }
  }
  return ink > 0 && ramp >= ink * 0.5 && alnum < ink * 0.05;
}

export function createShadeTester(rows: string[][]): (ch: string) => boolean {
  const rs = isRampShaded(rows);
  return (ch: string) => isShade(ch.codePointAt(0) ?? 0) || (rs && RAMP_PUNCT.has(ch));
}

export interface DensityGridResult {
  T: string[][];
  C: string[][] | null;
  D: number[][];
  w: number;
  h: number;
}

export interface DensityOptions {
  all?: boolean;
  gamma?: number;
}

export function computeDensityGrid(
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: DensityOptions = {}
): DensityGridResult {
  const T = frame.text.split("\n").map((r) => [...r]);
  const C = frame.color ? frame.color.split("\n").map((r) => [...r]) : null;
  const shade = opts.all ? null : createShadeTester(T);

  const D = T.map((row, y) =>
    row.map((ch, x) => {
      if (ch === " " || (!opts.all && shade && !shade(ch))) return -1;
      const k = C?.[y]?.[x];
      const hex = k && k !== " " && palette ? palette[k] : null;
      return (cover(ch) / 100) * lumHex(hex);
    })
  );

  let max = 0;
  let min = Infinity;
  for (const row of D) {
    for (const d of row) {
      if (d > max) max = d;
      if (d >= 0.004 && d < min) min = d;
    }
  }

  const span = max - min > 0.05 ? max - min : max;
  const lo = max - min > 0.05 ? min : 0;
  const gamma = opts.gamma ?? 0.35;

  for (const row of D) {
    for (let x = 0; x < row.length; x++) {
      const d = row[x];
      if (d < 0) continue;
      row[x] =
        d < 0.004 || !span
          ? 0
          : Math.max(0.0001, Math.pow(Math.max(0, d - lo) / span, gamma));
    }
  }

  return { T, C, D, w: T[0]?.length ?? 0, h: T.length };
}

export interface RestyleOptions extends DensityOptions {
  look: AsciiMagicLook;
  lift?: boolean;
}

export function restyleFrame(
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  opts: RestyleOptions
): { frame: AsciiMagicFrame; palette: AsciiMagicPalette | null } {
  const chars = LOOK_CHARS[opts.look];
  if (!chars) {
    return { frame, palette: frame.paletteOverride ?? palette };
  }
  const activePalette = frame.paletteOverride ?? palette;
  const ramp = buildRamp(chars);
  const n = Math.max(1, ramp.length - 1);
  const isDither = opts.look === "dither";
  const { T, D } = computeDensityGrid(frame, activePalette, {
    ...opts,
    all: isDither ? true : opts.all,
  });

  const outText = T.map((row, y) =>
    row
      .map((ch, x) => {
        const d = D[y][x];
        if (d < 0) return ch;
        if (d === 0) return " ";
        if (isDither) return ditherChar(d, x, y);
        return ramp[1 + Math.min(n - 1, Math.floor(d * n))];
      })
      .join("")
  ).join("\n");

  const nextPalette = opts.lift === false ? activePalette : liftPalette(activePalette);
  return {
    frame: {
      text: outText,
      color: frame.color,
      paletteOverride: nextPalette,
    },
    palette: nextPalette,
  };
}

/**
 * Downsamples square-cell frames (e.g. 192x108) into monospace aspect rows/cols
 * when switching to ASCII/Dense/Blocks so characters are never clipped or bloated.
 */
export function restyleMerged(
  frame: AsciiMagicFrame,
  palette: AsciiMagicPalette | null,
  outCols: number,
  outRows: number,
  opts: RestyleOptions
): { frame: AsciiMagicFrame; palette: AsciiMagicPalette | null } {
  const chars = LOOK_CHARS[opts.look];
  const activePalette = frame.paletteOverride ?? palette;
  if (!chars || outCols <= 0 || outRows <= 0) {
    return { frame, palette: activePalette };
  }
  const ramp = buildRamp(chars);
  const n = Math.max(1, ramp.length - 1);
  const isDither = opts.look === "dither";
  const { C, D, w, h } = computeDensityGrid(frame, activePalette, {
    ...opts,
    all: true,
  });
  if (w === 0 || h === 0) {
    return { frame, palette: activePalette };
  }

  const outTextLines: string[] = [];
  const outColorLines: string[] | null = C ? [] : null;
  for (let or = 0; or < outRows; or++) {
    const y0 = Math.floor((or * h) / outRows);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor(((or + 1) * h) / outRows)));
    let line = "";
    let colorLine = "";
    for (let oc = 0; oc < outCols; oc++) {
      const x0 = Math.floor((oc * w) / outCols);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor(((oc + 1) * w) / outCols)));
      let sumD = 0;
      let inkCount = 0;
      let totalCount = 0;
      let bestD = -1;
      let bestKey = " ";
      for (let y = y0; y < y1; y++) {
        const dRow = D[y];
        const cRow = C?.[y];
        for (let x = x0; x < x1; x++) {
          totalCount++;
          const d = dRow[x];
          if (d < 0) continue;
          inkCount++;
          sumD += d;
          if (d > bestD) {
            bestD = d;
            bestKey = cRow?.[x] ?? " ";
          }
        }
      }
      if (inkCount === 0 || totalCount === 0) {
        line += " ";
        if (outColorLines) colorLine += " ";
        continue;
      }
      const avgD = Math.min(0.9999, sumD / totalCount);
      const glyph = isDither
        ? ditherChar(avgD, oc, or)
        : avgD <= 0
          ? " "
          : ramp[1 + Math.min(n - 1, Math.floor(avgD * n))];
      line += glyph;
      if (outColorLines) colorLine += glyph === " " ? " " : bestKey;
    }
    outTextLines.push(line);
    if (outColorLines) outColorLines.push(colorLine);
  }

  const nextPalette = opts.lift === false ? activePalette : liftPalette(activePalette);
  return {
    frame: {
      text: outTextLines.join("\n"),
      color: outColorLines ? outColorLines.join("\n") : null,
      paletteOverride: nextPalette,
    },
    palette: nextPalette,
  };
}

export function clearLooksCaches(): void {
  rampCache.clear();
  hexCache.clear();
  lumCache.clear();
  brightCache.clear();
  boostCache.clear();
}
