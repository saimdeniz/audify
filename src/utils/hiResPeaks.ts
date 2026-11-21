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
 */

const MAX_ENTRIES = 32;
const DEBOUNCE_MS = 95;
const RAPID_SCRUB_WINDOW_MS = 200;
const cache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[] | null>>();
let cacheGeneration = 0;
let lastSelectionTimestamp = 0;

function remember(path: string, peaks: number[]) {
  cache.delete(path);
  cache.set(path, peaks);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function loadHiResPeaks(path: string): Promise<number[] | null> {
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
      const peaks = raw.map((v) => Math.max(0, Math.min(1, v / 255)));
      if (gen === cacheGeneration) {
        remember(path, peaks);
      }
      return peaks;
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
  lastSelectionTimestamp = 0;
}

/**
 * Returns hi-res peaks (0..1) for `filePath`, or `null` until they are ready /
 * when decoding fails, in which case callers keep using the 600-bin peaks.
 */
export function useHiResPeaks(filePath: string | undefined): number[] | null {
  const [state, setState] = useState<{
    path: string;
    peaks: number[];
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
      setState({ path: filePath, peaks: hit });
      return;
    }

    let cancelled = false;
    const runFetch = () => {
      loadHiResPeaks(filePath).then((peaks) => {
        if (!cancelled && peaks) {
          setState({ path: filePath, peaks });
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
  if (cached) return cached;
  return state && state.path === filePath ? state.peaks : null;
}
