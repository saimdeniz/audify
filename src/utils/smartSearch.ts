import { SampleItem } from "../types";
import { foldSearchText } from "./format";
import { getBilingualSynonyms } from "./sfxThesaurus";
import {
  type ParsedSearchQuery,
  type SearchCandidateTerm,
  parseSmartSearchQuery,
} from "./search/queryParser";
import {
  clearSmartSearchCache,
  getIndexedSample,
  type IndexedSampleEntry,
  tokenizeSearchWords,
} from "./search/sampleIndex";
import {
  getHarmonicCamelotNeighbors,
  normalizeMusicalOrCamelotKey,
} from "./search/musicalKey";
import { matchesTechnicalCriteria } from "./search/technicalOperators";

export {
  clearSmartSearchCache,
  foldSearchText,
  getHarmonicCamelotNeighbors,
  normalizeMusicalOrCamelotKey,
  type ParsedSearchQuery,
  parseSmartSearchQuery,
  type SearchCandidateTerm,
  tokenizeSearchWords,
};

const FILE_NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function matchesPhraseInSample(
  idx: IndexedSampleEntry,
  phrase: string
): boolean {
  if (idx.normalizedPhraseStem.includes(phrase)) return true;
  if (idx.foldedArtist && idx.foldedArtist.includes(phrase)) return true;
  if (idx.foldedAlbum && idx.foldedAlbum.includes(phrase)) return true;
  if (idx.foldedGenre && idx.foldedGenre.includes(phrase)) return true;
  if (idx.tagNamesFolded.some((t) => t.includes(phrase))) return true;
  const normFolderWords = idx.foldedFolder.replace(/[^a-z0-9]+/g, " ");
  if (normFolderWords.includes(phrase)) return true;
  return false;
}

