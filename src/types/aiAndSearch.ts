export type TypeFilter = "all" | "oneshot" | "loop";
export type SortKey =
  | "name"
  | "class"
  | "artist"
  | "album"
  | "year"
  | "genre"
  | "bpm"
  | "key"
  | "duration"
  | "sample_rate"
  | "dateModified"
  | "dateAdded"
  | "match";
export type SortDir = "asc" | "desc";
export type SampleRateFilter = null | 44100 | 48000 | 96000;

export type AiTaggingMode = "vectors_only" | "suggest" | "auto_apply";
export type AiSimilarityScope = "profile" | "folder";

export interface AiModelStatus {
  model_id: string;
  model_name: string;
  installed: boolean;
  runtime_installed: boolean;
  ready: boolean;
  model_sha256_ok: boolean;
  runtime_sha256_ok: boolean;
  is_custom_model: boolean;
  model_size_bytes: number;
  runtime_size_bytes: number;
  model_rel_path: string;
  runtime_rel_path: string;
  indexed_count: number;
  total_profile_samples: number;
  pending_suggestions_count: number;
  embedding_bytes: number;
  embedding_dim: number;
  last_avg_ms_per_clip: number;
}

export interface AiDownloadProgressPayload {
  stage: string;
  downloaded_bytes: number;
  total_bytes: number;
  percentage: number;
}

export interface AiIndexProgressPayload {
  processed: number;
  total: number;
  percentage: number;
  current_file: string;
  indexed_count: number;
  tags_suggested: number;
  avg_ms_per_clip: number;
}

export interface SimilarityMatch {
  sample_id: number;
  score: number;
}

export interface SimilaritySearchResult {
  anchor_sample_id: number;
  matches: SimilarityMatch[];
  elapsed_ms: number;
  scanned_vectors: number;
}

export interface ExternalSimilaritySearchResult {
  anchor_sample_id: number;
  probe_id: string;
  file_name: string;
  anchor_duration_ms: number;
  matches: SimilarityMatch[];
  elapsed_ms: number;
  scanned_vectors: number;
}

export interface AiTagSuggestionItem {
  sample_id: number;
  tag_name: string;
  confidence: number;
  model_id: string;
  status: string;
}

export interface AiAnalysisSummary {
  processed: number;
  indexed: number;
  suggestions_added: number;
  tags_auto_applied: number;
  canceled: boolean;
  avg_ms_per_clip: number;
}
