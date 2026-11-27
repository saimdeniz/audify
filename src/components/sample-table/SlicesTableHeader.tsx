import React from "react";
import { Star } from "lucide-react";
import type { SliceSortKey, SortDir } from "../../types";
import { ColumnSortLabel } from "./ColumnSortLabel";
import type { SliceColWidths } from "./SliceTableRow";
import { FIXED_WAVEFORM_WIDTH } from "./tableLayout";

interface SlicesTableHeaderProps {
  colWidths: SliceColWidths;
  sliceSortKey: SliceSortKey | null;
  sliceSortDir: SortDir;
  onCycleSort: (key: SliceSortKey) => void;
  onStartColResize: (colKey: keyof SliceColWidths, e: React.MouseEvent) => void;
}

export const SlicesTableHeader: React.FC<SlicesTableHeaderProps> = React.memo(
  ({
    colWidths,
    sliceSortKey,
    sliceSortDir,
    onCycleSort,
    onStartColResize,
  }) => (
    <div className="h-[26px] sticky top-0 z-20 bg-surface-header audify-frosted-bar border-b border-line border-l-2 border-l-transparent flex items-center text-[10px] font-semibold uppercase tracking-wider text-fg-head shrink-0 select-none">
      {/* 1. Fav (34px) */}
      <button
        type="button"
        onClick={() => onCycleSort("fav")}
        className={`w-[34px] h-full flex items-center justify-center shrink-0 border-r border-line hover:text-fg transition-colors cursor-pointer ${
          sliceSortKey === "fav" ? "text-accent-fg" : ""
        }`}
        title="Sort by Favorite Slices"
      >
        <Star className="w-3.5 h-3.5" />
      </button>

      {/* 2. Slice Name (Resizable) */}
      <div
        style={{ width: `${colWidths.name}px` }}
        onClick={(e) => {
          if ((e.target as HTMLElement).dataset.colResize) return;
          onCycleSort("name");
        }}
        className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
          sliceSortKey === "name" ? "text-accent-fg" : ""
        }`}
        title="Slice Name"
      >
        <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
          <ColumnSortLabel
            label="SLICE NAME"
            active={sliceSortKey === "name"}
            sortDir={sliceSortDir}
          />
        </div>
        <div
          data-col-resize="true"
          onMouseDown={(e) => onStartColResize("name", e)}
          className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
          title="Drag to resize Slice Name column"
        />
      </div>

      {/* 3. Waveform (Fixed 220px) */}
      <div
        style={{ width: `${FIXED_WAVEFORM_WIDTH}px` }}
        className="h-full px-1 flex items-center justify-center shrink-0 border-r border-line"
        title="Waveform"
      >
        <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5">
          WAVEFORM
        </div>
      </div>

      {/* 4. Source Track (Resizable) */}
      <div
        style={{ width: `${colWidths.source}px` }}
        onClick={(e) => {
          if ((e.target as HTMLElement).dataset.colResize) return;
          onCycleSort("source");
        }}
        className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
          sliceSortKey === "source" ? "text-accent-fg" : ""
        }`}
        title="Source Track (Click ↗ on row to jump back)"
      >
        <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
          <ColumnSortLabel
            label="SOURCE TRACK"
            active={sliceSortKey === "source"}
            sortDir={sliceSortDir}
          />
        </div>
        <div
          data-col-resize="true"
          onMouseDown={(e) => onStartColResize("source", e)}
          className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
          title="Drag to resize Source Track column"
        />
      </div>

      {/* 5. Range / FX (Resizable) */}
      <div
        style={{ width: `${colWidths.range}px` }}
        className="relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line"
        title="Slice Range & FX"
      >
        <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 min-w-0">
          <span className="truncate">RANGE / FX</span>
        </div>
        <div
          data-col-resize="true"
          onMouseDown={(e) => onStartColResize("range", e)}
          className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
          title="Drag to resize Range / FX column"
        />
      </div>

      {/* 6. Time (Fixed 78px) */}
      <div
        style={{ width: "78px" }}
        onClick={() => onCycleSort("duration")}
        className={`group/hdr h-full px-1 flex items-center justify-center shrink-0 border-r border-line cursor-pointer ${
          sliceSortKey === "duration" ? "text-accent-fg" : ""
        }`}
        title="Duration"
      >
        <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
          <ColumnSortLabel
            label="TIME"
            active={sliceSortKey === "duration"}
            sortDir={sliceSortDir}
          />
        </div>
      </div>

      {/* 7. FMT/SR (Fixed 84px, Sortable) */}
      <div
        style={{ width: "84px" }}
        onClick={() => onCycleSort("format")}
        className={`group/hdr h-full px-1 flex items-center justify-center shrink-0 border-r border-line cursor-pointer ${
          sliceSortKey === "format" ? "text-accent-fg" : ""
        }`}
        title="Format / Sample Rate"
      >
        <div className="h-[22px] w-full flex items-center justify-center rounded-[4px] px-0.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
          <ColumnSortLabel
            label="FMT/SR"
            active={sliceSortKey === "format"}
            sortDir={sliceSortDir}
          />
        </div>
      </div>

      {/* 8. Added (Resizable, Sortable) */}
      <div
        style={{ width: `${colWidths.dateAdded}px` }}
        onClick={(e) => {
          if ((e.target as HTMLElement).dataset.colResize) return;
          onCycleSort("created");
        }}
        className={`group/hdr relative h-full px-1 flex items-center justify-center min-w-0 shrink-0 border-r border-line cursor-pointer ${
          sliceSortKey === "created" ? "text-accent-fg" : ""
        }`}
        title="Created Date"
      >
        <div className="h-[22px] w-full max-w-full flex items-center justify-center rounded-[4px] px-1.5 hover:bg-surface-3 hover:text-fg transition-colors min-w-0">
          <ColumnSortLabel
            label="ADDED"
            active={sliceSortKey === "created"}
            sortDir={sliceSortDir}
          />
        </div>
        <div
          data-col-resize="true"
          onMouseDown={(e) => onStartColResize("dateAdded", e)}
          className="absolute right-[-3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-accent/60 z-10 transition-colors"
          title="Drag to resize Added column"
        />
      </div>
    </div>
  )
);
