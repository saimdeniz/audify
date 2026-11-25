import { safeGetItem, safeSetItem } from "../../store/storageHelpers";

/**
 * Checks whether a Settings tree preference key has ever been persisted by the user.
 * Lets us respect an intentional empty set (`[]` after Collapse All) without auto-expanding it back.
 */
export function hasPersistedTreePref(storageKey: string): boolean {
  return safeGetItem(storageKey) !== null;
}

/**
 * Synchronously loads a persisted numeric ID Set (for expanded parent tags / collections),
 * falling back to `computeDefaultIds()` on first use so Frame 1 renders immediately with zero flicker.
 */
export function loadPersistedIdSet(
  storageKey: string,
  computeDefaultIds: () => number[]
): Set<number> {
  try {
    const raw = safeGetItem(storageKey);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        );
      }
    }
  } catch {
    // Fall back to defaults on malformed storage
  }
  return new Set(computeDefaultIds());
}

export function savePersistedIdSet(
  storageKey: string,
  ids: ReadonlySet<number>
): void {
  safeSetItem(storageKey, JSON.stringify(Array.from(ids)), {
    broadcast: false,
    markEdited: false,
  });
}

/**
 * Synchronously loads a persisted boolean map (e.g., collapsed sections or rule groups).
 */
export function loadPersistedBoolMap(
  storageKey: string,
  defaults?: Record<string, boolean>
): Record<string, boolean> {
  try {
    const raw = safeGetItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const clean: Record<string, boolean> = { ...(defaults ?? {}) };
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "boolean") clean[k] = v;
        }
        return clean;
      }
    }
  } catch {
    // Fall back to defaults
  }
  return { ...(defaults ?? {}) };
}

export function savePersistedBoolMap(
  storageKey: string,
  map: Record<string, boolean>
): void {
  safeSetItem(storageKey, JSON.stringify(map), {
    broadcast: false,
    markEdited: false,
  });
}
