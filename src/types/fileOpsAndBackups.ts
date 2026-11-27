import type { Profile } from "./profileAndSettings";

export interface FileOpJournalEntry {
  id: number;
  sample_id: number;
  op_type: string;
  old_path: string;
  new_path: string;
  old_name: string;
  new_name: string;
  created_at: string;
  can_undo: boolean;
}

export interface TrashStatusInfo {
  trashed_count: number;
  total_bytes: number;
  journal_entries: FileOpJournalEntry[];
}

export interface TrashActionSummary {
  affected_count: number;
  affected_ids: number[];
  trashed_count: number;
  total_bytes: number;
}

export interface TrashOpStatus {
  kind: "moving" | "restoring" | "emptying";
  count: number;
}

export interface SubfolderRenameSummary {
  old_folder_path: string;
  new_folder_path: string;
  new_folder_name: string;
  updated_sample_count: number;
}

export interface FileCollisionItem {
  source_path: string;
  sample_id?: number | null;
  file_name: string;
  suggested_new_name: string;
  source_size: number;
  existing_size: number;
  target_folder: string;
}

export interface MovedSampleRecord {
  sample_id: number;
  old_library_id: number;
  new_library_id: number;
  old_path: string;
  new_path: string;
  old_name: string;
  new_name: string;
}

export interface BatchRenameEntryInput {
  sample_id: number;
  new_stem: string;
}

export interface BatchRenameRecord {
  sample_id: number;
  library_id: number;
  old_path: string;
  new_path: string;
  old_name: string;
  new_name: string;
}

export interface SampleRelocateEntry {
  sample_id: number;
  target_library_id: number;
  target_path: string;
  target_name: string;
}

export interface FolderDropResult {
  status: "ok" | "conflict";
  target_library_id: number;
  target_folder_path: string;
  moved_records: MovedSampleRecord[];
  imported_sample_ids: number[];
  conflicts: FileCollisionItem[];
  skipped_duplicates: string[];
  skipped_same_folder: number;
  skipped_unsupported: number;
  skipped_conflicts: number;
}

export interface ImportReport {
  matched: number;
  unmatched: number;
  ambiguous: number;
  unmatched_samples: string[];
}

export interface BackupFileInfo {
  file_name: string;
  file_path: string;
  profile_name: string;
  created_at: string;
  timestamp_ms: number;
  file_size: number;
  is_auto: boolean;
  kind?: "profile" | "snapshot";
  sample_count?: number;
  includes_ai_tags?: boolean;
}

export interface FullSnapshotManifest {
  format: string;
  schema_version: number;
  app_version: string;
  created_at: string;
  active_profile_name: string;
  profile_count: number;
  sample_count: number;
  image_count: number;
}

export interface FullSnapshotRestoreResult {
  active_profile: Profile;
  profile_count: number;
  sample_count: number;
  tag_count: number;
  collection_count: number;
  restored_images: number;
}

export interface PendingSnapshotRestore {
  filePath: string;
  manifest: FullSnapshotManifest;
}

export type DuplicateScanMode = "exact" | "similar";

export interface DuplicateSampleEntry {
  sample_id: number;
  library_id: number;
  library_name: string;
  library_read_only: boolean;
  file_path: string;
  file_name: string;
  extension: string;
  duration_ms: number;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  file_size: number;
  is_favorite: boolean;
  tag_count: number;
  collection_count: number;
  keep_suggested: boolean;
}

export interface DuplicateGroup {
  group_id: string;
  match_kind: string;
  similarity_pct: number;
  file_size: number;
  reclaimable_bytes: number;
  items: DuplicateSampleEntry[];
}

export interface DuplicateScanResult {
  mode: DuplicateScanMode;
  scanned_samples: number;
  groups_found: number;
  duplicate_files_count: number;
  reclaimable_bytes: number;
  elapsed_ms: number;
  groups: DuplicateGroup[];
}

export interface DuplicateScanProgressPayload {
  mode: DuplicateScanMode;
  stage: string;
  stage_label: string;
  processed: number;
  total: number;
  percentage: number;
  current_file: string;
}

export interface SliceHistoryEntry {
  id: number;
  slice_path: string;
  slice_name: string;
  source_sample_id: number | null;
  source_file_path: string;
  source_file_name: string;
  start_sec: number;
  end_sec: number;
  pitch_semitones: number;
  micro_fade: boolean;
  duration_ms: number;
  is_favorite: boolean;
  peaks_json: string;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  created_at: string;
  file_exists: boolean;
  is_trashed?: boolean;
  trash_file_path?: string | null;
  trashed_at?: string | null;
}

export interface SliceTrashSummary {
  affected_count: number;
  affected_ids: number[];
  trashed_count: number;
  total_bytes: number;
}

export type TrashViewTab = "tracks" | "slices" | "layers";

export interface SliceRenameOutcome {
  old_record: SliceHistoryEntry;
  updated_record: SliceHistoryEntry;
}

export type SliceSortKey =
  | "fav"
  | "name"
  | "source"
  | "duration"
  | "format"
  | "created";

export type SliceOpHistoryItem =
  | {
      kind: "rename";
      entries: Array<{
        slice_id: number;
        old_stem: string;
        new_stem: string;
      }>;
      summary: string;
    }
  | {
      kind: "trash";
      slice_ids: number[];
      slice_names: string[];
      summary: string;
    }
  | {
      kind: "restore";
      slice_ids: number[];
      slice_names: string[];
      summary: string;
    };

export interface PromotedSliceResult {
  slice_path: string;
  slice_name: string;
  newly_created: boolean;
}
