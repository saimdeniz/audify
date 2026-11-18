import React from "react";
import { FileAudio, Scissors } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

/**
 * Top toolbar sub-view switcher rendered when viewing main `Trash` so
 * trashed Library Tracks and trashed Saved Slices stay separated with clean columns.
 */
export const TrashToolbarChips: React.FC = () => {
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const setTrashViewTab = useSampleStore((s) => s.setTrashViewTab);

  return (
    <div className="flex-1 min-w-0 flex items-center justify-end gap-1.5 py-0.5">
      <button
        type="button"
        onClick={() => setTrashViewTab("tracks")}
        className={`h-[22px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          trashViewTab === "tracks"
            ? "bg-accent-soft border-accent text-accent-fg font-medium"
            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        }`}
        title="Show trashed library tracks"
      >
        <FileAudio className="w-3 h-3 shrink-0" />
        <span>Tracks</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {trashedCount.toLocaleString()}
        </span>
      </button>

      <button
        type="button"
        onClick={() => setTrashViewTab("slices")}
        className={`h-[22px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          trashViewTab === "slices"
            ? "bg-accent-soft border-accent text-accent-fg font-medium"
            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        }`}
        title="Show trashed saved slices"
      >
        <Scissors className="w-3 h-3 shrink-0" />
        <span>Slices</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {trashedSliceCount.toLocaleString()}
        </span>
      </button>
    </div>
  );
};
