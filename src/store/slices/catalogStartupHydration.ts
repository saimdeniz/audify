import { invoke } from "@tauri-apps/api/core";
import {
  Collection,
  FolderStat,
  Genre,
  Library,
  LicenseGroup,
  Profile,
  SampleItem,
  SampleRateFilter,
  SliceTrashSummary,
  Tag,
  TagFacet,
  TrashStatusInfo,
  TypeFilter,
} from "../../types";
import { onError } from "../../utils/errors";
import { normalizePathForMatch } from "../../utils/format";
import { resolveNextTrashViewState } from "../../utils/viewModes";
import { doesSampleMatchInitialView } from "../filterEngine";
import { runStartupMtimeBackfill } from "../mtimeBackfill";
import {
  AUDIFY_STORAGE_KEYS,
  isStandaloneSettingsWindow,
  persistNavigationFilters,
  safeGetItem,
  safeSetItem,
} from "../storageHelpers";
import type { SampleStoreState, StoreSliceContext } from "../types";

export function summarizeSamplePool(
  list: SampleItem[],
  trackedIds?: ReadonlySet<number>
): {
  knownIds: Set<number>;
  favCount: number;
} {
  const knownIds = new Set<number>();
  let favCount = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!trackedIds || trackedIds.has(s.id)) {
      knownIds.add(s.id);
    }
    if (s.is_favorite) favCount++;
  }
  return { knownIds, favCount };
}

export function resolveValidStartupFolder(
  initFolder: string | null,
  libraries: Library[]
): string | null {
  if (initFolder === null) return null;
  const visibleLibs = libraries.filter(
    (l) => l.is_global !== false || l.assigned_to_profile !== false
  );
  if (visibleLibs.length === 0) return initFolder;
  const fp = normalizePathForMatch(initFolder);
  const belongsToVisibleLib = visibleLibs.some((l) => {
    const lp = normalizePathForMatch(l.path);
    return fp === lp || fp.startsWith(`${lp}/`);
  });
  return belongsToVisibleLib ? initFolder : null;
}

export interface ResolveInitialSelectedSampleParams {
  filteredInitial: SampleItem[];
  directSavedSample: SampleItem | null;
  savedLast: { id: number | null; path: string | null };
  libraries: Library[];
  folderFilter: string | null;
  favoriteOnly: boolean;
  recentOnly: boolean;
  recentSampleIds: number[];
  binFilterActive: boolean;
  binSampleIds: number[];
  collectionId: number | null;
  licenseGroup: LicenseGroup | null;
  typeFilter: TypeFilter;
  srFilter: SampleRateFilter;
}

export function resolveInitialSelectedSample(
  params: ResolveInitialSelectedSampleParams
): { initialSelected: SampleItem | null; initialIdx: number } {
  const {
    filteredInitial,
    directSavedSample,
    savedLast,
    libraries,
    folderFilter,
    favoriteOnly,
    recentOnly,
    recentSampleIds,
    binFilterActive,
    binSampleIds,
    collectionId,
    licenseGroup,
    typeFilter,
    srFilter,
  } = params;

  const visibleLibraryIds = new Set(
    libraries
      .filter((l) => l.is_global !== false || l.assigned_to_profile !== false)
      .map((l) => l.id)
  );

  let initialSelected: SampleItem | null = null;
  if (directSavedSample) {
    const inInitial = filteredInitial.find((s) => s.id === directSavedSample.id);
    if (inInitial) {
      initialSelected = inInitial;
    } else if (
      doesSampleMatchInitialView(directSavedSample, {
        visibleLibraryIds,
        folderFilter,
        favoriteOnly,
        recentOnly,
        recentSampleIds,
        binFilterActive,
        binSampleIds,
        collectionId,
        licenseGroup,
        typeFilter,
        srFilter,
      })
    ) {
      // Keep the saved sample ready in the waveform deck without unshifting it
      // into row 0 (which would cause a visible list jump when Stage 2 loads).
      initialSelected = directSavedSample;
    }
  } else if (savedLast.id !== null || savedLast.path !== null) {
    initialSelected =
      filteredInitial.find(
        (s) =>
          (savedLast.id !== null && s.id === savedLast.id) ||
          (savedLast.path !== null &&
            normalizePathForMatch(s.file_path) ===
              normalizePathForMatch(savedLast.path))
      ) || null;
  }
  if (!initialSelected && filteredInitial.length > 0) {
    initialSelected = filteredInitial[0];
  }
  const initialIdx = initialSelected
    ? filteredInitial.findIndex((s) => s.id === initialSelected.id)
    : -1;

  return { initialSelected, initialIdx };
}

