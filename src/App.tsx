import React, { Suspense, useEffect, useState } from "react";
import { AppAtmosphereViewport } from "./components/AppAtmosphereViewport";
import { CreditToastBanner, StatusNoticeToast } from "./components/AppToasts";
import { AudioEngine } from "./components/AudioEngine";
import { GlobalTooltip } from "./components/GlobalTooltip";
import { LeftSidebar } from "./components/LeftSidebar";
import { SampleTable } from "./components/SampleTable";
import { BottomStatusBar, TopHeaderBar } from "./components/StatusBar";
import { TopTransportDeck } from "./components/TopTransportDeck";
import { useAppGlobalShortcuts } from "./hooks/useAppGlobalShortcuts";
import {
  hasActiveVisualBackdrop,
  isStandaloneSettingsWindow,
} from "./store/storageHelpers";
import { useSampleStore } from "./store/useSampleStore";

const SettingsModal = React.lazy(() =>
  import("./components/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  }))
);
const MiniDockShell = React.lazy(() =>
  import("./components/mini-dock/MiniDockShell").then((m) => ({
    default: m.MiniDockShell,
  }))
);
const FileOpsModals = React.lazy(() =>
  import("./components/modals/FileOpsModals").then((m) => ({
    default: m.FileOpsModals,
  }))
);
const BatchRenameModal = React.lazy(() =>
  import("./components/modals/BatchRenameModal").then((m) => ({
    default: m.BatchRenameModal,
  }))
);
const ShortcutsCheatsheetModal = React.lazy(() =>
  import("./components/modals/ShortcutsCheatsheetModal").then((m) => ({
    default: m.ShortcutsCheatsheetModal,
  }))
);

export const App: React.FC = () => {
  const customBgImage = useSampleStore((s) => s.customBgImage);
  const wallpaperKind = useSampleStore((s) => s.wallpaperKind);
  const asciiMagicSlug = useSampleStore((s) => s.asciiMagicSlug);
  const themeMode = useSampleStore((s) => s.themeMode);
  const creditToast = useSampleStore((s) => s.creditToast);
  const statusNotice = useSampleStore((s) => s.statusNotice);
  const isSettingsOpen = useSampleStore((s) => s.isSettingsOpen);
  const isMiniDock = useSampleStore((s) => s.isMiniDock);
  const hasPendingFileOpModal = useSampleStore((s) =>
    Boolean(s.pendingTrashRequest || s.pendingFileConflictPrompt)
  );
  const hasBatchRenameModal = useSampleStore(
    (s) => s.batchRenameSampleIds !== null || s.batchRenameSliceIds !== null
  );
  const clearCreditToast = useSampleStore((s) => s.clearCreditToast);
  const pauseCreditToast = useSampleStore((s) => s.pauseCreditToast);
  const resumeCreditToast = useSampleStore((s) => s.resumeCreditToast);
  const clearStatusNotice = useSampleStore((s) => s.clearStatusNotice);

  useEffect(() => {
    void useSampleStore.getState().initialize();
  }, []);

  // Sync data-has-bg attribute on root html when any image or ASCII backdrop is active
  useEffect(() => {
    const root = document.documentElement;
    const isActive =
      themeMode !== "contrast" &&
      hasActiveVisualBackdrop(wallpaperKind, customBgImage, asciiMagicSlug);
    if (isActive) {
      root.setAttribute("data-has-bg", "true");
    } else {
      root.removeAttribute("data-has-bg");
    }
  }, [wallpaperKind, customBgImage, asciiMagicSlug, themeMode]);

  // Surface otherwise-silent async failures in the status bar instead of the dev console only.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason =
        e.reason instanceof Error ? e.reason.message : String(e.reason);
      useSampleStore
        .getState()
        .setStatusMessage(`Unexpected error: ${reason}`);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // Mirror title -> aria-label on icon buttons for accessibility
  useEffect(() => {
    const label = (root: ParentNode) => {
      root
        .querySelectorAll<HTMLElement>("button[title]:not([aria-label])")
        .forEach((b) => {
          const t = b.getAttribute("title");
          if (t) {
            b.setAttribute("aria-label", t);
            b.setAttribute("data-aria-from-title", "true");
          }
        });
    };
    label(document);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes" && r.target instanceof HTMLElement) {
          const el = r.target;
          if (el.matches("button[title]")) {
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
          continue;
        }
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement) {
            if (n.matches("button[title]:not([aria-label])")) {
              const t = n.getAttribute("title");
              if (t) {
                n.setAttribute("aria-label", t);
                n.setAttribute("data-aria-from-title", "true");
              }
            }
            label(n);
          }
        });
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    return () => observer.disconnect();
  }, []);

  // Disable browser default right-click context menu globally
  useEffect(() => {
    const preventContext = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", preventContext);
    return () => window.removeEventListener("contextmenu", preventContext);
  }, []);

  useAppGlobalShortcuts();
  const [showShortcutsGuide, setShowShortcutsGuide] = useState(false);

  useEffect(() => {
    const onToggleGuide = () => setShowShortcutsGuide((prev) => !prev);
    window.addEventListener("audify:toggle-shortcuts-cheatsheet", onToggleGuide);
    return () => {
      window.removeEventListener(
        "audify:toggle-shortcuts-cheatsheet",
        onToggleGuide
      );
    };
  }, []);

  const isStandaloneSettings = isStandaloneSettingsWindow();

  if (isStandaloneSettings) {
    return (
      <div
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex flex-col h-screen w-screen bg-surface-0 text-fg overflow-hidden select-none"
      >
        <Suspense fallback={null}>
          <SettingsModal standalone={true} />
        </Suspense>

        {statusNotice && (
          <StatusNoticeToast
            notice={statusNotice}
            onDismiss={clearStatusNotice}
          />
        )}

        <GlobalTooltip />
      </div>
    );
  }

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="relative flex flex-col h-screen w-screen bg-surface-0 text-fg overflow-hidden select-none"
    >
      <AudioEngine />

      <AppAtmosphereViewport />

      {/* Main UI Content Layer */}
      <div className="relative z-10 flex flex-col h-full w-full overflow-hidden">
        {isMiniDock ? (
          <Suspense fallback={null}>
            <MiniDockShell />
          </Suspense>
        ) : (
          <>
            <TopHeaderBar />
            <TopTransportDeck />
            <div className="flex-1 flex min-h-0">
              <LeftSidebar />
              <SampleTable />
            </div>
            <BottomStatusBar />
          </>
        )}
      </div>

      {/* Crisp 1px Window Frame Overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-40 border border-line"
      />

      {creditToast && (
        <CreditToastBanner
          toast={creditToast}
          onDismiss={clearCreditToast}
          onPause={pauseCreditToast}
          onResume={resumeCreditToast}
        />
      )}

      {/* Modal-Visible Feedback & Error Toast (Renders above SettingsModal z-50) */}
      {statusNotice && (isSettingsOpen || statusNotice.kind === "error") && (
        <StatusNoticeToast
          notice={statusNotice}
          onDismiss={clearStatusNotice}
        />
      )}

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}

      {hasPendingFileOpModal && (
        <Suspense fallback={null}>
          <FileOpsModals />
        </Suspense>
      )}
      {hasBatchRenameModal && (
        <Suspense fallback={null}>
          <BatchRenameModal />
        </Suspense>
      )}
      {showShortcutsGuide && (
        <Suspense fallback={null}>
          <ShortcutsCheatsheetModal
            onClose={() => setShowShortcutsGuide(false)}
          />
        </Suspense>
      )}
      <GlobalTooltip />
    </div>
  );
};

export default App;
