import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeGetItem } from "../../store/storageHelpers";
import { SampleItem } from "../../types";

export type VisibleColumnsState = {
  class: boolean;
  artist: boolean;
  album: boolean;
  year: boolean;
  genre: boolean;
  bpm: boolean;
  key: boolean;
  tags: boolean;
  time: boolean;
  format: boolean;
  dateModified: boolean;
  dateAdded: boolean;
};

// Balanced studio default for fresh installs (~1,134px — fits 1080p with zero horizontal scroll).
// Existing users' saved column visibility in localStorage is preserved untouched.
export const DEFAULT_VISIBLE_COLS: VisibleColumnsState = {
  class: true,
  artist: false,
  album: false,
  year: false,
  genre: true,
  bpm: true,
  key: true,
  tags: true,
  time: true,
  format: true,
  dateModified: false,
  dateAdded: false,
};

export const COLUMN_LAYOUT_PRESETS: readonly {
  id: "sfx" | "music" | "minimal";
  label: string;
  title: string;
  cols: VisibleColumnsState;
}[] = [
  {
    id: "sfx",
    label: "SFX Post",
    title: "Optimized for sound design & video editing (Class, Tags, Time, Format)",
    cols: {
      class: true,
      artist: false,
      album: false,
      year: false,
      genre: true,
      bpm: false,
      key: false,
      tags: true,
      time: true,
      format: true,
      dateModified: false,
      dateAdded: false,
    },
  },
  {
    id: "music",
    label: "Music / DJ",
    title: "Optimized for music & loops (BPM, Key, Genre, Tags, Time, Artist)",
    cols: {
      class: true,
      artist: true,
      album: false,
      year: false,
      genre: true,
      bpm: true,
      key: true,
      tags: true,
      time: true,
      format: false,
      dateModified: false,
      dateAdded: false,
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    title: "Compact view with zero horizontal scrolling (Name, Waveform, Tags, Time)",
    cols: {
      class: false,
      artist: false,
      album: false,
      year: false,
      genre: false,
      bpm: false,
      key: false,
      tags: true,
      time: true,
      format: false,
      dateModified: false,
      dateAdded: false,
    },
  },
];

export type ColumnId =
  | "class"
  | "name"
  | "waveform"
  | "artist"
  | "album"
  | "year"
  | "genre"
  | "bpm"
  | "key"
  | "tags"
  | "time"
  | "format"
  | "dateModified"
  | "dateAdded";

export const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  "class",
  "name",
  "waveform",
  "artist",
  "album",
  "year",
  "genre",
  "bpm",
  "key",
  "tags",
  "time",
  "format",
  "dateModified",
  "dateAdded",
];

export type ResizableColKey =
  | "name"
  | "artist"
  | "album"
  | "year"
  | "genre"
  | "tags"
  | "dateModified"
  | "dateAdded";

export const COL_WIDTH_BOUNDS: Record<
  ResizableColKey,
  { def: number; min: number; max: number }
> = {
  name: { def: 240, min: 140, max: 600 },
  artist: { def: 110, min: 70, max: 260 },
  album: { def: 110, min: 70, max: 260 },
  year: { def: 70, min: 64, max: 110 },
  genre: { def: 98, min: 74, max: 220 },
  tags: { def: 168, min: 105, max: 320 },
  dateModified: { def: 116, min: 86, max: 200 },
  dateAdded: { def: 116, min: 86, max: 200 },
};

export const DEFAULT_COL_WIDTHS: Record<ResizableColKey, number> = {
  name: COL_WIDTH_BOUNDS.name.def,
  artist: COL_WIDTH_BOUNDS.artist.def,
  album: COL_WIDTH_BOUNDS.album.def,
  year: COL_WIDTH_BOUNDS.year.def,
  genre: COL_WIDTH_BOUNDS.genre.def,
  tags: COL_WIDTH_BOUNDS.tags.def,
  dateModified: COL_WIDTH_BOUNDS.dateModified.def,
  dateAdded: COL_WIDTH_BOUNDS.dateAdded.def,
};

export const FIXED_FAV_COL_WIDTH = 34;
export const FIXED_CLASS_COL_WIDTH = 74;
export const FIXED_WAVEFORM_WIDTH = 220;
export const FIXED_MATCH_COL_WIDTH = 78;
export const FIXED_BPM_COL_WIDTH = 68;
export const FIXED_KEY_COL_WIDTH = 68;
export const FIXED_TIME_COL_WIDTH = 78;
export const FIXED_FORMAT_COL_WIDTH = 84;
export const ROW_LEFT_ACCENT_BORDER_WIDTH = 2;

export interface ContextMenuState {
  sample: SampleItem;
  targetIds: number[];
  x: number;
  y: number;
  subMenu: "collection" | "tag" | "genre" | "bpmKey" | null;
}

