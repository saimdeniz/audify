use super::model_manager::{
    ensure_models_dirs, replace_file_safely, sha256_file_hex, CUSTOM_MODEL_FILE,
    DEFAULT_MODEL_BYTES, DEFAULT_MODEL_FILE, DEFAULT_MODEL_SHA256, DEFAULT_MODEL_URL,
    DEFAULT_ORT_WHL_BYTES, DEFAULT_ORT_WHL_SHA256, DEFAULT_ORT_WHL_URL, MAX_DLL_ENTRY_BYTES,
    MAX_REMOTE_DOWNLOAD_BYTES, ORT_DLL_NAME, ORT_DLL_SHA256, ORT_SHARED_DLL_NAME,
    ORT_SHARED_DLL_SHA256,
};
use super::types::AiDownloadProgress;
use crate::security::sanitize_err;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use zip::ZipArchive;

struct DownloadSpec<'a> {
    url: &'a str,
    expected_sha256: &'a str,
    expected_size: u64,
    stage: &'a str,
    progress_offset: u64,
    combined_total: u64,
}

fn is_allowlisted_url(url: &str) -> bool {
    url == DEFAULT_MODEL_URL || url == DEFAULT_ORT_WHL_URL
}

pub(crate) fn build_https_agent_with_timeout(timeout_secs: u64) -> ureq::Agent {
    let tls_config = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::NativeTls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(5)
        .tls_config(tls_config)
        .timeout_global(Some(std::time::Duration::from_secs(timeout_secs)))
        .build()
        .new_agent()
}

pub(crate) fn build_http_agent() -> ureq::Agent {
    build_https_agent_with_timeout(300)
}

fn emit_download_progress(
    app: &AppHandle,
    stage: &str,
    downloaded: u64,
    total: u64,
    offset: u64,
    combined_total: u64,
) {
    let overall_done = offset.saturating_add(downloaded);
    let pct = if combined_total > 0 {
        ((overall_done as f64 / combined_total as f64) * 100.0).min(100.0)
    } else if total > 0 {
        ((downloaded as f64 / total as f64) * 100.0).min(100.0)
    } else {
        0.0
    };
    let _ = app.emit(
        "ai-download-progress",
        AiDownloadProgress {
            stage: stage.to_string(),
            downloaded_bytes: overall_done,
            total_bytes: combined_total.max(total),
            percentage: pct,
        },
    );
}

fn download_verified_to_tmp(
    app: &AppHandle,
    user_dir: &Path,
    spec: DownloadSpec<'_>,
    tmp_path: &Path,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    if !is_allowlisted_url(spec.url) {
        return Err("Rejected non-allowlisted download URL".to_string());
    }
    let _ = fs::remove_file(tmp_path);

    let agent = build_http_agent();

    let mut response = agent
        .get(spec.url)
        .call()
        .map_err(|e| format!("Network error downloading {}: {}", spec.stage, e))?;

    let mut reader = response.body_mut().as_reader();
    let mut out = File::create(tmp_path)
        .map_err(|e| sanitize_err(user_dir, &format!("Failed creating staging file: {}", e)))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 32_768];
    let mut written: u64 = 0;
    let mut last_emit: u64 = 0;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            drop(out);
            let _ = fs::remove_file(tmp_path);
            return Err("Download canceled by user".to_string());
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download read failed: {}", e))?;
        if n == 0 {
            break;
        }
        written = written.saturating_add(n as u64);
        if written > MAX_REMOTE_DOWNLOAD_BYTES {
            drop(out);
            let _ = fs::remove_file(tmp_path);
            return Err("Download exceeded maximum allowed file size cap".to_string());
        }
        out.write_all(&buf[..n])
            .map_err(|e| sanitize_err(user_dir, &format!("Failed writing staging file: {}", e)))?;
        hasher.update(&buf[..n]);

        if written.saturating_sub(last_emit) >= 131_072 {
            last_emit = written;
            emit_download_progress(
                app,
                spec.stage,
                written,
                spec.expected_size,
                spec.progress_offset,
                spec.combined_total,
            );
        }
    }
    out.flush()
        .map_err(|e| sanitize_err(user_dir, &format!("Flush failed: {}", e)))?;
    drop(out);

    let actual_sha = hex::encode(hasher.finalize());
    if !actual_sha.eq_ignore_ascii_case(spec.expected_sha256) {
        let _ = fs::remove_file(tmp_path);
        return Err("SHA-256 verification failed; downloaded file was discarded".to_string());
    }

    emit_download_progress(
        app,
        spec.stage,
        written,
        spec.expected_size,
        spec.progress_offset,
        spec.combined_total,
    );
    Ok(())
}

