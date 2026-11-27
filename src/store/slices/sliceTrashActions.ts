import { SliceHistoryEntry, SliceOpHistoryItem } from "../../types";
import { upsertSliceEntryInList } from "../../utils/slicePreview";
import { invokeCommand } from "../../utils/tauriCommands";
import { resolveNextTrashViewState } from "../../utils/viewModes";
import type { StoreSliceContext } from "../types";
import { pushBoundedSliceHistory } from "./sliceUndoAndJumpActions";

interface SliceTrashActionDeps {
  stopAudioIfMatchesAnyPath: (paths: readonly string[]) => Promise<void>;
  applyInstantMemoryFilter: StoreSliceContext["applyInstantMemoryFilter"];
}

export function retainSliceHistoryEntries(
  stack: SliceOpHistoryItem[],
  deletedSet: ReadonlySet<number>
): SliceOpHistoryItem[] {
  return stack
    .map((item): SliceOpHistoryItem | null => {
      if (item.kind === "rename") {
        const entries = item.entries.filter((e) => !deletedSet.has(e.slice_id));
        return entries.length > 0 ? { ...item, entries } : null;
      }
      const nextIds: number[] = [];
      const nextNames: string[] = [];
      for (let i = 0; i < item.slice_ids.length; i++) {
        const id = item.slice_ids[i];
        if (!deletedSet.has(id)) {
          nextIds.push(id);
          if (item.slice_names[i] !== undefined) {
            nextNames.push(item.slice_names[i]);
          }
        }
      }
      return nextIds.length > 0
        ? { ...item, slice_ids: nextIds, slice_names: nextNames }
        : null;
    })
    .filter((item): item is SliceOpHistoryItem => item !== null);
}

export function collectSliceMediaPaths(
  entries: readonly SliceHistoryEntry[]
): string[] {
  const paths: string[] = [];
  for (const s of entries) {
    if (s.slice_path) paths.push(s.slice_path);
    if (s.trash_file_path) paths.push(s.trash_file_path);
  }
  return paths;
}

