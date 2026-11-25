import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * On-demand high-resolution peaks for the transport deck waveform.
 *
 * The library DB only stores 600 bins per track (~180 ms each on a 108 s file).
 * The deck asks the backend for ~30 bins/sec for the selected track only, which
 * keeps transients aligned with the audio. Uses adaptive debounce: single clicks
 * after idle (>= 200ms) fire immediately (0ms), while rapid scrubbing (< 200ms
 * between track changes, e.g. holding ArrowDown) applies a 95ms debounce so we
 * never flood the backend with dozens of concurrent Symphonia decode tasks.
 *
 * Cached entries are stored as compact 1-byte `Uint8Array` (8x smaller than JS
 * `number[]`), materializing a normalized 0..1 `number[]` view only for the single
 * active track.
 */

const MAX_ENTRIES = 24;
const DEBOUNCE_MS = 95;
const RAPID_SCRUB_WINDOW_MS = 200;
const cache = new Map<string, Uint8Array>();
const inflight = new Map<string, Promise<Uint8Array | null>>();
let activeViewPath: string | null = null;
let activeViewBytes: Uint8Array | null = null;
let activeViewNormalized: number[] | null = null;
let cacheGeneration = 0;
let lastSelectionTimestamp = 0;

function remember(path: string, bytes: Uint8Array) {
  cache.delete(path);
  cache.set(path, bytes);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function getNormalizedView(path: string, bytes: Uint8Array): number[] {
  if (
    activeViewPath === path &&
    activeViewBytes === bytes &&
    activeViewNormalized !== null
  ) {
    return activeViewNormalized;
  }
  const normalized = new Array<number>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    normalized[i] = bytes[i] / 255;
  }
  activeViewPath = path;
  activeViewBytes = bytes;
  activeViewNormalized = normalized;
  return normalized;
}

function loadHiResPeaks(path: string): Promise<Uint8Array | null> {
  const hit = cache.get(path);
  if (hit) {
    remember(path, hit);
    return Promise.resolve(hit);
  }
  const pending = inflight.get(path);
  if (pending) return pending;

  const gen = cacheGeneration;
  const p = invoke<number[]>("get_hires_peaks", { filePath: path })
    .then((raw) => {
      if (!Array.isArray(raw) || raw.length === 0) return null;
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        bytes[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
      }
      if (gen === cacheGeneration) {
        remember(path, bytes);
      }
      return bytes;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(path) === p) {
        inflight.delete(path);
      }
    });
  inflight.set(path, p);
  return p;
}

/** Drop cached hi-res peaks (e.g. after files changed on disk or rescan). */
export function clearHiResPeaksCache() {
  cacheGeneration += 1;
  cache.clear();
  inflight.clear();
  activeViewPath = null;
  activeViewBytes = null;
  activeViewNormalized = null;
  lastSelectionTimestamp = 0;
}

/**
 * Returns hi-res peaks (0..1) for `filePath`, or `null` until they are ready /
 * when decoding fails, in which case callers keep using the 600-bin peaks.
 */
export function useHiResPeaks(filePath: string | undefined): number[] | null {
  const [state, setState] = useState<{
    path: string;
    bytes: Uint8Array;
  } | null>(null);

  useEffect(() => {
    if (!filePath) return;
    const now = Date.now();
    const elapsed = now - lastSelectionTimestamp;
    const isRapidScrub =
      lastSelectionTimestamp > 0 &&
      elapsed >= 0 &&
      elapsed < RAPID_SCRUB_WINDOW_MS;
    lastSelectionTimestamp = now;

    const hit = cache.get(filePath);
    if (hit) {
      remember(filePath, hit);
      setState({ path: filePath, bytes: hit });
      return;
    }

    let cancelled = false;
    const runFetch = () => {
      loadHiResPeaks(filePath).then((bytes) => {
        if (!cancelled && bytes) {
          setState({ path: filePath, bytes });
        }
      });
    };

    if (!isRapidScrub) {
      runFetch();
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(runFetch, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filePath]);

  if (!filePath) return null;
  const cached = cache.get(filePath);
  if (cached) return getNormalizedView(filePath, cached);
  return state && state.path === filePath
    ? getNormalizedView(filePath, state.bytes)
    : null;
}
