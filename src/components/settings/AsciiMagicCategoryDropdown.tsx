import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";

export interface AsciiMagicCategoryOption {
  id: string;
  name: string;
  count: number;
}

interface AsciiMagicCategoryDropdownProps {
  value: string;
  options: readonly AsciiMagicCategoryOption[];
  totalCount: number;
  onChange: (categoryId: string) => void;
}

interface PopoverCoords {
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
}

export const AsciiMagicCategoryDropdown: React.FC<AsciiMagicCategoryDropdownProps> =
  React.memo(({ value, options, totalCount, onChange }) => {
    const [open, setOpen] = useState(false);
    const [filterText, setFilterText] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const [coords, setCoords] = useState<PopoverCoords | null>(null);

    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const items = useMemo<AsciiMagicCategoryOption[]>(
      () => [{ id: "all", name: "All Categories", count: totalCount }, ...options],
      [options, totalCount]
    );

    const filteredItems = useMemo(() => {
      const q = filterText.trim().toLowerCase();
      if (!q) return items;
      return items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
      );
    }, [items, filterText]);

    const selectedLabel = useMemo(() => {
      return items.find((i) => i.id === value)?.name ?? "All Categories";
    }, [items, value]);

    const updatePosition = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const width = Math.max(210, Math.round(rect.width));
      const pad = 8;
      const spaceBelow = window.innerHeight - rect.bottom - pad;
      const spaceAbove = rect.top - pad;
      const desiredH = 270;
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        140,
        Math.min(desiredH, openUp ? spaceAbove : spaceBelow)
      );
      const top = openUp
        ? Math.max(pad, rect.top - Math.min(desiredH, maxHeight) - 4)
        : rect.bottom + 4;
      const left = Math.max(
        pad,
        Math.min(rect.right - width, window.innerWidth - width - pad)
      );
      setCoords({ top, left, minWidth: width, maxHeight });
    };

    useLayoutEffect(() => {
      if (!open) return;
      updatePosition();
      const onWinChange = () => updatePosition();
      window.addEventListener("resize", onWinChange);
      window.addEventListener("scroll", onWinChange, true);
      return () => {
        window.removeEventListener("resize", onWinChange);
        window.removeEventListener("scroll", onWinChange, true);
      };
    }, [open]);

    const handleToggleOpen = () => {
      setOpen((prev) => {
        const next = !prev;
        if (next) {
          const idx = Math.max(
            0,
            items.findIndex((i) => i.id === value)
          );
          setActiveIdx(idx);
        }
        return next;
      });
    };

    useEffect(() => {
      if (!open) {
        setFilterText("");
        return;
      }
      const raf = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
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
          setOpen(false);
          triggerRef.current?.focus();
        }
      };
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
        cancelAnimationFrame(raf);
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, [open]);

    useEffect(() => {
      if (activeIdx >= filteredItems.length) {
        setActiveIdx(Math.max(0, filteredItems.length - 1));
      }
    }, [activeIdx, filteredItems.length]);

    const handleSelect = (id: string) => {
      onChange(id);
      setOpen(false);
      triggerRef.current?.focus();
    };

    const handleMenuKeyDown = (ev: React.KeyboardEvent) => {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setActiveIdx((i) =>
          filteredItems.length ? (i + 1) % filteredItems.length : 0
        );
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setActiveIdx((i) =>
          filteredItems.length
            ? (i - 1 + filteredItems.length) % filteredItems.length
            : 0
        );
      } else if (ev.key === "Enter" && filteredItems[activeIdx]) {
        ev.preventDefault();
        handleSelect(filteredItems[activeIdx].id);
      }
    };

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onClick={handleToggleOpen}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Filter catalog by category"
          className={`h-[24px] min-w-[138px] max-w-[175px] px-2 rounded-xs border text-[10.5px] inline-flex items-center justify-between gap-1.5 cursor-pointer transition-colors shrink-0 ${
            open || value !== "all"
              ? "bg-surface-2 border-accent text-fg font-medium"
              : "bg-surface-1 hover:bg-surface-3 border-line hover:border-line-strong text-fg"
          }`}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown
            className={`w-3 h-3 text-fg-3 shrink-0 transition-transform ${
              open ? "rotate-180 text-accent-fg" : ""
            }`}
          />
        </button>

        {open &&
          coords &&
          createPortal(
            <div
              ref={menuRef}
              aria-label="Catalog categories"
              data-popover-portal="true"
              data-popover-open="true"
              data-settings-dropdown-open="true"
              data-mica-overlay="true"
              onKeyDown={handleMenuKeyDown}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: coords.minWidth,
                maxHeight: coords.maxHeight,
                zIndex: Z_INDEX.popoverFloating,
              }}
              className="bg-surface-2 backdrop-blur-md border border-line-strong rounded-sm shadow-lg flex flex-col overflow-hidden select-none"
            >
              {items.length > 6 && (
                <div className="p-1.5 border-b border-line bg-surface-1 shrink-0">
                  <div className="relative">
                    <Search className="w-3 h-3 text-fg-3 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={filterText}
                      onChange={(e) => {
                        setFilterText(e.target.value);
                        setActiveIdx(0);
                      }}
                      placeholder="Filter categories..."
                      className="w-full h-[22px] pl-6 pr-2 rounded-xs bg-surface-2 border border-line text-[10.5px] text-fg placeholder:text-fg-3 focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}

              <div
                role="listbox"
                aria-label="Category options"
                className="flex-1 overflow-y-auto p-1 space-y-0.5"
              >
                {filteredItems.length === 0 ? (
                  <div className="px-2 py-2 text-[10px] text-fg-3 text-center">
                    No matching category
                  </div>
                ) : (
                  filteredItems.map((item, idx) => {
                    const isSelected = item.id === value;
                    const isHighlighted = idx === activeIdx;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => handleSelect(item.id)}
                        className={`w-full px-2 py-1 rounded-xs text-[10.5px] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-accent text-accent-on font-semibold"
                            : isHighlighted
                              ? "bg-surface-3 text-fg"
                              : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                        }`}
                      >
                        <span className="truncate flex items-center gap-1.5 min-w-0">
                          {isSelected && (
                            <Check className="w-3 h-3 shrink-0 stroke-[2.5]" />
                          )}
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span
                          className={`text-[9.5px] font-mono shrink-0 ${
                            isSelected ? "text-accent-on" : "text-fg-3"
                          }`}
                        >
                          {item.count}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>,
            document.body
          )}
      </>
    );
  });
