// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SidebarNavRail } from "./SidebarNavRail";

describe("SidebarNavRail Trash theme styling", () => {
  afterEach(() => {
    cleanup();
  });

  const renderRail = (overrides: {
    trashFilterActive?: boolean;
    trashedCount?: number;
  } = {}) =>
    render(
      <SidebarNavRail
        railRef={createRef<HTMLDivElement>()}
        isMiniOverlay={false}
        showContentColumn={true}
        activeTab="folders"
        setActiveTab={vi.fn()}
        setIsOverlayOpen={vi.fn()}
        isDraggingInApp={false}
        isExternalFileDragActive={false}
        isDroppableActiveTab={true}
        hoveredRailTab={null}
        dragHoverTarget={null}
        dropFlashTarget={null}
        enableLicensesSystem={false}
        enableAdvancedFileOps={true}
        folderFilter={null}
        selectedLicenseGroupId={null}
        selectedCollectionId={null}
        selectedTagIdsCount={0}
        selectedGenre={null}
        favoriteOnly={false}
        validBinCount={0}
        binFilterActive={false}
        trashedCount={overrides.trashedCount ?? 1}
        trashFilterActive={overrides.trashFilterActive ?? false}
        scheduleOverlayClose={vi.fn()}
        handleRailTabHoverEnter={vi.fn()}
        scheduleDragTabSwitch={vi.fn()}
        cancelDragTabSwitch={vi.fn()}
        updateDragHoverTarget={vi.fn()}
        setFavoriteOnly={vi.fn()}
        setTrashFilterActive={vi.fn()}
        setSettingsOpen={vi.fn()}
      />
    );

  it("uses theme foreground when idle and theme accent when active instead of permanent danger red", () => {
    const { getByLabelText, rerender } = renderRail({
      trashFilterActive: false,
      trashedCount: 1,
    });
    const idleTrashBtn = getByLabelText("Trash");
    expect(idleTrashBtn.className).toContain("text-fg-head");
    expect(idleTrashBtn.className).not.toContain("text-danger");

    const idleBadge = idleTrashBtn.querySelector("span");
    expect(idleBadge?.className).toContain("bg-accent");
    expect(idleBadge?.className).not.toContain("bg-danger");

    rerender(
      <SidebarNavRail
        railRef={createRef<HTMLDivElement>()}
        isMiniOverlay={false}
        showContentColumn={true}
        activeTab="trash"
        setActiveTab={vi.fn()}
        setIsOverlayOpen={vi.fn()}
        isDraggingInApp={false}
        isExternalFileDragActive={false}
        isDroppableActiveTab={true}
        hoveredRailTab={null}
        dragHoverTarget={null}
        dropFlashTarget={null}
        enableLicensesSystem={false}
        enableAdvancedFileOps={true}
        folderFilter={null}
        selectedLicenseGroupId={null}
        selectedCollectionId={null}
        selectedTagIdsCount={0}
        selectedGenre={null}
        favoriteOnly={false}
        validBinCount={0}
        binFilterActive={false}
        trashedCount={1}
        trashFilterActive={true}
        scheduleOverlayClose={vi.fn()}
        handleRailTabHoverEnter={vi.fn()}
        scheduleDragTabSwitch={vi.fn()}
        cancelDragTabSwitch={vi.fn()}
        updateDragHoverTarget={vi.fn()}
        setFavoriteOnly={vi.fn()}
        setTrashFilterActive={vi.fn()}
        setSettingsOpen={vi.fn()}
      />
    );

    const activeTrashBtn = getByLabelText("Trash");
    expect(activeTrashBtn.className).toContain("text-accent-fg");
    expect(activeTrashBtn.className).toContain("bg-accent-soft");
    expect(activeTrashBtn.className).not.toContain("text-danger");
    expect(getByLabelText("Folders").className).not.toContain("bg-accent-soft");

    rerender(
      <SidebarNavRail
        railRef={createRef<HTMLDivElement>()}
        isMiniOverlay={false}
        showContentColumn={true}
        activeTab="folders"
        setActiveTab={vi.fn()}
        setIsOverlayOpen={vi.fn()}
        isDraggingInApp={true}
        isExternalFileDragActive={false}
        isDroppableActiveTab={true}
        hoveredRailTab={null}
        dragHoverTarget="trash"
        dropFlashTarget={null}
        enableLicensesSystem={false}
        enableAdvancedFileOps={true}
        folderFilter={null}
        selectedLicenseGroupId={null}
        selectedCollectionId={null}
        selectedTagIdsCount={0}
        selectedGenre={null}
        favoriteOnly={false}
        validBinCount={0}
        binFilterActive={false}
        trashedCount={1}
        trashFilterActive={false}
        scheduleOverlayClose={vi.fn()}
        handleRailTabHoverEnter={vi.fn()}
        scheduleDragTabSwitch={vi.fn()}
        cancelDragTabSwitch={vi.fn()}
        updateDragHoverTarget={vi.fn()}
        setFavoriteOnly={vi.fn()}
        setTrashFilterActive={vi.fn()}
        setSettingsOpen={vi.fn()}
      />
    );
    const dragHoverTrashBtn = getByLabelText("Trash");
    expect(dragHoverTrashBtn.className).toContain("bg-accent");
    expect(dragHoverTrashBtn.className).toContain("ring-accent");
    expect(dragHoverTrashBtn.className).not.toContain("danger");

    rerender(
      <SidebarNavRail
        railRef={createRef<HTMLDivElement>()}
        isMiniOverlay={false}
        showContentColumn={true}
        activeTab="folders"
        setActiveTab={vi.fn()}
        setIsOverlayOpen={vi.fn()}
        isDraggingInApp={false}
        isExternalFileDragActive={false}
        isDroppableActiveTab={true}
        hoveredRailTab={null}
        dragHoverTarget={null}
        dropFlashTarget="trash"
        enableLicensesSystem={false}
        enableAdvancedFileOps={true}
        folderFilter={null}
        selectedLicenseGroupId={null}
        selectedCollectionId={null}
        selectedTagIdsCount={0}
        selectedGenre={null}
        favoriteOnly={false}
        validBinCount={0}
        binFilterActive={false}
        trashedCount={1}
        trashFilterActive={false}
        scheduleOverlayClose={vi.fn()}
        handleRailTabHoverEnter={vi.fn()}
        scheduleDragTabSwitch={vi.fn()}
        cancelDragTabSwitch={vi.fn()}
        updateDragHoverTarget={vi.fn()}
        setFavoriteOnly={vi.fn()}
        setTrashFilterActive={vi.fn()}
        setSettingsOpen={vi.fn()}
      />
    );
    const dropFlashTrashBtn = getByLabelText("Trash");
    expect(dropFlashTrashBtn.className).toContain("text-accent-fg");
    expect(dropFlashTrashBtn.className).toContain("bg-accent-soft");
    expect(dropFlashTrashBtn.className).not.toContain("danger");
  });

  it("toggles Session Bin main table view directly on click and closes Mini Dock hover overlay", () => {
    const setBinFilterActive = vi.fn();
    const setIsOverlayOpen = vi.fn();

    const makeProps = (
      binFilterActive: boolean,
      isMiniOverlay = false,
      showContentColumn = true
    ) => ({
      railRef: createRef<HTMLDivElement>(),
      isMiniOverlay,
      showContentColumn,
      activeTab: "collections" as const,
      setActiveTab: vi.fn(),
      setIsOverlayOpen,
      isDraggingInApp: false,
      isExternalFileDragActive: false,
      isDroppableActiveTab: true,
      hoveredRailTab: null,
      dragHoverTarget: null,
      dropFlashTarget: null,
      enableLicensesSystem: false,
      enableAdvancedFileOps: true,
      folderFilter: null,
      selectedLicenseGroupId: null,
      selectedCollectionId: null,
      selectedTagIdsCount: 0,
      selectedGenre: null,
      validBinCount: 3,
      binFilterActive,
      trashedCount: 0,
      trashFilterActive: false,
      scheduleOverlayClose: vi.fn(),
      handleRailTabHoverEnter: vi.fn(),
      scheduleDragTabSwitch: vi.fn(),
      cancelDragTabSwitch: vi.fn(),
      updateDragHoverTarget: vi.fn(),
      setBinFilterActive,
      setTrashFilterActive: vi.fn(),
      setSettingsOpen: vi.fn(),
    });

    const { getByLabelText, rerender } = render(
      <SidebarNavRail {...makeProps(false)} />
    );

    fireEvent.click(getByLabelText("Session Bin"));
    expect(setBinFilterActive).toHaveBeenLastCalledWith(true);

    rerender(<SidebarNavRail {...makeProps(true)} />);
    fireEvent.click(getByLabelText("Session Bin"));
    expect(setBinFilterActive).toHaveBeenLastCalledWith(false);

    rerender(<SidebarNavRail {...makeProps(false, true, true)} />);
    fireEvent.click(getByLabelText("Session Bin"));
    expect(setBinFilterActive).toHaveBeenLastCalledWith(true);
    expect(setIsOverlayOpen).toHaveBeenLastCalledWith(false);
  });
});
