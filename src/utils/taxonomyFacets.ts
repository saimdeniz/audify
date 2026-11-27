import type { Tag, TagFacet, TaxonomyDomain, TaxonomyFacetSlug } from "../types";
import { deriveChildTonalColor } from "./taxonomyColor";

export const FACET_LABELS: Record<string, string> = {
  category: "Category",
  genre: "Genre",
  mood: "Mood",
  source: "Source / Pack",
};

export const FACET_SHORT_BADGE: Record<string, string> = {
  category: "CAT",
  genre: "GENRE",
  mood: "MOOD",
  source: "SRC",
};

export const FACET_DEFAULT_COLORS: Record<string, string> = {
  category: "#64748B",
  genre: "#3B82F6",
  mood: "#EC4899",
  source: "#64748B",
};

export const FALLBACK_SYSTEM_FACETS: readonly TagFacet[] = [
  {
    id: 1,
    slug: "category",
    name: "Category",
    color: "#22C55E",
    sort_order: 0,
    is_system: true,
    domain: "tags",
    allow_nesting: true,
  },
  {
    id: 2,
    slug: "genre",
    name: "Genre",
    color: "#3B82F6",
    sort_order: 1,
    is_system: true,
    domain: "genres",
    allow_nesting: true,
  },
  {
    id: 3,
    slug: "mood",
    name: "Mood",
    color: "#EC4899",
    sort_order: 2,
    is_system: true,
    domain: "genres",
    allow_nesting: false,
  },
  {
    id: 4,
    slug: "source",
    name: "Source / Pack",
    color: "#64748B",
    sort_order: 3,
    is_system: true,
    domain: "tags",
    allow_nesting: false,
  },
];

export const MAX_TAXONOMY_DEPTH = 3;

export function resolveFacetDomain(
  slug: TaxonomyFacetSlug,
  facets?: readonly TagFacet[]
): TaxonomyDomain {
  if (facets && facets.length > 0) {
    const found = facets.find((f) => f.slug === slug);
    if (found?.domain === "genres" || found?.domain === "tags") {
      return found.domain;
    }
  }
  return slug === "genre" || slug === "mood" ? "genres" : "tags";
}

export function isFacetHierarchical(
  slug: TaxonomyFacetSlug,
  facets?: readonly TagFacet[]
): boolean {
  if (facets && facets.length > 0) {
    const found = facets.find((f) => f.slug === slug);
    if (found && typeof found.allow_nesting === "boolean") {
      return found.allow_nesting;
    }
  }
  return slug === "category" || slug === "genre";
}

export function getFacetsForDomain(
  facets: readonly TagFacet[] | undefined,
  domain: TaxonomyDomain
): TagFacet[] {
  const source = facets && facets.length > 0 ? facets : FALLBACK_SYSTEM_FACETS;
  return source
    .filter((f) => (f.domain ?? resolveFacetDomain(f.slug)) === domain)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

export function getFacetLabel(
  slug: TaxonomyFacetSlug,
  facets?: readonly TagFacet[]
): string {
  const found = facets?.find((f) => f.slug === slug);
  if (found) return found.name;
  return FACET_LABELS[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getFacetDefaultColor(
  slug: TaxonomyFacetSlug,
  facets?: readonly TagFacet[]
): string {
  const found = facets?.find((f) => f.slug === slug);
  if (found?.color) return found.color;
  return FACET_DEFAULT_COLORS[slug] ?? "#64748B";
}

export function resolveTagFacetSlug(
  tag: Pick<Tag, "facet_slug" | "facet_id">,
  facets?: readonly TagFacet[]
): TaxonomyFacetSlug {
  if (tag.facet_slug && tag.facet_slug.trim().length > 0) {
    return tag.facet_slug.trim();
  }
  if (tag.facet_id != null && facets && facets.length > 0) {
    const found = facets.find((f) => f.id === tag.facet_id);
    if (found) return found.slug;
  }
  if (tag.facet_id === 2) return "genre";
  if (tag.facet_id === 3) return "mood";
  if (tag.facet_id === 4) return "source";
  return "category";
}

export function getTagRollupCount(tag: Pick<Tag, "rollup_count" | "sample_count">): number {
  return typeof tag.rollup_count === "number" ? tag.rollup_count : tag.sample_count;
}

export function getTagEffectiveColor(
  tag: Tag,
  byId?: ReadonlyMap<number, Tag>,
  facets?: readonly TagFacet[]
): string {
  const facetSlug = resolveTagFacetSlug(tag, facets);
  const fallbackColor = getFacetDefaultColor(facetSlug, facets);
  if (!tag.color_inherited) {
    return tag.color || tag.effective_color || fallbackColor;
  }
  if (!byId) {
    if (tag.effective_color && tag.effective_color.trim()) {
      return tag.effective_color;
    }
    return tag.color || fallbackColor;
  }
  const visited = new Set<number>([tag.id]);
  let parentId = tag.parent_id ?? null;
  let hops = 0;
  let baseColor: string | null = null;
  while (parentId !== null) {
    if (visited.has(parentId) || hops > MAX_TAXONOMY_DEPTH + 1) break;
    visited.add(parentId);
    hops += 1;
    const parent = byId.get(parentId);
    if (!parent) break;
    if (!parent.color_inherited && parent.color) {
      baseColor = parent.color;
      break;
    }
    parentId = parent.parent_id ?? null;
  }
  if (tag.parent_id != null) {
    const resolvedParentHex = baseColor ?? fallbackColor;
    return deriveChildTonalColor(
      resolvedParentHex,
      tag.name,
      Math.max(2, hops + 1)
    );
  }
  if (tag.effective_color && tag.effective_color.trim()) {
    return tag.effective_color;
  }
  return baseColor || tag.color || fallbackColor;
}
