import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Pause, Play, Star } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  formatDuplicateModeLabel,
  makeDuplicateScopeKey,
  resolveDuplicateScopeLabel,
} from "../../store/slices/duplicateSlice";
import { Collection, SampleItem } from "../../types";
import { beginDragOnMove } from "../../utils/drag";
import {
  folderNameFromPath,
  formatDuration,
  splitFileNameAndExt,
} from "../../utils/format";
import { EMPTY_SAMPLES, resolveSamplesByIds } from "../../utils/sampleLookup";
import { DragDropFeedbackOverlay } from "../sample-table/DragDropFeedbackOverlay";
import { SimilarityMatchBadge } from "../sample-table/SimilarityMatchBadge";
import { MiniContextMenuState } from "./MiniDockContextMenu";

const LazySampleBatchActionBar = lazy(() =>
  import("../sample-table/SampleBatchActionBar").then((m) => ({
    default: m.SampleBatchActionBar,
  }))
);

interface MiniDockListProps {
  onStartSampleDrag: (paths: string[], sourceSample: SampleItem) => Promise<void>;
  onOpenContextMenu: (menu: MiniContextMenuState) => void;
  batchPopover: "collection" | "tag" | "genre" | null;
  setBatchPopover: React.Dispatch<
    React.SetStateAction<"collection" | "tag" | "genre" | null>
  >;
}

