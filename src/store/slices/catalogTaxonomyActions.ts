import { invoke } from "@tauri-apps/api/core";
import type {
  SampleItem,
  SampleTagBadge,
  Tag,
  TagFacet,
  TaxonomyFacetSlug,
} from "../../types";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  resolveFacetDomain,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";
import type { SampleStoreState, StoreSliceContext } from "../types";
import { createCatalogTaxonomyManageActions } from "./catalogTaxonomyManageActions";

function hasActiveDynamicTaxonomyFilter(
  state: SampleStoreState,
  kind: "tag" | "genre"
): boolean {
  if (state.selectedTagIds.length > 0 || state.excludedTagIds.length > 0) {
    return true;
  }
  if (kind === "genre" && Boolean(state.selectedGenre)) return true;
  if (state.searchQuery.trim().length > 0) return true;
  if (state.selectedCollectionId !== null) {
    const activeCol = state.collections.find(
      (c) => c.id === state.selectedCollectionId
    );
    if (activeCol?.smart_query?.trim()) return true;
  }
  return false;
}

function mapSampleTagOrGenre(
  state: SampleStoreState,
  updater: (s: SampleItem) => SampleItem
) {
  return {
    allProfileSamples: state.allProfileSamples.map(updater),
    rawSamples: state.rawSamples.map(updater),
    samples: state.samples.map(updater),
    selectedSample: state.selectedSample
      ? updater(state.selectedSample)
      : null,
  };
}

function derivePrimaryGenreFromBadges(
  badges: readonly SampleTagBadge[],
  allTags: readonly Tag[],
  facets: readonly TagFacet[]
): string {
  const facetById = new Map<number, TaxonomyFacetSlug>();
  for (const t of allTags) {
    facetById.set(t.id, resolveTagFacetSlug(t, facets));
  }
  let moodFallback = "";
  let customGenreFallback = "";
  for (const b of badges) {
    const f = facetById.get(b.id);
    if (!f) continue;
    if (f === "genre") return b.name;
    if (f === "mood" && !moodFallback) moodFallback = b.name;
    else if (
      resolveFacetDomain(f, facets) === "genres" &&
      !customGenreFallback
    ) {
      customGenreFallback = b.name;
    }
  }
  return moodFallback || customGenreFallback;
}

