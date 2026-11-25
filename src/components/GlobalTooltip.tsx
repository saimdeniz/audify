import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Z_INDEX } from "../constants/zIndex";
import { useSampleStore } from "../store/useSampleStore";
import { subscribeBodyNodeRemovals } from "../utils/domBodyObserver";
import { isOsDragCurrentlyInFlight } from "../utils/drag";

interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

interface TooltipState {
  text: string;
  x: number;
  y: number;
  visible: boolean;
}

let measureCanvas: HTMLCanvasElement | null = null;
const tooltipWidthCache = new Map<string, number>();
function getAccurateTextWidth(text: string): number {
  const cached = tooltipWidthCache.get(text);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") return text.length * 7;
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
  }
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 7;
  ctx.font =
    '500 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      "0.025em";
  } catch {
    // Ignore unsupported letterSpacing
  }
  const width = Math.ceil(ctx.measureText(text).width);
  if (tooltipWidthCache.size >= 256) {
    tooltipWidthCache.clear();
  }
  tooltipWidthCache.set(text, width);
  return width;
}

/**
 * Strips legacy verbose and noisy instructions into clean, direct UI labels.
 */
function sanitizeTooltipText(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();

  text = text.replace(
    /\s*\((?:Drag row to NLE|Ctrl\/Shift\+Click|Click to filter by|Click to filter|Drag samples here)[^)]*\)/gi,
    ""
  );

  text = text.replace(/\s*[—–-]\s*Click to filter.*$/i, "");
  text = text.replace(/\s*[—–-]\s*Right-click to manage.*$/i, "");

  const filterMatch = text.match(/^Click to filter by "([^"]+)"/i);
  if (filterMatch) {
    return filterMatch[1];
  }

  text = text.replace(/[\s•—-]+$/, "").trim();
  return text;
}

