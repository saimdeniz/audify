import type { Tag, TagFacet, TaxonomyFacetSlug } from "../types";
import { isFacetHierarchical, resolveTagFacetSlug } from "./taxonomyTree";

type CreateTagFn = (
  name: string,
  color: string,
  opts?: {
    facetSlug?: TaxonomyFacetSlug;
    parentId?: number | null;
    colorInherited?: boolean;
    aliases?: string[];
  }
) => Promise<Tag | null>;

/**
 * Shared `Parent/Child` slash-aware taxonomy tag creator used across
 * `TaxonomyDomainSidebarTab` (`Tags` & `Genres`) and `TaxonomyPicker`.
 */
export async function createTagOrSlashHierarchy(params: {
  rawInput: string;
  color: string;
  facetSlug: TaxonomyFacetSlug;
  tags: readonly Tag[];
  tagFacets: readonly TagFacet[];
  createTag: CreateTagFn;
}): Promise<{ created: Tag | null; parentId: number | null }> {
  const { rawInput, color, facetSlug, tags, tagFacets, createTag } = params;
  const trimmed = rawInput.trim();
  if (!trimmed) return { created: null, parentId: null };

  const hierarchical = isFacetHierarchical(facetSlug, tagFacets);
  if (hierarchical && trimmed.includes("/")) {
    const parts = trimmed
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const parentName = parts[parts.length - 2];
      const leafName = parts[parts.length - 1];
      let parent =
        tags.find(
          (t) =>
            resolveTagFacetSlug(t, tagFacets) === facetSlug &&
            t.name.toLowerCase() === parentName.toLowerCase()
        ) ?? null;
      if (!parent) {
        parent = await createTag(parentName, color, { facetSlug });
      }
      const parentId = parent?.id ?? null;
      const created = await createTag(leafName, color, {
        facetSlug,
        parentId,
        colorInherited: parentId !== null || facetSlug === "source",
      });
      return { created, parentId };
    }
  }

  const created = await createTag(trimmed, color, {
    facetSlug,
    colorInherited: facetSlug === "source",
  });
  return { created, parentId: null };
}
