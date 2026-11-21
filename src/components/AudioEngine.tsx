import React, { useEffect, useRef } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  registerAudioElement,
  unregisterAudioElement,
} from "../services/audioPlaybackService";
import { resetPlayheadClock, setPlayheadSec } from "../store/playheadClock";
import { useSampleStore } from "../store/useSampleStore";

const MAX_FALLBACK_ENTRIES = 256;
const transcodedFallbackMap = new Map<string, string>();

const MAX_PREVIEW_GAIN_ENTRIES = 512;
const previewGainMap = new Map<string, number>();

function setBoundedPreviewGain(filePath: string, gain: number): void {
  if (previewGainMap.has(filePath)) {
    previewGainMap.delete(filePath);
  } else if (previewGainMap.size >= MAX_PREVIEW_GAIN_ENTRIES) {
    const oldest = previewGainMap.keys().next().value;
    if (oldest !== undefined) previewGainMap.delete(oldest);
  }
  previewGainMap.set(filePath, gain);
}

function applyVarispeedRate(audio: HTMLAudioElement, semitones: number): void {
  const rate = semitones === 0 ? 1 : Math.pow(2, semitones / 12);
  const clamped = Math.max(0.25, Math.min(4.0, rate));
  const pitched = audio as HTMLAudioElement & {
    preservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  if ("preservesPitch" in pitched) pitched.preservesPitch = false;
  if ("webkitPreservesPitch" in pitched) pitched.webkitPreservesPitch = false;
  if ("mozPreservesPitch" in pitched) pitched.mozPreservesPitch = false;
  audio.defaultPlaybackRate = clamped;
  audio.playbackRate = clamped;
}

function setBoundedFallback(filePath: string, pcmPath: string): void {
  if (transcodedFallbackMap.has(filePath)) {
    transcodedFallbackMap.delete(filePath);
  } else if (transcodedFallbackMap.size >= MAX_FALLBACK_ENTRIES) {
    const oldest = transcodedFallbackMap.keys().next().value;
    if (oldest !== undefined) transcodedFallbackMap.delete(oldest);
  }
  transcodedFallbackMap.set(filePath, pcmPath);
}

let cachedAutoOutputLatencyMs: number | null = null;
let deviceChangeListenerAttached = false;

function ensureDeviceChangeListener(): void {
  if (deviceChangeListenerAttached || typeof navigator === "undefined") return;
  if (navigator.mediaDevices?.addEventListener) {
    deviceChangeListenerAttached = true;
    navigator.mediaDevices.addEventListener("devicechange", () => {
      cachedAutoOutputLatencyMs = null;
    });
  }
}

/**
 * Estimates the audio output pipeline delay (WASAPI / Bluetooth buffers) in ms.
 */
function getAutoOutputLatencyMs(): number {
  ensureDeviceChangeListener();
  if (cachedAutoOutputLatencyMs !== null) return cachedAutoOutputLatencyMs;
  let ms = 0;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctor) {
      const ctx = new Ctor();
      const sec = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      ms = Math.max(0, Math.min(300, sec * 1000));
      void ctx.close();
    }
  } catch {
    ms = 0;
  }
  cachedAutoOutputLatencyMs = ms;
  return ms;
}

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

/**
 * Shared slice enforcement & playhead sync helper (used by both rAF and timeupdate).
 */
function syncPlaybackPosition(audio: HTMLAudioElement): void {
  if (audio.paused) return;
  const now = audio.currentTime;
  const state = useSampleStore.getState();
  const activeSlice = state.sliceRange;
  const looping = state.isLooping;
  const manualLatency = state.playheadLatencyMs;

  if (
    activeSlice &&
    (now >= activeSlice.endSec || now < activeSlice.startSec - 0.05)
  ) {
    if (looping) {
      audio.currentTime = activeSlice.startSec;
      resetPlayheadClock(activeSlice.startSec);
    } else {
      audio.pause();
      audio.currentTime = activeSlice.startSec;
      state.setCurrentTimeSec(activeSlice.startSec);
      state.setIsPlaying(false);
    }
    return;
  }

  const latencySec =
    (manualLatency === null ? getAutoOutputLatencyMs() : manualLatency) / 1000;
  setPlayheadSec(Math.max(0, now - latencySec));
}

