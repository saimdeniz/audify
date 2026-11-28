import React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Lock } from "lucide-react";
import type { BatchRenamePreviewResult } from "../../utils/batchRename";

interface BatchRenamePreviewPaneProps {
  preview: BatchRenamePreviewResult;
  autoDisambiguate: boolean;
  onEnableAutoDisambiguate: () => void;
}

/**
 * Renders filename collision/validation alerts and the scrollable per-row
 * old -> new preview list inside the fixed-height rename dialog.
 */
export const BatchRenamePreviewPane: React.FC<BatchRenamePreviewPaneProps> = ({
  preview,
  autoDisambiguate,
  onEnableAutoDisambiguate,
}) => (
  <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-1">
    {(preview.collisionCount > 0 || preview.invalidCount > 0) && (
      <div className="px-3 sm:px-4 py-2 bg-surface-2 border-b border-danger flex items-center justify-between gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-2 text-danger-fg font-medium min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {preview.collisionCount > 0
              ? `${preview.collisionCount} collision(s) detected — cannot overwrite existing file.`
              : `${preview.invalidCount} invalid filename(s) detected.`}
          </span>
        </div>
        {preview.collisionCount > 0 && !autoDisambiguate && (
          <button
            type="button"
            onClick={onEnableAutoDisambiguate}
            className="h-[22px] px-2 rounded-xs bg-accent-soft border border-accent text-accent-fg font-mono text-[10px] font-semibold shrink-0 whitespace-nowrap cursor-pointer"
          >
            Fix with _01, _02
          </button>
        )}
      </div>
    )}

    <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line bg-surface-1">
      {preview.rows.map((row) => (
        <div
          key={row.sample.id}
          className="px-3 sm:px-4 py-1.5 flex items-center gap-2 text-[11px] font-mono"
        >
          <span
            className="flex-1 min-w-0 truncate text-fg-2"
            title={row.oldFileName}
          >
            {row.oldFileName}
          </span>
          <ArrowRight className="w-3 h-3 text-fg-3 shrink-0" />
          <span
            className={`flex-1 min-w-0 truncate font-medium ${
              row.status === "ready"
                ? "text-accent-fg"
                : row.status === "duplicate" || row.status === "invalid"
                ? "text-danger-fg"
                : "text-fg-3"
            }`}
            title={row.reason || row.newFileName}
          >
            {row.newFileName}
          </span>
          <span className="w-[78px] sm:w-[96px] flex justify-end shrink-0">
            {row.status === "ready" && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-accent-soft text-accent-fg text-[9.5px]">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Ready
              </span>
            )}
            {row.status === "unchanged" && (
              <span className="px-1.5 py-0.5 rounded-xs bg-surface-2 text-fg-3 text-[9.5px]">
                Unchanged
              </span>
            )}
            {row.status === "duplicate" && (
              <span
                className="px-1.5 py-0.5 rounded-xs bg-surface-2 border border-danger text-danger-fg text-[9.5px]"
                title={row.reason}
              >
                Duplicate
              </span>
            )}
            {row.status === "invalid" && (
              <span
                className="px-1.5 py-0.5 rounded-xs bg-surface-2 border border-danger text-danger-fg text-[9.5px]"
                title={row.reason}
              >
                Invalid
              </span>
            )}
            {row.status === "vault_locked" && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-surface-2 border border-warn text-warn text-[9.5px]"
                title={row.reason}
              >
                <Lock className="w-2.5 h-2.5" />
                Vault
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  </div>
);
