import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { getMatchingSynonymsForQuery } from "../../utils/sfxThesaurus";
import { QuickCreatePopover } from "../QuickCreatePopover";
import {
  SmartSearchAutocomplete,
  useSearchAutocomplete,
} from "../sample-table/SmartSearchAutocomplete";
import { MiniDockSortDropdown } from "./MiniDockSortDropdown";

const SmartSearchHelperPopover = lazy(() =>
  import("../sample-table/SmartSearchHelperPopover").then((m) => ({
    default: m.SmartSearchHelperPopover,
  }))
);

interface MiniDockSearchBarProps {
  searchInputRef: React.RefObject<HTMLInputElement>;
  showSlicesTable: boolean;
  onFocusChange: (focused: boolean) => void;
}

export const MiniDockSearchBar: React.FC<MiniDockSearchBarProps> = React.memo(
  ({ searchInputRef, showSlicesTable, onFocusChange }) => {
    const searchQuery = useSampleStore((s) => s.searchQuery);
    const smartSearchSynonyms = useSampleStore((s) => s.smartSearchSynonyms);
    const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
    const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
    const tags = useSampleStore((s) => s.tags);
    const genres = useSampleStore((s) => s.genres);

    const setSearchQuery = useSampleStore((s) => s.setSearchQuery);
    const setSmartSearchSynonyms = useSampleStore(
      (s) => s.setSmartSearchSynonyms
    );
    const createCollection = useSampleStore((s) => s.createCollection);

    const searchBoxRef = useRef<HTMLDivElement>(null);
    const [showSearchHelper, setShowSearchHelper] = useState(false);

    const canUseSmartOperators = !slicesFilterActive && !trashFilterActive;

    const synonymHints = useMemo(
      () =>
        smartSearchSynonyms ? getMatchingSynonymsForQuery(searchQuery) : [],
      [smartSearchSynonyms, searchQuery]
    );

    const autocomplete = useSearchAutocomplete({
      enabled: canUseSmartOperators && !showSearchHelper,
      searchQuery,
      tags,
      genres,
      searchInputRef,
      setSearchQuery,
    });

    useEffect(() => {
      if (!canUseSmartOperators && showSearchHelper) {
        setShowSearchHelper(false);
      }
    }, [canUseSmartOperators, showSearchHelper]);

    // Close Smart Search Helper popover on outside click or Escape
    useEffect(() => {
      if (!showSearchHelper) return;
      const onMouseDown = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
          searchBoxRef.current?.contains(target) ||
          target.closest("[data-popover-portal='true']")
        ) {
          return;
        }
        setShowSearchHelper(false);
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setShowSearchHelper(false);
        }
      };
      window.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("keydown", onKeyDown, true);
      return () => {
        window.removeEventListener("mousedown", onMouseDown, true);
        window.removeEventListener("keydown", onKeyDown, true);
      };
    }, [showSearchHelper]);

    return (
      <div className="bg-surface-1 border-b border-line px-2 py-1.5 flex items-center gap-1.5 shrink-0">
        <div
          ref={searchBoxRef}
          data-search-keep-focus="true"
          className="relative flex-1 min-w-0 flex items-center bg-surface-3 border border-line-strong focus-within:border-accent rounded-xs h-[28px] pl-2.5 pr-1"
        >
          <Search className="w-3.5 h-3.5 text-fg-2 mr-1.5 shrink-0" />
          <input
            ref={searchInputRef}
            data-search-input="true"
            type="text"
            value={searchQuery}
            onFocus={(e) => {
              onFocusChange(true);
              autocomplete.onFocus(
                e.currentTarget.selectionStart ?? e.currentTarget.value.length
              );
            }}
            onBlur={() => {
              onFocusChange(false);
              autocomplete.onBlur();
            }}
            onClick={(e) =>
              autocomplete.onCursorChange(
                e.currentTarget.selectionStart ?? e.currentTarget.value.length
              )
            }
            onKeyUp={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                autocomplete.onCursorChange(
                  e.currentTarget.selectionStart ?? e.currentTarget.value.length
                );
              }
            }}
            onChange={(e) => {
              autocomplete.onValueChange(
                e.target.selectionStart ?? e.target.value.length
              );
              setSearchQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (autocomplete.handleKeyDown(e)) return;
              if (e.key === "Escape") {
                e.stopPropagation();
                if (showSearchHelper) {
                  setShowSearchHelper(false);
                  return;
                }
                if (searchQuery) setSearchQuery("");
                e.currentTarget.blur();
              } else if (e.key === "ArrowDown" || e.key === "Enter") {
                setShowSearchHelper(false);
                e.currentTarget.blur();
              }
            }}
            placeholder={
              showSlicesTable
                ? trashFilterActive
                  ? "Search trashed slices..."
                  : "Search slices..."
                : trashFilterActive
                ? "Search trashed files..."
                : "Search samples..."
            }
            className="bg-transparent border-none text-[12px] text-fg placeholder-fg-3 w-full focus:outline-none min-w-0"
          />
          {searchQuery && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="w-[20px] h-[20px] flex items-center justify-center text-fg-2 hover:text-fg shrink-0"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {searchQuery.trim() && canUseSmartOperators && (
            <QuickCreatePopover
              title="Save as Smart Collection"
              placeholder="Collection name..."
              hasColor={false}
              align="right"
              buttonTitle={`Save "${searchQuery.trim()}" as a Smart Collection`}
              buttonClassName="w-[20px] h-[20px] ml-0.5 rounded-xs flex items-center justify-center transition-colors shrink-0 text-fg-3 hover:text-accent-fg hover:bg-surface-2 border border-transparent"
              buttonIcon={<Zap className="w-3 h-3" />}
              onCreated={async (name) => {
                const query = searchQuery.trim();
                if (!query) return false;
                const created = await createCollection(
                  name,
                  undefined,
                  "zap",
                  null,
                  null,
                  query
                );
                return Boolean(created);
              }}
            />
          )}
          {canUseSmartOperators && (
            <>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSmartSearchSynonyms(!smartSearchSynonyms)}
                title={
                  smartSearchSynonyms
                    ? "Bilingual UCS Synonyms: ON"
                    : "Bilingual UCS Synonyms: OFF"
                }
                className={`w-[22px] h-[22px] ml-0.5 rounded-xs flex items-center justify-center shrink-0 transition-colors ${
                  smartSearchSynonyms
                    ? "bg-accent-soft text-accent-fg border border-accent/60"
                    : "text-fg-2 hover:text-fg"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSearchHelper((prev) => !prev);
                }}
                title="Smart Search Filters & Operators (-neg, <3s, bpm:, tag:, ext:)"
                className={`w-[22px] h-[22px] ml-0.5 rounded-xs flex items-center justify-center shrink-0 transition-colors ${
                  showSearchHelper
                    ? "bg-accent-soft text-accent-fg border border-accent/60"
                    : "text-fg-2 hover:text-fg"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {autocomplete.context && autocomplete.context.items.length > 0 && (
            <SmartSearchAutocomplete
              context={autocomplete.context}
              activeIndex={autocomplete.activeIndex}
              anchorRef={searchBoxRef}
              onHoverIndex={autocomplete.setActiveIndex}
              onSelect={autocomplete.accept}
            />
          )}

          {showSearchHelper && (
            <Suspense fallback={null}>
              <SmartSearchHelperPopover
                searchQuery={searchQuery}
                smartSearchSynonyms={smartSearchSynonyms}
                synonymHints={synonymHints}
                searchInputRef={searchInputRef}
                anchorRef={searchBoxRef}
                setSearchQuery={setSearchQuery}
                setSmartSearchSynonyms={setSmartSearchSynonyms}
                setShowSearchHelper={setShowSearchHelper}
                onOperatorInserted={autocomplete.onFocus}
              />
            </Suspense>
          )}
        </div>
        {!showSlicesTable && <MiniDockSortDropdown />}
      </div>
    );
  }
);