export const MiniDockList: React.FC<MiniDockListProps> = ({
  onStartSampleDrag,
  onOpenContextMenu,
  batchPopover,
  setBatchPopover,
}) => {
  const samples = useSampleStore((s) => s.samples);
  const collections = useSampleStore((s) => s.collections);
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const selectedSampleObjects = useMemo(() => {
    if (selectedSampleIds.length <= 1) return EMPTY_SAMPLES;
    const pool = useSampleStore.getState().allProfileSamples;
    return resolveSamplesByIds(
      selectedSampleIds,
      pool.length > 0 ? pool : samples,
      samples
    );
  }, [selectedSampleIds, samples]);
  const isPlaying = useSampleStore((s) => s.isPlaying);
  const similaritySession = useSampleStore((s) => s.similaritySession);
  const libraries = useSampleStore((s) => s.libraries);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const isScanningDuplicates = useSampleStore((s) => s.isScanningDuplicates);
  const duplicateScanProgress = useSampleStore(
    (s) => s.duplicateScanProgress
  );
  const duplicateScanMode = useSampleStore((s) => s.duplicateScanMode);
  const duplicateLibraryId = useSampleStore((s) => s.duplicateLibraryId);
  const duplicateMinSimilarityPct = useSampleStore(
    (s) => s.duplicateMinSimilarityPct
  );
  const duplicateScanResult = useSampleStore((s) => s.duplicateScanResult);
  const duplicateScanCache = useSampleStore((s) => s.duplicateScanCache);

  const resetAllFilters = useSampleStore((s) => s.resetAllFilters);
  const scanDuplicates = useSampleStore((s) => s.scanDuplicates);

  const duplicateHasResult = Boolean(
    duplicateScanCache[
      makeDuplicateScopeKey(
        duplicateScanMode,
        duplicateLibraryId,
        duplicateMinSimilarityPct
      )
    ] || duplicateScanResult
  );
  const duplicateScopeLabel = useMemo(
    () => resolveDuplicateScopeLabel(libraries, duplicateLibraryId),
    [libraries, duplicateLibraryId]
  );
  const duplicateScanModeLabel = formatDuplicateModeLabel(
    duplicateScanMode,
    duplicateMinSimilarityPct
  );

  const listParentRef = useRef<HTMLDivElement>(null);
  const suppressNextClickRef = useRef(false);

  const { rootCollections, childrenByParentId } = useMemo(() => {
    const roots: Collection[] = [];
    const childrenMap = new Map<number, Collection[]>();
    for (const c of collections) {
      if (c.parent_id) {
        const list = childrenMap.get(c.parent_id) || [];
        list.push(c);
        childrenMap.set(c.parent_id, list);
      } else {
        roots.push(c);
      }
    }
    for (const [, list] of childrenMap.entries()) {
      list.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    }
    roots.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
    return { rootCollections: roots, childrenByParentId: childrenMap };
  }, [collections]);

  const selectedIdSet = useMemo(
    () => new Set(selectedSampleIds),
    [selectedSampleIds]
  );

  const rowVirtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 28,
    overscan: 18,
  });

  // Auto-scroll virtual list when active sample changes via Up/Down keys
  const prevSelectedIdRef = useRef<number | null>(selectedSample?.id ?? null);
  useEffect(() => {
    const currentId = selectedSample?.id ?? null;
    if (currentId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = currentId;
    if (currentId === null) return;
    const idx = samples.findIndex((s) => s.id === currentId);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [selectedSample?.id, samples, rowVirtualizer]);

  const handleRowMouseDown = useCallback(
    (e: React.MouseEvent, sample: SampleItem) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("[data-inline-rename]")
      ) {
        return;
      }

      e.preventDefault();
      window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));

      const state = useSampleStore.getState();
      if (sample.is_trashed || state.trashFilterActive) {
        return;
      }
      const selSet = new Set(state.selectedSampleIds);
      let paths = [sample.file_path];
      if (selSet.has(sample.id) && selSet.size > 1) {
        const pool =
          state.allProfileSamples.length > 0
            ? state.allProfileSamples
            : state.samples;
        const multi = pool
          .filter((s) => selSet.has(s.id) && !s.is_trashed)
          .map((s) => s.file_path);
        if (multi.length > 0) paths = multi;
      }

      beginDragOnMove(e.clientX, e.clientY, () => {
        suppressNextClickRef.current = true;
        window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
        void onStartSampleDrag(paths, sample).finally(() => {
          window.setTimeout(() => {
            suppressNextClickRef.current = false;
          }, 60);
        });
      });
    },
    [onStartSampleDrag]
  );

  const handleRowClick = useCallback(
    (e: React.MouseEvent, sample: SampleItem, rowIndex: number) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        e.stopPropagation();
        return;
      }
      useSampleStore.getState().handleRowSelect(sample, rowIndex, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
    },
    []
  );

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, sample: SampleItem, rowIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      const state = useSampleStore.getState();
      if (!state.selectedSampleIds.includes(sample.id)) {
        state.handleRowSelect(sample, rowIndex);
      }
      const estHeight = state.trashFilterActive
        ? 190
        : state.enableAdvancedFileOps
        ? sample.previous_file_name
          ? 222
          : 196
        : 136;
      onOpenContextMenu({
        sample,
        x: Math.min(window.innerWidth - 188, Math.max(6, e.clientX)),
        y: Math.min(window.innerHeight - estHeight, Math.max(6, e.clientY)),
      });
    },
    [onOpenContextMenu]
  );

  const handleBatchNativeDrag = useCallback(
    (paths: string[], src?: SampleItem) => {
      const primary = src || selectedSampleObjects[0];
      if (primary) {
        void onStartSampleDrag(paths, primary);
      }
    },
    [onStartSampleDrag, selectedSampleObjects]
  );

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {samples.length === 0 ? (
        duplicatesFilterActive && isScanningDuplicates ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-2">
            <span className="font-mono text-[11px] text-fg-2">
              {duplicateScanProgress
                ? `${duplicateScanProgress.stage_label} (${Math.min(
                    100,
                    Math.max(0, Math.round(duplicateScanProgress.percentage))
                  )}%)`
                : "Scanning duplicates..."}
            </span>
          </div>
        ) : duplicatesFilterActive && !duplicateHasResult ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-2">
            <span className="font-mono text-[11px] font-semibold text-fg">
              Ready to scan duplicates
            </span>
            <span className="font-mono text-[10px] text-fg-3">
              {duplicateScopeLabel} · {duplicateScanModeLabel}
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void scanDuplicates()}
                className="h-[26px] px-3 bg-accent hover:bg-accent-hover text-accent-on font-mono text-[10.5px] font-bold rounded-xs cursor-pointer"
              >
                SCAN DUPLICATES
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={resetAllFilters}
                className="h-[26px] px-2.5 bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg font-mono text-[10px] rounded-xs cursor-pointer"
              >
                EXIT
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-2">
            <span className="font-mono text-[11.5px] text-fg-2">
              {duplicatesFilterActive
                ? "No duplicate audio found in current scope"
                : "No matching samples"}
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={resetAllFilters}
              className="h-[26px] px-3 bg-surface-3 hover:border-accent border border-line-strong text-accent-fg font-mono text-[10.5px] font-semibold rounded-xs"
            >
              RESET FILTERS
            </button>
          </div>
        )
      ) : (
        <div
          ref={listParentRef}
          className="flex-1 overflow-y-auto overflow-x-hidden relative outline-none"
          tabIndex={0}
          role="grid"
          aria-multiselectable="true"
          aria-rowcount={samples.length}
          aria-label="Mini Dock Samples"
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const sample = samples[vRow.index];
              if (!sample) return null;
              const isPrimary = selectedSample?.id === sample.id;
              const isSelected = isPrimary || selectedIdSet.has(sample.id);
              const isSimilarityMode = similaritySession !== null;
              const isSimilarityAnchor = similaritySession
                ? similaritySession.anchorSample.id === sample.id
                : false;
              const matchScore = similaritySession
                ? similaritySession.scoresById.get(sample.id) ?? null
                : null;
              return (
                <MiniDockRow
                  key={sample.id}
                  sample={sample}
                  rowIndex={vRow.index}
                  offsetY={vRow.start}
                  isPrimary={isPrimary}
                  isRowPlaying={isPrimary && isPlaying}
                  isSelected={isSelected}
                  isSimilarityMode={isSimilarityMode}
                  isSimilarityAnchor={isSimilarityAnchor}
                  matchScore={matchScore}
                  onRowClick={handleRowClick}
                  onRowMouseDown={handleRowMouseDown}
                  onRowContextMenu={handleRowContextMenu}
                />
              );
            })}
          </div>
        </div>
      )}

      <DragDropFeedbackOverlay compact={true} />

      {selectedSampleIds.length > 1 && (
        <Suspense fallback={null}>
          <LazySampleBatchActionBar
            compact={true}
            selectedSampleIds={selectedSampleIds}
            selectedSampleObjects={selectedSampleObjects}
            rootCollections={rootCollections}
            childrenByParentId={childrenByParentId}
            batchPopover={batchPopover}
            setBatchPopover={setBatchPopover}
            onStartNativeDrag={handleBatchNativeDrag}
          />
        </Suspense>
      )}
    </div>
  );
};