function matchesTermInSample(idx: IndexedSampleEntry, term: string): boolean {
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

function scorePhraseCandidate(
  idx: IndexedSampleEntry,
  phrase: string
): number {
  if (idx.normalizedPhraseStem === phrase) return 340;
  if (idx.normalizedPhraseStem.startsWith(phrase + " ")) return 220;
  if (
    idx.normalizedPhraseStem.includes(" " + phrase + " ") ||
    idx.normalizedPhraseStem.endsWith(" " + phrase)
  ) {
    return 185;
  }
  if (idx.normalizedPhraseStem.includes(phrase)) return 140;
  if (idx.tagNamesFolded.some((t) => t === phrase || t.includes(phrase))) {
    return 95;
  }
  if (idx.foldedGenre && idx.foldedGenre.includes(phrase)) return 90;
  if (idx.foldedArtist && idx.foldedArtist.includes(phrase)) return 80;
  if (idx.foldedAlbum && idx.foldedAlbum.includes(phrase)) return 70;
  const normFolderWords = idx.foldedFolder.replace(/[^a-z0-9]+/g, " ");
  if (normFolderWords.includes(phrase)) return 45;
  return 0;
}

function scoreSingleTerm(
  idx: IndexedSampleEntry,
  term: string,
  enableSynonyms: boolean
): number {
  let score = 0;

  // 1. Direct filename stem & word matches (highest priority)
  if (idx.foldedStem === term) {
    score = 320;
  } else if (idx.nameWords.includes(term)) {
    score = idx.foldedStem.startsWith(term) ? 185 : 135;
  } else if (idx.foldedStem.startsWith(term)) {
    score = 150;
  } else if (idx.nameWords.some((w) => w.startsWith(term))) {
    score = 105;
  } else if (idx.foldedStem.includes(term)) {
    score = 55;
  }

  // 2. Tag, Genre & Metadata match
  let metaBonus = 0;
  for (const tName of idx.tagNamesFolded) {
    if (tName === term) {
      metaBonus = 85;
      break;
    } else if (tName.startsWith(term) || tName.includes(term)) {
      metaBonus = Math.max(metaBonus, 60);
    }
  }
  if (idx.foldedGenre) {
    if (idx.foldedGenre === term) {
      metaBonus = Math.max(metaBonus, 90);
    } else if (idx.foldedGenre.includes(term)) {
      metaBonus = Math.max(metaBonus, 65);
    }
  }
  if (idx.foldedArtist) {
    if (idx.foldedArtist === term) {
      metaBonus = Math.max(metaBonus, 80);
    } else if (idx.foldedArtist.includes(term)) {
      metaBonus = Math.max(metaBonus, 55);
    }
  }
  if (idx.foldedAlbum && idx.foldedAlbum.includes(term)) {
    metaBonus = Math.max(metaBonus, 48);
  }
  if (idx.foldedYear && idx.foldedYear === term) {
    metaBonus = Math.max(metaBonus, 45);
  }

  // 3. Immediate parent folder / folder path match
  let folderScore = 0;
  if (idx.parentWords.includes(term) || idx.foldedParent === term) {
    folderScore = 50;
  } else if (idx.foldedParent.includes(term)) {
    folderScore = 36;
  } else if (term.length >= 3 && idx.foldedFolder.includes(term)) {
    folderScore = 18;
  }

  const directTotal =
    score + metaBonus + (score > 0 ? Math.min(20, folderScore) : folderScore);
  if (directTotal > 0) {
    return directTotal;
  }

  // 4. Smart Pro-Audio Bilingual (TR <-> EN) Synonym Fallback
  if (enableSynonyms) {
    const synonyms = getBilingualSynonyms(term);
    if (synonyms) {
      for (const syn of synonyms) {
        if (syn.includes(" ")) {
          if (matchesPhraseInSample(idx, syn)) {
            return 40;
          }
          continue;
        }
        if (idx.nameWords.includes(syn)) {
          return 42;
        }
        if (idx.nameWords.some((w) => w.startsWith(syn))) {
          return 34;
        }
        if (
          idx.foldedGenre &&
          (idx.foldedGenre === syn || idx.foldedGenre.includes(syn))
        ) {
          return 40;
        }
        if (idx.tagNamesFolded.some((t) => t === syn || t.includes(syn))) {
          return 38;
        }
        if (idx.parentWords.includes(syn)) {
          return 26;
        }
      }
    }
  }

  return 0;
}

/**
 * Executes Smart Search v2 across a sample array with weighted relevance ranking,
 * camelCase & Turkish folding, quoted phrases, boolean OR, power operators
 * (`-neg`, `-tag:`, `<3s`, `1-5s`, `tag:`, `ext:`, `artist:`, `bpm:`, `is:loop`),
 * and optional studio synonym expansion.
 */
export function executeSmartSearch(
  samples: SampleItem[],
  rawQuery: string,
  enableSynonyms = true
): SampleItem[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return samples;

  const parsed = parseSmartSearchQuery(trimmed);
  const orGroups = parsed.positiveOrGroups;
  const hasPositiveGroups = orGroups.length > 0;

  const scored: Array<{ sample: SampleItem; score: number }> = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // Fast structural operator checks first
    if (parsed.requireLoop !== null && sample.is_loop !== parsed.requireLoop) {
      continue;
    }
    if (
      parsed.requireFav !== null &&
      sample.is_favorite !== parsed.requireFav
    ) {
      continue;
    }
    if (
      parsed.minDurationMs !== null &&
      sample.duration_ms < parsed.minDurationMs
    ) {
      continue;
    }
    if (
      parsed.maxDurationMs !== null &&
      sample.duration_ms > parsed.maxDurationMs
    ) {
      continue;
    }
    if (!matchesTechnicalCriteria(sample, parsed)) {
      continue;
    }

    const idx = getIndexedSample(sample);

    if (parsed.minBpm !== null || parsed.maxBpm !== null) {
      if (idx.detectedBpm === null) continue;
      if (parsed.minBpm !== null && idx.detectedBpm < parsed.minBpm) continue;
      if (parsed.maxBpm !== null && idx.detectedBpm > parsed.maxBpm) continue;
    }
    if (parsed.excludeBpmRanges.length > 0 && idx.detectedBpm !== null) {
      const inExcluded = parsed.excludeBpmRanges.some(
        (r) => idx.detectedBpm! >= r.min && idx.detectedBpm! <= r.max
      );
      if (inExcluded) continue;
    }

    if (parsed.keyAllowedGroups.length > 0) {
      if (!idx.effectiveCamelotKey) continue;
      const matchesAllKeySpecs = parsed.keyAllowedGroups.every((allowed) =>
        allowed.includes(idx.effectiveCamelotKey)
      );
      if (!matchesAllKeySpecs) continue;
    }
    if (
      parsed.excludeCamelotKeys.length > 0 &&
      idx.effectiveCamelotKey &&
      parsed.excludeCamelotKeys.includes(idx.effectiveCamelotKey)
    ) {
      continue;
    }

    if (parsed.extTerms.length > 0) {
      if (!parsed.extTerms.some((e) => idx.foldedExt === e)) {
        continue;
      }
    }
    if (parsed.excludeExtTerms.length > 0) {
      if (parsed.excludeExtTerms.some((e) => idx.foldedExt === e)) {
        continue;
      }
    }

    if (parsed.tagTerms.length > 0) {
      const allTagsMatch = parsed.tagTerms.every((tt) =>
        idx.tagNamesFolded.some((tn) => tn.includes(tt))
      );
      if (!allTagsMatch) continue;
    }
    if (parsed.excludeTagTerms.length > 0) {
      const anyExcludedTag = parsed.excludeTagTerms.some((tt) =>
        idx.tagNamesFolded.some((tn) => tn.includes(tt))
      );
      if (anyExcludedTag) continue;
    }

    if (parsed.genreTerms.length > 0) {
      const allGenresMatch = parsed.genreTerms.every(
        (gt) => idx.foldedGenre && idx.foldedGenre.includes(gt)
      );
      if (!allGenresMatch) continue;
    }
    if (parsed.excludeGenreTerms.length > 0) {
      const anyExcludedGenre = parsed.excludeGenreTerms.some(
        (gt) => idx.foldedGenre && idx.foldedGenre.includes(gt)
      );
      if (anyExcludedGenre) continue;
    }

    if (parsed.folderTerms.length > 0) {
      const allFoldersMatch = parsed.folderTerms.every(
        (ft) => idx.foldedParent.includes(ft) || idx.foldedFolder.includes(ft)
      );
      if (!allFoldersMatch) continue;
    }
    if (parsed.excludeFolderTerms.length > 0) {
      const anyExcludedFolder = parsed.excludeFolderTerms.some(
        (ft) => idx.foldedParent.includes(ft) || idx.foldedFolder.includes(ft)
      );
      if (anyExcludedFolder) continue;
    }

    if (parsed.artistTerms.length > 0) {
      const allArtistsMatch = parsed.artistTerms.every(
        (at) => idx.foldedArtist && idx.foldedArtist.includes(at)
      );
      if (!allArtistsMatch) continue;
    }
    if (parsed.excludeArtistTerms.length > 0) {
      const anyExcludedArtist = parsed.excludeArtistTerms.some(
        (at) => idx.foldedArtist && idx.foldedArtist.includes(at)
      );
      if (anyExcludedArtist) continue;
    }

    if (parsed.albumTerms.length > 0) {
      const allAlbumsMatch = parsed.albumTerms.every(
        (al) => idx.foldedAlbum && idx.foldedAlbum.includes(al)
      );
      if (!allAlbumsMatch) continue;
    }

    if (parsed.yearTerms.length > 0) {
      const allYearsMatch = parsed.yearTerms.every(
        (yr) => idx.foldedYear && idx.foldedYear.includes(yr)
      );
      if (!allYearsMatch) continue;
    }

    // Negative plain terms (`-loop`, `!vocal`) & negative phrases
    if (parsed.negativeTerms.length > 0) {
      let excluded = false;
      for (const neg of parsed.negativeTerms) {
        if (neg === "loop" && sample.is_loop) {
          excluded = true;
          break;
        }
        if (matchesTermInSample(idx, neg)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
    }
    if (parsed.negativePhrases.length > 0) {
      if (parsed.negativePhrases.some((np) => matchesPhraseInSample(idx, np))) {
        continue;
      }
    }

    if (!hasPositiveGroups) {
      scored.push({ sample, score: 1 });
      continue;
    }

    // Evaluate CNF groups: EVERY group must have at least one option score > 0
    let totalScore = 0;
    let matchedAllGroups = true;
    let allMatchedInFilename = true;
    const matchedSingleTokens: string[] = [];

    for (let g = 0; g < orGroups.length; g++) {
      const group = orGroups[g];
      let bestGroupScore = 0;
      let bestOptionValue = "";

      for (let o = 0; o < group.length; o++) {
        const opt = group[o];
        const s = opt.isPhrase
          ? scorePhraseCandidate(idx, opt.value)
          : scoreSingleTerm(
              idx,
              opt.value,
              enableSynonyms && !opt.exactQuoted
            );
        if (s > bestGroupScore) {
          bestGroupScore = s;
          bestOptionValue = opt.value;
        }
      }

      if (bestGroupScore <= 0) {
        matchedAllGroups = false;
        break;
      }

      totalScore += bestGroupScore;
      const checkStr = bestOptionValue.replace(/\s+/g, "");
      if (
        !idx.foldedStem.includes(bestOptionValue) &&
        !idx.foldedStem.includes(checkStr)
      ) {
        allMatchedInFilename = false;
      } else {
        matchedSingleTokens.push(checkStr);
      }
    }

    if (!matchedAllGroups) continue;

    // Multi-token filename cohesion bonus
    if (orGroups.length > 1 && allMatchedInFilename) {
      totalScore += 55;
      const joinedPhrase = matchedSingleTokens.join("");
      const compactStem = idx.foldedStem.replace(/[^a-z0-9]+/g, "");
      if (joinedPhrase && compactStem.includes(joinedPhrase)) {
        totalScore += 45;
      }
    }

    if (sample.is_favorite) {
      totalScore += 6;
    }
    totalScore -= Math.min(18, idx.foldedStem.length * 0.2);

    scored.push({ sample, score: totalScore });
  }

  if (hasPositiveGroups) {
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return FILE_NAME_COLLATOR.compare(a.sample.file_name, b.sample.file_name);
    });
  }

  return scored.map((entry) => entry.sample);
}
