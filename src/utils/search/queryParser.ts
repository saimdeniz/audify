import { foldSearchText } from "../format";
import { getHarmonicCamelotNeighbors, normalizeMusicalOrCamelotKey } from "./musicalKey";
import { getKnownCustomFacetSlugs } from "./sampleIndex";
import {
  applyTechnicalOperatorToken,
  type TechnicalFilterCriteria,
} from "./technicalOperators";

const MAX_QUERY_LEN = 512;

export interface SearchCandidateTerm {
  value: string;
  isPhrase: boolean;
  exactQuoted?: boolean;
}

export interface ParsedSearchQuery extends TechnicalFilterCriteria {
  positiveTerms: string[];
  positiveOrGroups: SearchCandidateTerm[][];
  negativeTerms: string[];
  negativePhrases: string[];
  tagTerms: string[];
  excludeTagTerms: string[];
  genreTerms: string[];
  excludeGenreTerms: string[];
  moodTerms: string[];
  excludeMoodTerms: string[];
  sourceTerms: string[];
  excludeSourceTerms: string[];
  customFacetTerms: Record<string, string[]>;
  excludeCustomFacetTerms: Record<string, string[]>;
  folderTerms: string[];
  excludeFolderTerms: string[];
  extTerms: string[];
  excludeExtTerms: string[];
  artistTerms: string[];
  excludeArtistTerms: string[];
  albumTerms: string[];
  excludeAlbumTerms: string[];
  yearTerms: string[];
  excludeYearTerms: string[];
  keyAllowedGroups: string[][];
  excludeCamelotKeys: string[];
  minDurationMs: number | null;
  maxDurationMs: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  excludeBpmRanges: Array<{ min: number; max: number }>;
  requireLoop: boolean | null;
  requireFav: boolean | null;
}

interface RawLexToken {
  text: string;
  quoted: boolean;
  wholeQuoted: boolean;
}

/**
 * Splits query string respecting double/single quotes, both standalone (`"heavy kick"`)
 * and attached to field operators (`tag:"sci fi"`, `-folder:"raw takes"`).
 */
function lexQueryTokens(raw: string): RawLexToken[] {
  const out: RawLexToken[] = [];
  const n = raw.length;
  let i = 0;

  while (i < n) {
    while (i < n && /\s/.test(raw[i])) i++;
    if (i >= n) break;

    if (raw[i] === '"' || raw[i] === "'") {
      const quoteChar = raw[i++];
      let buf = "";
      while (i < n && raw[i] !== quoteChar) {
        buf += raw[i++];
      }
      if (i < n && raw[i] === quoteChar) i++;
      if (buf.trim()) {
        out.push({ text: buf.trim(), quoted: true, wholeQuoted: true });
      }
      continue;
    }

    let buf = "";
    let hadQuotedSegment = false;
    while (i < n && !/\s/.test(raw[i])) {
      if (raw[i] === '"' || raw[i] === "'") {
        const quoteChar = raw[i++];
        hadQuotedSegment = true;
        while (i < n && raw[i] !== quoteChar) {
          buf += raw[i++];
        }
        if (i < n && raw[i] === quoteChar) i++;
      } else {
        buf += raw[i++];
      }
    }
    if (buf) {
      out.push({ text: buf, quoted: hadQuotedSegment, wholeQuoted: false });
    }
  }

  return out;
}

