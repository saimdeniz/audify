import React from "react";
import { Scissors, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

interface SlicesTableEmptyStateProps {
  isSliceTrashMode: boolean;
  isLoadingSliceHistory: boolean;
  searchQuery: string;
  sliceFavoriteOnly: boolean;
  slicePitchOnly: boolean;
  sliceHideMissing: boolean;
  trashedCount: number;
}

export const SlicesTableEmptyState: React.FC<SlicesTableEmptyStateProps> = ({
  isSliceTrashMode,
  isLoadingSliceHistory,
  searchQuery,
  sliceFavoriteOnly,
  slicePitchOnly,
  sliceHideMissing,
  trashedCount,
}) => {
  const hasSearch = searchQuery.trim() !== "";
  const hasActiveFilter =
    sliceFavoriteOnly || slicePitchOnly || sliceHideMissing || hasSearch;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-surface-2 border border-line flex items-center justify-center mb-2 text-fg-3">
        {isSliceTrashMode ? (
          <Trash2 className="w-4 h-4" />
        ) : (
          <Scissors className="w-4 h-4" />
        )}
      </div>
      <div className="text-[12px] font-medium text-fg-2">
        {isLoadingSliceHistory
          ? isSliceTrashMode
            ? "Loading trashed slices..."
            : "Loading saved slices..."
          : isSliceTrashMode
            ? hasSearch
              ? "No trashed slices match your search"
              : "Slice Trash is empty"
            : hasActiveFilter
              ? "No saved slices match your filter"
              : "No saved slices yet"}
      </div>
      <p className="text-[11px] text-fg-3 mt-1 max-w-[380px]">
        {isSliceTrashMode ? (
          "Slices moved to Trash are kept safely here until you restore them or send them to the OS Recycle Bin."
        ) : (
          <>
            Drag a selection on the top waveform and click{" "}
            <span className="font-mono text-fg-2">Save Slice</span> or drag the
            slice directly into your DAW / video editor.
          </>
        )}
      </p>
      {isSliceTrashMode ? (
        hasSearch ? (
          <button
            type="button"
            onClick={() => useSampleStore.getState().setSearchQuery("")}
            className="mt-3 px-2.5 h-[26px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
          >
            Clear Search
          </button>
        ) : (
          trashedCount > 0 && (
            <button
              type="button"
              onClick={() => useSampleStore.getState().setTrashViewTab("tracks")}
              className="mt-3 px-2.5 h-[26px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
            >
              View Trashed Tracks
            </button>
          )
        )
      ) : (
        hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              const st = useSampleStore.getState();
              st.setSliceFavoriteOnly(false);
              st.setSlicePitchOnly(false);
              st.setSliceHideMissing(false);
              if (st.searchQuery.trim() !== "") {
                st.setSearchQuery("");
              }
            }}
            className="mt-3 px-2.5 h-[26px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] font-medium transition-colors cursor-pointer"
          >
            Reset Slice Filters
          </button>
        )
      )}
    </div>
  );
};
