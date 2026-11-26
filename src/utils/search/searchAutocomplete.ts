import { CAMELOT_KEYS } from "../../constants/camelotKeys";
import type {
  ArtistStat,
  FolderStat,
  Genre,
  Tag,
  TagFacet,
  TaxonomyFacetSlug,
} from "../../types";
import { foldSearchText, folderNameFromPath } from "../format";
import {
  FACET_SHORT_BADGE,
  getFacetLabel,
  getSharedTaxonomyIndex,
  getTagRollupCount,
  resolveFacetDomain,
  resolveTagFacetSlug,
} from "../taxonomyTree";
import { buildArtistAutocompleteContext } from "./artistSearchHelpers";
import { STATIC_OPERATOR_OPTIONS } from "./searchAutocompleteOptions";

export interface SearchAutocompleteItem {
  id: string;
  insertToken: string;
  label: string;
  meta?: string;
  color?: string;
  facetBadge?: string;
  kind:
    | "tag"
    | "genre"
    | "mood"
    | "source"
    | "key"
    | "folder"
    | "artist"
    | "operator";
}

export interface SearchAutocompleteContext {
  tokenStart: number;
  tokenEnd: number;
  rawToken: string;
  headerLabel: string;
  items: SearchAutocompleteItem[];
}

const MAX_SUGGESTIONS = 10;

function formatTokenValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function finalizeAutocompleteContext(
  ctx: SearchAutocompleteContext
): SearchAutocompleteContext | null {
  if (ctx.items.length === 0) return null;
  if (
    ctx.items.length === 1 &&
    ctx.items[0].insertToken.toLowerCase() === ctx.rawToken.toLowerCase()
  ) {
    return null;
  }
  return ctx;
}

function extractActiveToken(
  query: string,
  cursorPos: number
): { start: number; end: number; token: string } | null {
  const safeCursor = Math.max(0, Math.min(query.length, cursorPos));
  // Quote-aware scan so `tag:"Sci Fi"` remains a single editable token across spaces
  let i = 0;
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) i += 1;
    if (i >= query.length) break;
    const tokStart = i;
    let inQuotes = false;
    while (i < query.length) {
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
    const tokEnd = i;
    if (safeCursor >= tokStart && safeCursor <= tokEnd) {
      const token = query.slice(tokStart, tokEnd);
      return token ? { start: tokStart, end: tokEnd, token } : null;
    }
  }
  return null;
}

function rankTextMatches<T extends { name: string; sample_count: number }>(
  list: readonly T[],
  needleFolded: string
): T[] {
  const prefix: T[] = [];
  const contains: T[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const folded = foldSearchText(item.name);
    if (!needleFolded || folded.startsWith(needleFolded)) {
      prefix.push(item);
    } else if (folded.includes(needleFolded)) {
      contains.push(item);
    }
  }
  const byPopularity = (a: T, b: T) =>
    b.sample_count - a.sample_count || a.name.localeCompare(b.name);
  prefix.sort(byPopularity);
  contains.sort(byPopularity);
  return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS);
}

function buildUniqueFolderEntries(
  folderStats: readonly FolderStat[]
): Array<{ name: string; sample_count: number }> {
  if (folderStats.length === 0) return [];
  const byFolded = new Map<string, { name: string; sample_count: number }>();
  for (let i = 0; i < folderStats.length; i++) {
    const stat = folderStats[i];
    const leaf = folderNameFromPath(stat.folder_path, "").trim();
    if (!leaf) continue;
    const key = foldSearchText(leaf);
    if (!key) continue;
    const existing = byFolded.get(key);
    if (existing) {
      existing.sample_count += stat.count;
    } else {
      byFolded.set(key, { name: leaf, sample_count: stat.count });
    }
  }
  return Array.from(byFolded.values());
}

interface RankedTaxonomyCandidate {
  tag: Tag;
  breadcrumb: string;
  slashToken: string;
  effectiveColor: string;
  rollupCount: number;
  facet: TaxonomyFacetSlug;
}

