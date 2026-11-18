import React, { useMemo } from "react";
import { Eye, EyeOff, FolderOpen, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { ReadOnlyWriteModeButton } from "./ReadOnlyWriteModeButton";

interface SliceGeneralControlsProps {
  compact?: boolean;
}

/**
 * Contextual Slice History controls rendered on row 2 of Filters -> General
 * whenever `slicesFilterActive` is enabled.
 */
export const SliceGeneralControls: React.FC<SliceGeneralControlsProps> = ({
  compact = false,
}) => {
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const sliceHideMissing = useSampleStore((s) => s.sliceHideMissing);
  const customSliceExportPath = useSampleStore((s) => s.customSliceExportPath);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);

  const setSliceHideMissing = useSampleStore((s) => s.setSliceHideMissing);
  const openSlicesFolder = useSampleStore((s) => s.openSlicesFolder);
  const clearMissingSlices = useSampleStore((s) => s.clearMissingSlices);

  const { readyCount, missingCount } = useMemo(() => {
    let missing = 0;
    for (const item of sliceHistory) {
      if (!item.file_exists) missing++;
    }
    return {
      readyCount: sliceHistory.length - missing,
      missingCount: missing,
    };
  }, [sliceHistory]);

  return (
    <div
      className={`border-t border-line-subtle flex items-center flex-wrap w-full ${
        compact ? "pt-1 gap-1" : "pt-1.5 gap-1.5"
      }`}
    >
      <button
        type="button"
        onClick={() => setSliceHideMissing(!sliceHideMissing)}
        className={`${
          compact ? "h-[22px] px-1.5 text-[10px]" : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] border inline-flex items-center gap-1 font-mono font-medium cursor-pointer transition-colors shrink-0 ${
          sliceHideMissing
            ? "bg-accent-soft border-accent text-accent-fg"
            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        }`}
        title="Hide slice entries whose exported WAV file was removed from disk"
      >
        {sliceHideMissing ? (
          <EyeOff className="w-3 h-3 shrink-0" />
        ) : (
          <Eye className="w-3 h-3 shrink-0" />
        )}
        <span>{sliceHideMissing ? "Showing Existing" : "Hide Missing"}</span>
      </button>

      <button
        type="button"
        onClick={() => void openSlicesFolder()}
        className={`${
          compact ? "h-[22px] px-1.5 text-[10px]" : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0`}
        title={`Open slice export folder (${customSliceExportPath || "user/slices"})`}
      >
        <FolderOpen className="w-3 h-3 shrink-0" />
        <span>Open Folder</span>
      </button>

      <button
        type="button"
        onClick={() => void clearMissingSlices()}
        disabled={missingCount === 0}
        className={`${
          compact ? "h-[22px] px-1.5 text-[10px]" : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title="Remove slice history records whose exported files no longer exist on disk"
      >
        <Trash2 className="w-3 h-3 shrink-0" />
        <span>Clear Missing ({missingCount})</span>
      </button>

      <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] shrink-0">
        <span className="text-fg-3 truncate">
          {compact
            ? `${readyCount} ready · ${missingCount} missing`
            : `${readyCount.toLocaleString()} ready · ${missingCount.toLocaleString()} missing · ${
                customSliceExportPath || "user/slices"
              }`}
        </span>
        {!enableAdvancedFileOps && <ReadOnlyWriteModeButton compact={compact} />}
      </div>
    </div>
  );
};
