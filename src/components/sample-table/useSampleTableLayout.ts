import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { safeRemoveItem, safeSetItem } from "../../store/storageHelpers";
import {
  ColumnId,
  computeColumnsContentWidth,
  DEFAULT_COL_WIDTHS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLS,
  loadValidatedColWidths,
  loadValidatedColumnOrder,
  loadValidatedVisibleCols,
  ResizableColKey,
  VisibleColumnsState,
} from "./tableLayout";

interface UseSampleTableLayoutParams {
  parentRef: React.RefObject<HTMLDivElement>;
  headerRef: React.RefObject<HTMLDivElement>;
  sampleCount: number;
  showSlicesTable: boolean;
  isSimilarityMode: boolean;
}

/**
 * Manages persisted SampleTable column widths, order, visibility toggles, and
 * synchronized horizontal/vertical scrollbar gutter sizing.
 */
export function useSampleTableLayout({
  parentRef,
  headerRef,
  sampleCount,
  showSlicesTable,
  isSimilarityMode,
}: UseSampleTableLayoutParams) {
  const [verticalScrollbarWidth, setVerticalScrollbarWidth] = useState(0);
  const [visibleCols, setVisibleCols] = useState<VisibleColumnsState>(() =>
    loadValidatedVisibleCols()
  );
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() =>
    loadValidatedColumnOrder()
  );
  const [colWidths, setColWidths] = useState<Record<ResizableColKey, number>>(
    () => loadValidatedColWidths()
  );

  const toggleVisibleCol = useCallback((key: keyof VisibleColumnsState) => {
    setVisibleCols((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      safeSetItem(AUDIFY_STORAGE_KEYS.visibleColumnsV2, JSON.stringify(next), {
        broadcast: false,
        markEdited: false,
      });
      return next;
    });
  }, []);

  const resetTableLayout = useCallback(() => {
    setVisibleCols({ ...DEFAULT_VISIBLE_COLS });
    setColWidths({ ...DEFAULT_COL_WIDTHS });
    setColumnOrder([...DEFAULT_COLUMN_ORDER]);
    safeRemoveItem(AUDIFY_STORAGE_KEYS.visibleColumnsV2);
    safeRemoveItem(AUDIFY_STORAGE_KEYS.columnWidthsV3);
    safeRemoveItem(AUDIFY_STORAGE_KEYS.columnOrderV2);
  }, []);

  const columnsContentWidth = useMemo(
    () =>
      computeColumnsContentWidth(
        columnOrder,
        visibleCols,
        colWidths,
        isSimilarityMode
      ),
    [columnOrder, visibleCols, colWidths, isSimilarityMode]
  );

  // Body rows include a trailing 28px spacer matching the pinned header column picker
  const totalTableWidth = columnsContentWidth + 28;

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el || showSlicesTable || sampleCount === 0) {
      setVerticalScrollbarWidth(0);
      return;
    }
    const syncMetrics = () => {
      const sbWidth = Math.max(0, el.offsetWidth - el.clientWidth);
      setVerticalScrollbarWidth((prev) => (prev === sbWidth ? prev : sbWidth));
      if (headerRef.current) {
        headerRef.current.scrollLeft = el.scrollLeft;
      }
    };
    syncMetrics();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncMetrics);
    ro.observe(el);
    return () => ro.disconnect();
  }, [parentRef, headerRef, sampleCount, showSlicesTable, columnsContentWidth]);

  return {
    visibleCols,
    columnOrder,
    setColumnOrder,
    colWidths,
    setColWidths,
    toggleVisibleCol,
    resetTableLayout,
    columnsContentWidth,
    totalTableWidth,
    verticalScrollbarWidth,
  };
}
