import { DuplicateScanMode, DuplicateScanResult, Library } from "../../types";
import { filterVisibleLibraries } from "../../utils/format";

export const MAX_DUPLICATE_SCAN_CACHE_ENTRIES = 2;

export function putDuplicateScanCache(
  prev: Record<string, DuplicateScanResult>,
  scopeKey: string,
  result: DuplicateScanResult
): Record<string, DuplicateScanResult> {
  const keys = Object.keys(prev).filter((k) => k !== scopeKey);
  while (keys.length >= MAX_DUPLICATE_SCAN_CACHE_ENTRIES) {
    keys.shift();
  }
  const next: Record<string, DuplicateScanResult> = {};
  for (const k of keys) {
    next[k] = prev[k];
  }
  next[scopeKey] = result;
  return next;
}

export function makeDuplicateScopeKey(
  mode: DuplicateScanMode,
  libraryId: number | null,
  minSimilarityPct = 97
): string {
  return mode === "similar"
    ? `similar:${minSimilarityPct}:${libraryId ?? "all"}`
    : `exact:${libraryId ?? "all"}`;
}

export function resolveDuplicateScopeLabel(
  libraries: Library[],
  libraryId: number | null
): string {
  if (libraryId === null) return "All Libraries";
  return (
    filterVisibleLibraries(libraries).find((l) => l.id === libraryId)?.name ??
    "All Libraries"
  );
}

export function formatDuplicateModeLabel(
  mode: DuplicateScanMode,
  minSimilarityPct?: number
): string {
  if (mode !== "similar") return "Exact (SHA-256)";
  if (minSimilarityPct === 80) return "Similar Audio (All 80%+)";
  return minSimilarityPct !== undefined
    ? `Similar Audio (>= ${minSimilarityPct}%)`
    : "Similar Audio";
}

export function pruneDuplicateScanCache(
  cache: Record<string, DuplicateScanResult>,
  removedIds: ReadonlySet<number>
): Record<string, DuplicateScanResult> {
  if (removedIds.size === 0) return cache;
  let changed = false;
  const next: Record<string, DuplicateScanResult> = {};
  for (const [key, res] of Object.entries(cache)) {
    const pruned = pruneDuplicateScanResult(res, removedIds);
    if (pruned !== res) changed = true;
    if (pruned) {
      next[key] = pruned;
    }
  }
  return changed ? next : cache;
}

export interface DuplicateSampleMeta {
  orderIndex: number;
  groupId: string;
  groupNumber: number;
  matchKind: string;
  similarityPct: number;
  keepSuggested: boolean;
  libraryReadOnly: boolean;
}

const EMPTY_DUPLICATE_META_MAP: ReadonlyMap<number, DuplicateSampleMeta> =
  new Map();
const EMPTY_DUPLICATE_ORDER_MAP: ReadonlyMap<number, number> = new Map();

export function buildDuplicateMetaBySampleId(
  result: DuplicateScanResult | null
): ReadonlyMap<number, DuplicateSampleMeta> {
  if (!result || result.groups.length === 0) {
    return EMPTY_DUPLICATE_META_MAP;
  }
  const map = new Map<number, DuplicateSampleMeta>();
  let orderIndex = 0;
  for (let gIdx = 0; gIdx < result.groups.length; gIdx++) {
    const group = result.groups[gIdx];
    const groupNumber = gIdx + 1;
    for (const entry of group.items) {
      if (!map.has(entry.sample_id)) {
        map.set(entry.sample_id, {
          orderIndex,
          groupId: group.group_id,
          groupNumber,
          matchKind: group.match_kind,
          similarityPct: group.similarity_pct,
          keepSuggested: entry.keep_suggested,
          libraryReadOnly: entry.library_read_only,
        });
      }
      orderIndex += 1;
    }
  }
  return map;
}

export function buildDuplicateOrderMap(
  duplicatesFilterActive: boolean,
  result: DuplicateScanResult | null
): ReadonlyMap<number, number> | null {
  if (!duplicatesFilterActive) return null;
  if (!result || result.groups.length === 0) return EMPTY_DUPLICATE_ORDER_MAP;
  const order = new Map<number, number>();
  let idx = 0;
  for (const group of result.groups) {
    for (const entry of group.items) {
      if (!order.has(entry.sample_id)) {
        order.set(entry.sample_id, idx);
      }
      idx += 1;
    }
  }
  return order;
}

export function collectSuggestedExtraDuplicateIds(
  result: DuplicateScanResult | null,
  visibleSampleIds?: ReadonlySet<number>,
  minSimilarityPct = 0
): number[] {
  if (!result || result.groups.length === 0) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const group of result.groups) {
    if (minSimilarityPct > 0 && group.similarity_pct < minSimilarityPct) {
      continue;
    }
    for (const entry of group.items) {
      if (entry.keep_suggested || entry.library_read_only) continue;
      if (visibleSampleIds && !visibleSampleIds.has(entry.sample_id)) continue;
      if (!seen.has(entry.sample_id)) {
        seen.add(entry.sample_id);
        ids.push(entry.sample_id);
      }
    }
  }
  return ids;
}

export function pruneDuplicateScanResult(
  result: DuplicateScanResult | null,
  removedIds: ReadonlySet<number>
): DuplicateScanResult | null {
  if (!result || removedIds.size === 0) return result;
  const nextGroups = result.groups
    .map((group) => {
      const remaining = group.items.filter(
        (entry) => !removedIds.has(entry.sample_id)
      );
      if (remaining.length < 2) return null;
      const hasKeep = remaining.some((entry) => entry.keep_suggested);
      const normalizedItems = hasKeep
        ? remaining
        : remaining.map((entry, idx) => ({
            ...entry,
            keep_suggested: idx === 0,
          }));
      const reclaimableBytes = normalizedItems.reduce(
        (sum, entry) => sum + (entry.keep_suggested ? 0 : entry.file_size),
        0
      );
      return {
        ...group,
        items: normalizedItems,
        reclaimable_bytes: reclaimableBytes,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  return {
    ...result,
    groups_found: nextGroups.length,
    duplicate_files_count: nextGroups.reduce(
      (sum, g) => sum + Math.max(0, g.items.length - 1),
      0
    ),
    reclaimable_bytes: nextGroups.reduce(
      (sum, g) => sum + g.reclaimable_bytes,
      0
    ),
    groups: nextGroups,
  };
}
