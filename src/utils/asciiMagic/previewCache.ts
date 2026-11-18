import type { AsciiMagicPreviewSnapshot } from "../../types";

const MAX_PREVIEW_SNAPSHOT_CACHE = 16;

const previewCache = new Map<string, AsciiMagicPreviewSnapshot | null>();

export function hasAsciiMagicPreviewCacheEntry(slug: string): boolean {
  return previewCache.has(slug);
}

export function getAsciiMagicPreviewCacheEntry(
  slug: string
): AsciiMagicPreviewSnapshot | null | undefined {
  return previewCache.get(slug);
}

export function setBoundedPreviewCache(
  slug: string,
  value: AsciiMagicPreviewSnapshot | null
): void {
  previewCache.delete(slug);
  previewCache.set(slug, value);
  while (previewCache.size > MAX_PREVIEW_SNAPSHOT_CACHE) {
    const oldest = previewCache.keys().next().value;
    if (oldest === undefined) break;
    previewCache.delete(oldest);
  }
}

export function clearAsciiMagicPreviewSnapshots(slug?: string): void {
  if (slug) {
    previewCache.delete(slug);
  } else {
    previewCache.clear();
  }
}
