import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import {
  ExportAudioPreset,
  ExportLoudnessMode,
  KeyboardShortcuts,
  MiniDockEdgeSide,
  WaveformSensitivity,
  WaveformStyle,
} from "../../types";
import { canonicalizeShortcut } from "../../utils/shortcuts";
import { AUDIFY_STORAGE_KEYS, safeSetItem } from "../storageHelpers";
import { SampleStoreState, StoreSliceContext } from "../types";
import { createAppearanceAndModalActions } from "./appearanceAndShortcutActions";
import { createBinAndMiniDockActions } from "./binAndMiniDockActions";
import { createLicenseActions } from "./licenseActions";

export interface SettingsSliceTimers {
  flushPendingTint: () => void;
  cancelPendingTint: () => void;
  clearToastTimers: () => void;
}

export function createSettingsAndBinSlice(
  ctx: StoreSliceContext,
  timersOut: SettingsSliceTimers
): Pick<
  SampleStoreState,
  | "setEnableLicensesSystem"
  | "addLicenseGroup"
  | "updateLicenseGroup"
  | "deleteLicenseGroup"
  | "pickFolderForLicenseGroup"
  | "setLicenseGroupFilter"
  | "copyAttributionForSamples"
  | "copySamplePaths"
  | "clearCreditToast"
  | "pauseCreditToast"
  | "resumeCreditToast"
  | "addSamplesToBin"
  | "removeSampleFromBin"
  | "removeSamplesFromBin"
  | "clearBin"
  | "setAutoBinOnNleDrag"
  | "setSidebarCollapsed"
  | "toggleSidebarCollapsed"
  | "setSidebarCompactHover"
  | "setBinFilterActive"
  | "setCustomSliceExportPath"
  | "pickCustomSliceExportPath"
  | "openSlicesFolder"
  | "setSettingsOpen"
  | "setThemeMode"
  | "setAccentColor"
  | "setAccentAuto"
  | "setWaveformSensitivity"
  | "setWaveformStyle"
  | "setPlayheadLatencyMs"
  | "setAudioOutputDeviceId"
  | "setSliceMicroFade"
  | "setExportAudioPreset"
  | "setExportLoudnessMode"
  | "setSkipLeadingSilence"
  | "setNormalizePreview"
  | "setAutoAnalyzeBpmKey"
  | "setEnableLiveFolderWatch"
  | "toggleMiniDock"
  | "setMiniDockPinned"
  | "setMiniDockEdgePeek"
  | "setMiniDockEdgeSide"
  | "setEnableMica"
  | "setThemeTintIntensity"
  | "setCustomBgImage"
  | "loadCustomBgGallery"
  | "openCustomBgFolder"
  | "deleteCustomBgImage"
  | "selectCustomBgImageFile"
  | "setCustomBgBlur"
  | "setCustomBgOpacity"
  | "setWallpaperKind"
  | "setAsciiPreset"
  | "setAsciiMagicSlug"
  | "setAsciiMagicLook"
  | "setAsciiMagicFit"
  | "setAsciiMotionSpeed"
  | "setShortcut"
  | "resetShortcuts"
  | "setStatusMessage"
  | "showStatusNotice"
