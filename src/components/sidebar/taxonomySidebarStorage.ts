import {
  AUDIFY_STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
} from "../../store/storageHelpers";

export function loadSidebarSectionMap(key: string): Record<string, boolean> {
  try {
    const raw = safeGetItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean") out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore corrupted localStorage
  }
  return {};
}

export function saveSidebarSectionMap(
  key: string,
  map: Record<string, boolean>
): void {
  safeSetItem(key, JSON.stringify(map), {
    broadcast: false,
    markEdited: false,
  });
}

export function loadSidebarExpandedTagIds(): Set<number> {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.sidebarExpandedTagIds);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed.filter(
          (v): v is number => typeof v === "number" && Number.isFinite(v)
        )
      );
    }
  } catch {
    // ignore corrupted localStorage
  }
  return new Set();
}

export function saveSidebarExpandedTagIds(ids: ReadonlySet<number>): void {
  safeSetItem(
    AUDIFY_STORAGE_KEYS.sidebarExpandedTagIds,
    JSON.stringify(Array.from(ids)),
    { broadcast: false, markEdited: false }
  );
}
