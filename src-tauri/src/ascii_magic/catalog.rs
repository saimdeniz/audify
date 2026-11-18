use super::security::{is_valid_slug, normalize_slug_or_url, validate_piece_source_js};
use super::{
    ascii_magic_pieces_dir, ascii_magic_previews_dir, ascii_magic_root_dir, AsciiMagicState,
    CatalogIndexFile, InstalledPieceRecord, ASCII_MAGIC_INDEX_URL, ASCII_MAGIC_PIECE_BASE_URL,
    MAX_CATALOG_BYTES, MAX_PIECE_BYTES, MAX_PREVIEW_BYTES,
};
use crate::ai_tagger::model_download::build_http_agent;
use crate::security::{ensure_inside, sanitize_err};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_INSTALLED_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
static INSTALLED_MANIFEST_LOCK: Mutex<()> = Mutex::new(());
static TMP_FILE_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CachedCatalogEnvelope {
    synced_at_unix: u64,
    catalog: CatalogIndexFile,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct InstalledManifest {
    pieces: Vec<InstalledPieceRecord>,
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn ensure_dirs(user_dir: &Path) -> Result<(), String> {
    for dir in [
        ascii_magic_root_dir(user_dir),
        ascii_magic_pieces_dir(user_dir),
        ascii_magic_previews_dir(user_dir),
    ] {
        fs::create_dir_all(&dir)
            .map_err(|e| sanitize_err(user_dir, &format!("Failed creating cache directory: {}", e)))?;
    }
    Ok(())
}

fn lock_installed_manifest() -> std::sync::MutexGuard<'static, ()> {
    INSTALLED_MANIFEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn unique_tmp_path(dest: &Path) -> Result<std::path::PathBuf, String> {
    let parent = dest
        .parent()
        .ok_or_else(|| "Destination path lacks parent directory".to_string())?;
    let stem = dest
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("staging");
    let seq = TMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!("{}.tmp.{}.{}", stem, std::process::id(), seq)))
}

fn write_atomic_bytes(user_dir: &Path, dest: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = unique_tmp_path(dest)?;
    let write_res = (|| -> Result<(), String> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| sanitize_err(user_dir, &format!("Failed creating staging file: {}", e)))?;
        f.write_all(bytes)
            .map_err(|e| sanitize_err(user_dir, &format!("Failed writing file: {}", e)))?;
        f.sync_all()
            .map_err(|e| sanitize_err(user_dir, &format!("Failed syncing file: {}", e)))?;
        Ok(())
    })();
    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp);
        return Err(err);
    }
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        sanitize_err(user_dir, &format!("Failed committing cache file: {}", e))
    })
}

fn download_bounded_bytes(url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let agent = build_http_agent();
    let mut response = agent
        .get(url)
        .call()
        .map_err(|e| format!("Network request failed: {}", e))?;

    let mut reader = response.body_mut().as_reader();
    let mut out = Vec::new();
    let mut buf = [0u8; 16_384];

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download read error: {}", e))?;
        if n == 0 {
            break;
        }
        if (out.len() as u64).saturating_add(n as u64) > max_bytes {
            return Err("Remote file exceeds maximum allowed size".to_string());
        }
        out.extend_from_slice(&buf[..n]);
    }

    Ok(out)
}

fn read_installed_manifest_unlocked(user_dir: &Path) -> InstalledManifest {
    let path = ascii_magic_root_dir(user_dir).join("installed.json");
    let Ok(meta) = fs::symlink_metadata(&path) else {
        return InstalledManifest::default();
    };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_INSTALLED_MANIFEST_BYTES
    {
        return InstalledManifest::default();
    }
    let Ok(file) = File::open(&path) else {
        return InstalledManifest::default();
    };
    let mut text = String::new();
    if file
        .take(MAX_INSTALLED_MANIFEST_BYTES + 1)
        .read_to_string(&mut text)
        .is_err()
    {
        return InstalledManifest::default();
    }
    if text.len() as u64 > MAX_INSTALLED_MANIFEST_BYTES {
        return InstalledManifest::default();
    }
    serde_json::from_str::<InstalledManifest>(&text).unwrap_or_default()
}

