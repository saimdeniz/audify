import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";

export interface ThemedSelectOption {
  value: string;
  label: string;
  color?: string;
  badge?: string;
  disabled?: boolean;
}

export interface ThemedSelectProps {
  value: string;
  options: readonly ThemedSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  ariaLabel?: string;
  title?: string;
  triggerClassName?: string;
  minMenuWidth?: number;
}

interface MenuCoords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Shared portal-backed themed dropdown replacing native OS `<select>` elements
 * across Settings & Taxonomy inspectors. Matches Audify's Dark / Light / Contrast
 * overlay language with viewport clamping, optional search, and keyboard nav.
 */
export const ThemedSelect: React.FC<ThemedSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = "Select...",
  disabled = false,
  searchable,
  ariaLabel,
  title,
  triggerClassName = "",
  minMenuWidth = 150,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const showSearch = searchable ?? options.length > 10;

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) ?? null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.badge && opt.badge.toLowerCase().includes(q))
    );
  }, [options, query]);

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const pad = 8;
    const width = Math.min(
      Math.max(minMenuWidth, Math.round(rect.width)),
      Math.max(160, window.innerWidth - pad * 2)
    );
    const spaceBelow = window.innerHeight - rect.bottom - pad;
    const spaceAbove = rect.top - pad;
    const desiredH = Math.min(
      260,
      options.length * 26 + (showSearch ? 38 : 10)
    );
    const openUp = spaceBelow < Math.min(desiredH, 160) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      110,
      Math.min(260, openUp ? spaceAbove : spaceBelow)
    );
    const renderedH = Math.min(desiredH, maxHeight);
    const top = openUp
      ? Math.max(pad, rect.top - renderedH - 4)
      : rect.bottom + 4;
    const left = Math.max(
      pad,
      Math.min(rect.left, window.innerWidth - width - pad)
    );
    setCoords({ top, left, width, maxHeight });
  }, [minMenuWidth, options.length, showSearch]);

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
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
    const raf = requestAnimationFrame(() => {
      if (showSearch) {
        searchRef.current?.focus();
      } else {
        menuRef.current?.focus();
      }
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
        ev.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, showSearch]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setQuery("");
        const idx = options.findIndex((o) => o.value === value);
        setActiveIdx(idx >= 0 ? idx : 0);
      }
      return next;
    });
  };

  const handleSelectOption = (opt: ThemedSelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (filteredOptions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filteredOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(
        (i) => (i - 1 + filteredOptions.length) % filteredOptions.length
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredOptions[activeIdx];
      if (target) handleSelectOption(target);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        className={`w-full h-[28px] px-2 rounded-xs border font-mono text-[11px] flex items-center justify-between gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? "bg-surface-3 border-accent text-fg"
            : "bg-surface-2 hover:bg-surface-3 border-line hover:border-line-strong text-fg"
        } ${triggerClassName}`}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {selectedOption?.color && (
            <span
              className="w-2 h-2 rounded-[2px] shrink-0"
              style={{ backgroundColor: selectedOption.color }}
            />
          )}
          <span
            className={`truncate ${
              selectedOption ? "text-fg" : "text-fg-3"
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${
            open ? "rotate-180 text-accent-fg" : "text-fg-3"
          }`}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            tabIndex={-1}
            role="listbox"
            aria-label={ariaLabel || placeholder}
            data-popover-portal="true"
            data-mica-overlay="true"
            onKeyDown={handleMenuKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="bg-surface-2 audify-overlay-surface border border-line-strong rounded-sm shadow-2xl p-1 flex flex-col select-none outline-none"
          >
            {showSearch && (
              <div className="relative flex items-center mb-1 shrink-0">
                <Search className="w-3 h-3 text-fg-3 absolute left-2 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIdx(0);
                  }}
                  placeholder="Filter options..."
                  className="w-full h-[24px] pl-6 pr-2 rounded-xs bg-surface-1 border border-line focus:border-accent font-mono text-[10.5px] text-fg placeholder-fg-3 outline-none"
                />
              </div>
            )}

            <div className="overflow-y-auto space-y-0.5 flex-1 min-h-0">
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-2 text-center font-mono text-[10px] text-fg-3">
                  No matching options
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isHighlighted = idx === activeIdx;
                  return (
                    <button
                      key={`${opt.value}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => handleSelectOption(opt)}
                      className={`w-full px-2 py-1 rounded-xs font-mono text-[10.5px] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer disabled:opacity-45 ${
                        isSelected
                          ? "bg-accent-soft text-accent-fg font-semibold border border-accent/40"
                          : isHighlighted
                          ? "bg-surface-3 text-fg border border-transparent"
                          : "text-fg-2 hover:bg-surface-3 hover:text-fg border border-transparent"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        {opt.color && (
                          <span
                            className="w-2 h-2 rounded-[2px] shrink-0"
                            style={{ backgroundColor: opt.color }}
                          />
                        )}
                        <span className="truncate">{opt.label}</span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {opt.badge && (
                          <span className="text-[9px] uppercase text-fg-3 px-1 rounded-[2px] bg-surface-1 border border-line">
                            {opt.badge}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="w-3 h-3 text-accent-fg shrink-0" />
                        )}
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
};
