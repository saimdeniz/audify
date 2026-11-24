import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";

export interface DuplicateDropdownOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

interface DuplicateOptionDropdownProps<T extends string | number> {
  value: T;
  selectedLabel: string;
  options: readonly DuplicateDropdownOption<T>[];
  onSelect: (value: T) => void;
  disabled?: boolean;
  isActive?: boolean;
  ariaLabel: string;
  listboxLabel: string;
  title?: string;
  triggerClassName?: string;
  minMenuWidth?: number;
}

/**
 * Portal-backed dropdown menu used by Duplicate Finder controls (never native OS `<select>`),
 * supporting Mica overlay styling, outside-click dismissal, and Escape focus restoration.
 */
export function DuplicateOptionDropdown<T extends string | number>({
  value,
  selectedLabel,
  options,
  onSelect,
  disabled = false,
  isActive = false,
  ariaLabel,
  listboxLabel,
  title,
  triggerClassName = "",
  minMenuWidth = 140,
}: DuplicateOptionDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxHeight: number;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPosition = React.useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const minWidth = Math.max(minMenuWidth, Math.round(rect.width));
    const pad = 8;
    const spaceBelow = window.innerHeight - rect.bottom - pad;
    const spaceAbove = rect.top - pad;
    const estimatedH = Math.min(230, options.length * 28 + 10);
    const openUp = spaceBelow < estimatedH && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      100,
      Math.min(230, openUp ? spaceAbove : spaceBelow)
    );
    const actualH = Math.min(estimatedH, maxHeight);
    const top = openUp
      ? Math.max(pad, rect.top - actualH - 4)
      : rect.bottom + 4;
    const left = Math.max(
      pad,
      Math.min(rect.left, window.innerWidth - minWidth - pad)
    );
    setMenuCoords({ top, left, minWidth, maxHeight });
  }, [minMenuWidth, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onWinChange = () => updateMenuPosition();
    window.addEventListener("resize", onWinChange);
    window.addEventListener("scroll", onWinChange, true);
    return () => {
      window.removeEventListener("resize", onWinChange);
      window.removeEventListener("scroll", onWinChange, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        className={`rounded-[3px] border font-mono inline-flex items-center justify-between gap-1 transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
          open || isActive
            ? "bg-accent-soft border-accent text-accent-fg font-medium"
            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        } ${triggerClassName}`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${
            open ? "rotate-180 text-accent-fg" : "text-fg-3"
          }`}
        />
      </button>

      {open &&
        menuCoords &&
        createPortal(
          <div
            ref={menuRef}
            data-filter-popover="true"
            data-popover-portal="true"
            data-mica-overlay="true"
            role="listbox"
            aria-label={listboxLabel}
            style={{
              position: "fixed",
              top: menuCoords.top,
              left: menuCoords.left,
              minWidth: menuCoords.minWidth,
              maxHeight: menuCoords.maxHeight,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="bg-surface-2 audify-overlay-surface border border-line-strong rounded-sm shadow-2xl p-1 overflow-y-auto space-y-0.5 select-none"
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setOpen(false);
                    onSelect(opt.value);
                  }}
                  className={`w-full px-2 py-1 rounded-xs font-mono text-[10.5px] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors ${
                    selected
                      ? "bg-accent text-accent-on font-semibold"
                      : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                  }`}
                >
                  <span className="truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{opt.label}</span>
                    {opt.hint && (
                      <span
                        className={`text-[9.5px] shrink-0 ${
                          selected ? "text-accent-on opacity-80" : "text-fg-3"
                        }`}
                      >
                        {opt.hint}
                      </span>
                    )}
                  </span>
                  {selected && <Check className="w-3 h-3 shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
