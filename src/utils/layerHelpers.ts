import type {
  LayerClipSpec,
  LayerHistoryEntry,
  LayerLaneSpec,
  LayerRecipe,
  LayerSortKey,
  SampleItem,
  SortDir,
} from "../types";

export const LAYER_DRAFT_DISPLAY_PATH = "layer://draft";
export const LAYER_DRAFT_VIRTUAL_SAMPLE_ID = -999_999;
const LAYER_HISTORY_SAMPLE_ID_OFFSET = 200_000;

export const LAYER_LANE_PALETTE = [
  "#38BDF8", // Sky
  "#A78BFA", // Violet
  "#F59E0B", // Amber
  "#10B981", // Emerald
  "#F43F5E", // Rose
  "#EC4899", // Pink
  "#14B8A6", // Teal
  "#FB923C", // Orange
] as const;

function hslToHex(hDeg: number, sPct: number, lPct: number): string {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(100, sPct)) / 100;
  const l = Math.max(0, Math.min(100, lPct)) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v * 255)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(hue2rgb(h + 1 / 3))}${toHex(hue2rgb(h))}${toHex(hue2rgb(h - 1 / 3))}`;
}

/**
 * Curated high-contrast 8-color studio palette for Lanes 1–8, seamlessly
 * extending into deterministic Golden-Angle 16M full-spectrum colors for Lanes 9–64
 * so every audio lane receives a visually distinct hex color without repetition.
 */
export function pickLaneColor(laneIndex: number): string {
  const idx = Math.max(0, Math.floor(Math.abs(laneIndex)));
  if (idx < LAYER_LANE_PALETTE.length) {
    return LAYER_LANE_PALETTE[idx];
  }
  const extra = idx - LAYER_LANE_PALETTE.length;
  // Offset from palette base hues + golden angle (137.507764deg) for maximal separation
  const hue = (27.5 + extra * 137.507764) % 360;
  const sat = 68 + (extra % 3) * 7; // 68%, 75%, 82%
  const light = 55 + ((extra >> 1) % 3) * 4; // 55%, 59%, 63%
  return hslToHex(hue, sat, light);
}

export function getNextLaneNumber(lanes: readonly LayerLaneSpec[]): number {
  const used = new Set<number>();
  for (const lane of lanes) {
    const match = lane.name.trim().match(/^lane\s+(\d+)$/i);
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export function createDefaultLane(index: number, name?: string): LayerLaneSpec {
  const num = index + 1;
  return {
    id: `lane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${num}`,
    name: name?.trim() || `Lane ${num}`,
    colorHex: pickLaneColor(index),
    volumeDb: 0,
    muted: false,
    solo: false,
  };
}

export function createSequentialLane(existingLanes: readonly LayerLaneSpec[]): LayerLaneSpec {
  const nextNum = getNextLaneNumber(existingLanes);
  return createDefaultLane(existingLanes.length, `Lane ${nextNum}`);
}

export function createEmptyLayerRecipe(): LayerRecipe {
  return {
    version: 1,
    lanes: [
      {
        id: "lane-1",
        name: "Lane 1",
        colorHex: LAYER_LANE_PALETTE[0],
        volumeDb: 0,
        muted: false,
        solo: false,
      },
      {
        id: "lane-2",
        name: "Lane 2",
        colorHex: LAYER_LANE_PALETTE[1],
        volumeDb: 0,
        muted: false,
        solo: false,
      },
    ],
    clips: [],
    masterGainDb: 0,
    snapEnabled: true,
    snapGridSec: 0.1,
  };
}

export function isLayerDraftSample(
  sample: SampleItem | null | undefined
): boolean {
  return Boolean(
    sample &&
      (sample.id === LAYER_DRAFT_VIRTUAL_SAMPLE_ID ||
        sample.file_path === LAYER_DRAFT_DISPLAY_PATH)
  );
}

export function isLayerPreviewSample(
  sample: SampleItem | null | undefined
): boolean {
  return Boolean(
    sample &&
      (isLayerDraftSample(sample) ||
        sample.id <= -LAYER_HISTORY_SAMPLE_ID_OFFSET)
  );
}

export function createLayerDraftVirtualSample(
  name: string,
  durationSec: number,
  masterPeaks: number[]
): SampleItem {
  const cleanName = name.trim() || "Untitled_Layer";
  const displayName = cleanName.toLowerCase().endsWith(".wav")
    ? cleanName
    : `${cleanName}.wav`;
  return {
    id: LAYER_DRAFT_VIRTUAL_SAMPLE_ID,
    library_id: 0,
    file_path: LAYER_DRAFT_DISPLAY_PATH,
    file_name: displayName,
    folder_path: "Layers Editor",
    extension: "wav",
    duration_ms: Math.max(0, Math.round(durationSec * 1000)),
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 0,
    is_favorite: false,
    is_loop: false,
    genre: "Layer Mix",
    artist: "",
    album: "",
    year: "",
    peaks_json: JSON.stringify(masterPeaks),
    created_at: "",
    tags: [],
  };
}

export function layerEntryToPreviewSample(entry: LayerHistoryEntry): SampleItem {
  const activePath =
    entry.is_trashed && entry.trash_file_path
      ? entry.trash_file_path
      : entry.layer_path;
  const normalized = activePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const folderPath = lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
  return {
    id: -(LAYER_HISTORY_SAMPLE_ID_OFFSET + entry.id),
    library_id: 0,
    file_path: activePath,
    file_name: entry.layer_name,
    folder_path: folderPath,
    extension: "wav",
    duration_ms: Math.max(10, entry.duration_ms || 0),
    sample_rate: entry.sample_rate || 48000,
    channels: entry.channels || 2,
    bit_depth: entry.bit_depth || 24,
    file_size: 0,
    is_favorite: entry.is_favorite,
    is_loop: false,
    genre: "Layer",
    artist: `${entry.lane_count}L · ${entry.clip_count}C`,
    album: "",
    year: "",
    peaks_json: entry.peaks_json || "[]",
    created_at: entry.updated_at || entry.created_at,
    tags: [],
    is_trashed: entry.is_trashed,
    trashed_at: entry.trashed_at ?? null,
  };
}

export function layerEntryToRenameAdapter(entry: LayerHistoryEntry): SampleItem {
  return {
    ...layerEntryToPreviewSample(entry),
    id: entry.id,
    file_path: entry.layer_path,
    file_name: entry.layer_name,
  };
}

export function parseLayerRecipeJson(raw: string): LayerRecipe | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LayerRecipe>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lanes)) {
      return null;
    }
    return {
      version: 1,
      lanes: parsed.lanes,
      clips: Array.isArray(parsed.clips) ? parsed.clips : [],
      masterGainDb:
        typeof parsed.masterGainDb === "number" && Number.isFinite(parsed.masterGainDb)
          ? parsed.masterGainDb
          : 0,
      snapEnabled: parsed.snapEnabled !== false,
      snapGridSec:
        typeof parsed.snapGridSec === "number" && Number.isFinite(parsed.snapGridSec)
          ? parsed.snapGridSec
          : 0.1,
    };
  } catch {
    return null;
  }
}

export function getVisibleSortedLayers(
  layers: LayerHistoryEntry[],
  opts: {
    searchQuery: string;
    favoriteOnly?: boolean;
    hideMissing?: boolean;
    sortKey: LayerSortKey | null;
    sortDir: SortDir;
  }
): LayerHistoryEntry[] {
  const q = opts.searchQuery.trim().toLowerCase();
  const filtered = layers.filter((item) => {
    if (opts.favoriteOnly && !item.is_favorite) return false;
    if (opts.hideMissing && !item.file_exists) return false;
    if (q) {
      const hay = `${item.layer_name} ${item.layer_path}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!opts.sortKey) return filtered;
  const dir = opts.sortDir === "desc" ? -1 : 1;
  return [...filtered].sort((a, b) => {
    switch (opts.sortKey) {
      case "fav":
        return (Number(a.is_favorite) - Number(b.is_favorite)) * dir;
      case "name":
        return (
          a.layer_name.localeCompare(b.layer_name, undefined, {
            numeric: true,
            sensitivity: "base",
          }) * dir
        );
      case "lanes":
        return (a.lane_count - b.lane_count || a.clip_count - b.clip_count) * dir;
      case "duration":
        return (a.duration_ms - b.duration_ms) * dir;
      case "updated":
        return (a.updated_at || a.created_at).localeCompare(b.updated_at || b.created_at) * dir;
      default:
        return 0;
    }
  });
}

