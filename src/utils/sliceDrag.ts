import { invoke } from "@tauri-apps/api/core";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import {
  extractBaseName,
  isLeftButtonHeldForDrag,
  normalizeOsPath,
  releaseNativeDrag,
  renderDynamicDragBadgePng,
  tryAcquireNativeDrag,
} from "./dragCore";
import { safeGetItem } from "./localStorageSafe";
import { normalizePathForMatch } from "./pathHelpers";
import { invokeCommand } from "./tauriCommands";

const MAX_SLICE_CACHE = 200;
const slicePathCache = new Map<string, string>();
const sliceInFlightPromises = new Map<string, Promise<string | null>>();
let sliceCacheGeneration = 0;

export function clearSlicePathCache(): void {
  sliceCacheGeneration += 1;
  slicePathCache.clear();
  sliceInFlightPromises.clear();
}

function getActiveCustomSliceDir(): string {
  return (safeGetItem(AUDIFY_STORAGE_KEYS.customSliceExportPath) || "").trim();
}

function getActiveExportAudioPreset(): string {
  const raw = (safeGetItem(AUDIFY_STORAGE_KEYS.exportAudioPreset) || "").trim();
  return raw === "wav_24" || raw === "nle_48k_24" ? raw : "original";
}

function getActiveExportLoudnessMode(): string {
  const raw = (safeGetItem(AUDIFY_STORAGE_KEYS.exportLoudnessMode) || "").trim();
  return raw === "peak_m1" || raw === "lufs_m14" || raw === "lufs_m24"
    ? raw
    : "off";
}

function formatLoudnessBadge(mode: string): string {
  if (mode === "peak_m1") return "-1 dBTP";
  if (mode === "lufs_m14") return "-14 LUFS";
  if (mode === "lufs_m24") return "-24 LUFS";
  return "";
}

export interface SliceExportOptions {
  pitchSemitones?: number;
  applyMicroFade?: boolean;
  exportPreset?: string;
  loudnessMode?: string;
  cacheOnly?: boolean;
}

function makeSliceCacheKey(
  sourceFilePath: string,
  startSec: number,
  endSec: number,
  pitchSemitones = 0,
  applyMicroFade = false,
  cacheOnly = false,
  exportPreset = getActiveExportAudioPreset(),
  loudnessMode = getActiveExportLoudnessMode()
): string {
  const s = Math.max(0, startSec).toFixed(3);
  const e = Math.max(0.02, endSec).toFixed(3);
  const p = Number.isFinite(pitchSemitones) ? pitchSemitones.toFixed(2) : "0.00";
  const mf = applyMicroFade ? "1" : "0";
  const scopePrefix = cacheOnly ? "__cache__" : getActiveCustomSliceDir();
  const normSource = normalizePathForMatch(sourceFilePath);
  return `${scopePrefix}::${normSource}::${s}-${e}::p=${p}::mf=${mf}::fmt=${exportPreset}::norm=${loudnessMode}`;
}

export function getCachedPreviewSlicePath(
  sourceFilePath: string,
  startSec: number,
  endSec: number,
  opts?: SliceExportOptions
): string | null {
  const key = makeSliceCacheKey(
    sourceFilePath,
    startSec,
    endSec,
    opts?.pitchSemitones ?? 0,
    Boolean(opts?.applyMicroFade),
    true,
    opts?.exportPreset ?? getActiveExportAudioPreset(),
    opts?.loudnessMode ?? getActiveExportLoudnessMode()
  );
  return slicePathCache.get(key) || null;
}

function rememberSlicePath(key: string, path: string) {
  slicePathCache.delete(key);
  slicePathCache.set(key, path);
  if (slicePathCache.size > MAX_SLICE_CACHE) {
    const oldest = slicePathCache.keys().next().value;
    if (oldest !== undefined) {
      slicePathCache.delete(oldest);
    }
  }
}

export async function preExportAudioSlice(
  sourceFilePath: string,
  startSec: number,
  endSec: number,
  opts?: SliceExportOptions
): Promise<string | null> {
  if (
    !sourceFilePath ||
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    endSec <= startSec
  ) {
    return null;
  }
  const pitch = opts?.pitchSemitones ?? 0;
  const microFade = Boolean(opts?.applyMicroFade);
  const cacheOnly = Boolean(opts?.cacheOnly);
  const exportPreset = opts?.exportPreset ?? getActiveExportAudioPreset();
  const loudnessMode = opts?.loudnessMode ?? getActiveExportLoudnessMode();
  const key = makeSliceCacheKey(
    sourceFilePath,
    startSec,
    endSec,
    pitch,
    microFade,
    cacheOnly,
    exportPreset,
    loudnessMode
  );
  const cached = slicePathCache.get(key);
  if (cached) {
    rememberSlicePath(key, cached);
    return cached;
  }

  const existingPromise = sliceInFlightPromises.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const customDir = cacheOnly ? "" : getActiveCustomSliceDir();
  const gen = sliceCacheGeneration;
  const promise = (async () => {
    try {
      const slicedWavPath = await invoke<string>("export_audio_slice", {
        filePath: sourceFilePath,
        startSec,
        endSec,
        customDir: customDir || null,
        pitchSemitones: Math.abs(pitch) >= 0.01 ? pitch : null,
        applyMicroFade: microFade,
        cacheOnly,
        ...(exportPreset !== "original" ? { exportPreset } : {}),
        ...(loudnessMode !== "off" ? { exportLoudnessMode: loudnessMode } : {}),
      });
      if (slicedWavPath && slicedWavPath.trim().length > 0) {
        const normalized = normalizeOsPath(slicedWavPath);
        if (gen === sliceCacheGeneration) {
          rememberSlicePath(key, normalized);
        }
        return normalized;
      }
      return null;
    } catch (err) {
      console.error("Pre-export audio slice error:", err);
      return null;
    } finally {
      if (gen === sliceCacheGeneration) {
        sliceInFlightPromises.delete(key);
      }
    }
  })();

  sliceInFlightPromises.set(key, promise);
  return promise;
}

