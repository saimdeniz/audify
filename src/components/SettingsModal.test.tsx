// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
const startDraggingMock = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    show: () => Promise.resolve(),
    setFocus: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    startDragging: () => startDraggingMock(),
    minimize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import App from "../App";
import { useSampleStore } from "../store/useSampleStore";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { SettingsModal } from "./SettingsModal";
import { SidebarNavRail } from "./sidebar/SidebarNavRail";

describe("Settings open & standalone window flow", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
    startDraggingMock.mockClear();
    window.history.replaceState({}, "", "/");
    useSampleStore.setState({
      isSettingsOpen: false,
      settingsTab: "profiles",
      isMiniDock: false,
      isMiniDockPinned: false,
      themeMode: "dark",
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    useSampleStore.setState({
      isSettingsOpen: false,
      settingsTab: "profiles",
      pendingAiSuggestionsCount: 0,
      aiModelStatus: null,
    });
  });

  it("renders standalone settings window via App without triggering AppErrorBoundary", async () => {
    window.history.replaceState(
      {},
      "",
      "/index.html?window=settings&tab=profiles&theme=dark"
    );

    render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    );

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toBeTruthy();
    expect(screen.queryByText("Audify Recovery Mode")).toBeNull();
    expect(await screen.findByText("WORKSPACE PROFILES")).toBeTruthy();

    const headerBar = dialog.firstElementChild as HTMLElement;
    expect(headerBar).toBeTruthy();
    fireEvent.mouseDown(headerBar, {
      button: 0,
      detail: 1,
      clientX: 200,
      clientY: 12,
    });
    fireEvent.mouseMove(window, {
      buttons: 1,
      clientX: 201,
      clientY: 12,
    });
    expect(startDraggingMock).toHaveBeenCalledTimes(1);

    // Emitting a statusNotice in standalone Settings (e.g. Apply rules) must not suspend/crash with React #426
    useSampleStore.setState({
      statusNotice: {
        seq: 1,
        message: "Applied profile auto-tag rules (42 new tag links added)",
        kind: "success",
      },
    });
    expect(
      await screen.findByText(
        "Applied profile auto-tag rules (42 new tag links added)"
      )
    ).toBeTruthy();
    expect(screen.queryByText("Audify Recovery Mode")).toBeNull();
  });

  it("opens settings window via SidebarNavRail click and supports in-app fallback", async () => {
    const railRef = React.createRef<HTMLDivElement>();
    const setSettingsOpen = useSampleStore.getState().setSettingsOpen;

    render(
      <>
        <SidebarNavRail
          railRef={railRef}
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
          enableLicensesSystem={true}
          enableAdvancedFileOps={true}
          folderFilter={null}
          selectedLicenseGroupId={null}
          selectedCollectionId={null}
          selectedTagIdsCount={0}
          selectedGenre={null}
          favoriteOnly={false}
          validBinCount={0}
          binFilterActive={false}
          trashedCount={0}
          trashFilterActive={false}
          scheduleOverlayClose={vi.fn()}
          handleRailTabHoverEnter={vi.fn()}
          scheduleDragTabSwitch={vi.fn()}
          cancelDragTabSwitch={vi.fn()}
          updateDragHoverTarget={vi.fn()}
          setFavoriteOnly={vi.fn()}
          setTrashFilterActive={vi.fn()}
          setSettingsOpen={setSettingsOpen}
        />
        <SettingsModal />
      </>
    );

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "open_settings_window" ? Promise.resolve(undefined) : Promise.resolve([])
    );
    const settingsBtn = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(settingsBtn);

    expect(invokeMock).toHaveBeenCalledWith(
      "open_settings_window",
      expect.objectContaining({ tab: "profiles" })
    );

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "open_settings_window"
        ? Promise.reject(new Error("no tauri runtime"))
        : Promise.resolve([])
    );
    fireEvent.click(settingsBtn);

    const modalDialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(modalDialog).toBeTruthy();
    await waitFor(() => {
      expect(useSampleStore.getState().isSettingsOpen).toBe(true);
    });
  });

  it("renders polished Libraries, Audio, Collections, Tags & Rules, and Shortcuts sections", async () => {
    window.history.replaceState({}, "", "/index.html?window=settings");
    useSampleStore.setState({
      isSettingsOpen: true,
      settingsTab: "libraries",
      libraries: [
        {
          id: 1,
          name: "sounds",
          path: "C:/Audio/sounds",
          sample_count: 3325,
          is_global: true,
          assigned_to_profile: true,
          is_read_only: false,
          last_scanned_at: "2026-11-13 10:00:00",
        },
      ],
    });

    render(<SettingsModal standalone={true} />);
    expect(await screen.findByText("ACTIVE SCOPE")).toBeTruthy();
    expect(screen.getByText("VAULT LOCK")).toBeTruthy();
    expect(screen.getByText("REPAIR & SYNC")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Audio$/i }));
    expect(await screen.findByText("PLAYBACK & MONITORING")).toBeTruthy();
    expect(screen.getByText(/Solid Baseline · Natural/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Collections$/i }));
    const templatesTabBtn = await screen.findByRole("button", {
      name: /Templates/i,
    });
    const collectionsSwitcher = templatesTabBtn.parentElement;
    expect(collectionsSwitcher?.className || "").toContain("justify-self-center");
    expect(collectionsSwitcher?.className || "").not.toContain("absolute");
    expect(collectionsSwitcher?.parentElement?.className || "").toContain(
      "grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)]"
    );
    fireEvent.click(templatesTabBtn);
    expect(await screen.findByText("SUB-FOLDER TEMPLATES")).toBeTruthy();
    expect(screen.getByText("AUTO-SUBFOLDERS")).toBeTruthy();
    expect(screen.getByText("SMART ROUTE")).toBeTruthy();
    expect(screen.getAllByRole("switch").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: /^Tags & Rules$/i }));
    expect(await screen.findByRole("heading", { name: "Tags & Rules" })).toBeTruthy();
    const libraryTabBtn = screen.getByRole("button", { name: /^Library/i });
    const rulesTabBtn = screen.getByRole("button", { name: /^Rules/i });
    expect(
      libraryTabBtn.compareDocumentPosition(rulesTabBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      await screen.findByPlaceholderText("Search tags & aliases...")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply rules/i })).toBeNull();
    expect(rulesTabBtn.parentElement?.className || "").toContain(
      "justify-self-center"
    );
    expect(rulesTabBtn.parentElement?.parentElement?.className || "").toContain(
      "grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)]"
    );
    fireEvent.click(rulesTabBtn);
    expect(await screen.findByRole("button", { name: /Apply rules/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Shortcuts$/i }));
    expect(await screen.findByText("Open Settings window")).toBeTruthy();
    expect(screen.getByText("Copy file path(s)")).toBeTruthy();
    expect(screen.getByText("Show in Explorer")).toBeTruthy();

    // Clicking recorder and pressing Backspace clears the shortcut to UNBOUND
    const copyPathRecorder = screen
      .getByText("Copy file path(s)")
      .parentElement?.parentElement?.querySelector(
        "button[data-shortcut-recorder='true']"
      ) as HTMLButtonElement | null;
    expect(copyPathRecorder).toBeTruthy();
    fireEvent.click(copyPathRecorder!);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(useSampleStore.getState().shortcuts.copyFilePath).toBe("");
    expect(await screen.findByText("UNBOUND")).toBeTruthy();

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "get_ai_model_status"
        ? Promise.resolve({
            model_id: "yamnet_v1",
            model_name: "YAMNet AudioSet ONNX",
            installed: true,
            runtime_installed: true,
            ready: true,
            model_sha256_ok: true,
            runtime_sha256_ok: true,
            is_custom_model: false,
            model_size_bytes: 15_300_000,
            runtime_size_bytes: 18_400_000,
            model_rel_path: "user/models/yamnet.onnx",
            runtime_rel_path: "user/models/bin/onnxruntime.dll",
            indexed_count: 50,
            total_profile_samples: 100,
            pending_suggestions_count: 120,
            embedding_bytes: 25_600,
            embedding_dim: 128,
            last_avg_ms_per_clip: 21.6,
          })
        : Promise.resolve([])
    );
    fireEvent.click(screen.getByRole("button", { name: /^AI$/i }));
    expect(await screen.findByText("Tag review")).toBeTruthy();
    expect(await screen.findByText("120 pending")).toBeTruthy();
    const approveBtn = await screen.findByRole("button", {
      name: /Approve All/i,
    });
    const reanalyzeBtn = screen.getByRole("button", { name: /Re-analyze all/i });
    expect(approveBtn.className).toContain("whitespace-nowrap");
    expect(reanalyzeBtn.className).toContain("whitespace-nowrap");
    expect(approveBtn.parentElement?.closest(".bg-surface-2")).toBeNull();
    expect(reanalyzeBtn.closest(".bg-surface-2")).not.toBeNull();
  });

  it("unmounts standalone settings DOM when hidden and remounts cleanly when shown", async () => {
    window.history.replaceState({}, "", "/index.html?window=settings&tab=profiles");
    useSampleStore.setState({ isSettingsWindowVisible: true });

    render(<SettingsModal standalone={true} />);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();

    useSampleStore.setState({ isSettingsWindowVisible: false });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    });

    useSampleStore.setState({ isSettingsWindowVisible: true });
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("renders Collections headers without duplicate icons/+ buttons and Licenses without legacy colors", async () => {
    useSampleStore.setState({
      collections: [
        {
          id: 101,
          name: "SFX Packs",
          color: "#3B82F6",
          icon: "folder",
          created_at: "2026-11-17T00:00:00Z",
          sample_count: 12,
          parent_id: null,
          smart_query: null,
        },
        {
          id: 102,
          name: "Short Kicks",
          color: "#3B82F6",
          icon: "zap",
          created_at: "2026-11-17T00:00:00Z",
          sample_count: 4,
          parent_id: null,
          smart_query: "kick <1s",
        },
      ],
      selectedCollectionId: 101,
      licenseGroups: [
        {
          id: "lic-1",
          name: "Kevin MacLeod",
          color: "#F59E0B",
          folders: ["F:/Audio/Kevin"],
          template: '"{title}" by {artist}',
          quoteMode: "auto",
        },
      ],
    });

    try {
      render(<SettingsModal standalone={true} />);

      fireEvent.click(screen.getByRole("button", { name: /^Collections$/i }));
      const collectionsHeader = await screen.findByRole("button", {
        name: "COLLECTIONS (1)",
      });
      const smartHeader = screen.getByRole("button", {
        name: "SMART COLLECTIONS (1)",
      });

      // Only the collapse chevron SVG should be inside each group header button
      expect(collectionsHeader.querySelectorAll("svg")).toHaveLength(1);
      expect(smartHeader.querySelectorAll("svg")).toHaveLength(1);
      expect(collectionsHeader.parentElement?.querySelectorAll("button")).toHaveLength(1);
      expect(smartHeader.parentElement?.querySelectorAll("button")).toHaveLength(1);

      // Top search bar provides both Smart Collection (Zap) and Standard Collection (+) buttons
      expect(screen.getByTitle("Create smart collection")).toBeTruthy();
      expect(screen.getByTitle("Create collection")).toBeTruthy();

      fireEvent.click(screen.getByTitle("Create smart collection"));
      expect(await screen.findByText("New Smart Collection")).toBeTruthy();
      expect(screen.queryByTitle("Pick Color")).toBeNull();
      fireEvent.keyDown(window, { key: "Escape" });

      fireEvent.click(screen.getByRole("button", { name: /^Licenses$/i }));
      expect(await screen.findByText("ARTIST INSPECTOR")).toBeTruthy();
      expect(screen.getByText("NAME")).toBeTruthy();
      expect(screen.queryByText(/NAME & COLOR/i)).toBeNull();
      expect(screen.queryByTitle("Artist Color")).toBeNull();
      const nameInput = await screen.findByDisplayValue("Kevin MacLeod");
      expect(nameInput.className).toContain("w-full");

      fireEvent.click(screen.getByTitle("Add Artist Group"));
      expect(await screen.findByText("New Artist Group")).toBeTruthy();
      expect(screen.queryByTitle("Pick Color")).toBeNull();
    } finally {
      useSampleStore.setState({
        collections: [],
        selectedCollectionId: null,
        licenseGroups: [],
      });
    }
  });

  it("toggles Live Watch Folders in Libraries tab and updates store state", async () => {
    render(<SettingsModal standalone={true} />);

    fireEvent.click(screen.getByRole("button", { name: /^Libraries$/i }));
    expect(await screen.findByText("LIVE FOLDER WATCHER")).toBeTruthy();
    const toggleBtn = screen.getByTitle(
      "Watch active library folders in the background with debounce and write-stability checks"
    );
    expect(useSampleStore.getState().enableLiveFolderWatch).toBe(true);

    fireEvent.click(toggleBtn);
    expect(useSampleStore.getState().enableLiveFolderWatch).toBe(false);
    expect(
      localStorage.getItem("audify_enable_live_folder_watch")
    ).toBe("false");

    fireEvent.click(toggleBtn);
    expect(useSampleStore.getState().enableLiveFolderWatch).toBe(true);
    expect(
      localStorage.getItem("audify_enable_live_folder_watch")
    ).toBe("true");
  });
});
