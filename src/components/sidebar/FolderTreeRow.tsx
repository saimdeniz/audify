import React from "react";
import { Check, FolderPlus, Lock, RefreshCw, X } from "lucide-react";
import { Library } from "../../types";
import { normalizeTreeKey } from "./folderTreeBuilder";
import type { FlatFolderRow } from "./folderTreeFlatten";
import type { SidebarFolderContextMenuState } from "./SidebarFolderContextMenu";
import { getSidebarTreeIndentPx, SidebarTreeRow } from "./SidebarTreeRow";

interface FolderTreeRowProps {
  row: FlatFolderRow;
  virtualStart: number;
  virtualSize: number;
  readOnlyScope?: boolean;
  enableAdvancedFileOps: boolean;
  isAnyDragActive: boolean;
  isExternalFileDragActive: boolean;
  inAppDragCount: number;
  isDropHovered: boolean;
  isDropFlashed: boolean;
  isScanning: boolean;
  createInputRef: React.RefObject<HTMLInputElement>;
  newSubfolderName: string;
  setNewSubfolderName: (val: string) => void;
  setCreatingSubfolderTarget: (v: null) => void;
  submitCreateSubfolder: () => Promise<void>;
  isRenamingThisFolder: boolean;
  renameInputRef: React.RefObject<HTMLInputElement>;
  renameFolderDraft: string;
  setRenameFolderDraft: (val: string) => void;
  setRenamingFolderTarget: (v: null) => void;
  submitRenameSubfolder: () => Promise<void>;
  setExpandedLibIds: React.Dispatch<
    React.SetStateAction<Record<number, boolean>>
  >;
  setExpandedFolderPaths: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  startCreatingSubfolder: (
    lib: Library,
    parentPath: string,
    depth: number
  ) => void;
  startRenamingSubfolder: (
    lib: Library,
    folderPath: string,
    currentName: string
  ) => void;
  handleImportDialogForFolder: (
    lib: Library,
    targetFolderPath: string
  ) => Promise<void>;
  syncFolderIncremental: (rootPath: string, subPath?: string) => Promise<void>;
  setFolderFilter: (path: string | null) => void;
  setDragHoverTarget?: (target: string | null) => void;
  setSettingsOpen: (open: boolean, tab?: "libraries") => void;
  requestTrashSubfolder: (
    libraryId: number,
    folderPath: string,
    folderName: string,
    sampleCount: number
  ) => void;
  setFolderContextMenu: (menu: SidebarFolderContextMenuState | null) => void;
}

