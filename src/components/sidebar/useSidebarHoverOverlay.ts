import { useCallback, useEffect, useRef, useState } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import type { SidebarTab } from "../LeftSidebar";

function hasOpenFloatingPortal(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      "[data-context-menu-portal], [data-quick-create-portal], [data-color-picker-portal], [data-modal-portal]"
    )
  );
}

interface UseSidebarHoverOverlayParams {
  isHoverOverlayMode: boolean;
  railRef: React.RefObject<HTMLDivElement>;
  panelRef: React.RefObject<HTMLDivElement>;
  setActiveTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
}

export function useSidebarHoverOverlay({
  isHoverOverlayMode,
  railRef,
  panelRef,
  setActiveTab,
}: UseSidebarHoverOverlayParams) {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTabTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    if (hoverTabTimerRef.current) {
      clearTimeout(hoverTabTimerRef.current);
      hoverTabTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isHoverOverlayMode) {
      clearHoverTimers();
      setIsOverlayOpen(false);
    }
  }, [isHoverOverlayMode, clearHoverTimers]);

  const scheduleOverlayClose = useCallback(() => {
    if (!isHoverOverlayMode) return;
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverTabTimerRef.current) {
      clearTimeout(hoverTabTimerRef.current);
      hoverTabTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (
        hasOpenFloatingPortal() ||
        useSampleStore.getState().inAppDragSample !== null
      ) {
        return;
      }
      setIsOverlayOpen(false);
    }, 140);
  }, [isHoverOverlayMode]);

  const handleRailTabHoverEnter = useCallback(
    (tab: SidebarTab) => {
      if (!isHoverOverlayMode) return;
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
      if (!isOverlayOpen) {
        if (hoverOpenTimerRef.current) {
          clearTimeout(hoverOpenTimerRef.current);
        }
        hoverOpenTimerRef.current = setTimeout(() => {
          hoverOpenTimerRef.current = null;
          window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
          setActiveTab(tab);
          setIsOverlayOpen(true);
        }, 45);
      } else {
        if (hoverTabTimerRef.current) {
          clearTimeout(hoverTabTimerRef.current);
        }
        hoverTabTimerRef.current = setTimeout(() => {
          hoverTabTimerRef.current = null;
          setActiveTab(tab);
        }, 40);
      }
    },
    [isHoverOverlayMode, isOverlayOpen, setActiveTab]
  );

  const handleOverlayPanelEnter = useCallback(() => {
    if (!isHoverOverlayMode) return;
    clearHoverTimers();
  }, [isHoverOverlayMode, clearHoverTimers]);

  useEffect(() => {
    return () => clearHoverTimers();
  }, [clearHoverTimers]);

  useEffect(() => {
    if (!isHoverOverlayMode || !isOverlayOpen) return;
    const onMouseDownCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        railRef.current?.contains(target) ||
        panelRef.current?.contains(target) ||
        target.closest(
          "[data-context-menu-portal], [data-quick-create-portal], [data-color-picker-portal], [data-modal-portal]"
        )
      ) {
        return;
      }
      setIsOverlayOpen(false);
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !hasOpenFloatingPortal() &&
        !document.querySelector('[data-modal-portal="true"]')
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsOverlayOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDownCapture, true);
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDownCapture, true);
      window.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [isHoverOverlayMode, isOverlayOpen, railRef, panelRef]);

  return {
    isOverlayOpen,
    setIsOverlayOpen,
    scheduleOverlayClose,
    handleRailTabHoverEnter,
    handleOverlayPanelEnter,
  };
}
