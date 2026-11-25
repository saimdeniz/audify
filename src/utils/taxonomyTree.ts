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

export interface TaxonomyTagSearchMeta {
  name: string;
  nameLower: string;
  facet: TaxonomyFacetSlug;
  domain: TaxonomyDomain;
  ancestors: string[];
  aliases: string[];
  slashPath: string;
}

export interface TaxonomyWorkerIndex {
  descendantsByTagId: Record<number, number[]>;
  facetByTagId: Record<number, TaxonomyFacetSlug>;
  facetDomainBySlug: Record<string, TaxonomyDomain>;
  searchMetaByTagId: Record<number, TaxonomyTagSearchMeta>;
}

export interface TaxonomyIndex {
  byId: Map<number, Tag>;
  byLowerName: Map<string, Tag>;
  childrenByParentId: Map<number | null, Tag[]>;
  descendantsByTagId: Map<number, number[]>;
  ancestorsByTagId: Map<number, Tag[]>;
  facetByTagId: Map<number, TaxonomyFacetSlug>;
  domainByTagId: Map<number, TaxonomyDomain>;
  effectiveColorByTagId: Map<number, string>;
  breadcrumbByTagId: Map<number, string>;
  slashPathByTagId: Map<number, string>;
  depthByTagId: Map<number, number>;
}

function compareSiblingTags(a: Tag, b: Tag): number {
  const aSort = a.sort_order ?? 500;
  const bSort = b.sort_order ?? 500;
  const aPinned = aSort < 0;
  const bPinned = bSort < 0;
  if (aPinned || bPinned) {
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aSort !== bSort) return aSort - bSort;
  }
  const aCount = getTagRollupCount(a);
  const bCount = getTagRollupCount(b);
  if (bCount !== aCount) return bCount - aCount;
  if (aSort !== bSort) return aSort - bSort;
  return a.name.localeCompare(b.name);
}

export function buildTaxonomyIndex(
  tags: readonly Tag[],
  facets?: readonly TagFacet[]
): TaxonomyIndex {
  const byId = new Map<number, Tag>();
  const byLowerName = new Map<string, Tag>();
  const childrenByParentId = new Map<number | null, Tag[]>();
  const facetByTagId = new Map<number, TaxonomyFacetSlug>();
  const domainByTagId = new Map<number, TaxonomyDomain>();

  for (const t of tags) {
    byId.set(t.id, t);
    byLowerName.set(t.name.trim().toLowerCase(), t);
    const slug = resolveTagFacetSlug(t, facets);
    facetByTagId.set(t.id, slug);
    domainByTagId.set(t.id, resolveFacetDomain(slug, facets));
  }

  for (const t of tags) {
    const slug = facetByTagId.get(t.id) ?? "category";
    const validParent =
      t.parent_id != null &&
      t.parent_id !== t.id &&
      byId.has(t.parent_id) &&
      isFacetHierarchical(slug, facets) &&
      facetByTagId.get(t.parent_id) === slug
        ? t.parent_id
        : null;
    const list = childrenByParentId.get(validParent) ?? [];
    list.push(t);
    childrenByParentId.set(validParent, list);
  }

  for (const list of childrenByParentId.values()) {
    list.sort(compareSiblingTags);
  }

  const ancestorsByTagId = new Map<number, Tag[]>();
  const depthByTagId = new Map<number, number>();
  const effectiveColorByTagId = new Map<number, string>();
  const breadcrumbByTagId = new Map<number, string>();
  const slashPathByTagId = new Map<number, string>();

  for (const t of tags) {
    const slug = facetByTagId.get(t.id) ?? "category";
    const hierarchical = isFacetHierarchical(slug, facets);
    const chain: Tag[] = [];
    const seen = new Set<number>([t.id]);
    let pid = hierarchical ? (t.parent_id ?? null) : null;
    while (pid !== null && chain.length < MAX_TAXONOMY_DEPTH) {
      if (seen.has(pid)) break;
      seen.add(pid);
      const parent = byId.get(pid);
      if (!parent || facetByTagId.get(parent.id) !== slug) break;
      chain.push(parent);
      pid = parent.parent_id ?? null;
    }
    chain.reverse();
    ancestorsByTagId.set(t.id, chain);
    depthByTagId.set(t.id, chain.length + 1);
    effectiveColorByTagId.set(t.id, getTagEffectiveColor(t, byId, facets));

    const names = [...chain.map((a) => a.name), t.name];
    breadcrumbByTagId.set(t.id, names.join(" ▸ "));
    slashPathByTagId.set(
      t.id,
      names.map((n) => n.trim().toLowerCase()).join("/")
    );
  }

  const descendantsByTagId = new Map<number, number[]>();
  const collectDescendants = (id: number, visited: Set<number>): number[] => {
    const cached = descendantsByTagId.get(id);
    if (cached) return cached;
    visited.add(id);
    const out: number[] = [id];
    const children = childrenByParentId.get(id);
    if (children) {
      for (const child of children) {
        if (!visited.has(child.id)) {
          out.push(...collectDescendants(child.id, visited));
        }
      }
    }
    descendantsByTagId.set(id, out);
    return out;
  };

  for (const t of tags) {
    if (!descendantsByTagId.has(t.id)) {
      collectDescendants(t.id, new Set<number>());
    }
  }

  return {
    byId,
    byLowerName,
    childrenByParentId,
    descendantsByTagId,
    ancestorsByTagId,
    facetByTagId,
    domainByTagId,
    effectiveColorByTagId,
    breadcrumbByTagId,
    slashPathByTagId,
    depthByTagId,
  };
}