export const FolderTreeRow: React.FC<FolderTreeRowProps> = React.memo(({
  row,
  virtualStart,
  virtualSize,
  readOnlyScope = false,
  enableAdvancedFileOps,
  isAnyDragActive,
  isExternalFileDragActive,
  inAppDragCount,
  isDropHovered,
  isDropFlashed,
  isScanning,
  createInputRef,
  newSubfolderName,
  setNewSubfolderName,
  setCreatingSubfolderTarget,
  submitCreateSubfolder,
  isRenamingThisFolder,
  renameInputRef,
  renameFolderDraft,
  setRenameFolderDraft,
  setRenamingFolderTarget,
  submitRenameSubfolder,
  setExpandedLibIds,
  setExpandedFolderPaths,
  startCreatingSubfolder,
  startRenamingSubfolder,
  handleImportDialogForFolder,
  syncFolderIncremental,
  setFolderFilter,
  setDragHoverTarget,
  setSettingsOpen,
  requestTrashSubfolder,
  setFolderContextMenu,
}) => {
  if (row.kind === "create-input") {
    const indentPx = getSidebarTreeIndentPx(row.depth);
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${virtualSize}px`,
          transform: `translateY(${virtualStart}px)`,
          paddingLeft: `${indentPx + 22}px`,
        }}
        className="pr-2 flex items-center gap-1 bg-surface-3 border-l-2 border-accent"
      >
        <FolderPlus className="w-3.5 h-3.5 text-accent-fg shrink-0" />
        <input
          ref={createInputRef}
          type="text"
          value={newSubfolderName}
          onChange={(e) => setNewSubfolderName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              void submitCreateSubfolder();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setCreatingSubfolderTarget(null);
            }
          }}
          onBlur={() => {
            setCreatingSubfolderTarget(null);
          }}
          placeholder="Subfolder name..."
          className="flex-1 min-w-0 h-[20px] px-1.5 rounded-xs bg-surface-1 border border-accent text-[11px] text-fg outline-none"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void submitCreateSubfolder()}
          className="w-[18px] h-[18px] rounded-xs bg-accent text-accent-on flex items-center justify-center shrink-0"
          title="Create subfolder (Enter)"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCreatingSubfolderTarget(null)}
          className="w-[18px] h-[18px] rounded-xs text-fg-3 hover:text-fg flex items-center justify-center shrink-0"
          title="Cancel (Esc)"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (row.kind === "library") {
    const {
      lib,
      displayCount,
      hasSubfolders,
      isExpanded,
      isLibRootSelected,
      isSubfolderSelected,
    } = row;
    const dropKey = `folder:${lib.id}:${lib.path}`;
    const canDropHere = !readOnlyScope && enableAdvancedFileOps && !lib.is_read_only;

    return (
      <SidebarTreeRow
        depth={0}
        label={lib.name}
        count={displayCount}
        hasChildren={hasSubfolders}
        isExpanded={isExpanded}
        isSelected={isLibRootSelected}
        isAncestorOfSelected={isSubfolderSelected}
        isDragHover={isDropHovered}
        isDropFlashing={isDropFlashed}
        onToggleExpand={() =>
          setExpandedLibIds((prev) => ({
            ...prev,
            [lib.id]: !isExpanded,
          }))
        }
        toggleTitle={isExpanded ? "Collapse folder tree" : "Expand folder tree"}
        dropHint={
          isDropHovered
            ? isExternalFileDragActive
              ? "＋ Import"
              : inAppDragCount > 1
              ? `➔ Move (${inAppDragCount})`
              : "➔ Move"
            : null
        }
        actions={
          readOnlyScope ? undefined : (
          <>
            {enableAdvancedFileOps &&
              (lib.is_read_only ? (
                <span
                  className="w-[18px] h-[18px] flex items-center justify-center text-warn shrink-0"
                  title="Protected Read-Only Library Vault"
                >
                  <Lock className="w-3 h-3" />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    startCreatingSubfolder(lib, lib.path, 0);
                  }}
                  className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0"
                  title="New Physical Subfolder"
                >
                  <FolderPlus className="w-3 h-3" />
                </button>
              ))}
            <button
              type="button"
              disabled={isScanning}
              onClick={(e) => {
                e.stopPropagation();
                void syncFolderIncremental(lib.path);
              }}
              className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0 disabled:opacity-30"
              title="Sync Folder Changes (Incremental)"
            >
              <RefreshCw
                className={`w-3 h-3 ${isScanning ? "animate-spin" : ""}`}
              />
            </button>
          </>
          )
        }
        data-sidebar-drop={canDropHere ? dropKey : undefined}
        onClick={() => setFolderFilter(isLibRootSelected ? null : lib.path)}
        onMouseEnter={() => {
          if (canDropHere && isAnyDragActive) {
            setDragHoverTarget?.(dropKey);
          }
        }}
        onMouseLeave={() => {
          if (isDropHovered) {
            setDragHoverTarget?.(null);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setFolderContextMenu(
            readOnlyScope
              ? {
                  x: e.clientX,
                  y: e.clientY,
                  title: lib.name,
                  explorerTargets: [{ label: "Show in Explorer", path: lib.path }],
                  primaryCopyPath: lib.path,
                }
              : {
                  x: e.clientX,
                  y: e.clientY,
                  title: lib.name,
                  explorerTargets: [{ label: "Show in Explorer", path: lib.path }],
                  primaryCopyPath: lib.path,
                  onSyncFolder: () => void syncFolderIncremental(lib.path),
                  isReadOnlyVault: Boolean(lib.is_read_only),
                  onCreateSubfolder: enableAdvancedFileOps
                    ? () => startCreatingSubfolder(lib, lib.path, 0)
                    : undefined,
                  onImportAudioFiles: enableAdvancedFileOps
                    ? () => void handleImportDialogForFolder(lib, lib.path)
                    : undefined,
                  onOpenSettings: () => setSettingsOpen(true, "libraries"),
                  settingsLabel: "Manage Library in Settings",
                }
          );
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${virtualSize}px`,
          transform: `translateY(${virtualStart}px)`,
        }}
        title={lib.path}
      />
    );
  }

  const { lib, node, isExpanded, isSelected, isAncestorOfSelected } = row;
  const hasChildren = node.children.length > 0;
  const nodeLower = normalizeTreeKey(node.fullPath);
  const dropKey = `folder:${lib.id}:${node.fullPath}`;
  const canDropHere = !readOnlyScope && enableAdvancedFileOps && !lib.is_read_only;

  return (
    <SidebarTreeRow
      depth={node.depth}
      label={node.name}
      count={node.count}
      hasChildren={hasChildren}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isAncestorOfSelected={isAncestorOfSelected}
      isDragHover={isDropHovered}
      isDropFlashing={isDropFlashed}
      hideRight={isRenamingThisFolder}
      onToggleExpand={() =>
        setExpandedFolderPaths((prev) => ({
          ...prev,
          [nodeLower]: !isExpanded,
        }))
      }
      toggleTitle={isExpanded ? "Collapse subfolder" : "Expand subfolder"}
      dropHint={
        isDropHovered
          ? isExternalFileDragActive
            ? "＋ Import"
            : inAppDragCount > 1
            ? `➔ Move (${inAppDragCount})`
            : "➔ Move"
          : null
      }
      labelReplacement={
        isRenamingThisFolder ? (
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={renameInputRef}
              type="text"
              value={renameFolderDraft}
              onChange={(e) => setRenameFolderDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitRenameSubfolder();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenamingFolderTarget(null);
                }
              }}
              onBlur={() => {
                setRenamingFolderTarget(null);
              }}
              className="flex-1 min-w-0 h-[20px] px-1.5 rounded-xs bg-surface-1 border border-accent text-[11px] text-fg outline-none"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void submitRenameSubfolder()}
              className="w-[18px] h-[18px] rounded-xs bg-accent text-accent-on flex items-center justify-center shrink-0"
              title="Save folder name (Enter)"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        ) : undefined
      }
      actions={
        !readOnlyScope && !isRenamingThisFolder ? (
          <>
            {enableAdvancedFileOps && !lib.is_read_only && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startCreatingSubfolder(lib, node.fullPath, node.depth + 1);
                }}
                className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0"
                title="New Subfolder"
              >
                <FolderPlus className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              disabled={isScanning}
              onClick={(e) => {
                e.stopPropagation();
                void syncFolderIncremental(lib.path, node.fullPath);
              }}
              className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0 disabled:opacity-30"
              title="Sync Subfolder Changes"
            >
              <RefreshCw
                className={`w-3 h-3 ${isScanning ? "animate-spin" : ""}`}
              />
            </button>
          </>
        ) : undefined
      }
      data-sidebar-drop={canDropHere ? dropKey : undefined}
      onClick={() => {
        if (isRenamingThisFolder) return;
        setFolderFilter(isSelected ? null : node.fullPath);
      }}
      onMouseEnter={() => {
        if (canDropHere && isAnyDragActive) {
          setDragHoverTarget?.(dropKey);
        }
      }}
      onMouseLeave={() => {
        if (isDropHovered) {
          setDragHoverTarget?.(null);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFolderContextMenu(
          readOnlyScope
            ? {
                x: e.clientX,
                y: e.clientY,
                title: node.name,
                explorerTargets: [{ label: "Show in Explorer", path: node.fullPath }],
                primaryCopyPath: node.fullPath,
              }
            : {
                x: e.clientX,
                y: e.clientY,
                title: node.name,
                explorerTargets: [{ label: "Show in Explorer", path: node.fullPath }],
                primaryCopyPath: node.fullPath,
                onSyncFolder: () => void syncFolderIncremental(lib.path, node.fullPath),
                isReadOnlyVault: Boolean(lib.is_read_only),
                onCreateSubfolder: enableAdvancedFileOps
                  ? () => startCreatingSubfolder(lib, node.fullPath, node.depth + 1)
                  : undefined,
                onImportAudioFiles: enableAdvancedFileOps
                  ? () => void handleImportDialogForFolder(lib, node.fullPath)
                  : undefined,
                onRenameSubfolder: enableAdvancedFileOps
                  ? () => startRenamingSubfolder(lib, node.fullPath, node.name)
                  : undefined,
                onTrashSubfolder: enableAdvancedFileOps
                  ? () =>
                      void requestTrashSubfolder(
                        lib.id,
                        node.fullPath,
                        node.name,
                        node.count
                      )
                  : undefined,
                onOpenSettings: () => setSettingsOpen(true, "libraries"),
                settingsLabel: "Manage Library in Settings",
              }
        );
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: `${virtualSize}px`,
        transform: `translateY(${virtualStart}px)`,
      }}
      title={node.fullPath}
    />
  );
});
