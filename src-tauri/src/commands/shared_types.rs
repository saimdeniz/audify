use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub settings_json: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub last_scanned_at: String,
    pub sample_count: i64,
    pub is_global: bool,
    pub assigned_to_profile: bool,
    #[serde(default)]
    pub is_read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleTagBadge {
    pub id: i64,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleItem {
    pub id: i64,
    pub library_id: i64,
    pub file_path: String,
    pub file_name: String,
    pub folder_path: String,
    pub extension: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub bit_depth: i64,
    pub file_size: i64,
    pub is_favorite: bool,
    pub is_loop: bool,
    pub genre: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub bpm: Option<f64>,
    pub musical_key: String,
    pub camelot_key: String,
    pub peaks_json: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<SampleTagBadge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tag_ids: Vec<i64>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_modified_at: Option<i64>,
    #[serde(default)]
    pub is_trashed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trashed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BpmKeyProgressPayload {
    pub processed: usize,
    pub total: usize,
    pub percentage: f64,
    pub current_file: String,
    pub updated_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchJobProgressPayload {
    pub stage_label: String,
    pub processed: usize,
    pub total: usize,
    pub percentage: f64,
    pub current_item: String,
    pub matched_count: usize,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleBpmKeyPatch {
    pub sample_id: i64,
    pub bpm: Option<f64>,
    pub musical_key: String,
    pub camelot_key: String,
}

fn default_facet_id() -> i64 {
    1
}

fn default_facet_slug() -> String {
    "category".to_string()
}

fn default_genre_facet_slug() -> String {
    "genre".to_string()
}

fn default_tag_path() -> String {
    "/".to_string()
}

fn default_facet_domain() -> String {
    "tags".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagFacet {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub is_system: bool,
    #[serde(default = "default_facet_domain")]
    pub domain: String,
    #[serde(default)]
    pub allow_nesting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sample_count: i64,
    #[serde(default = "default_facet_id")]
    pub facet_id: i64,
    #[serde(default = "default_facet_slug")]
    pub facet_slug: String,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default = "default_tag_path")]
    pub path: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub effective_color: String,
    #[serde(default)]
    pub color_inherited: bool,
    #[serde(default)]
    pub is_system: bool,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub rollup_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Genre {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sample_count: i64,
    #[serde(default = "default_genre_facet_slug")]
    pub facet_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub profile_id: i64,
    pub parent_id: Option<i64>,
    pub rule_path: Option<String>,
    pub smart_query: Option<String>,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub created_at: String,
    pub sample_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupFileInfo {
    pub file_name: String,
    pub file_path: String,
    pub profile_name: String,
    pub created_at: String,
    pub timestamp_ms: i64,
    pub file_size: i64,
    pub is_auto: bool,
    #[serde(default = "default_backup_kind")]
    pub kind: String,
    #[serde(default)]
    pub sample_count: i64,
    #[serde(default)]
    pub includes_ai_tags: bool,
}

fn default_backup_kind() -> String {
    "profile".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSnapshotManifest {
    pub format: String,
    pub schema_version: i64,
    pub app_version: String,
    pub created_at: String,
    pub active_profile_name: String,
    pub profile_count: i64,
    pub sample_count: i64,
    #[serde(default)]
    pub image_count: usize,
    #[serde(default)]
    pub slice_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSnapshotRestoreResult {
    pub active_profile: Profile,
    pub profile_count: i64,
    pub sample_count: i64,
    pub tag_count: i64,
    pub collection_count: i64,
    pub restored_images: usize,
    #[serde(default)]
    pub restored_slices: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderStat {
    pub library_id: i64,
    pub folder_path: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileQuickStats {
    pub favorites_count: i64,
    pub existing_sample_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedLibraryEntry {
    pub path: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub is_global: bool,
    #[serde(default)]
    pub is_read_only: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExportedFacetEntry {
    pub slug: String,
    pub name: String,
    pub color: String,
    #[serde(default = "default_facet_domain")]
    pub domain: String,
    #[serde(default)]
    pub allow_nesting: bool,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExportedTagEntry {
    pub name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facet_slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub color_inherited: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedGenreEntry {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedManualLoopEntry {
    pub is_loop: bool,
    pub sample: ResilientSampleRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedManualLoopIndexEntry {
    pub is_loop: bool,
    pub sample_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedManualMetaIndexEntry {
    pub sample_index: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    #[serde(default)]
    pub musical_key: String,
    #[serde(default)]
    pub camelot_key: String,
    #[serde(default)]
    pub bpm_is_manual: bool,
    #[serde(default)]
    pub key_is_manual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedSliceEntry {
    pub slice_path: String,
    pub slice_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sample_index: Option<usize>,
    pub source_file_path: String,
    pub source_file_name: String,
    pub start_sec: f64,
    pub end_sec: f64,
    #[serde(default)]
    pub pitch_semitones: f64,
    #[serde(default = "default_true")]
    pub micro_fade: bool,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(default = "default_sample_rate")]
    pub sample_rate: i64,
    #[serde(default = "default_channels")]
    pub channels: i64,
    #[serde(default = "default_bit_depth")]
    pub bit_depth: i64,
    #[serde(default)]
    pub created_at: String,
}

fn default_sample_rate() -> i64 {
    48000
}

fn default_channels() -> i64 {
    2
}

fn default_bit_depth() -> i64 {
    16
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResilientSampleRef {
    pub file_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExportedCollectionEntry {
    pub name: String,
    pub color: String,
    pub icon: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel_rule_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smart_query: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sample_file_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<ResilientSampleRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sample_indices: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedSampleTagMap {
    pub file_path: String,
    pub tag_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_ref: Option<ResilientSampleRef>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileExportPackage {
    pub format: String,
    #[serde(default = "default_version")]
    pub version: u32,
    pub name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub includes_ai_tags: bool,
    pub settings: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub libraries: Vec<ExportedLibraryEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub facets: Vec<ExportedFacetEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<ExportedTagEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<ExportedGenreEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<ExportedCollectionEntry>,
    // Compact v3 deduplicated sample table + index maps:
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sample_refs: Vec<ResilientSampleRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub favorite_ref_indices: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bin_sample_indices: Vec<usize>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub manual_tag_ref_indices: HashMap<String, Vec<usize>>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub ai_approved_tag_ref_indices: HashMap<String, Vec<usize>>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub manual_genre_ref_indices: HashMap<String, Vec<usize>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manual_loop_ref_indices: Vec<ExportedManualLoopIndexEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manual_bpm_key_ref_indices: Vec<ExportedManualMetaIndexEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slices: Vec<ExportedSliceEntry>,
    // Legacy v1/v2 fields preserved for backward-compatible JSON import:
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub favorite_sample_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub favorite_samples: Vec<ResilientSampleRef>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub manual_tag_assignments: HashMap<String, Vec<String>>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub manual_tag_samples: HashMap<String, Vec<ResilientSampleRef>>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub manual_genre_assignments: HashMap<String, Vec<ResilientSampleRef>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manual_loops: Vec<ExportedManualLoopEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sample_tags: Vec<ExportedSampleTagMap>,
}

fn default_version() -> u32 {
    2
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportReport {
    pub matched: usize,
    pub unmatched: usize,
    pub ambiguous: usize,
    pub unmatched_samples: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportProfileResult {
    #[serde(flatten)]
    pub profile: Profile,
    pub report: ImportReport,
}

#[derive(Debug, Serialize)]
pub struct AutoTagPreviewResult {
    pub match_count: usize,
    pub sample_names: Vec<String>,
}