fn read_installed_manifest(user_dir: &Path) -> InstalledManifest {
    let _guard = lock_installed_manifest();
    read_installed_manifest_unlocked(user_dir)
}

fn write_installed_manifest_unlocked(
    user_dir: &Path,
    manifest: &InstalledManifest,
) -> Result<(), String> {
    let path = ascii_magic_root_dir(user_dir).join("installed.json");
    let data = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Failed serializing installed manifest: {}", e))?;
    write_atomic_bytes(user_dir, &path, &data)
}

#[cfg(test)]
fn write_installed_manifest(user_dir: &Path, manifest: &InstalledManifest) -> Result<(), String> {
    let _guard = lock_installed_manifest();
    write_installed_manifest_unlocked(user_dir, manifest)
}

fn read_cached_catalog(user_dir: &Path) -> Option<CachedCatalogEnvelope> {
    let path = ascii_magic_root_dir(user_dir).join("index.json");
    let meta = fs::symlink_metadata(&path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_CATALOG_BYTES {
        return None;
    }
    let text = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<CachedCatalogEnvelope>(&text).ok()
}

/// Fetches the official 734-piece catalog index from https://www.ascii-magic.com/ascii/index.json
/// and persists it locally inside `ascii_magic/index.json`.
pub fn sync_catalog_to_dir(user_dir: &Path) -> Result<AsciiMagicState, String> {
    ensure_dirs(user_dir)?;
    let bytes = download_bounded_bytes(ASCII_MAGIC_INDEX_URL, MAX_CATALOG_BYTES)?;
    let mut parsed: CatalogIndexFile =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid catalog JSON: {}", e))?;

    parsed.pieces.retain(|p| is_valid_slug(&p.slug));
    let envelope = CachedCatalogEnvelope {
        synced_at_unix: unix_now(),
        catalog: parsed,
    };
    let encoded = serde_json::to_vec(&envelope)
        .map_err(|e| format!("Failed encoding catalog cache: {}", e))?;
    let dest = ascii_magic_root_dir(user_dir).join("index.json");
    write_atomic_bytes(user_dir, &dest, &encoded)?;

    read_state_from_dir(user_dir)
}

/// Reads cached catalog metadata and locally installed pieces (synchronizes preview flags).
pub fn read_state_from_dir(user_dir: &Path) -> Result<AsciiMagicState, String> {
    ensure_dirs(user_dir)?;
    let pieces_dir = ascii_magic_pieces_dir(user_dir);
    let previews_dir = ascii_magic_previews_dir(user_dir);
    let mut manifest = {
        let _guard = lock_installed_manifest();
        read_installed_manifest_unlocked(user_dir)
    };

    manifest.pieces.retain(|rec| {
        if !is_valid_slug(&rec.slug) {
            return false;
        }
        let file = pieces_dir.join(format!("{}.js", rec.slug));
        fs::symlink_metadata(&file)
            .map(|m| !m.file_type().is_symlink() && m.is_file())
            .unwrap_or(false)
    });

    for rec in &mut manifest.pieces {
        let preview_file = previews_dir.join(format!("{}.preview.json", rec.slug));
        rec.has_preview = fs::symlink_metadata(&preview_file)
            .map(|m| !m.file_type().is_symlink() && m.is_file())
            .unwrap_or(false);
    }

    let cached = read_cached_catalog(user_dir);
    let (synced_at_unix, categories, catalog) = match cached {
        Some(env) => (
            Some(env.synced_at_unix),
            env.catalog.categories,
            env.catalog.pieces,
        ),
        None => (None, Vec::new(), Vec::new()),
    };

    Ok(AsciiMagicState {
        synced_at_unix,
        categories,
        catalog,
        installed: manifest.pieces,
    })
}

/// Downloads, statically validates, SHA-256 hashes, and atomically caches an ASCII Magic piece.
pub fn install_piece_to_dir(
    user_dir: &Path,
    slug_or_url: &str,
) -> Result<InstalledPieceRecord, String> {
    ensure_dirs(user_dir)?;
    let slug = normalize_slug_or_url(slug_or_url)?;
    let url = format!("{}/{}.js", ASCII_MAGIC_PIECE_BASE_URL, slug);
    let bytes = download_bounded_bytes(&url, MAX_PIECE_BYTES)?;
    let source = std::str::from_utf8(&bytes)
        .map_err(|_| "Downloaded piece file is not valid UTF-8".to_string())?;
    validate_piece_source_js(source)?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = hex::encode(hasher.finalize());

    let pieces_dir = ascii_magic_pieces_dir(user_dir);
    let dest = pieces_dir.join(format!("{}.js", slug));
    let cached = read_cached_catalog(user_dir);
    let catalog_hit = cached
        .as_ref()
        .and_then(|c| c.catalog.pieces.iter().find(|p| p.slug == slug));

    let record = InstalledPieceRecord {
        slug: slug.clone(),
        name: catalog_hit
            .map(|c| c.name.clone())
            .unwrap_or_else(|| title_from_slug(&slug)),
        category: catalog_hit
            .map(|c| c.category.clone())
            .unwrap_or_else(|| "custom".to_string()),
        note: catalog_hit.map(|c| c.note.clone()).unwrap_or_default(),
        cols: catalog_hit.map(|c| c.cols).unwrap_or(120),
        rows: catalog_hit.map(|c| c.rows).unwrap_or(40),
        fps: catalog_hit.map(|c| c.fps).unwrap_or(15),
        sha256,
        bytes: bytes.len() as u64,
        installed_at_unix: unix_now(),
        has_preview: false,
    };

    {
        let _guard = lock_installed_manifest();
        write_atomic_bytes(user_dir, &dest, &bytes)?;
        let mut manifest = read_installed_manifest_unlocked(user_dir);
        manifest.pieces.retain(|p| p.slug != slug);
        manifest.pieces.insert(0, record.clone());
        write_installed_manifest_unlocked(user_dir, &manifest)?;
    }

    Ok(record)
}

/// Deletes an installed piece script and its cached snapshot thumbnail.
pub fn delete_piece_from_dir(user_dir: &Path, slug_raw: &str) -> Result<(), String> {
    let slug = normalize_slug_or_url(slug_raw)?;
    let pieces_dir = ascii_magic_pieces_dir(user_dir);
    let previews_dir = ascii_magic_previews_dir(user_dir);

    let _guard = lock_installed_manifest();
    let js_path = pieces_dir.join(format!("{}.js", slug));
    if let Ok(canon) = ensure_inside(&pieces_dir, &js_path) {
        let _ = fs::remove_file(canon);
    }

    let preview_path = previews_dir.join(format!("{}.preview.json", slug));
    if let Ok(canon) = ensure_inside(&previews_dir, &preview_path) {
        let _ = fs::remove_file(canon);
    }

    let mut manifest = read_installed_manifest_unlocked(user_dir);
    manifest.pieces.retain(|p| p.slug != slug);
    write_installed_manifest_unlocked(user_dir, &manifest)?;
    Ok(())
}

/// Saves a compact 1-frame JSON snapshot rendered from the sandboxed piece for Settings thumbnails.
pub fn save_preview_to_dir(
    user_dir: &Path,
    slug_raw: &str,
    preview_json: &str,
) -> Result<(), String> {
    ensure_dirs(user_dir)?;
    let slug = normalize_slug_or_url(slug_raw)?;
    if preview_json.len() > MAX_PREVIEW_BYTES {
        return Err("Preview snapshot exceeds size limit".to_string());
    }
    let parsed: serde_json::Value = serde_json::from_str(preview_json)
        .map_err(|_| "Invalid preview snapshot JSON".to_string())?;
    if !parsed.is_object() {
        return Err("Preview snapshot must be a JSON object".to_string());
    }

    let previews_dir = ascii_magic_previews_dir(user_dir);
    let dest = previews_dir.join(format!("{}.preview.json", slug));
    write_atomic_bytes(user_dir, &dest, preview_json.as_bytes())
}

/// Reads the cached 1-frame JSON preview snapshot for a piece if available.
pub fn read_preview_from_dir(user_dir: &Path, slug_raw: &str) -> Result<Option<String>, String> {
    let slug = normalize_slug_or_url(slug_raw)?;
    let previews_dir = ascii_magic_previews_dir(user_dir);
    let target = previews_dir.join(format!("{}.preview.json", slug));
    let Ok(meta) = fs::symlink_metadata(&target) else {
        return Ok(None);
    };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() as usize > MAX_PREVIEW_BYTES {
        return Ok(None);
    }
    let canon = ensure_inside(&previews_dir, &target)
        .map_err(|e| sanitize_err(user_dir, &e))?;
    let content = fs::read_to_string(canon)
        .map_err(|e| sanitize_err(user_dir, &format!("Failed reading preview cache: {}", e)))?;
    Ok(Some(content))
}

/// Looks up the stored SHA-256 digest for an installed piece slug.
pub fn expected_piece_sha256(user_dir: &Path, slug: &str) -> Option<String> {
    read_installed_manifest(user_dir)
        .pieces
        .into_iter()
        .find(|p| p.slug == slug)
        .map(|p| p.sha256)
}

fn title_from_slug(slug: &str) -> String {
    slug.split('-')
        .filter(|s| !s.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_roundtrip_and_state_persistence_work_inside_temp_dir() {
        let dir = std::env::temp_dir().join(format!(
            "audify_ascii_magic_test_{}",
            unix_now()
        ));
        let _ = fs::remove_dir_all(&dir);
        ensure_dirs(&dir).unwrap();

        let slug = "test-scene";
        let js = r#"
          import { fbm } from "../lib/kit.js";
          export const meta = { slug: "test-scene", cols: 10, rows: 4, fps: 15 };
          export default function create() { return () => "hello"; }
        "#;
        validate_piece_source_js(js).unwrap();
        let piece_path = ascii_magic_pieces_dir(&dir).join("test-scene.js");
        write_atomic_bytes(&dir, &piece_path, js.as_bytes()).unwrap();

        let mut hasher = Sha256::new();
        hasher.update(js.as_bytes());
        let sha = hex::encode(hasher.finalize());
        write_installed_manifest(
            &dir,
            &InstalledManifest {
                pieces: vec![InstalledPieceRecord {
                    slug: slug.to_string(),
                    name: "Test Scene".to_string(),
                    category: "retro".to_string(),
                    note: String::new(),
                    cols: 10,
                    rows: 4,
                    fps: 15,
                    sha256: sha.clone(),
                    bytes: js.len() as u64,
                    installed_at_unix: 1,
                    has_preview: false,
                }],
            },
        )
        .unwrap();

        save_preview_to_dir(&dir, slug, r#"{"meta":{"cols":10},"frame":{"text":"hi","color":null}}"#).unwrap();
        let loaded_preview = read_preview_from_dir(&dir, slug).unwrap().unwrap();
        assert!(loaded_preview.contains("\"cols\":10"));

        let st = read_state_from_dir(&dir).unwrap();
        assert_eq!(st.installed.len(), 1);
        assert!(st.installed[0].has_preview);
        assert_eq!(expected_piece_sha256(&dir, slug).as_deref(), Some(sha.as_str()));

        delete_piece_from_dir(&dir, slug).unwrap();
        assert!(read_preview_from_dir(&dir, slug).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
