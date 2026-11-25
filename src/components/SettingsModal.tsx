import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings as SettingsIcon } from "lucide-react";
import { Z_INDEX } from "../constants/zIndex";
import { isStandaloneSettingsWindow } from "../store/storageHelpers";
import { useSampleStore } from "../store/useSampleStore";
import { KeyboardShortcuts } from "../types";
import { beginWindowTitlebarDrag } from "../utils/drag";
import { useDialogFocusTrap } from "../utils/modalFocus";
import { SettingsSectionHeader } from "./settings/SettingsSectionHeader";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { WindowCaptionControls } from "./WindowCaptionControls";

const AdvancedTab = lazy(() =>
  import("./settings/AdvancedTab").then((m) => ({ default: m.AdvancedTab }))
);
const AiAudioTab = lazy(() =>
  import("./settings/AiAudioTab").then((m) => ({ default: m.AiAudioTab }))
);
const AppearanceTab = lazy(() =>
  import("./settings/AppearanceTab").then((m) => ({ default: m.AppearanceTab }))
);
const AudioTab = lazy(() =>
  import("./settings/AudioTab").then((m) => ({ default: m.AudioTab }))
);
const CollectionsTab = lazy(() =>
  import("./settings/CollectionsTab").then((m) => ({ default: m.CollectionsTab }))
);
const GenresTab = lazy(() =>
  import("./settings/GenresTab").then((m) => ({ default: m.GenresTab }))
);
const LibrariesTab = lazy(() =>
  import("./settings/LibrariesTab").then((m) => ({ default: m.LibrariesTab }))
);
const LicensesTab = lazy(() =>
  import("./settings/LicensesTab").then((m) => ({ default: m.LicensesTab }))
);
const ProfilesTab = lazy(() =>
  import("./settings/ProfilesTab").then((m) => ({ default: m.ProfilesTab }))
);
const ShortcutsTab = lazy(() =>
  import("./settings/ShortcutsTab").then((m) => ({ default: m.ShortcutsTab }))
);
const TagsAndRulesTab = lazy(() =>
  import("./settings/TagsAndRulesTab").then((m) => ({
    default: m.TagsAndRulesTab,
  }))
);

