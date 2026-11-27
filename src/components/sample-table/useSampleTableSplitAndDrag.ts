import React, { useCallback, useEffect, useRef, useState } from "react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeGetItem, safeSetItem } from "../../utils/localStorageSafe";

export function useSampleTableSplitAndDrag(hasInAppDrag: boolean) {
  const splitStageRef = useRef<HTMLDivElement>(null);
  const [librarySplitPct, setLibrarySplitPct] = useState<number>(() => {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.layerSplitRatioV1);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed)
      ? Math.max(18, Math.min(68, Math.round(parsed)))
      : 36;
  });

  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitResizeCleanupRef = useRef<(() => void) | null>(null);
  const [dragOverlayArmed, setDragOverlayArmed] = useState(false);

  useEffect(() => () => splitResizeCleanupRef.current?.(), []);

  useEffect(() => {
    if (dragOverlayArmed) return;
    if (hasInAppDrag) {
      setDragOverlayArmed(true);
      return;
    }
    const onOverlayEvt = (e: Event) => {
      const detail = (
        e as CustomEvent<{ isExternalFileDragActive?: boolean }>
      ).detail;
      if (detail?.isExternalFileDragActive) {
        setDragOverlayArmed(true);
      }
    };
    window.addEventListener("audify:folder-drop-overlay", onOverlayEvt);
    return () =>
      window.removeEventListener("audify:folder-drop-overlay", onOverlayEvt);
  }, [dragOverlayArmed, hasInAppDrag]);

  const handleStartSplitResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      splitResizeCleanupRef.current?.();
      const stage = splitStageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.height < 160) return;
      let latestPct = librarySplitPct;
      setIsResizingSplit(true);
      const onMove = (ev: MouseEvent) => {
        const rel = ((ev.clientY - rect.top) / rect.height) * 100;
        latestPct = Math.max(18, Math.min(68, Math.round(rel)));
        setLibrarySplitPct(latestPct);
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        setIsResizingSplit(false);
        splitResizeCleanupRef.current = null;
      };
      const onUp = () => {
        cleanup();
        safeSetItem(AUDIFY_STORAGE_KEYS.layerSplitRatioV1, String(latestPct));
      };
      splitResizeCleanupRef.current = cleanup;
      document.body.style.cursor = "row-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [librarySplitPct]
  );

  return {
    splitStageRef,
    librarySplitPct,
    isResizingSplit,
    dragOverlayArmed,
    handleStartSplitResize,
  };
}
