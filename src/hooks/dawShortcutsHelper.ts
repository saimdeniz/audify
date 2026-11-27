import { getPlayheadSec } from "../store/playheadClock";
import { useSampleStore } from "../store/useSampleStore";
import { isRangeSliderTarget } from "../utils/shortcuts";
import { isNonSampleTableViewActive } from "../utils/viewModes";

type AppStoreState = ReturnType<typeof useSampleStore.getState>;

const PAGE_JUMP_ROWS = 15;
const SEEK_STEP_SEC = 0.5;
const FINE_SEEK_STEP_SEC = 0.1;
const SLICE_TRIM_STEP_SEC = 0.05;
const MIN_SLICE_LEN_SEC = 0.05;

function getEffectiveDurationSec(state: AppStoreState): number {
  const fromSample = state.selectedSample
    ? state.selectedSample.duration_ms / 1000
    : 0;
  return Math.max(0.05, state.durationSec || fromSample || 0.05);
}

function extendSampleSelectionByDelta(
  state: AppStoreState,
  delta: number
): boolean {
  const { samples, selectedSample } = state;
  if (samples.length === 0) return false;
  const currentIndex = selectedSample
    ? samples.findIndex((s) => s.id === selectedSample.id)
    : -1;
  const baseIdx = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(0, Math.min(samples.length - 1, baseIdx + delta));
  const target = samples[nextIndex];
  if (!target) return false;
  state.handleRowSelect(target, nextIndex, { shiftKey: true });
  return true;
}

/**
 * Handles DAW sample-list keyboard navigation (`Shift+↑/↓`, `PageUp`/`PageDown`,
 * `Ctrl+Home`/`Ctrl+End`). Runs before bare ArrowUp/ArrowDown handlers.
 */
export function handleDawListNavigationShortcut(
  e: KeyboardEvent,
  state: AppStoreState
): boolean {
  if (e.altKey) return false;
  // Never leak sample-table jumps while viewing Slices or Saved/Favorites/Trash Layers tables
  if (isNonSampleTableViewActive(state)) {
    return false;
  }
  if (isRangeSliderTarget(e.target as HTMLElement | null)) return false;

  // Shift + ArrowUp/ArrowDown: extend contiguous multi-selection
  if (
    e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.key === "ArrowDown" || e.key === "ArrowUp")
  ) {
    e.preventDefault();
    extendSampleSelectionByDelta(state, e.key === "ArrowDown" ? 1 : -1);
    return true;
  }

  // PageDown / PageUp: jump list by 15 rows (Shift extends selection)
  if (
    !e.ctrlKey &&
    !e.metaKey &&
    (e.key === "PageDown" || e.key === "PageUp")
  ) {
    e.preventDefault();
    const delta = e.key === "PageDown" ? PAGE_JUMP_ROWS : -PAGE_JUMP_ROWS;
    if (e.shiftKey) {
      extendSampleSelectionByDelta(state, delta);
    } else {
      state.selectRelativeSample(delta);
    }
    return true;
  }

  // Ctrl+Home / Ctrl+End: jump straight to first or last visible sample
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    (e.key === "Home" || e.key === "End")
  ) {
    const { samples } = state;
    if (samples.length === 0) return false;
    e.preventDefault();
    const idx = e.key === "Home" ? 0 : samples.length - 1;
    state.handleRowSelect(samples[idx], idx);
    return true;
  }

  return false;
}

/**
 * Handles DAW playhead scrubbing (`←/→`, `Shift+←/→`), slice edge trimming
 * (`Alt+←/→` end, `Alt+Shift+←/→` start), `Home`/`End`, and `Enter` audition replay.
 * Runs AFTER user-customized transport shortcuts so custom bindings always win.
 */
export function handleDawTransportAndSliceShortcut(
  e: KeyboardEvent,
  state: AppStoreState
): boolean {
  if (!state.selectedSample) return false;
  if (isRangeSliderTarget(e.target as HTMLElement | null)) return false;

  // Alt + Left/Right: trim active waveform slice bounds by 50ms
  if (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    state.sliceRange !== null &&
    (e.key === "ArrowLeft" || e.key === "ArrowRight")
  ) {
    e.preventDefault();
    const dur = getEffectiveDurationSec(state);
    const step =
      e.key === "ArrowRight" ? SLICE_TRIM_STEP_SEC : -SLICE_TRIM_STEP_SEC;
    if (e.shiftKey) {
      const nextStart = Math.max(
        0,
        Math.min(
          state.sliceRange.endSec - MIN_SLICE_LEN_SEC,
          state.sliceRange.startSec + step
        )
      );
      state.setSliceRange({
        startSec: nextStart,
        endSec: state.sliceRange.endSec,
      });
    } else {
      const nextEnd = Math.max(
        state.sliceRange.startSec + MIN_SLICE_LEN_SEC,
        Math.min(dur, state.sliceRange.endSec + step)
      );
      state.setSliceRange({
        startSec: state.sliceRange.startSec,
        endSec: nextEnd,
      });
    }
    return true;
  }

  // ArrowLeft / ArrowRight: seek playhead +-0.5s (Shift: fine +-0.1s)
  if (
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    (e.key === "ArrowLeft" || e.key === "ArrowRight")
  ) {
    e.preventDefault();
    const dur = getEffectiveDurationSec(state);
    const minSec = state.sliceRange ? state.sliceRange.startSec : 0;
    const maxSec = state.sliceRange ? state.sliceRange.endSec : dur;
    const step = e.shiftKey ? FINE_SEEK_STEP_SEC : SEEK_STEP_SEC;
    const delta = e.key === "ArrowRight" ? step : -step;
    const nextSec = Math.max(minSec, Math.min(maxSec, getPlayheadSec() + delta));
    state.requestSeek(nextSec, state.isPlaying);
    return true;
  }

  // Home / End: jump playhead to start or end of track / active slice
  if (
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    (e.key === "Home" || e.key === "End")
  ) {
    e.preventDefault();
    const dur = getEffectiveDurationSec(state);
    const targetSec =
      e.key === "Home"
        ? state.sliceRange
          ? state.sliceRange.startSec
          : 0
        : Math.max(
            0,
            (state.sliceRange ? state.sliceRange.endSec : dur) - 0.05
          );
    state.requestSeek(targetSec, state.isPlaying);
    return true;
  }

  // Bare Enter: instant audition replay from start / slice start (yields to focused buttons)
  if (
    e.key === "Enter" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    const targetEl = e.target as HTMLElement | null;
    if (
      targetEl &&
      targetEl.closest(
        "button, a, [role='button'], [role='menuitem'], [role='option'], select"
      )
    ) {
      return false;
    }
    e.preventDefault();
    if (!e.repeat) {
      const startSec = state.sliceRange ? state.sliceRange.startSec : 0;
      state.requestSeek(startSec, true);
    }
    return true;
  }

  return false;
}
