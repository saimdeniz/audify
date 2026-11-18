import { useCallback } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  applyFilterInMainWindow,
  MainFilterRequest,
} from "../../utils/mainWindowBridge";

/**
 * Shared Settings hook for triggering a filter in the Main window (or local
 * fallback) while keeping the Settings window open.
 */
export function useMainFilterAction(): (req: MainFilterRequest) => void {
  const applyMainFilterRequest = useSampleStore(
    (s) => s.applyMainFilterRequest
  );
  const showStatusNotice = useSampleStore((s) => s.showStatusNotice);

  return useCallback(
    (req: MainFilterRequest) => {
      void applyFilterInMainWindow(req, {
        applyLocally: applyMainFilterRequest,
        notify: showStatusNotice,
      });
    },
    [applyMainFilterRequest, showStatusNotice]
  );
}
