import { invoke } from "@tauri-apps/api/core";
import {
  AudioHandleReleaseSnapshot,
  releaseAudioFileHandleIfMatching,
} from "../../services/audioPlaybackService";
import type { TrashStatusInfo, TrashViewTab } from "../../types";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
  saveTrashStatus,
} from "../storageHelpers";
import { StoreSliceContext } from "../types";

export function createFileOpsSlice(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  const releaseMatchingAudioHandle = async (
    targetSampleIds: number[]
  ): Promise<AudioHandleReleaseSnapshot> => {
    const state = get();
    return releaseAudioFileHandleIfMatching(
      {
        activeSampleId: state.selectedSample?.id ?? null,
        isPlaying: state.isPlaying,
        currentTimeSec: state.currentTimeSec,
        stopPlaying: () => state.setIsPlaying(false),
      },
      targetSampleIds
    );
  };

  let cachedTrashActions: ReturnType<
    typeof import("./fileOpsTrashActions").createFileOpsTrashActions
  > | null = null;
  const loadTrashActions = async () => {
    if (!cachedTrashActions) {
      const [{ createFileOpsTrashActions }, { pushBoundedHistory }] =
        await Promise.all([
          import("./fileOpsTrashActions"),
          import("./fileOpsHistoryHelpers"),
        ]);
      cachedTrashActions = createFileOpsTrashActions({
        set,
        get,
        applyInstantMemoryFilter,
        emitNotice,
        releaseMatchingAudioHandle,
        pushBoundedHistory,
      });
    }
    return cachedTrashActions;
  };

  let cachedFolderActions: ReturnType<
    typeof import("./fileOpsFolderActions").createFileOpsFolderActions
  > | null = null;
  const loadFolderActions = async () => {
    if (!cachedFolderActions) {
      const [{ createFileOpsFolderActions }, { pushBoundedHistory }] =
        await Promise.all([
          import("./fileOpsFolderActions"),
          import("./fileOpsHistoryHelpers"),
        ]);
      cachedFolderActions = createFileOpsFolderActions({
        set,
        get,
        emitNotice,
        releaseMatchingAudioHandle,
        pushBoundedHistory,
      });
    }
    return cachedFolderActions;
  };

  let cachedBatchRenameActions: ReturnType<
    typeof import("./fileOpsRenameActions").createFileOpsBatchRenameActions
  > | null = null;
  const loadBatchRenameActions = async () => {
    if (!cachedBatchRenameActions) {
      const [{ createFileOpsBatchRenameActions }, { pushBoundedHistory }] =
        await Promise.all([
          import("./fileOpsRenameActions"),
          import("./fileOpsHistoryHelpers"),
        ]);
      cachedBatchRenameActions = createFileOpsBatchRenameActions({
        set,
        get,
        emitNotice,
        releaseMatchingAudioHandle,
        pushBoundedHistory,
      });
    }
    return cachedBatchRenameActions;
  };

  let cachedSingleActions: ReturnType<
    typeof import("./fileOpsSingleActions").createFileOpsSingleActions
  > | null = null;
  const loadSingleActions = async () => {
    if (!cachedSingleActions) {
      const { createFileOpsSingleActions } = await import(
        "./fileOpsSingleActions"
      );
      cachedSingleActions = createFileOpsSingleActions({
        set,
        get,
        emitNotice,
        releaseMatchingAudioHandle,
      });
    }
    return cachedSingleActions;
  };

  return {
    setEnableAdvancedFileOps: (enableAdvancedFileOps: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.enableAdvancedFileOps,
        String(enableAdvancedFileOps)
      );
      set({
        enableAdvancedFileOps,
        batchRenameSampleIds: enableAdvancedFileOps
          ? get().batchRenameSampleIds
          : null,
        pendingTrashRequest: enableAdvancedFileOps
          ? get().pendingTrashRequest
          : null,
        pendingFileConflictPrompt: enableAdvancedFileOps
          ? get().pendingFileConflictPrompt
          : null,
        statusMessage: enableAdvancedFileOps
          ? "Enabled Advanced Physical File Operations (F2 Rename, Folder Management & Trash)"
          : "Disabled Advanced Physical File Operations (Read-Only Safe Mode)",
      });
      void get().persistActiveProfileSettings();
    },

    setConfirmBeforeTrash: (confirmBeforeTrash: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.confirmBeforeTrash,
        String(confirmBeforeTrash)
      );
      set({
        confirmBeforeTrash,
        statusMessage: confirmBeforeTrash
          ? "Enabled confirmation prompt before moving files to Trash"
          : "Disabled confirmation prompt before moving files to Trash",
      });
      void get().persistActiveProfileSettings();
    },

    requestTrashSubfolder: (
      libraryId: number,
      folderPath: string,
      folderName: string,
      sampleCount: number
    ) => {
      const state = get();
      if (!state.enableAdvancedFileOps) return;
      const lib = state.libraries.find((l) => l.id === libraryId);
      if (lib?.is_read_only) {
        emitNotice(
          `Library "${lib.name}" is locked as a Protected Vault`,
          "error"
        );
        return;
      }
      set({
        pendingTrashRequest: {
          kind: "folder",
          libraryId,
          folderPath,
          folderName,
          sampleCount,
        },
      });
    },

    cancelPendingTrashRequest: () => set({ pendingTrashRequest: null }),

    setTrashFilterActive: (trashFilterActive: boolean) => {
      const wasTrashActive = get().trashFilterActive;
      const curState = get();
      const nextTab: TrashViewTab = trashFilterActive
        ? curState.trashedCount === 0 && curState.trashedSliceCount > 0
          ? "slices"
          : "tracks"
        : "tracks";
      if (trashFilterActive) {
        persistNavigationFilters(null, null, false, null);
      }
      set({
        trashFilterActive,
        trashViewTab: nextTab,
        ...(trashFilterActive
          ? {
              folderFilter: null,
              selectedLicenseGroupId: null,
              binFilterActive: false,
              duplicatesFilterActive: false,
              slicesFilterActive: false,
              favoriteOnly: false,
              recentOnly: false,
              selectedCollectionId: null,
              selectedSliceIds: [],
              activeSliceId: null,
            }
          : wasTrashActive
          ? { folderFilter: null, selectedSliceIds: [], activeSliceId: null }
          : {}),
      });
      if (trashFilterActive && nextTab === "slices") {
        void get().fetchTrashedSlices();
        return;
      }
      if (trashFilterActive) {
        void get().fetchSliceTrashStatus();
      }
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    setTrashViewTab: (trashViewTab: TrashViewTab) => {
      set({
        trashViewTab,
        selectedSampleIds: [],
        selectedSliceIds: [],
        activeSliceId: null,
        batchRenameSliceIds: null,
        batchRenameSampleIds: null,
      });
      if (trashViewTab === "slices") {
        void get().fetchTrashedSlices();
      } else {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }
    },

    openBatchRenameModal: (sampleIds: number[]) => {
      if (!get().enableAdvancedFileOps || get().trashFilterActive) return;
      const cleanIds = Array.from(
        new Set(sampleIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (cleanIds.length === 0) return;
      set({ batchRenameSampleIds: cleanIds });
    },

    closeBatchRenameModal: () => set({ batchRenameSampleIds: null }),

    requestMoveSamplesToTrash: async (sampleIds: number[]) =>
      (await loadTrashActions()).requestMoveSamplesToTrash(sampleIds),
    confirmPendingTrashRequest: async (dontAskAgain?: boolean) =>
      (await loadTrashActions()).confirmPendingTrashRequest(dontAskAgain),
    refreshTrashStatus: async () => {
      try {
        const info = await invoke<TrashStatusInfo>("get_trash_status");
        saveTrashStatus(info.trashed_count, info.total_bytes);
        const st = get();
        const wasTrashActive = st.trashFilterActive;
        const shouldExitTrash =
          wasTrashActive && info.trashed_count === 0 && st.trashedSliceCount === 0;
        const shouldSwitchToSlices =
          wasTrashActive &&
          info.trashed_count === 0 &&
          st.trashedSliceCount > 0 &&
          st.trashViewTab !== "slices";
        set({
          trashedCount: info.trashed_count,
          trashedTotalBytes: info.total_bytes,
          fileOpJournal: Array.isArray(info.journal_entries)
            ? info.journal_entries
            : [],
          ...(shouldExitTrash
            ? {
                trashFilterActive: false,
                trashViewTab: "tracks" as const,
                folderFilter: null,
                trashedProfileSamples: [],
              }
            : shouldSwitchToSlices
            ? {
                trashViewTab: "slices" as const,
                trashedProfileSamples: [],
              }
            : {}),
        });
        if (shouldExitTrash) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
            void get().fetchSamples({ preserveMultiSelect: false });
          }
        } else if (shouldSwitchToSlices) {
          void get().fetchTrashedSlices();
        }
      } catch (err) {
        console.error("Failed to fetch trash status:", err);
      }
    },
    moveSamplesToTrash: async (
      sampleIds: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => (await loadTrashActions()).moveSamplesToTrash(sampleIds, opts),
    restoreSamplesFromTrash: async (
      sampleIds?: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => (await loadTrashActions()).restoreSamplesFromTrash(sampleIds, opts),
    emptyAudifyTrash: async (sampleIds?: number[]) =>
      (await loadTrashActions()).emptyAudifyTrash(sampleIds),

    resolvePendingFileConflict: async (
      policy: "skip" | "keep_both" | "cancel"
    ) => (await loadFolderActions()).resolvePendingFileConflict(policy),
    setLibraryReadOnly: async (libraryId: number, isReadOnly: boolean) =>
      (await loadFolderActions()).setLibraryReadOnly(libraryId, isReadOnly),
    createPhysicalSubfolder: async (
      libraryId: number,
      parentFolderPath: string,
      newFolderName: string
    ) =>
      (await loadFolderActions()).createPhysicalSubfolder(
        libraryId,
        parentFolderPath,
        newFolderName
      ),
    renamePhysicalSubfolder: async (
      libraryId: number,
      folderPath: string,
      newFolderName: string
    ) =>
      (await loadFolderActions()).renamePhysicalSubfolder(
        libraryId,
        folderPath,
        newFolderName
      ),
    trashPhysicalSubfolder: async (libraryId: number, folderPath: string) =>
      (await loadFolderActions()).trashPhysicalSubfolder(libraryId, folderPath),
    moveSamplesToFolder: async (
      sampleIds: number[],
      targetLibraryId: number,
      targetFolderPath: string,
      conflictPolicy?: "prompt" | "skip" | "keep_both"
    ) =>
      (await loadFolderActions()).moveSamplesToFolder(
        sampleIds,
        targetLibraryId,
        targetFolderPath,
        conflictPolicy
      ),
    importExternalFilesToFolder: async (
      libraryId: number,
      targetFolderPath: string,
      externalPaths: string[],
      conflictPolicy?: "prompt" | "skip" | "keep_both"
    ) =>
      (await loadFolderActions()).importExternalFilesToFolder(
        libraryId,
        targetFolderPath,
        externalPaths,
        conflictPolicy
      ),

    batchRenameSamples: async (
      entries: Array<{ sample_id: number; new_stem: string }>,
      opts?: { isHistoryReplay?: boolean }
    ) => (await loadBatchRenameActions()).batchRenameSamples(entries, opts),

    renameSampleFile: async (
      sampleId: number,
      newStem: string,
      opts?: { isHistoryReplay?: boolean }
    ) => (await loadSingleActions()).renameSampleFile(sampleId, newStem, opts),
    undoRenameSampleFile: async (sampleId: number) =>
      (await loadSingleActions()).undoRenameSampleFile(sampleId),
    undoLastFileOp: async () => (await loadSingleActions()).undoLastFileOp(),
    redoLastFileOp: async () => (await loadSingleActions()).redoLastFileOp(),
  };
}
