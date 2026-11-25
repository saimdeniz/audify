import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { User } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import type {
  SearchAutocompleteContext,
  SearchAutocompleteItem,
} from "../../utils/search/searchAutocomplete";

interface SmartSearchAutocompleteProps {
  context: SearchAutocompleteContext;
  activeIndex: number;
  anchorRef: React.RefObject<HTMLElement>;
  onHoverIndex: (index: number) => void;
  onSelect: (item: SearchAutocompleteItem) => void;
}

export const SmartSearchAutocomplete: React.FC<SmartSearchAutocompleteProps> =
  React.memo(({ context, activeIndex, anchorRef, onHoverIndex, onSelect }) => {
    const [pos, setPos] = useState<{
      left: number;
      top: number;
      width: number;
    }>({ left: 12, top: 68, width: 320 });

    useLayoutEffect(() => {
      const update = () => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return;
        const maxW = Math.max(200, Math.min(380, window.innerWidth - 16));
        const width = Math.max(200, Math.min(maxW, Math.round(rect.width)));
        const left = Math.max(
          8,
          Math.min(window.innerWidth - width - 8, Math.round(rect.left))
        );
        const top = Math.min(
          window.innerHeight - 160,
          Math.round(rect.bottom + 4)
        );
        setPos((prev) =>
          prev.left === left && prev.top === top && prev.width === width
            ? prev
            : { left, top, width }
        );
      };
      const onScroll = (ev: Event) => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const target = ev.target;
        if (
          target === window ||
          target === document ||
          (target instanceof Node && target.contains(anchor))
        ) {
          update();
        }
      };
      update();
      window.addEventListener("resize", update);
      window.addEventListener("scroll", onScroll, true);
      return () => {
        window.removeEventListener("resize", update);
        window.removeEventListener("scroll", onScroll, true);
      };
    }, [anchorRef, context.items.length]);

    return createPortal(
      <div
        role="listbox"
        aria-label={context.headerLabel}
        data-popover-portal="true"
        data-mica-overlay="true"
        data-search-keep-focus="true"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          zIndex: Z_INDEX.popoverFloating,
        }}
        className="fixed rounded-md bg-surface-1 border border-line-strong shadow-2xl overflow-hidden select-none"
      >
        <div className="px-2.5 py-1 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-fg-head">
            {context.headerLabel}
          </span>
          <span className="font-mono text-[9px] text-fg-3">
            Tab / Enter
          </span>
        </div>

        <div className="py-1 max-h-[224px] overflow-y-auto">
          {context.items.map((item, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => onHoverIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                }}
                className={`w-full h-[26px] px-2.5 flex items-center justify-between gap-2 text-left text-[11.5px] transition-colors ${
                  isActive
                    ? "bg-accent-soft text-accent-fg font-medium"
                    : "text-fg hover:bg-surface-hover"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {item.color ? (
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                  ) : item.kind === "artist" ? (
                    <User className="w-3 h-3 text-fg-3 shrink-0" />
                  ) : item.kind === "source" || item.facetBadge === "SRC" ? (
                    <span className="font-mono text-[10px] text-fg-3 shrink-0 w-2 text-center">
                      #
                    </span>
                  ) : null}
                  <span className="truncate font-mono text-[11px]">
                    {item.label}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {item.facetBadge && (
                    <span className="font-mono text-[8.5px] uppercase tracking-wider px-1 py-0.2 rounded-[2px] border border-line bg-surface-3 text-fg-3">
                      {item.facetBadge}
                    </span>
                  )}
                  {item.meta && (
                    <span
                      className={`font-mono tabular-nums text-[10px] shrink-0 ${
                        isActive ? "text-accent-fg" : "text-fg-3"
                      }`}
                    >
                      {item.meta}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    );
  });
