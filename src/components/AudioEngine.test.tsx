// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const nativeAudioLoadMock = vi.fn();
const nativeAudioPlayMock = vi.fn(() => Promise.resolve());
const nativeAudioPauseMock = vi.fn(() => Promise.resolve());
const nativeAudioUnloadMock = vi.fn(() => Promise.resolve());
const nativeAudioSeekMock = vi.fn((_pos?: number) => Promise.resolve());
const nativeAudioSetDeviceMock = vi.fn(() => Promise.resolve());
const nativeAudioSetParamsMock = vi.fn((_params?: unknown) => Promise.resolve());
let syncListener: ((payload: unknown) => void) | null = null;
const subscribeNativeAudioSyncMock = vi.fn(
  (cb: (payload: unknown) => void) => {
    syncListener = cb;
    return Promise.resolve(() => {
      syncListener = null;
    });
  }
);

vi.mock("../services/nativeAudioClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/nativeAudioClient")>();
  return {
    ...actual,
    isTauriNativeAudioRuntime: () => true,
    nativeAudioLoad: (...args: unknown[]) => nativeAudioLoadMock(...args),
    nativeAudioPlay: () => nativeAudioPlayMock(),
    nativeAudioPause: () => nativeAudioPauseMock(),
    nativeAudioUnload: () => nativeAudioUnloadMock(),
    nativeAudioSeek: (pos: number) => nativeAudioSeekMock(pos),
    nativeAudioSetDevice: () => nativeAudioSetDeviceMock(),
    nativeAudioSetParams: (params?: unknown) => nativeAudioSetParamsMock(params),
    subscribeNativeAudioSync: (cb: (payload: unknown) => void) =>
      subscribeNativeAudioSyncMock(cb),
  };
});

import { getPlayheadSec } from "../store/playheadClock";
import { useSampleStore } from "../store/useSampleStore";
import type { SampleItem } from "../types";
import { AudioEngine } from "./AudioEngine";

const SAMPLE_A: SampleItem = {
  id: 101,
  library_id: 1,
  file_path: "C:/Sounds/Loops/ambient_pad.wav",
  file_name: "ambient_pad.wav",
  folder_path: "C:/Sounds/Loops",
  extension: "wav",
  duration_ms: 8000,
  sample_rate: 48000,
  channels: 2,
  bit_depth: 24,
  file_size: 1200000,
  is_favorite: false,
  is_loop: true,
  genre: "",
  artist: "",
  album: "",
  year: "",
  bpm: 120,
  musical_key: "Am",
  peaks_json: "[]",
  created_at: "2026-11-22T00:00:00Z",
  tags: [],
};

