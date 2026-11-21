import { useEffect, useSyncExternalStore } from "react";
import { clearParsedPeaksCache } from "./format";
import { invokeCommand } from "./tauriCommands";

/**
 * Lazy waveform peaks cache with bounded LRU eviction.
 *
 * `query_samples` omits `peaks_json` (3-5 KB per row). Components ask for the peaks
 * they actually render; requests made within the same tick are coalesced into one
 * `get_sample_peaks` IPC call.
 */

const cache = new Map<number, string>();
const pending = new Set<number>();
const inflight = new Set<number>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

const MAX_CACHE_ENTRIES = 2000;

function rememberPeakJson(id: number, json: string) {
  cache.delete(id);
  cache.set(id, json);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

function emit() {
  listeners.forEach((l) => l());
}

async function flush() {
  flushTimer = null;
  const ids = Array.from(pending);
  pending.clear();
  if (ids.length === 0) return;

  const gen = generation;
  ids.forEach((id) => inflight.add(id));
  try {
    const res = await invokeCommand("get_sample_peaks", {
      sampleIds: ids,
    });
    if (gen !== generation) return;
    for (const id of ids) {
      rememberPeakJson(id, res[String(id)] ?? "");
    }
  } catch {
    if (gen !== generation) return;
    // Mark as empty so a failing backend does not cause an infinite request loop.
    for (const id of ids) {
      rememberPeakJson(id, "");
    }
  } finally {
    if (gen === generation) {
      ids.forEach((id) => inflight.delete(id));
      emit();
    }
  }
}

export function requestPeaks(id: number) {
  if (cache.has(id) || inflight.has(id) || pending.has(id)) return;
  pending.add(id);
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, 12);
  }
}

/** Pre-populates the in-memory peaks cache from rows that already carried `peaks_json` inline. */
export function seedPeaksCache(
  items: readonly { id: number; peaks_json?: string | null }[]
): void {
  for (let i = 0; i < items.length; i++) {
    const { id, peaks_json } = items[i];
    if (id > 0 && peaks_json && peaks_json.length > 0 && !cache.has(id)) {
      rememberPeakJson(id, peaks_json);
    }
  }
}

/** Drop everything (call after a library scan/rebuild regenerates peaks). */
export function clearPeaksCache() {
  generation++;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  cache.clear();
  pending.clear();
  inflight.clear();
  clearParsedPeaksCache();
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Returns the peaks JSON for a sample. `inline` (when non-empty) wins, so callers that already
 * hold peaks skip the extra request.
 */
export function usePeaksJson(
  id: number | null | undefined,
  inline?: string
): string {
  const cached = useSyncExternalStore(subscribe, () =>
    id == null ? undefined : cache.get(id)
  );
  // Track cache resets so rows whose initial request was cancelled by clearPeaksCache() re-request immediately.
  const clearEpoch = useSyncExternalStore(subscribe, () => generation);

  useEffect(() => {
    if (id != null && !inline && cached === undefined) {
      requestPeaks(id);
    }
  }, [id, inline, cached, clearEpoch]);

  return inline || cached || "";
}
