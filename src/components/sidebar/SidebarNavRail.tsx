import React from "react";
import {
  FileCheck2,
  HardDrive,
  Hash,
  Inbox,
  LayoutGrid,
  Music,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import type { SidebarTab } from "../LeftSidebar";

interface SidebarNavRailProps {
  railRef: React.RefObject<HTMLDivElement>;
  isMiniOverlay: boolean;
  showContentColumn: boolean;
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  setIsOverlayOpen: (open: boolean) => void;
  isDraggingInApp: boolean;
  isExternalFileDragActive: boolean;
  isDroppableActiveTab: boolean;
  hoveredRailTab: SidebarTab | null;
  dragHoverTarget: string | null;
  dropFlashTarget: string | null;
  enableLicensesSystem: boolean;
  enableAdvancedFileOps: boolean;
  folderFilter: string | null;
  selectedLicenseGroupId: string | null;
  selectedCollectionId: number | null;
  selectedTagIdsCount: number;
  selectedGenre: string | null;
  favoriteOnly: boolean;
  validBinCount: number;
  binFilterActive: boolean;
  trashedCount: number;
  trashFilterActive: boolean;
  scheduleOverlayClose: () => void;
  handleRailTabHoverEnter: (tab: SidebarTab) => void;
  scheduleDragTabSwitch: (tab: SidebarTab) => void;
  cancelDragTabSwitch: () => void;
  updateDragHoverTarget: (next: string | null) => void;
  setFavoriteOnly: (v: boolean) => void;
  setTrashFilterActive: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
}

export const SidebarNavRail: React.FC<SidebarNavRailProps> = ({
  railRef,
  isMiniOverlay,
  showContentColumn,
  activeTab,
  setActiveTab,
  setIsOverlayOpen,
  isDraggingInApp,
  isExternalFileDragActive,
  isDroppableActiveTab,
  hoveredRailTab,
  dragHoverTarget,
  dropFlashTarget,
  enableLicensesSystem,
  enableAdvancedFileOps,
  folderFilter,
  selectedLicenseGroupId,
  selectedCollectionId,
  selectedTagIdsCount,
  selectedGenre,
  favoriteOnly,
  validBinCount,
  binFilterActive,
  trashedCount,
  trashFilterActive,
  scheduleOverlayClose,
  handleRailTabHoverEnter,
  scheduleDragTabSwitch,
  cancelDragTabSwitch,
  updateDragHoverTarget,
  setFavoriteOnly,
  setTrashFilterActive,
  setSettingsOpen,
}) => {
  const railBtnSize = isMiniOverlay ? "w-[26px] h-[28px]" : "w-[32px] h-[34px]";
  const railIconSize = isMiniOverlay ? "w-[15px] h-[15px]" : "w-[18px] h-[18px]";
  const lastPrimaryTabRef = React.useRef<Exclude<SidebarTab, "bin">>("folders");

  React.useEffect(() => {
    if (activeTab !== "bin") {
      lastPrimaryTabRef.current = activeTab;
    }
  }, [activeTab]);

  const primaryTabs: {
    id: SidebarTab;
    label: string;
    icon: React.ReactNode;
    hasActiveFilterDot: boolean;
    countBadge?: number;
    dragEligible: boolean;
    dragActive: boolean;
  }[] = [
    {
      id: "folders",
      label: "Folders",
      icon: <HardDrive className={railIconSize} />,
      hasActiveFilterDot: Boolean(folderFilter && !selectedLicenseGroupId),
      dragEligible: Boolean(enableAdvancedFileOps),
      dragActive: isDraggingInApp || isExternalFileDragActive,
    },
    {
      id: "collections",
      label: "Collections",
      icon: <LayoutGrid className={railIconSize} />,
      hasActiveFilterDot: selectedCollectionId !== null,
      dragEligible: true,
      dragActive: isDraggingInApp,
    },
    {
      id: "tags",
      label: "Tags",
      icon: <Hash className={railIconSize} />,
      hasActiveFilterDot: false,
      countBadge: selectedTagIdsCount,
      dragEligible: true,
      dragActive: isDraggingInApp,
    },
    {
      id: "genres",
      label: "Genres",
      icon: <Music className={railIconSize} />,
      hasActiveFilterDot: selectedGenre !== null,
      dragEligible: true,
      dragActive: isDraggingInApp,
    },
  ];

  if (enableLicensesSystem) {
    primaryTabs.push({
      id: "licenses",
      label: "Licenses",
      icon: <FileCheck2 className={railIconSize} />,
      hasActiveFilterDot: selectedLicenseGroupId !== null,
      dragEligible: false,
      dragActive: false,
    });
  }

  return (
    <div
      ref={railRef}
      data-sidebar="true"
      onMouseLeave={() => {
        if (isMiniOverlay) scheduleOverlayClose();
      }}
      className={`${
        isMiniOverlay
          ? "w-[30px] py-1.5 px-0.5"
          : "w-[40px] border-r border-line py-2 px-1"
      } bg-surface-rail flex flex-col items-center justify-between shrink-0 relative z-20`}
    >
      <div
        className={`flex flex-col items-center ${
          isMiniOverlay ? "space-y-1" : "space-y-1.5"
        } w-full`}
      >
        {primaryTabs.map((tab) => {
          const isDropHovered =
            tab.dragActive && tab.dragEligible && hoveredRailTab === tab.id;
          const isDropTargetHint =
            tab.dragActive && tab.dragEligible && !isDroppableActiveTab;
          const isTabActive = activeTab === tab.id && showContentColumn;

          return (
            <button
              key={tab.id}
              type="button"
              data-sidebar-tab={tab.id}
              data-tooltip={isMiniOverlay ? undefined : tab.label}
              aria-label={tab.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setActiveTab(tab.id);
                if (isMiniOverlay) setIsOverlayOpen(true);
              }}
              onMouseEnter={() => {
                handleRailTabHoverEnter(tab.id);
                scheduleDragTabSwitch(tab.id);
              }}
              onMouseLeave={cancelDragTabSwitch}
              className={`relative ${railBtnSize} rounded-sm flex items-center justify-center transition-all ${
                isDropHovered
                  ? "text-accent-fg bg-accent-soft ring-2 ring-inset ring-accent"
                  : isTabActive
                  ? "text-accent-fg bg-accent-soft"
                  : isDropTargetHint
                  ? "text-accent-fg bg-accent/[0.06] ring-1 ring-inset ring-accent/55"
                  : "text-fg-head hover:text-fg hover:bg-surface-hover"
              }`}
            >
              {isTabActive && (
                <span className="absolute left-[1px] top-1/2 -translate-y-1/2 w-[2.5px] h-[15px] rounded-full bg-accent" />
              )}
              {tab.icon}
              {tab.countBadge !== undefined && tab.countBadge > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[12px] h-[12px] px-0.5 rounded-full bg-accent text-accent-on font-mono text-[8.5px] font-bold flex items-center justify-center">
                  {tab.countBadge}
                </span>
              )}
              {tab.hasActiveFilterDot && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center space-y-1 w-full pt-1.5 border-t border-line">
        {isMiniOverlay && (
          <button
            type="button"
            data-sidebar-drop="favorites"
            data-tooltip="Favorites"
            aria-label="Toggle Favorites"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFavoriteOnly(!favoriteOnly)}
            onMouseEnter={() => {
              if (isDraggingInApp) updateDragHoverTarget("favorites");
            }}
            onMouseLeave={() => {
              if (dragHoverTarget === "favorites") updateDragHoverTarget(null);
            }}
            className={`relative ${railBtnSize} rounded-sm flex items-center justify-center transition-all ${
              dropFlashTarget === "favorites"
                ? "text-accent-fg bg-accent-soft ring-2 ring-inset ring-accent"
                : isDraggingInApp && dragHoverTarget === "favorites"
                ? "text-accent-on bg-accent ring-2 ring-accent"
                : favoriteOnly
                ? "text-accent-fg bg-accent-soft"
                : "text-fg-head hover:text-fg hover:bg-surface-hover"
            }`}
          >
            <Star
              className={`${railIconSize} ${
                favoriteOnly ? "fill-current" : ""
              }`}
            />
          </button>
        )}

        <button
          type="button"
          data-drop-bin="true"
          data-sidebar-drop="bin"
          data-sidebar-tab="bin"
          data-tooltip={isMiniOverlay ? undefined : "Session Bin"}
          aria-label="Session Bin"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (isMiniOverlay) {
              if (activeTab === "bin" && showContentColumn) {
                setIsOverlayOpen(false);
              } else {
                setActiveTab("bin");
                setIsOverlayOpen(true);
              }
              return;
            }
            if (activeTab === "bin") {
              setActiveTab(lastPrimaryTabRef.current);
            } else {
              setActiveTab("bin");
            }
          }}
          onMouseEnter={() => {
            handleRailTabHoverEnter("bin");
            if (isDraggingInApp) updateDragHoverTarget("bin");
            scheduleDragTabSwitch("bin");
          }}
          onMouseLeave={() => {
            if (dragHoverTarget === "bin") updateDragHoverTarget(null);
            cancelDragTabSwitch();
          }}
          className={`relative ${railBtnSize} rounded-sm flex items-center justify-center transition-all ${
            dropFlashTarget === "bin"
              ? "text-accent-fg bg-accent-soft ring-2 ring-inset ring-accent"
              : isDraggingInApp && dragHoverTarget === "bin"
              ? "text-accent-on bg-accent ring-2 ring-accent"
              : isDraggingInApp && !isDroppableActiveTab
              ? "text-accent-fg bg-accent/[0.06] ring-1 ring-inset ring-accent/55"
              : (activeTab === "bin" && showContentColumn) ||
                (isMiniOverlay && binFilterActive)
              ? "text-accent-fg bg-accent-soft"
              : "text-fg-head hover:text-fg hover:bg-surface-hover"
          }`}
        >
          {activeTab === "bin" && showContentColumn && (
            <span className="absolute left-[1px] top-1/2 -translate-y-1/2 w-[2.5px] h-[15px] rounded-full bg-accent" />
          )}
          <Inbox className={railIconSize} />
          {validBinCount > 0 && (
            <span className="absolute top-0.5 right-0 min-w-[13px] h-[12px] px-0.5 rounded-full bg-accent text-accent-on font-mono text-[8.5px] font-bold flex items-center justify-center">
              {validBinCount > 99 ? "99+" : validBinCount}
            </span>
          )}
        </button>

        {(trashedCount > 0 ||
          trashFilterActive ||
          (isDraggingInApp && enableAdvancedFileOps)) && (
          <button
            type="button"
            data-sidebar-drop={enableAdvancedFileOps ? "trash" : undefined}
            data-tooltip="Trash"
            aria-label="Trash"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setTrashFilterActive(!trashFilterActive);
              if (isMiniOverlay) setIsOverlayOpen(false);
            }}
            onMouseEnter={() => {
              if (isDraggingInApp && enableAdvancedFileOps) {
                updateDragHoverTarget("trash");
              }
            }}
            onMouseLeave={() => {
              if (dragHoverTarget === "trash") updateDragHoverTarget(null);
            }}
            className={`relative ${railBtnSize} rounded-sm flex items-center justify-center transition-all ${
              dropFlashTarget === "trash"
                ? "text-accent-fg bg-accent-soft ring-2 ring-inset ring-accent"
                : isDraggingInApp && dragHoverTarget === "trash"
                ? "text-accent-on bg-accent ring-2 ring-accent"
                : trashFilterActive
                ? "text-accent-fg bg-accent-soft"
                : "text-fg-head hover:text-fg hover:bg-surface-hover"
            }`}
          >
            {trashFilterActive && (
              <span className="absolute left-[1px] top-1/2 -translate-y-1/2 w-[2.5px] h-[15px] rounded-full bg-accent" />
            )}
            <Trash2 className={railIconSize} />
            {trashedCount > 0 && (
              <span className="absolute top-0.5 right-0 min-w-[13px] h-[12px] px-0.5 rounded-full bg-accent text-accent-on font-mono text-[8.5px] font-bold flex items-center justify-center">
                {trashedCount > 99 ? "99+" : trashedCount}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          data-tooltip="Settings"
          aria-label="Settings"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSettingsOpen(true)}
          className={`relative ${railBtnSize} rounded-sm flex items-center justify-center text-fg-head hover:text-accent-fg hover:bg-surface-header transition-colors`}
        >
          <SlidersHorizontal
            className={
              isMiniOverlay ? "w-[14px] h-[14px]" : "w-[17px] h-[17px]"
            }
          />
        </button>
      </div>
    </div>
  );
};
