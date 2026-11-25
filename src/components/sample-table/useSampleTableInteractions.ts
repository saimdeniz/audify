import React, { useCallback, useEffect, useRef } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import {
  beginDragOnMove,
  getActiveOsDragSample,
  isOsDragCurrentlyInFlight,
  setActiveOsDragSample,
  startNativePitchedSampleDrag,
  startNativeSampleDrag as startNativeSampleDragRaw,
} from "../../utils/drag";
import { folderNameFromPath } from "../../utils/format";
import {
  computeAnchoredPopoverPosition,
  ContextMenuState,
  RowPopoverPosition,
} from "./tableLayout";

interface UseSampleTableInteractionsParams {
  samples: SampleItem[];
  autoBinOnNleDrag: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  rowTagPopover: RowPopoverPosition | null;
  setRowTagPopover: React.Dispatch<
    React.SetStateAction<RowPopoverPosition | null>
  >;
  rowGenrePopover: RowPopoverPosition | null;
  setRowGenrePopover: React.Dispatch<
    React.SetStateAction<RowPopoverPosition | null>
  >;
  setHoverOverflowTags: React.Dispatch<
    React.SetStateAction<RowPopoverPosition | null>
  >;
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  batchPopover: "collection" | "tag" | "genre" | null;
  setBatchPopover: React.Dispatch<
    React.SetStateAction<"collection" | "tag" | "genre" | null>
  >;
  showSearchHelper: boolean;
  setShowSearchHelper: React.Dispatch<React.SetStateAction<boolean>>;
  showColumnPicker: boolean;
  setShowColumnPicker: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSampleTableInteractions({
  autoBinOnNleDrag,
  searchInputRef,
  rowTagPopover,
  setRowTagPopover,
  rowGenrePopover,
  setRowGenrePopover,
  setHoverOverflowTags,
  contextMenu,
  setContextMenu,
  batchPopover,
  setBatchPopover,
  showSearchHelper,
  setShowSearchHelper,
  showColumnPicker,
  setShowColumnPicker,
}: UseSampleTableInteractionsParams) {
  const handleRowSelect = useSampleStore((s) => s.handleRowSelect);
  const setInAppDragSample = useSampleStore((s) => s.setInAppDragSample);
  const addSamplesToBin = useSampleStore((s) => s.addSamplesToBin);

  const osDragSampleRef = useRef<SampleItem | null>(null);
  const osDragCleanupTimerRef = useRef<number | null>(null);
  const suppressNextRowClickRef = useRef(false);

  const startNativeSampleDrag = useCallback(
    async (paths: string[], sourceSample?: SampleItem) => {
      if (osDragCleanupTimerRef.current !== null) {
        window.clearTimeout(osDragCleanupTimerRef.current);
        osDragCleanupTimerRef.current = null;
      }
      if (sourceSample) {
        osDragSampleRef.current = sourceSample;
        setActiveOsDragSample(sourceSample, false);
        setInAppDragSample(sourceSample);
      }
      const dragLabel =
        paths.length > 1
          ? `${paths.length} samples selected`
          : sourceSample?.file_name ||
            (paths[0] ? folderNameFromPath(paths[0]) : "") ||
            "1 sample selected";
      try {
        const { pitchSemitones, sliceMicroFade, exportLoudnessMode } =
          useSampleStore.getState();
        const withinRenderLimit =
          Boolean(sourceSample) &&
          (sourceSample?.duration_ms ?? 0) > 0 &&
          (sourceSample?.duration_ms ?? 0) <= 600_000;
        const shouldExportRendered =
          paths.length === 1 &&
          withinRenderLimit &&
          (Math.abs(pitchSemitones) >= 0.01 || exportLoudnessMode !== "off");

        const droppedExternally =
          shouldExportRendered && sourceSample
            ? await startNativePitchedSampleDrag(
                sourceSample,
                pitchSemitones,
                sliceMicroFade,
                exportLoudnessMode
              )
            : await startNativeSampleDragRaw(paths, dragLabel);

        if (droppedExternally && autoBinOnNleDrag && paths.length > 0) {
          if (paths.length === 1 && sourceSample) {
            addSamplesToBin([sourceSample.id]);
          } else {
            const pathSet = new Set(paths);
            const stateNow = useSampleStore.getState();
            const sourcePool =
              stateNow.allProfileSamples.length > 0
                ? stateNow.allProfileSamples
                : stateNow.samples;
            const ids: number[] = [];
            for (const s of sourcePool) {
              if (pathSet.has(s.file_path)) ids.push(s.id);
            }
            if (ids.length > 0) {
              addSamplesToBin(ids);
            }
          }
        }
      } finally {
        // Keep `inAppDragSample` alive briefly so Chromium's DOM `drop` event on
        // LeftSidebar always executes even if Tauri IPC resolves a few ms earlier.
        osDragCleanupTimerRef.current = window.setTimeout(() => {
          osDragCleanupTimerRef.current = null;
          if (!isOsDragCurrentlyInFlight()) {
            osDragSampleRef.current = null;
            setActiveOsDragSample(null);
            setInAppDragSample(null);
          }
        }, 140);
      }
    },
    [autoBinOnNleDrag, addSamplesToBin, setInAppDragSample]
  );

  // Global CTRL+F shortcut to focus search bar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (
          useSampleStore.getState().isSettingsOpen ||
          document.querySelector(
            "[data-modal-portal='true'], [data-shortcut-recorder='true']"
          )
        ) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchInputRef]);

  // Rapid Tag / Genre keyboard shortcuts (`T` / `G`) anchored to selected row
  useEffect(() => {
    const onOpenRapidPicker = (ev: Event) => {
      const detail = (ev as CustomEvent<{ mode?: "tags" | "genres" }>).detail;
      const mode = detail?.mode;
      if (mode !== "tags" && mode !== "genres") return;

      const state = useSampleStore.getState();
      if (state.trashFilterActive || state.slicesFilterActive) return;
      const anchorId =
        state.selectedSample?.id ?? state.selectedSampleIds[0] ?? null;
      if (!anchorId || anchorId <= 0) return;

      setContextMenu(null);
      setHoverOverflowTags(null);
      setBatchPopover(null);
      setShowColumnPicker(false);
      setShowSearchHelper(false);

      const selector =
        mode === "tags"
          ? `[data-row-tag-btn="${anchorId}"]`
          : `[data-row-genre-btn="${anchorId}"]`;
      const btnEl = document.querySelector<HTMLElement>(selector);
      const rowEl =
        btnEl ??
        document.querySelector<HTMLElement>(`[data-sample-row-id="${anchorId}"]`);
      const anchorRect = rowEl?.getBoundingClientRect();

      let x = 360;
      let y = 120;
      if (anchorRect && anchorRect.width > 0 && anchorRect.height > 0) {
        const pos = computeAnchoredPopoverPosition(
          anchorRect,
          272,
          mode === "tags" ? 340 : 300,
          mode === "tags"
        );
        x = pos.x;
        y = pos.y;
      } else {
        const mainRect = document.querySelector("main")?.getBoundingClientRect();
        const baseLeft = mainRect?.left ?? 320;
        const baseWidth = mainRect?.width ?? Math.max(320, window.innerWidth - baseLeft);
        const baseTop = mainRect?.top ?? 80;
        x = Math.max(
          12,
          Math.min(window.innerWidth - 284, Math.round(baseLeft + (baseWidth - 272) / 2))
        );
        y = Math.max(64, Math.min(window.innerHeight - 352, Math.round(baseTop + 44)));
      }

      if (mode === "tags") {
        setRowGenrePopover(null);
        setRowTagPopover((prev) =>
          prev?.sampleId === anchorId ? null : { sampleId: anchorId, x, y }
        );
      } else {
        setRowTagPopover(null);
        setRowGenrePopover((prev) =>
          prev?.sampleId === anchorId ? null : { sampleId: anchorId, x, y }
        );
      }
    };

    window.addEventListener("audify:open-row-taxonomy-picker", onOpenRapidPicker);
    return () =>
      window.removeEventListener(
        "audify:open-row-taxonomy-picker",
        onOpenRapidPicker
      );
  }, [
    setBatchPopover,
    setContextMenu,
    setHoverOverflowTags,
    setRowGenrePopover,
    setRowTagPopover,
    setShowColumnPicker,
    setShowSearchHelper,
  ]);

  // Capture-phase Escape closes any open table menu/popover before App.tsx clears multi-selection
  const hasAnyTableMenuOpen = Boolean(
    contextMenu ||
      rowTagPopover ||
      rowGenrePopover ||
      batchPopover ||
      showColumnPicker ||
      showSearchHelper
  );
  useEffect(() => {
    if (!hasAnyTableMenuOpen) return;
    const onEscapeCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        document.querySelector(
          "[data-color-picker-portal='true'], [data-quick-create-portal='true']"
        )
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setContextMenu(null);
      setRowTagPopover(null);
      setRowGenrePopover(null);
      setHoverOverflowTags(null);
      setBatchPopover(null);
      setShowColumnPicker(false);
      setShowSearchHelper(false);
    };
    window.addEventListener("keydown", onEscapeCapture, true);
    return () => window.removeEventListener("keydown", onEscapeCapture, true);
  }, [
    hasAnyTableMenuOpen,
    setBatchPopover,
    setContextMenu,
    setHoverOverflowTags,
    setRowGenrePopover,
    setRowTagPopover,
    setShowColumnPicker,
    setShowSearchHelper,
  ]);

  // Close menus/popovers on outside click
  useEffect(() => {
    if (!hasAnyTableMenuOpen) return;
    const closeMenu = () => {
      setContextMenu(null);
      setRowTagPopover(null);
      setRowGenrePopover(null);
      setShowColumnPicker(false);
      setBatchPopover(null);
      setShowSearchHelper(false);
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [
    hasAnyTableMenuOpen,
    setBatchPopover,
    setContextMenu,
    setRowGenrePopover,
    setRowTagPopover,
    setShowColumnPicker,
    setShowSearchHelper,
  ]);

  // Dynamic OS Drag <-> LeftSidebar Bridge
  useEffect(() => {
    const getSidebarRight = () =>
      document.querySelector("aside")?.getBoundingClientRect().right ?? 296;

    const onDragOver = (e: DragEvent) => {
      if (!isOsDragCurrentlyInFlight()) return;
      const shared = getActiveOsDragSample();
      const dragSample = shared?.sample ?? osDragSampleRef.current;
      if (!dragSample) return;
      if (useSampleStore.getState().inAppDragSample?.id !== dragSample.id) {
        setInAppDragSample(
          dragSample,
          shared
            ? { single: shared.single, origin: shared.origin }
            : undefined
        );
      }
      if (e.clientX <= getSidebarRight()) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isOsDragCurrentlyInFlight()) return;
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        setInAppDragSample(null);
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      if (osDragCleanupTimerRef.current !== null) {
        window.clearTimeout(osDragCleanupTimerRef.current);
        osDragCleanupTimerRef.current = null;
      }
    };
  }, [setInAppDragSample]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, sample: SampleItem, index: number) => {
      if (suppressNextRowClickRef.current) {
        suppressNextRowClickRef.current = false;
        e.stopPropagation();
        return;
      }
      handleRowSelect(sample, index, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
    },
    [handleRowSelect]
  );

  const handleRowBodyMouseDown = useCallback(
    (e: React.MouseEvent, sample: SampleItem) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("[data-tag-badge]") ||
        target.closest("[data-inline-rename]")
      ) {
        return;
      }

      e.preventDefault();
      window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));

      const stateAtStart = useSampleStore.getState();
      if (sample.is_trashed || stateAtStart.trashFilterActive) {
        return;
      }

      const startSelectedSet = new Set(stateAtStart.selectedSampleIds);
      let paths = [sample.file_path];
      if (startSelectedSet.has(sample.id) && startSelectedSet.size > 1) {
        const source =
          stateAtStart.allProfileSamples.length > 0
            ? stateAtStart.allProfileSamples
            : stateAtStart.samples;
        const multiPaths = source
          .filter((s) => startSelectedSet.has(s.id) && !s.is_trashed)
          .map((s) => s.file_path);
        if (multiPaths.length > 0) paths = multiPaths;
      }

      beginDragOnMove(e.clientX, e.clientY, () => {
        suppressNextRowClickRef.current = true;
        window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
        void startNativeSampleDrag(paths, sample).finally(() => {
          window.setTimeout(() => {
            suppressNextRowClickRef.current = false;
          }, 60);
        });
      });
    },
    [startNativeSampleDrag]
  );

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, sample: SampleItem, index: number) => {
      e.preventDefault();
      e.stopPropagation();

      const state = useSampleStore.getState();
      const currentSelectedSet = new Set(state.selectedSampleIds);
      let targetIds = state.selectedSampleIds;
      if (!currentSelectedSet.has(sample.id)) {
        state.handleRowSelect(sample, index);
        targetIds = [sample.id];
      }

      setRowTagPopover(null);
      setRowGenrePopover(null);
      setHoverOverflowTags(null);
      setBatchPopover(null);
      setShowColumnPicker(false);
      setShowSearchHelper(false);

      const estMenuHeight = state.enableAdvancedFileOps
        ? sample.previous_file_name
          ? 295
          : 268
        : 205;
      const clampedX = Math.min(
        window.innerWidth - 248 - 8,
        Math.max(8, e.clientX)
      );
      const clampedY = Math.min(
        window.innerHeight - estMenuHeight - 12,
        Math.max(8, e.clientY)
      );

      setContextMenu({
        sample,
        targetIds,
        x: clampedX,
        y: clampedY,
        subMenu: null,
      });
    },
    [
      setBatchPopover,
      setContextMenu,
      setHoverOverflowTags,
      setRowGenrePopover,
      setRowTagPopover,
      setShowColumnPicker,
      setShowSearchHelper,
    ]
  );

  const openRowTagPopover = useCallback(
    (e: React.MouseEvent, sample: SampleItem) => {
      e.preventDefault();
      e.stopPropagation();
      // Read anchor geometry synchronously before React nulls e.currentTarget in deferred updaters.
      const anchorEl = e.currentTarget as HTMLElement | null;
      const rect = anchorEl?.getBoundingClientRect();
      setContextMenu(null);
      setHoverOverflowTags(null);
      setBatchPopover(null);
      setRowGenrePopover(null);
      if (!rect) return;

      const pos = computeAnchoredPopoverPosition(rect, 264, 340, true);
      setRowTagPopover((prev) =>
        prev?.sampleId === sample.id
          ? null
          : { sampleId: sample.id, x: pos.x, y: pos.y }
      );
    },
    [
      setBatchPopover,
      setContextMenu,
      setHoverOverflowTags,
      setRowGenrePopover,
      setRowTagPopover,
    ]
  );

  const openRowGenrePopover = useCallback(
    (e: React.MouseEvent, sample: SampleItem) => {
      e.preventDefault();
      e.stopPropagation();
      const anchorEl = e.currentTarget as HTMLElement | null;
      const rect = anchorEl?.getBoundingClientRect();
      setContextMenu(null);
      setRowTagPopover(null);
      setHoverOverflowTags(null);
      setBatchPopover(null);
      if (!rect) return;

      const pos = computeAnchoredPopoverPosition(rect, 248, 290, false);
      setRowGenrePopover((prev) =>
        prev?.sampleId === sample.id
          ? null
          : { sampleId: sample.id, x: pos.x, y: pos.y }
      );
    },
    [
      setBatchPopover,
      setContextMenu,
      setHoverOverflowTags,
      setRowGenrePopover,
      setRowTagPopover,
    ]
  );

  return {
    startNativeSampleDrag,
    handleRowClick,
    handleRowBodyMouseDown,
    handleRowContextMenu,
    openRowTagPopover,
    openRowGenrePopover,
  };
}
