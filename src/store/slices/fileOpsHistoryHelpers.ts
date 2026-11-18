import { invoke } from "@tauri-apps/api/core";
import { AudioHandleReleaseSnapshot } from "../../services/audioPlaybackService";
import {
  FileOpJournalEntry,
  MovedSampleRecord,
  SampleItem,
  SampleRelocateEntry,
} from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { normalizePathForMatch, splitFileNameAndExt } from "../../utils/format";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import {
  FileOpHistoryItem,
  SampleStoreState,
  StoreGet,
  StoreSet,
} from "../types";

const MAX_HISTORY_ITEMS = 30;

export function pushBoundedHistory(
  stack: FileOpHistoryItem[],
  item: FileOpHistoryItem
): FileOpHistoryItem[] {
  return [...stack.slice(-(MAX_HISTORY_ITEMS - 1)), item];
}

export function journalEntryToHistoryItem(
  entry: FileOpJournalEntry,
  getState: () => SampleStoreState
): FileOpHistoryItem | null {
  if (entry.op_type === "RENAME") {
    return {
      kind: "rename",
      sampleId: entry.sample_id,
      oldStem: splitFileNameAndExt(entry.old_name).stem,
      newStem: splitFileNameAndExt(entry.new_name).stem,
      oldFileName: entry.old_name,
      newFileName: entry.new_name,
    };
  }
  if (entry.op_type === "TRASH") {
    return {
      kind: "trash",
      sampleIds: [entry.sample_id],
      label: `"${entry.old_name}"`,
    };
  }
  if (entry.op_type === "MOVE") {
    const state = getState();
    const curSample =
      state.allProfileSamples.find((s) => s.id === entry.sample_id) ||
      state.samples.find((s) => s.id === entry.sample_id);
    if (!curSample) return null;
    const oldNorm = normalizePathForMatch(entry.old_path);
    const oldLib = [...state.libraries]
      .sort(
        (a, b) =>
          normalizePathForMatch(b.path).length -
          normalizePathForMatch(a.path).length
      )
      .find((lib) => {
        const libNorm = normalizePathForMatch(lib.path);
        return (
          libNorm.length > 0 &&
          (oldNorm === libNorm || oldNorm.startsWith(`${libNorm}/`))
        );
      });
    return {
      kind: "move",
      moves: [
        {
          sample_id: curSample.id,
          old_library_id: oldLib ? oldLib.id : curSample.library_id,
          new_library_id: curSample.library_id,
          old_path: entry.old_path,
          new_path: entry.new_path,
          old_name: entry.old_name,
          new_name: entry.new_name,
        },
      ],
      label: `"${entry.old_name}"`,
    };
  }
  return null;
}

