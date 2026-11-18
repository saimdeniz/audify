// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { SampleItem } from "../../types";
import type { RowPopoverPosition } from "./tableLayout";
import { useSampleTableInteractions } from "./useSampleTableInteractions";

const MOCK_SAMPLE: SampleItem = {
  id: 42,
  library_id: 1,
  file_path: "C:/Audio/sfx/hit_01.wav",
  file_name: "hit_01.wav",
  folder_path: "C:/Audio/sfx",
  extension: "wav",
  duration_ms: 420,
  sample_rate: 48000,
  channels: 2,
  bit_depth: 24,
  file_size: 80640,
  is_favorite: false,
  is_loop: false,
  genre: "",
  artist: "",
  album: "",
  year: "",
  bpm: null,
  peaks_json: "[]",
  created_at: "2026-11-14 00:00:00",
  tags: [],
};

interface MutableMouseEventLike {
  currentTarget: HTMLElement | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

describe("useSampleTableInteractions popover anchor safety", () => {
  afterEach(() => {
    cleanup();
  });

  it("captures anchor geometry before React nulls e.currentTarget in deferred updaters", () => {
    let pendingTagUpdater: React.SetStateAction<RowPopoverPosition | null> | null =
      null;
    let pendingGenreUpdater: React.SetStateAction<RowPopoverPosition | null> | null =
      null;

    const setRowTagPopover = vi.fn(
      (action: React.SetStateAction<RowPopoverPosition | null>) => {
        pendingTagUpdater = action;
      }
    );
    const setRowGenrePopover = vi.fn(
      (action: React.SetStateAction<RowPopoverPosition | null>) => {
        pendingGenreUpdater = action;
      }
    );

    const searchInputRef = React.createRef<HTMLInputElement>();

    const { result } = renderHook(() =>
      useSampleTableInteractions({
        samples: [MOCK_SAMPLE],
        autoBinOnNleDrag: false,
        searchInputRef,
        rowTagPopover: null,
        setRowTagPopover,
        rowGenrePopover: null,
        setRowGenrePopover,
        setHoverOverflowTags: vi.fn(),
        contextMenu: null,
        setContextMenu: vi.fn(),
        batchPopover: null,
        setBatchPopover: vi.fn(),
        showSearchHelper: false,
        setShowSearchHelper: vi.fn(),
        showColumnPicker: false,
        setShowColumnPicker: vi.fn(),
      })
    );

    const fakeButton = document.createElement("button");
    fakeButton.getBoundingClientRect = () =>
      ({
        left: 360,
        right: 382,
        top: 120,
        bottom: 140,
        width: 22,
        height: 20,
        x: 360,
        y: 120,
        toJSON: () => ({}),
      }) as DOMRect;

    const syntheticTagEvent: MutableMouseEventLike = {
      currentTarget: fakeButton,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      result.current.openRowTagPopover(
        syntheticTagEvent as unknown as React.MouseEvent,
        MOCK_SAMPLE
      );
    });

    // Simulate React 18 clearing SyntheticEvent.currentTarget before deferred updater runs
    syntheticTagEvent.currentTarget = null;

    expect(typeof pendingTagUpdater).toBe("function");
    const runTagUpdater = pendingTagUpdater as unknown as (
      prev: RowPopoverPosition | null
    ) => RowPopoverPosition | null;
    expect(runTagUpdater(null)).toEqual({ sampleId: 42, x: 118, y: 144 });

    const syntheticGenreEvent: MutableMouseEventLike = {
      currentTarget: fakeButton,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      result.current.openRowGenrePopover(
        syntheticGenreEvent as unknown as React.MouseEvent,
        MOCK_SAMPLE
      );
    });
    syntheticGenreEvent.currentTarget = null;

    expect(typeof pendingGenreUpdater).toBe("function");
    const runGenreUpdater = pendingGenreUpdater as unknown as (
      prev: RowPopoverPosition | null
    ) => RowPopoverPosition | null;
    expect(runGenreUpdater(null)).toEqual({ sampleId: 42, x: 360, y: 144 });
  });

  it("ignores clicks safely if currentTarget is already null", () => {
    const setRowTagPopover = vi.fn();
    const searchInputRef = React.createRef<HTMLInputElement>();

    const { result } = renderHook(() =>
      useSampleTableInteractions({
        samples: [MOCK_SAMPLE],
        autoBinOnNleDrag: false,
        searchInputRef,
        rowTagPopover: null,
        setRowTagPopover,
        rowGenrePopover: null,
        setRowGenrePopover: vi.fn(),
        setHoverOverflowTags: vi.fn(),
        contextMenu: null,
        setContextMenu: vi.fn(),
        batchPopover: null,
        setBatchPopover: vi.fn(),
        showSearchHelper: false,
        setShowSearchHelper: vi.fn(),
        showColumnPicker: false,
        setShowColumnPicker: vi.fn(),
      })
    );

    const nullEvent: MutableMouseEventLike = {
      currentTarget: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(() =>
      result.current.openRowTagPopover(
        nullEvent as unknown as React.MouseEvent,
        MOCK_SAMPLE
      )
    ).not.toThrow();
    expect(setRowTagPopover).not.toHaveBeenCalled();
  });
});
