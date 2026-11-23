import { DEFAULT_COLLECTION_TEMPLATES } from "../constants/collections";
import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import {
  AUDIFY_STORAGE_KEYS,
  LAST_SELECTED_SAMPLE_ID_KEY,
  LAST_SELECTED_SAMPLE_PATH_KEY,
} from "../constants/storageKeys";
import {
  CollectionRuleTemplate,
  FolderStat,
  KeyboardShortcuts,
  LicenseGroup,
  SampleItem,
  SortDir,
  SortKey,
} from "../types";
import { normalizeSettingsTab, SETTINGS_TAB_STORAGE_KEY } from "./crossWindowSync";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./localStorageSafe";
import type { SettingsTab } from "./types";

export {
  AUDIFY_STORAGE_KEYS,
  LAST_SELECTED_SAMPLE_ID_KEY,
  LAST_SELECTED_SAMPLE_PATH_KEY,
} from "../constants/storageKeys";

export {
  APPLY_MAIN_FILTER_EVENT,
  SETTINGS_TAB_STORAGE_KEY,
  isStandaloneSettingsWindow,
  normalizeSettingsTab,
  postCrossWindowSync,
  subscribeCrossWindowSync,
  type CrossWindowSyncKind,
  type CrossWindowSyncMessage,
} from "./crossWindowSync";
export {
  isLocalKeyRecentlyEdited,
  markLocalKeyEdited,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from "./localStorageSafe";
export {
  ASCII_MAGIC_FIT_STORAGE_KEY,
  ASCII_MAGIC_LOOK_STORAGE_KEY,
  ASCII_MAGIC_SLUG_STORAGE_KEY,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
} from "../constants/asciiMagic";
export {
  hasActiveVisualBackdrop,
  loadBootSettings,
  normalizeAsciiMotionSpeed,
  normalizeAsciiPreset,
  normalizeWallpaperKind,
  parseProfileSettings,
  type BootSettingsSnapshot,
} from "./profileSettingsParser";
export type { MainFilterRequest } from "./types";

export function loadSavedRecentSampleIds(): number[] {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.recentSampleIds);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((id): id is number => typeof id === "number")
          .slice(0, 50);
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return [];
}

export function pushRecentSampleId(current: number[], sampleId: number): number[] {
  const next = [sampleId, ...current.filter((id) => id !== sampleId)].slice(
    0,
    50
  );
  safeSetItem(AUDIFY_STORAGE_KEYS.recentSampleIds, JSON.stringify(next), {
    broadcast: false,
  });
  safeSetItem(LAST_SELECTED_SAMPLE_ID_KEY, String(sampleId), {
    broadcast: false,
  });
  return next;
}

export function loadSavedLastSample(): { id: number | null; path: string | null } {
  try {
    const rawId = safeGetItem(LAST_SELECTED_SAMPLE_ID_KEY);
    const path = safeGetItem(LAST_SELECTED_SAMPLE_PATH_KEY);
    let id: number | null = null;
    if (rawId) {
      const parsed = parseInt(rawId, 10);
      if (!Number.isNaN(parsed) && parsed > 0) id = parsed;
    }
    if (!id) {
      const recent = loadSavedRecentSampleIds();
      if (recent.length > 0) id = recent[0];
    }
    return { id, path: path || null };
  } catch {
    return { id: null, path: null };
  }
}

export function saveLastSample(sample: SampleItem | null): void {
  if (!sample) return;
  safeSetItem(LAST_SELECTED_SAMPLE_ID_KEY, String(sample.id), {
    broadcast: false,
  });
  safeSetItem(LAST_SELECTED_SAMPLE_PATH_KEY, sample.file_path, {
    broadcast: false,
  });
}

export function loadSavedSort(): { key: SortKey | null; dir: SortDir } {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.sort);
    if (raw) {
      const parsed = JSON.parse(raw);
      const keys: SortKey[] = [
        "name",
        "class",
        "artist",
        "album",
        "year",
        "genre",
        "bpm",
        "key",
        "duration",
        "sample_rate",
        "dateModified",
        "dateAdded",
      ];
      if (parsed && keys.includes(parsed.key)) {
        return { key: parsed.key, dir: parsed.dir === "desc" ? "desc" : "asc" };
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return { key: null, dir: "asc" };
}

export function loadSavedBinSampleIds(): number[] {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.binSampleIds);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is number => typeof id === "number");
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return [];
}

export function loadSavedLicenseGroups(): LicenseGroup[] {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.licenseGroups);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore malformed JSON
  }
  return [];
}

const CACHED_FOLDER_STATS_KEY = AUDIFY_STORAGE_KEYS.cachedFolderStats;

export function loadSavedFolderStats(): FolderStat[] {
  try {
    const raw = safeGetItem(CACHED_FOLDER_STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is FolderStat =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof (item as FolderStat).library_id === "number" &&
                typeof (item as FolderStat).folder_path === "string" &&
                typeof (item as FolderStat).count === "number"
            )
        );
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return [];
}

export function saveFolderStats(stats: FolderStat[]): void {
  safeSetItem(CACHED_FOLDER_STATS_KEY, JSON.stringify(stats), {
    broadcast: false,
    markEdited: false,
  });
}

const CACHED_TRASH_STATUS_KEY = AUDIFY_STORAGE_KEYS.cachedTrashStatus;

