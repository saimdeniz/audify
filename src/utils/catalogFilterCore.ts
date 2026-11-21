import {
  LicenseGroup,
  SampleItem,
  SampleRateFilter,
  SimilaritySession,
  SortDir,
  SortKey,
  TypeFilter,
} from "../types";
import {
  isSampleInLicenseGroup,
  normalizePathForMatch,
  parseSqliteUtcMs,
} from "../utils/format";

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

const textCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
});

const numCollator = new Intl.Collator(undefined, {
  numeric: true,
});

interface CachedNameSortKey {
  fast: boolean;
  key: string;
}

const nameSortKeyCache = new WeakMap<SampleItem, CachedNameSortKey>();
const createdAtMsCache = new WeakMap<SampleItem, number>();

function getCachedCreatedAtMs(sample: SampleItem): number {
  let cached = createdAtMsCache.get(sample);
  if (cached === undefined) {
    cached = parseSqliteUtcMs(sample.created_at);
    createdAtMsCache.set(sample, cached);
  }
  return cached;
}

const ASCII_PRINTABLE_RE = /^[ -~]*$/;
const LONG_DIGIT_RUN_RE = /\d{17,}/;
const DIGIT_RUN_RE = /\d+/g;

function getCachedNameSortKey(sample: SampleItem): CachedNameSortKey {
  let cached = nameSortKeyCache.get(sample);
  if (!cached) {
    const name = sample.file_name;
    const fast = ASCII_PRINTABLE_RE.test(name) && !LONG_DIGIT_RUN_RE.test(name);
    cached = {
      fast,
      key: fast
        ? name.toLowerCase().replace(DIGIT_RUN_RE, (digits) => digits.padStart(16, "0"))
        : name,
    };
    nameSortKeyCache.set(sample, cached);
  }
  return cached;
}

function compareSampleNames(a: SampleItem, b: SampleItem): number {
  const ka = getCachedNameSortKey(a);
  const kb = getCachedNameSortKey(b);
  if (ka.fast && kb.fast) {
    if (ka.key < kb.key) return -1;
    if (ka.key > kb.key) return 1;
    return nameCollator.compare(a.file_name, b.file_name);
  }
  return nameCollator.compare(a.file_name, b.file_name);
}

