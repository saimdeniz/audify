import { invoke } from "@tauri-apps/api/core";
import type { AudioHandleReleaseSnapshot } from "../../services/audioPlaybackService";
import { SampleItem } from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { splitFileNameAndExt } from "../../utils/format";
import { internSamplePool } from "../../utils/sampleInterning";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import {
  LAST_SELECTED_SAMPLE_PATH_KEY,
  postCrossWindowSync,
  safeSetItem,
} from "../storageHelpers";
import type { StoreGet, StoreSet } from "../types";
import {
  applySampleRenameState,
  pushBoundedHistory,
  replayFileOpHistoryItem,
} from "./fileOpsHistoryHelpers";

export interface FileOpsSingleDeps {
  set: StoreSet;
  get: StoreGet;
  emitNotice: (message: string, kind?: "info" | "success" | "error") => void;
  getProfileEpoch: () => number;
  releaseMatchingAudioHandle: (
    targetSampleIds: number[]
  ) => Promise<AudioHandleReleaseSnapshot>;
}

let isReplayingHistory = false;

export function createFileOpsSingleActions(deps: FileOpsSingleDeps) {
  const { set, get, emitNotice, getProfileEpoch, releaseMatchingAudioHandle } =
    deps;

  return {
    renameSampleFile: async (
      sampleId: number,
      newStem: string,
      opts?: { isHistoryReplay?: boolean }
    ) => {
      const prevSample =
        get().allProfileSamples.find((s) => s.id === sampleId) ||
        get().samples.find((s) => s.id === sampleId);
      const oldFileName = prevSample?.file_name || "";
      const oldStem = oldFileName ? splitFileNameAndExt(oldFileName).stem : "";
      const releaseSnap = await releaseMatchingAudioHandle([sampleId]);
      try {
        const updated = await invoke<SampleItem>("rename_sample_file", {
          sampleId,
          newStem,
        });
        internSamplePool([updated], get().tags);
        clearSmartSearchCache();
        clearSlicePathCache();
        const updatedStem = splitFileNameAndExt(updated.file_name).stem;
        applySampleRenameState(set, sampleId, updated, releaseSnap, (state) => {
          const nextUndoStack =
            !opts?.isHistoryReplay && oldStem && oldStem !== updatedStem
              ? pushBoundedHistory(state.fileOpUndoStack, {
                  kind: "rename",
                  sampleId,
                  oldStem,
                  newStem: updatedStem,
                  oldFileName,
                  newFileName: updated.file_name,
                })
              : state.fileOpUndoStack;
          return {
            fileOpUndoStack: nextUndoStack,
            ...(opts?.isHistoryReplay ? {} : { fileOpRedoStack: [] }),
          };
        });
        if (get().selectedSample?.id === sampleId) {
          safeSetItem(LAST_SELECTED_SAMPLE_PATH_KEY, updated.file_path);
        }
        if (!opts?.isHistoryReplay) {
          emitNotice(
            `Renamed to "${updated.file_name}" (Ctrl+Z to Undo)`,
            "success"
          );
        }
        await get().refreshTrashStatus();
        postCrossWindowSync("catalog");
        return updated;
      } catch (err) {
        emitNotice(`Rename failed: ${String(err)}`, "error");
        return null;
      }
    },

    undoRenameSampleFile: async (sampleId: number) => {
      const currentSample =
        get().allProfileSamples.find((s) => s.id === sampleId) ||
        get().samples.find((s) => s.id === sampleId);
      const currentName = currentSample?.file_name || "";
      const prevName = currentSample?.previous_file_name || "";

      if (prevName) {
        const targetOldStem = splitFileNameAndExt(prevName).stem;
        const currentStem = currentName
          ? splitFileNameAndExt(currentName).stem
          : "";
        const updated = await get().renameSampleFile(sampleId, targetOldStem, {
          isHistoryReplay: true,
        });
        if (updated) {
          set((state) => ({
            fileOpUndoStack: state.fileOpUndoStack.filter(
              (item) =>
                !(
                  item.kind === "rename" &&
                  item.sampleId === sampleId &&
                  item.newStem === currentStem
                )
            ),
            fileOpRedoStack: currentStem
              ? pushBoundedHistory(state.fileOpRedoStack, {
                  kind: "rename",
                  sampleId,
                  oldStem: targetOldStem,
                  newStem: currentStem,
                  oldFileName: updated.file_name,
                  newFileName: currentName || updated.file_name,
                })
              : state.fileOpRedoStack,
          }));
          emitNotice(
            `Restored original name "${updated.file_name}" (Ctrl+Y to Redo)`,
            "success"
          );
        }
        return updated;
      }

      const releaseSnap = await releaseMatchingAudioHandle([sampleId]);
      try {
        const updated = await invoke<SampleItem>("undo_rename_sample_file", {
          sampleId,
        });
        internSamplePool([updated], get().tags);
        clearSmartSearchCache();
        clearSlicePathCache();
        applySampleRenameState(set, sampleId, updated, releaseSnap);
        if (get().selectedSample?.id === sampleId) {
          safeSetItem(LAST_SELECTED_SAMPLE_PATH_KEY, updated.file_path);
        }
        emitNotice(`Restored original name "${updated.file_name}"`, "success");
        await get().refreshTrashStatus();
        postCrossWindowSync("catalog");
        return updated;
      } catch (err) {
        emitNotice(`Undo rename failed: ${String(err)}`, "error");
        return null;
      }
    },

    undoLastFileOp: async () => {
      if (isReplayingHistory) return false;
      const stack = get().fileOpUndoStack;
      if (stack.length > 0) {
        const item = stack[stack.length - 1];
        isReplayingHistory = true;
        try {
          return await replayFileOpHistoryItem(item, "undo", {
            set,
            get,
            emitNotice,
            getProfileEpoch,
            releaseMatchingAudioHandle,
            popFromSourceStack: true,
          });
        } finally {
          isReplayingHistory = false;
        }
      }

      // Global Ctrl+Z is strictly session-scoped so historical SQLite journal entries
      // from previous app sessions never silently mutate files weeks later.
      emitNotice("Nothing to undo", "info");
      return false;
    },

    redoLastFileOp: async () => {
      if (isReplayingHistory) return false;
      const redoStack = get().fileOpRedoStack;
      if (redoStack.length === 0) {
        emitNotice("Nothing to redo", "info");
        return false;
      }
      const item = redoStack[redoStack.length - 1];
      isReplayingHistory = true;
      try {
        return await replayFileOpHistoryItem(item, "redo", {
          set,
          get,
          emitNotice,
          getProfileEpoch,
          releaseMatchingAudioHandle,
          popFromSourceStack: true,
        });
      } finally {
        isReplayingHistory = false;
      }
    },
  };
}
