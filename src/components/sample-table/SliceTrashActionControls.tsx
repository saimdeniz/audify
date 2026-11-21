import React, { useEffect, useState } from "react";
import { ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { TrashOpStatus } from "../../types";
import { formatBytesCompact } from "../../utils/format";
import { formatTrashOpLabel } from "../../utils/trashStatusFormat";
import { EmptyTrashConfirmModal } from "../modals/EmptyTrashConfirmModal";

export interface TrashActionToolbarStripProps {
  compact?: boolean;
  trashedCount: number;
  trashedTotalBytes: number;
  selectedIds: number[];
  trashOpStatus: TrashOpStatus | null;
  itemNoun: "file" | "slice";
  preservedSummarySuffix: string;
  restoreSelectedTitle: string;
  restoreAllTitle: string;
  emptyTitle: string;
  onRestoreSelected: (ids: number[]) => void;
  onRestoreAll: () => void;
  onEmptyAll: () => void;
}

/**
 * Shared trash action strip (`Restore`, `Restore All`, `Empty to Recycle Bin`, status counter)
 * used by both track quarantine (`TrashGeneralControls`) and slice quarantine (`SliceTrashActionControls`).
 */
export const TrashActionToolbarStrip: React.FC<
  TrashActionToolbarStripProps
> = ({
  compact = false,
  trashedCount,
  trashedTotalBytes,
  selectedIds,
  trashOpStatus,
  itemNoun,
  preservedSummarySuffix,
  restoreSelectedTitle,
  restoreAllTitle,
  emptyTitle,
  onRestoreSelected,
  onRestoreAll,
  onEmptyAll,
}) => {
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const isBusy = trashOpStatus !== null;

  useEffect(() => {
    if ((trashedCount === 0 || isBusy) && confirmEmpty) {
      setConfirmEmpty(false);
    }
  }, [trashedCount, isBusy, confirmEmpty]);

  const pluralNoun = trashedCount === 1 ? itemNoun : `${itemNoun}s`;

  return (
    <div
      className={`border-t border-line-subtle flex items-center flex-wrap w-full ${
        compact ? "pt-1 gap-1" : "pt-1.5 gap-1.5"
      }`}
    >
      {selectedIds.length > 0 && (
        <button
          type="button"
          onClick={() => onRestoreSelected(selectedIds)}
          disabled={isBusy}
          className={`${
            compact
              ? "h-[22px] px-1.5 text-[10px]"
              : "h-[24px] px-2 text-[10.5px]"
          } rounded-[3px] border border-accent/50 bg-accent-soft hover:bg-accent hover:text-accent-on text-accent-fg font-mono font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
          title={restoreSelectedTitle}
        >
          <ArchiveRestore className="w-3 h-3 shrink-0" />
          <span>Restore ({selectedIds.length})</span>
        </button>
      )}

      <button
        type="button"
        onClick={onRestoreAll}
        disabled={trashedCount === 0 || isBusy}
        className={`${
          compact
            ? "h-[22px] px-1.5 text-[10px]"
            : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title={restoreAllTitle}
      >
        <ArchiveRestore className="w-3 h-3 shrink-0" />
        <span>Restore All</span>
      </button>

      <div className="w-px h-4 bg-line shrink-0" aria-hidden="true" />

      <button
        type="button"
        disabled={trashedCount === 0 || isBusy}
        onClick={() => setConfirmEmpty(true)}
        className={`${
          compact
            ? "h-[22px] px-1.5 text-[10px]"
            : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title={emptyTitle}
      >
        <Trash2 className="w-3 h-3 shrink-0" />
        <span>{compact ? "Empty Trash" : "Empty to Recycle Bin"}</span>
      </button>

      <EmptyTrashConfirmModal
        isOpen={confirmEmpty}
        trashedCount={trashedCount}
        trashedTotalBytes={trashedTotalBytes}
        itemNoun={itemNoun}
        onConfirm={() => {
          setConfirmEmpty(false);
          onEmptyAll();
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
            ? `${trashedCount.toLocaleString()} · ${formatBytesCompact(trashedTotalBytes)}`
            : `${trashedCount.toLocaleString()} ${pluralNoun} · ${formatBytesCompact(trashedTotalBytes)} · ${preservedSummarySuffix}`}
        </span>
      )}
    </div>
  );
};

interface SliceTrashActionControlsProps {
  compact?: boolean;
}

/**
 * Contextual Slice Trash actions (`Restore`, `Restore All`, `Empty to Recycle Bin`)
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

  return (
    <TrashActionToolbarStrip
      compact={compact}
      trashedCount={trashedSliceCount}
      trashedTotalBytes={trashedSliceTotalBytes}
      selectedIds={selectedSliceIds}
      trashOpStatus={trashOpStatus}
      itemNoun="slice"
      preservedSummarySuffix="Favorites preserved until emptied"
      restoreSelectedTitle="Restore selected slices to their slice export folder"
      restoreAllTitle="Restore all trashed slices to their original folders"
      emptyTitle="Send trashed slices to OS Recycle Bin"
      onRestoreSelected={(ids) => void restoreTrashedSlices(ids)}
      onRestoreAll={() => void restoreTrashedSlices()}
      onEmptyAll={() => void emptyTrashedSlices()}
    />
  );
};
