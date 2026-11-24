import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DuplicateSampleMeta } from "../../store/slices/duplicateSlice";
import { useSampleStore } from "../../store/useSampleStore";
import type {
  AiTagSuggestionItem,
  SampleItem,
  SimilaritySession,
} from "../../types";
import type { WaveformDisplayConfig } from "../MiniWaveform";
import { SampleTableRow } from "./SampleTableRow";
import type {
  ColumnId,
  ResizableColKey,
  RowPopoverPosition,
  VisibleColumnsState,
} from "./tableLayout";

interface SampleTableRowsPaneProps {
  parentRef: React.RefObject<HTMLDivElement>;
  headerRef: React.RefObject<HTMLDivElement>;
  samples: SampleItem[];
  selectedSample: SampleItem | null;
  selectedIdSet: ReadonlySet<number>;
  selectedTagSet: ReadonlySet<number>;
  selectedCollectionId: number | null;
  isSmartCollectionActive: boolean;
  selectedGenre: string | null;
  similaritySession: SimilaritySession | null;
  isSimilarityMode: boolean;
  duplicateMetaBySampleId: ReadonlyMap<number, DuplicateSampleMeta> | null;
  aiSuggestionsBySampleId: Record<number, AiTagSuggestionItem[]>;
  activeTagPopoverSampleId: number | null;
  activeGenrePopoverSampleId: number | null;
  setHoverOverflowTags: React.Dispatch<
    React.SetStateAction<RowPopoverPosition | null>
  >;
  columnOrder: ColumnId[];
  visibleCols: VisibleColumnsState;
  colWidths: Record<ResizableColKey, number>;
  totalTableWidth: number;
  genreColorMap: ReadonlyMap<string, string>;
  waveformDisplay: WaveformDisplayConfig;
  favoriteShortcutLabel: string;
  onRowClick: (e: React.MouseEvent, sample: SampleItem, index: number) => void;
  onRowBodyMouseDown: (e: React.MouseEvent, sample: SampleItem) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    sample: SampleItem,
    index: number
  ) => void;
  openRowTagPopover: (e: React.MouseEvent, sample: SampleItem) => void;
  openRowGenrePopover: (e: React.MouseEvent, sample: SampleItem) => void;
}

/**
 * Virtualized scrollable rows pane for `SampleTable`, owning row virtualization,
 * horizontal scroll header sync, and active-sample scroll-into-view tracking.
 */
