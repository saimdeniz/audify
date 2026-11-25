import { invoke } from "@tauri-apps/api/core";
import { Collection, SampleItem } from "../../types";
import { isPathInsideFolder } from "../../utils/format";
import { invokeCommand } from "../../utils/tauriCommands";
import { deduplicateTemplates, persistNavigationFilters } from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export function createCatalogCollectionActions(ctx: StoreSliceContext) {
  const { set, get, applyInstantMemoryFilter, emitNotice } = ctx;

  return {
    createCollection: async (
      name: string,
      color?: string,
      icon?: string,
      parentId?: number | null,
      rulePath?: string | null,
      smartQuery?: string | null
    ): Promise<Collection | null> => {
      const trimmed = name.trim();
      if (!trimmed) {
        emitNotice("Collection name cannot be empty", "error");
        return null;
      }
      const cleanSmartQuery = smartQuery?.trim() ? smartQuery.trim() : null;
      const targetParentId = cleanSmartQuery ? null : parentId || null;
      const duplicateSibling = get().collections.find(
        (c) =>
          (c.parent_id ?? null) === targetParentId &&
          c.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (duplicateSibling) {
        emitNotice(
          targetParentId
            ? `Sub-folder "${duplicateSibling.name}" already exists in this collection`
            : `Collection "${duplicateSibling.name}" already exists`,
          "error"
        );
        return null;
      }

      try {
        const created = await invoke<Collection>("create_collection", {
          name: trimmed,
          color: color || null,
          icon: icon || (cleanSmartQuery ? "zap" : null),
          parentId: targetParentId,
          rulePath: cleanSmartQuery ? null : rulePath || null,
          smartQuery: cleanSmartQuery,
        });

        if (
          !targetParentId &&
          !cleanSmartQuery &&
          get().autoCreateCollectionSubfolders
        ) {
          const templates = deduplicateTemplates(get().collectionTemplates);
          for (const tmpl of templates) {
            try {
              await invoke<Collection>("create_collection", {
                name: tmpl.name,
                color: null,
                icon: tmpl.icon,
                parentId: created.id,
                rulePath: tmpl.folder_path ? tmpl.folder_path : null,
              });
            } catch (err) {
              console.error(
                `Failed to auto-create subfolder "${tmpl.name}":`,
                err
              );
            }
          }
        }

        await get().refreshSidebarData();
        set({
          statusMessage: targetParentId
            ? `Created sub-collection "${created.name}"`
            : `Created collection "${created.name}"`,
        });
        return created;
      } catch (err) {
        console.error("Failed to create collection:", err);
        emitNotice(`Create collection error: ${String(err)}`, "error");
        return null;
      }
    },

    addToCollection: async (collectionId: number, sampleId: number) => {
      const targetCol = get().collections.find((c) => c.id === collectionId);
      if (targetCol?.smart_query?.trim()) {
        emitNotice(
          `"${targetCol.name}" is a Smart Collection and updates automatically from its search query`,
          "info"
        );
        return;
      }
      try {
        const col = await invoke<Collection>("add_to_collection", {
          collectionId,
          sampleId,
        });
        set((state) => ({
          collections: state.collections.map((c) => (c.id === col.id ? col : c)),
          statusMessage: `Added sample to collection "${col.name}" (${col.sample_count})`,
        }));
        await get().refreshSidebarData();
        const activeColId = get().selectedCollectionId;
        if (activeColId === collectionId || activeColId === col.parent_id) {
          await get().fetchSamples({ preserveMultiSelect: true });
        }
      } catch (err) {
        console.error("Failed to add to collection:", err);
        emitNotice(`Add to collection error: ${String(err)}`, "error");
      }
    },

    addSamplesToCollectionBatch: async (
      collectionId: number,
      sampleIds: number[]
    ) => {
      if (sampleIds.length === 0) return;
      const targetCol = get().collections.find((c) => c.id === collectionId);
      if (targetCol?.smart_query?.trim()) {
        emitNotice(
          `"${targetCol.name}" is a Smart Collection and updates automatically from its search query`,
          "info"
        );
        return;
      }
      try {
        const col = await invokeCommand("add_samples_to_collection_batch", {
          collectionId,
          sampleIds,
        });
        set((state) => ({
          collections: state.collections.map((c) => (c.id === col.id ? col : c)),
          statusMessage: `Added ${sampleIds.length} samples to "${col.name}" (${col.sample_count})`,
        }));
        await get().refreshSidebarData();
        const activeColId = get().selectedCollectionId;
        if (activeColId === collectionId || activeColId === col.parent_id) {
          await get().fetchSamples({ preserveMultiSelect: true });
        }
      } catch (err) {
        console.error("Failed to batch add to collection:", err);
        emitNotice(`Add to collection error: ${String(err)}`, "error");
      }
    },

    addAutoRoutedSamplesToCollection: async (
      targetCollectionId: number,
      samplesToAdd: SampleItem[]
    ) => {
      if (samplesToAdd.length === 0) return;
      const { collections, autoRouteCollectionDrops, collectionTemplates } = get();
      const targetCol = collections.find((c) => c.id === targetCollectionId);
      if (!targetCol) return;
      if (targetCol.smart_query?.trim()) {
        emitNotice(
          `"${targetCol.name}" is a Smart Collection and updates automatically from its search query`,
          "info"
        );
        return;
      }

      const children = collections.filter((c) => c.parent_id === targetCollectionId);

      if (autoRouteCollectionDrops && children.length > 0) {
        const matchers: {
          childId: number;
          childName: string;
          paths: string[];
        }[] = [];

        for (const child of children) {
          const paths: string[] = [];
          if (child.rule_path && child.rule_path.trim()) {
            paths.push(child.rule_path.trim());
          }
          const tmpl = collectionTemplates.find(
            (t) => t.name.toLowerCase() === child.name.toLowerCase()
          );
          if (tmpl && tmpl.folder_path && tmpl.folder_path.trim()) {
            paths.push(tmpl.folder_path.trim());
          }
          matchers.push({ childId: child.id, childName: child.name, paths });
        }

        const bucketMap = new Map<number, number[]>();
        const routedSummary = new Map<string, number>();

        for (const s of samplesToAdd) {
          let matchedChild: { childId: number; childName: string } | null = null;
          let bestLen = -1;

          for (const m of matchers) {
            for (const p of m.paths) {
              if (isPathInsideFolder(s.file_path, p) && p.length > bestLen) {
                bestLen = p.length;
                matchedChild = m;
              }
            }
          }

          const targetId = matchedChild ? matchedChild.childId : targetCollectionId;
          const targetName = matchedChild ? matchedChild.childName : targetCol.name;

          if (!bucketMap.has(targetId)) {
            bucketMap.set(targetId, []);
          }
          bucketMap.get(targetId)!.push(s.id);
          routedSummary.set(targetName, (routedSummary.get(targetName) || 0) + 1);
        }

        for (const [colId, sampleIds] of bucketMap.entries()) {
          try {
            await invokeCommand("add_samples_to_collection_batch", {
              collectionId: colId,
              sampleIds,
            });
          } catch (err) {
            console.error(`Failed to route samples to collection ${colId}:`, err);
          }
        }

        await get().refreshSidebarData();
        const activeColId = get().selectedCollectionId;
        if (
          activeColId !== null &&
          (activeColId === targetCollectionId || bucketMap.has(activeColId))
        ) {
          await get().fetchSamples({ preserveMultiSelect: true });
        }

        const breakdown = Array.from(routedSummary.entries())
          .map(([name, count]) => `${count} -> ${name}`)
          .join(", ");
        set({
          statusMessage: `Auto-routed ${samplesToAdd.length} track(s) into "${targetCol.name}": ${breakdown}`,
        });
        return;
      }

      try {
        await invokeCommand("add_samples_to_collection_batch", {
          collectionId: targetCollectionId,
          sampleIds: samplesToAdd.map((s) => s.id),
        });
        await get().refreshSidebarData();
        const activeColId = get().selectedCollectionId;
        if (
          activeColId === targetCollectionId ||
          activeColId === targetCol.parent_id
        ) {
          await get().fetchSamples({ preserveMultiSelect: true });
        }
        set({
          statusMessage: `Added ${samplesToAdd.length} track(s) to "${targetCol.name}"`,
        });
      } catch (err) {
        console.error("Failed to add samples to collection:", err);
        emitNotice(`Add to collection error: ${String(err)}`, "error");
      }
    },

    removeSamplesFromCollection: async (
      collectionId: number,
      sampleIds: number[]
    ) => {
      if (sampleIds.length === 0) return;
      const targetCol = get().collections.find((c) => c.id === collectionId);
      if (targetCol?.smart_query?.trim()) {
        emitNotice(
          "Smart Collections are dynamic — edit the query to change matched items",
          "info"
        );
        return;
      }
      try {
        const col = await invokeCommand("remove_samples_from_collection", {
          collectionId,
          sampleIds,
        });
        await get().refreshSidebarData();
        await get().fetchSamples({ preserveMultiSelect: true });
        set({
          statusMessage: `Removed ${sampleIds.length} sample(s) from "${col.name}"`,
        });
      } catch (err) {
        console.error("Failed to remove samples from collection:", err);
        emitNotice(`Remove from collection error: ${String(err)}`, "error");
      }
    },

    renameCollection: async (
      collectionId: number,
      newName: string,
      newColor?: string,
      newIcon?: string,
      newRulePath?: string | null,
      newSmartQuery?: string | null
    ) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        emitNotice("Collection name cannot be empty", "error");
        return null;
      }
      const cleanSmartQuery =
        newSmartQuery !== undefined
          ? newSmartQuery?.trim()
            ? newSmartQuery.trim()
            : null
          : undefined;
      if (newSmartQuery !== undefined && cleanSmartQuery === null) {
        emitNotice("Smart Collection query cannot be empty", "error");
        return null;
      }
      const currentCol = get().collections.find((c) => c.id === collectionId);
      const parentId = currentCol?.parent_id ?? null;
      const duplicateSibling = get().collections.find(
        (c) =>
          c.id !== collectionId &&
          (c.parent_id ?? null) === parentId &&
          c.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (duplicateSibling) {
        emitNotice(
          parentId
            ? `Sub-folder "${duplicateSibling.name}" already exists`
            : `Collection "${duplicateSibling.name}" already exists`,
          "error"
        );
        return null;
      }

      try {
        const col = await invoke<Collection>("rename_collection", {
          collectionId,
          newName: trimmed,
          newColor: newColor || null,
          newIcon: newIcon || null,
          newRulePath: newRulePath !== undefined ? newRulePath : null,
          newSmartQuery: cleanSmartQuery !== undefined ? cleanSmartQuery : null,
        });
        await get().refreshSidebarData();
        if (get().selectedCollectionId === collectionId && col.smart_query?.trim()) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
            await get().fetchSamples({ preserveMultiSelect: true });
          }
        }
        set({ statusMessage: `Updated collection "${col.name}"` });
        return col;
      } catch (err) {
        console.error("Failed to rename collection:", err);
        emitNotice(`Update collection error: ${String(err)}`, "error");
        return null;
      }
    },

    reparentCollection: async (
      collectionId: number,
      newParentId: number | null
    ): Promise<Collection | null> => {
      try {
        const updated = await invokeCommand("reparent_collection", {
          collectionId,
          newParentId,
        });
        await get().refreshSidebarData();
        const parentName = newParentId
          ? get().collections.find((c) => c.id === newParentId)?.name
          : null;
        set({
          statusMessage: parentName
            ? `Moved "${updated.name}" inside "${parentName}"`
            : `Moved "${updated.name}" to top-level Collections`,
        });
        return updated;
      } catch (err) {
        console.error("Failed to reparent collection:", err);
        emitNotice(`Move collection error: ${String(err)}`, "error");
        return null;
      }
    },

    deleteCollection: async (collectionId: number) => {
      try {
        const prevCollections = get().collections;
        const activeColId = get().selectedCollectionId;
        const wasSelectedOrChild =
          activeColId !== null &&
          (activeColId === collectionId ||
            prevCollections.some(
              (c) => c.id === activeColId && c.parent_id === collectionId
            ));

        await invoke("delete_collection", { collectionId });

        if (wasSelectedOrChild) {
          persistNavigationFilters(
            get().folderFilter,
            get().selectedLicenseGroupId,
            get().favoriteOnly,
            null
          );
          set({ selectedCollectionId: null });
        }

        await get().refreshSidebarData();
        if (wasSelectedOrChild) {
          if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
            await get().fetchSamples({ preserveMultiSelect: false });
          }
        }
        set({ statusMessage: "Collection deleted" });
      } catch (err) {
        console.error("Failed to delete collection:", err);
        emitNotice(`Delete collection error: ${String(err)}`, "error");
      }
    },
  };
}