describe("AudioEngine native bridge stability across visual re-renders", () => {
  beforeEach(() => {
    nativeAudioLoadMock.mockReset();
    nativeAudioLoadMock.mockResolvedValue({
      seq: 1,
      event: "playing",
      filePath: SAMPLE_A.file_path,
      isPlaying: true,
      positionSec: 0,
      durationSec: 8,
      playbackRate: 1,
      activeDeviceId: "default",
      activeDeviceName: "System Default",
      outputLatencyMs: 12,
      error: null,
    });
    subscribeNativeAudioSyncMock.mockClear();
    nativeAudioPlayMock.mockClear();
    nativeAudioPauseMock.mockClear();

    useSampleStore.setState({
      selectedSample: SAMPLE_A,
      isPlaying: true,
      playTriggerSeq: 1,
      seekRequest: null,
      sliceRange: null,
      pitchSemitones: 0,
      themeMode: "dark",
      wallpaperKind: "none",
      customBgImage: "",
      asciiPreset: "aurora_cabin",
    });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({
      selectedSample: null,
      isPlaying: false,
    });
    vi.clearAllMocks();
  });

  it("never restarts playback or re-subscribes when parent/theme/wallpaper/ASCII state changes", async () => {
    const { rerender } = render(<AudioEngine />);

    await waitFor(() => {
      expect(nativeAudioLoadMock).toHaveBeenCalledTimes(1);
    });
    expect(subscribeNativeAudioSyncMock).toHaveBeenCalledTimes(1);

    // Simulate parent <App /> re-renders caused by switching theme, ASCII, image wallpaper, blur
    act(() => {
      useSampleStore.setState({
        themeMode: "light",
        wallpaperKind: "ascii_preset",
        asciiPreset: "koi_pond",
      });
    });
    rerender(<AudioEngine />);

    act(() => {
      useSampleStore.setState({
        themeMode: "dark",
        wallpaperKind: "image",
        customBgImage: "C:/Audify/user/images/bg.png",
        customBgBlur: 12,
      });
    });
    rerender(<AudioEngine />);

    expect(nativeAudioLoadMock).toHaveBeenCalledTimes(1);
    expect(subscribeNativeAudioSyncMock).toHaveBeenCalledTimes(1);
  });

  it("seeks in place via nativeAudioSeek + nativeAudioPlay without reloading the already-loaded track", async () => {
    render(<AudioEngine />);

    await waitFor(() => {
      expect(nativeAudioLoadMock).toHaveBeenCalledTimes(1);
    });

    nativeAudioSeekMock.mockClear();
    nativeAudioPlayMock.mockClear();

    act(() => {
      useSampleStore.getState().requestSeek(3.5, true);
    });

    await waitFor(() => {
      expect(nativeAudioSeekMock).toHaveBeenCalledWith(3.5);
    });
    expect(nativeAudioLoadMock).toHaveBeenCalledTimes(1);
    expect(nativeAudioPlayMock).toHaveBeenCalledTimes(1);
  });

  it("ignores stale ended sync events from a previous track after switching tracks", async () => {
    const sampleB: SampleItem = {
      ...SAMPLE_A,
      id: 102,
      file_path: "C:/Sounds/Loops/bass_loop.wav",
      file_name: "bass_loop.wav",
    };

    nativeAudioLoadMock.mockImplementation((req: { filePath: string }) =>
      Promise.resolve({
        seq: req.filePath === sampleB.file_path ? 2 : 1,
        event: "playing",
        filePath: req.filePath,
        isPlaying: true,
        positionSec: 0,
        durationSec: 8,
        playbackRate: 1,
        activeDeviceId: "default",
        activeDeviceName: "System Default",
        outputLatencyMs: 12,
        error: null,
      })
    );

    render(<AudioEngine />);

    await waitFor(() => {
      expect(nativeAudioLoadMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useSampleStore.setState({
        selectedSample: sampleB,
        isPlaying: true,
        playTriggerSeq: 2,
      });
    });

    await waitFor(() => {
      expect(nativeAudioLoadMock).toHaveBeenCalledTimes(2);
    });

    // Deliver a stale "ended" event belonging to Track A
    act(() => {
      syncListener?.({
        seq: 1,
        event: "ended",
        filePath: SAMPLE_A.file_path,
        isPlaying: false,
        positionSec: 8,
        durationSec: 8,
        playbackRate: 1,
        activeDeviceId: "default",
        activeDeviceName: "System Default",
        outputLatencyMs: 12,
        error: null,
      });
    });

    expect(useSampleStore.getState().isPlaying).toBe(true);
    expect(useSampleStore.getState().selectedSample?.id).toBe(sampleB.id);
  });

  it("isolates layer://draft playback from global top-deck pitchSemitones", async () => {
    const draftSample: SampleItem = {
      ...SAMPLE_A,
      id: -999999,
      file_path: "layer://draft",
      file_name: "Draft_Mix.wav",
      duration_ms: 1000,
    };

    useSampleStore.setState({
      selectedSample: draftSample,
      isPlaying: false,
      pitchSemitones: -12,
      playTriggerSeq: 1,
    });

    nativeAudioSetParamsMock.mockClear();
    render(<AudioEngine />);

    await waitFor(() => {
      expect(nativeAudioSetParamsMock).toHaveBeenCalled();
    });
    const calls = nativeAudioSetParamsMock.mock.calls;
    const lastArgs = calls[calls.length - 1]?.[0] as {
      pitchSemitones?: number;
      updateSlice?: boolean;
    };
    expect(lastArgs.pitchSemitones).toBe(0);
    expect(lastArgs.updateSlice).toBe(false);
  });

  it("holds playhead at 0 while cold nativeAudioLoad is decoding and ignores duplicate seq reset", async () => {
    let resolveLoad!: (payload: unknown) => void;
    nativeAudioLoadMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );

    let nowMs = 1000;
    const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    let queuedRaf: FrameRequestCallback | null = null;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        queuedRaf = cb;
        return 1;
      });
    const cancelRafSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {
        queuedRaf = null;
      });

    try {
      render(<AudioEngine />);

      // Simulate 140ms passing while Rust is still decoding the cold track on disk
      nowMs = 1140;
      act(() => {
        queuedRaf?.(nowMs);
      });
      expect(getPlayheadSec()).toBe(0);

      // Rust finishes decoding and emits `"playing"` (`seq: 10`) on the sync channel first
      const playingPayload = {
        seq: 10,
        event: "playing",
        filePath: SAMPLE_A.file_path,
        isPlaying: true,
        positionSec: 0,
        durationSec: 8,
        playbackRate: 1,
        activeDeviceId: "default",
        activeDeviceName: "System Default",
        outputLatencyMs: 0,
        error: null,
      };
      act(() => {
        syncListener?.(playingPayload);
      });

      // Playhead advances smoothly for 60ms after audio truly starts
      nowMs = 1200;
      act(() => {
        queuedRaf?.(nowMs);
      });
      expect(getPlayheadSec()).toBeCloseTo(0.06, 3);

      // Duplicate `seq: 10` arrives from the `nativeAudioLoad` promise resolution — must NOT snap back to 0!
      await act(async () => {
        resolveLoad(playingPayload);
        await Promise.resolve();
      });
      expect(getPlayheadSec()).toBeCloseTo(0.06, 3);
    } finally {
      perfSpy.mockRestore();
      rafSpy.mockRestore();
      cancelRafSpy.mockRestore();
    }
  });
});
