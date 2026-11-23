import { SampleItem } from "../../types";
import { foldSearchText } from "../format";
import { normalizeMusicalOrCamelotKey } from "./musicalKey";

const MAX_SAMPLE_INDEX_CACHE = 250000;

/**
 * Splits camelCase, PascalCase, letter-digit boundaries, and delimiters into folded tokens.
 * Example: "SciFiWhoosh_01" -> ["scifiwhoosh", "sci", "fi", "whoosh", "01"]
 */
export function tokenizeSearchWords(raw: string): string[] {
  if (!raw) return [];
  const tokens = new Set<string>();
  const chunks = raw.split(/[^\p{L}\p{N}]+/u);

  for (const chunk of chunks) {
    if (!chunk) continue;
    const foldedWhole = foldSearchText(chunk);
    if (foldedWhole) tokens.add(foldedWhole);

    const subParts = chunk
      .replace(/([a-z\u00E0-\u024F])([A-Z\u00C0-\u00DE])/g, "$1 $2")
      .replace(
        /([A-Z\u00C0-\u00DE]+)([A-Z\u00C0-\u00DE][a-z\u00E0-\u024F])/g,
        "$1 $2"
      )
      .replace(/([a-zA-Z\u00C0-\u024F])([0-9])/g, "$1 $2")
      .replace(/([0-9])([a-zA-Z\u00C0-\u024F])/g, "$1 $2")
      .split(" ");

    if (subParts.length > 1) {
      for (const sp of subParts) {
        const f = foldSearchText(sp);
        if (f) tokens.add(f);
      }
    }
  }

  return Array.from(tokens);
}

export interface IndexedSampleEntry {
  sampleId: number;
  fileName: string;
  folderPath: string;
  tagsSig: string;
  rawGenre: string;
  rawArtist: string;
  rawAlbum: string;
  rawYear: string;
  rawBpm: number | null;
  rawMusicalKey: string;
  rawCamelotKey: string;
  foldedGenre: string;
  foldedArtist: string;
  foldedAlbum: string;
  foldedYear: string;
  foldedStem: string;
  normalizedPhraseStem: string;
  foldedExt: string;
  foldedParent: string;
  foldedFolder: string;
  nameWords: string[];
  parentWords: string[];
  tagNamesFolded: string[];
  detectedBpm: number | null;
  effectiveCamelotKey: string;
}

const sampleIndexCache = new Map<number, IndexedSampleEntry>();

export function clearSmartSearchCache(): void {
  sampleIndexCache.clear();
}

/**
 * Removes only entries whose sample IDs are no longer in the active catalog,
 * preserving valid `IndexedSampleEntry` records across incremental updates.
 */
export function pruneSmartSearchCache(
  validIds: ReadonlyMap<number, unknown>
): void {
  if (sampleIndexCache.size === 0) return;
  if (validIds.size === 0) {
    sampleIndexCache.clear();
    return;
  }
  for (const id of sampleIndexCache.keys()) {
    if (!validIds.has(id)) {
      sampleIndexCache.delete(id);
    }
  }
}

function extractBpmFromStem(foldedStem: string): number | null {
  // Match patterns like "120bpm", "128.5bpm", "120_bpm", "bpm120", "bpm_95"
  const m1 = foldedStem.match(
    /(?:^|[^0-9])((?:[3-9][0-9]|[12][0-9]{2}|300)(?:\.[0-9]+)?)\s*[_-]?\s*bpm(?:$|[^a-z0-9])/
  );
  if (m1) return Number(m1[1]);
  const m2 = foldedStem.match(
    /(?:^|[^a-z0-9])bpm\s*[_-]?\s*((?:[3-9][0-9]|[12][0-9]{2}|300)(?:\.[0-9]+)?)(?:$|[^0-9])/
  );
  if (m2) return Number(m2[1]);
  return null;
}

