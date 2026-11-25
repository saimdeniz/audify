// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { SampleItem, Tag, TagFacet } from "../types";

const invokeMock = vi.fn();
const retainConsumerMock = vi.fn();
const releaseConsumerMock = vi.fn();
const loadPieceMock = vi.fn();
const computeFrameMock = vi.fn();
const renderAsciiMagicFrameMock = vi.fn();
const releaseCanvasRenderCachesMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../utils/asciiMagic/sandboxBridge", () => ({
  asciiMagicSandbox: {
    retainConsumer: () => retainConsumerMock(),
    releaseConsumer: () => releaseConsumerMock(),
    loadPiece: (...args: unknown[]) => loadPieceMock(...args),
    computeFrame: (...args: unknown[]) => computeFrameMock(...args),
  },
}));

vi.mock("../utils/asciiMagic/frameRenderer", () => ({
  renderAsciiMagicFrame: (...args: unknown[]) =>
    renderAsciiMagicFrameMock(...args),
  releaseCanvasRenderCaches: (...args: unknown[]) =>
    releaseCanvasRenderCachesMock(...args),
}));

import { AppAtmosphereViewport } from "./AppAtmosphereViewport";
import { AsciiMagicCanvas } from "./AsciiMagicCanvas";
import { ToolbarQuickTagCloud } from "./sample-table/ToolbarQuickTagCloud";
import { resolveInitialSelectedSample } from "../store/slices/catalogStartupHydration";
import {
  applyLiveVisualPatch,
  applyRemoteSettingsFromStorage,
} from "../store/slices/remoteVisualListeners";
import { AUDIFY_STORAGE_KEYS, safeSetItem } from "../store/storageHelpers";
import { useSampleStore } from "../store/useSampleStore";
import { buildDistinctiveTopTags } from "../utils/taxonomyTree";

