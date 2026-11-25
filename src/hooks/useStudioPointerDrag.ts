import { useCallback, useEffect, useRef, useState } from "react";

export interface StudioDragVisual {
  label: string;
  swatchColor?: string;
  prefixSymbol?: string;
}

export interface StudioPointerDragState<T> {
  payload: T;
  visual: StudioDragVisual;
  clientX: number;
  clientY: number;
  dropKey: string | null;
  dropHint: string | null;
}

interface UseStudioPointerDragOptions<T> {
  /** Unique scope string written to `data-studio-drop-scope` on every drop target in this tree. */
  scope: string;
  /** Optional scroll container ref for smooth top/bottom edge auto-scrolling during drags. */
  scrollContainerRef?: React.RefObject<HTMLElement>;
  /** Return true if `payload` may be dropped onto `dropKey`. */
  canDrop: (payload: T, dropKey: string) => boolean;
  /** Called once when the user releases the mouse over a valid drop target. */
  onDrop: (payload: T, dropKey: string) => void | Promise<void>;
  /** Distance in pixels before a mouse press turns into an active drag (default: 5). */
  thresholdPx?: number;
}

const EDGE_SCROLL_ZONE_PX = 28;
const EDGE_SCROLL_STEP_PX = 8;

function hitTestDropTarget<T>(
  scope: string,
  clientX: number,
  clientY: number,
  payload: T,
  canDrop: (payload: T, dropKey: string) => boolean
): { key: string; hint: string | null } | null {
  if (
    typeof document === "undefined" ||
    typeof document.elementFromPoint !== "function"
  ) {
    return null;
  }
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit) return null;
  const el = hit.closest<HTMLElement>(`[data-studio-drop-scope="${scope}"]`);
  if (!el) return null;

  const centerKey = el.getAttribute("data-studio-drop-key");
  const beforeKey = el.getAttribute("data-studio-drop-before-key");
  const afterKey = el.getAttribute("data-studio-drop-after-key");

  if (beforeKey || afterKey) {
    const rect = el.getBoundingClientRect();
    const axis = el.getAttribute("data-studio-drop-axis") === "x" ? "x" : "y";
    const span = axis === "x" ? rect.width : rect.height;
    const rel =
      span > 0
        ? ((axis === "x" ? clientX - rect.left : clientY - rect.top) / span)
        : 0.5;
    const centerAllowed = Boolean(centerKey && canDrop(payload, centerKey));

    if (centerAllowed) {
      if (rel < 0.28 && beforeKey && canDrop(payload, beforeKey)) {
        return {
          key: beforeKey,
          hint: el.getAttribute("data-studio-drop-before-hint"),
        };
      }
      if (rel > 0.72 && afterKey && canDrop(payload, afterKey)) {
        return {
          key: afterKey,
          hint: el.getAttribute("data-studio-drop-after-hint"),
        };
      }
      return {
        key: centerKey!,
        hint: el.getAttribute("data-studio-drop-hint"),
      };
    }

    if (rel < 0.5) {
      if (beforeKey && canDrop(payload, beforeKey)) {
        return {
          key: beforeKey,
          hint: el.getAttribute("data-studio-drop-before-hint"),
        };
      }
    } else if (afterKey && canDrop(payload, afterKey)) {
      return {
        key: afterKey,
        hint: el.getAttribute("data-studio-drop-after-hint"),
      };
    }
  }

  if (centerKey && canDrop(payload, centerKey)) {
    return {
      key: centerKey,
      hint: el.getAttribute("data-studio-drop-hint"),
    };
  }
  return null;
}

/**
 * Pointer-based internal tree drag-and-drop hook supporting both center reparent
 * zones (`data-studio-drop-key`) and top/bottom or left/right sibling reorder edges
 * (`data-studio-drop-before-key` / `data-studio-drop-after-key`).
 */
