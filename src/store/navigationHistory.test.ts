import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNavigationHistoryFlags,
  initNavigationHistory,
  MAX_NAV_HISTORY,
  navigateHistoryBack,
  navigateHistoryForward,
  resetNavigationHistoryForTest,
} from "./navigationHistory";
import { useSampleStore } from "./useSampleStore";

const initialStateSnapshot = useSampleStore.getState();

describe("navigationHistory", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetNavigationHistoryForTest();
    useSampleStore.setState(
      {
        ...initialStateSnapshot,
        hasInitialized: true,
        activeProfile: {
          id: 1,
          name: "Test",
          color: "#38BDF8",
          is_active: true,
          settings_json: "{}",
          created_at: "",
        },
        allProfileSamples: [],
        collections: [],
        licenseGroups: [],
        folderFilter: null,
        favoriteOnly: false,
        favoritesViewTab: "tracks",
        recentOnly: false,
        binFilterActive: false,
        slicesFilterActive: false,
        layersFilterActive: false,
        layersWorkspaceTab: "saved",
        duplicatesFilterActive: false,
        trashFilterActive: false,
        trashViewTab: "tracks",
        selectedCollectionId: null,
        selectedLicenseGroupId: null,
        selectedTagIds: [],
        excludedTagIds: [],
        selectedGenre: null,
        typeFilter: "all",
        srFilter: null,
        searchQuery: "",
        fetchSamples: vi.fn(async () => {}),
        fetchSliceHistory: vi.fn(async () => {}),
        fetchTrashedSlices: vi.fn(async () => {}),
        fetchLayerHistory: vi.fn(async () => {}),
        fetchTrashedLayers: vi.fn(async () => {}),
        refreshTrashStatus: vi.fn(async () => {}),
        renderLayerDraftPreview: vi.fn(async () => {}),
      },
      true
    );
    cleanup = initNavigationHistory();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    resetNavigationHistoryForTest();
    useSampleStore.setState(initialStateSnapshot, true);
  });

  it("tracks view transitions, restores Back/Forward cleanly, and truncates Forward on new branch", () => {
    expect(getNavigationHistoryFlags()).toMatchObject({
      canGoBack: false,
      canGoForward: false,
      length: 1,
    });

    // Navigate: All Files -> Favorites -> Folder
    useSampleStore.setState({ favoriteOnly: true, favoritesViewTab: "tracks" });
    useSampleStore.setState({
      favoriteOnly: false,
      folderFilter: "F:/SFX/Drums",
    });

    expect(getNavigationHistoryFlags()).toMatchObject({
      canGoBack: true,
      canGoForward: false,
      index: 2,
      length: 3,
    });

    // Back -> Favorites
    expect(navigateHistoryBack()).toBe(true);
    expect(useSampleStore.getState().favoriteOnly).toBe(true);
    expect(useSampleStore.getState().folderFilter).toBeNull();
    expect(getNavigationHistoryFlags()).toMatchObject({
      canGoBack: true,
      canGoForward: true,
      index: 1,
    });

    // Forward -> Folder
    expect(navigateHistoryForward()).toBe(true);
    expect(useSampleStore.getState().folderFilter).toBe("F:/SFX/Drums");
    expect(getNavigationHistoryFlags().canGoForward).toBe(false);

    // Back -> Favorites, then branch to Slices (drops Folder from Forward stack)
    expect(navigateHistoryBack()).toBe(true);
    useSampleStore.setState({ favoriteOnly: false, slicesFilterActive: true });
    expect(getNavigationHistoryFlags()).toMatchObject({
      canGoBack: true,
      canGoForward: false,
      index: 2,
      length: 3,
    });
    expect(navigateHistoryForward()).toBe(false);
  });

  it("preserves searchQuery in-place without spamming history per keystroke", () => {
    useSampleStore.setState({ searchQuery: "k" });
    useSampleStore.setState({ searchQuery: "ki" });
    useSampleStore.setState({ searchQuery: "kick" });
    expect(getNavigationHistoryFlags().length).toBe(1);

    // Navigate away with fresh search, then navigate Back -> restores "kick"
    useSampleStore.setState({ favoriteOnly: true, searchQuery: "" });
    expect(getNavigationHistoryFlags().length).toBe(2);

    expect(navigateHistoryBack()).toBe(true);
    expect(useSampleStore.getState().favoriteOnly).toBe(false);
    expect(useSampleStore.getState().searchQuery).toBe("kick");
  });

  it("caps history length at MAX_NAV_HISTORY and resets on profile switch", () => {
    for (let i = 0; i < MAX_NAV_HISTORY + 10; i++) {
      useSampleStore.setState({ folderFilter: `F:/SFX/Pack_${i}` });
    }
    expect(getNavigationHistoryFlags().length).toBe(MAX_NAV_HISTORY);

    useSampleStore.setState({
      activeProfile: {
        id: 2,
        name: "Second",
        color: "#F43F5E",
        is_active: true,
        settings_json: "{}",
        created_at: "",
      },
      folderFilter: null,
    });
    expect(getNavigationHistoryFlags()).toMatchObject({
      canGoBack: false,
      canGoForward: false,
      length: 1,
    });
  });

  it("remembers last selected track per view without spamming Back/Forward history", () => {
    const sampleA = {
      id: 101,
      library_id: 1,
      file_path: "F:/SFX/kick.wav",
      file_name: "kick.wav",
      folder_path: "F:/SFX",
      extension: "wav",
      duration_ms: 800,
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
      file_size: 1024,
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
    const sampleB = { ...sampleA, id: 102, file_name: "snare.wav", file_path: "F:/SFX/snare.wav" };

    useSampleStore.setState({ allProfileSamples: [sampleA, sampleB], isPlaying: false });
    // Auditioning tracks inside the same view updates current snapshot in-place (no new history entries)
    useSampleStore.setState({ selectedSample: sampleA, selectedSampleIds: [101] });
    useSampleStore.setState({ selectedSample: sampleB, selectedSampleIds: [102] });
    expect(getNavigationHistoryFlags().length).toBe(1);

    // Navigate to Favorites and select sampleA
    useSampleStore.setState({
      favoriteOnly: true,
      selectedSample: sampleA,
      selectedSampleIds: [101],
    });
    expect(getNavigationHistoryFlags().length).toBe(2);

    // Navigate Back -> restores view AND silently recalls sampleB (without playing)
    expect(navigateHistoryBack()).toBe(true);
    expect(useSampleStore.getState().favoriteOnly).toBe(false);
    expect(useSampleStore.getState().selectedSample?.id).toBe(102);
    expect(useSampleStore.getState().isPlaying).toBe(false);
  });

  it("preserves Forward stack when a deleted collection is pruned on Back and never interrupts live playback returning to Layers Editor", () => {
    const renderSpy = vi.fn(async () => {});
    useSampleStore.setState({
      collections: [
        { id: 7, name: "Temp", color: "#38BDF8", icon: "folder", sample_count: 1, created_at: "" },
      ],
      renderLayerDraftPreview: renderSpy,
    });
    // Navigate to collection 7 -> then to Layers Editor -> then delete collection 7
    useSampleStore.setState({ selectedCollectionId: 7 });
    useSampleStore.setState({
      selectedCollectionId: null,
      layersFilterActive: true,
      layersWorkspaceTab: "editor",
    });
    useSampleStore.setState({ collections: [], isPlaying: true });

    // Back prunes deleted collection 7 to null AND must keep Forward stack intact after subsequent search update
    expect(navigateHistoryBack()).toBe(true);
    expect(useSampleStore.getState().selectedCollectionId).toBeNull();
    useSampleStore.setState({ searchQuery: "boom" });
    expect(getNavigationHistoryFlags().canGoForward).toBe(true);

    // Forward back to Layers Editor while isPlaying=true must NOT invoke renderLayerDraftPreview
    expect(navigateHistoryForward()).toBe(true);
    expect(renderSpy).not.toHaveBeenCalled();
  });
});
