import React from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";

export const SIDEBAR_TREE_ROOT_HEIGHT = 28;
export const SIDEBAR_TREE_CHILD_HEIGHT = 26;

export function getSidebarTreeIndentPx(depth: number): number {
  return depth <= 0 ? 8 : 14 + depth * 13;
}

export interface SidebarTreeRowProps
  extends React.HTMLAttributes<HTMLDivElement> {
  "data-sidebar-drop"?: string;
  "data-studio-drop-scope"?: string;
  "data-studio-drop-key"?: string;
  "data-studio-drop-hint"?: string;
  depth: number;
  label: string;
  count: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isAncestorOfSelected?: boolean;
  isDragHover?: boolean;
  isDropFlashing?: boolean;
  dimmed?: boolean;
  onToggleExpand?: (e: React.MouseEvent) => void;
  toggleTitle?: string;
  /** Shown in place of actions + count while dragging onto this row. */
  dropHint?: string | null;
  /** Optional replacement for the folder icon. */
  icon?: React.ReactNode;
  /** Optional replacement for the label when inline renaming. */
  labelReplacement?: React.ReactNode;
  /** Optional inline badges rendered right after the label (e.g. smart-rule icon). */
  afterLabel?: React.ReactNode;
  /** Optional hover action buttons rendered before the count when not drop-hovering. */
  actions?: React.ReactNode;
  /** Hides right-side actions and count (e.g. during inline rename). */
  hideRight?: boolean;
}

/**
 * Unified sidebar tree row shared between Folders and Collections trees so both
 * panels have identical row heights, chevron alignment, indentation, typography,
 * drag/drop states, and tabular sample counters across all themes.
 */
export const SidebarTreeRow: React.FC<SidebarTreeRowProps> = ({
  depth,
  label,
  count,
  hasChildren,
  isExpanded,
  isSelected,
  isAncestorOfSelected = false,
  isDragHover = false,
  isDropFlashing = false,
  dimmed = false,
  onToggleExpand,
  toggleTitle,
  dropHint = null,
  icon,
  labelReplacement,
  afterLabel,
  actions,
  hideRight = false,
  className = "",
  style,
  ...rest
}) => {
  const isRoot = depth <= 0;
  const indentPx = getSidebarTreeIndentPx(depth);
  const heightPx = isRoot ? SIDEBAR_TREE_ROOT_HEIGHT : SIDEBAR_TREE_CHILD_HEIGHT;

  const stateClasses = isDropFlashing
    ? "bg-accent-soft text-accent-fg border-accent ring-1 ring-inset ring-accent"
    : isDragHover
    ? "bg-accent-soft text-accent-fg border-accent ring-1 ring-inset ring-accent"
    : isSelected
    ? "bg-surface-3 text-accent-fg border-accent font-medium"
    : isAncestorOfSelected
    ? "bg-surface-soft text-fg border-accent/40 hover:bg-surface-hover"
    : "text-fg hover:text-fg-head hover:bg-surface-hover border-transparent";

  return (
    <div
      {...rest}
      style={{
        height: `${heightPx}px`,
        paddingLeft: `${indentPx}px`,
        ...style,
      }}
      className={`group pr-2 flex items-center justify-between cursor-pointer text-[12px] border-l-2 transition-colors ${stateClasses} ${
        dimmed ? "opacity-45" : ""
      } ${className}`}
    >
      <div className="flex items-center space-x-1 truncate flex-1 min-w-0">
        {hasChildren && onToggleExpand ? (
          <button
            type="button"
            data-no-press-shift="true"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(e);
            }}
            className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-line shrink-0"
            title={toggleTitle}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}

        {icon ??
          (isExpanded && hasChildren ? (
            <FolderOpen
              className={`w-3.5 h-3.5 shrink-0 ${
                isSelected || isRoot
                  ? "text-accent-fg"
                  : "text-accent-fg opacity-80"
              }`}
            />
          ) : (
            <Folder
              className={`w-3.5 h-3.5 shrink-0 ${
                isSelected || isRoot
                  ? "text-accent-fg"
                  : "text-fg-2 group-hover:text-accent-fg"
              }`}
            />
          ))}

        {labelReplacement ? (
          labelReplacement
        ) : (
          <span className={`truncate pl-0.5 ${isRoot ? "font-semibold" : ""}`}>
            {label}
          </span>
        )}

        {afterLabel}
      </div>

      {!hideRight && (
        <div className="flex items-center space-x-1 shrink-0 pl-1">
          {dropHint ? (
            <span className="text-[10px] font-mono font-semibold text-accent-fg px-1 rounded-xs bg-accent/15 shrink-0">
              {dropHint}
            </span>
          ) : (
            <>
              {actions}
              <span
                className={`font-mono tabular-nums text-[11px] font-medium shrink-0 ${
                  isSelected
                    ? "text-accent-fg"
                    : "text-fg-2 group-hover:text-fg"
                }`}
              >
                {count.toLocaleString()}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
