import { beforeEach, describe, expect, it, vi } from "vitest";

const emitToMock = vi.fn();
const getByLabelMock = vi.fn();
const isStandaloneMock = vi.fn();
const selfIsAlwaysOnTopMock = vi.fn();
const selfSetAlwaysOnTopMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: unknown[]) => emitToMock(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: (...args: unknown[]) => getByLabelMock(...args),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isAlwaysOnTop: selfIsAlwaysOnTopMock,
    setAlwaysOnTop: selfSetAlwaysOnTopMock,
  }),
}));

vi.mock("./windowContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./windowContext")>();
  return {
    ...actual,
    isStandaloneSettingsWindow: () => isStandaloneMock(),
  };
});

import {
  APPLY_MAIN_FILTER_EVENT,
  applyFilterInMainWindow,
} from "./mainWindowBridge";

describe("mainWindowBridge", () => {
  beforeEach(() => {
    emitToMock.mockReset();
    getByLabelMock.mockReset();
    isStandaloneMock.mockReset();
    selfIsAlwaysOnTopMock.mockReset();
    selfSetAlwaysOnTopMock.mockReset();
    emitToMock.mockResolvedValue(undefined);
    selfIsAlwaysOnTopMock.mockResolvedValue(false);
    selfSetAlwaysOnTopMock.mockResolvedValue(undefined);
  });

  it("emits filter event and unminimizes, shows, and focuses main in standalone Settings mode", async () => {
    isStandaloneMock.mockReturnValue(true);
    selfIsAlwaysOnTopMock.mockResolvedValue(true);
    const mainWin = {
      isAlwaysOnTop: vi.fn().mockResolvedValue(false),
      isMinimized: vi.fn().mockResolvedValue(true),
      unminimize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    getByLabelMock.mockResolvedValue(mainWin);

    const applyLocally = vi.fn();
    const notify = vi.fn();
    const ok = await applyFilterInMainWindow(
      { kind: "collection", id: 42, label: "SFX" },
      { applyLocally, notify }
    );

    expect(ok).toBe(true);
    expect(emitToMock).toHaveBeenCalledWith("main", APPLY_MAIN_FILTER_EVENT, {
      kind: "collection",
      id: 42,
      label: "SFX",
    });
    expect(applyLocally).not.toHaveBeenCalled();
    expect(getByLabelMock).toHaveBeenCalledWith("main");
    expect(selfSetAlwaysOnTopMock).toHaveBeenCalledWith(false);
    expect(mainWin.unminimize).toHaveBeenCalled();
    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.setFocus).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Filtered "SFX" in main window', "info");
  });

  it("keeps Settings unpinned only when main is not pinned, leaving main pinned in Mini Dock", async () => {
    isStandaloneMock.mockReturnValue(true);
    selfIsAlwaysOnTopMock.mockResolvedValue(true);
    const mainWin = {
      isAlwaysOnTop: vi.fn().mockResolvedValue(true),
      isMinimized: vi.fn().mockResolvedValue(false),
      unminimize: vi.fn(),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    getByLabelMock.mockResolvedValue(mainWin);

    await applyFilterInMainWindow(
      { kind: "trash" },
      { applyLocally: vi.fn(), notify: vi.fn() }
    );

    expect(selfSetAlwaysOnTopMock).not.toHaveBeenCalled();
    expect(mainWin.unminimize).not.toHaveBeenCalled();
    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.setFocus).toHaveBeenCalled();
  });

  it("applies filter locally in browser / single-window fallback without IPC", async () => {
    isStandaloneMock.mockReturnValue(false);
    const applyLocally = vi.fn();
    const notify = vi.fn();

    const ok = await applyFilterInMainWindow(
      { kind: "genre", name: "Ambient" },
      { applyLocally, notify }
    );

    expect(ok).toBe(true);
    expect(emitToMock).not.toHaveBeenCalled();
    expect(getByLabelMock).not.toHaveBeenCalled();
    expect(applyLocally).toHaveBeenCalledWith({
      kind: "genre",
      name: "Ambient",
    });
    expect(notify).toHaveBeenCalledWith(
      'Filtered "Ambient" in main window',
      "info"
    );
  });

  it("reports an error notice if emitTo fails in standalone mode", async () => {
    isStandaloneMock.mockReturnValue(true);
    emitToMock.mockRejectedValue(new Error("ipc down"));
    const applyLocally = vi.fn();
    const notify = vi.fn();

    const ok = await applyFilterInMainWindow(
      { kind: "tag", id: 7, label: "UI" },
      { applyLocally, notify }
    );

    expect(ok).toBe(false);
    expect(applyLocally).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Could not send filter to main window",
      "error"
    );
  });
});
