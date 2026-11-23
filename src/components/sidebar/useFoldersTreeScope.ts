import { useMemo } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import type { Library, SliceHistoryEntry } from "../../types";
import { EMPTY_SAMPLES, resolveSamplesByIds } from "../../utils/sampleLookup";
import {
  FolderTreeSampleRef,
  normalizeTreeKey,
  normalizeTreePath,
} from "./folderTreeBuilder";

export type FoldersTreeScope =
  | "library"
  | "favorites"
  | "bin"
  | "trash"
  | "slices"
  | "duplicates";

interface ResolvedScopeData {
  scope: FoldersTreeScope;
  isReadOnlyScope: boolean;
  headerTitle: string;
  emptyMessage: string;
  subsetSamples: FolderTreeSampleRef[] | null;
}

export function mapSlicesToFolderRefs(
  slices: readonly SliceHistoryEntry[],
  displayLibraries: readonly Library[]
): FolderTreeSampleRef[] {
  if (slices.length === 0 || displayLibraries.length === 0) return [];
  const sortedLibs = [...displayLibraries]
    .map((lib) => ({
      id: lib.id,
      normLower: normalizeTreeKey(lib.path),
    }))
    .sort((a, b) => b.normLower.length - a.normLower.length);

  const refs: FolderTreeSampleRef[] = [];
  for (const slice of slices) {
    if (!slice.source_file_path) continue;
    const normSource = normalizeTreePath(slice.source_file_path);
    const lastSlash = normSource.lastIndexOf("/");
    const folderPath = lastSlash > 0 ? normSource.slice(0, lastSlash) : normSource;
    const folderLower = folderPath.toLowerCase();

    for (const lib of sortedLibs) {
      if (
        folderLower === lib.normLower ||
        folderLower.startsWith(`${lib.normLower}/`)
      ) {
        refs.push({ library_id: lib.id, folder_path: folderPath });
        break;
      }
    }
  }
  return refs;
}

export function useFoldersTreeScope(
  displayLibraries: Library[],
  forcedScope?: "bin" | "trash"
): ResolvedScopeData {
  const folderStats = useSampleStore((s) => s.folderStats);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesCount = useSampleStore((s) => s.favoritesCount);
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const binSampleIds = useSampleStore((s) => s.binSampleIds);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const trashedSliceHistory = useSampleStore((s) => s.trashedSliceHistory);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const duplicateScanResult = useSampleStore((s) => s.duplicateScanResult);
  const loadedPoolLength = useSampleStore((s) => s.allProfileSamples.length);

  const trashedSamples = useSampleStore((s) => {
    if (!s.trashFilterActive && forcedScope !== "trash") return EMPTY_SAMPLES;
    return s.trashedProfileSamples.length > 0
      ? s.trashedProfileSamples
      : s.rawSamples;
  });

  const scope: FoldersTreeScope =
    forcedScope === "bin"
      ? "bin"
      : forcedScope === "trash"
      ? "trash"
      : trashFilterActive
      ? "trash"
      : binFilterActive
      ? "bin"
      : slicesFilterActive
      ? "slices"
      : duplicatesFilterActive
      ? "duplicates"
      : favoriteOnly
      ? "favorites"
      : "library";

  const favoriteSamples = useMemo(() => {
    if (
      scope !== "favorites" ||
      (favoritesCount === 0 && loadedPoolLength > 0)
    ) {
      return EMPTY_SAMPLES;
    }
    const st = useSampleStore.getState();
    const pool =
      st.allProfileSamples.length > 0 ? st.allProfileSamples : st.rawSamples;
    return folderStats.length >= 0
      ? pool.filter((item) => item.is_favorite)
      : EMPTY_SAMPLES;
  }, [scope, favoritesCount, loadedPoolLength, folderStats]);

  const binSamples = useMemo(() => {
    if (scope !== "bin" || binSampleIds.length === 0 || loadedPoolLength < 0) {
      return EMPTY_SAMPLES;
    }
    const st = useSampleStore.getState();
    const pool =
      st.allProfileSamples.length > 0 ? st.allProfileSamples : st.rawSamples;
    return folderStats.length >= 0
      ? resolveSamplesByIds(binSampleIds, pool)
      : EMPTY_SAMPLES;
  }, [scope, binSampleIds, loadedPoolLength, folderStats]);

  const duplicateSamples = useMemo((): FolderTreeSampleRef[] => {
    if (scope !== "duplicates" || !duplicateScanResult) return [];
    const seenIds = new Set<number>();
    const list: FolderTreeSampleRef[] = [];
    for (const group of duplicateScanResult.groups) {
      for (const entry of group.items) {
        if (!seenIds.has(entry.sample_id)) {
          seenIds.add(entry.sample_id);
          const normFile = entry.file_path.replace(/\\/g, "/");
          const slash = normFile.lastIndexOf("/");
          list.push({
            library_id: entry.library_id,
            folder_path: slash > 0 ? normFile.slice(0, slash) : normFile,
          });
        }
      }
    }
    return list;
  }, [scope, duplicateScanResult]);

  const sliceSourceRefs = useMemo((): FolderTreeSampleRef[] => {
    if (scope === "slices") {
      return mapSlicesToFolderRefs(sliceHistory, displayLibraries);
    }
    if (scope === "trash" && trashViewTab === "slices") {
      return mapSlicesToFolderRefs(trashedSliceHistory, displayLibraries);
    }
    return [];
  }, [scope, trashViewTab, sliceHistory, trashedSliceHistory, displayLibraries]);

  const subsetSamples = useMemo((): FolderTreeSampleRef[] | null => {
    switch (scope) {
      case "favorites":
        return favoriteSamples;
      case "bin":
        return binSamples;
      case "trash":
        return trashViewTab === "slices" ? sliceSourceRefs : trashedSamples;
      case "slices":
        return sliceSourceRefs;
      case "duplicates":
        return duplicateSamples;
      case "library":
      default:
        return null;
    }
  }, [
    scope,
    favoriteSamples,
    binSamples,
    trashViewTab,
    sliceSourceRefs,
    trashedSamples,
    duplicateSamples,
  ]);

  const itemCount = subsetSamples ? subsetSamples.length : displayLibraries.length;

  let headerTitle: string;
  let emptyMessage: string;
  switch (scope) {
    case "bin":
      headerTitle = `SESSION BIN (${itemCount.toLocaleString()})`;
      emptyMessage = "Session Bin is empty.";
      break;
    case "trash":
      headerTitle = `TRASH (${itemCount.toLocaleString()})`;
      emptyMessage =
        trashViewTab === "slices"
          ? "No trashed slices in library folders."
          : "Trash is empty.";
      break;
    case "slices":
      headerTitle = `SLICES (${itemCount.toLocaleString()})`;
      emptyMessage = "No slice source folders found.";
      break;
    case "duplicates":
      headerTitle = `DUPLICATES (${itemCount.toLocaleString()})`;
      emptyMessage = duplicateScanResult
        ? "No duplicate folders found."
        : "Run a scan to inspect duplicate folders.";
      break;
    case "favorites":
      headerTitle = `FAVORITES (${itemCount.toLocaleString()})`;
      emptyMessage = "No favorited tracks in folders.";
      break;
    case "library":
    default:
      headerTitle = `FOLDERS (${displayLibraries.length.toLocaleString()})`;
      emptyMessage = "No folders match filter.";
      break;
  }

  return {
    scope,
    isReadOnlyScope: scope !== "library",
    headerTitle,
    emptyMessage,
    subsetSamples,
  };
}
