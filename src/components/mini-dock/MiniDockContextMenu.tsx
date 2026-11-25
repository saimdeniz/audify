import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCheck2,
  FolderOpen,
  Hash,
  Inbox,
  LayoutGrid,
  Music,
  Pencil,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { handleContextMenuKeyDown, MenuItem } from "../common/MenuItem";
import { TaxonomyPicker } from "../taxonomy/TaxonomyPicker";

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
  const undoRenameSampleFile = useSampleStore((s) => s.undoRenameSampleFile);
  const requestMoveSamplesToTrash = useSampleStore(
    (s) => s.requestMoveSamplesToTrash
  );
  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [expandedSub, setExpandedSub] = useState<
    "collection" | "tag" | "genre" | null
  >(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: menu.x,
    y: menu.y,
  });

  useEffect(() => {
    menuRef.current?.focus();
  }, [menu.sample.id, menu.x, menu.y]);

  const manualCollections = collections.filter((c) => !c.smart_query?.trim());

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
      tabIndex={-1}
      role="menu"
      aria-label="Sample actions"
      data-context-menu-portal="true"
      data-mica-overlay="true"
      style={{ top: pos.y, left: pos.x, zIndex: Z_INDEX.floatingMenu }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleContextMenuKeyDown}
      className="fixed w-[216px] max-h-[82vh] overflow-y-auto bg-surface-2 border border-line-strong rounded-md py-1 text-[11px] text-fg shadow-2xl focus:outline-none"
    >
      {!trashFilterActive && menu.sample.id > 0 && (
        <MenuItem
          tone="accent"
          compactHeight
          icon={<Sparkles className="w-3.5 h-3.5 text-accent-fg" />}
          label="Find Similar Audio (AI)"
          onClick={() => {
            const sample = menu.sample;
            onClose();
            void findSimilarSamples(sample);
          }}
        />
      )}

      <MenuItem
        tone="accent"
        compactHeight
        icon={<Inbox className="w-3.5 h-3.5 text-accent-fg" />}
        label={
          binFilterActive ? "Remove from Session Bin" : "Add to Session Bin"
        }
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
        <div>
          <MenuItem
            tone="accent"
            compactHeight
            icon={<LayoutGrid className="w-3.5 h-3.5 text-accent-fg" />}
            label="Add to Collection"
            rightSlot={
              <ChevronRight
                className={`w-3 h-3 text-fg-3 transition-transform ${
                  expandedSub === "collection" ? "rotate-90" : ""
                }`}
              />
            }
            onClick={() =>
              setExpandedSub((prev) =>
                prev === "collection" ? null : "collection"
              )
            }
          />
          {expandedSub === "collection" && (
            <div className="mx-1.5 my-0.5 py-0.5 rounded-xs bg-surface-1 border border-line max-h-[120px] overflow-y-auto">
              {manualCollections.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => {
                    void addSamplesToCollectionBatch(col.id, targetIds);
                    onClose();
                  }}
                  className="w-full h-[22px] px-2 flex items-center gap-1.5 text-left text-[10.5px] text-fg-2 hover:text-fg hover:bg-accent-soft transition-colors truncate"
                >
                  <span
                    className="w-2 h-2 rounded-[2px] shrink-0"
                    style={{ backgroundColor: col.color || "var(--signal-accent)" }}
                  />
                  <span className="truncate">{col.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!trashFilterActive && tags.length > 0 && (
        <div>
          <MenuItem
            tone="accent"
            compactHeight
            icon={<Hash className="w-3.5 h-3.5 text-accent-fg" />}
            label="Assign Tag"
            rightSlot={
              <ChevronRight
                className={`w-3 h-3 text-fg-3 transition-transform ${
                  expandedSub === "tag" ? "rotate-90" : ""
                }`}
              />
            }
            onClick={() =>
              setExpandedSub((prev) => (prev === "tag" ? null : "tag"))
            }
          />
          {expandedSub === "tag" && (
            <div className="mx-1.5 my-1 p-1.5 rounded-xs bg-surface-1 border border-line">
              <TaxonomyPicker
                mode="tags"
                compact
                allowCreate={false}
                sampleIds={targetIds}
                samples={
                  targetIds.length > 1
                    ? samples.filter((s) => targetIds.includes(s.id))
                    : [samples.find((s) => s.id === menu.sample.id) ?? menu.sample]
                }
              />
            </div>
          )}
        </div>
      )}

      {!trashFilterActive && genres.length > 0 && (
        <div>
          <MenuItem
            tone="accent"
            compactHeight
            icon={<Music className="w-3.5 h-3.5 text-accent-fg" />}
            label="Genres & Moods"
            rightSlot={
              <ChevronRight
                className={`w-3 h-3 text-fg-3 transition-transform ${
                  expandedSub === "genre" ? "rotate-90" : ""
                }`}
              />
            }
            onClick={() =>
              setExpandedSub((prev) => (prev === "genre" ? null : "genre"))
            }
          />
          {expandedSub === "genre" && (
            <div className="mx-1.5 my-1 p-1.5 rounded-xs bg-surface-1 border border-line">
              <TaxonomyPicker
                mode="genres"
                compact
                allowCreate={false}
                sampleIds={targetIds}
                samples={
                  targetIds.length > 1
                    ? samples.filter((s) => targetIds.includes(s.id))
                    : [samples.find((s) => s.id === menu.sample.id) ?? menu.sample]
                }
              />
            </div>
          )}
        </div>
      )}

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
