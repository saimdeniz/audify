import { AUDIO_EXTENSION_RE } from "../constants/audioFormats";

const MAX_NORMALIZED_PATHS = 20000;
const normalizedPathCache = new Map<string, string>();

export function normalizePathForMatch(p: string): string {
  const cached = normalizedPathCache.get(p);
  if (cached !== undefined) return cached;
  const value = p
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (normalizedPathCache.size >= MAX_NORMALIZED_PATHS) {
    // Evict oldest 25% instead of cliff-clearing the entire cache
    let toRemove = Math.floor(MAX_NORMALIZED_PATHS / 4);
    for (const k of normalizedPathCache.keys()) {
      normalizedPathCache.delete(k);
      if (--toRemove <= 0) break;
    }
  }
  normalizedPathCache.set(p, value);
  return value;
}

export function isPathInsideFolder(
  samplePath: string,
  folderPath: string
): boolean {
  const normSample = normalizePathForMatch(samplePath);
  const normFolder = normalizePathForMatch(folderPath);
  if (!normFolder) return false;
  if (normSample === normFolder || normSample.startsWith(normFolder + "/")) {
    return true;
  }
  // Drive-letter / PC agnostic fallback: if folderPath is "F:/data/sounds/sfx" and sample is "D:/data/sounds/sfx/item.wav"
  const colonIdx = normFolder.indexOf(":");
  if (colonIdx !== -1) {
    const withoutDrive = normFolder.slice(colonIdx + 1).replace(/^\/+/, "");
    if (
      withoutDrive &&
      (normSample === withoutDrive ||
        normSample.includes("/" + withoutDrive + "/") ||
        normSample.endsWith("/" + withoutDrive) ||
        normSample.startsWith(withoutDrive + "/"))
    ) {
      return true;
    }
  }
  return false;
}

/** Extracts the leaf directory/file name from an OS path using `/` or `\`. */
export function folderNameFromPath(path: string, fallback = ""): string {
  const clean = path.trim().replace(/[\\/]+$/, "");
  if (!clean) return fallback;
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return idx >= 0 ? clean.slice(idx + 1) || fallback : clean;
}

/**
 * Computes portable library-relative paths (e.g. `SFX/Whoosh`) for absolute scope paths,
 * matching Rust's `compute_rel_path` behavior across drives/machines.
 */
export function computeRelativeScopePaths(
  absPaths: string[],
  libraries: Array<{ path: string }>
): string[] {
  const rels: string[] = [];
  for (const raw of absPaths) {
    const clean = raw
      .trim()
      .replace(/^\\\\\?\\/, "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    if (!clean) continue;
    const lowerClean = normalizePathForMatch(clean);
    for (const lib of libraries) {
      const lowerLib = normalizePathForMatch(lib.path);
      if (!lowerLib) continue;
      if (lowerClean.startsWith(lowerLib + "/")) {
        const rel = clean.slice(lowerLib.length + 1);
        if (rel && !rels.some((r) => r.toLowerCase() === rel.toLowerCase())) {
          rels.push(rel);
        }
        break;
      }
    }
  }
  return rels;
}

/**
 * Removes a trailing *known audio* extension only. Anything else is left untouched, so titles
 * that legitimately contain dots ("Vol. 2 Intro", "Mr. Brightside") are never truncated.
 */
export function stripAudioExtension(fileName: string): string {
  return fileName.trim().replace(AUDIO_EXTENSION_RE, "");
}

/** Human-readable track title: drops the audio extension and turns underscores into spaces. */
export function cleanTrackTitle(raw: string): string {
  return stripAudioExtension(raw).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

