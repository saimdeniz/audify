import { invoke } from "@tauri-apps/api/core";
import { SampleItem, SliceRange } from "../../types";
import {
  isLayerDraftPreviewPending,
  isLayerDraftSample,
} from "../../utils/layerHelpers";
import { markLocalKeyEdited } from "../../utils/localStorageSafe";
import { resolveSamplesByIds } from "../../utils/sampleLookup";
import {
  getLayerDraftPlayheadSec,
  getPlayheadSec,
  resetPlayheadClock,
  setPlayheadSec,
} from "../playheadClock";
import {
  AUDIFY_STORAGE_KEYS,
  postCrossWindowSync,
  pushRecentSampleId,
  safeSetItem,
  saveLastSample,
} from "../storageHelpers";
import { SampleStoreState, StoreSliceContext } from "../types";

export interface PlaybackSliceTimers {
  flushPendingVolume: () => void;
  cancelPendingVolume: () => void;
}

export function createPlaybackSlice(
  ctx: StoreSliceContext,
  timers?: PlaybackSliceTimers
): Pick<
  SampleStoreState,
  | "selectSample"
  | "handleRowSelect"
  | "selectAllSamples"
  | "clearMultiSelection"
  | "selectRelativeSample"
  | "setIsPlaying"
  | "togglePlayPause"
  | "stopPlayback"
  | "toggleLooping"
  | "toggleShuffle"
  | "toggleAutoPreview"
  | "setVolume"
  | "toggleMute"
  | "setPitchSemitones"
  | "setCurrentTimeSec"
  | "setDurationSec"
  | "requestSeek"
  | "setSliceRange"
  | "setInAppDragSample"
  | "showInFolder"
