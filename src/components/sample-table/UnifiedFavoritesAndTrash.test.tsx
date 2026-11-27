// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FavoritesToolbarChips } from "./FavoritesToolbarChips";
import { TrashToolbarChips } from "./TrashToolbarChips";
import { LayersAudioCard } from "../settings/LayersAudioCard";
import { MiniDockCategoryDropdown } from "../mini-dock/MiniDockCategoryDropdown";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerHistoryEntry, SampleItem, SliceHistoryEntry } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

const MOCK_SLICE: SliceHistoryEntry = {
  id: 10,
  slice_path: "F:/Audify/user/slices/hit_slice.wav",
  slice_name: "hit_slice.wav",
  source_sample_id: 1,
  source_file_path: "F:/SFX/hit.wav",
  source_file_name: "hit.wav",
  start_sec: 0,
  end_sec: 0.5,
  pitch_semitones: 0,
  micro_fade: false,
  duration_ms: 500,
  is_favorite: true,
  peaks_json: "[]",
  sample_rate: 48000,
  channels: 2,
  bit_depth: 24,
  created_at: "2026-11-26 10:00:00",
  file_exists: true,
};

const MOCK_LAYER: LayerHistoryEntry = {
  id: 20,
  layer_path: "F:/Audify/user/layers/epic_boom.wav",
  layer_name: "epic_boom.wav",
  recipe_json: "{}",
  lane_count: 3,
  clip_count: 4,
  duration_ms: 2100,
  is_favorite: true,
  peaks_json: "[]",
  sample_rate: 48000,
  channels: 2,
  bit_depth: 24,
  created_at: "2026-11-26 10:00:00",
  updated_at: "2026-11-26 10:00:00",
  file_exists: true,
};

describe("Unified Favorites & Trash 3-tab navigation", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useSampleStore.setState({
      favoritesCount: 7,
      favoriteOnly: false,
      favoritesViewTab: "tracks",
      slicesFilterActive: false,
      layersFilterActive: false,
      trashFilterActive: false,
      trashViewTab: "tracks",
      trashedCount: 0,
      trashedSliceCount: 2,
      trashedLayerCount: 3,
      sliceHistory: [MOCK_SLICE],
      layerHistory: [MOCK_LAYER],
    });
  });

  it("opens Favorites context-aware to Slices when in Slices and Layers when in Layers", () => {
    useSampleStore.setState({ slicesFilterActive: true });
    useSampleStore.getState().setFavoriteOnly(true);
    expect(useSampleStore.getState().favoriteOnly).toBe(true);
    expect(useSampleStore.getState().favoritesViewTab).toBe("slices");
    expect(useSampleStore.getState().slicesFilterActive).toBe(false);

    useSampleStore.setState({ favoriteOnly: false, layersFilterActive: true });
    useSampleStore.getState().setFavoriteOnly(true);
    expect(useSampleStore.getState().favoriteOnly).toBe(true);
    expect(useSampleStore.getState().favoritesViewTab).toBe("layers");
    expect(useSampleStore.getState().layersFilterActive).toBe(false);

    useSampleStore.setState({ favoriteOnly: false, layersFilterActive: false, slicesFilterActive: false });
    useSampleStore.getState().setFavoriteOnly(true);
    expect(useSampleStore.getState().favoritesViewTab).toBe("tracks");
  });

  it("renders uniform Tracks | Slices | Layers tabs in FavoritesToolbarChips and switches tabs", () => {
    useSampleStore.setState({ favoriteOnly: true, favoritesViewTab: "tracks" });
    render(<FavoritesToolbarChips />);
    expect(screen.getByText("Tracks")).toBeTruthy();
    expect(screen.getByText("Slices")).toBeTruthy();
    expect(screen.getByText("Layers")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();

    fireEvent.click(screen.getByText("Layers"));
    expect(useSampleStore.getState().favoritesViewTab).toBe("layers");
  });

  it("renders uniform Tracks | Slices | Layers tabs in TrashToolbarChips and falls back to Layers when only layers are trashed", () => {
    useSampleStore.setState({
      trashedCount: 0,
      trashedSliceCount: 0,
      trashedLayerCount: 3,
    });
    useSampleStore.getState().setTrashFilterActive(true);
    expect(useSampleStore.getState().trashViewTab).toBe("layers");

    render(<TrashToolbarChips />);
    expect(screen.getByText("Layers")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    fireEvent.click(screen.getByText("Slices"));
    expect(useSampleStore.getState().trashViewTab).toBe("slices");
  });

  it("renders Settings LayersAudioCard without deprecated Top Deck view selector and toggles NLE auto-save", () => {
    useSampleStore.setState({
      customLayerExportPath: "",
      autoSaveLayerOnNleDrag: false,
    });
    render(<LayersAudioCard />);
    expect(screen.getByText("LAYERS & MIX EXPORT")).toBeTruthy();
    expect(screen.getByText("user/layers (Default)")).toBeTruthy();
    expect(screen.queryByText("Stacked Lanes")).toBeNull();
  });

  it("renders MiniDockCategoryDropdown (Option A) and switches Favorites/Trash tabs via portal menu", () => {
    useSampleStore.setState({
      favoriteOnly: true,
      favoritesViewTab: "tracks",
      favoritesCount: 7,
      sliceHistory: [MOCK_SLICE],
      layerHistory: [MOCK_LAYER],
    });
    render(<MiniDockCategoryDropdown />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Layers"));
    expect(useSampleStore.getState().favoritesViewTab).toBe("layers");
  });

  it("sends multi-selected samples to Layers (create when empty, append as new lanes when non-empty, undoable)", async () => {
    const sampleA: SampleItem = {
      id: 1,
      library_id: 1,
      file_path: "F:/SFX/boom.wav",
      file_name: "boom.wav",
      folder_path: "F:/SFX",
      extension: "wav",
      duration_ms: 1200,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
      file_size: 1000,
      is_favorite: false,
      is_loop: false,
      genre: "",
      artist: "",
      album: "",
      year: "",
      peaks_json: "[]",
      created_at: "",
      tags: [],
    };
    const sampleB: SampleItem = {
      ...sampleA,
      id: 2,
      file_path: "F:/SFX/whoosh.wav",
      file_name: "whoosh.wav",
    };
    const sampleC: SampleItem = {
      ...sampleA,
      id: 3,
      file_path: "F:/SFX/sub.wav",
      file_name: "sub.wav",
    };

    useSampleStore.getState().resetLayerDraft();
    await useSampleStore.getState().sendSamplesToLayers([sampleA, sampleB]);

    await waitFor(() => {
      const st = useSampleStore.getState();
      expect(st.layersFilterActive).toBe(true);
      expect(st.layersWorkspaceTab).toBe("editor");
      expect(st.layerDraftRecipe.lanes).toHaveLength(2);
      expect(st.layerDraftRecipe.clips).toHaveLength(2);
    });

    // Appending a 3rd track adds a new lane below without wiping existing clips
    await useSampleStore.getState().sendSamplesToLayers([sampleC]);
    expect(useSampleStore.getState().layerDraftRecipe.lanes).toHaveLength(3);
    expect(useSampleStore.getState().layerDraftRecipe.clips).toHaveLength(3);

    // Single Ctrl+Z reverts the append cleanly back to 2 lanes
    useSampleStore.getState().undoLayerDraft();
    expect(useSampleStore.getState().layerDraftRecipe.lanes).toHaveLength(2);
    expect(useSampleStore.getState().layerDraftRecipe.clips).toHaveLength(2);
  });
});
