import React from "react";
import { FolderTree, GripVertical } from "lucide-react";
import type { AutoTagRule, TagFacet } from "../../types";
import { deriveChildTonalColor } from "../../utils/taxonomyColor";
import { isFacetHierarchical } from "../../utils/taxonomyTree";

interface TagRuleTreeRowProps {
  rule: AutoTagRule;
  categoryName: string;
  tagFacets: readonly TagFacet[];
  isSelected: boolean;
  isDraggingSelf: boolean;
  onSelectRule: (ruleId: string) => void;
  onStartDrag: (
    e: React.MouseEvent,
    ruleId: string,
    visual: { label: string; swatchColor?: string; prefixSymbol?: string }
  ) => void;
}

export const TagRuleTreeRow: React.FC<TagRuleTreeRowProps> = ({
  rule,
  categoryName,
  tagFacets,
  isSelected,
  isDraggingSelf,
  onSelectRule,
  onStartDrag,
}) => {
  const hasOverrides =
    (rule.include_paths?.length || 0) +
      (rule.exclude_paths?.length || 0) +
      (rule.rel_include_paths?.length || 0) +
      (rule.rel_exclude_paths?.length || 0) >
      0 ||
    rule.min_duration_ms != null ||
    rule.max_duration_ms != null;

  const ruleFacet = rule.facet_slug || "category";
  const isSourceRule = ruleFacet === "source";
  const displayColor =
    rule.parent_tag_name && isFacetHierarchical(ruleFacet, tagFacets)
      ? deriveChildTonalColor(rule.tag_color, rule.tag_name, 2)
      : rule.tag_color;
  const showParentHint =
    Boolean(rule.parent_tag_name) &&
    rule.parent_tag_name!.toLowerCase() !== categoryName.toLowerCase();

  return (
    <div
      onMouseDown={(e) =>
        onStartDrag(e, rule.id, {
          label: rule.tag_name,
          swatchColor: isSourceRule ? undefined : displayColor,
          prefixSymbol: isSourceRule ? "#" : undefined,
        })
      }
      onClick={() => onSelectRule(rule.id)}
      style={{ paddingLeft: "24px" }}
      className={`group/rule h-[30px] pr-2.5 rounded-xs flex items-center justify-between cursor-grab active:cursor-grabbing text-[11px] transition-colors ${
        isDraggingSelf
          ? "opacity-45 bg-surface-2 border border-dashed border-accent"
          : isSelected
          ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
          : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
      } ${rule.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-center min-w-0 truncate space-x-1.5">
        <span className="w-3.5 shrink-0 flex items-center justify-center">
          <GripVertical className="w-2.5 h-2.5 text-fg-faint opacity-0 group-hover/rule:opacity-80 transition-opacity" />
        </span>
        {isSourceRule ? (
          <span className="font-mono text-[10.5px] text-fg-3 shrink-0">#</span>
        ) : (
          <span
            className="w-2.5 h-2.5 rounded-[2px] shrink-0"
            style={{ backgroundColor: displayColor }}
          />
        )}
        <span className="font-medium truncate text-fg">{rule.tag_name}</span>
        {showParentHint && (
          <span className="font-mono text-[9px] text-fg-3 truncate">
            ▸ {rule.parent_tag_name}
          </span>
        )}

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
};