let sharedIndexTagsRef: readonly Tag[] | null = null;
let sharedIndexFacetsRef: readonly TagFacet[] | undefined = undefined;
let sharedIndexValue: TaxonomyIndex | null = null;

/**
 * Reference-memoized singleton taxonomy index shared across `SampleTable`,
 * `SampleFilterToolbar`, `ActiveTaxonomyChips`, `FilterDrawer`, and sidebars
 * so identical `(tags, tagFacets)` references never rebuild the tree multiple times.
 */
export function getSharedTaxonomyIndex(
  tags: readonly Tag[],
  facets?: readonly TagFacet[]
): TaxonomyIndex {
  if (
    sharedIndexValue !== null &&
    tags === sharedIndexTagsRef &&
    facets === sharedIndexFacetsRef
  ) {
    return sharedIndexValue;
  }
  const built = buildTaxonomyIndex(tags, facets);
  sharedIndexTagsRef = tags;
  sharedIndexFacetsRef = facets;
  sharedIndexValue = built;
  return built;
}

export function serializeTaxonomyForWorker(
  tags: readonly Tag[],
  facets?: readonly TagFacet[]
): TaxonomyWorkerIndex {
  const index = getSharedTaxonomyIndex(tags, facets);
  const descendantsByTagId: Record<number, number[]> = {};
  const facetByTagId: Record<number, TaxonomyFacetSlug> = {};
  const facetDomainBySlug: Record<string, TaxonomyDomain> = {};
  const searchMetaByTagId: Record<number, TaxonomyTagSearchMeta> = {};

  const facetList =
    facets && facets.length > 0 ? facets : FALLBACK_SYSTEM_FACETS;
  for (const f of facetList) {
    const cleanSlug = f.slug.trim().toLowerCase();
    if (cleanSlug) {
      facetDomainBySlug[cleanSlug] =
        f.domain ?? resolveFacetDomain(cleanSlug, facets);
    }
  }

  for (const tag of tags) {
    descendantsByTagId[tag.id] = index.descendantsByTagId.get(tag.id) ?? [tag.id];
    const facet = index.facetByTagId.get(tag.id) ?? "category";
    const domain =
      index.domainByTagId.get(tag.id) ?? resolveFacetDomain(facet, facets);
    facetByTagId[tag.id] = facet;
    const lowerSlug = facet.toLowerCase();
    if (!(lowerSlug in facetDomainBySlug)) {
      facetDomainBySlug[lowerSlug] = domain;
    }
    const ancestors = (index.ancestorsByTagId.get(tag.id) ?? []).map((a) => a.name);
    searchMetaByTagId[tag.id] = {
      name: tag.name,
      nameLower: tag.name.trim().toLowerCase(),
      facet,
      domain,
      ancestors,
      aliases: Array.isArray(tag.aliases) ? tag.aliases : [],
      slashPath: index.slashPathByTagId.get(tag.id) ?? tag.name.trim().toLowerCase(),
    };
  }

  return {
    descendantsByTagId,
    facetByTagId,
    facetDomainBySlug,
    searchMetaByTagId,
  };
}