interface MiniDockRowProps {
  sample: SampleItem;
  rowIndex: number;
  offsetY: number;
  isPrimary: boolean;
  isRowPlaying: boolean;
  isSelected: boolean;
  isSimilarityMode: boolean;
  isSimilarityAnchor: boolean;
  matchScore: number | null;
  onRowClick: (e: React.MouseEvent, sample: SampleItem, rowIndex: number) => void;
  onRowMouseDown: (e: React.MouseEvent, sample: SampleItem) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    sample: SampleItem,
    rowIndex: number
  ) => void;
}

const MiniDockRow: React.FC<MiniDockRowProps> = React.memo(
  ({
    sample,
    rowIndex,
    offsetY,
    isPrimary,
    isRowPlaying,
    isSelected,
    isSimilarityMode,
    isSimilarityAnchor,
    matchScore,
    onRowClick,
    onRowMouseDown,
    onRowContextMenu,
  }) => {
    const { stem, ext } = splitFileNameAndExt(sample.file_name);
    const bpmDisplay =
      sample.bpm && sample.bpm > 0 ? `${Math.round(sample.bpm)}` : null;
    const keyDisplay = sample.camelot_key || sample.musical_key || null;
    const folderName = folderNameFromPath(sample.folder_path, sample.folder_path);

    return (
      <div
        role="row"
        aria-selected={isSelected}
        aria-rowindex={rowIndex + 1}
        aria-label={sample.file_name}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "28px",
          transform: `translateY(${offsetY}px)`,
        }}
        onClick={(e) => onRowClick(e, sample, rowIndex)}
        onMouseDown={(e) => onRowMouseDown(e, sample)}
        onContextMenu={(e) => onRowContextMenu(e, sample, rowIndex)}
        className={`flex items-center px-2 border-b border-line-subtle cursor-pointer ${
          isSelected
            ? "bg-accent-soft border-l-2 border-l-accent"
            : "audify-row-surface border-l-2 border-l-transparent"
        }`}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            void useSampleStore.getState().toggleFavorite(sample.id);
          }}
          className={`w-[22px] h-full flex items-center justify-center shrink-0 ${
            sample.is_favorite
              ? "text-accent-fg"
              : "text-fg-3 hover:text-fg-2"
          }`}
          title="Toggle Favorite"
        >
          <Star
            className={`w-3.5 h-3.5 ${sample.is_favorite ? "fill-current" : ""}`}
          />
        </button>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            const store = useSampleStore.getState();
            if (isPrimary) {
              store.togglePlayPause();
            } else {
              store.handleRowSelect(sample, rowIndex);
            }
          }}
          className={`w-[18px] h-full flex items-center justify-center shrink-0 ${
            isPrimary ? "text-accent-fg" : "text-fg-3 hover:text-fg"
          }`}
          title="Play / Preview"
        >
          {isRowPlaying ? (
            <Pause className="w-3 h-3 fill-current" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
        </button>

        {isSimilarityMode && (
          <div
            className="w-[46px] h-full px-0.5 flex items-center justify-center shrink-0"
            title={
              isSimilarityAnchor
                ? "Similarity Search Reference Anchor (100%)"
                : matchScore !== null
                  ? `Acoustic Cosine Similarity: ${(matchScore * 100).toFixed(1)}%`
                  : "No match score"
            }
          >
            <SimilarityMatchBadge
              isAnchor={isSimilarityAnchor}
              matchScore={matchScore}
              compact={true}
            />
          </div>
        )}

        <div
          className={`flex-1 min-w-0 px-1.5 text-[12.5px] truncate ${
            isSelected ? "font-semibold text-fg" : "text-fg"
          }`}
          title={`${sample.file_name} (${folderName}) — Drag directly onto NLE timeline or sidebar`}
        >
          {stem}
          <span className="text-fg-3 font-normal">{ext}</span>
        </div>

        {(bpmDisplay || keyDisplay) && (
          <div className="flex items-center gap-1 px-1 shrink-0">
            {bpmDisplay && (
              <span className="px-1.5 py-0.2 rounded-[2px] bg-surface-2 border border-line font-mono tabular-nums text-[9.5px] text-fg-2">
                {bpmDisplay}
              </span>
            )}
            {keyDisplay && (
              <span className="px-1.5 py-0.2 rounded-[2px] bg-surface-2 border border-line font-mono tabular-nums text-[9.5px] text-accent-fg">
                {keyDisplay}
              </span>
            )}
          </div>
        )}

        <div className="font-mono tabular-nums text-[11px] text-fg-2 w-[54px] text-right pr-1 shrink-0">
          {formatDuration(sample.duration_ms)}
        </div>
      </div>
    );
  }
);
MiniDockRow.displayName = "MiniDockRow";
