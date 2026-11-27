import { WallpaperKind } from "../types";
import { clearAsciiMagicPreviewSnapshots } from "./asciiMagic/previewCache";
import {
  clearAllAutoAccentCaches,
  evictAsciiMagicAutoAccentCache,
} from "./autoAccentCache";
import { runWallpaperCacheCleaner } from "./wallpaperCacheRegistry";

/**
 * Releases volatile in-memory ASCII / backdrop / media caches when switching
 * away from an active backdrop mode or turning wallpaper effects Off.
 */
export function releaseBackdropTransitionCaches(
  prevKind: WallpaperKind,
  nextKind: WallpaperKind
): void {
  if (nextKind === "none") {
    runWallpaperCacheCleaner("ascii_magic_render");
    clearAsciiMagicPreviewSnapshots();
    evictAsciiMagicAutoAccentCache();
    clearAllAutoAccentCaches();
    runWallpaperCacheCleaner("wallpaper_media_all");
    runWallpaperCacheCleaner("wallpaper_blur");
    runWallpaperCacheCleaner("ascii_preset_grid");
    queueMicrotask(() => {
      runWallpaperCacheCleaner("ascii_magic_sandbox");
    });
    return;
  }

  if (prevKind === "ascii_magic" && nextKind !== "ascii_magic") {
    runWallpaperCacheCleaner("ascii_magic_render");
    clearAsciiMagicPreviewSnapshots();
    evictAsciiMagicAutoAccentCache();
    queueMicrotask(() => {
      runWallpaperCacheCleaner("ascii_magic_sandbox");
    });
  }

  if (prevKind === "image" && nextKind !== "image") {
    runWallpaperCacheCleaner("wallpaper_media_viewport");
    runWallpaperCacheCleaner("wallpaper_blur");
  }

  if (prevKind === "ascii_preset" && nextKind !== "ascii_preset") {
    runWallpaperCacheCleaner("ascii_preset_grid");
  }
}

/**
 * Aggressive cleanup invoked when the standalone Settings window hides/closes.
 */
export function releaseSettingsWindowCaches(): void {
  runWallpaperCacheCleaner("ascii_magic_render");
  clearAsciiMagicPreviewSnapshots();
  clearAllAutoAccentCaches();
  runWallpaperCacheCleaner("wallpaper_media_all");
  runWallpaperCacheCleaner("wallpaper_blur");
  runWallpaperCacheCleaner("ascii_preset_grid");
  runWallpaperCacheCleaner("ascii_magic_sandbox");
}
