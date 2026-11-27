import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Maximize2,
  PanelLeftClose,
  PanelRightClose,
  Pin,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { beginWindowTitlebarDrag } from "../../utils/drag";
import { AudifyLogoIcon } from "../StatusBar";
import { NavHistoryButtons } from "../common/NavHistoryButtons";
import { WindowCaptionControls } from "../WindowCaptionControls";

export const MiniDockHeader: React.FC = () => {
  const isMiniDockPinned = useSampleStore((s) => s.isMiniDockPinned);
  const miniDockEdgePeek = useSampleStore((s) => s.miniDockEdgePeek);
  const miniDockEdgeSide = useSampleStore((s) => s.miniDockEdgeSide);
  const miniDockShortcut = useSampleStore((s) => s.shortcuts.toggleMiniDock);
  const toggleMiniDock = useSampleStore((s) => s.toggleMiniDock);
  const setMiniDockPinned = useSampleStore((s) => s.setMiniDockPinned);
  const setMiniDockEdgePeek = useSampleStore((s) => s.setMiniDockEdgePeek);
  const setMiniDockEdgeSide = useSampleStore((s) => s.setMiniDockEdgeSide);
  const setStatusMessage = useSampleStore((s) => s.setStatusMessage);

  const handleTitlebarMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.detail !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-no-drag]")) return;
    beginWindowTitlebarDrag(e.clientX, e.clientY, () => {
      try {
        void getCurrentWindow().startDragging();
      } catch {
        // Ignore in browser preview
      }
    });
  };

  const handleTitlebarDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-no-drag]")) return;
    void toggleMiniDock();
  };

  return (
    <header
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
      className="h-[32px] bg-surface-1 border-b border-line pl-2.5 pr-0 flex items-center justify-between shrink-0 cursor-default"
    >
      <div className="flex items-center space-x-2 min-w-0">
        <div className="flex items-center space-x-2 pointer-events-none shrink-0">
          <AudifyLogoIcon className="w-[18px] h-[18px]" />
          <span className="text-[12px] font-semibold tracking-wide text-fg">
            Audify
          </span>
          <span className="px-1.5 py-0.2 bg-accent-soft border border-accent/50 text-accent-fg font-mono text-[9px] font-bold rounded-xs uppercase">
            DOCK
          </span>
        </div>
        <NavHistoryButtons />
      </div>

      <div data-no-drag="true" className="flex items-center h-full shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const next = !miniDockEdgePeek;
            setMiniDockEdgePeek(next);
            if (next && !isMiniDockPinned) {
              void setMiniDockPinned(true);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextSide = miniDockEdgeSide === "right" ? "left" : "right";
            setMiniDockEdgeSide(nextSide);
            setStatusMessage(
              `Mini Dock Edge-Peek aligned to ${
                nextSide === "right" ? "Right" : "Left"
              } screen edge`
            );
          }}
          aria-pressed={miniDockEdgePeek}
          aria-label={
            miniDockEdgePeek
              ? `Edge-Peek auto-hide active (${miniDockEdgeSide} edge)`
              : `Enable Edge-Peek auto-hide (${miniDockEdgeSide} edge)`
          }
          title={
            miniDockEdgePeek
              ? `Edge-Peek ON (${
                  miniDockEdgeSide === "right" ? "Right" : "Left"
                } edge) — Click to disable, Right-click to switch side`
              : `Enable Edge-Peek auto-hide (${
                  miniDockEdgeSide === "right" ? "Right" : "Left"
                } edge) — Right-click to switch side`
          }
          className={`w-[30px] h-full flex items-center justify-center transition-colors ${
            miniDockEdgePeek
              ? "text-accent-fg bg-accent-soft"
              : "text-fg-2 hover:text-fg hover:bg-surface-3"
          }`}
        >
          {miniDockEdgeSide === "left" ? (
            <PanelLeftClose className="w-3.5 h-3.5" />
          ) : (
            <PanelRightClose className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void setMiniDockPinned(!isMiniDockPinned)}
          aria-label={
            isMiniDockPinned
              ? "Pinned Always-on-Top (Click to unpin)"
              : "Unpinned (Click to keep Always-on-Top over NLE)"
          }
          title={
            isMiniDockPinned
              ? "Pinned Always-on-Top (Click to unpin)"
              : "Unpinned (Click to keep Always-on-Top over NLE)"
          }
          className={`w-[30px] h-full flex items-center justify-center transition-colors ${
            isMiniDockPinned
              ? "text-accent-fg bg-accent-soft"
              : "text-fg-2 hover:text-fg hover:bg-surface-3"
          }`}
        >
          <Pin
            className={`w-3.5 h-3.5 ${isMiniDockPinned ? "fill-current" : ""}`}
          />
        </button>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void toggleMiniDock()}
          aria-label={`Expand to Full Studio (${miniDockShortcut || "Ctrl+M"})`}
          title={`Expand to Full Studio (${miniDockShortcut || "Ctrl+M"})`}
          className="w-[30px] h-full flex items-center justify-center text-fg-2 hover:text-accent-fg hover:bg-surface-3 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <WindowCaptionControls
          showMaximize={false}
          compact={true}
          closeTitle="Close Audify"
        />
      </div>
    </header>
  );
};