export function useStudioPointerDrag<T>({
  scope,
  scrollContainerRef,
  canDrop,
  onDrop,
  thresholdPx = 5,
}: UseStudioPointerDragOptions<T>) {
  const [dragState, setDragState] = useState<StudioPointerDragState<T> | null>(
    null
  );
  const canDropRef = useRef(canDrop);
  canDropRef.current = canDrop;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const activeSessionRef = useRef<{
    cleanup: () => void;
  } | null>(null);
  const clickSuppressCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      activeSessionRef.current?.cleanup();
      activeSessionRef.current = null;
      clickSuppressCleanupRef.current?.();
      clickSuppressCleanupRef.current = null;
    };
  }, []);

  const beginPointerDrag = useCallback(
    (e: React.MouseEvent, payload: T, visual: StudioDragVisual) => {
      if (e.button !== 0) return;
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.closest(
          "button, input, textarea, a, [data-no-drag='true']"
        )
      ) {
        return;
      }

      activeSessionRef.current?.cleanup();

      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let latestX = startX;
      let latestY = startY;
      let latestDropKey: string | null = null;
      let latestDropHint: string | null = null;
      let cachedScrollBounds: { top: number; bottom: number } | null = null;
      let autoScrollTimer: ReturnType<typeof setInterval> | null = null;

      const updateHoverFromPoint = (x: number, y: number) => {
        const hit = hitTestDropTarget(
          scope,
          x,
          y,
          payload,
          canDropRef.current
        );
        latestDropKey = hit ? hit.key : null;
        latestDropHint = hit ? hit.hint : null;
        setDragState({
          payload,
          visual,
          clientX: x,
          clientY: y,
          dropKey: latestDropKey,
          dropHint: latestDropHint,
        });
      };

      const startAutoScrollLoop = () => {
        const scroller = scrollContainerRef?.current;
        if (!scroller) return;
        const rect = scroller.getBoundingClientRect();
        cachedScrollBounds = { top: rect.top, bottom: rect.bottom };
        autoScrollTimer = setInterval(() => {
          const el = scrollContainerRef?.current;
          if (!el || !cachedScrollBounds) return;
          if (latestY < cachedScrollBounds.top + EDGE_SCROLL_ZONE_PX) {
            el.scrollTop -= EDGE_SCROLL_STEP_PX;
            updateHoverFromPoint(latestX, latestY);
          } else if (
            latestY >
            cachedScrollBounds.bottom - EDGE_SCROLL_ZONE_PX
          ) {
            el.scrollTop += EDGE_SCROLL_STEP_PX;
            updateHoverFromPoint(latestX, latestY);
          }
        }, 28);
      };

      const suppressNextClick = () => {
        clickSuppressCleanupRef.current?.();
        let timerId: number | null = null;
        const clearBlocker = () => {
          window.removeEventListener("click", blocker, true);
          if (timerId !== null) {
            window.clearTimeout(timerId);
            timerId = null;
          }
          if (clickSuppressCleanupRef.current === clearBlocker) {
            clickSuppressCleanupRef.current = null;
          }
        };
        const blocker = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          clearBlocker();
        };
        clickSuppressCleanupRef.current = clearBlocker;
        window.addEventListener("click", blocker, true);
        timerId = window.setTimeout(clearBlocker, 60);
      };

      const cleanup = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("blur", onCancel);
        if (autoScrollTimer !== null) {
          clearInterval(autoScrollTimer);
          autoScrollTimer = null;
        }
        document.body.style.removeProperty("cursor");
        setDragState(null);
        activeSessionRef.current = null;
      };

      const onMouseMove = (moveEv: MouseEvent) => {
        if ((moveEv.buttons & 1) !== 1) {
          cleanup();
          return;
        }
        latestX = moveEv.clientX;
        latestY = moveEv.clientY;
        if (!started) {
          if (Math.hypot(latestX - startX, latestY - startY) < thresholdPx) {
            return;
          }
          started = true;
          document.body.style.cursor = "grabbing";
          startAutoScrollLoop();
        }
        updateHoverFromPoint(latestX, latestY);
      };

      const onMouseUp = (upEv: MouseEvent) => {
        const wasStarted = started;
        const finalX = upEv.clientX;
        const finalY = upEv.clientY;
        let dropTarget = latestDropKey;
        if (wasStarted) {
          const finalHit = hitTestDropTarget(
            scope,
            finalX,
            finalY,
            payload,
            canDropRef.current
          );
          dropTarget = finalHit ? finalHit.key : null;
          suppressNextClick();
        }
        cleanup();
        if (wasStarted && dropTarget !== null) {
          void onDropRef.current(payload, dropTarget);
        }
      };

      const onKeyDown = (keyEv: KeyboardEvent) => {
        if (keyEv.key === "Escape") {
          keyEv.preventDefault();
          keyEv.stopPropagation();
          cleanup();
        }
      };

      const onCancel = () => cleanup();

      activeSessionRef.current = { cleanup };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("blur", onCancel);
    },
    [scope, scrollContainerRef, thresholdPx]
  );

  return {
    dragState,
    beginPointerDrag,
  };
}
