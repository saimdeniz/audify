import React from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { Tag, TagFacet } from "../../types";
import { getTagRollupCount } from "../../utils/taxonomyTree";
import type { StudioDragPayload } from "./TaxonomyStudioHeaderBars";

interface TaxonomyStudioRowProps {
  dropScope: string;
  facet: TagFacet;
  hierarchical: boolean;
  isSource: boolean;
  tag: Tag;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  effectiveColor: string;
  isSelected: boolean;
  isDraggingSelf: boolean;
  activeDropKey: string | null;
  onSelectTag: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onBeginDrag: (
    e: React.MouseEvent,
    payload: StudioDragPayload,
    visual: { label: string; swatchColor?: string; prefixSymbol?: string }
  ) => void;
}

export const TaxonomyStudioRow: React.FC<TaxonomyStudioRowProps> = React.memo(
  ({
    dropScope,
    facet,
    hierarchical,
    isSource,
    tag,
    depth,
    hasChildren,
    isExpanded,
    effectiveColor,
    isSelected,
    isDraggingSelf,
    activeDropKey,
    onSelectTag,
    onToggleExpand,
    onBeginDrag,
  }) => {
    const rollup = getTagRollupCount(tag);
    const nodeDropKey = `node:${facet.slug}:${tag.id}`;
    const beforeDropKey = `before:${facet.slug}:${tag.id}`;
    const afterDropKey = `after:${facet.slug}:${tag.id}`;
    const isNodeDropHover = hierarchical && activeDropKey === nodeDropKey;
    const isBeforeHover = activeDropKey === beforeDropKey;
    const isAfterHover = activeDropKey === afterDropKey;

    return (
      <div
        data-studio-drop-scope={dropScope}
        data-studio-drop-key={hierarchical ? nodeDropKey : undefined}
        data-studio-drop-hint={
          hierarchical ? `↳ Nest under ${tag.name}` : undefined
        }
        data-studio-drop-before-key={beforeDropKey}
        data-studio-drop-before-hint={`↑ Move before ${tag.name}`}
        data-studio-drop-after-key={afterDropKey}
        data-studio-drop-after-hint={`↓ Move after ${tag.name}`}
        onMouseDown={(e) =>
          onBeginDrag(
            e,
            { kind: "tag", id: tag.id },
            {
              label: tag.name,
              swatchColor: isSource ? undefined : effectiveColor,
              prefixSymbol: isSource ? "#" : undefined,
            }
          )
        }
        onClick={() => onSelectTag(tag.id)}
        style={{
          paddingLeft: `${hierarchical ? 8 + depth * 16 : 10}px`,
        }}
        className={`relative group/row h-[30px] pr-2.5 rounded-xs flex items-center justify-between cursor-grab active:cursor-grabbing text-[11px] transition-colors ${
          isDraggingSelf
            ? "opacity-45 bg-surface-2 border border-dashed border-accent"
            : isNodeDropHover
            ? "bg-accent-soft border border-accent text-accent-fg ring-1 ring-accent"
            : isSelected
            ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
            : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
        }`}
      >
        {isBeforeHover && (
          <span className="absolute left-0 right-0 -top-[2px] h-[2px] bg-accent rounded-xs pointer-events-none z-10" />
        )}
        {isAfterHover && (
          <span className="absolute left-0 right-0 -bottom-[2px] h-[2px] bg-accent rounded-xs pointer-events-none z-10" />
        )}
        <div className="flex items-center space-x-1.5 truncate min-w-0">
          {hierarchical && hasChildren ? (
            <button
              type="button"
              data-no-press-shift="true"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(tag.id);
              }}
              className="w-3.5 h-3.5 flex items-center justify-center text-fg-3 hover:text-fg shrink-0 cursor-pointer"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          ) : hierarchical ? (
            <span className="w-3.5 shrink-0 flex items-center justify-center">
              <GripVertical className="w-2.5 h-2.5 text-fg-faint opacity-0 group-hover/row:opacity-80 transition-opacity" />
            </span>
          ) : (
            <GripVertical className="w-2.5 h-2.5 text-fg-faint opacity-0 group-hover/row:opacity-80 shrink-0 transition-opacity" />
          )}

          {isSource ? (
            <span className="font-mono text-[10.5px] text-fg-3 shrink-0">#</span>
          ) : (
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: effectiveColor }}
            />
          )}
          <span className="font-medium truncate text-fg">{tag.name}</span>
          {(tag.aliases?.length ?? 0) > 0 && (
            <span className="font-mono text-[9px] text-fg-3 truncate">
              ({tag.aliases!.slice(0, 2).join(", ")})
            </span>
          )}
        </div>

        <span className="flex items-center gap-1.5 shrink-0 ml-2">
          {isNodeDropHover && (
            <span className="font-mono text-[9.5px] text-accent-fg font-semibold">
              ↳ Nest
            </span>
          )}
          <span className="font-mono text-[9.5px] text-fg-3 tabular-nums">
            {rollup.toLocaleString()}
          </span>
        </span>
      </div>
    );
  }
);
