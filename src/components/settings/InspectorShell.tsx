import React from "react";
import { Filter } from "lucide-react";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";

export interface InspectorShellProps {
  icon: React.ReactNode;
  title: string;
  hasItem: boolean;
  itemName?: string;
  itemDotColor?: string;
  subHeaderLabel?: string;
  onFilter?: () => void;
  filterTitle?: string;
  extraActions?: React.ReactNode;
  canDelete?: boolean;
  isConfirmingDelete?: boolean;
  onRequestDelete?: () => void;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
  deleteTitle?: string;
  confirmDeleteTitle?: string;
  emptyState: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}

/**
 * Shared right-hand inspector frame used across Settings tabs (Collections,
 * Tags & Rules, Genres, Licenses) with unified header, sub-bar, Filter action,
 * and two-click Delete confirmation controls.
 */
export const InspectorShell: React.FC<InspectorShellProps> = ({
  icon,
  title,
  hasItem,
  itemName,
  itemDotColor,
  subHeaderLabel = "PROPERTIES",
  onFilter,
  filterTitle,
  extraActions,
  canDelete = false,
  isConfirmingDelete = false,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  deleteTitle = "Delete",
  confirmDeleteTitle = "Confirm Delete",
  emptyState,
  bodyClassName = "flex-1 overflow-y-auto space-y-2.5 p-3 min-h-0",
  children,
}) => {
  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
      <div className="h-[36px] px-2.5 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          {icon}
          <span className="font-mono text-[10px] font-semibold text-fg uppercase tracking-wider truncate">
            {title}
          </span>
        </div>

        {hasItem && (
          <div className="flex items-center space-x-1 shrink-0">
            {onFilter && (
              <button
                type="button"
                onClick={onFilter}
                className="w-[22px] h-[22px] bg-surface-2 hover:bg-surface-3 hover:border-accent text-fg-2 hover:text-accent-fg border border-line rounded-xs flex items-center justify-center transition-colors cursor-pointer"
                title={filterTitle}
              >
                <Filter className="w-3 h-3" />
              </button>
            )}

            {extraActions}

            {canDelete &&
              onRequestDelete &&
              onConfirmDelete &&
              onCancelDelete && (
                <InlineConfirmDeleteButton
                  isConfirming={isConfirmingDelete}
                  onRequest={onRequestDelete}
                  onConfirm={onConfirmDelete}
                  onCancel={onCancelDelete}
                  deleteTitle={deleteTitle}
                  confirmTitle={confirmDeleteTitle}
                />
              )}
          </div>
        )}
      </div>

      <div className="h-[26px] px-2.5 bg-surface-sub border-b border-line flex items-center justify-between text-[9.5px] font-mono text-fg-3 font-semibold shrink-0">
        {hasItem && itemName ? (
          <div className="flex items-center space-x-1.5 truncate min-w-0">
            {itemDotColor && (
              <span
                className="w-2 h-2 rounded-[2px] inline-block shrink-0"
                style={{ backgroundColor: itemDotColor }}
              />
            )}
            <span className="font-medium text-fg truncate">{itemName}</span>
          </div>
        ) : (
          <span>NO SELECTION</span>
        )}
        <span>{subHeaderLabel}</span>
      </div>

      {hasItem ? <div className={bodyClassName}>{children}</div> : emptyState}
    </div>
  );
};
