import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowUpRight,
  Lock,
  Redo2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
  Unlock,
} from "lucide-react";
import { APP_VERSION } from "../../constants/appInfo";
import { useAppUpdate } from "../../hooks/useAppUpdate";
import {
  checkForAppUpdates,
  openAudifyReleasesPage,
  setAutoCheckUpdates,
} from "../../services/updateCheckService";
import { useSampleStore } from "../../store/useSampleStore";
import {
  formatBytesCompact,
  formatShortJournalTimestamp,
} from "../../utils/format";
import { InlineConfirmRowBar } from "../common/InlineConfirmDeleteButton";
import { ToggleRow } from "./ToggleRow";
import { useMainFilterAction } from "./useMainFilterAction";

export const AdvancedTab: React.FC = () => {
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const setEnableAdvancedFileOps = useSampleStore(
    (s) => s.setEnableAdvancedFileOps
  );
  const confirmBeforeTrash = useSampleStore((s) => s.confirmBeforeTrash);
  const setConfirmBeforeTrash = useSampleStore((s) => s.setConfirmBeforeTrash);
  const libraries = useSampleStore((s) => s.libraries);
  const setLibraryReadOnly = useSampleStore((s) => s.setLibraryReadOnly);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedTotalBytes = useSampleStore((s) => s.trashedTotalBytes);
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const trashedSliceTotalBytes = useSampleStore((s) => s.trashedSliceTotalBytes);
  const trashedLayerCount = useSampleStore((s) => s.trashedLayerCount);
  const trashedLayerTotalBytes = useSampleStore((s) => s.trashedLayerTotalBytes);
  const totalTrashedCount = trashedCount + trashedSliceCount + trashedLayerCount;
  const totalTrashedBytes =
    trashedTotalBytes + trashedSliceTotalBytes + trashedLayerTotalBytes;
  const fileOpJournal = useSampleStore((s) => s.fileOpJournal);
  const fileOpUndoStack = useSampleStore((s) => s.fileOpUndoStack);
  const fileOpRedoStack = useSampleStore((s) => s.fileOpRedoStack);
  const refreshTrashStatus = useSampleStore((s) => s.refreshTrashStatus);
  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);
  const undoRenameSampleFile = useSampleStore((s) => s.undoRenameSampleFile);
  const undoLastFileOp = useSampleStore((s) => s.undoLastFileOp);
  const redoLastFileOp = useSampleStore((s) => s.redoLastFileOp);
  const sendFilterToMain = useMainFilterAction();

  const [showRiskConfirmModal, setShowRiskConfirmModal] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const appUpdate = useAppUpdate();

  useEffect(() => {
    void refreshTrashStatus();
  }, [refreshTrashStatus]);

  const handleToggleMaster = (nextChecked: boolean) => {
    if (nextChecked && !enableAdvancedFileOps) {
      setShowRiskConfirmModal(true);
      return;
    }
    setEnableAdvancedFileOps(false);
  };

  const canUndoAny =
    fileOpUndoStack.length > 0 || fileOpJournal.some((e) => e.can_undo);
  const canRedoAny = fileOpRedoStack.length > 0;

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto pr-0.5">
      {/* 1. FILE OPERATIONS & QUARANTINE TRASH */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden shrink-0">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            FILE OPERATIONS &amp; TRASH
          </span>
          <span
            className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded-xs border font-semibold uppercase tracking-wide ${
              enableAdvancedFileOps
                ? "bg-accent-soft border-accent/50 text-accent-fg"
                : "bg-ok/15 border-ok/40 text-ok"
            }`}
          >
            {enableAdvancedFileOps ? "Disk Write Active" : "Read-Only"}
          </span>
        </div>

        <div className="divide-y divide-line">
          {/* Row 1: Master Toggle */}
          <ToggleRow
            label="Disk file operations"
            checked={enableAdvancedFileOps}
            onChange={handleToggleMaster}
            title="Enable F2 rename, folder moves, and Trash quarantine"
          />

          {/* Row 1b: Delete Confirmation Guard Toggle */}
          <ToggleRow
            compact
            label="Confirm before Trash"
            checked={confirmBeforeTrash}
            onChange={setConfirmBeforeTrash}
            title="Show confirmation dialog before moving files to Trash"
          />

          {showRiskConfirmModal && (
            <div className="px-3 py-2 bg-accent-soft flex items-center justify-between gap-3">
              <div className="flex items-center space-x-2 min-w-0 text-[11px] text-fg-2">
                <AlertTriangle className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                <span className="truncate">
                  Moves or Trash may trigger{" "}
                  <span className="font-mono font-semibold text-accent-fg">
                    Media Offline
                  </span>{" "}
                  in active NLEs (<span className="font-mono">Ctrl+Z</span>{" "}
                  undoable).
                </span>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowRiskConfirmModal(false)}
                  className="h-[22px] px-2 bg-surface-2 hover:bg-surface-3 border border-line rounded-xs text-[10.5px] text-fg-2 hover:text-fg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRiskConfirmModal(false);
                    setEnableAdvancedFileOps(true);
                  }}
                  className="h-[22px] px-2.5 bg-accent hover:bg-accent-hover text-accent-on font-semibold rounded-xs text-[10.5px] cursor-pointer"
                >
                  Enable
                </button>
              </div>
            </div>
          )}

          {/* Row 2: Trash Status & Actions */}
          <div className="h-[38px] px-3 flex items-center justify-between gap-3">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="text-[12px] font-medium text-fg">
                Trash
              </span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-surface-2 border border-line text-fg-2"
                title={
                  trashedSliceCount > 0 || trashedLayerCount > 0
                    ? `${trashedCount} file(s), ${trashedSliceCount} slice(s), ${trashedLayerCount} layer(s)`
                    : undefined
                }
              >
                {totalTrashedCount} {totalTrashedCount === 1 ? "item" : "items"} •{" "}
                {formatBytesCompact(totalTrashedBytes)}
              </span>
            </div>

            <div className="flex items-center space-x-1.5 shrink-0">
              <button
                type="button"
                disabled={totalTrashedCount === 0}
                onClick={() => {
                  sendFilterToMain({ kind: "trash" });
                }}
                className="h-[22px] px-2 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[10.5px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                title="View trashed items in main table"
              >
                <span>View</span>
              </button>
              <button
                type="button"
                disabled={trashedCount === 0 || busyAction !== null}
                onClick={async () => {
                  setBusyAction("restore-all");
                  try {
                    await restoreSamplesFromTrash();
                  } finally {
                    setBusyAction(null);
                  }
                }}
                className="h-[22px] px-2 bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent/60 rounded-xs text-[10.5px] font-semibold text-accent-fg inline-flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                title="Restore all trashed files to their original folders"
              >
                <ArchiveRestore className="w-3 h-3 shrink-0" />
                <span>Restore All</span>
              </button>
              <button
                type="button"
                disabled={trashedCount === 0 || busyAction !== null}
                onClick={() => setConfirmEmptyTrash(true)}
                className="h-[22px] px-2 bg-danger/15 hover:bg-danger hover:text-danger-on border border-danger/50 rounded-xs text-[10.5px] font-semibold text-danger-fg inline-flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                title="Move trashed files to Windows Recycle Bin"
              >
                <Trash2 className="w-3 h-3 shrink-0" />
                <span>Empty</span>
              </button>
            </div>
          </div>

          {confirmEmptyTrash && trashedCount > 0 && (
            <div className="px-3 py-2 bg-danger/10">
              <InlineConfirmRowBar
                tone="accent"
                confirmLabel="Confirm Empty"
                confirmTitle="Confirm Empty"
                disabled={busyAction !== null}
                prompt={
                  <>
                    Send{" "}
                    <span className="font-mono font-semibold text-danger-fg">
                      {trashedCount} file(s)
                    </span>{" "}
                    to Recycle Bin?
                  </>
                }
                onConfirm={async () => {
                  setBusyAction("empty-trash");
                  try {
                    setConfirmEmptyTrash(false);
                    await emptyAudifyTrash();
                  } finally {
                    setBusyAction(null);
                  }
                }}
                onCancel={() => setConfirmEmptyTrash(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* 2. APP UPDATES */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden shrink-0">
        <div className="h-[32px] px-3 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            APP UPDATES
          </span>
          <span
            className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded-xs border font-semibold tabular-nums ${
              appUpdate.info?.has_update
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-1 border-line text-fg-2"
            }`}
          >
            {appUpdate.info?.has_update
              ? `v${appUpdate.info.latest_version} available`
              : `v${APP_VERSION}`}
          </span>
        </div>

        <div className="divide-y divide-line">
          <ToggleRow
            compact
            label="Auto-check for updates on startup"
            checked={appUpdate.autoCheckEnabled}
            onChange={setAutoCheckUpdates}
            title="Silently check GitHub Releases once every 6 hours when Audify launches"
          />

          <div className="h-[36px] px-3 flex items-center justify-between gap-3">
            <span className="font-mono text-[10.5px] text-fg-2 truncate">
              {appUpdate.status === "checking"
                ? "Checking GitHub Releases..."
                : appUpdate.status === "error"
                ? "Could not reach GitHub Releases"
                : appUpdate.info?.has_update
                ? `New version v${appUpdate.info.latest_version} is ready on GitHub`
                : appUpdate.lastCheckedAt
                ? `You're up to date (v${APP_VERSION})`
                : `Current version v${APP_VERSION}`}
            </span>

            <div className="flex items-center space-x-1.5 shrink-0">
              {appUpdate.info?.has_update && (
                <button
                  type="button"
                  onClick={() =>
                    void openAudifyReleasesPage(appUpdate.info?.release_url)
                  }
                  className="h-[22px] px-2 bg-accent-soft hover:bg-accent border border-accent rounded-xs text-[10.5px] font-semibold text-accent-fg hover:text-accent-on inline-flex items-center space-x-1 transition-colors cursor-pointer"
                  title={`Open Audify v${appUpdate.info.latest_version} on GitHub Releases`}
                >
                  <ArrowUpRight className="w-3 h-3 shrink-0" />
                  <span>Download</span>
                </button>
              )}
              <button
                type="button"
                disabled={appUpdate.status === "checking"}
                onClick={() => void checkForAppUpdates({ force: true })}
                className="h-[22px] px-2 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[10.5px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
                title="Check GitHub Releases for a newer version now"
              >
                <RefreshCw
                  className={`w-3 h-3 shrink-0 ${
                    appUpdate.status === "checking" ? "animate-spin" : ""
                  }`}
                />
                <span>Check Now</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. LIBRARY WRITE ACCESS (COMPACT) */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden shrink-0">
        <div className="h-[32px] px-3 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            LIBRARY WRITE ACCESS
          </span>
          <span className="text-[10px] font-mono text-fg-3">
            {libraries.length}{" "}
            {libraries.length === 1 ? "library" : "libraries"}
          </span>
        </div>

        <div className="divide-y divide-line max-h-[132px] overflow-y-auto">
          {libraries.length === 0 ? (
            <div className="h-[36px] px-3 flex items-center font-mono text-[11px] text-fg-3">
              No libraries indexed.
            </div>
          ) : (
            libraries.map((lib) => {
              const isLocked = Boolean(lib.is_read_only);
              return (
                <div
                  key={lib.id}
                  className="h-[34px] px-3 flex items-center justify-between gap-3 hover:bg-surface-hover"
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    {isLocked ? (
                      <Lock className="w-3.5 h-3.5 text-warn shrink-0" />
                    ) : (
                      <Unlock className="w-3.5 h-3.5 text-fg-3 shrink-0" />
                    )}
                    <span className="text-[11.5px] font-semibold text-fg shrink-0">
                      {lib.name}
                    </span>
                    <span className="text-[10px] font-mono text-fg-3 shrink-0">
                      ({lib.sample_count.toLocaleString()})
                    </span>
                    <span className="font-mono text-[10px] text-fg-3 truncate">
                      {lib.path}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void setLibraryReadOnly(lib.id, !isLocked)}
                    className={`h-[22px] px-2 rounded-xs border text-[10px] font-mono font-medium inline-flex items-center space-x-1 shrink-0 transition-colors cursor-pointer ${
                      isLocked
                        ? "bg-accent-soft border-accent/50 text-accent-fg hover:bg-accent/20"
                        : "bg-surface-2 border-line text-fg-2 hover:text-fg hover:border-accent"
                    }`}
                    title={
                      isLocked
                        ? "Protected Read-Only Vault — Click to make writable"
                        : "Writable — Click to lock as Protected Read-Only Vault"
                    }
                  >
                    {isLocked ? (
                      <>
                        <Lock className="w-2.5 h-2.5 shrink-0" />
                        <span>Protected</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-2.5 h-2.5 shrink-0" />
                        <span>Writable</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. OPERATION HISTORY & UNDO / REDO */}
      <div className="bg-surface-1 border border-line rounded-md flex-1 flex flex-col min-h-[160px] overflow-hidden">
        <div className="h-[32px] px-3 bg-surface-2 border-b border-line flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
              OPERATION HISTORY
            </span>
            <span className="text-[10px] font-mono text-fg-3">
              ({fileOpJournal.length})
            </span>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              disabled={!canUndoAny || busyAction !== null}
              onClick={async () => {
                setBusyAction("undo");
                try {
                  await undoLastFileOp();
                } finally {
                  setBusyAction(null);
                }
              }}
              className="h-[22px] px-2 bg-surface-1 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[10px] font-mono text-fg-2 hover:text-fg inline-flex items-center space-x-1 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              title="Undo last rename or delete (Ctrl+Z)"
            >
              <Undo2 className="w-3 h-3 shrink-0" />
              <span>Undo</span>
              <span className="text-[9px] text-fg-3">Ctrl+Z</span>
            </button>
            <button
              type="button"
              disabled={!canRedoAny || busyAction !== null}
              onClick={async () => {
                setBusyAction("redo");
                try {
                  await redoLastFileOp();
                } finally {
                  setBusyAction(null);
                }
              }}
              className="h-[22px] px-2 bg-surface-1 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[10px] font-mono text-fg-2 hover:text-fg inline-flex items-center space-x-1 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              title="Redo last undone operation (Ctrl+Y)"
            >
              <Redo2 className="w-3 h-3 shrink-0" />
              <span>Redo</span>
              <span className="text-[9px] text-fg-3">Ctrl+Y</span>
            </button>
          </div>
        </div>

        <div className="flex-1 divide-y divide-line overflow-y-auto min-h-0">
          {fileOpJournal.length === 0 ? (
            <div className="p-6 text-center font-mono text-[11px] text-fg-3">
              No file operations recorded yet.
            </div>
          ) : (
            fileOpJournal.map((entry) => {
              const showArrow =
                Boolean(entry.new_name) && entry.new_name !== entry.old_name;
              const canRowUndo = entry.can_undo && entry.sample_id > 0;
              return (
                <div
                  key={entry.id}
                  className="h-[30px] px-3 flex items-center justify-between gap-3 text-[11px] hover:bg-surface-hover"
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <span
                      className={`font-mono text-[9px] w-[72px] text-center py-0.5 rounded-xs border font-semibold shrink-0 ${
                        entry.op_type === "RENAME" || entry.op_type === "MOVE"
                          ? "bg-accent-soft border-accent/40 text-accent-fg"
                          : entry.op_type === "TRASH"
                          ? "bg-danger/15 border-danger/40 text-danger-fg"
                          : entry.op_type === "RESTORE" ||
                            entry.op_type === "UNDO_RENAME" ||
                            entry.op_type === "UNDO_MOVE"
                          ? "bg-ok/15 border-ok/40 text-ok"
                          : "bg-danger/15 border-danger/40 text-danger-fg"
                      }`}
                    >
                      {entry.op_type === "UNDO_RENAME" ||
                      entry.op_type === "UNDO_MOVE"
                        ? "UNDO"
                        : entry.op_type}
                    </span>
                    <span className="font-mono text-fg-2 truncate">
                      {entry.old_name}
                    </span>
                    {showArrow && (
                      <>
                        <span className="text-fg-3 shrink-0">→</span>
                        <span className="font-mono font-semibold text-fg truncate">
                          {entry.new_name}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {canRowUndo && (
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.op_type === "RENAME") {
                            void undoRenameSampleFile(entry.sample_id);
                          } else if (entry.op_type === "TRASH") {
                            void restoreSamplesFromTrash([entry.sample_id]);
                          } else if (entry.op_type === "MOVE") {
                            void undoLastFileOp();
                          }
                        }}
                        className="h-[20px] px-2 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[10px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1 cursor-pointer"
                        title={
                          entry.op_type === "RENAME"
                            ? `Restore "${entry.old_name}"`
                            : `Restore "${entry.old_name}" from Trash`
                        }
                      >
                        <RotateCcw className="w-2.5 h-2.5 shrink-0" />
                        <span>
                          {entry.op_type === "TRASH" ? "Restore" : "Undo"}
                        </span>
                      </button>
                    )}
                    <span
                      className="font-mono text-[9.5px] text-fg-3 w-[104px] text-right tabular-nums shrink-0"
                      title={entry.created_at}
                    >
                      {formatShortJournalTimestamp(entry.created_at)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
