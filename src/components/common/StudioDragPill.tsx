import React from "react";
import { createPortal } from "react-dom";
import { Folder } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import type { StudioPointerDragState } from "../../hooks/useStudioPointerDrag";

interface StudioDragPillProps<T> {
  dragState: StudioPointerDragState<T> | null;
  iconKind?: "swatch" | "folder";
}

export function StudioDragPill<T>({
  dragState,
  iconKind = "swatch",
}: StudioDragPillProps<T>): React.ReactPortal | null {
  if (!dragState || typeof document === "undefined") return null;

  const maxLeft =
    typeof window !== "undefined" ? Math.max(8, window.innerWidth - 260) : 600;
  const maxTop =
    typeof window !== "undefined" ? Math.max(8, window.innerHeight - 36) : 400;
  const left = Math.min(dragState.clientX + 14, maxLeft);
  const top = Math.min(dragState.clientY + 12, maxTop);

  return createPortal(
    <div
      style={{
        left: `${left}px`,
        top: `${top}px`,
        zIndex: Z_INDEX.floatingMenu + 20,
      }}
      className="fixed pointer-events-none select-none max-w-[260px] px-2 py-1 rounded-[3px] bg-surface-2 border border-accent shadow-2xl flex items-center gap-1.5 text-[10.5px] font-mono text-fg audify-overlay-surface"
    >
      {iconKind === "folder" ? (
        <Folder className="w-3 h-3 text-accent-fg shrink-0" />
      ) : dragState.visual.prefixSymbol ? (
        <span className="text-fg-3 shrink-0">
          {dragState.visual.prefixSymbol}
        </span>
      ) : dragState.visual.swatchColor ? (
        <span
          className="w-2.5 h-2.5 rounded-[2px] shrink-0"
          style={{ backgroundColor: dragState.visual.swatchColor }}
        />
      ) : null}

      <span className="font-semibold truncate">{dragState.visual.label}</span>

      {dragState.dropHint && (
        <span className="text-[9.5px] text-accent-fg font-semibold truncate shrink-0">
          {dragState.dropHint}
        </span>
      )}
    </div>,
    document.body
  );
}
