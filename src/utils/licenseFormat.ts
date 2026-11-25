import { LicenseGroup, LicenseQuoteMode, SampleItem } from "../types";
import { cleanTrackTitle, isPathInsideFolder, normalizePathForMatch } from "./pathHelpers";

const relFoldersCache = new WeakMap<LicenseGroup, string[]>();
const artistsCache = new WeakMap<LicenseGroup, Set<string>>();

/** Normalized (lower-case, forward-slash, no edge slashes) `rel_folders`, cached per group. */
function getNormalizedRelFolders(group: LicenseGroup): string[] {
  const cached = relFoldersCache.get(group);
  if (cached) return cached;
  const list = (group.rel_folders ?? [])
    .map((r) => normalizePathForMatch(r).replace(/^\/+/, ""))
    .filter(Boolean);
  relFoldersCache.set(group, list);
  return list;
}

/** Normalized (trimmed lower-case) `artists` set, cached per group for O(1) lookup. */
function getNormalizedArtists(group: LicenseGroup): Set<string> {
  const cached = artistsCache.get(group);
  if (cached) return cached;
  const set = new Set<string>();
  const raw = group.artists;
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const clean = raw[i]?.trim().toLowerCase();
      if (clean) set.add(clean);
    }
  }
  artistsCache.set(group, set);
  return set;
}

export function findLicenseArtistMatch(
  sampleArtist: string | null | undefined,
  group: LicenseGroup
): string | null {
  if (!sampleArtist) return null;
  const norm = sampleArtist.trim().toLowerCase();
  if (!norm) return null;
  const artistSet = getNormalizedArtists(group);
  return artistSet.has(norm) ? norm : null;
}

export interface LicenseFolderMatch {
  /** The configured folder (absolute `folders` entry or relative `rel_folders` entry) that matched. */
  folder: string;
  /** Specificity score: length of the matched normalized folder (longer = more specific). */
  score: number;
}

/**
 * Single source of truth for "which folder of this license group contains the sample".
 * Absolute `folders` win; `rel_folders` are a drive/PC-independent fallback so a license
 * keeps working after the library moved (e.g. C: -> D:).
 */
export function findLicenseFolderMatch(
  samplePath: string,
  group: LicenseGroup
): LicenseFolderMatch | null {
  let best: LicenseFolderMatch | null = null;

  for (const folder of group.folders) {
    if (isPathInsideFolder(samplePath, folder)) {
      const score = normalizePathForMatch(folder).length;
      if (!best || score > best.score) best = { folder, score };
    }
  }
  if (best) return best;

  const rels = getNormalizedRelFolders(group);
  if (rels.length > 0) {
    const normSample = normalizePathForMatch(samplePath);
    const originals = group.rel_folders ?? [];
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      if (
        normSample.endsWith("/" + rel) ||
        normSample.includes("/" + rel + "/")
      ) {
        if (!best || rel.length > best.score) {
          best = { folder: originals[i] ?? rel, score: rel.length };
        }
      }
    }
  }
  return best;
}

export function isSampleInLicenseGroup(
  samplePath: string,
  group: LicenseGroup,
  sampleArtist?: string | null
): boolean {
  return (
    findLicenseFolderMatch(samplePath, group) !== null ||
    findLicenseArtistMatch(sampleArtist, group) !== null
  );
}

export function matchSampleToLicenseGroup(
  samplePath: string,
  licenseGroups: LicenseGroup[],
  sampleArtist?: string | null
): LicenseGroup | null {
  let bestGroup: LicenseGroup | null = null;
  let bestScore = -1;

  // Priority 1: Folder specificity (longest matched folder path wins)
  for (const group of licenseGroups) {
    const m = findLicenseFolderMatch(samplePath, group);
    if (m && m.score > bestScore) {
      bestScore = m.score;
      bestGroup = group;
    }
  }
  if (bestGroup) return bestGroup;

  // Priority 2: Exact case-insensitive Artist metadata match fallback
  if (sampleArtist && sampleArtist.trim()) {
    for (const group of licenseGroups) {
      if (findLicenseArtistMatch(sampleArtist, group) !== null) {
        return group;
      }
    }
  }
  return null;
}

