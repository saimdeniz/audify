import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, Sparkles, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { setEdgePeekCollapsedState } from "../../utils/appFocusMonitor";
import {
  isOsDragCurrentlyInFlight,
  startNativePitchedSampleDrag,
  startNativeSampleDrag,
} from "../../utils/drag";
import { LeftSidebar } from "../LeftSidebar";
import { ActiveFilterBanner } from "../sample-table/ActiveFilterBanner";
import { FilterDrawer } from "../sample-table/FilterDrawer";
import { WaveformDeckCanvas } from "../transport/WaveformDeckCanvas";
import {
  MiniContextMenuState,
  MiniDockContextMenu,
} from "./MiniDockContextMenu";
import { MiniDockHeader } from "./MiniDockHeader";
import { MiniDockList } from "./MiniDockList";
import { MiniDockSortDropdown } from "./MiniDockSortDropdown";
import { MiniDockTransport } from "./MiniDockTransport";

const LazySlicesTableView = lazy(() =>
  import("../sample-table/SlicesTableView").then((m) => ({
    default: m.SlicesTableView,
  }))
);

export const MiniDockShell: React.FC = () => {
  const samples = useSampleStore((s) => s.samples);
  const totalProfileSamplesCount = useSampleStore(
    (s) => s.allProfileSamples.length || s.samples.length
  );
  const searchQuery = useSampleStore((s) => s.searchQuery);
  const smartSearchSynonyms = useSampleStore((s) => s.smartSearchSynonyms);
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);
  const statusMessage = useSampleStore((s) => s.statusMessage);
  const miniDockShortcut = useSampleStore((s) => s.shortcuts.toggleMiniDock);
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const miniDockEdgePeek = useSampleStore((s) => s.miniDockEdgePeek);
  const miniDockEdgeSide = useSampleStore((s) => s.miniDockEdgeSide);
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);

  const setSearchQuery = useSampleStore((s) => s.setSearchQuery);
  const setSmartSearchSynonyms = useSampleStore(
    (s) => s.setSmartSearchSynonyms
  );
  const setInAppDragSample = useSampleStore((s) => s.setInAppDragSample);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);

  const showSlicesTable =
    slicesFilterActive || (trashFilterActive && trashViewTab === "slices");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const osDragCleanupTimerRef = useRef<number | null>(null);
  const [miniContextMenu, setMiniContextMenu] =
    useState<MiniContextMenuState | null>(null);
  const [batchPopover, setBatchPopover] = useState<
    "collection" | "tag" | "genre" | null
  >(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Sync Windows Edge-Peek controller with store preference & pause animations when collapsed
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void listen<{ enabled: boolean; collapsed: boolean; side: string }>(
      "audify:edge-peek-state",
      (ev) => {
        if (!active || !ev.payload) return;
        setEdgePeekCollapsedState(
          Boolean(ev.payload.enabled && ev.payload.collapsed)
        );
      }
    )
      .then((fn) => {
        if (!active) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      active = false;
      setEdgePeekCollapsedState(false);
      unlisten?.();
    };
  }, []);

  // Push live theme & accent RGB colors to the native Win32 Edge-Peek pill
  useEffect(() => {
    const surfaceHex =
      themeMode === "light"
        ? "#EAECEF"
        : themeMode === "contrast"
          ? "#050505"
          : "#141417";
    const borderHex =
      themeMode === "light"
        ? "#B0B4C2"
        : themeMode === "contrast"
          ? "#666666"
          : "#2E2E38";
    const accentHex = /^#[0-9a-f]{6}$/i.test(accentColor)
      ? accentColor
      : "#38BDF8";
    void invoke("mini_dock_edge_peek_set_theme", {
      surfaceHex,
      borderHex,
      accentHex,
      isLight: themeMode === "light",
    }).catch(() => {});
  }, [themeMode, accentColor, miniDockEdgePeek]);

  useEffect(() => {
    if (!miniDockEdgePeek) {
      setEdgePeekCollapsedState(false);
    }
    void invoke("mini_dock_set_edge_peek", {
      enabled: miniDockEdgePeek,
      side: miniDockEdgeSide,
    }).catch(() => {});
  }, [miniDockEdgePeek, miniDockEdgeSide]);

  useEffect(() => {
    return () => {
      setEdgePeekCollapsedState(false);
      void invoke("mini_dock_set_edge_peek", {
        enabled: false,
        side: null,
      }).catch(() => {});
    };
  }, []);

  // Keep Edge-Peek expanded whenever menus, modals, popovers, or search input are active
  useEffect(() => {
    if (!miniDockEdgePeek) return;
    const syncHold = () => {
      const hasPortal = Boolean(
        document.querySelector(
          "[data-context-menu-portal], [data-quick-create-portal], [data-color-picker-portal], [data-modal-portal], [role='dialog'], [role='menu'], [role='listbox']"
        )
      );
      const shouldHold =
        hasPortal ||
        miniContextMenu !== null ||
        batchPopover !== null ||
        isSearchFocused;
      void invoke("mini_dock_edge_peek_set_hold", { hold: shouldHold }).catch(
        () => {}
      );
    };
    syncHold();
    const observer = new MutationObserver(syncHold);
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      void invoke("mini_dock_edge_peek_set_hold", { hold: false }).catch(
        () => {}
      );
    };
  }, [miniDockEdgePeek, miniContextMenu, batchPopover, isSearchFocused]);

  useEffect(() => {
    return () => {
      if (osDragCleanupTimerRef.current !== null) {
        window.clearTimeout(osDragCleanupTimerRef.current);
      }
    };
  }, []);

  // Ctrl+F focuses Mini Dock search input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (
          useSampleStore.getState().isSettingsOpen ||
          document.querySelector(
            "[data-modal-portal='true'], [data-shortcut-recorder='true']"
          )
        ) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close mini context menu or batch popover on outside click or Escape
  useEffect(() => {
    if (!miniContextMenu && !batchPopover) return;
    const close = () => {
      setMiniContextMenu(null);
      setBatchPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMiniContextMenu(null);
        setBatchPopover(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [miniContextMenu, batchPopover]);

  const startSampleDrag = useCallback(
    async (paths: string[], sourceSample: SampleItem) => {
      if (osDragCleanupTimerRef.current !== null) {
        window.clearTimeout(osDragCleanupTimerRef.current);
        osDragCleanupTimerRef.current = null;
      }
      setInAppDragSample(sourceSample);

      try {
        const { pitchSemitones: livePitch, sliceMicroFade: liveFade } =
          useSampleStore.getState();
        const shouldExportPitched =
          paths.length === 1 && Math.abs(livePitch) >= 0.01;

        const droppedExternally = shouldExportPitched
          ? await startNativePitchedSampleDrag(
              sourceSample,
              livePitch,
              liveFade
            )
          : await startNativeSampleDrag(
              paths,
              paths.length > 1
                ? `${paths.length} samples selected`
                : sourceSample.file_name
            );

        if (droppedExternally && autoBinOnNleDrag) {
          if (paths.length === 1) {
            addSamplesToBin([sourceSample.id]);
          } else {
            const pathSet = new Set(paths);
            const stateNow = useSampleStore.getState();
            const pool =
              stateNow.allProfileSamples.length > 0
                ? stateNow.allProfileSamples
                : stateNow.samples;
            const ids = pool
              .filter((s) => pathSet.has(s.file_path))
              .map((s) => s.id);
            if (ids.length > 0) addSamplesToBin(ids);
          }
        }
      } finally {
        osDragCleanupTimerRef.current = window.setTimeout(() => {
          osDragCleanupTimerRef.current = null;
          if (!isOsDragCurrentlyInFlight()) {
            setInAppDragSample(null);
          }
        }, 140);
      }
    },
    [
      autoBinOnNleDrag,
      addSamplesToBin,
      setInAppDragSample,
    ]
  );

  return (
    <div className="flex flex-col h-full w-full audify-stage-surface text-fg overflow-hidden select-none">
      <MiniDockHeader />

      {/* Dock Body: Hover-Expand Sidebar Rail + Main Stack */}
      <div className="flex-1 flex flex-row min-h-0 relative overflow-hidden">
        <LeftSidebar mode="mini-overlay" />

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <MiniDockTransport />

          <div className="h-[92px] flex flex-col border-b border-line shrink-0">
            <WaveformDeckCanvas />
          </div>

          {/* Search Bar with Bilingual UCS Synonym Toggle */}
          <div className="bg-surface-1 border-b border-line px-2 py-1.5 flex items-center gap-1.5 shrink-0">
            <div
              data-search-keep-focus="true"
              className="flex-1 min-w-0 flex items-center bg-surface-3 border border-line-strong focus-within:border-accent rounded-xs h-[28px] pl-2.5 pr-1"
            >
              <Search className="w-3.5 h-3.5 text-fg-2 mr-2 shrink-0" />
              <input
                ref={searchInputRef}
                data-search-input="true"
                type="text"
                value={searchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    if (searchQuery) setSearchQuery("");
                    e.currentTarget.blur();
                  } else if (e.key === "ArrowDown" || e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Search samples..."
                className="bg-transparent border-none text-[12px] text-fg placeholder-fg-3 w-full focus:outline-none min-w-0"
              />
              {searchQuery && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setSearchQuery("")}
                  className="w-[20px] h-[20px] flex items-center justify-center text-fg-2 hover:text-fg shrink-0"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
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
            </div>
            {!showSlicesTable && <MiniDockSortDropdown />}
          </div>

          <ActiveFilterBanner />

          {showSlicesTable ? (
            <Suspense fallback={null}>
              <LazySlicesTableView />
            </Suspense>
          ) : (
            <MiniDockList
              onStartSampleDrag={startSampleDrag}
              onOpenContextMenu={setMiniContextMenu}
              batchPopover={batchPopover}
              setBatchPopover={setBatchPopover}
            />
          )}

          <FilterDrawer compact={true} />
        </div>
      </div>

      {/* Colored Compact Dock Status Footer */}
      <footer
        role="status"
        aria-live="polite"
        className="h-[22px] bg-accent-soft border-t border-accent/40 px-2.5 flex items-center justify-between font-mono text-[10px] text-accent-fg shrink-0"
      >
        <span className="truncate font-semibold">
          {statusMessage ||
            `${samples.length.toLocaleString()} / ${totalProfileSamplesCount.toLocaleString()} files`}
        </span>
        <span className="shrink-0 ml-1 opacity-90">
          {miniDockShortcut || "Ctrl+M"}
        </span>
      </footer>

      {miniContextMenu && (
        <MiniDockContextMenu
          menu={miniContextMenu}
          onClose={() => setMiniContextMenu(null)}
        />
      )}
    </div>
  );
};
