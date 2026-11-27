export type LayerTopDeckView = "sum" | "lanes";
export type FavoritesViewTab = "tracks" | "slices" | "layers";
export type LayersWorkspaceTab = "saved" | "editor";

export type LayerSortKey = "fav" | "name" | "lanes" | "duration" | "updated";
export type LayerPitchMode = "preserve" | "varispeed";

export interface LayerLaneSpec {
  id: string;
  name: string;
  colorHex: string;
  volumeDb: number;
  muted: boolean;
  solo: boolean;
}

export interface LayerClipSpec {
  id: string;
  laneId: string;
  sourceSampleId: number | null;
  sourcePath: string;
  sourceName: string;
  startSec: number;
  trimStartSec: number;
  trimEndSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  gainDb: number;
  pitchSemitones: number;
  pitchMode?: LayerPitchMode;
  reversed: boolean;
}

export interface LayerRecipe {
  version: 1;
  lanes: LayerLaneSpec[];
  clips: LayerClipSpec[];
  masterGainDb: number;
  snapEnabled: boolean;
  snapGridSec: number;
}

export interface LanePeaksPreview {
  laneId: string;
  colorHex: string;
  muted: boolean;
  solo: boolean;
  peaks: number[];
}

export interface LayerPreviewState {
  durationSec: number;
  masterPeaks: number[];
  lanePeaks: LanePeaksPreview[];
  peakDb: number;
  clipped: boolean;
}

export interface LayerPreviewResult extends LayerPreviewState {
  audioSync: {
    seq: number;
    event: string;
    filePath: string;
    isPlaying: boolean;
    positionSec: number;
    durationSec: number;
    playbackRate: number;
    activeDeviceId: string;
    activeDeviceName: string;
    outputLatencyMs: number;
    error: string | null;
  };
}

export interface LayerHistoryEntry {
  id: number;
  layer_path: string;
  layer_name: string;
  recipe_json: string;
  lane_count: number;
  clip_count: number;
  duration_ms: number;
  is_favorite: boolean;
  peaks_json: string;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  created_at: string;
  updated_at: string;
  file_exists: boolean;
  is_trashed?: boolean;
  trash_file_path?: string | null;
  trashed_at?: string | null;
}

export interface LayerTrashSummary {
  affected_count: number;
  affected_ids: number[];
  trashed_count: number;
  total_bytes: number;
}

export interface PreparedLayerDragResult {
  wavPath: string;
  savedRecord: LayerHistoryEntry | null;
}