/**
 * Persistent headless HTML5 audio engine mounted once at the root of `<App />`.
 *
 * Keeps playback completely isolated from UI layout changes (and ready for a
 * future Mini Dock / Compact Overlay), drives the 60Hz `playheadClock` without
 * causing Zustand store re-renders on every frame, and enforces slice bounds
 * both in `requestAnimationFrame` and native `timeupdate` (when occluded behind NLEs).
 */
export const AudioEngine: React.FC = () => {
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const selectedSampleId = selectedSample?.id ?? null;
  const selectedSampleFilePath = selectedSample?.file_path ?? "";
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const isLooping = useSampleStore((s) => s.isLooping);
  const volume = useSampleStore((s) => s.volume);
  const pitchSemitones = useSampleStore((s) => s.pitchSemitones);
  const normalizePreview = useSampleStore((s) => s.normalizePreview);
  const durationSec = useSampleStore((s) => s.durationSec);
  const sliceRange = useSampleStore((s) => s.sliceRange);
  const seekRequest = useSampleStore((s) => s.seekRequest);
  const playTriggerSeq = useSampleStore((s) => s.playTriggerSeq);
  const playheadLatencyMs = useSampleStore((s) => s.playheadLatencyMs);
  const audioOutputDeviceId = useSampleStore((s) => s.audioOutputDeviceId);
  const setIsPlaying = useSampleStore((s) => s.setIsPlaying);
  const setCurrentTimeSec = useSampleStore((s) => s.setCurrentTimeSec);
  const setDurationSec = useSampleStore((s) => s.setDurationSec);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const fallbackRetriedRef = useRef<number | null>(null);
  const lastAppliedSeekSeqRef = useRef<number>(0);
  const pendingSeekSecRef = useRef<number | null>(null);
  const loadedSampleIdRef = useRef<number | null>(null);
  const normGainRef = useRef<number>(1.0);

  const effectiveDuration = Math.max(
    0.05,
    durationSec || (selectedSample ? selectedSample.duration_ms / 1000 : 1)
  );

  useEffect(() => {
    const el = audioRef.current;
    registerAudioElement(el);
    return () => {
      unregisterAudioElement(el);
    };
  }, []);

  // Route audio output device via HTMLMediaElement.setSinkId when supported
  useEffect(() => {
    const audio = audioRef.current as SinkCapableAudioElement | null;
    if (!audio || typeof audio.setSinkId !== "function") return;
    const targetSink =
      !audioOutputDeviceId || audioOutputDeviceId === "default"
        ? ""
        : audioOutputDeviceId;
    if ((audio.sinkId || "") === targetSink) return;

    cachedAutoOutputLatencyMs = null;
    audio.setSinkId(targetSink).catch((err) => {
      console.warn("Audio output device unavailable, reverting to default:", err);
      useSampleStore.getState().setAudioOutputDeviceId("default");
    });
  }, [audioOutputDeviceId]);

  // Sync audio source ONLY when selectedSampleId or playTriggerSeq changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const state = useSampleStore.getState();
    const activeSample = state.selectedSample;

    if (selectedSampleId === null || !activeSample) {
      loadedSampleIdRef.current = null;
      pendingSeekSecRef.current = null;
      audio.pause();
      audio.removeAttribute("src");
      resetPlayheadClock(0);
      state.setIsPlaying(false);
      return;
    }

    const isTrackSwitch = loadedSampleIdRef.current !== activeSample.id;
    if (isTrackSwitch) {
      fallbackRetriedRef.current = null;
      loadedSampleIdRef.current = activeSample.id;
    }

    const cachedFallback = transcodedFallbackMap.get(activeSample.file_path);
    const targetPath = cachedFallback || activeSample.file_path;
    const assetUrl = convertFileSrc(targetPath);

    const hasUnappliedSeek =
      state.seekRequest !== null &&
      state.seekRequest.seq !== lastAppliedSeekSeqRef.current;

    if (audio.src !== assetUrl) {
      if (activeSample.duration_ms > 0) {
        state.setDurationSec(activeSample.duration_ms / 1000);
      }
      if (!hasUnappliedSeek) {
        const startAt = state.sliceRange ? state.sliceRange.startSec : 0;
        pendingSeekSecRef.current = startAt > 0 ? startAt : null;
        resetPlayheadClock(startAt);
      }
      audio.src = assetUrl;
      audio.load();
    } else if (!hasUnappliedSeek && state.isPlaying) {
      const startAt = state.sliceRange ? state.sliceRange.startSec : 0;
      audio.currentTime = startAt;
      resetPlayheadClock(startAt);
    }

    const cachedGain = state.normalizePreview
      ? previewGainMap.get(activeSample.file_path)
      : 1.0;
    normGainRef.current = cachedGain ?? (state.normalizePreview ? 0.78 : 1.0);
    audio.volume = Math.max(0, Math.min(1, state.volume * normGainRef.current));
    applyVarispeedRate(audio, state.pitchSemitones);
    audio.loop = state.isLooping && !state.sliceRange;

    if (state.isPlaying) {
      audio.play().catch(() => {
        state.setIsPlaying(false);
      });
    }
  }, [selectedSampleId, selectedSampleFilePath, playTriggerSeq]);

  // Sync play/pause state without re-triggering old seeks
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || selectedSampleId === null) return;

    if (isPlaying) {
      if (sliceRange && audio.readyState >= 1) {
        if (
          audio.currentTime < sliceRange.startSec - 0.05 ||
          audio.currentTime >= sliceRange.endSec
        ) {
          audio.currentTime = sliceRange.startSec;
          resetPlayheadClock(sliceRange.startSec);
        }
      }
      if (audio.paused) {
        audio.play().catch(() => setIsPlaying(false));
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
      // Sync discrete paused playhead back to store once on pause
      const pausedSec = Math.max(0, audio.currentTime || 0);
      setCurrentTimeSec(pausedSec);
    }
  }, [isPlaying, selectedSampleId, sliceRange, setCurrentTimeSec, setIsPlaying]);

  // Sync volume, optional loudness normalization & native loop attribute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = isLooping && !sliceRange;

    if (!normalizePreview || !selectedSample) {
      normGainRef.current = 1.0;
      audio.volume = Math.max(0, Math.min(1, volume));
      return;
    }

    const filePath = selectedSample.file_path;
    const sampleId = selectedSample.id;
    const cached = previewGainMap.get(filePath);
    if (cached !== undefined) {
      normGainRef.current = cached;
      audio.volume = Math.max(0, Math.min(1, volume * cached));
      return;
    }

    audio.volume = Math.max(0, Math.min(1, volume * normGainRef.current));
    let cancelled = false;
    invoke<number>("get_audio_preview_gain", { filePath })
      .then((gain) => {
        const cleanGain =
          typeof gain === "number" && Number.isFinite(gain)
            ? Math.max(0.2, Math.min(1.0, gain))
            : 1.0;
        setBoundedPreviewGain(filePath, cleanGain);
        if (cancelled || !audioRef.current) return;
        const live = useSampleStore.getState();
        if (live.selectedSample?.id === sampleId && live.normalizePreview) {
          normGainRef.current = cleanGain;
          audioRef.current.volume = Math.max(
            0,
            Math.min(1, live.volume * cleanGain)
          );
        }
      })
      .catch(() => {
        setBoundedPreviewGain(filePath, 1.0);
      });

    return () => {
      cancelled = true;
    };
  }, [volume, normalizePreview, selectedSample, isLooping, sliceRange]);

  // Sync varispeed pitch semitones (-24..+24 st) cleanly on change
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    applyVarispeedRate(audio, pitchSemitones);
  }, [pitchSemitones, selectedSampleId]);

  // Handle explicit seek requests ONCE per unique `seekRequest.seq`
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !seekRequest) return;
    if (seekRequest.seq === lastAppliedSeekSeqRef.current) return;

    lastAppliedSeekSeqRef.current = seekRequest.seq;

    const targetSec = sliceRange
      ? Math.max(
          sliceRange.startSec,
          Math.min(sliceRange.endSec, seekRequest.timeSec)
        )
      : Math.max(0, Math.min(effectiveDuration, seekRequest.timeSec));

    resetPlayheadClock(targetSec);

    if (audio.readyState >= 1) {
      pendingSeekSecRef.current = null;
      audio.currentTime = targetSec;
      if (isPlaying && audio.paused) {
        audio.play().catch(() => {});
      }
    } else {
      // Queue cross-track seek until metadata finishes loading
      pendingSeekSecRef.current = targetSec;
    }
  }, [seekRequest, sliceRange, effectiveDuration, isPlaying]);

  // 60 FPS Playhead tracking while visible
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const tick = () => {
      if (!audio.paused) {
        syncPlaybackPosition(audio);
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, isLooping, sliceRange, playheadLatencyMs]);

  return (
    <audio
      ref={audioRef}
      preload="auto"
      className="hidden"
      onLoadedMetadata={(e) => {
        const audio = e.currentTarget;
        applyVarispeedRate(audio, useSampleStore.getState().pitchSemitones);
        const dur = audio.duration;
        if (Number.isFinite(dur) && dur > 0) {
          setDurationSec(dur);
        }
        if (pendingSeekSecRef.current !== null) {
          const clamped =
            Number.isFinite(dur) && dur > 0
              ? Math.max(0, Math.min(dur, pendingSeekSecRef.current))
              : Math.max(0, pendingSeekSecRef.current);
          pendingSeekSecRef.current = null;
          audio.currentTime = clamped;
          resetPlayheadClock(clamped);
          if (useSampleStore.getState().isPlaying && audio.paused) {
            audio.play().catch(() => {});
          }
        }
      }}
      onDurationChange={(e) => {
        const dur = e.currentTarget.duration;
        if (Number.isFinite(dur) && dur > 0) {
          setDurationSec(dur);
        }
      }}
      onTimeUpdate={(e) => {
        // Ensures slice stop/loop still fires accurately when Audify is occluded behind an NLE!
        syncPlaybackPosition(e.currentTarget);
      }}
      onError={async (e) => {
        const err = e.currentTarget.error;
        const currentSample = useSampleStore.getState().selectedSample;
        const erroredSampleId = currentSample?.id ?? null;
        const erroredFileName = currentSample?.file_name ?? "";
        if (
          currentSample &&
          err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED &&
          fallbackRetriedRef.current !== currentSample.id
        ) {
          const requestedId = currentSample.id;
          const requestedPath = currentSample.file_path;
          fallbackRetriedRef.current = requestedId;
          try {
            const pcmPath = await invoke<string>("transcode_to_pcm_cache", {
              filePath: requestedPath,
            });
            if (pcmPath) {
              setBoundedFallback(requestedPath, pcmPath);
              const liveState = useSampleStore.getState();
              // Guard against user switching tracks while Symphonia was transcoding
              if (
                audioRef.current &&
                liveState.selectedSample?.id === requestedId
              ) {
                const audio = audioRef.current;
                audio.src = convertFileSrc(pcmPath);
                audio.load();
                if (liveState.isPlaying) {
                  audio.play().catch(() => setIsPlaying(false));
                }
                return;
              }
              return;
            }
          } catch (fallbackErr) {
            console.error("Transcode fallback failed:", fallbackErr);
          }
        }

        // Do not clobber playback or show a stale error if user already switched to another sample
        const latestSample = useSampleStore.getState().selectedSample;
        if (
          erroredSampleId !== null &&
          latestSample?.id !== erroredSampleId
        ) {
          return;
        }

        let msg = "Failed to load audio file or access denied";
        if (err) {
          if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
            msg = "Audio format not supported or file inaccessible";
          } else if (err.code === MediaError.MEDIA_ERR_NETWORK) {
            msg = "Network or file read error occurred";
          } else if (err.code === MediaError.MEDIA_ERR_DECODE) {
            msg = "Audio decode error (corrupt file)";
          }
        }
        useSampleStore
          .getState()
          .setStatusMessage(
            `Playback Error: ${msg} [${erroredFileName || latestSample?.file_name || ""}]`
          );
        setIsPlaying(false);
      }}
      onEnded={(e) => {
        const state = useSampleStore.getState();
        if (state.isLooping) {
          // If a slice ends right at file EOF, native `audio.loop` is false — restart at slice start!
          const audio = e.currentTarget;
          const restartSec = state.sliceRange ? state.sliceRange.startSec : 0;
          audio.currentTime = restartSec;
          resetPlayheadClock(restartSec);
          audio.play().catch(() => setIsPlaying(false));
        } else {
          const resetSec = state.sliceRange ? state.sliceRange.startSec : 0;
          setIsPlaying(false);
          setCurrentTimeSec(resetSec);
        }
      }}
      onPlay={() => {
        setIsPlaying(true);
      }}
    />
  );
};
