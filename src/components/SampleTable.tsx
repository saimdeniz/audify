import React, {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  buildDuplicateMetaBySampleId,
  formatDuplicateModeLabel,
  makeDuplicateScopeKey,
  resolveDuplicateScopeLabel,
} from "../store/slices/duplicateSlice";
import { useSampleStore } from "../store/useSampleStore";
import { SampleItem } from "../types";
import { buildCollectionHierarchy } from "../utils/collectionTree";
import {
  EMPTY_SAMPLE_MAP,
  EMPTY_SAMPLES,
  getCachedSampleByIdMap,
} from "../utils/sampleLookup";
import { formatShortcutDisplay } from "../utils/shortcuts";
import { getSharedTaxonomyIndex } from "../utils/taxonomyTree";
import { WaveformDisplayConfig } from "./MiniWaveform";
import { SampleFilterToolbar } from "./sample-table/SampleFilterToolbar";

const LazyDragDropFeedbackOverlay = lazy(() =>
  import("./sample-table/DragDropFeedbackOverlay").then((m) => ({
    default: m.DragDropFeedbackOverlay,
  }))
);
const LazyFilterDrawer = lazy(() =>
  import("./sample-table/FilterDrawer").then((m) => ({
    default: m.FilterDrawer,
  }))
);

const LazyActiveFilterBanner = lazy(() =>
  import("./sample-table/ActiveFilterBanner").then((m) => ({
    default: m.ActiveFilterBanner,
  }))
);

const LazySampleBatchActionBar = lazy(() =>
  import("./sample-table/SampleBatchActionBar").then((m) => ({
    default: m.SampleBatchActionBar,
  }))
);
const SampleTableEmptyState = lazy(() =>
  import("./sample-table/SampleTableEmptyState").then((m) => ({
    default: m.SampleTableEmptyState,
  }))
);
import { SampleTableHeader } from "./sample-table/SampleTableHeader";
import { SampleTableRowsPane } from "./sample-table/SampleTableRowsPane";
import { ContextMenuState, RowPopoverPosition } from "./sample-table/tableLayout";
import { useSampleTableInteractions } from "./sample-table/useSampleTableInteractions";
import { useSampleTableLayout } from "./sample-table/useSampleTableLayout";

const SampleContextMenu = lazy(() =>
  import("./sample-table/SampleContextMenu").then((m) => ({
    default: m.SampleContextMenu,
  }))
);
const SampleRowPopovers = lazy(() =>
  import("./sample-table/SampleRowPopovers").then((m) => ({
    default: m.SampleRowPopovers,
  }))
);
const SlicesTableView = lazy(() =>
  import("./sample-table/SlicesTableView").then((m) => ({
    default: m.SlicesTableView,
  }))
);

