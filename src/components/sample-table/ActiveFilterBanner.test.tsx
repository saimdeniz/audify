// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { ActiveFilterBanner } from "./ActiveFilterBanner";

describe("ActiveFilterBanner UI component", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset().mockResolvedValue([]);
    useSampleStore.setState({
      tags: [{ id: 10, name: "Animals", color: "#50fa7b", sample_count: 12 }],
      genres: [{ id: 1, name: "Foley", color: "#8be9fd", sample_count: 8 }],
      selectedTagIds: [10],
      selectedGenre: "Foley",
      folderFilter: null,
      selectedCollectionId: null,
      selectedLicenseGroupId: null,
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      trashFilterActive: false,
      typeFilter: "all",
      srFilter: null,
      searchQuery: "",
      similaritySession: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows icon-only X clear button for active tag/genre filters and resets filters on click", () => {
    render(<ActiveFilterBanner />);

    expect(screen.getByText("Animals")).toBeTruthy();
    expect(screen.getByText("Foley")).toBeTruthy();
    expect(screen.queryByText("Clear all")).toBeNull();

    const clearBtn = screen.getByRole("button", {
      name: "Clear all active filters",
    });
    fireEvent.click(clearBtn);

    expect(useSampleStore.getState().selectedTagIds).toEqual([]);
    expect(useSampleStore.getState().selectedGenre).toBeNull();
  });

  it("renders seamless Trash pill chip alongside folder filter chip in single ActiveFilterBanner row", () => {
    useSampleStore.setState({
      selectedTagIds: [],
      selectedGenre: null,
      trashFilterActive: true,
      trashedCount: 2,
      trashedTotalBytes: 4096,
      folderFilter: "C:/Audio/Main/Pokemon",
    });

    render(<ActiveFilterBanner />);

    expect(screen.getByText(/Trash · 2 files · 4\.0 KB/i)).toBeTruthy();
    expect(screen.queryByText(/preserved until emptied/i)).toBeNull();
    expect(screen.getByText("Pokemon")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Remove folder filter"));
    expect(useSampleStore.getState().trashFilterActive).toBe(true);
    expect(useSampleStore.getState().folderFilter).toBeNull();

    fireEvent.click(screen.getByTitle("Exit Trash view"));
    expect(useSampleStore.getState().trashFilterActive).toBe(false);
  });
});
