import { WaveformSensitivity } from "../types";

const MAX_PARSED_PEAKS = 200;
const EMPTY_PEAKS = new Float32Array(600);
const peaksCache = new Map<string, Float32Array>();

const SENSITIVITY_LUT_SIZE = 2048;

function buildSensitivityLut(exponent: number): Float32Array {
  const lut = new Float32Array(SENSITIVITY_LUT_SIZE + 1);
  for (let i = 1; i < SENSITIVITY_LUT_SIZE; i++) {
    lut[i] = Math.pow(i / SENSITIVITY_LUT_SIZE, exponent);
  }
  lut[SENSITIVITY_LUT_SIZE] = 1;
  return lut;
}

const SENSITIVITY_LUTS: Record<WaveformSensitivity, Float32Array> = {
  logarithmic: buildSensitivityLut(0.72),
  high_boost: buildSensitivityLut(0.55),
  linear: buildSensitivityLut(1.25),
};

function getSensitivityLut(sensitivity: WaveformSensitivity): Float32Array {
  return SENSITIVITY_LUTS[sensitivity] ?? SENSITIVITY_LUTS.logarithmic;
}

export function clearParsedPeaksCache(): void {
  peaksCache.clear();
}

export function parsePeaks(peaksJson: string): Float32Array {
  if (!peaksJson || peaksJson === "[]") return EMPTY_PEAKS;
  const cached = peaksCache.get(peaksJson);
  if (cached) {
    // Refresh LRU order
    peaksCache.delete(peaksJson);
    peaksCache.set(peaksJson, cached);
    return cached;
  }

  try {
    const parsed = JSON.parse(peaksJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const raw = new Float32Array(parsed.length);
      for (let i = 0; i < parsed.length; i++) {
        const v = parsed[i];
        raw[i] =
          typeof v === "number" && Number.isFinite(v)
            ? Math.max(0.0, Math.min(1.0, Math.abs(v)))
            : 0.0;
      }

      if (peaksCache.size >= MAX_PARSED_PEAKS) {
        const oldestKey = peaksCache.keys().next().value;
        if (oldestKey !== undefined) {
          peaksCache.delete(oldestKey);
        }
      }
      peaksCache.set(peaksJson, raw);
      return raw;
    }
  } catch {
    // Fallback below
  }
  return EMPTY_PEAKS;
}

/**
 * Samples the 600-bin `peaks` array across [ratioStart, ratioEnd]:
 * - If multiple peaks fall within [ratioStart, ratioEnd], returns their max peak.
 * - Otherwise returns exact linear interpolation at the midpoint ratio.
 */
export function samplePeakRange(
  peaks: ArrayLike<number>,
  ratioStart: number,
  ratioEnd: number,
  sensitivity: WaveformSensitivity = "logarithmic"
): number {
  const len = peaks.length;
  if (len === 0) return 0;

  // Each bin value describes the CENTER of its time slice ((i + 0.5) / len),
  // so a time ratio maps to bin position `ratio * len - 0.5`.
  const exactStart = Math.max(0, Math.min(len - 1, ratioStart * len - 0.5));
  const exactEnd = Math.max(exactStart, Math.min(len - 1, ratioEnd * len - 0.5));

  const startIdx = Math.floor(exactStart);
  const endIdx = Math.ceil(exactEnd);

  let baseVal = 0;
  if (endIdx - startIdx > 1) {
    let maxVal = 0;
    for (let i = startIdx; i <= endIdx && i < len; i++) {
      if (peaks[i] > maxVal) {
        maxVal = peaks[i];
      }
    }
    baseVal = maxVal;
  } else {
    const midPos = (exactStart + exactEnd) * 0.5;
    const idx0 = Math.max(0, Math.min(len - 1, Math.floor(midPos)));
    const idx1 = Math.max(0, Math.min(len - 1, Math.ceil(midPos)));
    const frac = midPos - idx0;
    const interp = peaks[idx0] * (1 - frac) + peaks[idx1] * frac;
    baseVal = Math.max(0, Math.min(1, interp));
  }

  if (baseVal <= 0) return 0;
  if (sensitivity === "high_boost") {
    return Math.min(1, Math.pow(baseVal, 0.55));
  }
  if (sensitivity === "linear") {
    return Math.min(1, Math.pow(baseVal, 1.25));
  }
  // Natural / Logarithmic: responsive power curve preserving punchy transient ceiling
  return Math.min(1, Math.pow(baseVal, 0.72));
}

/**
 * Allocation-free batch envelope sampler for the high-frequency zoom/pan waveform deck.
 * Computes sensitivity-scaled pixel columns via a precomputed 2048-entry LUT (zero `Math.pow`
 * calls) and writes the smoothed envelope directly into caller-owned scratch buffers.
 */
export function sampleWaveformEnvelope(
  peaks: ArrayLike<number>,
  viewStart: number,
  viewSpan: number,
  width: number,
  sensitivity: WaveformSensitivity,
  outRaw: Float32Array,
  outEnv: Float32Array
): void {
  if (width <= 0) return;
  const len = peaks.length;
  if (len === 0) {
    outEnv.fill(0, 0, width);
    return;
  }

  const lut = getSensitivityLut(sensitivity);
  const lenMinus1 = len - 1;
  const step = viewSpan / width;

  for (let x = 0; x < width; x++) {
    const ratioStart = viewStart + x * step;
    const ratioEnd = ratioStart + step;
    let exactStart = ratioStart * len - 0.5;
    if (exactStart < 0) exactStart = 0;
    else if (exactStart > lenMinus1) exactStart = lenMinus1;

    let exactEnd = ratioEnd * len - 0.5;
    if (exactEnd < exactStart) exactEnd = exactStart;
    else if (exactEnd > lenMinus1) exactEnd = lenMinus1;

    const startIdx = exactStart | 0;
    const endIdx = Math.ceil(exactEnd);

    let baseVal = 0;
    if (endIdx - startIdx > 1) {
      let maxVal = 0;
      const limit = endIdx < len ? endIdx : lenMinus1;
      for (let i = startIdx; i <= limit; i++) {
        const v = peaks[i];
        if (v > maxVal) maxVal = v;
      }
      baseVal = maxVal;
    } else {
      const midPos = (exactStart + exactEnd) * 0.5;
      const idx0 = midPos <= 0 ? 0 : midPos >= lenMinus1 ? lenMinus1 : midPos | 0;
      const idx1 = idx0 < lenMinus1 ? idx0 + 1 : lenMinus1;
      const frac = midPos - idx0;
      const interp = peaks[idx0] * (1 - frac) + peaks[idx1] * frac;
      baseVal = interp <= 0 ? 0 : interp >= 1 ? 1 : interp;
    }

    if (baseVal <= 0) {
      outRaw[x] = 0;
    } else if (baseVal >= 1) {
      outRaw[x] = 1;
    } else {
      outRaw[x] = lut[(baseVal * SENSITIVITY_LUT_SIZE + 0.5) | 0];
    }
  }

  const lastX = width - 1;
  for (let x = 0; x < width; x++) {
    const a = outRaw[x > 0 ? x - 1 : 0];
    const b = outRaw[x];
    const c = outRaw[x < lastX ? x + 1 : lastX];
    const smoothed = a * 0.2 + b * 0.6 + c * 0.2;
    const peak = b * 0.9;
    outEnv[x] = peak > smoothed ? peak : smoothed;
  }
}