> {
  const { set, get, emitNotice } = ctx;

  const licenseActions = createLicenseActions(ctx, (clearFn) => {
    timersOut.clearToastTimers = clearFn;
  });
  const binAndMiniDockActions = createBinAndMiniDockActions(ctx);
  const appearanceActions = createAppearanceAndModalActions(ctx, (t) => {
    timersOut.flushPendingTint = t.flushPendingTint;
    timersOut.cancelPendingTint = t.cancelPendingTint;
  });

  return {
    ...licenseActions,
    ...binAndMiniDockActions,
    ...appearanceActions,

    setWaveformSensitivity: (waveformSensitivity: WaveformSensitivity) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.waveformSensitivity, waveformSensitivity);
      set({ waveformSensitivity });
      void get().persistActiveProfileSettings();
    },

    setPlayheadLatencyMs: (ms: number | null) => {
      const clamped = ms === null ? null : Math.max(-100, Math.min(500, ms));
      safeSetItem(
        AUDIFY_STORAGE_KEYS.playheadLatencyMs,
        clamped === null ? "auto" : String(clamped)
      );
      set({ playheadLatencyMs: clamped });
      void get().persistActiveProfileSettings();
    },

    setWaveformStyle: (waveformStyle: WaveformStyle) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.waveformStyle, waveformStyle);
      set({ waveformStyle });
      void get().persistActiveProfileSettings();
    },

    setAudioOutputDeviceId: (audioOutputDeviceId: string) => {
      const clean = audioOutputDeviceId || "default";
      safeSetItem(AUDIFY_STORAGE_KEYS.audioOutputDeviceId, clean);
      set({ audioOutputDeviceId: clean });
      void get().persistActiveProfileSettings();
    },

    setSliceMicroFade: (sliceMicroFade: boolean) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.sliceMicroFade, String(sliceMicroFade));
      set({
        sliceMicroFade,
        statusMessage: sliceMicroFade
          ? "Slice 3ms anti-click micro-fade enabled"
          : "Slice 3ms anti-click micro-fade disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setExportAudioPreset: (exportAudioPreset: ExportAudioPreset) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.exportAudioPreset, exportAudioPreset);
      const label =
        exportAudioPreset === "nle_48k_24"
          ? "48 kHz / 24-bit Broadcast WAV (NLE)"
          : exportAudioPreset === "wav_24"
          ? "24-bit Lossless WAV (source sample rate)"
          : "Keep Source (preserves 24-bit on hi-res files)";
      set({
        exportAudioPreset,
        statusMessage: `Slice & pitch export format: ${label}`,
      });
      void get().persistActiveProfileSettings();
    },

    setExportLoudnessMode: (exportLoudnessMode: ExportLoudnessMode) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.exportLoudnessMode, exportLoudnessMode);
      const label =
        exportLoudnessMode === "peak_m1"
          ? "Peak -1 dBTP"
          : exportLoudnessMode === "lufs_m14"
          ? "-14 LUFS (Streaming)"
          : exportLoudnessMode === "lufs_m24"
          ? "-24 LUFS (Broadcast)"
          : "Off (original level)";
      set({
        exportLoudnessMode,
        statusMessage: `Export loudness normalization: ${label}`,
      });
      void get().persistActiveProfileSettings();
    },

    setSkipLeadingSilence: (skipLeadingSilence: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.skipLeadingSilence,
        String(skipLeadingSilence)
      );
      set({
        skipLeadingSilence,
        statusMessage: skipLeadingSilence
          ? "Skip leading silence on preview enabled"
          : "Skip leading silence on preview disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setMiniDockEdgePeek: (miniDockEdgePeek: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.miniDockEdgePeek,
        String(miniDockEdgePeek)
      );
      set({
        miniDockEdgePeek,
        statusMessage: miniDockEdgePeek
          ? "Mini Dock Edge-Peek auto-hide enabled"
          : "Mini Dock Edge-Peek auto-hide disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setMiniDockEdgeSide: (miniDockEdgeSide: MiniDockEdgeSide) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.miniDockEdgeSide, miniDockEdgeSide);
      set({ miniDockEdgeSide });
      void get().persistActiveProfileSettings();
    },

    setNormalizePreview: (normalizePreview: boolean) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.normalizePreview, String(normalizePreview));
      set({
        normalizePreview,
        statusMessage: normalizePreview
          ? "Preview loudness normalization (Auto-Gain) enabled"
          : "Preview loudness normalization (Auto-Gain) disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setAutoAnalyzeBpmKey: (autoAnalyzeBpmKey: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.autoAnalyzeBpmKey,
        String(autoAnalyzeBpmKey)
      );
      set({
        autoAnalyzeBpmKey,
        statusMessage: autoAnalyzeBpmKey
          ? "Auto BPM & Key detection on new scans enabled"
          : "Auto BPM & Key detection on new scans disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setEnableLiveFolderWatch: (enableLiveFolderWatch: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.enableLiveFolderWatch,
        String(enableLiveFolderWatch)
      );
      set({
        enableLiveFolderWatch,
        statusMessage: enableLiveFolderWatch
          ? "Live folder watcher enabled"
          : "Live folder watcher paused",
      });
      void get().persistActiveProfileSettings();
    },

    setShortcut: (action: keyof KeyboardShortcuts, key: string) => {
      if (key === "") {
        const updated = { ...get().shortcuts, [action]: "" };
        safeSetItem(AUDIFY_STORAGE_KEYS.shortcuts, JSON.stringify(updated));
        set({
          shortcuts: updated,
          statusMessage: `Cleared shortcut for ${action}`,
        });
        void get().persistActiveProfileSettings();
        return;
      }
      const targetNorm = canonicalizeShortcut(key);
      if (!targetNorm) {
        emitNotice("Invalid shortcut key", "error");
        return;
      }
      const label = key === " " ? "SPACE" : key.toUpperCase();
      if (
        targetNorm === "tab" ||
        targetNorm === "arrowup" ||
        targetNorm === "arrowdown" ||
        /^[1-9]$/.test(targetNorm) ||
        targetNorm === "ctrl+," ||
        targetNorm === "ctrl+z" ||
        targetNorm === "ctrl+y" ||
        targetNorm === "ctrl+shift+z" ||
        targetNorm === "ctrl+shift+c" ||
        targetNorm === "ctrl+a" ||
        targetNorm === "f2"
      ) {
        emitNotice(
          `Key "${label}" is reserved by studio navigation / global shortcuts`,
          "error"
        );
        return;
      }
      const current = get().shortcuts;
      const conflictEntry = (
        Object.entries(current) as [keyof KeyboardShortcuts, string][]
      ).find(
        ([k, v]) => k !== action && v && canonicalizeShortcut(v) === targetNorm
      );
      if (conflictEntry) {
        emitNotice(
          `Key "${label}" is already assigned to another shortcut`,
          "error"
        );
        return;
      }
      const updated = { ...current, [action]: key };
      safeSetItem(AUDIFY_STORAGE_KEYS.shortcuts, JSON.stringify(updated));
      set({
        shortcuts: updated,
        statusMessage: `Updated shortcut for ${action}`,
      });
      void get().persistActiveProfileSettings();
    },

    resetShortcuts: () => {
      const defaults = { ...DEFAULT_SHORTCUTS };
      safeSetItem(AUDIFY_STORAGE_KEYS.shortcuts, JSON.stringify(defaults));
      set({ shortcuts: defaults, statusMessage: "Reset shortcuts to defaults" });
      void get().persistActiveProfileSettings();
    },

    setStatusMessage: (statusMessage: string | null) => set({ statusMessage }),

    showStatusNotice: (
      message: string,
      kind: "info" | "success" | "error" = "info",
      action?: import("../storePayloads").StatusNoticeAction
    ) => emitNotice(message, kind, action),
  };
}
