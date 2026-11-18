import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface WindowCaptionControlsProps {
  /** Whether to show the Minimize caption button (default true). */
  showMinimize?: boolean;
  /** Whether to show the Maximize / Restore caption button (default true). */
  showMaximize?: boolean;
  /** Optional controlled maximized state; syncs automatically with Tauri when omitted. */
  isMaximized?: boolean;
  /** Narrower caption widths for compact docks such as Mini Dock. */
  compact?: boolean;
  /** Tooltip / aria-label for the Close button. */
  closeTitle?: string;
  /** Omit left divider when adjacent header controls already provide their own border. */
  showDivider?: boolean;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

/**
 * Unified Windows 11-style frameless window caption controls shared across the
 * Main Studio bar, standalone/modal Settings header, and Mini Dock.
 */
export const WindowCaptionControls: React.FC<WindowCaptionControlsProps> =
  React.memo(
    ({
      showMinimize = true,
      showMaximize = true,
      isMaximized: controlledMaximized,
      compact = false,
      closeTitle = "Close",
      showDivider = true,
      onMinimize,
      onToggleMaximize,
      onClose,
    }) => {
      const [internalMaximized, setInternalMaximized] = useState(false);
      const isControlled = controlledMaximized !== undefined;
      const maximized = isControlled ? controlledMaximized : internalMaximized;

      useEffect(() => {
        if (!showMaximize || isControlled) return;
        let active = true;
        const syncMaximized = async () => {
          try {
            const state = await getCurrentWindow().isMaximized();
            if (active) setInternalMaximized(state);
          } catch {
            // Ignore in browser preview
          }
        };
        void syncMaximized();
        window.addEventListener("resize", syncMaximized);
        return () => {
          active = false;
          window.removeEventListener("resize", syncMaximized);
        };
      }, [showMaximize, isControlled]);

      const handleMinimize = () => {
        if (onMinimize) {
          onMinimize();
          return;
        }
        try {
          void getCurrentWindow()
            .minimize()
            .catch(() => {});
        } catch {
          // Ignore in browser preview
        }
      };

      const handleToggleMaximize = () => {
        if (onToggleMaximize) {
          onToggleMaximize();
          return;
        }
        try {
          const win = getCurrentWindow();
          void win
            .toggleMaximize()
            .then(() => win.isMaximized())
            .then((maxState) => setInternalMaximized(maxState))
            .catch(() => {});
        } catch {
          // Ignore in browser preview
        }
      };

      const handleClose = () => {
        if (onClose) {
          onClose();
          return;
        }
        try {
          void getCurrentWindow()
            .close()
            .catch(() => {});
        } catch {
          // Ignore in browser preview
        }
      };

      const btnW = compact ? "w-[30px]" : "w-[34px]";
      const closeW = compact ? "w-[32px]" : "w-[38px]";
      const baseBtn =
        "h-full flex items-center justify-center text-fg transition-colors focus:outline-none";

      return (
        <div
          data-no-drag="true"
          data-tooltip-delay="1500"
          data-tooltip-align="center"
          className={`flex items-center h-full shrink-0 ${
            showDivider ? "border-l border-line" : ""
          }`}
        >
          {showMinimize && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleMinimize}
              aria-label="Minimize"
              title="Minimize"
              data-tooltip-delay="1500"
              data-tooltip-align="center"
              className={`${btnW} ${baseBtn} hover:bg-surface-3`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 11 11"
                fill="none"
                aria-hidden="true"
                shapeRendering="crispEdges"
              >
                <line
                  x1="1"
                  y1="5.5"
                  x2="10"
                  y2="5.5"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            </button>
          )}

          {showMaximize && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleToggleMaximize}
              aria-label={maximized ? "Restore" : "Maximize"}
              title={maximized ? "Restore" : "Maximize"}
              data-tooltip-delay="1500"
              data-tooltip-align="center"
              className={`${btnW} ${baseBtn} hover:bg-surface-3`}
            >
              {maximized ? (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  fill="none"
                  aria-hidden="true"
                  shapeRendering="crispEdges"
                >
                  <path
                    d="M3.5 3.5V1.5H9.5V7.5H7.5"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                  <rect
                    x="1.5"
                    y="3.5"
                    width="6"
                    height="6"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
              ) : (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  fill="none"
                  aria-hidden="true"
                  shapeRendering="crispEdges"
                >
                  <rect
                    x="1.5"
                    y="1.5"
                    width="8"
                    height="8"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
              )}
            </button>
          )}

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClose}
            aria-label={closeTitle}
            title={closeTitle}
            data-tooltip-delay="1500"
            data-tooltip-align="center"
            className={`${closeW} ${baseBtn} hover:bg-danger hover:text-white`}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              aria-hidden="true"
            >
              <line
                x1="1.75"
                y1="1.75"
                x2="9.25"
                y2="9.25"
                stroke="currentColor"
                strokeWidth="1.05"
                strokeLinecap="round"
              />
              <line
                x1="9.25"
                y1="1.75"
                x2="1.75"
                y2="9.25"
                stroke="currentColor"
                strokeWidth="1.05"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      );
    }
  );
