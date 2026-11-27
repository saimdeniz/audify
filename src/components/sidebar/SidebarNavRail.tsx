import React from "react";
import {
  FileCheck2,
  HardDrive,
  Hash,
  Inbox,
  LayoutGrid,
  Music,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { SidebarTab } from "../LeftSidebar";

interface SidebarNavRailProps {
  railRef: React.RefObject<HTMLDivElement>;
  isMiniOverlay: boolean;
  isHoverOverlayMode?: boolean;
  showContentColumn: boolean;
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  onPrimaryTabSelect?: (tab: SidebarTab) => void;
  onBinRailSelect?: () => void;
  onTrashRailSelect?: () => void;
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
  favoriteOnly?: boolean;
  validBinCount: number;
  binFilterActive: boolean;
  trashedCount: number;
  trashFilterActive: boolean;
  scheduleOverlayClose: () => void;
  handleRailTabHoverEnter: (tab: SidebarTab) => void;
  scheduleDragTabSwitch: (tab: SidebarTab) => void;
  cancelDragTabSwitch: () => void;
  updateDragHoverTarget: (next: string | null) => void;
  setFavoriteOnly?: (v: boolean) => void;
  setBinFilterActive?: (v: boolean) => void;
  setTrashFilterActive: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
}

export const SidebarNavRail: React.FC<SidebarNavRailProps> = ({
  railRef,
  isMiniOverlay,
  isHoverOverlayMode = isMiniOverlay,
  showContentColumn,
  activeTab,
  setActiveTab,
  onPrimaryTabSelect,
  onBinRailSelect,
  onTrashRailSelect,
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
  validBinCount,
  binFilterActive,
  trashedCount,
  trashFilterActive,
  scheduleOverlayClose,
  handleRailTabHoverEnter,
  scheduleDragTabSwitch,
  cancelDragTabSwitch,
  updateDragHoverTarget,
  setBinFilterActive,
  setTrashFilterActive,
  setSettingsOpen,
}) => {
  const railBtnSize = "w-[32px] h-[34px]";
  const railIconSize = "w-[18px] h-[18px]";

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
        if (isHoverOverlayMode) scheduleOverlayClose();
      }}
      className="w-[40px] border-r border-line py-2 px-1 bg-surface-rail flex flex-col items-center justify-between shrink-0 relative z-20"
    >
      <div className="flex flex-col items-center space-y-1.5 w-full">
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
              data-tooltip={isHoverOverlayMode ? undefined : tab.label}
              aria-label={tab.label}
              aria-current={isTabActive ? "page" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (onPrimaryTabSelect) {
                  onPrimaryTabSelect(tab.id);
                } else if (isHoverOverlayMode) {
                  setActiveTab(tab.id);
                  setIsOverlayOpen(true);
                } else {
                  setActiveTab(tab.id);
                }
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
                <span className="absolute top-0.5 right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-accent text-accent-on font-mono text-[9.5px] font-bold flex items-center justify-center">
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
        {(() => {
          const isBinActiveTab =
            binFilterActive && (showContentColumn ? activeTab === "bin" : true);
          const isBinCrossFiltering =
            binFilterActive && showContentColumn && activeTab !== "bin";
          return (
            <button
              type="button"
              data-drop-bin="true"
              data-sidebar-drop="bin"
              data-sidebar-tab="bin"
              data-tooltip="Session Bin"
              aria-label="Session Bin"
              aria-current={isBinActiveTab ? "page" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (onBinRailSelect) {
                  onBinRailSelect();
                } else {
                  setBinFilterActive?.(!binFilterActive);
                  if (isHoverOverlayMode) setIsOverlayOpen(false);
                }
              }}
              onMouseEnter={() => {
                if (isDraggingInApp) {
                  updateDragHoverTarget("bin");
                } else if (isHoverOverlayMode && binFilterActive) {
                  handleRailTabHoverEnter("bin");
                }
              }}
              onMouseLeave={() => {
                if (dragHoverTarget === "bin") updateDragHoverTarget(null);
              }}
              className={`relative ${railBtnSize} rounded-sm flex items-center justify-center transition-all ${
                dropFlashTarget === "bin"
                  ? "text-accent-fg bg-accent-soft ring-2 ring-inset ring-accent"
                  : isDraggingInApp && dragHoverTarget === "bin"
                  ? "text-accent-on bg-accent ring-2 ring-accent"
                  : isDraggingInApp && !isDroppableActiveTab
                  ? "text-accent-fg bg-accent/[0.06] ring-1 ring-inset ring-accent/55"
                  : isBinActiveTab
                  ? "text-accent-fg bg-accent-soft"
                  : isBinCrossFiltering
                  ? "text-accent-fg hover:bg-surface-hover"
                  : "text-fg-head hover:text-fg hover:bg-surface-hover"
              }`}
            >
              {isBinActiveTab && (
                <span className="absolute left-[1px] top-1/2 -translate-y-1/2 w-[2.5px] h-[15px] rounded-full bg-accent" />
              )}
              <Inbox className={railIconSize} />
              {validBinCount > 0 && (
                <span className="absolute top-0.5 right-0 min-w-[14px] h-[13px] px-0.5 rounded-full bg-accent text-accent-on font-mono text-[9.5px] font-bold flex items-center justify-center">
                  {validBinCount > 99 ? "99+" : validBinCount}
                </span>
              )}
            </button>
          );
        })()}

        {(trashedCount > 0 ||
          trashFilterActive ||
          (isDraggingInApp && enableAdvancedFileOps)) &&
          (() => {
            const isTrashActiveTab =
              trashFilterActive &&
              (showContentColumn ? activeTab === "trash" : true);
            return (
              <button
                type="button"
                data-sidebar-drop={enableAdvancedFileOps ? "trash" : undefined}
                data-sidebar-tab="trash"
                data-tooltip="Trash"
                aria-label="Trash"
                aria-current={isTrashActiveTab ? "page" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (onTrashRailSelect) {
                    onTrashRailSelect();
                  } else {
                    setTrashFilterActive(!trashFilterActive);
                    if (isHoverOverlayMode) setIsOverlayOpen(false);
                  }
                }}
                onMouseEnter={() => {
                  if (isDraggingInApp && enableAdvancedFileOps) {
                    updateDragHoverTarget("trash");
                  } else if (isHoverOverlayMode && trashFilterActive) {
                    handleRailTabHoverEnter("trash");
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
                    : isTrashActiveTab
                    ? "text-accent-fg bg-accent-soft"
                    : "text-fg-head hover:text-fg hover:bg-surface-hover"
                }`}
              >
                {isTrashActiveTab && (
                  <span className="absolute left-[1px] top-1/2 -translate-y-1/2 w-[2.5px] h-[15px] rounded-full bg-accent" />
                )}
                <Trash2 className={railIconSize} />
                {trashedCount > 0 && (
                  <span className="absolute top-0.5 right-0 min-w-[14px] h-[13px] px-0.5 rounded-full bg-accent text-accent-on font-mono text-[9.5px] font-bold flex items-center justify-center">
                    {trashedCount > 99 ? "99+" : trashedCount}
                  </span>
                )}
              </button>
            );
          })()}

        <button
          type="button"
          data-tooltip="Settings"
          aria-label="Settings"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSettingsOpen(true)}
          className={`relative ${railBtnSize} rounded-sm flex items-center justify-center text-fg-head hover:text-accent-fg hover:bg-surface-header transition-colors`}
        >
          <SlidersHorizontal className={railIconSize} />
        </button>
      </div>
    </div>
  );
};