function buildTagsSignature(sample: SampleItem): string {
  if (!sample.tags || sample.tags.length === 0) return "";
  if (sample.tags.length === 1) {
    return `${sample.tags[0].id}:${sample.tags[0].name}`;
  }
  let sig = "";
  for (let i = 0; i < sample.tags.length; i++) {
    const t = sample.tags[i];
    if (i > 0) sig += "|";
    sig += `${t.id}:${t.name}`;
  }
  return sig;
}

export function getIndexedSample(sample: SampleItem): IndexedSampleEntry {
  const rawGenre = sample.genre || "";
  const rawArtist = sample.artist || "";
  const rawAlbum = sample.album || "";
  const rawYear = sample.year || "";
  const rawBpm = sample.bpm ?? null;
  const rawMusicalKey = sample.musical_key || "";
  const rawCamelotKey = sample.camelot_key || "";
  const tagsSig = buildTagsSignature(sample);

  const cached = sampleIndexCache.get(sample.id);
  if (
    cached &&
    cached.fileName === sample.file_name &&
    cached.folderPath === sample.folder_path &&
    cached.tagsSig === tagsSig &&
    cached.rawGenre === rawGenre &&
    cached.rawArtist === rawArtist &&
    cached.rawAlbum === rawAlbum &&
    cached.rawYear === rawYear &&
    cached.rawBpm === rawBpm &&
    cached.rawMusicalKey === rawMusicalKey &&
    cached.rawCamelotKey === rawCamelotKey
  ) {
    return cached;
  }

  const dotIdx = sample.file_name.lastIndexOf(".");
  const rawStem =
    dotIdx > 0 ? sample.file_name.slice(0, dotIdx) : sample.file_name;
  const foldedStem = foldSearchText(rawStem);
  const normalizedPhraseStem = foldedStem
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const foldedExt = foldSearchText(sample.extension || "").replace(/^\./, "");
  const foldedGenre = foldSearchText(rawGenre);
  const foldedArtist = foldSearchText(rawArtist);
  const foldedAlbum = foldSearchText(rawAlbum);
  const foldedYear = foldSearchText(rawYear);

  const normFolder = (sample.folder_path || "").replace(/\\/g, "/");
  const lastSlash = normFolder.lastIndexOf("/");
  const rawParent =
    lastSlash >= 0 ? normFolder.slice(lastSlash + 1) : normFolder;
  const foldedParent = foldSearchText(rawParent);
  const foldedFolder = foldSearchText(normFolder);

  const nameWords = tokenizeSearchWords(rawStem);
  const parentWords = tokenizeSearchWords(rawParent);
  const tagNamesFolded = sample.tags.map((t) => foldSearchText(t.name));
  const detectedBpm = rawBpm ?? extractBpmFromStem(foldedStem);

  let effectiveCamelotKey = rawCamelotKey.trim().toUpperCase();
  if (!effectiveCamelotKey && rawMusicalKey) {
    const norm = normalizeMusicalOrCamelotKey(rawMusicalKey);
    if (norm) effectiveCamelotKey = norm.camelotKey;
  }

  const entry: IndexedSampleEntry = {
    sampleId: sample.id,
    fileName: sample.file_name,
    folderPath: sample.folder_path,
    tagsSig,
    rawGenre,
    rawArtist,
    rawAlbum,
    rawYear,
    rawBpm,
    rawMusicalKey,
    rawCamelotKey,
    foldedGenre,
    foldedArtist,
    foldedAlbum,
    foldedYear,
    foldedStem,
    normalizedPhraseStem,
    foldedExt,
    foldedParent,
    foldedFolder,
    nameWords,
    parentWords,
    tagNamesFolded,
    detectedBpm,
    effectiveCamelotKey,
  };

  if (sampleIndexCache.size >= MAX_SAMPLE_INDEX_CACHE) {
    let toEvict = Math.floor(MAX_SAMPLE_INDEX_CACHE / 5);
    for (const k of sampleIndexCache.keys()) {
      sampleIndexCache.delete(k);
      if (--toEvict <= 0) break;
    }
  }

  sampleIndexCache.set(sample.id, entry);
  return entry;
}
