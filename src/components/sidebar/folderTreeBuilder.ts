import { FolderStat, Library, LicenseGroup, SampleItem } from "../../types";
import { findLicenseFolderMatch, folderNameFromPath } from "../../utils/format";

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  count: number;
  depth: number;
  children: FolderTreeNode[];
}

export interface FolderTreeSampleRef {
  library_id: number;
  folder_path: string;
}

interface MutableNode {
  name: string;
  fullPath: string;
  count: number;
  depth: number;
  childrenMap: Map<string, MutableNode>;
}

const sortNodesCompare = (a: MutableNode, b: MutableNode): number =>
  a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

function toSortedTree(map: Map<string, MutableNode>): FolderTreeNode[] {
  return Array.from(map.values())
    .sort(sortNodesCompare)
    .map((n) => ({
      name: n.name,
      fullPath: n.fullPath,
      count: n.count,
      depth: n.depth,
      children: toSortedTree(n.childrenMap),
    }));
}

export function normalizeTreePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function normalizeTreeKey(p: string): string {
  return normalizeTreePath(p).toLowerCase();
}

function insertRelativeFolderSegments(
  rootMap: Map<string, MutableNode>,
  rootNorm: string,
  folderNorm: string,
  countDelta: number,
  baseDepth = 0
): void {
  const rootLower = rootNorm.toLowerCase();
  const folderLower = folderNorm.toLowerCase();
  if (
    folderLower.length <= rootLower.length ||
    !folderLower.startsWith(`${rootLower}/`)
  ) {
    return;
  }

  const rel = folderNorm.slice(rootNorm.length).replace(/^\/+/, "");
  if (!rel) return;
  const segments = rel.split("/").filter(Boolean);
  let currentPath = rootNorm;
  let currentMap = rootMap;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segKey = seg.toLowerCase();
    let node = currentMap.get(segKey);
    if (!node) {
      currentPath = `${currentPath}/${seg}`;
      node = {
        name: seg,
        fullPath: currentPath,
        count: 0,
        depth: baseDepth + i + 1,
        childrenMap: new Map(),
      };
      currentMap.set(segKey, node);
    } else {
      currentPath = node.fullPath;
    }
    node.count += countDelta;
    currentMap = node.childrenMap;
  }
}

export function buildFolderTreeByLibrary(params: {
  displayLibraries: Library[];
  folderStats: FolderStat[];
  fallbackSamples: SampleItem[];
  favoriteOnly: boolean;
  favoriteSamples: SampleItem[];
  subsetSamples?: FolderTreeSampleRef[] | null;
}): Record<number, FolderTreeNode[]> {
  const {
    displayLibraries,
    folderStats,
    fallbackSamples,
    favoriteOnly,
    favoriteSamples,
    subsetSamples,
  } = params;
  const activeSubset =
    subsetSamples !== undefined
      ? subsetSamples
      : favoriteOnly
      ? favoriteSamples
      : null;
  const result: Record<number, FolderTreeNode[]> = {};
  const hasStats = folderStats.length > 0;

  for (const lib of displayLibraries) {
    const rootNorm = normalizeTreePath(lib.path);
    const rootMap = new Map<string, MutableNode>();

    if (activeSubset !== null) {
      for (const sample of activeSubset) {
        if (sample.library_id !== lib.id) continue;
        const folderNorm = normalizeTreePath(sample.folder_path);
        insertRelativeFolderSegments(rootMap, rootNorm, folderNorm, 1, 0);
      }
    } else if (hasStats) {
      for (const stat of folderStats) {
        if (stat.library_id !== lib.id) continue;
        const folderNorm = normalizeTreePath(stat.folder_path);
        insertRelativeFolderSegments(
          rootMap,
          rootNorm,
          folderNorm,
          stat.count,
          0
        );
      }
    } else {
      for (const sample of fallbackSamples) {
        if (sample.library_id !== lib.id) continue;
        const folderNorm = normalizeTreePath(sample.folder_path);
        insertRelativeFolderSegments(rootMap, rootNorm, folderNorm, 1, 0);
      }
    }

    result[lib.id] = toSortedTree(rootMap);
  }

  return result;
}

/**
 * Resolves effective root paths for a LicenseGroup across both absolute `folders`
 * and portable `rel_folders` (matched against visible libraries when drive letters move),
 * deduplicating case-insensitively.
 */
