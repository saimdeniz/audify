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

  it("toggles Session Bin closed back to the previous primary tab on second click", () => {
    const setActiveTab = vi.fn();
    const setIsOverlayOpen = vi.fn();

    const makeProps = (
      activeTab: "collections" | "bin",
      isMiniOverlay = false,
      showContentColumn = true
    ) => ({
      railRef: createRef<HTMLDivElement>(),
      isMiniOverlay,
      showContentColumn,
      activeTab,
      setActiveTab,
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
      favoriteOnly: false,
      validBinCount: 0,
      binFilterActive: false,
      trashedCount: 0,
      trashFilterActive: false,
      scheduleOverlayClose: vi.fn(),
      handleRailTabHoverEnter: vi.fn(),
      scheduleDragTabSwitch: vi.fn(),
      cancelDragTabSwitch: vi.fn(),
      updateDragHoverTarget: vi.fn(),
      setFavoriteOnly: vi.fn(),
      setTrashFilterActive: vi.fn(),
      setSettingsOpen: vi.fn(),
    });

    const { getByLabelText, rerender } = render(
      <SidebarNavRail {...makeProps("collections")} />
    );

    fireEvent.click(getByLabelText("Session Bin"));
    expect(setActiveTab).toHaveBeenLastCalledWith("bin");

    rerender(<SidebarNavRail {...makeProps("bin")} />);
    fireEvent.click(getByLabelText("Session Bin"));
    expect(setActiveTab).toHaveBeenLastCalledWith("collections");

    rerender(<SidebarNavRail {...makeProps("bin", true, true)} />);
    fireEvent.click(getByLabelText("Session Bin"));
    expect(setIsOverlayOpen).toHaveBeenLastCalledWith(false);
  });
});
