import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  Copy,
  ExternalLink,
  FileCheck2,
  FolderOpen,
  Hash,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  Music,
  Pencil,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import {
  handleContextMenuKeyDown,
  MenuItem,
  SubmenuTriggerItem,
} from "../common/MenuItem";
import {
  fetchSampleRenameHistory,
  SampleRenameHistoryItem,
} from "../common/RenameHistoryList";
import {
  MiniDockContextSubmenu,
  MiniDockSubmenuAnchor,
  MiniDockSubmenuKind,
} from "./MiniDockContextSubmenu";

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
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const shortcuts = useSampleStore((s) => s.shortcuts);
  const collections = useSampleStore((s) => s.collections);
  const samples = useSampleStore((s) => s.samples);
  const tags = useSampleStore((s) => s.tags);
  const genres = useSampleStore((s) => s.genres);

  const toggleFavorite = useSampleStore((s) => s.toggleFavorite);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const removeSamplesFromBin = useSampleStore((s) => s.removeSamplesFromBin);
  const sendSamplesToLayers = useSampleStore((s) => s.sendSamplesToLayers);
  const findSimilarSamples = useSampleStore((s) => s.findSimilarSamples);
  const addSamplesToCollectionBatch = useSampleStore(
    (s) => s.addSamplesToCollectionBatch
  );
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const copySamplePaths = useSampleStore((s) => s.copySamplePaths);
  const showInFolder = useSampleStore((s) => s.showInFolder);
  const openBatchRenameModal = useSampleStore((s) => s.openBatchRenameModal);
  const requestMoveSamplesToTrash = useSampleStore(
    (s) => s.requestMoveSamplesToTrash
  );
  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeSubTimerRef = useRef<number | null>(null);
  const [subAnchor, setSubAnchor] = useState<MiniDockSubmenuAnchor | null>(
    null
  );
  const [renameHistoryItems, setRenameHistoryItems] = useState<
    SampleRenameHistoryItem[]
  >(() =>
    menu.sample.previous_file_name
      ? [{ name: menu.sample.previous_file_name, created_at: "" }]
      : []
  );
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: menu.x,
    y: menu.y,
  });

  useEffect(() => {
    if (trashFilterActive || selectedSampleIds.length > 1 || menu.sample.id <= 0) {
      return;
    }
    let alive = true;
    void fetchSampleRenameHistory(menu.sample.id, 10).then((rows) => {
      if (!alive) return;
      if (rows.length > 0) setRenameHistoryItems(rows);
      else if (menu.sample.previous_file_name) {
        setRenameHistoryItems([
          { name: menu.sample.previous_file_name, created_at: "" },
        ]);
      } else {
        setRenameHistoryItems([]);
      }
    });
    return () => {
      alive = false;
    };
  }, [menu.sample.id, menu.sample.previous_file_name, trashFilterActive, selectedSampleIds.length]);

  const cancelSubClose = () => {
    if (closeSubTimerRef.current !== null) {
      window.clearTimeout(closeSubTimerRef.current);
      closeSubTimerRef.current = null;
    }
  };

  const scheduleSubClose = () => {
    cancelSubClose();
    closeSubTimerRef.current = window.setTimeout(() => {
      setSubAnchor(null);
      closeSubTimerRef.current = null;
    }, 140);
  };

  useEffect(() => () => cancelSubClose(), []);

  useEffect(() => {
    menuRef.current?.focus();
    setSubAnchor(null);
  }, [menu.sample.id, menu.x, menu.y]);

  const manualCollections = collections.filter((c) => !c.smart_query?.trim());

  useLayoutEffect(() => {
    const el = menuRef.current;
    const margin = 6;
    const menuWidth = Math.min(
      el?.offsetWidth || 216,
      Math.max(140, window.innerWidth - margin * 2)
    );
    const menuHeight = el?.offsetHeight || 220;
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
        if (subAnchor) {
          setSubAnchor(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, subAnchor]);

  const openSubmenu = (
    kind: MiniDockSubmenuKind,
    triggerEl: HTMLElement | null
  ) => {
    cancelSubClose();
    const menuEl = menuRef.current;
    if (!menuEl || !triggerEl) return;
    const mRect = menuEl.getBoundingClientRect();
    const rRect = triggerEl.getBoundingClientRect();
    setSubAnchor({
      kind,
      menuRect: {
        left: mRect.left,
        right: mRect.right,
        top: mRect.top,
        bottom: mRect.bottom,
      },
      rowTop: rRect.top,
    });
  };

  const clearSubmenuNow = () => {
    cancelSubClose();
    setSubAnchor(null);
  };

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

  const handleAddToLayer = (mode: "current" | "new") => {
    const targetSet = new Set(targetIds);
    const list =
      targetIds.length > 1
        ? samples.filter((s) => targetSet.has(s.id))
        : [menu.sample];
    onClose();
    void sendSamplesToLayers(list.length > 0 ? list : [menu.sample], mode);
  };

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          tabIndex={-1}
          role="menu"
          aria-label="Sample actions"
          data-context-menu-portal="true"
          data-mica-overlay="true"
          style={{ top: pos.y, left: pos.x, zIndex: Z_INDEX.floatingMenu }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleContextMenuKeyDown}
          className="fixed w-[216px] max-w-[calc(100vw-12px)] max-h-[82vh] overflow-y-auto bg-surface-2 border border-line-strong rounded-md py-1 text-[11px] text-fg shadow-2xl"
        >
          {!trashFilterActive && menu.sample.id > 0 && (
            <MenuItem
              tone="accent"
              compactHeight
              icon={<Sparkles className="w-3.5 h-3.5 text-accent-fg" />}
              label="Find Similar Audio (AI)"
              onMouseEnter={clearSubmenuNow}
              onClick={() => {
                const sample = menu.sample;
                onClose();
                void findSimilarSamples(sample);
              }}
            />
          )}

          {!trashFilterActive && menu.sample.id > 0 && (
            <div
              onClick={(e) => openSubmenu("layers", e.currentTarget)}
              onMouseEnter={(e) => openSubmenu("layers", e.currentTarget)}
              onMouseLeave={scheduleSubClose}
            >
              <SubmenuTriggerItem
                isOpen={subAnchor?.kind === "layers"}
                onOpen={() => {}}
                icon={<Layers className="w-3.5 h-3.5 text-accent-fg" />}
                label={
                  targetIds.length > 1
                    ? `Layers (${targetIds.length})`
                    : "Layers"
                }
              />
            </div>
          )}

          <MenuItem
            tone="accent"
            compactHeight
            icon={<Inbox className="w-3.5 h-3.5 text-accent-fg" />}
            label={
              binFilterActive
                ? "Remove from Session Bin"
                : "Add to Session Bin"
            }
            onMouseEnter={clearSubmenuNow}
            onClick={() => {
              if (binFilterActive) {
                removeSamplesFromBin(targetIds);
              } else {
                addSamplesToBin(targetIds);
              }
              onClose();
            }}
          />

          {!trashFilterActive && manualCollections.length > 0 && (
            <div
              onClick={(e) => openSubmenu("collection", e.currentTarget)}
              onMouseEnter={(e) => openSubmenu("collection", e.currentTarget)}
              onMouseLeave={scheduleSubClose}
            >
              <SubmenuTriggerItem
                isOpen={subAnchor?.kind === "collection"}
                onOpen={() => {}}
                icon={<LayoutGrid className="w-3.5 h-3.5 text-accent-fg" />}
                label="Add to Collection"
              />
            </div>
          )}

          {!trashFilterActive && tags.length > 0 && (
            <div
              onClick={(e) => openSubmenu("tag", e.currentTarget)}
              onMouseEnter={(e) => openSubmenu("tag", e.currentTarget)}
              onMouseLeave={scheduleSubClose}
            >
              <SubmenuTriggerItem
                isOpen={subAnchor?.kind === "tag"}
                onOpen={() => {}}
                icon={<Hash className="w-3.5 h-3.5 text-accent-fg" />}
                label="Assign Tag"
              />
            </div>
          )}

          {!trashFilterActive && genres.length > 0 && (
            <div
              onClick={(e) => openSubmenu("genre", e.currentTarget)}
              onMouseEnter={(e) => openSubmenu("genre", e.currentTarget)}
              onMouseLeave={scheduleSubClose}
            >
              <SubmenuTriggerItem
                isOpen={subAnchor?.kind === "genre"}
                onOpen={() => {}}
                icon={<Music className="w-3.5 h-3.5 text-accent-fg" />}
                label="Genres & Moods"
              />
            </div>
          )}

          {enableLicensesSystem && (
            <MenuItem
              tone="accent"
              compactHeight
              icon={<FileCheck2 className="w-3.5 h-3.5 text-accent-fg" />}
              label="Copy Credits"
              onMouseEnter={clearSubmenuNow}
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
            onMouseEnter={clearSubmenuNow}
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
            onMouseEnter={clearSubmenuNow}
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
            onMouseEnter={clearSubmenuNow}
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
                onMouseEnter={clearSubmenuNow}
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
                onMouseEnter={clearSubmenuNow}
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
                  onMouseEnter={clearSubmenuNow}
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
                  rightSlot={
                    <span className="font-mono text-[9.5px] text-fg-3">F2</span>
                  }
                  onMouseEnter={clearSubmenuNow}
                  onClick={() => {
                    const id = menu.sample.id;
                    onClose();
                    openBatchRenameModal([id]);
                  }}
                />
              )}
              {targetIds.length === 1 && renameHistoryItems.length > 0 && (
                <div
                  onClick={(e) => openSubmenu("renameHistory", e.currentTarget)}
                  onMouseEnter={(e) =>
                    openSubmenu("renameHistory", e.currentTarget)
                  }
                  onMouseLeave={scheduleSubClose}
                >
                  <SubmenuTriggerItem
                    isOpen={subAnchor?.kind === "renameHistory"}
                    onOpen={() => {}}
                    icon={<History className="w-3.5 h-3.5 text-accent-fg" />}
                    label="Rename History"
                    rightSlot={
                      <span className="font-mono text-[9.5px] text-fg-3">
                        {renameHistoryItems.length}
                      </span>
                    }
                  />
                </div>
              )}
              <MenuItem
                tone="accent"
                compactHeight
                icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
                label="Move to Trash"
                rightSlot={
                  <span className="font-mono text-[9.5px] text-fg-3">Del</span>
                }
                onMouseEnter={clearSubmenuNow}
                onClick={() => {
                  onClose();
                  void requestMoveSamplesToTrash(targetIds);
                }}
              />
            </>
          ) : null}
        </div>,
        document.body
      )}

      {subAnchor && (
        <MiniDockContextSubmenu
          anchor={subAnchor}
          sample={menu.sample}
          targetIds={targetIds}
          samples={samples}
          manualCollections={manualCollections}
          renameHistoryItems={renameHistoryItems}
          onCloseAll={onClose}
          onMouseEnter={cancelSubClose}
          onMouseLeave={scheduleSubClose}
          onAddToLayer={handleAddToLayer}
          onAddToCollection={(colId) => {
            void addSamplesToCollectionBatch(colId, targetIds);
            onClose();
          }}
        />
      )}
    </>
  );
};