const SettingsModalInner: React.FC<{ standalone?: boolean }> = ({
  standalone = false,
}) => {
  const settingsTab = useSampleStore((s) => s.settingsTab);
  const activeProfile = useSampleStore((s) => s.activeProfile);
  const accentColor = useSampleStore((s) => s.accentColor);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);

  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const setShortcut = useSampleStore((s) => s.setShortcut);

  const [collectionsSubTab, setCollectionsSubTab] = useState<
    "list" | "templates"
  >("list");
  const [tagsSubTab, setTagsSubTab] = useState<"library" | "rules">("library");
  const [recordingAction, setRecordingAction] = useState<
    keyof KeyboardShortcuts | null
  >(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(!standalone, dialogRef);

  useEffect(() => {
    setRecordingAction(null);
  }, [activeProfile?.id, settingsTab]);

  useEffect(() => {
    if (!standalone) return;
    let active = true;
    const syncMaximized = async () => {
      try {
        const maxState = await getCurrentWindow().isMaximized();
        if (active) setIsWindowMaximized(maxState);
      } catch {
        // Ignore in browser preview
      }
    };
    void syncMaximized();
    window.addEventListener("resize", syncMaximized);
    return () => {
      active = false;
      window.removeEventListener("resize", syncMaximized);
    };
  }, [standalone]);

  useEffect(() => {
    if (!standalone) return;
    const raf = requestAnimationFrame(() => {
      try {
        const win = getCurrentWindow();
        void win
          .show()
          .then(() => win.setFocus())
          .catch(() => {});
      } catch {
        // Ignore in browser preview
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [standalone]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (recordingAction) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setRecordingAction(null);
          return;
        }
        if (
          e.key === "Backspace" &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey
        ) {
          setShortcut(recordingAction, "");
          setRecordingAction(null);
          return;
        }
        if (
          e.key === "Control" ||
          e.key === "Shift" ||
          e.key === "Alt" ||
          e.key === "Meta"
        ) {
          return;
        }
        const mods: string[] = [];
        if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
        if (e.altKey) mods.push("Alt");
        const isShiftedSymbolOnly =
          e.key.length === 1 &&
          !/^[a-z0-9 ]$/i.test(e.key) &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey;
        if (e.shiftKey && !isShiftedSymbolOnly) mods.push("Shift");
        const baseKey =
          e.key === " "
            ? "Space"
            : e.key.length === 1
            ? e.key.toUpperCase()
            : e.key;
        const normalizedKey =
          mods.length > 0
            ? `${mods.join("+")}+${baseKey}`
            : e.key === " "
            ? " "
            : e.key;
        setShortcut(recordingAction, normalizedKey);
        setRecordingAction(null);
        return;
      }

      if (e.key === "Escape") {
        // Yield Escape to nested portals (ColorPickerPopover, QuickCreatePopover, modal confirm) or open dropdowns
        if (
          document.querySelector(
            "[data-modal-portal='true']:not([data-settings-modal-portal='true']), [data-color-picker-portal], [data-quick-create-portal], [data-settings-dropdown-open='true']"
          )
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingAction, setShortcut, setSettingsOpen]);

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!standalone || e.button !== 0 || e.detail !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-no-drag]")) return;
    beginWindowTitlebarDrag(e.clientX, e.clientY, () => {
      try {
        void getCurrentWindow().startDragging();
      } catch {
        // ignore in browser preview
      }
    });
  };

  const handleToggleMaximize = () => {
    try {
      void getCurrentWindow()
        .toggleMaximize()
        .then(() => getCurrentWindow().isMaximized())
        .then((maxState) => setIsWindowMaximized(maxState))
        .catch(() => {});
    } catch {
      // Ignore in browser preview
    }
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!standalone) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-no-drag]")) return;
    handleToggleMaximize();
  };

  const modalTree = (
    <div
      data-modal-portal={!standalone ? "true" : undefined}
      data-settings-modal-portal={!standalone ? "true" : undefined}
      onClick={() => {
        if (!standalone) setSettingsOpen(false);
      }}
      className={
        standalone
          ? "fixed inset-0 bg-surface-0 flex items-stretch justify-stretch select-none"
          : "fixed inset-0 audify-modal-backdrop flex items-center justify-center p-4 select-none"
      }
      style={{ zIndex: Z_INDEX.settingsBackdrop }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={
          standalone
            ? `w-full h-full bg-surface-0 ${
                isWindowMaximized ? "border-0" : "border border-line"
              } flex flex-col overflow-hidden`
            : "w-[92vw] max-w-[1000px] h-[78vh] min-h-[420px] max-h-[720px] bg-surface-0 border border-line rounded-lg flex flex-col overflow-hidden shadow-2xl"
        }
      >
        {/* MODAL HEADER BAR (32px, unified with main window) */}
        <div
          onMouseDown={handleHeaderMouseDown}
          onDoubleClick={handleHeaderDoubleClick}
          className="h-[32px] bg-surface-1 border-b border-line pl-2.5 pr-0 flex items-center justify-between shrink-0 cursor-default"
        >
          <div className="flex items-center space-x-2 min-w-0 pointer-events-none">
            <SettingsIcon className="w-[15px] h-[15px] text-accent-fg shrink-0" />
            <span className="text-[12px] font-semibold tracking-wide text-fg shrink-0">
              Settings
            </span>
            <span className="h-[22px] px-2 font-mono text-[11px] text-fg rounded-sm bg-surface-3 border border-line inline-flex items-center space-x-1.5 truncate">
              <span
                className="w-2 h-2 rounded-[2px] inline-block shrink-0"
                style={{
                  backgroundColor:
                    activeProfile?.color || accentColor || "#F59E0B",
                }}
              />
              <span className="truncate">
                {activeProfile?.name || "Default Studio"}
              </span>
            </span>
          </div>

          <WindowCaptionControls
            showMinimize={standalone}
            showMaximize={standalone}
            isMaximized={isWindowMaximized}
            onToggleMaximize={handleToggleMaximize}
            onClose={() => setSettingsOpen(false)}
            closeTitle="Close (Esc)"
          />
        </div>

        {/* MODAL BODY: LEFT TAB NAVIGATION + RIGHT CONTENT */}
        <div className="flex-1 flex min-h-0">
          <SettingsSidebarNav
            settingsTab={settingsTab}
            enableLicensesSystem={enableLicensesSystem}
            enableAdvancedFileOps={enableAdvancedFileOps}
            onSelectTab={(tabId) => {
              setRecordingAction(null);
              setSettingsOpen(true, tabId);
            }}
          />

          <div className="flex-1 flex flex-col bg-surface-0 min-w-0 min-h-0">
            <SettingsSectionHeader
              collectionsSubTab={collectionsSubTab}
              setCollectionsSubTab={setCollectionsSubTab}
              tagsSubTab={tagsSubTab}
              setTagsSubTab={setTagsSubTab}
              onClearShortcutRecording={() => setRecordingAction(null)}
            />

            <div className="flex-1 p-3.5 overflow-y-auto min-h-0 flex flex-col">
              <div className="w-full max-w-[1220px] mx-auto flex-1 min-h-0 flex flex-col">
                <Suspense
                  fallback={
                    <div className="flex-1 flex items-center justify-center text-[11px] font-mono text-fg-3">
                      Loading settings...
                    </div>
                  }
                >
                  {settingsTab === "profiles" && <ProfilesTab />}
                  {settingsTab === "appearance" && <AppearanceTab />}
                  {settingsTab === "audio" && <AudioTab />}
                  {settingsTab === "ai" && <AiAudioTab />}
                  {settingsTab === "libraries" && <LibrariesTab />}
                  {settingsTab === "collections" && (
                    <CollectionsTab collectionsSubTab={collectionsSubTab} />
                  )}
                  {settingsTab === "tags" && (
                    <TagsAndRulesTab tagsSubTab={tagsSubTab} />
                  )}
                  {settingsTab === "genres" && <GenresTab />}
                  {settingsTab === "licenses" && <LicensesTab />}
                  {settingsTab === "shortcuts" && (
                    <ShortcutsTab
                      recordingAction={recordingAction}
                      setRecordingAction={setRecordingAction}
                    />
                  )}
                  {settingsTab === "advanced" && <AdvancedTab />}
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!standalone && typeof document !== "undefined") {
    return createPortal(modalTree, document.body);
  }
  return modalTree;
};

export const SettingsModal: React.FC<{ standalone?: boolean }> = ({
  standalone,
}) => {
  const isSettingsOpen = useSampleStore((s) => s.isSettingsOpen);
  const isSettingsWindowVisible = useSampleStore(
    (s) => s.isSettingsWindowVisible
  );
  const isStandalone = standalone ?? isStandaloneSettingsWindow();
  if (isStandalone && !isSettingsWindowVisible) return null;
  if (!isStandalone && !isSettingsOpen) return null;
  return <SettingsModalInner standalone={isStandalone} />;
};
