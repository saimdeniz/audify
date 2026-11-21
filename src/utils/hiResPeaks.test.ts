// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { clearHiResPeaksCache, useHiResPeaks } from "./hiResPeaks";

describe("useHiResPeaks adaptive debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([255, 128, 64]);
    clearHiResPeaksCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearHiResPeaksCache();
  });

  it("fires immediately (0ms) on idle clicks, debounces rapid scrubbing (95ms), and resets after idle", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string | undefined }) => useHiResPeaks(path),
      { initialProps: { path: "D:/Music/track_a.mp3" as string | undefined } }
    );

    // First selection after idle fires immediately without waiting 95ms
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith("get_hires_peaks", {
      filePath: "D:/Music/track_a.mp3",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual([1, 128 / 255, 64 / 255]);

    // Rapid scrubbing (< 200ms): intermediate tracks must be skipped
    vi.advanceTimersByTime(40);
    rerender({ path: "D:/Music/track_b.mp3" });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(40);
    rerender({ path: "D:/Music/track_c.mp3" });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // After 95ms debounce on the final scrubbed track, only track_c is fetched
    await act(async () => {
      vi.advanceTimersByTime(95);
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("get_hires_peaks", {
      filePath: "D:/Music/track_c.mp3",
    });

    // After pausing >= 200ms, the next click fires immediately at 0ms again
    vi.advanceTimersByTime(250);
    rerender({ path: "D:/Music/track_d.mp3" });
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenLastCalledWith("get_hires_peaks", {
      filePath: "D:/Music/track_d.mp3",
    });
  });
});
