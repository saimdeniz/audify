import { invoke } from "@tauri-apps/api/core";
import {
  Collection,
  FolderStat,
  Genre,
  Library,
  Profile,
  SampleItem,
  SliceTrashSummary,
  Tag,
  TagFacet,
  TrashStatusInfo,
} from "../../types";
import { onError } from "../../utils/errors";
import { isSampleInLicenseGroup } from "../../utils/format";
import { seedPeaksCache } from "../../utils/peaksStore";
import {
  internSamplePool,
  internSamplePoolWithStatus,
} from "../../utils/sampleInterning";
import { invokeCommand } from "../../utils/tauriCommands";
import { applyClientFacetFilters } from "../filterEngine";
import {
  AUDIFY_STORAGE_KEYS,
  isStandaloneSettingsWindow,
  loadSavedLastSample,
  persistNavigationFilters,
  postCrossWindowSync,
  safeSetItem,
  saveFolderStats,
  saveTrashStatus,
} from "../storageHelpers";
import { applyThemeAndAccentToDom, applyVisualEffectsToDom } from "../themeDom";
import type { StoreSliceContext } from "../types";
import {
  buildSidebarRefreshState,
  resolveInitialSelectedSample,
  resolveValidStartupFolder,
  scheduleStartupBackgroundStages,
  summarizeSamplePool,
} from "./catalogStartupHydration";
import { registerStoreListenersOnce } from "./initListeners";

export const SAMPLE_QUERY_LIMIT = 250000;
export { summarizeSamplePool };

