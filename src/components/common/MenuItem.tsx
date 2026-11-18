import React from "react";
import { ChevronRight } from "lucide-react";

export interface MenuItemProps {
  icon?: React.ReactNode;
  label: React.ReactNode;
  rightSlot?: React.ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger" | "ok";
  compactHeight?: boolean;
  title?: string;
  className?: string;
}

/**
 * Handles ArrowDown / ArrowUp / Home / End keyboard navigation across `[role="menuitem"]`
 * items inside an open context menu container.
 */
export function handleContextMenuKeyDown(
  e: React.KeyboardEvent<HTMLElement>
): void {
  if (
    e.key !== "ArrowDown" &&
    e.key !== "ArrowUp" &&
    e.key !== "Home" &&
    e.key !== "End"
  ) {
    return;
  }
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'
    )
  );
  if (items.length === 0) return;

  e.preventDefault();
  e.stopPropagation();

  const currentIdx = items.indexOf(document.activeElement as HTMLElement);
  let nextIdx = 0;
  if (e.key === "ArrowDown") {
    nextIdx = currentIdx >= 0 ? (currentIdx + 1) % items.length : 0;
  } else if (e.key === "ArrowUp") {
    nextIdx =
      currentIdx >= 0
        ? (currentIdx - 1 + items.length) % items.length
        : items.length - 1;
  } else if (e.key === "Home") {
    nextIdx = 0;
  } else if (e.key === "End") {
    nextIdx = items.length - 1;
  }
  items[nextIdx]?.focus();
}

/**
 * Shared menu button primitive for portal/context menus (SampleContextMenu,
 * SidebarFolderContextMenu). Preserves semantic focus/hover tokens across all themes.
 */
export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  rightSlot,
  onClick,
  onMouseEnter,
  disabled = false,
  tone = "default",
  compactHeight = false,
  title,
  className = "",
}) => {
  const toneClasses =
    tone === "danger"
      ? "text-fg-2 hover:bg-danger/20 hover:text-danger focus-visible:bg-danger/20 focus-visible:text-danger"
      : tone === "ok"
      ? "text-ok hover:bg-ok/20 focus-visible:bg-ok/20"
      : tone === "accent"
      ? "text-fg hover:bg-accent-soft hover:text-accent-fg focus-visible:bg-accent-soft focus-visible:text-accent-fg"
      : "text-fg hover:bg-surface-hover focus-visible:bg-surface-hover";

  const heightClasses = compactHeight ? "h-[27px] px-2.5" : "px-2.5 py-1.5";

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={title}
      className={`w-full ${heightClasses} flex items-center justify-between gap-2 text-left outline-none disabled:opacity-45 transition-colors ${toneClasses} ${className}`}
    >
      <span className="flex items-center gap-2 min-w-0 truncate">
        {icon && <span className="shrink-0 flex items-center">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {rightSlot && (
        <span className="shrink-0 flex items-center">{rightSlot}</span>
      )}
    </button>
  );
};

export interface SubmenuTriggerItemProps {
  isOpen: boolean;
  onOpen: () => void;
  icon: React.ReactNode;
  label: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared context-menu trigger row that expands a nested submenu on hover or
 * ArrowRight/Enter/Space while participating in ArrowUp/ArrowDown navigation.
 */
export const SubmenuTriggerItem: React.FC<SubmenuTriggerItemProps> = ({
  isOpen,
  onOpen,
  icon,
  label,
  children,
}) => (
  <div
    role="menuitem"
    tabIndex={-1}
    aria-haspopup="menu"
    aria-expanded={isOpen}
    onMouseEnter={onOpen}
    onKeyDown={(e) => {
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    }}
    className={`relative h-[27px] px-2.5 hover:bg-accent-soft hover:text-accent-fg focus-visible:bg-accent-soft focus-visible:text-accent-fg outline-none flex items-center justify-between cursor-pointer transition-colors ${
      isOpen ? "bg-accent-soft text-accent-fg" : ""
    }`}
  >
    <span className="flex items-center space-x-2 truncate">
      {icon}
      <span className="truncate">{label}</span>
    </span>
    <ChevronRight className="w-3.5 h-3.5 text-fg-2 shrink-0" />
    {isOpen && children}
  </div>
);