fn extract_verified_ort_dlls(
    user_dir: &Path,
    whl_path: &Path,
    bin_dir: &Path,
    tmp_dir: &Path,
) -> Result<(), String> {
    let whl_file = File::open(whl_path)
        .map_err(|e| sanitize_err(user_dir, &format!("Failed opening archive: {}", e)))?;
    let mut archive =
        ZipArchive::new(whl_file).map_err(|e| format!("Invalid zip archive: {}", e))?;

    let targets = [
        (
            "onnxruntime/capi/onnxruntime.dll",
            ORT_DLL_NAME,
            ORT_DLL_SHA256,
        ),
        (
            "onnxruntime/capi/onnxruntime_providers_shared.dll",
            ORT_SHARED_DLL_NAME,
            ORT_SHARED_DLL_SHA256,
        ),
    ];

    for (entry_name, out_name, expected_hash) in targets {
        let mut entry = archive
            .by_name(entry_name)
            .map_err(|_| format!("Missing runtime binary in archive: {}", out_name))?;
        if entry.size() == 0 || entry.size() > MAX_DLL_ENTRY_BYTES {
            return Err(format!("Invalid runtime binary size: {}", out_name));
        }

        let tmp_dll = tmp_dir.join(format!("{}.tmp", out_name));
        let final_dll = bin_dir.join(out_name);
        let _ = fs::remove_file(&tmp_dll);

        let mut out = File::create(&tmp_dll)
            .map_err(|e| sanitize_err(user_dir, &format!("Failed staging DLL: {}", e)))?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 32_768];
        let mut copied: u64 = 0;

        loop {
            let n = entry
                .read(&mut buf)
                .map_err(|e| format!("Failed extracting DLL: {}", e))?;
            if n == 0 {
                break;
            }
            copied = copied.saturating_add(n as u64);
            if copied > MAX_DLL_ENTRY_BYTES {
                drop(out);
                let _ = fs::remove_file(&tmp_dll);
                return Err(format!("Extracted DLL exceeded size limit: {}", out_name));
            }
            out.write_all(&buf[..n])
                .map_err(|e| sanitize_err(user_dir, &format!("Failed writing DLL: {}", e)))?;
            hasher.update(&buf[..n]);
        }
        out.flush()
            .map_err(|e| sanitize_err(user_dir, &format!("Flush DLL failed: {}", e)))?;
        drop(out);

        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected_hash) {
            let _ = fs::remove_file(&tmp_dll);
            return Err(format!("Extracted {} failed SHA-256 verification", out_name));
        }
        replace_file_safely(user_dir, &tmp_dll, &final_dll, out_name)?;
    }

    Ok(())
}

pub fn download_default_ai_bundle(
    app: &AppHandle,
    user_dir: &Path,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let (models_dir, bin_dir, tmp_dir) = ensure_models_dirs(user_dir)?;
    let dll_path = bin_dir.join(ORT_DLL_NAME);
    let shared_dll_path = bin_dir.join(ORT_SHARED_DLL_NAME);
    let model_path = models_dir.join(DEFAULT_MODEL_FILE);

    let need_runtime = !(dll_path.is_file()
        && shared_dll_path.is_file()
        && sha256_file_hex(&dll_path)
            .map(|h| h.eq_ignore_ascii_case(ORT_DLL_SHA256))
            .unwrap_or(false)
        && sha256_file_hex(&shared_dll_path)
            .map(|h| h.eq_ignore_ascii_case(ORT_SHARED_DLL_SHA256))
            .unwrap_or(false));
    let need_model = !(model_path.is_file()
        && sha256_file_hex(&model_path)
            .map(|h| h.eq_ignore_ascii_case(DEFAULT_MODEL_SHA256))
            .unwrap_or(false));

    let combined_total = (if need_runtime { DEFAULT_ORT_WHL_BYTES } else { 0 })
        + (if need_model { DEFAULT_MODEL_BYTES } else { 0 });
    let mut offset = 0u64;

    if need_runtime {
        let tmp_whl = tmp_dir.join("onnxruntime.whl.tmp");
        download_verified_to_tmp(
            app,
            user_dir,
            DownloadSpec {
                url: DEFAULT_ORT_WHL_URL,
                expected_sha256: DEFAULT_ORT_WHL_SHA256,
                expected_size: DEFAULT_ORT_WHL_BYTES,
                stage: "runtime",
                progress_offset: offset,
                combined_total,
            },
            &tmp_whl,
            cancel_flag,
        )?;
        emit_download_progress(
            app,
            "extracting",
            DEFAULT_ORT_WHL_BYTES,
            DEFAULT_ORT_WHL_BYTES,
            offset,
            combined_total,
        );
        let extract_res = extract_verified_ort_dlls(user_dir, &tmp_whl, &bin_dir, &tmp_dir);
        let _ = fs::remove_file(&tmp_whl);
        extract_res?;
        offset = offset.saturating_add(DEFAULT_ORT_WHL_BYTES);
    }

    if need_model {
        let tmp_onnx = tmp_dir.join("yamnet.onnx.tmp");
        download_verified_to_tmp(
            app,
            user_dir,
            DownloadSpec {
                url: DEFAULT_MODEL_URL,
                expected_sha256: DEFAULT_MODEL_SHA256,
                expected_size: DEFAULT_MODEL_BYTES,
                stage: "model",
                progress_offset: offset,
                combined_total,
            },
            &tmp_onnx,
            cancel_flag,
        )?;
        replace_file_safely(user_dir, &tmp_onnx, &model_path, "AI model")?;
        let custom_path = models_dir.join(CUSTOM_MODEL_FILE);
        if custom_path.exists() {
            let _ = fs::remove_file(&custom_path);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_http_agent_configures_native_tls_without_panicking() {
        let agent = build_http_agent();
        assert_eq!(
            agent.config().tls_config().provider(),
            ureq::tls::TlsProvider::NativeTls
        );
    }

    #[test]
    #[ignore = "hits external HTTPS endpoints to verify Schannel TLS + redirects"]
    fn live_https_download_urls_head_succeed() {
        let agent = build_http_agent();
        for url in [DEFAULT_MODEL_URL, DEFAULT_ORT_WHL_URL] {
            let resp = agent
                .head(url)
                .call()
                .unwrap_or_else(|e| panic!("HEAD failed for {}: {}", url, e));
            assert_eq!(resp.status().as_u16(), 200);
        }
    }
}
