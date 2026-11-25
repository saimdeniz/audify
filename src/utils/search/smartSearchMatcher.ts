import type { SampleItem } from "../../types";
import type { ParsedSearchQuery } from "./queryParser";
import {
  getIndexedSample,
  getNormalizedPhraseStem,
  type IndexedSampleEntry,
} from "./sampleIndex";
import { matchesTechnicalCriteria } from "./technicalOperators";

const STRUCTURAL_ONLY_INDEX: IndexedSampleEntry = {
  foldedGenre: "",
  foldedArtist: "",
  foldedAlbum: "",
  foldedYear: "",
  foldedStem: "",
  foldedExt: "",
  foldedParent: "",
  foldedFolder: "",
  nameWords: [],
  parentWords: [],
  tagNamesFolded: [],
  tagPathsFolded: [],
  genreTagNamesFolded: [],
  moodTagNamesFolded: [],
  sourceTagNamesFolded: [],
  customFacetTermsFolded: {},
  detectedBpm: null,
  effectiveCamelotKey: "",
};

export function queryRequiresTextIndex(parsed: ParsedSearchQuery): boolean {
  return (
    parsed.positiveOrGroups.length > 0 ||
    parsed.negativeTerms.length > 0 ||
    parsed.negativePhrases.length > 0 ||
    parsed.minBpm !== null ||
    parsed.maxBpm !== null ||
    parsed.excludeBpmRanges.length > 0 ||
    parsed.keyAllowedGroups.length > 0 ||
    parsed.excludeCamelotKeys.length > 0 ||
    parsed.extTerms.length > 0 ||
    parsed.excludeExtTerms.length > 0 ||
    parsed.tagTerms.length > 0 ||
    parsed.excludeTagTerms.length > 0 ||
    parsed.genreTerms.length > 0 ||
    parsed.excludeGenreTerms.length > 0 ||
    parsed.moodTerms.length > 0 ||
    parsed.excludeMoodTerms.length > 0 ||
    parsed.sourceTerms.length > 0 ||
    parsed.excludeSourceTerms.length > 0 ||
    Object.keys(parsed.customFacetTerms).length > 0 ||
    Object.keys(parsed.excludeCustomFacetTerms).length > 0 ||
    parsed.folderTerms.length > 0 ||
    parsed.excludeFolderTerms.length > 0 ||
    parsed.artistTerms.length > 0 ||
    parsed.excludeArtistTerms.length > 0 ||
    parsed.albumTerms.length > 0 ||
    parsed.excludeAlbumTerms.length > 0 ||
    parsed.yearTerms.length > 0 ||
    parsed.excludeYearTerms.length > 0
  );
}

export function matchesPhraseInSample(
  idx: IndexedSampleEntry,
  phrase: string
): boolean {
  const phraseStem = getNormalizedPhraseStem(idx);
  if (phraseStem.includes(phrase)) return true;
  if (idx.foldedArtist && idx.foldedArtist.includes(phrase)) return true;
  if (idx.foldedAlbum && idx.foldedAlbum.includes(phrase)) return true;
  if (idx.foldedGenre && idx.foldedGenre.includes(phrase)) return true;
  if (idx.tagNamesFolded.some((t) => t.includes(phrase))) return true;
  const normFolderWords = idx.foldedFolder.replace(/[^\p{L}\p{N}]+/gu, " ");
  if (normFolderWords.includes(phrase)) return true;
  return false;
}

export function matchesTermInSample(
  idx: IndexedSampleEntry,
  term: string
): boolean {
  if (idx.nameWords.includes(term)) return true;
  if (idx.foldedStem.includes(term)) return true;
  if (idx.foldedGenre && idx.foldedGenre.includes(term)) return true;
  if (idx.foldedArtist && idx.foldedArtist.includes(term)) return true;
  if (idx.foldedAlbum && idx.foldedAlbum.includes(term)) return true;
  if (idx.foldedYear && idx.foldedYear === term) return true;
  if (idx.tagNamesFolded.some((t) => t.includes(term))) return true;
  if (idx.foldedParent.includes(term)) return true;
  if (term.length >= 3 && idx.foldedFolder.includes(term)) return true;
  return false;
}

