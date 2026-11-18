use super::catalog::expected_piece_sha256;
use super::security::{is_valid_slug, validate_piece_source_js};
use super::{ascii_magic_pieces_dir, MAX_PIECE_BYTES};
use crate::security::ensure_inside;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use tauri::http::{header, Method, Request, Response, StatusCode};

const RUNNER_HTML: &str = include_str!("../../assets/ascii_magic/runner.html");
const RUNNER_JS: &str = include_str!("../../assets/ascii_magic/runner.js");
const WORKER_JS: &str = include_str!("../../assets/ascii_magic/worker.js");
const LIB_KIT_JS: &str = include_str!("../../assets/ascii_magic/lib/kit.js");
const LIB_SCENE_JS: &str = include_str!("../../assets/ascii_magic/lib/scene.js");

#[cfg(debug_assertions)]
const SANDBOX_CSP: &str = "default-src 'none'; script-src 'self' http://ascii-sandbox.localhost ascii-sandbox:; worker-src 'self' http://ascii-sandbox.localhost ascii-sandbox:; connect-src 'none'; img-src 'none'; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://tauri.localhost https://tauri.localhost tauri://localhost http://localhost:1420 http://127.0.0.1:1420;";

#[cfg(not(debug_assertions))]
const SANDBOX_CSP: &str = "default-src 'none'; script-src 'self' http://ascii-sandbox.localhost ascii-sandbox:; worker-src 'self' http://ascii-sandbox.localhost ascii-sandbox:; connect-src 'none'; img-src 'none'; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://tauri.localhost https://tauri.localhost tauri://localhost;";

const ALLOWED_SANDBOX_ORIGINS: &[&str] = &[
    "http://ascii-sandbox.localhost",
    "https://ascii-sandbox.localhost",
    "ascii-sandbox://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    #[cfg(debug_assertions)]
    "http://localhost:1420",
    #[cfg(debug_assertions)]
    "http://127.0.0.1:1420",
];

fn match_allowed_origin(request: &Request<Vec<u8>>) -> Result<Option<&'static str>, ()> {
    let Some(raw) = request.headers().get(header::ORIGIN) else {
        return Ok(None);
    };
    let Ok(origin) = raw.to_str() else {
        return Err(());
    };
    let normalized = origin.trim().trim_end_matches('/');
    ALLOWED_SANDBOX_ORIGINS
        .iter()
        .copied()
        .find(|allowed| normalized.eq_ignore_ascii_case(allowed))
        .map(Some)
        .ok_or(())
}

fn build_response(
    status: StatusCode,
    content_type: &str,
    cache_control: &str,
    allowed_origin: Option<&'static str>,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, SANDBOX_CSP)
        .header(header::VARY, "Origin")
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, cache_control);
    if let Some(origin) = allowed_origin {
        builder = builder
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS");
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn text_error(
    status: StatusCode,
    allowed_origin: Option<&'static str>,
    msg: &str,
) -> Response<Vec<u8>> {
    build_response(
        status,
        "text/plain; charset=utf-8",
        "no-store",
        allowed_origin,
        msg.as_bytes().to_vec(),
    )
}

/// Serves read-only sandbox assets and SHA-256 verified cached pieces under `ascii-sandbox://`.
pub fn handle_sandbox_request(user_dir: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let allowed_origin = match match_allowed_origin(&request) {
        Ok(origin) => origin,
        Err(()) => {
            return text_error(StatusCode::FORBIDDEN, None, "Origin not allowed");
        }
    };
    if request.method() == Method::OPTIONS {
        return build_response(
            StatusCode::NO_CONTENT,
            "text/plain; charset=utf-8",
            "no-store",
            allowed_origin,
            Vec::new(),
        );
    }
    if request.method() != Method::GET {
        return text_error(
            StatusCode::METHOD_NOT_ALLOWED,
            allowed_origin,
            "Method not allowed",
        );
    }

    let raw_path = request.uri().path();
    let path = raw_path.split('?').next().unwrap_or(raw_path);

    match path {
        "/" | "/runner.html" => build_response(
            StatusCode::OK,
            "text/html; charset=utf-8",
            "public, max-age=3600",
            allowed_origin,
            RUNNER_HTML.as_bytes().to_vec(),
        ),
        "/runner.js" => build_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            "public, max-age=3600",
            allowed_origin,
            RUNNER_JS.as_bytes().to_vec(),
        ),
        "/worker.js" => build_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            "public, max-age=3600",
            allowed_origin,
            WORKER_JS.as_bytes().to_vec(),
        ),
        "/lib/kit.js" => build_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            "public, max-age=86400",
            allowed_origin,
            LIB_KIT_JS.as_bytes().to_vec(),
        ),
        "/lib/scene.js" => build_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            "public, max-age=86400",
            allowed_origin,
            LIB_SCENE_JS.as_bytes().to_vec(),
        ),
        _ if path.starts_with("/pieces/") && path.ends_with(".js") => {
            serve_verified_piece(user_dir, path, allowed_origin)
        }
        _ => text_error(StatusCode::NOT_FOUND, allowed_origin, "Not found"),
    }
}

fn serve_verified_piece(
    user_dir: &Path,
    path: &str,
    allowed_origin: Option<&'static str>,
) -> Response<Vec<u8>> {
    let slug = path
        .trim_start_matches("/pieces/")
        .trim_end_matches(".js");
    if !is_valid_slug(slug) {
        return text_error(StatusCode::BAD_REQUEST, allowed_origin, "Invalid piece slug");
    }

    let Some(expected_hash) = expected_piece_sha256(user_dir, slug) else {
        return text_error(StatusCode::NOT_FOUND, allowed_origin, "Piece is not installed");
    };

    let pieces_dir = ascii_magic_pieces_dir(user_dir);
    let candidate = pieces_dir.join(format!("{}.js", slug));
    let Ok(meta) = fs::symlink_metadata(&candidate) else {
        return text_error(
            StatusCode::NOT_FOUND,
            allowed_origin,
            "Piece cache file missing",
        );
    };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_PIECE_BYTES {
        return text_error(
            StatusCode::FORBIDDEN,
            allowed_origin,
            "Rejected unsafe piece cache entry",
        );
    }

    let Ok(canon) = ensure_inside(&pieces_dir, &candidate) else {
        return text_error(
            StatusCode::FORBIDDEN,
            allowed_origin,
            "Path outside sandbox root",
        );
    };

    let Ok(bytes) = fs::read(canon) else {
        return text_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            allowed_origin,
            "Failed reading piece",
        );
    };

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual_hash = hex::encode(hasher.finalize());
    if actual_hash != expected_hash {
        return text_error(
            StatusCode::FORBIDDEN,
            allowed_origin,
            "Piece integrity checksum mismatch",
        );
    }

    let Ok(source) = std::str::from_utf8(&bytes) else {
        return text_error(
            StatusCode::FORBIDDEN,
            allowed_origin,
            "Invalid UTF-8 piece source",
        );
    };
    if validate_piece_source_js(source).is_err() {
        return text_error(
            StatusCode::FORBIDDEN,
            allowed_origin,
            "Piece source failed security validation",
        );
    }

    build_response(
        StatusCode::OK,
        "application/javascript; charset=utf-8",
        "no-store",
        allowed_origin,
        bytes,
    )
}
