import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeGetItem, safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { extractSearchPrefixValues } from "../../utils/searchPrefixHelpers";
import { getSharedTaxonomyIndex } from "../../utils/taxonomyTree";
import type { FilterDrawerTabId } from "./FilterDrawerPanels";

const LazyFilterDrawerPanel = lazy(() =>
  import("./FilterDrawerPanels").then((m) => ({
    default: m.FilterDrawerPanel,
  }))
);

const DRAWER_OPEN_KEY = AUDIFY_STORAGE_KEYS.filterDrawerOpen;
const DRAWER_TAB_KEY = AUDIFY_STORAGE_KEYS.filterDrawerTab;
const DRAWER_HEIGHT_KEY = AUDIFY_STORAGE_KEYS.filterDrawerHeight;
const DRAWER_COMPACT_HEIGHT_KEY = AUDIFY_STORAGE_KEYS.filterDrawerCompactHeight;

const DEFAULT_DRAWER_HEIGHT = 88;
const MIN_DRAWER_HEIGHT = 76;
const MAX_DRAWER_HEIGHT = 260;

const DEFAULT_COMPACT_DRAWER_HEIGHT = 74;
const MIN_COMPACT_DRAWER_HEIGHT = 68;
const MAX_COMPACT_DRAWER_HEIGHT = 220;

function clampDrawerHeight(raw: number, compact: boolean): number {
  const minH = compact ? MIN_COMPACT_DRAWER_HEIGHT : MIN_DRAWER_HEIGHT;
  const maxH = compact ? MAX_COMPACT_DRAWER_HEIGHT : MAX_DRAWER_HEIGHT;
  const viewportCap =
    typeof window !== "undefined" && window.innerHeight > 0
      ? Math.max(
          compact ? 100 : 120,
          Math.floor(window.innerHeight * (compact ? 0.42 : 0.38))
        )
      : maxH;
  const maxAllowed = Math.min(maxH, viewportCap);
  return Math.max(minH, Math.min(maxAllowed, Math.round(raw)));
}

function loadInitialDrawerHeight(compact: boolean): number {
  const key = compact ? DRAWER_COMPACT_HEIGHT_KEY : DRAWER_HEIGHT_KEY;
  const minH = compact ? MIN_COMPACT_DRAWER_HEIGHT : MIN_DRAWER_HEIGHT;
  const defH = compact ? DEFAULT_COMPACT_DRAWER_HEIGHT : DEFAULT_DRAWER_HEIGHT;
  const saved = Number(safeGetItem(key));
  if (Number.isFinite(saved) && saved >= minH) {
    return clampDrawerHeight(saved, compact);
  }
  return defH;
}

const VALID_TABS: readonly FilterDrawerTabId[] = [
  "general",
  "type",
  "sample_rate",
  "genre",
  "tags",
  "bpm",
  "key",
];

export function useActiveDrawerFilterCount(): number {
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const recentOnly = useSampleStore((s) => s.recentOnly);
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const typeFilter = useSampleStore((s) => s.typeFilter);
  const srFilter = useSampleStore((s) => s.srFilter);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const excludedTagIds = useSampleStore((s) => s.excludedTagIds);
  const searchQuery = useSampleStore((s) => s.searchQuery);

  return useMemo(() => {
    let count = 0;
    if (favoriteOnly) count++;
    if (recentOnly) count++;
    if (binFilterActive) count++;
    if (slicesFilterActive) count++;
    if (duplicatesFilterActive) count++;
    if (trashFilterActive) count++;
    if (typeFilter !== "all") count++;
    if (srFilter !== null) count++;
    if (selectedGenre !== null) count++;
    count += selectedTagIds.length + excludedTagIds.length;
    count += extractSearchPrefixValues(searchQuery, "bpm:").length;
    count += extractSearchPrefixValues(searchQuery, "key:").length;
    return count;
  }, [
    favoriteOnly,
    recentOnly,
    binFilterActive,
    slicesFilterActive,
    duplicatesFilterActive,
    trashFilterActive,
    typeFilter,
    srFilter,
    selectedGenre,
    selectedTagIds.length,
    excludedTagIds.length,
    searchQuery,
  ]);
}

interface FilterDrawerProps {
  compact?: boolean;
}

