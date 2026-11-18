// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsciiMagicPreviewSnapshot } from "../types";
import {
  hasAsciiMagicPreviewCacheEntry,
  setBoundedPreviewCache,
} from "./asciiMagic/previewCache";
import { asciiMagicSandbox } from "./asciiMagic/sandboxBridge";
import {
  cacheAsciiMagicAutoAccent,
  getCachedAsciiMagicAutoAccentHex,
} from "./autoAccent";
import {
  releaseBackdropTransitionCaches,
  releaseSettingsWindowCaches,
} from "./wallpaperCleanup";

const SAMPLE_SNAP: AsciiMagicPreviewSnapshot = {
  meta: {
    slug: "cleanup-test",
    name: "Cleanup Test",
    category: "abstract",
    cols: 4,
    rows: 2,
    fps: 15,
    cell: "mono",
    look: "original",
    still: true,
    dots: null,
    palette: { a: "#38bdf8" },
  },
  frame: {
    text: "████\n████",
    color: "aaaa\naaaa",
    paletteOverride: null,
  },
};

describe("wallpaperCleanup caches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("evicts ASCII magic preview and accent caches when switching wallpaper to none", async () => {
    const disposeSpy = vi
      .spyOn(asciiMagicSandbox, "disposeIfIdle")
      .mockImplementation(() => {});

    setBoundedPreviewCache("cleanup-test", SAMPLE_SNAP);
    cacheAsciiMagicAutoAccent("cleanup-test", SAMPLE_SNAP);
    expect(hasAsciiMagicPreviewCacheEntry("cleanup-test")).toBe(true);
    expect(getCachedAsciiMagicAutoAccentHex("cleanup-test")).toBeTruthy();

    releaseBackdropTransitionCaches("ascii_magic", "none");
    expect(hasAsciiMagicPreviewCacheEntry("cleanup-test")).toBe(false);
    expect(getCachedAsciiMagicAutoAccentHex("cleanup-test")).toBeNull();

    await Promise.resolve();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("disposes idle sandbox and clears caches when standalone settings hides", () => {
    const disposeSpy = vi
      .spyOn(asciiMagicSandbox, "disposeIfIdle")
      .mockImplementation(() => {});

    setBoundedPreviewCache("settings-hide-test", SAMPLE_SNAP);
    expect(hasAsciiMagicPreviewCacheEntry("settings-hide-test")).toBe(true);

    releaseSettingsWindowCaches();
    expect(hasAsciiMagicPreviewCacheEntry("settings-hide-test")).toBe(false);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
