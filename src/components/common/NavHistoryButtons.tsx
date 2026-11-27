import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigationHistoryFlags } from "../../hooks/useNavigationHistory";
import {
  navigateHistoryBack,
  navigateHistoryForward,
} from "../../store/navigationHistory";

/**
 * Shared Back (`←`) and Forward (`→`) navigation buttons used in both
 * `TopHeaderBar` (Main View) and `MiniDockHeader` (Mini Dock).
 */
export const NavHistoryButtons: React.FC = React.memo(() => {
  const { canGoBack, canGoForward } = useNavigationHistoryFlags();

  return (
    <div
      data-no-drag="true"
      className="flex items-center space-x-1 shrink-0"
      role="group"
      aria-label="View navigation history"
    >
      <button
        type="button"
        data-no-drag="true"
        disabled={!canGoBack}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => navigateHistoryBack()}
        aria-label="Navigate back (Alt+Left / Mouse4)"
        title="Back (Alt+← / Mouse 4)"
        className={`w-[22px] h-[22px] rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
          canGoBack
            ? "bg-surface-3 border-line text-fg-2 hover:text-accent-fg hover:border-accent hover:bg-accent-soft cursor-pointer"
            : "bg-surface-2 border-line text-fg-3 opacity-35 cursor-default"
        }`}
      >
        <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
      </button>
      <button
        type="button"
        data-no-drag="true"
        disabled={!canGoForward}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => navigateHistoryForward()}
        aria-label="Navigate forward (Alt+Right / Mouse5)"
        title="Forward (Alt+→ / Mouse 5)"
        className={`w-[22px] h-[22px] rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
          canGoForward
            ? "bg-surface-3 border-line text-fg-2 hover:text-accent-fg hover:border-accent hover:bg-accent-soft cursor-pointer"
            : "bg-surface-2 border-line text-fg-3 opacity-35 cursor-default"
        }`}
      >
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
      </button>
    </div>
  );
});