function trimNonAlphaNumUnicode(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function parseDurationSpecMs(
  spec: string,
  requireUnitForRange = false
): { min?: number; max?: number } | null {
  const s = spec.trim().toLowerCase();
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(ms|s)?$/);
  if (rangeMatch) {
    if (requireUnitForRange && !rangeMatch[3]) return null;
    const mul = rangeMatch[3] === "ms" ? 1 : 1000;
    const a = parseFloat(rangeMatch[1]) * mul;
    const b = parseFloat(rangeMatch[2]) * mul;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const cmpMatch = s.match(/^(<=|>=|<|>)(\d+(?:\.\d+)?)(ms|s)?$/);
  if (cmpMatch) {
    const op = cmpMatch[1];
    const mul = cmpMatch[3] === "ms" ? 1 : 1000;
    const val = parseFloat(cmpMatch[2]) * mul;
    if (op === "<" || op === "<=") return { max: val };
    if (op === ">" || op === ">=") return { min: val };
  }
  return null;
}

function applyDurationBound(
  result: ParsedSearchQuery,
  dur: { min?: number; max?: number }
) {
  if (dur.min !== undefined) {
    result.minDurationMs =
      result.minDurationMs !== null
        ? Math.max(result.minDurationMs, dur.min)
        : dur.min;
  }
  if (dur.max !== undefined) {
    result.maxDurationMs =
      result.maxDurationMs !== null
        ? Math.min(result.maxDurationMs, dur.max)
        : dur.max;
  }
}

function parseBpmRange(val: string): { min: number; max: number } | null {
  const range = val.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
  }
  const minOnly = val.match(/^(?:>=?|(\d+(?:\.\d+)?)\+$)(\d+(?:\.\d+)?)?$/);
  if (minOnly) {
    const numStr = minOnly[1] || minOnly[2];
    const a = Number(numStr);
    if (Number.isFinite(a) && a > 0) {
      return { min: a, max: 999 };
    }
  }
  const maxOnly = val.match(/^<=?(\d+(?:\.\d+)?)$/);
  if (maxOnly) {
    const b = Number(maxOnly[1]);
    if (Number.isFinite(b) && b > 0) {
      return { min: 0, max: b };
    }
  }
  const single = Number(val);
  if (Number.isFinite(single) && single > 0) {
    return { min: single - 2, max: single + 2 };
  }
  return null;
}

