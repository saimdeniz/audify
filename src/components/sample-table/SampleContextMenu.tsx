import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  ExternalLink,
  FileCheck2,
  FolderOpen,
  Hash,
  Inbox,
  Layers,
  LayoutGrid,
  Music,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection, SampleItem } from "../../types";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import {
  handleContextMenuKeyDown,
  MenuItem,
  SubmenuTriggerItem,
} from "../common/MenuItem";
import { ContextMenuAiActions } from "./ContextMenuAiActions";
import { ContextMenuCollectionSubmenu } from "./ContextMenuCollectionSubmenu";
import { ContextMenuFileActions } from "./ContextMenuFileActions";
import { ContextMenuLayersSubmenu } from "./ContextMenuLayersSubmenu";
import {
  ContextMenuBpmKeySubmenu,
  ContextMenuGenreSubmenu,
  ContextMenuTagSubmenu,
} from "./ContextMenuMetadataSubmenus";
import { ContextMenuState } from "./tableLayout";

interface SampleContextMenuProps {
  contextMenu: ContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  sampleByIdMap: ReadonlyMap<number, SampleItem>;
  rootCollections: Collection[];
  childrenByParentId: ReadonlyMap<number, Collection[]>;
}

const SUBMENU_WIDTH = 248;
const MAIN_MENU_WIDTH = 248;