export function createCatalogTaxonomyActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  const isGenreOrMoodTag = (tagId: number): boolean => {
    const { tags, tagFacets } = get();
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) return false;
    return resolveFacetDomain(resolveTagFacetSlug(tag, tagFacets), tagFacets) === "genres";
  };

  return {
    ...createCatalogTaxonomyManageActions(ctx),

    createTag: async (
      name: string,
      color: string,
      opts?: {
        facetSlug?: TaxonomyFacetSlug;
        parentId?: number | null;
        colorInherited?: boolean;
        aliases?: string[];
      }
    ) => {
      const trimmed = name.trim();
      if (!trimmed) {
        emitNotice("Tag name cannot be empty", "error");
        return null;
      }
      const existing = get().tags.find(
        (t) => t.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) {
        emitNotice(`Tag "${existing.name}" already exists`, "info");
        return existing;
      }
      try {
        const created = await invoke<Tag>("create_tag", {
          name: trimmed,
          color: color || "#64748B",
          facetSlug: opts?.facetSlug ?? null,
          parentId: opts?.parentId ?? null,
          colorInherited: opts?.colorInherited ?? null,
          aliases: opts?.aliases ?? null,
        });
        await get().refreshSidebarData();
        set({ statusMessage: `Created tag "${created.name}"` });
        return created;
      } catch (err) {
        console.error("Failed to create tag:", err);
        emitNotice(`Create tag error: ${String(err)}`, "error");
        return null;
      }
    },

    assignTag: async (sampleId: number, tagId: number) => {
      try {
        const updatedBadges = await invoke<SampleTagBadge[]>("assign_tag", {
          sampleId,
          tagId,
        });
        clearSmartSearchCache();
        const affectsGenre = isGenreOrMoodTag(tagId);
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const nextGenre = affectsGenre
          ? derivePrimaryGenreFromBadges(updatedBadges, allTags, allFacets)
          : null;
        set((state) =>
          mapSampleTagOrGenre(state, (s) =>
            s.id === sampleId
              ? {
                  ...s,
                  tags: updatedBadges,
                  ...(nextGenre !== null ? { genre: nextGenre } : {}),
                }
              : s
          )
        );
        await get().refreshSidebarData();
        if (hasActiveDynamicTaxonomyFilter(get(), affectsGenre ? "genre" : "tag")) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to assign tag:", err);
        emitNotice(`Assign tag error: ${String(err)}`, "error");
      }
    },

    unassignTag: async (sampleId: number, tagId: number) => {
      try {
        const updatedBadges = await invoke<SampleTagBadge[]>("unassign_tag", {
          sampleId,
          tagId,
        });
        clearSmartSearchCache();
        const affectsGenre = isGenreOrMoodTag(tagId);
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const nextGenre = affectsGenre
          ? derivePrimaryGenreFromBadges(updatedBadges, allTags, allFacets)
          : null;
        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) =>
            s.id === sampleId
              ? {
                  ...s,
                  tags: updatedBadges,
                  ...(nextGenre !== null ? { genre: nextGenre } : {}),
                }
              : s
          ),
          statusMessage: affectsGenre
            ? "Genre/mood removed from sample"
            : "Tag removed from sample",
        }));
        await get().refreshSidebarData();
        if (hasActiveDynamicTaxonomyFilter(get(), affectsGenre ? "genre" : "tag")) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to unassign tag:", err);
        emitNotice(`Remove tag error: ${String(err)}`, "error");
      }
    },

    assignTagBatch: async (sampleIds: number[], tagId: number) => {
      if (sampleIds.length === 0) return;
      try {
        await invokeCommand("assign_tag_batch", { sampleIds, tagId });
        clearSmartSearchCache();
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const tag = allTags.find((t) => t.id === tagId);
        const affectsGenre = tag
          ? resolveFacetDomain(resolveTagFacetSlug(tag, allFacets), allFacets) === "genres"
          : false;
        if (tag) {
          const idSet = new Set(sampleIds);
          const badge: SampleTagBadge = {
            id: tag.id,
            name: tag.name,
            color: tag.effective_color || tag.color,
          };
          set((state) => ({
            ...mapSampleTagOrGenre(state, (s) => {
              if (!idSet.has(s.id)) return s;
              const existing = s.tags ?? [];
              if (existing.some((t) => t.id === tagId)) return s;
              const nextBadges = [...existing, badge];
              return {
                ...s,
                tags: nextBadges,
                ...(affectsGenre
                  ? {
                      genre: derivePrimaryGenreFromBadges(
                        nextBadges,
                        allTags,
                        allFacets
                      ),
                    }
                  : {}),
              };
            }),
            statusMessage: `Assigned "${tag.name}" to ${sampleIds.length} samples`,
          }));
          await get().refreshSidebarData();
          if (
            hasActiveDynamicTaxonomyFilter(get(), affectsGenre ? "genre" : "tag")
          ) {
            if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
              await get().fetchSamples({ preserveMultiSelect: true });
            }
          }
        } else {
          await get().refreshAfterCatalogMutation();
          const refreshedTag = get().tags.find((t) => t.id === tagId);
          set({
            statusMessage: `Assigned "${refreshedTag?.name || tagId}" to ${sampleIds.length} samples`,
          });
        }
      } catch (err) {
        console.error("Failed to assign tag in batch:", err);
        emitNotice(`Batch tag error: ${String(err)}`, "error");
      }
    },

    unassignTagBatch: async (sampleIds: number[], tagId: number) => {
      if (sampleIds.length === 0) return;
      try {
        await invokeCommand("unassign_tag_batch", { sampleIds, tagId });
        clearSmartSearchCache();
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const tag = allTags.find((t) => t.id === tagId);
        const affectsGenre = tag
          ? resolveFacetDomain(resolveTagFacetSlug(tag, allFacets), allFacets) === "genres"
          : false;
        const idSet = new Set(sampleIds);
        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) => {
            if (!idSet.has(s.id)) return s;
            const nextBadges = (s.tags ?? []).filter((t) => t.id !== tagId);
            return {
              ...s,
              tags: nextBadges,
              ...(affectsGenre
                ? {
                    genre: derivePrimaryGenreFromBadges(
                      nextBadges,
                      allTags,
                      allFacets
                    ),
                  }
                : {}),
            };
          }),
          statusMessage: tag
            ? `Removed "${tag.name}" from ${sampleIds.length} samples`
            : `Removed tag from ${sampleIds.length} samples`,
        }));
        await get().refreshSidebarData();
        if (hasActiveDynamicTaxonomyFilter(get(), affectsGenre ? "genre" : "tag")) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to remove tag in batch:", err);
        emitNotice(`Batch remove tag error: ${String(err)}`, "error");
      }
    },

    clearSampleTags: async (
      sampleIds: number[],
      facetSlugs?: TaxonomyFacetSlug[]
    ) => {
      if (sampleIds.length === 0) return;
      try {
        await invokeCommand("clear_sample_tags_batch", {
          sampleIds,
          facetSlugs: facetSlugs ?? null,
        });
        clearSmartSearchCache();
        const idSet = new Set(sampleIds);
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const facetMap = new Map<number, TaxonomyFacetSlug>();
        for (const t of allTags) {
          facetMap.set(t.id, resolveTagFacetSlug(t, allFacets));
        }
        const dropFacets =
          facetSlugs && facetSlugs.length > 0 ? new Set(facetSlugs) : null;
        const affectsGenre =
          !dropFacets ||
          Array.from(dropFacets).some(
            (slug) => resolveFacetDomain(slug, allFacets) === "genres"
          );

        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) => {
            if (!idSet.has(s.id)) return s;
            const nextBadges = dropFacets
              ? (s.tags ?? []).filter(
                  (b) => !dropFacets.has(facetMap.get(b.id) ?? "category")
                )
              : [];
            return {
              ...s,
              tags: nextBadges,
              ...(affectsGenre
                ? {
                    genre: derivePrimaryGenreFromBadges(
                      nextBadges,
                      allTags,
                      allFacets
                    ),
                  }
                : {}),
            };
          }),
          statusMessage:
            sampleIds.length > 1
              ? `Cleared ${dropFacets && affectsGenre && !dropFacets.has("category") ? "genres & moods" : "tags"} from ${sampleIds.length} samples`
              : `Cleared ${dropFacets && affectsGenre && !dropFacets.has("category") ? "genres & moods" : "tags"} from sample`,
        }));
        await get().refreshSidebarData();
        if (hasActiveDynamicTaxonomyFilter(get(), affectsGenre ? "genre" : "tag")) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to clear sample tags:", err);
        emitNotice(`Clear tags error: ${String(err)}`, "error");
      }
    },

    assignGenre: async (sampleId: number, genreName: string) => {
      try {
        const updatedGenre = await invoke<string>("assign_sample_genre", {
          sampleId,
          genreName,
        });
        clearSmartSearchCache();
        await get().refreshSidebarData();
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const matchedTag = updatedGenre
          ? allTags.find(
              (t) =>
                t.name.toLowerCase() === updatedGenre.toLowerCase() &&
                resolveFacetDomain(resolveTagFacetSlug(t, allFacets), allFacets) ===
                  "genres"
            )
          : null;
        const facetMap = new Map<number, TaxonomyFacetSlug>();
        for (const t of allTags) {
          facetMap.set(t.id, resolveTagFacetSlug(t, allFacets));
        }

        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) => {
            if (s.id !== sampleId) return s;
            const nonGenreTags = (s.tags ?? []).filter((b) => {
              const f = facetMap.get(b.id) ?? "category";
              return resolveFacetDomain(f, allFacets) !== "genres";
            });
            const nextBadges = matchedTag
              ? [
                  ...nonGenreTags,
                  {
                    id: matchedTag.id,
                    name: matchedTag.name,
                    color: matchedTag.effective_color || matchedTag.color,
                  },
                ]
              : nonGenreTags;
            return { ...s, genre: updatedGenre, tags: nextBadges };
          }),
          statusMessage: updatedGenre
            ? `Assigned genre "${updatedGenre}"`
            : "Cleared sample genre",
        }));
        if (hasActiveDynamicTaxonomyFilter(get(), "genre")) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to assign genre:", err);
        emitNotice(`Assign genre error: ${String(err)}`, "error");
      }
    },

    assignGenreBatch: async (sampleIds: number[], genreName: string) => {
      if (sampleIds.length === 0) return;
      try {
        const updatedGenre = await invokeCommand("assign_sample_genre_batch", {
          sampleIds,
          genreName,
        });
        clearSmartSearchCache();
        await get().refreshSidebarData();
        const allTags = get().tags;
        const allFacets = get().tagFacets;
        const matchedTag = updatedGenre
          ? allTags.find(
              (t) =>
                t.name.toLowerCase() === updatedGenre.toLowerCase() &&
                resolveFacetDomain(resolveTagFacetSlug(t, allFacets), allFacets) ===
                  "genres"
            )
          : null;
        const facetMap = new Map<number, TaxonomyFacetSlug>();
        for (const t of allTags) {
          facetMap.set(t.id, resolveTagFacetSlug(t, allFacets));
        }
        const idSet = new Set(sampleIds);

        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) => {
            if (!idSet.has(s.id)) return s;
            const nonGenreTags = (s.tags ?? []).filter((b) => {
              const f = facetMap.get(b.id) ?? "category";
              return resolveFacetDomain(f, allFacets) !== "genres";
            });
            const nextBadges = matchedTag
              ? [
                  ...nonGenreTags,
                  {
                    id: matchedTag.id,
                    name: matchedTag.name,
                    color: matchedTag.effective_color || matchedTag.color,
                  },
                ]
              : nonGenreTags;
            return { ...s, genre: updatedGenre, tags: nextBadges };
          }),
          statusMessage: updatedGenre
            ? `Assigned genre "${updatedGenre}" to ${sampleIds.length} samples`
            : `Cleared genre on ${sampleIds.length} samples`,
        }));
        if (hasActiveDynamicTaxonomyFilter(get(), "genre")) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to batch assign genre:", err);
        emitNotice(`Batch genre error: ${String(err)}`, "error");
      }
    },
  };
}
