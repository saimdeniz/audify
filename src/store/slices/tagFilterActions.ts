import type { TagMatchMode, TaxonomyFacetSlug } from "../../types";
import { resolveTagFacetSlug } from "../../utils/taxonomyTree";
import type { StoreSliceContext } from "../types";

export function createTagFilterActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter } = ctx;

  return {
    toggleTagFilter: (tagId: number) => {
      const { selectedTagIds: current, excludedTagIds } = get();
      const exists = current.includes(tagId);
      const next = exists ? current.filter((id) => id !== tagId) : [...current, tagId];
      const nextExcluded = exists
        ? excludedTagIds
        : excludedTagIds.filter((id) => id !== tagId);
      set({ selectedTagIds: next, excludedTagIds: nextExcluded });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    selectOrToggleTagFilter: (tagId: number, append: boolean) => {
      const { selectedTagIds: current, excludedTagIds, tags, tagFacets } = get();
      let next: number[];
      if (append) {
        next = current.includes(tagId)
          ? current.filter((id) => id !== tagId)
          : [...current, tagId];
      } else {
        // Single-click replaces selection within the SAME facet while preserving other facets for cross-facet AND
        const targetTag = tags.find((t) => t.id === tagId);
        const targetFacet = targetTag
          ? resolveTagFacetSlug(targetTag, tagFacets)
          : "category";
        const tagFacetById = new Map<number, TaxonomyFacetSlug>();
        for (const t of tags) {
          tagFacetById.set(t.id, resolveTagFacetSlug(t, tagFacets));
        }
        const sameFacetSelected = current.filter(
          (id) => (tagFacetById.get(id) ?? "category") === targetFacet
        );
        const otherFacetSelected = current.filter(
          (id) => (tagFacetById.get(id) ?? "category") !== targetFacet
        );
        if (sameFacetSelected.length === 1 && sameFacetSelected[0] === tagId) {
          next = otherFacetSelected;
        } else {
          next = [...otherFacetSelected, tagId];
        }
      }
      const nextExcluded = excludedTagIds.filter((id) => id !== tagId);
      set({ selectedTagIds: next, excludedTagIds: nextExcluded });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    toggleExcludeTagFilter: (tagId: number) => {
      const { selectedTagIds, excludedTagIds } = get();
      const alreadyExcluded = excludedTagIds.includes(tagId);
      const nextExcluded = alreadyExcluded
        ? excludedTagIds.filter((id) => id !== tagId)
        : [...excludedTagIds, tagId];
      const nextSelected = alreadyExcluded
        ? selectedTagIds
        : selectedTagIds.filter((id) => id !== tagId);
      set({ selectedTagIds: nextSelected, excludedTagIds: nextExcluded });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    setTagMatchMode: (mode: TagMatchMode) => {
      if (get().tagMatchMode === mode) return;
      set({ tagMatchMode: mode });
      if (get().selectedTagIds.length > 0) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      }
    },

    toggleTagMatchMode: () => {
      const next: TagMatchMode = get().tagMatchMode === "all" ? "any" : "all";
      set({ tagMatchMode: next });
      if (get().selectedTagIds.length > 0) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      }
    },

    clearExcludedTagFilters: () => {
      if (get().excludedTagIds.length === 0) return;
      set({ excludedTagIds: [] });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },

    clearTagFilters: (facetSlugs?: readonly TaxonomyFacetSlug[]) => {
      if (!facetSlugs || facetSlugs.length === 0) {
        set({ selectedTagIds: [], excludedTagIds: [], tagMatchMode: "all" });
      } else {
        const dropSet = new Set<TaxonomyFacetSlug>(facetSlugs);
        const { selectedTagIds, excludedTagIds, tags, tagFacets } = get();
        const facetMap = new Map<number, TaxonomyFacetSlug>();
        for (const t of tags) {
          facetMap.set(t.id, resolveTagFacetSlug(t, tagFacets));
        }
        const keep = (id: number) => !dropSet.has(facetMap.get(id) ?? "category");
        set({
          selectedTagIds: selectedTagIds.filter(keep),
          excludedTagIds: excludedTagIds.filter(keep),
        });
      }
      if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
        void get().fetchSamples({ preserveMultiSelect: true });
      }
    },
  };
}
