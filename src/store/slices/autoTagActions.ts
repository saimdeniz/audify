import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_AUTO_TAG_RULES } from "../../constants/autoTagRules";
import {
  AutoTagCategoryConfig,
  AutoTagPreviewResult,
  AutoTagRule,
} from "../../types";
import {
  buildDefaultAutoTagCategories,
  upgradeLegacyAutoTagRuleset,
} from "../../utils/autoTagRuleUpgrade";
import { computeRelativeScopePaths } from "../../utils/pathHelpers";
import { invokeCommand } from "../../utils/tauriCommands";
import type { StatusNoticeAction } from "../storePayloads";
import type { StoreGet, StoreSet } from "../types";

export interface AutoTagActionsDeps {
  set: StoreSet;
  get: StoreGet;
  emitNotice: (
    message: string,
    kind?: "info" | "success" | "error",
    action?: StatusNoticeAction
  ) => void;
}

export function createAutoTagActions(deps: AutoTagActionsDeps) {
  const { set, get, emitNotice } = deps;

  return {
    addAutoTagRule: async (
      tagName: string,
      tagColor: string,
      keywordsCsv: string,
      category?: string,
      includePathsCsv?: string,
      excludePathsCsv?: string,
      min_duration_ms?: number,
      max_duration_ms?: number
    ) => {
      const cleanName = tagName.trim();
      const keywords = keywordsCsv
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (!cleanName || keywords.length === 0) return;

      const duplicate = get().autoTagRules.find(
        (r) => r.tag_name.trim().toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        emitNotice(`Rule for tag "${cleanName}" already exists`, "error");
        return;
      }

      const include_paths = includePathsCsv
        ? includePathsCsv
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
        : [];
      const exclude_paths = excludePathsCsv
        ? excludePathsCsv
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
        : [];

      const libs = get().libraries;
      const newRule: AutoTagRule = {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tag_name: cleanName,
        tag_color: tagColor || "#F59E0B",
        keywords,
        enabled: true,
        category: category || "SFX",
        include_paths,
        exclude_paths,
        rel_include_paths: computeRelativeScopePaths(include_paths, libs),
        rel_exclude_paths: computeRelativeScopePaths(exclude_paths, libs),
        min_duration_ms,
        max_duration_ms,
      };
      set((s) => ({
        autoTagRules: [newRule, ...s.autoTagRules],
        autoTagRulesDirty: true,
        statusMessage: `Added custom auto-tag rule for "${cleanName}"`,
      }));
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    previewAutoTagRule: async (rule: AutoTagRule) => {
      try {
        const res = await invoke<AutoTagPreviewResult>("preview_auto_tag_rule", {
          rule,
        });
        if (!res || typeof res.match_count !== "number") {
          return { match_count: 0, sample_names: [] };
        }
        return {
          match_count: res.match_count,
          sample_names: Array.isArray(res.sample_names) ? res.sample_names : [],
        };
      } catch (err) {
        console.error("Failed to preview auto-tag rule:", err);
        return { match_count: 0, sample_names: [] };
      }
    },

    updateAutoTagRule: async (
      ruleId: string,
      patch: Partial<AutoTagRule>
    ) => {
      const libs = get().libraries;
      const normalizedPatch: Partial<AutoTagRule> = { ...patch };
      if (
        patch.include_paths !== undefined &&
        patch.rel_include_paths === undefined
      ) {
        normalizedPatch.rel_include_paths = computeRelativeScopePaths(
          patch.include_paths,
          libs
        );
      }
      if (
        patch.exclude_paths !== undefined &&
        patch.rel_exclude_paths === undefined
      ) {
        normalizedPatch.rel_exclude_paths = computeRelativeScopePaths(
          patch.exclude_paths,
          libs
        );
      }
      set((s) => ({
        autoTagRules: s.autoTagRules.map((r) =>
          r.id === ruleId ? { ...r, ...normalizedPatch } : r
        ),
        autoTagRulesDirty: true,
      }));
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    deleteAutoTagRule: async (ruleId: string) => {
      set((s) => ({
        autoTagRules: s.autoTagRules.filter((r) => r.id !== ruleId),
        autoTagRulesDirty: true,
        statusMessage: "Removed auto-tag rule",
      }));
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    resetAutoTagRules: async () => {
      set({
        autoTagRules: [...DEFAULT_AUTO_TAG_RULES],
        autoTagCategories: buildDefaultAutoTagCategories(DEFAULT_AUTO_TAG_RULES),
        autoTagRulesDirty: true,
        statusMessage: "Reset auto-tag rules to nested taxonomy defaults",
      });
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    upgradeLegacyAutoTagRules: async () => {
      const { autoTagRules, autoTagCategories } = get();
      const { rules, categories, upgradedCount } = upgradeLegacyAutoTagRuleset(
        autoTagRules,
        autoTagCategories
      );
      set({
        autoTagRules: rules,
        autoTagCategories: categories,
        autoTagRulesDirty: true,
        statusMessage: `Upgraded ${upgradedCount} rule(s) to Nested Taxonomy — click Apply rules to re-tag`,
      });
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
      emitNotice(
        `Upgraded rules to Nested Taxonomy (${rules.length} rules). Click "Apply rules" to update your library.`,
        "success"
      );
    },

    reapplyAutoTagRules: async () => {
      if (get().isApplyingAutoTags) return;
      set({
        isApplyingAutoTags: true,
        autoTagProgress: {
          stage_label: "Matching rules",
          processed: 0,
          total: 0,
          percentage: 0,
          current_item: "",
          matched_count: 0,
          done: false,
        },
      });
      try {
        await get().persistActiveProfileSettings(true);
        const assignedCount = await invoke<number>(
          "apply_auto_tag_rules_to_library"
        );
        set({
          autoTagRulesDirty: false,
          autoTagImpactPreview: null,
          canUndoAutoTagApply: true,
        });
        await get().refreshAfterCatalogMutation();
        emitNotice(
          `Applied profile auto-tag rules (${assignedCount.toLocaleString()} samples matched)`,
          "success",
          {
            label: "Undo",
            onClick: () => {
              void get().undoLastAutoTagApply();
            },
          }
        );
      } catch (err) {
        console.error("Failed to reapply auto-tag rules:", err);
        emitNotice(`Auto-tag rule error: ${String(err)}`, "error");
      } finally {
        set({ isApplyingAutoTags: false, autoTagProgress: null });
      }
    },

    refreshAutoTagImpactPreview: async () => {
      try {
        await get().persistActiveProfileSettings(true);
        const impact = await invokeCommand("preview_auto_tag_rules_impact", {});
        if (!impact || typeof impact.affected_samples !== "number") return;
        set({
          autoTagImpactPreview: impact,
          canUndoAutoTagApply: Boolean(impact.can_undo),
        });
      } catch (err) {
        console.error("Failed to preview auto-tag rules impact:", err);
      }
    },

    undoLastAutoTagApply: async () => {
      try {
        const restored = await invokeCommand("undo_last_auto_tag_apply", {});
        set({
          canUndoAutoTagApply: false,
          autoTagRulesDirty: true,
        });
        await get().refreshAfterCatalogMutation();
        void get().refreshAutoTagImpactPreview();
        emitNotice(
          `Reverted last Apply Rules (${restored} auto-tag links restored)`,
          "info"
        );
      } catch (err) {
        console.error("Failed to undo auto-tag apply:", err);
        emitNotice(`Undo auto-tag error: ${String(err)}`, "error");
      }
    },

    setAutoTagCategoryPaths: async (
      categoryName: string,
      includePaths: string[],
      excludePaths: string[]
    ) => {
      const cleanCategory = categoryName.trim();
      if (!cleanCategory) return;
      const libs = get().libraries;
      const relInclude = computeRelativeScopePaths(includePaths, libs);
      const relExclude = computeRelativeScopePaths(excludePaths, libs);
      set((s) => {
        const existingIndex = s.autoTagCategories.findIndex(
          (c) => c.name.toLowerCase() === cleanCategory.toLowerCase()
        );
        let updatedCategories: AutoTagCategoryConfig[];
        if (existingIndex >= 0) {
          updatedCategories = s.autoTagCategories.map((c, idx) =>
            idx === existingIndex
              ? {
                  ...c,
                  include_paths: includePaths,
                  exclude_paths: excludePaths,
                  rel_include_paths: relInclude,
                  rel_exclude_paths: relExclude,
                }
              : c
          );
        } else {
          updatedCategories = [
            ...s.autoTagCategories,
            {
              name: cleanCategory,
              include_paths: includePaths,
              exclude_paths: excludePaths,
              rel_include_paths: relInclude,
              rel_exclude_paths: relExclude,
            },
          ];
        }
        return {
          autoTagCategories: updatedCategories,
          autoTagRulesDirty: true,
          statusMessage: `Updated folder filters for category "${cleanCategory}"`,
        };
      });
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    addAutoTagCategory: async (name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const exists = get().autoTagCategories.some(
        (c) => c.name.toLowerCase() === clean.toLowerCase()
      );
      if (exists) {
        emitNotice(`Category "${clean}" already exists`, "error");
        return;
      }
      const updated = [
        ...get().autoTagCategories,
        { name: clean, include_paths: [], exclude_paths: [] },
      ];
      set({
        autoTagCategories: updated,
        statusMessage: `Created category "${clean}"`,
      });
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    renameAutoTagCategory: async (oldName: string, newName: string) => {
      const cleanOld = oldName.trim();
      const cleanNew = newName.trim();
      if (!cleanOld || !cleanNew || cleanOld.toLowerCase() === "uncategorized") {
        return;
      }
      if (cleanOld === cleanNew) return;
      const duplicate = get().autoTagCategories.some(
        (c) =>
          c.name.toLowerCase() === cleanNew.toLowerCase() &&
          c.name.toLowerCase() !== cleanOld.toLowerCase()
      );
      if (duplicate) {
        emitNotice(`Category "${cleanNew}" already exists`, "error");
        return;
      }
      set((s) => {
        const hadConfig = s.autoTagCategories.some(
          (c) => c.name.toLowerCase() === cleanOld.toLowerCase()
        );
        const updatedCategories = hadConfig
          ? s.autoTagCategories.map((c) =>
              c.name.toLowerCase() === cleanOld.toLowerCase()
                ? { ...c, name: cleanNew }
                : c
            )
          : [
              ...s.autoTagCategories,
              { name: cleanNew, include_paths: [], exclude_paths: [] },
            ];
        const updatedRules = s.autoTagRules.map((r) =>
          r.category?.toLowerCase() === cleanOld.toLowerCase()
            ? { ...r, category: cleanNew }
            : r
        );
        return {
          autoTagCategories: updatedCategories,
          autoTagRules: updatedRules,
          autoTagRulesDirty: true,
          statusMessage: `Renamed category "${cleanOld}" to "${cleanNew}"`,
        };
      });
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },

    deleteAutoTagCategory: async (name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const updatedCategories = get().autoTagCategories.filter(
        (c) => c.name.toLowerCase() !== clean.toLowerCase()
      );
      const updatedRules = get().autoTagRules.map((r) =>
        r.category?.toLowerCase() === clean.toLowerCase()
          ? { ...r, category: undefined }
          : r
      );
      set({
        autoTagCategories: updatedCategories,
        autoTagRules: updatedRules,
        autoTagRulesDirty: true,
        statusMessage: `Removed category "${clean}"`,
      });
      await get().persistActiveProfileSettings(true);
      await get().refreshSidebarData();
    },
  };
}
