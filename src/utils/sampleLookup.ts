import type { SampleItem } from "../types";

export const EMPTY_SAMPLES: SampleItem[] = [];
export const EMPTY_SAMPLE_MAP: Map<number, SampleItem> = new Map();

const profileSampleMapCache = new WeakMap<
  readonly SampleItem[],
  Map<number, SampleItem>
>();

/**
 * Returns a cached `id -> SampleItem` map for a sample pool array (built once per
 * array reference via WeakMap, avoiding O(n) scans across filter/search updates).
 */
export function getCachedSampleByIdMap(
  pool: readonly SampleItem[]
): Map<number, SampleItem> {
  if (pool.length === 0) return EMPTY_SAMPLE_MAP;
  let map = profileSampleMapCache.get(pool);
  if (!map) {
    map = new Map<number, SampleItem>();
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      map.set(item.id, item);
    }
    profileSampleMapCache.set(pool, map);
  }
  return map;
}

/**
 * Resolves ordered `SampleItem` records for a subset of IDs using the WeakMap
 * `id -> SampleItem` cache on large pools to avoid O(N) scans over 50k+ samples.
 */
export function resolveSamplesByIds(
  ids: readonly number[],
  primary: readonly SampleItem[],
  fallback?: readonly SampleItem[]
): SampleItem[] {
  if (ids.length === 0) return EMPTY_SAMPLES;
  if (primary.length >= 256 || profileSampleMapCache.has(primary)) {
    const primaryMap = getCachedSampleByIdMap(primary);
    const fallbackMap =
      fallback && fallback.length > 0 ? getCachedSampleByIdMap(fallback) : null;
    const out: SampleItem[] = [];
    for (let i = 0; i < ids.length; i++) {
      const hit = primaryMap.get(ids[i]) ?? fallbackMap?.get(ids[i]);
      if (hit) out.push(hit);
    }
    return out;
  }

  const wanted = new Set(ids);
  const found = new Map<number, SampleItem>();

  for (const item of primary) {
    if (wanted.has(item.id)) {
      found.set(item.id, item);
      if (found.size === wanted.size) break;
    }
  }

  if (fallback && found.size < wanted.size) {
    for (const item of fallback) {
      if (wanted.has(item.id) && !found.has(item.id)) {
        found.set(item.id, item);
        if (found.size === wanted.size) break;
      }
    }
  }

  return ids
    .map((id) => found.get(id))
    .filter((item): item is SampleItem => Boolean(item));
}