export function loadSavedTrashStatus(): { count: number; totalBytes: number } {
  try {
    const raw = safeGetItem(CACHED_TRASH_STATUS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        count?: unknown;
        totalBytes?: unknown;
      };
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.count === "number" &&
        Number.isFinite(parsed.count) &&
        parsed.count >= 0
      ) {
        const totalBytes =
          typeof parsed.totalBytes === "number" &&
          Number.isFinite(parsed.totalBytes) &&
          parsed.totalBytes >= 0
            ? Math.trunc(parsed.totalBytes)
            : 0;
        return { count: Math.trunc(parsed.count), totalBytes };
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return { count: 0, totalBytes: 0 };
}

export function saveTrashStatus(count: number, totalBytes: number): void {
  const safeCount =
    Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
  const safeBytes =
    Number.isFinite(totalBytes) && totalBytes >= 0 ? Math.trunc(totalBytes) : 0;
  safeSetItem(
    CACHED_TRASH_STATUS_KEY,
    JSON.stringify({ count: safeCount, totalBytes: safeBytes }),
    { broadcast: false, markEdited: false }
  );
}

export function mergeShortcutsWithDefaults(raw: unknown): KeyboardShortcuts {
  const result: KeyboardShortcuts = { ...DEFAULT_SHORTCUTS };
  if (!raw || typeof raw !== "object") {
    return result;
  }
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SHORTCUTS) as (keyof KeyboardShortcuts)[]) {
    const val = source[key];
    // Preserve explicit empty strings ("") representing intentionally unbound shortcuts.
    if (typeof val === "string") {
      result[key] = val;
    }
  }
  return result;
}

export function loadSavedShortcuts(): KeyboardShortcuts {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.shortcuts);
    if (raw) {
      return mergeShortcutsWithDefaults(JSON.parse(raw));
    }
  } catch {
    // Ignore malformed JSON
  }
  return { ...DEFAULT_SHORTCUTS };
}

export function loadSavedActiveFolder(): string | null {
  return safeGetItem(AUDIFY_STORAGE_KEYS.activeFolderFilter) || null;
}

export function loadSavedActiveLicenseGroupId(): string | null {
  return safeGetItem(AUDIFY_STORAGE_KEYS.activeLicenseGroupId) || null;
}

export function loadSavedFavoriteOnly(): boolean {
  return safeGetItem(AUDIFY_STORAGE_KEYS.activeFavoriteOnly) === "true";
}

export function loadSavedCollectionId(): number | null {
  const raw = safeGetItem(AUDIFY_STORAGE_KEYS.activeCollectionId);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function deduplicateTemplates(
  templates: CollectionRuleTemplate[]
): CollectionRuleTemplate[] {
  const seen = new Set<string>();
  const deduped: CollectionRuleTemplate[] = [];
  for (const t of templates) {
    const key = (t.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...t,
      name: (t.name || "").trim(),
    });
  }
  return deduped;
}

export function loadSavedCollectionTemplates(): CollectionRuleTemplate[] {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.collectionTemplates);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return deduplicateTemplates(parsed);
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return deduplicateTemplates([...DEFAULT_COLLECTION_TEMPLATES]);
}

export function loadSavedAutoCreateCollectionSubfolders(): boolean {
  const val = safeGetItem(AUDIFY_STORAGE_KEYS.autoCreateSubfolders);
  if (val !== null) return val === "true";
  return false;
}

export function loadSavedAutoRouteCollectionDrops(): boolean {
  const val = safeGetItem(AUDIFY_STORAGE_KEYS.autoRouteCollectionDrops);
  if (val !== null) return val === "true";
  return true;
}

export function persistNavigationFilters(
  folderFilter: string | null,
  selectedLicenseGroupId: string | null,
  favoriteOnly: boolean,
  selectedCollectionId: number | null
): void {
  const noBroadcast = { broadcast: false } as const;
  if (folderFilter) {
    safeSetItem(AUDIFY_STORAGE_KEYS.activeFolderFilter, folderFilter, noBroadcast);
  } else {
    safeRemoveItem(AUDIFY_STORAGE_KEYS.activeFolderFilter, noBroadcast);
  }

  if (selectedLicenseGroupId) {
    safeSetItem(
      AUDIFY_STORAGE_KEYS.activeLicenseGroupId,
      selectedLicenseGroupId,
      noBroadcast
    );
  } else {
    safeRemoveItem(AUDIFY_STORAGE_KEYS.activeLicenseGroupId, noBroadcast);
  }

  if (favoriteOnly) {
    safeSetItem(AUDIFY_STORAGE_KEYS.activeFavoriteOnly, "true", noBroadcast);
  } else {
    safeRemoveItem(AUDIFY_STORAGE_KEYS.activeFavoriteOnly, noBroadcast);
  }

  if (selectedCollectionId !== null) {
    safeSetItem(
      AUDIFY_STORAGE_KEYS.activeCollectionId,
      String(selectedCollectionId),
      noBroadcast
    );
  } else {
    safeRemoveItem(AUDIFY_STORAGE_KEYS.activeCollectionId, noBroadcast);
  }
}

export function loadSavedSettingsTab(): SettingsTab {
  return normalizeSettingsTab(safeGetItem(SETTINGS_TAB_STORAGE_KEY));
}
