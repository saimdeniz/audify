// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    show: () => Promise.resolve(),
    setFocus: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    startDragging: () => Promise.resolve(),
    minimize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { resolveActiveBackgroundJob } from "../../utils/activeBackgroundJob";
import { BottomStatusBar } from "../StatusBar";
import { SettingsJobProgressStrip } from "./SettingsJobProgressStrip";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

function resetJobState() {
  useSampleStore.setState({
    hasInitialized: true,
    activeProfile: {
      id: 1,
      name: "Saim",
      color: "#38BDF8",
      settings_json: "{}",
      is_active: true,
      created_at: "2026-01-01",
    },
    isScanning: false,
    scanProgress: null,
    isDetectingGenres: false,
    genreDetectProgress: null,
    isApplyingAutoTags: false,
    autoTagProgress: null,
    isAnalyzingBpmKey: false,
    bpmKeyProgress: null,
    isDownloadingAiModel: false,
    aiDownloadProgress: null,
    isAnalyzingAi: false,
    aiIndexProgress: null,
    isScanningDuplicates: false,
    duplicateScanProgress: null,
    statusMessage: null,
  });
}

describe("unified background job progress UI (inline buttons, Option A Settings strip, Main status bar)", () => {
  beforeEach(() => {
    resetJobState();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetJobState();
  });

  it("resolves priority and multi-job overlap count cleanly across all background jobs", () => {
    const idle = resolveActiveBackgroundJob({
      isScanning: false,
      scanProgress: null,
      isDetectingGenres: false,
      genreDetectProgress: null,
      isApplyingAutoTags: false,
      autoTagProgress: null,
      isAnalyzingBpmKey: false,
      bpmKeyProgress: null,
      isDownloadingAiModel: false,
      aiDownloadProgress: null,
      isAnalyzingAi: false,
      aiIndexProgress: null,
      isScanningDuplicates: false,
      duplicateScanProgress: null,
    });
    expect(idle).toBeNull();

    const overlapping = resolveActiveBackgroundJob({
      isScanning: false,
      scanProgress: null,
      isDetectingGenres: true,
      genreDetectProgress: {
        stage_label: "Scanning genres",
        processed: 12000,
        total: 45770,
        percentage: 26.2,
        current_item: "ambient_pad.wav",
        matched_count: 3400,
        done: false,
      },
      isApplyingAutoTags: false,
      autoTagProgress: null,
      isAnalyzingBpmKey: true,
      bpmKeyProgress: {
        processed: 50,
        total: 200,
        percentage: 25,
        current_file: "loop.wav",
        updated_count: 10,
      },
      isDownloadingAiModel: false,
      aiDownloadProgress: null,
      isAnalyzingAi: false,
      aiIndexProgress: null,
      isScanningDuplicates: false,
      duplicateScanProgress: null,
    });
    expect(overlapping).toEqual(
      expect.objectContaining({
        kind: "genre_detect",
        label: "Scanning genres",
        percentage: 26,
        activeCount: 2,
        detail: "ambient_pad.wav",
      })
    );
  });

  it("shows live inline percentages directly inside Auto-assign, Apply rules, and Sync all header buttons", () => {
    // 1) Genres -> Auto-assign
    useSampleStore.setState({ settingsTab: "genres", isDetectingGenres: false });
    const { rerender } = render(
      <SettingsSectionHeader
        collectionsSubTab="list"
        setCollectionsSubTab={vi.fn()}
        tagsSubTab="rules"
        setTagsSubTab={vi.fn()}
        onClearShortcutRecording={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Auto-assign/i })).toBeTruthy();

    act(() => {
      useSampleStore.setState({
        isDetectingGenres: true,
        genreDetectProgress: {
          stage_label: "Scanning genres",
          processed: 21500,
          total: 45770,
          percentage: 47,
          current_item: "track.mp3",
          matched_count: 1200,
          done: false,
        },
      });
    });
    expect(screen.getByRole("button", { name: /Assigning 47%/i })).toBeTruthy();

    // 2) Tags & Rules -> Rules -> Apply rules
    act(() => {
      useSampleStore.setState({
        settingsTab: "tags",
        isDetectingGenres: false,
        genreDetectProgress: null,
        isApplyingAutoTags: true,
        autoTagProgress: {
          stage_label: "Matching rules",
          processed: 31000,
          total: 45770,
          percentage: 68,
          current_item: "explosion_01.wav",
          matched_count: 15000,
          done: false,
        },
      });
    });
    rerender(
      <SettingsSectionHeader
        collectionsSubTab="list"
        setCollectionsSubTab={vi.fn()}
        tagsSubTab="rules"
        setTagsSubTab={vi.fn()}
        onClearShortcutRecording={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Applying 68%/i })).toBeTruthy();

    // 3) Libraries -> Sync all
    act(() => {
      useSampleStore.setState({
        settingsTab: "libraries",
        isApplyingAutoTags: false,
        autoTagProgress: null,
        isScanning: true,
        scanProgress: {
          library_path: "D:/SFX",
          processed: 550,
          total: 1000,
          percentage: 55,
          current_file: "kick.wav",
        },
      });
    });
    rerender(
      <SettingsSectionHeader
        collectionsSubTab="list"
        setCollectionsSubTab={vi.fn()}
        tagsSubTab="rules"
        setTagsSubTab={vi.fn()}
        onClearShortcutRecording={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Syncing 55%/i })).toBeTruthy();
  });

  it("mounts SettingsJobProgressStrip (Option A) only while busy, shows completion hand-off, then collapses to 0px", () => {
    vi.useFakeTimers();

    const { container } = render(<SettingsJobProgressStrip />);
    expect(container.firstChild).toBeNull();

    act(() => {
      useSampleStore.setState({
        isApplyingAutoTags: true,
        autoTagProgress: {
          stage_label: "Saving tag links",
          processed: 15000,
          total: 20000,
          percentage: 87,
          current_item: "",
          matched_count: 15000,
          done: false,
        },
      });
    });

    const strip = screen.getByTestId("settings-job-progress-strip");
    expect(strip.textContent).toContain("Saving tag links");
    expect(strip.textContent).toContain("(87%)");

    // Job completes -> shows brief 100% completion summary before collapsing cleanly
    act(() => {
      useSampleStore.setState({
        isApplyingAutoTags: false,
        autoTagProgress: null,
      });
    });
    expect(
      screen.getByTestId("settings-job-progress-strip").textContent
    ).toContain("Auto-tag rules applied");

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByTestId("settings-job-progress-strip")).toBeNull();
  });

  it("displays genre auto-assign, rule apply, BPM/Key, and AI indexing progress in Main BottomStatusBar", () => {
    render(<BottomStatusBar />);
    expect(screen.getByText(/Ready — Profile: Saim/i)).toBeTruthy();

    act(() => {
      useSampleStore.setState({
        isDetectingGenres: true,
        genreDetectProgress: {
          stage_label: "Scanning genres",
          processed: 12000,
          total: 45770,
          percentage: 26,
          current_item: "Almost Bliss.mp3",
          matched_count: 2500,
          done: false,
        },
      });
    });
    const bar = screen.getByTestId("main-job-progress-bar");
    expect(bar.textContent).toContain("Scanning genres");
    expect(bar.textContent).toContain("(26%)");
    expect(bar.textContent).toContain("Almost Bliss.mp3");

    act(() => {
      useSampleStore.setState({
        isDetectingGenres: false,
        genreDetectProgress: null,
        isAnalyzingBpmKey: true,
        bpmKeyProgress: {
          processed: 80,
          total: 200,
          percentage: 40,
          current_file: "drum_loop_128.wav",
          updated_count: 60,
        },
      });
    });
    expect(screen.getByTestId("main-job-progress-bar").textContent).toContain(
      "Analyzing BPM & Key"
    );
    expect(screen.getByTestId("main-job-progress-bar").textContent).toContain(
      "(40%)"
    );
  });
});