export function parseSmartSearchQuery(rawQuery: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    positiveTerms: [],
    positiveOrGroups: [],
    negativeTerms: [],
    negativePhrases: [],
    tagTerms: [],
    excludeTagTerms: [],
    genreTerms: [],
    excludeGenreTerms: [],
    moodTerms: [],
    excludeMoodTerms: [],
    sourceTerms: [],
    excludeSourceTerms: [],
    customFacetTerms: {},
    excludeCustomFacetTerms: {},
    folderTerms: [],
    excludeFolderTerms: [],
    extTerms: [],
    excludeExtTerms: [],
    artistTerms: [],
    excludeArtistTerms: [],
    albumTerms: [],
    excludeAlbumTerms: [],
    yearTerms: [],
    excludeYearTerms: [],
    keyAllowedGroups: [],
    excludeCamelotKeys: [],
    minDurationMs: null,
    maxDurationMs: null,
    minBpm: null,
    maxBpm: null,
    excludeBpmRanges: [],
    requireLoop: null,
    requireFav: null,
    channelRanges: [],
    excludeChannelRanges: [],
    sampleRateRanges: [],
    excludeSampleRateRanges: [],
    bitDepthRanges: [],
    excludeBitDepthRanges: [],
    fileSizeRanges: [],
    excludeFileSizeRanges: [],
  };

  const bounded = rawQuery.slice(0, MAX_QUERY_LEN).trim();
  if (!bounded) return result;

  const lexed = lexQueryTokens(bounded);
  let mergeNextWithOr = false;

  const pushPositiveCandidate = (cand: SearchCandidateTerm) => {
    if (!cand.value) return;
    result.positiveTerms.push(cand.value);
    if (mergeNextWithOr && result.positiveOrGroups.length > 0) {
      result.positiveOrGroups[result.positiveOrGroups.length - 1].push(cand);
      mergeNextWithOr = false;
    } else {
      result.positiveOrGroups.push([cand]);
      mergeNextWithOr = false;
    }
  };

  for (let idx = 0; idx < lexed.length; idx++) {
    const tok = lexed[idx];

    // Top-level standalone quoted phrase/word: `"heavy impact"`, `"whoosh"`, `"-3db"` (disables synonyms)
    if (tok.wholeQuoted) {
      const normPhrase = foldSearchText(tok.text)
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (normPhrase) {
        const isMultiWord = normPhrase.includes(" ");
        pushPositiveCandidate({
          value: normPhrase,
          isPhrase: isMultiWord,
          exactQuoted: true,
        });
      } else {
        mergeNextWithOr = false;
      }
      continue;
    }

    // Boolean OR operator (`kick OR snare` or `kick | snare`)
    if (
      !tok.quoted &&
      (tok.text === "|" ||
        tok.text === "||" ||
        tok.text.toUpperCase() === "OR")
    ) {
      if (result.positiveOrGroups.length > 0 && idx < lexed.length - 1) {
        mergeNextWithOr = true;
      }
      continue;
    }

    const lower = foldSearchText(tok.text);

    // 1. Duration shorthand: <3, <3s, <=500ms, >10s, or bare unit range `1-5s` / `200-800ms`
    if (!tok.quoted) {
      if (lower.startsWith("<") || lower.startsWith(">")) {
        const dur = parseDurationSpecMs(lower, false);
        if (dur) {
          applyDurationBound(result, dur);
          mergeNextWithOr = false;
          continue;
        }
      } else if (/^\d/.test(lower)) {
        const bareRange = parseDurationSpecMs(lower, true);
        if (bareRange) {
          applyDurationBound(result, bareRange);
          mergeNextWithOr = false;
          continue;
        }
      }
    }

    // Check leading negation (`-` or `!`) BEFORE `#tag` and `key:val`
    const isNegated =
      (lower.startsWith("-") || lower.startsWith("!")) && lower.length > 1;
    const body = isNegated ? lower.slice(1) : lower;

    // 2. #tag / -#tag shorthand
    if (body.startsWith("#") && body.length > 1) {
      const tagVal = body.slice(1).trim();
      if (tagVal) {
        if (isNegated) result.excludeTagTerms.push(tagVal);
        else result.tagTerms.push(tagVal);
      }
      mergeNextWithOr = false;
      continue;
    }

    // 3. Key:Value (and -Key:Value) operators
    const colonIdx = body.indexOf(":");
    if (colonIdx > 0 && colonIdx < body.length - 1) {
      const key = body.slice(0, colonIdx);
      const val = body.slice(colonIdx + 1).trim();

      if (val) {
        let handledOperator = true;
        if (key === "tag" || key === "t") {
          if (isNegated) result.excludeTagTerms.push(val);
          else result.tagTerms.push(val);
        } else if (key === "genre" || key === "g" || key === "style") {
          if (isNegated) result.excludeGenreTerms.push(val);
          else result.genreTerms.push(val);
        } else if (key === "mood" || key === "m") {
          if (isNegated) result.excludeMoodTerms.push(val);
          else result.moodTerms.push(val);
        } else if (key === "source" || key === "src") {
          if (isNegated) result.excludeSourceTerms.push(val);
          else result.sourceTerms.push(val);
        } else if (
          key === "folder" ||
          key === "in" ||
          key === "dir" ||
          key === "path"
        ) {
          if (isNegated) result.excludeFolderTerms.push(val);
          else result.folderTerms.push(val);
        } else if (key === "ext" || key === "format" || key === "fmt") {
          const cleanExt = val.replace(/^\./, "");
          if (cleanExt) {
            if (isNegated) result.excludeExtTerms.push(cleanExt);
            else result.extTerms.push(cleanExt);
          }
        } else if (key === "artist" || key === "author" || key === "by") {
          if (isNegated) result.excludeArtistTerms.push(val);
          else result.artistTerms.push(val);
        } else if (key === "album" || key === "pack") {
          if (isNegated) result.excludeAlbumTerms.push(val);
          else result.albumTerms.push(val);
        } else if (key === "year") {
          if (isNegated) result.excludeYearTerms.push(val);
          else result.yearTerms.push(val);
        } else if (key === "key" || key === "camelot") {
          // Use raw token text after `:` so `#` / `b` accidentals (e.g. `key:F#m`, `key:Bb`, `key:~8a`) remain intact!
          const rawBody =
            tok.text.startsWith("-") || tok.text.startsWith("!")
              ? tok.text.slice(1)
              : tok.text;
          const rawColon = rawBody.indexOf(":");
          const rawKeySpec =
            rawColon >= 0 ? rawBody.slice(rawColon + 1).trim() : val;
          const isHarmonic =
            rawKeySpec.startsWith("~") || rawKeySpec.startsWith("≈");
          const cleanKeySpec = isHarmonic
            ? rawKeySpec.slice(1).trim()
            : rawKeySpec;
          const parsedKey = normalizeMusicalOrCamelotKey(cleanKeySpec);
          if (parsedKey) {
            if (isNegated) {
              result.excludeCamelotKeys.push(parsedKey.camelotKey);
            } else if (isHarmonic) {
              result.keyAllowedGroups.push(
                getHarmonicCamelotNeighbors(parsedKey.camelotKey)
              );
            } else {
              result.keyAllowedGroups.push([parsedKey.camelotKey]);
            }
          } else {
            handledOperator = false;
          }
        } else if (!isNegated && (key === "dur" || key === "time" || key === "len")) {
          const dur = parseDurationSpecMs(val, false);
          if (dur) {
            applyDurationBound(result, dur);
          } else {
            handledOperator = false;
          }
        } else if (key === "bpm") {
          const bpm = parseBpmRange(val);
          if (bpm) {
            if (isNegated) {
              result.excludeBpmRanges.push(bpm);
            } else {
              result.minBpm =
                result.minBpm !== null
                  ? Math.max(result.minBpm, bpm.min)
                  : bpm.min;
              result.maxBpm =
                result.maxBpm !== null
                  ? Math.min(result.maxBpm, bpm.max)
                  : bpm.max;
            }
          } else {
            handledOperator = false;
          }
        } else if (key === "is" || key === "type") {
          if (val === "loop" || val === "loops") {
            result.requireLoop = isNegated ? false : true;
          } else if (val === "oneshot" || val === "one-shot" || val === "shot") {
            result.requireLoop = isNegated ? true : false;
          } else if (val === "fav" || val === "favorite" || val === "starred") {
            result.requireFav = isNegated ? false : true;
          } else {
            handledOperator = false;
          }
        } else if (!applyTechnicalOperatorToken(key, val, isNegated, result)) {
          if (getKnownCustomFacetSlugs().has(key)) {
            const targetMap = isNegated
              ? result.excludeCustomFacetTerms
              : result.customFacetTerms;
            const list = targetMap[key] ?? [];
            list.push(val);
            targetMap[key] = list;
          } else {
            handledOperator = false;
          }
        }
        if (handledOperator) {
          mergeNextWithOr = false;
          continue;
        }
      }
    }

    // 4. Negative plain terms / quoted negative phrases (`-word`, `-"bad take"`)
    if (isNegated) {
      if (tok.quoted && body.includes(" ")) {
        const negPhrase = body.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        if (negPhrase) result.negativePhrases.push(negPhrase);
      } else {
        const negClean = trimNonAlphaNumUnicode(body);
        if (negClean) {
          result.negativeTerms.push(negClean);
        }
      }
      mergeNextWithOr = false;
      continue;
    }

    // 5. Standard positive term (may be hyphenated like "sci-fi" or pipe-joined `kick|snare`)
    if (!tok.quoted && lower.includes("|")) {
      const pipeAlts = lower
        .split("|")
        .map((p) => trimNonAlphaNumUnicode(p))
        .filter(Boolean);
      if (pipeAlts.length > 0) {
        for (let pIdx = 0; pIdx < pipeAlts.length; pIdx++) {
          if (pIdx > 0) mergeNextWithOr = true;
          pushPositiveCandidate({ value: pipeAlts[pIdx], isPhrase: false });
        }
        continue;
      }
    }

    const subTokens = lower.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
    if (subTokens.length === 1) {
      pushPositiveCandidate({ value: subTokens[0], isPhrase: false });
    } else if (subTokens.length > 1) {
      // If preceded by OR (`riser OR sci-fi`), treat hyphenated compound as a phrase candidate inside the OR group
      if (mergeNextWithOr) {
        pushPositiveCandidate({
          value: subTokens.join(" "),
          isPhrase: true,
        });
      } else {
        for (const st of subTokens) {
          pushPositiveCandidate({ value: st, isPhrase: false });
        }
      }
    } else {
      mergeNextWithOr = false;
    }
  }

  return result;
}
