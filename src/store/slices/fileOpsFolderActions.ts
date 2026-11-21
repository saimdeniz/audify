import { invoke } from "@tauri-apps/api/core";
import {
  FolderDropResult,
  SubfolderRenameSummary,
  TrashActionSummary,
} from "../../types";
import { clearSlicePathCache } from "../../utils/drag";
import { folderNameFromPath, normalizePathForMatch } from "../../utils/format";
import { clearPeaksCache } from "../../utils/peaksStore";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  persistNavigationFilters,
  postCrossWindowSync,
  saveTrashStatus,
} from "../storageHelpers";
import type { FileOpHistoryItem, StoreGet, StoreSet } from "../types";

export interface FileOpsFolderDeps {
  set: StoreSet;
  get: StoreGet;
  emitNotice: (message: string, kind?: "info" | "success" | "error") => void;
  releaseMatchingAudioHandle: (targetSampleIds: number[]) => Promise<unknown>;
  pushBoundedHistory: (
    stack: FileOpHistoryItem[],
    item: FileOpHistoryItem
  ) => FileOpHistoryItem[];
}

export function createFileOpsFolderActions(deps: FileOpsFolderDeps) {
  const {
    set,
    get,
    emitNotice,
    releaseMatchingAudioHandle,
    pushBoundedHistory,
  } = deps;

  return {
    resolvePendingFileConflict: async (
      policy: "skip" | "keep_both" | "cancel"
    ) => {
      const prompt = get().pendingFileConflictPrompt;
      set({ pendingFileConflictPrompt: null });
      if (!prompt || policy === "cancel") {
        return;
      }
      if (prompt.mode === "move") {
        await get().moveSamplesToFolder(
          prompt.sampleIds,
          prompt.targetLibraryId,
          prompt.targetFolderPath,
          policy
        );
      } else {
        await get().importExternalFilesToFolder(
          prompt.libraryId,
          prompt.targetFolderPath,
          prompt.externalPaths,
          policy
        );
      }
    },

    setLibraryReadOnly: async (libraryId: number, isReadOnly: boolean) => {
      try {
        await invoke("set_library_read_only", { libraryId, isReadOnly });
        set((state) => ({
          libraries: state.libraries.map((lib) =>
            lib.id === libraryId ? { ...lib, is_read_only: isReadOnly } : lib
          ),
          statusMessage: isReadOnly
            ? "Library locked as Protected Read-Only Vault"
            : "Library unlocked for physical file operations",
        }));
        emitNotice(
          isReadOnly
            ? "Library locked as Protected Read-Only Vault"
            : "Library unlocked for file operations",
          "info"
        );
        postCrossWindowSync("catalog");
      } catch (err) {
        console.error("Failed to set library read-only state:", err);
        emitNotice(`Failed to update library lock: ${String(err)}`, "error");
      }
    },

    createPhysicalSubfolder: async (
      libraryId: number,
      parentFolderPath: string,
      newFolderName: string
    ) => {
      try {
        const createdPath = await invoke<string>("create_physical_subfolder", {
          libraryId,
          parentFolderPath,
          newFolderName,
        });
        await get().fetchFolderStats();
        postCrossWindowSync("catalog");
        emitNotice(`Created folder "${newFolderName.trim()}"`, "success");
        return createdPath;
      } catch (err) {
        emitNotice(`Create folder failed: ${String(err)}`, "error");
        return null;
      }
    },

    renamePhysicalSubfolder: async (
      libraryId: number,
      folderPath: string,
      newFolderName: string
    ) => {
      const prefixNorm = normalizePathForMatch(folderPath);
      const activeSample = get().selectedSample;
      if (
        activeSample &&
        normalizePathForMatch(activeSample.file_path).startsWith(
          `${prefixNorm}/`
        )
      ) {
        await releaseMatchingAudioHandle([activeSample.id]);
      }

      try {
        const summary = await invoke<SubfolderRenameSummary>(
          "rename_physical_subfolder",
          {
            libraryId,
            folderPath,
            newFolderName,
          }
        );
        clearSmartSearchCache();
        clearSlicePathCache();

        const curFolder = get().folderFilter;
        if (curFolder) {
          const normOld = normalizePathForMatch(summary.old_folder_path);
          const normCur = normalizePathForMatch(curFolder);
          if (normCur === normOld) {
            persistNavigationFilters(
              summary.new_folder_path,
              get().selectedLicenseGroupId,
              get().favoriteOnly,
              get().selectedCollectionId
            );
            set({ folderFilter: summary.new_folder_path });
          } else if (normCur.startsWith(`${normOld}/`)) {
            const rel = normCur.slice(normOld.length + 1);
            const nextFolder = `${summary.new_folder_path}/${rel}`;
            persistNavigationFilters(
              nextFolder,
              get().selectedLicenseGroupId,
              get().favoriteOnly,
              get().selectedCollectionId
            );
            set({ folderFilter: nextFolder });
          }
        }

        await get().refreshAfterCatalogMutation({ syncCatalog: true });
        emitNotice(
          `Renamed folder to "${summary.new_folder_name}" (${summary.updated_sample_count} sample path(s) updated)`,
          "success"
        );
        return summary;
      } catch (err) {
        emitNotice(`Rename folder failed: ${String(err)}`, "error");
        return null;
      }
    },

    trashPhysicalSubfolder: async (libraryId: number, folderPath: string) => {
      const prefixNorm = normalizePathForMatch(folderPath);
      const activeSample = get().selectedSample;
      if (
        activeSample &&
        normalizePathForMatch(activeSample.file_path).startsWith(
          `${prefixNorm}/`
        )
      ) {
        await releaseMatchingAudioHandle([activeSample.id]);
      }

      try {
        const summary = await invoke<TrashActionSummary>(
          "trash_physical_subfolder",
          {
            libraryId,
            folderPath,
          }
        );
        clearSmartSearchCache();
        clearSlicePathCache();

        const curFolder = get().folderFilter;
        if (curFolder) {
          const normCur = normalizePathForMatch(curFolder);
          if (normCur === prefixNorm || normCur.startsWith(`${prefixNorm}/`)) {
            persistNavigationFilters(
              null,
              get().selectedLicenseGroupId,
              get().favoriteOnly,
              get().selectedCollectionId
            );
            set({ folderFilter: null });
          }
        }

        if (summary.affected_ids.length > 0) {
          saveTrashStatus(summary.trashed_count, summary.total_bytes);
          const folderName = folderNameFromPath(folderPath, "folder");
          set((state) => ({
            trashedCount: summary.trashed_count,
            trashedTotalBytes: summary.total_bytes,
            fileOpUndoStack: pushBoundedHistory(state.fileOpUndoStack, {
              kind: "trash",
              sampleIds: summary.affected_ids,
              label: `${summary.affected_count} file(s) from "${folderName}"`,
            }),
            fileOpRedoStack: [],
          }));
        }

        await get().refreshAfterCatalogMutation({
          refreshTrash: true,
          syncCatalog: true,
        });
        emitNotice(
          summary.affected_count > 0
            ? `Moved folder contents (${summary.affected_count} file(s)) to Trash (Ctrl+Z to Undo)`
            : "Removed empty folder",
          "success"
        );
        return summary;
      } catch (err) {
        emitNotice(`Delete folder failed: ${String(err)}`, "error");
        return null;
      }
    },

    moveSamplesToFolder: async (
      sampleIds: number[],
      targetLibraryId: number,
      targetFolderPath: string,
      conflictPolicy: "prompt" | "skip" | "keep_both" = "prompt"
    ) => {
      if (!sampleIds || sampleIds.length === 0) return null;
      await releaseMatchingAudioHandle(sampleIds);

      try {
        const res = await invokeCommand("move_samples_to_folder", {
          sampleIds,
          targetLibraryId,
          targetFolderPath,
          conflictPolicy,
        });

        if (res.status === "conflict" && res.conflicts.length > 0) {
          set({
            pendingFileConflictPrompt: {
              mode: "move",
              sampleIds,
              targetLibraryId,
              targetFolderPath: res.target_folder_path,
              conflicts: res.conflicts,
              skippedDuplicates: res.skipped_duplicates,
            },
          });
          return res;
        }

        const folderName = folderNameFromPath(res.target_folder_path, "folder");

        if (res.moved_records.length > 0) {
          clearSmartSearchCache();
          clearSlicePathCache();
          set((state) => ({
            fileOpUndoStack: pushBoundedHistory(state.fileOpUndoStack, {
              kind: "move",
              moves: res.moved_records,
              label: `${res.moved_records.length} file(s) to "${folderName}"`,
            }),
            fileOpRedoStack: [],
          }));
          await get().refreshAfterCatalogMutation({
            refreshTrash: true,
            syncCatalog: true,
          });
        }

        const parts: string[] = [];
        if (res.moved_records.length > 0) {
          parts.push(
            `Moved ${res.moved_records.length} file(s) to "${folderName}" (Ctrl+Z to Undo)`
          );
        }
        if (res.skipped_duplicates.length > 0) {
          parts.push(
            `Skipped ${res.skipped_duplicates.length} identical duplicate(s)`
          );
        }
        if (res.skipped_conflicts > 0) {
          parts.push(`Skipped ${res.skipped_conflicts} name collision(s)`);
        }
        if (
          parts.length === 0 &&
          res.skipped_same_folder > 0 &&
          res.moved_records.length === 0
        ) {
          parts.push(`File(s) are already in "${folderName}"`);
        }

        if (parts.length > 0) {
          emitNotice(
            parts.join(" • "),
            res.moved_records.length > 0 ? "success" : "info"
          );
        }
        return res;
      } catch (err) {
        emitNotice(`Move to folder failed: ${String(err)}`, "error");
        return null;
      }
    },

    importExternalFilesToFolder: async (
      libraryId: number,
      targetFolderPath: string,
      externalPaths: string[],
      conflictPolicy: "prompt" | "skip" | "keep_both" = "prompt"
    ) => {
      if (!externalPaths || externalPaths.length === 0) return null;

      try {
        const res = await invoke<FolderDropResult>(
          "import_external_files_to_folder",
          {
            libraryId,
            targetFolderPath,
            externalPaths,
            conflictPolicy,
          }
        );

        if (res.status === "conflict" && res.conflicts.length > 0) {
          set({
            pendingFileConflictPrompt: {
              mode: "import",
              libraryId,
              targetFolderPath: res.target_folder_path,
              externalPaths,
              conflicts: res.conflicts,
              skippedDuplicates: res.skipped_duplicates,
            },
          });
          return res;
        }

        const folderName = folderNameFromPath(res.target_folder_path, "folder");

        if (res.imported_sample_ids.length > 0) {
          clearPeaksCache();
          clearSmartSearchCache();
          await get().refreshAfterCatalogMutation({ syncCatalog: true });
        }

        const parts: string[] = [];
        if (res.imported_sample_ids.length > 0) {
          parts.push(
            `Imported ${res.imported_sample_ids.length} audio file(s) into "${folderName}"`
          );
        }
        if (res.skipped_duplicates.length > 0) {
          parts.push(
            `Skipped ${res.skipped_duplicates.length} identical duplicate(s)`
          );
        }
        if (res.skipped_conflicts > 0) {
          parts.push(`Skipped ${res.skipped_conflicts} name collision(s)`);
        }
        if (res.skipped_unsupported > 0) {
          parts.push(
            `Ignored ${res.skipped_unsupported} unsupported file(s)`
          );
        }
        if (
          parts.length === 0 &&
          res.skipped_same_folder > 0 &&
          res.imported_sample_ids.length === 0
        ) {
          parts.push(`File(s) are already inside "${folderName}"`);
        }

        if (parts.length > 0) {
          emitNotice(
            parts.join(" • "),
            res.imported_sample_ids.length > 0 ? "success" : "info"
          );
        }
        return res;
      } catch (err) {
        emitNotice(`External file import failed: ${String(err)}`, "error");
        return null;
      }
    },
  };
}
