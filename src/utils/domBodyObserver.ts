/**
 * Single shared `MutationObserver` on `document.body`.
 *
 * Unifies:
 * 1. Mirroring `title` -> `aria-label` on icon buttons for accessibility.
 * 2. Notifying subscribers (e.g. `GlobalTooltip`) when DOM nodes are removed
 *    so orphaned tooltips hide immediately without running a second observer.
 */

type RemovalListener = () => void;

let sharedObserver: MutationObserver | null = null;
let ariaMirrorRefCount = 0;
const removalListeners = new Set<RemovalListener>();

function mirrorButtonTitles(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>("button[title]:not([aria-label])")
    .forEach((b) => {
      const t = b.getAttribute("title");
      if (t) {
        b.setAttribute("aria-label", t);
        b.setAttribute("data-aria-from-title", "true");
      }
    });
}

function handleMutations(records: MutationRecord[]): void {
  let hasRemovals = false;
  const shouldMirror = ariaMirrorRefCount > 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === "attributes") {
      if (r.target instanceof HTMLElement) {
        const el = r.target;
        if (
          !el.hasAttribute("title") &&
          el.hasAttribute("data-tooltip-from-title")
        ) {
          el.removeAttribute("data-tooltip");
          el.removeAttribute("data-tooltip-from-title");
          if (el.hasAttribute("data-aria-from-title")) {
            el.removeAttribute("aria-label");
            el.removeAttribute("data-aria-from-title");
          }
        } else if (shouldMirror && el.matches("button[title]")) {
          const t = el.getAttribute("title");
          if (
            t &&
            (!el.hasAttribute("aria-label") ||
              el.hasAttribute("data-aria-from-title"))
          ) {
            el.setAttribute("aria-label", t);
            el.setAttribute("data-aria-from-title", "true");
          }
        }
      }
      continue;
    }

    if (r.removedNodes.length > 0) {
      hasRemovals = true;
    }

    if (shouldMirror && r.addedNodes.length > 0) {
      for (let j = 0; j < r.addedNodes.length; j++) {
        const n = r.addedNodes[j];
        if (n instanceof HTMLElement) {
          if (n.matches("button[title]:not([aria-label])")) {
            const t = n.getAttribute("title");
            if (t) {
              n.setAttribute("aria-label", t);
              n.setAttribute("data-aria-from-title", "true");
            }
          }
          mirrorButtonTitles(n);
        }
      }
    }
  }

  if (hasRemovals && removalListeners.size > 0) {
    removalListeners.forEach((cb) => cb());
  }
}

function syncObserverLifecycle(): void {
  const needsObserver = ariaMirrorRefCount > 0 || removalListeners.size > 0;
  if (needsObserver && !sharedObserver && typeof document !== "undefined" && document.body) {
    sharedObserver = new MutationObserver(handleMutations);
    sharedObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
  } else if (!needsObserver && sharedObserver) {
    sharedObserver.disconnect();
    sharedObserver = null;
  }
}

export function attachBodyAriaTitleMirror(): () => void {
  ariaMirrorRefCount += 1;
  if (typeof document !== "undefined") {
    mirrorButtonTitles(document);
  }
  syncObserverLifecycle();
  return () => {
    ariaMirrorRefCount = Math.max(0, ariaMirrorRefCount - 1);
    syncObserverLifecycle();
  };
}

export function subscribeBodyNodeRemovals(cb: RemovalListener): () => void {
  removalListeners.add(cb);
  syncObserverLifecycle();
  return () => {
    removalListeners.delete(cb);
    syncObserverLifecycle();
  };
}