export interface FlattenedTaxonomyRow {
  tag: Tag;
  depth: number; // 0 = root, 1 = child, 2 = grandchild
  hasChildren: boolean;
  isExpanded: boolean;
  matchedDirectly: boolean;
  effectiveColor: string;
  breadcrumb: string;
}

export interface FlattenTaxonomyOptions {
  hideEmpty?: boolean;
  selectedIds?: ReadonlySet<number>;
  excludedIds?: ReadonlySet<number>;
  sortSelectedFirst?: boolean;
}

function tagMatchesSearch(tag: Tag, needle: string, breadcrumb: string): boolean {
  if (!needle) return true;
  if (tag.name.toLowerCase().includes(needle)) return true;
  if (breadcrumb.toLowerCase().includes(needle)) return true;
  if (Array.isArray(tag.aliases)) {
    for (const alias of tag.aliases) {
      if (alias.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

export function flattenTaxonomyTree(
  tags: readonly Tag[],
  facetSlug: TaxonomyFacetSlug,
  expandedIds: ReadonlySet<number>,
  searchNeedle: string,
  options?: FlattenTaxonomyOptions & { facets?: readonly TagFacet[] }
): FlattenedTaxonomyRow[] {
  const facets = options?.facets;
  const facetTags = tags.filter((t) => resolveTagFacetSlug(t, facets) === facetSlug);
  if (facetTags.length === 0) return [];

  const index = buildTaxonomyIndex(facetTags, facets);
  const needle = searchNeedle.trim().toLowerCase();
  const hideEmpty = options?.hideEmpty ?? false;
  const selectedIds = options?.selectedIds;
  const excludedIds = options?.excludedIds;
  const sortSelectedFirst = options?.sortSelectedFirst ?? false;

  const isPinned = (id: number): boolean =>
    Boolean(selectedIds?.has(id) || excludedIds?.has(id));

  const visibleSubtreeCache = new Map<number, boolean>();
  const directMatchCache = new Map<number, boolean>();

  const computeVisibility = (tag: Tag): boolean => {
    const cached = visibleSubtreeCache.get(tag.id);
    if (cached !== undefined) return cached;

    const breadcrumb = index.breadcrumbByTagId.get(tag.id) ?? tag.name;
    const direct = tagMatchesSearch(tag, needle, breadcrumb);
    directMatchCache.set(tag.id, direct);

    const children = index.childrenByParentId.get(tag.id) ?? [];
    let anyChildVisible = false;
    for (const child of children) {
      if (computeVisibility(child)) {
        anyChildVisible = true;
      }
    }

    const rollup = getTagRollupCount(tag);
    const passesEmpty =
      !hideEmpty || rollup > 0 || isPinned(tag.id) || anyChildVisible;
    const visible = passesEmpty && (needle ? direct || anyChildVisible : true);
    visibleSubtreeCache.set(tag.id, visible);
    return visible;
  };

  const roots = [...(index.childrenByParentId.get(null) ?? [])];
  for (const root of roots) {
    computeVisibility(root);
  }

  const sortNodes = (nodes: Tag[]): Tag[] => {
    const copy = [...nodes];
    copy.sort((a, b) => {
      if (sortSelectedFirst) {
        const aPin = isPinned(a.id) ? 1 : 0;
        const bPin = isPinned(b.id) ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
      }
      return compareSiblingTags(a, b);
    });
    return copy;
  };

  const out: FlattenedTaxonomyRow[] = [];
  const walk = (nodes: Tag[], depth: number) => {
    for (const tag of sortNodes(nodes)) {
      if (!visibleSubtreeCache.get(tag.id)) continue;
      const children = (index.childrenByParentId.get(tag.id) ?? []).filter(
        (c) => visibleSubtreeCache.get(c.id)
      );
      const hasChildren = children.length > 0;
      const isExpanded =
        hasChildren && (needle.length > 0 || expandedIds.has(tag.id));
      out.push({
        tag,
        depth,
        hasChildren,
        isExpanded,
        matchedDirectly: directMatchCache.get(tag.id) ?? true,
        effectiveColor: index.effectiveColorByTagId.get(tag.id) ?? tag.color,
        breadcrumb: index.breadcrumbByTagId.get(tag.id) ?? tag.name,
      });
      if (hasChildren && isExpanded) {
        walk(children, depth + 1);
      }
    }
  };

  walk(roots, 0);
  return out;
}

/**
 * Selects up to `maxCount` high-signal leaf & flat (`#Source`) tags for the Toolbar
 * Quick Tag Cloud, keeping parent category containers (`Foley`, `Animals`, etc.) out
 * of the flat quick-refinement bar whenever concrete leaf tags exist.
 */
export function buildDistinctiveTopTags(
  tags: readonly Tag[],
  totalViewSamples: number,
  maxCount = 8,
  facets?: readonly TagFacet[]
): Tag[] {
  const index = getSharedTaxonomyIndex(tags, facets);
  const candidates = tags.filter((t) => {
    const domain = index.domainByTagId.get(t.id) ?? "tags";
    return domain === "tags" && getTagRollupCount(t) > 0;
  });
  if (candidates.length === 0) return [];

  const leafCandidates = candidates.filter(
    (t) => (index.childrenByParentId.get(t.id)?.length ?? 0) === 0
  );
  const effectiveCandidates =
    leafCandidates.length > 0 ? leafCandidates : candidates;

  const scored = effectiveCandidates.map((tag) => {
    const count = getTagRollupCount(tag);
    const ratio = totalViewSamples > 0 ? count / totalViewSamples : 0;
    const isOverlyBroad = totalViewSamples >= 20 && ratio > 0.85;
    return {
      tag,
      isOverlyBroad,
      score: count,
    };
  });

  const nonBroad = scored.filter((item) => !item.isOverlyBroad);
  const pool = nonBroad.length >= Math.min(3, scored.length) ? nonBroad : scored;
  pool.sort((a, b) => b.score - a.score || a.tag.name.localeCompare(b.tag.name));
  return pool.slice(0, maxCount).map((item) => item.tag);
}

/**
 * Returns valid parent candidates inside `targetFacetSlug` (defaulting to the tag's own facet)
 * when reparenting `tagId`, excluding itself, its descendants, and any parent that would exceed
 * `MAX_TAXONOMY_DEPTH`.
 */
export function getValidParentCandidates(
  tags: readonly Tag[],
  tagId: number,
  targetFacetSlug?: TaxonomyFacetSlug,
  facets?: readonly TagFacet[]
): Tag[] {
  const index = getSharedTaxonomyIndex(tags, facets);
  const currentTag = index.byId.get(tagId);
  const targetFacet =
    targetFacetSlug ?? (currentTag ? resolveTagFacetSlug(currentTag, facets) : "category");
  if (!isFacetHierarchical(targetFacet, facets)) {
    return [];
  }
  const forbidden = new Set<number>(index.descendantsByTagId.get(tagId) ?? [tagId]);

  const subtreeHeight = (id: number): number => {
    const children = index.childrenByParentId.get(id) ?? [];
    if (children.length === 0) return 1;
    let best = 0;
    for (const c of children) {
      best = Math.max(best, subtreeHeight(c.id));
    }
    return 1 + best;
  };
  const myHeight = subtreeHeight(tagId);

  return tags
    .filter((candidate) => {
      if (resolveTagFacetSlug(candidate, facets) !== targetFacet) return false;
      if (forbidden.has(candidate.id)) return false;
      const candidateDepth = index.depthByTagId.get(candidate.id) ?? 1;
      return candidateDepth + myHeight <= MAX_TAXONOMY_DEPTH;
    })
    .sort((a, b) =>
      (index.breadcrumbByTagId.get(a.id) ?? a.name).localeCompare(
        index.breadcrumbByTagId.get(b.id) ?? b.name
      )
    );
}
