import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CopyPlus,
  FolderX,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { Z_INDEX } from "../../constants/zIndex";
import { formatBytesCompact } from "../../utils/format";
import { useDialogFocusTrap } from "../../utils/modalFocus";

export const FileOpsModals: React.FC = () => {
  const pendingTrashRequest = useSampleStore((s) => s.pendingTrashRequest);
  const pendingFileConflictPrompt = useSampleStore(
    (s) => s.pendingFileConflictPrompt
  );
  const confirmPendingTrashRequest = useSampleStore(
    (s) => s.confirmPendingTrashRequest
  );
  const cancelPendingTrashRequest = useSampleStore(
    (s) => s.cancelPendingTrashRequest
  );
  const resolvePendingFileConflict = useSampleStore(
    (s) => s.resolvePendingFileConflict
  );

  const [dontAskAgain, setDontAskAgain] = useState(false);
  const trashDialogRef = useRef<HTMLDivElement>(null);
  const conflictDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(Boolean(pendingTrashRequest), trashDialogRef);
  useDialogFocusTrap(Boolean(pendingFileConflictPrompt), conflictDialogRef);

  useEffect(() => {
    if (pendingTrashRequest) {
      setDontAskAgain(false);
    }
  }, [pendingTrashRequest]);

  useEffect(() => {
    if (!pendingTrashRequest && !pendingFileConflictPrompt) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (pendingFileConflictPrompt) {
          void resolvePendingFileConflict("cancel");
        } else if (pendingTrashRequest) {
          cancelPendingTrashRequest();
        }
      } else if (e.key === "Enter" && pendingTrashRequest) {
        const targetEl = e.target as HTMLElement | null;
        if (
          targetEl &&
          targetEl.closest(
            "button, [role='button'], input, select, textarea, a, label"
          )
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        void confirmPendingTrashRequest(dontAskAgain);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    pendingTrashRequest,
    pendingFileConflictPrompt,
    dontAskAgain,
    confirmPendingTrashRequest,
    cancelPendingTrashRequest,
    resolvePendingFileConflict,
  ]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {pendingTrashRequest && (
        <div
          data-modal-portal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              cancelPendingTrashRequest();
            }
          }}
          className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-2 sm:p-4 select-none"
          style={{ zIndex: Z_INDEX.modalConfirm }}
        >
          <div
            ref={trashDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={
              pendingTrashRequest.kind === "folder"
                ? "Move Folder to Trash"
                : "Move Sample to Trash"
            }
            tabIndex={-1}
            data-mica-overlay="true"
            className="w-full max-w-[348px] rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-fg"
          >
            {/* Compact Studio Header */}
            <div className="h-[32px] px-3 border-b border-line bg-surface-header flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {pendingTrashRequest.kind === "folder" ? (
                  <FolderX className="w-3.5 h-3.5 text-danger-fg shrink-0" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 text-danger-fg shrink-0" />
                )}
                <span className="text-[12px] font-semibold text-fg truncate">
                  {pendingTrashRequest.kind === "folder"
                    ? "Move Folder to Trash"
                    : pendingTrashRequest.sampleIds.length === 1
                    ? "Move File to Trash"
                    : `Move ${pendingTrashRequest.sampleIds.length} Files to Trash`}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-1.5 py-0.5 rounded-xs bg-surface-2 border border-line font-mono text-[9.5px] text-fg-3">
                  Ctrl+Z Undo
                </span>
                <button
                  type="button"
                  onClick={cancelPendingTrashRequest}
                  className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-hover transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Compact Body */}
            <div className="px-3 py-2.5 space-y-2">
              {pendingTrashRequest.kind === "folder" ? (
                <div className="rounded-xs bg-surface-2 border border-line px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold text-fg truncate">
                    {pendingTrashRequest.folderName}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-xs bg-surface-3 border border-line font-mono text-[10px] text-fg-2 shrink-0">
                    {pendingTrashRequest.sampleCount > 0
                      ? `${pendingTrashRequest.sampleCount} ${
                          pendingTrashRequest.sampleCount === 1
                            ? "track"
                            : "tracks"
                        }`
                      : "Empty folder"}
                  </span>
                </div>
              ) : (
                <div className="rounded-xs bg-surface-2 border border-line px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-fg truncate">
                    {pendingTrashRequest.sampleNames.slice(0, 2).join(", ")}
                  </span>
                  {pendingTrashRequest.sampleNames.length > 2 && (
                    <span className="px-1.5 py-0.5 rounded-xs bg-surface-3 border border-line font-mono text-[10px] text-accent-fg font-semibold shrink-0">
                      +{pendingTrashRequest.sampleNames.length - 2} more
                    </span>
                  )}
                </div>
              )}

              <div className="text-[10.5px] text-fg-3 leading-snug">
                Moved to Trash safely — Favorites, Tags &amp; Collections stay
                intact.
              </div>
            </div>

            {/* Compact Footer */}
            <div className="px-3 py-2 border-t border-line bg-surface-header flex items-center justify-between gap-2">
              {pendingTrashRequest.kind === "samples" ? (
                <label className="flex items-center gap-1.5 cursor-pointer text-[10.5px] text-fg-3 hover:text-fg-2 truncate">
                  <input
                    type="checkbox"
                    checked={dontAskAgain}
                    onChange={(e) => setDontAskAgain(e.target.checked)}
                    className="rounded-xs accent-[var(--signal-accent)]"
                  />
                  <span className="truncate">Don&apos;t ask again</span>
                </label>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={cancelPendingTrashRequest}
                  className="h-[25px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-2 hover:text-fg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => void confirmPendingTrashRequest(dontAskAgain)}
                  className="h-[25px] px-2.5 rounded-xs bg-danger/15 hover:bg-danger hover:text-danger-on border border-danger/50 text-[11px] font-semibold text-danger-fg flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Trash (Enter)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingFileConflictPrompt && (
        <div
          data-modal-portal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              void resolvePendingFileConflict("cancel");
            }
          }}
          className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-2 sm:p-4 select-none"
          style={{ zIndex: Z_INDEX.modalConfirm }}
        >
          <div
            ref={conflictDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="File Name Collision"
            tabIndex={-1}
            data-mica-overlay="true"
            className="w-full max-w-[390px] rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-fg"
          >
            <div className="h-[32px] px-3 border-b border-line bg-surface-header flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                <span className="text-[12px] font-semibold text-fg truncate">
                  File Name Collision (
                  {pendingFileConflictPrompt.conflicts.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => void resolvePendingFileConflict("cancel")}
                aria-label="Close collision dialog"
                title="Close (Esc)"
                className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-hover transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="px-3 py-2.5 space-y-2 text-[11px]">
              {pendingFileConflictPrompt.skippedDuplicates.length > 0 && (
                <div className="rounded-xs bg-ok/15 border border-ok/40 px-2.5 py-1 flex items-center gap-1.5 text-[10.5px] text-ok font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {pendingFileConflictPrompt.skippedDuplicates.length} exact
                    duplicate(s) auto-skipped.
                  </span>
                </div>
              )}

              <div className="text-[10.5px] text-fg-2">
                Destination folder already has different audio file(s) with the
                same name:
              </div>

              <div className="rounded-xs bg-surface-2 border border-line divide-y divide-line max-h-[124px] overflow-y-auto">
                {pendingFileConflictPrompt.conflicts
                  .slice(0, 5)
                  .map((c, idx) => (
                    <div
                      key={`${c.file_name}-${idx}`}
                      className="px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <span className="text-fg font-semibold truncate">
                          {c.file_name}
                        </span>
                        <span className="text-accent-fg shrink-0">
                          → {c.suggested_new_name}
                        </span>
                      </div>
                      <div className="text-[9.5px] text-fg-3 font-mono mt-0.5">
                        Incoming: {formatBytesCompact(c.source_size)} •
                        Existing: {formatBytesCompact(c.existing_size)}
                      </div>
                    </div>
                  ))}
                {pendingFileConflictPrompt.conflicts.length > 5 && (
                  <div className="px-2.5 py-1 text-[10px] font-mono text-fg-3">
                    +{pendingFileConflictPrompt.conflicts.length - 5} more
                    collision(s)
                  </div>
                )}
              </div>
            </div>

            <div className="px-3 py-2 border-t border-line bg-surface-header flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void resolvePendingFileConflict("cancel")}
                className="h-[25px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-3 hover:text-fg transition-colors shrink-0"
              >
                Cancel
              </button>

              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  autoFocus
                  onClick={() => void resolvePendingFileConflict("skip")}
                  className="h-[25px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line-strong text-[11px] font-semibold text-fg flex items-center gap-1.5 transition-colors shrink-0"
                  title="Do not move/copy colliding files"
                >
                  <SkipForward className="w-3 h-3 text-fg-2 shrink-0" />
                  <span>Skip</span>
                </button>
                <button
                  type="button"
                  onClick={() => void resolvePendingFileConflict("keep_both")}
                  className="h-[25px] px-2.5 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent/60 text-[11px] font-semibold text-accent-fg flex items-center gap-1.5 min-w-0 max-w-[195px] transition-colors"
                  title={
                    pendingFileConflictPrompt.conflicts.length === 1
                      ? `Keep both files by adding (2) suffix: ${pendingFileConflictPrompt.conflicts[0].suggested_new_name}`
                      : "Keep both files by adding (2) suffix"
                  }
                >
                  <CopyPlus className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    Keep Both (
                    {pendingFileConflictPrompt.conflicts.length === 1
                      ? pendingFileConflictPrompt.conflicts[0]
                          .suggested_new_name
                      : "Rename"}
                    )
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};
