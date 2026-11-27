use crate::security::open_https_url_in_browser;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

pub const AUDIFY_GITHUB_REPO_URL: &str = "https://github.com/saimdeniz/audify";
pub const AUDIFY_RELEASES_LATEST_URL: &str = "https://github.com/saimdeniz/audify/releases/latest";
const GITHUB_LATEST_RELEASE_API_URL: &str =
    "https://api.github.com/repos/saimdeniz/audify/releases/latest";
const MAX_RELEASE_JSON_BYTES: u64 = 256 * 1024;
const UPDATE_CHECK_TIMEOUT_SECS: u64 = 6;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub release_name: String,
    pub published_at: String,
}

#[derive(Debug, Deserialize)]
struct GitHubLatestReleaseResponse {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ParsedSemver {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub is_prerelease: bool,
}

pub(crate) fn clean_version_label(raw: &str) -> String {
    raw.trim()
        .trim_start_matches(['v', 'V'])
        .trim()
        .to_string()
}

pub(crate) fn parse_semver(raw: &str) -> Option<ParsedSemver> {
    let cleaned = clean_version_label(raw);
    if cleaned.is_empty() {
        return None;
    }
    let without_build = cleaned.split('+').next().unwrap_or("");
    let (core, pre) = match without_build.split_once('-') {
        Some((c, p)) => (c, !p.trim().is_empty()),
        None => (without_build, false),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = match parts.next() {
        Some(p) => p.parse::<u64>().ok()?,
        None => 0,
    };
    if parts.next().is_some() {
        return None;
    }
    Some(ParsedSemver {
        major,
        minor,
        patch,
        is_prerelease: pre,
    })
}

/// Returns `true` strictly when `remote` is a newer SemVer release than `current`.
/// Stable builds beat same-triple pre-releases; pre-releases never override stable builds.
pub(crate) fn is_remote_version_newer(current: &str, remote: &str) -> bool {
    let (Some(cur), Some(rem)) = (parse_semver(current), parse_semver(remote)) else {
        return false;
    };
    let cur_triple = (cur.major, cur.minor, cur.patch);
    let rem_triple = (rem.major, rem.minor, rem.patch);
    if rem_triple != cur_triple {
        return rem_triple > cur_triple;
    }
    cur.is_prerelease && !rem.is_prerelease
}

/// Strict allowlist ensuring only official Audify GitHub pages can be opened externally.
pub(crate) fn sanitize_allowed_github_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 512
        || trimmed.contains("..")
        || trimmed
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '"' || c == '\'' || c == '\\')
    {
        return None;
    }
    if trimmed == AUDIFY_GITHUB_REPO_URL
        || trimmed.starts_with("https://github.com/saimdeniz/audify/")
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn build_update_http_agent() -> ureq::Agent {
    let tls_config = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::NativeTls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls_config)
        .timeout_global(Some(Duration::from_secs(UPDATE_CHECK_TIMEOUT_SECS)))
        .build()
        .new_agent()
}

