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
import { Hash } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  buildDistinctiveTopTags,
  getSharedTaxonomyIndex,
  getTagRollupCount,
  resolveFacetDomain,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";

const ToolbarTagOverflowPopover = lazy(() =>
  import("./ToolbarTagOverflowPopover").then((m) => ({
    default: m.ToolbarTagOverflowPopover,
  }))
);

export const ToolbarQuickTagCloud: React.FC = React.memo(() => {
  const samples = useSampleStore((s) => s.samples);
  const tags = useSampleStore((s) => s.tags);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const excludedTagIds = useSampleStore((s) => s.excludedTagIds);
  const tagMatchMode = useSampleStore((s) => s.tagMatchMode);
  const hasActiveFilter = useSampleStore((s) =>
    Boolean(
      s.searchQuery.trim() ||
        s.folderFilter ||
        s.favoriteOnly ||
        s.recentOnly ||
        s.selectedTagIds.length > 0 ||
        s.excludedTagIds.length > 0 ||
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
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);
  const toggleExcludeTagFilter = useSampleStore(
    (s) => s.toggleExcludeTagFilter
  );

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );
  const excludedTagSet = useMemo(
    () => new Set(excludedTagIds),
    [excludedTagIds]
  );
  const taxonomyIndex = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );

  const deferredSamples = useDeferredValue(samples);

  const suggestedTags = useMemo(() => {
    if (tags.length === 0) return [];
    const toEntry = (t: (typeof tags)[number], matchCount: number) => ({
      tag: t,
      matchCount,
      isSelected: false,
      isSource: taxonomyIndex.facetByTagId.get(t.id) === "source",
      color: taxonomyIndex.effectiveColorByTagId.get(t.id) ?? t.color,
      breadcrumb: taxonomyIndex.breadcrumbByTagId.get(t.id) ?? t.name,
    });

    if (!hasActiveFilter) {
      return buildDistinctiveTopTags(tags, deferredSamples.length, 14, tagFacets)
        .filter((t) => !selectedTagSet.has(t.id) && !excludedTagSet.has(t.id))
        .map((t) => toEntry(t, getTagRollupCount(t)))
        .slice(0, 14);
    }

    const countsById = new Map<number, number>();
    const limit = Math.min(deferredSamples.length, 2000);
    for (let i = 0; i < limit; i++) {
      const rowTags = deferredSamples[i].tags;
      for (let j = 0; j < rowTags.length; j++) {
        const tid = rowTags[j].id;
        countsById.set(tid, (countsById.get(tid) || 0) + 1);
      }
    }

    const domainCandidates = tags.filter((t) => {
      if (selectedTagSet.has(t.id) || excludedTagSet.has(t.id)) return false;
      const f = resolveTagFacetSlug(t, tagFacets);
      return resolveFacetDomain(f, tagFacets) === "tags";
    });
    const leafOnly = domainCandidates.filter(
      (t) => (taxonomyIndex.childrenByParentId.get(t.id)?.length ?? 0) === 0
    );
    const pool = leafOnly.length > 0 ? leafOnly : domainCandidates;
    const totalScanned = limit;

    return pool
      .map((t) => toEntry(t, countsById.get(t.id) || 0))
      .filter((item) => item.matchCount > 0)
      .sort((a, b) => {
        if (tagMatchMode === "all" && totalScanned > 1) {
          const aNarrows = a.matchCount < totalScanned;
          const bNarrows = b.matchCount < totalScanned;
          if (aNarrows !== bNarrows) return aNarrows ? -1 : 1;
        }
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return a.tag.name.localeCompare(b.tag.name);
      })
      .slice(0, 14);
  }, [
    deferredSamples,
    hasActiveFilter,
    tags,
    tagFacets,
    taxonomyIndex,
    selectedTagSet,
    excludedTagSet,
    tagMatchMode,
  ]);

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
      setOverflowPos((prev) =>
        prev.top === top && prev.right === right ? prev : { top, right }
      );
    };
    const onScroll = (ev: Event) => {
      const trigger = overflowTriggerRef.current;
      if (!trigger) return;
      const target = ev.target;
      if (
        target === window ||
        target === document ||
        (target instanceof Node && target.contains(trigger))
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
        e.preventDefault();
        e.stopPropagation();
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
    <div
      ref={cloudContainerRef}
      className="relative flex-1 min-w-0 flex items-center justify-end gap-1 py-0.5"
    >
      {suggestedTags.length > 0 && (
        <>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-3 mr-0.5 shrink-0"
            title="Top matching tags in current results (Click to toggle multi-tag filter, Alt+Click to exclude)"
          >
            <Hash className="w-3 h-3" />
          </span>

          {visibleTags.map(
            ({ tag, matchCount, isSelected, isSource, color, breadcrumb }) => (
              <button
                key={tag.id}
                type="button"
                onClick={(e) => {
                  if (e.altKey) {
                    toggleExcludeTagFilter(tag.id);
                  } else {
                    toggleTagFilter(tag.id);
                  }
                }}
                className={`h-[22px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 shrink-0 transition-colors ${
                  isSelected
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
                title={`${breadcrumb} (${matchCount.toLocaleString()} in current view) — Click to refine filter · Alt+Click to exclude`}
              >
                {isSource ? (
                  <span className="font-mono text-[10px] opacity-80 shrink-0">
                    #
                  </span>
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-[2px] shrink-0"
                    style={{ backgroundColor: color }}
                  />
                )}
                <span className="truncate max-w-[96px]">{tag.name}</span>
                <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
                  {matchCount.toLocaleString()}
                </span>
              </button>
            )
          )}

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

          {showTagOverflow && overflowTags.length > 0 && (
            <Suspense fallback={null}>
              <ToolbarTagOverflowPopover
                popoverRef={overflowPopoverRef}
                pos={overflowPos}
                overflowTags={overflowTags}
                onToggleTag={toggleTagFilter}
                onExcludeTag={toggleExcludeTagFilter}
                onClose={() => setShowTagOverflow(false)}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
});
