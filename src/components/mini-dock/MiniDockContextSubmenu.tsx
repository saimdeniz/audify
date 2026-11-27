import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Plus } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import type { Collection, SampleItem } from "../../types";
import { MenuItem } from "../common/MenuItem";
import {
  RenameHistoryList,
  SampleRenameHistoryItem,
} from "../common/RenameHistoryList";
import { TaxonomyPicker } from "../taxonomy/TaxonomyPicker";

export type MiniDockSubmenuKind =
  | "layers"
  | "collection"
  | "tag"
  | "genre"
  | "renameHistory";

export interface MiniDockSubmenuAnchor {
  kind: MiniDockSubmenuKind;
  menuRect: { left: number; right: number; top: number; bottom: number };
  rowTop: number;
}

interface MiniDockContextSubmenuProps {
  anchor: MiniDockSubmenuAnchor;
  sample: SampleItem;
  targetIds: number[];
  samples: SampleItem[];
  manualCollections: Collection[];
  renameHistoryItems?: SampleRenameHistoryItem[];
  onCloseAll: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onAddToLayer: (mode: "current" | "new") => void;
  onAddToCollection: (collectionId: number) => void;
}

/**
 * Floating portal flyout submenu for Mini Dock's right-click menu.
 * Mirrors Main View's `SampleContextMenu` side-flyout design and automatically flips
 * left/right (or cascades cleanly inward on ultra-narrow dock widths) without clipping.
 */
export const MiniDockContextSubmenu: React.FC<MiniDockContextSubmenuProps> = ({
  anchor,
  sample,
  targetIds,
  samples,
  manualCollections,
  renameHistoryItems,
  onCloseAll,
  onMouseEnter,
  onMouseLeave,
  onAddToLayer,
  onAddToCollection,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const subWidth =
    anchor.kind === "tag" ||
    anchor.kind === "genre" ||
    anchor.kind === "renameHistory"
      ? 238
      : 206;

  const computeInitialPos = () => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 480;
    const vh = typeof window !== "undefined" ? window.innerHeight : 640;
    const margin = 6;
    let x = anchor.menuRect.right + 2;
    if (x + subWidth + margin > vw) {
      const leftTry = anchor.menuRect.left - subWidth - 2;
      if (leftTry >= margin) {
        x = leftTry;
      } else {
        // Ultra-narrow dock: cleanly offset cascade overlapping menu edge while staying inside viewport
        x = Math.max(margin, vw - subWidth - margin);
      }
    }
    const y = Math.max(margin, Math.min(anchor.rowTop - 4, vh - 220));
    return { x, y };
  };

  const [pos, setPos] = useState(computeInitialPos);

  useLayoutEffect(() => {
    const el = panelRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 6;
    const actualW = el?.offsetWidth || subWidth;
    const actualH = el?.offsetHeight || 180;

    let x = anchor.menuRect.right + 2;
    if (x + actualW + margin > vw) {
      const leftTry = anchor.menuRect.left - actualW - 2;
      x =
        leftTry >= margin
          ? leftTry
          : Math.max(margin, vw - actualW - margin);
    }
    const y = Math.max(
      margin,
      Math.min(anchor.rowTop - 4, vh - actualH - margin)
    );
    setPos({ x, y });
  }, [anchor, subWidth]);

  const targetSamples =
    targetIds.length > 1
      ? samples.filter((s) => targetIds.includes(s.id))
      : [samples.find((s) => s.id === sample.id) ?? sample];

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      data-context-menu-portal="true"
      data-mica-overlay="true"
      style={{
        top: pos.y,
        left: pos.x,
        width: subWidth,
        zIndex: Z_INDEX.floatingMenu + 2,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed max-h-[72vh] overflow-y-auto bg-surface-2 border border-line-strong rounded-md py-1 text-[11px] text-fg shadow-2xl"
    >
      {anchor.kind === "layers" && (
        <>
          <MenuItem
            tone="accent"
            compactHeight
            icon={<Layers className="w-3.5 h-3.5 text-accent-fg" />}
            label="Add to Current Layer"
            onClick={() => onAddToLayer("current")}
          />
          <MenuItem
            tone="accent"
            compactHeight
            icon={<Plus className="w-3.5 h-3.5 text-accent-fg" />}
            label="Create New Layer"
            onClick={() => onAddToLayer("new")}
          />
        </>
      )}

      {anchor.kind === "collection" && (
        <div className="max-h-[240px] overflow-y-auto">
          {manualCollections.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => onAddToCollection(col.id)}
              className="w-full h-[25px] px-2.5 flex items-center gap-2 text-left text-[11px] text-fg hover:bg-accent-soft hover:text-accent-fg transition-colors truncate cursor-pointer"
            >
              <span
                className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                style={{
                  backgroundColor: col.color || "var(--signal-accent)",
                }}
              />
              <span className="truncate">{col.name}</span>
            </button>
          ))}
        </div>
      )}

      {anchor.kind === "tag" && (
        <div className="p-1.5">
          <TaxonomyPicker
            mode="tags"
            compact
            allowCreate={false}
            sampleIds={targetIds}
            samples={targetSamples}
          />
        </div>
      )}

      {anchor.kind === "genre" && (
        <div className="p-1.5">
          <TaxonomyPicker
            mode="genres"
            compact
            allowCreate={false}
            sampleIds={targetIds}
            samples={targetSamples}
          />
        </div>
      )}

      {anchor.kind === "renameHistory" && (
        <RenameHistoryList
          sampleId={sample.id}
          fallbackPrevName={sample.previous_file_name}
          preloadedItems={renameHistoryItems}
          onRestored={onCloseAll}
        />
      )}
    </div>,
    document.body
  );
};
