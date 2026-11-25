import { SampleItem } from "../../types";
import { foldSearchText } from "../format";
import type { TaxonomyWorkerIndex } from "../taxonomyTree";
import { normalizeMusicalOrCamelotKey } from "./musicalKey";

const MAX_FOLDER_INDEX_CACHE = 4096;
const MAX_FOLDED_STR_POOL = 8192;
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_CUSTOM_FACETS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({});
const BUILTIN_FACET_SLUGS = new Set(["category", "genre", "mood", "source"]);

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

interface FolderIndexEntry {
  foldedParent: string;
  foldedFolder: string;
  parentWords: readonly string[];
}

export interface IndexedSampleEntry {
  foldedGenre: string;
  foldedArtist: string;
  foldedAlbum: string;
  foldedYear: string;
  foldedStem: string;
  foldedExt: string;
  foldedParent: string;
  foldedFolder: string;
  nameWords: readonly string[];
  parentWords: readonly string[];
  tagNamesFolded: readonly string[];
  tagPathsFolded: readonly string[];
  genreTagNamesFolded: readonly string[];
  moodTagNamesFolded: readonly string[];
  sourceTagNamesFolded: readonly string[];
  customFacetTermsFolded: Readonly<Record<string, readonly string[]>>;
  detectedBpm: number | null;
  effectiveCamelotKey: string;
}

/**
 * WeakMap keyed by immutable `SampleItem` references so evicted/mutated samples
 * are automatically GC'd without storing 10 duplicate raw-field copies per row.
 */
let sampleIndexCache = new WeakMap<SampleItem, IndexedSampleEntry>();
let activeSearchTaxonomy: TaxonomyWorkerIndex | null = null;
let knownCustomFacetSlugs: ReadonlySet<string> = new Set<string>();
const folderIndexCache = new Map<string, FolderIndexEntry>();
const foldedStringPool = new Map<string, string>();

export function getKnownCustomFacetSlugs(): ReadonlySet<string> {
  return knownCustomFacetSlugs;
}

export function setSmartSearchTaxonomy(
  taxonomy: TaxonomyWorkerIndex | null
): void {
  if (activeSearchTaxonomy === taxonomy) return;
  activeSearchTaxonomy = taxonomy;
  if (taxonomy?.facetDomainBySlug) {
    const custom = new Set<string>();
    for (const rawSlug of Object.keys(taxonomy.facetDomainBySlug)) {
      const foldedSlug = foldSearchText(rawSlug);
      if (foldedSlug && !BUILTIN_FACET_SLUGS.has(foldedSlug)) {
        custom.add(foldedSlug);
      }
    }
    knownCustomFacetSlugs = custom;
  } else {
    knownCustomFacetSlugs = new Set<string>();
  }
  sampleIndexCache = new WeakMap<SampleItem, IndexedSampleEntry>();
}

export function clearSmartSearchCache(): void {
  sampleIndexCache = new WeakMap<SampleItem, IndexedSampleEntry>();
  folderIndexCache.clear();
  foldedStringPool.clear();
}

/**
 * Kept for API compatibility; `sampleIndexCache` is a `WeakMap<SampleItem, ...>`
 * so removed samples are reclaimed automatically by GC.
 */
export function pruneSmartSearchCache(
  validIds: ReadonlyMap<number, unknown>
): void {
  if (validIds.size === 0) {
    clearSmartSearchCache();
  }
}

function internFolded(raw: string): string {
  if (!raw) return "";
  let cached = foldedStringPool.get(raw);
  if (cached !== undefined) return cached;
  cached = foldSearchText(raw);
  if (foldedStringPool.size < MAX_FOLDED_STR_POOL) {
    foldedStringPool.set(raw, cached);
  }
  return cached;
}

