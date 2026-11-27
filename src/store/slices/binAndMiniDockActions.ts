import type { SampleItem } from "../../types";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export function createBinAndMiniDockActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter } = ctx;
  const loadWindowActions = () => import("./miniDockWindowActions");

  return {
    addSamplesToBin: (sampleIds: number[]) => {
      const validIds = (sampleIds || []).filter(
        (id) => Number.isSafeInteger(id) && id > 0
      );
      if (validIds.length === 0) return;
      const current = get().binSampleIds;
      const existingSet = new Set(current);
      const added: number[] = [];
      for (const id of validIds) {
        if (!existingSet.has(id)) {
          existingSet.add(id);
          added.push(id);
        }
      }
      if (added.length === 0) {
        set({
          statusMessage:
            validIds.length === 1
              ? "Track is already in Session Bin"
              : "Selected tracks are already in Session Bin",
        });
        return;
      }
      const next = [...current, ...added];
      safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(next));
      const prevKnown = get().knownSampleIds;
      const missingFromKnown = added.some((id) => !prevKnown.has(id));
      const nextKnownIds = missingFromKnown
        ? new Set([...prevKnown, ...added])
        : prevKnown;
      set({
        binSampleIds: next,
        ...(missingFromKnown ? { knownSampleIds: nextKnownIds } : {}),
        statusMessage: `Added ${added.length} track(s) to Session Bin (${next.length} in Bin)`,
      });
      if (get().binFilterActive) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      }
      void get().persistActiveProfileSettings();
    },

    removeSampleFromBin: (sampleId: number) => {
      get().removeSamplesFromBin([sampleId]);
    },

    removeSamplesFromBin: (sampleIds: number[]) => {
      if (!sampleIds || sampleIds.length === 0) return;
      const removeSet = new Set(sampleIds);
      const current = get().binSampleIds;
      const next = current.filter((id) => !removeSet.has(id));
      const removedCount = current.length - next.length;
      if (removedCount === 0) return;
      safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(next));
      const shouldDisableFilter = next.length === 0 && get().binFilterActive;
      set({
        binSampleIds: next,
        ...(shouldDisableFilter ? { binFilterActive: false, folderFilter: null } : {}),
        statusMessage:
          removedCount === 1
            ? `Removed track from Session Bin (${next.length} remaining)`
            : `Removed ${removedCount} tracks from Session Bin (${next.length} remaining)`,
      });
      if (get().binFilterActive || shouldDisableFilter) {
        if (
          !applyInstantMemoryFilter({
            preserveMultiSelect: !shouldDisableFilter,
          })
        ) {
          void get().fetchSamples({
            preserveMultiSelect: !shouldDisableFilter,
          });
        }
      }
      void get().persistActiveProfileSettings();
    },

    clearBin: () => {
      const wasFiltering = get().binFilterActive;
      safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify([]));
      set({
        binSampleIds: [],
        binFilterActive: false,
        statusMessage: "Cleared Session Bin",
      });
      if (wasFiltering) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }
      void get().persistActiveProfileSettings();
    },

    setAutoBinOnNleDrag: (autoBinOnNleDrag: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.autoBinOnNleDrag,
        String(autoBinOnNleDrag)
      );
      set({
        autoBinOnNleDrag,
        statusMessage: autoBinOnNleDrag
          ? "Auto-Add to Session Bin on NLE drag enabled"
          : "Auto-Add to Session Bin on NLE drag disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setSidebarCollapsed: (sidebarCollapsed: boolean) => {
      safeSetItem(AUDIFY_STORAGE_KEYS.sidebarCollapsed, String(sidebarCollapsed), {
        broadcast: false,
        markEdited: false,
      });
      set({ sidebarCollapsed });
    },

    toggleSidebarCollapsed: () => {
      const next = !get().sidebarCollapsed;
      safeSetItem(AUDIFY_STORAGE_KEYS.sidebarCollapsed, String(next), {
        broadcast: false,
        markEdited: false,
      });
      set({ sidebarCollapsed: next });
    },

    setSidebarCompactHover: (sidebarCompactHover: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.sidebarCompactHover,
        String(sidebarCompactHover)
      );
      set({
        sidebarCompactHover,
        statusMessage: sidebarCompactHover
          ? "Compact sidebar hover overlay enabled"
          : "Compact sidebar hover overlay disabled",
      });
      void get().persistActiveProfileSettings();
    },

    setBinFilterActive: (binFilterActive: boolean) => {
      if (binFilterActive) {
        persistNavigationFilters(null, null, false, null);
      }
      set({
        binFilterActive,
        ...(binFilterActive
          ? {
              folderFilter: null,
              selectedLicenseGroupId: null,
              favoriteOnly: false,
              recentOnly: false,
              trashFilterActive: false,
              duplicatesFilterActive: false,
              slicesFilterActive: false,
              layersFilterActive: false,
              selectedCollectionId: null,
            }
          : {}),
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setCustomSliceExportPath: (customSliceExportPath: string) => {
      const clean = customSliceExportPath.trim();
      safeSetItem(AUDIFY_STORAGE_KEYS.customSliceExportPath, clean);
      set({
        customSliceExportPath: clean,
        statusMessage: clean
          ? `Set custom slice export folder: ${clean}`
          : "Reset slice export folder to default (user/slices)",
      });
      void get().persistActiveProfileSettings();
    },

    pickCustomSliceExportPath: async () =>
      (await loadWindowActions()).runPickCustomSliceExportPath(ctx),

    openSlicesFolder: async () =>
      (await loadWindowActions()).runOpenSlicesFolder(ctx),

    toggleMiniDock: async () =>
      (await loadWindowActions()).runToggleMiniDock(ctx),

    setMiniDockPinned: async (isMiniDockPinned: boolean) =>
      (await loadWindowActions()).runSetMiniDockPinned(ctx, isMiniDockPinned),

    copySamplePaths: async (targetSamples?: SampleItem[]) =>
      (await loadWindowActions()).runCopySamplePaths(ctx, targetSamples),
  };
}