export const SampleContextMenu: React.FC<SampleContextMenuProps> = ({
  contextMenu,
  setContextMenu,
  sampleByIdMap,
  rootCollections,
  childrenByParentId,
}) => {
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const isSmartCollectionActive = useSampleStore(
    (s) =>
      s.selectedCollectionId !== null &&
      Boolean(
        s.collections
          .find((c) => c.id === s.selectedCollectionId)
          ?.smart_query?.trim()
      )
  );
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const libraries = useSampleStore((s) => s.libraries);
  const shortcuts = useSampleStore((s) => s.shortcuts);

  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);
  const removeSamplesFromBin = useSampleStore((s) => s.removeSamplesFromBin);
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const copySamplePaths = useSampleStore((s) => s.copySamplePaths);
  const removeSamplesFromCollection = useSampleStore(
    (s) => s.removeSamplesFromCollection
  );
  const toggleFavorite = useSampleStore((s) => s.toggleFavorite);
  const toggleFavoritesBatch = useSampleStore((s) => s.toggleFavoritesBatch);
  const showInFolder = useSampleStore((s) => s.showInFolder);

  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      contextMenuRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Measure main menu height/width and clamp cleanly inside viewport
  useLayoutEffect(() => {
    const el = contextMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const x = Math.max(8, Math.min(contextMenu.x, maxX));
    const y = Math.max(8, Math.min(contextMenu.y, maxY));
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x, y } : prev));
    }
  }, [
    contextMenu.x,
    contextMenu.y,
    contextMenu.targetIds.length,
    setContextMenu,
  ]);

  const activeContextSample =
    sampleByIdMap.get(contextMenu.sample.id) || contextMenu.sample;
  const isMultiContext = contextMenu.targetIds.length > 1;

  const targetSamplesList = useMemo(
    () =>
      contextMenu.targetIds
        .map((id) => sampleByIdMap.get(id))
        .filter((s): s is SampleItem => Boolean(s)),
    [contextMenu.targetIds, sampleByIdMap]
  );

  const allTargetsAreFavorites = useMemo(
    () =>
      targetSamplesList.length > 0 &&
      targetSamplesList.every((s) => s.is_favorite),
    [targetSamplesList]
  );

  // Dynamic horizontal & vertical submenu flip so submenus never overflow viewport edges
  const flipSubmenuLeft =
    typeof window !== "undefined" &&
    contextMenu.x + MAIN_MENU_WIDTH + SUBMENU_WIDTH + 6 >
      window.innerWidth - 8;
  const alignSubmenuBottom =
    typeof window !== "undefined" &&
    contextMenu.y + 300 > window.innerHeight - 8;

  const submenuPositionClass = `${
    flipSubmenuLeft ? "right-full mr-[2px]" : "left-full ml-[2px]"
  } ${alignSubmenuBottom ? "bottom-0" : "top-0"}`;

  const clearSubmenuHover = () =>
    setContextMenu((prev) => (prev ? { ...prev, subMenu: null } : null));

  const setSubmenuHover = (
    subMenu:
      | "collection"
      | "tag"
      | "genre"
      | "bpmKey"
      | "layers"
      | "renameHistory"
  ) => setContextMenu((prev) => (prev ? { ...prev, subMenu } : null));

  const sampleLib = libraries.find(
    (l) => l.id === activeContextSample.library_id
  );
  const isVaultLocked = Boolean(sampleLib?.is_read_only);
  const copyPathShortcutLabel = formatShortcutDisplay(
    shortcuts.copyFilePath ?? DEFAULT_SHORTCUTS.copyFilePath,
    { compact: true }
  );
  const showInFolderShortcutLabel = formatShortcutDisplay(
    shortcuts.showInFolder ?? DEFAULT_SHORTCUTS.showInFolder,
    { compact: true }
  );
  const openTagShortcutLabel = formatShortcutDisplay(
    shortcuts.openTagPicker ?? DEFAULT_SHORTCUTS.openTagPicker ?? "",
    { compact: true }
  );
  const openGenreShortcutLabel = formatShortcutDisplay(
    shortcuts.openGenrePicker ?? DEFAULT_SHORTCUTS.openGenrePicker ?? "",
    { compact: true }
  );

  const menuContent = (
    <div
      ref={contextMenuRef}
      role="menu"
      aria-label="Sample actions"
      tabIndex={-1}
      onKeyDown={handleContextMenuKeyDown}
      data-context-menu-portal="true"
      style={{
        top: contextMenu.y,
        left: contextMenu.x,
        zIndex: Z_INDEX.contextMenu,
      }}
      onClick={(e) => e.stopPropagation()}
      className="fixed w-[248px] bg-surface-2 border border-line-strong rounded-md py-1 text-[11.5px] text-fg font-sans shadow-2xl outline-none"
    >
      <div className="px-2.5 py-1 border-b border-line text-[10px] font-mono text-accent-fg truncate">
        {isMultiContext
          ? `${contextMenu.targetIds.length} samples selected`
          : activeContextSample.file_name}
      </div>

      {/* Add to / Remove from Session Bin */}
      <MenuItem
        compactHeight
        tone="accent"
        onMouseEnter={clearSubmenuHover}
        onClick={() => {
          const ids = contextMenu.targetIds;
          setContextMenu(null);
          if (binFilterActive) {
            removeSamplesFromBin(ids);
          } else {
            addSamplesToBin(ids);
          }
        }}
        icon={<Inbox className="w-3.5 h-3.5 text-accent-fg" />}
        label={
          binFilterActive
            ? isMultiContext
              ? `Remove ${contextMenu.targetIds.length} from Bin`
              : "Remove from Bin"
            : isMultiContext
            ? `Add ${contextMenu.targetIds.length} to Bin`
            : "Add to Bin"
        }
        rightSlot={
          <span className="font-mono text-[9.5px] text-fg-3 ml-1">
            {binFilterActive
              ? "Del"
              : formatShortcutDisplay(shortcuts.addToBin, { compact: true })}
          </span>
        }
      />

      {/* Layers multi-track SFX studio hover submenu */}
      {!trashFilterActive && (
        <SubmenuTriggerItem
          isOpen={contextMenu.subMenu === "layers"}
          onOpen={() => setSubmenuHover("layers")}
          icon={<Layers className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
          label={
            isMultiContext
              ? `Layers (${contextMenu.targetIds.length})`
              : "Layers"
          }
        >
          <ContextMenuLayersSubmenu
            submenuPositionClass={submenuPositionClass}
            targetSamples={
              isMultiContext ? targetSamplesList : [activeContextSample]
            }
            setContextMenu={setContextMenu}
          />
        </SubmenuTriggerItem>
      )}

      {/* Copy Credits (only when Licenses System is enabled) */}
      {enableLicensesSystem && (
        <>
          <MenuItem
            compactHeight
            tone="accent"
            onMouseEnter={clearSubmenuHover}
            onClick={() => {
              const list = isMultiContext
                ? targetSamplesList
                : [activeContextSample];
              setContextMenu(null);
              copyAttributionForSamples(list);
            }}
            icon={<FileCheck2 className="w-3.5 h-3.5 text-accent-fg" />}
            label={
              <span className="font-medium">
                {isMultiContext
                  ? `Copy Credits (${contextMenu.targetIds.length})`
                  : "Copy Credits"}
              </span>
            }
            rightSlot={
              <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                Ctrl+Shift+C
              </span>
            }
          />
          <div className="my-1 border-t border-line" />
        </>
      )}

      {/* 1. Add to Collection */}
      <SubmenuTriggerItem
        isOpen={contextMenu.subMenu === "collection"}
        onOpen={() => setSubmenuHover("collection")}
        icon={<LayoutGrid className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label={
          isMultiContext
            ? `Add ${contextMenu.targetIds.length} to Collection`
            : "Add to Collection"
        }
      >
        <ContextMenuCollectionSubmenu
          submenuPositionClass={submenuPositionClass}
          targetIds={contextMenu.targetIds}
          isMultiContext={isMultiContext}
          activeContextSample={activeContextSample}
          targetSamplesList={targetSamplesList}
          rootCollections={rootCollections}
          childrenByParentId={childrenByParentId}
          setContextMenu={setContextMenu}
        />
      </SubmenuTriggerItem>

      {/* 2. Assign Tag */}
      <SubmenuTriggerItem
        isOpen={contextMenu.subMenu === "tag"}
        onOpen={() => setSubmenuHover("tag")}
        icon={<Hash className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label={
          isMultiContext
            ? `Assign Tag (${contextMenu.targetIds.length})`
            : "Assign Tag"
        }
        rightSlot={
          openTagShortcutLabel ? (
            <span className="font-mono text-[9.5px] text-fg-3">
              {openTagShortcutLabel}
            </span>
          ) : undefined
        }
      >
        <ContextMenuTagSubmenu
          submenuPositionClass={submenuPositionClass}
          targetIds={contextMenu.targetIds}
          isMultiContext={isMultiContext}
          activeContextSample={activeContextSample}
          targetSamplesList={targetSamplesList}
          setContextMenu={setContextMenu}
        />
      </SubmenuTriggerItem>

      {/* 2b. Assign Genre */}
      <SubmenuTriggerItem
        isOpen={contextMenu.subMenu === "genre"}
        onOpen={() => setSubmenuHover("genre")}
        icon={<Music className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label={
          isMultiContext
            ? `Assign Genre (${contextMenu.targetIds.length})`
            : "Assign Genre"
        }
        rightSlot={
          openGenreShortcutLabel ? (
            <span className="font-mono text-[9.5px] text-fg-3">
              {openGenreShortcutLabel}
            </span>
          ) : undefined
        }
      >
        <ContextMenuGenreSubmenu
          submenuPositionClass={submenuPositionClass}
          targetIds={contextMenu.targetIds}
          isMultiContext={isMultiContext}
          activeContextSample={activeContextSample}
          targetSamplesList={targetSamplesList}
          setContextMenu={setContextMenu}
        />
      </SubmenuTriggerItem>

      {/* 2c. Set BPM / Musical Key */}
      <SubmenuTriggerItem
        isOpen={contextMenu.subMenu === "bpmKey"}
        onOpen={() => setSubmenuHover("bpmKey")}
        icon={<SlidersHorizontal className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label={
          isMultiContext
            ? `Set BPM / Key (${contextMenu.targetIds.length})`
            : "Set BPM / Key"
        }
      >
        <ContextMenuBpmKeySubmenu
          submenuPositionClass={submenuPositionClass}
          targetIds={contextMenu.targetIds}
          isMultiContext={isMultiContext}
          activeContextSample={activeContextSample}
          setContextMenu={setContextMenu}
        />
      </SubmenuTriggerItem>

      {/* 3. Remove from Collection */}
      {selectedCollectionId !== null && !isSmartCollectionActive && (
        <MenuItem
          compactHeight
          tone="accent"
          onMouseEnter={clearSubmenuHover}
          onClick={async () => {
            const ids = contextMenu.targetIds;
            setContextMenu(null);
            await removeSamplesFromCollection(selectedCollectionId, ids);
          }}
          icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
          label={
            isMultiContext
              ? `Remove ${contextMenu.targetIds.length} from Collection`
              : "Remove from Collection"
          }
          rightSlot={
            <span className="font-mono text-[9.5px] ml-1">
              {formatShortcutDisplay(shortcuts.removeFromCollection, {
                compact: true,
              })}
            </span>
          }
        />
      )}

      <div className="my-1 border-t border-line" />

      {/* 4. Toggle Favorite (F) */}
      <MenuItem
        compactHeight
        tone="accent"
        onMouseEnter={clearSubmenuHover}
        onClick={async () => {
          if (isMultiContext) {
            await toggleFavoritesBatch(
              contextMenu.targetIds,
              !allTargetsAreFavorites
            );
          } else {
            await toggleFavorite(activeContextSample.id);
          }
          setContextMenu(null);
        }}
        icon={
          <Star
            className={`w-3.5 h-3.5 text-accent-fg ${
              (!isMultiContext && activeContextSample.is_favorite) ||
              (isMultiContext && allTargetsAreFavorites)
                ? "fill-current"
                : ""
            }`}
          />
        }
        label={
          isMultiContext
            ? allTargetsAreFavorites
              ? "Unfavorite Selected"
              : "Favorite Selected"
            : activeContextSample.is_favorite
            ? "Remove from Favorites"
            : "Add to Favorites"
        }
        rightSlot={
          <span className="font-mono text-[9.5px] text-fg-3 ml-1">
            {formatShortcutDisplay(shortcuts.toggleFavorite, { compact: true })}
          </span>
        }
      />

      {/* 5. Copy File Path & Show in Explorer */}
      <MenuItem
        compactHeight
        tone="accent"
        onMouseEnter={clearSubmenuHover}
        onClick={async () => {
          const list = isMultiContext
            ? targetSamplesList
            : [activeContextSample];
          setContextMenu(null);
          await copySamplePaths(list);
        }}
        icon={<Copy className="w-3.5 h-3.5 text-accent-fg" />}
        label={
          isMultiContext
            ? `Copy File Paths (${contextMenu.targetIds.length})`
            : "Copy File Path"
        }
        rightSlot={
          copyPathShortcutLabel ? (
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">
              {copyPathShortcutLabel}
            </span>
          ) : undefined
        }
      />

      <MenuItem
        compactHeight
        tone="accent"
        onMouseEnter={clearSubmenuHover}
        onClick={async () => {
          const path = activeContextSample.file_path;
          setContextMenu(null);
          await showInFolder(path);
        }}
        icon={<FolderOpen className="w-3.5 h-3.5 text-accent-fg" />}
        label="Show in Explorer"
        rightSlot={
          showInFolderShortcutLabel ? (
            <span className="font-mono text-[9.5px] text-fg-3 ml-1">
              {showInFolderShortcutLabel}
            </span>
          ) : (
            <ExternalLink className="w-3 h-3 text-fg-3" />
          )
        }
      />

      {/* 5b. Local AI Audio Intelligence & Similarity Search */}
      {!trashFilterActive && (
        <ContextMenuAiActions
          targetIds={contextMenu.targetIds}
          isMultiContext={isMultiContext}
          activeContextSample={activeContextSample}
          clearSubmenuHover={clearSubmenuHover}
          setContextMenu={setContextMenu}
        />
      )}

      {/* 6. Physical File Rename, Rename History & 2-Stage Trash (hidden in Safe Read-Only mode unless in Trash) */}
      {(trashFilterActive || enableAdvancedFileOps) && (
        <ContextMenuFileActions
          targetIds={contextMenu.targetIds}
          isMultiContext={isMultiContext}
          activeContextSample={activeContextSample}
          trashFilterActive={trashFilterActive}
          isVaultLocked={isVaultLocked}
          vaultName={sampleLib?.name}
          selectedCollectionId={selectedCollectionId}
          activeSubMenu={contextMenu.subMenu}
          submenuPositionClass={submenuPositionClass}
          setSubmenuHover={setSubmenuHover}
          clearSubmenuHover={clearSubmenuHover}
          setContextMenu={setContextMenu}
        />
      )}
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(menuContent, document.body)
    : null;
};
