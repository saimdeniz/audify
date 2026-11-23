import React from "react";
import { History, Library as LibraryIcon, Star, X } from "lucide-react";

interface LibraryViewsSectionProps {
  isMiniOverlay: boolean;
  isAllActive: boolean;
  isDraggingInApp: boolean;
  inAppDragCount: number;
  dragHoverTarget: string | null;
  dropFlashTarget: string | null;
  favoriteOnly: boolean;
  recentOnly: boolean;
  totalSamplesCount: number;
  totalFavoritesCount: number;
  recentSamplesCount: number;
  setIsOverlayOpen: (open: boolean) => void;
  selectAllFiles: () => void;
  resetAllFilters: () => void;
  setFavoriteOnly: (v: boolean) => void;
  setRecentOnly: (v: boolean) => void;
  clearRecentSamples: () => void;
  updateDragHoverTarget: (next: string | null) => void;
}

export const LibraryViewsSection: React.FC<LibraryViewsSectionProps> = ({
  isMiniOverlay,
  isAllActive,
  isDraggingInApp,
  inAppDragCount,
  dragHoverTarget,
  dropFlashTarget,
  favoriteOnly,
  recentOnly,
  totalSamplesCount,
  totalFavoritesCount,
  recentSamplesCount,
  setIsOverlayOpen,
  selectAllFiles,
  resetAllFilters,
  setFavoriteOnly,
  setRecentOnly,
  clearRecentSamples,
  updateDragHoverTarget,
}) => {
  return (
    <div className="py-2 border-b border-line shrink-0">
      <div className="h-[20px] px-3 mb-1 flex items-center justify-between shrink-0">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head leading-none">
          LIBRARY VIEWS
        </span>
        <div className="flex items-center space-x-1">
          {!isAllActive && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={resetAllFilters}
              className="h-[18px] px-1 text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 font-mono text-[9px] flex items-center justify-center shrink-0 transition-colors"
              title="Reset all active filters"
            >
              RESET
            </button>
          )}
          {isMiniOverlay && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setIsOverlayOpen(false)}
              className="w-[18px] h-[18px] text-fg-3 hover:text-fg hover:bg-surface-3 rounded-xs flex items-center justify-center shrink-0 transition-colors"
              title="Close panel"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <nav className="px-1.5 space-y-0.5 text-[12px]">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={selectAllFiles}
          className={`w-full h-[26px] px-2.5 rounded-xs flex items-center justify-between border-l-2 transition-opacity ${
            isDraggingInApp ? "opacity-40" : ""
          } ${
            isAllActive
              ? "bg-surface-3 text-fg border-accent"
              : "text-fg-2 hover:bg-surface-hover hover:text-fg border-transparent"
          }`}
        >
          <span className="flex items-center space-x-1.5 truncate">
            <LibraryIcon className="w-3.5 h-3.5 text-accent-fg shrink-0" />
            <span>All Files</span>
          </span>
          <span className="font-mono tabular-nums text-[11px] font-medium text-fg-2 shrink-0">
            {totalSamplesCount.toLocaleString()}
          </span>
        </button>

        <button
          type="button"
          data-sidebar-drop="favorites"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFavoriteOnly(!favoriteOnly)}
          onMouseEnter={() => {
            if (isDraggingInApp) updateDragHoverTarget("favorites");
          }}
          onMouseLeave={() => {
            if (dragHoverTarget === "favorites") updateDragHoverTarget(null);
          }}
          className={`w-full h-[26px] px-2.5 rounded-xs flex items-center justify-between border-l-2 transition-all ${
            dropFlashTarget === "favorites"
              ? "bg-accent-soft text-accent-fg border-accent ring-1 ring-inset ring-accent"
              : isDraggingInApp && dragHoverTarget === "favorites"
              ? "bg-accent-soft text-accent-fg border-accent ring-1 ring-inset ring-accent"
              : favoriteOnly
              ? "bg-surface-3 text-fg border-accent"
              : "text-fg-2 hover:bg-surface-hover hover:text-fg border-transparent"
          }`}
        >
          <span className="flex items-center space-x-1.5 truncate">
            <Star className="w-3.5 h-3.5 fill-current text-accent-fg shrink-0" />
            <span>Favorites</span>
          </span>
          <span className="font-mono tabular-nums text-[11px] font-medium text-fg-2 shrink-0">
            {isDraggingInApp && dragHoverTarget === "favorites" ? (
              <span className="text-[10.5px] font-semibold text-accent-fg">
                {inAppDragCount > 1 ? `＋ Fav (${inAppDragCount})` : "＋ Fav"}
              </span>
            ) : (
              totalFavoritesCount.toLocaleString()
            )}
          </span>
        </button>

        <div
          className={`relative group w-full h-[26px] rounded-xs border-l-2 transition-opacity ${
            isDraggingInApp ? "opacity-40" : ""
          } ${
            recentOnly
              ? "bg-surface-3 text-fg border-accent"
              : "text-fg-2 hover:bg-surface-hover hover:text-fg border-transparent"
          }`}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setRecentOnly(!recentOnly)}
            className="w-full h-full px-2.5 flex items-center justify-between gap-2 text-left"
            title="Recently played samples (last 50)"
          >
            <span className="flex items-center space-x-1.5 truncate">
              <History className="w-3.5 h-3.5 text-accent-fg shrink-0" />
              <span>Recent</span>
            </span>
            <span
              className={`font-mono tabular-nums text-[11px] font-medium text-fg-2 shrink-0 ${
                recentSamplesCount > 0 && !isDraggingInApp
                  ? "transition-opacity group-hover:opacity-0"
                  : ""
              }`}
            >
              {recentSamplesCount.toLocaleString()}
            </span>
          </button>
          {recentSamplesCount > 0 && !isDraggingInApp && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearRecentSamples}
              aria-label="Clear recent history"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line focus-visible:bg-surface-3 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity"
              title="Clear recent history"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </nav>
    </div>
  );
};
