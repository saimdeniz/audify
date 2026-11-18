import { useEffect, useState } from "react";
import {
  AUDIO_EXTENSION_RE,
  SUPPORTED_AUDIO_EXTENSIONS,
} from "../constants/audioFormats";
import type { SidebarTab } from "../store/types";
import { useSampleStore } from "../store/useSampleStore";
import { isOsDragCurrentlyInFlight } from "../utils/drag";
import { filterVisibleLibraries, normalizePathForMatch } from "../utils/format";
import { invokeCommand } from "../utils/tauriCommands";

const MAX_STAGE_BATCH_BYTES = 16 * 1024 * 1024;

interface UseExternalFolderDropParams {
  enableAdvancedFileOps: boolean;
  isMiniOverlay: boolean;
  dragHoverTargetRef: React.MutableRefObject<string | null>;
  isExternalFileDragRef: React.MutableRefObject<boolean>;
  updateDragHoverTarget: (
    next: string | null,
    opts?: { railTab?: SidebarTab | null; inSidebar?: boolean }
  ) => void;
  setIsPointerInSidebar: (inSidebar: boolean) => void;
  setHoveredRailTab: (tab: SidebarTab | null) => void;
  cancelDragTabSwitch: () => void;
  scheduleDragTabSwitch: (tab: SidebarTab) => void;
  triggerDropFlash: (targetKey: string) => void;
  setActiveTab: (tab: SidebarTab) => void;
  setIsOverlayOpen: (open: boolean) => void;
}

