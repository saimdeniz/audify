import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import type { Genre, Tag } from "../../types";
import {
  applyAutocompleteSuggestion,
  getSearchAutocompleteSuggestions,
  type SearchAutocompleteContext,
  type SearchAutocompleteItem,
} from "../../utils/search/searchAutocomplete";

export function useSearchAutocomplete({
  enabled,
  searchQuery,
  tags,
  genres,
  searchInputRef,
  setSearchQuery,
}: {
  enabled: boolean;
  searchQuery: string;
  tags: readonly Tag[];
  genres: readonly Genre[];
  searchInputRef: React.RefObject<HTMLInputElement>;
  setSearchQuery: (q: string) => void;
}) {
  const folderStats = useSampleStore((s) => s.folderStats);
  const [isFocused, setIsFocused] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  const context = useMemo(() => {
    if (!enabled || !isFocused) return null;
    const ctx = getSearchAutocompleteSuggestions(
      searchQuery,
      cursorPos,
      tags,
      genres,
      folderStats
    );
    if (!ctx || ctx.rawToken === dismissedToken) return null;
    return ctx;
  }, [
    enabled,
    isFocused,
    searchQuery,
    cursorPos,
    tags,
    genres,
    folderStats,
    dismissedToken,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [context?.rawToken, context?.items.length]);

  const accept = useCallback(
    (item: SearchAutocompleteItem) => {
      if (!context) return;
      const { nextQuery, nextCursor } = applyAutocompleteSuggestion(
        searchQuery,
        context,
        item
      );
      setDismissedToken(null);
      setSearchQuery(nextQuery);
      setCursorPos(nextCursor);
      requestAnimationFrame(() => {
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.setSelectionRange(nextCursor, nextCursor);
        }
      });
    },
    [context, searchQuery, setSearchQuery, searchInputRef]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!context || context.items.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % context.items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + context.items.length) % context.items.length
        );
        return true;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const chosen = context.items[activeIndex] ?? context.items[0];
        if (chosen) accept(chosen);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedToken(context.rawToken);
        return true;
      }
      return false;
    },
    [context, activeIndex, accept]
  );

  return {
    context,
    activeIndex,
    setActiveIndex,
    accept,
    handleKeyDown,
    onFocus: (pos: number) => {
      setIsFocused(true);
      setCursorPos(pos);
    },
    onBlur: () => setIsFocused(false),
    onCursorChange: (pos: number) => setCursorPos(pos),
    onValueChange: (pos: number) => {
      setDismissedToken(null);
      setCursorPos(pos);
    },
  };
}

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
                  // Prevent input blur before insertion completes
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
                  {item.color && (
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                  )}
                  <span className="truncate font-mono text-[11px]">
                    {item.label}
                  </span>
                </span>
                {item.meta && (
                  <span
                    className={`font-mono tabular-nums text-[10px] shrink-0 ${
                      isActive ? "text-accent-fg" : "text-fg-3"
                    }`}
                  >
                    {item.meta}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    );
  });
