import type { TagFacet } from "../types";
import {
  isFacetHierarchical,
  MAX_TAXONOMY_DEPTH,
  resolveTagFacetSlug,
  type TaxonomyIndex,
} from "./taxonomyTree";

/**
 * Single source of truth for validating pointer drag-and-drop taxonomy moves across
 * Settings (`Tags & Rules -> Library`, `Genres`) and Main Sidebar (`Tags`, `Genres`).
 * Supports drop keys `pill:<slug>`, `sec:<slug>`, and `node:<slug>:<targetTagId>`.
 */
export function canDropTaxonomyItem(
  srcId: number,
  dropKey: string,
  index: TaxonomyIndex,
  facets: readonly TagFacet[]
): boolean {
  const srcTag = index.byId.get(srcId);
  if (!srcTag) return false;
  if (dropKey.startsWith("pill:") || dropKey.startsWith("sec:")) {
    const targetSlug = dropKey.slice(dropKey.indexOf(":") + 1);
    const srcSlug = resolveTagFacetSlug(srcTag, facets);
    return srcSlug !== targetSlug || srcTag.parent_id != null;
  }
  if (dropKey.startsWith("node:")) {
    const parts = dropKey.split(":");
    const targetSlug = parts[1];
    const targetTagId = Number(parts[2]);
    if (!Number.isFinite(targetTagId) || targetTagId === srcId) return false;
    if (!isFacetHierarchical(targetSlug, facets)) return false;
    const descendants = index.descendantsByTagId.get(srcId) ?? [];
    if (descendants.includes(targetTagId)) return false;
    if (
      srcTag.parent_id === targetTagId &&
      resolveTagFacetSlug(srcTag, facets) === targetSlug
    ) {
      return false;
    }
    const subtreeHeight = (id: number): number => {
      const children = index.childrenByParentId.get(id) ?? [];
      if (children.length === 0) return 1;
      let best = 0;
      for (const c of children) best = Math.max(best, subtreeHeight(c.id));
      return 1 + best;
    };
    const targetDepth = index.depthByTagId.get(targetTagId) ?? 1;
    return targetDepth + subtreeHeight(srcId) <= MAX_TAXONOMY_DEPTH;
  }
  return false;
}
