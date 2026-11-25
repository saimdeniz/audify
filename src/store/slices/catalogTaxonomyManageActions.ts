import { invoke } from "@tauri-apps/api/core";
import type {
  Genre,
  Tag,
  TagFacet,
  TaxonomyDomain,
  TaxonomyFacetSlug,
} from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import type { StoreSliceContext } from "../types";

export function createCatalogTaxonomyManageActions(ctx: StoreSliceContext) {
  const { set, get, emitNotice } = ctx;

  return {
    createTagFacet: async (
      name: string,
      domain: TaxonomyDomain,
      color: string,
      allowNesting: boolean
    ): Promise<TagFacet | null> => {
      const trimmed = name.trim();
      if (!trimmed) {
        emitNotice("Facet name cannot be empty", "error");
        return null;
      }
      try {
        const created = await invokeCommand("create_tag_facet", {
          name: trimmed,
          domain,
          color,
          allowNesting,
        });
        await get().refreshSidebarData();
        set({
          statusMessage: `Created ${allowNesting ? "nested" : "flat"} facet "${created.name}"`,
        });
        return created;
      } catch (err) {
        console.error("Failed to create tag facet:", err);
        emitNotice(`Create facet error: ${String(err)}`, "error");
        return null;
      }
    },

    updateTagFacet: async (
      facetId: number,
      patch: { name?: string; color?: string; allowNesting?: boolean }
    ): Promise<TagFacet | null> => {
      try {
        const updated = await invokeCommand("update_tag_facet", {
          facetId,
          name: patch.name ?? null,
          color: patch.color ?? null,
          allowNesting: patch.allowNesting ?? null,
        });
        await get().refreshAfterCatalogMutation();
        set({ statusMessage: `Updated facet "${updated.name}"` });
        return updated;
      } catch (err) {
        console.error("Failed to update tag facet:", err);
        emitNotice(`Update facet error: ${String(err)}`, "error");
        return null;
      }
    },

    deleteTagFacet: async (facetId: number): Promise<number | null> => {
      try {
        const target = get().tagFacets.find((f) => f.id === facetId);
        const migrated = await invokeCommand("delete_tag_facet", { facetId });
        await get().refreshAfterCatalogMutation();
        const fallbackLabel =
          target?.domain === "genres" ? "Genre" : "Category";
        set({
          statusMessage:
            migrated > 0
              ? `Deleted facet "${target?.name ?? ""}" (${migrated} item${migrated === 1 ? "" : "s"} moved to ${fallbackLabel})`
              : `Deleted facet "${target?.name ?? ""}"`,
        });
        return migrated;
      } catch (err) {
        console.error("Failed to delete tag facet:", err);
        emitNotice(`Delete facet error: ${String(err)}`, "error");
        return null;
      }
    },

    reorderTagFacets: async (orderedFacetIds: number[]) => {
      if (orderedFacetIds.length === 0) return;
      try {
        await invokeCommand("reorder_tag_facets", { orderedFacetIds });
        await get().refreshSidebarData();
      } catch (err) {
        console.error("Failed to reorder facets:", err);
        emitNotice(`Reorder facet error: ${String(err)}`, "error");
      }
    },

    reorderTaxonomyItems: async (orderedTagIds: number[]) => {
      if (orderedTagIds.length === 0) return;
      try {
        await invokeCommand("reorder_taxonomy_items", { orderedTagIds });
        await get().refreshSidebarData();
      } catch (err) {
        console.error("Failed to reorder taxonomy items:", err);
        emitNotice(`Reorder taxonomy error: ${String(err)}`, "error");
      }
    },

    harmonizeTaxonomyColors: async (opts: {
      facetSlug?: TaxonomyFacetSlug;
      parentTagId?: number;
    }) => {
      try {
        const updated = await invokeCommand("harmonize_taxonomy_colors", {
          facetSlug: opts.facetSlug ?? null,
          parentTagId: opts.parentTagId ?? null,
        });
        await get().refreshAfterCatalogMutation();
        if (updated > 0) {
          emitNotice(
            `Harmonized ${updated} sub-item color${updated === 1 ? "" : "s"} to parent shades`,
            "success"
          );
        }
        return updated;
      } catch (err) {
        console.error("Failed to harmonize taxonomy colors:", err);
        emitNotice(`Color harmonize error: ${String(err)}`, "error");
        return 0;
      }
    },

    renameTag: async (tagId: number, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        emitNotice("Tag name cannot be empty", "error");
        return;
      }
      const prevTag = get().tags.find((t) => t.id === tagId);
      const conflict = get().tags.find(
        (t) =>
          t.id !== tagId && t.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (conflict) {
        emitNotice(`Tag "${conflict.name}" already exists`, "error");
        return;
      }
      try {
        const updated = await invoke<Tag>("rename_tag", {
          tagId,
          newName: trimmed,
        });

        let syncedRules = false;
        if (prevTag) {
          const prevLower = prevTag.name.trim().toLowerCase();
          const currentRules = get().autoTagRules;
          if (
            currentRules.some(
              (r) => r.tag_name.trim().toLowerCase() === prevLower
            )
          ) {
            syncedRules = true;
            set({
              autoTagRules: currentRules.map((r) =>
                r.tag_name.trim().toLowerCase() === prevLower
                  ? { ...r, tag_name: updated.name }
                  : r
              ),
            });
          }
        }
        if (syncedRules) {
          await get().persistActiveProfileSettings(true);
        }

        await get().refreshAfterCatalogMutation();
        set({ statusMessage: `Renamed tag to "${updated.name}"` });
      } catch (err) {
        console.error("Failed to rename tag:", err);
        emitNotice(`Rename tag error: ${String(err)}`, "error");
      }
    },

    updateTagColor: async (tagId: number, newColor: string) => {
      try {
        const prevTag = get().tags.find((t) => t.id === tagId);
        const updated = await invoke<Tag>("update_tag_color", {
          tagId,
          newColor,
        });
        if (prevTag) {
          const prevLower = prevTag.name.trim().toLowerCase();
          const currentRules = get().autoTagRules;
          if (
            currentRules.some(
              (r) => r.tag_name.trim().toLowerCase() === prevLower
            )
          ) {
            set({
              autoTagRules: currentRules.map((r) =>
                r.tag_name.trim().toLowerCase() === prevLower
                  ? { ...r, tag_color: updated.color }
                  : r
              ),
            });
            await get().persistActiveProfileSettings(true);
          }
        }
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to update tag color:", err);
        emitNotice(`Update tag color error: ${String(err)}`, "error");
      }
    },

    updateTagTaxonomy: async (
      tagId: number,
      patch: {
        facetSlug?: TaxonomyFacetSlug;
        parentId?: number | null;
        clearParent?: boolean;
        colorInherited?: boolean;
        aliases?: string[];
        sortOrder?: number;
      }
    ): Promise<Tag | null> => {
      try {
        const updated = await invokeCommand("update_tag_taxonomy", {
          tagId,
          facetSlug: patch.facetSlug ?? null,
          parentId: patch.parentId ?? null,
          clearParent: patch.clearParent ?? null,
          colorInherited: patch.colorInherited ?? null,
          aliases: patch.aliases ?? null,
          sortOrder: patch.sortOrder ?? null,
        });
        await get().refreshAfterCatalogMutation();
        set({ statusMessage: `Updated taxonomy for "${updated.name}"` });
        return updated;
      } catch (err) {
        console.error("Failed to update tag taxonomy:", err);
        emitNotice(`Update taxonomy error: ${String(err)}`, "error");
        return null;
      }
    },

    mergeTags: async (
      sourceTagId: number,
      targetTagId: number,
      addSourceAsAlias = true
    ): Promise<Tag | null> => {
      if (sourceTagId === targetTagId) return null;
      try {
        const merged = await invokeCommand("merge_tags", {
          sourceTagId,
          targetTagId,
          addSourceAsAlias,
        });
        set((state) => ({
          selectedTagIds: state.selectedTagIds.filter((id) => id !== sourceTagId),
          excludedTagIds: state.excludedTagIds.filter((id) => id !== sourceTagId),
          statusMessage: `Merged into "${merged.name}"`,
        }));
        await get().refreshAfterCatalogMutation();
        return merged;
      } catch (err) {
        console.error("Failed to merge tags:", err);
        emitNotice(`Merge tag error: ${String(err)}`, "error");
        return null;
      }
    },

    deleteTag: async (tagId: number) => {
      try {
        await invoke("delete_tag", { tagId });
        set((state) => ({
          selectedTagIds: state.selectedTagIds.filter((id) => id !== tagId),
          excludedTagIds: state.excludedTagIds.filter((id) => id !== tagId),
          statusMessage: "Tag deleted",
        }));
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to delete tag:", err);
        emitNotice(`Delete tag error: ${String(err)}`, "error");
      }
    },

    createGenre: async (
      name: string,
      color: string,
      facetSlug: TaxonomyFacetSlug = "genre"
    ) => {
      const trimmed = name.trim();
      if (!trimmed) {
        emitNotice("Genre name cannot be empty", "error");
        return null;
      }
      const existing = get().genres.find(
        (g) => g.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) {
        emitNotice(`"${existing.name}" already exists`, "info");
        return existing;
      }
      try {
        const created = await invoke<Genre>("create_genre", {
          name: trimmed,
          color: color || (facetSlug === "mood" ? "#EC4899" : "#3B82F6"),
          facetSlug,
        });
        await get().refreshSidebarData();
        set({
          statusMessage: `Created ${facetSlug === "mood" ? "mood" : "genre"} "${created.name}"`,
        });
        return created;
      } catch (err) {
        console.error("Failed to create genre:", err);
        emitNotice(`Create genre error: ${String(err)}`, "error");
        return null;
      }
    },

    renameGenre: async (genreId: number, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        emitNotice("Genre name cannot be empty", "error");
        return;
      }
      const conflict = get().genres.find(
        (g) =>
          g.id !== genreId &&
          g.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (conflict) {
        emitNotice(`Genre "${conflict.name}" already exists`, "error");
        return;
      }
      try {
        const prevGenre = get().genres.find((g) => g.id === genreId);
        const updated = await invoke<Genre>("rename_genre", {
          genreId,
          newName: trimmed,
        });
        set((state) => ({
          selectedGenre:
            prevGenre &&
            state.selectedGenre &&
            state.selectedGenre.toLowerCase() === prevGenre.name.toLowerCase()
              ? updated.name
              : state.selectedGenre,
          statusMessage: `Renamed genre to "${updated.name}"`,
        }));
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to rename genre:", err);
        emitNotice(`Rename genre error: ${String(err)}`, "error");
      }
    },

    updateGenreColor: async (genreId: number, newColor: string) => {
      try {
        await invoke<Genre>("update_genre_color", { genreId, newColor });
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to update genre color:", err);
        emitNotice(`Update genre color error: ${String(err)}`, "error");
      }
    },

    deleteGenre: async (genreId: number) => {
      try {
        const prevGenre = get().genres.find((g) => g.id === genreId);
        await invoke("delete_genre", { genreId });
        set((state) => ({
          selectedGenre:
            prevGenre &&
            state.selectedGenre &&
            state.selectedGenre.toLowerCase() === prevGenre.name.toLowerCase()
              ? null
              : state.selectedGenre,
          selectedTagIds: state.selectedTagIds.filter((id) => id !== genreId),
          excludedTagIds: state.excludedTagIds.filter((id) => id !== genreId),
          statusMessage: "Genre deleted",
        }));
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to delete genre:", err);
        emitNotice(`Delete genre error: ${String(err)}`, "error");
      }
    },

    autoDetectGenres: async () => {
      if (get().isDetectingGenres) return;
      set({
        isDetectingGenres: true,
        genreDetectProgress: {
          stage_label: "Scanning genres",
          processed: 0,
          total: 0,
          percentage: 0,
          current_item: "",
          matched_count: 0,
          done: false,
        },
        statusMessage:
          "Scanning audio file metadata (ID3 / Vorbis / RIFF) & folders for genres & moods...",
      });
      try {
        const updatedCount = await invoke<number>("auto_detect_library_genres");
        await get().refreshAfterCatalogMutation();
        const msg =
          updatedCount > 0
            ? `Auto-detected genre/mood metadata for ${updatedCount.toLocaleString()} tracks`
            : "Genre & Mood scan complete (all detectable tracks already classified)";
        set({
          isDetectingGenres: false,
          genreDetectProgress: null,
          statusMessage: msg,
        });
        emitNotice(msg, updatedCount > 0 ? "success" : "info");
      } catch (err) {
        console.error("Failed to auto-detect genres:", err);
        set({ isDetectingGenres: false, genreDetectProgress: null });
        emitNotice(`Auto-detect genre error: ${String(err)}`, "error");
      }
    },
  };
}
