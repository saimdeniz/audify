import React from "react";
import { Scissors, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

interface SlicesTableEmptyStateProps {
  isSliceTrashMode: boolean;
  isSliceFavMode?: boolean;
  isLoadingSliceHistory: boolean;
  searchQuery: string;
  sliceFavoriteOnly: boolean;
  slicePitchOnly: boolean;
  sliceHideMissing: boolean;
  trashedCount: number;
}

export const SlicesTableEmptyState: React.FC<SlicesTableEmptyStateProps> = ({
  isSliceTrashMode,
  isSliceFavMode = false,
  isLoadingSliceHistory,
  searchQuery,
  sliceFavoriteOnly,
  slicePitchOnly,
  sliceHideMissing,
  trashedCount,
}) => {
  const hasSearch = searchQuery.trim() !== "";
  const hasSubFilter = isSliceFavMode
    ? hasSearch
    : sliceFavoriteOnly || slicePitchOnly || sliceHideMissing || hasSearch;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2 text-fg-3">
      <div className="w-10 h-10 rounded-md bg-surface-2 border border-line flex items-center justify-center text-accent-fg">
        {isSliceTrashMode ? (
          <Trash2 className="w-5 h-5" />
        ) : (
          <Scissors className="w-5 h-5" />
        )}
      </div>
      <div className="text-[13px] font-medium text-fg">
        {isLoadingSliceHistory
          ? isSliceTrashMode
            ? "Loading trashed slices..."
            : "Loading saved slices..."
          : isSliceTrashMode
            ? hasSearch
              ? "No trashed slices match your search"
              : "No trashed slices"
            : isSliceFavMode
              ? hasSearch
                ? "No favorite slices match your search"
                : "No favorite slices yet"
              : hasSubFilter
                ? "No saved slices match your filter"
                : "No saved slices yet"}
      </div>
      <p className="text-[11.5px] text-fg-2 max-w-[380px]">
        {isSliceTrashMode ? (
          "Trashed slices stay safely quarantined here until restored or emptied."
        ) : isSliceFavMode ? (
          "Star your favorite waveform slices to find them instantly here."
        ) : (
          <>
            Drag a selection on the top waveform and click{" "}
            <span className="font-mono text-fg">Save Slice</span> or drag the
            slice directly into your DAW / video editor.
          </>
        )}
      </p>
      {isSliceTrashMode ? (
        hasSearch ? (
          <button
            type="button"
            onClick={() => useSampleStore.getState().setSearchQuery("")}
            className="mt-1 px-2.5 h-[24px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
          >
            Clear Search
          </button>
        ) : (
          trashedCount > 0 && (
            <button
              type="button"
              onClick={() => useSampleStore.getState().setTrashViewTab("tracks")}
              className="mt-1 px-2.5 h-[24px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
            >
              View Trashed Tracks
            </button>
          )
        )
      ) : (
        hasSubFilter && (
          <button
            type="button"
            onClick={() => {
              const st = useSampleStore.getState();
              if (!isSliceFavMode) {
                st.setSliceFavoriteOnly(false);
                st.setSlicePitchOnly(false);
                st.setSliceHideMissing(false);
              }
              if (st.searchQuery.trim() !== "") {
                st.setSearchQuery("");
              }
            }}
            className="mt-1 px-2.5 h-[24px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
          >
            {isSliceFavMode ? "Clear Search" : "Reset Slice Filters"}
          </button>
        )
      )}
    </div>
  );
};