export const GlobalTooltip: React.FC = () => {
  const [tooltip, setTooltip] = useState<TooltipState>({
    text: "",
    x: 0,
    y: 0,
    visible: false,
  });

  const timerRef = useRef<number | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);
  const lastActiveRef = useRef<number>(0);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const lastCoordsRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const visibleRef = useRef<boolean>(false);
  const cachedWidthRef = useRef<number>(0);

  useEffect(() => {
    const FLOATING_PORTAL_SELECTOR =
      "[data-popover-portal='true'], [data-context-menu-portal='true'], [data-color-picker-portal='true'], [data-quick-create-portal='true']";

    const isBlockedByOpenPortal = (el: HTMLElement | null): boolean => {
      if (!el) return false;
      const openPortal = document.querySelector(FLOATING_PORTAL_SELECTOR);
      if (!openPortal) return false;
      return !el.closest(FLOATING_PORTAL_SELECTOR);
    };

    const isDragActive = () =>
      isOsDragCurrentlyInFlight() ||
      useSampleStore.getState().inAppDragSample !== null;

    const hideImmediately = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      currentTargetRef.current = null;
      if (visibleRef.current) {
        visibleRef.current = false;
        lastActiveRef.current = Date.now();
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }
    };

    const handlePointerOver = (e: PointerEvent) => {
      if (isDragActive()) {
        hideImmediately();
        return;
      }

      const target = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(
        "[title], [data-tooltip]"
      );

      if (!target || isBlockedByOpenPortal(target)) {
        if (currentTargetRef.current || visibleRef.current) {
          hideImmediately();
        }
        return;
      }

      // Transfer native title -> data-tooltip using `title=""` suppression so React's
      // later `removeAttribute("title")` still fires a MutationRecord and clears stale tooltips.
      const rawTitle = target.getAttribute("title");
      if (rawTitle) {
        const clean = sanitizeTooltipText(rawTitle);
        if (clean) {
          target.setAttribute("data-tooltip", clean);
          target.setAttribute("data-tooltip-from-title", "true");
          if (
            !target.hasAttribute("aria-label") ||
            target.hasAttribute("data-aria-from-title")
          ) {
            target.setAttribute("aria-label", clean);
            target.setAttribute("data-aria-from-title", "true");
          }
        } else {
          target.removeAttribute("data-tooltip");
          target.removeAttribute("data-tooltip-from-title");
        }
        target.setAttribute("title", "");
      } else if (
        !target.hasAttribute("title") &&
        target.hasAttribute("data-tooltip-from-title")
      ) {
        target.removeAttribute("data-tooltip");
        target.removeAttribute("data-tooltip-from-title");
      }

      const text = target.getAttribute("data-tooltip") || "";
      if (!text) {
        hideImmediately();
        return;
      }

      currentTargetRef.current = target;
      lastCoordsRef.current = { x: e.clientX, y: e.clientY };

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const delayAttr =
        target.getAttribute("data-tooltip-delay") ||
        target
          .closest("[data-tooltip-delay]")
          ?.getAttribute("data-tooltip-delay");
      const customDelay = delayAttr ? parseInt(delayAttr, 10) : null;

      const alignCenter = Boolean(
        target.getAttribute("data-tooltip-align") === "center" ||
          target.closest("[data-tooltip-align='center']")
      );

      const rect = target.getBoundingClientRect();
      const anchorRect: AnchorRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      };

      const isSidebar = Boolean(target.closest("aside, [data-sidebar]"));
      const isWarm = Date.now() - lastActiveRef.current < 350;

      let delay = 500;
      if (customDelay !== null && !Number.isNaN(customDelay)) {
        delay = customDelay;
      } else if (isSidebar) {
        delay = isWarm ? 750 : 950;
      } else if (isWarm) {
        delay = 180;
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (
          !target.isConnected ||
          currentTargetRef.current !== target ||
          isBlockedByOpenPortal(target)
        ) {
          return;
        }
        // Re-read in case React updated or cleared title/data-tooltip while waiting
        const delayedTitle = target.getAttribute("title");
        if (delayedTitle) {
          const fresh = sanitizeTooltipText(delayedTitle);
          if (fresh) {
            target.setAttribute("data-tooltip", fresh);
            target.setAttribute("data-tooltip-from-title", "true");
          } else {
            target.removeAttribute("data-tooltip");
            target.removeAttribute("data-tooltip-from-title");
          }
          target.setAttribute("title", "");
        } else if (
          !target.hasAttribute("title") &&
          target.hasAttribute("data-tooltip-from-title")
        ) {
          target.removeAttribute("data-tooltip");
          target.removeAttribute("data-tooltip-from-title");
        }
        const liveText = target.getAttribute("data-tooltip") || "";
        if (!liveText) return;

        const tw = Math.min(500, getAccurateTextWidth(liveText) + 18);
        const th = 22;
        let posX = 0;
        let posY = 0;

        if (alignCenter) {
          const liveRect = target.getBoundingClientRect();
          const baseRect = liveRect.width > 0 ? liveRect : anchorRect;
          const centerX = baseRect.left + baseRect.width / 2;
          posX = Math.round(centerX - tw / 2);
          if (posX + tw > window.innerWidth - 8) {
            posX = window.innerWidth - tw - 8;
          }
          if (posX < 8) posX = 8;
          posY = Math.round(baseRect.bottom + 5);
          if (posY + th > window.innerHeight - 8) {
            posY = Math.max(8, Math.round(baseRect.top - th - 5));
          }
        } else {
          posX = lastCoordsRef.current.x + 10;
          posY = lastCoordsRef.current.y + 14;
          if (posX + tw > window.innerWidth - 12) {
            posX = Math.max(8, window.innerWidth - tw - 12);
          }
          if (posY + th > window.innerHeight - 8) {
            posY = Math.max(8, lastCoordsRef.current.y - th - 10);
          }
        }

        visibleRef.current = true;
        cachedWidthRef.current = tw;
        setTooltip({
          text: liveText,
          x: posX,
          y: posY,
          visible: true,
        });
        lastActiveRef.current = Date.now();
      }, delay);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isDragActive()) {
        hideImmediately();
        return;
      }
      const curTarget = currentTargetRef.current;
      if (!curTarget) return;
      if (!curTarget.isConnected) {
        hideImmediately();
        return;
      }
      lastCoordsRef.current = { x: e.clientX, y: e.clientY };

      if (!visibleRef.current || !tooltipRef.current) return;

      const isCentered =
        curTarget.getAttribute("data-tooltip-align") === "center" ||
        curTarget.closest("[data-tooltip-align='center']");
      if (isCentered) return;

      const tw = cachedWidthRef.current;
      const th = 22;
      let posX = e.clientX + 10;
      let posY = e.clientY + 14;
      if (posX + tw > window.innerWidth - 12) {
        posX = Math.max(8, window.innerWidth - tw - 12);
      }
      if (posY + th > window.innerHeight - 8) {
        posY = Math.max(8, e.clientY - th - 10);
      }
      // Update GPU transform directly on the DOM node to avoid React re-renders on every pointer pixel
      tooltipRef.current.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;
    };

    const handlePointerOut = (e: PointerEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (
        currentTargetRef.current &&
        (!related || !currentTargetRef.current.contains(related))
      ) {
        hideImmediately();
      }
    };

    // Hide orphaned tooltip immediately if its anchor element unmounts (via shared body observer)
    const unsubBodyRemovals = subscribeBodyNodeRemovals(() => {
      if (currentTargetRef.current && !currentTargetRef.current.isConnected) {
        hideImmediately();
      }
    });

    window.addEventListener("pointerover", handlePointerOver, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerout", handlePointerOut, { passive: true });
    window.addEventListener("pointerdown", hideImmediately, { passive: true });
    window.addEventListener("mousedown", hideImmediately, {
      capture: true,
      passive: true,
    });
    window.addEventListener("audify:hide-tooltip", hideImmediately);
    window.addEventListener("blur", hideImmediately, { passive: true });
    window.addEventListener("wheel", hideImmediately, { passive: true });
    window.addEventListener("scroll", hideImmediately, {
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", hideImmediately, { passive: true });

    let prevDragSample = useSampleStore.getState().inAppDragSample;
    const unsubStore = useSampleStore.subscribe((state) => {
      if (state.inAppDragSample !== prevDragSample) {
        prevDragSample = state.inAppDragSample;
        if (prevDragSample !== null) {
          hideImmediately();
        }
      }
    });

    return () => {
      unsubBodyRemovals();
      unsubStore();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      window.removeEventListener("pointerover", handlePointerOver);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("pointerdown", hideImmediately);
      window.removeEventListener("mousedown", hideImmediately, true);
      window.removeEventListener("audify:hide-tooltip", hideImmediately);
      window.removeEventListener("blur", hideImmediately);
      window.removeEventListener("wheel", hideImmediately);
      window.removeEventListener("scroll", hideImmediately, true);
      window.removeEventListener("keydown", hideImmediately);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip.visible || !tooltipRef.current) return;
    const actualTw = tooltipRef.current.offsetWidth;
    const estimatedTw = Math.min(500, getAccurateTextWidth(tooltip.text) + 18);
    const diff = actualTw - estimatedTw;
    const isCentered =
      currentTargetRef.current?.getAttribute("data-tooltip-align") ===
        "center" ||
      Boolean(
        currentTargetRef.current?.closest("[data-tooltip-align='center']")
      );

    if (isCentered && Math.abs(diff) > 4) {
      setTooltip((prev) => {
        if (!prev.visible) return prev;
        return {
          ...prev,
          x: Math.max(
            8,
            Math.min(
              window.innerWidth - actualTw - 8,
              Math.round(prev.x - diff / 2)
            )
          ),
        };
      });
    }
  }, [tooltip.visible, tooltip.text]);

  if (!tooltip.visible || !tooltip.text) return null;

  return (
    <div
      ref={tooltipRef}
      data-mica-overlay="true"
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${tooltip.x}px, ${tooltip.y}px, 0)`,
        zIndex: Z_INDEX.tooltip,
      }}
      className="fixed pointer-events-none select-none max-w-[500px] px-2 py-0.5 rounded-xs bg-surface-2 border border-line-strong shadow-lg text-fg text-[11px] font-sans font-medium tracking-wide whitespace-nowrap overflow-hidden text-ellipsis audify-overlay-surface"
    >
      {tooltip.text}
    </div>
  );
};