> {
  const { set, get, emitNotice } = ctx;
  let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPendingVolume = () => {
    if (volumePersistTimer !== null) {
      clearTimeout(volumePersistTimer);
      volumePersistTimer = null;
    }
  };
  const flushPendingVolume = () => {
    if (volumePersistTimer !== null) {
      clearTimeout(volumePersistTimer);
      volumePersistTimer = null;
      safeSetItem(AUDIFY_STORAGE_KEYS.volume, String(get().volume), {
        broadcast: false,
      });
      void get().persistActiveProfileSettings(true);
    }
  };
  if (timers) {
    timers.flushPendingVolume = flushPendingVolume;
    timers.cancelPendingVolume = cancelPendingVolume;
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushPendingVolume);
  }

  return {
    selectSample: (sample: SampleItem, shouldPlay?: boolean) => {
      const isVirtualPreview = sample.id <= 0;
      if (!isVirtualPreview) {
        saveLastSample(sample);
      }
      const {
        autoPreview,
        selectedSample,
        samples,
        playTriggerSeq,
        recentOnly,
        recentSampleIds,
      } = get();
      const isSame = isVirtualPreview
        ? selectedSample?.file_path === sample.file_path
        : selectedSample?.id === sample.id;
      const targetSlice = isSame ? get().sliceRange : null;
      const initialTime = targetSlice ? targetSlice.startSec : 0;
      const playNow = shouldPlay !== undefined ? shouldPlay : autoPreview;
      const idx = samples.findIndex((s) => s.id === sample.id);
      const nextRecentIds =
        recentOnly || isVirtualPreview
          ? recentSampleIds
          : pushRecentSampleId(recentSampleIds, sample.id);
      const prevKnown = get().knownSampleIds;
      const nextKnownIds =
        !isVirtualPreview && sample.id > 0 && !prevKnown.has(sample.id)
          ? new Set([...prevKnown, sample.id])
          : prevKnown;

      resetPlayheadClock(initialTime);
      set({
        selectedSample: sample,
        selectedSampleIds: [sample.id],
        lastSelectedIndex: idx >= 0 ? idx : null,
        recentSampleIds: nextRecentIds,
        ...(nextKnownIds !== prevKnown ? { knownSampleIds: nextKnownIds } : {}),
        currentTimeSec: initialTime,
        durationSec: Math.max(0.01, sample.duration_ms / 1000),
        sliceRange: targetSlice,
        isPlaying: playNow,
        playTriggerSeq: playNow ? playTriggerSeq + 1 : playTriggerSeq,
      });
    },

    handleRowSelect: (
      sample: SampleItem,
      index: number,
      opts?: { ctrlKey?: boolean; shiftKey?: boolean }
    ) => {
      const {
        samples,
        selectedSampleIds,
        lastSelectedIndex,
        autoPreview,
        selectedSample,
        playTriggerSeq,
      } = get();

      const isCtrl = Boolean(opts?.ctrlKey);
      const isShift = Boolean(opts?.shiftKey);

      if (isShift && samples.length > 0) {
        const selectedIdx = selectedSample
          ? samples.findIndex((s) => s.id === selectedSample.id)
          : -1;
        const anchor =
          lastSelectedIndex !== null &&
          lastSelectedIndex >= 0 &&
          lastSelectedIndex < samples.length
            ? lastSelectedIndex
            : selectedIdx >= 0
            ? selectedIdx
            : index;
        const start = Math.max(0, Math.min(anchor, index));
        const end = Math.min(samples.length - 1, Math.max(anchor, index));
        const rangeIds = samples.slice(start, end + 1).map((s) => s.id);
        const merged = isCtrl
          ? Array.from(new Set([...selectedSampleIds, ...rangeIds]))
          : rangeIds;

        const samePrimary = selectedSample?.id === sample.id;
        if (!samePrimary) {
          resetPlayheadClock(0);
        }
        set({
          selectedSample: sample,
          selectedSampleIds: merged,
          lastSelectedIndex: anchor,
          ...(samePrimary
            ? {}
            : {
                sliceRange: null,
                currentTimeSec: 0,
                durationSec: Math.max(0.01, sample.duration_ms / 1000),
              }),
        });
        return;
      }

      if (isCtrl) {
        const exists = selectedSampleIds.includes(sample.id);
        const nextIds = exists
          ? selectedSampleIds.filter((id) => id !== sample.id)
          : [...selectedSampleIds, sample.id];

        let nextPrimary = selectedSample;
        if (!get().isPlaying && !exists) {
          nextPrimary = sample;
        } else if (selectedSample?.id === sample.id) {
          const fallbackId = nextIds[nextIds.length - 1];
          nextPrimary =
            fallbackId !== undefined
              ? samples.find((s) => s.id === fallbackId) ||
                get().allProfileSamples.find((s) => s.id === fallbackId) ||
                null
              : null;
        }

        const primaryChanged = nextPrimary?.id !== selectedSample?.id;
        if (primaryChanged) {
          resetPlayheadClock(0);
        }
        set({
          selectedSample: nextPrimary,
          selectedSampleIds: nextIds,
          lastSelectedIndex: index,
          ...(primaryChanged
            ? {
                sliceRange: null,
                currentTimeSec: 0,
                durationSec: nextPrimary
                  ? Math.max(0.01, nextPrimary.duration_ms / 1000)
                  : 0,
              }
            : {}),
        });
        return;
      }

      // Standard single click -> select single row and preview
      saveLastSample(sample);
      const isSame = selectedSample?.id === sample.id;
      const targetSlice = isSame ? get().sliceRange : null;
      const initialTime = targetSlice ? targetSlice.startSec : 0;
      const nextRecentIds = get().recentOnly
        ? get().recentSampleIds
        : pushRecentSampleId(get().recentSampleIds, sample.id);
      const prevKnown = get().knownSampleIds;
      const nextKnownIds =
        sample.id > 0 && !prevKnown.has(sample.id)
          ? new Set([...prevKnown, sample.id])
          : prevKnown;

      resetPlayheadClock(initialTime);
      set({
        selectedSample: sample,
        selectedSampleIds: [sample.id],
        lastSelectedIndex: index,
        recentSampleIds: nextRecentIds,
        ...(nextKnownIds !== prevKnown ? { knownSampleIds: nextKnownIds } : {}),
        currentTimeSec: initialTime,
        durationSec: Math.max(0.01, sample.duration_ms / 1000),
        sliceRange: targetSlice,
        isPlaying: autoPreview,
        playTriggerSeq: autoPreview ? playTriggerSeq + 1 : playTriggerSeq,
      });
    },

    selectAllSamples: () => {
      const { samples, selectedSample } = get();
      if (samples.length === 0) return;
      const nextPrimary =
        selectedSample && samples.some((s) => s.id === selectedSample.id)
          ? selectedSample
          : samples[0];
      const nextIdx = samples.findIndex((s) => s.id === nextPrimary.id);
      set({
        selectedSample: nextPrimary,
        selectedSampleIds: samples.map((s) => s.id),
        lastSelectedIndex: nextIdx >= 0 ? nextIdx : 0,
        statusMessage: `Selected all ${samples.length} samples`,
      });
    },

    clearMultiSelection: () => {
      const { selectedSample, samples } = get();
      const idx = selectedSample
        ? samples.findIndex((s) => s.id === selectedSample.id)
        : -1;
      set({
        selectedSampleIds: selectedSample ? [selectedSample.id] : [],
        lastSelectedIndex: idx >= 0 ? idx : null,
      });
    },

    selectRelativeSample: (delta: number) => {
      const {
        samples,
        selectedSample,
        autoPreview,
        playTriggerSeq,
        isShuffle,
        shuffleHistory,
      } = get();
      if (samples.length === 0) return;

      const currentIndex = selectedSample
        ? samples.findIndex((s) => s.id === selectedSample.id)
        : -1;

      let nextIndex = -1;
      let nextHistory = shuffleHistory;

      if (isShuffle && Math.abs(delta) === 1 && samples.length > 1) {
        if (delta < 0 && shuffleHistory.length > 0) {
          const histCopy = shuffleHistory.slice();
          while (histCopy.length > 0) {
            const prevId = histCopy.pop()!;
            const foundIdx = samples.findIndex((s) => s.id === prevId);
            if (foundIdx >= 0 && foundIdx !== currentIndex) {
              nextIndex = foundIdx;
              break;
            }
          }
          nextHistory = histCopy;
        }

        if (nextIndex === -1) {
          let randIdx = Math.floor(Math.random() * samples.length);
          if (randIdx === currentIndex) {
            randIdx = (randIdx + 1) % samples.length;
          }
          nextIndex = randIdx;
          if (delta > 0 && selectedSample) {
            nextHistory = [
              ...shuffleHistory.filter((id) => id !== selectedSample.id),
              selectedSample.id,
            ].slice(-100);
          }
        }
      } else {
        nextIndex = Math.max(
          0,
          Math.min(
            samples.length - 1,
            currentIndex === -1 ? 0 : currentIndex + delta
          )
        );
      }

      const target = samples[nextIndex];
      if (!target) return;
      saveLastSample(target);
      const nextRecentIds = get().recentOnly
        ? get().recentSampleIds
        : pushRecentSampleId(get().recentSampleIds, target.id);
      const prevKnown = get().knownSampleIds;
      const nextKnownIds =
        target.id > 0 && !prevKnown.has(target.id)
          ? new Set([...prevKnown, target.id])
          : prevKnown;

      resetPlayheadClock(0);
      set({
        selectedSample: target,
        selectedSampleIds: [target.id],
        lastSelectedIndex: nextIndex,
        shuffleHistory: nextHistory,
        recentSampleIds: nextRecentIds,
        ...(nextKnownIds !== prevKnown ? { knownSampleIds: nextKnownIds } : {}),
        currentTimeSec: 0,
        durationSec: Math.max(0.01, target.duration_ms / 1000),
        sliceRange: null,
        isPlaying: autoPreview,
        playTriggerSeq: autoPreview ? playTriggerSeq + 1 : playTriggerSeq,
      });
    },

    setIsPlaying: (isPlaying: boolean) => set({ isPlaying }),

    togglePlayPause: () => {
      const {
        isPlaying,
        selectedSample,
        samples,
        durationSec,
        sliceRange,
      } = get();
      if (!selectedSample && samples.length > 0) {
        get().selectSample(samples[0], true);
        return;
      }
      if (!selectedSample) return;
      if (selectedSample.id > 0) {
        saveLastSample(selectedSample);
      }

      if (
        !isPlaying &&
        isLayerDraftSample(selectedSample) &&
        (get().isRenderingLayerPreview || isLayerDraftPreviewPending())
      ) {
        void get().renderLayerDraftPreview({
          autoplay: true,
          startSec: getLayerDraftPlayheadSec(),
        });
        return;
      }

      const liveTime = getPlayheadSec();
      if (sliceRange) {
        const atSliceEnd = liveTime >= sliceRange.endSec - 0.05;
        const beforeSliceStart = liveTime < sliceRange.startSec - 0.05;
        if (!isPlaying && (atSliceEnd || beforeSliceStart)) {
          get().requestSeek(sliceRange.startSec, true);
          return;
        }
      } else {
        const atEnd = durationSec > 0 && liveTime >= durationSec - 0.05;
        if (!isPlaying && atEnd) {
          get().requestSeek(0, true);
          return;
        }
      }

      set({
        isPlaying: !isPlaying,
        currentTimeSec: liveTime,
      });
    },

    stopPlayback: () => {
      const { sliceRange } = get();
      const targetSec = sliceRange ? sliceRange.startSec : 0;
      const seq = (get().seekRequest?.seq || 0) + 1;
      resetPlayheadClock(targetSec);
      set({
        isPlaying: false,
        currentTimeSec: targetSec,
        seekRequest: { timeSec: targetSec, seq },
      });
    },

    toggleLooping: () => {
      const next = !get().isLooping;
      safeSetItem(AUDIFY_STORAGE_KEYS.isLooping, String(next));
      set({ isLooping: next });
      void get().persistActiveProfileSettings();
    },

    toggleShuffle: () => {
      const next = !get().isShuffle;
      safeSetItem(AUDIFY_STORAGE_KEYS.isShuffle, String(next));
      set({
        isShuffle: next,
        statusMessage: next
          ? "Shuffle mode enabled (Next / Previous will pick random tracks)"
          : "Shuffle mode disabled",
      });
      void get().persistActiveProfileSettings();
    },

    toggleAutoPreview: () => {
      const next = !get().autoPreview;
      safeSetItem(AUDIFY_STORAGE_KEYS.autoPreview, String(next));
      set({ autoPreview: next });
      void get().persistActiveProfileSettings();
    },

    setVolume: (volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      markLocalKeyEdited(AUDIFY_STORAGE_KEYS.volume);
      set((s) => ({
        volume: clamped,
        preMuteVolume: clamped > 0.02 ? clamped : s.preMuteVolume,
      }));
      postCrossWindowSync("live-visual", { volume: clamped });
      cancelPendingVolume();
      volumePersistTimer = setTimeout(() => {
        volumePersistTimer = null;
        safeSetItem(AUDIFY_STORAGE_KEYS.volume, String(clamped), {
          broadcast: false,
        });
        void get().persistActiveProfileSettings();
      }, 180);
    },

    toggleMute: () => {
      cancelPendingVolume();
      const { volume, preMuteVolume } = get();
      const nextVol =
        volume > 0.005 ? 0 : preMuteVolume > 0.02 ? preMuteVolume : 0.85;
      safeSetItem(AUDIFY_STORAGE_KEYS.volume, String(nextVol));
      set({
        preMuteVolume: volume > 0.005 ? volume : preMuteVolume,
        volume: nextVol,
      });
      void get().persistActiveProfileSettings();
    },

    setPitchSemitones: (semitones: number) => {
      const clamped = Number.isFinite(semitones)
        ? Math.max(-24, Math.min(24, Math.round(semitones)))
        : 0;
      set({ pitchSemitones: clamped });
    },

    setCurrentTimeSec: (currentTimeSec: number) => {
      setPlayheadSec(currentTimeSec);
      set({ currentTimeSec });
    },

    setDurationSec: (durationSec: number) => set({ durationSec }),

    requestSeek: (timeSec: number, playImmediately = true) => {
      const { durationSec } = get();
      const clampedTime =
        durationSec > 0
          ? Math.max(0, Math.min(durationSec, timeSec))
          : Math.max(0, timeSec);

      resetPlayheadClock(clampedTime);
      const seq = (get().seekRequest?.seq || 0) + 1;
      set((s) => ({
        currentTimeSec: clampedTime,
        seekRequest: { timeSec: clampedTime, seq },
        isPlaying: playImmediately ? true : s.isPlaying,
        playTriggerSeq: playImmediately
          ? s.playTriggerSeq + 1
          : s.playTriggerSeq,
      }));
    },

    setSliceRange: (sliceRange: SliceRange | null) => {
      const liveTime = getPlayheadSec();
      if (sliceRange) {
        if (liveTime < sliceRange.startSec || liveTime >= sliceRange.endSec) {
          resetPlayheadClock(sliceRange.startSec);
          const seq = (get().seekRequest?.seq || 0) + 1;
          set({
            sliceRange,
            currentTimeSec: sliceRange.startSec,
            seekRequest: { timeSec: sliceRange.startSec, seq },
          });
          return;
        }
      }
      set({ sliceRange });
    },

    setInAppDragSample: (
      inAppDragSample: SampleItem | null,
      opts?: { single?: boolean; origin?: "list" | "deck-header" }
    ) => {
      if (!inAppDragSample) {
        set({
          inAppDragSample: null,
          inAppDragSamples: [],
          inAppDragOrigin: null,
        });
        return;
      }
      const origin = opts?.origin ?? "list";
      if (opts?.single) {
        set({
          inAppDragSample,
          inAppDragSamples: [inAppDragSample],
          inAppDragOrigin: origin,
        });
        return;
      }
      const { selectedSampleIds, samples, allProfileSamples } = get();
      if (
        selectedSampleIds.includes(inAppDragSample.id) &&
        selectedSampleIds.length > 1
      ) {
        const batch = resolveSamplesByIds(
          selectedSampleIds,
          samples,
          allProfileSamples
        );
        set({
          inAppDragSample,
          inAppDragSamples: batch.length > 0 ? batch : [inAppDragSample],
          inAppDragOrigin: origin,
        });
      } else {
        set({
          inAppDragSample,
          inAppDragSamples: [inAppDragSample],
          inAppDragOrigin: origin,
        });
      }
    },

    showInFolder: async (filePath: string) => {
      try {
        await invoke("show_in_folder", { filePath });
        set({ statusMessage: `Revealed in Explorer: ${filePath}` });
      } catch (err) {
        console.error("Failed to reveal in folder:", err);
        emitNotice(`Explorer error: ${String(err)}`, "error");
      }
    },
  };
}
