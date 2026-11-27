import { getPlayheadSec } from "../utils/playheadClock";
import { nativeAudioReleaseHandle } from "./nativeAudioClient";

let activeAudioElementRef: HTMLAudioElement | null = null;

/**
 * Registers the singleton `<audio>` element mounted by `<AudioEngine />` fallback.
 */
export function registerAudioElement(el: HTMLAudioElement | null): void {
  activeAudioElementRef = el;
}

/**
 * Unregisters the `<audio>` element on unmount without clearing a newer ref.
 */
export function unregisterAudioElement(el: HTMLAudioElement | null): void {
  if (activeAudioElementRef === el) {
    activeAudioElementRef = null;
  }
}

export interface AudioHandleReleaseContext {
  activeSampleId: number | null;
  activeFilePath?: string | null;
  isPlaying: boolean;
  currentTimeSec: number;
  stopPlaying: () => void;
}

export interface AudioHandleReleaseSnapshot {
  wasMatched: boolean;
  wasPlaying: boolean;
  resumeTimeSec: number;
}

async function releaseMatchedHandle(
  ctx: AudioHandleReleaseContext
): Promise<AudioHandleReleaseSnapshot> {
  const audio = activeAudioElementRef;
  const wasPlaying = ctx.isPlaying;
  const liveClock = getPlayheadSec();
  const resumeTimeSec =
    audio && Number.isFinite(audio.currentTime)
      ? audio.currentTime
      : liveClock > 0
        ? liveClock
        : ctx.currentTimeSec;

  if (wasPlaying) {
    ctx.stopPlaying();
  }

  // Synchronously closes any streaming Rust Symphonia handle before Windows file ops
  await nativeAudioReleaseHandle(ctx.activeFilePath || undefined);

  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      // ignore
    }
    // Brief yield so WebView2's media pipeline closes the Win32 file handle
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return { wasMatched: true, wasPlaying, resumeTimeSec };
}

/**
 * Releases the underlying OS file handle held by the WebView2 `<audio>` element
 * when one of `targetSampleIds` is currently loaded, preventing Windows
 * `ERROR_SHARING_VIOLATION` during physical `fs::rename` or quarantine moves.
 */
export async function releaseAudioFileHandleIfMatching(
  ctx: AudioHandleReleaseContext,
  targetSampleIds: number[]
): Promise<AudioHandleReleaseSnapshot> {
  if (
    ctx.activeSampleId === null ||
    !targetSampleIds.includes(ctx.activeSampleId)
  ) {
    return { wasMatched: false, wasPlaying: false, resumeTimeSec: 0 };
  }
  return releaseMatchedHandle(ctx);
}

/**
 * Releases the OS audio handle if the currently loaded sample path matches `targetPath`.
 */
export async function releaseAudioFileHandleIfPathMatching(
  ctx: AudioHandleReleaseContext,
  targetPath: string
): Promise<AudioHandleReleaseSnapshot> {
  const activeNorm = (ctx.activeFilePath || "").replace(/\\/g, "/").toLowerCase();
  const targetNorm = targetPath.replace(/\\/g, "/").toLowerCase();
  if (!activeNorm || activeNorm !== targetNorm) {
    return { wasMatched: false, wasPlaying: false, resumeTimeSec: 0 };
  }
  return releaseMatchedHandle(ctx);
}
