import React from "react";
import {
  ChevronsDown,
  ChevronsUp,
  Search,
  Settings,
  X,
} from "lucide-react";

export interface TaxonomySidebarHeaderProps {
  title: string;
  hasActiveFilter: boolean;
  clearFilterTitle: string;
  onClearFilter: () => void;
  createAction: React.ReactNode;
  showExpandCollapse: boolean;
  expandAllTitle: string;
  collapseAllTitle: string;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  isSearchOpen: boolean;
  isSearching: boolean;
  searchQuery: string;
  searchPlaceholder: string;
  searchButtonTitle: string;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onSearchChange: (val: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  settingsTitle: string;
  onOpenSettings: () => void;
}

/**
 * Shared header + collapsible search bar for the `TAGS`, `GENRES`, and `COLLECTIONS`
 * sidebar tabs, aligned with `FoldersTreeTab`'s `32px` header height and 5-icon strip.
 */
export const TaxonomySidebarHeader: React.FC<TaxonomySidebarHeaderProps> = ({
  title,
  hasActiveFilter,
  clearFilterTitle,
  onClearFilter,
  createAction,
  showExpandCollapse,
  expandAllTitle,
  collapseAllTitle,
  onExpandAll,
  onCollapseAll,
  isSearchOpen,
  isSearching,
  searchQuery,
  searchPlaceholder,
  searchButtonTitle,
  searchInputRef,
  onSearchChange,
  onSearchOpenChange,
  settingsTitle,
  onOpenSettings,
}) => (
  <>
    <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
      <div className="flex items-center space-x-1.5 min-w-0">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
          {title}
        </span>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="w-[18px] h-[18px] text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 flex items-center justify-center shrink-0 transition-colors"
            title={clearFilterTitle}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex items-center space-x-1 shrink-0">
        {createAction}

        {showExpandCollapse && (
          <>
            <button
              type="button"
              onClick={onExpandAll}
              className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
              title={expandAllTitle}
            >
              <ChevronsDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onCollapseAll}
              className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
              title={collapseAllTitle}
            >
              <ChevronsUp className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            if (isSearchOpen && !searchQuery.trim()) {
              onSearchOpenChange(false);
            } else {
              onSearchOpenChange(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }
          }}
          className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
            isSearchOpen || isSearching
              ? "bg-accent-soft border-accent text-accent-fg"
              : "border-transparent text-fg-3 hover:text-fg hover:bg-line"
          }`}
          title={searchButtonTitle}
        >
          <Search className="w-3 h-3" />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
          title={settingsTitle}
        >
          <Settings className="w-3 h-3" />
        </button>
      </div>
    </div>

    {(isSearchOpen || isSearching) && (
      <div className="px-2 py-1.5 border-b border-line shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={() => {
              if (!searchQuery.trim()) onSearchOpenChange(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                if (searchQuery.trim()) {
                  onSearchChange("");
                } else {
                  onSearchOpenChange(false);
                  searchInputRef.current?.blur();
                }
              }
            }}
            placeholder={searchPlaceholder}
            className="w-full h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSearchChange("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-1.5 text-fg-2 hover:text-fg"
              title="Clear filter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    )}
  </>
);
