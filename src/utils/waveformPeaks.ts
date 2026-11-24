import { WaveformSensitivity } from "../types";

const MAX_PARSED_PEAKS = 200;
const EMPTY_PEAKS = new Float32Array(600);
const peaksCache = new Map<string, Float32Array>();

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
