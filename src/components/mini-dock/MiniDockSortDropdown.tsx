import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
} from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { SortKey } from "../../types";

const MINI_SORT_OPTIONS: readonly {
  key: SortKey | null;
  label: string;
  shortLabel: string;
}[] = [
  { key: null, label: "Default order", shortLabel: "Sort" },
  { key: "name", label: "File Name", shortLabel: "Name" },
  { key: "duration", label: "Duration", shortLabel: "Time" },
  { key: "bpm", label: "BPM", shortLabel: "BPM" },
  { key: "key", label: "Musical Key", shortLabel: "Key" },
  { key: "dateModified", label: "Date Modified", shortLabel: "Modified" },
  { key: "dateAdded", label: "Date Added", shortLabel: "Added" },
];

export const MiniDockSortDropdown: React.FC = React.memo(() => {
  const sortKey = useSampleStore((s) => s.sortKey);
  const sortDir = useSampleStore((s) => s.sortDir);
  const cycleSort = useSampleStore((s) => s.cycleSort);

  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: 120,
    left: 200,
  });

  const activeEntry =
    MINI_SORT_OPTIONS.find((item) => item.key === sortKey) ??
    MINI_SORT_OPTIONS[0];

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuW = 164;
      const menuH = 228;
      const left = Math.max(
        8,
        Math.min(rect.right - menuW, window.innerWidth - menuW - 8)
      );
      const top =
        rect.bottom + 4 + menuH <= window.innerHeight - 8
          ? rect.bottom + 4
          : Math.max(8, rect.top - menuH - 4);
      setPos({ top, left });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    return () => window.removeEventListener("resize", updatePos);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isOpen]);

  const selectSortOption = (key: SortKey | null) => {
    if (key === null) {
      if (sortKey !== null) {
        cycleSort(sortKey);
        if (useSampleStore.getState().sortKey !== null) {
          cycleSort(sortKey);
        }
      }
      setIsOpen(false);
      return;
    }

    if (sortKey === key) {
      cycleSort(key);
      if (useSampleStore.getState().sortKey === null) {
        cycleSort(key);
      }
    } else {
      cycleSort(key);
    }
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsOpen((v) => !v)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (sortKey !== null) {
            selectSortOption(sortKey);
          }
        }}
        title="Sort samples (click to choose field, right-click to flip direction)"
        className={`h-[28px] px-2 rounded-xs border font-mono text-[10px] font-medium flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
          sortKey !== null || isOpen
            ? "bg-accent-soft border-accent text-accent-fg"
            : "bg-surface-3 border-line-strong text-fg-2 hover:text-fg"
        }`}
      >
        {sortKey === null ? (
          <ArrowUpDown className="w-3 h-3 shrink-0" />
        ) : sortDir === "asc" ? (
          <ArrowUp className="w-3 h-3 shrink-0" />
        ) : (
          <ArrowDown className="w-3 h-3 shrink-0" />
        )}
        <span>{activeEntry.shortLabel}</span>
        <ChevronDown className="w-2.5 h-2.5 opacity-75 shrink-0" />
      </button>

      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Sort samples"
            data-popover-portal="true"
            data-mica-overlay="true"
            style={{
              top: pos.top,
              left: pos.left,
              zIndex: Z_INDEX.contextMenu,
            }}
            className="fixed w-[164px] bg-surface-1 border border-line-strong rounded-sm shadow-2xl py-1 select-none"
          >
            <div className="px-2.5 py-1 text-[9.5px] font-mono uppercase tracking-wider text-fg-3 border-b border-line-subtle mb-0.5">
              Sort By
            </div>
            {MINI_SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortKey;
              return (
                <button
                  key={opt.key ?? "default"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSortOption(opt.key)}
                  className={`w-full h-[26px] px-2.5 flex items-center justify-between text-[11px] transition-colors cursor-pointer ${
                    active
                      ? "bg-accent-soft text-accent-fg font-medium"
                      : "text-fg-2 hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  <span className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                    {active && opt.key !== null ? (
                      <>
                        {sortDir === "asc" ? (
                          <ArrowUp className="w-3 h-3 text-accent-fg" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-accent-fg" />
                        )}
                      </>
                    ) : active ? (
                      <Check className="w-3 h-3 text-accent-fg" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
});
