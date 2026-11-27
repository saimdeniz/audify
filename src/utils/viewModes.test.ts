import { describe, expect, it } from "vitest";
import {
  isLayersEditorViewActive,
  isLayersSavedViewActive,
  isNonSampleTableViewActive,
  isSliceTableViewActive,
  resolveNextTrashViewState,
  type ViewModeStateSlice,
} from "./viewModes";

const BASE_VIEW: ViewModeStateSlice = {
  slicesFilterActive: false,
  layersFilterActive: false,
  layersWorkspaceTab: "editor",
  favoriteOnly: false,
  favoritesViewTab: "tracks",
  trashFilterActive: false,
  trashViewTab: "tracks",
};

describe("viewModes single source of truth & trash exit guards", () => {
  it("recognizes Favorites -> Slices and Trash -> Slices as Slice table views", () => {
    expect(isSliceTableViewActive(BASE_VIEW)).toBe(false);
    expect(
      isSliceTableViewActive({
        ...BASE_VIEW,
        favoriteOnly: true,
        favoritesViewTab: "slices",
      })
    ).toBe(true);
    expect(
      isSliceTableViewActive({
        ...BASE_VIEW,
        trashFilterActive: true,
        trashViewTab: "slices",
      })
    ).toBe(true);
    expect(
      isNonSampleTableViewActive({
        ...BASE_VIEW,
        favoriteOnly: true,
        favoritesViewTab: "slices",
      })
    ).toBe(true);
  });

  it("distinguishes Saved/Favorites/Trash Layers tables from the split Layers Editor", () => {
    const editor = {
      ...BASE_VIEW,
      layersFilterActive: true,
      layersWorkspaceTab: "editor" as const,
    };
    expect(isLayersEditorViewActive(editor)).toBe(true);
    expect(isLayersSavedViewActive(editor)).toBe(false);
    expect(isNonSampleTableViewActive(editor)).toBe(false);

    const saved = {
      ...BASE_VIEW,
      layersFilterActive: true,
      layersWorkspaceTab: "saved" as const,
    };
    expect(isLayersEditorViewActive(saved)).toBe(false);
    expect(isLayersSavedViewActive(saved)).toBe(true);
    expect(isNonSampleTableViewActive(saved)).toBe(true);

    const favLayers = {
      ...BASE_VIEW,
      favoriteOnly: true,
      favoritesViewTab: "layers" as const,
    };
    expect(isLayersSavedViewActive(favLayers)).toBe(true);
    expect(isNonSampleTableViewActive(favLayers)).toBe(true);
  });

  it("keeps Trash open and switches tabs when layers or slices still remain trashed", () => {
    expect(
      resolveNextTrashViewState(true, "tracks", {
        tracks: 0,
        slices: 0,
        layers: 2,
      })
    ).toEqual({ trashViewTab: "layers", folderFilter: null });

    expect(
      resolveNextTrashViewState(true, "layers", {
        tracks: 0,
        slices: 3,
        layers: 0,
      })
    ).toEqual({ trashViewTab: "slices", folderFilter: null });

    expect(
      resolveNextTrashViewState(true, "layers", {
        tracks: 0,
        slices: 0,
        layers: 0,
      })
    ).toEqual({
      trashFilterActive: false,
      trashViewTab: "tracks",
      folderFilter: null,
    });

    // Stays put when active tab still has items
    expect(
      resolveNextTrashViewState(true, "layers", {
        tracks: 0,
        slices: 0,
        layers: 1,
      })
    ).toEqual({});
  });
});
