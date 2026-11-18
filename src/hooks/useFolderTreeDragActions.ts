import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../constants/audioFormats";
import {
  AUDIFY_STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
} from "../store/storageHelpers";
import type { FolderTreeNode } from "../store/types";
import { FolderDropResult, Library, SubfolderRenameSummary } from "../types";
import { folderNameFromPath, normalizePathForMatch } from "../utils/format";

interface UseFolderTreeDragActionsParams {
  displayLibraries: Library[];
  folderTreeByLibrary: Record<number, FolderTreeNode[]>;
  folderFilter: string | null;
  enableAdvancedFileOps: boolean;
  isDraggingInApp: boolean;
  isExternalFileDragActive: boolean;
  dragHoverTarget: string | null;
  setStatusMessage: (msg: string) => void;
  setFolderFilter: (path: string | null) => void;
  createPhysicalSubfolder: (
    libraryId: number,
    parentFolderPath: string,
    newFolderName: string
  ) => Promise<string | null>;
  renamePhysicalSubfolder: (
    libraryId: number,
    folderPath: string,
    newFolderName: string
  ) => Promise<SubfolderRenameSummary | null>;
  importExternalFilesToFolder: (
    libraryId: number,
    targetFolderPath: string,
    externalPaths: string[],
    conflictPolicy?: "prompt" | "skip" | "keep_both"
  ) => Promise<FolderDropResult | null>;
}

