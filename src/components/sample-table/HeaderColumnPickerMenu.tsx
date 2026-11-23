import React from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { COLUMN_LAYOUT_PRESETS, VisibleColumnsState } from "./tableLayout";

const PICKER_COLUMNS: readonly {
  key: keyof VisibleColumnsState;
  label: string;
}[] = [
  { key: "class", label: "Class" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
  { key: "bpm", label: "BPM" },
  { key: "key", label: "Key / Camelot" },
  { key: "tags", label: "Tags" },
  { key: "time", label: "Time" },
  { key: "format", label: "Format / SR" },
  { key: "dateModified", label: "Date Modified" },
  { key: "dateAdded", label: "Date Added" },
];

interface HeaderColumnPickerMenuProps {
  menuPos: { top: number; right: number };
  visibleCols: VisibleColumnsState;
  toggleVisibleCol: (key: keyof VisibleColumnsState) => void;
  applyVisibleColsPreset?: (cols: VisibleColumnsState) => void;
  resetTableLayout: () => void;
}

export const HeaderColumnPickerMenu: React.FC<HeaderColumnPickerMenuProps> = ({
  menuPos,
  visibleCols,
  toggleVisibleCol,
  applyVisibleColsPreset,
  resetTableLayout,
}) => {
  const menu = (
    <div
      data-context-menu-portal="true"
      data-popover-portal="true"
      data-mica-overlay="true"
      style={{
        position: "fixed",
        top: `${menuPos.top}px`,
        right: `${menuPos.right}px`,
        zIndex: Z_INDEX.floatingMenu,
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-[196px] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md p-2 shadow-2xl space-y-1.5 text-[11px] font-sans normal-case tracking-normal font-normal text-fg"
    >
      <div className="flex items-center justify-between border-b border-line pb-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-accent-fg font-semibold">
          TABLE COLUMNS
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            resetTableLayout();
          }}
          className="font-mono text-[9px] text-fg-3 hover:text-accent-fg transition-colors"
          title="Reset column visibility, order and widths to default"
        >
          Reset Layout
        </button>
      </div>
      {applyVisibleColsPreset && (
        <div className="grid grid-cols-3 gap-1 pb-1 border-b border-line">
          {COLUMN_LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.title}
              onClick={(e) => {
                e.stopPropagation();
                applyVisibleColsPreset(preset.cols);
              }}
              className="h-[22px] px-1 rounded-xs bg-surface-3 hover:bg-accent-soft hover:text-accent-fg border border-line hover:border-accent text-[9.5px] font-mono font-medium text-fg-2 transition-colors truncate"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-0.5">
        {PICKER_COLUMNS.map((col) => {
          const enabled = visibleCols[col.key];
          return (
            <button
              key={col.key}
              type="button"
              onClick={() => toggleVisibleCol(col.key)}
              className={`w-full h-[24px] px-2 rounded-xs flex items-center justify-between text-left transition-colors ${
                enabled
                  ? "bg-accent-soft text-fg font-medium"
                  : "text-fg-3 hover:text-fg hover:bg-surface-3"
              }`}
            >
              <span className="truncate">{col.label}</span>
              <span
                className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center shrink-0 ${
                  enabled
                    ? "bg-accent border-accent text-accent-on"
                    : "border-line-strong bg-surface-3"
                }`}
              >
                {enabled && <Check className="w-2.5 h-2.5" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(menu, document.body)
    : menu;
};
