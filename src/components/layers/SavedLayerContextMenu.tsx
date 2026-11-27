import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  Copy,
  FolderOpen,
  Layers,
  Pencil,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import type { LayerHistoryEntry } from "../../types";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { handleContextMenuKeyDown, MenuItem } from "../common/MenuItem";

export interface LayerContextMenuState {
  entry: LayerHistoryEntry;
  x: number;
  y: number;
}

interface SavedLayerContextMenuProps {
  menu: LayerContextMenuState;
  mode: "saved" | "favorites" | "trash";
  allEntries: LayerHistoryEntry[];
  selectedLayerIds: number[];
  selectedSet: ReadonlySet<number>;
  onClose: () => void;
  onPreviewLayer: (entry: LayerHistoryEntry) => void;
  onEditInLayers: (entry: LayerHistoryEntry) => void;
  onToggleFavorite: (layerId: number) => void;
  onToggleFavoritesBatch: (layerIds: number[], isFavorite: boolean) => void;
  onOpenRenameModal: (layerIds: number[]) => void;
  onRevealInExplorer: (path: string) => void;
  onTrashLayers: (ids: number[]) => void;
  onRestoreLayers: (ids: number[]) => void;
  onEmptyLayers: (ids: number[]) => void;
}

const MENU_WIDTH = 248;

/**
 * Unified portal context menu for Saved Layers across Main View (`Saved`, `Favorites`, `Trash`)
 * and Mini Dock Layers list. Matches `SliceContextMenu` & `SampleContextMenu` 1:1 with
 * full multi-select, `BatchRenameModal` (F2), copy path, shortcuts, and theme accent icons.
 */
