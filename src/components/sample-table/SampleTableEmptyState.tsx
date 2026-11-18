import React from "react";
import { CopyCheck, Disc, Plus, Search } from "lucide-react";

const SUPPORTED_FORMATS = [".WAV", ".FLAC", ".MP3", ".AIFF", ".OGG"] as const;
const SKELETON_ROW_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

interface SampleTableEmptyStateProps {
  hasLibraries: boolean;
  isInitializing?: boolean;
  isScanning: boolean;
  isScanningDuplicates?: boolean;
  duplicatesFilterActive?: boolean;
  duplicateHasResult?: boolean;
  duplicateScopeLabel?: string;
  duplicateScanModeLabel?: string;
  onScanDuplicates?: () => void;
  onAddFolder: () => void;
  onResetFilters: () => void;
}

export const SampleTableEmptyState: React.FC<SampleTableEmptyStateProps> = ({
  hasLibraries,
  isInitializing = false,
  isScanning,
  isScanningDuplicates = false,
  duplicatesFilterActive = false,
  duplicateHasResult = false,
  duplicateScopeLabel = "All Libraries",
  duplicateScanModeLabel = "Exact (SHA-256)",
  onScanDuplicates,
  onAddFolder,
  onResetFilters,
}) => {
  if (isInitializing || isScanningDuplicates) {
    return (
      <div
        className="flex-1 flex flex-col overflow-hidden select-none"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-[2px] w-full bg-surface-2 overflow-hidden shrink-0">
          <div className="h-full w-1/3 bg-accent animate-pulse" />
        </div>
        <div className="flex-1 overflow-hidden divide-y divide-line">
          {SKELETON_ROW_INDICES.map((idx) => (
            <div
              key={idx}
              className="h-[34px] px-3 flex items-center space-x-3 animate-pulse"
            >
              <div className="w-3.5 h-3.5 rounded-xs bg-surface-2 shrink-0" />
              <div
                className={`h-2.5 rounded-xs bg-surface-3 shrink-0 ${
                  idx % 3 === 0
                    ? "w-56"
                    : idx % 3 === 1
                      ? "w-44"
                      : "w-64"
                }`}
              />
              <div className="w-16 h-3.5 rounded-xs bg-surface-2 shrink-0" />
              <div className="flex-1 h-3 rounded-xs bg-surface-2 min-w-[120px]" />
              <div className="w-12 h-2.5 rounded-xs bg-surface-2 shrink-0" />
              <div className="w-12 h-2.5 rounded-xs bg-surface-2 shrink-0" />
              <div className="w-10 h-2.5 rounded-xs bg-surface-2 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!hasLibraries) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-[440px] bg-surface-1 border border-line rounded-lg p-6 text-center space-y-4 shadow-xl">
          <div className="inline-flex items-center space-x-2 px-2.5 py-1 bg-surface-3 border border-line font-mono text-[11px] text-accent-fg rounded-xs">
            <Disc className="w-3.5 h-3.5" />
            <span>AUDIO LIBRARY</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-[15px] font-semibold text-fg">
              No Audio Folders Linked
            </h2>
            <p className="text-[12px] text-fg-2 leading-relaxed">
              Add a local SFX, music, or sample directory to search, organize,
              and preview your sound library.
            </p>
          </div>

          <button
            type="button"
            onClick={onAddFolder}
            disabled={isScanning}
            className="w-full h-[34px] bg-accent hover:bg-accent-hover text-accent-on font-mono text-[12px] font-bold tracking-wide flex items-center justify-center space-x-2 rounded-sm"
          >
            <Plus className="w-4 h-4" />
            <span>ADD SAMPLE FOLDER</span>
          </button>

          <div className="pt-2 border-t border-line flex items-center justify-center space-x-2 font-mono text-[10px] text-fg-3">
            <span>SUPPORTED:</span>
            {SUPPORTED_FORMATS.map((fmt) => (
              <span
                key={fmt}
                className="px-1.5 py-0.5 bg-surface-3 border border-line text-fg-2 rounded-xs"
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (duplicatesFilterActive && !duplicateHasResult) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-[420px] bg-surface-1 border border-line rounded-lg px-6 py-5 text-center space-y-3 shadow-xl">
          <div className="inline-flex items-center space-x-2 px-2.5 py-1 bg-surface-3 border border-line font-mono text-[11px] text-accent-fg rounded-xs">
            <CopyCheck className="w-3.5 h-3.5" />
            <span>DUPLICATE FINDER</span>
          </div>
          <div className="space-y-1">
            <div className="font-mono text-[12px] font-semibold text-fg">
              READY TO SCAN FOR DUPLICATES
            </div>
            <div className="text-[11.5px] text-fg-2">
              Choose a library and match mode below, then run Scan.
            </div>
            <div className="font-mono text-[10.5px] text-fg-3 pt-0.5">
              Scope: {duplicateScopeLabel} · {duplicateScanModeLabel}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            {onScanDuplicates && (
              <button
                type="button"
                onClick={onScanDuplicates}
                className="h-[30px] px-4 bg-accent hover:bg-accent-hover text-accent-on font-mono text-[11.5px] font-bold rounded-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Scan for Duplicates</span>
              </button>
            )}
            <button
              type="button"
              onClick={onResetFilters}
              className="h-[30px] px-3 bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg font-mono text-[11px] rounded-xs transition-colors cursor-pointer"
            >
              Exit Duplicates
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="bg-surface-1 border border-line rounded-lg px-6 py-5 text-center space-y-3 shadow-xl">
        <div className="font-mono text-[12px] text-fg-2">
          {duplicatesFilterActive
            ? "NO DUPLICATE AUDIO FOUND IN CURRENT SCOPE"
            : "NO SAMPLES MATCH CURRENT FILTER CRITERIA"}
        </div>
        {duplicatesFilterActive && (
          <div className="text-[11px] text-fg-3">
            Try switching to Similar Audio or All Libraries in Filters → General
            below and clicking Scan, or exit Duplicates view.
          </div>
        )}
        <button
          type="button"
          onClick={onResetFilters}
          className="h-[26px] px-3 bg-surface-3 hover:border-accent border border-line text-accent-fg font-mono text-[11px] rounded-xs transition-colors"
        >
          RESET ALL FILTERS
        </button>
      </div>
    </div>
  );
};
