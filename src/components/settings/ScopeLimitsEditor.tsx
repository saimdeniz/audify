import React from "react";
import {
  ChevronDown,
  Clock,
  FolderPlus,
  FolderTree,
  RotateCcw,
  X,
} from "lucide-react";
import { AutoTagCategoryConfig } from "../../types";
import { folderNameFromPath } from "../../utils/format";

export interface ScopeLimitsEditorProps {
  mode: "rule" | "category";
  isOpen: boolean;
  onToggleOpen?: () => void;
  collapsible?: boolean;
  categoryName?: string;
  categoryConfig?: AutoTagCategoryConfig | null;
  includePaths: string[];
  excludePaths: string[];
  onAddIncludePath: () => void;
  onRemoveIncludePath: (path: string) => void;
  onAddExcludePath: () => void;
  onRemoveExcludePath: (path: string) => void;
  onResetIncludeToCategory?: () => void;
  minDurationMs?: number;
  maxDurationMs?: number;
  onChangeMinDurationMs?: (ms: number | undefined) => void;
  onChangeMaxDurationMs?: (ms: number | undefined) => void;
}

function renderScopePathLabel(path: string): string {
  const leaf = folderNameFromPath(path);
  return leaf || path;
}

/**
 * Unified Scope & Limits editor shared by Category Inspector (bulk include/exclude
 * paths for a tag group) and Rule Inspector (rule-level override + inherited badges +
 * duration limits).
 */
