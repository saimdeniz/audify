import React, { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronsDown,
  ChevronsUp,
  FileCheck2,
  Search,
  Settings,
  X,
} from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeGetItem, safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { filterVisibleLibraries } from "../../utils/format";
import { EMPTY_SAMPLES } from "../../utils/sampleLookup";
import {
  buildLicenseGroupTrees,
  FolderTreeNode,
  normalizeTreeKey,
} from "./folderTreeBuilder";
import { buildFlatLicenseRows, LicenseTreeRow } from "./LicenseTreeRow";
import {
  SidebarFolderContextMenu,
  SidebarFolderContextMenuState,
} from "./SidebarFolderContextMenu";

let sessionLicenseSearch = "";

export const LicensesTreeTab: React.FC = () => {
  const libraries = useSampleStore((s) => s.libraries);
  const folderStats = useSampleStore((s) => s.folderStats);
  const fallbackSamplesForTree = useSampleStore((s) =>
    s.folderStats.length > 0 ? EMPTY_SAMPLES : s.rawSamples
  );
  const licenseGroups = useSampleStore((s) => s.licenseGroups);
  const selectedLicenseGroupId = useSampleStore(
    (s) => s.selectedLicenseGroupId
  );
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const hasActiveSampleSelection = useSampleStore(
    (s) => s.selectedSampleIds.length > 0 || s.selectedSample !== null
  );
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const setLicenseGroupFilter = useSampleStore((s) => s.setLicenseGroupFilter);
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const showInFolder = useSampleStore((s) => s.showInFolder);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  const [licenseContextMenu, setLicenseContextMenu] =
    useState<SidebarFolderContextMenuState | null>(null);

  const handleCopyFolderPath = (path: string) => {
    navigator.clipboard
      ?.writeText(path)
      .then(() => setStatusMessage(`Copied folder path: ${path}`))
      .catch(() => {});
  };

  const [licenseSearch, setLicenseSearch] = useState<string>(
    () => sessionLicenseSearch
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    () => sessionLicenseSearch.trim().length > 0
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const updateLicenseSearch = (val: string) => {
    sessionLicenseSearch = val;
    setLicenseSearch(val);
  };

  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isSearchOpen]);

  const [expandedLicenseIds, setExpandedLicenseIds] = useState<
    Record<string, boolean>
  >(() => {
    try {
      const raw = safeGetItem(AUDIFY_STORAGE_KEYS.expandedLicenseIds);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [expandedFolderPaths, setExpandedFolderPaths] = useState<
    Record<string, boolean>
  >(() => {
    try {
      const raw = safeGetItem(AUDIFY_STORAGE_KEYS.expandedLicenseFolderPaths);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const t = setTimeout(() => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.expandedLicenseIds,
        JSON.stringify(expandedLicenseIds),
        { broadcast: false, markEdited: false }
      );
    }, 120);
    return () => clearTimeout(t);
  }, [expandedLicenseIds]);

  useEffect(() => {
    const t = setTimeout(() => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.expandedLicenseFolderPaths,
        JSON.stringify(expandedFolderPaths),
        { broadcast: false, markEdited: false }
      );
    }, 120);
    return () => clearTimeout(t);
  }, [expandedFolderPaths]);

  const visibleLibraries = useMemo(
    () => filterVisibleLibraries(libraries),
    [libraries]
  );

  const licenseGroupTrees = useMemo(
    () =>
      buildLicenseGroupTrees({
        licenseGroups,
        visibleLibraries,
        folderStats,
        fallbackSamples: fallbackSamplesForTree,
      }),
    [licenseGroups, visibleLibraries, folderStats, fallbackSamplesForTree]
  );

  const filteredLicenseGroups = useMemo(() => {
    const q = licenseSearch.trim().toLowerCase();
    if (!q) return licenseGroups;
    return licenseGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.folders.some((f) => f.toLowerCase().includes(q)) ||
        (g.rel_folders ?? []).some((f) => f.toLowerCase().includes(q))
    );
  }, [licenseGroups, licenseSearch]);

  const normActiveLower = folderFilter ? normalizeTreeKey(folderFilter) : null;

  const flatLicenseRows = useMemo(
    () =>
      buildFlatLicenseRows({
        filteredLicenseGroups,
        licenseGroupTrees,
        expandedLicenseIds,
        expandedFolderPaths,
        selectedLicenseGroupId,
        folderFilter,
        normActiveLower,
      }),
    [
      filteredLicenseGroups,
      licenseGroupTrees,
      expandedLicenseIds,
      expandedFolderPaths,
      selectedLicenseGroupId,
      folderFilter,
      normActiveLower,
    ]
  );

  const licensesScrollRef = useRef<HTMLDivElement | null>(null);
  const licenseVirtualizer = useVirtualizer({
    count: flatLicenseRows.length,
    getScrollElement: () => licensesScrollRef.current,
    estimateSize: (index) =>
      flatLicenseRows[index]?.kind === "group" ? 28 : 26,
    overscan: 18,
  });

  const setAllLicenseNodesExpanded = (expanded: boolean) => {
    const nextGroupIds: Record<string, boolean> = {};
    const nextFolderPaths: Record<string, boolean> = { ...expandedFolderPaths };
    for (const group of licenseGroups) {
      nextGroupIds[group.id] = expanded;
      const tree = licenseGroupTrees[group.id]?.nodes || [];
      const traverse = (nodes: FolderTreeNode[]) => {
        for (const node of nodes) {
          if (node.children.length > 0) {
            nextFolderPaths[
              `lic-${group.id}-${normalizeTreeKey(node.fullPath)}`
            ] = expanded;
            traverse(node.children);
          }
        }
      };
      traverse(tree);
    }
    setExpandedLicenseIds(nextGroupIds);
    setExpandedFolderPaths(nextFolderPaths);
  };

  const isSearching = licenseSearch.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
            LICENSES ({licenseGroups.length.toLocaleString()})
          </span>
          {selectedLicenseGroupId !== null && (
            <button
              type="button"
              onClick={() => setLicenseGroupFilter(null, null)}
              className="w-[18px] h-[18px] text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 flex items-center justify-center shrink-0 transition-colors"
              title="Clear license filter (Show all)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={() => setAllLicenseNodesExpanded(true)}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Expand All License Folders"
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setAllLicenseNodesExpanded(false)}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Collapse All License Folders"
          >
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (isSearchOpen && !licenseSearch.trim()) {
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
            title="Search licenses"
          >
            <Search className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true, "licenses")}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Manage Licenses & Rules in Settings"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>

      {(isSearchOpen || isSearching) && (
        <div className="px-2 py-1.5 border-b border-line shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={licenseSearch}
              onChange={(e) => updateLicenseSearch(e.target.value)}
              onBlur={() => {
                if (!licenseSearch.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (licenseSearch.trim()) {
                    updateLicenseSearch("");
                  } else {
                    setIsSearchOpen(false);
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Filter artists or folders..."
              className="w-full h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none"
            />
            {licenseSearch && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  updateLicenseSearch("");
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

      <div ref={licensesScrollRef} className="flex-1 overflow-y-auto py-1.5">
        {filteredLicenseGroups.length === 0 ? (
          licenseGroups.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-2 select-none">
              <div className="w-8 h-8 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
                <FileCheck2 className="w-4 h-4" />
              </div>
              <div className="text-[11px] font-medium text-fg">
                No license groups yet
              </div>
              <div className="text-[10px] text-fg-3 leading-relaxed">
                Manage attribution and track licenses in Settings.
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-[11px] text-fg-3 font-mono">
              No license groups match filter.
            </div>
          )
        ) : (
          <div
            className={`relative w-full text-[12px] transition-opacity ${
              isDraggingInApp ? "opacity-40" : ""
            }`}
            style={{
              height: `${licenseVirtualizer.getTotalSize()}px`,
            }}
          >
            {licenseVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatLicenseRows[virtualRow.index];
              if (!row) return null;
              return (
                <LicenseTreeRow
                  key={row.key}
                  row={row}
                  virtualStart={virtualRow.start}
                  virtualSize={virtualRow.size}
                  hasActiveSampleSelection={hasActiveSampleSelection}
                  setExpandedLicenseIds={setExpandedLicenseIds}
                  setExpandedFolderPaths={setExpandedFolderPaths}
                  setLicenseGroupFilter={setLicenseGroupFilter}
                  copyAttributionForSamples={copyAttributionForSamples}
                  setSettingsOpen={setSettingsOpen}
                  setLicenseContextMenu={setLicenseContextMenu}
                />
              );
            })}
          </div>
        )}
      </div>

      <SidebarFolderContextMenu
        menu={licenseContextMenu}
        onClose={() => setLicenseContextMenu(null)}
        onShowInFolder={(path) => void showInFolder(path)}
        onCopyPath={handleCopyFolderPath}
      />
    </div>
  );
};
