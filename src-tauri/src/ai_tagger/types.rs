use serde::{Deserialize, Serialize};

pub const AI_EMBEDDING_DIM: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTaggingMode {
    VectorsOnly,
    Suggest,
    AutoApply,
}

impl AiTaggingMode {
    pub fn from_str_or_default(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some("vectors_only") => Self::VectorsOnly,
            Some("auto_apply") => Self::AutoApply,
            _ => Self::Suggest,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModelStatus {
    pub model_id: String,
    pub model_name: String,
    pub installed: bool,
    pub runtime_installed: bool,
    pub ready: bool,
    pub model_sha256_ok: bool,
    pub runtime_sha256_ok: bool,
    pub is_custom_model: bool,
    pub model_size_bytes: u64,
    pub runtime_size_bytes: u64,
    pub model_rel_path: String,
    pub runtime_rel_path: String,
    pub indexed_count: usize,
    pub total_profile_samples: usize,
    pub pending_suggestions_count: usize,
    pub embedding_bytes: u64,
    pub embedding_dim: usize,
    pub last_avg_ms_per_clip: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiDownloadProgress {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiIndexProgress {
    pub processed: usize,
    pub total: usize,
    pub percentage: f64,
    pub current_file: String,
    pub indexed_count: usize,
    pub tags_suggested: usize,
    pub avg_ms_per_clip: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarityMatch {
    pub sample_id: i64,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilaritySearchResult {
    pub anchor_sample_id: i64,
    pub matches: Vec<SimilarityMatch>,
    pub elapsed_ms: f64,
    pub scanned_vectors: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTagSuggestionItem {
    pub sample_id: i64,
    pub tag_name: String,
    pub confidence: f32,
    pub model_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnalysisSummary {
    pub processed: usize,
    pub indexed: usize,
    #[serde(default)]
    pub skipped_silent: usize,
    pub suggestions_added: usize,
    pub tags_auto_applied: usize,
    pub canceled: bool,
    pub avg_ms_per_clip: f64,
}

#[derive(Debug, Clone)]
pub struct ResolvedAiModelConfig {
    pub model_id: String,
    pub model_path: std::path::PathBuf,
    pub runtime_dll_path: std::path::PathBuf,
}
