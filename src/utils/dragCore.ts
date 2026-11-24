import { invoke } from "@tauri-apps/api/core";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import type { SampleItem } from "../types";
import { safeGetItem } from "./localStorageSafe";
import { folderNameFromPath } from "./pathHelpers";

/**
 * Starts `start()` only once the pointer has actually moved (default 5px) while the button is
 * still held. Prevents a plain click on a "drag" button from kicking off an OS drag-and-drop.
 */
export function beginDragOnMove(
  startX: number,
  startY: number,
  start: () => void,
  threshold = 5
) {
  const onMove = (e: MouseEvent) => {
    if ((e.buttons & 1) !== 1) {
      cleanup();
      return;
    }
    if (Math.hypot(e.clientX - startX, e.clientY - startY) >= threshold) {
      cleanup();
      start();
    }
  };
  const onUp = () => cleanup();
  const cleanup = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/**
 * Starts window dragging (`getCurrentWindow().startDragging()`) on the very first pixel (>= 1px)
 * of mouse movement after `mousedown` on a titlebar, or immediately if the held cursor crosses
 * outside the top/side edge of the frameless window (`mouseleave`), while keeping 0px clicks and
 * `onDoubleClick` maximize completely intact.
 */
export function beginWindowTitlebarDrag(
  startX: number,
  startY: number,
  start: () => void
) {
  const onMove = (ev: MouseEvent) => {
    if ((ev.buttons & 1) !== 1) {
      cleanup();
      return;
    }
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 1) {
      cleanup();
      start();
    }
  };

  const onLeave = (ev: MouseEvent) => {
    if ((ev.buttons & 1) !== 1) {
      cleanup();
      return;
    }
    cleanup();
    start();
  };

  const onUp = () => cleanup();

  const cleanup = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.documentElement.removeEventListener("mouseleave", onLeave);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  document.documentElement.addEventListener("mouseleave", onLeave);
}

let isNativeDragInFlight = false;
let isLeftMouseButtonHeld = false;
let activeOsDragPayload: {
  sample: SampleItem;
  single: boolean;
  origin: "list" | "deck-header";
} | null = null;

export function setActiveOsDragSample(
  sample: SampleItem | null,
  single = false,
  origin: "list" | "deck-header" = "list"
): void {
  activeOsDragPayload = sample ? { sample, single, origin } : null;
}

export function getActiveOsDragSample(): {
  sample: SampleItem;
  single: boolean;
  origin: "list" | "deck-header";
} | null {
  return activeOsDragPayload;
}

export function isOsDragCurrentlyInFlight(): boolean {
  return isNativeDragInFlight;
}

export function isLeftButtonHeldForDrag(): boolean {
  return isLeftMouseButtonHeld;
}

export function tryAcquireNativeDrag(): boolean {
  if (isNativeDragInFlight) return false;
  isNativeDragInFlight = true;
  return true;
}

export function releaseNativeDrag(): void {
  isNativeDragInFlight = false;
  isLeftMouseButtonHeld = false;
}

// Prevent WebView2 / Chromium from starting a competing HTML5 text/link DoDragDrop loop
// which intermittently blocks native Win32 CF_HDROP file drags into DaVinci Resolve / NLEs.
if (typeof window !== "undefined") {
  window.addEventListener(
    "dragstart",
    (e) => {
      e.preventDefault();
    },
    true
  );
  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button === 0) {
        isLeftMouseButtonHeld = true;
      }
    },
    true
  );
  window.addEventListener(
    "mouseup",
    (e) => {
      if (e.button === 0) {
        isLeftMouseButtonHeld = false;
      }
    },
    true
  );
  window.addEventListener("blur", () => {
    isLeftMouseButtonHeld = false;
  });
}