export interface DeferredTaxonomyFlags {
  fetchTags: boolean;
  fetchGenres: boolean;
  fetchCollections: boolean;
}

export function scheduleStartupBackgroundStages(
  ctx: Pick<
    StoreSliceContext,
    "set" | "get" | "applyInstantMemoryFilter" | "getProfileEpoch"
  >,
  standaloneSettings: boolean,
  deferredTaxonomy?: DeferredTaxonomyFlags
): void {
  const { set, get, applyInstantMemoryFilter, getProfileEpoch } = ctx;
  const bootEpoch = getProfileEpoch();

  // STAGE 2: Non-blocking Background Hydration
  // Run deferred taxonomy + lightweight sidebar/status calls right after Stage 1 paint,
  // and yield slightly before fetching the full 55k pool so Stage 1 waveforms finish painting first.
  setTimeout(() => {
    if (deferredTaxonomy) {
      const { fetchTags, fetchGenres, fetchCollections } = deferredTaxonomy;
      if (fetchTags || fetchGenres || fetchCollections) {
        void Promise.all([
          fetchTags
            ? invoke<Tag[]>("get_tags").catch(() => null)
            : Promise.resolve(null),
          fetchGenres
            ? invoke<Genre[]>("get_genres").catch(() => null)
            : Promise.resolve(null),
          fetchCollections
            ? invoke<Collection[]>("get_collections").catch(() => null)
            : Promise.resolve(null),
          invoke<TagFacet[]>("get_tag_facets").catch(() => null),
        ]).then(([bgTags, bgGenres, bgCollections, bgFacets]) => {
          if (bootEpoch !== getProfileEpoch()) return;
          set((state) => ({
            ...(bgTags !== null && state.tags.length === 0
              ? { tags: bgTags }
              : {}),
            ...(bgGenres !== null && state.genres.length === 0
              ? { genres: bgGenres }
              : {}),
            ...(bgCollections !== null && state.collections.length === 0
              ? { collections: bgCollections }
              : {}),
            ...(bgFacets !== null && state.tagFacets.length === 0
              ? { tagFacets: bgFacets }
              : {}),
          }));
        });
      }
    }

    if (!standaloneSettings) {
      get().fetchFolderStats().catch(onError("folder stats"));
      get().fetchAiTagSuggestions().catch(onError("ai suggestions"));
      get().fetchSliceHistory().catch(onError("slice history"));
      get().fetchLayerHistory().catch(onError("layer history"));
      get().fetchSliceTrashStatus().catch(onError("slice trash status"));
      get().fetchLayerTrashStatus().catch(onError("layer trash status"));
    }
    get().refreshTrashStatus().catch(onError("trash status"));
    get().fetchAiModelStatus().catch(onError("ai model status"));
  }, 25);

  if (!standaloneSettings) {
    setTimeout(() => {
      if (bootEpoch !== getProfileEpoch()) return;
      get()
        .reloadProfileSamples({ skipFolderStats: true })
        .finally(() => {
          setTimeout(() => {
            if (bootEpoch !== getProfileEpoch()) return;
            void runStartupMtimeBackfill({
              set,
              get,
              applyInstantMemoryFilter,
              getProfileEpoch,
            });
          }, 450);
        })
        .catch(onError("profile sample reload"));
    }, 180);
  }

  if (!isStandaloneSettingsWindow()) {
    setTimeout(() => {
      if (bootEpoch !== getProfileEpoch()) return;
      get()
        .syncAllLibrariesBackground()
        .catch(onError("background library sync"));
    }, 3500);

    setTimeout(() => {
      if (bootEpoch !== getProfileEpoch()) return;
      const todayStr = new Date().toISOString().slice(0, 10);
      const lastAutoBackup = safeGetItem(AUDIFY_STORAGE_KEYS.lastAutoBackupDate);
      if (lastAutoBackup !== todayStr) {
        get()
          .createQuickBackup(true)
          .then(() => {
            if (bootEpoch === getProfileEpoch()) {
              safeSetItem(AUDIFY_STORAGE_KEYS.lastAutoBackupDate, todayStr);
            }
          })
          .catch(onError("daily auto-backup"));
      } else {
        get().fetchLocalBackups().catch(onError("backup list refresh"));
      }
    }, 3000);
  } else {
    setTimeout(() => {
      if (bootEpoch !== getProfileEpoch()) return;
      get().fetchLocalBackups().catch(onError("backup list refresh"));
    }, 400);
  }
}