function getFolderIndex(folderPath: string): FolderIndexEntry {
  const key = folderPath || "";
  const hit = folderIndexCache.get(key);
  if (hit) return hit;

  const normFolder = key.replace(/\\/g, "/");
  const lastSlash = normFolder.lastIndexOf("/");
  const rawParent = lastSlash >= 0 ? normFolder.slice(lastSlash + 1) : normFolder;
  const foldedParent = foldSearchText(rawParent);
  const foldedFolder = foldSearchText(normFolder);
  const parentWords = rawParent ? tokenizeSearchWords(rawParent) : EMPTY_STRINGS;
  const entry: FolderIndexEntry = { foldedParent, foldedFolder, parentWords };

  if (folderIndexCache.size >= MAX_FOLDER_INDEX_CACHE) {
    folderIndexCache.clear();
  }
  folderIndexCache.set(key, entry);
  return entry;
}

export function getNormalizedPhraseStem(idx: IndexedSampleEntry): string {
  return idx.foldedStem.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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

export function getIndexedSample(sample: SampleItem): IndexedSampleEntry {
  const cached = sampleIndexCache.get(sample);
  if (cached) {
    return cached;
  }

  const rawGenre = sample.genre || "";
  const rawArtist = sample.artist || "";
  const rawAlbum = sample.album || "";
  const rawYear = sample.year || "";
  const rawBpm = sample.bpm ?? null;
  const rawMusicalKey = sample.musical_key || "";
  const rawCamelotKey = sample.camelot_key || "";

  const dotIdx = sample.file_name.lastIndexOf(".");
  const rawStem =
    dotIdx > 0 ? sample.file_name.slice(0, dotIdx) : sample.file_name;
  const foldedStem = foldSearchText(rawStem);
  const rawExt = sample.extension || "";
  const foldedExt = rawExt
    ? internFolded(rawExt.startsWith(".") ? rawExt.slice(1) : rawExt)
    : "";
  const foldedGenre = internFolded(rawGenre);
  const foldedArtist = internFolded(rawArtist);
  const foldedAlbum = internFolded(rawAlbum);
  const foldedYear = internFolded(rawYear);

  const folderEntry = getFolderIndex(sample.folder_path || "");
  const nameWords = rawStem ? tokenizeSearchWords(rawStem) : EMPTY_STRINGS;

  let tagNamesFolded: readonly string[] = EMPTY_STRINGS;
  let tagPathsFolded: readonly string[] = EMPTY_STRINGS;
  let genreTagNamesFolded: readonly string[] = EMPTY_STRINGS;
  let moodTagNamesFolded: readonly string[] = EMPTY_STRINGS;
  let sourceTagNamesFolded: readonly string[] = EMPTY_STRINGS;
  let customFacetTermsFolded: Readonly<Record<string, readonly string[]>> =
    EMPTY_CUSTOM_FACETS;

  if (sample.tags && sample.tags.length > 0) {
    const names = new Set<string>();
    const paths = new Set<string>();
    const genres = new Set<string>();
    const moods = new Set<string>();
    const sources = new Set<string>();
    const customSets = new Map<string, Set<string>>();
    const metaMap = activeSearchTaxonomy?.searchMetaByTagId;
    const facetDomains = activeSearchTaxonomy?.facetDomainBySlug;
    const facetSlugsById = activeSearchTaxonomy?.facetByTagId;

    const addCustomTerm = (slug: string, val: string) => {
      if (!val) return;
      let bucket = customSets.get(slug);
      if (!bucket) {
        bucket = new Set<string>();
        customSets.set(slug, bucket);
      }
      bucket.add(val);
    };

    for (let i = 0; i < sample.tags.length; i++) {
      const t = sample.tags[i];
      const foldedName = internFolded(t.name);
      if (foldedName) names.add(foldedName);
      const meta = metaMap?.[t.id];
      if (meta) {
        if (meta.slashPath) paths.add(internFolded(meta.slashPath));
        const foldedAncestors: string[] = [];
        for (let a = 0; a < meta.ancestors.length; a++) {
          const fa = internFolded(meta.ancestors[a]);
          if (fa) {
            names.add(fa);
            foldedAncestors.push(fa);
          }
        }
        const foldedAliases: string[] = [];
        for (let a = 0; a < meta.aliases.length; a++) {
          const al = internFolded(meta.aliases[a]);
          if (al) {
            names.add(al);
            foldedAliases.push(al);
          }
        }

        const facetSlugFolded = internFolded(meta.facet);
        const isGenreDomain =
          meta.domain === "genres" ||
          meta.facet === "genre" ||
          meta.facet === "mood" ||
          facetDomains?.[meta.facet] === "genres";

        if (isGenreDomain) {
          if (foldedName) genres.add(foldedName);
          for (let a = 0; a < foldedAncestors.length; a++) {
            genres.add(foldedAncestors[a]);
          }
          for (let a = 0; a < foldedAliases.length; a++) {
            genres.add(foldedAliases[a]);
          }
        }
        if (meta.facet === "mood") {
          if (foldedName) moods.add(foldedName);
          for (let a = 0; a < foldedAncestors.length; a++) {
            moods.add(foldedAncestors[a]);
          }
          for (let a = 0; a < foldedAliases.length; a++) {
            moods.add(foldedAliases[a]);
          }
        } else if (meta.facet === "source") {
          if (foldedName) sources.add(foldedName);
          for (let a = 0; a < foldedAliases.length; a++) {
            sources.add(foldedAliases[a]);
          }
        }
        if (facetSlugFolded && !BUILTIN_FACET_SLUGS.has(facetSlugFolded)) {
          addCustomTerm(facetSlugFolded, foldedName);
          for (let a = 0; a < foldedAncestors.length; a++) {
            addCustomTerm(facetSlugFolded, foldedAncestors[a]);
          }
          for (let a = 0; a < foldedAliases.length; a++) {
            addCustomTerm(facetSlugFolded, foldedAliases[a]);
          }
        }
      } else {
        if (foldedName) paths.add(foldedName);
        const mappedSlug = facetSlugsById?.[t.id];
        const rawSlug = mappedSlug ? internFolded(mappedSlug) : "";
        if (rawSlug === "genre") {
          if (foldedName) genres.add(foldedName);
        } else if (rawSlug === "mood") {
          if (foldedName) {
            genres.add(foldedName);
            moods.add(foldedName);
          }
        } else if (rawSlug === "source") {
          if (foldedName) sources.add(foldedName);
        } else if (rawSlug && !BUILTIN_FACET_SLUGS.has(rawSlug)) {
          if (facetDomains?.[rawSlug] === "genres" && foldedName) {
            genres.add(foldedName);
          }
          addCustomTerm(rawSlug, foldedName);
        }
      }
    }
    tagNamesFolded = names.size > 0 ? Array.from(names) : EMPTY_STRINGS;
    tagPathsFolded = paths.size > 0 ? Array.from(paths) : EMPTY_STRINGS;
    genreTagNamesFolded = genres.size > 0 ? Array.from(genres) : EMPTY_STRINGS;
    moodTagNamesFolded = moods.size > 0 ? Array.from(moods) : EMPTY_STRINGS;
    sourceTagNamesFolded = sources.size > 0 ? Array.from(sources) : EMPTY_STRINGS;
    if (customSets.size > 0) {
      const rec: Record<string, readonly string[]> = {};
      for (const [slug, vals] of customSets.entries()) {
        rec[slug] = Array.from(vals);
      }
      customFacetTermsFolded = rec;
    }
  }

  const detectedBpm = rawBpm ?? extractBpmFromStem(foldedStem);

  let effectiveCamelotKey = rawCamelotKey.trim().toUpperCase();
  if (!effectiveCamelotKey && rawMusicalKey) {
    const norm = normalizeMusicalOrCamelotKey(rawMusicalKey);
    if (norm) effectiveCamelotKey = norm.camelotKey;
  }

  const entry: IndexedSampleEntry = {
    foldedGenre,
    foldedArtist,
    foldedAlbum,
    foldedYear,
    foldedStem,
    foldedExt,
    foldedParent: folderEntry.foldedParent,
    foldedFolder: folderEntry.foldedFolder,
    nameWords,
    parentWords: folderEntry.parentWords,
    tagNamesFolded,
    tagPathsFolded,
    genreTagNamesFolded,
    moodTagNamesFolded,
    sourceTagNamesFolded,
    customFacetTermsFolded,
    detectedBpm,
    effectiveCamelotKey,
  };

  sampleIndexCache.set(sample, entry);
  return entry;
}
