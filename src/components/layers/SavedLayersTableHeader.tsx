import React from "react";
import { Star } from "lucide-react";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import type { LayerSortKey, SortDir } from "../../types";
import { safeGetItem } from "../../utils/localStorageSafe";
import { ColumnSortLabel } from "../sample-table/ColumnSortLabel";
import { FIXED_WAVEFORM_WIDTH } from "../sample-table/tableLayout";
import type { LayerColWidths } from "./SavedLayersTableRow";

export const DEFAULT_LAYER_COL_WIDTHS: LayerColWidths = {
  name: 260,
  structure: 148,
  updated: 116,
};

export const LAYER_COL_BOUNDS: Record<
  keyof LayerColWidths,
  { min: number; max: number }
> = {
  name: { min: 150, max: 600 },
  structure: { min: 100, max: 280 },
  updated: { min: 86, max: 220 },
};

export function loadLayerColWidths(): LayerColWidths {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.layerColumnWidthsV1);
    if (!raw) return { ...DEFAULT_LAYER_COL_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<LayerColWidths>;
    const clamp = (k: keyof LayerColWidths) => {
      const v = parsed[k];
      const b = LAYER_COL_BOUNDS[k];
      return typeof v === "number" && Number.isFinite(v)
        ? Math.max(b.min, Math.min(b.max, Math.round(v)))
        : DEFAULT_LAYER_COL_WIDTHS[k];
    };
    return {
      name: clamp("name"),
      structure: clamp("structure"),
      updated: clamp("updated"),
    };
  } catch {
    return { ...DEFAULT_LAYER_COL_WIDTHS };
  }
}

interface SavedLayersTableHeaderProps {
  colWidths: LayerColWidths;
  layerSortKey: LayerSortKey | null;
  layerSortDir: SortDir;
  onCycleSort: (key: LayerSortKey) => void;
  onStartColResize: (
    colKey: keyof LayerColWidths,
    e: React.MouseEvent
  ) => void;
}

/**
 * Sticky frosted table header matching `SampleTableHeader` & `SlicesTableView` 1:1.
 */
export const SavedLayersTableHeader: React.FC<SavedLayersTableHeaderProps> = ({
  colWidths,
  layerSortKey,
  layerSortDir,
  onCycleSort,
  onStartColResize,
}) => (
  <div className="h-[26px] sticky top-0 z-20 bg-surface-header audify-frosted-bar border-b border-line border-l-2 border-l-transparent flex items-center text-[10px] font-semibold uppercase tracking-wider text-fg-head shrink-0 select-none">
    <button
      type="button"
      onClick={() => onCycleSort("fav")}
      className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line hover:text-fg transition-colors cursor-pointer ${
        layerSortKey === "fav" ? "text-accent-fg" : ""
      }`}
      title="Sort by Favorite Layers"
      aria-label="Sort by Favorite Layers"
    >
      <Star className="w-3.5 h-3.5" />
    </button>

    <div
      style={{ width: `${colWidths.name}px` }}
      onClick={(e) => {
        if ((e.target as HTMLElement).dataset.colResize) return;
        onCycleSort("name");
      }}
      className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
        layerSortKey === "name" ? "text-accent-fg" : ""
      }`}
    >
      <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
        <ColumnSortLabel
          label="LAYER NAME"
          active={layerSortKey === "name"}
          sortDir={layerSortDir}
        />
      </div>
      <div
        data-col-resize="true"
        onMouseDown={(e) => onStartColResize("name", e)}
        className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
      />
    </div>

    <div
      style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
      className="h-full px-1 flex items-center justify-center shrink-0 border-r border-line"
    >
      WAVEFORM
    </div>

    <div
      style={{ width: `${colWidths.structure}px` }}
      onClick={(e) => {
        if ((e.target as HTMLElement).dataset.colResize) return;
        onCycleSort("lanes");
      }}
      className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
        layerSortKey === "lanes" ? "text-accent-fg" : ""
      }`}
    >
      <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
        <ColumnSortLabel
          label="STRUCTURE"
          active={layerSortKey === "lanes"}
          sortDir={layerSortDir}
        />
      </div>
      <div
        data-col-resize="true"
        onMouseDown={(e) => onStartColResize("structure", e)}
        className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
      />
    </div>

    <button
      type="button"
      onClick={() => onCycleSort("duration")}
      className={`group/hdr w-[78px] h-full px-1 flex items-center justify-center shrink-0 border-r border-line cursor-pointer ${
        layerSortKey === "duration" ? "text-accent-fg" : ""
      }`}
    >
      <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1 hover:bg-surface-3 hover:text-fg transition-colors">
        <ColumnSortLabel
          label="TIME"
          active={layerSortKey === "duration"}
          sortDir={layerSortDir}
        />
      </div>
    </button>

    <div className="w-[84px] h-full px-1 flex items-center justify-center shrink-0 border-r border-line">
      FMT/SR
    </div>

    <div
      style={{ width: `${colWidths.updated}px` }}
      onClick={(e) => {
        if ((e.target as HTMLElement).dataset.colResize) return;
        onCycleSort("updated");
      }}
      className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 cursor-pointer ${
        layerSortKey === "updated" ? "text-accent-fg" : ""
      }`}
    >
      <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
        <ColumnSortLabel
          label="UPDATED"
          active={layerSortKey === "updated"}
          sortDir={layerSortDir}
        />
      </div>
      <div
        data-col-resize="true"
        onMouseDown={(e) => onStartColResize("updated", e)}
        className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
      />
    </div>
  </div>
);
