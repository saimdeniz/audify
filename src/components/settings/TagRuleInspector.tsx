import React from "react";
import { FolderTree, Sparkles } from "lucide-react";
import {
  AutoTagCategoryConfig,
  AutoTagPreviewResult,
  AutoTagRule,
  Tag,
} from "../../types";
import { InspectorShell } from "./InspectorShell";
import {
  TagRuleCategoryPanel,
  TagRuleEditorPanel,
} from "./TagRuleFormSections";
import { MainFilterRequest } from "../../store/types";

interface TagRuleInspectorProps {
  tags: Tag[];
  allAvailableCategories: string[];
  rulesByCategory: Map<string, AutoTagRule[]>;
  activeInspectedCategory: string | null;
  activeCategoryConfig: AutoTagCategoryConfig | null;
  activeInspectedRule: AutoTagRule | null;
  activeRuleCategoryConfig: AutoTagCategoryConfig | null;
  inspectorCategoryName: string;
  setInspectorCategoryName: (v: string) => void;
  inspectorRuleTagName: string;
  setInspectorRuleTagName: (v: string) => void;
  inspectorRuleKeywords: string;
  setInspectorRuleKeywords: (v: string) => void;
  confirmDeleteCategoryName: string | null;
  setConfirmDeleteCategoryName: (v: string | null) => void;
  confirmDeleteRuleId: string | null;
  setConfirmDeleteRuleId: (v: string | null) => void;
  isRuleCategoryDropdownOpen: boolean;
  setIsRuleCategoryDropdownOpen: (v: boolean) => void;
  isRuleOverridesOpen: boolean;
  setIsRuleOverridesOpen: (v: boolean) => void;
  inspectedRulePreview: AutoTagPreviewResult | null;
  onSelectCategory: (cat: string | null) => void;
  onSelectRule: (id: string) => void;
  sendFilterToMain: (req: MainFilterRequest & { label?: string }) => void;
  renameAutoTagCategory: (oldName: string, newName: string) => Promise<void>;
  deleteAutoTagCategory: (name: string) => Promise<void>;
  setAutoTagCategoryPaths: (
    categoryName: string,
    includePaths: string[],
    excludePaths: string[]
  ) => Promise<void>;
  updateAutoTagRule: (
    ruleId: string,
    patch: Partial<AutoTagRule>
  ) => Promise<void>;
  deleteAutoTagRule: (ruleId: string) => Promise<void>;
  runRulePreview: (rule: AutoTagRule, keywordsDraft: string) => Promise<void>;
  handleBrowseRulePath: (ruleId: string, isInclude: boolean) => Promise<void>;
  handleBrowseCategoryPath: (
    categoryName: string,
    isInclude: boolean
  ) => Promise<void>;
}

