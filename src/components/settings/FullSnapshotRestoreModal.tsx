import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Database, RotateCcw, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { folderNameFromPath } from "../../utils/format";
import { useDialogFocusTrap } from "../../utils/modalFocus";

/**
 * Confirmation modal inspecting a `.audify-backup.zip` full DB snapshot
 * manifest before atomically replacing the live SQLite database and images.
 */
export const FullSnapshotRestoreModal: React.FC = () => {
  const pendingSnapshotRestore = useSampleStore(
    (s) => s.pendingSnapshotRestore
  );
  const clearPendingSnapshotRestore = useSampleStore(
    (s) => s.clearPendingSnapshotRestore
  );
  const confirmFullSnapshotRestore = useSampleStore(
    (s) => s.confirmFullSnapshotRestore
  );

  const [isRestoring, setIsRestoring] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const isOpen = Boolean(pendingSnapshotRestore);

  useDialogFocusTrap(isOpen, dialogRef);

  useEffect(() => {
    if (!isOpen) {
      setIsRestoring(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRestoring) {
        e.preventDefault();
        e.stopPropagation();
        clearPendingSnapshotRestore();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, isRestoring, clearPendingSnapshotRestore]);

  if (!pendingSnapshotRestore) {
    return null;
  }

  const { filePath, manifest } = pendingSnapshotRestore;
  const archiveName = folderNameFromPath(filePath);

  const handleConfirm = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    try {
      await confirmFullSnapshotRestore();
    } finally {
      setIsRestoring(false);
    }
  };

  return createPortal(
    <div
      data-modal-portal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isRestoring) {
          clearPendingSnapshotRestore();
        }
      }}
      className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-2 sm:p-4 select-none"
      style={{ zIndex: Z_INDEX.modalConfirm }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Restore Full Library Snapshot"
        tabIndex={-1}
        data-mica-overlay="true"
        className="w-full max-w-[410px] rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-fg"
      >
        {/* Header */}
        <div className="h-[34px] px-3 border-b border-line bg-surface-header flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-3.5 h-3.5 text-accent-fg shrink-0" />
            <span className="text-[12px] font-semibold text-fg truncate">
              Restore Full DB Snapshot
            </span>
          </div>
          <button
            type="button"
            disabled={isRestoring}
            onClick={clearPendingSnapshotRestore}
            className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-hover disabled:opacity-40 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-3 space-y-2.5">
          <div className="px-2.5 py-1.5 rounded-xs bg-surface-2 border border-line flex items-center justify-between gap-2">
            <span
              className="font-mono text-[11px] font-medium text-fg truncate"
              title={archiveName}
            >
              {archiveName}
            </span>
            <span className="px-1.5 py-0.2 rounded-xs bg-surface-3 border border-line font-mono text-[9.5px] text-fg-2 shrink-0">
              v{manifest.schema_version}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="px-2.5 py-1.5 rounded-xs bg-surface-2 border border-line min-w-0">
              <div className="text-[9.5px] font-mono uppercase text-fg-3">
                Active Profile
              </div>
              <div className="font-medium text-fg truncate">
                {manifest.active_profile_name}
              </div>
              <div className="text-[10px] text-fg-3">
                {manifest.profile_count} total profiles
              </div>
            </div>

            <div className="px-2.5 py-1.5 rounded-xs bg-surface-2 border border-line min-w-0">
              <div className="text-[9.5px] font-mono uppercase text-fg-3">
                Catalog &amp; AI Vectors
              </div>
              <div className="font-medium text-fg font-mono tabular-nums">
                {manifest.sample_count.toLocaleString()} samples
              </div>
              <div className="text-[10px] text-fg-3">
                {manifest.image_count} wallpaper assets
              </div>
            </div>
          </div>

          <div className="px-2.5 py-1.5 rounded-xs bg-surface-2 border border-line flex items-center justify-between text-[10.5px]">
            <span className="text-fg-3">Snapshot created</span>
            <span className="font-mono text-fg-2 tabular-nums">
              {manifest.created_at}
            </span>
          </div>

          <div className="px-2.5 py-2 rounded-xs bg-warn/10 border border-warn/40 flex items-start gap-2 text-[10.5px] leading-snug text-warn">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              This replaces the entire live catalog database (all profiles,
              waveforms, manual &amp; AI tags, vector embeddings, and wallpaper
              images) with the contents of this snapshot.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-line bg-surface-header flex items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={isRestoring}
            onClick={clearPendingSnapshotRestore}
            className="h-[26px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-2 hover:text-fg disabled:opacity-40 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isRestoring}
            onClick={() => void handleConfirm()}
            className="h-[26px] px-3 rounded-xs bg-danger/15 hover:bg-danger text-danger-fg hover:text-danger-on border border-danger/40 text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RotateCcw
              className={`w-3 h-3 shrink-0 ${isRestoring ? "animate-spin" : ""}`}
            />
            <span>{isRestoring ? "Restoring..." : "Restore Full Snapshot"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