export interface RowPopoverPosition {
  sampleId: number;
  x: number;
  y: number;
}

export function loadValidatedVisibleCols(): VisibleColumnsState {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.visibleColumnsV2);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VisibleColumnsState>;
      if (parsed && typeof parsed === "object") {
        const result = { ...DEFAULT_VISIBLE_COLS };
        for (const k of Object.keys(
          DEFAULT_VISIBLE_COLS
        ) as (keyof VisibleColumnsState)[]) {
          if (typeof parsed[k] === "boolean") {
            result[k] = parsed[k]!;
          }
        }
        return result;
      }
    }
  } catch {
    // Ignore malformed storage
  }
  return { ...DEFAULT_VISIBLE_COLS };
}

export function loadValidatedColumnOrder(): ColumnId[] {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.columnOrderV2);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validSet = new Set<ColumnId>(DEFAULT_COLUMN_ORDER);
        const deduped: ColumnId[] = [];
        for (const item of parsed) {
          if (
            typeof item === "string" &&
            validSet.has(item as ColumnId) &&
            !deduped.includes(item as ColumnId)
          ) {
            deduped.push(item as ColumnId);
          }
        }
        const missing = DEFAULT_COLUMN_ORDER.filter(
          (c) => !deduped.includes(c)
        );
        return [...deduped, ...missing];
      }
    }
  } catch {
    // Ignore malformed storage
  }
  return [...DEFAULT_COLUMN_ORDER];
}

export function loadValidatedColWidths(): Record<ResizableColKey, number> {
  const result = { ...DEFAULT_COL_WIDTHS };
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.columnWidthsV3);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ResizableColKey, unknown>>;
      if (parsed && typeof parsed === "object") {
        for (const key of Object.keys(COL_WIDTH_BOUNDS) as ResizableColKey[]) {
          const val = Number(parsed[key]);
          const bounds = COL_WIDTH_BOUNDS[key];
          if (Number.isFinite(val)) {
            result[key] = Math.max(
              bounds.min,
              Math.min(bounds.max, Math.round(val))
            );
          }
        }
      }
    }
  } catch {
    // Ignore malformed storage
  }
  return result;
}

export function computeColumnsContentWidth(
  columnOrder: ColumnId[],
  visibleCols: VisibleColumnsState,
  colWidths: Record<ResizableColKey, number>,
  includeMatchCol = false
): number {
  let w =
    ROW_LEFT_ACCENT_BORDER_WIDTH +
    FIXED_FAV_COL_WIDTH +
    (includeMatchCol ? FIXED_MATCH_COL_WIDTH : 0);
  for (const colId of columnOrder) {
    if (colId === "class") {
      if (visibleCols.class) w += FIXED_CLASS_COL_WIDTH;
    } else if (colId === "waveform") {
      w += FIXED_WAVEFORM_WIDTH;
    } else if (colId === "time") {
      if (visibleCols.time) w += FIXED_TIME_COL_WIDTH;
    } else if (colId === "format") {
      if (visibleCols.format) w += FIXED_FORMAT_COL_WIDTH;
    } else if (colId === "name") {
      w += colWidths.name;
    } else if (colId === "artist") {
      if (visibleCols.artist) w += colWidths.artist;
    } else if (colId === "album") {
      if (visibleCols.album) w += colWidths.album;
    } else if (colId === "year") {
      if (visibleCols.year) w += colWidths.year;
    } else if (colId === "genre") {
      if (visibleCols.genre) w += colWidths.genre;
    } else if (colId === "bpm") {
      if (visibleCols.bpm) w += FIXED_BPM_COL_WIDTH;
    } else if (colId === "key") {
      if (visibleCols.key) w += FIXED_KEY_COL_WIDTH;
    } else if (colId === "tags") {
      if (visibleCols.tags) w += colWidths.tags;
    } else if (colId === "dateModified") {
      if (visibleCols.dateModified) w += colWidths.dateModified;
    } else if (colId === "dateAdded") {
      if (visibleCols.dateAdded) w += colWidths.dateAdded;
    }
  }
  return w;
}

/**
 * Computes clamped viewport coordinates for an inline row popover anchored to a clicked element.
 */
export function computeAnchoredPopoverPosition(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  popoverWidth: number,
  popoverHeight: number,
  alignRight: boolean
): { x: number; y: number } {
  const rawX = alignRight ? rect.right - popoverWidth : rect.left;
  const clampedX = Math.min(
    window.innerWidth - popoverWidth - 12,
    Math.max(12, rawX)
  );
  const clampedY =
    rect.bottom + popoverHeight + 12 > window.innerHeight
      ? Math.max(12, rect.top - popoverHeight - 4)
      : rect.bottom + 4;
  return { x: clampedX, y: clampedY };
}
