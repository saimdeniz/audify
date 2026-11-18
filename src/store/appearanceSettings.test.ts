// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ASCII_PRESETS } from "../constants/asciiPresets";
import { evictAsciiMagicAutoAccentCache } from "../utils/autoAccent";
import { isGifWallpaperPath } from "../utils/thumbnailCache";
import {
  AUDIFY_STORAGE_KEYS,
  hasActiveVisualBackdrop,
  loadBootSettings,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
  normalizeAsciiPreset,
  normalizeSettingsTab,
  normalizeWallpaperKind,
  safeRemoveItem,
  safeSetItem,
} from "./storageHelpers";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "./useSampleStore";

describe("appearance backdrop & settings tab persistence", () => {
  it("manages ASCII & image wallpaper states, migrates legacy custom kind and computes active backdrops", () => {
    const store = useSampleStore.getState();

    expect(hasActiveVisualBackdrop("none", "C:/wallpapers/forest.png")).toBe(
      false
    );
    expect(hasActiveVisualBackdrop("ascii_preset", "")).toBe(true);
    expect(hasActiveVisualBackdrop("image", "")).toBe(false);
    expect(hasActiveVisualBackdrop("image", "C:/wallpapers/forest.png")).toBe(
      true
    );
    expect(isGifWallpaperPath("C:/wallpapers/rain.gif")).toBe(true);
    expect(isGifWallpaperPath("C:/wallpapers/NEON_LOOP.GIF")).toBe(true);
    expect(isGifWallpaperPath("C:/wallpapers/forest.png")).toBe(false);

    expect(normalizeWallpaperKind("ascii_custom", "")).toBe("ascii_preset");
    for (const preset of ASCII_PRESETS) {
      expect(normalizeAsciiPreset(preset.id)).toBe(preset.id);
    }

    store.setAsciiPreset("aurora_cabin");
    expect(useSampleStore.getState().wallpaperKind).toBe("ascii_preset");
    expect(useSampleStore.getState().asciiPreset).toBe("aurora_cabin");

    store.setAsciiPreset("koi_pond");
    expect(useSampleStore.getState().asciiPreset).toBe("koi_pond");

    store.setAsciiMotionSpeed(1.5);
    expect(useSampleStore.getState().asciiMotionSpeed).toBe(1.5);

    store.setWallpaperKind("none");
    expect(useSampleStore.getState().wallpaperKind).toBe("none");

    store.setCustomBgImage("C:/wallpapers/studio.jpg");
    expect(useSampleStore.getState().wallpaperKind).toBe("image");
    expect(useSampleStore.getState().customBgImage).toBe(
      "C:/wallpapers/studio.jpg"
    );

    store.setCustomBgImage("");
    expect(useSampleStore.getState().wallpaperKind).toBe("none");

    store.setCustomBgOpacity(1);
    expect(useSampleStore.getState().customBgOpacity).toBe(1);
    store.setCustomBgOpacity(1.3);
    expect(useSampleStore.getState().customBgOpacity).toBe(1);

    // Community catalog (ascii_magic) state & look persistence
    expect(hasActiveVisualBackdrop("ascii_magic", "", "")).toBe(false);
    expect(hasActiveVisualBackdrop("ascii_magic", "", "chai-stall-dawn")).toBe(
      true
    );
    expect(normalizeAsciiMagicSlug(" Chai-Stall-Dawn ")).toBe("chai-stall-dawn");
    expect(normalizeAsciiMagicSlug("https://evil.test/x.js")).toBe("");
    expect(normalizeAsciiMagicLook("dots")).toBe("dots");
    expect(normalizeAsciiMagicLook("invalid_look")).toBe("original");
    expect(normalizeAsciiMagicFit("cover")).toBe("cover");
    expect(normalizeAsciiMagicFit("bad")).toBe("contain");

    store.setAsciiMagicSlug("chai-stall-dawn", true);
    expect(useSampleStore.getState().wallpaperKind).toBe("ascii_magic");
    expect(useSampleStore.getState().asciiMagicSlug).toBe("chai-stall-dawn");

    store.setAsciiMagicLook("dots");
    expect(useSampleStore.getState().asciiMagicLook).toBe("dots");

    store.setAsciiMagicFit("cover");
    expect(useSampleStore.getState().asciiMagicFit).toBe("cover");

    store.setAsciiMagicSlug("", true);
    expect(useSampleStore.getState().wallpaperKind).toBe("none");
    expect(useSampleStore.getState().asciiMagicSlug).toBe("");
  });

  it("remembers the last opened settings tab across close/reopen when no explicit tab is given", () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    expect(normalizeSettingsTab("unknown_tab")).toBe("profiles");
    expect(normalizeSettingsTab("appearance")).toBe("appearance");

    const store = useSampleStore.getState();
    store.setSettingsOpen(true, "appearance");
    expect(useSampleStore.getState().settingsTab).toBe("appearance");

    store.setSettingsOpen(false);
    expect(useSampleStore.getState().settingsTab).toBe("appearance");

    store.setSettingsOpen(true);
    expect(useSampleStore.getState().settingsTab).toBe("appearance");
    expect(invokeMock).toHaveBeenLastCalledWith(
      "open_settings_window",
      expect.objectContaining({ tab: "appearance" })
    );
  });

  it("extracts and updates theme accent automatically when Auto Accent is enabled for catalog scenes", async () => {
    invokeMock.mockReset();
    evictAsciiMagicAutoAccentCache();

    invokeMock.mockImplementation(async (cmd: string, args?: { slug?: string }) => {
      if (cmd === "get_ascii_magic_preview" && args?.slug === "aurora-cabin-snowfall") {
        return JSON.stringify({
          meta: {
            slug: "aurora-cabin-snowfall",
            name: "Aurora Cabin",
            category: "landscapes",
            cols: 4,
            rows: 2,
            fps: 15,
            cell: "square",
            look: "original",
            still: false,
            dots: null,
            palette: { a: "#10b981", b: "#090d16" },
          },
          frame: {
            text: "████\n████",
            color: "aaaa\nbbbb",
            paletteOverride: null,
          },
        });
      }
      if (cmd === "get_ascii_magic_preview" && args?.slug === "acropolis-hill-dusk") {
        return JSON.stringify({
          meta: {
            slug: "acropolis-hill-dusk",
            name: "Acropolis Hill Dusk",
            category: "places",
            cols: 4,
            rows: 2,
            fps: 15,
            cell: "square",
            look: "original",
            still: false,
            dots: null,
            palette: { a: "#f97316", b: "#111827" },
          },
          frame: {
            text: "████\n████",
            color: "aaaa\nbbbb",
            paletteOverride: null,
          },
        });
      }
      return undefined;
    });

    const store = useSampleStore.getState();
    store.setAccentColor("#38BDF8");
    store.setAsciiMagicSlug("aurora-cabin-snowfall", true);
    store.setAccentAuto(true);

    await vi.waitFor(() => {
      const hex = useSampleStore.getState().accentColor;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b - 30);
    });
    const auroraAccent = useSampleStore.getState().accentColor;

    store.setAsciiMagicSlug("acropolis-hill-dusk", true);
    await vi.waitFor(() => {
      const hex = useSampleStore.getState().accentColor;
      expect(hex).not.toBe(auroraAccent);
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(r).toBeGreaterThan(b);
    });

    store.setAccentAuto(false);
    expect(useSampleStore.getState().accentColor).toBe("#38BDF8");
  });

  it("broadcasts lightweight live-visual patch on setThemeMode and handles empty numeric storage values safely", () => {
    const postSpy =
      typeof BroadcastChannel !== "undefined"
        ? vi.spyOn(BroadcastChannel.prototype, "postMessage")
        : null;

    try {
      useSampleStore.getState().setThemeMode("light");
      expect(useSampleStore.getState().themeMode).toBe("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");

      if (postSpy) {
        const posted = postSpy.mock.calls.map((c) => c[0] as { kind?: string; patch?: unknown });
        expect(posted).toContainEqual({
          kind: "live-visual",
          patch: { themeMode: "light" },
        });
        expect(posted.some((m) => m.kind === "settings")).toBe(false);
      }

      // Empty strings for numeric settings must use defaults, whereas explicit "0" stays 0
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgBlur, "", { broadcast: false });
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgOpacity, "   ", { broadcast: false });
      safeSetItem(AUDIFY_STORAGE_KEYS.volume, "", { broadcast: false });
      const emptyBoot = loadBootSettings();
      expect(emptyBoot.customBgBlur).toBe(16);
      expect(emptyBoot.customBgOpacity).toBe(0.22);
      expect(emptyBoot.volume).toBe(0.9);

      safeSetItem(AUDIFY_STORAGE_KEYS.customBgBlur, "0", { broadcast: false });
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgOpacity, "0", { broadcast: false });
      safeSetItem(AUDIFY_STORAGE_KEYS.volume, "0", { broadcast: false });
      const zeroBoot = loadBootSettings();
      expect(zeroBoot.customBgBlur).toBe(0);
      expect(zeroBoot.customBgOpacity).toBe(0);
      expect(zeroBoot.volume).toBe(0);
    } finally {
      postSpy?.mockRestore();
      safeRemoveItem(AUDIFY_STORAGE_KEYS.customBgBlur, { broadcast: false });
      safeRemoveItem(AUDIFY_STORAGE_KEYS.customBgOpacity, { broadcast: false });
      safeRemoveItem(AUDIFY_STORAGE_KEYS.volume, { broadcast: false });
      safeRemoveItem(AUDIFY_STORAGE_KEYS.themeMode, { broadcast: false });
    }
  });
});
