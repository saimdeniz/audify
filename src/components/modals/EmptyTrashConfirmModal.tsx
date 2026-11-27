import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { formatBytesCompact } from "../../utils/format";
import { useDialogFocusTrap } from "../../utils/modalFocus";

interface EmptyTrashConfirmModalProps {
  isOpen: boolean;
  trashedCount: number;
  trashedTotalBytes: number;
  itemNoun?: "file" | "slice" | "layer";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Minimal confirmation dialog for permanently moving Audify Trash files
 * into the OS Recycle Bin without shifting FilterDrawer toolbar buttons.
 */
export const EmptyTrashConfirmModal: React.FC<EmptyTrashConfirmModalProps> = ({
  isOpen,
  trashedCount,
  trashedTotalBytes,
  itemNoun = "file",
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(isOpen, dialogRef);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, onCancel]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-modal-portal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-3 select-none"
      style={{ zIndex: Z_INDEX.modalConfirm }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Empty Recycle Bin"
        tabIndex={-1}
        data-mica-overlay="true"
        className="w-full max-w-[310px] rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-fg"
      >
        <div className="h-[32px] px-3 border-b border-line bg-surface-header flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Trash2 className="w-3.5 h-3.5 text-accent-fg shrink-0" />
            <span className="text-[12px] font-semibold text-fg truncate">
              Empty Recycle Bin
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-3 py-3 text-[12px] text-fg-2 leading-snug">
          Move{" "}
          <span className="font-semibold text-fg">
            {trashedCount.toLocaleString()}{" "}
            {trashedCount === 1 ? itemNoun : `${itemNoun}s`}
          </span>{" "}
          <span className="font-mono text-[11px] text-fg-3">
            ({formatBytesCompact(trashedTotalBytes)})
          </span>{" "}
          to Recycle Bin?
        </div>

        <div className="px-3 py-2 border-t border-line bg-surface-header flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-[25px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-2 hover:text-fg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="h-[25px] px-2.5 rounded-xs bg-danger/15 hover:bg-danger hover:text-danger-on border border-danger/50 text-[11px] font-semibold text-danger inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3 shrink-0" />
            <span>Empty</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
