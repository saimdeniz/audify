import React, { useEffect, useState } from "react";
import { ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { formatBytesCompact } from "../../utils/format";
import { formatTrashOpLabel } from "../../utils/trashStatusFormat";
import { EmptyTrashConfirmModal } from "../modals/EmptyTrashConfirmModal";

interface SliceTrashActionControlsProps {
  compact?: boolean;
}

/**
 * Shared contextual Slice Trash actions (`Restore`, `Restore All`, `Empty to Recycle Bin`)
 * rendered inside Filters -> General for both `Trash -> Slices` and `Slices -> Trash`.
 */
export const SliceTrashActionControls: React.FC<
  SliceTrashActionControlsProps
> = ({ compact = false }) => {
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const trashedSliceTotalBytes = useSampleStore(
    (s) => s.trashedSliceTotalBytes
  );
  const selectedSliceIds = useSampleStore((s) => s.selectedSliceIds);
  const trashOpStatus = useSampleStore((s) => s.trashOpStatus);

  const restoreTrashedSlices = useSampleStore((s) => s.restoreTrashedSlices);
  const emptyTrashedSlices = useSampleStore((s) => s.emptyTrashedSlices);

  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const isBusy = trashOpStatus !== null;

  useEffect(() => {
    if ((trashedSliceCount === 0 || isBusy) && confirmEmpty) {
      setConfirmEmpty(false);
    }
  }, [trashedSliceCount, isBusy, confirmEmpty]);

  return (
    <div
      className={`border-t border-line-subtle flex items-center flex-wrap w-full ${
        compact ? "pt-1 gap-1" : "pt-1.5 gap-1.5"
      }`}
    >
      {selectedSliceIds.length > 0 && (
        <button
          type="button"
          onClick={() => void restoreTrashedSlices(selectedSliceIds)}
          disabled={isBusy}
          className={`${
            compact
              ? "h-[22px] px-1.5 text-[10px]"
              : "h-[24px] px-2 text-[10.5px]"
          } rounded-[3px] border border-accent/50 bg-accent-soft hover:bg-accent hover:text-accent-on text-accent-fg font-mono font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
          title="Restore selected slices to their slice export folder"
        >
          <ArchiveRestore className="w-3 h-3 shrink-0" />
          <span>Restore ({selectedSliceIds.length})</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => void restoreTrashedSlices()}
        disabled={trashedSliceCount === 0 || isBusy}
        className={`${
          compact
            ? "h-[22px] px-1.5 text-[10px]"
            : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title="Restore all trashed slices to their original folders"
      >
        <ArchiveRestore className="w-3 h-3 shrink-0" />
        <span>Restore All</span>
      </button>

      <div className="w-px h-4 bg-line shrink-0" aria-hidden="true" />

      <button
        type="button"
        disabled={trashedSliceCount === 0 || isBusy}
        onClick={() => setConfirmEmpty(true)}
        className={`${
          compact
            ? "h-[22px] px-1.5 text-[10px]"
            : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title="Send trashed slices to OS Recycle Bin"
      >
        <Trash2 className="w-3 h-3 shrink-0" />
        <span>{compact ? "Empty Trash" : "Empty to Recycle Bin"}</span>
      </button>

      <EmptyTrashConfirmModal
        isOpen={confirmEmpty}
        trashedCount={trashedSliceCount}
        trashedTotalBytes={trashedSliceTotalBytes}
        itemNoun="slice"
        onConfirm={() => {
          setConfirmEmpty(false);
          void emptyTrashedSlices();
        }}
        onCancel={() => setConfirmEmpty(false)}
      />

      {trashOpStatus ? (
        <span
          className="ml-auto font-mono text-[10px] text-accent-fg inline-flex items-center gap-1.5 truncate"
          aria-live="polite"
        >
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>{formatTrashOpLabel(trashOpStatus, compact)}</span>
        </span>
      ) : (
        <span className="ml-auto font-mono text-[10px] text-fg-3 truncate">
          {compact
            ? `${trashedSliceCount.toLocaleString()} · ${formatBytesCompact(trashedSliceTotalBytes)}`
            : `${trashedSliceCount.toLocaleString()} ${
                trashedSliceCount === 1 ? "slice" : "slices"
              } · ${formatBytesCompact(trashedSliceTotalBytes)} · Favorites preserved until emptied`}
        </span>
      )}
    </div>
  );
};