export const FilterDrawer: React.FC<FilterDrawerProps> = React.memo(({
  compact = false,
}) => {
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const typeFilter = useSampleStore((s) => s.typeFilter);
  const srFilter = useSampleStore((s) => s.srFilter);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const excludedTagIds = useSampleStore((s) => s.excludedTagIds);
  const tags = useSampleStore((s) => s.tags);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const searchQuery = useSampleStore((s) => s.searchQuery);

  const isContextualToolsView = trashFilterActive || binFilterActive;

  const [isOpen, setIsOpen] = useState<boolean>(
    () => isContextualToolsView || safeGetItem(DRAWER_OPEN_KEY) === "true"
  );

  const [activeTab, setActiveTab] = useState<FilterDrawerTabId>(() => {
    if (isContextualToolsView) return "general";
    const saved = safeGetItem(DRAWER_TAB_KEY) as FilterDrawerTabId | null;
    return saved && VALID_TABS.includes(saved) ? saved : "general";
  });

  const [drawerHeight, setDrawerHeight] = useState<number>(() =>
    loadInitialDrawerHeight(compact)
  );
  const [isResizing, setIsResizing] = useState(false);
  const drawerHeightRef = useRef<number>(drawerHeight);
  drawerHeightRef.current = drawerHeight;

  useEffect(() => {
    setDrawerHeight(loadInitialDrawerHeight(compact));
  }, [compact]);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startHeight = drawerHeightRef.current;
      let latestHeight = startHeight;
      const storageKey = compact ? DRAWER_COMPACT_HEIGHT_KEY : DRAWER_HEIGHT_KEY;
      setIsResizing(true);

      const onPointerMove = (ev: PointerEvent) => {
        const deltaY = startY - ev.clientY;
        latestHeight = clampDrawerHeight(startHeight + deltaY, compact);
        setDrawerHeight(latestHeight);
      };
      const onPointerUp = () => {
        setIsResizing(false);
        safeSetItem(storageKey, String(latestHeight));
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [compact]
  );

  const handleResetDrawerHeight = useCallback(() => {
    const defH = compact ? DEFAULT_COMPACT_DRAWER_HEIGHT : DEFAULT_DRAWER_HEIGHT;
    const storageKey = compact ? DRAWER_COMPACT_HEIGHT_KEY : DRAWER_HEIGHT_KEY;
    setDrawerHeight(defH);
    safeSetItem(storageKey, String(defH));
  }, [compact]);

  const prevContextualActiveRef = useRef<boolean>(isContextualToolsView);
  const preContextualDrawerStateRef = useRef<{
    isOpen: boolean;
    activeTab: FilterDrawerTabId;
  } | null>(
    isContextualToolsView
      ? {
          isOpen: safeGetItem(DRAWER_OPEN_KEY) === "true",
          activeTab: (() => {
            const saved = safeGetItem(DRAWER_TAB_KEY) as FilterDrawerTabId | null;
            return saved && VALID_TABS.includes(saved) ? saved : "general";
          })(),
        }
      : null
  );

  // Auto-expand FilterDrawer to Tools when Trash or Session Bin opens, and restore user's prior drawer state on exit
  useEffect(() => {
    const wasActive = prevContextualActiveRef.current;
    prevContextualActiveRef.current = isContextualToolsView;

    if (!wasActive && isContextualToolsView) {
      preContextualDrawerStateRef.current = { isOpen, activeTab };
      setActiveTab("general");
      setIsOpen(true);
    } else if (
      wasActive &&
      !isContextualToolsView &&
      preContextualDrawerStateRef.current
    ) {
      const saved = preContextualDrawerStateRef.current;
      preContextualDrawerStateRef.current = null;
      setIsOpen(saved.isOpen);
      setActiveTab(saved.activeTab);
    }
  }, [isContextualToolsView, isOpen, activeTab]);

  useEffect(() => {
    if (isContextualToolsView) return;
    safeSetItem(DRAWER_OPEN_KEY, String(isOpen), {
      broadcast: false,
      markEdited: false,
    });
    safeSetItem(DRAWER_TAB_KEY, activeTab, {
      broadcast: false,
      markEdited: false,
    });
  }, [isOpen, activeTab, isContextualToolsView]);

  const activeCount = useActiveDrawerFilterCount();

  const bpmTokens = useMemo(
    () => extractSearchPrefixValues(searchQuery, "bpm:"),
    [searchQuery]
  );
  const keyTokens = useMemo(
    () => extractSearchPrefixValues(searchQuery, "key:"),
    [searchQuery]
  );

  const { hasGenreActive, hasTagsActive } = useMemo(() => {
    const taxonomy = getSharedTaxonomyIndex(tags, tagFacets);
    let genreHit = selectedGenre !== null;
    let tagHit = false;
    const checkId = (id: number) => {
      if (taxonomy.domainByTagId.get(id) === "genres") {
        genreHit = true;
      } else {
        tagHit = true;
      }
    };
    for (let i = 0; i < selectedTagIds.length; i++) checkId(selectedTagIds[i]);
    for (let i = 0; i < excludedTagIds.length; i++) checkId(excludedTagIds[i]);
    return { hasGenreActive: genreHit, hasTagsActive: tagHit };
  }, [tags, tagFacets, selectedGenre, selectedTagIds, excludedTagIds]);

  const tabs: Array<{
    id: FilterDrawerTabId;
    label: string;
    shortLabel: string;
    hasActive: boolean;
  }> = [
    {
      id: "general",
      label: "Tools",
      shortLabel: "Tools",
      hasActive:
        binFilterActive ||
        slicesFilterActive ||
        duplicatesFilterActive ||
        trashFilterActive,
    },
    {
      id: "type",
      label: "Type",
      shortLabel: "Type",
      hasActive: typeFilter !== "all",
    },
    {
      id: "sample_rate",
      label: "Sample Rate",
      shortLabel: "Rate",
      hasActive: srFilter !== null,
    },
    {
      id: "genre",
      label: "Genre",
      shortLabel: "Genre",
      hasActive: hasGenreActive,
    },
    {
      id: "tags",
      label: "Tags",
      shortLabel: "Tags",
      hasActive: hasTagsActive,
    },
    {
      id: "bpm",
      label: "BPM",
      shortLabel: "BPM",
      hasActive: bpmTokens.length > 0,
    },
    {
      id: "key",
      label: "Key",
      shortLabel: "Key",
      hasActive: keyTokens.length > 0,
    },
  ];

  const handleTabClick = (tabId: FilterDrawerTabId) => {
    if (isOpen && activeTab === tabId) {
      setIsOpen(false);
    } else {
      setActiveTab(tabId);
      setIsOpen(true);
    }
  };

  return (
    <div className="relative border-t border-line bg-surface-1 shrink-0 select-none">
      {isOpen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize filter drawer"
          data-testid="filter-drawer-resize-handle"
          onPointerDown={handleResizePointerDown}
          onDoubleClick={handleResetDrawerHeight}
          title="Drag to resize filter drawer (double-click to reset)"
          className="group absolute -top-[3px] left-0 right-0 h-[6px] cursor-ns-resize z-20 flex items-center"
        >
          <div
            className={`w-full h-[2px] transition-colors ${
              isResizing
                ? "bg-accent"
                : "bg-transparent group-hover:bg-accent/60"
            }`}
          />
        </div>
      )}
      <div className="h-[28px] px-2 flex items-center gap-0.5 text-[11.5px] text-fg-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span
          className={`inline-flex items-center gap-1.5 ${
            compact ? "mr-1" : "mr-2"
          } shrink-0`}
          title="Filter Drawer"
        >
          <SlidersHorizontal className="w-3 h-3 text-fg-3 shrink-0" />
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-fg-3 hidden sm:inline">
            FILTERS
          </span>
          <span
            className={`min-w-[18px] h-[16px] px-1 rounded-[3px] font-mono tabular-nums text-[9.5px] font-bold inline-flex items-center justify-center transition-colors ${
              activeCount > 0
                ? "bg-accent text-accent-on"
                : "bg-surface-3 border border-line text-fg-2"
            }`}
          >
            {activeCount}
          </span>
        </span>

        {tabs.map((t) => {
          const isTabActive = isOpen && activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleTabClick(t.id)}
              className={`relative h-full ${
                compact ? "px-1.5 text-[11px]" : "px-2.5 text-[11.5px]"
              } border-b-2 inline-flex items-center whitespace-nowrap shrink-0 transition-colors ${
                isTabActive
                  ? "text-fg border-b-accent font-medium"
                  : "text-fg-2 hover:text-fg border-b-transparent"
              }`}
            >
              <span>{compact ? t.shortLabel : t.label}</span>
              {t.hasActive && (
                <span className="absolute top-1.5 right-0.5 w-1.5 h-1.5 rounded-[1px] bg-accent" />
              )}
            </button>
          );
        })}

        <div className="flex-1 min-w-[4px]" />

        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-[22px] h-[22px] rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3 transition-colors shrink-0"
          title={isOpen ? "Collapse filter drawer" : "Expand filter drawer"}
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {isOpen && (
        <div
          data-testid="filter-drawer-body"
          style={{ height: `${drawerHeight}px` }}
          className={`border-t border-line-subtle bg-surface-1 ${
            compact ? "px-2 py-1.5" : "px-3 py-2"
          } ${
            activeTab === "tags" || activeTab === "genre"
              ? "overflow-hidden"
              : "overflow-y-auto"
          }`}
        >
          <Suspense fallback={null}>
            <LazyFilterDrawerPanel
              activeTab={activeTab}
              compact={compact}
              bpmTokens={bpmTokens}
              keyTokens={keyTokens}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
});
