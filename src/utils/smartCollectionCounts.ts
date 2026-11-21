import { Collection, SampleItem } from "../types";
import { countSmartSearchMatches } from "./smartSearch";

const EMPTY_SMART_COLLECTION_COUNTS: Record<number, number> = {};

/**
 * Computes live matching counts for every Smart Collection against the loaded
 * profile sample pool. Returns a shared empty map when no smart collections exist.
 */
export function computeSmartCollectionCounts(
  allProfileSamples: SampleItem[],
  collections: Collection[],
  enableSynonyms: boolean
): Record<number, number> {
  const smartCollections = collections.filter(
    (col) => typeof col.smart_query === "string" && col.smart_query.trim().length > 0
  );
  if (smartCollections.length === 0) {
    return EMPTY_SMART_COLLECTION_COUNTS;
  }

  const counts: Record<number, number> = {};
  for (const col of smartCollections) {
    const query = col.smart_query!.trim();
    counts[col.id] =
      allProfileSamples.length > 0
        ? countSmartSearchMatches(allProfileSamples, query, enableSynonyms)
        : 0;
  }
  return counts;
}
