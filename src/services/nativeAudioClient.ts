import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const NATIVE_AUDIO_SYNC_EVENT = "audify:audio-sync";

export interface AudioOutputDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AudioSyncPayload {
  seq: number;
  event: string;
  filePath: string;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  playbackRate: number;
  activeDeviceId: string;
  activeDeviceName: string;
  outputLatencyMs: number;
  error: string | null;
}

export interface NativeAudioLoadParams {
  filePath: string;
  autoplay: boolean;
  startSec?: number;
  sliceStartSec?: number | null;
  sliceEndSec?: number | null;
  volume?: number;
  pitchSemitones?: number;
  looping?: boolean;
  normalizePreview?: boolean;
  skipLeadingSilence?: boolean;
}

export interface NativeAudioParamsUpdate {
  volume?: number;
  pitchSemitones?: number;
  looping?: boolean;
  normalizePreview?: boolean;
  updateSlice?: boolean;
  sliceStartSec?: number | null;
  sliceEndSec?: number | null;
}

export interface PlayheadAnchor {
  positionSec: number;
  anchorMs: number;
  playbackRate: number;
  durationSec: number;
  isPlaying: boolean;
  outputLatencyMs: number;
}

export function isTauriNativeAudioRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

/**
 * Pure monotonic local playhead interpolator driven at 60–144 Hz via `rAF`
 * without per-frame IPC calls. Smoothly aligns with output latency and wraps
 * cleanly inside an active looping slice between Rust sync heartbeats.
 */
export function computeInterpolatedPlayheadSec(
  anchor: PlayheadAnchor,
  nowMs: number,
  manualLatencyMs: number | null,
  sliceRange: { startSec: number; endSec: number } | null,
  isLooping: boolean
): number {
  const elapsedSec = anchor.isPlaying
    ? Math.max(0, (nowMs - anchor.anchorMs) / 1000)
    : 0;
  const rate =
    Number.isFinite(anchor.playbackRate) && anchor.playbackRate > 0
      ? anchor.playbackRate
      : 1;
  const latencySec =
    (manualLatencyMs === null ? anchor.outputLatencyMs : manualLatencyMs) /
    1000;

  let raw = anchor.positionSec + elapsedSec * rate - latencySec;

  const anchorInSlice =
    sliceRange !== null &&
    sliceRange.endSec > sliceRange.startSec &&
    anchor.positionSec >= sliceRange.startSec - 0.02 &&
    anchor.positionSec <= sliceRange.endSec + 0.02;

  if (anchorInSlice && sliceRange) {
    const span = sliceRange.endSec - sliceRange.startSec;
    if (isLooping && raw >= sliceRange.endSec) {
      raw = sliceRange.startSec + ((raw - sliceRange.startSec) % span);
    } else {
      raw = Math.max(sliceRange.startSec, Math.min(sliceRange.endSec, raw));
    }
  } else if (anchor.durationSec > 0) {
    if (isLooping && raw >= anchor.durationSec) {
      raw = raw % anchor.durationSec;
    } else {
      raw = Math.max(0, Math.min(anchor.durationSec, raw));
    }
  }

  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

export async function nativeAudioLoad(
  params: NativeAudioLoadParams
): Promise<AudioSyncPayload> {
  return invoke<AudioSyncPayload>("audio_engine_load", {
    filePath: params.filePath,
    autoplay: params.autoplay,
    startSec: params.startSec ?? 0,
    sliceStartSec: params.sliceStartSec ?? null,
    sliceEndSec: params.sliceEndSec ?? null,
    volume: params.volume ?? 0.85,
    pitchSemitones: params.pitchSemitones ?? 0,
    looping: params.looping ?? false,
    normalizePreview: params.normalizePreview ?? false,
    skipLeadingSilence: params.skipLeadingSilence ?? false,
  });
}

export async function nativeAudioPlay(): Promise<void> {
  await invoke("audio_engine_play");
}

export async function nativeAudioPause(): Promise<void> {
  await invoke("audio_engine_pause");
}

export async function nativeAudioUnload(): Promise<void> {
  await invoke("audio_engine_unload");
}

export async function nativeAudioSeek(sec: number): Promise<void> {
  await invoke("audio_engine_seek", { sec: Math.max(0, sec) });
}

export async function nativeAudioSetParams(
  params: NativeAudioParamsUpdate
): Promise<void> {
  await invoke("audio_engine_set_params", {
    volume: params.volume ?? null,
    pitchSemitones: params.pitchSemitones ?? null,
    looping: params.looping ?? null,
    normalizePreview: params.normalizePreview ?? null,
    updateSlice: params.updateSlice ?? false,
    sliceStartSec: params.sliceStartSec ?? null,
    sliceEndSec: params.sliceEndSec ?? null,
  });
}

export async function nativeAudioListDevices(): Promise<
  AudioOutputDeviceInfo[]
> {
  if (!isTauriNativeAudioRuntime()) {
    return [{ id: "default", name: "System Default", isDefault: true }];
  }
  try {
    const list = await invoke<AudioOutputDeviceInfo[]>(
      "audio_engine_list_devices"
    );
    if (Array.isArray(list) && list.length > 0) {
      return list;
    }
  } catch {
    // Fallback to single default entry in non-audio environments
  }
  return [{ id: "default", name: "System Default", isDefault: true }];
}

export async function nativeAudioSetDevice(deviceId: string): Promise<void> {
  await invoke("audio_engine_set_device", {
    deviceId: deviceId || "default",
  });
}

export async function nativeAudioReleaseHandle(
  filePath?: string
): Promise<boolean> {
  if (!isTauriNativeAudioRuntime()) return false;
  try {
    return await invoke<boolean>("audio_engine_release_handle", {
      filePath: filePath || null,
    });
  } catch {
    return false;
  }
}

export async function subscribeNativeAudioSync(
  handler: (payload: AudioSyncPayload) => void
): Promise<UnlistenFn> {
  return listen<AudioSyncPayload>(NATIVE_AUDIO_SYNC_EVENT, (ev) => {
    if (ev.payload) {
      handler(ev.payload);
    }
  });
}
