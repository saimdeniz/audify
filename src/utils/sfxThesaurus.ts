import rawThesaurus from "../data/sfxThesaurus.json";
import { foldSearchText } from "./format";

export interface SfxThesaurusCluster {
  id: string;
  label: string;
  terms: string[];
}

export interface ActiveSynonymHint {
  clusterId: string;
  label: string;
  matchedTerm: string;
  suggestions: string[];
}

const foldAscii = (input: string): string => foldSearchText(input).trim();

export const SFX_THESAURUS_CLUSTERS: SfxThesaurusCluster[] =
  rawThesaurus as SfxThesaurusCluster[];

const FOLDED_SYNONYM_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, Set<string>>();

  for (const cluster of SFX_THESAURUS_CLUSTERS) {
    const foldedTerms = Array.from(
      new Set(
        cluster.terms
          .map((t) => foldAscii(t))
          .filter((t) => t.length > 0)
      )
    );
    for (const head of foldedTerms) {
      let bucket = map.get(head);
      if (!bucket) {
        bucket = new Set<string>();
        map.set(head, bucket);
      }
      for (const other of foldedTerms) {
        if (other !== head) {
          bucket.add(other);
        }
      }
    }
  }

  const out = new Map<string, string[]>();
  for (const [k, set] of map.entries()) {
    out.set(k, Array.from(set));
  }
  return out;
})();

export function getBilingualSynonyms(foldedTerm: string): string[] | undefined {
  return FOLDED_SYNONYM_MAP.get(foldedTerm);
}

/**
 * Returns up to 2 subtle bilingual synonym hint groups for the current search query
 * (skipping quoted exact phrases and field operators) so users can see/click related terms.
 */
export function getMatchingSynonymsForQuery(
  rawQuery: string
): ActiveSynonymHint[] {
  const trimmed = rawQuery.trim();
  if (!trimmed || trimmed.length < 2) return [];

  // Strip quoted phrases so `"whoosh"` shows no synonym hints
  const unquoted = trimmed.replace(/"[^"]*"|'[^']*'/g, " ").trim();
  if (!unquoted) return [];

  const words = unquoted
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 2 &&
        !w.includes(":") &&
        !w.startsWith("-") &&
        !w.startsWith("!") &&
        !w.startsWith("#") &&
        !w.startsWith("<") &&
        !w.startsWith(">") &&
        w.toUpperCase() !== "OR" &&
        w !== "|"
    )
    .map((w) => foldAscii(w.replace(/[^a-zA-Z0-9\u00C0-\u024F\u011E-\u015F]/g, "")))
    .filter(Boolean);

  if (words.length === 0) return [];

  const hints: ActiveSynonymHint[] = [];
  const seenClusters = new Set<string>();

  for (const word of words) {
    for (const cluster of SFX_THESAURUS_CLUSTERS) {
      if (seenClusters.has(cluster.id)) continue;
      const foldedList = cluster.terms.map((t) => ({
        raw: t.trim(),
        folded: foldAscii(t),
      }));
      const hit = foldedList.find((item) => item.folded === word);
      if (hit) {
        seenClusters.add(cluster.id);
        const suggestions = foldedList
          .filter(
            (item) =>
              item.folded !== word &&
              !words.includes(item.folded) &&
              !item.raw.includes(" ")
          )
          .slice(0, 5)
          .map((item) => item.raw);
        if (suggestions.length > 0) {
          hints.push({
            clusterId: cluster.id,
            label: cluster.label,
            matchedTerm: hit.raw,
            suggestions,
          });
        }
        if (hints.length >= 2) return hints;
      }
    }
  }

  return hints;
}
