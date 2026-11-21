import React from "react";
import { ChevronDown, ChevronRight, Copy, Folder, FolderOpen } from "lucide-react";
import { LicenseGroup } from "../../types";
import { folderNameFromPath } from "../../utils/format";
import { FolderTreeNode, normalizeTreeKey } from "./folderTreeBuilder";
import type { SidebarFolderContextMenuState } from "./SidebarFolderContextMenu";

export type FlatLicenseRow =
  | {
      kind: "group";
      key: string;
      group: LicenseGroup;
      totalCount: number;
      isExpanded: boolean;
      isGroupSelected: boolean;
      isSubfolderSelected: boolean;
    }
  | {
      kind: "folder";
      key: string;
      groupId: string;
      expandKey: string;
      node: FolderTreeNode;
      isExpanded: boolean;
      isSelected: boolean;
      isAncestorOfSelected: boolean;
    };

export function buildFlatLicenseRows(params: {
  filteredLicenseGroups: LicenseGroup[];
  licenseGroupTrees: Record<string, { totalCount: number; nodes: FolderTreeNode[] }>;
  expandedLicenseIds: Record<string, boolean>;
  expandedFolderPaths: Record<string, boolean>;
  selectedLicenseGroupId: string | null;
  folderFilter: string | null;
  normActiveLower: string | null;
}): FlatLicenseRow[] {
  const {
    filteredLicenseGroups,
    licenseGroupTrees,
    expandedLicenseIds,
    expandedFolderPaths,
    selectedLicenseGroupId,
    folderFilter,
    normActiveLower,
  } = params;
  const rows: FlatLicenseRow[] = [];

  const pushNodes = (groupId: string, nodes: FolderTreeNode[]) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const nodeLower = normalizeTreeKey(node.fullPath);
      const isSelected =
        selectedLicenseGroupId === groupId && normActiveLower === nodeLower;
      const isAncestorOfSelected = Boolean(
        selectedLicenseGroupId === groupId &&
          normActiveLower &&
          normActiveLower.startsWith(`${nodeLower}/`)
      );
      const expandKey = `lic-${groupId}-${nodeLower}`;
      const isExpanded =
        expandedFolderPaths[expandKey] !== undefined
          ? expandedFolderPaths[expandKey]
          : isAncestorOfSelected;

      rows.push({
        kind: "folder",
        key: expandKey,
        groupId,
        expandKey,
        node,
        isExpanded,
        isSelected,
        isAncestorOfSelected,
      });

      if (hasChildren && isExpanded) {
        pushNodes(groupId, node.children);
      }
    }
  };

  for (const group of filteredLicenseGroups) {
    const treeData = licenseGroupTrees[group.id] || {
      totalCount: 0,
      nodes: [],
    };
    const isExpanded = expandedLicenseIds[group.id] ?? true;
    const isGroupSelected =
      selectedLicenseGroupId === group.id && folderFilter === null;
    const isSubfolderSelected =
      selectedLicenseGroupId === group.id && folderFilter !== null;

    rows.push({
      kind: "group",
      key: `grp-${group.id}`,
      group,
      totalCount: treeData.totalCount,
      isExpanded,
      isGroupSelected,
      isSubfolderSelected,
    });

    if (isExpanded && treeData.nodes.length > 0) {
      pushNodes(group.id, treeData.nodes);
    }
  }

  return rows;
}

interface LicenseTreeRowProps {
  row: FlatLicenseRow;
  virtualStart: number;
  virtualSize: number;
  hasActiveSampleSelection: boolean;
  setExpandedLicenseIds: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setExpandedFolderPaths: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setLicenseGroupFilter: (groupId: string | null, folderPath: string | null) => void;
  copyAttributionForSamples: () => void;
  setSettingsOpen: (open: boolean, tab?: "licenses") => void;
  setLicenseContextMenu: (menu: SidebarFolderContextMenuState | null) => void;
}

