import { AUDIFY_STORAGE_KEY_PREFIX } from "../constants/storageKeys";
import { postCrossWindowSync } from "./windowContext";

export function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const localEditedKeyTimestamps = new Map<string, number>();

export function clearLocalEditedKeys(): void {
  localEditedKeyTimestamps.clear();
}

export function markLocalKeyEdited(key: string): void {
  const now = Date.now();
  if (localEditedKeyTimestamps.size > 64) {
    for (const [k, ts] of localEditedKeyTimestamps) {
      if (now - ts > 5000) {
        localEditedKeyTimestamps.delete(k);
      }
    }
  }
  localEditedKeyTimestamps.set(key, now);
}

export function isLocalKeyRecentlyEdited(
  key: string,
  windowMs = 1500
): boolean {
  const ts = localEditedKeyTimestamps.get(key);
  if (ts === undefined) return false;
  if (Date.now() - ts <= windowMs) return true;
  localEditedKeyTimestamps.delete(key);
  return false;
}

export function safeSetItem(
  key: string,
  value: string,
  opts?: { broadcast?: boolean; markEdited?: boolean }
): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (opts?.markEdited !== false) {
      markLocalKeyEdited(key);
    }
    localStorage.setItem(key, value);
    if (opts?.broadcast !== false && key.startsWith(AUDIFY_STORAGE_KEY_PREFIX)) {
      postCrossWindowSync("settings");
    }
  } catch {
    // Ignore storage quota or sandbox errors
  }
}

export function safeRemoveItem(
  key: string,
  opts?: { broadcast?: boolean; markEdited?: boolean }
): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (opts?.markEdited !== false) {
      markLocalKeyEdited(key);
    }
    localStorage.removeItem(key);
    if (opts?.broadcast !== false && key.startsWith(AUDIFY_STORAGE_KEY_PREFIX)) {
      postCrossWindowSync("settings");
    }
  } catch {
    // Ignore storage errors
  }
}