export const SavedLayerContextMenu: React.FC<SavedLayerContextMenuProps> = ({
  menu,
  mode,
  allEntries,
  selectedLayerIds,
  selectedSet,
  onClose,
  onPreviewLayer,
  onEditInLayers,
  onToggleFavorite,
  onToggleFavoritesBatch,
  onOpenRenameModal,
  onRevealInExplorer,
  onTrashLayers,
  onRestoreLayers,
  onEmptyLayers,
}) => {
  const shortcuts = useSampleStore((s) => s.shortcuts);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<{ x: number; y: number }>({ x: menu.x, y: menu.y });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      menuRef.current?.focus({ preventScroll: true });
    });
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      onClose();
    };
    window.addEventListener("mousedown", handleOutside, true);
    window.addEventListener("click", handleOutside, true);
    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", handleOutside, true);
      window.removeEventListener("click", handleOutside, true);
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - (rect.width || MENU_WIDTH) - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const nextX = Math.max(8, Math.min(menu.x, maxX));
    const nextY = Math.max(8, Math.min(menu.y, maxY));
    posRef.current = { x: nextX, y: nextY };
    el.style.left = `${nextX}px`;
    el.style.top = `${nextY}px`;
  }, [menu.x, menu.y, selectedLayerIds.length]);

  const targetIds = selectedSet.has(menu.entry.id)
    ? selectedLayerIds
    : [menu.entry.id];
  const byId = new Map(allEntries.map((e) => [e.id, e]));
  const targetEntries = targetIds
    .map((id) => byId.get(id))
    .filter((e): e is LayerHistoryEntry => Boolean(e));
  const activeEntry = byId.get(menu.entry.id) ?? menu.entry;
  const effectiveTargets = targetEntries.length > 0 ? targetEntries : [activeEntry];
  const isMulti = effectiveTargets.length > 1;
  const allFav = effectiveTargets.every((e) => e.is_favorite);
  const anyExisting = effectiveTargets.some((e) => e.file_exists);

  const playPauseLabel = formatShortcutDisplay(
    shortcuts.playPause ?? DEFAULT_SHORTCUTS.playPause,
    { compact: true }
  );
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

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Layer actions"
      tabIndex={-1}
      onKeyDown={handleContextMenuKeyDown}
      data-context-menu-portal="true"
      data-mica-overlay="true"
      style={{
        top: posRef.current.y,
        left: posRef.current.x,
        zIndex: Z_INDEX.contextMenu,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed w-[248px] bg-surface-2 border border-line-strong rounded-md py-1 text-[11.5px] text-fg font-sans shadow-2xl outline-none select-none"
    >
      <div className="px-2.5 py-1 border-b border-line text-[10px] font-mono text-accent-fg truncate">
        {isMulti
          ? `${effectiveTargets.length} layers selected`
          : activeEntry.layer_name}
      </div>

      {!isMulti && activeEntry.file_exists && (
        <MenuItem
          compactHeight
          tone="accent"
          icon={<Play className="w-3.5 h-3.5 text-accent-fg" />}
          label="Preview Layer"
          rightSlot={
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">
              {playPauseLabel}
            </span>
          }
          onClick={() => {
            onClose();
            onPreviewLayer(activeEntry);
          }}
        />
      )}

      {mode !== "trash" && !isMulti && (
        <MenuItem
          compactHeight
          tone="accent"
          icon={<Layers className="w-3.5 h-3.5 text-accent-fg" />}
          label="Edit in Layers Editor"
          rightSlot={
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">Enter</span>
          }
          onClick={() => {
            onClose();
            onEditInLayers(activeEntry);
          }}
        />
      )}

      {mode !== "trash" && (
        <>
          <div className="my-1 border-t border-line" />
          <MenuItem
            compactHeight
            tone="accent"
            icon={
              <Star
                className={`w-3.5 h-3.5 text-accent-fg ${
                  allFav ? "fill-current" : ""
                }`}
              />
            }
            label={
              isMulti
                ? allFav
                  ? `Remove ${effectiveTargets.length} from Favorites`
                  : `Add ${effectiveTargets.length} to Favorites`
                : activeEntry.is_favorite
                ? "Remove from Favorites"
                : "Add to Favorites"
            }
            rightSlot={
              <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                {favKeyLabel}
              </span>
            }
            onClick={() => {
              const ids = effectiveTargets.map((e) => e.id);
              onClose();
              if (ids.length > 1) onToggleFavoritesBatch(ids, !allFav);
              else onToggleFavorite(activeEntry.id);
            }}
          />

          <MenuItem
            compactHeight
            tone="accent"
            icon={<Copy className="w-3.5 h-3.5 text-accent-fg" />}
            label={isMulti ? "Copy File Paths" : "Copy File Path"}
            rightSlot={
              <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                {copyPathLabel}
              </span>
            }
            onClick={async () => {
              const paths = effectiveTargets.map((e) => e.layer_path);
              onClose();
              const ok = await copyTextToClipboard(paths.join("\n"));
              if (ok) {
                setStatusMessage(
                  paths.length === 1
                    ? "Copied layer file path"
                    : `Copied ${paths.length} layer paths`
                );
              }
            }}
          />

          {activeEntry.file_exists && !isMulti && (
            <MenuItem
              compactHeight
              tone="accent"
              icon={<FolderOpen className="w-3.5 h-3.5 text-accent-fg" />}
              label="Show in Explorer"
              rightSlot={
                <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                  {showInFolderLabel}
                </span>
              }
              onClick={() => {
                const path = activeEntry.layer_path;
                onClose();
                onRevealInExplorer(path);
              }}
            />
          )}
        </>
      )}

      {mode === "trash" ? (
        <>
          <div className="my-1 border-t border-line" />
          <MenuItem
            compactHeight
            tone="accent"
            icon={<ArchiveRestore className="w-3.5 h-3.5 text-accent-fg" />}
            label={
              isMulti
                ? `Restore ${effectiveTargets.length} from Trash`
                : "Restore from Trash"
            }
            onClick={() => {
              onClose();
              onRestoreLayers(effectiveTargets.map((e) => e.id));
            }}
          />
          <MenuItem
            compactHeight
            tone="accent"
            icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
            label={
              isMulti
                ? `Send ${effectiveTargets.length} to Recycle Bin`
                : "Send to Recycle Bin"
            }
            onClick={() => {
              onClose();
              onEmptyLayers(effectiveTargets.map((e) => e.id));
            }}
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
                icon={<Pencil className="w-3.5 h-3.5 text-accent-fg" />}
                label={
                  isMulti
                    ? `Batch Rename (${effectiveTargets.length} Layers)...`
                    : "Rename Layer File..."
                }
                rightSlot={
                  <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                    F2
                  </span>
                }
                onClick={() => {
                  const ids = effectiveTargets
                    .filter((e) => e.file_exists)
                    .map((e) => e.id);
                  onClose();
                  onOpenRenameModal(ids);
                }}
              />
            )}
            <MenuItem
              compactHeight
              tone="accent"
              icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
              label={
                isMulti
                  ? `Move ${effectiveTargets.length} to Trash`
                  : "Move to Trash"
              }
              rightSlot={
                <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                  Del
                </span>
              }
              onClick={() => {
                onClose();
                onTrashLayers(effectiveTargets.map((e) => e.id));
              }}
            />
          </>
        )
      )}
    </div>,
    document.body
  );
};
