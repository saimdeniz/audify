pub mod catalog;
mod js_scope;
pub mod sandbox_protocol;
pub mod security;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const ASCII_MAGIC_INDEX_URL: &str = "https://www.ascii-magic.com/ascii/index.json";
pub const ASCII_MAGIC_PIECE_BASE_URL: &str = "https://www.ascii-magic.com/ascii/pieces";
pub const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_PIECE_BYTES: u64 = 512 * 1024;
pub const MAX_PREVIEW_BYTES: usize = 384 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogCategory {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub blurb: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogPiece {
    pub slug: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_cols")]
    pub cols: u32,
    #[serde(default = "default_rows")]
    pub rows: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
}

fn default_cols() -> u32 {
    120
}
fn default_rows() -> u32 {
    40
}
fn default_fps() -> u32 {
    15
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogIndexFile {
    pub count: usize,
    #[serde(default)]
    pub categories: Vec<CatalogCategory>,
    #[serde(default)]
    pub pieces: Vec<CatalogPiece>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPieceRecord {
    pub slug: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub note: String,
    pub cols: u32,
    pub rows: u32,
    pub fps: u32,
    pub sha256: String,
    pub bytes: u64,
    pub installed_at_unix: u64,
    #[serde(default)]
    pub has_preview: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsciiMagicState {
    pub synced_at_unix: Option<u64>,
    pub categories: Vec<CatalogCategory>,
    pub catalog: Vec<CatalogPiece>,
    pub installed: Vec<InstalledPieceRecord>,
}

pub fn ascii_magic_root_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("ascii_magic")
}

pub fn ascii_magic_pieces_dir(user_dir: &Path) -> PathBuf {
    ascii_magic_root_dir(user_dir).join("pieces")
}

pub fn ascii_magic_previews_dir(user_dir: &Path) -> PathBuf {
    ascii_magic_root_dir(user_dir).join("previews")
}
