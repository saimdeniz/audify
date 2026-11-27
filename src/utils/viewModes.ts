import type {
  FavoritesViewTab,
  LayersWorkspaceTab,
  TrashViewTab,
} from "../types";

export interface ViewModeStateSlice {
  slicesFilterActive: boolean;
  layersFilterActive: boolean;
  layersWorkspaceTab: LayersWorkspaceTab;
  favoriteOnly: boolean;
  favoritesViewTab: FavoritesViewTab;
  trashFilterActive: boolean;
  trashViewTab: TrashViewTab;
}

/**
 * Single source of truth for whether the main stage is currently displaying
 * the Slices table (`Tools -> Slices`, `Favorites -> Slices`, or `Trash -> Slices`).
 */
export function isSliceTableViewActive(state: ViewModeStateSlice): boolean {
  return (
    state.slicesFilterActive ||
    (state.trashFilterActive && state.trashViewTab === "slices") ||
    (state.favoriteOnly && state.favoritesViewTab === "slices")
  );
}

/**
 * True when the main stage is showing the Saved / Favorites / Trash Layers table
 * (not the Layers Timeline Editor split view).
 */
export function isLayersSavedViewActive(state: ViewModeStateSlice): boolean {
  return (
    (state.trashFilterActive && state.trashViewTab === "layers") ||
    (state.favoriteOnly && state.favoritesViewTab === "layers") ||
    (state.layersFilterActive &&
      state.layersWorkspaceTab !== "editor" &&
      !state.slicesFilterActive &&
      !state.trashFilterActive &&
      !(state.favoriteOnly && state.favoritesViewTab !== "tracks"))
  );
}

/**
 * True when the main stage is displaying the interactive Layers Timeline Editor.
 */
export function isLayersEditorViewActive(state: ViewModeStateSlice): boolean {
  return (
    state.layersFilterActive &&
    state.layersWorkspaceTab === "editor" &&
    !state.slicesFilterActive &&
    !(state.favoriteOnly && state.favoritesViewTab !== "tracks") &&
    !(state.trashFilterActive && state.trashViewTab !== "tracks")
  );
}

/**
 * True when a non-sample table view (Slices table or Saved/Favorites/Trash Layers table)
 * occupies the main stage and background track-table shortcuts must not leak through.
 */
export function isNonSampleTableViewActive(state: ViewModeStateSlice): boolean {
  return isSliceTableViewActive(state) || isLayersSavedViewActive(state);
}

/**
 * Computes the next Trash navigation patch after restoring or emptying items from
 * tracks, slices, or layers. Only exits Trash when ALL three buckets reach zero.
 */
export function resolveNextTrashViewState(
  isTrashActive: boolean,
  currentTab: TrashViewTab,
  counts: { tracks: number; slices: number; layers: number }
): {
  trashFilterActive?: boolean;
  trashViewTab?: TrashViewTab;
  folderFilter?: string | null;
} {
  if (!isTrashActive) return {};
  const tracks = Math.max(0, counts.tracks);
  const slices = Math.max(0, counts.slices);
  const layers = Math.max(0, counts.layers);
  const total = tracks + slices + layers;

  if (total === 0) {
    return {
      trashFilterActive: false,
      trashViewTab: "tracks",
      folderFilter: null,
    };
  }

  const currentCount =
    currentTab === "tracks"
      ? tracks
      : currentTab === "slices"
      ? slices
      : layers;
  if (currentCount > 0) return {};

  const nextTab: TrashViewTab =
    tracks > 0 ? "tracks" : slices > 0 ? "slices" : "layers";
  return {
    trashViewTab: nextTab,
    folderFilter: null,
  };
}