export const LicenseTreeRow: React.FC<LicenseTreeRowProps> = React.memo(({
  row,
  virtualStart,
  virtualSize,
  hasActiveSampleSelection,
  setExpandedLicenseIds,
  setExpandedFolderPaths,
  setLicenseGroupFilter,
  copyAttributionForSamples,
  setSettingsOpen,
  setLicenseContextMenu,
}) => {
  if (row.kind === "group") {
    const {
      group,
      totalCount,
      isExpanded,
      isGroupSelected,
      isSubfolderSelected,
    } = row;

    return (
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const cleanFolders = group.folders.filter(
            (f) => f && f.trim().length > 0
          );
          const explorerTargets = cleanFolders.map((fp) => {
            const base = folderNameFromPath(fp, fp);
            return {
              label:
                cleanFolders.length > 1
                  ? `Show in Explorer (${base})`
                  : "Show in Explorer",
              path: fp,
            };
          });
          setLicenseContextMenu({
            x: e.clientX,
            y: e.clientY,
            title: group.name,
            explorerTargets,
            primaryCopyPath: cleanFolders[0],
            onOpenSettings: () => setSettingsOpen(true, "licenses"),
            settingsLabel: "Edit License Rule in Settings",
          });
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${virtualSize}px`,
          transform: `translateY(${virtualStart}px)`,
        }}
        className={`group px-2 flex items-center justify-between cursor-pointer border-l-2 ${
          isGroupSelected
            ? "bg-surface-3 text-accent-fg border-accent font-medium"
            : isSubfolderSelected
            ? "bg-surface-2 text-fg border-accent/40"
            : "text-fg hover:bg-surface-hover border-transparent"
        }`}
      >
        <div
          onClick={() =>
            setLicenseGroupFilter(isGroupSelected ? null : group.id, null)
          }
          className="flex items-center space-x-1 truncate flex-1 min-w-0"
          title={`${group.name} — ${group.template}`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedLicenseIds((prev) => ({
                ...prev,
                [group.id]: !isExpanded,
              }));
            }}
            className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-line shrink-0"
            title={isExpanded ? "Collapse folder tree" : "Expand folder tree"}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-accent-fg" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0 text-accent-fg" />
          )}

          <span className="truncate font-medium pl-0.5">{group.name}</span>
        </div>

        <div className="flex items-center space-x-1 shrink-0 pl-1">
          {hasActiveSampleSelection && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyAttributionForSamples();
              }}
              className="opacity-0 group-hover:opacity-100 w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-line shrink-0"
              title="Copy credits for selected sample(s)"
            >
              <Copy className="w-3 h-3" />
            </button>
          )}
          <span
            className={`font-mono tabular-nums text-[11px] font-medium shrink-0 ${
              isGroupSelected
                ? "text-accent-fg"
                : "text-fg-2 group-hover:text-fg"
            }`}
          >
            {totalCount.toLocaleString()}
          </span>
        </div>
      </div>
    );
  }

  const {
    groupId,
    expandKey,
    node,
    isExpanded,
    isSelected,
    isAncestorOfSelected,
  } = row;
  const hasChildren = node.children.length > 0;
  const indentPx = 14 + node.depth * 13;

  return (
    <div
      onClick={() =>
        setLicenseGroupFilter(groupId, isSelected ? null : node.fullPath)
      }
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setLicenseContextMenu({
          x: e.clientX,
          y: e.clientY,
          title: node.name,
          explorerTargets: [{ label: "Show in Explorer", path: node.fullPath }],
          primaryCopyPath: node.fullPath,
          onOpenSettings: () => setSettingsOpen(true, "licenses"),
          settingsLabel: "Edit License Rule in Settings",
        });
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: `${virtualSize}px`,
        transform: `translateY(${virtualStart}px)`,
        paddingLeft: `${indentPx}px`,
      }}
      className={`group pr-2 flex items-center justify-between cursor-pointer text-[12px] border-l-2 ${
        isSelected
          ? "bg-surface-3 text-accent-fg border-accent font-medium"
          : isAncestorOfSelected
          ? "text-fg border-accent/40 hover:bg-surface-hover"
          : "text-fg hover:text-fg-head hover:bg-surface-hover border-transparent"
      }`}
      title={node.fullPath}
    >
      <div className="flex items-center space-x-1 truncate flex-1 min-w-0">
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedFolderPaths((prev) => ({
                ...prev,
                [expandKey]: !isExpanded,
              }));
            }}
            className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-line shrink-0"
            title={isExpanded ? "Collapse subfolder" : "Expand subfolder"}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}

        {isExpanded && hasChildren ? (
          <FolderOpen
            className={`w-3.5 h-3.5 shrink-0 ${
              isSelected ? "text-accent-fg" : "text-accent-fg opacity-80"
            }`}
          />
        ) : (
          <Folder
            className={`w-3.5 h-3.5 shrink-0 ${
              isSelected ? "text-accent-fg" : "text-fg-2 group-hover:text-accent-fg"
            }`}
          />
        )}

        <span className="truncate pl-0.5">{node.name}</span>
      </div>

      <span
        className={`font-mono tabular-nums text-[11px] font-medium pl-1.5 shrink-0 ${
          isSelected ? "text-accent-fg" : "text-fg-2 group-hover:text-fg"
        }`}
      >
        {node.count.toLocaleString()}
      </span>
    </div>
  );
});