export function useFolderTreeDragActions({
  displayLibraries,
  folderTreeByLibrary,
  folderFilter,
  enableAdvancedFileOps,
  isDraggingInApp,
  isExternalFileDragActive,
  dragHoverTarget,
  setStatusMessage,
  setFolderFilter,
  createPhysicalSubfolder,
  renamePhysicalSubfolder,
  importExternalFilesToFolder,
}: UseFolderTreeDragActionsParams) {
  const [creatingSubfolderTarget, setCreatingSubfolderTarget] = useState<{
    libraryId: number;
    parentPath: string;
    depth: number;
  } | null>(null);
  const [newSubfolderName, setNewSubfolderName] = useState("");
  const createInputRef = useRef<HTMLInputElement | null>(null);

  const [renamingFolderTarget, setRenamingFolderTarget] = useState<{
    libraryId: number;
    folderPath: string;
    currentName: string;
  } | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const [expandedLibIds, setExpandedLibIds] = useState<Record<number, boolean>>(
    () => {
      try {
        const raw = safeGetItem(AUDIFY_STORAGE_KEYS.expandedLibIds);
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<number, boolean>)
          : {};
      } catch {
        return {};
      }
    }
  );

  const [expandedFolderPaths, setExpandedFolderPaths] = useState<
    Record<string, boolean>
  >(() => {
    try {
      const raw = safeGetItem(AUDIFY_STORAGE_KEYS.expandedFolderPaths);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, boolean>)
        : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (creatingSubfolderTarget) {
      requestAnimationFrame(() => {
        createInputRef.current?.focus();
        createInputRef.current?.select();
      });
    }
  }, [creatingSubfolderTarget]);

  useEffect(() => {
    if (renamingFolderTarget) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [renamingFolderTarget]);

  useEffect(() => {
    if (!enableAdvancedFileOps) {
      setCreatingSubfolderTarget(null);
      setRenamingFolderTarget(null);
    }
  }, [enableAdvancedFileOps]);

  useEffect(() => {
    const t = setTimeout(() => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.expandedLibIds,
        JSON.stringify(expandedLibIds),
        {
          broadcast: false,
          markEdited: false,
        }
      );
    }, 120);
    return () => clearTimeout(t);
  }, [expandedLibIds]);

  useEffect(() => {
    const t = setTimeout(() => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.expandedFolderPaths,
        JSON.stringify(expandedFolderPaths),
        { broadcast: false, markEdited: false }
      );
    }, 120);
    return () => clearTimeout(t);
  }, [expandedFolderPaths]);

  const startCreatingSubfolder = useCallback(
    (lib: Library, parentPath: string, depth: number) => {
      if (!enableAdvancedFileOps) return;
      if (lib.is_read_only) {
        setStatusMessage(
          `Library "${lib.name}" is locked as a Protected Vault in Settings > Advanced`
        );
        return;
      }
      setRenamingFolderTarget(null);
      setExpandedLibIds((prev) => ({ ...prev, [lib.id]: true }));
      const normParent = normalizePathForMatch(parentPath);
      const normLib = normalizePathForMatch(lib.path);
      if (normParent !== normLib) {
        setExpandedFolderPaths((prev) => ({ ...prev, [normParent]: true }));
      }
      setNewSubfolderName("New Folder");
      setCreatingSubfolderTarget({
        libraryId: lib.id,
        parentPath,
        depth,
      });
    },
    [enableAdvancedFileOps, setStatusMessage]
  );

  const handleHeaderCreateSubfolder = useCallback(() => {
    if (!enableAdvancedFileOps || displayLibraries.length === 0) return;

    if (folderFilter) {
      const normActive = normalizePathForMatch(folderFilter);
      for (const lib of displayLibraries) {
        const normLib = normalizePathForMatch(lib.path);
        if (normActive === normLib) {
          startCreatingSubfolder(lib, lib.path, 0);
          return;
        }
        if (normActive.startsWith(`${normLib}/`)) {
          const rel = normActive.slice(normLib.length + 1);
          const depth = rel.split("/").filter(Boolean).length;
          startCreatingSubfolder(lib, folderFilter, depth);
          return;
        }
      }
    }

    const firstWritable =
      displayLibraries.find((l) => !l.is_read_only) || displayLibraries[0];
    if (firstWritable) {
      startCreatingSubfolder(firstWritable, firstWritable.path, 0);
    }
  }, [
    enableAdvancedFileOps,
    displayLibraries,
    folderFilter,
    startCreatingSubfolder,
  ]);

  const submitCreateSubfolder = useCallback(async () => {
    if (!creatingSubfolderTarget) return;
    const { libraryId, parentPath } = creatingSubfolderTarget;
    const trimmed = newSubfolderName.trim();
    setCreatingSubfolderTarget(null);
    if (!trimmed) return;
    const createdPath = await createPhysicalSubfolder(
      libraryId,
      parentPath,
      trimmed
    );
    if (createdPath) {
      setFolderFilter(createdPath);
    }
  }, [
    creatingSubfolderTarget,
    newSubfolderName,
    createPhysicalSubfolder,
    setFolderFilter,
  ]);

  const startRenamingSubfolder = useCallback(
    (lib: Library, folderPath: string, currentName: string) => {
      if (!enableAdvancedFileOps) return;
      if (lib.is_read_only) {
        setStatusMessage(
          `Library "${lib.name}" is locked as a Protected Vault in Settings > Advanced`
        );
        return;
      }
      setCreatingSubfolderTarget(null);
      setRenameFolderDraft(currentName);
      setRenamingFolderTarget({
        libraryId: lib.id,
        folderPath,
        currentName,
      });
    },
    [enableAdvancedFileOps, setStatusMessage]
  );

  const submitRenameSubfolder = useCallback(async () => {
    if (!renamingFolderTarget) return;
    const { libraryId, folderPath, currentName } = renamingFolderTarget;
    const trimmed = renameFolderDraft.trim();
    setRenamingFolderTarget(null);
    if (!trimmed || trimmed === currentName) return;
    await renamePhysicalSubfolder(libraryId, folderPath, trimmed);
  }, [renamingFolderTarget, renameFolderDraft, renamePhysicalSubfolder]);

  const handleImportDialogForFolder = useCallback(
    async (lib: Library, targetFolderPath: string) => {
      if (!enableAdvancedFileOps) return;
      if (lib.is_read_only) {
        setStatusMessage(
          `Library "${lib.name}" is locked as a Protected Vault in Settings > Advanced`
        );
        return;
      }
      try {
        const selected = await openDialog({
          multiple: true,
          title: `Import Audio Files into "${folderNameFromPath(
            targetFolderPath,
            lib.name
          )}"`,
          filters: [
            {
              name: "Supported Audio Files",
              extensions: [...SUPPORTED_AUDIO_EXTENSIONS],
            },
          ],
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          await importExternalFilesToFolder(
            lib.id,
            targetFolderPath,
            paths,
            "prompt"
          );
        }
      } catch (err) {
        console.error("Import audio files dialog error:", err);
      }
    },
    [enableAdvancedFileOps, importExternalFilesToFolder, setStatusMessage]
  );

  // Auto-expand collapsed folder/library after hovering for 420ms during drag
  useEffect(() => {
    if (
      (!isDraggingInApp && !isExternalFileDragActive) ||
      !enableAdvancedFileOps ||
      !dragHoverTarget ||
      !dragHoverTarget.startsWith("folder:")
    ) {
      return;
    }
    const rest = dragHoverTarget.slice("folder:".length);
    const sepIdx = rest.indexOf(":");
    if (sepIdx < 0) return;
    const libId = parseInt(rest.slice(0, sepIdx), 10);
    const folderPath = rest.slice(sepIdx + 1);
    if (Number.isNaN(libId) || !folderPath) return;

    const timer = setTimeout(() => {
      const lib = displayLibraries.find((l) => l.id === libId);
      if (!lib) return;
      const normTarget = normalizePathForMatch(folderPath);
      const normLib = normalizePathForMatch(lib.path);
      if (normTarget === normLib) {
        setExpandedLibIds((prev) =>
          prev[lib.id] ? prev : { ...prev, [lib.id]: true }
        );
      } else {
        setExpandedFolderPaths((prev) =>
          prev[normTarget] ? prev : { ...prev, [normTarget]: true }
        );
      }
    }, 420);

    return () => clearTimeout(timer);
  }, [
    dragHoverTarget,
    isDraggingInApp,
    isExternalFileDragActive,
    enableAdvancedFileOps,
    displayLibraries,
  ]);

  const handleExpandAll = useCallback(() => {
    const nextLibIds: Record<number, boolean> = {};
    const nextFolderPaths: Record<string, boolean> = {};
    for (const lib of displayLibraries) {
      nextLibIds[lib.id] = true;
      const tree = folderTreeByLibrary[lib.id] || [];
      const traverse = (nodes: FolderTreeNode[]) => {
        for (const node of nodes) {
          if (node.children.length > 0) {
            nextFolderPaths[normalizePathForMatch(node.fullPath)] = true;
            traverse(node.children);
          }
        }
      };
      traverse(tree);
    }
    setExpandedLibIds(nextLibIds);
    setExpandedFolderPaths(nextFolderPaths);
  }, [displayLibraries, folderTreeByLibrary]);

  const handleCollapseAll = useCallback(() => {
    const nextLibIds: Record<number, boolean> = {};
    for (const lib of displayLibraries) {
      nextLibIds[lib.id] = false;
    }
    setExpandedLibIds(nextLibIds);
    setExpandedFolderPaths({});
  }, [displayLibraries]);

  return {
    creatingSubfolderTarget,
    setCreatingSubfolderTarget,
    newSubfolderName,
    setNewSubfolderName,
    createInputRef,
    renamingFolderTarget,
    setRenamingFolderTarget,
    renameFolderDraft,
    setRenameFolderDraft,
    renameInputRef,
    expandedLibIds,
    setExpandedLibIds,
    expandedFolderPaths,
    setExpandedFolderPaths,
    startCreatingSubfolder,
    handleHeaderCreateSubfolder,
    submitCreateSubfolder,
    startRenamingSubfolder,
    submitRenameSubfolder,
    handleImportDialogForFolder,
    handleExpandAll,
    handleCollapseAll,
  };
}
