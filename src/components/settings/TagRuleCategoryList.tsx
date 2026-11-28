import React, { useCallback, useMemo, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  FolderPlus,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { deterministicColorForName } from "../../utils/taxonomyColor";
import { useStudioPointerDrag } from "../../hooks/useStudioPointerDrag";
import { useSampleStore } from "../../store/useSampleStore";
import {
  AutoTagCategoryConfig,
  AutoTagRule,
  Tag,
  TagFacet,
  TaxonomyFacetSlug,
} from "../../types";
import {
  getFacetsForDomain,
  isFacetHierarchical,
} from "../../utils/taxonomyTree";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";
import { StudioDragPill } from "../common/StudioDragPill";
import { TagRuleTreeRow } from "./TagRuleTreeRow";

interface TagRuleCategoryListProps {
  tagFacets: readonly TagFacet[];
  tags: readonly Tag[];
  autoTagSearchQuery: string;
  setAutoTagSearchQuery: (q: string) => void;
  facetFilter: "all" | TaxonomyFacetSlug;
  setFacetFilter: (f: "all" | TaxonomyFacetSlug) => void;
  hasLegacyFlatRules: boolean;
  onUpgradeLegacyRules: () => Promise<void>;
  allAvailableCategories: string[];
  autoTagRules: AutoTagRule[];
  autoTagCategories: AutoTagCategoryConfig[];
  filteredAutoTagRules: AutoTagRule[];
  visibleCategories: [string, AutoTagRule[]][];
  collapsedCategories: Record<string, boolean>;
  toggleCategoryCollapse: (cat: string) => void;
  onExpandAllCategories: () => void;
  onCollapseAllCategories: () => void;
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
  updateAutoTagRule: (
    ruleId: string,
    patch: Partial<AutoTagRule>
  ) => Promise<void>;
}

export const TagRuleCategoryList: React.FC<TagRuleCategoryListProps> = ({
  tagFacets,
  tags,
  autoTagSearchQuery,
  setAutoTagSearchQuery,
  facetFilter,
  setFacetFilter,
  hasLegacyFlatRules,
  onUpgradeLegacyRules,
  allAvailableCategories,
  autoTagRules,
  autoTagCategories,
  filteredAutoTagRules,
  visibleCategories,
  collapsedCategories,
  toggleCategoryCollapse,
  onExpandAllCategories,
  onCollapseAllCategories,
  activeInspectedCategory,
  activeInspectedRule,
  confirmDeleteCategoryName,
  setConfirmDeleteCategoryName,
  onSelectCategory,
  onSelectRule,
  addAutoTagCategory,
  deleteAutoTagCategory,
  addAutoTagRule,
  updateAutoTagRule,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dropScope = "rules-studio";

  const tagDomainFacets = useMemo(
    () => getFacetsForDomain(tagFacets, "tags"),
    [tagFacets]
  );

  const rootTagColorByLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tags) {
      if (!t.parent_id) {
        map.set(t.name.trim().toLowerCase(), t.effective_color || t.color);
      }
    }
    return map;
  }, [tags]);

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

  const canDropRule = useCallback(
    (ruleId: string, dropKey: string): boolean => {
      const rule = autoTagRules.find((r) => r.id === ruleId);
      if (!rule) return false;
      if (dropKey.startsWith("cat:")) {
        const targetCat = dropKey.slice(4);
        if (!targetCat || targetCat === "Uncategorized") return false;
        return (rule.category || "").trim().toLowerCase() !== targetCat.trim().toLowerCase();
      }
      if (dropKey.startsWith("pill:")) {
        const targetSlug = dropKey.slice(5);
        return (rule.facet_slug || "category") !== targetSlug;
      }
      return false;
    },
    [autoTagRules]
  );

  const handleRuleDrop = useCallback(
    async (ruleId: string, dropKey: string) => {
      const rule = autoTagRules.find((r) => r.id === ruleId);
      if (!rule) return;
      if (dropKey.startsWith("pill:")) {
        const nextFacet = dropKey.slice(5) as TaxonomyFacetSlug;
        await updateAutoTagRule(ruleId, {
          facet_slug: nextFacet,
          parent_tag_name: isFacetHierarchical(nextFacet, tagFacets)
            ? rule.parent_tag_name
            : undefined,
        });
        return;
      }
      if (dropKey.startsWith("cat:")) {
        const targetCat = dropKey.slice(4);
        if (!targetCat || targetCat === "Uncategorized") return;
        const targetLower = targetCat.trim().toLowerCase();
        const isSourceGroup =
          targetLower === "source / pack" || targetLower === "source";
        const matchingRoot = tags.find(
          (t) => !t.parent_id && t.name.trim().toLowerCase() === targetLower
        );
        const nextFacet = isSourceGroup
          ? "source"
          : rule.facet_slug === "source"
          ? "category"
          : rule.facet_slug || "category";

        await updateAutoTagRule(ruleId, {
          category: targetCat,
          facet_slug: nextFacet,
          parent_tag_name:
            isFacetHierarchical(nextFacet, tagFacets) && matchingRoot
              ? matchingRoot.name
              : isSourceGroup
              ? undefined
              : rule.parent_tag_name,
        });
      }
    },
    [autoTagRules, tags, tagFacets, updateAutoTagRule]
  );

  const { dragState, beginPointerDrag } = useStudioPointerDrag<string>({
    scope: dropScope,
    scrollContainerRef,
    canDrop: canDropRule,
    onDrop: handleRuleDrop,
  });

  const draggingRuleId = dragState?.payload ?? null;
  const activeDropKey = dragState?.dropKey ?? null;

  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
      {/* Top Toolbar: Search + Expand/Collapse All + Add Group + Add Rule */}
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

        <button
          type="button"
          onClick={onExpandAllCategories}
          className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          title="Expand All Rule Groups"
        >
          <ChevronsDown className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onCollapseAllCategories}
          className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          title="Collapse All Rule Groups"
        >
          <ChevronsUp className="w-3.5 h-3.5" />
        </button>

        <QuickCreatePopover
          title="New Category"
          placeholder="Category name..."
          hasColor={false}
          buttonTitle="Add new rule group"
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

      {/* Strict Tags-Domain Facet Filter Pills (Matching Library Tab) */}
      <div className="px-2 py-1.5 bg-surface-sub border-b border-line flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => setFacetFilter("all")}
            className={`h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border transition-colors cursor-pointer ${
              facetFilter === "all"
                ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                : "bg-surface-2 border-line text-fg-3 hover:text-fg"
            }`}
          >
            ALL ({autoTagRules.length})
          </button>
          {tagDomainFacets.map((f) => {
            const pillDropKey = `pill:${f.slug}`;
            const isPillHover = activeDropKey === pillDropKey;
            return (
              <button
                key={f.slug}
                type="button"
                data-studio-drop-scope={dropScope}
                data-studio-drop-key={pillDropKey}
                data-studio-drop-hint={`↳ Facet: ${f.name}`}
                onClick={() => setFacetFilter(f.slug)}
                className={`h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border transition-colors cursor-pointer ${
                  isPillHover
                    ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-accent"
                    : facetFilter === f.slug
                    ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                    : "bg-surface-2 border-line text-fg-3 hover:text-fg"
                }`}
              >
                {f.name}
              </button>
            );
          })}
        </div>
        {filteredAutoTagRules.length !== autoTagRules.length && (
          <span className="font-mono text-[9px] text-fg-3 tabular-nums shrink-0">
            {filteredAutoTagRules.length} shown
          </span>
        )}
      </div>

      {hasLegacyFlatRules && (
        <div className="px-2.5 py-1.5 bg-accent-soft border-b border-accent/40 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 text-[10px] font-mono text-fg">
            <Sparkles className="w-3 h-3 text-accent-fg shrink-0" />
            <span className="truncate">
              Legacy flat rules detected — upgrade to 2-level nested taxonomy
            </span>
          </div>
          <button
            type="button"
            onClick={() => void onUpgradeLegacyRules()}
            className="h-[20px] px-2 rounded-[2px] bg-accent hover:bg-accent-hover text-accent-on font-mono text-[9.5px] font-semibold shrink-0 transition-colors cursor-pointer"
            title="Non-destructively maps legacy SFX/Music rules into nested Category & Source rules while preserving custom rules and keywords"
          >
            Upgrade Rules
          </button>
        </div>
      )}

      {/* Sleek Library-Parity Tree List (Clean Parent Rows + Indented Rule Rows) */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-1.5 space-y-2 min-h-0 select-none"
      >
        {visibleCategories.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
            No categories or rules found
          </div>
        ) : (
          <div className="space-y-0.5">
            <div className="h-[22px] px-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-head flex items-center justify-between">
              <span className="font-semibold">
                {facetFilter === "all"
                  ? "RULE GROUPS"
                  : (
                      tagDomainFacets.find((f) => f.slug === facetFilter)?.name ??
                      facetFilter
                    ).toUpperCase()}
              </span>
              <span className="text-fg-3 tabular-nums">
                {filteredAutoTagRules.length}
              </span>
            </div>

            {visibleCategories.map(([cat, rules]) => {
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
              const catDropKey = `cat:${cat}`;
              const isDropHover =
                draggingRuleId !== null && activeDropKey === catDropKey;

              const isSourceCat =
                cat.trim().toLowerCase() === "source / pack" ||
                cat.trim().toLowerCase() === "source" ||
                (rules.length > 0 &&
                  rules.every((r) => r.facet_slug === "source"));
              const groupColor =
                rootTagColorByLower.get(cat.trim().toLowerCase()) ||
                rules[0]?.tag_color ||
                deterministicColorForName(cat);

              return (
                <React.Fragment key={cat}>
                  {/* Parent Category Row — exact Library depth-0 row geometry */}
                  <div
                    data-studio-drop-scope={
                      cat !== "Uncategorized" ? dropScope : undefined
                    }
                    data-studio-drop-key={
                      cat !== "Uncategorized" ? catDropKey : undefined
                    }
                    data-studio-drop-hint={
                      cat !== "Uncategorized" ? `↳ Move to ${cat}` : undefined
                    }
                    onClick={() => onSelectCategory(cat)}
                    style={{ paddingLeft: "8px" }}
                    className={`h-[30px] pr-2.5 rounded-xs flex items-center justify-between cursor-pointer text-[11px] group/cat transition-colors ${
                      isDropHover
                        ? "bg-accent-soft border border-accent text-accent-fg ring-1 ring-accent"
                        : isCatSelected
                        ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
                        : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
                    }`}
                    title="Click to edit group Scope & Limits · Drop a rule here to move it into this group"
                  >
                    <div className="flex items-center space-x-1.5 min-w-0 truncate">
                      <button
                        type="button"
                        data-no-press-shift="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCategoryCollapse(cat);
                        }}
                        className="w-3.5 h-3.5 flex items-center justify-center text-fg-3 hover:text-fg shrink-0 cursor-pointer"
                        title={isCollapsed ? "Expand group" : "Collapse group"}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>

                      {isSourceCat ? (
                        <span className="font-mono text-[10.5px] text-fg-3 shrink-0">
                          #
                        </span>
                      ) : (
                        <span
                          className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                          style={{ backgroundColor: groupColor }}
                        />
                      )}

                      <span className="font-semibold truncate text-fg">
                        {cat}
                      </span>

                      {hasFilter && (
                        <span
                          className="w-1.5 h-1.5 rounded-[2px] bg-ok shrink-0"
                          title="Group folder scope paths active"
                        />
                      )}
                    </div>

                    <div
                      className="flex items-center space-x-1.5 shrink-0 ml-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isDropHover && (
                        <span className="font-mono text-[9.5px] text-accent-fg font-semibold">
                          ↳ Move
                        </span>
                      )}

                      <div className="opacity-0 group-hover/cat:opacity-100 focus-within:opacity-100 flex items-center space-x-1 transition-opacity">
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
                            idleClassName="w-[18px] h-[18px] text-fg-2 hover:text-accent-fg hover:bg-accent-soft border border-transparent hover:border-accent/40 rounded-xs flex items-center justify-center cursor-pointer"
                          />
                        )}
                      </div>

                      <span className="font-mono text-[9.5px] text-fg-3 tabular-nums">
                        {rules.length}
                      </span>
                    </div>
                  </div>

                  {/* Child Rule Rows — exact Library depth-1 indented row geometry */}
                  {!isCollapsed &&
                    (rules.length === 0 ? (
                      <div
                        style={{ paddingLeft: "28px" }}
                        className="py-1.5 pr-2 text-[10px] font-mono text-fg-3 italic"
                      >
                        No rules in this group yet.
                      </div>
                    ) : (
                      rules.map((rule) => (
                        <TagRuleTreeRow
                          key={rule.id}
                          rule={rule}
                          categoryName={cat}
                          tagFacets={tagFacets}
                          isSelected={
                            activeInspectedCategory === null &&
                            activeInspectedRule?.id === rule.id
                          }
                          isDraggingSelf={draggingRuleId === rule.id}
                          onSelectRule={onSelectRule}
                          onStartDrag={beginPointerDrag}
                        />
                      ))
                    ))}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
      <StudioDragPill dragState={dragState} />
    </div>
  );
};
