import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  computeInterpolatedPlayheadSec,
  isTauriNativeAudioRuntime,
  nativeAudioLoad,
  nativeAudioPause,
  nativeAudioPlay,
  nativeAudioSeek,
  nativeAudioSetDevice,
  nativeAudioSetParams,
  nativeAudioUnload,
  subscribeNativeAudioSync,
  type AudioSyncPayload,
  type PlayheadAnchor,
} from "../services/nativeAudioClient";
import {
  getLayerDraftPlayheadSec,
  getPlayheadSec,
  resetPlayheadClock,
  setPlayheadSec,
} from "../store/playheadClock";
import { useSampleStore } from "../store/useSampleStore";
import {
  isViewportRenderActive,
  subscribeAppActivity,
} from "../utils/appFocusMonitor";
import { isLayerDraftSample } from "../utils/layerHelpers";
import { normalizePathForMatch } from "../utils/pathHelpers";

const LazyHtmlAudioFallbackEngine = lazy(() =>
  import("./HtmlAudioFallbackEngine").then((m) => ({
    default: m.HtmlAudioFallbackEngine,
  }))
);

const DEFAULT_ANCHOR: PlayheadAnchor = {
  positionSec: 0,
  anchorMs: 0,
  playbackRate: 1,
  durationSec: 0,
  isPlaying: false,
  outputLatencyMs: 12,
};

/**
 * Persistent headless audio engine mounted once at the root of `<App />`.
 *
 * Uses Audify's Native Rust Audio Engine (`cpal` + `symphonia` WASAPI shared)
 * for low-latency DAW-grade preview, 0-sample slice looping, live Hermite
 * varispeed, auto-gain, and zero fallback WAV files. Transparently falls back
 * to `<HtmlAudioFallbackEngine />` in non-Tauri / test runtimes.
 */
export const AudioEngine: React.FC = React.memo(() => {
  const [useNative, setUseNative] = useState<boolean>(() =>
    isTauriNativeAudioRuntime()
  );
  const handleFallback = useCallback(() => {
    setUseNative(false);
  }, []);

  if (!useNative) {
    return (
      <Suspense fallback={null}>
        <LazyHtmlAudioFallbackEngine />
      </Suspense>
    );
  }

  return <NativeRustAudioBridge onFallback={handleFallback} />;
});

