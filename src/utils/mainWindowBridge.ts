import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  APPLY_MAIN_FILTER_EVENT,
  isStandaloneSettingsWindow,
  type MainFilterRequest,
} from "./windowContext";

export { APPLY_MAIN_FILTER_EVENT, type MainFilterRequest };

export interface ApplyFilterInMainOptions {
  applyLocally: (req: MainFilterRequest) => void;
  notify?: (message: string, kind?: "info" | "success" | "error") => void;
}

function describeFilterRequest(req: MainFilterRequest): string {
  switch (req.kind) {
    case "trash":
      return "Showing Trash in main window";
    case "duplicates":
      return "Opened Duplicate Finder in main window";
    case "genre":
      return `Filtered "${req.name}" in main window`;
    case "search": {
      const text = req.label ?? req.query;
      return text ? `Filtered "${text}" in main window` : "Filtered in main window";
    }
    case "collection":
    case "tag":
    case "license":
      return req.label
        ? `Filtered "${req.label}" in main window`
        : "Filtered in main window";
  }
}

/**
 * Brings the main window to foreground without closing the caller window.
 * If the caller window (Settings) is pinned always-on-top while main is not,
 * drops always-on-top on Settings so main can focus cleanly in front.
 */
export async function focusMainWindow(): Promise<boolean> {
  try {
    const mainWin = await WebviewWindow.getByLabel("main");
    if (!mainWin) return false;

    try {
      const selfWin = getCurrentWindow();
      const [selfPinned, mainPinned] = await Promise.all([
        selfWin.isAlwaysOnTop().catch(() => false),
        mainWin.isAlwaysOnTop().catch(() => false),
      ]);
      if (selfPinned && !mainPinned) {
        await selfWin.setAlwaysOnTop(false).catch(() => {});
      }
    } catch {
      // Ignore always-on-top query errors
    }

    try {
      if (await mainWin.isMinimized()) {
        await mainWin.unminimize();
      }
    } catch {
      await mainWin.unminimize().catch(() => {});
    }

    await mainWin.show().catch(() => {});
    await mainWin.setFocus().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends a non-toggling filter request from Settings to the Main window (or
 * applies it directly in browser / single-window fallback) while keeping Settings open.
 */
export async function applyFilterInMainWindow(
  req: MainFilterRequest,
  opts: ApplyFilterInMainOptions
): Promise<boolean> {
  const notice = describeFilterRequest(req);
  if (isStandaloneSettingsWindow()) {
    try {
      await emitTo("main", APPLY_MAIN_FILTER_EVENT, req);
      await focusMainWindow();
      opts.notify?.(notice, "info");
      return true;
    } catch {
      opts.notify?.("Could not send filter to main window", "error");
      return false;
    }
  }

  opts.applyLocally(req);
  opts.notify?.(notice, "info");
  return true;
}
