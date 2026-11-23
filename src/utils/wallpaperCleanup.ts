import { WallpaperKind } from "../types";
import { clearAsciiMagicPreviewSnapshots } from "./asciiMagic/previewCache";
import {
  clearAllAutoAccentCaches,
  evictAsciiMagicAutoAccentCache,
} from "./autoAccentCache";
import { clearWallpaperMediaCaches } from "./thumbnailCache";
import { clearBlurredWallpaperCache } from "./wallpaperBlurCache";
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
    clearWallpaperMediaCaches("all");
    clearBlurredWallpaperCache();
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
    clearWallpaperMediaCaches("viewport");
    clearBlurredWallpaperCache();
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
  clearWallpaperMediaCaches("all");
  clearBlurredWallpaperCache();
  runWallpaperCacheCleaner("ascii_preset_grid");
  runWallpaperCacheCleaner("ascii_magic_sandbox");
}
