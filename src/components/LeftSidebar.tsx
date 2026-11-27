import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExternalFolderDrop } from "../hooks/useExternalFolderDrop";
import { useLeftSidebarDragDrop } from "../hooks/useLeftSidebarDragDrop";
import { useSampleStore } from "../store/useSampleStore";
import { filterVisibleLibraries } from "../utils/format";
import { LibraryViewsSection } from "./sidebar/LibraryViewsSection";
import { SidebarNavRail } from "./sidebar/SidebarNavRail";
import { useSidebarHoverOverlay } from "./sidebar/useSidebarHoverOverlay";

const FoldersTreeTab = lazy(() =>
  import("./sidebar/FoldersTreeTab").then((m) => ({
    default: m.FoldersTreeTab,
  }))
);
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

import type { SidebarTab } from "../store/types";
export type { SidebarTab };

interface LeftSidebarProps {
  mode?: "docked" | "mini-overlay";
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  mode = "docked",
}) => {
  const isMiniOverlay = mode === "mini-overlay";
  const libraries = useSampleStore((s) => s.libraries);
  const trackFavoritesCount = useSampleStore((s) => s.favoritesCount);
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const totalFavoritesCount = useMemo(() => {
    let sliceFavs = 0;
    for (const s of sliceHistory) {
      if (s.is_favorite) sliceFavs++;
    }
    let layerFavs = 0;
    for (const l of layerHistory) {
      if (l.is_favorite) layerFavs++;
    }
    return trackFavoritesCount + sliceFavs + layerFavs;
  }, [trackFavoritesCount, sliceHistory, layerHistory]);
  const knownSampleIds = useSampleStore((s) => s.knownSampleIds);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const recentOnly = useSampleStore((s) => s.recentOnly);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const layersFilterActive = useSampleStore((s) => s.layersFilterActive);
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
  const trashedLayerCount = useSampleStore((s) => s.trashedLayerCount);
  const totalTrashedCount = trashedCount + trashedSliceCount + trashedLayerCount;
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);

  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );

  const sidebarCollapsed = useSampleStore((s) => s.sidebarCollapsed);
  const sidebarCompactHover = useSampleStore((s) => s.sidebarCompactHover);

  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);
  const setFavoriteOnly = useSampleStore((s) => s.setFavoriteOnly);
  const setRecentOnly = useSampleStore((s) => s.setRecentOnly);
  const setBinFilterActive = useSampleStore((s) => s.setBinFilterActive);
  const setTrashFilterActive = useSampleStore((s) => s.setTrashFilterActive);
  const setSidebarCollapsed = useSampleStore((s) => s.setSidebarCollapsed);
  const clearRecentSamples = useSampleStore((s) => s.clearRecentSamples);
  const selectAllFiles = useSampleStore((s) => s.selectAllFiles);
  const resetAllFilters = useSampleStore((s) => s.resetAllFilters);

  const isMainHoverCompact =
    !isMiniOverlay && sidebarCollapsed && sidebarCompactHover;
  const isHoverOverlayMode = isMiniOverlay || isMainHoverCompact;

  const sidebarRef = useRef<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("folders");
  const lastLibraryTabRef = useRef<SidebarTab>("folders");
  const prevScopedFiltersRef = useRef({
    bin: binFilterActive,
    trash: trashFilterActive,
    slices: slicesFilterActive,
    layers: layersFilterActive,
    duplicates: duplicatesFilterActive,
  });
  const {
    isOverlayOpen,
    setIsOverlayOpen,
    scheduleOverlayClose,
    handleRailTabHoverEnter,
    handleOverlayPanelEnter,
  } = useSidebarHoverOverlay({
    isHoverOverlayMode,
    railRef,
    panelRef,
    setActiveTab,
  });

  useEffect(() => {
    if (activeTab !== "bin" && activeTab !== "trash") {
      lastLibraryTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    const prev = prevScopedFiltersRef.current;
    if (trashFilterActive && !prev.trash) {
      setActiveTab("trash");
    } else if (!trashFilterActive && prev.trash) {
      setActiveTab((cur) =>
        cur === "trash" ? lastLibraryTabRef.current : cur
      );
    }

    if (binFilterActive && !prev.bin) {
      setActiveTab("bin");
    } else if (!binFilterActive && prev.bin) {
      setActiveTab((cur) => (cur === "bin" ? lastLibraryTabRef.current : cur));
    }

    if (
      (slicesFilterActive && !prev.slices) ||
      (layersFilterActive && !prev.layers) ||
      (duplicatesFilterActive && !prev.duplicates)
    ) {
      setActiveTab("folders");
    }

    prevScopedFiltersRef.current = {
      bin: binFilterActive,
      trash: trashFilterActive,
      slices: slicesFilterActive,
      layers: layersFilterActive,
      duplicates: duplicatesFilterActive,
    };
  }, [
    binFilterActive,
    trashFilterActive,
    slicesFilterActive,
    layersFilterActive,
    duplicatesFilterActive,
  ]);

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
    isMiniOverlay: isHoverOverlayMode,
    isOverlayOpen,
    isDraggingInApp,
    sidebarRef,
    railRef,
    panelRef,
    setActiveTab,
    setIsOverlayOpen,
  });

  const isExternalFileDragActive = useExternalFolderDrop({
    enableAdvancedFileOps,
    isMiniOverlay: isHoverOverlayMode,
    isOverlayOpen,
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
    !slicesFilterActive &&
    !layersFilterActive &&
    !folderFilter &&
    selectedCollectionId === null &&
    selectedLicenseGroupId === null &&
    !binFilterActive &&
    !trashFilterActive &&
    typeFilter === "all" &&
    selectedTagIds.length === 0 &&
    selectedGenre === null;

  const isDroppableActiveTab =
    (activeTab === "folders" &&
      enableAdvancedFileOps &&
      !favoriteOnly &&
      !binFilterActive &&
      !trashFilterActive &&
      !slicesFilterActive &&
      !layersFilterActive &&
      !duplicatesFilterActive) ||
    activeTab === "collections" ||
    activeTab === "tags" ||
    activeTab === "genres";

  const showContentColumn = isHoverOverlayMode
    ? isOverlayOpen
    : !sidebarCollapsed;
  const shouldRenderPanel = isHoverOverlayMode || !sidebarCollapsed;
  const isOverlayPanelHidden = isHoverOverlayMode && !isOverlayOpen;

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (isOverlayPanelHidden) {
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("inert");
    }
  }, [isOverlayPanelHidden, shouldRenderPanel]);

  const handlePrimaryTabSelect = useCallback(
    (tab: SidebarTab) => {
      if (trashFilterActive) {
        setTrashFilterActive(false);
      } else if (binFilterActive && tab === "folders") {
        setBinFilterActive(false);
      }
      setActiveTab(tab);
      if (isHoverOverlayMode) {
        setIsOverlayOpen(true);
      } else if (sidebarCollapsed) {
        setSidebarCollapsed(false);
      }
    },
    [
      trashFilterActive,
      binFilterActive,
      setTrashFilterActive,
      setBinFilterActive,
      isHoverOverlayMode,
      sidebarCollapsed,
      setSidebarCollapsed,
      setIsOverlayOpen,
    ]
  );

  const handleBinRailSelect = useCallback(() => {
    if (binFilterActive) {
      if (showContentColumn && activeTab !== "bin") {
        setActiveTab("bin");
        return;
      }
      setBinFilterActive(false);
      if (isHoverOverlayMode) setIsOverlayOpen(false);
      return;
    }
    setBinFilterActive(true);
    setActiveTab("bin");
    if (isHoverOverlayMode) setIsOverlayOpen(false);
  }, [
    binFilterActive,
    showContentColumn,
    activeTab,
    setBinFilterActive,
    isHoverOverlayMode,
    setIsOverlayOpen,
  ]);

  const handleTrashRailSelect = useCallback(() => {
    if (trashFilterActive) {
      if (showContentColumn && activeTab !== "trash") {
        setActiveTab("trash");
        return;
      }
      setTrashFilterActive(false);
      if (isHoverOverlayMode) setIsOverlayOpen(false);
      return;
    }
    setTrashFilterActive(true);
    setActiveTab("trash");
    if (isHoverOverlayMode) setIsOverlayOpen(false);
  }, [
    trashFilterActive,
    showContentColumn,
    activeTab,
    setTrashFilterActive,
    isHoverOverlayMode,
    setIsOverlayOpen,
  ]);

  return (
    <aside
      ref={sidebarRef}
      className={
        isMiniOverlay
          ? "w-[40px] bg-surface-rail border-r border-line flex flex-row shrink-0 select-none relative z-50 overflow-visible"
          : isMainHoverCompact
          ? "w-[40px] bg-surface-rail border-r border-line flex flex-row shrink-0 select-none relative z-50 overflow-visible"
          : sidebarCollapsed
          ? "w-[40px] bg-surface-rail border-r border-line flex flex-row shrink-0 select-none overflow-hidden relative"
          : "w-[320px] bg-surface-1 border-r border-line flex flex-row shrink-0 select-none overflow-hidden relative"
      }
    >
      <SidebarNavRail
        railRef={railRef}
        isMiniOverlay={isMiniOverlay}
        isHoverOverlayMode={isHoverOverlayMode}
        showContentColumn={showContentColumn}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onPrimaryTabSelect={handlePrimaryTabSelect}
        onBinRailSelect={handleBinRailSelect}
        onTrashRailSelect={handleTrashRailSelect}
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
        validBinCount={validBinCount}
        binFilterActive={binFilterActive}
        trashedCount={totalTrashedCount}
        trashFilterActive={trashFilterActive}
        scheduleOverlayClose={scheduleOverlayClose}
        handleRailTabHoverEnter={handleRailTabHoverEnter}
        scheduleDragTabSwitch={scheduleDragTabSwitch}
        cancelDragTabSwitch={cancelDragTabSwitch}
        updateDragHoverTarget={updateDragHoverTarget}
        setBinFilterActive={setBinFilterActive}
        setTrashFilterActive={setTrashFilterActive}
        setSettingsOpen={setSettingsOpen}
      />

      {shouldRenderPanel && (
        <div
          ref={panelRef}
          data-sidebar="true"
          data-mica-overlay={isHoverOverlayMode ? "true" : undefined}
          aria-hidden={isHoverOverlayMode && !isOverlayOpen ? true : undefined}
          onMouseEnter={handleOverlayPanelEnter}
          onMouseLeave={() => {
            if (isHoverOverlayMode) scheduleOverlayClose();
          }}
          className={
            isHoverOverlayMode
              ? `absolute left-[40px] ${
                  isMiniOverlay
                    ? "w-[min(280px,calc(100vw-42px))]"
                    : "w-[280px]"
                } top-0 bottom-0 bg-surface-1 border-r border-line-strong shadow-2xl flex flex-col overflow-hidden z-40 transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none will-change-transform ${
                  isOverlayOpen
                    ? "opacity-100 translate-x-0 pointer-events-auto"
                    : "opacity-0 -translate-x-2 pointer-events-none"
                }`
              : "flex-1 min-w-0 flex flex-col overflow-hidden"
          }
        >
          <LibraryViewsSection
            isMiniOverlay={isHoverOverlayMode}
            isAllActive={isAllActive}
            isDraggingInApp={isDraggingInApp}
            inAppDragCount={inAppDragCount}
            dragHoverTarget={dragHoverTarget}
            dropFlashTarget={dropFlashTarget}
            favoriteOnly={favoriteOnly}
            recentOnly={recentOnly}
            totalSamplesCount={totalSamplesCount}
            totalFavoritesCount={totalFavoritesCount}
            recentSamplesCount={recentSamplesCount}
            setIsOverlayOpen={setIsOverlayOpen}
            selectAllFiles={selectAllFiles}
            resetAllFilters={resetAllFilters}
            setFavoriteOnly={setFavoriteOnly}
            setRecentOnly={setRecentOnly}
            clearRecentSamples={clearRecentSamples}
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
            <Suspense fallback={null}>
              {(activeTab === "folders" ||
                activeTab === "bin" ||
                activeTab === "trash") && (
                <FoldersTreeTab
                  forcedScope={
                    activeTab === "bin"
                      ? "bin"
                      : activeTab === "trash"
                      ? "trash"
                      : undefined
                  }
                  dragHoverTarget={dragHoverTarget}
                  setDragHoverTarget={updateDragHoverTarget}
                  dropFlashTarget={dropFlashTarget}
                  isExternalFileDragActive={isExternalFileDragActive}
                />
              )}
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
            </Suspense>
          </div>
        </div>
      )}
    </aside>
  );
};
