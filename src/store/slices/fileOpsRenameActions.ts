import { AudioHandleReleaseSnapshot } from "../../services/audioPlaybackService";
import { BatchRenameEntryInput, BatchRenameRecord, SampleItem } from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { splitFileNameAndExt } from "../../utils/format";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  LAST_SELECTED_SAMPLE_PATH_KEY,
  postCrossWindowSync,
  safeSetItem,
} from "../storageHelpers";
import type { FileOpHistoryItem, SampleStoreState, StoreGet, StoreSet } from "../types";

export interface FileOpsBatchRenameDeps {
  set: StoreSet;
  get: StoreGet;
  emitNotice: (message: string, kind?: "info" | "success" | "error") => void;
  releaseMatchingAudioHandle: (
    targetSampleIds: number[]
  ) => Promise<AudioHandleReleaseSnapshot>;
  pushBoundedHistory: (
    stack: FileOpHistoryItem[],
    item: FileOpHistoryItem
  ) => FileOpHistoryItem[];
}

export function createFileOpsBatchRenameActions(deps: FileOpsBatchRenameDeps) {
  const { set, get, emitNotice, releaseMatchingAudioHandle, pushBoundedHistory } =
    deps;

  return {
    batchRenameSamples: async (
      entries: BatchRenameEntryInput[],
      opts?: { isHistoryReplay?: boolean }
    ): Promise<BatchRenameRecord[]> => {
      if (!entries || entries.length === 0) return [];
      const sampleIds = entries.map((e) => e.sample_id);
      const releaseSnap = await releaseMatchingAudioHandle(sampleIds);

      try {
        const records = await invokeCommand("batch_rename_samples", { entries });
        if (records.length === 0) {
          if (!opts?.isHistoryReplay) {
            emitNotice("No filenames changed", "info");
          }
          return [];
        }

        clearSmartSearchCache();
        clearSlicePathCache();

        const recordById = new Map<number, BatchRenameRecord>();
        for (const r of records) {
          recordById.set(r.sample_id, r);
        }

        set((state: SampleStoreState) => {
          const patchList = (list: SampleItem[]) =>
            list.map((s) => {
              const rec = recordById.get(s.id);
              if (!rec) return s;
              return {
                ...s,
                file_name: rec.new_name,
                file_path: rec.new_path,
                previous_file_name: rec.old_name,
              };
            });

          const selectedRec = state.selectedSample
            ? recordById.get(state.selectedSample.id)
            : undefined;

          const historyEntries = records.map((r) => ({
            sampleId: r.sample_id,
            oldStem: splitFileNameAndExt(r.old_name).stem,
            newStem: splitFileNameAndExt(r.new_name).stem,
            oldFileName: r.old_name,
            newFileName: r.new_name,
          }));

          return {
            allProfileSamples: patchList(state.allProfileSamples),
            rawSamples: patchList(state.rawSamples),
            samples: patchList(state.samples),
            selectedSample:
              selectedRec && state.selectedSample
                ? {
                    ...state.selectedSample,
                    file_name: selectedRec.new_name,
                    file_path: selectedRec.new_path,
                    previous_file_name: selectedRec.old_name,
                  }
                : state.selectedSample,
            batchRenameSampleIds: opts?.isHistoryReplay
              ? state.batchRenameSampleIds
              : null,
            fileOpUndoStack: opts?.isHistoryReplay
              ? state.fileOpUndoStack
              : pushBoundedHistory(state.fileOpUndoStack, {
                  kind: "batch_rename",
                  entries: historyEntries,
                  records,
                }),
            ...(opts?.isHistoryReplay ? {} : { fileOpRedoStack: [] }),
            ...(releaseSnap.wasMatched
              ? {
                  seekRequest: {
                    timeSec: releaseSnap.resumeTimeSec,
                    seq: Date.now(),
                  },
                  isPlaying: releaseSnap.wasPlaying,
                  playTriggerSeq: releaseSnap.wasPlaying
                    ? state.playTriggerSeq + 1
                    : state.playTriggerSeq,
                }
              : {}),
          };
        });

        const selectedId = get().selectedSample?.id;
        if (selectedId) {
          const selectedRec = recordById.get(selectedId);
          if (selectedRec) {
            safeSetItem(LAST_SELECTED_SAMPLE_PATH_KEY, selectedRec.new_path);
          }
        }

        if (!opts?.isHistoryReplay) {
          const msg =
            records.length === 1
              ? `Renamed to ${records[0].new_name} (Ctrl+Z to Undo)`
              : `Batch renamed ${records.length} files (Ctrl+Z to Undo)`;
          emitNotice(msg, "success");
        }
        await get().refreshTrashStatus();
        postCrossWindowSync("catalog");
        return records;
      } catch (err) {
        emitNotice(`Batch rename failed: ${String(err)}`, "error");
        return [];
      }
    },
  };
}
