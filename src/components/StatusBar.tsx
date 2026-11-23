import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDown,
  Hash,
  PanelLeft,
  PanelLeftClose,
  PictureInPicture2,
  Star,
} from "lucide-react";
import { useSampleStore } from "../store/useSampleStore";
import { beginWindowTitlebarDrag } from "../utils/drag";
import { CollectionIcon } from "./CollectionIcon";
import { WindowCaptionControls } from "./WindowCaptionControls";

const ProfileSwitcherPopover = lazy(() =>
  import("./ProfileSwitcherPopover").then((m) => ({
    default: m.ProfileSwitcherPopover,
  }))
);

export const AudifyLogoIcon: React.FC<{ className?: string }> = ({
  className = "w-4 h-4",
}) => (
  <img
    src="/audify-icon.png"
    alt="Audify"
    draggable={false}
    className={`${className} shrink-0 object-contain select-none`}
  />
);

export const TopHeaderBar: React.FC = React.memo(() => {
  const hasInitialized = useSampleStore((s) => s.hasInitialized);
  const allProfileSamplesLoaded = useSampleStore(
    (s) => s.allProfileSamples.length > 0
  );
  const favoritesCount = useSampleStore((s) => s.favoritesCount);
  const hasActiveFilter = useSampleStore((s) =>
    Boolean(
      s.searchQuery.trim() ||
        s.folderFilter ||
        s.favoriteOnly ||
        s.recentOnly ||
        s.selectedTagIds.length > 0 ||
        s.selectedGenre ||
        s.selectedCollectionId !== null ||
        s.selectedLicenseGroupId !== null ||
        s.binFilterActive ||
        s.trashFilterActive ||
        s.typeFilter !== "all" ||
        s.srFilter !== null ||
        s.similaritySession
    )
  );
  const isFavoriteOnlyFilter = useSampleStore((s) =>
    Boolean(
      s.favoriteOnly &&
        !s.searchQuery.trim() &&
        !s.folderFilter &&
        !s.recentOnly &&
        s.selectedTagIds.length === 0 &&
        !s.selectedGenre &&
        s.selectedCollectionId === null &&
        s.selectedLicenseGroupId === null &&
        !s.binFilterActive &&
        !s.trashFilterActive &&
        s.typeFilter === "all" &&
        s.srFilter === null &&
        !s.similaritySession
    )
  );
  const profiles = useSampleStore((s) => s.profiles);
  const activeProfile = useSampleStore((s) => s.activeProfile);
  const accentColor = useSampleStore((s) => s.accentColor);
  const filteredCount = useSampleStore((s) => s.samples.length);
  const libraries = useSampleStore((s) => s.libraries);
  const miniDockShortcut = useSampleStore((s) => s.shortcuts.toggleMiniDock);
  const sidebarCollapsed = useSampleStore((s) => s.sidebarCollapsed);
  const sidebarCompactHover = useSampleStore((s) => s.sidebarCompactHover);
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const toggleMiniDock = useSampleStore((s) => s.toggleMiniDock);
  const toggleSidebarCollapsed = useSampleStore(
    (s) => s.toggleSidebarCollapsed
  );
  const switchProfile = useSampleStore((s) => s.switchProfile);
  const createProfile = useSampleStore((s) => s.createProfile);

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [profileMenuPos, setProfileMenuPos] = useState<{
    top: number;
    left: number;
  }>({ top: 34, left: 80 });

  useLayoutEffect(() => {
    if (!isProfileMenuOpen) return;
    const update = () => {
      const rect = profileButtonRef.current?.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      const top = Math.min(window.innerHeight - 240, rect.bottom + 4);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 240));
      setProfileMenuPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const onWindowClick = () => {
      setIsProfileMenuOpen(false);
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsProfileMenuOpen(false);
      }
    };
    window.addEventListener("click", onWindowClick);
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("click", onWindowClick);
      window.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [isProfileMenuOpen]);

  const activeLibraries = libraries.filter(
    (l) => l.is_global !== false || l.assigned_to_profile !== false
  );
  const totalIndexed = activeLibraries.reduce(
    (sum, l) => sum + l.sample_count,
    0
  );
  const effectiveFilteredCount = !allProfileSamplesLoaded
    ? !hasActiveFilter
      ? totalIndexed
      : isFavoriteOnlyFilter && favoritesCount > 0
        ? favoritesCount
        : filteredCount
    : filteredCount;
  const countLabel = !hasInitialized
    ? "Loading..."
    : effectiveFilteredCount !== totalIndexed && totalIndexed > 0
      ? `${effectiveFilteredCount.toLocaleString()} / ${totalIndexed.toLocaleString()} samples`
      : `${totalIndexed.toLocaleString()} samples`;

  const handleTitlebarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.detail !== 1) return;
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("[data-no-drag]")
    ) {
      return;
    }

    beginWindowTitlebarDrag(e.clientX, e.clientY, () => {
      try {
        void getCurrentWindow().startDragging();
      } catch {
        // Fallback in browser preview
      }
    });
  };

  const handleTitlebarDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("[data-no-drag]")
    ) {
      return;
    }

    try {
      void getCurrentWindow().toggleMaximize();
    } catch {
      // Fallback in browser preview
    }
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
      className="h-[32px] bg-surface-1 border-b border-line flex items-center justify-between pl-2.5 pr-0 shrink-0 select-none cursor-default relative z-30"
    >
      {/* Left: Brand Logo + Compact Sidebar Toggle + Fast Workspace Profile Switcher */}
      <div className="flex items-center space-x-2.5">
        <div
          data-tauri-drag-region
          className="flex items-center space-x-1.5 pointer-events-none"
        >
          <AudifyLogoIcon className="w-[18px] h-[18px]" />
          <span className="text-[12px] font-semibold tracking-wide text-fg">
            Audify
          </span>
        </div>

        <button
          type="button"
          data-no-drag="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleSidebarCollapsed}
          aria-pressed={sidebarCollapsed}
          title={
            sidebarCollapsed
              ? sidebarCompactHover
                ? "Expand sidebar (currently Compact Hover mode)"
                : "Expand sidebar"
              : sidebarCompactHover
              ? "Compact sidebar (hover icon rail to peek)"
              : "Collapse sidebar to icon rail"
          }
          className={`w-[22px] h-[22px] rounded-sm border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
            sidebarCollapsed
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-accent"
          }`}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5 shrink-0" />
          )}
        </button>

        {/* Profile Switcher Dropdown */}
        <div
          data-no-drag="true"
          className="relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            ref={profileButtonRef}
            type="button"
            onClick={() => setIsProfileMenuOpen((v) => !v)}
            className="h-[22px] px-2 bg-surface-3 hover:border-accent border border-line rounded-sm flex items-center space-x-1.5 text-[11px] font-mono text-fg whitespace-nowrap"
            title="Switch Workspace Profile"
          >
            <span
              className="w-2 h-2 rounded-[2px] inline-block shrink-0 shadow-xs"
              style={{
                backgroundColor:
                  activeProfile?.color || accentColor || "#F59E0B",
              }}
            />
            <span className="max-w-[140px] truncate">
              {activeProfile?.name || (hasInitialized ? "Default Studio" : "Loading...")}
            </span>
            <ChevronDown className="w-3 h-3 text-fg-2 shrink-0" />
          </button>

          {isProfileMenuOpen && (
            <Suspense fallback={null}>
              <ProfileSwitcherPopover
                profileMenuPos={profileMenuPos}
                profiles={profiles}
                activeProfile={activeProfile}
                onClose={() => setIsProfileMenuOpen(false)}
                onSwitchProfile={switchProfile}
                onCreateProfile={createProfile}
                onOpenManageProfiles={() => {
                  setIsProfileMenuOpen(false);
                  setSettingsOpen(true, "profiles");
                }}
              />
            </Suspense>
          )}
        </div>
      </div>

      {/* Right: Sample Counter + Window Controls */}
      <div className="flex items-center h-full">
        <div
          data-tauri-drag-region
          className="flex items-center font-mono tabular-nums text-[11px] text-fg-2 mr-2.5 pointer-events-none"
        >
          <span>{countLabel}</span>
        </div>

        <button
          type="button"
          data-no-drag="true"
          onClick={() => void toggleMiniDock()}
          title={`Mini Dock Overlay Mode (${
            miniDockShortcut || "Ctrl+M"
          })`}
          className="h-[22px] px-2 mr-2 bg-surface-3 hover:bg-accent-soft hover:border-accent hover:text-accent-fg border border-line rounded-sm flex items-center space-x-1 font-mono text-[10px] text-fg-2 transition-colors"
        >
          <PictureInPicture2 className="w-3 h-3 shrink-0" />
          <span className="hidden md:inline">DOCK</span>
        </button>

        {/* FRAMELESS WINDOW CONTROLS */}
        <WindowCaptionControls />
      </div>
    </header>
  );
});

