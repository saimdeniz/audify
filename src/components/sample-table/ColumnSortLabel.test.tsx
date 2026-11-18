// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { SampleTableHeader } from "./SampleTableHeader";
import { DEFAULT_COL_WIDTHS, DEFAULT_COLUMN_ORDER, DEFAULT_VISIBLE_COLS } from "./tableLayout";

describe("ColumnSortLabel & SampleTableHeader unified sort indicators", () => {
  beforeEach(() => {
    useSampleStore.setState({
      sortKey: "name",
      sortDir: "asc",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders fixed-footprint hover/sort arrows on sortable columns only and cycles asc -> desc -> idle", () => {
    const headerRef = createRef<HTMLDivElement>();
    const { container } = render(
      <SampleTableHeader
        headerRef={headerRef}
        columnsContentWidth={1200}
        scrollbarGutterWidth={7}
        columnOrder={DEFAULT_COLUMN_ORDER}
        setColumnOrder={vi.fn()}
        visibleCols={DEFAULT_VISIBLE_COLS}
        toggleVisibleCol={vi.fn()}
        colWidths={DEFAULT_COL_WIDTHS}
        setColWidths={vi.fn()}
        resetTableLayout={vi.fn()}
        showColumnPicker={false}
        setShowColumnPicker={vi.fn()}
      />
    );

    const fileNameBtn = screen.getByRole("button", { name: "FILE NAME" });
    expect(
      fileNameBtn.querySelector('[data-sort-indicator="asc"]')
    ).toBeTruthy();

    // Narrow headers like CLASS, YEAR, BPM, KEY share the exact same symmetric grid & idle arrow
    for (const colLabel of ["CLASS", "YEAR", "BPM", "KEY", "TIME", "FMT/SR"]) {
      const btn = screen.getByRole("button", { name: colLabel });
      expect(btn.querySelector('[data-sort-indicator="idle"]')).toBeTruthy();
      expect(btn.querySelector(".grid")).toBeTruthy();
    }

    // Trailing header gutter aligns horizontal maxScrollLeft when body has a 7px scrollbar
    const scrollInner = headerRef.current?.firstElementChild as HTMLElement;
    expect(scrollInner.style.minWidth).toBe("1207px");

    // Non-sortable headers (WAVEFORM, TAGS) do not render a sort indicator
    const waveformHeader = container.querySelector('[data-col-header-id="waveform"]');
    const tagsHeader = container.querySelector('[data-col-header-id="tags"]');
    expect(waveformHeader?.querySelector("[data-sort-indicator]")).toBeNull();
    expect(tagsHeader?.querySelector("[data-sort-indicator]")).toBeNull();

    // Another sortable column renders an idle (hover-revealed) indicator preserving width
    const timeBtn = screen.getByRole("button", { name: "TIME" });
    const idleIndicator = timeBtn.querySelector('[data-sort-indicator="idle"]');
    expect(idleIndicator).toBeTruthy();
    expect(idleIndicator?.getAttribute("class")).toContain("group-hover/hdr:opacity-75");

    // Clicking TIME switches to asc, then desc, then back to idle
    fireEvent.click(timeBtn);
    expect(useSampleStore.getState().sortKey).toBe("duration");
    expect(useSampleStore.getState().sortDir).toBe("asc");
    expect(timeBtn.querySelector('[data-sort-indicator="asc"]')).toBeTruthy();

    fireEvent.click(timeBtn);
    expect(useSampleStore.getState().sortDir).toBe("desc");
    expect(timeBtn.querySelector('[data-sort-indicator="desc"]')).toBeTruthy();
  });
});
