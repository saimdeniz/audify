import { invoke } from "@tauri-apps/api/core";
import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { SampleItem } from "../../types";
import {
  copyTextToClipboard,
  formatPathsForClipboard,
  resolveTargetSamples,
} from "../../utils/clipboard";
import {
  AUDIFY_STORAGE_KEYS,
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

export async function runPickCustomSliceExportPath(
  ctx: StoreSliceContext
): Promise<void> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Custom Slice Export Folder",
    });
    if (!selected || typeof selected !== "string") return;
    ctx.get().setCustomSliceExportPath(selected);
  } catch (err) {
    console.error("Failed to pick custom slice folder:", err);
  }
}

export async function runOpenSlicesFolder(
  ctx: StoreSliceContext
): Promise<void> {
  try {
    await invoke("open_slices_folder", {
      customDir: ctx.get().customSliceExportPath || null,
    });
  } catch (err) {
    console.error("Failed to open slices folder:", err);
    ctx.emitNotice(`Open slices folder failed: ${String(err)}`, "error");
  }
}

export async function runToggleMiniDock(ctx: StoreSliceContext): Promise<void> {
  const { set, get } = ctx;
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
      const workArea =
        monitor?.workArea ??
        (monitor
          ? { position: monitor.position, size: monitor.size }
          : null);
      const workLogicalW = workArea
        ? Math.round(workArea.size.width / initScale)
        : 1920;
      const workLogicalH = workArea
        ? Math.round(workArea.size.height / initScale)
        : 1040;

      let dockW = Math.max(460, Math.min(560, Math.round(workLogicalW * 0.265)));
      let dockH = Math.max(540, workLogicalH);
      const maxDockW = Math.max(440, Math.min(840, workLogicalW));
      const maxDockH = Math.max(500, workLogicalH);
      let savedDockX: number | null = null;
      let savedDockY: number | null = null;
      try {
        const raw = safeGetItem(AUDIFY_STORAGE_KEYS.miniDockBoundsV4);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            typeof parsed?.width === "number" &&
            parsed.width >= 440 &&
            parsed.width <= 840
          ) {
            dockW = Math.min(maxDockW, Math.round(parsed.width));
          }
          if (
            typeof parsed?.height === "number" &&
            parsed.height >= 500 &&
            parsed.height <= 2400
          ) {
            dockH = Math.min(maxDockH, Math.round(parsed.height));
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
      await appWindow
        .setMaxSize(new LogicalSize(maxDockW, maxDockH))
        .catch(() => {});
      await appWindow.setSize(new LogicalSize(dockW, dockH)).catch(() => {});

      if (workArea) {
        const scale = scaleFactor || monitor?.scaleFactor || 1;
        const workLeft = workArea.position.x;
        const workTop = workArea.position.y;
        const workRight = workLeft + workArea.size.width;
        const workBottom = workTop + workArea.size.height;
        const physDockW = Math.round(dockW * scale);

        const hasValidSavedPos =
          savedDockX !== null &&
          savedDockY !== null &&
          savedDockX >= workLeft - 20 &&
          savedDockX <= workRight - 100 &&
          savedDockY >= workTop - 10 &&
          savedDockY <= workBottom - 120;

        const physDockH = Math.round(dockH * scale);
        const targetX = hasValidSavedPos
          ? savedDockX!
          : Math.max(workLeft, workRight - physDockW);
        const rawTargetY = hasValidSavedPos ? savedDockY! : workTop;
        const targetY = Math.max(
          workTop,
          Math.min(rawTargetY, Math.max(workTop, workBottom - physDockH))
        );

        await appWindow
          .setPosition(new PhysicalPosition(targetX, targetY))
          .catch(() => {});
      }

      const shouldPin = get().isMiniDockPinned || get().miniDockEdgePeek;
      await appWindow.setAlwaysOnTop(shouldPin).catch(() => {});
      void syncSettingsWindowAlwaysOnTop(shouldPin);
      if (get().miniDockEdgePeek) {
        await invoke("mini_dock_set_edge_peek", {
          enabled: true,
          side: get().miniDockEdgeSide,
        }).catch(() => {});
      }
    } else {
      await invoke("mini_dock_set_edge_peek", {
        enabled: false,
        side: null,
      }).catch(() => {});

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
          if (logicalW >= 440 && logicalW <= 840) {
            safeSetItem(
              AUDIFY_STORAGE_KEYS.miniDockBoundsV4,
              JSON.stringify({
                width: logicalW,
                height: logicalH,
                x: outerPos.x,
                y: outerPos.y,
              }),
              { broadcast: false, markEdited: false }
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
      await appWindow.setMaxSize(null).catch(() => {});
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
}

export async function runSetMiniDockPinned(
  ctx: StoreSliceContext,
  isMiniDockPinned: boolean
): Promise<void> {
  safeSetItem(AUDIFY_STORAGE_KEYS.miniDockPinned, String(isMiniDockPinned), {
    broadcast: false,
    markEdited: false,
  });
  ctx.set({ isMiniDockPinned });
  if (ctx.get().isMiniDock) {
    try {
      await getCurrentWindow().setAlwaysOnTop(isMiniDockPinned);
      void syncSettingsWindowAlwaysOnTop(isMiniDockPinned);
    } catch (err) {
      console.error("Failed to toggle Always-on-Top:", err);
    }
  }
}

export async function runCopySamplePaths(
  ctx: StoreSliceContext,
  targetSamples?: SampleItem[]
): Promise<void> {
  const { allProfileSamples, samples, selectedSampleIds, selectedSample } =
    ctx.get();
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
    ctx.set({ statusMessage: msg });
    ctx.emitNotice(msg, "success");
  } else {
    ctx.emitNotice("Failed to copy file path to clipboard", "error");
  }
}
