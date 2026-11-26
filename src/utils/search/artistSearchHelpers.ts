import type { ArtistStat } from "../../types";
import { foldSearchText } from "../format";
import type { SearchAutocompleteContext } from "./searchAutocomplete";

const MAX_ARTIST_SUGGESTIONS = 10;

export function formatArtistTokenValue(artistName: string): string {
  const clean = artistName.replace(/"/g, "").trim();
  if (!clean) return "";
  return /\s/.test(clean) ? `"${clean}"` : clean;
}

export function formatArtistSearchToken(
  artistName: string,
  operator = "artist"
): string {
  const val = formatArtistTokenValue(artistName);
  return val ? `${operator}:${val}` : "";
}

interface QuerySpan {
  raw: string;
  start: number;
  end: number;
}

function scanQuerySpans(query: string): QuerySpan[] {
  const spans: QuerySpan[] = [];
  const n = query.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(query[i])) i += 1;
    if (i >= n) break;
    const start = i;
    let inQuotes = false;
    while (i < n) {
      const ch = query[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        i += 1;
      } else if (!inQuotes && /\s/.test(ch)) {
        break;
      } else {
        i += 1;
      }
    }
    spans.push({ raw: query.slice(start, i), start, end: i });
  }
  return spans;
}

function parsePositiveArtistTokenValue(rawToken: string): string | null {
  if (rawToken.startsWith("-") || rawToken.startsWith("!")) return null;
  const colonIdx = rawToken.indexOf(":");
  if (colonIdx <= 0) return null;
  const op = rawToken.slice(0, colonIdx).toLowerCase();
  if (op !== "artist" && op !== "author" && op !== "by") return null;
  const rawVal = rawToken.slice(colonIdx + 1).trim();
  const unquoted =
    rawVal.length >= 2 && rawVal.startsWith('"') && rawVal.endsWith('"')
      ? rawVal.slice(1, -1)
      : rawVal.replace(/^"|"$/g, "");
  const clean = unquoted.trim();
  return clean ? foldSearchText(clean) : null;
}

/**
 * Toggles a positive `artist:` smart-search token for `artistName` while preserving
 * all other active search terms (keywords, tags, BPM, duration, exclusions, etc.).
 *
 * - Clicking the already-active artist removes its `artist:` token (toggle off).
 * - Clicking a different artist swaps any previous positive `artist:` token so
 *   combining two mutually exclusive artist filters never traps the user on 0 rows.
 */
export function toggleArtistSearchFilter(
  currentQuery: string,
  artistName: string
): string {
  const cleanName = artistName.replace(/"/g, "").trim();
  if (!cleanName) return currentQuery;

  const targetFolded = foldSearchText(cleanName);
  const spans = scanQuerySpans(currentQuery);

  let hadExactTarget = false;
  const kept: string[] = [];
  for (let i = 0; i < spans.length; i++) {
    const raw = spans[i].raw;
    const parsedArtist = parsePositiveArtistTokenValue(raw);
    if (parsedArtist !== null) {
      if (parsedArtist === targetFolded) {
        hadExactTarget = true;
      }
      continue;
    }
    kept.push(raw);
  }

  if (hadExactTarget) {
    return kept.join(" ");
  }

  const nextToken = formatArtistSearchToken(cleanName);
  return kept.length > 0 ? `${kept.join(" ")} ${nextToken}` : nextToken;
}

/**
 * Builds Smart Search inline autocomplete suggestions for `artist:`, `author:`, `by:`
 * (and their `-` negated forms) backed by the active profile's scanned `artistStats`.
 */
export function buildArtistAutocompleteContext(params: {
  start: number;
  end: number;
  rawToken: string;
  negPrefix: string;
  op: string;
  rawVal: string;
  artistStats: readonly ArtistStat[];
}): SearchAutocompleteContext | null {
  const { start, end, rawToken, negPrefix, op, rawVal, artistStats } = params;
  if (artistStats.length === 0) return null;

  const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
  const prefix: ArtistStat[] = [];
  const contains: ArtistStat[] = [];

  for (let i = 0; i < artistStats.length; i++) {
    const stat = artistStats[i];
    const folded = foldSearchText(stat.artist);
    if (!needle || folded.startsWith(needle)) {
      prefix.push(stat);
    } else if (folded.includes(needle)) {
      contains.push(stat);
    }
  }

  const byPopularity = (a: ArtistStat, b: ArtistStat) =>
    b.count - a.count || a.artist.localeCompare(b.artist);
  prefix.sort(byPopularity);
  contains.sort(byPopularity);

  const matched = [...prefix, ...contains].slice(0, MAX_ARTIST_SUGGESTIONS);
  if (matched.length === 0) return null;

  const items = matched.map((a) => ({
    id: `artist:${foldSearchText(a.artist)}`,
    insertToken: `${negPrefix}${op}:${formatArtistTokenValue(a.artist)}`,
    label: a.artist,
    meta: a.count.toLocaleString(),
    kind: "artist" as const,
  }));

  if (
    items.length === 1 &&
    items[0].insertToken.toLowerCase() === rawToken.toLowerCase()
  ) {
    return null;
  }

  return {
    tokenStart: start,
    tokenEnd: end,
    rawToken,
    headerLabel: negPrefix
      ? `EXCLUDE ARTIST (-${op}:)`
      : `ARTISTS (${op}:)`,
    items,
  };
}
