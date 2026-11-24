import { listen } from "@tauri-apps/api/event";

let appFocused = true;
let edgePeekCollapsed = false;
let tauriListenerStarted = false;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const cb of subscribers) {
    cb();
  }
}

function ensureTauriFocusListener(): void {
  if (tauriListenerStarted || typeof window === "undefined") return;
  tauriListenerStarted = true;
  void listen<boolean>("audify:app-focus", (event) => {
    const next = event.payload !== false;
    if (next !== appFocused) {
      appFocused = next;
      notifySubscribers();
    }
  }).catch(() => {
    // Non-Tauri browser/test runtimes fall back cleanly to visibilitychange alone
  });
}

/**
 * Returns true whenever the viewport is actually visible on screen (not hidden/minimized
 * and not Edge-Peek collapsed), even if another app (e.g. NLE/DAW) holds OS focus.
 * Keeps Always-on-Top Mini Dock playhead smooth and prevents GIF wallpapers from blanking on blur,
 * while still dropping to 0% CPU/GPU when hidden or collapsed into the Edge-Peek pill.
 */
export function isViewportRenderActive(): boolean {
  if (
    typeof document !== "undefined" &&
    (document.hidden || document.visibilityState === "hidden")
  ) {
    return false;
  }
  return !edgePeekCollapsed;
}

/**
 * Returns true only when the page is visible, Mini Dock Edge-Peek is not collapsed,
 * AND Audify itself has OS focus (across either the main window or Settings).
 */
export function isAppWindowActive(): boolean {
  if (!isViewportRenderActive()) {
    return false;
  }
  return appFocused;
}

/** Test / runtime helper to update cached app-focus state directly. */
export function setAppFocusedState(focused: boolean): void {
  if (appFocused === focused) return;
  appFocused = focused;
  notifySubscribers();
}

/** Updates Edge-Peek collapsed state so animated backdrops & RAF loops pause at 0% GPU/CPU. */
export function setEdgePeekCollapsedState(collapsed: boolean): void {
  if (edgePeekCollapsed === collapsed) return;
  edgePeekCollapsed = collapsed;
  notifySubscribers();
}

/** Subscribes to both document visibility and Tauri app-focus changes. */
export function subscribeAppActivity(cb: () => void): () => void {
  subscribers.add(cb);
  ensureTauriFocusListener();

  const onVisibilityChange = () => {
    cb();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    subscribers.delete(cb);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}
