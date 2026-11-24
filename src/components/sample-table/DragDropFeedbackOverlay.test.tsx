// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem } from "../../types";
import { DragDropFeedbackOverlay } from "./DragDropFeedbackOverlay";

function makeSample(id: number, fileName: string): SampleItem {
  return {
    id,
    library_id: 1,
    file_path: `C:/Audio/Main/${fileName}`,
    file_name: fileName,
    folder_path: "C:/Audio/Main",
    extension: "mp3",
    duration_ms: 4200,
    sample_rate: 44100,
    channels: 2,
    bit_depth: 16,
    file_size: 102400,
    is_favorite: false,
    is_loop: false,
    peaks_json: "",
    created_at: "2026-11-23 00:00:00",
    tags: [],
    genre: "",
    artist: "",
    album: "",
    year: "",
  };
}

describe("DragDropFeedbackOverlay hybrid collapsed-sidebar & Mini Dock layout", () => {
  const sample = makeSample(101, "Afterlife.mp3");

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });
    useSampleStore.setState({
      enableAdvancedFileOps: true,
      inAppDragSample: sample,
      inAppDragSamples: [sample],
      genres: [{ id: 1, name: "Jazz", color: "#38BDF8", sample_count: 12 }],
    });
  });

  afterEach(() => {
    cleanup();
    useSampleStore.setState({
      inAppDragSample: null,
      inAppDragSamples: [],
    });
  });

  it("shifts full overlay 256px right and stays below z-50 sidebar flyout in wide Normal View", async () => {
    const { container } = render(<DragDropFeedbackOverlay />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: false,
            dragHoverTarget: "folder:1:C:/Audio/Main/music",
            isSidebarOverlayOpen: true,
          },
        })
      );
    });

    await screen.findByText('"music"');
    const overlay = container.querySelector<HTMLElement>(
      '[data-drag-overlay-mode="full"]'
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.style.left).toBe("256px");
    expect(Number(overlay?.style.zIndex)).toBe(Z_INDEX.dragFeedback);
    expect(Number(overlay?.style.zIndex)).toBeLessThan(50);
  });

  it("renders non-blocking compact bottom bar in Mini Dock when sidebar flyout is open", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 420,
    });
    const { container } = render(<DragDropFeedbackOverlay compact={true} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: false,
            dragHoverTarget: "genre-Jazz",
            isSidebarOverlayOpen: true,
          },
        })
      );
    });

    await screen.findByText('"Jazz"');
    const compactBar = container.querySelector<HTMLElement>(
      '[data-drag-overlay-mode="compact-bar"]'
    );
    expect(compactBar).not.toBeNull();
    expect(compactBar?.className).not.toContain("audify-drop-overlay-backdrop");
    expect(compactBar?.className).toContain("pointer-events-none");
    expect(Number(compactBar?.style.zIndex)).toBe(Z_INDEX.dragFeedbackCompactBar);
  });

  it("keeps full centered overlay in Mini Dock when hovering rail targets with flyout closed", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 420,
    });
    const { container } = render(<DragDropFeedbackOverlay compact={true} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: false,
            dragHoverTarget: "bin",
            isSidebarOverlayOpen: false,
          },
        })
      );
    });

    await screen.findByText("Session Bin");
    const overlay = container.querySelector<HTMLElement>(
      '[data-drag-overlay-mode="full"]'
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.style.left).toBe("0px");
  });

  it("holds hover target across brief 80ms nulls inside sidebar to prevent Mini Dock flicker, and clears immediately when leaving sidebar", () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 420,
      });
      const { container } = render(<DragDropFeedbackOverlay compact={true} />);

      act(() => {
        window.dispatchEvent(
          new CustomEvent("audify:folder-drop-overlay", {
            detail: {
              isExternalFileDragActive: false,
              dragHoverTarget: "genre-Jazz",
              isSidebarOverlayOpen: true,
              isPointerInSidebar: true,
            },
          })
        );
      });
      expect(
        container.querySelector('[data-drag-overlay-mode="compact-bar"]')
      ).not.toBeNull();

      // Transient null while crossing between rows inside sidebar should hold for 80ms
      act(() => {
        window.dispatchEvent(
          new CustomEvent("audify:folder-drop-overlay", {
            detail: {
              isExternalFileDragActive: false,
              dragHoverTarget: null,
              isSidebarOverlayOpen: true,
              isPointerInSidebar: true,
            },
          })
        );
      });
      act(() => {
        vi.advanceTimersByTime(40);
      });
      expect(
        container.querySelector('[data-drag-overlay-mode="compact-bar"]')
      ).not.toBeNull();

      // Leaving sidebar clears immediately without waiting
      act(() => {
        window.dispatchEvent(
          new CustomEvent("audify:folder-drop-overlay", {
            detail: {
              isExternalFileDragActive: false,
              dragHoverTarget: null,
              isSidebarOverlayOpen: false,
              isPointerInSidebar: false,
            },
          })
        );
      });
      expect(
        container.querySelector('[data-drag-overlay-mode="compact-bar"]')
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears external file drag overlay immediately on audify:clear-external-drag (waveform hover/drop) and Escape", async () => {
    useSampleStore.setState({
      inAppDragSample: null,
      inAppDragSamples: [],
      folderFilter: "C:/Audio/Main/Ambient",
    });
    const { container } = render(<DragDropFeedbackOverlay />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: true,
            dragHoverTarget: null,
            isSidebarOverlayOpen: false,
          },
        })
      );
    });
    await screen.findByText('"Ambient"');
    expect(
      container.querySelector('[data-drag-overlay-mode="full"]')
    ).not.toBeNull();

    // Hovering or dropping on waveform emits audify:clear-external-drag
    act(() => {
      window.dispatchEvent(new CustomEvent("audify:clear-external-drag"));
    });
    expect(
      container.querySelector('[data-drag-overlay-mode="full"]')
    ).toBeNull();

    // Re-open and verify Escape also dismisses external drag overlay
    act(() => {
      window.dispatchEvent(
        new CustomEvent("audify:folder-drop-overlay", {
          detail: {
            isExternalFileDragActive: true,
            dragHoverTarget: null,
            isSidebarOverlayOpen: false,
          },
        })
      );
    });
    expect(
      container.querySelector('[data-drag-overlay-mode="full"]')
    ).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(
      container.querySelector('[data-drag-overlay-mode="full"]')
    ).toBeNull();
  });
});