export function applySort(
  items: SampleItem[],
  sortKey: SortKey | null,
  sortDir: SortDir,
  similaritySession: SimilaritySession | null = null
): SampleItem[] {
  if (!sortKey || items.length <= 1) return items;
  const mul = sortDir === "asc" ? 1 : -1;
  const arr = items.slice();
  switch (sortKey) {
    case "name":
      arr.sort((a, b) => mul * compareSampleNames(a, b));
      break;
    case "class":
      arr.sort((a, b) => {
        if (a.is_loop !== b.is_loop) {
          return mul * (a.is_loop ? 1 : -1);
        }
        return compareSampleNames(a, b);
      });
      break;
    case "artist":
      arr.sort((a, b) => {
        const aa = (a.artist || "").trim();
        const ab = (b.artist || "").trim();
        if (!aa && ab) return 1;
        if (aa && !ab) return -1;
        const cmp = textCollator.compare(aa, ab);
        if (cmp !== 0) return mul * cmp;
        return compareSampleNames(a, b);
      });
      break;
    case "album":
      arr.sort((a, b) => {
        const aa = (a.album || "").trim();
        const ab = (b.album || "").trim();
        if (!aa && ab) return 1;
        if (aa && !ab) return -1;
        const cmp = textCollator.compare(aa, ab);
        if (cmp !== 0) return mul * cmp;
        return compareSampleNames(a, b);
      });
      break;
    case "year":
      arr.sort((a, b) => {
        const ya = (a.year || "").trim();
        const yb = (b.year || "").trim();
        if (!ya && yb) return 1;
        if (ya && !yb) return -1;
        const cmp = numCollator.compare(ya, yb);
        if (cmp !== 0) return mul * cmp;
        return compareSampleNames(a, b);
      });
      break;
    case "genre":
      arr.sort((a, b) => {
        const ga = (a.genre || "").trim();
        const gb = (b.genre || "").trim();
        if (!ga && gb) return 1;
        if (ga && !gb) return -1;
        const cmp = textCollator.compare(ga, gb);
        if (cmp !== 0) return mul * cmp;
        return compareSampleNames(a, b);
      });
      break;
    case "bpm":
      arr.sort((a, b) => {
        const ba = a.bpm;
        const bb = b.bpm;
        const hasA = typeof ba === "number" && Number.isFinite(ba) && ba > 0;
        const hasB = typeof bb === "number" && Number.isFinite(bb) && bb > 0;
        if (!hasA && hasB) return 1;
        if (hasA && !hasB) return -1;
        if (hasA && hasB && ba !== bb) return mul * (ba - bb);
        return compareSampleNames(a, b);
      });
      break;
    case "key":
      arr.sort((a, b) => {
        const ka = (a.camelot_key || a.musical_key || "").trim();
        const kb = (b.camelot_key || b.musical_key || "").trim();
        if (!ka && kb) return 1;
        if (ka && !kb) return -1;
        if (ka && kb) {
          const cmp = numCollator.compare(ka, kb);
          if (cmp !== 0) return mul * cmp;
        }
        return compareSampleNames(a, b);
      });
      break;
    case "duration":
      arr.sort((a, b) => mul * (a.duration_ms - b.duration_ms));
      break;
    case "sample_rate":
      arr.sort(
        (a, b) =>
          mul * (a.sample_rate - b.sample_rate || a.bit_depth - b.bit_depth)
      );
      break;
    case "dateModified":
      arr.sort((a, b) => {
        const ta = a.file_modified_at ?? 0;
        const tb = b.file_modified_at ?? 0;
        const hasA = Number.isFinite(ta) && ta > 0;
        const hasB = Number.isFinite(tb) && tb > 0;
        if (!hasA && hasB) return 1;
        if (hasA && !hasB) return -1;
        if (hasA && hasB && ta !== tb) return mul * (ta - tb);
        return compareSampleNames(a, b);
      });
      break;
    case "dateAdded":
      arr.sort((a, b) => {
        const ta = getCachedCreatedAtMs(a);
        const tb = getCachedCreatedAtMs(b);
        const hasA = ta > 0;
        const hasB = tb > 0;
        if (!hasA && hasB) return 1;
        if (hasA && !hasB) return -1;
        if (hasA && hasB && ta !== tb) return mul * (ta - tb);
        return compareSampleNames(a, b);
      });
      break;
    case "match":
      if (similaritySession && similaritySession.scoresById.size > 0) {
        const anchorId = similaritySession.anchorSample.id;
        const scores = similaritySession.scoresById;
        arr.sort((a, b) => {
          if (sortDir === "desc") {
            if (a.id === anchorId) return -1;
            if (b.id === anchorId) return 1;
          }
          const sa = scores.get(a.id) ?? -1;
          const sb = scores.get(b.id) ?? -1;
          if (sa !== sb) return mul * (sa - sb);
          return compareSampleNames(a, b);
        });
      }
      break;
  }
  return arr;
}

export function applyClientFacetFilters(
  items: SampleItem[],
  typeFilter: TypeFilter,
  srFilter: SampleRateFilter,
  sortKey: SortKey | null = null,
  sortDir: SortDir = "asc",
  similaritySession: SimilaritySession | null = null
): SampleItem[] {
  const hasSim = similaritySession !== null;
  const filtered =
    !hasSim && typeFilter === "all" && srFilter === null
      ? items
      : items.filter((s) => {
          if (similaritySession) {
            const isAnchor = s.id === similaritySession.anchorSample.id;
            const score = similaritySession.scoresById.get(s.id);
            if (!isAnchor && (score === undefined || score < similaritySession.minScore)) {
              return false;
            }
          }
          if (typeFilter === "loop" && !s.is_loop) return false;
          if (typeFilter === "oneshot" && s.is_loop) return false;
          if (srFilter !== null && s.sample_rate !== srFilter) return false;
          return true;
        });
  return applySort(filtered, sortKey, sortDir, similaritySession);
}

export interface InitialSampleViewFilter {
  visibleLibraryIds: ReadonlySet<number>;
  folderFilter: string | null;
  favoriteOnly: boolean;
  recentOnly: boolean;
  recentSampleIds: readonly number[];
  binFilterActive: boolean;
  binSampleIds: readonly number[];
  collectionId: number | null;
  licenseGroup: LicenseGroup | null;
  typeFilter: TypeFilter;
  srFilter: SampleRateFilter;
}