function makeSample(id: number, overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/sample_${id}.wav`,
    file_name: `sample_${id}.wav`,
    folder_path: "D:/SFX",
    extension: "wav",
    duration_ms: 1200,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 4096,
    is_favorite: false,
    is_loop: false,
    genre: "Acoustic",
    artist: "",
    album: "",
    year: "",
    bpm: null,
    musical_key: "",
    camelot_key: "",
    peaks_json: "[0.2,0.8]",
    tags: [],
    created_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("startup zero-jump & atmosphere 60fps regression fixes", () => {
  const observeSpy = vi.fn();
  const disconnectSpy = vi.fn();

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    retainConsumerMock.mockReset();
    releaseConsumerMock.mockReset();
    loadPieceMock.mockReset();
    computeFrameMock.mockReset();
    renderAsciiMagicFrameMock.mockReset();
    releaseCanvasRenderCachesMock.mockReset();
    observeSpy.mockReset();
    disconnectSpy.mockReset();

    class MockResizeObserver {
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = disconnectSpy;
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    loadPieceMock.mockResolvedValue({
      meta: {
        slug: "neon-rain",
        name: "Neon Rain",
        category: "weather",
        cols: 40,
        rows: 20,
        fps: 15,
        cell: "mono",
        look: "original",
        still: true,
        dots: null,
        palette: { a: "#38bdf8" },
      },
      frame: { text: "████", color: "aaaa", paletteOverride: null },
    });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          setTransform: vi.fn(),
          clearRect: vi.fn(),
        }) as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1280,
      height: 720,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps Stage 1 sorted rows intact without unshifting an off-page saved sample into row 0", () => {
    const first = makeSample(1, { file_name: "agats-splash.mp3", genre: "Acoustic" });
    const second = makeSample(2, { file_name: "Almost Bliss.mp3", genre: "Acoustic" });
    const savedOffPage = makeSample(5000, {
      file_name: "Guts and Bourbon.mp3",
      genre: "Rock",
    });

    const filteredInitial = [first, second];
    const { initialSelected, initialIdx } = resolveInitialSelectedSample({
      filteredInitial,
      directSavedSample: savedOffPage,
      savedLast: { id: 5000, path: savedOffPage.file_path },
      libraries: [
        {
          id: 1,
          path: "D:/SFX",
          name: "SFX",
          last_scanned_at: "2026-01-01",
          sample_count: 45770,
          is_global: true,
          assigned_to_profile: true,
        },
      ],
      folderFilter: null,
      favoriteOnly: false,
      recentOnly: false,
      recentSampleIds: [],
      binFilterActive: false,
      binSampleIds: [],
      collectionId: null,
      licenseGroup: null,
      typeFilter: "all",
      srFilter: null,
    });

    // Saved sample stays loaded for the waveform deck, while row 0..N never shift
    expect(initialSelected?.id).toBe(5000);
    expect(initialIdx).toBe(-1);
    expect(filteredInitial.map((s) => s.id)).toEqual([1, 2]);
  });

  it("never prunes real popular tags during Stage 1 partial 150-row hydration", () => {
    const facets: TagFacet[] = [
      {
        id: 1,
        slug: "category",
        name: "Category",
        color: "#EF4444",
        sort_order: 1,
        is_system: true,
        domain: "tags",
        allow_nesting: true,
      },
    ];
    const tags: Tag[] = [
      { id: 10, name: "Impact", color: "#EF4444", sample_count: 22554, rollup_count: 22554, facet_slug: "category" },
      { id: 11, name: "Vocal", color: "#8B5CF6", sample_count: 11532, rollup_count: 11532, facet_slug: "category" },
      { id: 12, name: "Music", color: "#7C3AED", sample_count: 10829, rollup_count: 10829, facet_slug: "category" },
      { id: 13, name: "Other", color: "#64748B", sample_count: 85, rollup_count: 85, facet_slug: "category" },
      { id: 14, name: "Synth", color: "#06B6D4", sample_count: 42, rollup_count: 42, facet_slug: "category" },
      { id: 15, name: "Bass", color: "#10B981", sample_count: 30, rollup_count: 30, facet_slug: "category" },
    ];

    // Even if a caller only passes Stage 1's 150 rows, real top tags must not be treated as >85% broad
    const partialPageTop = buildDistinctiveTopTags(tags, 150, 6, facets);
    expect(partialPageTop.slice(0, 3).map((t) => t.name)).toEqual([
      "Impact",
      "Vocal",
      "Music",
    ]);

    // ToolbarQuickTagCloud uses visible library counts (45,770) on Frame 1 before allProfileSamples loads
    useSampleStore.setState({
      allProfileSamples: [],
      samples: [makeSample(1), makeSample(2)],
      libraries: [
        {
          id: 1,
          path: "D:/SFX",
          name: "SFX",
          last_scanned_at: "2026-01-01",
          sample_count: 45770,
          is_global: true,
          assigned_to_profile: true,
        },
      ],
      tags,
      tagFacets: facets,
      selectedTagIds: [],
      excludedTagIds: [],
      searchQuery: "",
      folderFilter: null,
      favoriteOnly: false,
      recentOnly: false,
      selectedGenre: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      binFilterActive: false,
      trashFilterActive: false,
      typeFilter: "all",
      srFilter: null,
      similaritySession: null,
    });

    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    try {
      const { container } = render(<ToolbarQuickTagCloud />);
      const renderedLabels = Array.from(container.querySelectorAll("button")).map(
        (btn) => btn.textContent || ""
      );
      expect(renderedLabels[0]).toContain("Impact");
      expect(renderedLabels[1]).toContain("Vocal");
      expect(renderedLabels[2]).toContain("Music");
    } finally {
      clientWidthSpy.mockRestore();
    }
  });

  it("does not tear down ResizeObserver, render caches, or sandbox when dragging blurPx on AsciiMagicCanvas", () => {
    vi.useFakeTimers();

    const { rerender, unmount } = render(
      <AsciiMagicCanvas
        slug="neon-rain"
        look="original"
        motionSpeed={1}
        themeMode="dark"
        blurPx={0}
      />
    );

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(0);
    expect(retainConsumerMock).toHaveBeenCalledTimes(1);
    expect(releaseConsumerMock).toHaveBeenCalledTimes(0);
    // Initial slug effect calls releaseCanvasRenderCaches(canvas, false) once
    const initialReleaseCalls = releaseCanvasRenderCachesMock.mock.calls.length;

    // Simulate continuous drag from 0px -> 40px -> 0px
    for (let px = 1; px <= 40; px++) {
      rerender(
        <AsciiMagicCanvas
          slug="neon-rain"
          look="original"
          motionSpeed={1}
          themeMode="dark"
          blurPx={px}
        />
      );
    }

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(0);
    expect(releaseConsumerMock).toHaveBeenCalledTimes(0);
    expect(releaseCanvasRenderCachesMock.mock.calls.length).toBe(
      initialReleaseCalls
    );

    // After drag pauses past debounce, backing store settles cleanly without dropping caches
    vi.advanceTimersByTime(200);
    expect(disconnectSpy).toHaveBeenCalledTimes(0);
    expect(releaseConsumerMock).toHaveBeenCalledTimes(0);
    expect(releaseCanvasRenderCachesMock.mock.calls.length).toBe(
      initialReleaseCalls
    );

    // Only real unmount tears down ResizeObserver, render caches, and sandbox retention
    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(releaseConsumerMock).toHaveBeenCalledTimes(1);
    expect(releaseCanvasRenderCachesMock).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      true
    );
  });

  it("blurs ASCII Magic directly via GPU CSS filter (no full-screen backdrop-filter overlay) and skips DOM tint writes on blur patches", () => {
    useSampleStore.setState({
      themeMode: "dark",
      accentColor: "#38BDF8",
      enableMica: true,
      themeTintIntensity: 0.4,
      wallpaperKind: "ascii_magic",
      asciiMagicSlug: "neon-rain",
      asciiMagicLook: "original",
      asciiMagicFit: "cover",
      customBgBlur: 24,
      customBgOpacity: 0.65,
      asciiMotionSpeed: 1,
      isPlaying: false,
    });

    const { container } = render(<AppAtmosphereViewport />);
    const allDivs = Array.from(container.querySelectorAll("div"));
    // Zero full-screen backdropFilter overlays for motion/ASCII backdrops
    expect(
      allDivs.some(
        (el) =>
          el.style.backdropFilter.includes("blur") ||
          el.style.getPropertyValue("-webkit-backdrop-filter").includes("blur")
      )
    ).toBe(false);
    // 1:1 zero-zoom edge-clamped SVG feGaussianBlur on the motion wrapper
    const blurFilter = container.querySelector("filter");
    const blurPrimitive = container.querySelector("feGaussianBlur");
    expect(blurFilter?.id).toBeTruthy();
    expect(blurPrimitive?.getAttribute("stdDeviation")).toBe("24");
    expect(blurPrimitive?.getAttribute("edgeMode")).toBe("duplicate");
    const directBlurWrapper = allDivs.find((el) =>
      (el.style.filter || el.getAttribute("style") || "").includes(
        `#${blurFilter?.id}`
      )
    );
    expect(directBlurWrapper).toBeDefined();
    expect(directBlurWrapper?.style.transform).not.toContain("scale(");

    // Tint glow layer reads --tint-scale directly from CSS
    const tintOverlay = allDivs.find((el) =>
      el.style.opacity.includes("--tint-scale")
    );
    expect(tintOverlay).toBeDefined();

    // Blur-only live-visual patches must not rewrite :root tint CSS properties
    document.documentElement.style.setProperty("--tint-scale", "0.4");
    const setPropSpy = vi.spyOn(document.documentElement.style, "setProperty");
    applyLiveVisualPatch(useSampleStore.setState, { customBgBlur: 32 });
    expect(useSampleStore.getState().customBgBlur).toBe(32);
    expect(setPropSpy).not.toHaveBeenCalled();
  });

  it("coalesces continuous blur/tint slider sync per rAF and preserves unchanged object references on remote storage sync", () => {
    vi.useFakeTimers();
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const postSpy =
      typeof BroadcastChannel !== "undefined"
        ? vi.spyOn(BroadcastChannel.prototype, "postMessage")
        : null;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    try {
      useSampleStore.setState({
        customBgBlur: 0,
        themeTintIntensity: 0,
        activeProfile: {
          id: 1,
          name: "Studio",
          color: "#38BDF8",
          settings_json: "{}",
          is_active: true,
          created_at: "2026-01-01",
        },
        accentColor: "#38BDF8",
      });
      setItemSpy.mockClear();
      postSpy?.mockClear();

      // Rapidly scrub blur 1 -> 20 within a single animation frame
      const store = useSampleStore.getState();
      for (let px = 1; px <= 20; px++) {
        store.setCustomBgBlur(px);
      }

      // Zero synchronous localStorage writes mid-drag (no cross-window storage storm)
      expect(setItemSpy).not.toHaveBeenCalled();

      // Flush the single coalesced rAF broadcast
      expect(rafCallbacks.length).toBe(1);
      rafCallbacks.shift()?.(16);
      if (postSpy) {
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(postSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "live-visual",
            patch: { customBgBlur: 20 },
          })
        );
      }

      // After drag pauses (150ms debounce), localStorage receives final settled value
      vi.advanceTimersByTime(160);
      expect(setItemSpy).toHaveBeenCalledWith(
        AUDIFY_STORAGE_KEYS.customBgBlur,
        "20"
      );

      // Remote storage sync preserves unchanged references (activeProfile, shortcuts, licenseGroups, binSampleIds)
      safeSetItem(AUDIFY_STORAGE_KEYS.accentColor, "#38BDF8", {
        broadcast: false,
        markEdited: false,
      });
      safeSetItem(AUDIFY_STORAGE_KEYS.customBgBlur, "20", {
        broadcast: false,
        markEdited: false,
      });
      const before = useSampleStore.getState();
      applyRemoteSettingsFromStorage(
        useSampleStore.getState,
        useSampleStore.setState
      );
      const after = useSampleStore.getState();
      expect(after.activeProfile).toBe(before.activeProfile);
      expect(after.shortcuts).toBe(before.shortcuts);
      expect(after.licenseGroups).toBe(before.licenseGroups);
      expect(after.binSampleIds).toBe(before.binSampleIds);
    } finally {
      postSpy?.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});
