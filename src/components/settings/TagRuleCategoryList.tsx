import React from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  Plus,
  Search,
  X,
} from "lucide-react";
import { deterministicColorForName } from "../../constants/palettes";
import { useSampleStore } from "../../store/useSampleStore";
import { AutoTagCategoryConfig, AutoTagRule } from "../../types";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";

interface TagRuleCategoryListProps {
  autoTagSearchQuery: string;
  setAutoTagSearchQuery: (q: string) => void;
  allAvailableCategories: string[];
  autoTagRules: AutoTagRule[];
  autoTagCategories: AutoTagCategoryConfig[];
  filteredAutoTagRules: AutoTagRule[];
  visibleCategories: [string, AutoTagRule[]][];
  collapsedCategories: Record<string, boolean>;
  toggleCategoryCollapse: (cat: string) => void;
  activeInspectedCategory: string | null;
  activeInspectedRule: AutoTagRule | null;
  confirmDeleteCategoryName: string | null;
  setConfirmDeleteCategoryName: (name: string | null) => void;
  onSelectCategory: (cat: string) => void;
  onSelectRule: (ruleId: string) => void;
  addAutoTagCategory: (name: string) => Promise<void>;
  deleteAutoTagCategory: (name: string) => Promise<void>;
  addAutoTagRule: (
    tagName: string,
    tagColor: string,
    keywordsRaw: string,
    category?: string
  ) => Promise<void>;
}

