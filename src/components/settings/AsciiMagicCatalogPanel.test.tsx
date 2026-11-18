// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string, protocol = "asset") =>
    `http://${protocol}.localhost/${path}`,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../utils/asciiMagic/sandboxBridge", () => ({
  asciiMagicSandbox: {
    loadPiece: vi.fn(),
    computeFrame: vi.fn(),
    capturePiecePreview: vi.fn().mockResolvedValue({
      meta: {
        slug: "chai-stall-dawn",
        name: "Chai Stall at Dawn",
        category: "street",
        cols: 120,
        rows: 40,
        fps: 15,
        cell: "mono",
        look: "original",
        still: false,
        dots: null,
        palette: { a: "#ffaa00" },
      },
      frame: { text: "█", color: "a", paletteOverride: null },
    }),
    dispose: vi.fn(),
  },
}));

import { AsciiMagicCatalogPanel } from "./AsciiMagicCatalogPanel";
import { evictAsciiMagicPreviewCache } from "../../services/asciiMagicService";
import { useSampleStore } from "../../store/useSampleStore";
import type { AsciiMagicState } from "../../types";

describe("AsciiMagicCatalogPanel UI", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    evictAsciiMagicPreviewCache();
    vi.stubGlobal(
      "Path2D",
      class {
        rect = vi.fn();
        moveTo = vi.fn();
        arc = vi.fn();
      }
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          canvas: document.createElement("canvas"),
          setTransform: vi.fn(),
          fillStyle: "#000000",
          fillRect: vi.fn(),
          fillText: vi.fn(),
          drawImage: vi.fn(),
          fill: vi.fn(),
          clearRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          beginPath: vi.fn(),
          rect: vi.fn(),
          clip: vi.fn(),
          getImageData: vi.fn(() => ({
            width: 100,
            height: 100,
            data: new Uint8ClampedArray(100 * 100 * 4),
          })),
          putImageData: vi.fn(),
          font: "",
          textBaseline: "middle",
        }) as unknown as CanvasRenderingContext2D
    );
    useSampleStore.setState({
      wallpaperKind: "none",
      asciiMagicSlug: "",
      asciiMagicLook: "original",
      asciiMagicFit: "contain",
      themeMode: "dark",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("syncs catalog, installs a piece by slug/URL, activates it, and changes look", async () => {
    const emptyState: AsciiMagicState = {
      synced_at_unix: null,
      categories: [],
      catalog: [],
      installed: [],
    };
    const syncedState: AsciiMagicState = {
      synced_at_unix: 1730000000,
      categories: [{ id: "street", name: "Street", blurb: "Street life" }],
      catalog: [
        {
          slug: "chai-stall-dawn",
          name: "Chai Stall at Dawn",
          category: "street",
          note: "Warm tea steam",
          tags: ["chai", "morning"],
          cols: 120,
          rows: 40,
          fps: 15,
        },
      ],
      installed: [],
    };
    const installedRecord = {
      slug: "chai-stall-dawn",
      name: "Chai Stall at Dawn",
      category: "street",
      note: "Warm tea steam",
      cols: 120,
      rows: 40,
      fps: 15,
      sha256: "abc123",
      bytes: 2048,
      installed_at_unix: 1730000010,
      has_preview: true,
    };

    let currentState: AsciiMagicState = emptyState;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_ascii_magic_state") return currentState;
      if (cmd === "sync_ascii_magic_catalog") {
        currentState = syncedState;
        return currentState;
      }
      if (cmd === "install_ascii_magic_piece") {
        currentState = { ...syncedState, installed: [installedRecord] };
        return installedRecord;
      }
      if (cmd === "delete_ascii_magic_piece") {
        currentState = syncedState;
        return undefined;
      }
      if (cmd === "save_ascii_magic_preview") return undefined;
      if (cmd === "get_ascii_magic_preview") return null;
      return undefined;
    });

    render(<AsciiMagicCatalogPanel />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_ascii_magic_state");
    });

    const syncButtons = screen.getAllByRole("button", {
      name: /Sync (Full )?Catalog/i,
    });
    await act(async () => {
      fireEvent.click(syncButtons[0]);
    });

    expect(await screen.findByText("Chai Stall at Dawn")).toBeTruthy();

    const input = screen.getByPlaceholderText(/chai-stall-dawn/i);
    fireEvent.change(input, {
      target: { value: "https://www.ascii-magic.com/ascii/chai-stall-dawn" },
    });
    const form = input.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(invokeMock).toHaveBeenCalledWith("install_ascii_magic_piece", {
      slugOrUrl: "https://www.ascii-magic.com/ascii/chai-stall-dawn",
    });
    await waitFor(() => {
      expect(useSampleStore.getState().wallpaperKind).toBe("ascii_magic");
      expect(useSampleStore.getState().asciiMagicSlug).toBe("chai-stall-dawn");
    });

    fireEvent.click(screen.getByRole("button", { name: "Halftone Dots" }));
    expect(useSampleStore.getState().asciiMagicLook).toBe("dots");

    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect(useSampleStore.getState().asciiMagicFit).toBe("cover");

    fireEvent.click(screen.getByRole("button", { name: /All Categories/i }));
    const listbox = await screen.findByRole("listbox", {
      name: "Category options",
    });
    expect(listbox).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Street/i }));
    expect(
      screen.getByRole("button", { name: /Street/i }).getAttribute("aria-expanded")
    ).toBe("false");

    fireEvent.click(screen.getByTitle("Remove Chai Stall at Dawn from cache"));
    await act(async () => {
      fireEvent.click(screen.getByTitle("Confirm remove Chai Stall at Dawn"));
    });
    expect(invokeMock).toHaveBeenCalledWith("delete_ascii_magic_piece", {
      slug: "chai-stall-dawn",
    });
    await waitFor(() => {
      expect(useSampleStore.getState().wallpaperKind).toBe("none");
      expect(useSampleStore.getState().asciiMagicSlug).toBe("");
    });
  });
});
