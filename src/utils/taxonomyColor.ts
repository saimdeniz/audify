/**
 * Full-gamut (16M) studio color helpers and deterministic parent-hue tonal shade
 * derivation shared across the taxonomy sidebar, table badges, pickers, and settings.
 * Mirrors `derive_child_tonal_color` in `src-tauri/src/taxonomy_catalog.rs`.
 */

interface HslColor {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

const TONAL_SLOTS: readonly (readonly [number, number, number])[] = [
  [-14, 0.04, 0.06],
  [-7, -0.06, -0.05],
  [0, -0.08, 0.09],
  [7, 0.06, 0.04],
  [14, -0.04, -0.06],
  [-10, 0.02, 0.11],
  [10, 0.05, -0.03],
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeSixHex(hex: string): string {
  let clean = (hex || "").trim().replace(/^#/, "");
  if (clean.length === 3) {
    clean = `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toUpperCase()}`;
  }
  return "#3B82F6";
}

export function hexToHsl(hex: string): HslColor {
  const norm = normalizeSixHex(hex).slice(1);
  const r = parseInt(norm.slice(0, 2), 16) / 255;
  const g = parseInt(norm.slice(2, 4), 16) / 255;
  const b = parseInt(norm.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s, l };
}

function hueToChannel(p: number, q: number, tRaw: number): number {
  let t = tRaw;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToHex(hDeg: number, sRaw: number, lRaw: number): string {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = clamp(sRaw, 0, 1);
  const l = clamp(lRaw, 0, 1);

  let r = l;
  let g = l;
  let b = l;
  if (s > 0.0001) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToChannel(p, q, h + 1 / 3);
    g = hueToChannel(p, q, h);
    b = hueToChannel(p, q, h - 1 / 3);
  }
  const toByte = (x: number) =>
    Math.round(clamp(x * 255, 0, 255))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function djb2HashUnsigned(text: string): number {
  let hash = 5381;
  const lower = text.trim().toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    hash = (((hash << 5) + hash) + lower.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Generates a deterministic, perceptually balanced color anywhere across the full
 * 360° hue wheel (16M RGB gamut) for newly created custom root tags, genres, or moods.
 */
export function generateDeterministicFullSpectrumColor(name: string): string {
  const hash = djb2HashUnsigned(name || "audify");
  const h = hash % 360;
  const s = 0.62 + ((hash >>> 9) % 23) / 100; // 0.62..0.84
  const l = 0.5 + ((hash >>> 15) % 15) / 100; // 0.50..0.64
  return hslToHex(h, s, l);
}

/**
 * Generates a fresh random vivid color across the full 16M RGB gamut
 * while staying within a Dark/Light/Contrast legible saturation & lightness band.
 */
export function generateRandomStudioHex(): string {
  const h = Math.random() * 360;
  const s = 0.58 + Math.random() * 0.28; // 0.58..0.86
  const l = 0.48 + Math.random() * 0.19; // 0.48..0.67
  return hslToHex(h, s, l);
}

/**
 * Derives a harmonious, theme-legible tonal shade in the parent's color family.
 * Example: a Blue parent automatically yields sky, cerulean, cobalt, royal & azure
 * shades for its children; changing the parent's color cascades automatically.
 */
export function deriveChildTonalColor(
  parentHex: string,
  childName: string,
  depth = 2
): string {
  const { h, s, l } = hexToHsl(parentHex);
  const hash = djb2HashUnsigned(childName || "subtag");
  const slot = TONAL_SLOTS[hash % TONAL_SLOTS.length];
  const depthScale = depth >= 3 ? 0.75 : 1;
  const depthLightBoost = depth >= 3 ? 0.03 : 0;

  if (s < 0.08) {
    const neutralL = clamp(l + slot[2] * 1.15 + depthLightBoost, 0.42, 0.74);
    return hslToHex(h, s, neutralL);
  }

  const nextH = (h + slot[0] * depthScale + 360) % 360;
  const nextS = clamp(s + slot[1], 0.44, 0.9);
  const nextL = clamp(l + slot[2] + depthLightBoost, 0.44, 0.72);
  return hslToHex(nextH, nextS, nextL);
}
