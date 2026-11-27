import { useSyncExternalStore } from "react";

/**
 * High-frequency (60–144 Hz) playhead clock decoupled from Zustand state.
 *
 * Audio playback updates this clock on every animation frame without triggering
 * Zustand store subscriptions across unrelated UI components (SampleTable,
 * LeftSidebar, SettingsModal, StatusBar). Canvas waveforms and timecode readouts
 * subscribe directly via `subscribePlayhead` or `usePlayheadSec`.
 */
let currentPlayheadSec = 0;
const listeners = new Set<(sec: number) => void>();

let currentLayerDraftPlayheadSec = 0;
const layerDraftListeners = new Set<(sec: number) => void>();

export function getPlayheadSec(): number {
  return currentPlayheadSec;
}

export function setPlayheadSec(sec: number): void {
  const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
  if (Math.abs(safe - currentPlayheadSec) < 0.00005) return;
  currentPlayheadSec = safe;
  for (const listener of listeners) {
    listener(currentPlayheadSec);
  }
}

export function resetPlayheadClock(sec = 0): void {
  const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
  currentPlayheadSec = safe;
  for (const listener of listeners) {
    listener(currentPlayheadSec);
  }
}

export function subscribePlayhead(listener: (sec: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlayheadSec(): number {
  return useSyncExternalStore(subscribePlayhead, getPlayheadSec, getPlayheadSec);
}

/**
 * Independent Layers Editor draft playhead so auditioning a sample in the top
 * Split-Mode Library never drags the Layers timeline playhead or breaks `S`/`Ctrl+V`.
 */
export function getLayerDraftPlayheadSec(): number {
  return currentLayerDraftPlayheadSec;
}

export function setLayerDraftPlayheadSec(sec: number): void {
  const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
  if (Math.abs(safe - currentLayerDraftPlayheadSec) < 0.00005) return;
  currentLayerDraftPlayheadSec = safe;
  for (const listener of layerDraftListeners) {
    listener(currentLayerDraftPlayheadSec);
  }
}

export function resetLayerDraftPlayheadClock(sec = 0): void {
  const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
  currentLayerDraftPlayheadSec = safe;
  for (const listener of layerDraftListeners) {
    listener(currentLayerDraftPlayheadSec);
  }
}

export function subscribeLayerDraftPlayhead(
  listener: (sec: number) => void
): () => void {
  layerDraftListeners.add(listener);
  return () => {
    layerDraftListeners.delete(listener);
  };
}
