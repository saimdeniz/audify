import { useEffect, useSyncExternalStore } from "react";
import {
  getNavigationHistoryFlags,
  initNavigationHistory,
  navigateHistoryBack,
  navigateHistoryForward,
  NavigationHistoryFlags,
  subscribeNavigationHistoryFlags,
} from "../store/navigationHistory";
import { isStandaloneSettingsWindow } from "../store/storageHelpers";
import { useSampleStore } from "../store/useSampleStore";
import { isTextEntryTarget } from "../utils/shortcuts";

export function useNavigationHistoryFlags(): NavigationHistoryFlags {
  return useSyncExternalStore(
    subscribeNavigationHistoryFlags,
    getNavigationHistoryFlags,
    getNavigationHistoryFlags
  );
}

function isNavigationBlocked(): boolean {
  const state = useSampleStore.getState();
  if (
    state.isSettingsOpen ||
    state.pendingTrashRequest ||
    state.pendingFileConflictPrompt ||
    state.batchRenameSampleIds !== null ||
    state.batchRenameSliceIds !== null ||
    state.batchRenameLayerIds !== null
  ) {
    return true;
  }
  return document.querySelector('[data-modal-portal="true"]') !== null;
}

/**
 * Initializes Audify's browser-style navigation history and binds global
 * `Alt+←` / `Alt+→` (when no active slice is being trimmed) and `Mouse4` / `Mouse5`
 * side buttons in both Main View and Mini Dock.
 */
export function useNavigationHistoryController(): void {
  useEffect(() => {
    if (isStandaloneSettingsWindow()) return;

    const cleanupHistory = initNavigationHistory();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const isRecordingShortcut = target?.dataset?.shortcutRecorder === "true";

      // Prevent standalone Alt (e.g. after Alt+Scroll / Alt+Drag) from moving
      // WebView2 focus into native Win32 menu mode while preserving Turkish AltGr.
      if (
        !isRecordingShortcut &&
        !isTextEntryTarget(target) &&
        !e.ctrlKey &&
        !e.metaKey &&
        e.key === "Alt"
      ) {
        e.preventDefault();
        return;
      }

      // Guard accidental Alt+Space during rapid Alt+Scroll/Alt+Drag -> Space playback
      if (
        !isRecordingShortcut &&
        !isTextEntryTarget(target) &&
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === " " || e.code === "Space")
      ) {
        e.preventDefault();
        if (!e.repeat && !isNavigationBlocked()) {
          useSampleStore.getState().togglePlayPause();
        }
        return;
      }

      if (e.repeat) return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isNavigationBlocked()) return;

      if (isTextEntryTarget(target)) return;

      // Yield Alt+ArrowLeft/Right to active waveform slice edge trimming
      if (useSampleStore.getState().sliceRange !== null) return;

      e.preventDefault();
      if (e.key === "ArrowLeft") {
        navigateHistoryBack();
      } else {
        navigateHistoryForward();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.dataset?.shortcutRecorder === "true" ||
        isTextEntryTarget(target)
      ) {
        return;
      }
      if (!e.ctrlKey && !e.metaKey && e.key === "Alt") {
        e.preventDefault();
      }
    };

    const preventNativeSideNav = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (isNavigationBlocked()) return;
      if (e.button === 3) {
        navigateHistoryBack();
      } else {
        navigateHistoryForward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", preventNativeSideNav);
    window.addEventListener("auxclick", preventNativeSideNav);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      cleanupHistory();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", preventNativeSideNav);
      window.removeEventListener("auxclick", preventNativeSideNav);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);
}
