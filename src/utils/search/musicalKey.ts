const MAJOR_DISPLAY_AND_CAMELOT: ReadonlyArray<readonly [string, string]> = [
  ["C", "8B"],
  ["Db", "3B"],
  ["D", "10B"],
  ["Eb", "5B"],
  ["E", "12B"],
  ["F", "7B"],
  ["F#", "2B"],
  ["G", "9B"],
  ["Ab", "4B"],
  ["A", "11B"],
  ["Bb", "6B"],
  ["B", "1B"],
];

const MINOR_DISPLAY_AND_CAMELOT: ReadonlyArray<readonly [string, string]> = [
  ["Cm", "5A"],
  ["C#m", "12A"],
  ["Dm", "7A"],
  ["Ebm", "2A"],
  ["Em", "9A"],
  ["Fm", "4A"],
  ["F#m", "11A"],
  ["Gm", "6A"],
  ["Abm", "1A"],
  ["Am", "8A"],
  ["Bbm", "3A"],
  ["Bm", "10A"],
];

/**
 * Normalizes any musical key (`"am"`, `"c#m"`, `"fmaj"`, `"db"`) or Camelot code (`"8a"`, `"11B"`)
 * into a canonical `{ musicalKey, camelotKey }` pair, or `null` if invalid.
 */
export function normalizeMusicalOrCamelotKey(
  raw: string
): { musicalKey: string; camelotKey: string } | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 24) return null;

  const upper = trimmed.toUpperCase();
  const camMatch = upper.match(/^(1[0-2]|[1-9])([AB])$/);
  if (camMatch) {
    const cam = `${camMatch[1]}${camMatch[2]}`;
    const list =
      camMatch[2] === "A"
        ? MINOR_DISPLAY_AND_CAMELOT
        : MAJOR_DISPLAY_AND_CAMELOT;
    const hit = list.find(([, c]) => c === cam);
    if (hit) return { musicalKey: hit[0], camelotKey: hit[1] };
  }

  const compact = trimmed.replace(/[\s_-]+/g, "");
  const noteMatch = compact.match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
  if (!noteMatch) return null;

  const noteChar = noteMatch[1].toUpperCase();
  const baseMap: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const basePc = baseMap[noteChar];
  if (basePc === undefined) return null;

  const acc = noteMatch[2];
  let offset = 0;
  if (acc === "#" || acc === "♯") offset = 1;
  else if (acc === "b" || acc === "♭") offset = -1;

  const pc = (((basePc + offset) % 12) + 12) % 12;
  const modeLower = noteMatch[3].toLowerCase();
  let isMinor = false;
  if (modeLower === "" || modeLower === "maj" || modeLower === "major") {
    isMinor = false;
  } else if (
    modeLower === "m" ||
    modeLower === "min" ||
    modeLower === "minor" ||
    modeLower === "min7"
  ) {
    isMinor = true;
  } else {
    return null;
  }

  const pair = isMinor
    ? MINOR_DISPLAY_AND_CAMELOT[pc]
    : MAJOR_DISPLAY_AND_CAMELOT[pc];
  return { musicalKey: pair[0], camelotKey: pair[1] };
}

/**
 * Returns the 4 harmonically compatible Camelot codes for a given Camelot key
 * (same key, `-1` fifth, `+1` fifth, and relative major/minor `A <-> B`).
 */
export function getHarmonicCamelotNeighbors(camelotKey: string): string[] {
  const m = camelotKey.trim().toUpperCase().match(/^(1[0-2]|[1-9])([AB])$/);
  if (!m) return [];
  const num = Number(m[1]);
  const letter = m[2] as "A" | "B";
  const prev = ((num - 2 + 12) % 12) + 1;
  const next = (num % 12) + 1;
  const relLetter = letter === "A" ? "B" : "A";
  return [`${num}${letter}`, `${prev}${letter}`, `${next}${letter}`, `${num}${relLetter}`];
}

export interface TransposedMusicalKey {
  fromKey: string;
  toKey: string;
  fromCamelot: string;
  toCamelot: string;
}

/**
 * Transposes a musical key or Camelot code by `semitones`, returning both
 * original and transposed musical + Camelot key labels (e.g. `Am -> Cm`).
 */
export function transposeMusicalKey(
  rawKey: string,
  semitones: number
): TransposedMusicalKey | null {
  if (!rawKey || !Number.isFinite(semitones)) return null;
  const norm = normalizeMusicalOrCamelotKey(rawKey);
  if (!norm) return null;

  const isMinor = norm.camelotKey.endsWith("A");
  const table = isMinor ? MINOR_DISPLAY_AND_CAMELOT : MAJOR_DISPLAY_AND_CAMELOT;
  const baseIdx = table.findIndex(([, cam]) => cam === norm.camelotKey);
  if (baseIdx < 0) return null;

  const shift = Math.round(semitones);
  const nextIdx = (((baseIdx + shift) % 12) + 12) % 12;
  const [toKey, toCamelot] = table[nextIdx];
  return {
    fromKey: norm.musicalKey,
    toKey,
    fromCamelot: norm.camelotKey,
    toCamelot,
  };
}
