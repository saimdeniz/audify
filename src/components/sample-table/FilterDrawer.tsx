import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeGetItem, safeSetItem } from "../../store/storageHelpers";
import { useSampleStore } from "../../store/useSampleStore";
import { extractSearchPrefixValues } from "../../utils/searchPrefixHelpers";
import type { FilterDrawerTabId } from "./FilterDrawerPanels";

const LazyFilterDrawerPanel = lazy(() =>
  import("./FilterDrawerPanels").then((m) => ({
    default: m.FilterDrawerPanel,
  }))
);

const DRAWER_OPEN_KEY = AUDIFY_STORAGE_KEYS.filterDrawerOpen;
const DRAWER_TAB_KEY = AUDIFY_STORAGE_KEYS.filterDrawerTab;

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
    count += selectedTagIds.length;
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
      hasActive: selectedGenre !== null,
    },
    {
      id: "tags",
      label: "Tags",
      shortLabel: "Tags",
      hasActive: selectedTagIds.length > 0,
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
    <div className="border-t border-line bg-surface-1 shrink-0 select-none">
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
          className={`border-t border-line-subtle bg-surface-1 overflow-y-auto ${
            compact
              ? "h-[74px] px-2 py-1.5"
              : `px-3 py-2 ${
                  activeTab === "general" &&
                  (slicesFilterActive ||
                    duplicatesFilterActive ||
                    trashFilterActive)
                    ? "min-h-[88px] max-h-[126px]"
                    : "h-[88px]"
                }`
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