export function useExternalFolderDrop({
  enableAdvancedFileOps,
  isMiniOverlay,
  dragHoverTargetRef,
  isExternalFileDragRef,
  updateDragHoverTarget,
  setIsPointerInSidebar,
  setHoveredRailTab,
  cancelDragTabSwitch,
  scheduleDragTabSwitch,
  triggerDropFlash,
  setActiveTab,
  setIsOverlayOpen,
}: UseExternalFolderDropParams) {
  const [isExternalFileDragActive, setIsExternalFileDragActive] =
    useState(false);

  useEffect(() => {
    if (!enableAdvancedFileOps) {
      isExternalFileDragRef.current = false;
      setIsExternalFileDragActive(false);
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: false,
            dragHoverTarget: dragHoverTargetRef.current,
          },
        })
      );
      return;
    }

    const clearExternalDragState = () => {
      if (isExternalFileDragRef.current) {
        isExternalFileDragRef.current = false;
        setIsExternalFileDragActive(false);
        window.dispatchEvent(
          new CustomEvent("audify:folder-drop-overlay", {
            detail: {
              isExternalFileDragActive: false,
              dragHoverTarget: null,
            },
          })
        );
        if (!useSampleStore.getState().inAppDragSample) {
          updateDragHoverTarget(null);
          setIsPointerInSidebar(false);
          setHoveredRailTab(null);
          cancelDragTabSwitch();
        }
      }
    };

    const isExternalFilesDrag = (e: DragEvent): boolean => {
      if (
        useSampleStore.getState().inAppDragSample !== null ||
        isOsDragCurrentlyInFlight()
      ) {
        return false;
      }
      const types = e.dataTransfer?.types;
      return Boolean(types && Array.from(types).includes("Files"));
    };

    const onExternalDragOver = (e: DragEvent) => {
      if (!isExternalFilesDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      if (!isExternalFileDragRef.current) {
        isExternalFileDragRef.current = true;
        setIsExternalFileDragActive(true);
        window.dispatchEvent(
          new CustomEvent("audify:folder-drop-overlay", {
            detail: {
              isExternalFileDragActive: true,
              dragHoverTarget: dragHoverTargetRef.current,
            },
          })
        );
      }

      const hitEl = document.elementFromPoint(
        e.clientX,
        e.clientY
      ) as HTMLElement | null;
      const tabBtn = hitEl?.closest<HTMLElement>("[data-sidebar-tab]");
      if (tabBtn?.dataset.sidebarTab === "folders") {
        setHoveredRailTab("folders");
        if (isMiniOverlay) {
          setActiveTab("folders");
          setIsOverlayOpen(true);
        } else {
          scheduleDragTabSwitch("folders");
        }
      } else {
        setHoveredRailTab(null);
        cancelDragTabSwitch();
      }

      const dropEl = hitEl?.closest<HTMLElement>("[data-sidebar-drop]");
      const dropKey = dropEl?.dataset.sidebarDrop || null;
      updateDragHoverTarget(
        dropKey && dropKey.startsWith("folder:") ? dropKey : null
      );
    };

    const onExternalDragLeave = (e: DragEvent) => {
      if (!isExternalFileDragRef.current) return;
      if (
        e.relatedTarget === null ||
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        clearExternalDragState();
      }
    };

    const onExternalDrop = async (e: DragEvent) => {
      if (!isExternalFilesDrag(e)) return;
      e.preventDefault();

      const hitEl = document.elementFromPoint(
        e.clientX,
        e.clientY
      ) as HTMLElement | null;
      const dropEl = hitEl?.closest<HTMLElement>("[data-sidebar-drop]");
      const hoveredKey =
        dropEl?.dataset.sidebarDrop || dragHoverTargetRef.current;

      clearExternalDragState();

      const state = useSampleStore.getState();
      let targetLibId: number | null = null;
      let targetFolderPath: string | null = null;

      if (hoveredKey && hoveredKey.startsWith("folder:")) {
        const rest = hoveredKey.slice("folder:".length);
        const sepIdx = rest.indexOf(":");
        if (sepIdx >= 0) {
          const parsedId = parseInt(rest.slice(0, sepIdx), 10);
          const parsedPath = rest.slice(sepIdx + 1);
          if (!Number.isNaN(parsedId) && parsedPath) {
            targetLibId = parsedId;
            targetFolderPath = parsedPath;
            triggerDropFlash(hoveredKey);
          }
        }
      } else if (state.folderFilter && state.selectedLicenseGroupId === null) {
        const normFilter = normalizePathForMatch(state.folderFilter);
        for (const lib of filterVisibleLibraries(state.libraries)) {
          const normLib = normalizePathForMatch(lib.path);
          if (normFilter === normLib || normFilter.startsWith(`${normLib}/`)) {
            if (!lib.is_read_only) {
              targetLibId = lib.id;
              targetFolderPath = state.folderFilter;
            }
            break;
          }
        }
      } else {
        const writableLibs = filterVisibleLibraries(state.libraries).filter(
          (l) => !l.is_read_only
        );
        if (writableLibs.length === 1) {
          targetLibId = writableLibs[0].id;
          targetFolderPath = writableLibs[0].path;
        }
      }

      if (targetLibId === null || !targetFolderPath) {
        state.setStatusMessage(
          "Drop audio files directly onto a target folder in the Folders sidebar"
        );
        return;
      }

      const fileList = e.dataTransfer?.files;
      if (!fileList || fileList.length === 0) return;

      const directPaths: string[] = [];
      const filesToStage: File[] = [];
      let unsupportedCount = 0;

      for (const file of Array.from(fileList)) {
        if (!AUDIO_EXTENSION_RE.test(file.name)) {
          unsupportedCount++;
          continue;
        }
        const nativePath = (file as unknown as { path?: string }).path;
        if (typeof nativePath === "string" && nativePath.trim().length > 0) {
          directPaths.push(nativePath.trim());
        } else {
          filesToStage.push(file);
        }
      }

      if (directPaths.length === 0 && filesToStage.length === 0) {
        if (unsupportedCount > 0) {
          const extsLabel = SUPPORTED_AUDIO_EXTENSIONS.map((ext) =>
            ext.toUpperCase()
          ).join(", ");
          state.setStatusMessage(
            `Skipped ${unsupportedCount} unsupported file(s) (supported: ${extsLabel})`
          );
        }
        return;
      }

      try {
        let allSourcePaths = [...directPaths];
        if (filesToStage.length > 0) {
          const MAX_STAGE_DROP_FILES = 250;
          const MAX_STAGE_DROP_FILE_BYTES = 256 * 1024 * 1024;
          const MAX_STAGE_DROP_TOTAL_BYTES = 1024 * 1024 * 1024;

          if (filesToStage.length > MAX_STAGE_DROP_FILES) {
            state.setStatusMessage(
              `Drop limit exceeded: at most ${MAX_STAGE_DROP_FILES} files can be staged at once`
            );
            return;
          }

          let totalBytes = 0;
          for (const f of filesToStage) {
            if (f.size > MAX_STAGE_DROP_FILE_BYTES) {
              state.setStatusMessage(
                `File too large to drop (${f.name}): max 256 MB per staged file`
              );
              return;
            }
            totalBytes += f.size;
            if (totalBytes > MAX_STAGE_DROP_TOTAL_BYTES) {
              state.setStatusMessage(
                "Drop limit exceeded: total staged drop size cannot exceed 1 GB"
              );
              return;
            }
          }

          // Stage in byte-bounded batches so huge multi-file drops never pin multiple GB of boxed number[] arrays in RAM.
          let batchPayloads: { file_name: string; bytes: number[] }[] = [];
          let batchBytes = 0;
          const flushStageBatch = async () => {
            if (batchPayloads.length === 0) return;
            const staged = await invokeCommand("stage_dropped_audio_files", {
              files: batchPayloads,
            });
            allSourcePaths = allSourcePaths.concat(staged);
            batchPayloads = [];
            batchBytes = 0;
          };

          for (const f of filesToStage) {
            if (
              batchPayloads.length > 0 &&
              batchBytes + f.size > MAX_STAGE_BATCH_BYTES
            ) {
              await flushStageBatch();
            }
            const buf = await f.arrayBuffer();
            batchPayloads.push({
              file_name: f.name,
              bytes: Array.from(new Uint8Array(buf)),
            });
            batchBytes += f.size;
            if (batchBytes >= MAX_STAGE_BATCH_BYTES) {
              await flushStageBatch();
            }
          }
          await flushStageBatch();
        }

        if (allSourcePaths.length > 0) {
          await state.importExternalFilesToFolder(
            targetLibId,
            targetFolderPath,
            allSourcePaths,
            "prompt"
          );
        }
      } catch (err) {
        console.error("External file drop import error:", err);
        state.setStatusMessage(`Import error: ${String(err)}`);
      }
    };

    window.addEventListener("dragover", onExternalDragOver);
    window.addEventListener("dragleave", onExternalDragLeave);
    window.addEventListener("drop", onExternalDrop);
    return () => {
      window.removeEventListener("dragover", onExternalDragOver);
      window.removeEventListener("dragleave", onExternalDragLeave);
      window.removeEventListener("drop", onExternalDrop);
    };
  }, [
    enableAdvancedFileOps,
    isMiniOverlay,
    dragHoverTargetRef,
    isExternalFileDragRef,
    cancelDragTabSwitch,
    scheduleDragTabSwitch,
    triggerDropFlash,
    updateDragHoverTarget,
    setIsPointerInSidebar,
    setHoveredRailTab,
    setActiveTab,
    setIsOverlayOpen,
  ]);

  return isExternalFileDragActive;
}
