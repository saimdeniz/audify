export interface CamelotKeyDef {
  camelot: string;
  key: string;
  mode: "minor" | "major";
}

export const CAMELOT_MINOR_KEYS: readonly CamelotKeyDef[] = [
  { camelot: "1A", key: "Abm", mode: "minor" },
  { camelot: "2A", key: "Ebm", mode: "minor" },
  { camelot: "3A", key: "Bbm", mode: "minor" },
  { camelot: "4A", key: "Fm", mode: "minor" },
  { camelot: "5A", key: "Cm", mode: "minor" },
  { camelot: "6A", key: "Gm", mode: "minor" },
  { camelot: "7A", key: "Dm", mode: "minor" },
  { camelot: "8A", key: "Am", mode: "minor" },
  { camelot: "9A", key: "Em", mode: "minor" },
  { camelot: "10A", key: "Bm", mode: "minor" },
  { camelot: "11A", key: "F#m", mode: "minor" },
  { camelot: "12A", key: "C#m", mode: "minor" },
];

export const CAMELOT_MAJOR_KEYS: readonly CamelotKeyDef[] = [
  { camelot: "1B", key: "B", mode: "major" },
  { camelot: "2B", key: "F#", mode: "major" },
  { camelot: "3B", key: "Db", mode: "major" },
  { camelot: "4B", key: "Ab", mode: "major" },
  { camelot: "5B", key: "Eb", mode: "major" },
  { camelot: "6B", key: "Bb", mode: "major" },
  { camelot: "7B", key: "F", mode: "major" },
  { camelot: "8B", key: "C", mode: "major" },
  { camelot: "9B", key: "G", mode: "major" },
  { camelot: "10B", key: "D", mode: "major" },
  { camelot: "11B", key: "A", mode: "major" },
  { camelot: "12B", key: "E", mode: "major" },
];

export const CAMELOT_KEYS: readonly CamelotKeyDef[] = [
  ...CAMELOT_MINOR_KEYS,
  ...CAMELOT_MAJOR_KEYS,
];
