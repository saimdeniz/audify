import React, {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Hash, Search, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { getMatchingSynonymsForQuery } from "../../utils/sfxThesaurus";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { SliceToolbarChips } from "./SliceToolbarChips";
import { TrashToolbarChips } from "./TrashToolbarChips";

const SmartSearchHelperPopover = lazy(() =>
  import("./SmartSearchHelperPopover").then((m) => ({
    default: m.SmartSearchHelperPopover,
  }))
);

interface SampleFilterToolbarProps {
  searchInputRef: React.RefObject<HTMLInputElement>;
  showSearchHelper: boolean;
  setShowSearchHelper: React.Dispatch<React.SetStateAction<boolean>>;
}

export const SampleFilterToolbar: React.FC<SampleFilterToolbarProps> = ({
  searchInputRef,
  showSearchHelper,
  setShowSearchHelper,
}) => {
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const smartSearchSynonyms = useSampleStore((s) => s.smartSearchSynonyms);
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const isShowingSlices =
    slicesFilterActive || (trashFilterActive && trashViewTab === "slices");
  const samples = useSampleStore((s) => s.samples);
  const tags = useSampleStore((s) => s.tags);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const hasActiveFilter = useSampleStore((s) =>
    Boolean(
      s.searchQuery.trim() ||
        s.folderFilter ||
        s.favoriteOnly ||
        s.recentOnly ||
        s.selectedTagIds.length > 0 ||
        s.selectedGenre ||
        s.selectedCollectionId !== null ||
        s.selectedLicenseGroupId !== null ||
        s.binFilterActive ||
        s.trashFilterActive ||
        s.typeFilter !== "all" ||
        s.srFilter !== null ||
        s.similaritySession
    )
  );

  const setSearchQuery = useSampleStore((s) => s.setSearchQuery);
  const setSmartSearchSynonyms = useSampleStore(
    (s) => s.setSmartSearchSynonyms
  );
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);
  const selectOrToggleTagFilter = useSampleStore(
    (s) => s.selectOrToggleTagFilter
  );
  const createCollection = useSampleStore((s) => s.createCollection);

  const synonymHints = useMemo(
    () =>
      smartSearchSynonyms ? getMatchingSynonymsForQuery(searchQuery) : [],
    [smartSearchSynonyms, searchQuery]
  );

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );

  const deferredSamples = useDeferredValue(samples);

  // Tag Suggestion Cloud: top 14 matching tags from current results (dynamically fitted to available width)
  const suggestedTags = useMemo(() => {
    if (slicesFilterActive || trashFilterActive || tags.length === 0) return [];
    if (!hasActiveFilter) {
      return tags
        .map((t) => ({
          tag: t,
          matchCount: t.sample_count,
          isSelected: selectedTagSet.has(t.id),
        }))
        .filter((item) => item.isSelected || item.matchCount > 0)
        .sort((a, b) => {
          if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
          if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
          return a.tag.name.localeCompare(b.tag.name);
        })
        .slice(0, 14);
    }

    const countsById = new Map<number, number>();
    // Sample up to 2,000 rows from deferred results for zero-jank tag frequency counting
    const limit = Math.min(deferredSamples.length, 2000);
    for (let i = 0; i < limit; i++) {
      const rowTags = deferredSamples[i].tags;
      for (let j = 0; j < rowTags.length; j++) {
        const tid = rowTags[j].id;
        countsById.set(tid, (countsById.get(tid) || 0) + 1);
      }
    }

    return tags
      .map((t) => ({
        tag: t,
        matchCount: countsById.get(t.id) || 0,
        isSelected: selectedTagSet.has(t.id),
      }))
      .filter((item) => item.isSelected || item.matchCount > 0)
      .sort((a, b) => {
        if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return a.tag.name.localeCompare(b.tag.name);
      })
      .slice(0, 14);
  }, [
    slicesFilterActive,
    trashFilterActive,
    deferredSamples,
    hasActiveFilter,
    tags,
    selectedTagSet,
  ]);

  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const cloudContainerRef = useRef<HTMLDivElement | null>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overflowPopoverRef = useRef<HTMLDivElement | null>(null);
  const [cloudWidth, setCloudWidth] = useState<number>(520);
  const [showTagOverflow, setShowTagOverflow] = useState(false);
  const [overflowPos, setOverflowPos] = useState<{ top: number; right: number }>({
    top: 68,
    right: 12,
  });

  useLayoutEffect(() => {
    if (!showTagOverflow) return;
    const update = () => {
      const rect = overflowTriggerRef.current?.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      const top = Math.min(window.innerHeight - 160, rect.bottom + 4);
      const right = Math.max(8, window.innerWidth - rect.right);
      setOverflowPos({ top, right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showTagOverflow]);

  useEffect(() => {
    const el = cloudContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setCloudWidth(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [suggestedTags.length]);

  useEffect(() => {
    if (!showTagOverflow) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        overflowPopoverRef.current?.contains(target) ||
        target.closest("[data-tag-overflow-trigger]")
      ) {
        return;
      }
      setShowTagOverflow(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowTagOverflow(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [showTagOverflow]);

  const { visibleTags, overflowTags } = useMemo(() => {
    const topCloudCandidates = suggestedTags.slice(0, 7);
    if (topCloudCandidates.length === 0) {
      return { visibleTags: [], overflowTags: [] };
    }
    // Reserve ~22px for '#' icon and ~42px for '+N' badge when overflow exists
    const available = Math.max(0, cloudWidth - 24);
    const chipWidths = topCloudCandidates.map(({ tag, matchCount }) => {
      const nameChars = Math.min(14, tag.name.length);
      const countChars = matchCount.toLocaleString().length;
      return Math.round(32 + nameChars * 6.6 + countChars * 6.2 + 4);
    });

    const totalTopWidth = chipWidths.reduce((a, b) => a + b, 0);
    const extraBeyondSeven = suggestedTags.slice(7);

    if (totalTopWidth <= available && extraBeyondSeven.length === 0) {
      return { visibleTags: topCloudCandidates, overflowTags: [] };
    }

    const budgetWithBadge = Math.max(0, available - 42);
    let used = 0;
    let fitCount = 0;
    for (let i = 0; i < topCloudCandidates.length; i++) {
      if (used + chipWidths[i] <= budgetWithBadge) {
        used += chipWidths[i];
        fitCount++;
      } else {
        break;
      }
    }

    return {
      visibleTags: topCloudCandidates.slice(0, fitCount),
      overflowTags: suggestedTags.slice(fitCount),
    };
  }, [suggestedTags, cloudWidth]);

  return (
    <div className="h-[36px] bg-surface-1 audify-frosted-bar border-b border-line px-2.5 flex items-center justify-between gap-2.5 shrink-0">
      <div
        ref={searchBoxRef}
        data-search-keep-focus="true"
        className="relative flex items-center w-[340px] min-w-[260px] sm:min-w-[300px] lg:min-w-[350px] max-w-[440px] flex-1 bg-surface-3 border border-line rounded-sm focus-within:border-accent h-[25px] pl-2.5 pr-1 shrink-0"
      >
        <Search className="w-3.5 h-3.5 text-fg-head mr-2 shrink-0" />
        <input
          ref={searchInputRef}
          data-search-input="true"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
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
            isShowingSlices
              ? trashFilterActive
                ? "Search trashed slices by name or source track..."
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
            onClick={() => setSearchQuery("")}
            className="w-[18px] h-[18px] flex items-center justify-center text-fg-2 hover:text-accent-fg shrink-0"
            title="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {searchQuery.trim() && !slicesFilterActive && !trashFilterActive && (
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
        {!slicesFilterActive && !trashFilterActive && (
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
            />
          </Suspense>
        )}
      </div>

      {!slicesFilterActive && !trashFilterActive && synonymHints.length > 0 && (
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

      {/* Tag Suggestion Cloud, Trash Sub-View Switcher, or Slice Quick Filters */}
      {slicesFilterActive ? (
        <SliceToolbarChips />
      ) : trashFilterActive ? (
        <TrashToolbarChips />
      ) : (
        <div
          ref={cloudContainerRef}
          className="relative flex-1 min-w-0 flex items-center justify-end gap-1 py-0.5"
        >
        {suggestedTags.length > 0 && (
          <>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-3 mr-0.5 shrink-0"
              title="Top matching tags in current results (Click to filter, Ctrl+Click for multi-tag)"
            >
              <Hash className="w-3 h-3" />
            </span>

            {visibleTags.map(({ tag, matchCount, isSelected }) => (
              <button
                key={tag.id}
                type="button"
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    toggleTagFilter(tag.id);
                  } else {
                    selectOrToggleTagFilter(tag.id, true);
                  }
                }}
                className={`h-[22px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 shrink-0 transition-colors ${
                  isSelected
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
                title={`${tag.name} (${matchCount.toLocaleString()} in current view) — Click to toggle filter`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-[1px] shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="truncate max-w-[96px]">{tag.name}</span>
                <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
                  {matchCount.toLocaleString()}
                </span>
              </button>
            ))}

            {overflowTags.length > 0 && (
              <button
                ref={overflowTriggerRef}
                type="button"
                data-tag-overflow-trigger="true"
                onClick={() => setShowTagOverflow((v) => !v)}
                className={`h-[22px] px-2 rounded-[3px] border font-mono tabular-nums text-[10.5px] font-semibold inline-flex items-center justify-center shrink-0 transition-colors ${
                  showTagOverflow || overflowTags.some((t) => t.isSelected)
                    ? "bg-accent-soft border-accent text-accent-fg"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
                title={`${overflowTags.length} more matching tags — Click to view`}
              >
                +{overflowTags.length}
              </button>
            )}

            {showTagOverflow &&
              overflowTags.length > 0 &&
              createPortal(
                <div
                  ref={overflowPopoverRef}
                  data-context-menu-portal="true"
                  data-popover-portal="true"
                  data-mica-overlay="true"
                  style={{
                    top: overflowPos.top,
                    right: overflowPos.right,
                    zIndex: Z_INDEX.floatingMenu,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="fixed w-[290px] max-w-[85vw] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md shadow-2xl p-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between border-b border-line pb-1">
                    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-fg-2">
                      More Matching Tags ({overflowTags.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowTagOverflow(false)}
                      className="w-[18px] h-[18px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-3"
                      title="Close"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto pr-0.5">
                    {overflowTags.map(({ tag, matchCount, isSelected }) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            toggleTagFilter(tag.id);
                          } else {
                            selectOrToggleTagFilter(tag.id, true);
                            setShowTagOverflow(false);
                          }
                        }}
                        className={`h-[23px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 transition-colors ${
                          isSelected
                            ? "bg-accent-soft border-accent text-accent-fg font-medium"
                            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                        }`}
                        title={`${tag.name} (${matchCount.toLocaleString()} in current view) — Click to filter, Ctrl+Click for multi-tag`}
                      >
                        <span
                          className="w-2 h-2 rounded-[1.5px] shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="truncate max-w-[130px]">{tag.name}</span>
                        <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
                          {matchCount.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>,
                document.body
              )}
          </>
        )}
        </div>
      )}
    </div>
  );
};
