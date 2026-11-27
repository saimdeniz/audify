import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { setEdgePeekCollapsedState } from "../../utils/appFocusMonitor";
import {
  getActiveOsDragSample,
  isOsDragCurrentlyInFlight,
  setActiveOsDragSample,
  startNativePitchedSampleDrag,
  startNativeSampleDrag,
} from "../../utils/drag";
import { formatShortcutDisplay } from "../../utils/shortcuts";
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
import { MiniDockSearchBar } from "./MiniDockSearchBar";
import { MiniDockTransport } from "./MiniDockTransport";

const LazySlicesTableView = lazy(() =>
  import("../sample-table/SlicesTableView").then((m) => ({
    default: m.SlicesTableView,
  }))
);
const LazyMiniDockLayersList = lazy(() =>
  import("./MiniDockLayersList").then((m) => ({
    default: m.MiniDockLayersList,
  }))
);

export const MiniDockShell: React.FC = () => {
  const samples = useSampleStore((s) => s.samples);
  const totalProfileSamplesCount = useSampleStore(
    (s) => s.allProfileSamples.length || s.samples.length
  );
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);
  const statusMessage = useSampleStore((s) => s.statusMessage);
  const isScanning = useSampleStore((s) => s.isScanning);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);
  const miniDockShortcut = useSampleStore((s) => s.shortcuts.toggleMiniDock);
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const layersFilterActive = useSampleStore((s) => s.layersFilterActive);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const miniDockEdgePeek = useSampleStore((s) => s.miniDockEdgePeek);
  const miniDockEdgeSide = useSampleStore((s) => s.miniDockEdgeSide);
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);

  const setInAppDragSample = useSampleStore((s) => s.setInAppDragSample);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);

  const showSlicesTable =
    slicesFilterActive ||
    (trashFilterActive && trashViewTab === "slices") ||
    (favoriteOnly && favoritesViewTab === "slices");
  const showLayersList =
    layersFilterActive ||
    (trashFilterActive && trashViewTab === "layers") ||
    (favoriteOnly && favoritesViewTab === "layers");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const osDragSampleRef = useRef<SampleItem | null>(null);
  const osDragCleanupTimerRef = useRef<number | null>(null);
  const [miniContextMenu, setMiniContextMenu] =
    useState<MiniContextMenuState | null>(null);
  const [batchPopover, setBatchPopover] = useState<
    "collection" | "tag" | "genre" | null
  >(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Auto-clear transient status messages in Mini Dock (mirrors BottomStatusBar)
  useEffect(() => {
    if (!statusMessage || isScanning) return;
    const timer = window.setTimeout(() => {
      setStatusMessage(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [statusMessage, isScanning, setStatusMessage]);

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

  // Dynamic OS Drag <-> LeftSidebar / Waveform Bridge in Mini Dock
  useEffect(() => {
    const getSidebarRight = () =>
      document.querySelector("aside")?.getBoundingClientRect().right ?? 296;

    const onDragOver = (e: DragEvent) => {
      if (!isOsDragCurrentlyInFlight()) return;
      const shared = getActiveOsDragSample();
      const dragSample = shared?.sample ?? osDragSampleRef.current;
      if (!dragSample) return;
      if (useSampleStore.getState().inAppDragSample?.id !== dragSample.id) {
        setInAppDragSample(
          dragSample,
          shared
            ? { single: shared.single, origin: shared.origin }
            : { single: false, origin: "list" }
        );
      }
      if (e.clientX <= getSidebarRight()) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isOsDragCurrentlyInFlight()) return;
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        setInAppDragSample(null);
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      if (osDragCleanupTimerRef.current !== null) {
        window.clearTimeout(osDragCleanupTimerRef.current);
        osDragCleanupTimerRef.current = null;
      }
    };
  }, [setInAppDragSample]);

  const startSampleDrag = useCallback(
    async (paths: string[], sourceSample: SampleItem) => {
      if (osDragCleanupTimerRef.current !== null) {
        window.clearTimeout(osDragCleanupTimerRef.current);
        osDragCleanupTimerRef.current = null;
      }
      osDragSampleRef.current = sourceSample;
      setActiveOsDragSample(sourceSample, false, "list");
      setInAppDragSample(sourceSample, { single: false, origin: "list" });

      try {
        const {
          pitchSemitones: livePitch,
          sliceMicroFade: liveFade,
          exportLoudnessMode: liveLoudness,
        } = useSampleStore.getState();
        const withinRenderLimit =
          sourceSample.duration_ms > 0 && sourceSample.duration_ms <= 600_000;
        const shouldExportRendered =
          paths.length === 1 &&
          withinRenderLimit &&
          (Math.abs(livePitch) >= 0.01 || liveLoudness !== "off");

        const droppedExternally = shouldExportRendered
          ? await startNativePitchedSampleDrag(
              sourceSample,
              livePitch,
              liveFade,
              liveLoudness
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
            osDragSampleRef.current = null;
            setActiveOsDragSample(null);
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

          <MiniDockSearchBar
            searchInputRef={searchInputRef}
            showSlicesTable={showSlicesTable}
            onFocusChange={setIsSearchFocused}
          />

          <ActiveFilterBanner />

          {showSlicesTable ? (
            <Suspense fallback={null}>
              <LazySlicesTableView />
            </Suspense>
          ) : showLayersList ? (
            <Suspense fallback={null}>
              <LazyMiniDockLayersList />
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
        {statusMessage ? (
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            title="Click to dismiss"
            className="truncate font-semibold text-left hover:opacity-80 transition-opacity cursor-pointer"
          >
            {statusMessage}
          </button>
        ) : (
          <span className="truncate font-semibold">
            {`${samples.length.toLocaleString()} / ${totalProfileSamplesCount.toLocaleString()} files`}
          </span>
        )}
        <span className="shrink-0 ml-1 opacity-90">
          {formatShortcutDisplay(miniDockShortcut || "Ctrl+M")}
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
