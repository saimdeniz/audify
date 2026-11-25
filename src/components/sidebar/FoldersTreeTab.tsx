import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronsDown,
  ChevronsUp,
  FolderPlus,
  HardDrive,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useFolderTreeDragActions } from "../../hooks/useFolderTreeDragActions";
import { useSampleStore } from "../../store/useSampleStore";
import { filterVisibleLibraries } from "../../utils/format";
import { EMPTY_SAMPLES } from "../../utils/sampleLookup";
import { FolderTreeRow } from "./FolderTreeRow";
import {
  buildFolderTreeByLibrary,
  normalizeTreeKey,
} from "./folderTreeBuilder";
import { buildFlatFolderRows } from "./folderTreeFlatten";
import type { SidebarFolderContextMenuState } from "./SidebarFolderContextMenu";
import {
  SIDEBAR_TREE_CHILD_HEIGHT,
  SIDEBAR_TREE_ROOT_HEIGHT,
} from "./SidebarTreeRow";
import { useFoldersTreeScope } from "./useFoldersTreeScope";

const LazySidebarFolderContextMenu = lazy(() =>
  import("./SidebarFolderContextMenu").then((m) => ({
    default: m.SidebarFolderContextMenu,
  }))
);

let sessionFolderSearch = "";

export interface FoldersTreeTabProps {
  forcedScope?: "bin" | "trash";
  dragHoverTarget?: string | null;
  setDragHoverTarget?: (target: string | null) => void;
  dropFlashTarget?: string | null;
  isExternalFileDragActive?: boolean;
}

