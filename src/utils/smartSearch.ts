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
  getNormalizedPhraseStem,
  type IndexedSampleEntry,
  setSmartSearchTaxonomy,
  tokenizeSearchWords,
} from "./search/sampleIndex";
import {
  getHarmonicCamelotNeighbors,
  normalizeMusicalOrCamelotKey,
} from "./search/musicalKey";
import {
  evaluateSmartSearchStructural,
  matchesPhraseInSample,
  queryRequiresTextIndex,
} from "./search/smartSearchMatcher";

export {
  clearSmartSearchCache,
  foldSearchText,
  getHarmonicCamelotNeighbors,
  normalizeMusicalOrCamelotKey,
  type ParsedSearchQuery,
  parseSmartSearchQuery,
  type SearchCandidateTerm,
  setSmartSearchTaxonomy,
  tokenizeSearchWords,
};

const FILE_NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function scorePhraseCandidate(
  idx: IndexedSampleEntry,
  phrase: string
): number {
  const phraseStem = getNormalizedPhraseStem(idx);
  if (phraseStem === phrase) return 340;
  if (phraseStem.startsWith(phrase + " ")) return 220;
  if (
    phraseStem.includes(" " + phrase + " ") ||
    phraseStem.endsWith(" " + phrase)
  ) {
    return 185;
  }
  if (phraseStem.includes(phrase)) return 140;
  if (idx.tagNamesFolded.some((t) => t === phrase || t.includes(phrase))) {
    return 95;
  }
  if (idx.foldedGenre && idx.foldedGenre.includes(phrase)) return 90;
  if (idx.foldedArtist && idx.foldedArtist.includes(phrase)) return 80;
  if (idx.foldedAlbum && idx.foldedAlbum.includes(phrase)) return 70;
  const normFolderWords = idx.foldedFolder.replace(/[^\p{L}\p{N}]+/gu, " ");
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
 * Counts how many samples satisfy a Smart Search query without allocating a result
 * array or sorting matches — used for Smart Collection live badge counts.
 */
export function countSmartSearchMatches(
  samples: SampleItem[],
  rawQuery: string,
  enableSynonyms = true
): number {
  const trimmed = rawQuery.trim();
  if (!trimmed) return samples.length;

  const parsed = parseSmartSearchQuery(trimmed);
  const orGroups = parsed.positiveOrGroups;
  const hasPositiveGroups = orGroups.length > 0;
  const needsTextIndex = queryRequiresTextIndex(parsed);

  let count = 0;
  for (let i = 0; i < samples.length; i++) {
    const idx = evaluateSmartSearchStructural(samples[i], parsed, needsTextIndex);
    if (!idx) continue;

    if (!hasPositiveGroups) {
      count += 1;
      continue;
    }

    let matchedAllGroups = true;
    for (let g = 0; g < orGroups.length; g++) {
      const group = orGroups[g];
      let matchedGroup = false;
      for (let o = 0; o < group.length; o++) {
        const opt = group[o];
        const s = opt.isPhrase
          ? scorePhraseCandidate(idx, opt.value)
          : scoreSingleTerm(
              idx,
              opt.value,
              enableSynonyms && !opt.exactQuoted
            );
        if (s > 0) {
          matchedGroup = true;
          break;
        }
      }
      if (!matchedGroup) {
        matchedAllGroups = false;
        break;
      }
    }
    if (matchedAllGroups) {
      count += 1;
    }
  }
  return count;
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
  const needsTextIndex = queryRequiresTextIndex(parsed);

  const scored: Array<{ sample: SampleItem; score: number }> = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const idx = evaluateSmartSearchStructural(sample, parsed, needsTextIndex);
    if (!idx) continue;

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
