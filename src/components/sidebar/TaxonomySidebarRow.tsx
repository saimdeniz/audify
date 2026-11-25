import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Tag } from "../../types";
import { getTagRollupCount } from "../../utils/taxonomyTree";
import {
  SIDEBAR_TREE_CHILD_HEIGHT,
  SidebarTreeRow,
} from "./SidebarTreeRow";

export interface TaxonomyFacetSectionHeaderProps {
  label: string;
  count: number;
  isOpen: boolean;
  isDropActive?: boolean;
  title: string;
  rightExtra?: React.ReactNode;
  onToggle: () => void;
  dropScope?: string;
  dropKey?: string;
  dropHint?: string;
}

/**
 * Facet group divider aligned to the exact 28px root height & 8px / 22px chevron grid
 * of `SidebarTreeRow` (`Folders` / `Collections`) so every sidebar tab stays pixel-locked.
 */
export const TaxonomyFacetSectionHeader: React.FC<
  TaxonomyFacetSectionHeaderProps
> = ({
  label,
  count,
  isOpen,
  isDropActive = false,
  title,
  rightExtra,
  onToggle,
  dropScope,
  dropKey,
  dropHint,
}) => (
  <div
    data-studio-drop-scope={dropScope}
    data-studio-drop-key={dropKey}
    data-studio-drop-hint={dropHint}
    style={{ paddingLeft: "8px" }}
    className={`group h-[28px] pr-2 border-l-2 border-transparent flex items-center justify-between text-[9.5px] font-mono uppercase tracking-wider transition-colors select-none ${
      isDropActive
        ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-inset ring-accent"
        : "text-fg-head hover:text-fg hover:bg-surface-hover"
    }`}
  >
    <button
      type="button"
      data-no-press-shift="true"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label={`${label} (${count})`}
      title={title}
      className="flex-1 min-w-0 h-full flex items-center justify-between cursor-pointer text-left"
    >
      <span className="flex items-center space-x-1 min-w-0">
        <span className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 shrink-0">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
        <span className="truncate font-semibold">{label}</span>
      </span>
      {!rightExtra && (
        <span className="font-mono tabular-nums text-[11px] font-medium text-fg-2 group-hover:text-fg shrink-0 pl-1">
          {count.toLocaleString()}
        </span>
      )}
    </button>
    {rightExtra && (
      <span className="flex items-center space-x-1 shrink-0 pl-1">
        <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity inline-flex items-center">
          {rightExtra}
        </span>
        <span className="font-mono tabular-nums text-[11px] font-medium text-fg-2 group-hover:text-fg">
          {count.toLocaleString()}
        </span>
      </span>
    )}
  </div>
);

export interface TaxonomySidebarRowProps {
  tag: Tag;
  depth?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  effectiveColor: string;
  breadcrumb: string;
  isSource?: boolean;
  flat?: boolean;
  isSelected: boolean;
  isExcluded: boolean;
  isDraggingInApp: boolean;
  isDraggingSelf?: boolean;
  inAppDragCount: number;
  isDropHover: boolean;
  isDropFlash: boolean;
  isReparentHover: boolean;
  dropLabelPrefix?: string;
  dropScope?: string;
  dropKey?: string;
  dropHint?: string;
  onToggleExpand?: (tagId: number) => void;
  onClick: (e: React.MouseEvent, tag: Tag) => void;
  onContextMenu: (e: React.MouseEvent, tag: Tag) => void;
  onMouseEnterTag: (targetKey: string) => void;
  onPointerDragStart?: (
    e: React.MouseEvent,
    tag: Tag,
    effectiveColor: string,
    isSource: boolean
  ) => void;
}

/**
 * Taxonomy sidebar row composing `SidebarTreeRow` directly so `Tags` and `Genres`
 * match `Folders` and `Collections` in row height, chevron scale, indentation,
 * typography, and tabular counter alignment.
 */
export const TaxonomySidebarRow: React.FC<TaxonomySidebarRowProps> = React.memo(
  ({
    tag,
    depth = 0,
    hasChildren = false,
    isExpanded = false,
    effectiveColor,
    breadcrumb,
    isSource = false,
    flat = false,
    isSelected,
    isExcluded,
    isDraggingInApp,
    isDraggingSelf = false,
    inAppDragCount,
    isDropHover,
    isDropFlash,
    isReparentHover,
    dropLabelPrefix = "Tag",
    dropScope,
    dropKey,
    dropHint,
    onToggleExpand,
    onClick,
    onContextMenu,
    onMouseEnterTag,
    onPointerDragStart,
  }) => {
    const rollup = getTagRollupCount(tag);
    const targetKey = `tag-${tag.id}`;

    const resolvedDropHint = isReparentHover
      ? "↳ Nest"
      : isDropHover
      ? inAppDragCount > 1
        ? `＋ ${dropLabelPrefix} (${inAppDragCount})`
        : `＋ ${dropLabelPrefix}`
      : null;

    const iconNode = isSource ? (
      <span className="w-3.5 h-3.5 flex items-center justify-center font-mono text-[11px] text-fg-3 shrink-0">
        #
      </span>
    ) : (
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
        <span
          className={`${
            depth === 0 && !flat ? "w-2.5 h-2.5" : "w-2 h-2"
          } rounded-[2px] shrink-0`}
          style={{ backgroundColor: effectiveColor }}
        />
      </span>
    );

    const labelNode = isExcluded ? (
      <span
        className={`truncate pl-0.5 line-through opacity-75 ${
          depth === 0 && !flat ? "font-semibold" : ""
        }`}
      >
        {tag.name}
      </span>
    ) : flat ? (
      <span className="truncate pl-0.5">{tag.name}</span>
    ) : undefined;

    return (
      <SidebarTreeRow
        depth={flat ? 0 : depth}
        label={tag.name}
        labelReplacement={labelNode}
        count={rollup}
        hasChildren={!flat && !isSource && hasChildren}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isDragHover={isDropHover || isReparentHover}
        isDropFlashing={isDropFlash}
        dimmed={rollup === 0 && !isSelected && !isExcluded}
        onToggleExpand={
          !flat && !isSource && hasChildren && onToggleExpand
            ? () => onToggleExpand(tag.id)
            : undefined
        }
        toggleTitle={isExpanded ? "Collapse" : "Expand"}
        dropHint={resolvedDropHint}
        icon={iconNode}
        actions={
          isExcluded ? (
            <span className="font-mono text-[9px] uppercase text-accent-fg px-1 rounded-[2px] bg-accent-soft border border-accent/40 shrink-0">
              NOT
            </span>
          ) : undefined
        }
        style={flat ? { height: `${SIDEBAR_TREE_CHILD_HEIGHT}px` } : undefined}
        className={`${
          isDraggingSelf ? "opacity-45" : ""
        } ${isExcluded ? "bg-surface-3 border-accent/60 text-fg-2" : ""}`}
        data-sidebar-drop={targetKey}
        data-studio-drop-scope={dropScope}
        data-studio-drop-key={dropKey}
        data-studio-drop-hint={dropHint}
        onMouseDown={
          !isDraggingInApp && onPointerDragStart
            ? (e) => onPointerDragStart(e, tag, effectiveColor, isSource)
            : undefined
        }
        onMouseEnter={() => onMouseEnterTag(targetKey)}
        onClick={(e) => onClick(e, tag)}
        onContextMenu={(e) => onContextMenu(e, tag)}
        title={`${breadcrumb} · Click: Filter · Ctrl+Click: Multi · Alt+Click: Exclude · Drag onto a group to reorganize`}
      />
    );
  }
);
