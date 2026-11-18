export interface NumericRangeSpec {
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
}

export function matchesNumericRange(
  value: number,
  spec: NumericRangeSpec
): boolean {
  if (!Number.isFinite(value)) return false;
  if (spec.min !== undefined) {
    if (spec.minExclusive ? value <= spec.min : value < spec.min) {
      return false;
    }
  }
  if (spec.max !== undefined) {
    if (spec.maxExclusive ? value >= spec.max : value > spec.max) {
      return false;
    }
  }
  return true;
}

export function parseNumericRangeSpec(
  rawVal: string,
  scaleValue: (num: number, unit: string) => number | null
): NumericRangeSpec | null {
  const s = rawVal.trim().toLowerCase();
  if (!s) return null;

  const rangeMatch = s.match(
    /^(\d+(?:\.\d+)?)\s*([a-z]*)\s*-\s*(\d+(?:\.\d+)?)\s*([a-z]*)$/
  );
  if (rangeMatch) {
    const u1 = rangeMatch[2] || rangeMatch[4];
    const u2 = rangeMatch[4] || rangeMatch[2];
    const a = scaleValue(Number(rangeMatch[1]), u1);
    const b = scaleValue(Number(rangeMatch[3]), u2);
    if (a === null || b === null) return null;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  const cmpMatch = s.match(/^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!cmpMatch) return null;
  const op = cmpMatch[1] || "=";
  const scaled = scaleValue(Number(cmpMatch[2]), cmpMatch[3]);
  if (scaled === null) return null;

  if (op === "<") return { max: scaled, maxExclusive: true };
  if (op === "<=") return { max: scaled };
  if (op === ">") return { min: scaled, minExclusive: true };
  if (op === ">=") return { min: scaled };
  return { min: scaled, max: scaled };
}

export function parseChannelRange(rawVal: string): NumericRangeSpec | null {
  const s = rawVal.trim().toLowerCase();
  if (s === "mono" || s === "ch1" || s === "1ch") return { min: 1, max: 1 };
  if (s === "stereo" || s === "ch2" || s === "2ch") return { min: 2, max: 2 };
  if (s === "multi" || s === "multichannel" || s === "surround") {
    return { min: 3, max: 64 };
  }
  return parseNumericRangeSpec(s, (n, unit) => {
    if (!Number.isFinite(n) || n <= 0) return null;
    if (unit && unit !== "ch" && unit !== "channels") return null;
    return Math.round(n);
  });
}

export function parseSampleRateRange(rawVal: string): NumericRangeSpec | null {
  return parseNumericRangeSpec(rawVal, (n, unit) => {
    if (!Number.isFinite(n) || n <= 0) return null;
    if (unit === "k" || unit === "khz") return Math.round(n * 1000);
    if (unit === "hz" || !unit) {
      return !unit && n < 1000 ? Math.round(n * 1000) : Math.round(n);
    }
    return null;
  });
}

export function parseBitDepthRange(rawVal: string): NumericRangeSpec | null {
  return parseNumericRangeSpec(rawVal, (n, unit) => {
    if (!Number.isFinite(n) || n <= 0) return null;
    if (unit && unit !== "b" && unit !== "bit" && unit !== "bits") return null;
    return Math.round(n);
  });
}

export function parseFileSizeRange(rawVal: string): NumericRangeSpec | null {
  return parseNumericRangeSpec(rawVal, (n, unit) => {
    if (!Number.isFinite(n) || n < 0) return null;
    if (!unit || unit === "mb" || unit === "m") {
      return Math.round(n * 1024 * 1024);
    }
    if (unit === "kb" || unit === "k") return Math.round(n * 1024);
    if (unit === "gb" || unit === "g") {
      return Math.round(n * 1024 * 1024 * 1024);
    }
    if (unit === "b" || unit === "bytes") return Math.round(n);
    return null;
  });
}

export interface TechnicalFilterCriteria {
  channelRanges: NumericRangeSpec[];
  excludeChannelRanges: NumericRangeSpec[];
  sampleRateRanges: NumericRangeSpec[];
  excludeSampleRateRanges: NumericRangeSpec[];
  bitDepthRanges: NumericRangeSpec[];
  excludeBitDepthRanges: NumericRangeSpec[];
  fileSizeRanges: NumericRangeSpec[];
  excludeFileSizeRanges: NumericRangeSpec[];
}

function matchesDimension(
  val: number,
  include: NumericRangeSpec[],
  exclude: NumericRangeSpec[]
): boolean {
  for (let i = 0; i < include.length; i++) {
    if (!matchesNumericRange(val, include[i])) return false;
  }
  for (let i = 0; i < exclude.length; i++) {
    if (matchesNumericRange(val, exclude[i])) return false;
  }
  return true;
}

export function matchesTechnicalCriteria(
  sample: {
    channels: number;
    sample_rate: number;
    bit_depth: number;
    file_size: number;
  },
  criteria: TechnicalFilterCriteria
): boolean {
  return (
    matchesDimension(
      sample.channels,
      criteria.channelRanges,
      criteria.excludeChannelRanges
    ) &&
    matchesDimension(
      sample.sample_rate,
      criteria.sampleRateRanges,
      criteria.excludeSampleRateRanges
    ) &&
    matchesDimension(
      sample.bit_depth,
      criteria.bitDepthRanges,
      criteria.excludeBitDepthRanges
    ) &&
    matchesDimension(
      sample.file_size,
      criteria.fileSizeRanges,
      criteria.excludeFileSizeRanges
    )
  );
}

const TECH_OPERATOR_ROUTES = [
  {
    keys: ["ch", "chan", "channel", "channels"] as const,
    parse: parseChannelRange,
    incKey: "channelRanges" as const,
    excKey: "excludeChannelRanges" as const,
  },
  {
    keys: ["sr", "rate", "samplerate"] as const,
    parse: parseSampleRateRange,
    incKey: "sampleRateRanges" as const,
    excKey: "excludeSampleRateRanges" as const,
  },
  {
    keys: ["bit", "bits", "bitdepth"] as const,
    parse: parseBitDepthRange,
    incKey: "bitDepthRanges" as const,
    excKey: "excludeBitDepthRanges" as const,
  },
  {
    keys: ["size", "filesize"] as const,
    parse: parseFileSizeRange,
    incKey: "fileSizeRanges" as const,
    excKey: "excludeFileSizeRanges" as const,
  },
];

export function applyTechnicalOperatorToken(
  key: string,
  val: string,
  isNegated: boolean,
  criteria: TechnicalFilterCriteria
): boolean {
  for (const route of TECH_OPERATOR_ROUTES) {
    if ((route.keys as readonly string[]).includes(key)) {
      const parsedRange = route.parse(val);
      if (!parsedRange) return false;
      (isNegated ? criteria[route.excKey] : criteria[route.incKey]).push(
        parsedRange
      );
      return true;
    }
  }
  return false;
}