export const SampleTableRowsPane: React.FC<SampleTableRowsPaneProps> =
  React.memo(({
  parentRef,
  headerRef,
  samples,
  selectedSample,
  selectedIdSet,
  selectedTagSet,
  selectedCollectionId,
  isSmartCollectionActive,
  selectedGenre,
  similaritySession,
  isSimilarityMode,
  duplicateMetaBySampleId,
  aiSuggestionsBySampleId,
  activeTagPopoverSampleId,
  activeGenrePopoverSampleId,
  setHoverOverflowTags,
  columnOrder,
  visibleCols,
  colWidths,
  totalTableWidth,
  genreColorMap,
  waveformDisplay,
  favoriteShortcutLabel,
  onRowClick,
  onRowBodyMouseDown,
  onRowContextMenu,
  openRowTagPopover,
  openRowGenrePopover,
}) => {
  const rowVirtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 8,
  });

  // Scroll virtualizer only when the primary selected sample ID actually changes
  const prevSelectedIdRef = useRef<number | null>(selectedSample?.id ?? null);
  useEffect(() => {
    const currentId = selectedSample?.id ?? null;
    if (currentId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = currentId;
    if (currentId === null) return;
    const currentSamples = useSampleStore.getState().samples;
    if (currentSamples.length === 0) return;
    const idx = currentSamples.findIndex((s) => s.id === currentId);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [selectedSample?.id, rowVirtualizer]);

  return (
    <div
      ref={parentRef}
      onScroll={(e) => {
        if (headerRef.current) {
          headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }
        setHoverOverflowTags((prev) => (prev ? null : prev));
      }}
      className="flex-1 overflow-auto relative outline-none"
      tabIndex={0}
      role="grid"
      aria-label="Samples"
      aria-multiselectable="true"
      aria-rowcount={samples.length}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          minWidth: `${totalTableWidth}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const sample = samples[virtualRow.index];
          if (!sample) return null;

          const isPrimarySelected = selectedSample?.id === sample.id;
          const isMultiSelected = selectedIdSet.has(sample.id);
          const isRowSelected = isPrimarySelected || isMultiSelected;
          const matchScore = similaritySession
            ? similaritySession.scoresById.get(sample.id) ?? null
            : null;
          const isSimilarityAnchor = similaritySession
            ? similaritySession.anchorSample.id === sample.id
            : false;
          const pendingAiTags = aiSuggestionsBySampleId[sample.id];
          const dupMeta = duplicateMetaBySampleId?.get(sample.id);
          const prevSample =
            virtualRow.index > 0 ? samples[virtualRow.index - 1] : null;
          const prevDupMeta = prevSample
            ? duplicateMetaBySampleId?.get(prevSample.id)
            : undefined;
          const isDuplicateGroupStart = Boolean(
            dupMeta && prevDupMeta && dupMeta.groupId !== prevDupMeta.groupId
          );
          const isDuplicateAltGroup = Boolean(
            dupMeta && dupMeta.groupNumber % 2 === 0
          );
          const duplicateRole = dupMeta
            ? dupMeta.keepSuggested
              ? "keep"
              : "extra"
            : undefined;
          const showSimilarityPct = Boolean(
            dupMeta &&
              (dupMeta.matchKind === "similar" ||
                dupMeta.matchKind === "near_duplicate" ||
                dupMeta.similarityPct < 100)
          );
          const duplicateGroupLabel = dupMeta
            ? showSimilarityPct
              ? `#G${dupMeta.groupNumber} · ${dupMeta.similarityPct}%`
              : `#G${dupMeta.groupNumber}`
            : undefined;
          const duplicateHighConfidence =
            dupMeta && showSimilarityPct
              ? dupMeta.similarityPct >= 98
              : true;

          return (
            <SampleTableRow
              key={sample.id}
              sample={sample}
              rowIndex={virtualRow.index}
              startOffsetPx={virtualRow.start}
              totalTableWidth={totalTableWidth}
              isSimilarityMode={isSimilarityMode}
              matchScore={matchScore}
              isSimilarityAnchor={isSimilarityAnchor}
              duplicateRole={duplicateRole}
              duplicateGroupLabel={duplicateGroupLabel}
              duplicateHighConfidence={duplicateHighConfidence}
              isDuplicateGroupStart={isDuplicateGroupStart}
              isDuplicateAltGroup={isDuplicateAltGroup}
              duplicateReadOnly={dupMeta?.libraryReadOnly ?? false}
              pendingAiTags={pendingAiTags}
              isPrimarySelected={isPrimarySelected}
              isRowSelected={isRowSelected}
              isTagPopoverOpen={activeTagPopoverSampleId === sample.id}
              isGenrePopoverOpen={activeGenrePopoverSampleId === sample.id}
              columnOrder={columnOrder}
              visibleCols={visibleCols}
              colWidths={colWidths}
              selectedCollectionId={selectedCollectionId}
              isSmartCollectionActive={isSmartCollectionActive}
              selectedGenre={selectedGenre}
              selectedTagSet={selectedTagSet}
              genreColorMap={genreColorMap}
              waveformDisplay={waveformDisplay}
              favoriteShortcutLabel={favoriteShortcutLabel}
              onRowClick={onRowClick}
              onRowMouseDown={onRowBodyMouseDown}
              onRowContextMenu={onRowContextMenu}
              onOpenTagPopover={openRowTagPopover}
              onOpenGenrePopover={openRowGenrePopover}
              onSetHoverOverflowTags={setHoverOverflowTags}
            />
          );
        })}
      </div>
    </div>
  );
});