export function doesSampleMatchInitialView(
  sample: SampleItem,
  filter: InitialSampleViewFilter
): boolean {
  if (sample.is_trashed) return false;
  if (!filter.visibleLibraryIds.has(sample.library_id)) return false;
  if (filter.collectionId !== null) return false;
  if (filter.favoriteOnly && !sample.is_favorite) return false;
  if (filter.recentOnly && !filter.recentSampleIds.includes(sample.id)) return false;
  if (filter.binFilterActive && !filter.binSampleIds.includes(sample.id)) return false;
  if (filter.typeFilter === "loop" && !sample.is_loop) return false;
  if (filter.typeFilter === "oneshot" && sample.is_loop) return false;
  if (filter.srFilter !== null && sample.sample_rate !== filter.srFilter) return false;
  if (
    filter.licenseGroup &&
    !isSampleInLicenseGroup(sample.file_path, filter.licenseGroup)
  ) {
    return false;
  }
  if (filter.folderFilter) {
    const normInitFolder = normalizePathForMatch(filter.folderFilter);
    const normDir = normalizePathForMatch(sample.folder_path);
    const normFile = normalizePathForMatch(sample.file_path);
    if (normDir !== normInitFolder && !normFile.startsWith(`${normInitFolder}/`)) {
      return false;
    }
  }
  return true;
}

export function filterBaseSamplesInMemory(
  allSamples: SampleItem[],
  folderFilter: string | null,
  favoriteOnly: boolean,
  recentOnly: boolean,
  recentSampleIds: number[],
  selectedTagIds: number[],
  selectedGenre: string | null,
  selectedLicenseGroupId: string | null,
  licenseGroups: LicenseGroup[],
  binFilterActive: boolean,
  binSampleIds: number[],
  duplicateOrderMap?: ReadonlyMap<number, number> | null
): SampleItem[] {
  const normFolder = folderFilter ? normalizePathForMatch(folderFilter) : null;
  const normPrefix = normFolder ? `${normFolder}/` : null;
  const activeLicenseGroup = selectedLicenseGroupId
    ? licenseGroups.find((g) => g.id === selectedLicenseGroupId) || null
    : null;
  const binIdSet = binFilterActive ? new Set(binSampleIds) : null;
  const recentOrderMap = recentOnly
    ? new Map(recentSampleIds.map((id, idx) => [id, idx]))
    : null;
  const targetGenreLower = selectedGenre ? selectedGenre.toLowerCase() : null;

  const filtered = allSamples.filter((s) => {
    if (duplicateOrderMap && !duplicateOrderMap.has(s.id)) return false;
    if (recentOrderMap && !recentOrderMap.has(s.id)) return false;
    if (binIdSet && !binIdSet.has(s.id)) return false;
    if (favoriteOnly && !s.is_favorite) return false;
    if (targetGenreLower) {
      if ((s.genre || "").toLowerCase() !== targetGenreLower) return false;
    }
    if (activeLicenseGroup) {
      if (
        !isSampleInLicenseGroup(
          s.folder_path || s.file_path,
          activeLicenseGroup
        )
      ) {
        return false;
      }
    }
    if (normFolder) {
      const fp = normalizePathForMatch(s.folder_path);
      if (fp !== normFolder && !fp.startsWith(normPrefix!)) {
        return false;
      }
    }
    if (selectedTagIds.length > 0) {
      const tags = s.tags;
      if (tags.length < selectedTagIds.length) return false;
      for (let r = 0; r < selectedTagIds.length; r++) {
        const reqId = selectedTagIds[r];
        let found = false;
        for (let i = 0; i < tags.length; i++) {
          if (tags[i].id === reqId) {
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    }
    return true;
  });

  if (recentOrderMap) {
    filtered.sort(
      (a, b) =>
        (recentOrderMap.get(a.id) ?? 9999) - (recentOrderMap.get(b.id) ?? 9999)
    );
  } else if (duplicateOrderMap) {
    filtered.sort(
      (a, b) =>
        (duplicateOrderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (duplicateOrderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }
  return filtered;
}
