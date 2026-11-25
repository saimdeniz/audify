import { useEffect, useState } from "react";
import { SITE_CONFIG } from "../config/siteConfig";

export interface LatestReleaseInfo {
  version: string;
  sizeLabel: string;
  downloadUrl: string;
  releaseUrl: string;
  sha256Url: string;
  sha256: string | null;
  publishedYear: string;
}

const CACHE_KEY = "audify_latest_release_v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedEntry {
  ts: number;
  data: LatestReleaseInfo;
}

interface GitHubAsset {
  name: string;
  size: number;
  digest?: string | null;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubAsset[];
}

const FALLBACK_RELEASE: LatestReleaseInfo = {
  version: SITE_CONFIG.version,
  sizeLabel: SITE_CONFIG.portableSize,
  downloadUrl: SITE_CONFIG.directDownloadUrl,
  releaseUrl: SITE_CONFIG.githubReleasesUrl,
  sha256Url: SITE_CONFIG.sha256SumsUrl,
  sha256: SITE_CONFIG.sha256,
  publishedYear: SITE_CONFIG.releaseDate,
};

function readCache(): LatestReleaseInfo | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: LatestReleaseInfo): void {
  try {
    const entry: CachedEntry = { ts: Date.now(), data };
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Automatically fetches the newest published GitHub Release for saimdeniz/audify
 * so version badges, file size, and download links stay up to date without code edits.
 * Falls back cleanly to SITE_CONFIG if offline or rate-limited.
 */
export function useLatestRelease(): LatestReleaseInfo {
  const [release, setRelease] = useState<LatestReleaseInfo>(() => readCache() ?? FALLBACK_RELEASE);

  useEffect(() => {
    if (readCache()) return;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(SITE_CONFIG.githubLatestApiUrl, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as GitHubReleaseResponse;
        const tag = json.tag_name?.trim();
        if (!tag) return;

        const exeAsset = json.assets?.find((a) => a.name.toLowerCase().endsWith(".exe"));
        const shaAsset = json.assets?.find((a) => a.name.toUpperCase().includes("SHA256"));
        const sizeMb = exeAsset ? `${(exeAsset.size / (1024 * 1024)).toFixed(1)} MB Portable .exe` : SITE_CONFIG.portableSize;
        const year = json.published_at ? json.published_at.slice(0, 4) : SITE_CONFIG.releaseDate;

        // GitHub Releases API returns `digest: "sha256:<64-hex>"` natively on release assets
        const rawDigest = exeAsset?.digest?.trim() ?? "";
        const liveSha256 = rawDigest.toLowerCase().startsWith("sha256:")
          ? rawDigest.slice(7).toUpperCase()
          : null;

        const next: LatestReleaseInfo = {
          version: tag,
          sizeLabel: sizeMb,
          downloadUrl: exeAsset?.browser_download_url ?? SITE_CONFIG.directDownloadUrl,
          releaseUrl: json.html_url ?? SITE_CONFIG.githubReleasesUrl,
          sha256Url: shaAsset?.browser_download_url ?? SITE_CONFIG.sha256SumsUrl,
          sha256: liveSha256 ?? (tag === SITE_CONFIG.version ? SITE_CONFIG.sha256 : null),
          publishedYear: year,
        };

        writeCache(next);
        setRelease(next);
      } catch {
        // Offline / aborted / rate-limited -> keep clean fallback
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  return release;
}
