import { Library } from "../../types";
import { FolderTreeNode, normalizeTreeKey } from "./folderTreeBuilder";

export type FlatFolderRow =
  | {
      kind: "library";
      key: string;
      lib: Library;
      displayCount: number;
      hasSubfolders: boolean;
      isExpanded: boolean;
      isLibRootSelected: boolean;
      isSubfolderSelected: boolean;
    }
  | {
      kind: "folder";
      key: string;
      lib: Library;
      node: FolderTreeNode;
      isExpanded: boolean;
      isSelected: boolean;
      isAncestorOfSelected: boolean;
    }
  | {
      kind: "create-input";
      key: string;
      lib: Library;
      parentPath: string;
      depth: number;
    };

export function filterFolderNodesByQuery(
  nodes: FolderTreeNode[],
  queryLower: string
): FolderTreeNode[] {
  const out: FolderTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterFolderNodesByQuery(
      node.children,
      queryLower
    );
    const selfMatches =
      node.name.toLowerCase().includes(queryLower) ||
      node.fullPath.toLowerCase().includes(queryLower);
    if (selfMatches || filteredChildren.length > 0) {
      out.push({
        ...node,
        children:
          selfMatches && filteredChildren.length === 0
            ? node.children
            : filteredChildren,
      });
    }
  }
  return out;
}

interface BuildFlatFolderRowsParams {
  displayLibraries: Library[];
  folderTreeByLibrary: Record<number, FolderTreeNode[]>;
  folderSearch: string;
  favoriteOnly: boolean;
  favCountByLibrary: Record<number, number> | null;
  subsetCountByLibrary?: Record<number, number> | null;
  normActiveLower: string | null;
  expandedLibIds: Record<number, boolean>;
  expandedFolderPaths: Record<string, boolean>;
  creatingSubfolderTarget: {
    libraryId: number;
    parentPath: string;
    depth: number;
  } | null;
}

export function buildFlatFolderRows({
  displayLibraries,
  folderTreeByLibrary,
  folderSearch,
  favoriteOnly,
  favCountByLibrary,
  subsetCountByLibrary,
  normActiveLower,
  expandedLibIds,
  expandedFolderPaths,
  creatingSubfolderTarget,
}: BuildFlatFolderRowsParams): FlatFolderRow[] {
  const rows: FlatFolderRow[] = [];
  const q = folderSearch.trim().toLowerCase();
  const normCreateParent = creatingSubfolderTarget
    ? normalizeTreeKey(creatingSubfolderTarget.parentPath)
    : null;

  const pushNodes = (lib: Library, nodes: FolderTreeNode[]) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const nodeLower = normalizeTreeKey(node.fullPath);
      const isSelected = normActiveLower === nodeLower;
      const isAncestorOfSelected = Boolean(
        normActiveLower && normActiveLower.startsWith(`${nodeLower}/`)
      );
      const isExpanded = q
        ? true
        : expandedFolderPaths[nodeLower] !== undefined
        ? expandedFolderPaths[nodeLower]
        : isAncestorOfSelected;

      rows.push({
        kind: "folder",
        key: `fld-${lib.id}-${nodeLower}`,
        lib,
        node,
        isExpanded,
        isSelected,
        isAncestorOfSelected,
      });

      if (
        creatingSubfolderTarget &&
        creatingSubfolderTarget.libraryId === lib.id &&
        normCreateParent === nodeLower
      ) {
        rows.push({
          kind: "create-input",
          key: `create-${lib.id}-${nodeLower}`,
          lib,
          parentPath: node.fullPath,
          depth: node.depth + 1,
        });
      }

      if (hasChildren && isExpanded) {
        pushNodes(lib, node.children);
      }
    }
  };

  for (const lib of displayLibraries) {
    const rawTree = folderTreeByLibrary[lib.id] || [];
    const libMatches =
      !q ||
      lib.name.toLowerCase().includes(q) ||
      lib.path.toLowerCase().includes(q);
    const tree = q
      ? libMatches
        ? filterFolderNodesByQuery(rawTree, q).length > 0
          ? filterFolderNodesByQuery(rawTree, q)
          : rawTree
        : filterFolderNodesByQuery(rawTree, q)
      : rawTree;

    if (q && !libMatches && tree.length === 0) {
      continue;
    }

    const activeSubsetCounts =
      subsetCountByLibrary ?? (favoriteOnly ? favCountByLibrary : null);
    const displayCount = activeSubsetCounts
      ? activeSubsetCounts[lib.id] || 0
      : lib.sample_count;
    if (activeSubsetCounts && displayCount === 0 && tree.length === 0) {
      continue;
    }
    const libLower = normalizeTreeKey(lib.path);
    const isLibRootSelected = normActiveLower === libLower;
    const isSubfolderSelected = Boolean(
      normActiveLower && normActiveLower.startsWith(`${libLower}/`)
    );
    const isExpanded = q
      ? true
      : expandedLibIds[lib.id] !== undefined
      ? expandedLibIds[lib.id]
      : isSubfolderSelected;

    rows.push({
      kind: "library",
      key: `lib-${lib.id}`,
      lib,
      displayCount,
      hasSubfolders: tree.length > 0,
      isExpanded,
      isLibRootSelected,
      isSubfolderSelected,
    });

    if (
      creatingSubfolderTarget &&
      creatingSubfolderTarget.libraryId === lib.id &&
      normCreateParent === libLower
    ) {
      rows.push({
        kind: "create-input",
        key: `create-${lib.id}-root`,
        lib,
        parentPath: lib.path,
        depth: 0,
      });
    }

    if (isExpanded && tree.length > 0) {
      pushNodes(lib, tree);
    }
  }

  return rows;
}
