import React, { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUpRight,
  Hash,
  HelpCircle,
  PanelLeft,
  PanelLeftClose,
  PictureInPicture2,
  Star,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppUpdate } from "../hooks/useAppUpdate";
import {
  dismissUpdateBanner,
  openAudifyReleasesPage,
} from "../services/updateCheckService";
import { useSampleStore } from "../store/useSampleStore";
import { resolveActiveBackgroundJob } from "../utils/activeBackgroundJob";
import { beginWindowTitlebarDrag } from "../utils/drag";
import { CollectionIcon } from "./CollectionIcon";
import { NavHistoryButtons } from "./common/NavHistoryButtons";
import { StatusBarAudioDeviceButton } from "./StatusBarAudioDeviceButton";
import { WindowCaptionControls } from "./WindowCaptionControls";

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
        s.excludedTagIds.length > 0 ||
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
        s.excludedTagIds.length === 0 &&
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
  const filteredCount = useSampleStore((s) => s.samples.length);
  const libraries = useSampleStore((s) => s.libraries);
  const miniDockShortcut = useSampleStore((s) => s.shortcuts.toggleMiniDock);
  const sidebarCollapsed = useSampleStore((s) => s.sidebarCollapsed);
  const sidebarCompactHover = useSampleStore((s) => s.sidebarCompactHover);
  const toggleMiniDock = useSampleStore((s) => s.toggleMiniDock);
  const toggleSidebarCollapsed = useSampleStore(
    (s) => s.toggleSidebarCollapsed
  );

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
      {/* Left: Brand Logo + Compact Sidebar Toggle + Navigation History */}
      <div className="flex items-center space-x-2">
        <div
          data-tauri-drag-region
          className="flex items-center space-x-1.5 pointer-events-none mr-0.5"
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

        <NavHistoryButtons />
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
  const jobSnapshot = useSampleStore(
    useShallow((s) => ({
      isScanning: s.isScanning,
      scanProgress: s.scanProgress,
      isDetectingGenres: s.isDetectingGenres,
      genreDetectProgress: s.genreDetectProgress,
      isApplyingAutoTags: s.isApplyingAutoTags,
      autoTagProgress: s.autoTagProgress,
      isAnalyzingBpmKey: s.isAnalyzingBpmKey,
      bpmKeyProgress: s.bpmKeyProgress,
      isDownloadingAiModel: s.isDownloadingAiModel,
      aiDownloadProgress: s.aiDownloadProgress,
      isAnalyzingAi: s.isAnalyzingAi,
      aiIndexProgress: s.aiIndexProgress,
      isScanningDuplicates: s.isScanningDuplicates,
      duplicateScanProgress: s.duplicateScanProgress,
    }))
  );
  const activeJob = resolveActiveBackgroundJob(jobSnapshot);
  const statusMessage = useSampleStore((s) => s.statusMessage);
  const selectedSampleSize = useSampleStore(
    (s) => s.selectedSample?.file_size ?? null
  );
  const selectedCount = useSampleStore((s) => s.selectedSampleIds.length);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const selectedTagCount = useSampleStore((s) => s.selectedTagIds.length);
  const excludedTagCount = useSampleStore((s) => s.excludedTagIds.length);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const collections = useSampleStore((s) => s.collections);
  const inAppDragSample = useSampleStore((s) => s.inAppDragSample);
  const inAppDragCount = useSampleStore((s) => s.inAppDragSamples.length);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);
  const appUpdate = useAppUpdate();

  const hasActiveJob = activeJob !== null;
  useEffect(() => {
    if (!statusMessage || hasActiveJob) return;
    const timer = window.setTimeout(() => {
      setStatusMessage(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [statusMessage, hasActiveJob, setStatusMessage]);

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
        {activeJob ? (
          <div
            data-testid="main-job-progress-bar"
            className="flex items-center space-x-2 min-w-0"
          >
            <span className="text-accent-fg font-semibold shrink-0">
              {activeJob.label}
              {activeJob.countLabel ? ` [${activeJob.countLabel}]` : ""} (
              {activeJob.percentage}%)
            </span>
            <div className="w-[140px] h-[6px] bg-surface-0 border border-line rounded-2xs overflow-hidden shrink-0">
              <div
                className={`h-full bg-accent transition-[width] duration-75 ${
                  activeJob.indeterminate ? "animate-pulse" : ""
                }`}
                style={{
                  width: activeJob.indeterminate
                    ? "28%"
                    : `${activeJob.percentage}%`,
                }}
              />
            </div>
            {activeJob.detail && (
              <span className="text-fg-3 truncate max-w-[300px]">
                {activeJob.detail}
              </span>
            )}
            {activeJob.activeCount > 1 && (
              <span
                className="px-1 rounded-2xs bg-accent-soft border border-accent/40 text-accent-fg text-[9.5px] font-semibold shrink-0"
                title={`${activeJob.activeCount} background tasks running`}
              >
                +{activeJob.activeCount - 1}
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
        {selectedGenre && (
          <span className="text-accent-fg inline-flex items-center space-x-0.5">
            <span>♫ {selectedGenre}</span>
          </span>
        )}
        {selectedTagCount > 0 && (
          <span className="text-accent-fg inline-flex items-center space-x-0.5">
            <Hash className="w-3 h-3" />
            <span>
              {selectedTagCount} filter{selectedTagCount > 1 ? "s" : ""}
            </span>
          </span>
        )}
        {excludedTagCount > 0 && (
          <span className="text-fg-2 inline-flex items-center space-x-0.5">
            <span>
              NOT {excludedTagCount}
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
        {appUpdate.isBannerVisible && appUpdate.info && (
          <div className="h-[18px] inline-flex items-center rounded-[3px] bg-accent-soft border border-accent text-accent-fg overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() =>
                void openAudifyReleasesPage(appUpdate.info?.release_url)
              }
              title={`Audify v${appUpdate.info.latest_version} is available — click to open GitHub Releases`}
              className="h-full px-1.5 inline-flex items-center gap-0.5 font-mono text-[9.5px] font-semibold hover:bg-accent hover:text-accent-on transition-colors cursor-pointer"
            >
              <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
              <span>Update v{appUpdate.info.latest_version}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                dismissUpdateBanner(appUpdate.info!.latest_version)
              }
              title="Dismiss update notice for this version"
              aria-label="Dismiss update notice"
              className="h-full w-[16px] border-l border-accent flex items-center justify-center hover:bg-accent hover:text-accent-on transition-colors cursor-pointer"
            >
              <X className="w-2.5 h-2.5 shrink-0" />
            </button>
          </div>
        )}
        <StatusBarAudioDeviceButton />
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("audify:toggle-shortcuts-cheatsheet")
            );
          }}
          className="h-[18px] w-[18px] rounded-xs border border-transparent hover:border-line hover:bg-surface-2 text-fg-3 hover:text-accent-fg inline-flex items-center justify-center transition-colors shrink-0"
          title="Keyboard Shortcuts (? / F1)"
          aria-label="Keyboard Shortcuts (? / F1)"
        >
          <HelpCircle className="w-3 h-3" />
        </button>
      </div>
    </footer>
  );
});