export function createCatalogSyncSlice(ctx: StoreSliceContext) {
  const {
    set,
    get,
    applyInstantMemoryFilter,
    applyProfileSettingsImmediately,
    bumpProfileEpoch,
    getProfileEpoch,
    resetFiltersOnProfileChange,
  } = ctx;

  let initInFlight: Promise<void> | null = null;
  let initializedOnce = false;
  let sidebarSeq = 0;
  let folderStatsSeq = 0;
  let reloadProfileSeq = 0;

  return {
    initialize: async () => {
      if (get().hasInitialized || initializedOnce) return;
      if (initInFlight) return initInFlight;
      initInFlight = (async () => {
        try {
          applyThemeAndAccentToDom(get().themeMode, get().accentColor);
          applyVisualEffectsToDom(get().enableMica, get().themeTintIntensity);

      registerStoreListenersOnce({
        set,
        get,
        applyProfileSettingsImmediately,
        bumpProfileEpoch,
        getProfileEpoch,
        resetFiltersOnProfileChange,
      });

      // STAGE 1: Instant First Paint with peaks + profile counts so first screen is immediately complete
      const {
        folderFilter: initFolder,
        favoriteOnly: initFav,
        recentOnly: initRecentOnly,
        recentSampleIds: initRecentIds,
        binFilterActive: initBinFilterActive,
        binSampleIds: initBinIds,
        selectedCollectionId: initCol,
        sortKey: bootSortKey,
        sortDir: bootSortDir,
      } = get();

      const savedLast = loadSavedLastSample();
      const standaloneSettings = isStandaloneSettingsWindow();
      const initSettingsTab = get().settingsTab;
      const quickStatIds = Array.from(new Set([...initRecentIds, ...initBinIds]));

      const needTagsImmediately =
        !standaloneSettings ||
        initSettingsTab === "tags" ||
        initSettingsTab === "genres";
      const needGenresImmediately =
        !standaloneSettings || initSettingsTab === "genres";
      const needCollectionsImmediately =
        !standaloneSettings || initSettingsTab === "collections";

      try {
        const [
          profiles,
          libraries,
          tagFacets,
          tags,
          genres,
          collections,
          initialSamplesRaw,
          directSavedSample,
          quickStats,
        ] = await Promise.all([
          invoke<Profile[]>("get_profiles").catch(() => [] as Profile[]),
          invoke<Library[]>("get_libraries").catch(() => [] as Library[]),
          needTagsImmediately
            ? invoke<TagFacet[]>("get_tag_facets").catch(() => [] as TagFacet[])
            : Promise.resolve([] as TagFacet[]),
          needTagsImmediately
            ? invoke<Tag[]>("get_tags").catch(() => [] as Tag[])
            : Promise.resolve([] as Tag[]),
          needGenresImmediately
            ? invoke<Genre[]>("get_genres").catch(() => [] as Genre[])
            : Promise.resolve([] as Genre[]),
          needCollectionsImmediately
            ? invoke<Collection[]>("get_collections").catch(
                () => [] as Collection[]
              )
            : Promise.resolve([] as Collection[]),
          standaloneSettings
            ? Promise.resolve([] as SampleItem[])
            : invoke<SampleItem[]>("query_samples", {
                searchQuery: null,
                folderFilter: initFolder,
                favoriteOnly: initFav,
                tagIds: [],
                collectionId: initCol,
                limit: 150,
                offset: 0,
                includePeaks: true,
                ...(bootSortKey && bootSortKey !== "match"
                  ? { sortKey: bootSortKey, sortDir: bootSortDir }
                  : {}),
              }).catch(() => [] as SampleItem[]),
          !standaloneSettings && (savedLast.id !== null || savedLast.path !== null)
            ? invoke<SampleItem | null>("get_sample_by_id_or_path", {
                sampleId: savedLast.id,
                filePath: savedLast.path,
                includePeaks: true,
              }).catch(() => null)
            : Promise.resolve(null),
          standaloneSettings
            ? Promise.resolve({ favorites_count: 0, existing_sample_ids: [] })
            : invokeCommand("get_profile_quick_stats", {
                sampleIds: quickStatIds,
              }).catch(() => ({ favorites_count: 0, existing_sample_ids: [] })),
        ]);

        if (directSavedSample) {
          internSamplePool([directSavedSample]);
          seedPeaksCache([directSavedSample]);
        }
        internSamplePool(initialSamplesRaw);
        seedPeaksCache(initialSamplesRaw);

        const activeProfile =
          profiles.find((p) => p.is_active) || profiles[0] || null;
        if (activeProfile) {
          applyProfileSettingsImmediately(activeProfile, { isInitialBoot: true });
        }

        const validFolder = resolveValidStartupFolder(initFolder, libraries);
        // Validate persisted collection filter against loaded collections
        const validColId =
          initCol !== null &&
          (!needCollectionsImmediately || collections.some((c) => c.id === initCol))
            ? initCol
            : null;
        if (validColId !== initCol || validFolder !== initFolder) {
          persistNavigationFilters(
            validFolder,
            get().selectedLicenseGroupId,
            initFav,
            validColId
          );
        }

        const {
          typeFilter: initTypeFilter,
          srFilter: initSrFilter,
          sortKey: initSortKey,
          sortDir: initSortDir,
          selectedLicenseGroupId: initLicId,
          licenseGroups: initLicGroups,
        } = get();

        const activeLicGroup = initLicId
          ? initLicGroups.find((g) => g.id === initLicId) || null
          : null;
        const licFilteredInitial = activeLicGroup
          ? initialSamplesRaw.filter((s) =>
              isSampleInLicenseGroup(
                s.folder_path || s.file_path,
                activeLicGroup
              )
            )
          : initialSamplesRaw;

        const filteredInitial = applyClientFacetFilters(
          licFilteredInitial,
          initTypeFilter,
          initSrFilter,
          initSortKey,
          initSortDir
        );

        const { initialSelected, initialIdx } = resolveInitialSelectedSample({
          filteredInitial,
          directSavedSample,
          savedLast,
          libraries,
          folderFilter: validFolder,
          favoriteOnly: initFav,
          recentOnly: initRecentOnly,
          recentSampleIds: initRecentIds,
          binFilterActive: initBinFilterActive,
          binSampleIds: initBinIds,
          collectionId: validColId,
          licenseGroup: activeLicGroup,
          typeFilter: initTypeFilter,
          srFilter: initSrFilter,
        });

        const nextKnownIds =
          quickStats.existing_sample_ids.length > 0
            ? new Set(quickStats.existing_sample_ids)
            : get().knownSampleIds;

        set({
          hasInitialized: true,
          profiles,
          activeProfile: get().activeProfile || activeProfile,
          libraries,
          favoritesCount: quickStats.favorites_count,
          knownSampleIds: nextKnownIds,
          ...(tagFacets.length > 0 ? { tagFacets } : {}),
          tags,
          genres,
          collections,
          folderFilter: validFolder,
          selectedCollectionId: validColId,
          rawSamples: licFilteredInitial,
          samples: filteredInitial,
          selectedSample: initialSelected,
          selectedSampleIds: initialSelected ? [initialSelected.id] : [],
          lastSelectedIndex: initialIdx >= 0 ? initialIdx : null,
          durationSec: initialSelected
            ? Math.max(0.01, initialSelected.duration_ms / 1000)
            : 0,
        });
      } catch (err) {
        console.error("Failed during initial startup hydration:", err);
        set({ hasInitialized: true });
      }

      scheduleStartupBackgroundStages(
        { set, get, applyInstantMemoryFilter, getProfileEpoch },
        standaloneSettings,
        {
          fetchTags: !needTagsImmediately,
          fetchGenres: !needGenresImmediately,
          fetchCollections: !needCollectionsImmediately,
        }
      );
      initializedOnce = true;
      } finally {
        initInFlight = null;
      }
      })();
      return initInFlight;
    },

    refreshSidebarData: async (opts?: { broadcastCatalog?: boolean }) => {
      const reqSeq = ++sidebarSeq;
      const epoch = getProfileEpoch();
      try {
        const standaloneSettings = isStandaloneSettingsWindow();
        const prevActiveColId = get().selectedCollectionId;
        const prevSmartQuery =
          prevActiveColId !== null
            ? get().collections.find((c) => c.id === prevActiveColId)
                ?.smart_query ?? null
            : null;
        const [
          profiles,
          libraries,
          tagFacets,
          tags,
          genres,
          collections,
          folderStats,
          trashStatus,
          sliceTrashStatus,
        ] = await Promise.all([
          invoke<Profile[]>("get_profiles"),
          invoke<Library[]>("get_libraries"),
          invoke<TagFacet[]>("get_tag_facets").catch(() => [] as TagFacet[]),
          invoke<Tag[]>("get_tags"),
          invoke<Genre[]>("get_genres").catch(() => [] as Genre[]),
          invoke<Collection[]>("get_collections"),
          standaloneSettings
            ? Promise.resolve<FolderStat[] | null>(null)
            : invoke<FolderStat[]>("get_folder_tree_stats").catch(() => []),
          invoke<TrashStatusInfo>("get_trash_status").catch(() => null),
          invoke<SliceTrashSummary>("get_slice_trash_status").catch(() => null),
        ]);
        if (reqSeq !== sidebarSeq || epoch !== getProfileEpoch()) {
          return;
        }
        const safeProfiles = Array.isArray(profiles) ? profiles : [];
        const safeLibraries = Array.isArray(libraries) ? libraries : [];
        const safeTagFacets = Array.isArray(tagFacets) ? tagFacets : [];
        const safeTags = Array.isArray(tags) ? tags : [];
        const safeGenres = Array.isArray(genres) ? genres : [];
        const safeCollections = Array.isArray(collections) ? collections : [];
        const activeProfile =
          safeProfiles.find((p) => p.is_active) || safeProfiles[0] || null;
        if (!standaloneSettings && Array.isArray(folderStats)) {
          saveFolderStats(folderStats);
        }
        if (trashStatus) {
          saveTrashStatus(trashStatus.trashed_count, trashStatus.total_bytes);
        }

        set((state) =>
          buildSidebarRefreshState(state, {
            profiles: safeProfiles,
            activeProfile,
            libraries: safeLibraries,
            ...(safeTagFacets.length > 0 ? { tagFacets: safeTagFacets } : {}),
            tags: safeTags,
            genres: safeGenres,
            collections: safeCollections,
            folderStats,
            trashStatus,
            sliceTrashStatus,
          })
        );

        const nextActiveColId = get().selectedCollectionId;
        if (nextActiveColId !== null) {
          const nextSmartQuery =
            safeCollections.find((c) => c.id === nextActiveColId)?.smart_query ??
            null;
          if (nextSmartQuery && nextSmartQuery !== prevSmartQuery) {
            applyInstantMemoryFilter({ preserveMultiSelect: true });
          }
        }

        if (opts?.broadcastCatalog !== false) {
          postCrossWindowSync("catalog");
        }
      } catch (err) {
        console.error("Failed to load sidebar data:", err);
      }
    },

    refreshAfterCatalogMutation: async (opts?: {
      reloadSamples?: boolean;
      refreshTrash?: boolean;
      syncCatalog?: boolean;
    }) => {
      const {
        reloadSamples = true,
        refreshTrash = false,
        syncCatalog,
      } = opts ?? {};
      const standaloneSettings = isStandaloneSettingsWindow();
      await get().refreshSidebarData(
        syncCatalog === false ? { broadcastCatalog: false } : undefined
      );
      if (reloadSamples && !standaloneSettings) {
        if (Object.keys(get().duplicateScanCache).length > 0) {
          set({
            duplicateScanCache: {},
            ...(!get().isScanningDuplicates
              ? { duplicateScanResult: null }
              : {}),
          });
        }
        await get().reloadProfileSamples({ skipFolderStats: true });
      }
      if (refreshTrash) {
        await get().refreshTrashStatus();
      }
      if (!standaloneSettings) {
        void get().fetchAiTagSuggestions();
        void get().fetchSliceHistory();
      }
      void get().fetchAiModelStatus();
    },

    fetchFolderStats: async () => {
      const reqSeq = ++folderStatsSeq;
      const epoch = getProfileEpoch();
      try {
        const folderStats = await invoke<FolderStat[]>("get_folder_tree_stats");
        if (reqSeq !== folderStatsSeq || epoch !== getProfileEpoch()) {
          return;
        }
        saveFolderStats(folderStats);
        set({ folderStats });
      } catch (err) {
        console.error("Failed to fetch folder stats:", err);
      }
    },

    syncAllLibrariesBackground: async () => {
      const { libraries, isScanning } = get();
      if (isScanning || libraries.length === 0) return;
      const epoch = getProfileEpoch();

      let anyChanged = false;
      for (const lib of libraries) {
        if (epoch !== getProfileEpoch()) return;
        try {
          const res = await invoke<{ library: Library; changed: boolean }>(
            "sync_library_background",
            { libraryPath: lib.path }
          );
          if (epoch !== getProfileEpoch()) return;
          if (res?.changed) {
            anyChanged = true;
          }
        } catch (err) {
          console.warn("Background sync error for", lib.path, err);
        }
      }
      // Skip expensive 55k catalog/tag/tree reload on startup when zero disk changes occurred
      if (anyChanged && epoch === getProfileEpoch()) {
        await get().refreshAfterCatalogMutation();
      }
    },

    reloadProfileSamples: async (opts?: { skipFolderStats?: boolean }) => {
      // Standalone Settings window only manages rules/metadata and never renders the sample table.
      if (isStandaloneSettingsWindow()) return;
      const epoch = getProfileEpoch();
      const reqSeq = ++reloadProfileSeq;
      try {
        const useCompactTags = get().tags.length > 0;
        const allSamples = await invoke<SampleItem[]>("query_samples", {
          searchQuery: null,
          folderFilter: null,
          favoriteOnly: false,
          tagIds: [],
          collectionId: null,
          limit: SAMPLE_QUERY_LIMIT,
          offset: 0,
          includePeaks: false,
          ...(useCompactTags ? { compactTags: true } : {}),
        });

        // Abort if profile switched or a newer reload request superseded this one
        if (epoch !== getProfileEpoch() || reqSeq !== reloadProfileSeq) return;

        const internRes = internSamplePoolWithStatus(allSamples, get().tags);
        if (internRes.hadMissingTagIds) {
          const [freshTags, freshFacets] = await Promise.all([
            invoke<Tag[]>("get_tags").catch(() => null),
            invoke<TagFacet[]>("get_tag_facets").catch(() => null),
          ]);
          if (epoch !== getProfileEpoch() || reqSeq !== reloadProfileSeq) return;
          if ((freshTags && freshTags.length > 0) || (freshFacets && freshFacets.length > 0)) {
            set({
              ...(freshTags && freshTags.length > 0 ? { tags: freshTags } : {}),
              ...(freshFacets && freshFacets.length > 0 ? { tagFacets: freshFacets } : {}),
            });
            if (freshTags && freshTags.length > 0) {
              internSamplePoolWithStatus(allSamples, freshTags, {
                onlyUnresolvedTagIds: true,
              });
            }
          }
        }

        // Drop Bin entries that no longer exist (including when last library is removed!)
        // Track only recent + bin IDs in `knownSampleIds` instead of allocating a 50k+ V8 Set.
        const currentBin = get().binSampleIds;
        const trackedIds = new Set<number>([
          ...get().recentSampleIds,
          ...currentBin,
        ]);
        const { knownIds, favCount } = summarizeSamplePool(allSamples, trackedIds);
        const prunedBin = currentBin.filter((id) => knownIds.has(id));
        const binChanged = prunedBin.length !== currentBin.length;
        if (binChanged) {
          safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(prunedBin));
        }

        const shouldDisableBinFilter =
          prunedBin.length === 0 && get().binFilterActive;

        set({
          allProfileSamples: allSamples,
          favoritesCount: favCount,
          knownSampleIds: knownIds,
          binSampleIds: prunedBin,
          ...(shouldDisableBinFilter ? { binFilterActive: false } : {}),
          ...(allSamples.length >= SAMPLE_QUERY_LIMIT
            ? {
                statusMessage: `Showing the first ${SAMPLE_QUERY_LIMIT.toLocaleString()} samples. Narrow the view with folders, tags or search to see the rest.`,
              }
            : {}),
        });

        if (binChanged) {
          void get().persistActiveProfileSettings();
        }

        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          if (
            allSamples.length === 0 &&
            get().selectedCollectionId === null &&
            !get().trashFilterActive
          ) {
            set({
              rawSamples: [],
              samples: [],
              selectedSample: null,
              selectedSampleIds: [],
              lastSelectedIndex: null,
            });
          } else {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
        if (!opts?.skipFolderStats) {
          get().fetchFolderStats().catch(onError("folder stats refresh"));
        }
      } catch (err) {
        console.error("Failed to reload profile samples:", err);
      }
    },
  };
}