export const TagRuleInspector: React.FC<TagRuleInspectorProps> = ({
  tags,
  allAvailableCategories,
  rulesByCategory,
  activeInspectedCategory,
  activeCategoryConfig,
  activeInspectedRule,
  activeRuleCategoryConfig,
  inspectorCategoryName,
  setInspectorCategoryName,
  inspectorRuleTagName,
  setInspectorRuleTagName,
  inspectorRuleKeywords,
  setInspectorRuleKeywords,
  confirmDeleteCategoryName,
  setConfirmDeleteCategoryName,
  confirmDeleteRuleId,
  setConfirmDeleteRuleId,
  isRuleCategoryDropdownOpen,
  setIsRuleCategoryDropdownOpen,
  isRuleOverridesOpen,
  setIsRuleOverridesOpen,
  inspectedRulePreview,
  onSelectCategory,
  onSelectRule,
  sendFilterToMain,
  renameAutoTagCategory,
  deleteAutoTagCategory,
  setAutoTagCategoryPaths,
  updateAutoTagRule,
  deleteAutoTagRule,
  runRulePreview,
  handleBrowseRulePath,
  handleBrowseCategoryPath,
}) => {
  const isCategoryMode = Boolean(
    activeInspectedCategory && activeCategoryConfig
  );

  return (
    <InspectorShell
      icon={
        isCategoryMode ? (
          <FolderTree className="w-3.5 h-3.5 text-accent-fg shrink-0" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-accent-fg shrink-0" />
        )
      }
      title={isCategoryMode ? "CATEGORY INSPECTOR" : "RULE INSPECTOR"}
      hasItem={isCategoryMode || Boolean(activeInspectedRule)}
      itemName={
        isCategoryMode
          ? activeInspectedCategory ?? undefined
          : activeInspectedRule?.tag_name
      }
      itemDotColor={
        isCategoryMode ? undefined : activeInspectedRule?.tag_color
      }
      subHeaderLabel={isCategoryMode ? "GROUP SCOPE" : "CRITERIA & SCOPE"}
      onFilter={
        !isCategoryMode && activeInspectedRule
          ? () => {
              const match = tags.find(
                (t) =>
                  t.name.toLowerCase() ===
                  activeInspectedRule.tag_name.toLowerCase()
              );
              if (match) {
                sendFilterToMain({
                  kind: "tag",
                  id: match.id,
                  label: match.name,
                });
              } else {
                sendFilterToMain({
                  kind: "search",
                  query: activeInspectedRule.tag_name,
                  label: activeInspectedRule.tag_name,
                });
              }
            }
          : undefined
      }
      filterTitle={
        !isCategoryMode && activeInspectedRule
          ? `Filter sample table by tag "${activeInspectedRule.tag_name}"`
          : undefined
      }
      canDelete={
        isCategoryMode
          ? activeInspectedCategory !== "Uncategorized"
          : Boolean(activeInspectedRule)
      }
      isConfirmingDelete={
        isCategoryMode
          ? confirmDeleteCategoryName === activeInspectedCategory
          : Boolean(activeInspectedRule) &&
            confirmDeleteRuleId === activeInspectedRule?.id
      }
      onRequestDelete={() => {
        if (isCategoryMode && activeInspectedCategory) {
          setConfirmDeleteCategoryName(activeInspectedCategory);
        } else if (activeInspectedRule) {
          setConfirmDeleteRuleId(activeInspectedRule.id);
        }
      }}
      onConfirmDelete={async () => {
        if (isCategoryMode && activeInspectedCategory) {
          const toDelete = activeInspectedCategory;
          setConfirmDeleteCategoryName(null);
          onSelectCategory(null);
          await deleteAutoTagCategory(toDelete);
        } else if (activeInspectedRule) {
          setConfirmDeleteRuleId(null);
          await deleteAutoTagRule(activeInspectedRule.id);
        }
      }}
      onCancelDelete={() => {
        if (isCategoryMode) {
          setConfirmDeleteCategoryName(null);
        } else {
          setConfirmDeleteRuleId(null);
        }
      }}
      deleteTitle={
        isCategoryMode
          ? `Delete category "${activeInspectedCategory}"`
          : "Delete rule"
      }
      confirmDeleteTitle={
        isCategoryMode ? "Confirm Delete Category" : "Confirm Delete"
      }
      emptyState={
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
          <Sparkles className="w-8 h-8 opacity-40 text-accent-fg" />
          <div className="text-[11px] font-mono">No rule selected.</div>
          <div className="text-[9.5px] font-mono text-fg-3 max-w-[200px]">
            Select a rule from the left list to view or edit details.
          </div>
        </div>
      }
    >
      {activeInspectedCategory && activeCategoryConfig ? (
        <TagRuleCategoryPanel
          activeInspectedCategory={activeInspectedCategory}
          activeCategoryConfig={activeCategoryConfig}
          catRules={rulesByCategory.get(activeInspectedCategory) || []}
          inspectorCategoryName={inspectorCategoryName}
          setInspectorCategoryName={setInspectorCategoryName}
          onSelectCategory={onSelectCategory}
          onSelectRule={onSelectRule}
          renameAutoTagCategory={renameAutoTagCategory}
          setAutoTagCategoryPaths={setAutoTagCategoryPaths}
          handleBrowseCategoryPath={handleBrowseCategoryPath}
        />
      ) : (
        activeInspectedRule && (
          <TagRuleEditorPanel
            activeInspectedRule={activeInspectedRule}
            activeRuleCategoryConfig={activeRuleCategoryConfig}
            allAvailableCategories={allAvailableCategories}
            inspectorRuleTagName={inspectorRuleTagName}
            setInspectorRuleTagName={setInspectorRuleTagName}
            inspectorRuleKeywords={inspectorRuleKeywords}
            setInspectorRuleKeywords={setInspectorRuleKeywords}
            isRuleCategoryDropdownOpen={isRuleCategoryDropdownOpen}
            setIsRuleCategoryDropdownOpen={setIsRuleCategoryDropdownOpen}
            isRuleOverridesOpen={isRuleOverridesOpen}
            setIsRuleOverridesOpen={setIsRuleOverridesOpen}
            inspectedRulePreview={inspectedRulePreview}
            updateAutoTagRule={updateAutoTagRule}
            runRulePreview={runRulePreview}
            handleBrowseRulePath={handleBrowseRulePath}
          />
        )
      )}
    </InspectorShell>
  );
};
