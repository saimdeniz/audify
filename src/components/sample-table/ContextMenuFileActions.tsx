import React from "react";
import { ArchiveRestore, Lock, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { MenuItem } from "../common/MenuItem";
import { ContextMenuState } from "./tableLayout";

interface ContextMenuFileActionsProps {
  targetIds: number[];
  isMultiContext: boolean;
  activeContextSample: SampleItem;
  trashFilterActive: boolean;
  isVaultLocked: boolean;
  vaultName?: string;
  selectedCollectionId: number | null;
  clearSubmenuHover: () => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

export const ContextMenuFileActions: React.FC<ContextMenuFileActionsProps> = ({
  targetIds,
  isMultiContext,
  activeContextSample,
  trashFilterActive,
  isVaultLocked,
  vaultName,
  selectedCollectionId,
  clearSubmenuHover,
  setContextMenu,
}) => {
  const openBatchRenameModal = useSampleStore((s) => s.openBatchRenameModal);
  const undoRenameSampleFile = useSampleStore((s) => s.undoRenameSampleFile);
  const requestMoveSamplesToTrash = useSampleStore(
    (s) => s.requestMoveSamplesToTrash
  );
  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);

  if (trashFilterActive) {
    return (
      <>
        <div className="my-1 border-t border-line" />
        <MenuItem
          compactHeight
          tone="accent"
          onMouseEnter={clearSubmenuHover}
          onClick={async () => {
            setContextMenu(null);
            await restoreSamplesFromTrash(targetIds);
          }}
          icon={<ArchiveRestore className="w-3.5 h-3.5 text-accent-fg" />}
          label={
            <span className="font-medium">
              {isMultiContext
                ? `Restore ${targetIds.length} from Trash`
                : "Restore from Trash"}
            </span>
          }
        />
        <MenuItem
          compactHeight
          tone="accent"
          onMouseEnter={clearSubmenuHover}
          onClick={async () => {
            setContextMenu(null);
            await emptyAudifyTrash(targetIds);
          }}
          icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
          label={
            <span className="font-medium">
              {isMultiContext
                ? `Send ${targetIds.length} to Recycle Bin`
                : "Send to Recycle Bin"}
            </span>
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="my-1 border-t border-line" />
      {isMultiContext ? (
        <MenuItem
          compactHeight
          tone="accent"
          disabled={isVaultLocked}
          onMouseEnter={clearSubmenuHover}
          onClick={() => {
            const ids = [...targetIds];
            setContextMenu(null);
            openBatchRenameModal(ids);
          }}
          className="disabled:hover:bg-transparent disabled:hover:text-fg"
          title={
            isVaultLocked
              ? `Library "${vaultName}" is locked as a Protected Vault`
              : "Batch rename selected audio files (Prefix, Suffix, Find/Replace, Pattern)"
          }
          icon={
            isVaultLocked ? (
              <Lock className="w-3.5 h-3.5 text-warn" />
            ) : (
              <Pencil className="w-3.5 h-3.5 text-accent-fg" />
            )
          }
          label={
            isVaultLocked
              ? "Batch Rename (Protected Vault)"
              : `Batch Rename (${targetIds.length})...`
          }
        />
      ) : (
        <MenuItem
          compactHeight
          tone="accent"
          disabled={isVaultLocked}
          onMouseEnter={clearSubmenuHover}
          onClick={() => {
            const id = activeContextSample.id;
            setContextMenu(null);
            openBatchRenameModal([id]);
          }}
          className="disabled:hover:bg-transparent disabled:hover:text-fg"
          title={
            isVaultLocked
              ? `Library "${vaultName}" is locked as a Protected Vault`
              : "Open Rename panel to safely rename audio file on disk (F2)"
          }
          icon={
            isVaultLocked ? (
              <Lock className="w-3.5 h-3.5 text-warn" />
            ) : (
              <Pencil className="w-3.5 h-3.5 text-accent-fg" />
            )
          }
          label={
            isVaultLocked ? "Rename (Protected Vault)" : "Rename File on Disk..."
          }
          rightSlot={
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">F2</span>
          }
        />
      )}

      {!isMultiContext &&
        Boolean(activeContextSample.previous_file_name) &&
        !isVaultLocked && (
          <MenuItem
            compactHeight
            tone="accent"
            onMouseEnter={clearSubmenuHover}
            onClick={async () => {
              const id = activeContextSample.id;
              setContextMenu(null);
              await undoRenameSampleFile(id);
            }}
            title={`Restore previous file name "${activeContextSample.previous_file_name}"`}
            icon={<RotateCcw className="w-3.5 h-3.5 text-accent-fg" />}
            label={`Undo Rename (${activeContextSample.previous_file_name})`}
          />
        )}

      <MenuItem
        compactHeight
        tone="accent"
        disabled={isVaultLocked}
        onMouseEnter={clearSubmenuHover}
        onClick={async () => {
          setContextMenu(null);
          await requestMoveSamplesToTrash(targetIds);
        }}
        title={
          isVaultLocked
            ? `Library "${vaultName}" is locked as a Protected Vault`
            : "Move to Trash (preserves Tags, Favorites & Collections until emptied)"
        }
        icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
        label={
          isMultiContext
            ? `Move ${targetIds.length} to Trash`
            : "Move to Trash"
        }
        rightSlot={
          selectedCollectionId === null && (
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">Del</span>
          )
        }
      />
    </>
  );
};