function matchesTagOperatorTerm(idx: IndexedSampleEntry, term: string): boolean {
  if (term.includes("/")) {
    const clean = term.replace(/^\/+|\/+$/g, "");
    if (!clean) return false;
    return idx.tagPathsFolded.some(
      (p) =>
        p === clean ||
        p.startsWith(`${clean}/`) ||
        p.endsWith(`/${clean}`) ||
        p.includes(`/${clean}/`)
    );
  }
  return idx.tagNamesFolded.some((tn) => tn.includes(term));
}

function matchesGenreOperatorTerm(idx: IndexedSampleEntry, term: string): boolean {
  if (idx.foldedGenre && idx.foldedGenre.includes(term)) return true;
  if (idx.genreTagNamesFolded.some((g) => g.includes(term))) return true;
  if (idx.moodTagNamesFolded.some((m) => m.includes(term))) return true;
  return false;
}

function matchesMoodOperatorTerm(idx: IndexedSampleEntry, term: string): boolean {
  if (idx.moodTagNamesFolded.some((m) => m.includes(term))) return true;
  if (idx.foldedGenre && idx.foldedGenre.includes(term)) return true;
  return false;
}

function matchesSourceOperatorTerm(idx: IndexedSampleEntry, term: string): boolean {
  if (idx.sourceTagNamesFolded.some((s) => s.includes(term))) return true;
  if (idx.tagNamesFolded.some((t) => t === term || t.includes(term))) return true;
  return false;
}

function matchesCustomFacetOperatorTerm(
  idx: IndexedSampleEntry,
  slug: string,
  term: string
): boolean {
  const bucket = idx.customFacetTermsFolded[slug];
  if (!bucket || bucket.length === 0) return false;
  if (term.includes("/")) {
    return matchesTagOperatorTerm(idx, term);
  }
  return bucket.some((v) => v.includes(term));
}