export function normalizeOsPath(filePath: string): string {
  const trimmed = filePath.trim().replace(/^\\\\\?\\/, "");
  const isWindows = trimmed.includes("\\") || /^[a-zA-Z]:/.test(trimmed);
  if (isWindows) {
    return trimmed.replace(/\//g, "\\");
  }
  return trimmed;
}

export function extractBaseName(filePath: string): string {
  return folderNameFromPath(filePath);
}

const MAX_BADGE_CACHE = 64;
const dragBadgePngCache = new Map<string, number[]>();

/**
 * Renders the dynamic rectangular studio drag badge (`[Layers icon] track_name.mp3`)
 * onto an offscreen canvas with a `(14px, 12px)` cursor offset so Win32 `SHDoDragDrop`
 * shows a crisp studio badge without obscuring the cursor hotspot on NLE timelines.
 */
export function renderDynamicDragBadgePng(label: string): number[] | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const cleanLabel = (label || "Audio Sample").trim();
    const displayLabel =
      cleanLabel.length > 36 ? `${cleanLabel.slice(0, 34)}...` : cleanLabel;

    let accentHex = "#F59E0B";
    try {
      const cssVar = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-hex")
        .trim();
      if (cssVar && cssVar.startsWith("#")) {
        accentHex = cssVar;
      } else {
        const stored = (safeGetItem(AUDIFY_STORAGE_KEYS.accentColor) || "").trim();
        if (stored.startsWith("#")) {
          accentHex = stored;
        }
      }
    } catch {
      // ignore
    }

    const cacheKey = `${accentHex}::${displayLabel}`;
    const cachedBytes = dragBadgePngCache.get(cacheKey);
    if (cachedBytes) {
      return cachedBytes;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const font = '600 11px "JetBrains Mono", Consolas, monospace';
    ctx.font = font;
    const textWidth = Math.ceil(ctx.measureText(displayLabel).width);

    const offsetX = 14;
    const offsetY = 12;
    const padX = 10;
    const iconSize = 12;
    const gap = 7;
    const badgeW = Math.min(280, Math.max(96, padX * 2 + iconSize + gap + textWidth));
    const badgeH = 26;

    canvas.width = offsetX + badgeW + 2;
    canvas.height = offsetY + badgeH + 2;

    ctx.font = font;
    ctx.textBaseline = "middle";

    const bx = offsetX;
    const by = offsetY;
    const r = 6;

    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + badgeW - r, by);
    ctx.quadraticCurveTo(bx + badgeW, by, bx + badgeW, by + r);
    ctx.lineTo(bx + badgeW, by + badgeH - r);
    ctx.quadraticCurveTo(bx + badgeW, by + badgeH, bx + badgeW - r, by + badgeH);
    ctx.lineTo(bx + r, by + badgeH);
    ctx.quadraticCurveTo(bx, by + badgeH, bx, by + badgeH - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();

    // Non-zero dark studio fill (#0e1722) so Win32 crColorKey (0x00000000) keeps it opaque
    ctx.fillStyle = "#0e1722";
    ctx.fill();

    ctx.lineWidth = 1.25;
    ctx.strokeStyle = accentHex;
    ctx.stroke();

    const ix = bx + padX;
    const iy = by + badgeH / 2;
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(ix + 6, iy - 5);
    ctx.lineTo(ix + 11.5, iy - 2);
    ctx.lineTo(ix + 6, iy + 1);
    ctx.lineTo(ix + 0.5, iy - 2);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ix + 0.5, iy + 1.2);
    ctx.lineTo(ix + 6, iy + 4.2);
    ctx.lineTo(ix + 11.5, iy + 1.2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ix + 0.5, iy + 4.2);
    ctx.lineTo(ix + 6, iy + 7.2);
    ctx.lineTo(ix + 11.5, iy + 4.2);
    ctx.stroke();

    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(displayLabel, ix + iconSize + gap, iy + 0.5);

    const dataUrl = canvas.toDataURL("image/png");
    const base64Idx = dataUrl.indexOf("base64,");
    if (base64Idx < 0) return undefined;
    const binStr = atob(dataUrl.slice(base64Idx + 7));
    const bytes = new Array<number>(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }

    if (dragBadgePngCache.size >= MAX_BADGE_CACHE) {
      const oldest = dragBadgePngCache.keys().next().value;
      if (oldest !== undefined) dragBadgePngCache.delete(oldest);
    }
    dragBadgePngCache.set(cacheKey, bytes);

    return bytes;
  } catch {
    return undefined;
  }
}

export async function startNativeSampleDrag(
  filePaths: string[],
  label?: string
): Promise<boolean> {
  if (!filePaths.length || !isLeftMouseButtonHeld || !tryAcquireNativeDrag()) {
    return false;
  }

  try {
    const normalizedItems = filePaths
      .filter((p) => Boolean(p && p.trim()))
      .map((p) => normalizeOsPath(p));
    if (!normalizedItems.length) return false;

    const resolvedLabel =
      label ||
      (normalizedItems.length > 1
        ? `${normalizedItems.length} samples selected`
        : extractBaseName(normalizedItems[0]));
    const iconPng = renderDynamicDragBadgePng(resolvedLabel);

    const droppedExternally = await invoke<boolean>("start_native_file_drag", {
      paths: normalizedItems,
      iconPng,
    });
    return Boolean(droppedExternally);
  } catch (err) {
    console.error("Native OS drag error:", err);
    return false;
  } finally {
    releaseNativeDrag();
  }
}
