import React, { useMemo } from "react";
import { FileAudio, Layers, Scissors } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

/**
 * Compact search-adjacent segmented switcher (`Tracks | Slices | Layers`) rendered
 * immediately beside the Search field in Favorites view so Tag Suggestions remain
 * visible and interactive on the right side of the toolbar.
 */
export const FavoritesToolbarChips: React.FC = () => {
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const favoritesCount = useSampleStore((s) => s.favoritesCount);
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const setFavoritesViewTab = useSampleStore((s) => s.setFavoritesViewTab);

  const favSliceCount = useMemo(
    () => sliceHistory.reduce((acc, s) => acc + (s.is_favorite ? 1 : 0), 0),
    [sliceHistory]
  );
  const favLayerCount = useMemo(
    () => layerHistory.reduce((acc, l) => acc + (l.is_favorite ? 1 : 0), 0),
    [layerHistory]
  );

  return (
    <div
      role="tablist"
      aria-label="Favorites category"
      className="inline-flex items-center rounded-[3px] border border-line bg-surface-2 p-[1px] shrink-0"
    >
      <button
        type="button"
        role="tab"
        aria-selected={favoritesViewTab === "tracks"}
        onClick={() => setFavoritesViewTab("tracks")}
        className={`h-[21px] px-2 rounded-[2px] text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          favoritesViewTab === "tracks"
            ? "bg-accent-soft text-accent-fg"
            : "text-fg-2 hover:text-fg"
        }`}
        title="Favorite library tracks"
      >
        <FileAudio className="w-3 h-3 shrink-0" />
        <span>Tracks</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {(favoritesCount ?? 0).toLocaleString()}
        </span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={favoritesViewTab === "slices"}
        onClick={() => setFavoritesViewTab("slices")}
        className={`h-[21px] px-2 rounded-[2px] text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          favoritesViewTab === "slices"
            ? "bg-accent-soft text-accent-fg"
            : "text-fg-2 hover:text-fg"
        }`}
        title="Favorite saved slices"
      >
        <Scissors className="w-3 h-3 shrink-0" />
        <span>Slices</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {favSliceCount.toLocaleString()}
        </span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={favoritesViewTab === "layers"}
        onClick={() => setFavoritesViewTab("layers")}
        className={`h-[21px] px-2 rounded-[2px] text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          favoritesViewTab === "layers"
            ? "bg-accent-soft text-accent-fg"
            : "text-fg-2 hover:text-fg"
        }`}
        title="Favorite saved multi-track layers"
      >
        <Layers className="w-3 h-3 shrink-0" />
        <span>Layers</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {favLayerCount.toLocaleString()}
        </span>
      </button>
    </div>
  );
};
