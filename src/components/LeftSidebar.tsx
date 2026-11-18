import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExternalFolderDrop } from "../hooks/useExternalFolderDrop";
import { useLeftSidebarDragDrop } from "../hooks/useLeftSidebarDragDrop";
import { useSampleStore } from "../store/useSampleStore";
import { filterVisibleLibraries } from "../utils/format";
import { FoldersTreeTab } from "./sidebar/FoldersTreeTab";
import { LibraryViewsSection } from "./sidebar/LibraryViewsSection";
import { SidebarNavRail } from "./sidebar/SidebarNavRail";

const CollectionsTreeTab = lazy(() =>
  import("./sidebar/CollectionsTreeTab").then((m) => ({
    default: m.CollectionsTreeTab,
  }))
);
const TagsSidebarTab = lazy(() =>
  import("./sidebar/TagsSidebarTab").then((m) => ({
    default: m.TagsSidebarTab,
  }))
);
const GenresSidebarTab = lazy(() =>
  import("./sidebar/GenresSidebarTab").then((m) => ({
    default: m.GenresSidebarTab,
  }))
);
const LicensesTreeTab = lazy(() =>
  import("./sidebar/LicensesTreeTab").then((m) => ({
    default: m.LicensesTreeTab,
  }))
);
const SessionBinTab = lazy(() =>
  import("./sidebar/SessionBinTab").then((m) => ({
    default: m.SessionBinTab,
  }))
);

export type SidebarTab =
  | "folders"
  | "collections"
  | "tags"
  | "genres"
  | "licenses"
  | "bin";

interface LeftSidebarProps {
  mode?: "docked" | "mini-overlay";
}

