import { invoke } from "@tauri-apps/api/core";
import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { SampleItem } from "../../types";
import {
  copyTextToClipboard,
  formatPathsForClipboard,
  resolveTargetSamples,
} from "../../utils/clipboard";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeGetItem,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

let miniDockTransitionInFlight = false;
let savedNormalWindowBounds: {
  x: number;
  y: number;
  width: number;
  height: number;
  wasMaximized: boolean;
} | null = null;

async function syncSettingsWindowAlwaysOnTop(pinned: boolean): Promise<void> {
  try {
    const settingsWin = await WebviewWindow.getByLabel("settings");
    if (settingsWin) {
      await settingsWin.setAlwaysOnTop(pinned);
    }
  } catch {
    // Ignore when running outside Tauri or window does not exist
  }
}

export function createBinAndMiniDockActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  return {
    addSamplesToBin: (sampleIds: number[]) => {
      const validIds = (sampleIds || []).filter(
        (id) => Number.isSafeInteger(id) && id > 0
      );
      if (validIds.length === 0) return;
      const current = get().binSampleIds;
      const existingSet = new Set(current);
      const added: number[] = [];
      for (const id of validIds) {
        if (!existingSet.has(id)) {
          existingSet.add(id);
          added.push(id);
        }
      }
      if (added.length === 0) {
        set({
          statusMessage:
            validIds.length === 1
              ? "Track is already in Session Bin"
              : "Selected tracks are already in Session Bin",
        });
        return;
      }
      const next = [...current, ...added];
      safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(next));
      set({
        binSampleIds: next,
        statusMessage: `Added ${added.length} track(s) to Session Bin (${next.length} in Bin)`,
      });
      if (get().binFilterActive) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      }
      void get().persistActiveProfileSettings();
    },

    removeSampleFromBin: (sampleId: number) => {
      const next = get().binSampleIds.filter((id) => id !== sampleId);
      safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(next));
      const shouldDisableFilter = next.length === 0 && get().binFilterActive;
      set({
        binSampleIds: next,
        ...(shouldDisableFilter ? { binFilterActive: false } : {}),
        statusMessage: `Removed track from Session Bin (${next.length} remaining)`,
      });
      if (get().binFilterActive || shouldDisableFilter) {
        if (
          !applyInstantMemoryFilter({
            preserveMultiSelect: !shouldDisableFilter,
          })
        ) {
          void get().fetchSamples({
            preserveMultiSelect: !shouldDisableFilter,
          });
        }
      }
      void get().persistActiveProfileSettings();
    },

    clearBin: () => {
      const wasFiltering = get().binFilterActive;
      safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify([]));
      set({
        binSampleIds: [],
        binFilterActive: false,
        statusMessage: "Cleared Session Bin",
      });
      if (wasFiltering) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }
      void get().persistActiveProfileSettings();
    },

    setAutoBinOnNleDrag: (autoBinOnNleDrag: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.autoBinOnNleDrag,
        String(autoBinOnNleDrag)
      );
      set({
        autoBinOnNleDrag,
        statusMessage: autoBinOnNleDrag
          ? "Auto-Add to Session Bin on NLE drag enabled"
          : "Auto-Add to Session Bin on NLE drag disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setBinFilterActive: (binFilterActive: boolean) => {
      if (binFilterActive) {
        persistNavigationFilters(null, null, false, null);
      }
      set({
        binFilterActive,
        ...(binFilterActive
          ? {
              folderFilter: null,
              selectedLicenseGroupId: null,
              favoriteOnly: false,
              recentOnly: false,
              trashFilterActive: false,
              duplicatesFilterActive: false,
              slicesFilterActive: false,
              selectedCollectionId: null,
            }
          : {}),
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setCustomSliceExportPath: (customSliceExportPath: string) => {
      const clean = customSliceExportPath.trim();
      safeSetItem(AUDIFY_STORAGE_KEYS.customSliceExportPath, clean);
      set({
        customSliceExportPath: clean,
        statusMessage: clean
          ? `Set custom slice export folder: ${clean}`
          : "Reset slice export folder to default (user/slices)",
      });
      void get().persistActiveProfileSettings();
    },

    pickCustomSliceExportPath: async () => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Custom Slice Export Folder",
        });
        if (!selected || typeof selected !== "string") return;
        get().setCustomSliceExportPath(selected);
      } catch (err) {
        console.error("Failed to pick custom slice folder:", err);
      }
    },

    openSlicesFolder: async () => {
      try {
        await invoke("open_slices_folder", {
          customDir: get().customSliceExportPath || null,
        });
      } catch (err) {
        console.error("Failed to open slices folder:", err);
        emitNotice(`Open slices folder failed: ${String(err)}`, "error");
      }
    },

    toggleMiniDock: async () => {
      if (miniDockTransitionInFlight) return;
      miniDockTransitionInFlight = true;
      try {
        const appWindow = getCurrentWindow();
        const currentlyMini = get().isMiniDock;

        if (!currentlyMini) {
          const [wasMaximized, outerPos, outerSize, monitor, scaleFactor] =
            await Promise.all([
              appWindow.isMaximized().catch(() => false),
              appWindow.outerPosition().catch(() => null),
              appWindow.outerSize().catch(() => null),
              currentMonitor().catch(() => null),
              appWindow.scaleFactor().catch(() => 1),
            ]);

          if (outerPos && outerSize) {
            savedNormalWindowBounds = {
              x: outerPos.x,
              y: outerPos.y,
              width: outerSize.width,
              height: outerSize.height,
              wasMaximized,
            };
          }

          const initScale = scaleFactor || monitor?.scaleFactor || 1;
          const monLogicalW = monitor
            ? Math.round(monitor.size.width / initScale)
            : 1920;
          const monLogicalH = monitor
            ? Math.round(monitor.size.height / initScale)
            : 1080;

          let dockW = Math.max(480, Math.min(580, Math.round(monLogicalW * 0.27)));
          let dockH = Math.max(700, Math.min(960, Math.round(monLogicalH * 0.82)));
          let savedDockX: number | null = null;
          let savedDockY: number | null = null;
          try {
            const raw = safeGetItem(AUDIFY_STORAGE_KEYS.miniDockBoundsV3);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (
                typeof parsed?.width === "number" &&
                parsed.width >= 440 &&
                parsed.width <= 780
              ) {
                dockW = Math.round(parsed.width);
              }
              if (
                typeof parsed?.height === "number" &&
                parsed.height >= 500 &&
                parsed.height <= 1200
              ) {
                dockH = Math.round(parsed.height);
              }
              if (
                typeof parsed?.x === "number" &&
                Number.isFinite(parsed.x) &&
                typeof parsed?.y === "number" &&
                Number.isFinite(parsed.y)
              ) {
                savedDockX = Math.round(parsed.x);
                savedDockY = Math.round(parsed.y);
              }
            }
          } catch {
            // ignore storage parse error
          }

          set({ isMiniDock: true, isSettingsOpen: false });

          if (wasMaximized) {
            await appWindow.unmaximize().catch(() => {});
          }
          await appWindow.setMaximizable(false).catch(() => {});
          await appWindow.setMinSize(new LogicalSize(440, 500)).catch(() => {});
          await appWindow.setSize(new LogicalSize(dockW, dockH)).catch(() => {});

          if (monitor) {
            const scale = scaleFactor || monitor.scaleFactor || 1;
            const monLeft = monitor.position.x;
            const monTop = monitor.position.y;
            const monRight = monLeft + monitor.size.width;
            const monBottom = monTop + monitor.size.height;
            const physDockW = Math.round(dockW * scale);

            const hasValidSavedPos =
              savedDockX !== null &&
              savedDockY !== null &&
              savedDockX >= monLeft - 20 &&
              savedDockX <= monRight - 100 &&
              savedDockY >= monTop - 10 &&
              savedDockY <= monBottom - 120;

            const targetX = hasValidSavedPos
              ? savedDockX!
              : Math.max(monLeft + 16, monRight - physDockW - Math.round(24 * scale));
            const targetY = hasValidSavedPos
              ? savedDockY!
              : monTop + Math.round(48 * scale);

            await appWindow
              .setPosition(new PhysicalPosition(targetX, targetY))
              .catch(() => {});
          }

          await appWindow.setAlwaysOnTop(get().isMiniDockPinned).catch(() => {});
          void syncSettingsWindowAlwaysOnTop(get().isMiniDockPinned);
        } else {
          // Persist user's Mini Dock size & position before restoring full studio
          try {
            const [isMaxNow, innerSize, outerPos, scale] = await Promise.all([
              appWindow.isMaximized().catch(() => false),
              appWindow.innerSize().catch(() => null),
              appWindow.outerPosition().catch(() => null),
              appWindow.scaleFactor().catch(() => 1),
            ]);
            if (!isMaxNow && innerSize && outerPos && scale > 0) {
              const logicalW = Math.round(innerSize.width / scale);
              const logicalH = Math.round(innerSize.height / scale);
              if (logicalW >= 440 && logicalW <= 780) {
                safeSetItem(
                  AUDIFY_STORAGE_KEYS.miniDockBoundsV3,
                  JSON.stringify({
                    width: logicalW,
                    height: logicalH,
                    x: outerPos.x,
                    y: outerPos.y,
                  })
                );
              }
            }
          } catch {
            // ignore
          }

          await appWindow.setAlwaysOnTop(false).catch(() => {});
          void syncSettingsWindowAlwaysOnTop(false);
          await appWindow.setMaximizable(true).catch(() => {});
          await appWindow.unmaximize().catch(() => {});
          await appWindow.setMinSize(new LogicalSize(1024, 640)).catch(() => {});

          const restore = savedNormalWindowBounds;
          if (restore) {
            await appWindow
              .setSize(new PhysicalSize(restore.width, restore.height))
              .catch(() => {});
            await appWindow
              .setPosition(new PhysicalPosition(restore.x, restore.y))
              .catch(() => {});
            if (restore.wasMaximized) {
              await appWindow.maximize().catch(() => {});
            }
          } else {
            await appWindow.setSize(new LogicalSize(1440, 900)).catch(() => {});
          }

          set({ isMiniDock: false });
        }
      } catch (err) {
        console.error("Failed to toggle Mini Dock:", err);
      } finally {
        miniDockTransitionInFlight = false;
      }
    },

    setMiniDockPinned: async (isMiniDockPinned: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.miniDockPinned,
        String(isMiniDockPinned)
      );
      set({ isMiniDockPinned });
      if (get().isMiniDock) {
        try {
          await getCurrentWindow().setAlwaysOnTop(isMiniDockPinned);
          void syncSettingsWindowAlwaysOnTop(isMiniDockPinned);
        } catch (err) {
          console.error("Failed to toggle Always-on-Top:", err);
        }
      }
    },

    copySamplePaths: async (targetSamples?: SampleItem[]) => {
      const {
        allProfileSamples,
        samples,
        selectedSampleIds,
        selectedSample,
      } = get();
      const list = resolveTargetSamples(
        allProfileSamples,
        samples,
        selectedSampleIds,
        selectedSample,
        targetSamples
      );
      if (list.length === 0) return;

      const text = formatPathsForClipboard(list.map((s) => s.file_path));
      if (!text) return;

      const copied = await copyTextToClipboard(text);
      if (copied) {
        const lineCount = text.split("\n").length;
        const msg =
          lineCount === 1
            ? `Copied file path: ${text}`
            : `Copied ${lineCount} file paths to clipboard`;
        set({ statusMessage: msg });
        emitNotice(msg, "success");
      } else {
        emitNotice("Failed to copy file path to clipboard", "error");
      }
    },
  };
}