function resolveEffectiveLicenseRoots(
  group: LicenseGroup,
  visibleLibraries: Library[]
): string[] {
  const seenLower = new Set<string>();
  const roots: string[] = [];

  const addCandidate = (raw: string) => {
    const norm = normalizeTreePath(raw);
    if (!norm) return;
    const lower = norm.toLowerCase();
    if (seenLower.has(lower)) return;
    seenLower.add(lower);
    roots.push(norm);
  };

  for (const f of group.folders) {
    addCandidate(f);
  }

  if (group.rel_folders && group.rel_folders.length > 0) {
    for (const rel of group.rel_folders) {
      const cleanRel = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!cleanRel) continue;
      const relLower = cleanRel.toLowerCase();
      for (const lib of visibleLibraries) {
        const libNorm = normalizeTreePath(lib.path);
        const libBaseLower = folderNameFromPath(libNorm).toLowerCase();
        if (relLower === libBaseLower) {
          addCandidate(libNorm);
        } else if (relLower.startsWith(`${libBaseLower}/`)) {
          const sub = cleanRel.slice(libBaseLower.length + 1);
          addCandidate(`${libNorm}/${sub}`);
        }
      }
    }
  }

  return roots;
}

export function buildLicenseGroupTrees(params: {
  licenseGroups: LicenseGroup[];
  visibleLibraries: Library[];
  folderStats: FolderStat[];
  fallbackSamples: SampleItem[];
}): Record<string, { totalCount: number; nodes: FolderTreeNode[] }> {
  const { licenseGroups, visibleLibraries, folderStats, fallbackSamples } =
    params;
  const result: Record<
    string,
    { totalCount: number; nodes: FolderTreeNode[] }
  > = {};

  const visibleLibIds = new Set(visibleLibraries.map((l) => l.id));
  const visibleStats =
    folderStats.length > 0
      ? folderStats.filter((st) => visibleLibIds.has(st.library_id))
      : [];
  const hasStats = visibleStats.length > 0;

  for (const group of licenseGroups) {
    const rootMap = new Map<string, MutableNode>();
    let totalCount = 0;
    const effectiveRoots = resolveEffectiveLicenseRoots(
      group,
      visibleLibraries
    );
    const multiRoot = effectiveRoots.length > 1;

    if (hasStats) {
      const countedStatKeys = new Set<string>();

      for (const rootNorm of effectiveRoots) {
        const rootNormLower = rootNorm.toLowerCase();
        const rootBaseName = folderNameFromPath(rootNorm, rootNorm);

        for (const stat of visibleStats) {
          const folderNorm = normalizeTreePath(stat.folder_path);
          const folderNormLower = folderNorm.toLowerCase();

          if (
            folderNormLower === rootNormLower ||
            folderNormLower.startsWith(`${rootNormLower}/`)
          ) {
            const statKey = `${stat.library_id}:${folderNormLower}`;
            if (!countedStatKeys.has(statKey)) {
              countedStatKeys.add(statKey);
              totalCount += stat.count;
            }

            let currentMap = rootMap;
            let baseDepth = 0;

            if (multiRoot) {
              const rootKey = rootNormLower;
              let rootNode = currentMap.get(rootKey);
              if (!rootNode) {
                rootNode = {
                  name: rootBaseName,
                  fullPath: rootNorm,
                  count: 0,
                  depth: 1,
                  childrenMap: new Map(),
                };
                currentMap.set(rootKey, rootNode);
              }
              rootNode.count += stat.count;
              currentMap = rootNode.childrenMap;
              baseDepth = 1;
            }

            insertRelativeFolderSegments(
              currentMap,
              rootNorm,
              folderNorm,
              stat.count,
              baseDepth
            );
          }
        }
      }
    } else {
      for (const sample of fallbackSamples) {
        if (!visibleLibIds.has(sample.library_id)) continue;
        const matchedFolder = findLicenseFolderMatch(
          sample.file_path,
          group
        )?.folder;
        if (!matchedFolder) continue;
        totalCount++;

        const rootNorm = normalizeTreePath(matchedFolder);
        const rootNormLower = rootNorm.toLowerCase();
        const folderNorm = normalizeTreePath(sample.folder_path);
        const rootBaseName = folderNameFromPath(rootNorm, rootNorm);

        let currentMap = rootMap;
        let baseDepth = 0;

        if (multiRoot) {
          let rootNode = currentMap.get(rootNormLower);
          if (!rootNode) {
            rootNode = {
              name: rootBaseName,
              fullPath: rootNorm,
              count: 0,
              depth: 1,
              childrenMap: new Map(),
            };
            currentMap.set(rootNormLower, rootNode);
          }
          rootNode.count += 1;
          currentMap = rootNode.childrenMap;
          baseDepth = 1;
        }

        insertRelativeFolderSegments(
          currentMap,
          rootNorm,
          folderNorm,
          1,
          baseDepth
        );
      }
    }

    result[group.id] = {
      totalCount,
      nodes: toSortedTree(rootMap),
    };
  }

  return result;
}