function rankTaxonomyTagMatches(
  tags: readonly Tag[],
  needleFolded: string,
  allowedFacets?: ReadonlySet<TaxonomyFacetSlug>,
  facets?: readonly TagFacet[]
): RankedTaxonomyCandidate[] {
  const index = getSharedTaxonomyIndex(tags, facets);
  const prefix: RankedTaxonomyCandidate[] = [];
  const contains: RankedTaxonomyCandidate[] = [];

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const facet = index.facetByTagId.get(t.id) ?? resolveTagFacetSlug(t, facets);
    if (allowedFacets && !allowedFacets.has(facet)) continue;
    const breadcrumb = index.breadcrumbByTagId.get(t.id) ?? t.name;
    const ancestors = index.ancestorsByTagId.get(t.id) ?? [];
    const slashToken =
      ancestors.length > 0
        ? [...ancestors.map((a) => a.name), t.name].join("/")
        : t.name;
    const foldedName = foldSearchText(t.name);
    const foldedBreadcrumb = foldSearchText(breadcrumb);
    const foldedSlash = foldSearchText(slashToken);
    const aliases = Array.isArray(t.aliases) ? t.aliases : [];

    const entry: RankedTaxonomyCandidate = {
      tag: t,
      breadcrumb,
      slashToken,
      effectiveColor: index.effectiveColorByTagId.get(t.id) ?? t.color,
      rollupCount: getTagRollupCount(t),
      facet,
    };

    if (
      !needleFolded ||
      foldedName.startsWith(needleFolded) ||
      foldedSlash.startsWith(needleFolded)
    ) {
      prefix.push(entry);
    } else if (
      foldedName.includes(needleFolded) ||
      foldedBreadcrumb.includes(needleFolded) ||
      foldedSlash.includes(needleFolded) ||
      aliases.some((a) => foldSearchText(a).includes(needleFolded))
    ) {
      contains.push(entry);
    }
  }

  const byPopularity = (a: RankedTaxonomyCandidate, b: RankedTaxonomyCandidate) =>
    b.rollupCount - a.rollupCount || a.breadcrumb.localeCompare(b.breadcrumb);
  prefix.sort(byPopularity);
  contains.sort(byPopularity);
  return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS);
}

