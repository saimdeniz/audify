import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import type { Tag } from "../../types";

export interface SuggestedTagEntry {
  tag: Tag;
  matchCount: number;
  isSelected: boolean;
  isSource?: boolean;
  color?: string;
  breadcrumb?: string;
}

interface ToolbarTagOverflowPopoverProps {
  popoverRef: React.RefObject<HTMLDivElement>;
  pos: { top: number; right: number };
  overflowTags: SuggestedTagEntry[];
  onToggleTag: (tagId: number) => void;
  onExcludeTag: (tagId: number) => void;
  onClose: () => void;
}

export const ToolbarTagOverflowPopover: React.FC<
  ToolbarTagOverflowPopoverProps
> = ({
  popoverRef,
  pos,
  overflowTags,
  onToggleTag,
  onExcludeTag,
  onClose,
}) =>
  createPortal(
    <div
      ref={popoverRef}
      data-context-menu-portal="true"
      data-popover-portal="true"
      data-mica-overlay="true"
      style={{
        top: pos.top,
        right: pos.right,
        zIndex: Z_INDEX.floatingMenu,
      }}
      onClick={(e) => e.stopPropagation()}
      className="fixed w-[290px] max-w-[85vw] bg-surface-2 audify-overlay-surface border border-line-strong rounded-md shadow-2xl p-2 space-y-1.5"
    >
      <div className="flex items-center justify-between border-b border-line pb-1">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-fg-2">
          More Matching Tags ({overflowTags.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-[18px] h-[18px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-3"
          title="Close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto pr-0.5">
        {overflowTags.map(
          ({ tag, matchCount, isSelected, isSource, color, breadcrumb }) => (
            <button
              key={tag.id}
              type="button"
              onClick={(e) => {
                if (e.altKey) {
                  onExcludeTag(tag.id);
                } else {
                  onToggleTag(tag.id);
                }
              }}
              className={`h-[23px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 transition-colors ${
                isSelected
                  ? "bg-accent-soft border-accent text-accent-fg font-medium"
                  : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
              }`}
              title={`${breadcrumb ?? tag.name} (${matchCount.toLocaleString()} in current view) — Click to refine filter · Alt+Click to exclude`}
            >
              {isSource ? (
                <span className="font-mono text-[10px] opacity-80 shrink-0">
                  #
                </span>
              ) : (
                <span
                  className="w-2 h-2 rounded-[2px] shrink-0"
                  style={{ backgroundColor: color ?? tag.color }}
                />
              )}
              <span className="truncate max-w-[130px]">{tag.name}</span>
              <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
                {matchCount.toLocaleString()}
              </span>
            </button>
          )
        )}
      </div>
    </div>,
    document.body
  );