export const ScopeLimitsEditor: React.FC<ScopeLimitsEditorProps> = ({
  mode,
  isOpen,
  onToggleOpen,
  collapsible = true,
  categoryName,
  categoryConfig,
  includePaths,
  excludePaths,
  onAddIncludePath,
  onRemoveIncludePath,
  onAddExcludePath,
  onRemoveExcludePath,
  onResetIncludeToCategory,
  minDurationMs,
  maxDurationMs,
  onChangeMinDurationMs,
  onChangeMaxDurationMs,
}) => {
  const catIncludePaths = categoryConfig?.include_paths || [];
  const catRelIncludePaths = categoryConfig?.rel_include_paths || [];
  const inheritedIncludes =
    catIncludePaths.length > 0 ? catIncludePaths : catRelIncludePaths;

  const catExcludePaths = categoryConfig?.exclude_paths || [];
  const catRelExcludePaths = categoryConfig?.rel_exclude_paths || [];
  const inheritedExcludes =
    catExcludePaths.length > 0 ? catExcludePaths : catRelExcludePaths;

  const hasOwnScope =
    includePaths.length > 0 ||
    excludePaths.length > 0 ||
    (mode === "rule" && (minDurationMs != null || maxDurationMs != null));

  const hasAnyEffectiveScope =
    hasOwnScope ||
    (mode === "rule" &&
      (inheritedIncludes.length > 0 || inheritedExcludes.length > 0));

  const isRuleOverridingCategoryInclude =
    mode === "rule" && includePaths.length > 0 && inheritedIncludes.length > 0;

  return (
    <div className="border border-line rounded-xs overflow-hidden">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggleOpen}
          className="w-full h-[26px] px-2 bg-surface-soft hover:bg-surface-2 flex items-center justify-between text-[10px] font-mono text-fg-2 transition-colors cursor-pointer select-none"
        >
          <span className="flex items-center space-x-1.5 font-medium">
            <FolderTree className="w-3 h-3 text-accent-fg shrink-0" />
            <span>Scope &amp; Limits</span>
            {hasAnyEffectiveScope && (
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  hasOwnScope ? "bg-ok" : "bg-info"
                }`}
                title={
                  hasOwnScope
                    ? "Explicit scope or duration limit configured"
                    : `Inherits scope from category "${categoryName}"`
                }
              />
            )}
          </span>
          <ChevronDown
            className={`w-3 h-3 text-fg-3 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      ) : (
        <div className="w-full h-[26px] px-2 bg-surface-soft flex items-center justify-between text-[10px] font-mono text-fg-2 select-none">
          <span className="flex items-center space-x-1.5 font-medium">
            <FolderTree className="w-3 h-3 text-accent-fg shrink-0" />
            <span>Category Scope Paths</span>
            {hasOwnScope && (
              <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
            )}
          </span>
        </div>
      )}

      {isOpen && (
        <div className="p-2 bg-surface-1 border-t border-line space-y-2 text-[10px]">
          {mode === "category" && (
            <p className="text-[9.5px] font-mono text-fg-3 leading-relaxed">
              Applies to all rules in{" "}
              <span className="text-fg font-semibold">
                {categoryName || "this category"}
              </span>{" "}
              that don&apos;t define their own include folders. Exclusions always
              combine with rule exclusions.
            </p>
          )}

          {/* INCLUDE FOLDERS */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1.5 font-mono text-[9px] text-accent-fg font-semibold">
              <div className="flex items-center gap-1.5 min-w-0">
                <span>INCLUDE FOLDERS</span>
                {isRuleOverridingCategoryInclude && (
                  <span
                    className="px-1 py-0.2 rounded-xs bg-info/15 border border-info/30 text-info font-normal"
                    title={`Rule include paths override category "${categoryName}" includes`}
                  >
                    Override
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {mode === "rule" &&
                  includePaths.length > 0 &&
                  onResetIncludeToCategory && (
                    <button
                      type="button"
                      onClick={onResetIncludeToCategory}
                      className="h-[18px] px-1.5 bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg rounded-xs inline-flex items-center gap-1 font-normal cursor-pointer"
                      title={
                        inheritedIncludes.length > 0
                          ? `Reset to inherit from category "${categoryName}"`
                          : "Clear include folders"
                      }
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Reset to category</span>
                    </button>
                  )}
                <button
                  type="button"
                  onClick={onAddIncludePath}
                  className="w-[18px] h-[18px] bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 rounded-xs flex items-center justify-center cursor-pointer"
                  title="Browse folder to include"
                >
                  <FolderPlus className="w-2.5 h-2.5 text-accent-fg" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {includePaths.length > 0 ? (
                includePaths.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center space-x-1 bg-surface-2 border border-line font-mono text-[9px] text-fg px-1.5 py-0.5 rounded-xs"
                  >
                    <span className="truncate max-w-[140px]" title={p}>
                      {renderScopePathLabel(p)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveIncludePath(p)}
                      className="hover:text-accent-fg ml-0.5 cursor-pointer"
                      title={`Remove "${p}"`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))
              ) : mode === "rule" && inheritedIncludes.length > 0 ? (
                <div className="w-full space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {inheritedIncludes.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1 bg-info/10 border border-info/30 text-info font-mono text-[9px] px-1.5 py-0.5 rounded-xs"
                        title={`Inherited from category "${categoryName}": ${p}`}
                      >
                        <span className="truncate max-w-[140px]">
                          {renderScopePathLabel(p)}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="text-[9.5px] font-mono text-fg-3">
                    Inherited from {categoryName}. Add a folder above to override.
                  </div>
                </div>
              ) : (
                <span className="text-fg-3 font-mono text-[9px]">
                  {mode === "category"
                    ? "All library folders (no restriction)"
                    : categoryName
                    ? `Category default (${categoryName}: all folders)`
                    : "All library folders"}
                </span>
              )}
            </div>
          </div>

          {/* EXCLUDE FOLDERS */}
          <div className="space-y-1">
            <div className="flex items-center justify-between font-mono text-[9px] text-danger font-semibold">
              <span>EXCLUDE FOLDERS</span>
              <button
                type="button"
                onClick={onAddExcludePath}
                className="w-[18px] h-[18px] bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 rounded-xs flex items-center justify-center cursor-pointer"
                title="Browse folder to exclude"
              >
                <FolderPlus className="w-2.5 h-2.5 text-danger" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {mode === "rule" &&
                inheritedExcludes.map((p) => (
                  <span
                    key={`cat-exc-${p}`}
                    className="inline-flex items-center gap-1 bg-surface-soft border border-danger/20 text-fg-2 font-mono text-[9px] px-1.5 py-0.5 rounded-xs"
                    title={`Inherited exclude from category "${categoryName}": ${p}`}
                  >
                    <span className="text-[9.5px] text-danger font-semibold">
                      {categoryName}:
                    </span>
                    <span className="truncate max-w-[120px]">
                      {renderScopePathLabel(p)}
                    </span>
                  </span>
                ))}

              {excludePaths.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center space-x-1 bg-danger/15 border border-danger/30 text-danger font-mono text-[9px] px-1.5 py-0.5 rounded-xs"
                >
                  <span className="truncate max-w-[140px]" title={p}>
                    {renderScopePathLabel(p)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveExcludePath(p)}
                    className="hover:text-fg ml-0.5 cursor-pointer"
                    title={`Remove exclusion "${p}"`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}

              {excludePaths.length === 0 &&
                (mode === "category" || inheritedExcludes.length === 0) && (
                  <span className="text-fg-3 font-mono text-[9px]">None</span>
                )}
            </div>
          </div>

          {/* DURATION LIMITS (Rule-only) */}
          {mode === "rule" &&
            onChangeMinDurationMs &&
            onChangeMaxDurationMs && (
              <div className="pt-1.5 border-t border-line flex items-center justify-between gap-1 text-[9.5px] font-mono">
                <div className="flex items-center space-x-1 text-fg-3">
                  <Clock className="w-3 h-3 text-accent-fg shrink-0" />
                  <span>DURATION:</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-fg-3">Min</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={
                      minDurationMs != null
                        ? (minDurationMs / 1000).toString()
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      const parsed = parseFloat(v);
                      const ms =
                        v && Number.isFinite(parsed) && parsed >= 0
                          ? Math.round(parsed * 1000)
                          : undefined;
                      onChangeMinDurationMs(ms);
                    }}
                    placeholder="0s"
                    className="w-11 h-[20px] bg-surface-2 border border-line focus:border-accent text-center font-mono text-[9px] text-fg rounded-xs outline-none"
                  />
                  <span className="text-fg-3">Max</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={
                      maxDurationMs != null
                        ? (maxDurationMs / 1000).toString()
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      const parsed = parseFloat(v);
                      const ms =
                        v && Number.isFinite(parsed) && parsed >= 0
                          ? Math.round(parsed * 1000)
                          : undefined;
                      onChangeMaxDurationMs(ms);
                    }}
                    placeholder="∞"
                    className="w-11 h-[20px] bg-surface-2 border border-line focus:border-accent text-center font-mono text-[9px] text-fg rounded-xs outline-none"
                  />
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};
