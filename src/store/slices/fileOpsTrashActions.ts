import { invoke } from "@tauri-apps/api/core";
import { TrashActionSummary } from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { resolveSamplesByIds } from "../../utils/sampleLookup";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
export { formatTrashOpLabel } from "../../utils/trashStatusFormat";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
  saveTrashStatus,
} from "../storageHelpers";
import type { FileOpHistoryItem, StoreGet, StoreSet } from "../types";
import {
  pruneDuplicateScanCache,
  pruneDuplicateScanResult,
} from "./duplicateSlice";

export interface FileOpsTrashDeps {
  set: StoreSet;
  get: StoreGet;
  applyInstantMemoryFilter: (opts?: { preserveMultiSelect?: boolean }) => boolean;
  emitNotice: (message: string, kind?: "info" | "success" | "error") => void;
  releaseMatchingAudioHandle: (targetSampleIds: number[]) => Promise<unknown>;
  pushBoundedHistory: (
    stack: FileOpHistoryItem[],
    item: FileOpHistoryItem
  ) => FileOpHistoryItem[];
}

export function createFileOpsTrashActions(deps: FileOpsTrashDeps) {
  const {
    set,
    get,
    applyInstantMemoryFilter,
    emitNotice,
    releaseMatchingAudioHandle,
    pushBoundedHistory,
  } = deps;

  return {
    requestMoveSamplesToTrash: async (sampleIds: number[]) => {
      if (!sampleIds || sampleIds.length === 0) return;
      const state = get();
      if (!state.enableAdvancedFileOps) return;

      const targets = resolveSamplesByIds(
        sampleIds,
        state.samples,
        state.allProfileSamples
      );

      const validIds: number[] = [];
      const sampleNames: string[] = [];
      for (const s of targets) {
        if (s.is_trashed) continue;
        const lib = state.libraries.find((l) => l.id === s.library_id);
        if (lib?.is_read_only) {
          emitNotice(
            `Library "${lib.name}" is locked as a Protected Vault`,
            "error"
          );
          return;
        }
        validIds.push(s.id);
        sampleNames.push(s.file_name);
      }

      if (validIds.length === 0) return;

      if (!state.confirmBeforeTrash) {
        await get().moveSamplesToTrash(validIds);
        return;
      }

      set({
        pendingTrashRequest: {
          kind: "samples",
          sampleIds: validIds,
          sampleNames,
        },
      });
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

    confirmPendingTrashRequest: async (dontAskAgain?: boolean) => {
      const req = get().pendingTrashRequest;
      set({ pendingTrashRequest: null });
      if (!req) return;

      if (dontAskAgain && req.kind === "samples") {
        get().setConfirmBeforeTrash(false);
      }

      if (req.kind === "samples") {
        await get().moveSamplesToTrash(req.sampleIds);
      } else {
        await get().trashPhysicalSubfolder(req.libraryId, req.folderPath);
      }
    },

    cancelPendingTrashRequest: () => {
      set({ pendingTrashRequest: null });
    },

    setTrashFilterActive: (trashFilterActive: boolean) => {
      const wasTrashActive = get().trashFilterActive;
      if (trashFilterActive) {
        persistNavigationFilters(null, null, false, null);
      }
      set({
        trashFilterActive,
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
            }
          : wasTrashActive
          ? { folderFilter: null }
          : {}),
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    moveSamplesToTrash: async (
      sampleIds: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => {
      if (!sampleIds || sampleIds.length === 0 || get().trashOpStatus) {
        return null;
      }
      set({
        trashOpStatus: { kind: "moving", count: sampleIds.length },
      });
      try {
        await releaseMatchingAudioHandle(sampleIds);
        const summary = await invokeCommand("move_samples_to_trash", {
          sampleIds,
        });
        saveTrashStatus(summary.trashed_count, summary.total_bytes);
        clearSmartSearchCache();
        clearSlicePathCache();
        const targetSet = new Set(summary.affected_ids);
        set((state) => {
          const favSource =
            state.allProfileSamples.length > 0
              ? state.allProfileSamples
              : state.samples;
          const removedFavCount = favSource.reduce(
            (acc, s) => (targetSet.has(s.id) && s.is_favorite ? acc + 1 : acc),
            0
          );
          const nextAll = state.allProfileSamples.filter(
            (s) => !targetSet.has(s.id)
          );
          const nextRaw = state.rawSamples.filter((s) => !targetSet.has(s.id));
          const nextSamples = state.samples.filter(
            (s) => !targetSet.has(s.id)
          );
          let nextSelected = state.selectedSample;
          let nextSelectedIds = state.selectedSampleIds.filter(
            (id) => !targetSet.has(id)
          );
          let nextIdx: number | null = null;
          if (nextSelected && targetSet.has(nextSelected.id)) {
            const oldIdx = state.samples.findIndex(
              (s) => s.id === nextSelected!.id
            );
            const candidate =
              nextSamples[Math.min(oldIdx, nextSamples.length - 1)] || null;
            nextSelected = candidate;
            nextSelectedIds = candidate ? [candidate.id] : [];
            nextIdx = candidate
              ? nextSamples.findIndex((s) => s.id === candidate.id)
              : null;
          } else if (nextSelected) {
            nextIdx = nextSamples.findIndex((s) => s.id === nextSelected!.id);
          }
          const nextUndoStack =
            !opts?.isHistoryReplay && summary.affected_ids.length > 0
              ? pushBoundedHistory(state.fileOpUndoStack, {
                  kind: "trash",
                  sampleIds: summary.affected_ids,
                  label: `${summary.affected_count} file(s)`,
                })
              : state.fileOpUndoStack;
          return {
            allProfileSamples: nextAll,
            rawSamples: nextRaw,
            samples: nextSamples,
            favoritesCount: Math.max(0, state.favoritesCount - removedFavCount),
            trashedProfileSamples: [],
            duplicateScanResult: pruneDuplicateScanResult(
              state.duplicateScanResult,
              targetSet
            ),
            duplicateScanCache: pruneDuplicateScanCache(
              state.duplicateScanCache,
              targetSet
            ),
            selectedSample: nextSelected,
            selectedSampleIds: nextSelectedIds,
            lastSelectedIndex:
              nextIdx !== null && nextIdx >= 0 ? nextIdx : null,
            isPlaying:
              state.selectedSample && targetSet.has(state.selectedSample.id)
                ? false
                : state.isPlaying,
            trashedCount: summary.trashed_count,
            trashedTotalBytes: summary.total_bytes,
            fileOpUndoStack: nextUndoStack,
            ...(opts?.isHistoryReplay ? {} : { fileOpRedoStack: [] }),
          };
        });
        if (!opts?.isHistoryReplay) {
          emitNotice(
            `Moved ${summary.affected_count} file(s) to Trash (Ctrl+Z to Undo)`,
            summary.affected_count > 0 ? "success" : "error"
          );
        }
        await get().refreshAfterCatalogMutation({
          reloadSamples: false,
          refreshTrash: true,
          syncCatalog: true,
        });
        return summary;
      } catch (err) {
        emitNotice(`Move to Trash failed: ${String(err)}`, "error");
        return null;
      } finally {
        set({ trashOpStatus: null });
      }
    },

    restoreSamplesFromTrash: async (
      sampleIds?: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => {
      if (get().trashOpStatus) return null;
      const idsToRelease =
        sampleIds && sampleIds.length > 0
          ? sampleIds
          : get().samples.map((s) => s.id);
      const targetCount =
        sampleIds && sampleIds.length > 0
          ? sampleIds.length
          : get().trashedCount || idsToRelease.length;
      set({
        trashOpStatus: { kind: "restoring", count: targetCount },
      });
      try {
        await releaseMatchingAudioHandle(idsToRelease);
        const summary = await invoke<TrashActionSummary>(
          "restore_samples_from_trash",
          { sampleIds: sampleIds && sampleIds.length > 0 ? sampleIds : [] }
        );
        clearSmartSearchCache();
        saveTrashStatus(summary.trashed_count, summary.total_bytes);
        set((state) => {
          const restoredSet = new Set(summary.affected_ids);
          const restoredFavCount = state.trashedProfileSamples.reduce(
            (acc, s) => (restoredSet.has(s.id) && s.is_favorite ? acc + 1 : acc),
            0
          );
          const nextUndoStack =
            !opts?.isHistoryReplay && summary.affected_ids.length > 0
              ? pushBoundedHistory(state.fileOpUndoStack, {
                  kind: "restore",
                  sampleIds: summary.affected_ids,
                  label: `${summary.affected_count} file(s)`,
                })
              : state.fileOpUndoStack;
          return {
            trashedCount: summary.trashed_count,
            trashedTotalBytes: summary.total_bytes,
            favoritesCount: state.favoritesCount + restoredFavCount,
            trashedProfileSamples:
              summary.trashed_count === 0
                ? []
                : state.trashedProfileSamples.filter(
                    (s) => !restoredSet.has(s.id)
                  ),
            fileOpUndoStack: nextUndoStack,
            ...(opts?.isHistoryReplay ? {} : { fileOpRedoStack: [] }),
            ...(summary.trashed_count === 0
              ? state.trashedSliceCount > 0
                ? { trashViewTab: "slices" as const, folderFilter: null }
                : {
                    trashFilterActive: false,
                    trashViewTab: "tracks" as const,
                    folderFilter: null,
                  }
              : {}),
            ...(summary.affected_count > 0 &&
            (state.duplicateScanResult ||
              Object.keys(state.duplicateScanCache).length > 0)
              ? { duplicateScanResult: null, duplicateScanCache: {} }
              : {}),
          };
        });
        if (!opts?.isHistoryReplay) {
          emitNotice(
            `Restored ${summary.affected_count} file(s) to original folder`,
            "success"
          );
        }
        await get().refreshAfterCatalogMutation({
          refreshTrash: true,
          syncCatalog: true,
        });
        return summary;
      } catch (err) {
        emitNotice(`Restore from Trash failed: ${String(err)}`, "error");
        return null;
      } finally {
        set({ trashOpStatus: null });
      }
    },

    emptyAudifyTrash: async (sampleIds?: number[]) => {
      if (get().trashOpStatus) return null;
      const idsToRelease =
        sampleIds && sampleIds.length > 0
          ? sampleIds
          : get().samples.map((s) => s.id);
      const targetCount =
        sampleIds && sampleIds.length > 0
          ? sampleIds.length
          : get().trashedCount || idsToRelease.length;
      set({
        trashOpStatus: { kind: "emptying", count: targetCount },
      });
      try {
        await releaseMatchingAudioHandle(idsToRelease);
        const summary = await invoke<TrashActionSummary>("empty_audify_trash", {
          sampleIds: sampleIds && sampleIds.length > 0 ? sampleIds : null,
        });
        saveTrashStatus(summary.trashed_count, summary.total_bytes);
        clearSmartSearchCache();
        clearSlicePathCache();
        const deletedSet = new Set(summary.affected_ids);
        const preState = get();
        const nextBin = preState.binSampleIds.filter(
          (id) => !deletedSet.has(id)
        );
        const nextRecent = preState.recentSampleIds.filter(
          (id) => !deletedSet.has(id)
        );
        const binChanged = nextBin.length !== preState.binSampleIds.length;
        const recentChanged =
          nextRecent.length !== preState.recentSampleIds.length;
        if (binChanged) {
          safeSetItem(AUDIFY_STORAGE_KEYS.binSampleIds, JSON.stringify(nextBin));
        }
        if (recentChanged) {
          safeSetItem(
            AUDIFY_STORAGE_KEYS.recentSampleIds,
            JSON.stringify(nextRecent)
          );
        }
        set((state) => {
          const retainHistoryItem = (item: FileOpHistoryItem) =>
            item.kind === "rename"
              ? !deletedSet.has(item.sampleId)
              : item.kind === "batch_rename"
              ? item.entries.some((entry) => !deletedSet.has(entry.sampleId))
              : item.kind === "move"
              ? item.moves.some((m) => !deletedSet.has(m.sample_id))
              : item.sampleIds.some((id) => !deletedSet.has(id));
          return {
            trashedCount: summary.trashed_count,
            trashedTotalBytes: summary.total_bytes,
            trashedProfileSamples:
              summary.trashed_count === 0
                ? []
                : state.trashedProfileSamples.filter(
                    (s) => !deletedSet.has(s.id)
                  ),
            binSampleIds: nextBin,
            recentSampleIds: nextRecent,
            selectedSampleIds: state.selectedSampleIds.filter(
              (id) => !deletedSet.has(id)
            ),
            fileOpUndoStack: state.fileOpUndoStack.filter(retainHistoryItem),
            fileOpRedoStack: state.fileOpRedoStack.filter(retainHistoryItem),
            ...(summary.trashed_count === 0
              ? state.trashedSliceCount > 0
                ? { trashViewTab: "slices" as const, folderFilter: null }
                : {
                    trashFilterActive: false,
                    trashViewTab: "tracks" as const,
                    folderFilter: null,
                  }
              : {}),
          };
        });
        if (binChanged) {
          void get().persistActiveProfileSettings();
        }
        emitNotice(
          `Moved ${summary.affected_count} file(s) to Windows Recycle Bin`,
          "success"
        );
        await get().refreshAfterCatalogMutation({
          refreshTrash: true,
          syncCatalog: true,
        });
        return summary;
      } catch (err) {
        emitNotice(`Empty Trash failed: ${String(err)}`, "error");
        return null;
      } finally {
        set({ trashOpStatus: null });
      }
    },
  };
}
