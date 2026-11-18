import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  ArrowUpRight,
  Copy,
  ExternalLink,
  Pencil,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { SliceHistoryEntry } from "../../types";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { handleContextMenuKeyDown, MenuItem } from "../common/MenuItem";

export interface SliceContextMenuState {
  x: number;
  y: number;
  entry: SliceHistoryEntry;
  targetIds: number[];
}

interface SliceContextMenuProps {
  contextMenu: SliceContextMenuState;
  setContextMenu: React.Dispatch<
    React.SetStateAction<SliceContextMenuState | null>
  >;
  sliceByIdMap: ReadonlyMap<number, SliceHistoryEntry>;
  isTrashMode?: boolean;
}

const MENU_WIDTH = 248;

export const SliceContextMenu: React.FC<SliceContextMenuProps> = ({
  contextMenu,
  setContextMenu,
  sliceByIdMap,
  isTrashMode = false,
}) => {
  const shortcuts = useSampleStore((s) => s.shortcuts);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const selectSliceForPreview = useSampleStore((s) => s.selectSliceForPreview);
  const jumpToSliceSource = useSampleStore((s) => s.jumpToSliceSource);
  const toggleSliceFavorite = useSampleStore((s) => s.toggleSliceFavorite);
  const toggleSliceFavoritesBatch = useSampleStore(
    (s) => s.toggleSliceFavoritesBatch
  );
  const openBatchRenameSlicesModal = useSampleStore(
    (s) => s.openBatchRenameSlicesModal
  );
  const trashSliceFiles = useSampleStore((s) => s.trashSliceFiles);
  const restoreTrashedSlices = useSampleStore((s) => s.restoreTrashedSlices);
  const emptyTrashedSlices = useSampleStore((s) => s.emptyTrashedSlices);
  const showInFolder = useSampleStore((s) => s.showInFolder);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      menuRef.current?.focus({ preventScroll: true });
    });
    const handleOutsidePointer = (e: MouseEvent) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu(null);
      }
    };
    const handleScroll = (e: Event) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        return;
      }
      setContextMenu(null);
    };
    const handleWindowBlur = () => setContextMenu(null);

    window.addEventListener("mousedown", handleOutsidePointer, true);
    window.addEventListener("click", handleOutsidePointer, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", handleOutsidePointer, true);
      window.removeEventListener("click", handleOutsidePointer, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [setContextMenu]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - (rect.width || MENU_WIDTH) - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const x = Math.max(8, Math.min(contextMenu.x, maxX));
    const y = Math.max(8, Math.min(contextMenu.y, maxY));
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x, y } : prev));
    }
  }, [contextMenu.x, contextMenu.y, contextMenu.targetIds.length, setContextMenu]);

  const activeEntry = sliceByIdMap.get(contextMenu.entry.id) ?? contextMenu.entry;
  const targetEntries = contextMenu.targetIds
    .map((id) => sliceByIdMap.get(id))
    .filter((s): s is SliceHistoryEntry => Boolean(s));
  const isMulti = targetEntries.length > 1;
  const allTargetsFav =
    targetEntries.length > 0 && targetEntries.every((s) => s.is_favorite);
  const anyExisting = targetEntries.some((s) => s.file_exists);

  const favKeyLabel = formatShortcutDisplay(
    shortcuts.toggleFavorite ?? DEFAULT_SHORTCUTS.toggleFavorite,
    { compact: true }
  );
  const copyPathLabel = formatShortcutDisplay(
    shortcuts.copyFilePath ?? DEFAULT_SHORTCUTS.copyFilePath,
    { compact: true }
  );
  const showInFolderLabel = formatShortcutDisplay(
    shortcuts.showInFolder ?? DEFAULT_SHORTCUTS.showInFolder,
    { compact: true }
  );
  const playPauseLabel = formatShortcutDisplay(
    shortcuts.playPause ?? DEFAULT_SHORTCUTS.playPause,
    { compact: true }
  );

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Slice actions"
      tabIndex={-1}
      onKeyDown={handleContextMenuKeyDown}
      data-context-menu-portal="true"
      style={{
        top: contextMenu.y,
        left: contextMenu.x,
        zIndex: Z_INDEX.contextMenu,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed w-[248px] bg-surface-2 border border-line-strong rounded-md py-1 text-[11.5px] text-fg font-sans shadow-2xl outline-none select-none"
    >
      <div className="px-2.5 py-1 border-b border-line text-[10px] font-mono text-accent-fg truncate">
        {isMulti
          ? `${targetEntries.length} slices selected`
          : activeEntry.slice_name}
      </div>

      {!isMulti && activeEntry.file_exists && (
        <MenuItem
          compactHeight
          tone="accent"
          onClick={() => {
            setContextMenu(null);
            selectSliceForPreview(activeEntry, true);
          }}
          icon={<Play className="w-3.5 h-3.5 text-accent-fg" />}
          label="Preview Slice"
          rightSlot={
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">
              {playPauseLabel}
            </span>
          }
        />
      )}

      {!isMulti && (
        <MenuItem
          compactHeight
          tone="accent"
          onClick={() => {
            setContextMenu(null);
            void jumpToSliceSource(activeEntry);
          }}
          icon={<ArrowUpRight className="w-3.5 h-3.5 text-accent-fg" />}
          label="Jump to Source & Reselect"
        />
      )}

      {!isTrashMode && (
        <>
          <div className="my-1 border-t border-line" />

          <MenuItem
            compactHeight
            onClick={() => {
              const ids = targetEntries.map((s) => s.id);
              setContextMenu(null);
              if (ids.length > 1) {
                void toggleSliceFavoritesBatch(ids, !allTargetsFav);
              } else {
                void toggleSliceFavorite(activeEntry.id);
              }
            }}
            icon={
              <Star
                className={`w-3.5 h-3.5 ${
                  allTargetsFav ? "text-accent-fg fill-current" : "text-fg-3"
                }`}
              />
            }
            label={
              isMulti
                ? allTargetsFav
                  ? `Remove ${targetEntries.length} from Favorites`
                  : `Add ${targetEntries.length} to Favorites`
                : activeEntry.is_favorite
                ? "Remove from Favorites"
                : "Add to Favorites"
            }
            rightSlot={
              <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                {favKeyLabel}
              </span>
            }
          />

          <MenuItem
            compactHeight
            onClick={async () => {
              const paths = targetEntries.map((s) => s.slice_path);
              setContextMenu(null);
              const ok = await copyTextToClipboard(paths.join("\n"));
              if (ok) {
                setStatusMessage(
                  paths.length === 1
                    ? "Copied slice file path"
                    : `Copied ${paths.length} slice paths`
                );
              }
            }}
            icon={<Copy className="w-3.5 h-3.5 text-fg-3" />}
            label={isMulti ? "Copy File Paths" : "Copy File Path"}
            rightSlot={
              <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                {copyPathLabel}
              </span>
            }
          />

          {activeEntry.file_exists && !isMulti && (
            <MenuItem
              compactHeight
              onClick={() => {
                const p = activeEntry.slice_path;
                setContextMenu(null);
                void showInFolder(p);
              }}
              icon={<ExternalLink className="w-3.5 h-3.5 text-fg-3" />}
              label="Show in Explorer"
              rightSlot={
                <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                  {showInFolderLabel}
                </span>
              }
            />
          )}
        </>
      )}

      {isTrashMode ? (
        <>
          <div className="my-1 border-t border-line" />
          <MenuItem
            compactHeight
            tone="accent"
            title="Restore quarantined slice file to its export folder"
            onClick={() => {
              const ids = targetEntries.map((s) => s.id);
              setContextMenu(null);
              void restoreTrashedSlices(ids);
            }}
            icon={<ArchiveRestore className="w-3.5 h-3.5 text-accent-fg" />}
            label={
              <span className="font-medium">
                {isMulti
                  ? `Restore ${targetEntries.length} from Trash`
                  : "Restore from Trash"}
              </span>
            }
          />
          <MenuItem
            compactHeight
            tone="accent"
            title="Send quarantined slice permanently to OS Recycle Bin"
            onClick={() => {
              const ids = targetEntries.map((s) => s.id);
              setContextMenu(null);
              void emptyTrashedSlices(ids);
            }}
            icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
            label={
              <span className="font-medium">
                {isMulti
                  ? `Send ${targetEntries.length} to Recycle Bin`
                  : "Send to Recycle Bin"}
              </span>
            }
          />
        </>
      ) : (
        enableAdvancedFileOps && (
          <>
            <div className="my-1 border-t border-line" />

            {anyExisting && (
              <MenuItem
                compactHeight
                tone="accent"
                title="Open Rename panel to safely rename slice file on disk (F2)"
                onClick={() => {
                  const ids = targetEntries
                    .filter((s) => s.file_exists)
                    .map((s) => s.id);
                  setContextMenu(null);
                  openBatchRenameSlicesModal(ids);
                }}
                icon={<Pencil className="w-3.5 h-3.5 text-accent-fg" />}
                label={
                  isMulti
                    ? `Rename ${targetEntries.length} Slices...`
                    : "Rename Slice File..."
                }
                rightSlot={
                  <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                    F2
                  </span>
                }
              />
            )}

            <MenuItem
              compactHeight
              tone="accent"
              title="Move slice file to quarantine trash (Ctrl+Z restores)"
              onClick={() => {
                const ids = targetEntries.map((s) => s.id);
                setContextMenu(null);
                void trashSliceFiles(ids);
              }}
              icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
              label={
                isMulti
                  ? `Move ${targetEntries.length} to Trash`
                  : "Move to Trash"
              }
              rightSlot={
                <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                  Del
                </span>
              }
            />
          </>
        )
      )}
    </div>,
    document.body
  );
};