export const BottomStatusBar: React.FC = React.memo(() => {
  const hasInitialized = useSampleStore((s) => s.hasInitialized);
  const activeProfileName = useSampleStore((s) => s.activeProfile?.name);
  const isScanning = useSampleStore((s) => s.isScanning);
  const scanProgress = useSampleStore((s) => s.scanProgress);
  const isScanningDuplicates = useSampleStore((s) => s.isScanningDuplicates);
  const duplicateScanProgress = useSampleStore(
    (s) => s.duplicateScanProgress
  );
  const statusMessage = useSampleStore((s) => s.statusMessage);
  const selectedSampleSize = useSampleStore(
    (s) => s.selectedSample?.file_size ?? null
  );
  const selectedCount = useSampleStore((s) => s.selectedSampleIds.length);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const selectedTagCount = useSampleStore((s) => s.selectedTagIds.length);
  const collections = useSampleStore((s) => s.collections);
  const inAppDragSample = useSampleStore((s) => s.inAppDragSample);
  const inAppDragCount = useSampleStore((s) => s.inAppDragSamples.length);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  useEffect(() => {
    if (!statusMessage || isScanning) return;
    const timer = window.setTimeout(() => {
      setStatusMessage(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [statusMessage, isScanning, setStatusMessage]);

  const pct = scanProgress ? Math.round(scanProgress.percentage) : 0;
  const dupPct = duplicateScanProgress
    ? Math.min(100, Math.max(0, Math.round(duplicateScanProgress.percentage)))
    : 0;
  const activeCol =
    selectedCollectionId !== null
      ? collections.find((c) => c.id === selectedCollectionId)
      : undefined;

  return (
    <footer
      role="status"
      aria-live="polite"
      className="h-[24px] bg-surface-1 border-t border-line px-3 flex items-center justify-between font-mono tabular-nums text-[11px] text-fg-2 shrink-0 select-none"
    >
      <div className="flex items-center space-x-3 min-w-0 truncate">
        {isScanning && scanProgress ? (
          <div className="flex items-center space-x-2">
            <span className="text-accent-fg font-semibold">
              Scanning [{scanProgress.processed}/{scanProgress.total}] ({pct}%)
            </span>
            <div className="w-[140px] h-[6px] bg-surface-0 border border-line rounded-2xs overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-fg-3 truncate max-w-[320px]">
              {scanProgress.current_file}
            </span>
          </div>
        ) : isScanningDuplicates && duplicateScanProgress ? (
          <div className="flex items-center space-x-2">
            <span className="text-accent-fg font-semibold">
              {duplicateScanProgress.stage_label} ({dupPct}%)
            </span>
            <div className="w-[140px] h-[6px] bg-surface-0 border border-line rounded-2xs overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-75"
                style={{ width: `${dupPct}%` }}
              />
            </div>
            {duplicateScanProgress.current_file && (
              <span className="text-fg-3 truncate max-w-[280px]">
                {duplicateScanProgress.current_file}
              </span>
            )}
          </div>
        ) : inAppDragSample ? (
          <span className="text-accent-fg truncate max-w-[360px]">
            {inAppDragCount > 1
              ? `Dragging ${inAppDragCount} samples`
              : `Dragging: ${inAppDragSample.file_name}`}
          </span>
        ) : statusMessage ? (
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="flex items-center space-x-1.5 text-fg hover:text-accent-fg truncate transition-colors"
            title="Click to dismiss"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span className="truncate">{statusMessage}</span>
          </button>
        ) : (
          <span className="text-fg-3">
            {!hasInitialized
              ? "Loading workspace..."
              : `Ready — Profile: ${activeProfileName || "Default Studio"}`}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-3 shrink-0 text-[10px]">
        {selectedCount > 1 && (
          <span className="text-accent-fg">{selectedCount} selected</span>
        )}
        {favoriteOnly && (
          <span className="text-accent-fg inline-flex items-center space-x-1">
            <Star className="w-3 h-3 fill-current" />
            <span>Favorites</span>
          </span>
        )}
        {selectedTagCount > 0 && (
          <span className="text-accent-fg inline-flex items-center space-x-0.5">
            <Hash className="w-3 h-3" />
            <span>
              {selectedTagCount} tag{selectedTagCount > 1 ? "s" : ""}
            </span>
          </span>
        )}
        {folderFilter && (
          <span className="text-fg truncate max-w-[220px]">{folderFilter}</span>
        )}
        {activeCol && (
          <span className="inline-flex items-center space-x-1 text-accent-fg">
            {activeCol.parent_id ? (
              <span className="w-2 h-2 rounded-[2px] shrink-0 shadow-xs mr-0.5 bg-accent" />
            ) : (
              <CollectionIcon icon={activeCol.icon} className="w-3 h-3" />
            )}
            <span>{activeCol.name}</span>
          </span>
        )}
        {selectedSampleSize !== null && (
          <span className="text-fg-3">
            {(selectedSampleSize / 1024).toFixed(0)} KB
          </span>
        )}
      </div>
    </footer>
  );
});
