import React, { Suspense, lazy, useMemo, useRef } from "react";
import { Search, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { getMatchingSynonymsForQuery } from "../../utils/sfxThesaurus";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { ToolbarQuickTagCloud } from "./ToolbarQuickTagCloud";
import { useSearchAutocomplete } from "./useSearchAutocomplete";

const SmartSearchAutocomplete = lazy(() =>
  import("./SmartSearchAutocomplete").then((m) => ({
    default: m.SmartSearchAutocomplete,
  }))
);
const SmartSearchHelperPopover = lazy(() =>
  import("./SmartSearchHelperPopover").then((m) => ({
    default: m.SmartSearchHelperPopover,
  }))
);
const SliceToolbarChips = lazy(() =>
  import("./SliceToolbarChips").then((m) => ({ default: m.SliceToolbarChips }))
);
const TrashToolbarChips = lazy(() =>
  import("./TrashToolbarChips").then((m) => ({ default: m.TrashToolbarChips }))
);
const FavoritesToolbarChips = lazy(() =>
  import("./FavoritesToolbarChips").then((m) => ({
    default: m.FavoritesToolbarChips,
  }))
);

interface SampleFilterToolbarProps {
  searchInputRef: React.RefObject<HTMLInputElement>;
  showSearchHelper: boolean;
  setShowSearchHelper: React.Dispatch<React.SetStateAction<boolean>>;
}

export const SampleFilterToolbar: React.FC<SampleFilterToolbarProps> =
  React.memo(({ searchInputRef, showSearchHelper, setShowSearchHelper }) => {
    const searchQuery = useSampleStore((s) => s.searchQuery);
    const smartSearchSynonyms = useSampleStore((s) => s.smartSearchSynonyms);
    const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
    const layersFilterActive = useSampleStore((s) => s.layersFilterActive);
    const layersWorkspaceTab = useSampleStore((s) => s.layersWorkspaceTab);
    const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
    const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
    const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
    const trashViewTab = useSampleStore((s) => s.trashViewTab);
    const isShowingSlices =
      slicesFilterActive ||
      (trashFilterActive && trashViewTab === "slices") ||
      (favoriteOnly && favoritesViewTab === "slices");
    const isShowingLayersSaved =
      (layersFilterActive && layersWorkspaceTab === "saved") ||
      (trashFilterActive && trashViewTab === "layers") ||
      (favoriteOnly && favoritesViewTab === "layers");
    const isSpecialList =
      isShowingSlices || isShowingLayersSaved || trashFilterActive;
    const tags = useSampleStore((s) => s.tags);
    const genres = useSampleStore((s) => s.genres);

    const setSearchQuery = useSampleStore((s) => s.setSearchQuery);
    const setSmartSearchSynonyms = useSampleStore(
      (s) => s.setSmartSearchSynonyms
    );
    const createCollection = useSampleStore((s) => s.createCollection);

    const synonymHints = useMemo(
      () =>
        smartSearchSynonyms ? getMatchingSynonymsForQuery(searchQuery) : [],
      [smartSearchSynonyms, searchQuery]
    );

    const searchBoxRef = useRef<HTMLDivElement | null>(null);

    const autocomplete = useSearchAutocomplete({
      enabled: !showSearchHelper && !isSpecialList,
      searchQuery,
      tags,
      genres,
      searchInputRef,
      setSearchQuery,
    });

    return (
      <div className="h-[36px] bg-surface-1 audify-frosted-bar border-b border-line px-2.5 flex items-center justify-between gap-2.5 shrink-0">
        <div
          ref={searchBoxRef}
          data-search-keep-focus="true"
          className="relative flex items-center flex-1 min-w-[160px] max-w-[420px] bg-surface-3 border border-line rounded-sm focus-within:border-accent h-[25px] pl-2.5 pr-1"
        >
          <Search className="w-3.5 h-3.5 text-fg-head mr-2 shrink-0" />
          <input
            ref={searchInputRef}
            data-search-input="true"
            type="text"
            value={searchQuery}
            onFocus={(e) =>
              autocomplete.onFocus(
                e.currentTarget.selectionStart ?? e.currentTarget.value.length
              )
            }
            onBlur={autocomplete.onBlur}
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
                if (searchQuery) {
                  setSearchQuery("");
                }
                e.currentTarget.blur();
              } else if (e.key === "ArrowDown" || e.key === "Enter") {
                setShowSearchHelper(false);
                e.currentTarget.blur();
              }
            }}
            placeholder={
              isShowingLayersSaved
                ? trashFilterActive
                  ? "Search trashed layers..."
                  : favoriteOnly
                  ? "Search favorite layers..."
                  : "Search saved layers..."
                : isShowingSlices
                ? trashFilterActive
                  ? "Search trashed slices by name or source track..."
                  : favoriteOnly
                  ? "Search favorite slices..."
                  : "Search slices by name or source track..."
                : trashFilterActive
                  ? "Search trashed files..."
                  : "Search samples..."
            }
            className="bg-transparent border-none text-[12px] text-fg placeholder-fg-3 w-full focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="w-[18px] h-[18px] flex items-center justify-center text-fg-2 hover:text-accent-fg shrink-0"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {searchQuery.trim() && !isSpecialList && (
            <QuickCreatePopover
              title="Save as Smart Collection"
              placeholder="Collection name..."
              hasColor={false}
              align="right"
              buttonTitle={`Save "${searchQuery.trim()}" as a Smart Collection`}
              buttonClassName="w-[20px] h-[19px] ml-0.5 rounded-xs flex items-center justify-center transition-colors shrink-0 text-fg-3 hover:text-accent-fg hover:bg-surface-2 border border-transparent"
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
          {!isSpecialList && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSmartSearchSynonyms(!smartSearchSynonyms);
                }}
                className={`w-[20px] h-[19px] ml-0.5 rounded-xs flex items-center justify-center transition-colors shrink-0 ${
                  smartSearchSynonyms
                    ? "bg-accent-soft text-accent-fg border border-accent/50"
                    : "text-fg-3 hover:text-fg hover:bg-surface-2 border border-transparent"
                }`}
                title={
                  smartSearchSynonyms
                    ? "Smart Audio Synonyms: ON (riser ~ build, hit ~ impact, amb ~ atmos)"
                    : "Smart Audio Synonyms: OFF (strict keyword match)"
                }
              >
                <Sparkles className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSearchHelper((prev) => !prev);
                }}
                className={`w-[20px] h-[19px] ml-0.5 rounded-xs flex items-center justify-center transition-colors shrink-0 ${
                  showSearchHelper
                    ? "bg-accent-soft text-accent-fg border border-accent/50"
                    : "text-fg-3 hover:text-fg hover:bg-surface-2 border border-transparent"
                }`}
                title="Smart Search Filters & Operators (-neg, <3s, bpm:, tag:, ext:)"
              >
                <SlidersHorizontal className="w-3 h-3" />
              </button>
            </>
          )}

          {autocomplete.context && autocomplete.context.items.length > 0 && (
            <Suspense fallback={null}>
              <SmartSearchAutocomplete
                context={autocomplete.context}
                activeIndex={autocomplete.activeIndex}
                anchorRef={searchBoxRef}
                onHoverIndex={autocomplete.setActiveIndex}
                onSelect={autocomplete.accept}
              />
            </Suspense>
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

        {/* Search-adjacent compact category tabs for Favorites & Trash (preserves Tag Suggestions on the right) */}
        {favoriteOnly && (
          <Suspense fallback={null}>
            <FavoritesToolbarChips />
          </Suspense>
        )}
        {trashFilterActive && !favoriteOnly && (
          <Suspense fallback={null}>
            <TrashToolbarChips />
          </Suspense>
        )}

        {!isSpecialList &&
          synonymHints.length > 0 && (
            <div className="hidden 2xl:flex items-center space-x-1 min-w-0 overflow-hidden font-mono text-[10px] shrink-0">
              <span
                className="text-accent-fg shrink-0"
                title={`UCS Bilingual Cluster: ${synonymHints[0].label}`}
              >
                ≈
              </span>
              {synonymHints[0].suggestions.slice(0, 2).map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setSearchQuery(`"${sug}"`)}
                  className="h-[20px] px-1.5 rounded-xs bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg truncate transition-colors"
                  title={`Matched via UCS Synonyms (${synonymHints[0].label}). Click for strict "${sug}" match.`}
                >
                  {sug}
                </button>
              ))}
            </div>
          )}

        {slicesFilterActive ? (
          <Suspense fallback={null}>
            <SliceToolbarChips />
          </Suspense>
        ) : isShowingLayersSaved ||
          (favoriteOnly && favoritesViewTab !== "tracks") ||
          trashFilterActive ? (
          <div className="flex-1 min-w-0" />
        ) : (
          <ToolbarQuickTagCloud />
        )}
      </div>
    );
  });
