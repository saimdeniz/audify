import { invoke } from "@tauri-apps/api/core";
import { Genre, SampleItem, SampleTagBadge, Tag } from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import type { SampleStoreState, StoreSliceContext } from "../types";

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

export function createCatalogTaxonomyActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  return {
    createTag: async (name: string, color: string) => {
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
          color: color || "#F59E0B",
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
        set((state) =>
          mapSampleTagOrGenre(state, (s) =>
            s.id === sampleId ? { ...s, tags: updatedBadges } : s
          )
        );
        await get().refreshSidebarData();
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
        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) =>
            s.id === sampleId ? { ...s, tags: updatedBadges } : s
          ),
          statusMessage: "Tag removed from sample",
        }));
        await get().refreshSidebarData();
        if (get().selectedTagIds.length > 0) {
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
        const tag = get().tags.find((t) => t.id === tagId);
        if (tag) {
          const idSet = new Set(sampleIds);
          const badge: SampleTagBadge = {
            id: tag.id,
            name: tag.name,
            color: tag.color,
          };
          set((state) => ({
            ...mapSampleTagOrGenre(state, (s) => {
              if (!idSet.has(s.id)) return s;
              const existing = s.tags ?? [];
              if (existing.some((t) => t.id === tagId)) return s;
              return { ...s, tags: [...existing, badge] };
            }),
            statusMessage: `Assigned tag "${tag.name}" to ${sampleIds.length} samples`,
          }));
          await get().refreshSidebarData();
          if (get().selectedTagIds.length > 0) {
            if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
              await get().fetchSamples({ preserveMultiSelect: true });
            }
          }
        } else {
          await get().refreshAfterCatalogMutation();
          const refreshedTag = get().tags.find((t) => t.id === tagId);
          set({
            statusMessage: `Assigned tag "${refreshedTag?.name || tagId}" to ${sampleIds.length} samples`,
          });
        }
      } catch (err) {
        console.error("Failed to assign tag in batch:", err);
        emitNotice(`Batch tag error: ${String(err)}`, "error");
      }
    },

    clearSampleTags: async (sampleIds: number[]) => {
      if (sampleIds.length === 0) return;
      try {
        await invokeCommand("clear_sample_tags_batch", { sampleIds });
        const idSet = new Set(sampleIds);
        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) =>
            idSet.has(s.id) ? { ...s, tags: [] } : s
          ),
          statusMessage:
            sampleIds.length > 1
              ? `Cleared tags from ${sampleIds.length} samples`
              : "Cleared tags from sample",
        }));
        await get().refreshSidebarData();
        if (get().selectedTagIds.length > 0) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to clear sample tags:", err);
        emitNotice(`Clear tags error: ${String(err)}`, "error");
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

        // Keep matching auto-tag rules synchronized with the renamed tag
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

    deleteTag: async (tagId: number) => {
      try {
        await invoke("delete_tag", { tagId });
        set((state) => ({
          selectedTagIds: state.selectedTagIds.filter((id) => id !== tagId),
          statusMessage: "Tag deleted",
        }));
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to delete tag:", err);
        emitNotice(`Delete tag error: ${String(err)}`, "error");
      }
    },

    createGenre: async (name: string, color: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        emitNotice("Genre name cannot be empty", "error");
        return null;
      }
      const existing = get().genres.find(
        (g) => g.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) {
        emitNotice(`Genre "${existing.name}" already exists`, "info");
        return existing;
      }
      try {
        const created = await invoke<Genre>("create_genre", {
          name: trimmed,
          color: color || "#F59E0B",
        });
        await get().refreshSidebarData();
        set({ statusMessage: `Created genre "${created.name}"` });
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
        await get().refreshSidebarData();
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
          statusMessage: "Genre deleted",
        }));
        await get().refreshAfterCatalogMutation();
      } catch (err) {
        console.error("Failed to delete genre:", err);
        emitNotice(`Delete genre error: ${String(err)}`, "error");
      }
    },

    assignGenre: async (sampleId: number, genreName: string) => {
      try {
        const updatedGenre = await invoke<string>("assign_sample_genre", {
          sampleId,
          genreName,
        });
        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) =>
            s.id === sampleId ? { ...s, genre: updatedGenre } : s
          ),
          statusMessage: updatedGenre
            ? `Assigned genre "${updatedGenre}"`
            : "Cleared sample genre",
        }));
        await get().refreshSidebarData();
        if (get().selectedGenre) {
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
        const idSet = new Set(sampleIds);
        set((state) => ({
          ...mapSampleTagOrGenre(state, (s) =>
            idSet.has(s.id) ? { ...s, genre: updatedGenre } : s
          ),
          statusMessage: updatedGenre
            ? `Assigned genre "${updatedGenre}" to ${sampleIds.length} samples`
            : `Cleared genre on ${sampleIds.length} samples`,
        }));
        await get().refreshSidebarData();
        if (get().selectedGenre) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
      } catch (err) {
        console.error("Failed to batch assign genre:", err);
        emitNotice(`Batch genre error: ${String(err)}`, "error");
      }
    },

    autoDetectGenres: async () => {
      if (get().isDetectingGenres) return;
      set({
        isDetectingGenres: true,
        statusMessage:
          "Scanning audio file metadata (ID3 / Vorbis / RIFF) & folders for genres...",
      });
      try {
        const updatedCount = await invoke<number>("auto_detect_library_genres");
        await get().refreshAfterCatalogMutation();
        const msg =
          updatedCount > 0
            ? `Auto-detected genre/mood metadata for ${updatedCount} tracks`
            : "Genre scan complete (all detectable tracks already classified)";
        set({
          isDetectingGenres: false,
          statusMessage: msg,
        });
        emitNotice(msg, "success");
      } catch (err) {
        console.error("Failed to auto-detect genres:", err);
        set({ isDetectingGenres: false });
        emitNotice(`Genre detection error: ${String(err)}`, "error");
      }
    },
  };
}
