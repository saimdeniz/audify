import React, { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Database,
  FolderOpen,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { BackupFileInfo } from "../../types";
import {
  folderNameFromPath,
  formatBackupDateLabel,
  formatBytesCompact,
} from "../../utils/format";
import {
  InlineConfirmDeleteButton,
  InlineConfirmRowBar,
} from "../common/InlineConfirmDeleteButton";

function resolveBackupBadge(b: BackupFileInfo): {
  label: string;
  className: string;
} {
  if (b.kind === "snapshot") {
    return {
      label: "FULL DB",
      className: "bg-ok/15 border-ok/40 text-ok",
    };
  }
  if (b.is_auto) {
    return {
      label: "AUTO",
      className: "bg-info/15 border-info/40 text-info",
    };
  }
  return {
    label: "PROFILE",
    className: "bg-accent/15 border-accent/40 text-accent-fg",
  };
}

interface BackupListRowProps {
  backup: BackupFileInfo;
  isConfirmingRestore: boolean;
  isConfirmingDelete: boolean;
  onRestoreClick: (backup: BackupFileInfo) => void;
  onConfirmRestore: (filePath: string) => void;
  onCancelRestore: () => void;
  onRequestDelete: (filePath: string) => void;
  onConfirmDelete: (filePath: string) => void;
  onCancelDelete: () => void;
}

const BackupListRow: React.FC<BackupListRowProps> = React.memo(
  ({
    backup,
    isConfirmingRestore,
    isConfirmingDelete,
    onRestoreClick,
    onConfirmRestore,
    onCancelRestore,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
  }) => {
    const fileName =
      backup.file_name || folderNameFromPath(backup.file_path, backup.file_path);
    const badge = resolveBackupBadge(backup);

    const handleRequestDelete = useCallback(() => {
      onRequestDelete(backup.file_path);
    }, [onRequestDelete, backup.file_path]);

    const handleConfirmDelete = useCallback(() => {
      onConfirmDelete(backup.file_path);
    }, [onConfirmDelete, backup.file_path]);

    return (
      <div
        className={`h-[32px] px-3 flex items-center justify-between gap-2.5 text-[11px] transition-colors ${
          isConfirmingRestore || isConfirmingDelete
            ? "bg-accent-soft"
            : "hover:bg-surface-hover"
        }`}
      >
        {isConfirmingRestore ? (
          <InlineConfirmRowBar
            tone="accent"
            confirmLabel="Restore"
            confirmTitle="Confirm Restore"
            prompt={
              <>
                Restore this workspace profile?{" "}
                <span className="text-fg-3 font-normal">
                  Imports it as a new active profile.
                </span>
              </>
            }
            onConfirm={() => onConfirmRestore(backup.file_path)}
            onCancel={onCancelRestore}
          />
        ) : (
          <div className="grid grid-cols-[68px_138px_1fr_62px_auto] items-center gap-2.5 w-full min-w-0">
            <div>
              <span
                className={`px-1.5 py-0.2 font-mono text-[9.5px] rounded-xs font-semibold uppercase inline-block border ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>
            <span
              className="font-mono text-[10.5px] text-fg-2 tabular-nums truncate"
              title={backup.created_at}
            >
              {formatBackupDateLabel(backup.created_at, backup.timestamp_ms)}
            </span>
            <span
              className="font-mono text-[10px] text-fg-3 truncate"
              title={`${backup.profile_name}${
                (backup.sample_count ?? 0) > 0
                  ? ` · ${(backup.sample_count ?? 0).toLocaleString()} samples`
                  : ""
              } (${fileName})`}
            >
              {fileName}
            </span>
            <span className="font-mono text-[10px] text-fg-3 tabular-nums text-right shrink-0">
              {formatBytesCompact(backup.file_size)}
            </span>

            <div className="flex items-center space-x-1 shrink-0">
              <button
                type="button"
                onClick={() => onRestoreClick(backup)}
                className="w-[22px] h-[22px] flex items-center justify-center bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs transition-colors cursor-pointer"
                title={
                  backup.kind === "snapshot"
                    ? "Inspect & restore full DB snapshot"
                    : "Restore workspace profile"
                }
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <InlineConfirmDeleteButton
                isConfirming={isConfirmingDelete}
                onRequest={handleRequestDelete}
                onConfirm={handleConfirmDelete}
                onCancel={onCancelDelete}
                deleteTitle="Delete snapshot"
                confirmTitle="Confirm delete snapshot"
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

/**
 * Manages local workspace profile backups (`.audify-profile`) and full SQLite
 * database snapshots (`.audify-backup.zip`) stored inside `user/backups`.
 */
export const ProfileBackupsCard: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const localBackups = useSampleStore((s) => s.localBackups);
  const createQuickBackup = useSampleStore((s) => s.createQuickBackup);
  const createFullSnapshotBackup = useSampleStore(
    (s) => s.createFullSnapshotBackup
  );
  const restoreLocalBackup = useSampleStore((s) => s.restoreLocalBackup);
  const openFullSnapshotRestorePrompt = useSampleStore(
    (s) => s.openFullSnapshotRestorePrompt
  );
  const deleteLocalBackup = useSampleStore((s) => s.deleteLocalBackup);
  const openBackupsFolder = useSampleStore((s) => s.openBackupsFolder);

  const [confirmRestoreBackupPath, setConfirmRestoreBackupPath] = useState<
    string | null
  >(null);
  const [confirmDeleteBackupPath, setConfirmDeleteBackupPath] = useState<
    string | null
  >(null);
  const [isCreatingProfileBackup, setIsCreatingProfileBackup] = useState(false);
  const [isCreatingFullSnapshot, setIsCreatingFullSnapshot] = useState(false);

  useEffect(() => {
    setConfirmRestoreBackupPath(null);
    setConfirmDeleteBackupPath(null);
  }, [activeProfileId]);

  const handleRestoreClick = useCallback(
    (backup: BackupFileInfo) => {
      setConfirmDeleteBackupPath(null);
      if (backup.kind === "snapshot") {
        void openFullSnapshotRestorePrompt(backup.file_path);
      } else {
        setConfirmRestoreBackupPath(backup.file_path);
      }
    },
    [openFullSnapshotRestorePrompt]
  );

  const handleConfirmRestore = useCallback(
    (filePath: string) => {
      void restoreLocalBackup(filePath).finally(() => {
        setConfirmRestoreBackupPath(null);
      });
    },
    [restoreLocalBackup]
  );

  const handleCancelRestore = useCallback(() => {
    setConfirmRestoreBackupPath(null);
  }, []);

  const handleRequestDelete = useCallback((filePath: string) => {
    setConfirmRestoreBackupPath(null);
    setConfirmDeleteBackupPath(filePath);
  }, []);

  const handleConfirmDelete = useCallback(
    (filePath: string) => {
      setConfirmDeleteBackupPath(null);
      void deleteLocalBackup(filePath);
    },
    [deleteLocalBackup]
  );

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteBackupPath(null);
  }, []);

  const isBusy = isCreatingProfileBackup || isCreatingFullSnapshot;

  return (
    <div className="bg-surface-1 border border-line rounded-md flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="h-[34px] px-3 border-b border-line bg-surface-header flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <Archive className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          <span className="text-[10.5px] font-mono font-semibold text-fg-2 uppercase tracking-wider truncate">
            BACKUPS &amp; SNAPSHOTS
          </span>
          <span className="text-[9.5px] font-mono text-fg-3 bg-surface-2 px-1.5 py-0.2 rounded-xs border border-line shrink-0">
            {localBackups.length}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void openBackupsFolder()}
            className="w-[23px] h-[23px] flex items-center justify-center bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs transition-colors cursor-pointer"
            title="Open user/backups folder in Explorer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                setIsCreatingProfileBackup(true);
                await createQuickBackup(false);
              } finally {
                setIsCreatingProfileBackup(false);
              }
            }}
            disabled={isBusy}
            className="h-[23px] px-2 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg rounded-xs inline-flex items-center space-x-1 text-[10.5px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
            title="Save compact active workspace profile backup (.audify-profile)"
          >
            <Plus
              className={`w-3 h-3 text-accent-fg shrink-0 ${
                isCreatingProfileBackup ? "animate-spin" : ""
              }`}
            />
            <span>Quick Profile</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                setIsCreatingFullSnapshot(true);
                await createFullSnapshotBackup();
              } finally {
                setIsCreatingFullSnapshot(false);
              }
            }}
            disabled={isBusy}
            className="h-[23px] px-2.5 bg-accent hover:bg-accent-hover text-accent-on rounded-xs inline-flex items-center space-x-1 text-[10.5px] font-semibold transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
            title="Create complete SQLite DB, AI vectors & images snapshot (.audify-backup.zip)"
          >
            <Database
              className={`w-3 h-3 shrink-0 ${
                isCreatingFullSnapshot ? "animate-spin" : ""
              }`}
            />
            <span>Full DB Snapshot</span>
          </button>
        </div>
      </div>

      {/* Table Column Header */}
      <div className="h-[24px] px-3 bg-surface-sub border-b border-line grid grid-cols-[68px_138px_1fr_62px_auto] items-center gap-2.5 text-[9.5px] font-mono font-semibold text-fg-3 uppercase tracking-wider shrink-0">
        <span>TYPE</span>
        <span>DATE</span>
        <span>FILE</span>
        <span className="text-right">SIZE</span>
        <span className="w-[52px]" />
      </div>

      {/* Snapshots Scrollable List Filling Remaining Space */}
      <div className="flex-1 divide-y divide-line-subtle overflow-y-auto min-h-0">
        {localBackups.length === 0 ? (
          <div className="p-6 text-center text-fg-3 text-[11px] font-mono">
            No snapshots yet. Save a compact &ldquo;+ Quick Profile&rdquo; or
            a &ldquo;Full DB Snapshot&rdquo;.
          </div>
        ) : (
          localBackups.map((b) => (
            <BackupListRow
              key={b.file_path}
              backup={b}
              isConfirmingRestore={
                confirmRestoreBackupPath === b.file_path &&
                b.kind !== "snapshot"
              }
              isConfirmingDelete={confirmDeleteBackupPath === b.file_path}
              onRestoreClick={handleRestoreClick}
              onConfirmRestore={handleConfirmRestore}
              onCancelRestore={handleCancelRestore}
              onRequestDelete={handleRequestDelete}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
            />
          ))
        )}
      </div>

      {/* Footer Note */}
      <div className="h-[24px] px-3 border-t border-line bg-surface-sub flex items-center justify-between text-[10px] text-fg-3 shrink-0">
        <span>
          Backups are stored in{" "}
          <code className="font-mono text-fg-2">user/backups</code>
        </span>
        <span className="font-mono text-[9.5px] text-fg-3 hidden sm:inline">
          PROFILE = tags &amp; rules · FULL DB = complete catalog
        </span>
      </div>
    </div>
  );
};
