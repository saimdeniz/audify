import type {
  SampleItem,
  SliceHistoryEntry,
  SliceSortKey,
  SortDir,
} from "../types";

export function isSlicePreviewSample(
  sample: SampleItem | null | undefined
): boolean {
  return Boolean(
    sample &&
      (sample.id < 0 ||
        sample.library_id <= 0 ||
        sample.folder_path.startsWith("Slice ← "))
  );
}

export function sliceEntryToPreviewSample(entry: SliceHistoryEntry): SampleItem {
  const playbackPath =
    entry.is_trashed && entry.trash_file_path
      ? entry.trash_file_path
      : entry.slice_path;
  return {
    id: -Math.max(1, Math.abs(entry.id || 1)),
    library_id: 0,
    file_path: playbackPath,
    file_name: entry.slice_name,
    folder_path: `Slice ← ${entry.source_file_name} (${entry.start_sec.toFixed(
      2
    )}s–${entry.end_sec.toFixed(2)}s)`,
    extension: "wav",
    duration_ms: entry.duration_ms,
    sample_rate: entry.sample_rate || 48000,
    channels: entry.channels || 2,
    bit_depth: entry.bit_depth || 16,
    file_size: 0,
    is_favorite: Boolean(entry.is_favorite),
    is_loop: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    bpm: null,
    musical_key: "",
    camelot_key: "",
    peaks_json: entry.peaks_json || "[]",
    created_at: entry.created_at,
    tags: [],
  };
}

export function sliceEntryToRenameAdapter(entry: SliceHistoryEntry): SampleItem {
  return {
    ...sliceEntryToPreviewSample(entry),
    id: entry.id,
  };
}

export interface SliceFilterSortOptions {
  searchQuery: string;
  sliceHideMissing: boolean;
  sliceFavoriteOnly: boolean;
  slicePitchOnly: boolean;
  sliceSortKey: SliceSortKey | null;
  sliceSortDir: SortDir;
}

export function getVisibleSortedSlices(
  sliceHistory: readonly SliceHistoryEntry[],
  opts: SliceFilterSortOptions
): SliceHistoryEntry[] {
  const q = opts.searchQuery.trim().toLowerCase();
  const filtered = sliceHistory.filter((item) => {
    if (opts.sliceHideMissing && !item.file_exists) return false;
    if (opts.sliceFavoriteOnly && !item.is_favorite) return false;
    if (opts.slicePitchOnly && Math.abs(item.pitch_semitones) < 0.01) {
      return false;
    }
    if (!q) return true;
    return (
      item.slice_name.toLowerCase().includes(q) ||
      item.source_file_name.toLowerCase().includes(q) ||
      item.source_file_path.toLowerCase().includes(q)
    );
  });

  const { sliceSortKey, sliceSortDir } = opts;
  if (!sliceSortKey) return filtered;

  const mult = sliceSortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sliceSortKey) {
      case "fav":
        cmp = Number(b.is_favorite) - Number(a.is_favorite);
        break;
      case "name":
        cmp = a.slice_name.localeCompare(b.slice_name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        break;
      case "source":
        cmp = a.source_file_name.localeCompare(b.source_file_name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        break;
      case "duration":
        cmp = a.duration_ms - b.duration_ms;
        break;
      case "format":
        cmp =
          (a.sample_rate || 48000) - (b.sample_rate || 48000) ||
          (a.bit_depth || 16) - (b.bit_depth || 16);
        break;
      case "created":
        cmp = a.created_at.localeCompare(b.created_at) || a.id - b.id;
        break;
    }
    if (cmp !== 0) return cmp * mult;
    return b.id - a.id;
  });
}