export const MAX_LAYER_LANES = 64;
export const MAX_LAYER_CLIPS = 256;

export function makeLayerClipId(): string {
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeClipFromSample(
  sample: SampleItem,
  laneId: string,
  startSec = 0
): LayerClipSpec {
  const durSec = Math.max(0.05, (sample.duration_ms || 1000) / 1000);
  return {
    id: makeLayerClipId(),
    laneId,
    sourceSampleId: sample.id > 0 ? sample.id : null,
    sourcePath: sample.file_path,
    sourceName: sample.file_name,
    startSec: Math.max(0, startSec),
    trimStartSec: 0,
    trimEndSec: durSec,
    fadeInSec: 0,
    fadeOutSec: 0,
    gainDb: 0,
    pitchSemitones: 0,
    pitchMode: "preserve",
    reversed: false,
  };
}

export function deriveLayerDraftName(samples: SampleItem[]): string {
  const first = samples[0]?.file_name?.replace(/\.[^.]+$/, "").trim();
  if (!first) return "Untitled_Layer";
  const safe = first.replace(/[^a-zA-Z0-9 _-]+/g, "_").slice(0, 36).trim();
  return samples.length > 1 ? `${safe}_Layer` : `${safe}_Mix`;
}

export function buildNextLayerRecipeForSamples(opts: {
  prevRecipe: LayerRecipe;
  prevName: string;
  prevEditingId: number | null;
  selectedClipIds: string[];
  samples: SampleItem[];
  mode: "current" | "new" | "active-lane";
  playheadSec: number;
}): {
  nextRecipe: LayerRecipe;
  nextName: string;
  nextEditingId: number | null;
  addedClipIds: string[];
  isFresh: boolean;
} {
  const toAdd = opts.samples.slice(0, MAX_LAYER_LANES);
  const isFresh = opts.mode === "new" || opts.prevRecipe.clips.length === 0;
  const addedClipIds: string[] = [];

  if (isFresh) {
    const lanes = toAdd.map((_, idx) => createDefaultLane(idx));
    const clips = toAdd.map((s, idx) => {
      const clip = makeClipFromSample(s, lanes[idx].id, 0);
      addedClipIds.push(clip.id);
      return clip;
    });
    return {
      nextRecipe: { ...createEmptyLayerRecipe(), lanes, clips },
      nextName: deriveLayerDraftName(toAdd),
      nextEditingId: null,
      addedClipIds,
      isFresh: true,
    };
  }

  if (opts.mode === "active-lane") {
    const nextLanes =
      opts.prevRecipe.lanes.length > 0
        ? [...opts.prevRecipe.lanes]
        : [createDefaultLane(0)];
    const selId = opts.selectedClipIds[0];
    const selClip = selId
      ? opts.prevRecipe.clips.find((c) => c.id === selId)
      : null;
    const targetLaneId = selClip?.laneId ?? nextLanes[0].id;
    let cursor = Math.max(0, opts.playheadSec);
    const nextClips = [...opts.prevRecipe.clips];
    for (const s of toAdd) {
      const clip = makeClipFromSample(s, targetLaneId, cursor);
      addedClipIds.push(clip.id);
      nextClips.push(clip);
      cursor += Math.max(0.1, (s.duration_ms || 1000) / 1000);
    }
    return {
      nextRecipe: { ...opts.prevRecipe, lanes: nextLanes, clips: nextClips },
      nextName: opts.prevName,
      nextEditingId: opts.prevEditingId,
      addedClipIds,
      isFresh: false,
    };
  }

  const remaining = Math.max(0, MAX_LAYER_LANES - opts.prevRecipe.lanes.length);
  const nextLanes = [...opts.prevRecipe.lanes];
  const nextClips = [...opts.prevRecipe.clips];
  toAdd.forEach((sample, idx) => {
    let targetLaneId: string;
    if (idx < remaining) {
      const lane = createSequentialLane(nextLanes);
      nextLanes.push(lane);
      targetLaneId = lane.id;
    } else {
      targetLaneId = nextLanes[nextLanes.length - 1].id;
    }
    const clip = makeClipFromSample(sample, targetLaneId, 0);
    addedClipIds.push(clip.id);
    nextClips.push(clip);
  });
  return {
    nextRecipe: { ...opts.prevRecipe, lanes: nextLanes, clips: nextClips },
    nextName: opts.prevName,
    nextEditingId: opts.prevEditingId,
    addedClipIds,
    isFresh: false,
  };
}