const NativeRustAudioBridge: React.FC<{ onFallback: () => void }> = React.memo(
  ({ onFallback }) => {
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

    const onFallbackRef = useRef(onFallback);
    onFallbackRef.current = onFallback;

  const anchorRef = useRef<PlayheadAnchor>({ ...DEFAULT_ANCHOR });
  const lastSyncSeqRef = useRef<number>(0);
  const lastAppliedSeekSeqRef = useRef<number>(0);
  const loadRequestSeqRef = useRef<number>(0);
  const loadedSampleRef = useRef<{ id: number; path: string } | null>(null);
  const loadingSampleRef = useRef<{ id: number; path: string } | null>(null);
  const pendingSeekDuringLoadRef = useRef<number | null>(null);
  const lastLoadHandledRef = useRef<{
    sampleId: number | null;
    triggerSeq: number;
    isPlaying: boolean;
  } | null>(null);
  const lastEngineForcedPlayingRef = useRef<boolean | null>(null);
  const rafRef = useRef<number | null>(null);

  const effectiveDuration = Math.max(
    0.05,
    durationSec || (selectedSample ? selectedSample.duration_ms / 1000 : 1)
  );

  const applySyncPayload = (payload: AudioSyncPayload) => {
    if (payload.event === "superseded") return;
    if (payload.seq > 0 && payload.seq < lastSyncSeqRef.current) return;

    const state = useSampleStore.getState();
    // Drop stale events from a previously selected track during rapid switching
    if (
      payload.filePath &&
      state.selectedSample &&
      normalizePathForMatch(payload.filePath) !==
        normalizePathForMatch(state.selectedSample.file_path)
    ) {
      return;
    }

    lastSyncSeqRef.current = payload.seq;

    const nowMs = performance.now();
    anchorRef.current = {
      positionSec: payload.positionSec,
      anchorMs: nowMs,
      playbackRate: payload.playbackRate || 1,
      durationSec: payload.durationSec || anchorRef.current.durationSec,
      isPlaying: payload.isPlaying,
      outputLatencyMs: payload.outputLatencyMs ?? 12,
    };

    if (payload.durationSec > 0) {
      state.setDurationSec(payload.durationSec);
    }

    if (payload.event === "ended") {
      const resetSec = state.sliceRange ? state.sliceRange.startSec : 0;
      anchorRef.current.isPlaying = false;
      anchorRef.current.positionSec = resetSec;
      resetPlayheadClock(resetSec);
      state.setCurrentTimeSec(resetSec);
      if (state.isPlaying) {
        lastEngineForcedPlayingRef.current = false;
        state.setIsPlaying(false);
      }
    } else if (payload.event === "paused" || payload.event === "stopped") {
      if (payload.event === "stopped" && !payload.filePath) {
        // Handle was released/unloaded on the Rust side (e.g. rename/trash/unload);
        // clear loaded cache so the next Play/Seek reloads instead of targeting empty DSP.
        loadedSampleRef.current = null;
      }
      resetPlayheadClock(payload.positionSec);
      state.setCurrentTimeSec(payload.positionSec);
    } else if (
      payload.event === "looped" ||
      payload.event === "seeked" ||
      payload.event === "loaded" ||
      payload.event === "playing"
    ) {
      resetPlayheadClock(payload.positionSec);
    } else if (payload.event === "error" && payload.error) {
      anchorRef.current.isPlaying = false;
      const fileLabel = state.selectedSample?.file_name || "";
      state.setStatusMessage(
        `Playback Error: ${payload.error}${fileLabel ? ` [${fileLabel}]` : ""}`
      );
      if (state.isPlaying) {
        lastEngineForcedPlayingRef.current = false;
        state.setIsPlaying(false);
      }
    }
  };

  // Subscribe to discrete Rust audio state/heartbeat sync events
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void subscribeNativeAudioSync((payload) => {
      if (active) {
        applySyncPayload(payload);
      }
    })
      .then((fn) => {
        if (!active) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        if (active) onFallbackRef.current();
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Route WASAPI output device cleanly whenever setting changes
  useEffect(() => {
    void nativeAudioSetDevice(audioOutputDeviceId || "default").catch(() => {});
  }, [audioOutputDeviceId]);

  // Load & optionally autoplay whenever active sample or explicit trigger changes
  useEffect(() => {
    const state = useSampleStore.getState();
    const activeSample = state.selectedSample;
    const reqSeq = ++loadRequestSeqRef.current;

    if (selectedSampleId === null || !activeSample) {
      loadedSampleRef.current = null;
      loadingSampleRef.current = null;
      pendingSeekDuringLoadRef.current = null;
      anchorRef.current = { ...DEFAULT_ANCHOR };
      resetPlayheadClock(0);
      lastLoadHandledRef.current = {
        sampleId: null,
        triggerSeq: playTriggerSeq,
        isPlaying: false,
      };
      if (state.isPlaying) {
        lastEngineForcedPlayingRef.current = false;
        state.setIsPlaying(false);
      }
      void nativeAudioUnload().catch(() => {});
      return;
    }

    if (activeSample.duration_ms > 0) {
      state.setDurationSec(activeSample.duration_ms / 1000);
    }

    const isDraft = isLayerDraftSample(activeSample);
    const hasUnappliedSeek =
      state.seekRequest !== null &&
      state.seekRequest.seq !== lastAppliedSeekSeqRef.current;
    let startSec = isDraft
      ? Math.max(0, getLayerDraftPlayheadSec())
      : state.sliceRange
      ? state.sliceRange.startSec
      : 0;
    if (hasUnappliedSeek && state.seekRequest) {
      lastAppliedSeekSeqRef.current = state.seekRequest.seq;
      startSec = state.seekRequest.timeSec;
    }

    // Fast path: waveform click (`requestSeek(..., true)`) on the already-loaded track
    // must seek in-place instead of re-decoding the entire file from scratch.
    const sameTrackAlreadyLoaded =
      loadedSampleRef.current !== null &&
      loadedSampleRef.current.id === activeSample.id &&
      loadedSampleRef.current.path === activeSample.file_path;

    resetPlayheadClock(startSec);
    anchorRef.current = {
      positionSec: startSec,
      anchorMs: performance.now(),
      playbackRate:
        isDraft || state.pitchSemitones === 0
          ? 1
          : Math.max(0.25, Math.min(4.0, Math.pow(2, state.pitchSemitones / 12))),
      durationSec:
        activeSample.duration_ms > 0 ? activeSample.duration_ms / 1000 : 0,
      isPlaying: state.isPlaying,
      outputLatencyMs: anchorRef.current.outputLatencyMs,
    };

    lastLoadHandledRef.current = {
      sampleId: selectedSampleId,
      triggerSeq: playTriggerSeq,
      isPlaying: state.isPlaying,
    };

    if (isLayerDraftSample(activeSample)) {
      // Live Layers Editor drafts are loaded straight into native WASAPI RAM via `preview_layer_mix`.
      loadedSampleRef.current = {
        id: activeSample.id,
        path: activeSample.file_path,
      };
      loadingSampleRef.current = null;
      pendingSeekDuringLoadRef.current = null;
      if (hasUnappliedSeek) {
        void nativeAudioSeek(startSec).catch(() => {});
        if (state.isPlaying) {
          void nativeAudioPlay().catch(() => {
            lastEngineForcedPlayingRef.current = false;
            useSampleStore.getState().setIsPlaying(false);
          });
        }
      } else if (state.isPlaying && sameTrackAlreadyLoaded) {
        void nativeAudioPlay().catch(() => {
          lastEngineForcedPlayingRef.current = false;
          useSampleStore.getState().setIsPlaying(false);
        });
      }
      return;
    }

    if (sameTrackAlreadyLoaded && hasUnappliedSeek) {
      void nativeAudioSeek(startSec).catch(() => {});
      if (state.isPlaying) {
        void nativeAudioPlay().catch(() => {
          lastEngineForcedPlayingRef.current = false;
          useSampleStore.getState().setIsPlaying(false);
        });
      }
      return;
    }

    // Mark the track as in-flight rather than already loaded so mid-load seeks
    // are queued for the new track instead of racing onto the previous track.
    loadedSampleRef.current = null;
    loadingSampleRef.current = {
      id: activeSample.id,
      path: activeSample.file_path,
    };
    pendingSeekDuringLoadRef.current = null;

    const sentParams = {
      volume: state.volume,
      pitchSemitones: state.pitchSemitones,
      looping: state.isLooping,
      normalizePreview: state.normalizePreview,
      sliceStartSec: state.sliceRange ? state.sliceRange.startSec : null,
      sliceEndSec: state.sliceRange ? state.sliceRange.endSec : null,
    };

    void nativeAudioLoad({
      filePath: activeSample.file_path,
      autoplay: state.isPlaying,
      startSec,
      sliceStartSec: sentParams.sliceStartSec,
      sliceEndSec: sentParams.sliceEndSec,
      volume: sentParams.volume,
      pitchSemitones: sentParams.pitchSemitones,
      looping: sentParams.looping,
      normalizePreview: sentParams.normalizePreview,
      skipLeadingSilence: state.skipLeadingSilence,
    })
      .then((payload) => {
        if (reqSeq !== loadRequestSeqRef.current) return;
        loadingSampleRef.current = null;
        loadedSampleRef.current = {
          id: activeSample.id,
          path: activeSample.file_path,
        };
        const queuedSeek = pendingSeekDuringLoadRef.current;
        pendingSeekDuringLoadRef.current = null;

        // Always apply sync metadata (durationSec, seq, device) before honoring mid-load state changes
        applySyncPayload(payload);

        const liveNow = useSampleStore.getState();
        const liveSliceStart = liveNow.sliceRange ? liveNow.sliceRange.startSec : null;
        const liveSliceEnd = liveNow.sliceRange ? liveNow.sliceRange.endSec : null;
        if (
          liveNow.volume !== sentParams.volume ||
          liveNow.pitchSemitones !== sentParams.pitchSemitones ||
          liveNow.isLooping !== sentParams.looping ||
          liveNow.normalizePreview !== sentParams.normalizePreview ||
          liveSliceStart !== sentParams.sliceStartSec ||
          liveSliceEnd !== sentParams.sliceEndSec
        ) {
          void nativeAudioSetParams({
            volume: liveNow.volume,
            pitchSemitones: liveNow.pitchSemitones,
            looping: liveNow.isLooping,
            normalizePreview: liveNow.normalizePreview,
            updateSlice: true,
            sliceStartSec: liveSliceStart,
            sliceEndSec: liveSliceEnd,
          }).catch(() => {});
        }

        if (queuedSeek !== null) {
          const clamped =
            payload.durationSec > 0
              ? Math.max(0, Math.min(payload.durationSec, queuedSeek))
              : Math.max(0, queuedSeek);
          anchorRef.current.positionSec = clamped;
          anchorRef.current.anchorMs = performance.now();
          resetPlayheadClock(clamped);
          void nativeAudioSeek(clamped).catch(() => {});
        }

        // If user pressed Pause while decode was in-flight, honor Pause immediately
        if (!liveNow.isPlaying && payload.isPlaying) {
          anchorRef.current.isPlaying = false;
          void nativeAudioPause().catch(() => {});
          return;
        }
        // Symmetric race fix: if user pressed Play while an autoplay:false load was in-flight,
        // start playback now that the new track is actually loaded in the engine.
        if (liveNow.isPlaying && !payload.isPlaying) {
          anchorRef.current.isPlaying = true;
          anchorRef.current.anchorMs = performance.now();
          void nativeAudioPlay().catch(() => {
            lastEngineForcedPlayingRef.current = false;
            useSampleStore.getState().setIsPlaying(false);
          });
        }
      })
      .catch((err) => {
        if (reqSeq !== loadRequestSeqRef.current) return;
        loadingSampleRef.current = null;
        loadedSampleRef.current = null;
        pendingSeekDuringLoadRef.current = null;
        const msg = String(err || "Audio load failed");
        if (msg.includes("Native audio engine is not initialized")) {
          onFallbackRef.current();
          return;
        }
        const live = useSampleStore.getState();
        if (live.selectedSample?.id !== activeSample.id) return;
        live.setStatusMessage(
          `Playback Error: ${msg} [${activeSample.file_name}]`
        );
        lastEngineForcedPlayingRef.current = false;
        live.setIsPlaying(false);
      });
  }, [selectedSampleId, selectedSampleFilePath, playTriggerSeq]);

  // Sync play / pause toggles without re-decoding the active sample
  useEffect(() => {
    const handled = lastLoadHandledRef.current;
    if (
      handled &&
      handled.sampleId === selectedSampleId &&
      handled.triggerSeq === playTriggerSeq &&
      handled.isPlaying === isPlaying
    ) {
      lastLoadHandledRef.current = null;
      return;
    }
    lastLoadHandledRef.current = null;

    if (lastEngineForcedPlayingRef.current === isPlaying) {
      lastEngineForcedPlayingRef.current = null;
      return;
    }
    lastEngineForcedPlayingRef.current = null;

    if (selectedSampleId === null) return;
    // Defer Play/Pause commands while a track load IPC is still in-flight so we never
    // accidentally resume/pause the previously loaded track; `.then(payload)` reconciles.
    if (loadingSampleRef.current) return;

    if (isPlaying) {
      anchorRef.current.isPlaying = true;
      anchorRef.current.anchorMs = performance.now();
      void nativeAudioPlay().catch(() => {
        lastEngineForcedPlayingRef.current = false;
        setIsPlaying(false);
      });
    } else {
      anchorRef.current.isPlaying = false;
      const pausedSec = getPlayheadSec();
      anchorRef.current.positionSec = pausedSec;
      setCurrentTimeSec(pausedSec);
      void nativeAudioPause().catch(() => {});
    }
  }, [isPlaying, selectedSampleId, playTriggerSeq, setCurrentTimeSec, setIsPlaying]);

  // Sync live DSP parameters (volume, varispeed pitch, loop, auto-gain, slice bounds)
  useEffect(() => {
    const isDraft = isLayerDraftSample(useSampleStore.getState().selectedSample);
    const effectivePitch = isDraft ? 0 : pitchSemitones;
    const rate =
      effectivePitch === 0
        ? 1
        : Math.max(0.25, Math.min(4.0, Math.pow(2, effectivePitch / 12)));
    const nowMs = performance.now();
    if (anchorRef.current.isPlaying) {
      const currentPos = computeInterpolatedPlayheadSec(
        anchorRef.current,
        nowMs,
        0,
        isDraft ? null : sliceRange,
        isLooping
      );
      anchorRef.current.positionSec = currentPos;
      anchorRef.current.anchorMs = nowMs;
    }
    anchorRef.current.playbackRate = rate;

    void nativeAudioSetParams({
      volume,
      pitchSemitones: effectivePitch,
      looping: isLooping,
      normalizePreview,
      updateSlice: !isDraft,
      sliceStartSec: !isDraft && sliceRange ? sliceRange.startSec : null,
      sliceEndSec: !isDraft && sliceRange ? sliceRange.endSec : null,
    }).catch(() => {});
  }, [volume, pitchSemitones, isLooping, normalizePreview, sliceRange]);

  // Handle explicit seek requests once per unique `seekRequest.seq`
  useEffect(() => {
    if (!seekRequest || selectedSampleId === null) return;
    if (seekRequest.seq === lastAppliedSeekSeqRef.current) return;
    lastAppliedSeekSeqRef.current = seekRequest.seq;

    const targetSec = Math.max(
      0,
      Math.min(effectiveDuration, seekRequest.timeSec)
    );

    anchorRef.current.positionSec = targetSec;
    anchorRef.current.anchorMs = performance.now();
    resetPlayheadClock(targetSec);
    // If a new track is still decoding in Rust, queue this seek until load resolves
    // instead of firing `nativeAudioSeek` against the previous track.
    if (loadingSampleRef.current !== null) {
      pendingSeekDuringLoadRef.current = targetSec;
      return;
    }
    void nativeAudioSeek(targetSec).catch(() => {});
  }, [seekRequest, selectedSampleId, effectiveDuration]);

  // Smooth 60–144 Hz local monotonic playhead animation (zero per-frame IPC;
  // stays smooth while Always-on-Top Mini Dock is unfocused beside an NLE, and
  // pauses rAF automatically when hidden/minimized or Edge-Peek collapsed)
  useEffect(() => {
    if (!isPlaying) return;

    const tick = () => {
      const live = useSampleStore.getState();
      if (!live.isPlaying || !isViewportRenderActive()) {
        rafRef.current = null;
        return;
      }
      const sec = computeInterpolatedPlayheadSec(
        anchorRef.current,
        performance.now(),
        live.playheadLatencyMs,
        live.sliceRange,
        live.isLooping
      );
      setPlayheadSec(sec);
      rafRef.current = requestAnimationFrame(tick);
    };

    const startIfActive = () => {
      if (rafRef.current === null && isViewportRenderActive()) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const unsubActivity = subscribeAppActivity(() => {
      if (isViewportRenderActive()) {
        startIfActive();
      } else if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    });

    startIfActive();
    return () => {
      unsubActivity();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, isLooping, sliceRange, playheadLatencyMs]);

  return null;
});