export interface SliceDragResult {
  exportedPath: string;
  droppedExternally: boolean;
}

export async function startNativeSliceDrag(
  sourceFilePath: string,
  startSec: number,
  endSec: number,
  label?: string,
  opts?: SliceExportOptions
): Promise<SliceDragResult | null> {
  if (!sourceFilePath || !tryAcquireNativeDrag()) return null;

  try {
    const pitch = opts?.pitchSemitones ?? 0;
    const microFade = Boolean(opts?.applyMicroFade);
    const exportPreset = opts?.exportPreset ?? getActiveExportAudioPreset();
    const loudnessMode = opts?.loudnessMode ?? getActiveExportLoudnessMode();
    const cachedPreview = getCachedPreviewSlicePath(
      sourceFilePath,
      startSec,
      endSec,
      {
        pitchSemitones: pitch,
        applyMicroFade: microFade,
        exportPreset,
        loudnessMode,
      }
    );
    const customDir = getActiveCustomSliceDir();

    const promoted = await invokeCommand("promote_slice_to_export", {
      filePath: sourceFilePath,
      startSec,
      endSec,
      customDir: customDir || null,
      cachedSlicePath: cachedPreview,
      pitchSemitones: Math.abs(pitch) >= 0.01 ? pitch : null,
      applyMicroFade: microFade,
      customName: null,
      ...(exportPreset !== "original" ? { exportPreset } : {}),
      ...(loudnessMode !== "off" ? { exportLoudnessMode: loudnessMode } : {}),
    });
    const normalizedSlicePath = promoted?.slice_path
      ? normalizeOsPath(promoted.slice_path)
      : null;

    if (!normalizedSlicePath) return null;

    // If user already released the mouse button while slice export was running,
    // clean up newly created export file and abort instead of stuck OS drag loop.
    if (!isLeftButtonHeldForDrag()) {
      if (promoted.newly_created) {
        void invokeCommand("cleanup_unrecorded_slice_file", {
          slicePath: normalizedSlicePath,
        }).catch(() => {});
      }
      return null;
    }

    const resolvedLabel = label || extractBaseName(normalizedSlicePath);
    const iconPng = renderDynamicDragBadgePng(resolvedLabel);

    const droppedExternally = await invoke<boolean>("start_native_file_drag", {
      paths: [normalizedSlicePath],
      iconPng,
    });
    if (!droppedExternally && promoted.newly_created) {
      void invokeCommand("cleanup_unrecorded_slice_file", {
        slicePath: normalizedSlicePath,
      }).catch(() => {});
    }
    return {
      exportedPath: normalizedSlicePath,
      droppedExternally: Boolean(droppedExternally),
    };
  } catch (err) {
    console.error("Native slice drag error:", err);
    return null;
  } finally {
    releaseNativeDrag();
  }
}

export async function startNativePitchedSampleDrag(
  sample: { file_path: string; file_name: string; duration_ms: number },
  pitchSemitones: number,
  applyMicroFade = false,
  loudnessMode?: string
): Promise<boolean> {
  const endSec = Math.max(0.05, sample.duration_ms / 1000);
  const resolvedLoudness = loudnessMode ?? getActiveExportLoudnessMode();
  const tags: string[] = [];
  if (Math.abs(pitchSemitones) >= 0.01) {
    const sign = pitchSemitones > 0 ? "+" : "";
    tags.push(`${sign}${pitchSemitones}st`);
  }
  const loudBadge = formatLoudnessBadge(resolvedLoudness);
  if (loudBadge) tags.push(loudBadge);
  const label =
    tags.length > 0
      ? `[${tags.join(" · ")}] ${sample.file_name}`
      : sample.file_name;
  const res = await startNativeSliceDrag(sample.file_path, 0, endSec, label, {
    pitchSemitones,
    applyMicroFade,
    loudnessMode: resolvedLoudness,
  });
  return Boolean(res?.droppedExternally);
}