export function getSearchAutocompleteSuggestions(
  query: string,
  cursorPos: number,
  tags: readonly Tag[],
  genres: readonly Genre[],
  folderStats: readonly FolderStat[] = [],
  facets: readonly TagFacet[] = [],
  artistStats: readonly ArtistStat[] = []
): SearchAutocompleteContext | null {
  const active = extractActiveToken(query, cursorPos);
  if (!active) return null;

  const { start, end, token } = active;
  const negPrefix = token.startsWith("-") ? "-" : "";
  const body = negPrefix ? token.slice(1) : token;

  // Shorthand `#tag` syntax
  if (body.startsWith("#")) {
    const needle = foldSearchText(body.slice(1).replace(/^"|"$/g, ""));
    const matched = rankTaxonomyTagMatches(tags, needle, undefined, facets);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: negPrefix ? "EXCLUDE TAG" : "FILTER BY TAG",
      items: matched.map((c) => ({
        id: `tag:${c.tag.id}`,
        insertToken: `${negPrefix}tag:${formatTokenValue(c.slashToken)}`,
        label: c.breadcrumb,
        meta: c.rollupCount.toLocaleString(),
        color: c.facet === "source" ? undefined : c.effectiveColor,
        facetBadge:
          FACET_SHORT_BADGE[c.facet] ?? c.facet.slice(0, 6).toUpperCase(),
        kind: "tag",
      })),
    });
  }

  const colonIdx = body.indexOf(":");
  if (colonIdx <= 0) return null;

  const op = body.slice(0, colonIdx).toLowerCase();
  const rawVal = body.slice(colonIdx + 1);

  if (op === "tag" || op === "t") {
    const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
    const matched = rankTaxonomyTagMatches(tags, needle, undefined, facets);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: negPrefix ? "EXCLUDE TAG (-tag:)" : "TAGS (tag:)",
      items: matched.map((c) => ({
        id: `tag:${c.tag.id}`,
        insertToken: `${negPrefix}tag:${formatTokenValue(c.slashToken)}`,
        label: c.breadcrumb,
        meta: c.rollupCount.toLocaleString(),
        color: c.facet === "source" ? undefined : c.effectiveColor,
        facetBadge:
          FACET_SHORT_BADGE[c.facet] ?? c.facet.slice(0, 6).toUpperCase(),
        kind: "tag",
      })),
    });
  }

  if (op === "mood" || op === "m") {
    const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
    const moodFacetSet = new Set<TaxonomyFacetSlug>(["mood"]);
    const matched = rankTaxonomyTagMatches(tags, needle, moodFacetSet, facets);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: negPrefix ? "EXCLUDE MOOD (-mood:)" : "MOODS (mood:)",
      items: matched.map((c) => ({
        id: `mood:${c.tag.id}`,
        insertToken: `${negPrefix}mood:${formatTokenValue(c.tag.name)}`,
        label: c.breadcrumb,
        meta: c.rollupCount.toLocaleString(),
        color: c.effectiveColor,
        facetBadge: "MOOD",
        kind: "mood",
      })),
    });
  }

  if (op === "source" || op === "src") {
    const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
    const srcFacetSet = new Set<TaxonomyFacetSlug>(["source"]);
    const matched = rankTaxonomyTagMatches(tags, needle, srcFacetSet, facets);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: negPrefix ? "EXCLUDE SOURCE (-source:)" : "SOURCE / PACK (source:)",
      items: matched.map((c) => ({
        id: `source:${c.tag.id}`,
        insertToken: `${negPrefix}source:${formatTokenValue(c.tag.name)}`,
        label: c.tag.name,
        meta: c.rollupCount.toLocaleString(),
        facetBadge: "SRC",
        kind: "source",
      })),
    });
  }

  if (op === "genre") {
    const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
    const genreDomainSlugs = new Set<TaxonomyFacetSlug>(["genre", "mood"]);
    for (const f of facets) {
      if (resolveFacetDomain(f.slug, facets) === "genres") {
        genreDomainSlugs.add(f.slug);
      }
    }
    const hasGenreDomainTags = tags.some((t) =>
      genreDomainSlugs.has(resolveTagFacetSlug(t, facets))
    );
    if (hasGenreDomainTags) {
      const matched = rankTaxonomyTagMatches(
        tags,
        needle,
        genreDomainSlugs,
        facets
      );
      if (matched.length === 0) return null;
      return finalizeAutocompleteContext({
        tokenStart: start,
        tokenEnd: end,
        rawToken: token,
        headerLabel: negPrefix ? "EXCLUDE GENRE (-genre:)" : "GENRES & MOODS (genre:)",
        items: matched.map((c) => ({
          id: `genre:${c.tag.id}`,
          insertToken: `${negPrefix}genre:${formatTokenValue(c.tag.name)}`,
          label: c.breadcrumb,
          meta: c.rollupCount.toLocaleString(),
          color: c.effectiveColor,
          facetBadge:
            FACET_SHORT_BADGE[c.facet] ?? c.facet.slice(0, 6).toUpperCase(),
          kind: "genre",
        })),
      });
    }
    const matched = rankTextMatches(genres, needle);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: negPrefix ? "EXCLUDE GENRE (-genre:)" : "GENRES (genre:)",
      items: matched.map((g) => ({
        id: `genre:${g.id}`,
        insertToken: `${negPrefix}genre:${formatTokenValue(g.name)}`,
        label: g.name,
        meta: g.sample_count.toLocaleString(),
        color: g.color,
        facetBadge: g.facet_slug === "mood" ? "MOOD" : "GENRE",
        kind: "genre",
      })),
    });
  }

  if (op === "artist" || op === "author" || op === "by") {
    return buildArtistAutocompleteContext({ start, end, rawToken: token, negPrefix, op, rawVal, artistStats });
  }

  if (op === "folder" || op === "path") {
    const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
    const uniqueFolders = buildUniqueFolderEntries(folderStats);
    const matched = rankTextMatches(uniqueFolders, needle);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: negPrefix
        ? `EXCLUDE FOLDER (-${op}:)`
        : `FOLDERS (${op}:)`,
      items: matched.map((f) => ({
        id: `folder:${foldSearchText(f.name)}`,
        insertToken: `${negPrefix}${op}:${formatTokenValue(f.name)}`,
        label: f.name,
        meta: f.sample_count.toLocaleString(),
        kind: "folder",
      })),
    });
  }

  if (op === "key") {
    const harmonic = rawVal.startsWith("~") ? "~" : "";
    const needle = (harmonic ? rawVal.slice(1) : rawVal).trim().toLowerCase();
    const matched = CAMELOT_KEYS.filter((k) => {
      if (!needle) return true;
      return (
        k.key.toLowerCase().startsWith(needle) ||
        k.camelot.toLowerCase().startsWith(needle)
      );
    }).slice(0, MAX_SUGGESTIONS);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: harmonic
        ? "HARMONIC MIX KEY (key:~)"
        : "MUSICAL / CAMELOT KEY (key:)",
      items: matched.map((k) => ({
        id: `key:${k.camelot}`,
        insertToken: `${negPrefix}key:${harmonic}${k.key}`,
        label: k.key,
        meta: k.camelot,
        kind: "key",
      })),
    });
  }

  const staticDef = STATIC_OPERATOR_OPTIONS[op];
  if (staticDef) {
    const needle = rawVal.trim().toLowerCase();
    const matched = staticDef.values
      .filter((v) => !needle || v.value.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
    if (matched.length === 0) return null;
    return finalizeAutocompleteContext({
      tokenStart: start,
      tokenEnd: end,
      rawToken: token,
      headerLabel: staticDef.header,
      items: matched.map((v) => ({
        id: `${op}:${v.value}`,
        insertToken: `${negPrefix}${op}:${v.value}`,
        label: `${op}:${v.value}`,
        meta: v.meta,
        kind: "operator",
      })),
    });
  }

  // Custom user-defined facet operator (`material:`, `era:`, `-material:`, etc.)
  const opFolded = foldSearchText(op);
  if (
    opFolded &&
    opFolded !== "category" &&
    opFolded !== "genre" &&
    opFolded !== "mood" &&
    opFolded !== "source"
  ) {
    const matchingCustomFacet =
      facets.find((f) => foldSearchText(f.slug) === opFolded) ?? null;
    const targetSlug = matchingCustomFacet
      ? matchingCustomFacet.slug
      : tags.some((t) => foldSearchText(t.facet_slug ?? "") === opFolded)
        ? opFolded
        : null;
    if (targetSlug) {
      const needle = foldSearchText(rawVal.replace(/^"|"$/g, ""));
      const customSet = new Set<TaxonomyFacetSlug>([targetSlug]);
      const matched = rankTaxonomyTagMatches(tags, needle, customSet, facets);
      if (matched.length === 0) return null;
      const facetTitle = getFacetLabel(targetSlug, facets).toUpperCase();
      const shortBadge = targetSlug.slice(0, 6).toUpperCase();
      return finalizeAutocompleteContext({
        tokenStart: start,
        tokenEnd: end,
        rawToken: token,
        headerLabel: negPrefix
          ? `EXCLUDE ${facetTitle} (-${op}:)`
          : `${facetTitle} (${op}:)`,
        items: matched.map((c) => ({
          id: `${targetSlug}:${c.tag.id}`,
          insertToken: `${negPrefix}${op}:${formatTokenValue(c.tag.name)}`,
          label: c.breadcrumb,
          meta: c.rollupCount.toLocaleString(),
          color: c.effectiveColor,
          facetBadge: shortBadge,
          kind: resolveFacetDomain(targetSlug, facets) === "genres" ? "genre" : "tag",
        })),
      });
    }
  }

  return null;
}

export function applyAutocompleteSuggestion(
  query: string,
  ctx: SearchAutocompleteContext,
  item: SearchAutocompleteItem
): { nextQuery: string; nextCursor: number } {
  const before = query.slice(0, ctx.tokenStart);
  const after = query.slice(ctx.tokenEnd);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = needsSpace ? `${item.insertToken} ` : item.insertToken;
  return {
    nextQuery: `${before}${inserted}${after}`,
    nextCursor: before.length + inserted.length,
  };
}
