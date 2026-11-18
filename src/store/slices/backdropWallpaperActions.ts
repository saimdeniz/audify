import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AsciiMagicFit,
  AsciiMagicLook,
  AsciiPresetId,
  WallpaperKind,
} from "../../types";
import {
  evictAutoAccentCache,
  getCachedAsciiMagicAutoAccentHex,
  getPresetAutoAccentHex,
} from "../../utils/autoAccentCache";
import {
  evictThumbnailCache,
  getWallpaperThumbnailUrl,
  getWallpaperViewportUrl,
} from "../../utils/thumbnailCache";
import { releaseBackdropTransitionCaches } from "../../utils/wallpaperCleanup";
import {
  ASCII_MAGIC_FIT_STORAGE_KEY,
  ASCII_MAGIC_LOOK_STORAGE_KEY,
  ASCII_MAGIC_SLUG_STORAGE_KEY,
  AUDIFY_STORAGE_KEYS,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
  normalizeAsciiMotionSpeed,
  normalizeAsciiPreset,
  normalizeWallpaperKind,
  postCrossWindowSync,
  safeSetItem,
} from "../storageHelpers";
import { applyThemeAndAccentToDom } from "../themeDom";
import type { StoreSliceContext } from "../types";

export interface BackdropWallpaperHelpers {
  bumpAutoAccentSeq: () => void;
  getFallbackManualAccent: () => string;
  syncAutoAccentFromBackdrop: () => void;
  scheduleVisualPersist: () => void;
}

