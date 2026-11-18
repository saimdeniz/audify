import React, { useEffect, useState } from "react";
import { ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { formatBytesCompact } from "../../utils/format";
import { formatTrashOpLabel } from "../../utils/trashStatusFormat";
import { EmptyTrashConfirmModal } from "../modals/EmptyTrashConfirmModal";
import { SliceTrashActionControls } from "./SliceTrashActionControls";

interface TrashGeneralControlsProps {
  compact?: boolean;
}

/**
 * Contextual Trash quarantine actions rendered dynamically on row 2 of
 * Filters -> General only while `trashFilterActive` is enabled.
 */
export const TrashGeneralControls: React.FC<TrashGeneralControlsProps> = ({
  compact = false,
}) => {
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedTotalBytes = useSampleStore((s) => s.trashedTotalBytes);
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const trashOpStatus = useSampleStore((s) => s.trashOpStatus);

  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);

  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const isBusy = trashOpStatus !== null;

  useEffect(() => {
    if ((trashedCount === 0 || isBusy) && confirmEmpty) {
      setConfirmEmpty(false);
    }
  }, [trashedCount, isBusy, confirmEmpty]);

  if (trashViewTab === "slices") {
    return <SliceTrashActionControls compact={compact} />;
  }

  return (
    <div
      className={`border-t border-line-subtle flex items-center flex-wrap w-full ${
        compact ? "pt-1 gap-1" : "pt-1.5 gap-1.5"
      }`}
    >
      {selectedSampleIds.length > 0 && (
        <button
          type="button"
          onClick={() => void restoreSamplesFromTrash(selectedSampleIds)}
          disabled={isBusy}
          className={`${
            compact ? "h-[22px] px-1.5 text-[10px]" : "h-[24px] px-2 text-[10.5px]"
          } rounded-[3px] border border-accent/50 bg-accent-soft hover:bg-accent hover:text-accent-on text-accent-fg font-mono font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
          title="Restore selected files to their original folders"
        >
          <ArchiveRestore className="w-3 h-3 shrink-0" />
          <span>Restore ({selectedSampleIds.length})</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => void restoreSamplesFromTrash()}
        disabled={trashedCount === 0 || isBusy}
        className={`${
          compact ? "h-[22px] px-1.5 text-[10px]" : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title="Restore all trashed files to their original folders"
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
          compact ? "h-[22px] px-1.5 text-[10px]" : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title="Send trashed files to Windows OS Recycle Bin"
      >
        <Trash2 className="w-3 h-3 shrink-0" />
        <span>{compact ? "Empty Trash" : "Empty to Recycle Bin"}</span>
      </button>

      <EmptyTrashConfirmModal
        isOpen={confirmEmpty}
        trashedCount={trashedCount}
        trashedTotalBytes={trashedTotalBytes}
        onConfirm={() => {
          setConfirmEmpty(false);
          void emptyAudifyTrash();
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
            : `${trashedCount.toLocaleString()} ${trashedCount === 1 ? "file" : "files"} · ${formatBytesCompact(trashedTotalBytes)} · Favorites & tags preserved until emptied`}
        </span>
      )}
    </div>
  );
};
