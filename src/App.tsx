import React, { Suspense, useEffect, useState } from "react";
import { Z_INDEX } from "./constants/zIndex";
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
import { attachBodyAriaTitleMirror } from "./utils/domBodyObserver";

const AppAtmosphereViewport = React.lazy(() =>
  import("./components/AppAtmosphereViewport").then((m) => ({
    default: m.AppAtmosphereViewport,
  }))
);

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
const StatusNoticeToast = React.lazy(() =>
  import("./components/AppToasts").then((m) => ({
    default: m.StatusNoticeToast,
  }))
);
const CreditToastBanner = React.lazy(() =>
  import("./components/AppToasts").then((m) => ({
    default: m.CreditToastBanner,
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
  const pauseStatusNotice = useSampleStore((s) => s.pauseStatusNotice);
  const resumeStatusNotice = useSampleStore((s) => s.resumeStatusNotice);

  useEffect(() => {
    void useSampleStore.getState().initialize();
  }, []);

  const hasBackdrop =
    themeMode !== "contrast" &&
    hasActiveVisualBackdrop(wallpaperKind, customBgImage, asciiMagicSlug);

  // Sync data-has-bg attribute on root html when any image or ASCII backdrop is active
  useEffect(() => {
    const root = document.documentElement;
    if (hasBackdrop) {
      root.setAttribute("data-has-bg", "true");
    } else {
      root.removeAttribute("data-has-bg");
    }
  }, [hasBackdrop]);

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

  // Mirror title -> aria-label on icon buttons for accessibility (shared body observer)
  useEffect(() => attachBodyAriaTitleMirror(), []);

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
          <Suspense fallback={null}>
            <StatusNoticeToast
              notice={statusNotice}
              onDismiss={clearStatusNotice}
              onPause={pauseStatusNotice}
              onResume={resumeStatusNotice}
            />
          </Suspense>
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

      {hasBackdrop && (
        <Suspense fallback={null}>
          <AppAtmosphereViewport />
        </Suspense>
      )}

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

      {/* Stacked Bottom-Right Toast Container (prevents overlap between CreditToast & StatusNotice) */}
      {(creditToast ||
        (statusNotice &&
          (isSettingsOpen ||
            statusNotice.kind === "error" ||
            Boolean(statusNotice.actionLabel)))) && (
        <div
          style={{ zIndex: Z_INDEX.statusToast }}
          className="fixed bottom-8 right-4 flex flex-col-reverse items-end gap-2 pointer-events-none"
        >
          <Suspense fallback={null}>
            {statusNotice &&
              (isSettingsOpen ||
                statusNotice.kind === "error" ||
                Boolean(statusNotice.actionLabel)) && (
                <StatusNoticeToast
                  notice={statusNotice}
                  onDismiss={clearStatusNotice}
                  onPause={pauseStatusNotice}
                  onResume={resumeStatusNotice}
                  stacked={true}
                />
              )}
            {creditToast && (
              <CreditToastBanner
                toast={creditToast}
                onDismiss={clearCreditToast}
                onPause={pauseCreditToast}
                onResume={resumeCreditToast}
                stacked={true}
              />
            )}
          </Suspense>
        </div>
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