export function evaluateSmartSearchStructural(
  sample: SampleItem,
  parsed: ParsedSearchQuery,
  needsTextIndex: boolean
): IndexedSampleEntry | null {
  if (parsed.requireLoop !== null && sample.is_loop !== parsed.requireLoop) {
    return null;
  }
  if (parsed.requireFav !== null && sample.is_favorite !== parsed.requireFav) {
    return null;
  }
  if (
    parsed.minDurationMs !== null &&
    sample.duration_ms < parsed.minDurationMs
  ) {
    return null;
  }
  if (
    parsed.maxDurationMs !== null &&
    sample.duration_ms > parsed.maxDurationMs
  ) {
    return null;
  }
  if (!matchesTechnicalCriteria(sample, parsed)) {
    return null;
  }

  if (!needsTextIndex) {
    return STRUCTURAL_ONLY_INDEX;
  }

  const idx = getIndexedSample(sample);

  if (parsed.minBpm !== null || parsed.maxBpm !== null) {
    if (idx.detectedBpm === null) return null;
    if (parsed.minBpm !== null && idx.detectedBpm < parsed.minBpm) return null;
    if (parsed.maxBpm !== null && idx.detectedBpm > parsed.maxBpm) return null;
  }
  if (parsed.excludeBpmRanges.length > 0 && idx.detectedBpm !== null) {
    const inExcluded = parsed.excludeBpmRanges.some(
      (r) => idx.detectedBpm! >= r.min && idx.detectedBpm! <= r.max
    );
    if (inExcluded) return null;
  }

  if (parsed.keyAllowedGroups.length > 0) {
    if (!idx.effectiveCamelotKey) return null;
    const matchesAllKeySpecs = parsed.keyAllowedGroups.every((allowed) =>
      allowed.includes(idx.effectiveCamelotKey)
    );
    if (!matchesAllKeySpecs) return null;
  }
  if (
    parsed.excludeCamelotKeys.length > 0 &&
    idx.effectiveCamelotKey &&
    parsed.excludeCamelotKeys.includes(idx.effectiveCamelotKey)
  ) {
    return null;
  }

  if (parsed.extTerms.length > 0) {
    if (!parsed.extTerms.some((e) => idx.foldedExt === e)) return null;
  }
  if (parsed.excludeExtTerms.length > 0) {
    if (parsed.excludeExtTerms.some((e) => idx.foldedExt === e)) return null;
  }

  if (parsed.tagTerms.length > 0) {
    if (!parsed.tagTerms.every((tt) => matchesTagOperatorTerm(idx, tt))) {
      return null;
    }
  }
  if (parsed.excludeTagTerms.length > 0) {
    if (parsed.excludeTagTerms.some((tt) => matchesTagOperatorTerm(idx, tt))) {
      return null;
    }
  }

  if (parsed.genreTerms.length > 0) {
    if (!parsed.genreTerms.every((gt) => matchesGenreOperatorTerm(idx, gt))) {
      return null;
    }
  }
  if (parsed.excludeGenreTerms.length > 0) {
    if (
      parsed.excludeGenreTerms.some((gt) => matchesGenreOperatorTerm(idx, gt))
    ) {
      return null;
    }
  }

  if (parsed.moodTerms.length > 0) {
    if (!parsed.moodTerms.every((mt) => matchesMoodOperatorTerm(idx, mt))) {
      return null;
    }
  }
  if (parsed.excludeMoodTerms.length > 0) {
    if (parsed.excludeMoodTerms.some((mt) => matchesMoodOperatorTerm(idx, mt))) {
      return null;
    }
  }

  if (parsed.sourceTerms.length > 0) {
    if (!parsed.sourceTerms.every((st) => matchesSourceOperatorTerm(idx, st))) {
      return null;
    }
  }
  if (parsed.excludeSourceTerms.length > 0) {
    if (
      parsed.excludeSourceTerms.some((st) => matchesSourceOperatorTerm(idx, st))
    ) {
      return null;
    }
  }

  for (const slug of Object.keys(parsed.customFacetTerms)) {
    const terms = parsed.customFacetTerms[slug];
    if (
      terms &&
      terms.length > 0 &&
      !terms.every((ct) => matchesCustomFacetOperatorTerm(idx, slug, ct))
    ) {
      return null;
    }
  }
  for (const slug of Object.keys(parsed.excludeCustomFacetTerms)) {
    const terms = parsed.excludeCustomFacetTerms[slug];
    if (
      terms &&
      terms.length > 0 &&
      terms.some((ct) => matchesCustomFacetOperatorTerm(idx, slug, ct))
    ) {
      return null;
    }
  }

  if (parsed.folderTerms.length > 0) {
    const allFoldersMatch = parsed.folderTerms.every(
      (ft) => idx.foldedParent.includes(ft) || idx.foldedFolder.includes(ft)
    );
    if (!allFoldersMatch) return null;
  }
  if (parsed.excludeFolderTerms.length > 0) {
    const anyExcludedFolder = parsed.excludeFolderTerms.some(
      (ft) => idx.foldedParent.includes(ft) || idx.foldedFolder.includes(ft)
    );
    if (anyExcludedFolder) return null;
  }

  if (parsed.artistTerms.length > 0) {
    const allArtistsMatch = parsed.artistTerms.every(
      (at) => idx.foldedArtist && idx.foldedArtist.includes(at)
    );
    if (!allArtistsMatch) return null;
  }
  if (parsed.excludeArtistTerms.length > 0) {
    const anyExcludedArtist = parsed.excludeArtistTerms.some(
      (at) => idx.foldedArtist && idx.foldedArtist.includes(at)
    );
    if (anyExcludedArtist) return null;
  }

  if (parsed.albumTerms.length > 0) {
    const allAlbumsMatch = parsed.albumTerms.every(
      (al) => idx.foldedAlbum && idx.foldedAlbum.includes(al)
    );
    if (!allAlbumsMatch) return null;
  }
  if (parsed.excludeAlbumTerms.length > 0) {
    const anyExcludedAlbum = parsed.excludeAlbumTerms.some(
      (al) => idx.foldedAlbum && idx.foldedAlbum.includes(al)
    );
    if (anyExcludedAlbum) return null;
  }

  if (parsed.yearTerms.length > 0) {
    const allYearsMatch = parsed.yearTerms.every(
      (yr) => idx.foldedYear && idx.foldedYear.includes(yr)
    );
    if (!allYearsMatch) return null;
  }
  if (parsed.excludeYearTerms.length > 0) {
    const anyExcludedYear = parsed.excludeYearTerms.some(
      (yr) => idx.foldedYear && idx.foldedYear.includes(yr)
    );
    if (anyExcludedYear) return null;
  }

  if (parsed.negativeTerms.length > 0) {
    for (const neg of parsed.negativeTerms) {
      if (neg === "loop" && sample.is_loop) return null;
      if (matchesTermInSample(idx, neg)) return null;
    }
  }
  if (parsed.negativePhrases.length > 0) {
    if (parsed.negativePhrases.some((np) => matchesPhraseInSample(idx, np))) {
      return null;
    }
  }

  return idx;
}