export const FoldersTreeTab: React.FC<FoldersTreeTabProps> = ({
  forcedScope,
  dragHoverTarget = null,
  setDragHoverTarget,
  dropFlashTarget = null,
  isExternalFileDragActive = false,
}) => {
  const hasInitialized = useSampleStore((s) => s.hasInitialized);
  const libraries = useSampleStore((s) => s.libraries);
  const folderStats = useSampleStore((s) => s.folderStats);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const fallbackSamplesForTree = useSampleStore((s) =>
    s.folderStats.length > 0 ? EMPTY_SAMPLES : s.rawSamples
  );
  const selectedLicenseGroupId = useSampleStore(
    (s) => s.selectedLicenseGroupId
  );
  const isScanning = useSampleStore((s) => s.isScanning);
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);

  const setFolderFilter = useSampleStore((s) => s.setFolderFilter);
  const syncFolderIncremental = useSampleStore((s) => s.syncFolderIncremental);
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const showInFolder = useSampleStore((s) => s.showInFolder);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);
  const createPhysicalSubfolder = useSampleStore(
    (s) => s.createPhysicalSubfolder
  );
  const renamePhysicalSubfolder = useSampleStore(
    (s) => s.renamePhysicalSubfolder
  );
  const requestTrashSubfolder = useSampleStore((s) => s.requestTrashSubfolder);
  const importExternalFilesToFolder = useSampleStore(
    (s) => s.importExternalFilesToFolder
  );

  const [folderContextMenu, setFolderContextMenu] =
    useState<SidebarFolderContextMenuState | null>(null);
  const [folderSearch, setFolderSearch] = useState<string>(
    () => sessionFolderSearch
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    () => sessionFolderSearch.trim().length > 0
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const updateFolderSearch = (val: string) => {
    sessionFolderSearch = val;
    setFolderSearch(val);
  };

  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isSearchOpen]);

  const handleCopyFolderPath = useCallback(
    (path: string) => {
      navigator.clipboard
        ?.writeText(path)
        .then(() => setStatusMessage(`Copied folder path: ${path}`))
        .catch(() => {});
    },
    [setStatusMessage]
  );

  const handleCloseFolderContextMenu = useCallback(() => {
    setFolderContextMenu(null);
  }, []);

  const handleShowFolderInExplorer = useCallback(
    (path: string) => {
      void showInFolder(path);
    },
    [showInFolder]
  );

  const displayLibraries = useMemo(
    () => filterVisibleLibraries(libraries),
    [libraries]
  );

  const {
    isReadOnlyScope,
    headerTitle,
    emptyMessage,
    subsetSamples,
  } = useFoldersTreeScope(displayLibraries, forcedScope);

  const folderTreeByLibrary = useMemo(
    () =>
      buildFolderTreeByLibrary({
        displayLibraries,
        folderStats,
        fallbackSamples: fallbackSamplesForTree,
        favoriteOnly,
        favoriteSamples: EMPTY_SAMPLES,
        subsetSamples,
      }),
    [
      displayLibraries,
      folderStats,
      fallbackSamplesForTree,
      favoriteOnly,
      subsetSamples,
    ]
  );

  const subsetCountByLibrary = useMemo(() => {
    if (!subsetSamples) return null;
    const map: Record<number, number> = {};
    for (const s of subsetSamples) {
      map[s.library_id] = (map[s.library_id] || 0) + 1;
    }
    return map;
  }, [subsetSamples]);

  const normActiveLower =
    folderFilter && !selectedLicenseGroupId
      ? normalizeTreeKey(folderFilter)
      : null;

  const isSearching = folderSearch.trim().length > 0;

  const {
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
  } = useFolderTreeDragActions({
    displayLibraries,
    folderTreeByLibrary,
    folderFilter,
    enableAdvancedFileOps: !isReadOnlyScope && enableAdvancedFileOps,
    isDraggingInApp: !isReadOnlyScope && isDraggingInApp,
    isExternalFileDragActive: !isReadOnlyScope && isExternalFileDragActive,
    dragHoverTarget,
    setStatusMessage,
    setFolderFilter,
    createPhysicalSubfolder,
    renamePhysicalSubfolder,
    importExternalFilesToFolder,
  });

  const flatRows = useMemo(
    () =>
      buildFlatFolderRows({
        displayLibraries,
        folderTreeByLibrary,
        folderSearch,
        favoriteOnly: isReadOnlyScope,
        favCountByLibrary: subsetCountByLibrary,
        subsetCountByLibrary,
        normActiveLower,
        expandedLibIds,
        expandedFolderPaths,
        creatingSubfolderTarget: isReadOnlyScope
          ? null
          : creatingSubfolderTarget,
      }),
    [
      displayLibraries,
      folderTreeByLibrary,
      folderSearch,
      isReadOnlyScope,
      subsetCountByLibrary,
      normActiveLower,
      expandedLibIds,
      expandedFolderPaths,
      creatingSubfolderTarget,
    ]
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      flatRows[index]?.kind === "library"
        ? SIDEBAR_TREE_ROOT_HEIGHT
        : SIDEBAR_TREE_CHILD_HEIGHT,
    overscan: 18,
  });

  const isAnyDragActive =
    !isReadOnlyScope && (isDraggingInApp || isExternalFileDragActive);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
            {headerTitle}
          </span>
          {folderFilter !== null && selectedLicenseGroupId === null && (
            <button
              type="button"
              onClick={() => setFolderFilter(null)}
              className="w-[18px] h-[18px] text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 flex items-center justify-center shrink-0 transition-colors"
              title="Clear folder filter (Show all)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {!isReadOnlyScope &&
            enableAdvancedFileOps &&
            displayLibraries.length > 0 && (
              <button
                type="button"
                onClick={handleHeaderCreateSubfolder}
                className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-accent-fg hover:bg-accent-soft border border-accent/30 shrink-0 transition-colors"
                title="New Physical Subfolder on Disk (inside selected folder or library)"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            )}
          {flatRows.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExpandAll}
                className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
                title="Expand All Folders"
              >
                <ChevronsDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCollapseAll}
                className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
                title="Collapse All Folders"
              >
                <ChevronsUp className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (isSearchOpen && !folderSearch.trim()) {
                setIsSearchOpen(false);
              } else {
                setIsSearchOpen(true);
                requestAnimationFrame(() => searchInputRef.current?.focus());
              }
            }}
            className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
              isSearchOpen || isSearching
                ? "bg-accent-soft border-accent text-accent-fg"
                : "border-transparent text-fg-3 hover:text-fg hover:bg-line"
            }`}
            title="Search folders"
          >
            <Search className="w-3 h-3" />
          </button>
          {!isReadOnlyScope && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true, "libraries")}
              className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
              title="Manage Libraries in Settings"
            >
              <Settings className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {(isSearchOpen || isSearching) && (
        <div className="px-2 py-1.5 border-b border-line shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={folderSearch}
              onChange={(e) => updateFolderSearch(e.target.value)}
              onBlur={() => {
                if (!folderSearch.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (folderSearch.trim()) {
                    updateFolderSearch("");
                  } else {
                    setIsSearchOpen(false);
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Filter folders..."
              className="w-full h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none"
            />
            {folderSearch && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  updateFolderSearch("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 text-fg-2 hover:text-fg"
                title="Clear filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-1.5">
        {!hasInitialized && displayLibraries.length === 0 ? (
          <div className="px-2.5 py-2 space-y-2 select-none" aria-busy="true">
            <div className="h-[22px] rounded-xs bg-surface-2 animate-pulse" />
            <div className="h-[22px] rounded-xs bg-surface-2 animate-pulse w-4/5" />
            <div className="h-[22px] rounded-xs bg-surface-2 animate-pulse w-3/5" />
          </div>
        ) : displayLibraries.length === 0 ? (
          <div className="py-8 px-3 text-center space-y-2 select-none">
            <div className="w-8 h-8 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
              <HardDrive className="w-4 h-4" />
            </div>
            <div className="text-[11px] font-medium text-fg">
              No libraries indexed
            </div>
            <div className="text-[10px] text-fg-3 leading-relaxed">
              Add your audio folders in Settings to browse your folder tree.
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true, "libraries")}
              className="mt-1 h-[24px] px-2.5 rounded-xs bg-accent text-accent-on text-[11px] font-semibold hover:brightness-110 transition-all"
            >
              + Add Library
            </button>
          </div>
        ) : flatRows.length === 0 ? (
          <div className="py-5 px-3 text-center text-[11px] text-fg-3 font-mono">
            {isSearching ? "No folders match filter." : emptyMessage}
          </div>
        ) : (
          <div
            className={`relative w-full text-[12px] transition-opacity ${
              !isReadOnlyScope && isDraggingInApp && !enableAdvancedFileOps
                ? "opacity-40"
                : ""
            }`}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index];
              if (!row) return null;
              const rowDropKey =
                row.kind === "library"
                  ? `folder:${row.lib.id}:${row.lib.path}`
                  : row.kind === "folder"
                    ? `folder:${row.lib.id}:${row.node.fullPath}`
                    : "";
              const rowCanDrop =
                row.kind !== "create-input" &&
                !isReadOnlyScope &&
                enableAdvancedFileOps &&
                !row.lib.is_read_only;
              const isDropHovered =
                rowCanDrop && isAnyDragActive && dragHoverTarget === rowDropKey;
              const isDropFlashed =
                row.kind !== "create-input" &&
                !isReadOnlyScope &&
                dropFlashTarget === rowDropKey;
              const isRenamingThisFolder = Boolean(
                row.kind === "folder" &&
                  !isReadOnlyScope &&
                  renamingFolderTarget &&
                  renamingFolderTarget.libraryId === row.lib.id &&
                  normalizeTreeKey(renamingFolderTarget.folderPath) ===
                    normalizeTreeKey(row.node.fullPath)
              );
              return (
                <FolderTreeRow
                  key={row.key}
                  row={row}
                  virtualStart={virtualRow.start}
                  virtualSize={virtualRow.size}
                  readOnlyScope={isReadOnlyScope}
                  enableAdvancedFileOps={enableAdvancedFileOps}
                  isAnyDragActive={isAnyDragActive}
                  isExternalFileDragActive={isExternalFileDragActive}
                  inAppDragCount={inAppDragCount}
                  isDropHovered={isDropHovered}
                  isDropFlashed={isDropFlashed}
                  isScanning={isScanning}
                  createInputRef={createInputRef}
                  newSubfolderName={
                    row.kind === "create-input" ? newSubfolderName : ""
                  }
                  setNewSubfolderName={setNewSubfolderName}
                  setCreatingSubfolderTarget={setCreatingSubfolderTarget}
                  submitCreateSubfolder={submitCreateSubfolder}
                  isRenamingThisFolder={isRenamingThisFolder}
                  renameInputRef={renameInputRef}
                  renameFolderDraft={
                    isRenamingThisFolder ? renameFolderDraft : ""
                  }
                  setRenameFolderDraft={setRenameFolderDraft}
                  setRenamingFolderTarget={setRenamingFolderTarget}
                  submitRenameSubfolder={submitRenameSubfolder}
                  setExpandedLibIds={setExpandedLibIds}
                  setExpandedFolderPaths={setExpandedFolderPaths}
                  startCreatingSubfolder={startCreatingSubfolder}
                  startRenamingSubfolder={startRenamingSubfolder}
                  handleImportDialogForFolder={handleImportDialogForFolder}
                  syncFolderIncremental={syncFolderIncremental}
                  setFolderFilter={setFolderFilter}
                  setDragHoverTarget={setDragHoverTarget}
                  setSettingsOpen={setSettingsOpen}
                  requestTrashSubfolder={requestTrashSubfolder}
                  setFolderContextMenu={setFolderContextMenu}
                />
              );
            })}
          </div>
        )}
      </div>

      {folderContextMenu && (
        <Suspense fallback={null}>
          <LazySidebarFolderContextMenu
            menu={folderContextMenu}
            onClose={handleCloseFolderContextMenu}
            onShowInFolder={handleShowFolderInExplorer}
            onCopyPath={handleCopyFolderPath}
          />
        </Suspense>
      )}
    </div>
  );
};
