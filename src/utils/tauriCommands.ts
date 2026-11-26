import { invoke } from "@tauri-apps/api/core";
import type {
  AiAnalysisSummary,
  AiModelStatus,
  AiTaggingMode,
  AiTagSuggestionItem,
  ArtistStat,
  AutoTagImpactPreview,
  BatchRenameEntryInput,
  BatchRenameRecord,
  Collection,
  DuplicateScanMode,
  DuplicateScanResult,
  ExternalSimilaritySearchResult,
  FolderDropResult,
  ProfileQuickStats,
  PromotedSliceResult,
  SampleBpmKeyPatch,
  SimilaritySearchResult,
  SliceHistoryEntry,
  SliceRenameOutcome,
  SliceTrashSummary,
  Tag,
  TagFacet,
  TaxonomyFacetSlug,
  TrashActionSummary,
} from "../types";

export interface DroppedAudioFilePayload {
  file_name: string;
  bytes: number[];
}

export interface AudifyCommandMap {
  get_sample_peaks: {
    args: { sampleIds: number[] | null };
    result: Record<string, string>;
  };
  get_profile_quick_stats: {
    args: { sampleIds?: number[] | null };
    result: ProfileQuickStats;
  };
  toggle_favorites_batch: {
    args: { sampleIds: number[] | null; favorite: boolean };
    result: void;
  };
  set_sample_bpm_key: {
    args: {
      sampleIds: number[] | null;
      bpm?: number | null;
      clearBpm?: boolean | null;
      musicalKey?: string | null;
      clearKey?: boolean | null;
    };
    result: SampleBpmKeyPatch[];
  };
  assign_tag_batch: {
    args: { sampleIds: number[] | null; tagId: number };
    result: void;
  };
  unassign_tag_batch: {
    args: { sampleIds: number[] | null; tagId: number };
    result: void;
  };
  clear_sample_tags_batch: {
    args: {
      sampleIds: number[] | null;
      facetSlugs?: TaxonomyFacetSlug[] | null;
    };
    result: void;
  };
  get_tag_facets: {
    args: Record<string, never>;
    result: TagFacet[];
  };
  create_tag_facet: {
    args: {
      name: string;
      domain: "tags" | "genres";
      color: string;
      allowNesting: boolean;
    };
    result: TagFacet;
  };
  update_tag_facet: {
    args: {
      facetId: number;
      name?: string | null;
      color?: string | null;
      allowNesting?: boolean | null;
    };
    result: TagFacet;
  };
  delete_tag_facet: {
    args: { facetId: number };
    result: number;
  };
  reorder_tag_facets: {
    args: { orderedFacetIds: number[] };
    result: void;
  };
  reorder_taxonomy_items: {
    args: { orderedTagIds: number[] };
    result: void;
  };
  preview_auto_tag_rules_impact: {
    args: Record<string, never>;
    result: AutoTagImpactPreview;
  };
  undo_last_auto_tag_apply: {
    args: Record<string, never>;
    result: number;
  };
  reparent_collection: {
    args: {
      collectionId: number;
      newParentId: number | null;
    };
    result: Collection;
  };
  update_tag_taxonomy: {
    args: {
      tagId: number;
      facetSlug?: TaxonomyFacetSlug | null;
      parentId?: number | null;
      clearParent?: boolean | null;
      colorInherited?: boolean | null;
      aliases?: string[] | null;
      sortOrder?: number | null;
    };
    result: Tag;
  };
  merge_tags: {
    args: {
      sourceTagId: number;
      targetTagId: number;
      addSourceAsAlias?: boolean | null;
    };
    result: Tag;
  };
  harmonize_taxonomy_colors: {
    args: {
      facetSlug?: string | null;
      parentTagId?: number | null;
    };
    result: number;
  };
  assign_sample_genre_batch: {
    args: { sampleIds: number[] | null; genreName: string };
    result: string;
  };
  add_samples_to_collection_batch: {
    args: { collectionId: number; sampleIds: number[] | null };
    result: Collection;
  };
  remove_samples_from_collection: {
    args: { collectionId: number; sampleIds: number[] | null };
    result: Collection;
  };
  move_samples_to_trash: {
    args: { sampleIds: number[] | null };
    result: TrashActionSummary;
  };
  move_samples_to_folder: {
    args: {
      sampleIds: number[] | null;
      targetLibraryId: number;
      targetFolderPath: string;
      conflictPolicy?: string | null;
    };
    result: FolderDropResult;
  };
  stage_dropped_audio_files: {
    args: { files: DroppedAudioFilePayload[] };
    result: string[];
  };
  batch_rename_samples: {
    args: { entries: BatchRenameEntryInput[] };
    result: BatchRenameRecord[];
  };
  get_artist_stats: {
    args: Record<string, never>;
    result: ArtistStat[];
  };
  preview_license_group_samples: {
    args: {
      folders: string[];
      relFolders?: string[];
      artists?: string[];
      limit?: number;
    };
    result: string[];
  };
  count_license_group_matches: {
    args: {
      groups: Array<{
        id: string;
        folders: string[];
        rel_folders?: string[];
        artists?: string[];
      }>;
    };
    result: Record<string, number>;
  };
  get_ai_model_status: {
    args: Record<string, never>;
    result: AiModelStatus;
  };
  verify_ai_model_integrity: {
    args: Record<string, never>;
    result: AiModelStatus;
  };
  download_ai_model: {
    args: Record<string, never>;
    result: AiModelStatus;
  };
  cancel_ai_download: {
    args: Record<string, never>;
    result: void;
  };
  import_ai_model_file: {
    args: { sourcePath: string; kind: "onnx" | "runtime_dll" };
    result: AiModelStatus;
  };
  remove_ai_model: {
    args: { includeRuntime?: boolean; clearAiData?: boolean };
    result: AiModelStatus;
  };
  analyze_samples_ai: {
    args: {
      sampleIds?: number[] | null;
      confidenceThreshold?: number;
      autoApply?: boolean;
      taggingMode?: AiTaggingMode;
      reanalyzeExisting?: boolean;
      knnLearning?: boolean;
    };
    result: AiAnalysisSummary;
  };
  suggest_knn_ai_tags: {
    args: {
      sampleIds?: number[] | null;
      confidenceThreshold?: number;
      taggingMode?: AiTaggingMode;
    };
    result: AiAnalysisSummary;
  };
  cancel_ai_analysis: {
    args: Record<string, never>;
    result: void;
  };
  find_similar_samples: {
    args: {
      sampleId: number;
      minScore?: number;
      topK?: number;
      scopeFolderPath?: string | null;
      matchSimilarDuration?: boolean;
    };
    result: SimilaritySearchResult;
  };
  find_similar_samples_by_external_audio: {
    args: {
      probeId?: string | null;
      filePath?: string | null;
      fileName?: string | null;
      bytes?: number[] | null;
      minScore?: number;
      topK?: number;
      scopeFolderPath?: string | null;
      matchSimilarDuration?: boolean;
    };
    result: ExternalSimilaritySearchResult;
  };
  get_ai_tag_suggestions: {
    args: { status?: string; sampleIds?: number[] | null };
    result: AiTagSuggestionItem[];
  };
  resolve_ai_tag_suggestion: {
    args: { sampleId: number; tagName: string; approve: boolean };
    result: void;
  };
  approve_all_ai_tag_suggestions: {
    args: { sampleIds?: number[] | null };
    result: number;
  };
  dismiss_all_ai_tag_suggestions: {
    args: { sampleIds?: number[] | null };
    result: number;
  };
  scan_duplicate_samples: {
    args: { mode?: DuplicateScanMode; libraryId?: number | null };
    result: DuplicateScanResult;
  };
  promote_slice_to_export: {
    args: {
      filePath: string;
      startSec: number;
      endSec: number;
      customDir?: string | null;
      cachedSlicePath?: string | null;
      pitchSemitones?: number | null;
      applyMicroFade?: boolean | null;
      customName?: string | null;
      exportPreset?: string | null;
      exportLoudnessMode?: string | null;
    };
    result: PromotedSliceResult;
  };
  cleanup_unrecorded_slice_file: {
    args: { slicePath: string };
    result: void;
  };
  record_slice_export: {
    args: {
      slicePath: string;
      sourceSampleId?: number | null;
      sourceFilePath: string;
      startSec: number;
      endSec: number;
      pitchSemitones?: number | null;
      applyMicroFade?: boolean | null;
    };
    result: SliceHistoryEntry;
  };
  save_slice_to_export: {
    args: {
      filePath: string;
      sourceSampleId?: number | null;
      startSec: number;
      endSec: number;
      customDir?: string | null;
      cachedSlicePath?: string | null;
      pitchSemitones?: number | null;
      applyMicroFade?: boolean | null;
      customName?: string | null;
      exportPreset?: string | null;
      exportLoudnessMode?: string | null;
    };
    result: SliceHistoryEntry;
  };
  list_slice_history: {
    args: Record<string, never>;
    result: SliceHistoryEntry[];
  };
  toggle_slice_favorite: {
    args: { sliceId: number };
    result: SliceHistoryEntry;
  };
  toggle_slice_favorites_batch: {
    args: { sliceIds: number[]; isFavorite: boolean };
    result: number[];
  };
  batch_rename_slices: {
    args: {
      entries: Array<{ slice_id: number; new_stem: string }>;
    };
    result: SliceRenameOutcome[];
  };
  clear_missing_slices: {
    args: Record<string, never>;
    result: number;
  };
  trash_slice_files: {
    args: { sliceIds: number[] };
    result: number[];
  };
  restore_trashed_slice_files: {
    args: { sliceIds: number[] };
    result: SliceHistoryEntry[];
  };
  get_slice_trash_status: {
    args: Record<string, never>;
    result: SliceTrashSummary;
  };
  list_trashed_slices: {
    args: Record<string, never>;
    result: SliceHistoryEntry[];
  };
  empty_trashed_slices: {
    args: { sliceIds: number[] | null };
    result: SliceTrashSummary;
  };
}

/**
 * Normalizes an array of sample IDs before sending it across IPC:
 * drops invalid/non-positive numbers and removes duplicates while keeping order.
 */
export function normalizeSampleIds(
  ids: readonly number[] | null | undefined
): number[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const id of ids) {
    if (Number.isSafeInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  return normalized;
}

/**
 * Type-safe Tauri command wrapper for Audify IPC commands.
 * Automatically sanitizes `sampleIds` arrays when provided.
 */
export async function invokeCommand<K extends keyof AudifyCommandMap>(
  command: K,
  args: AudifyCommandMap[K]["args"]
): Promise<AudifyCommandMap[K]["result"]> {
  const payload =
    args &&
    typeof args === "object" &&
    "sampleIds" in args &&
    Array.isArray((args as { sampleIds?: number[] | null }).sampleIds)
      ? {
          ...args,
          sampleIds: normalizeSampleIds(
            (args as { sampleIds: number[] }).sampleIds
          ),
        }
      : args;

  return invoke<AudifyCommandMap[K]["result"]>(
    command,
    payload as Record<string, unknown>
  );
}
