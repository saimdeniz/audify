import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { FileCheck2, MinusCircle, Trash2, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { generateBatchAttributionCredits } from "../../utils/format";
import { useDialogFocusTrap } from "../../utils/modalFocus";
import { EMPTY_SAMPLES, resolveSamplesByIds } from "../../utils/sampleLookup";

interface SessionBinGeneralControlsProps {
  compact?: boolean;
}

/**
 * Contextual Session Bin actions rendered dynamically on row 2 of
 * Filters -> Tools whenever `binFilterActive` is enabled.
 */
export const SessionBinGeneralControls: React.FC<
  SessionBinGeneralControlsProps
> = ({ compact = false }) => {
  const binSamples = useSampleStore(
    useShallow((s) =>
      s.binSampleIds.length === 0
        ? EMPTY_SAMPLES
        : resolveSamplesByIds(
            s.binSampleIds,
            s.allProfileSamples.length > 0 ? s.allProfileSamples : s.rawSamples
          )
    )
  );
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const licenseGroups = useSampleStore((s) => s.licenseGroups);

  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const removeSamplesFromBin = useSampleStore((s) => s.removeSamplesFromBin);
  const clearBin = useSampleStore((s) => s.clearBin);

  const [confirmClearBin, setConfirmClearBin] = useState(false);
  const [creditsCopiedFlash, setCreditsCopiedFlash] = useState(false);
  const copyFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDialogRef = useRef<HTMLDivElement>(null);
  const isClearModalOpen = confirmClearBin && binSamples.length > 0;
  useDialogFocusTrap(isClearModalOpen, clearDialogRef);

  useEffect(() => {
    return () => {
      if (copyFlashTimerRef.current) {
        clearTimeout(copyFlashTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isClearModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setConfirmClearBin(false);
      } else if (e.key === "Enter") {
        const targetEl = e.target as HTMLElement | null;
        if (
          targetEl &&
          targetEl.closest(
            "button, [role='button'], input, select, textarea, a, label"
          )
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        clearBin();
        setConfirmClearBin(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isClearModalOpen, clearBin]);

  const binCredits = useMemo(
    () =>
      enableLicensesSystem && binSamples.length > 0
        ? generateBatchAttributionCredits(binSamples, licenseGroups)
        : null,
    [enableLicensesSystem, binSamples, licenseGroups]
  );

  const selectedBinIds = useMemo(() => {
    if (selectedSampleIds.length === 0 || binSamples.length === 0) return [];
    const binSet = new Set(binSamples.map((s) => s.id));
    return selectedSampleIds.filter((id) => binSet.has(id));
  }, [selectedSampleIds, binSamples]);

  const handleCopyCredits = () => {
    void copyAttributionForSamples(binSamples);
    setCreditsCopiedFlash(true);
    if (copyFlashTimerRef.current) {
      clearTimeout(copyFlashTimerRef.current);
    }
    copyFlashTimerRef.current = setTimeout(() => {
      copyFlashTimerRef.current = null;
      setCreditsCopiedFlash(false);
    }, 1200);
  };

  const btnSizeClass = compact
    ? "h-[22px] px-1.5 text-[10px]"
    : "h-[24px] px-2 text-[10.5px]";

  return (
    <div
      className={`border-t border-line-subtle flex items-center flex-wrap w-full ${
        compact ? "pt-1 gap-1" : "pt-1.5 gap-1.5"
      }`}
    >
      {enableLicensesSystem && (
        <button
          type="button"
          onClick={handleCopyCredits}
          disabled={binSamples.length === 0}
          className={`${btnSizeClass} rounded-[3px] border font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0 ${
            creditsCopiedFlash
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
          }`}
          title={
            binCredits
              ? `Copy all credits (${binCredits.matchedSampleCount} matched • ${binCredits.artistCount} artist${
                  binCredits.artistCount === 1 ? "" : "s"
                })`
              : "Copy all credits"
          }
        >
          <FileCheck2 className="w-3 h-3 shrink-0" />
          <span>{creditsCopiedFlash ? "Copied" : compact ? "Credits" : "Copy Credits"}</span>
        </button>
      )}

      {selectedBinIds.length > 0 && (
        <button
          type="button"
          onClick={() => removeSamplesFromBin(selectedBinIds)}
          className={`${btnSizeClass} rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0`}
          title="Remove selected track(s) from Session Bin (Del)"
        >
          <MinusCircle className="w-3 h-3 shrink-0" />
          <span>Remove ({selectedBinIds.length})</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setConfirmClearBin(true)}
        disabled={binSamples.length === 0}
        className={`${btnSizeClass} rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
        title="Clear all tracks from Session Bin"
      >
        <Trash2 className="w-3 h-3 shrink-0" />
        <span>Clear Bin</span>
      </button>

      {!compact && (
        <span className="ml-auto font-mono text-[10px] text-fg-3 truncate">
          {binSamples.length === 0
            ? "Drag tracks onto Inbox icon or press B to collect"
            : `${binSamples.length.toLocaleString()} ${
                binSamples.length === 1 ? "track" : "tracks"
              } in Session Bin · Del removes selected`}
        </span>
      )}

      {isClearModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-modal-portal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setConfirmClearBin(false);
              }
            }}
            className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-2 sm:p-4 select-none"
            style={{ zIndex: Z_INDEX.modalConfirm }}
          >
            <div
              ref={clearDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Clear Session Bin"
              tabIndex={-1}
              data-mica-overlay="true"
              className="w-full max-w-[340px] rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-fg"
            >
              <div className="h-[32px] px-3 border-b border-line bg-surface-header flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Trash2 className="w-3.5 h-3.5 text-danger shrink-0" />
                  <span className="text-[12px] font-semibold text-fg truncate">
                    Clear Session Bin
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmClearBin(false)}
                  className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-hover transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-3 py-2.5 space-y-2">
                <p className="text-[11.5px] text-fg-2 leading-relaxed">
                  Remove all{" "}
                  <span className="font-mono font-semibold text-fg">
                    {binSamples.length}
                  </span>{" "}
                  {binSamples.length === 1 ? "track" : "tracks"} from Session Bin?
                  Your audio files on disk will not be affected.
                </p>
              </div>

              <div className="px-3 py-2 border-t border-line bg-surface-header flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearBin(false)}
                  className="h-[25px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-2 hover:text-fg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    clearBin();
                    setConfirmClearBin(false);
                  }}
                  className="h-[25px] px-2.5 rounded-xs bg-danger/15 hover:bg-danger hover:text-danger-on border border-danger/50 text-[11px] font-semibold text-danger flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear Bin (Enter)</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
