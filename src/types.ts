import type { AiSimilarityScope, SortDir, SortKey } from "./types/aiAndSearch";
import type { TaxonomyDomain, TaxonomyFacetSlug } from "./types/profileAndSettings";

export * from "./types/aiAndSearch";
export * from "./types/profileAndSettings";
export * from "./types/fileOpsAndBackups";
export * from "./types/layers";

export interface Library {
  id: number;
  path: string;
  name: string;
  last_scanned_at: string;
  sample_count: number;
  is_global?: boolean;
  assigned_to_profile?: boolean;
  is_read_only?: boolean;
}

export interface TagFacet {
  id: number;
  slug: TaxonomyFacetSlug;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  domain?: TaxonomyDomain;
  allow_nesting?: boolean;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  sample_count: number;
  facet_id?: number;
  facet_slug?: TaxonomyFacetSlug;
  parent_id?: number | null;
  path?: string;
  aliases?: string[];
  effective_color?: string;
  color_inherited?: boolean;
  is_system?: boolean;
  sort_order?: number;
  rollup_count?: number;
}

export interface Genre {
  id: number;
  name: string;
  color: string;
  sample_count: number;
  facet_slug?: TaxonomyFacetSlug;
}

export interface Collection {
  id: number;
  profile_id?: number;
  parent_id?: number | null;
  rule_path?: string | null;
  rel_rule_path?: string | null;
  smart_query?: string | null;
  name: string;
  color: string;
  icon: string;
  created_at: string;
  sample_count: number;
}

export interface FolderStat {
  library_id: number;
  folder_path: string;
  count: number;
}

export interface ArtistStat {
  artist: string;
  count: number;
}

export interface SampleTagBadge {
  id: number;
  name: string;
  color: string;
}

export interface SampleItem {
  id: number;
  library_id: number;
  file_path: string;
  file_name: string;
  folder_path: string;
  extension: string;
  duration_ms: number;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  file_size: number;
  is_favorite: boolean;
  is_loop: boolean;
  genre: string;
  artist: string;
  album: string;
  year: string;
  bpm?: number | null;
  musical_key?: string;
  camelot_key?: string;
  peaks_json: string;
  created_at: string;
  file_modified_at?: number | null;
  tags: SampleTagBadge[];
  /** Transient compact IPC wire field hydrated into `tags` by `internSamplePool` and stripped. */
  tag_ids?: number[];
  is_trashed?: boolean;
  trashed_at?: string | null;
  original_file_path?: string | null;
  previous_file_name?: string | null;
}

export interface BpmKeyProgressPayload {
  processed: number;
  total: number;
  percentage: number;
  current_file: string;
  updated_count: number;
}

export interface BatchJobProgressPayload {
  stage_label: string;
  processed: number;
  total: number;
  percentage: number;
  current_item: string;
  matched_count: number;
  done: boolean;
}

export interface SampleBpmKeyPatch {
  sample_id: number;
  bpm: number | null;
  musical_key: string;
  camelot_key: string;
}

export interface ScanProgressPayload {
  library_path: string;
  processed: number;
  total: number;
  percentage: number;
  current_file: string;
}

export interface SliceRange {
  startSec: number;
  endSec: number;
}

export interface ExternalSimilaritySource {
  probeId: string;
  fileName: string;
  filePath?: string;
  durationMs: number;
}

export interface SimilaritySession {
  anchorSample: SampleItem;
  externalSource?: ExternalSimilaritySource;
  scoresById: ReadonlyMap<number, number>;
  minScore: number;
  topK: number;
  scope: AiSimilarityScope;
  scopeFolderPath: string | null;
  durationMatchOnly: boolean;
  elapsedMs: number;
  scannedVectors: number;
  prevSortKey: SortKey | null;
  prevSortDir: SortDir;
}

export interface AsciiMagicCategory {
  id: string;
  name: string;
  blurb: string;
}

export interface AsciiMagicCatalogPiece {
  slug: string;
  name: string;
  category: string;
  note: string;
  tags: string[];
  cols: number;
  rows: number;
  fps: number;
}

export interface AsciiMagicInstalledPiece {
  slug: string;
  name: string;
  category: string;
  note: string;
  cols: number;
  rows: number;
  fps: number;
  sha256: string;
  bytes: number;
  installed_at_unix: number;
  has_preview: boolean;
}

export interface AsciiMagicState {
  synced_at_unix: number | null;
  categories: AsciiMagicCategory[];
  catalog: AsciiMagicCatalogPiece[];
  installed: AsciiMagicInstalledPiece[];
}

export type AsciiMagicPalette = Record<string, string | null>;

export interface AsciiMagicDotsConfig {
  aspect?: number;
  soft?: boolean;
}

export interface AsciiMagicPieceMeta {
  slug: string;
  name: string;
  category: string;
  cols: number;
  rows: number;
  fps: number;
  cell: string;
  look: string;
  still: boolean;
  dots: AsciiMagicDotsConfig | null;
  palette: AsciiMagicPalette | null;
}

export interface AsciiMagicFrame {
  text: string;
  color: string | null;
  paletteOverride: AsciiMagicPalette | null;
}

export interface AsciiMagicPreviewSnapshot {
  meta: AsciiMagicPieceMeta;
  frame: AsciiMagicFrame;
}
