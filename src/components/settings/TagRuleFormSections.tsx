import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Zap } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import {
  AutoTagCategoryConfig,
  AutoTagPreviewResult,
  AutoTagRule,
} from "../../types";
import { ColorPickerPopover } from "../ColorPickerPopover";
import { ModernToggleSwitch } from "./ModernToggleSwitch";
import { ScopeLimitsEditor } from "./ScopeLimitsEditor";

interface TagRuleCategoryPanelProps {
  activeInspectedCategory: string;
  activeCategoryConfig: AutoTagCategoryConfig;
  catRules: AutoTagRule[];
  inspectorCategoryName: string;
  setInspectorCategoryName: (v: string) => void;
  onSelectCategory: (cat: string | null) => void;
  onSelectRule: (id: string) => void;
  renameAutoTagCategory: (oldName: string, newName: string) => Promise<void>;
  setAutoTagCategoryPaths: (
    categoryName: string,
    includePaths: string[],
    excludePaths: string[]
  ) => Promise<void>;
  handleBrowseCategoryPath: (
    categoryName: string,
    isInclude: boolean
  ) => Promise<void>;
}

/**
 * Category-level scope and name editor inside the Tags & Rules inspector.
 */
export const TagRuleCategoryPanel: React.FC<TagRuleCategoryPanelProps> = ({
  activeInspectedCategory,
  activeCategoryConfig,
  catRules,
  inspectorCategoryName,
  setInspectorCategoryName,
  onSelectCategory,
  onSelectRule,
  renameAutoTagCategory,
  setAutoTagCategoryPaths,
  handleBrowseCategoryPath,
}) => {
  const enabledRulesCount = catRules.filter((r) => r.enabled).length;
  const catInc = activeCategoryConfig.include_paths || [];
  const catExc = activeCategoryConfig.exclude_paths || [];

  return (
    <>
      <div className="space-y-1">
        <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-medium">
          Category Name
        </label>
        <input
          type="text"
          value={inspectorCategoryName}
          disabled={activeInspectedCategory === "Uncategorized"}
          onChange={(e) => setInspectorCategoryName(e.target.value)}
          onBlur={() => {
            const clean = inspectorCategoryName.trim();
            if (
              clean &&
              clean !== activeInspectedCategory &&
              activeInspectedCategory !== "Uncategorized"
            ) {
              void renameAutoTagCategory(activeInspectedCategory, clean);
              onSelectCategory(clean);
            } else {
              setInspectorCategoryName(activeInspectedCategory);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setInspectorCategoryName(activeInspectedCategory);
              e.currentTarget.blur();
            }
          }}
          className="w-full h-[26px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg outline-none rounded-xs disabled:opacity-60"
        />
      </div>

      <ScopeLimitsEditor
        mode="category"
        isOpen={true}
        collapsible={false}
        categoryName={activeInspectedCategory}
        includePaths={catInc}
        excludePaths={catExc}
        onAddIncludePath={() =>
          void handleBrowseCategoryPath(activeInspectedCategory, true)
        }
        onRemoveIncludePath={(p) =>
          void setAutoTagCategoryPaths(
            activeInspectedCategory,
            catInc.filter((x) => x !== p),
            catExc
          )
        }
        onAddExcludePath={() =>
          void handleBrowseCategoryPath(activeInspectedCategory, false)
        }
        onRemoveExcludePath={(p) =>
          void setAutoTagCategoryPaths(
            activeInspectedCategory,
            catInc,
            catExc.filter((x) => x !== p)
          )
        }
      />

      <div className="bg-surface-soft border border-line rounded-xs p-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-fg-3 uppercase font-semibold">
            Child Rules ({catRules.length})
          </span>
          <span className="text-fg-2 tabular-nums">
            {enabledRulesCount} enabled
          </span>
        </div>
        {catRules.length === 0 ? (
          <div className="text-[9.5px] font-mono text-fg-3">
            No rules assigned to this category yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1 max-h-[110px] overflow-y-auto">
            {catRules.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRule(r.id)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-[9.5px] font-mono text-fg cursor-pointer transition-colors"
                title={`Inspect rule "${r.tag_name}"`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-[2px] shrink-0"
                  style={{ backgroundColor: r.tag_color }}
                />
                <span className="truncate max-w-[110px]">{r.tag_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

interface TagRuleEditorPanelProps {
  activeInspectedRule: AutoTagRule;
  activeRuleCategoryConfig: AutoTagCategoryConfig | null;
  allAvailableCategories: string[];
  inspectorRuleTagName: string;
  setInspectorRuleTagName: (v: string) => void;
  inspectorRuleKeywords: string;
  setInspectorRuleKeywords: (v: string) => void;
  isRuleCategoryDropdownOpen: boolean;
  setIsRuleCategoryDropdownOpen: (v: boolean) => void;
  isRuleOverridesOpen: boolean;
  setIsRuleOverridesOpen: (v: boolean) => void;
  inspectedRulePreview: AutoTagPreviewResult | null;
  updateAutoTagRule: (
    ruleId: string,
    patch: Partial<AutoTagRule>
  ) => Promise<void>;
  runRulePreview: (rule: AutoTagRule, keywordsDraft: string) => Promise<void>;
  handleBrowseRulePath: (ruleId: string, isInclude: boolean) => Promise<void>;
}

/**
 * Rule-level criteria, match test preview, and scope overrides form inside the inspector.
 */
export const TagRuleEditorPanel: React.FC<TagRuleEditorPanelProps> = ({
  activeInspectedRule,
  activeRuleCategoryConfig,
  allAvailableCategories,
  inspectorRuleTagName,
  setInspectorRuleTagName,
  inspectorRuleKeywords,
  setInspectorRuleKeywords,
  isRuleCategoryDropdownOpen,
  setIsRuleCategoryDropdownOpen,
  isRuleOverridesOpen,
  setIsRuleOverridesOpen,
  inspectedRulePreview,
  updateAutoTagRule,
  runRulePreview,
  handleBrowseRulePath,
}) => {
  const excludedKeywords = (activeInspectedRule.keywords || []).filter(
    (k) => k.startsWith("!") || k.startsWith("-")
  );
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [categoryMenuPos, setCategoryMenuPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!isRuleCategoryDropdownOpen) return;
    const update = () => {
      const rect = categoryTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCategoryMenuPos({
        top: Math.min(rect.bottom + 4, window.innerHeight - 220),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 152)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isRuleCategoryDropdownOpen]);

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <ModernToggleSwitch
          checked={activeInspectedRule.enabled}
          onChange={(val) =>
            void updateAutoTagRule(activeInspectedRule.id, {
              enabled: val,
            })
          }
          title="Toggle rule ON / OFF"
        />

        <div className="relative shrink-0">
          <button
            ref={categoryTriggerRef}
            type="button"
            onClick={() =>
              setIsRuleCategoryDropdownOpen(!isRuleCategoryDropdownOpen)
            }
            className="h-[24px] px-2 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line rounded-xs font-mono text-[10px] text-fg flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="Rule Category"
          >
            <span className="font-semibold text-accent-fg">
              {activeInspectedRule.category || "SFX"}
            </span>
            <ChevronDown className="w-2.5 h-2.5 text-fg-3 shrink-0" />
          </button>

          {isRuleCategoryDropdownOpen &&
            createPortal(
              <>
                <div
                  style={{ zIndex: Z_INDEX.contextMenu }}
                  className="fixed inset-0"
                  onClick={() => setIsRuleCategoryDropdownOpen(false)}
                />
                <div
                  data-settings-dropdown-open="true"
                  data-mica-overlay="true"
                  style={{
                    top: categoryMenuPos.top,
                    left: categoryMenuPos.left,
                    zIndex: Z_INDEX.floatingMenu,
                  }}
                  className="fixed w-36 max-h-[240px] overflow-y-auto bg-surface-2 border border-line rounded-md shadow-2xl py-1 font-mono text-[10px] backdrop-blur-md"
                >
                  {allAvailableCategories.map((c) => {
                    const isCurrent =
                      (activeInspectedRule.category || "SFX").toLowerCase() ===
                      c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          void updateAutoTagRule(activeInspectedRule.id, {
                            category: c,
                          });
                          setIsRuleCategoryDropdownOpen(false);
                        }}
                        className={`w-full px-2.5 py-1 text-left flex items-center justify-between transition-colors cursor-pointer ${
                          isCurrent
                            ? "bg-accent-soft text-accent-fg font-bold"
                            : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                        }`}
                      >
                        <span>{c}</span>
                        {isCurrent && (
                          <Check className="w-2.5 h-2.5 text-accent-fg shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </>,
              document.body
            )}
        </div>

        <div className="flex items-center space-x-1.5 bg-surface-soft border border-line px-1.5 h-[24px] rounded-xs ml-auto">
          <ColorPickerPopover
            color={activeInspectedRule.tag_color}
            onChange={(c) =>
              void updateAutoTagRule(activeInspectedRule.id, {
                tag_color: c,
              })
            }
            triggerSize="xs"
            align="right"
            title="Rule Color (16M Colors)"
          />
          <span className="font-mono text-[9.5px] text-fg-2 uppercase">
            {activeInspectedRule.tag_color}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-medium">
          Tag Name
        </label>
        <input
          type="text"
          value={inspectorRuleTagName}
          onChange={(e) => setInspectorRuleTagName(e.target.value)}
          onBlur={() => {
            const clean = inspectorRuleTagName.trim();
            if (clean && clean !== activeInspectedRule.tag_name) {
              void updateAutoTagRule(activeInspectedRule.id, {
                tag_name: clean,
              });
            } else {
              setInspectorRuleTagName(activeInspectedRule.tag_name);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setInspectorRuleTagName(activeInspectedRule.tag_name);
              e.currentTarget.blur();
            }
          }}
          className="w-full h-[26px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg outline-none rounded-xs"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-medium">
            Match Keywords
          </label>
          {excludedKeywords.length > 0 && (
            <span
              className="font-mono text-[8.5px] text-danger bg-danger/15 border border-danger/30 px-1 rounded-xs"
              title={`Exclusions: ${excludedKeywords.join(", ")}`}
            >
              !{excludedKeywords.length} excluded
            </span>
          )}
        </div>
        <textarea
          value={inspectorRuleKeywords}
          onChange={(e) => setInspectorRuleKeywords(e.target.value)}
          onBlur={() => {
            const kws = inspectorRuleKeywords
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);
            if (kws.length > 0) {
              void updateAutoTagRule(activeInspectedRule.id, {
                keywords: kws,
              });
            } else {
              setInspectorRuleKeywords(
                (activeInspectedRule.keywords || []).join(", ")
              );
            }
          }}
          placeholder="whoosh, !music, @dur<2s, metal + impact..."
          rows={4}
          className="w-full h-[88px] bg-surface-2 border border-line focus:border-accent p-2 text-[10.5px] font-mono text-fg outline-none rounded-xs resize-none leading-relaxed"
        />
      </div>

      <div className="bg-surface-soft border border-line rounded-xs p-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Zap className="w-3 h-3 text-accent-fg shrink-0" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-3">
              MATCHING FILES
            </span>
            <span className="font-mono text-[12px] font-bold text-accent-fg tabular-nums">
              {inspectedRulePreview
                ? inspectedRulePreview.match_count.toLocaleString()
                : "—"}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              void runRulePreview(activeInspectedRule, inspectorRuleKeywords)
            }
            className="h-[20px] px-2 rounded-xs bg-surface-3 hover:bg-surface-2 border border-line text-[9.5px] font-mono text-fg-2 hover:text-fg transition-colors cursor-pointer"
            title="Run match test"
          >
            Refresh
          </button>
        </div>

        {inspectedRulePreview && inspectedRulePreview.sample_names.length > 0 ? (
          <div className="max-h-[176px] overflow-y-auto text-[9.5px] font-mono text-fg-3 divide-y divide-line-subtle">
            {inspectedRulePreview.sample_names.slice(0, 12).map((name) => (
              <div key={name} className="py-0.5 truncate text-fg-2">
                {name}
              </div>
            ))}
            {inspectedRulePreview.sample_names.length > 12 && (
              <div className="text-[9px] text-fg-3 py-0.5 font-semibold">
                +{inspectedRulePreview.sample_names.length - 12} more files
              </div>
            )}
          </div>
        ) : (
          <div className="text-[9.5px] font-mono text-fg-3">
            0 matching samples in library
          </div>
        )}
      </div>

      <ScopeLimitsEditor
        mode="rule"
        isOpen={isRuleOverridesOpen}
        onToggleOpen={() => setIsRuleOverridesOpen(!isRuleOverridesOpen)}
        categoryName={activeInspectedRule.category || "SFX"}
        categoryConfig={activeRuleCategoryConfig}
        includePaths={activeInspectedRule.include_paths || []}
        excludePaths={activeInspectedRule.exclude_paths || []}
        onAddIncludePath={() =>
          void handleBrowseRulePath(activeInspectedRule.id, true)
        }
        onRemoveIncludePath={(p) => {
          const inc = (activeInspectedRule.include_paths || []).filter(
            (x) => x !== p
          );
          void updateAutoTagRule(activeInspectedRule.id, {
            include_paths: inc,
          });
        }}
        onAddExcludePath={() =>
          void handleBrowseRulePath(activeInspectedRule.id, false)
        }
        onRemoveExcludePath={(p) => {
          const exc = (activeInspectedRule.exclude_paths || []).filter(
            (x) => x !== p
          );
          void updateAutoTagRule(activeInspectedRule.id, {
            exclude_paths: exc,
          });
        }}
        onResetIncludeToCategory={() =>
          void updateAutoTagRule(activeInspectedRule.id, {
            include_paths: [],
          })
        }
        minDurationMs={activeInspectedRule.min_duration_ms}
        maxDurationMs={activeInspectedRule.max_duration_ms}
        onChangeMinDurationMs={(ms) =>
          void updateAutoTagRule(activeInspectedRule.id, {
            min_duration_ms: ms,
          })
        }
        onChangeMaxDurationMs={(ms) =>
          void updateAutoTagRule(activeInspectedRule.id, {
            max_duration_ms: ms,
          })
        }
      />
    </>
  );
};
