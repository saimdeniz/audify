import { invoke } from "@tauri-apps/api/core";
import {
  SampleItem,
  SliceHistoryEntry,
  SliceOpHistoryItem,
} from "../../types";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
import { resetPlayheadClock } from "../playheadClock";
import { persistNavigationFilters } from "../storageHelpers";
import type { StoreSliceContext } from "../types";
import { upsertSliceEntryInList } from "./sliceHistoryActions";

const MAX_SLICE_OP_HISTORY = 30;

export function pushBoundedSliceHistory(
  stack: SliceOpHistoryItem[],
  item: SliceOpHistoryItem
): SliceOpHistoryItem[] {
  const next = [...stack, item];
  return next.length > MAX_SLICE_OP_HISTORY
    ? next.slice(next.length - MAX_SLICE_OP_HISTORY)
    : next;
}

export function createSliceUndoAndJumpActions(
  ctx: StoreSliceContext,
  deps: {
    batchRenameSlices: (
      entries: Array<{ slice_id: number; new_stem: string }>,
      opts?: { isHistoryReplay?: boolean }
    ) => Promise<boolean>;
    trashSliceFiles: (
      sliceIds: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => Promise<boolean>;
    restoreTrashedSlices: (
      sliceIds?: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => Promise<SliceHistoryEntry[]>;
  }
) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;
  const { batchRenameSlices, trashSliceFiles, restoreTrashedSlices } = deps;
  let sliceUndoRedoInFlight = false;

  return {
    undoLastSliceOp: async () => {
      if (!get().enableAdvancedFileOps) {
        emitNotice(
          "Safe Read-Only Mode is active — enable Write Mode in Settings → Advanced",
          "info"
        );
        return;
      }
      if (sliceUndoRedoInFlight) return;
      const stack = get().sliceOpUndoStack;
      const last = stack[stack.length - 1];
      if (!last) {
        emitNotice("Nothing to undo in Slices", "info");
        return;
      }
      sliceUndoRedoInFlight = true;
      try {
        if (last.kind === "rename") {
          const reverseEntries = last.entries.map((e) => ({
            slice_id: e.slice_id,
            new_stem: e.old_stem,
          }));
          const ok = await batchRenameSlices(reverseEntries, {
            isHistoryReplay: true,
          });
          if (!ok) return;
        } else if (last.kind === "restore") {
          const ok = await trashSliceFiles(last.slice_ids, {
            isHistoryReplay: true,
          });
          if (!ok) return;
        } else {
          const restored = await invokeCommand("restore_trashed_slice_files", {
            sliceIds: last.slice_ids,
          });
          const restoredIds = new Set(restored.map((r) => r.id));
          set((prev) => {
            let nextHistory = [...prev.sliceHistory];
            for (const entry of restored) {
              nextHistory = upsertSliceEntryInList(nextHistory, entry);
            }
            const nextTrashed = prev.trashedSliceHistory.filter(
              (item) => !restoredIds.has(item.id)
            );
            return {
              sliceHistory: nextHistory,
              trashedSliceHistory: nextTrashed,
              trashedSliceCount: Math.max(
                nextTrashed.length,
                prev.trashedSliceCount - restored.length
              ),
              selectedSliceIds: restored.map((r) => r.id),
              activeSliceId: restored[0]?.id ?? prev.activeSliceId,
            };
          });
          void get().fetchSliceTrashStatus();
        }
        // Atomic pop/push ONLY after await completes cleanly
        set((prev) => ({
          sliceOpUndoStack: prev.sliceOpUndoStack.slice(0, -1),
          sliceOpRedoStack: pushBoundedSliceHistory(prev.sliceOpRedoStack, last),
        }));
        emitNotice(`Undid: ${last.summary}`, "success");
      } catch (err) {
        emitNotice(`Slice undo failed: ${String(err)}`, "error");
      } finally {
        sliceUndoRedoInFlight = false;
      }
    },

    redoLastSliceOp: async () => {
      if (!get().enableAdvancedFileOps) {
        emitNotice(
          "Safe Read-Only Mode is active — enable Write Mode in Settings → Advanced",
          "info"
        );
        return;
      }
      if (sliceUndoRedoInFlight) return;
      const stack = get().sliceOpRedoStack;
      const item = stack[stack.length - 1];
      if (!item) {
        emitNotice("Nothing to redo in Slices", "info");
        return;
      }
      sliceUndoRedoInFlight = true;
      try {
        if (item.kind === "rename") {
          const forwardEntries = item.entries.map((e) => ({
            slice_id: e.slice_id,
            new_stem: e.new_stem,
          }));
          const ok = await batchRenameSlices(forwardEntries, {
            isHistoryReplay: true,
          });
          if (!ok) return;
        } else if (item.kind === "restore") {
          const restored = await restoreTrashedSlices(item.slice_ids, {
            isHistoryReplay: true,
          });
          if (restored.length === 0) return;
        } else {
          const ok = await trashSliceFiles(item.slice_ids, {
            isHistoryReplay: true,
          });
          if (!ok) return;
        }
        set((prev) => ({
          sliceOpRedoStack: prev.sliceOpRedoStack.slice(0, -1),
          sliceOpUndoStack: pushBoundedSliceHistory(prev.sliceOpUndoStack, item),
        }));
        emitNotice(`Redid: ${item.summary}`, "success");
      } catch (err) {
        emitNotice(`Slice redo failed: ${String(err)}`, "error");
      } finally {
        sliceUndoRedoInFlight = false;
      }
    },

    jumpToSliceSource: async (entry: SliceHistoryEntry) => {
      const st = get();
      // Unwrap any legacy chained slice-of-slice hops safely before library lookup
      let rootEntry = entry;
      const visited = new Set<string>([normalizePathForMatch(entry.slice_path)]);
      for (let hop = 0; hop < 8; hop++) {
        const srcNorm = normalizePathForMatch(rootEntry.source_file_path);
        if (visited.has(srcNorm)) break;
        visited.add(srcNorm);
        const parentSlice = st.sliceHistory.find(
          (s) => normalizePathForMatch(s.slice_path) === srcNorm
        );
        if (!parentSlice) break;
        rootEntry = parentSlice;
      }

      const normSrc = normalizePathForMatch(rootEntry.source_file_path);
      let sourceSample =
        st.allProfileSamples.find(
          (s) =>
            (rootEntry.source_sample_id !== null &&
              s.id === rootEntry.source_sample_id) ||
            normalizePathForMatch(s.file_path) === normSrc
        ) ?? null;

      if (!sourceSample) {
        try {
          sourceSample = await invoke<SampleItem | null>(
            "get_sample_by_id_or_path",
            {
              sampleId: rootEntry.source_sample_id,
              filePath: rootEntry.source_file_path,
              includePeaks: false,
            }
          );
        } catch {
          sourceSample = null;
        }
      }

      if (!sourceSample) {
        emitNotice(
          `Original source "${rootEntry.source_file_name}" is no longer in the library`,
          "error"
        );
        return;
      }

      clearSmartSearchCache();
      persistNavigationFilters(null, null, false, null);
      set({
        slicesFilterActive: false,
        duplicatesFilterActive: false,
        trashFilterActive: false,
        trashViewTab: "tracks",
        binFilterActive: false,
        favoriteOnly: false,
        recentOnly: false,
        searchQuery: "",
        folderFilter: null,
        selectedCollectionId: null,
        selectedLicenseGroupId: null,
        selectedTagIds: [],
        selectedGenre: null,
      });

      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        await get().fetchSamples({ preserveMultiSelect: false });
      }

      const nextPitch = Number.isFinite(rootEntry.pitch_semitones)
        ? Math.max(-24, Math.min(24, Math.round(rootEntry.pitch_semitones)))
        : 0;
      const startSec = Math.max(0, rootEntry.start_sec);
      const endSec = Math.max(startSec + 0.04, rootEntry.end_sec);

      get().selectSample(sourceSample, false);
      resetPlayheadClock(startSec);
      const nextSeq = (get().seekRequest?.seq || 0) + 1;
      set({
        sliceRange: { startSec, endSec },
        pitchSemitones: nextPitch,
        sliceMicroFade: rootEntry.micro_fade,
        currentTimeSec: startSec,
        seekRequest: { timeSec: startSec, seq: nextSeq },
      });
      emitNotice(
        `Loaded "${sourceSample.file_name}" [${startSec.toFixed(
          2
        )}s–${endSec.toFixed(2)}s]`,
        "info"
      );
    },
  };
}