export function createSliceTrashActions(
  ctx: StoreSliceContext,
  deps: SliceTrashActionDeps
) {
  const { set, get, emitNotice } = ctx;
  const { stopAudioIfMatchesAnyPath, applyInstantMemoryFilter } = deps;

  const fetchSliceTrashStatus = async () => {
    const epoch = ctx.getProfileEpoch();
    try {
      const status = await invokeCommand("get_slice_trash_status", {});
      if (epoch !== ctx.getProfileEpoch() || !status) return;
      set({
        trashedSliceCount: status.trashed_count,
        trashedSliceTotalBytes: status.total_bytes,
      });
    } catch {
      // Ignore if test harnesses mock only a subset of slice commands
    }
  };

  const fetchTrashedSlices = async () => {
    const epoch = ctx.getProfileEpoch();
    set({ isLoadingSliceHistory: true });
    try {
      const [items, status] = await Promise.all([
        invokeCommand("list_trashed_slices", {}),
        invokeCommand("get_slice_trash_status", {}).catch(() => null),
      ]);
      if (epoch !== ctx.getProfileEpoch()) return;
      const safeItems = Array.isArray(items) ? items : [];
      set({
        trashedSliceHistory: safeItems,
        trashedSliceCount: status ? status.trashed_count : safeItems.length,
        ...(status ? { trashedSliceTotalBytes: status.total_bytes } : {}),
        isLoadingSliceHistory: false,
      });
    } catch (err) {
      if (epoch !== ctx.getProfileEpoch()) return;
      console.error("Failed loading trashed slices:", err);
      set({ isLoadingSliceHistory: false });
    }
  };

  const restoreTrashedSlices = async (
    sliceIds?: number[],
    opts?: { isHistoryReplay?: boolean }
  ): Promise<SliceHistoryEntry[]> => {
    if (get().trashOpStatus) return [];
    const st = get();
    const candidateIds =
      sliceIds && sliceIds.length > 0
        ? Array.from(
            new Set(sliceIds.filter((id) => Number.isSafeInteger(id) && id > 0))
          )
        : st.trashedSliceHistory.map((s) => s.id);

    if (candidateIds.length === 0) return [];
    const epoch = ctx.getProfileEpoch();
    const idSet = new Set(candidateIds);
    const affected = [
      ...st.trashedSliceHistory.filter((s) => idSet.has(s.id)),
      ...st.sliceHistory.filter((s) => idSet.has(s.id)),
    ];
    const targetPaths = collectSliceMediaPaths(affected);
    if (
      st.selectedSample &&
      st.selectedSample.id < 0 &&
      idSet.has(-st.selectedSample.id) &&
      st.selectedSample.file_path
    ) {
      targetPaths.push(st.selectedSample.file_path);
    }

    set({
      trashOpStatus: { kind: "restoring", count: candidateIds.length },
    });
    try {
      await stopAudioIfMatchesAnyPath(targetPaths);
      const restored = await invokeCommand("restore_trashed_slice_files", {
        sliceIds: candidateIds,
      });
      if (epoch !== ctx.getProfileEpoch()) return [];
      const restoredIds = new Set(restored.map((r) => r.id));

      set((prev) => {
        let nextHistory = [...prev.sliceHistory];
        for (const entry of restored) {
          nextHistory = upsertSliceEntryInList(nextHistory, entry);
        }
        const nextTrashed = prev.trashedSliceHistory.filter(
          (item) => !restoredIds.has(item.id)
        );
        const nextSelectedIds = prev.selectedSliceIds.filter(
          (id) => !restoredIds.has(id)
        );
        const nextTrashedSliceCount = Math.max(
          nextTrashed.length,
          prev.trashedSliceCount - restored.length
        );
        const trashExitPatch = resolveNextTrashViewState(
          prev.trashFilterActive,
          prev.trashViewTab,
          {
            tracks: prev.trashedCount,
            slices: nextTrashedSliceCount,
            layers: prev.trashedLayerCount,
          }
        );
        const nextUndoItem: SliceOpHistoryItem | null =
          restored.length > 0 && !opts?.isHistoryReplay
            ? {
                kind: "restore",
                slice_ids: restored.map((r) => r.id),
                slice_names: restored.map((r) => r.slice_name),
                summary:
                  restored.length === 1
                    ? `Restore "${restored[0].slice_name}"`
                    : `Restore ${restored.length} slices`,
              }
            : null;
        return {
          sliceHistory: nextHistory,
          trashedSliceHistory: nextTrashed,
          trashedSliceCount: nextTrashedSliceCount,
          selectedSliceIds: nextSelectedIds,
          activeSliceId:
            prev.activeSliceId !== null && restoredIds.has(prev.activeSliceId)
              ? nextSelectedIds[0] ?? null
              : prev.activeSliceId,
          ...(nextUndoItem
            ? {
                sliceOpUndoStack: pushBoundedSliceHistory(
                  prev.sliceOpUndoStack,
                  nextUndoItem
                ),
                sliceOpRedoStack: [],
              }
            : {}),
          ...trashExitPatch,
        };
      });

      void fetchSliceTrashStatus();
      if (
        get().trashFilterActive &&
        get().trashViewTab === "tracks" &&
        !applyInstantMemoryFilter({ preserveMultiSelect: false })
      ) {
        void get().fetchSamples({ preserveMultiSelect: false });
      } else if (!get().trashFilterActive && !get().slicesFilterActive) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }

      if (!opts?.isHistoryReplay && restored.length > 0) {
        emitNotice(
          restored.length === 1
            ? `Restored "${restored[0].slice_name}" (Ctrl+Z to undo)`
            : `Restored ${restored.length} slices (Ctrl+Z to undo)`,
          "success"
        );
      }
      return restored;
    } catch (err) {
      emitNotice(`Restore slice failed: ${String(err)}`, "error");
      return [];
    } finally {
      set({ trashOpStatus: null });
    }
  };

  const emptyTrashedSlices = async (sliceIds?: number[]) => {
    if (get().trashOpStatus) return null;
    const st = get();
    const cleanIds =
      sliceIds && sliceIds.length > 0
        ? Array.from(
            new Set(sliceIds.filter((id) => Number.isSafeInteger(id) && id > 0))
          )
        : [];
    const idSet = new Set(cleanIds);
    const targets =
      cleanIds.length > 0
        ? st.trashedSliceHistory.filter((s) => idSet.has(s.id))
        : st.trashedSliceHistory;
    const targetCount = cleanIds.length > 0 ? cleanIds.length : st.trashedSliceCount || targets.length;
    if (targetCount === 0) return null;
    const epoch = ctx.getProfileEpoch();

    set({
      trashOpStatus: { kind: "emptying", count: targetCount },
    });
    try {
      await stopAudioIfMatchesAnyPath(collectSliceMediaPaths(targets));
      const summary = await invokeCommand("empty_trashed_slices", {
        sliceIds: cleanIds.length > 0 ? cleanIds : null,
      });
      if (epoch !== ctx.getProfileEpoch()) return null;
      const deletedSet = new Set(summary.affected_ids);

      let exitedTrashToTracks = false;
      set((prev) => {
        const nextTrashed = prev.trashedSliceHistory.filter(
          (item) => !deletedSet.has(item.id)
        );
        const nextSelected = prev.selectedSliceIds.filter(
          (id) => !deletedSet.has(id)
        );
        const trashExitPatch = resolveNextTrashViewState(
          prev.trashFilterActive,
          prev.trashViewTab,
          {
            tracks: prev.trashedCount,
            slices: summary.trashed_count,
            layers: prev.trashedLayerCount,
          }
        );
        exitedTrashToTracks =
          trashExitPatch.trashFilterActive === false ||
          trashExitPatch.trashViewTab === "tracks";
        return {
          trashedSliceHistory: nextTrashed,
          trashedSliceCount: summary.trashed_count,
          trashedSliceTotalBytes: summary.total_bytes,
          selectedSliceIds: nextSelected,
          activeSliceId:
            prev.activeSliceId !== null && deletedSet.has(prev.activeSliceId)
              ? nextSelected[0] ?? null
              : prev.activeSliceId,
          sliceOpUndoStack: retainSliceHistoryEntries(
            prev.sliceOpUndoStack,
            deletedSet
          ),
          sliceOpRedoStack: retainSliceHistoryEntries(
            prev.sliceOpRedoStack,
            deletedSet
          ),
          ...trashExitPatch,
        };
      });

      if (exitedTrashToTracks) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }

      emitNotice(
        `Moved ${summary.affected_count} slice(s) to OS Recycle Bin`,
        "success"
      );
      return summary;
    } catch (err) {
      emitNotice(`Empty slice trash failed: ${String(err)}`, "error");
      return null;
    } finally {
      set({ trashOpStatus: null });
    }
  };

  return {
    fetchSliceTrashStatus,
    fetchTrashedSlices,
    restoreTrashedSlices,
    emptyTrashedSlices,
  };
}
