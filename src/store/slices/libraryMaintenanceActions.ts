import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Library } from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { normalizePathForMatch } from "../../utils/format";
import { clearHiResPeaksCache } from "../../utils/hiResPeaks";
import { clearPeaksCache } from "../../utils/peaksStore";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { resetPlayheadClock } from "../playheadClock";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export function createLibraryMaintenanceActions(ctx: StoreSliceContext) {
  const { set, get, getProfileEpoch, emitNotice } = ctx;

  return {
    addAndScanFolder: async () => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Audio / SFX Library Folder to Index",
        });

        if (!selected || typeof selected !== "string") {
          return;
        }

        await get().scanSpecificPath(selected, false);
      } catch (err) {
        console.error("Folder dialog or scan error:", err);
        set({ isScanning: false });
        emitNotice(`Scan error: ${String(err)}`, "error");
      }
    },

    scanSpecificPath: async (path: string, forceRebuild = false) => {
      if (get().isScanning) return;
      const epoch = getProfileEpoch();
      set({
        isScanning: true,
        scanProgress: {
          library_path: path,
          processed: 0,
          total: 0,
          percentage: 0,
          current_file: forceRebuild
            ? "Rebuilding 600-bin RMS+Peak waveforms..."
            : "Syncing folder changes...",
        },
        statusMessage: forceRebuild
          ? `Rebuilding 600-bin waveforms for ${path}...`
          : `Syncing ${path}...`,
      });

      try {
        const lib = await invoke<Library>("sync_library_incremental", {
          libraryPath: path,
          targetFolder: null,
          forceRebuild,
        });
        if (epoch !== getProfileEpoch()) {
          set({ isScanning: false });
          return;
        }
        clearPeaksCache();
        if (forceRebuild) {
          clearHiResPeaksCache();
        }
        clearSmartSearchCache();
        await get().refreshAfterCatalogMutation();
        if (epoch !== getProfileEpoch()) {
          set({ isScanning: false });
          return;
        }
        const msg = `Synced ${lib.sample_count} samples in "${lib.name}"`;
        set({
          isScanning: false,
          statusMessage: msg,
        });
        emitNotice(msg, "success");
        if (get().autoAnalyzeBpmKey) {
          void get().analyzeLibraryBpmAndKey(lib.id, false);
        }
        if (get().aiAutoAnalyzeOnScan) {
          void get().analyzeSamplesAi({
            reanalyzeExisting: false,
            silentIfNotReady: true,
          });
        }
      } catch (err) {
        console.error("Failed to scan library:", err);
        set({ isScanning: false });
        emitNotice(`Scan failed: ${String(err)}`, "error");
      }
    },

    syncFolderIncremental: async (libraryPath: string, targetFolder?: string) => {
      if (get().isScanning) return;
      const epoch = getProfileEpoch();
      const label = targetFolder || libraryPath;
      set({
        isScanning: true,
        scanProgress: {
          library_path: label,
          processed: 0,
          total: 0,
          percentage: 0,
          current_file: "Checking new, modified, or removed audio files...",
        },
        statusMessage: `Syncing folder: ${label}...`,
      });

      try {
        const lib = await invoke<Library>("sync_library_incremental", {
          libraryPath,
          targetFolder: targetFolder || null,
          forceRebuild: false,
        });
        if (epoch !== getProfileEpoch()) {
          set({ isScanning: false });
          return;
        }
        clearPeaksCache();
        clearSmartSearchCache();
        await get().refreshAfterCatalogMutation();
        if (epoch !== getProfileEpoch()) {
          set({ isScanning: false });
          return;
        }
        set({
          isScanning: false,
          statusMessage: `Synced "${lib.name}" (${lib.sample_count} samples)`,
        });
        if (get().aiAutoAnalyzeOnScan) {
          void get().analyzeSamplesAi({
            reanalyzeExisting: false,
            silentIfNotReady: true,
          });
        }
      } catch (err) {
        console.error("Failed to sync folder incrementally:", err);
        set({ isScanning: false });
        if (epoch !== getProfileEpoch()) return;
        emitNotice(`Sync failed: ${String(err)}`, "error");
      }
    },

    setLibraryProfileScope: async (
      libraryId: number,
      isGlobal: boolean,
      assignedToProfile: boolean
    ) => {
      const epoch = getProfileEpoch();
      try {
        await invoke("set_library_profile_scope", {
          libraryId,
          isGlobal,
          assignedToProfile,
        });
        if (epoch !== getProfileEpoch()) return;
        await get().refreshAfterCatalogMutation();
        if (epoch !== getProfileEpoch()) return;
        set({ statusMessage: "Updated library profile visibility" });
      } catch (err) {
        console.error("Failed to update library profile scope:", err);
        if (epoch !== getProfileEpoch()) return;
        emitNotice(`Library visibility error: ${String(err)}`, "error");
      }
    },

    removeLibrary: async (libraryId: number) => {
      const epoch = getProfileEpoch();
      try {
        await invoke("remove_library", { libraryId });
        if (epoch !== getProfileEpoch()) return;
        clearPeaksCache();
        clearHiResPeaksCache();
        clearSmartSearchCache();
        clearSlicePathCache();

        const wasSelectedInRemovedLib =
          get().selectedSample?.library_id === libraryId;
        if (wasSelectedInRemovedLib) {
          resetPlayheadClock(0);
        }

        persistNavigationFilters(
          null,
          get().selectedLicenseGroupId,
          get().favoriteOnly,
          get().selectedCollectionId
        );

        set((state) => ({
          folderFilter: null,
          ...(wasSelectedInRemovedLib
            ? {
                selectedSample: null,
                isPlaying: false,
                currentTimeSec: 0,
                durationSec: 0,
                sliceRange: null,
              }
            : {}),
          selectedSampleIds: state.selectedSampleIds,
          statusMessage: "Library removed from database",
        }));

        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to remove library:", err);
        emitNotice(`Remove library error: ${String(err)}`, "error");
      }
    },

    relinkLibraryFolder: async (libraryId: number) => {
      const epoch = getProfileEpoch();
      try {
        const prevLib = get().libraries.find((l) => l.id === libraryId);
        const selected = await open({
          directory: true,
          multiple: false,
          title: prevLib
            ? `Select New Folder Location for "${prevLib.name}"`
            : "Select New Library Folder Location",
        });
        if (!selected || typeof selected !== "string" || epoch !== getProfileEpoch()) {
          return;
        }

        const updatedLib = await invoke<Library>("relink_library_folder", {
          libraryId,
          newPath: selected,
        });
        if (epoch !== getProfileEpoch()) return;

        clearPeaksCache();
        clearHiResPeaksCache();
        clearSmartSearchCache();
        clearSlicePathCache();

        const curFolder = get().folderFilter;
        if (prevLib && curFolder) {
          const normPrev = normalizePathForMatch(prevLib.path);
          const normCur = normalizePathForMatch(curFolder);
          const normNew = normalizePathForMatch(updatedLib.path);
          if (normCur === normPrev) {
            persistNavigationFilters(
              updatedLib.path,
              get().selectedLicenseGroupId,
              get().favoriteOnly,
              get().selectedCollectionId
            );
            set({ folderFilter: updatedLib.path });
          } else if (normCur.startsWith(`${normPrev}/`)) {
            const rel = normCur.slice(normPrev.length + 1);
            const nextFolder = `${normNew}/${rel}`;
            persistNavigationFilters(
              nextFolder,
              get().selectedLicenseGroupId,
              get().favoriteOnly,
              get().selectedCollectionId
            );
            set({ folderFilter: nextFolder });
          }
        }

        await get().syncFolderIncremental(updatedLib.path);
        const msg = `Relinked library to "${updatedLib.name}" (${updatedLib.sample_count} samples preserved)`;
        set({ statusMessage: msg });
        emitNotice(msg, "success");
      } catch (err) {
        console.error("Failed to relink library folder:", err);
        emitNotice(`Relink failed: ${String(err)}`, "error");
      }
    },

    analyzeLibraryBpmAndKey: async (
      libraryId: number | null = null,
      overwrite = false
    ) => {
      if (get().isAnalyzingBpmKey) return;
      const epoch = getProfileEpoch();
      set({
        isAnalyzingBpmKey: true,
        bpmKeyProgress: {
          processed: 0,
          total: 0,
          percentage: 0,
          current_file: "Preparing BPM & Musical Key DSP analysis...",
          updated_count: 0,
        },
        statusMessage: "Analyzing BPM & Musical Key / Camelot across library...",
      });

      try {
        const updatedCount = await invoke<number>(
          "analyze_library_bpm_and_key",
          {
            libraryId: libraryId ?? null,
            overwriteExisting: overwrite,
          }
        );
        if (epoch !== getProfileEpoch()) {
          set({ isAnalyzingBpmKey: false });
          return;
        }
        clearSmartSearchCache();
        await get().reloadProfileSamples();
        if (epoch !== getProfileEpoch()) {
          set({ isAnalyzingBpmKey: false });
          return;
        }
        const msg =
          updatedCount > 0
            ? `BPM & Key analysis complete (${updatedCount} track(s) classified)`
            : "BPM & Key analysis complete (no additional tonal/rhythmic tracks detected)";
        set({
          isAnalyzingBpmKey: false,
          statusMessage: msg,
        });
        emitNotice(msg, "success");
      } catch (err) {
        console.error("BPM & Key analysis failed:", err);
        set({ isAnalyzingBpmKey: false });
        if (epoch !== getProfileEpoch()) return;
        emitNotice(`BPM / Key analysis error: ${String(err)}`, "error");
      }
    },

    rebuildAllLibraries: async () => {
      const { libraries, isScanning } = get();
      if (isScanning || libraries.length === 0) return;

      for (const lib of libraries) {
        await get().scanSpecificPath(lib.path, true);
      }
      safeSetItem(AUDIFY_STORAGE_KEYS.peaksV3Rms600, "done");
    },
  };
}
