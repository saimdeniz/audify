import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ThemeMode } from "../../types";
import {
  getCachedAsciiMagicAutoAccentHex,
  getPresetAutoAccentHex,
} from "../../utils/autoAccentCache";
import {
  AUDIFY_STORAGE_KEYS,
  isStandaloneSettingsWindow,
  markLocalKeyEdited,
  normalizeSettingsTab,
  postCrossWindowSync,
  safeGetItem,
  safeSetItem,
  SETTINGS_TAB_STORAGE_KEY,
} from "../storageHelpers";
import { applyThemeAndAccentToDom, applyVisualEffectsToDom } from "../themeDom";
import type { SettingsTab, StoreSliceContext } from "../types";
import { createBackdropWallpaperActions } from "./backdropWallpaperActions";

export function createAppearanceAndModalActions(
  ctx: StoreSliceContext,
  registerTintTimers: (timers: {
    flushPendingTint: () => void;
    cancelPendingTint: () => void;
  }) => void
) {
  const { set, get } = ctx;
  let tintPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let liveVisualRafId: number | null = null;
  let pendingLiveVisualPatch: Record<string, unknown> | null = null;
  let autoAccentSeq = 0;

  const flushPendingLiveVisualSync = () => {
    if (liveVisualRafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(liveVisualRafId);
    }
    liveVisualRafId = null;
    if (pendingLiveVisualPatch) {
      const patch = pendingLiveVisualPatch;
      pendingLiveVisualPatch = null;
      postCrossWindowSync("live-visual", patch);
    }
  };

  const queueLiveVisualSync = (patch: Record<string, unknown>) => {
    pendingLiveVisualPatch = pendingLiveVisualPatch
      ? { ...pendingLiveVisualPatch, ...patch }
      : { ...patch };
    if (typeof requestAnimationFrame !== "function") {
      flushPendingLiveVisualSync();
      return;
    }
    if (liveVisualRafId !== null) return;
    liveVisualRafId = requestAnimationFrame(() => {
      liveVisualRafId = null;
      if (pendingLiveVisualPatch) {
        const nextPatch = pendingLiveVisualPatch;
        pendingLiveVisualPatch = null;
        postCrossWindowSync("live-visual", nextPatch);
      }
    });
  };

  const persistSliderVisualValuesToStorage = () => {
    const live = get();
    safeSetItem(
      AUDIFY_STORAGE_KEYS.themeTintIntensity,
      String(live.themeTintIntensity),
      { broadcast: false }
    );
    safeSetItem(
      AUDIFY_STORAGE_KEYS.customBgBlur,
      String(live.customBgBlur),
      { broadcast: false }
    );
    safeSetItem(
      AUDIFY_STORAGE_KEYS.customBgOpacity,
      String(live.customBgOpacity),
      { broadcast: false }
    );
  };

  const flushPendingVisualPersistence = () => {
    flushPendingLiveVisualSync();
    if (tintPersistTimer !== null) {
      clearTimeout(tintPersistTimer);
      tintPersistTimer = null;
      persistSliderVisualValuesToStorage();
      void get().persistActiveProfileSettings(true);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushPendingVisualPersistence);
  }

  registerTintTimers({
    flushPendingTint: flushPendingVisualPersistence,
    cancelPendingTint: () => {
      if (liveVisualRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(liveVisualRafId);
      }
      liveVisualRafId = null;
      pendingLiveVisualPatch = null;
      if (tintPersistTimer !== null) {
        clearTimeout(tintPersistTimer);
        tintPersistTimer = null;
      }
    },
  });

  const scheduleVisualPersist = () => {
    if (tintPersistTimer) clearTimeout(tintPersistTimer);
    tintPersistTimer = setTimeout(() => {
      tintPersistTimer = null;
      persistSliderVisualValuesToStorage();
      void get().persistActiveProfileSettings();
    }, 150);
  };

  const applyEffectiveAccent = (hex: string, autoMode: boolean) => {
    safeSetItem(AUDIFY_STORAGE_KEYS.accentColor, hex, { broadcast: false });
    applyThemeAndAccentToDom(get().themeMode, hex);
    set((state) => ({
      accentColor: hex,
      accentAuto: autoMode,
      activeProfile: state.activeProfile
        ? { ...state.activeProfile, color: hex }
        : null,
      profiles: state.activeProfile
        ? state.profiles.map((p) =>
            p.id === state.activeProfile!.id ? { ...p, color: hex } : p
          )
        : state.profiles,
    }));
    postCrossWindowSync("live-visual", {
      accentColor: hex,
      accentAuto: autoMode,
    });
  };

  const getFallbackManualAccent = (): string =>
    safeGetItem(AUDIFY_STORAGE_KEYS.manualAccentColor) ||
    get().accentColor ||
    "#F59E0B";

  const applyAutoAccentOrFallback = (resolvedHex: string | null) => {
    applyEffectiveAccent(resolvedHex || getFallbackManualAccent(), true);
    void get().persistActiveProfileSettings();
  };

  const syncAutoAccentFromBackdrop = () => {
    const seq = ++autoAccentSeq;
    const {
      wallpaperKind,
      asciiPreset,
      asciiMagicSlug,
      customBgImage,
      accentAuto,
    } = get();
    if (!accentAuto) return;

    if (wallpaperKind === "ascii_preset") {
      applyAutoAccentOrFallback(getPresetAutoAccentHex(asciiPreset));
      return;
    }

    if (wallpaperKind === "ascii_magic" && asciiMagicSlug.trim().length > 0) {
      const targetSlug = asciiMagicSlug;
      const cached = getCachedAsciiMagicAutoAccentHex(targetSlug);
      if (cached) {
        applyAutoAccentOrFallback(cached);
        return;
      }
      void import("../../utils/autoAccent")
        .then((mod) => mod.extractDominantAsciiMagicAccent(targetSlug))
        .then((extracted) => {
        if (
          seq !== autoAccentSeq ||
          !get().accentAuto ||
          get().wallpaperKind !== "ascii_magic" ||
          get().asciiMagicSlug !== targetSlug
        ) {
          return;
        }
        applyAutoAccentOrFallback(extracted);
      });
      return;
    }

    if (wallpaperKind === "image" && customBgImage.trim().length > 0) {
      const targetImage = customBgImage;
      void import("../../utils/autoAccent")
        .then((mod) => mod.extractDominantImageAccent(targetImage))
        .then((extracted) => {
        if (
          seq !== autoAccentSeq ||
          !get().accentAuto ||
          get().wallpaperKind !== "image" ||
          get().customBgImage !== targetImage
        ) {
          return;
        }
        if (extracted) {
          applyAutoAccentOrFallback(extracted);
        }
      });
      return;
    }

    applyAutoAccentOrFallback(null);
  };

  const backdropActions = createBackdropWallpaperActions(ctx, {
    bumpAutoAccentSeq: () => {
      autoAccentSeq++;
    },
    getFallbackManualAccent,
    syncAutoAccentFromBackdrop,
    scheduleVisualPersist,
    queueLiveVisualSync,
  });

  return {
    setSettingsOpen: (isSettingsOpen: boolean, tab?: SettingsTab) => {
      if (isStandaloneSettingsWindow()) {
        if (!isSettingsOpen) {
          void getCurrentWindow()
            .close()
            .catch(() => {});
          return;
        }
        const nextTab = tab ? normalizeSettingsTab(tab) : get().settingsTab;
        if (tab) {
          safeSetItem(SETTINGS_TAB_STORAGE_KEY, nextTab);
        }
        set({ isSettingsOpen: true, settingsTab: nextTab });
        return;
      }

      if (isSettingsOpen) {
        const persistedTabRaw = safeGetItem(SETTINGS_TAB_STORAGE_KEY);
        const targetTab = tab
          ? normalizeSettingsTab(tab)
          : persistedTabRaw
            ? normalizeSettingsTab(persistedTabRaw)
            : normalizeSettingsTab(get().settingsTab);
        safeSetItem(SETTINGS_TAB_STORAGE_KEY, targetTab);
        set({ isSettingsOpen: false, settingsTab: targetTab });
        void invoke("open_settings_window", {
          tab: targetTab,
          alwaysOnTop: get().isMiniDock && get().isMiniDockPinned,
          theme: get().themeMode,
        }).catch(() => {
          // Fallback to in-app modal when running in non-Tauri browser preview
          set({ isSettingsOpen: true, settingsTab: targetTab });
        });
        return;
      }

      set((state) => ({
        isSettingsOpen: false,
        settingsTab: tab ? normalizeSettingsTab(tab) : state.settingsTab,
      }));
    },

    setThemeMode: (themeMode: ThemeMode) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.themeMode, themeMode, {
        broadcast: false,
      });
      applyThemeAndAccentToDom(themeMode, get().accentColor);
      set({ themeMode });
      postCrossWindowSync("live-visual", { themeMode });
      void get().persistActiveProfileSettings();
    },

    setAccentColor: (accentColor: string) => {
      autoAccentSeq++;
      safeSetItem(AUDIFY_STORAGE_KEYS.manualAccentColor, accentColor, {
        broadcast: false,
      });
      safeSetItem(AUDIFY_STORAGE_KEYS.accentAuto, "false", { broadcast: false });
      applyEffectiveAccent(accentColor, false);
      void get().persistActiveProfileSettings();
    },

    setAccentAuto: (accentAuto: boolean) => {
      const enabled = Boolean(accentAuto);
      if (enabled && !safeGetItem(AUDIFY_STORAGE_KEYS.manualAccentColor)) {
        safeSetItem(AUDIFY_STORAGE_KEYS.manualAccentColor, get().accentColor, {
          broadcast: false,
        });
      }
      safeSetItem(AUDIFY_STORAGE_KEYS.accentAuto, String(enabled), {
        broadcast: false,
      });

      if (!enabled) {
        autoAccentSeq++;
        applyEffectiveAccent(getFallbackManualAccent(), false);
        void get().persistActiveProfileSettings();
        return;
      }

      set({ accentAuto: true });
      postCrossWindowSync("live-visual", { accentAuto: true });
      syncAutoAccentFromBackdrop();
    },

    setEnableMica: (enableMica: boolean) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.enableMica, String(enableMica), {
        broadcast: false,
      });
      applyVisualEffectsToDom(enableMica, get().themeTintIntensity);
      set({ enableMica });
      postCrossWindowSync("live-visual", {
        enableMica,
        themeTintIntensity: get().themeTintIntensity,
      });
      scheduleVisualPersist();
    },

    setThemeTintIntensity: (themeTintIntensity: number) => {
      const clamped = Math.max(
        0,
        Math.min(1, Number(themeTintIntensity.toFixed(2)))
      );
      if (get().themeTintIntensity === clamped) return;
      // Mark locally edited synchronously to block remote echoes while deferring
      // localStorage writes until drag settles (eliminates cross-window `storage` storms).
      markLocalKeyEdited(AUDIFY_STORAGE_KEYS.themeTintIntensity);
      applyVisualEffectsToDom(get().enableMica, clamped);
      set({ themeTintIntensity: clamped });
      queueLiveVisualSync({
        enableMica: get().enableMica,
        themeTintIntensity: clamped,
      });
      scheduleVisualPersist();
    },

    ...backdropActions,
  };
}
