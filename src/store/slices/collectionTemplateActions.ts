import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { DEFAULT_COLLECTION_TEMPLATES } from "../../constants/collections";
import { Collection, CollectionRuleTemplate } from "../../types";
import {
  AUDIFY_STORAGE_KEYS,
  deduplicateTemplates,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export function createCollectionTemplateActions(ctx: StoreSliceContext) {
  const { set, get, emitNotice } = ctx;

  return {
    addCollectionTemplate: async (
      template: Omit<CollectionRuleTemplate, "id">
    ) => {
      const trimmed = (template.name || "").trim();
      if (!trimmed) return;
      const existing = get().collectionTemplates.find(
        (t) => t.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) {
        emitNotice(`Template "${trimmed}" already exists`, "error");
        return;
      }
      const created: CollectionRuleTemplate = {
        ...template,
        name: trimmed,
        color: "",
        id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const next = [...get().collectionTemplates, created];
      safeSetItem(AUDIFY_STORAGE_KEYS.collectionTemplates, JSON.stringify(next));
      set({
        collectionTemplates: next,
        statusMessage: `Added collection template "${created.name}"`,
      });
      await get().persistActiveProfileSettings(true);
    },

    updateCollectionTemplate: async (
      id: string,
      patch: Partial<CollectionRuleTemplate>
    ) => {
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (trimmed) {
          const duplicate = get().collectionTemplates.find(
            (t) =>
              t.id !== id && t.name.trim().toLowerCase() === trimmed.toLowerCase()
          );
          if (duplicate) {
            emitNotice(`Template "${trimmed}" already exists`, "error");
            return;
          }
        }
      }
      const next = get().collectionTemplates.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              name: patch.name !== undefined ? patch.name.trim() : t.name,
            }
          : t
      );
      safeSetItem(AUDIFY_STORAGE_KEYS.collectionTemplates, JSON.stringify(next));
      set({ collectionTemplates: next });
      await get().persistActiveProfileSettings();
    },

    deleteCollectionTemplate: async (id: string) => {
      const next = get().collectionTemplates.filter((t) => t.id !== id);
      safeSetItem(AUDIFY_STORAGE_KEYS.collectionTemplates, JSON.stringify(next));
      set({
        collectionTemplates: next,
        statusMessage: "Removed collection template",
      });
      await get().persistActiveProfileSettings(true);
    },

    resetCollectionTemplates: async () => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.collectionTemplates,
        JSON.stringify(DEFAULT_COLLECTION_TEMPLATES)
      );
      set({
        collectionTemplates: [...DEFAULT_COLLECTION_TEMPLATES],
        statusMessage: "Cleared collection templates",
      });
      await get().persistActiveProfileSettings(true);
    },

    applyTemplatesToExistingCollection: async (collectionId: number) => {
      const { collections, collectionTemplates } = get();
      const targetCol = collections.find((c) => c.id === collectionId);
      if (!targetCol) return;
      if (targetCol.smart_query?.trim()) {
        emitNotice("Smart Collections cannot contain sub-folders", "info");
        return;
      }

      const existingChildren = collections.filter(
        (c) => c.parent_id === collectionId
      );
      const existingNames = new Set(
        existingChildren.map((c) => c.name.trim().toLowerCase())
      );

      let addedCount = 0;
      for (const tmpl of deduplicateTemplates(collectionTemplates)) {
        const key = tmpl.name.trim().toLowerCase();
        if (!key || existingNames.has(key)) continue;
        existingNames.add(key);
        try {
          await invoke<Collection>("create_collection", {
            name: tmpl.name,
            color: null,
            icon: tmpl.icon,
            parentId: collectionId,
            rulePath: tmpl.folder_path ? tmpl.folder_path : null,
          });
          addedCount++;
        } catch (err) {
          console.error(`Failed to apply template "${tmpl.name}":`, err);
        }
      }

      await get().refreshSidebarData();
      const msg =
        addedCount > 0
          ? `Added ${addedCount} template sub-folder(s) to "${targetCol.name}"`
          : `All template sub-folders already exist in "${targetCol.name}"`;
      emitNotice(msg, addedCount > 0 ? "success" : "info");
    },

    pickFolderForCollectionTemplate: async () => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Folder for Sub-folder Path Rule",
        });
        if (!selected || typeof selected !== "string") return null;
        return selected;
      } catch (err) {
        console.error("Failed to pick folder for template:", err);
        return null;
      }
    },
  };
}
