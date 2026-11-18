import React, { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

function isPointInsideRect(
  el: HTMLElement | null,
  clientX: number,
  clientY: number
): boolean {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

interface WaveformSimilarityDropOverlayProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Sononym-style similarity drop zone overlay rendered on the top waveform deck
 * whenever the user drags a track within Audify. Dropping triggers similarity search.
 */
export const WaveformSimilarityDropOverlay: React.FC<
  WaveformSimilarityDropOverlayProps
> = React.memo(({ panelRef }) => {
  const inAppDragSample = useSampleStore((s) => s.inAppDragSample);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = Boolean(inAppDragSample && !inAppDragSample.is_trashed);

  useEffect(() => {
    if (!isActive) {
      setIsHovered(false);
      return;
    }

    const commitSimilarityDrop = () => {
      const state = useSampleStore.getState();
      const dragged = state.inAppDragSample;
      if (!dragged || dragged.is_trashed) return;

      // Clear synchronously before async search so DOM drop + mouseup cannot fire twice
      state.setInAppDragSample(null);
      setIsHovered(false);
      if (state.selectedSample?.id !== dragged.id) {
        state.selectSample(dragged, false);
      }
      void state.findSimilarSamples(dragged);
    };

    const onDragOver = (e: DragEvent) => {
      if (isPointInsideRect(panelRef.current, e.clientX, e.clientY)) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
        setIsHovered(true);
      } else {
        setIsHovered(false);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      setIsHovered(isPointInsideRect(panelRef.current, e.clientX, e.clientY));
    };

    const onDrop = (e: DragEvent) => {
      if (isPointInsideRect(panelRef.current, e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        commitSimilarityDrop();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isPointInsideRect(panelRef.current, e.clientX, e.clientY)) {
        commitSimilarityDrop();
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [isActive, panelRef]);

  if (!isActive || !inAppDragSample) return null;

  if (!isHovered) {
    return (
      <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xs border border-dashed border-accent bg-surface-soft select-none">
        <div className="flex items-center gap-2 px-3 py-1 rounded-xs bg-surface-2 border border-line text-[11px] font-mono text-fg-2 shadow-xs">
          <AudioLines className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          <span>Drop on waveform to search by similarity</span>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="audify-drop-overlay-backdrop pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xs border-2 border-dashed border-accent select-none"
    >
      <div className="flex items-center gap-3 px-4 py-2 rounded-sm bg-surface-2 border border-line-strong shadow-lg max-w-[92%]">
        <div className="w-8 h-8 rounded-full bg-accent-soft border border-accent flex items-center justify-center text-accent-fg shrink-0">
          <AudioLines className="w-4 h-4 stroke-[2]" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-fg leading-tight">
            Release here to search by similarity
          </span>
          <span className="text-[10.5px] font-mono text-accent-fg truncate max-w-[340px]">
            {inAppDragSample.file_name}
          </span>
        </div>
      </div>
    </div>
  );
});