fn fetch_latest_release_sync(current_version: &str) -> Result<AppUpdateInfo, String> {
    let agent = build_update_http_agent();
    let user_agent = format!("Audify/{}", current_version);
    let response = agent
        .get(GITHUB_LATEST_RELEASE_API_URL)
        .header("User-Agent", &user_agent)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .call();

    let mut resp = match response {
        Ok(r) => r,
        Err(ureq::Error::StatusCode(404)) => {
            // Repository currently has no published GitHub release yet.
            return Ok(AppUpdateInfo {
                current_version: current_version.to_string(),
                latest_version: current_version.to_string(),
                has_update: false,
                release_url: AUDIFY_RELEASES_LATEST_URL.to_string(),
                release_name: String::new(),
                published_at: String::new(),
            });
        }
        Err(e) => return Err(format!("Update check request failed: {}", e)),
    };

    let mut body = Vec::new();
    resp.body_mut()
        .as_reader()
        .take(MAX_RELEASE_JSON_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|e| format!("Failed reading GitHub release response: {}", e))?;
    if body.len() as u64 > MAX_RELEASE_JSON_BYTES {
        return Err("GitHub release response exceeded size limit".to_string());
    }

    let parsed: GitHubLatestReleaseResponse = serde_json::from_slice(&body)
        .map_err(|e| format!("Invalid GitHub release payload: {}", e))?;

    if parsed.draft || parsed.prerelease {
        return Ok(AppUpdateInfo {
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            has_update: false,
            release_url: AUDIFY_RELEASES_LATEST_URL.to_string(),
            release_name: String::new(),
            published_at: String::new(),
        });
    }

    let latest_clean = clean_version_label(&parsed.tag_name);
    let has_update = is_remote_version_newer(current_version, &latest_clean);
    let safe_url = parsed
        .html_url
        .as_deref()
        .and_then(sanitize_allowed_github_url)
        .unwrap_or_else(|| AUDIFY_RELEASES_LATEST_URL.to_string());

    Ok(AppUpdateInfo {
        current_version: current_version.to_string(),
        latest_version: if latest_clean.is_empty() {
            current_version.to_string()
        } else {
            latest_clean
        },
        has_update,
        release_url: safe_url,
        release_name: parsed.name.unwrap_or_default().trim().to_string(),
        published_at: parsed.published_at.unwrap_or_default().trim().to_string(),
    })
}

#[tauri::command]
pub async fn check_app_update() -> Result<AppUpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    tauri::async_runtime::spawn_blocking(move || fetch_latest_release_sync(&current))
        .await
        .map_err(|e| format!("Update check task failed: {}", e))?
}

#[tauri::command]
pub async fn open_github_url(url: Option<String>) -> Result<(), String> {
    let target = match url {
        Some(raw) if !raw.trim().is_empty() => sanitize_allowed_github_url(&raw)
            .ok_or_else(|| "Rejected non-allowlisted external URL".to_string())?,
        _ => AUDIFY_RELEASES_LATEST_URL.to_string(),
    };
    tauri::async_runtime::spawn_blocking(move || open_https_url_in_browser(&target))
        .await
        .map_err(|e| format!("Open browser task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_comparison_detects_newer_releases_and_handles_prefixes_and_prereleases() {
        assert!(is_remote_version_newer("1.0.4", "v1.0.5"));
        assert!(is_remote_version_newer("1.0.9", "1.0.10"));
        assert!(is_remote_version_newer("1.0.4", "1.1.0"));
        assert!(is_remote_version_newer("1.0.4", "2.0.0"));
        assert!(is_remote_version_newer("1.0.5-beta.1", "v1.0.5"));

        assert!(!is_remote_version_newer("1.0.4", "v1.0.4"));
        assert!(!is_remote_version_newer("1.0.4", "1.0.3"));
        assert!(!is_remote_version_newer("1.0.4", "1.0.4-rc.1"));
        assert!(!is_remote_version_newer("1.0.4", "not-a-version"));
        assert!(!is_remote_version_newer("1.0.4", ""));
    }

    #[test]
    fn github_url_allowlist_accepts_official_repo_and_blocks_arbitrary_urls() {
        assert_eq!(
            sanitize_allowed_github_url("https://github.com/saimdeniz/audify"),
            Some("https://github.com/saimdeniz/audify".to_string())
        );
        assert_eq!(
            sanitize_allowed_github_url("https://github.com/saimdeniz/audify/releases/tag/v1.0.5"),
            Some("https://github.com/saimdeniz/audify/releases/tag/v1.0.5".to_string())
        );

        assert!(sanitize_allowed_github_url("https://github.com/saimdeniz/audify-evil").is_none());
        assert!(sanitize_allowed_github_url("https://evil.example.com/audify").is_none());
        assert!(sanitize_allowed_github_url("http://github.com/saimdeniz/audify").is_none());
        assert!(sanitize_allowed_github_url("file:///C:/Windows/System32/calc.exe").is_none());
        assert!(sanitize_allowed_github_url("javascript:alert(1)").is_none());
        assert!(
            sanitize_allowed_github_url("https://github.com/saimdeniz/audify/../../other")
                .is_none()
        );
    }
}
