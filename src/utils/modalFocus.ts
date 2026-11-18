import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Traps keyboard Tab navigation inside an active dialog container and restores focus
 * to the previously focused trigger element when the dialog closes.
 */
export function useDialogFocusTrap(
  active: boolean,
  containerRef: React.RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const prevFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (!container) return;

    const focusInitial = () => {
      if (container.contains(document.activeElement)) return;
      const autoEl = container.querySelector<HTMLElement>("[autofocus]");
      if (autoEl) {
        autoEl.focus();
        return;
      }
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else {
        container.focus();
      }
    };

    const rafId = requestAnimationFrame(focusInitial);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (!current || !root.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown, true);
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };
  }, [active, containerRef]);
}
