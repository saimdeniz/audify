import { useCallback, useEffect, useRef, useState } from "react";
import type { SidebarTab } from "../store/types";
import { useSampleStore } from "../store/useSampleStore";

const SWITCHABLE_SIDEBAR_TABS: ReadonlySet<SidebarTab> = new Set([
  "folders",
  "collections",
  "tags",
  "genres",
  "licenses",
]);

interface CachedRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function toCachedRect(el: HTMLElement | null): CachedRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

function isPointInsideRect(
  rect: CachedRect | null,
  clientX: number,
  clientY: number
): boolean {
  if (!rect) return false;
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

interface UseLeftSidebarDragDropParams {
  isMiniOverlay: boolean;
  isOverlayOpen: boolean;
  isDraggingInApp: boolean;
  sidebarRef: React.RefObject<HTMLElement>;
  railRef: React.RefObject<HTMLDivElement>;
  panelRef: React.RefObject<HTMLDivElement>;
  setActiveTab: (tab: SidebarTab) => void;
  setIsOverlayOpen: (open: boolean) => void;
}

export function useLeftSidebarDragDrop({
  isMiniOverlay,
  isOverlayOpen,
  isDraggingInApp,
  sidebarRef,
  railRef,
  panelRef,
  setActiveTab,
  setIsOverlayOpen,
}: UseLeftSidebarDragDropParams) {
  const isOverlayOpenRef = useRef(isOverlayOpen);
  isOverlayOpenRef.current = isOverlayOpen;
  const isMiniOverlayRef = useRef(isMiniOverlay);
  isMiniOverlayRef.current = isMiniOverlay;
  const [dragHoverTarget, setDragHoverTarget] = useState<string | null>(null);
  const dragHoverTargetRef = useRef<string | null>(null);
  const [isPointerInSidebar, setIsPointerInSidebar] = useState(false);
  const isPointerInSidebarRef = useRef(false);
  const [hoveredRailTab, setHoveredRailTab] = useState<SidebarTab | null>(null);
  const hoveredRailTabRef = useRef<SidebarTab | null>(null);
  const [dropFlashTarget, setDropFlashTarget] = useState<string | null>(null);
  const dropFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabSwitchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoveredTabRef = useRef<SidebarTab | null>(null);
  const isExternalFileDragRef = useRef(false);
  const refreshCachedRectsRef = useRef<(() => void) | null>(null);

  const lastBroadcastHoverRef = useRef<{
    target: string | null;
    railTab: SidebarTab | null;
    inSidebar: boolean;
    overlayOpen: boolean;
    externalActive: boolean;
  } | null>(null);

  const updateDragHoverTarget = useCallback(
    (
      next: string | null,
      opts?: { railTab?: SidebarTab | null; inSidebar?: boolean }
    ) => {
      const nextRailTab = opts?.railTab ?? null;
      const nextInSidebar = opts?.inSidebar ?? false;
      const nextOverlayOpen =
        isMiniOverlayRef.current && isOverlayOpenRef.current;
      const nextExternalActive = isExternalFileDragRef.current;
      const prev = lastBroadcastHoverRef.current;
      if (
        prev &&
        prev.target === next &&
        prev.railTab === nextRailTab &&
        prev.inSidebar === nextInSidebar &&
        prev.overlayOpen === nextOverlayOpen &&
        prev.externalActive === nextExternalActive
      ) {
        return;
      }
      lastBroadcastHoverRef.current = {
        target: next,
        railTab: nextRailTab,
        inSidebar: nextInSidebar,
        overlayOpen: nextOverlayOpen,
        externalActive: nextExternalActive,
      };
      dragHoverTargetRef.current = next;
      if (opts?.railTab !== undefined) {
        hoveredRailTabRef.current = opts.railTab;
      }
      if (opts?.inSidebar !== undefined) {
        isPointerInSidebarRef.current = opts.inSidebar;
      }
      setDragHoverTarget((curr) => (curr === next ? curr : next));
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: nextExternalActive,
            dragHoverTarget: next,
            hoveredRailTab: nextRailTab,
            isPointerInSidebar: nextInSidebar,
            isSidebarOverlayOpen: nextOverlayOpen,
          },
        })
      );
    },
    []
  );

  // Re-sync overlay geometry and cached bounding rects immediately when the hover-overlay drawer opens/closes mid-drag
  useEffect(() => {
    if (!isDraggingInApp && !isExternalFileDragRef.current) return;
    refreshCachedRectsRef.current?.();
    const rafId = requestAnimationFrame(() => {
      refreshCachedRectsRef.current?.();
    });
    window.dispatchEvent(
      new CustomEvent("audify:folder-drop-overlay", {
        detail: {
          isExternalFileDragActive: isExternalFileDragRef.current,
          dragHoverTarget: dragHoverTargetRef.current,
          hoveredRailTab: hoveredRailTabRef.current,
          isPointerInSidebar: isPointerInSidebarRef.current,
          isSidebarOverlayOpen: isMiniOverlay && isOverlayOpen,
        },
      })
    );
    return () => cancelAnimationFrame(rafId);
  }, [isDraggingInApp, isMiniOverlay, isOverlayOpen]);

  const triggerDropFlash = useCallback(
    (targetKey: string) => {
      if (dropFlashTimerRef.current) {
        clearTimeout(dropFlashTimerRef.current);
      }
      setDropFlashTarget(targetKey);
      dropFlashTimerRef.current = setTimeout(() => {
        dropFlashTimerRef.current = null;
        setDropFlashTarget(null);
        if (isMiniOverlay) {
          setIsOverlayOpen(false);
        }
      }, 180);
    },
    [isMiniOverlay, setIsOverlayOpen]
  );

  useEffect(() => {
    return () => {
      if (dropFlashTimerRef.current) {
        clearTimeout(dropFlashTimerRef.current);
      }
    };
  }, []);

  const cancelDragTabSwitch = useCallback(() => {
    lastHoveredTabRef.current = null;
    if (tabSwitchTimer.current) {
      clearTimeout(tabSwitchTimer.current);
      tabSwitchTimer.current = null;
    }
  }, []);

  const scheduleDragTabSwitch = useCallback(
    (tab: SidebarTab) => {
      if (!SWITCHABLE_SIDEBAR_TABS.has(tab)) return;
      if (
        !useSampleStore.getState().inAppDragSample &&
        !isExternalFileDragRef.current
      ) {
        return;
      }
      if (lastHoveredTabRef.current === tab && tabSwitchTimer.current) return;
      cancelDragTabSwitch();
      lastHoveredTabRef.current = tab;
      tabSwitchTimer.current = setTimeout(() => {
        setActiveTab(tab);
        if (isMiniOverlay) {
          setIsOverlayOpen(true);
        }
        tabSwitchTimer.current = null;
      }, 170);
    },
    [cancelDragTabSwitch, isMiniOverlay, setActiveTab, setIsOverlayOpen]
  );

  useEffect(() => {
    return () => cancelDragTabSwitch();
  }, [cancelDragTabSwitch]);

  /**
   * Single authoritative drop executor for all sidebar targets (Folders, Favorites,
   * Collections, Tags, Genres, Session Bin, Trash). Synchronously clears `inAppDragSample`
   * via `getState()` before invoking async mutations so drops execute strictly 1x.
   */
  const executeSidebarDropTarget = useCallback(
    async (targetKey: string) => {
      const state = useSampleStore.getState();
      if (!state.inAppDragSample) return;

      const dragged =
        state.inAppDragSamples.length > 0
          ? state.inAppDragSamples
          : [state.inAppDragSample];

      state.setInAppDragSample(null);
      updateDragHoverTarget(null);
      setIsPointerInSidebar(false);
      setHoveredRailTab(null);
      cancelDragTabSwitch();
      triggerDropFlash(targetKey);

      if (targetKey === "bin") {
        state.addSamplesToBin(dragged.map((s) => s.id));
        return;
      }

      if (targetKey === "trash") {
        if (state.enableAdvancedFileOps) {
          await state.requestMoveSamplesToTrash(dragged.map((s) => s.id));
        }
        return;
      }

      if (targetKey.startsWith("folder:")) {
        if (!state.enableAdvancedFileOps) return;
        const rest = targetKey.slice("folder:".length);
        const sepIdx = rest.indexOf(":");
        if (sepIdx < 0) return;
        const libId = parseInt(rest.slice(0, sepIdx), 10);
        const folderPath = rest.slice(sepIdx + 1);
        if (Number.isNaN(libId) || !folderPath) return;
        await state.moveSamplesToFolder(
          dragged.map((s) => s.id),
          libId,
          folderPath,
          "prompt"
        );
        return;
      }

      if (targetKey === "favorites") {
        if (dragged.length > 1) {
          await state.toggleFavoritesBatch(
            dragged.map((s) => s.id),
            true
          );
        } else {
          await state.ensureFavorite(dragged[0]);
        }
        return;
      }

      if (targetKey.startsWith("col-")) {
        const colId = parseInt(targetKey.slice(4), 10);
        if (Number.isNaN(colId)) return;
        const col = state.collections.find((c) => c.id === colId);
        if (col?.smart_query?.trim()) return;
        const isRoot = Boolean(col && !col.parent_id);
        const hasChildren = state.collections.some(
          (c) => c.parent_id === colId
        );
        if (isRoot && hasChildren && state.autoRouteCollectionDrops) {
          await state.addAutoRoutedSamplesToCollection(colId, dragged);
        } else if (dragged.length > 1) {
          await state.addSamplesToCollectionBatch(
            colId,
            dragged.map((s) => s.id)
          );
        } else {
          await state.addToCollection(colId, dragged[0].id);
        }
        return;
      }

      if (targetKey.startsWith("tag-")) {
        const tagId = parseInt(targetKey.slice(4), 10);
        if (Number.isNaN(tagId)) return;
        if (dragged.length > 1) {
          await state.assignTagBatch(
            dragged.map((s) => s.id),
            tagId
          );
        } else {
          await state.assignTag(dragged[0].id, tagId);
        }
        return;
      }

      if (targetKey.startsWith("genre-")) {
        const genreName = targetKey.slice(6);
        if (!genreName) return;
        if (dragged.length > 1) {
          await state.assignGenreBatch(
            dragged.map((s) => s.id),
            genreName
          );
        } else {
          await state.assignGenre(dragged[0].id, genreName);
        }
      }
    },
    [cancelDragTabSwitch, triggerDropFlash, updateDragHoverTarget]
  );

  // Unified pointer + OS drag tracking inside LeftSidebar bounds
  useEffect(() => {
    if (!isDraggingInApp) {
      updateDragHoverTarget(null);
      setIsPointerInSidebar(false);
      setHoveredRailTab(null);
      cancelDragTabSwitch();
      return;
    }

    let cachedSidebarRect = toCachedRect(sidebarRef.current);
    let cachedRailRect = toCachedRect(railRef.current);
    let cachedPanelRect = toCachedRect(panelRef.current);

    const refreshCachedRects = () => {
      cachedSidebarRect = toCachedRect(sidebarRef.current);
      cachedRailRect = toCachedRect(railRef.current);
      cachedPanelRect = toCachedRect(panelRef.current);
    };
    refreshCachedRectsRef.current = refreshCachedRects;

    const panelEl = panelRef.current;
    panelEl?.addEventListener("transitionend", refreshCachedRects);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(refreshCachedRects)
        : null;
    if (resizeObserver) {
      if (sidebarRef.current) resizeObserver.observe(sidebarRef.current);
      if (railRef.current) resizeObserver.observe(railRef.current);
      if (panelRef.current) resizeObserver.observe(panelRef.current);
    }
    window.addEventListener("resize", refreshCachedRects);

    const isInsideSidebarBounds = (clientX: number, clientY: number) => {
      if (isMiniOverlay) {
        if (!cachedRailRect && railRef.current) {
          cachedRailRect = toCachedRect(railRef.current);
          resizeObserver?.observe(railRef.current);
        }
        if (isPointInsideRect(cachedRailRect, clientX, clientY)) {
          return true;
        }
        if (!isOverlayOpenRef.current) {
          return false;
        }
        if (!cachedPanelRect && panelRef.current) {
          cachedPanelRect = toCachedRect(panelRef.current);
          resizeObserver?.observe(panelRef.current);
        }
        return isPointInsideRect(cachedPanelRect, clientX, clientY);
      }
      if (!cachedSidebarRect && sidebarRef.current) {
        cachedSidebarRect = toCachedRect(sidebarRef.current);
        resizeObserver?.observe(sidebarRef.current);
      }
      if (!cachedSidebarRect) return clientX >= 0 && clientX <= 296;
      return isPointInsideRect(cachedSidebarRect, clientX, clientY);
    };

    const updateSidebarHoverAtPoint = (clientX: number, clientY: number) => {
      if (!isInsideSidebarBounds(clientX, clientY)) {
        setIsPointerInSidebar(false);
        setHoveredRailTab(null);
        updateDragHoverTarget(null, { railTab: null, inSidebar: false });
        cancelDragTabSwitch();
        if (isMiniOverlay) {
          setIsOverlayOpen(false);
        }
        return;
      }
      setIsPointerInSidebar(true);
      const hitEl = document.elementFromPoint(
        clientX,
        clientY
      ) as HTMLElement | null;
      if (!hitEl) {
        setHoveredRailTab(null);
        updateDragHoverTarget(null, { railTab: null, inSidebar: true });
        cancelDragTabSwitch();
        return;
      }

      let nextRailTab: SidebarTab | null = null;
      const tabBtn = hitEl.closest<HTMLElement>("[data-sidebar-tab]");
      if (tabBtn?.dataset.sidebarTab) {
        const t = tabBtn.dataset.sidebarTab as SidebarTab;
        if (SWITCHABLE_SIDEBAR_TABS.has(t)) {
          nextRailTab = t;
          setHoveredRailTab(t);
          if (isMiniOverlay) {
            setActiveTab(t);
            setIsOverlayOpen(true);
          } else {
            scheduleDragTabSwitch(t);
          }
        } else {
          setHoveredRailTab(null);
          cancelDragTabSwitch();
        }
      } else {
        setHoveredRailTab(null);
        cancelDragTabSwitch();
      }

      const dropEl = hitEl.closest<HTMLElement>("[data-sidebar-drop]");
      updateDragHoverTarget(dropEl?.dataset.sidebarDrop || null, {
        railTab: nextRailTab,
        inSidebar: true,
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      updateSidebarHoverAtPoint(e.clientX, e.clientY);
    };

    const onDragOver = (e: DragEvent) => {
      if (isInsideSidebarBounds(e.clientX, e.clientY)) {
        e.preventDefault();
      }
      updateSidebarHoverAtPoint(e.clientX, e.clientY);
    };

    const resolveDropKeyAtPoint = (clientX: number, clientY: number) => {
      const hitEl = document.elementFromPoint(
        clientX,
        clientY
      ) as HTMLElement | null;
      const dropEl = hitEl?.closest<HTMLElement>("[data-sidebar-drop]");
      return dropEl?.dataset.sidebarDrop || dragHoverTargetRef.current;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isInsideSidebarBounds(e.clientX, e.clientY)) {
        const key = resolveDropKeyAtPoint(e.clientX, e.clientY);
        if (key) {
          void executeSidebarDropTarget(key);
        }
      }
    };

    const onDrop = (e: DragEvent) => {
      if (isInsideSidebarBounds(e.clientX, e.clientY)) {
        e.preventDefault();
        const key = resolveDropKeyAtPoint(e.clientX, e.clientY);
        if (key) {
          void executeSidebarDropTarget(key);
        }
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      refreshCachedRectsRef.current = null;
      panelEl?.removeEventListener("transitionend", refreshCachedRects);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refreshCachedRects);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [
    isDraggingInApp,
    isMiniOverlay,
    railRef,
    panelRef,
    sidebarRef,
    setActiveTab,
    setIsOverlayOpen,
    cancelDragTabSwitch,
    scheduleDragTabSwitch,
    executeSidebarDropTarget,
    updateDragHoverTarget,
  ]);

  return {
    dragHoverTarget,
    dragHoverTargetRef,
    isPointerInSidebar,
    setIsPointerInSidebar,
    hoveredRailTab,
    setHoveredRailTab,
    dropFlashTarget,
    isExternalFileDragRef,
    updateDragHoverTarget,
    triggerDropFlash,
    cancelDragTabSwitch,
    scheduleDragTabSwitch,
  };
}
