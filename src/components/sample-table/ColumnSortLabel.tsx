import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "../../types";

interface SortArrowIconProps {
  active: boolean;
  sortDir: SortDir;
}

/**
 * Fixed-footprint sort direction indicator shared by SampleTableHeader and SlicesTableView.
 * Reserves a constant 10x10px slot (`opacity-0` when idle, revealed on header hover) so
 * neither hovering nor cycling sort direction shifts column header labels.
 */
export const SortArrowIcon: React.FC<SortArrowIconProps> = ({
  active,
  sortDir,
}) => {
  if (!active) {
    return (
      <ArrowUpDown
        aria-hidden="true"
        data-sort-indicator="idle"
        className="w-2.5 h-2.5 text-fg-3 opacity-0 group-hover/hdr:opacity-75 transition-opacity shrink-0"
      />
    );
  }
  return sortDir === "asc" ? (
    <ArrowUp
      aria-hidden="true"
      data-sort-indicator="asc"
      className="w-2.5 h-2.5 text-accent-fg shrink-0"
    />
  ) : (
    <ArrowDown
      aria-hidden="true"
      data-sort-indicator="desc"
      className="w-2.5 h-2.5 text-accent-fg shrink-0"
    />
  );
};

interface ColumnSortLabelProps {
  label: string;
  active: boolean;
  sortDir: SortDir;
}

/**
 * Renders a sortable column title alongside its `SortArrowIcon` inside a symmetric
 * 3-track grid so every column title stays dead-center without layout jump across hover/sort.
 */
export const ColumnSortLabel: React.FC<ColumnSortLabelProps> = ({
  label,
  active,
  sortDir,
}) => (
  <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center w-full min-w-0">
    <span aria-hidden="true" />
    <span className="truncate">{label}</span>
    <span className="justify-self-start pl-1 flex items-center shrink-0">
      <SortArrowIcon active={active} sortDir={sortDir} />
    </span>
  </span>
);
