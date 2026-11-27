import React from "react";
import { FileAudio, Layers, Scissors } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

/**
 * Compact search-adjacent segmented switcher (`Tracks | Slices | Layers`) rendered
 * immediately beside the Search field in Trash view, matching FavoritesToolbarChips.
 */
export const TrashToolbarChips: React.FC = () => {
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const trashedLayerCount = useSampleStore((s) => s.trashedLayerCount);
  const setTrashViewTab = useSampleStore((s) => s.setTrashViewTab);

  return (
    <div
      role="tablist"
      aria-label="Trash category"
      className="inline-flex items-center rounded-[3px] border border-line bg-surface-2 p-[1px] shrink-0"
    >
      <button
        type="button"
        role="tab"
        aria-selected={trashViewTab === "tracks"}
        onClick={() => setTrashViewTab("tracks")}
        className={`h-[21px] px-2 rounded-[2px] text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          trashViewTab === "tracks"
            ? "bg-accent-soft text-accent-fg"
            : "text-fg-2 hover:text-fg"
        }`}
        title="Show trashed library tracks"
      >
        <FileAudio className="w-3 h-3 shrink-0" />
        <span>Tracks</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {(trashedCount ?? 0).toLocaleString()}
        </span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={trashViewTab === "slices"}
        onClick={() => setTrashViewTab("slices")}
        className={`h-[21px] px-2 rounded-[2px] text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          trashViewTab === "slices"
            ? "bg-accent-soft text-accent-fg"
            : "text-fg-2 hover:text-fg"
        }`}
        title="Show trashed saved slices"
      >
        <Scissors className="w-3 h-3 shrink-0" />
        <span>Slices</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {(trashedSliceCount ?? 0).toLocaleString()}
        </span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={trashViewTab === "layers"}
        onClick={() => setTrashViewTab("layers")}
        className={`h-[21px] px-2 rounded-[2px] text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
          trashViewTab === "layers"
            ? "bg-accent-soft text-accent-fg"
            : "text-fg-2 hover:text-fg"
        }`}
        title="Show trashed saved layers"
      >
        <Layers className="w-3 h-3 shrink-0" />
        <span>Layers</span>
        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
          {(trashedLayerCount ?? 0).toLocaleString()}
        </span>
      </button>
    </div>
  );
};