export function formatLicenseGroupLine(
  group: {
    name: string;
    template: string;
    quoteMode?: LicenseQuoteMode;
  },
  rawFileNames: string[],
  folderHint = ""
): string {
  const cleanTitles = Array.from(
    new Set(
      rawFileNames
        .map((fn) => cleanTrackTitle(fn))
        .filter(Boolean)
    )
  );
  if (cleanTitles.length === 0) return "";

  const isMulti = cleanTitles.length > 1;
  const quoteMode: LicenseQuoteMode = group.quoteMode || "auto";
  const rawTemplate = group.template.trim() || '"{title}" by {artist}';

  // Normalize {titles} and {file_name} aliases to {title}
  const normalizedTemplate = rawTemplate
    .replace(/\{titles\}/gi, "{title}")
    .replace(/\{file_name\}/gi, "{title}");

  const hasQuotedToken =
    normalizedTemplate.includes('"{title}"') ||
    normalizedTemplate.includes("“{title}”") ||
    normalizedTemplate.includes("'{title}'");

  let shouldQuoteEach = false;
  if (quoteMode === "always") {
    shouldQuoteEach = true;
  } else if (quoteMode === "never") {
    shouldQuoteEach = false;
  } else if (quoteMode === "multi_only") {
    shouldQuoteEach = isMulti;
  } else {
    // "auto": if template has "{title}", quote each; otherwise unquoted on single, quoted on multi if desired
    shouldQuoteEach = hasQuotedToken;
  }

  const formattedTitles = shouldQuoteEach
    ? cleanTitles.map((t) => `"${t}"`).join(", ")
    : cleanTitles.join(", ");

  let result = normalizedTemplate;
  if (hasQuotedToken) {
    result = result
      .replace(/"\{title\}"/g, formattedTitles)
      .replace(/“\{title\}”/g, formattedTitles)
      .replace(/'\{title\}'/g, formattedTitles);
  } else if (result.includes("{title}")) {
    result = result.replace(/\{title\}/g, formattedTitles);
  } else {
    result = `${formattedTitles} ${result}`;
  }

  result = result
    .replace(/\{artist\}/gi, group.name)
    .replace(/\{folder\}/gi, folderHint);

  return result.trim();
}

export interface BatchAttributionResult {
  text: string;
  matchedSampleCount: number;
  artistCount: number;
  unmatchedCount: number;
  groupsSummary: {
    group: LicenseGroup;
    titles: string[];
    line: string;
  }[];
}

export function generateBatchAttributionCredits(
  samples: SampleItem[],
  licenseGroups: LicenseGroup[],
  metadataTitlesByPath?: Record<string, string>
): BatchAttributionResult {
  const byGroupId = new Map<
    string,
    { group: LicenseGroup; fileNames: string[]; folderHint: string }
  >();
  let matchedSampleCount = 0;
  let unmatchedCount = 0;

  for (const sample of samples) {
    const matched = matchSampleToLicenseGroup(
      sample.file_path,
      licenseGroups,
      sample.artist
    );
    if (!matched) {
      unmatchedCount++;
      continue;
    }
    matchedSampleCount++;
    const resolvedTitle =
      metadataTitlesByPath?.[sample.file_path]?.trim() || sample.file_name;
    const existing = byGroupId.get(matched.id);
    if (existing) {
      existing.fileNames.push(resolvedTitle);
    } else {
      const folderParts = sample.file_path.replace(/\\/g, "/").split("/");
      folderParts.pop();
      const folderHint = folderParts[folderParts.length - 1] || "";
      byGroupId.set(matched.id, {
        group: matched,
        fileNames: [resolvedTitle],
        folderHint,
      });
    }
  }

  const groupsSummary: {
    group: LicenseGroup;
    titles: string[];
    line: string;
  }[] = [];

  for (const entry of byGroupId.values()) {
    const line = formatLicenseGroupLine(
      entry.group,
      entry.fileNames,
      entry.folderHint
    );
    const titles = Array.from(
      new Set(entry.fileNames.map((fn) => cleanTrackTitle(fn)))
    );
    if (line) {
      groupsSummary.push({
        group: entry.group,
        titles,
        line,
      });
    }
  }

  return {
    text: groupsSummary.map((g) => g.line).join("\n"),
    matchedSampleCount,
    artistCount: groupsSummary.length,
    unmatchedCount,
    groupsSummary,
  };
}