export function buildSidebarRefreshState(
  state: SampleStoreState,
  payload: {
    profiles: Profile[];
    activeProfile: Profile | null;
    libraries: Library[];
    tagFacets?: TagFacet[];
    tags: Tag[];
    genres: Genre[];
    collections: Collection[];
    folderStats: FolderStat[] | null;
    trashStatus: TrashStatusInfo | null;
    sliceTrashStatus?: SliceTrashSummary | null;
  }
): Partial<SampleStoreState> {
  const {
    profiles,
    activeProfile,
    libraries,
    tagFacets,
    tags,
    genres,
    collections,
    folderStats,
    trashStatus,
    sliceTrashStatus,
  } = payload;

  const validTagIds = new Set(tags.map((t) => t.id));
  const validGenresLower = new Set(genres.map((g) => g.name.toLowerCase()));
  const validCollectionIds = new Set(collections.map((c) => c.id));

  const prunedTagIds = state.selectedTagIds.filter((id) => validTagIds.has(id));
  const prunedExcludedTagIds = state.excludedTagIds.filter((id) =>
    validTagIds.has(id)
  );
  const nextGenre =
    state.selectedGenre &&
    validGenresLower.has(state.selectedGenre.toLowerCase())
      ? state.selectedGenre
      : null;
  const nextColId =
    state.selectedCollectionId !== null &&
    validCollectionIds.has(state.selectedCollectionId)
      ? state.selectedCollectionId
      : null;

  if (nextColId !== state.selectedCollectionId) {
    persistNavigationFilters(
      state.folderFilter,
      state.selectedLicenseGroupId,
      state.favoriteOnly,
      nextColId
    );
  }

  const nextTrashedTracks = trashStatus?.trashed_count ?? state.trashedCount;
  const nextTrashedSlices =
    sliceTrashStatus?.trashed_count ?? state.trashedSliceCount;
  const nextTrashedLayers = state.trashedLayerCount;
  const trashExitPatch = resolveNextTrashViewState(
    state.trashFilterActive,
    state.trashViewTab,
    {
      tracks: nextTrashedTracks,
      slices: nextTrashedSlices,
      layers: nextTrashedLayers,
    }
  );

  return {
    profiles,
    activeProfile,
    libraries,
    ...(tagFacets ? { tagFacets } : {}),
    tags,
    genres,
    collections,
    folderStats: folderStats ?? state.folderStats,
    selectedTagIds: prunedTagIds,
    excludedTagIds: prunedExcludedTagIds,
    selectedGenre: nextGenre,
    selectedCollectionId: nextColId,
    ...(trashStatus
      ? {
          trashedCount: trashStatus.trashed_count,
          trashedTotalBytes: trashStatus.total_bytes,
          fileOpJournal: trashStatus.journal_entries,
        }
      : {}),
    ...(sliceTrashStatus
      ? {
          trashedSliceCount: sliceTrashStatus.trashed_count,
          trashedSliceTotalBytes: sliceTrashStatus.total_bytes,
        }
      : {}),
    ...trashExitPatch,
  };
}