export function createBackdropWallpaperActions(
  ctx: StoreSliceContext,
  helpers: BackdropWallpaperHelpers
) {
  const { set, get, emitNotice } = ctx;
  const {
    bumpAutoAccentSeq,
    getFallbackManualAccent,
    syncAutoAccentFromBackdrop,
    scheduleVisualPersist,
  } = helpers;

  return {
    setCustomBgImage: (customBgImage: string) => {
      const prevKind = get().wallpaperKind;
      const nextKind: WallpaperKind =
        customBgImage.trim().length > 0
          ? "image"
          : prevKind === "image"
          ? "none"
          : prevKind;
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgImage, customBgImage, {
        broadcast: false,
      });
      safeSetItem(AUDIFY_STORAGE_KEYS.wallpaperKind, nextKind, {
        broadcast: false,
      });
      set({ customBgImage, wallpaperKind: nextKind });
      releaseBackdropTransitionCaches(prevKind, nextKind);
      postCrossWindowSync("live-visual", {
        customBgImage,
        wallpaperKind: nextKind,
      });
      if (get().accentAuto) {
        syncAutoAccentFromBackdrop();
      } else {
        void get().persistActiveProfileSettings();
      }
    },

    loadCustomBgGallery: async () => {
      try {
        const list = await invoke<string[]>("get_custom_backgrounds");
        set({ customBgGallery: list });
      } catch (err) {
        console.error("Failed to load custom backgrounds:", err);
      }
    },

    openCustomBgFolder: async () => {
      try {
        await invoke("open_custom_backgrounds_folder");
      } catch (err) {
        console.error("Failed to open custom backgrounds folder:", err);
        emitNotice(`Open backgrounds folder failed: ${String(err)}`, "error");
      }
    },

    deleteCustomBgImage: async (filePath: string) => {
      try {
        await invoke("delete_custom_background", { filePath });
        evictThumbnailCache(filePath);
        evictAutoAccentCache(filePath);
        if (get().customBgImage === filePath) {
          get().setCustomBgImage("");
        }
        await get().loadCustomBgGallery();
        postCrossWindowSync("backgrounds");
      } catch (err) {
        console.error("Failed to delete custom background:", err);
        emitNotice(`Delete wallpaper error: ${String(err)}`, "error");
      }
    },

    selectCustomBgImageFile: async () => {
      try {
        const selected = await open({
          multiple: true,
          directory: false,
          title: "Select Custom Wallpaper Image(s)",
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
            },
          ],
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        const validPaths = paths.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0
        );
        if (validPaths.length === 0) return;

        let lastImported = "";
        for (const srcPath of validPaths) {
          const importedPath = await invoke<string>(
            "import_custom_background",
            { sourcePath: srcPath }
          );
          lastImported = importedPath;
          void getWallpaperThumbnailUrl(importedPath);
        }

        if (lastImported) {
          void getWallpaperViewportUrl(lastImported);
          get().setCustomBgImage(lastImported);
        }
        await get().loadCustomBgGallery();
        postCrossWindowSync("backgrounds");
        const msg =
          validPaths.length > 1
            ? `Imported ${validPaths.length} wallpapers`
            : "Saved and applied wallpaper";
        emitNotice(msg, "success");
      } catch (err) {
        console.error("Failed to select background image:", err);
        emitNotice(`Import wallpaper failed: ${String(err)}`, "error");
      }
    },

    setCustomBgBlur: (customBgBlur: number) => {
      const clamped = Math.max(0, Math.min(48, Math.round(customBgBlur)));
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgBlur, String(clamped), {
        broadcast: false,
      });
      set({ customBgBlur: clamped });
      postCrossWindowSync("live-visual", { customBgBlur: clamped });
      scheduleVisualPersist();
    },

    setCustomBgOpacity: (customBgOpacity: number) => {
      const clamped = Math.max(
        0,
        Math.min(1, Number(customBgOpacity.toFixed(2)))
      );
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgOpacity, String(clamped), {
        broadcast: false,
      });
      set({ customBgOpacity: clamped });
      postCrossWindowSync("live-visual", { customBgOpacity: clamped });
      scheduleVisualPersist();
    },

    setWallpaperKind: (kind: WallpaperKind) => {
      const wallpaperKind = normalizeWallpaperKind(kind, get().customBgImage);
      const current = get();
      if (
        current.wallpaperKind === wallpaperKind &&
        (wallpaperKind !== "none" || current.customBgImage === "")
      ) {
        return;
      }
      safeSetItem(AUDIFY_STORAGE_KEYS.wallpaperKind, wallpaperKind, {
        broadcast: false,
      });
      const clearBg = wallpaperKind === "none";
      if (clearBg) {
        safeSetItem(AUDIFY_STORAGE_KEYS.customBgImage, "", { broadcast: false });
      }

      const syncAutoHex = current.accentAuto
        ? wallpaperKind === "ascii_preset"
          ? getPresetAutoAccentHex(current.asciiPreset) ||
            getFallbackManualAccent()
          : wallpaperKind === "ascii_magic"
          ? current.asciiMagicSlug.trim().length > 0
            ? getCachedAsciiMagicAutoAccentHex(current.asciiMagicSlug)
            : getFallbackManualAccent()
          : wallpaperKind === "none"
          ? getFallbackManualAccent()
          : null
        : null;

      if (syncAutoHex) {
        bumpAutoAccentSeq();
        safeSetItem(AUDIFY_STORAGE_KEYS.accentColor, syncAutoHex, {
          broadcast: false,
        });
        applyThemeAndAccentToDom(current.themeMode, syncAutoHex);
        set((state) => ({
          wallpaperKind,
          ...(clearBg ? { customBgImage: "" } : {}),
          accentColor: syncAutoHex,
          accentAuto: true,
          activeProfile: state.activeProfile
            ? { ...state.activeProfile, color: syncAutoHex }
            : null,
          profiles: state.activeProfile
            ? state.profiles.map((p) =>
                p.id === state.activeProfile!.id ? { ...p, color: syncAutoHex } : p
              )
            : state.profiles,
        }));
        postCrossWindowSync("live-visual", {
          wallpaperKind,
          ...(clearBg ? { customBgImage: "" } : {}),
          accentColor: syncAutoHex,
          accentAuto: true,
        });
        releaseBackdropTransitionCaches(current.wallpaperKind, wallpaperKind);
        void get().persistActiveProfileSettings();
        return;
      }

      if (clearBg) {
        set({ wallpaperKind, customBgImage: "" });
        postCrossWindowSync("live-visual", {
          wallpaperKind,
          customBgImage: "",
        });
      } else {
        set({ wallpaperKind });
        postCrossWindowSync("live-visual", { wallpaperKind });
      }
      releaseBackdropTransitionCaches(current.wallpaperKind, wallpaperKind);
      if (current.accentAuto) {
        syncAutoAccentFromBackdrop();
      } else {
        void get().persistActiveProfileSettings();
      }
    },

    setAsciiPreset: (preset: AsciiPresetId) => {
      const asciiPreset = normalizeAsciiPreset(preset);
      const current = get();
      if (
        current.wallpaperKind === "ascii_preset" &&
        current.asciiPreset === asciiPreset
      ) {
        return;
      }
      safeSetItem(AUDIFY_STORAGE_KEYS.asciiPreset, asciiPreset, {
        broadcast: false,
      });
      safeSetItem(AUDIFY_STORAGE_KEYS.wallpaperKind, "ascii_preset", {
        broadcast: false,
      });

      if (current.accentAuto) {
        bumpAutoAccentSeq();
        const nextHex =
          getPresetAutoAccentHex(asciiPreset) || getFallbackManualAccent();
        safeSetItem(AUDIFY_STORAGE_KEYS.accentColor, nextHex, {
          broadcast: false,
        });
        applyThemeAndAccentToDom(current.themeMode, nextHex);
        set((state) => ({
          asciiPreset,
          wallpaperKind: "ascii_preset",
          accentColor: nextHex,
          accentAuto: true,
          activeProfile: state.activeProfile
            ? { ...state.activeProfile, color: nextHex }
            : null,
          profiles: state.activeProfile
            ? state.profiles.map((p) =>
                p.id === state.activeProfile!.id ? { ...p, color: nextHex } : p
              )
            : state.profiles,
        }));
        postCrossWindowSync("live-visual", {
          asciiPreset,
          wallpaperKind: "ascii_preset",
          accentColor: nextHex,
          accentAuto: true,
        });
        releaseBackdropTransitionCaches(current.wallpaperKind, "ascii_preset");
        void get().persistActiveProfileSettings();
        return;
      }

      set({ asciiPreset, wallpaperKind: "ascii_preset" });
      releaseBackdropTransitionCaches(current.wallpaperKind, "ascii_preset");
      postCrossWindowSync("live-visual", {
        asciiPreset,
        wallpaperKind: "ascii_preset",
      });
      void get().persistActiveProfileSettings();
    },

    setAsciiMagicSlug: (slug: string, activate = true) => {
      const asciiMagicSlug = normalizeAsciiMagicSlug(slug);
      const current = get();
      const clearing = asciiMagicSlug === "";
      if (!clearing && !activate) {
        if (current.asciiMagicSlug === asciiMagicSlug) return;
        safeSetItem(ASCII_MAGIC_SLUG_STORAGE_KEY, asciiMagicSlug, {
          broadcast: false,
        });
        set({ asciiMagicSlug });
        postCrossWindowSync("live-visual", { asciiMagicSlug });
        void get().persistActiveProfileSettings();
        return;
      }
      const nextKind: WallpaperKind = clearing
        ? current.wallpaperKind === "ascii_magic"
          ? "none"
          : current.wallpaperKind
        : "ascii_magic";
      if (
        current.asciiMagicSlug === asciiMagicSlug &&
        current.wallpaperKind === nextKind
      ) {
        return;
      }
      safeSetItem(ASCII_MAGIC_SLUG_STORAGE_KEY, asciiMagicSlug, {
        broadcast: false,
      });
      safeSetItem(AUDIFY_STORAGE_KEYS.wallpaperKind, nextKind, {
        broadcast: false,
      });
      set({ asciiMagicSlug, wallpaperKind: nextKind });
      releaseBackdropTransitionCaches(current.wallpaperKind, nextKind);
      postCrossWindowSync("live-visual", {
        asciiMagicSlug,
        wallpaperKind: nextKind,
      });
      if (current.accentAuto) {
        syncAutoAccentFromBackdrop();
      } else {
        void get().persistActiveProfileSettings();
      }
    },

    setAsciiMagicLook: (look: AsciiMagicLook) => {
      const asciiMagicLook = normalizeAsciiMagicLook(look);
      if (get().asciiMagicLook === asciiMagicLook) return;
      safeSetItem(ASCII_MAGIC_LOOK_STORAGE_KEY, asciiMagicLook, {
        broadcast: false,
      });
      set({ asciiMagicLook });
      postCrossWindowSync("live-visual", { asciiMagicLook });
      void get().persistActiveProfileSettings();
    },

    setAsciiMagicFit: (fit: AsciiMagicFit) => {
      const asciiMagicFit = normalizeAsciiMagicFit(fit);
      if (get().asciiMagicFit === asciiMagicFit) return;
      safeSetItem(ASCII_MAGIC_FIT_STORAGE_KEY, asciiMagicFit, {
        broadcast: false,
      });
      set({ asciiMagicFit });
      postCrossWindowSync("live-visual", { asciiMagicFit });
      void get().persistActiveProfileSettings();
    },

    setAsciiMotionSpeed: (speed: number) => {
      const asciiMotionSpeed = normalizeAsciiMotionSpeed(speed);
      safeSetItem(
        AUDIFY_STORAGE_KEYS.asciiMotionSpeed,
        String(asciiMotionSpeed),
        { broadcast: false }
      );
      set({ asciiMotionSpeed });
      postCrossWindowSync("live-visual", { asciiMotionSpeed });
      void get().persistActiveProfileSettings();
    },
  };
}
