// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useSampleStore } from "../../store/useSampleStore";
import { createEmptyLayerRecipe } from "../../utils/layerHelpers";
import { WaveformDeckHeader } from "../transport/WaveformDeckHeader";
import { LayersStudio } from "./LayersStudio";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

if (typeof globalThis.ResizeObserver === "undefined") {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MockResizeObserver;
}

describe("LayersStudio v2 DaVinci Editor, Save duplicate guard & Master Sum Top Deck", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    const recipe = createEmptyLayerRecipe();
    recipe.clips.push({
      id: "c-1",
      laneId: recipe.lanes[0].id,
      sourceSampleId: 1,
      sourcePath: "F:/SFX/boom.wav",
      sourceName: "boom.wav",
      startSec: 0,
      trimStartSec: 0,
      trimEndSec: 1.5,
      fadeInSec: 0,
      fadeOutSec: 0,
      gainDb: 0,
      pitchSemitones: 0,
      reversed: false,
    });

    useSampleStore.setState({
      layersFilterActive: true,
      layersWorkspaceTab: "editor",
      layersSplitLibraryOpen: true,
      favoriteOnly: false,
      trashFilterActive: false,
      layerHistory: [
        {
          id: 99,
          layer_path: "F:/Audify/user/layers/Existing_Mix.wav",
          layer_name: "Existing_Mix.wav",
          recipe_json: "{}",
          lane_count: 2,
          clip_count: 2,
          duration_ms: 1500,
          is_favorite: false,
          peaks_json: "[]",
          sample_rate: 48000,
          channels: 2,
          bit_depth: 24,
          created_at: "2026-11-26 10:00:00",
          updated_at: "2026-11-26 10:00:00",
          file_exists: true,
        },
      ],
      trashedLayerHistory: [],
      layerDraftName: "Epic_Impact",
      layerDraftEditingId: null,
      layerDraftRecipe: recipe,
      layerDraftDirty: true,
      layerDraftSelectedClipIds: ["c-1"],
      layerDraftMissingClipIds: [],
      layerDraftUndoStack: [],
      layerDraftRedoStack: [],
      layerDraftPreview: {
        durationSec: 2.0,
        masterPeaks: [0.1, 0.8, 0.4],
        lanePeaks: [],
        peakDb: -1.4,
        clipped: false,
      },
    });
  });

  it("renders DaVinci toolbar, adds a lane, toggles Library split, and enforces Save duplicate guard + Auto", () => {
    render(<LayersStudio />);
    expect(screen.getByText("LANES (2)")).toBeTruthy();
    expect(screen.getByText("-1.4 dB")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Add new audio lane (max 64)"));
    expect(useSampleStore.getState().layerDraftRecipe.lanes).toHaveLength(3);
    expect(screen.getByText("LANES (3)")).toBeTruthy();

    // Pitch mode defaults to Lock Length icon-only toggle without inline layout-shift text
    const pitchModeBtn = screen.getByRole("button", { name: /Pitch mode: Lock Length/i });
    expect(pitchModeBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByTitle("Pitch up (+1st, Shift +12st)"));
    expect(useSampleStore.getState().layerDraftRecipe.clips[0].pitchSemitones).toBe(1);
    expect(screen.queryByText(/1\.06x/)).toBeNull();
    fireEvent.click(pitchModeBtn);
    expect(useSampleStore.getState().layerDraftRecipe.clips[0].pitchMode).toBe("varispeed");
    expect(
      screen.getByRole("button", { name: /Pitch mode: Tape Varispeed/i }).getAttribute("aria-pressed")
    ).toBe("true");

    // Mix button never becomes disabled during preview rendering (prevents not-allowed cursor & flicker)
    useSampleStore.setState({ isRenderingLayerPreview: true });
    const mixBtn = screen.getByTitle("Render & audition current layer mix (Space)") as HTMLButtonElement;
    expect(mixBtn.disabled).toBe(false);
    useSampleStore.setState({ isRenderingLayerPreview: false });

    // Open Save Layer dialog & test duplicate filename guard + Auto generator
    fireEvent.click(screen.getByText("Save"));
    const input = screen.getByLabelText(/Layer filename/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "existing_mix" } });
    expect(screen.getByText(/already exists/i)).toBeTruthy();

    fireEvent.click(screen.getByText("Auto"));
    expect(input.value).toBe("Layer_001");
    expect(screen.queryByText(/already exists/i)).toBeNull();
  });

  it("renders clean Master Sum Peak badge in WaveformDeckHeader without Sum/Lanes toggle", () => {
    render(
      <WaveformDeckHeader
        selectedSample={{
          id: -999999,
          library_id: 0,
          file_path: "layer://draft",
          file_name: "Epic_Impact.wav",
          folder_path: "Layers Editor",
          extension: "wav",
          duration_ms: 2000,
          sample_rate: 48000,
          channels: 2,
          bit_depth: 24,
          file_size: 0,
          is_favorite: false,
          is_loop: false,
          genre: "",
          artist: "",
          album: "",
          year: "",
          peaks_json: "[]",
          created_at: "",
          tags: [],
        }}
        isMiniDock={false}
        effectiveDuration={2.0}
        sliceRange={null}
        onClearSlice={vi.fn()}
        isLayerDraft={true}
        layerPeakDb={-1.4}
        layerClipped={false}
      />
    );
    expect(screen.getByText("-1.4 dB")).toBeTruthy();
    expect(screen.queryByText("Lanes")).toBeNull();
  });

  it("shows Mixed inspector readouts for differing multi-selected clips and guards New draft with 2-step Discard?", () => {
    const st = useSampleStore.getState();
    const secondClip = {
      ...st.layerDraftRecipe.clips[0],
      id: "c-2",
      startSec: 2.0,
      gainDb: -4.5,
      pitchSemitones: 5,
      pitchMode: "varispeed" as const,
      reversed: true,
    };
    useSampleStore.setState({
      layerDraftRecipe: {
        ...st.layerDraftRecipe,
        clips: [st.layerDraftRecipe.clips[0], secondClip],
      },
      layerDraftSelectedClipIds: ["c-1", "c-2"],
      layerDraftDirty: true,
    });

    render(<LayersStudio />);
    expect(screen.getByText("Mixed")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Pitch mode: Mixed/i })
        .getAttribute("aria-pressed")
    ).toBe("mixed");
    expect(screen.getByText("REV*")).toBeTruthy();

    // 1st click on New arms "Discard?" without wiping clips
    const newBtn = screen.getByTitle("Start a fresh empty layer draft");
    fireEvent.click(newBtn);
    expect(screen.getByText("Discard?")).toBeTruthy();
    expect(useSampleStore.getState().layerDraftRecipe.clips).toHaveLength(2);

    // 2nd click confirms reset
    fireEvent.click(screen.getByText("Discard?"));
    expect(useSampleStore.getState().layerDraftRecipe.clips).toHaveLength(0);
  });

  it("keeps SaveLayerModal open when save fails and blocks Delete in SavedLayersTableView in Read-Only mode", async () => {
    const saveSpy = vi.fn().mockResolvedValue(null);
    const trashSpy = vi.fn().mockResolvedValue(undefined);
    useSampleStore.setState({
      saveLayerDraft: saveSpy,
      trashLayerFiles: trashSpy,
      enableAdvancedFileOps: false,
      selectedLayerIds: [99],
    });

    const { rerender } = render(<LayersStudio />);
    fireEvent.click(screen.getByText("Save"));
    const dialog = screen.getByRole("dialog");
    const saveSubmit = within(dialog).getByRole("button", { name: /^Save$/ });
    fireEvent.click(saveSubmit);
    await Promise.resolve();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    // Modal stays open because save returned null
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Switch to Saved Layers table in Read-Only mode: Delete must NOT invoke trashLayerFiles
    useSampleStore.setState({ layersWorkspaceTab: "saved" });
    rerender(<LayersStudio />);
    const grid = screen.getByRole("grid", { name: /Saved layers/i });
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(trashSpy).not.toHaveBeenCalled();
  });
});
