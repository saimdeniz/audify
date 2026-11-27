import { releaseAudioFileHandleIfPathMatching } from "../../services/audioPlaybackService";
import type { SliceOpHistoryItem } from "../../types";
import { getCachedPreviewSlicePath } from "../../utils/drag";
import { splitFileNameAndExt } from "../../utils/format";
import { normalizePathForMatch } from "../../utils/pathHelpers";
import {
  isSlicePreviewSample,
  sliceEntryToPreviewSample,
  upsertSliceEntryInList,
} from "../../utils/slicePreview";
import { invokeCommand } from "../../utils/tauriCommands";
import type { StoreSliceContext } from "../types";
import {
  collectSliceMediaPaths,
  createSliceTrashActions,
} from "./sliceTrashActions";
import {
  createSliceUndoAndJumpActions,
  pushBoundedSliceHistory,
} from "./sliceUndoAndJumpActions";

export function createSliceHistoryActions(ctx: StoreSliceContext) {
  const { set, get, emitNotice } = ctx;

  const stopAudioIfMatchesAnyPath = async (targetPaths: readonly string[]) => {
    const st = get();
    const activePath = st.selectedSample?.file_path;
    if (!activePath) return;
    const normActive = normalizePathForMatch(activePath);
    if (targetPaths.some((p) => normalizePathForMatch(p) === normActive)) {
      await releaseAudioFileHandleIfPathMatching(
        {
          activeSampleId: st.selectedSample?.id ?? null,
          activeFilePath: activePath,
          isPlaying: st.isPlaying,
          currentTimeSec: st.currentTimeSec,
          stopPlaying: () => set({ isPlaying: false }),
        },
        activePath
      );
    }
  };

  const batchRenameSlices = async (
    entries: Array<{ slice_id: number; new_stem: string }>,
    opts?: { isHistoryReplay?: boolean }
  ): Promise<boolean> => {
    if (!get().enableAdvancedFileOps) {
      emitNotice(
        "Safe Read-Only Mode is active — enable Write Mode in Settings → Advanced",
        "info"
      );
      return false;
    }
    if (!entries || entries.length === 0) return false;
    const epoch = ctx.getProfileEpoch();
    const st = get();
    const historyMap = new Map(st.sliceHistory.map((s) => [s.id, s]));
    const targetPaths = entries
      .map((e) => historyMap.get(e.slice_id)?.slice_path)
      .filter((p): p is string => Boolean(p));
    await stopAudioIfMatchesAnyPath(targetPaths);
    if (epoch !== ctx.getProfileEpoch()) return false;

    try {
      const outcomes = await invokeCommand("batch_rename_slices", { entries });
      if (epoch !== ctx.getProfileEpoch()) return false;
      if (outcomes.length === 0) {
        set({ batchRenameSliceIds: null });
        return false;
      }

      const byId = new Map(outcomes.map((o) => [o.updated_record.id, o]));
      set((prev) => {
        const nextHistory = prev.sliceHistory.map((item) => {
          const hit = byId.get(item.id);
          return hit ? hit.updated_record : item;
        });
        const undoEntry: SliceOpHistoryItem = {
          kind: "rename",
          entries: outcomes.map((o) => ({
            slice_id: o.updated_record.id,
            old_stem: splitFileNameAndExt(o.old_record.slice_name).stem,
            new_stem: splitFileNameAndExt(o.updated_record.slice_name).stem,
          })),
          summary:
            outcomes.length === 1
              ? `Rename "${outcomes[0].old_record.slice_name}" → "${outcomes[0].updated_record.slice_name}"`
              : `Rename ${outcomes.length} slices`,
        };
        const selected = prev.selectedSample;
        const selectedMatch =
          selected &&
          outcomes.find(
            (o) =>
              normalizePathForMatch(o.old_record.slice_path) ===
              normalizePathForMatch(selected.file_path)
          );
        return {
          sliceHistory: nextHistory,
          batchRenameSliceIds: null,
          ...(selectedMatch
            ? {
                selectedSample: sliceEntryToPreviewSample(
                  selectedMatch.updated_record
                ),
              }
            : {}),
          ...(!opts?.isHistoryReplay
            ? {
                sliceOpUndoStack: pushBoundedSliceHistory(
                  prev.sliceOpUndoStack,
                  undoEntry
                ),
                sliceOpRedoStack: [],
              }
            : {}),
        };
      });

      if (!opts?.isHistoryReplay) {
        const msg =
          outcomes.length === 1
            ? `Renamed slice to "${outcomes[0].updated_record.slice_name}" (Ctrl+Z to undo)`
            : `Renamed ${outcomes.length} slices (Ctrl+Z to undo)`;
        emitNotice(msg, "success");
      }
      return true;
    } catch (err) {
      if (epoch !== ctx.getProfileEpoch()) return false;
      emitNotice(`Slice rename failed: ${String(err)}`, "error");
      return false;
    }
  };

  const trashSliceFiles = async (
    sliceIds: number[],
    opts?: { isHistoryReplay?: boolean }
  ): Promise<boolean> => {
    if (!get().enableAdvancedFileOps) {
      emitNotice(
        "Safe Read-Only Mode is active — enable Write Mode in Settings → Advanced",
        "info"
      );
      return false;
    }
    const cleanIds = Array.from(
      new Set(sliceIds.filter((id) => Number.isSafeInteger(id) && id > 0))
    );
    if (cleanIds.length === 0) return false;

    const epoch = ctx.getProfileEpoch();
    const st = get();
    const idSet = new Set(cleanIds);
    const affected = st.sliceHistory.filter((s) => idSet.has(s.id));
    await stopAudioIfMatchesAnyPath(collectSliceMediaPaths(affected));
    if (epoch !== ctx.getProfileEpoch()) return false;

    try {
      const trashedIds = await invokeCommand("trash_slice_files", {
        sliceIds: cleanIds,
      });
      if (epoch !== ctx.getProfileEpoch()) return false;
      const trashedSet = new Set(trashedIds);
      const removedNames = affected
        .filter((s) => trashedSet.has(s.id))
        .map((s) => s.slice_name);

      set((prev) => {
        const nextHistory = prev.sliceHistory.filter(
          (item) => !trashedSet.has(item.id)
        );
        const nextSelectedIds = prev.selectedSliceIds.filter(
          (id) => !trashedSet.has(id)
        );
        const activeCleared =
          prev.activeSliceId !== null && trashedSet.has(prev.activeSliceId);
        const undoItem: SliceOpHistoryItem | null =
          trashedIds.length > 0 && !opts?.isHistoryReplay
            ? {
                kind: "trash",
                slice_ids: trashedIds,
                slice_names: removedNames,
                summary:
                  trashedIds.length === 1 && removedNames[0]
                    ? `Trash "${removedNames[0]}"`
                    : `Trash ${trashedIds.length} slices`,
              }
            : null;

        return {
          sliceHistory: nextHistory,
          trashedSliceCount: prev.trashedSliceCount + trashedIds.length,
          selectedSliceIds: nextSelectedIds,
          activeSliceId: activeCleared
            ? nextSelectedIds[0] ?? null
            : prev.activeSliceId,
          ...(undoItem
            ? {
                sliceOpUndoStack: pushBoundedSliceHistory(
                  prev.sliceOpUndoStack,
                  undoItem
                ),
                sliceOpRedoStack: [],
              }
            : {}),
        };
      });

      void sliceTrashActions.fetchSliceTrashStatus();
      if (get().trashFilterActive && get().trashViewTab === "slices") {
        void sliceTrashActions.fetchTrashedSlices();
      }

      if (!opts?.isHistoryReplay) {
        if (trashedIds.length > 0) {
          emitNotice(
            trashedIds.length === 1 && removedNames[0]
              ? `Moved slice "${removedNames[0]}" to Trash · Ctrl+Z to undo`
              : `Moved ${trashedIds.length} slices to Trash · Ctrl+Z to undo`,
            "info"
          );
        } else {
          emitNotice("Removed missing slice record", "info");
        }
      }
      return true;
    } catch (err) {
      if (epoch !== ctx.getProfileEpoch()) return false;
      emitNotice(`Move slice to Trash failed: ${String(err)}`, "error");
      return false;
    }
  };

  const sliceTrashActions = createSliceTrashActions(ctx, {
    stopAudioIfMatchesAnyPath,
    applyInstantMemoryFilter: ctx.applyInstantMemoryFilter,
  });

  const undoAndJump = createSliceUndoAndJumpActions(ctx, {
    batchRenameSlices,
    trashSliceFiles,
    restoreTrashedSlices: sliceTrashActions.restoreTrashedSlices,
  });

  return {
    fetchSliceHistory: async () => {
      const epoch = ctx.getProfileEpoch();
      set({ isLoadingSliceHistory: true });
      try {
        const items = await invokeCommand("list_slice_history", {});
        if (epoch !== ctx.getProfileEpoch()) return;
        set({
          sliceHistory: Array.isArray(items) ? items : [],
          isLoadingSliceHistory: false,
        });
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return;
        console.error("Failed loading slice history:", err);
        set({ isLoadingSliceHistory: false });
      }
    },

    saveActiveSlice: async (customName?: string) => {
      const st = get();
      const sample = st.selectedSample;
      const range = st.sliceRange;
      if (isSlicePreviewSample(sample)) {
        emitNotice(
          "Cannot slice a slice preview — click ↗ on the row to open original source",
          "error"
        );
        return null;
      }
      if (!sample || !range || range.endSec - range.startSec <= 0.03) {
        emitNotice("Select a waveform slice range first", "error");
        return null;
      }

      const cached = getCachedPreviewSlicePath(
        sample.file_path,
        range.startSec,
        range.endSec,
        {
          pitchSemitones: st.pitchSemitones,
          applyMicroFade: st.sliceMicroFade,
          exportPreset: st.exportAudioPreset,
          loudnessMode: st.exportLoudnessMode,
        }
      );

      const epoch = ctx.getProfileEpoch();
      try {
        const saved = await invokeCommand("save_slice_to_export", {
          filePath: sample.file_path,
          sourceSampleId: sample.id > 0 ? sample.id : null,
          startSec: range.startSec,
          endSec: range.endSec,
          customDir: st.customSliceExportPath || null,
          cachedSlicePath: cached,
          pitchSemitones:
            Math.abs(st.pitchSemitones) >= 0.01 ? st.pitchSemitones : null,
          applyMicroFade: st.sliceMicroFade,
          customName: customName?.trim() || null,
          ...(st.exportAudioPreset !== "original"
            ? { exportPreset: st.exportAudioPreset }
            : {}),
          ...(st.exportLoudnessMode !== "off"
            ? { exportLoudnessMode: st.exportLoudnessMode }
            : {}),
        });
        if (epoch !== ctx.getProfileEpoch()) return null;
        set((prev) => ({
          sliceHistory: upsertSliceEntryInList(prev.sliceHistory, saved),
        }));
        emitNotice(`Saved slice "${saved.slice_name}"`, "success");
        return saved;
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return null;
        emitNotice(`Save slice failed: ${String(err)}`, "error");
        return null;
      }
    },

    recordSliceExport: async (payload: {
      slicePath: string;
      sourceSampleId?: number | null;
      sourceFilePath: string;
      startSec: number;
      endSec: number;
      pitchSemitones?: number;
      applyMicroFade?: boolean;
    }) => {
      if (
        payload.sourceSampleId !== undefined &&
        payload.sourceSampleId !== null &&
        payload.sourceSampleId < 0
      ) {
        return null;
      }
      const epoch = ctx.getProfileEpoch();
      try {
        const recorded = await invokeCommand("record_slice_export", {
          slicePath: payload.slicePath,
          sourceSampleId:
            payload.sourceSampleId && payload.sourceSampleId > 0
              ? payload.sourceSampleId
              : null,
          sourceFilePath: payload.sourceFilePath,
          startSec: payload.startSec,
          endSec: payload.endSec,
          pitchSemitones: payload.pitchSemitones ?? 0,
          applyMicroFade: Boolean(payload.applyMicroFade),
        });
        if (epoch !== ctx.getProfileEpoch()) return null;
        set((prev) => ({
          sliceHistory: upsertSliceEntryInList(prev.sliceHistory, recorded),
        }));
        return recorded;
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return null;
        console.error("Failed recording exported slice:", err);
        return null;
      }
    },

    toggleSliceFavorite: async (sliceId: number) => {
      const epoch = ctx.getProfileEpoch();
      try {
        const updated = await invokeCommand("toggle_slice_favorite", {
          sliceId,
        });
        if (epoch !== ctx.getProfileEpoch()) return;
        set((prev) => ({
          sliceHistory: prev.sliceHistory.map((item) =>
            item.id === sliceId ? updated : item
          ),
        }));
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return;
        emitNotice(`Failed toggling slice favorite: ${String(err)}`, "error");
      }
    },

    toggleSliceFavoritesBatch: async (
      sliceIds: number[],
      isFavorite: boolean
    ) => {
      const cleanIds = Array.from(
        new Set(sliceIds.filter((id) => Number.isSafeInteger(id) && id > 0))
      );
      if (cleanIds.length === 0) return;
      const epoch = ctx.getProfileEpoch();
      try {
        const updatedIds = await invokeCommand("toggle_slice_favorites_batch", {
          sliceIds: cleanIds,
          isFavorite,
        });
        if (epoch !== ctx.getProfileEpoch()) return;
        const idSet = new Set(updatedIds);
        set((prev) => ({
          sliceHistory: prev.sliceHistory.map((item) =>
            idSet.has(item.id) ? { ...item, is_favorite: isFavorite } : item
          ),
        }));
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return;
        emitNotice(`Failed updating slice favorites: ${String(err)}`, "error");
      }
    },

    batchRenameSlices: async (
      entries: Array<{ slice_id: number; new_stem: string }>,
      opts?: { isHistoryReplay?: boolean }
    ) => {
      await batchRenameSlices(entries, opts);
    },

    clearMissingSlices: async () => {
      const epoch = ctx.getProfileEpoch();
      try {
        const removed = await invokeCommand("clear_missing_slices", {});
        if (epoch !== ctx.getProfileEpoch()) return 0;
        set((prev) => ({
          sliceHistory: prev.sliceHistory.filter((item) => item.file_exists),
        }));
        emitNotice(
          removed > 0
            ? `Cleaned ${removed} missing slice ${
                removed === 1 ? "entry" : "entries"
              }`
            : "No missing slice entries found",
          "info"
        );
        return removed;
      } catch (err) {
        if (epoch !== ctx.getProfileEpoch()) return 0;
        emitNotice(`Failed cleaning missing slices: ${String(err)}`, "error");
        return 0;
      }
    },

    trashSliceFiles: async (
      sliceIds: number[],
      opts?: { isHistoryReplay?: boolean }
    ) => {
      await trashSliceFiles(sliceIds, opts);
    },

    ...sliceTrashActions,
    ...undoAndJump,
  };
}