export const TagRuleCategoryList: React.FC<TagRuleCategoryListProps> = ({
  autoTagSearchQuery,
  setAutoTagSearchQuery,
  allAvailableCategories,
  autoTagRules,
  autoTagCategories,
  filteredAutoTagRules,
  visibleCategories,
  collapsedCategories,
  toggleCategoryCollapse,
  activeInspectedCategory,
  activeInspectedRule,
  confirmDeleteCategoryName,
  setConfirmDeleteCategoryName,
  onSelectCategory,
  onSelectRule,
  addAutoTagCategory,
  deleteAutoTagCategory,
  addAutoTagRule,
}) => {
  const createRuleAndSelect = async (
    name: string,
    color: string | undefined,
    targetCat: string
  ): Promise<boolean> => {
    const clean = name.trim();
    const chosenColor = color || deterministicColorForName(clean);
    const existed = autoTagRules.some(
      (r) => r.tag_name.trim().toLowerCase() === clean.toLowerCase()
    );
    await addAutoTagRule(clean, chosenColor, clean.toLowerCase(), targetCat);
    if (existed) return false;
    const created = useSampleStore
      .getState()
      .autoTagRules.find(
        (r) => r.tag_name.trim().toLowerCase() === clean.toLowerCase()
      );
    if (created) {
      onSelectRule(created.id);
      return true;
    }
    return false;
  };

  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
      <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-0 flex items-center">
          <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={autoTagSearchQuery}
            onChange={(e) => setAutoTagSearchQuery(e.target.value)}
            placeholder="Search rules..."
            className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
          />
          {autoTagSearchQuery && (
            <button
              type="button"
              onClick={() => setAutoTagSearchQuery("")}
              className="absolute right-2 text-fg-3 hover:text-fg cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <QuickCreatePopover
          title="New Category"
          placeholder="Category name..."
          hasColor={false}
          buttonTitle="Add new category"
          buttonClassName="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg flex items-center justify-center transition-colors shadow-xs cursor-pointer"
          buttonIcon={<FolderPlus className="w-3.5 h-3.5 text-fg-2" />}
          onCreated={async (name) => {
            const clean = name.trim();
            const exists = allAvailableCategories.some(
              (c) => c.toLowerCase() === clean.toLowerCase()
            );
            await addAutoTagCategory(clean);
            if (!exists && clean) {
              onSelectCategory(clean);
            }
            return !exists;
          }}
        />

        <QuickCreatePopover
          title="New Rule"
          placeholder="Rule tag name..."
          hasColor={true}
          buttonTitle="Add new auto-tag rule"
          onCreated={(name, color) =>
            createRuleAndSelect(name, color, allAvailableCategories[0] || "SFX")
          }
        />
      </div>

      <div className="h-[26px] px-2.5 bg-surface-sub border-b border-line flex items-center justify-between text-[9.5px] font-mono text-fg-3 font-semibold shrink-0">
        <span>CATEGORIES &amp; RULES ({filteredAutoTagRules.length})</span>
        <span>STATUS</span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5 min-h-0">
        {visibleCategories.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
            No categories or rules found
          </div>
        ) : (
          visibleCategories.map(([cat, rules]) => {
            const isCollapsed =
              !autoTagSearchQuery.trim() && !!collapsedCategories[cat];
            const catConf = autoTagCategories.find(
              (c) => c.name.toLowerCase() === cat.toLowerCase()
            );
            const hasFilter =
              (catConf?.include_paths?.length || 0) +
                (catConf?.exclude_paths?.length || 0) +
                (catConf?.rel_include_paths?.length || 0) +
                (catConf?.rel_exclude_paths?.length || 0) >
              0;

            const isCatSelected =
              activeInspectedCategory !== null &&
              activeInspectedCategory.toLowerCase() === cat.toLowerCase();

            return (
              <div
                key={cat}
                className={`rounded-xs border bg-surface-sub overflow-hidden group/cat transition-all ${
                  isCatSelected ? "border-accent" : "border-line"
                }`}
              >
                <div
                  onClick={() => onSelectCategory(cat)}
                  className={`h-[28px] px-2 flex items-center justify-between cursor-pointer select-none transition-colors ${
                    isCatSelected
                      ? "bg-surface-3 text-accent-fg border-b border-accent"
                      : "bg-surface-soft hover:bg-surface-2"
                  }`}
                  title="Click to edit category Scope & Limits"
                >
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCategoryCollapse(cat);
                      }}
                      className="p-0.5 text-fg-3 hover:text-fg rounded-xs cursor-pointer"
                      title={
                        isCollapsed ? "Expand category" : "Collapse category"
                      }
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span
                      className={`font-mono text-[10.5px] font-bold truncate ${
                        isCatSelected ? "text-accent-fg" : "text-fg"
                      }`}
                    >
                      {cat}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-xs bg-surface-3 text-fg-3">
                      {rules.length}
                    </span>
                    {hasFilter && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-ok shrink-0"
                        title="Category folder scope paths active"
                      />
                    )}
                  </div>

                  <div
                    className="flex items-center space-x-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <QuickCreatePopover
                      title={`New Rule in ${cat}`}
                      placeholder="Rule tag name..."
                      hasColor={true}
                      buttonTitle={`Add rule in ${cat}`}
                      buttonClassName="w-[18px] h-[18px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center transition-colors shadow-xs"
                      buttonIcon={<Plus className="w-2.5 h-2.5" />}
                      onCreated={(name, color) =>
                        createRuleAndSelect(
                          name,
                          color,
                          cat === "Uncategorized" ? "SFX" : cat
                        )
                      }
                    />

                    {cat !== "Uncategorized" && (
                      <InlineConfirmDeleteButton
                        isConfirming={confirmDeleteCategoryName === cat}
                        onRequest={() => setConfirmDeleteCategoryName(cat)}
                        onConfirm={() => {
                          void deleteAutoTagCategory(cat);
                          setConfirmDeleteCategoryName(null);
                        }}
                        onCancel={() => setConfirmDeleteCategoryName(null)}
                        size="xs"
                        confirmTitle="Confirm Delete Category"
                        deleteTitle={`Delete category "${cat}"`}
                        idleClassName="w-[18px] h-[18px] text-fg-3 hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30 rounded-xs opacity-0 group-hover/cat:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                      />
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="p-1 space-y-0.5">
                    {rules.length === 0 ? (
                      <div className="py-2 px-3 text-[10px] font-mono text-fg-3 italic">
                        No rules in this category. Click + to add one.
                      </div>
                    ) : (
                      rules.map((rule) => {
                        const isSelected =
                          activeInspectedCategory === null &&
                          activeInspectedRule?.id === rule.id;
                        const hasOverrides =
                          (rule.include_paths?.length || 0) +
                            (rule.exclude_paths?.length || 0) +
                            (rule.rel_include_paths?.length || 0) +
                            (rule.rel_exclude_paths?.length || 0) >
                            0 ||
                          rule.min_duration_ms != null ||
                          rule.max_duration_ms != null;

                        return (
                          <div
                            key={rule.id}
                            onClick={() => onSelectRule(rule.id)}
                            className={`h-[30px] px-2 rounded-xs flex items-center justify-between cursor-pointer text-[11px] transition-colors select-none ${
                              isSelected
                                ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
                                : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
                            } ${rule.enabled ? "" : "opacity-60"}`}
                          >
                            <div className="flex items-center min-w-0 truncate space-x-2">
                              <span
                                className="w-2.5 h-2.5 rounded-[3px] inline-block shrink-0 shadow-xs"
                                style={{ backgroundColor: rule.tag_color }}
                              />
                              <span className="font-medium truncate text-fg">
                                {rule.tag_name}
                              </span>

                              {hasOverrides && (
                                <span
                                  title="Folder scope / duration limits active"
                                  className="inline-flex"
                                >
                                  <FolderTree className="w-3 h-3 text-accent-fg shrink-0" />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                              <span className="text-[9px] font-mono text-fg-3 tabular-nums">
                                {rule.keywords?.length || 0} kw
                              </span>
                              <span
                                className={`text-[8.5px] font-mono px-1.5 py-0.2 rounded-xs border font-semibold ${
                                  rule.enabled
                                    ? "bg-accent-soft border-accent/50 text-accent-fg"
                                    : "bg-surface-2 border-line text-fg-3"
                                }`}
                              >
                                {rule.enabled ? "ON" : "OFF"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
