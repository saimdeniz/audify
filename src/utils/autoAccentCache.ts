import { ASCII_PRESET_AUTO_ACCENTS } from "../constants/asciiPresetIds";
import type { AsciiPresetId } from "../types";
import { normalizePathForMatch } from "./pathHelpers";

export const MAX_ACCENT_CACHE_ENTRIES = 64;

export const imageAccentCache = new Map<string, string>();
export const pendingImageAccentPromises = new Map<string, Promise<string | null>>();
export const asciiMagicAccentCache = new Map<string, string>();
export const pendingAsciiMagicAccentPromises = new Map<
  string,
  Promise<string | null>
>();

export let imageAccentEpoch = 0;
export let asciiMagicAccentEpoch = 0;
export const imageAccentKeyEpochs = new Map<string, number>();
export const asciiMagicKeyEpochs = new Map<string, number>();

export function getPresetAutoAccentHex(presetId: AsciiPresetId): string | null {
  const hex = ASCII_PRESET_AUTO_ACCENTS[presetId];
  return hex ? hex.toUpperCase() : null;
}

export function rememberBoundedAccentCache(
  cache: Map<string, string>,
  key: string,
  hex: string
): void {
  cache.delete(key);
  cache.set(key, hex);
  if (cache.size > MAX_ACCENT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

export function evictAutoAccentCache(filePath: string): void {
  const key = normalizePathForMatch(filePath);
  imageAccentKeyEpochs.set(key, (imageAccentKeyEpochs.get(key) ?? 0) + 1);
  imageAccentCache.delete(key);
}

export function getCachedAsciiMagicAutoAccentHex(slug: string): string | null {
  const key = slug.trim().toLowerCase();
  return key ? (asciiMagicAccentCache.get(key) ?? null) : null;
}

export function evictAsciiMagicAutoAccentCache(slug?: string): void {
  if (slug) {
    const key = slug.trim().toLowerCase();
    asciiMagicKeyEpochs.set(key, (asciiMagicKeyEpochs.get(key) ?? 0) + 1);
    asciiMagicAccentCache.delete(key);
  } else {
    asciiMagicAccentEpoch += 1;
    asciiMagicAccentCache.clear();
  }
}

export function clearAllAutoAccentCaches(): void {
  imageAccentEpoch += 1;
  asciiMagicAccentEpoch += 1;
  imageAccentCache.clear();
  pendingImageAccentPromises.clear();
  asciiMagicAccentCache.clear();
  pendingAsciiMagicAccentPromises.clear();
}
