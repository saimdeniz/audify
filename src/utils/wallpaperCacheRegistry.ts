type CacheCleanerFn = () => void;

const cacheCleaners = new Map<string, CacheCleanerFn>();

/**
 * Registers a lazy subsystem cleanup callback without creating eager static
 * bundle dependencies from the main store into lazy ASCII/canvas chunks.
 */
export function registerWallpaperCacheCleaner(
  key: string,
  cleaner: CacheCleanerFn
): void {
  cacheCleaners.set(key, cleaner);
}

export function runWallpaperCacheCleaner(key: string): void {
  cacheCleaners.get(key)?.();
}