function hasOpenFloatingPortal(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      "[data-context-menu-portal], [data-quick-create-portal], [data-color-picker-portal]"
    )
  );
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  mode = "docked",
}) => {
  const isMiniOverlay = mode === "mini-overlay";
  const libraries = useSampleStore((s) => s.libraries);
  const totalFavoritesCount = useSampleStore((s) => s.favoritesCount);
  const knownSampleIds = useSampleStore((s) => s.knownSampleIds);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const recentOnly = useSampleStore((s) => s.recentOnly);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const recentSampleIds = useSampleStore((s) => s.recentSampleIds);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const selectedLicenseGroupId = useSampleStore(
    (s) => s.selectedLicenseGroupId
  );
  const typeFilter = useSampleStore((s) => s.typeFilter);
  const binSampleIds = useSampleStore((s) => s.binSampleIds);
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const totalTrashedCount = trashedCount + trashedSliceCount;
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);

  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );

  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const setFavoriteOnly = useSampleStore((s) => s.setFavoriteOnly);
  const setRecentOnly = useSampleStore((s) => s.setRecentOnly);
  const setTrashFilterActive = useSampleStore((s) => s.setTrashFilterActive);
  const setTypeFilter = useSampleStore((s) => s.setTypeFilter);
  const clearRecentSamples = useSampleStore((s) => s.clearRecentSamples);
  const selectAllFiles = useSampleStore((s) => s.selectAllFiles);
  const resetAllFilters = useSampleStore((s) => s.resetAllFilters);

  const sidebarRef = useRef<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("folders");
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTabTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    if (hoverTabTimerRef.current) {
      clearTimeout(hoverTabTimerRef.current);
      hoverTabTimerRef.current = null;
    }
  }, []);

  const scheduleOverlayClose = useCallback(() => {
    if (!isMiniOverlay) return;
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverTabTimerRef.current) {
      clearTimeout(hoverTabTimerRef.current);
      hoverTabTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (
        hasOpenFloatingPortal() ||
        useSampleStore.getState().inAppDragSample !== null
      ) {
        return;
      }
      setIsOverlayOpen(false);
    }, 135);
  }, [isMiniOverlay]);

  const handleRailTabHoverEnter = useCallback(
    (tab: SidebarTab) => {
      if (!isMiniOverlay) return;
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
      if (!isOverlayOpen) {
        if (hoverOpenTimerRef.current) {
          clearTimeout(hoverOpenTimerRef.current);
        }
        hoverOpenTimerRef.current = setTimeout(() => {
          hoverOpenTimerRef.current = null;
          window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
          setActiveTab(tab);
          setIsOverlayOpen(true);
        }, 65);
      } else {
        if (hoverTabTimerRef.current) {
          clearTimeout(hoverTabTimerRef.current);
        }
        hoverTabTimerRef.current = setTimeout(() => {
          hoverTabTimerRef.current = null;
          setActiveTab(tab);
        }, 115);
      }
    },
    [isMiniOverlay, isOverlayOpen]
  );

  const handleOverlayPanelEnter = useCallback(() => {
    if (!isMiniOverlay) return;
    clearHoverTimers();
  }, [isMiniOverlay, clearHoverTimers]);

  useEffect(() => {
    return () => clearHoverTimers();
  }, [clearHoverTimers]);

  // Dismiss Mini Dock floating sidebar overlay on outside click or Escape
  useEffect(() => {
    if (!isMiniOverlay || !isOverlayOpen) return;
    const onMouseDownCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        railRef.current?.contains(target) ||
        panelRef.current?.contains(target) ||
        target.closest(
          "[data-context-menu-portal], [data-quick-create-portal], [data-color-picker-portal]"
        )
      ) {
        return;
      }
      setIsOverlayOpen(false);
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hasOpenFloatingPortal()) {
        e.preventDefault();
        e.stopPropagation();
        setIsOverlayOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDownCapture, true);
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDownCapture, true);
      window.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [isMiniOverlay, isOverlayOpen]);

  useEffect(() => {
    if (!enableLicensesSystem && activeTab === "licenses") {
      setActiveTab("folders");
    }
  }, [enableLicensesSystem, activeTab]);

  const {
    dragHoverTarget,
    dragHoverTargetRef,
    isPointerInSidebar,
    setIsPointerInSidebar,
    hoveredRailTab,
    setHoveredRailTab,
    dropFlashTarget,
    isExternalFileDragRef,
    updateDragHoverTarget,
    triggerDropFlash,
    cancelDragTabSwitch,
    scheduleDragTabSwitch,
  } = useLeftSidebarDragDrop({
    isMiniOverlay,
    isDraggingInApp,
    sidebarRef,
    railRef,
    panelRef,
    setActiveTab,
    setIsOverlayOpen,
  });

  const isExternalFileDragActive = useExternalFolderDrop({
    enableAdvancedFileOps,
    isMiniOverlay,
    dragHoverTargetRef,
    isExternalFileDragRef,
    updateDragHoverTarget,
    setIsPointerInSidebar,
    setHoveredRailTab,
    cancelDragTabSwitch,
    scheduleDragTabSwitch,
    triggerDropFlash,
    setActiveTab,
    setIsOverlayOpen,
  });

  const visibleLibraries = useMemo(
    () => filterVisibleLibraries(libraries),
    [libraries]
  );

  const totalSamplesCount = useMemo(
    () => visibleLibraries.reduce((sum, l) => sum + l.sample_count, 0),
    [visibleLibraries]
  );

  const { recentSamplesCount, validBinCount } = useMemo(() => {
    if (recentSampleIds.length === 0 && binSampleIds.length === 0) {
      return { recentSamplesCount: 0, validBinCount: 0 };
    }
    return {
      recentSamplesCount: recentSampleIds.filter((id) => knownSampleIds.has(id))
        .length,
      validBinCount: binSampleIds.filter((id) => knownSampleIds.has(id)).length,
    };
  }, [recentSampleIds, binSampleIds, knownSampleIds]);

  const isAllActive =
    !favoriteOnly &&
    !recentOnly &&
    !duplicatesFilterActive &&
    !folderFilter &&
    selectedCollectionId === null &&
    selectedLicenseGroupId === null &&
    !binFilterActive &&
    !trashFilterActive &&
    typeFilter === "all" &&
    selectedTagIds.length === 0 &&
    selectedGenre === null;

  const isDroppableActiveTab =
    (activeTab === "folders" && enableAdvancedFileOps) ||
    activeTab === "collections" ||
    activeTab === "tags" ||
    activeTab === "genres" ||
    activeTab === "bin";

  const showContentColumn = !isMiniOverlay || isOverlayOpen;

  return (
    <aside
      ref={sidebarRef}
      className={
        isMiniOverlay
          ? "w-[30px] bg-surface-rail border-r border-line flex flex-row shrink-0 select-none relative z-30"
          : "w-[296px] bg-surface-1 border-r border-line flex flex-row shrink-0 select-none overflow-hidden relative"
      }
    >
      <SidebarNavRail
        railRef={railRef}
        isMiniOverlay={isMiniOverlay}
        showContentColumn={showContentColumn}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setIsOverlayOpen={setIsOverlayOpen}
        isDraggingInApp={isDraggingInApp}
        isExternalFileDragActive={isExternalFileDragActive}
        isDroppableActiveTab={isDroppableActiveTab}
        hoveredRailTab={hoveredRailTab}
        dragHoverTarget={dragHoverTarget}
        dropFlashTarget={dropFlashTarget}
        enableLicensesSystem={enableLicensesSystem}
        enableAdvancedFileOps={enableAdvancedFileOps}
        folderFilter={folderFilter}
        selectedLicenseGroupId={selectedLicenseGroupId}
        selectedCollectionId={selectedCollectionId}
        selectedTagIdsCount={selectedTagIds.length}
        selectedGenre={selectedGenre}
        favoriteOnly={favoriteOnly}
        validBinCount={validBinCount}
        binFilterActive={binFilterActive}
        trashedCount={totalTrashedCount}
        trashFilterActive={trashFilterActive}
        scheduleOverlayClose={scheduleOverlayClose}
        handleRailTabHoverEnter={handleRailTabHoverEnter}
        scheduleDragTabSwitch={scheduleDragTabSwitch}
        cancelDragTabSwitch={cancelDragTabSwitch}
        updateDragHoverTarget={updateDragHoverTarget}
        setFavoriteOnly={setFavoriteOnly}
        setTrashFilterActive={setTrashFilterActive}
        setSettingsOpen={setSettingsOpen}
      />

      {showContentColumn && (
        <div
          ref={panelRef}
          data-sidebar="true"
          data-mica-overlay={isMiniOverlay ? "true" : undefined}
          onMouseEnter={handleOverlayPanelEnter}
          onMouseLeave={() => {
            if (isMiniOverlay) scheduleOverlayClose();
          }}
          className={
            isMiniOverlay
              ? "absolute left-[30px] top-0 bottom-0 w-[min(252px,calc(100vw-32px))] bg-surface-1 border-r border-line-strong shadow-2xl flex flex-col overflow-hidden z-40"
              : "flex-1 min-w-0 flex flex-col overflow-hidden"
          }
        >
          <LibraryViewsSection
            isMiniOverlay={isMiniOverlay}
            isAllActive={isAllActive}
            isDraggingInApp={isDraggingInApp}
            inAppDragCount={inAppDragCount}
            dragHoverTarget={dragHoverTarget}
            dropFlashTarget={dropFlashTarget}
            favoriteOnly={favoriteOnly}
            recentOnly={recentOnly}
            typeFilter={typeFilter}
            totalSamplesCount={totalSamplesCount}
            totalFavoritesCount={totalFavoritesCount}
            recentSamplesCount={recentSamplesCount}
            setIsOverlayOpen={setIsOverlayOpen}
            selectAllFiles={selectAllFiles}
            resetAllFilters={resetAllFilters}
            setFavoriteOnly={setFavoriteOnly}
            setRecentOnly={setRecentOnly}
            clearRecentSamples={clearRecentSamples}
            setTypeFilter={setTypeFilter}
            updateDragHoverTarget={updateDragHoverTarget}
          />

          <div
            className={`relative flex-1 min-h-0 flex flex-col overflow-hidden transition-colors duration-100 ${
              isDraggingInApp && isDroppableActiveTab
                ? isPointerInSidebar
                  ? "bg-accent/[0.03]"
                  : "bg-surface-2"
                : ""
            }`}
          >
            {dropFlashTarget === "bin" && activeTab === "bin" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-30 ring-1 ring-inset ring-accent bg-accent-soft transition-opacity"
              />
            )}
            {activeTab === "folders" && (
              <FoldersTreeTab
                dragHoverTarget={dragHoverTarget}
                setDragHoverTarget={updateDragHoverTarget}
                dropFlashTarget={dropFlashTarget}
                isExternalFileDragActive={isExternalFileDragActive}
              />
            )}
            {activeTab !== "folders" && (
              <Suspense fallback={null}>
                {activeTab === "collections" && (
                  <CollectionsTreeTab
                    dragHoverTarget={dragHoverTarget}
                    setDragHoverTarget={updateDragHoverTarget}
                    dropFlashTarget={dropFlashTarget}
                  />
                )}
                {activeTab === "tags" && (
                  <TagsSidebarTab
                    dragHoverTarget={dragHoverTarget}
                    setDragHoverTarget={updateDragHoverTarget}
                    dropFlashTarget={dropFlashTarget}
                  />
                )}
                {activeTab === "genres" && (
                  <GenresSidebarTab
                    dragHoverTarget={dragHoverTarget}
                    setDragHoverTarget={updateDragHoverTarget}
                    dropFlashTarget={dropFlashTarget}
                  />
                )}
                {activeTab === "licenses" && enableLicensesSystem && (
                  <LicensesTreeTab />
                )}
                {activeTab === "bin" && (
                  <SessionBinTab
                    dragHoverTarget={dragHoverTarget}
                    setDragHoverTarget={updateDragHoverTarget}
                  />
                )}
              </Suspense>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
