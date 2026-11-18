import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  Copy,
  ExternalLink,
  FileCheck2,
  FolderOpen,
  Inbox,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { handleContextMenuKeyDown, MenuItem } from "../common/MenuItem";

export interface MiniContextMenuState {
  sample: SampleItem;
  x: number;
  y: number;
}

interface MiniDockContextMenuProps {
  menu: MiniContextMenuState;
  onClose: () => void;
}

export const MiniDockContextMenu: React.FC<MiniDockContextMenuProps> = ({
  menu,
  onClose,
}) => {
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const shortcuts = useSampleStore((s) => s.shortcuts);

  const toggleFavorite = useSampleStore((s) => s.toggleFavorite);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const copySamplePaths = useSampleStore((s) => s.copySamplePaths);
  const showInFolder = useSampleStore((s) => s.showInFolder);
  const openBatchRenameModal = useSampleStore((s) => s.openBatchRenameModal);
  const undoRenameSampleFile = useSampleStore((s) => s.undoRenameSampleFile);
  const requestMoveSamplesToTrash = useSampleStore(
    (s) => s.requestMoveSamplesToTrash
  );
  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: menu.x,
    y: menu.y,
  });

  useLayoutEffect(() => {
    const el = menuRef.current;
    const menuWidth = el?.offsetWidth || 210;
    const menuHeight = el?.offsetHeight || 200;
    const margin = 6;
    const clampedX = Math.max(
      margin,
      Math.min(menu.x, window.innerWidth - menuWidth - margin)
    );
    const clampedY = Math.max(
      margin,
      Math.min(menu.y, window.innerHeight - menuHeight - margin)
    );
    setPos({ x: clampedX, y: clampedY });
  }, [menu.x, menu.y, menu.sample.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const targetIds =
    selectedSampleIds.length > 1 ? selectedSampleIds : [menu.sample.id];
  const copyPathShortcutLabel = formatShortcutDisplay(
    shortcuts.copyFilePath ?? DEFAULT_SHORTCUTS.copyFilePath,
    { compact: true }
  );
  const showInFolderShortcutLabel = formatShortcutDisplay(
    shortcuts.showInFolder ?? DEFAULT_SHORTCUTS.showInFolder,
    { compact: true }
  );

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Sample actions"
      data-context-menu-portal="true"
      data-mica-overlay="true"
      style={{ top: pos.y, left: pos.x, zIndex: Z_INDEX.floatingMenu }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleContextMenuKeyDown}
      className="fixed w-[210px] bg-surface-2 border border-line-strong rounded-md py-1 text-[11px] text-fg shadow-2xl"
    >
      <MenuItem
        tone="accent"
        compactHeight
        icon={<Inbox className="w-3.5 h-3.5 text-accent-fg" />}
        label="Add to Session Bin"
        onClick={() => {
          addSamplesToBin(targetIds);
          onClose();
        }}
      />

      {enableLicensesSystem && (
        <MenuItem
          tone="accent"
          compactHeight
          icon={<FileCheck2 className="w-3.5 h-3.5 text-accent-fg" />}
          label="Copy Credits"
          onClick={() => {
            void copyAttributionForSamples([menu.sample]);
            onClose();
          }}
        />
      )}

      <MenuItem
        tone="accent"
        compactHeight
        icon={
          <Star
            className={`w-3.5 h-3.5 text-accent-fg ${
              menu.sample.is_favorite ? "fill-current" : ""
            }`}
          />
        }
        label={menu.sample.is_favorite ? "Remove Favorite" : "Add Favorite"}
        onClick={() => {
          void toggleFavorite(menu.sample.id);
          onClose();
        }}
      />

      <div className="my-0.5 border-t border-line" />

      <MenuItem
        tone="accent"
        compactHeight
        icon={<Copy className="w-3.5 h-3.5 text-accent-fg" />}
        label={
          targetIds.length > 1
            ? `Copy File Paths (${targetIds.length})`
            : "Copy File Path"
        }
        rightSlot={
          copyPathShortcutLabel ? (
            <span className="font-mono text-[9.5px] text-fg-3">
              {copyPathShortcutLabel}
            </span>
          ) : undefined
        }
        onClick={() => {
          const sample = menu.sample;
          onClose();
          void copySamplePaths(targetIds.length > 1 ? undefined : [sample]);
        }}
      />

      <MenuItem
        tone="accent"
        compactHeight
        icon={<FolderOpen className="w-3.5 h-3.5 text-accent-fg" />}
        label="Show in Explorer"
        rightSlot={
          showInFolderShortcutLabel ? (
            <span className="font-mono text-[9.5px] text-fg-3">
              {showInFolderShortcutLabel}
            </span>
          ) : (
            <ExternalLink className="w-3 h-3 text-fg-3" />
          )
        }
        onClick={() => {
          const path = menu.sample.file_path;
          onClose();
          void showInFolder(path);
        }}
      />

      {trashFilterActive ? (
        <>
          <div className="my-0.5 border-t border-line" />
          <MenuItem
            tone="accent"
            compactHeight
            icon={<ArchiveRestore className="w-3.5 h-3.5 text-accent-fg" />}
            label="Restore from Trash"
            onClick={() => {
              onClose();
              void restoreSamplesFromTrash(targetIds);
            }}
          />
          <MenuItem
            tone="accent"
            compactHeight
            icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
            label="Send to Recycle Bin"
            onClick={() => {
              onClose();
              void emptyAudifyTrash(targetIds);
            }}
          />
        </>
      ) : enableAdvancedFileOps ? (
        <>
          <div className="my-0.5 border-t border-line" />
          {targetIds.length > 1 ? (
            <MenuItem
              tone="accent"
              compactHeight
              icon={<Pencil className="w-3.5 h-3.5 text-accent-fg" />}
              label={`Batch Rename (${targetIds.length})...`}
              onClick={() => {
                const ids = [...targetIds];
                onClose();
                openBatchRenameModal(ids);
              }}
            />
          ) : (
            <MenuItem
              tone="accent"
              compactHeight
              icon={<Pencil className="w-3.5 h-3.5 text-accent-fg" />}
              label="Rename File..."
              rightSlot={<span className="font-mono text-[9.5px] text-fg-3">F2</span>}
              onClick={() => {
                const id = menu.sample.id;
                onClose();
                openBatchRenameModal([id]);
              }}
            />
          )}
          {menu.sample.previous_file_name && (
            <MenuItem
              tone="accent"
              compactHeight
              icon={<RotateCcw className="w-3.5 h-3.5 text-accent-fg" />}
              label="Undo Rename"
              onClick={() => {
                const id = menu.sample.id;
                onClose();
                void undoRenameSampleFile(id);
              }}
            />
          )}
          <MenuItem
            tone="accent"
            compactHeight
            icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
            label="Move to Trash"
            rightSlot={<span className="font-mono text-[9.5px] text-fg-3">Del</span>}
            onClick={() => {
              onClose();
              void requestMoveSamplesToTrash(targetIds);
            }}
          />
        </>
      ) : null}
    </div>,
    document.body
  );
};