export const SampleTable: React.FC = () => {
  const hasInitialized = useSampleStore((s) => s.hasInitialized);
  const libraries = useSampleStore((s) => s.libraries);
  const samples = useSampleStore((s) => s.samples);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const genres = useSampleStore((s) => s.genres);
  const collections = useSampleStore((s) => s.collections);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const selectedCollectionId = useSampleStore((s) => s.selectedCollectionId);
  const selectedSample = useSampleStore((s) => s.selectedSample);
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const similaritySession = useSampleStore((s) => s.similaritySession);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const showSlicesTable =
    slicesFilterActive || (trashFilterActive && trashViewTab === "slices");
  const hasActiveFilterBanner = useSampleStore((s) =>
    Boolean(
      s.similaritySession ||
        s.folderFilter ||
        s.selectedCollectionId !== null ||
        s.selectedLicenseGroupId !== null ||
        s.favoriteOnly ||
        s.recentOnly ||
        s.binFilterActive ||
        s.slicesFilterActive ||
        s.duplicatesFilterActive ||
        s.trashFilterActive ||
        s.trashOpStatus ||
        s.typeFilter !== "all" ||
        s.srFilter !== null ||
        s.selectedGenre ||
        s.selectedTagIds.length > 0 ||
        s.excludedTagIds.length > 0 ||
        s.searchQuery.toLowerCase().includes("bpm:") ||
        s.searchQuery.toLowerCase().includes("key:")
    )
  );
  const isScanningDuplicates = useSampleStore((s) => s.isScanningDuplicates);
  const duplicateScanMode = useSampleStore((s) => s.duplicateScanMode);
  const duplicateLibraryId = useSampleStore((s) => s.duplicateLibraryId);
  const duplicateMinSimilarityPct = useSampleStore(
    (s) => s.duplicateMinSimilarityPct
  );
  const duplicateScanResult = useSampleStore((s) => s.duplicateScanResult);
  const duplicateScanCache = useSampleStore((s) => s.duplicateScanCache);
  const aiSuggestionsBySampleId = useSampleStore(
    (s) => s.aiSuggestionsBySampleId
  );
  const isScanning = useSampleStore((s) => s.isScanning);
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);
  const toggleFavoriteShortcut = useSampleStore(
    (s) => s.shortcuts.toggleFavorite
  );
  const favoriteShortcutLabel = formatShortcutDisplay(toggleFavoriteShortcut, {
    compact: true,
  });
  const waveformDisplay = useSampleStore(
    useShallow(
      (s): WaveformDisplayConfig => ({
        accentColor: s.accentColor,
        themeMode: s.themeMode,
        enableMica: s.enableMica,
        waveformSensitivity: s.waveformSensitivity,
        waveformStyle: s.waveformStyle,
      })
    )
  );

  const addAndScanFolder = useSampleStore((s) => s.addAndScanFolder);
  const resetAllFilters = useSampleStore((s) => s.resetAllFilters);
  const scanDuplicates = useSampleStore((s) => s.scanDuplicates);
  const handleAddFolder = useCallback(() => {
    void addAndScanFolder();
  }, [addAndScanFolder]);
  const handleScanDuplicates = useCallback(() => {
    void scanDuplicates();
  }, [scanDuplicates]);

  const handleTableScroll = useCallback(() => {
    setHoverOverflowTags((prev) => (prev ? null : prev));
    setRowTagPopover((prev) => (prev ? null : prev));
    setRowGenrePopover((prev) => (prev ? null : prev));
    setContextMenu((prev) => (prev ? null : prev));
  }, []);

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

  const parentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [rowTagPopover, setRowTagPopover] = useState<RowPopoverPosition | null>(
    null
  );
  const [rowGenrePopover, setRowGenrePopover] =
    useState<RowPopoverPosition | null>(null);
  const [hoverOverflowTags, setHoverOverflowTags] =
    useState<RowPopoverPosition | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [batchPopover, setBatchPopover] = useState<
    "collection" | "tag" | "genre" | null
  >(null);
  const [showSearchHelper, setShowSearchHelper] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const isSimilarityMode = similaritySession !== null;
  const {
    visibleCols,
    columnOrder,
    setColumnOrder,
    colWidths,
    setColWidths,
    toggleVisibleCol,
    applyVisibleColsPreset,
    resetTableLayout,
    columnsContentWidth,
    totalTableWidth,
    verticalScrollbarWidth,
  } = useSampleTableLayout({
    parentRef,
    headerRef,
    sampleCount: samples.length,
    showSlicesTable,
    isSimilarityMode,
  });

  const duplicateMetaBySampleId = useMemo(
    () =>
      duplicatesFilterActive
        ? buildDuplicateMetaBySampleId(duplicateScanResult)
        : null,
    [duplicatesFilterActive, duplicateScanResult]
  );

  const { rootCollections, childrenByParentId } = useMemo(
    () =>
      buildCollectionHierarchy(collections, {
        excludeSmart: true,
        sortRoots: true,
      }),
    [collections]
  );

  const isSmartCollectionActive = useMemo(() => {
    if (selectedCollectionId === null) return false;
    return Boolean(
      collections
        .find((c) => c.id === selectedCollectionId)
        ?.smart_query?.trim()
    );
  }, [collections, selectedCollectionId]);

  const selectedIdSet = useMemo(
    () => new Set(selectedSampleIds),
    [selectedSampleIds]
  );

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );

  const hasActiveSampleLookup =
    selectedSampleIds.length > 0 ||
    contextMenu !== null ||
    hoverOverflowTags !== null ||
    rowTagPopover !== null ||
    rowGenrePopover !== null;

  const sampleByIdMap = useMemo(() => {
    if (!hasActiveSampleLookup) return EMPTY_SAMPLE_MAP;
    const pool = useSampleStore.getState().allProfileSamples;
    if (trashFilterActive || pool.length === 0) {
      return getCachedSampleByIdMap(samples);
    }
    return getCachedSampleByIdMap(pool);
  }, [hasActiveSampleLookup, trashFilterActive, samples]);

  const selectedSampleObjects = useMemo(() => {
    if (selectedSampleIds.length === 0) return EMPTY_SAMPLES;
    return selectedSampleIds
      .map((id) => sampleByIdMap.get(id))
      .filter((s): s is SampleItem => Boolean(s));
  }, [selectedSampleIds, sampleByIdMap]);

  const taxonomyIndex = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );

  const genreColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of genres) {
      map.set(g.name.toLowerCase(), g.color);
    }
    return map;
  }, [genres]);

  const {
    startNativeSampleDrag,
    handleRowClick,
    handleRowBodyMouseDown,
    handleRowContextMenu,
    openRowTagPopover,
    openRowGenrePopover,
  } = useSampleTableInteractions({
    samples,
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
  });

  return (
    <main
      className="flex-1 flex flex-col min-w-0 audify-stage-surface select-none relative"
      onClick={() => {
        if (showColumnPicker) setShowColumnPicker(false);
        if (rowTagPopover !== null) setRowTagPopover(null);
        if (rowGenrePopover !== null) setRowGenrePopover(null);
        if (contextMenu !== null) setContextMenu(null);
        if (batchPopover !== null) setBatchPopover(null);
        if (showSearchHelper) setShowSearchHelper(false);
      }}
    >
      <SampleFilterToolbar
        searchInputRef={searchInputRef}
        showSearchHelper={showSearchHelper}
        setShowSearchHelper={setShowSearchHelper}
      />

      {hasActiveFilterBanner && (
        <Suspense fallback={null}>
          <LazyActiveFilterBanner />
        </Suspense>
      )}

      {showSlicesTable ? (
        <Suspense fallback={null}>
          <SlicesTableView />
        </Suspense>
      ) : (
        <>
          <SampleTableHeader
            headerRef={headerRef}
            columnsContentWidth={columnsContentWidth}
            scrollbarGutterWidth={verticalScrollbarWidth}
            isSimilarityMode={isSimilarityMode}
            columnOrder={columnOrder}
            setColumnOrder={setColumnOrder}
            visibleCols={visibleCols}
            toggleVisibleCol={toggleVisibleCol}
            applyVisibleColsPreset={applyVisibleColsPreset}
            colWidths={colWidths}
            setColWidths={setColWidths}
            resetTableLayout={resetTableLayout}
            showColumnPicker={showColumnPicker}
            setShowColumnPicker={setShowColumnPicker}
          />

          {!hasInitialized || libraries.length === 0 || samples.length === 0 ? (
            <Suspense fallback={<div className="flex-1" />}>
              <SampleTableEmptyState
                hasLibraries={libraries.length > 0}
                isInitializing={!hasInitialized}
                isScanning={isScanning}
                isScanningDuplicates={
                  duplicatesFilterActive && isScanningDuplicates
                }
                duplicatesFilterActive={duplicatesFilterActive}
                duplicateHasResult={duplicateHasResult}
                duplicateScopeLabel={duplicateScopeLabel}
                duplicateScanModeLabel={duplicateScanModeLabel}
                onScanDuplicates={handleScanDuplicates}
                onAddFolder={handleAddFolder}
                onResetFilters={resetAllFilters}
              />
            </Suspense>
          ) : (
            <SampleTableRowsPane
              parentRef={parentRef}
              headerRef={headerRef}
              samples={samples}
              selectedSample={selectedSample}
              selectedIdSet={selectedIdSet}
              selectedTagSet={selectedTagSet}
              selectedCollectionId={selectedCollectionId}
              isSmartCollectionActive={isSmartCollectionActive}
              selectedGenre={selectedGenre}
              similaritySession={similaritySession}
              isSimilarityMode={isSimilarityMode}
              duplicateMetaBySampleId={duplicateMetaBySampleId}
              aiSuggestionsBySampleId={aiSuggestionsBySampleId}
              activeTagPopoverSampleId={rowTagPopover?.sampleId ?? null}
              activeGenrePopoverSampleId={rowGenrePopover?.sampleId ?? null}
              setHoverOverflowTags={setHoverOverflowTags}
              onTableScroll={handleTableScroll}
              columnOrder={columnOrder}
              visibleCols={visibleCols}
              colWidths={colWidths}
              totalTableWidth={totalTableWidth}
              genreColorMap={genreColorMap}
              taxonomyIndex={taxonomyIndex}
              waveformDisplay={waveformDisplay}
              favoriteShortcutLabel={favoriteShortcutLabel}
              onRowClick={handleRowClick}
              onRowBodyMouseDown={handleRowBodyMouseDown}
              onRowContextMenu={handleRowContextMenu}
              openRowTagPopover={openRowTagPopover}
              openRowGenrePopover={openRowGenrePopover}
            />
          )}
        </>
      )}

      <Suspense fallback={null}>
        <LazyDragDropFeedbackOverlay />
      </Suspense>

      {selectedSampleIds.length > 1 && !showSlicesTable && (
        <Suspense fallback={null}>
          <LazySampleBatchActionBar
            selectedSampleIds={selectedSampleIds}
            selectedSampleObjects={selectedSampleObjects}
            rootCollections={rootCollections}
            childrenByParentId={childrenByParentId}
            batchPopover={batchPopover}
            setBatchPopover={setBatchPopover}
            onStartNativeDrag={startNativeSampleDrag}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <LazyFilterDrawer />
      </Suspense>

      {contextMenu && (
        <Suspense fallback={null}>
          <SampleContextMenu
            contextMenu={contextMenu}
            setContextMenu={setContextMenu}
            sampleByIdMap={sampleByIdMap}
            rootCollections={rootCollections}
            childrenByParentId={childrenByParentId}
          />
        </Suspense>
      )}

      {(hoverOverflowTags || rowTagPopover || rowGenrePopover) && (
        <Suspense fallback={null}>
          <SampleRowPopovers
            hoverOverflowTags={hoverOverflowTags}
            rowTagPopover={rowTagPopover}
            setRowTagPopover={setRowTagPopover}
            rowGenrePopover={rowGenrePopover}
            setRowGenrePopover={setRowGenrePopover}
            sampleByIdMap={sampleByIdMap}
            selectedIdSet={selectedIdSet}
            selectedTagSet={selectedTagSet}
          />
        </Suspense>
      )}
    </main>
  );
};
