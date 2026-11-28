import React from "react";
import { AlertTriangle, Check, Trash2, X } from "lucide-react";

export interface InlineConfirmDeleteButtonProps {
  isConfirming: boolean;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  size?: "sm" | "xs";
  deleteTitle?: string;
  confirmTitle?: string;
  idleClassName?: string;
  idleLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  confirmClassName?: string;
}

/**
 * Compact two-click inline confirm button (Trash -> Confirm / Cancel)
 * shared across inspector headers, templates, categories, and toolbars.
 */
export const InlineConfirmDeleteButton: React.FC<InlineConfirmDeleteButtonProps> =
  React.memo(
    ({
      isConfirming,
      onRequest,
      onConfirm,
      onCancel,
      size = "sm",
      deleteTitle = "Delete",
      confirmTitle = "Confirm Delete",
      idleClassName,
      idleLabel,
      confirmLabel,
      cancelLabel,
      disabled = false,
      confirmClassName,
    }) => {
      const box = size === "xs" ? "w-[18px] h-[18px]" : "w-[22px] h-[22px]";
      const icon = size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3";

      if (isConfirming) {
        return (
          <div className="inline-flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={onConfirm}
              className={
                confirmClassName ??
                (confirmLabel
                  ? "h-[24px] px-2 rounded-[3px] bg-danger hover:bg-danger/90 text-danger-on font-mono text-[10.5px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  : `${box} bg-danger hover:bg-danger/90 text-danger-on rounded-xs flex items-center justify-center transition-colors cursor-pointer shadow-xs`)
              }
              title={confirmTitle}
            >
              {confirmLabel ? <span>{confirmLabel}</span> : <Check className={`${icon} stroke-[2.5]`} />}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className={
                cancelLabel
                  ? "h-[24px] px-2 rounded-[3px] bg-surface-3 border border-line text-fg-2 hover:text-fg font-mono text-[10.5px] cursor-pointer"
                  : `${box} bg-surface-3 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg rounded-xs flex items-center justify-center cursor-pointer`
              }
              title={cancelLabel ?? "Cancel"}
            >
              {cancelLabel ?? <X className={icon} />}
            </button>
          </div>
        );
      }

      return (
        <button
          type="button"
          disabled={disabled}
          onClick={onRequest}
          className={
            idleClassName ??
            (idleLabel
              ? "h-[24px] px-2 rounded-[3px] bg-surface-2 hover:bg-accent-soft hover:text-accent-fg border border-line hover:border-accent text-fg-2 font-mono text-[10.5px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none shrink-0"
              : `${box} bg-surface-2 hover:bg-accent-soft hover:text-accent-fg hover:border-accent border border-line text-fg-2 rounded-xs flex items-center justify-center transition-colors cursor-pointer shrink-0`)
          }
          title={deleteTitle}
        >
          <Trash2 className={`${icon} shrink-0`} />
          {idleLabel && <span>{idleLabel}</span>}
        </button>
      );
    }
  );

export interface InlineConfirmRowBarProps {
  prompt: React.ReactNode;
  confirmLabel?: string;
  confirmTitle?: string;
  disabled?: boolean;
  tone?: "danger" | "accent";
  className?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Inline row-level confirmation bar shared by Libraries, Profiles, Backups, and Trash controls.
 */
export const InlineConfirmRowBar: React.FC<InlineConfirmRowBarProps> =
  React.memo(
    ({
      prompt,
      confirmLabel = "Delete",
      confirmTitle = "Confirm Delete",
      disabled = false,
      tone = "danger",
      className = "flex items-center justify-between gap-3 w-full",
      onConfirm,
      onCancel,
    }) => (
      <div className={className}>
        <span className="flex items-center gap-1.5 min-w-0 text-[11px] font-medium text-fg">
          {tone === "danger" && (
            <AlertTriangle className="w-3.5 h-3.5 text-danger-fg shrink-0" />
          )}
          <span className="truncate">{prompt}</span>
        </span>
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className={`h-[22px] px-2.5 rounded-xs text-[10.5px] font-semibold inline-flex items-center transition-colors cursor-pointer disabled:opacity-50 ${
              tone === "accent"
                ? "bg-accent hover:bg-accent-hover text-accent-on"
                : "bg-danger hover:bg-danger/90 text-danger-on"
            }`}
            title={confirmTitle}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-[22px] px-2 bg-surface-3 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg rounded-xs text-[10.5px] inline-flex items-center transition-colors cursor-pointer"
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  );
