import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Edit3,
  ExternalLink,
  FolderPlus,
  Lock,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { handleContextMenuKeyDown, MenuItem } from "../common/MenuItem";

export interface FolderExplorerTarget {
  label: string;
  path: string;
}

export interface SidebarFolderContextMenuState {
  x: number;
  y: number;
  title: string;
  explorerTargets: FolderExplorerTarget[];
  primaryCopyPath?: string;
  onSyncFolder?: () => void;
  onOpenSettings?: () => void;
  settingsLabel?: string;
  isReadOnlyVault?: boolean;
  onCreateSubfolder?: () => void;
  onImportAudioFiles?: () => void;
  onRenameSubfolder?: () => void;
  onTrashSubfolder?: () => void;
}

interface SidebarFolderContextMenuProps {
  menu: SidebarFolderContextMenuState | null;
  onClose: () => void;
  onShowInFolder: (path: string) => void;
  onCopyPath: (path: string) => void;
}

export const SidebarFolderContextMenu: React.FC<
  SidebarFolderContextMenuProps
> = ({ menu, onClose, onShowInFolder, onCopyPath }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: menu?.x ?? 0,
    top: menu?.y ?? 0,
  });

  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    const width = el?.offsetWidth || 216;
    const height = el?.offsetHeight || 140;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, menu.x)
    );
    const top = Math.max(
      8,
      Math.min(window.innerHeight - height - 8, menu.y)
    );
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const handleDismiss = () => onClose();

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("blur", handleDismiss);
    const focusRaf = requestAnimationFrame(() => {
      menuRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focusRaf);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("blur", handleDismiss);
    };
  }, [menu, onClose]);

  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menu.title || "Folder actions"}
      tabIndex={-1}
      onKeyDown={handleContextMenuKeyDown}
      data-context-menu-portal="true"
      data-mica-overlay="true"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        zIndex: Z_INDEX.floatingMenu,
      }}
      className="fixed w-[224px] rounded-md bg-surface-2 border border-line-strong shadow-2xl py-1 text-[11.5px] text-fg select-none outline-none"
    >
      <div className="px-2.5 py-1 border-b border-line text-[10px] font-mono text-accent-fg truncate">
        {menu.title}
      </div>

      {menu.explorerTargets.map((target) => (
        <MenuItem
          key={target.path}
          compactHeight
          tone="accent"
          icon={<ExternalLink className="w-3.5 h-3.5 text-accent-fg" />}
          label={target.label}
          title={target.path}
          onClick={() => {
            onShowInFolder(target.path);
            onClose();
          }}
        />
      ))}

      {menu.primaryCopyPath && (
        <MenuItem
          compactHeight
          tone="accent"
          icon={<Copy className="w-3.5 h-3.5 text-accent-fg" />}
          label="Copy Folder Path"
          title={menu.primaryCopyPath}
          onClick={() => {
            onCopyPath(menu.primaryCopyPath!);
            onClose();
          }}
        />
      )}

      {menu.onSyncFolder && (
        <MenuItem
          compactHeight
          tone="accent"
          icon={<RefreshCw className="w-3.5 h-3.5 text-accent-fg" />}
          label="Sync Folder Changes"
          onClick={() => {
            menu.onSyncFolder?.();
            onClose();
          }}
        />
      )}

      {(menu.onCreateSubfolder ||
        menu.onImportAudioFiles ||
        menu.onRenameSubfolder ||
        menu.onTrashSubfolder) && (
        <>
          <div className="my-1 border-t border-line" />
          {menu.onCreateSubfolder && (
            <MenuItem
              compactHeight
              tone="accent"
              disabled={menu.isReadOnlyVault}
              icon={<FolderPlus className="w-3.5 h-3.5 text-accent-fg" />}
              label="New Subfolder"
              rightSlot={
                menu.isReadOnlyVault && <Lock className="w-3 h-3 text-warn" />
              }
              title={
                menu.isReadOnlyVault
                  ? "Library is locked as a Protected Vault in Settings > Advanced"
                  : "Create a new physical subfolder on disk"
              }
              onClick={() => {
                menu.onCreateSubfolder?.();
                onClose();
              }}
            />
          )}

          {menu.onImportAudioFiles && (
            <MenuItem
              compactHeight
              tone="accent"
              disabled={menu.isReadOnlyVault}
              icon={<Upload className="w-3.5 h-3.5 text-accent-fg" />}
              label="Import Audio Files..."
              rightSlot={
                menu.isReadOnlyVault && <Lock className="w-3 h-3 text-warn" />
              }
              title={
                menu.isReadOnlyVault
                  ? "Library is locked as a Protected Vault in Settings > Advanced"
                  : "Import audio files from disk into this folder"
              }
              onClick={() => {
                menu.onImportAudioFiles?.();
                onClose();
              }}
            />
          )}

          {menu.onRenameSubfolder && (
            <MenuItem
              compactHeight
              tone="accent"
              disabled={menu.isReadOnlyVault}
              icon={<Edit3 className="w-3.5 h-3.5 text-accent-fg" />}
              label="Rename Folder"
              rightSlot={
                menu.isReadOnlyVault ? (
                  <Lock className="w-3 h-3 text-warn" />
                ) : (
                  <span className="font-mono text-[9.5px] text-fg-3">F2</span>
                )
              }
              title={
                menu.isReadOnlyVault
                  ? "Library is locked as a Protected Vault in Settings > Advanced"
                  : "Rename physical subfolder on disk (F2)"
              }
              onClick={() => {
                menu.onRenameSubfolder?.();
                onClose();
              }}
            />
          )}

          {menu.onTrashSubfolder && (
            <MenuItem
              compactHeight
              tone="accent"
              disabled={menu.isReadOnlyVault}
              icon={<Trash2 className="w-3.5 h-3.5 text-accent-fg" />}
              label="Move Folder to Trash"
              rightSlot={
                menu.isReadOnlyVault && <Lock className="w-3 h-3 text-warn" />
              }
              title={
                menu.isReadOnlyVault
                  ? "Library is locked as a Protected Vault in Settings > Advanced"
                  : "Move folder audio files to Trash & remove empty subfolder"
              }
              onClick={() => {
                menu.onTrashSubfolder?.();
                onClose();
              }}
            />
          )}
        </>
      )}

      {menu.onOpenSettings && (
        <>
          <div className="my-1 border-t border-line" />
          <MenuItem
            compactHeight
            tone="accent"
            icon={<Settings className="w-3.5 h-3.5 text-accent-fg" />}
            label={menu.settingsLabel || "Manage in Settings"}
            onClick={() => {
              menu.onOpenSettings?.();
              onClose();
            }}
          />
        </>
      )}
    </div>,
    document.body
  );
};
