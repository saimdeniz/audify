import { invoke } from "@tauri-apps/api/core";
import { TrashActionSummary } from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { resolveSamplesByIds } from "../../utils/sampleLookup";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
export { formatTrashOpLabel } from "../../utils/trashStatusFormat";
import {
  AUDIFY_STORAGE_KEYS,
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
  getProfileEpoch: () => number;
  releaseMatchingAudioHandle: (targetSampleIds: number[]) => Promise<unknown>;
  pushBoundedHistory: (
    stack: FileOpHistoryItem[],
    item: FileOpHistoryItem
  ) => FileOpHistoryItem[];
}

function pruneFileOpHistoryStack(
  stack: FileOpHistoryItem[],
  deletedSet: ReadonlySet<number>
): FileOpHistoryItem[] {
  const next: FileOpHistoryItem[] = [];
  for (const item of stack) {
    if (item.kind === "rename") {
      if (!deletedSet.has(item.sampleId)) next.push(item);
    } else if (item.kind === "batch_rename") {
      const entries = item.entries.filter((e) => !deletedSet.has(e.sampleId));
      if (entries.length > 0) next.push({ ...item, entries });
    } else if (item.kind === "move") {
      const moves = item.moves.filter((m) => !deletedSet.has(m.sample_id));
      if (moves.length > 0) next.push({ ...item, moves });
    } else {
      const sampleIds = item.sampleIds.filter((id) => !deletedSet.has(id));
      if (sampleIds.length > 0) next.push({ ...item, sampleIds });
    }
  }
  return next;
}

export function createFileOpsTrashActions(deps: FileOpsTrashDeps) {
  const {
    set,
    get,
    emitNotice,
    getProfileEpoch,
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

    moveSamplesToTrash: async (
      sampleIds: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => {
      if (!sampleIds || sampleIds.length === 0 || get().trashOpStatus) {
        return null;
      }
      const epoch = getProfileEpoch();
      set({
        trashOpStatus: { kind: "moving", count: sampleIds.length },
      });
      try {
        await releaseMatchingAudioHandle(sampleIds);
        const summary = await invokeCommand("move_samples_to_trash", {
          sampleIds,
        });
        if (epoch !== getProfileEpoch()) return null;
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
          let nextKnownIds = state.knownSampleIds;
          if (state.knownSampleIds.size > 0) {
            const mutated = new Set(state.knownSampleIds);
            let removedAny = false;
            for (const id of targetSet) {
              if (mutated.delete(id)) removedAny = true;
            }
            if (removedAny) nextKnownIds = mutated;
          }
          return {
            allProfileSamples: nextAll,
            rawSamples: nextRaw,
            samples: nextSamples,
            knownSampleIds: nextKnownIds,
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
      const stForRelease = get();
      const idsToRelease =
        sampleIds && sampleIds.length > 0
          ? sampleIds
          : Array.from(
              new Set([
                ...stForRelease.trashedProfileSamples.map((s) => s.id),
                ...stForRelease.samples.map((s) => s.id),
                ...(stForRelease.selectedSample?.is_trashed
                  ? [stForRelease.selectedSample.id]
                  : []),
              ])
            );
      const targetCount =
        sampleIds && sampleIds.length > 0
          ? sampleIds.length
          : get().trashedCount || idsToRelease.length;
      const epoch = getProfileEpoch();
      set({
        trashOpStatus: { kind: "restoring", count: targetCount },
      });
      try {
        await releaseMatchingAudioHandle(idsToRelease);
        const summary = await invoke<TrashActionSummary>(
          "restore_samples_from_trash",
          { sampleIds: sampleIds && sampleIds.length > 0 ? sampleIds : [] }
        );
        if (epoch !== getProfileEpoch()) return null;
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
      const stForRelease = get();
      const idsToRelease =
        sampleIds && sampleIds.length > 0
          ? sampleIds
          : Array.from(
              new Set([
                ...stForRelease.trashedProfileSamples.map((s) => s.id),
                ...stForRelease.samples.map((s) => s.id),
                ...(stForRelease.selectedSample?.is_trashed
                  ? [stForRelease.selectedSample.id]
                  : []),
              ])
            );
      const targetCount =
        sampleIds && sampleIds.length > 0
          ? sampleIds.length
          : get().trashedCount || idsToRelease.length;
      const epoch = getProfileEpoch();
      set({
        trashOpStatus: { kind: "emptying", count: targetCount },
      });
      try {
        await releaseMatchingAudioHandle(idsToRelease);
        const summary = await invoke<TrashActionSummary>("empty_audify_trash", {
          sampleIds: sampleIds && sampleIds.length > 0 ? sampleIds : null,
        });
        if (epoch !== getProfileEpoch()) return null;
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
            ...(state.selectedSample && deletedSet.has(state.selectedSample.id)
              ? {
                  selectedSample: null,
                  isPlaying: false,
                  sliceRange: null,
                }
              : {}),
            fileOpUndoStack: pruneFileOpHistoryStack(
              state.fileOpUndoStack,
              deletedSet
            ),
            fileOpRedoStack: pruneFileOpHistoryStack(
              state.fileOpRedoStack,
              deletedSet
            ),
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
