import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let currentDpr: number =
  typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
let stopObserving: (() => void) | null = null;

function ensureDprObserver(): void {
  if (
    stopObserving !== null ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return;
  }

  const observe = () => {
    stopObserving?.();
    stopObserving = null;
    if (listeners.size === 0) return;

    const latest = window.devicePixelRatio || 1;
    currentDpr = latest;
    const mq = window.matchMedia(`(resolution: ${latest}dppx)`);
    const onChange = () => {
      const next = window.devicePixelRatio || 1;
      const changed = next !== currentDpr;
      currentDpr = next;
      observe();
      if (changed) {
        for (const listener of listeners) {
          listener();
        }
      }
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange, { once: true });
      stopObserving = () => mq.removeEventListener("change", onChange);
    } else {
      mq.addListener(onChange);
      stopObserving = () => mq.removeListener(onChange);
    }
  };

  observe();
}

function subscribeDpr(listener: () => void): () => void {
  listeners.add(listener);
  ensureDprObserver();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopObserving !== null) {
      stopObserving();
      stopObserving = null;
    }
  };
}

function getDprSnapshot(): number {
  if (typeof window !== "undefined") {
    const live = window.devicePixelRatio || 1;
    if (live !== currentDpr) {
      currentDpr = live;
    }
  }
  return currentDpr;
}

/**
 * Tracks `window.devicePixelRatio` via a single shared window-level `matchMedia` observer
 * (zero per-row listeners across virtualized `MiniWaveform` canvases).
 */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribeDpr, getDprSnapshot, () => 1);
}