export function applySampleRenameState(
  set: StoreSet,
  sampleId: number,
  updated: SampleItem,
  releaseSnap: AudioHandleReleaseSnapshot,
  extraPatch?: (state: SampleStoreState) => Partial<SampleStoreState>
): void {
  set((state) => {
    const patchList = (list: SampleItem[]) =>
      list.map((s) =>
        s.id === sampleId
          ? {
              ...s,
              file_name: updated.file_name,
              file_path: updated.file_path,
              previous_file_name: updated.previous_file_name,
            }
          : s
      );
    return {
      allProfileSamples: patchList(state.allProfileSamples),
      rawSamples: patchList(state.rawSamples),
      samples: patchList(state.samples),
      selectedSample:
        state.selectedSample?.id === sampleId
          ? {
              ...state.selectedSample,
              file_name: updated.file_name,
              file_path: updated.file_path,
              previous_file_name: updated.previous_file_name,
            }
          : state.selectedSample,
      ...(extraPatch ? extraPatch(state) : {}),
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
}

export async function replayFileOpHistoryItem(
  item: FileOpHistoryItem,
  direction: "undo" | "redo",
  deps: {
    set: StoreSet;
    get: StoreGet;
    emitNotice: (
      message: string,
      kind?: "info" | "success" | "error"
    ) => void;
    releaseMatchingAudioHandle: (
      targetSampleIds: number[]
    ) => Promise<AudioHandleReleaseSnapshot>;
  }
): Promise<boolean> {
  const { set, get, emitNotice, releaseMatchingAudioHandle } = deps;
  const isUndo = direction === "undo";
  const pushOppositeStack = (
    state: SampleStoreState
  ): Partial<SampleStoreState> =>
    isUndo
      ? { fileOpRedoStack: pushBoundedHistory(state.fileOpRedoStack, item) }
      : { fileOpUndoStack: pushBoundedHistory(state.fileOpUndoStack, item) };

  if (item.kind === "rename") {
    const targetStem = isUndo ? item.oldStem : item.newStem;
    const updated = await get().renameSampleFile(item.sampleId, targetStem, {
      isHistoryReplay: true,
    });
    if (!updated) return false;
    set(pushOppositeStack);
    emitNotice(
      isUndo
        ? `Undo Rename: "${item.newFileName}" → "${item.oldFileName}"`
        : `Redo Rename: "${item.oldFileName}" → "${item.newFileName}"`,
      "success"
    );
    return true;
  }

  if (item.kind === "batch_rename") {
    const targetEntries = item.entries.map((entry) => ({
      sample_id: entry.sampleId,
      new_stem: isUndo ? entry.oldStem : entry.newStem,
    }));
    const records = await get().batchRenameSamples(targetEntries, {
      isHistoryReplay: true,
    });
    if (records.length === 0) return false;
    set(pushOppositeStack);
    emitNotice(
      isUndo
        ? `Undo Batch Rename: Restored ${records.length} filename(s)`
        : `Redo Batch Rename: Renamed ${records.length} filename(s)`,
      "success"
    );
    return true;
  }

  if (item.kind === "trash") {
    const summary = isUndo
      ? await get().restoreSamplesFromTrash(item.sampleIds, {
          isHistoryReplay: true,
        })
      : await get().moveSamplesToTrash(item.sampleIds, {
          isHistoryReplay: true,
        });
    if (!summary || summary.affected_count === 0) return false;
    set(pushOppositeStack);
    emitNotice(
      isUndo
        ? `Undo Delete: Restored ${item.label}`
        : `Redo Delete: Moved ${item.label} to Trash`,
      "success"
    );
    return true;
  }

  if (item.kind === "restore") {
    const summary = isUndo
      ? await get().moveSamplesToTrash(item.sampleIds, {
          isHistoryReplay: true,
        })
      : await get().restoreSamplesFromTrash(item.sampleIds, {
          isHistoryReplay: true,
        });
    if (!summary || summary.affected_count === 0) return false;
    set(pushOppositeStack);
    emitNotice(
      isUndo
        ? `Undo Restore: Moved ${item.label} back to Trash`
        : `Redo Restore: Restored ${item.label}`,
      "success"
    );
    return true;
  }

  if (item.kind === "move") {
    const sampleIds = item.moves.map((m) => m.sample_id);
    await releaseMatchingAudioHandle(sampleIds);
    const entries: SampleRelocateEntry[] = item.moves.map((m) => ({
      sample_id: m.sample_id,
      target_library_id: isUndo ? m.old_library_id : m.new_library_id,
      target_path: isUndo ? m.old_path : m.new_path,
      target_name: isUndo ? m.old_name : m.new_name,
    }));
    try {
      const relocated = await invoke<MovedSampleRecord[]>(
        "relocate_moved_samples",
        {
          entries,
          opLabel: isUndo ? "UNDO_MOVE" : "MOVE",
        }
      );
      if (relocated.length > 0) {
        clearSmartSearchCache();
        clearSlicePathCache();
        set(pushOppositeStack);
        await get().refreshAfterCatalogMutation({
          refreshTrash: true,
          syncCatalog: true,
        });
        emitNotice(
          isUndo
            ? `Undo Move: Returned ${relocated.length} file(s) to previous folder`
            : `Redo Move: Moved ${item.label}`,
          "success"
        );
        return true;
      }
    } catch (err) {
      emitNotice(
        `${isUndo ? "Undo" : "Redo"} move failed: ${String(err)}`,
        "error"
      );
    }
    return false;
  }

  return false;
}
