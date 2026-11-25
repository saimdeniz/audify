import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSampleStore } from "../../store/useSampleStore";
import {
  ActiveBackgroundJobView,
  resolveActiveBackgroundJob,
} from "../../utils/activeBackgroundJob";

/**
 * Option A contextual footer strip for the Settings window:
 * stays completely unmounted (0px) when idle, slides in cleanly at 26px whenever
 * any background scan/rule/genre/BPM/AI job is running across any tab, and briefly
 * shows a 2.4s completion hand-off before collapsing back to 0px.
 */
export const SettingsJobProgressStrip: React.FC = React.memo(() => {
  const jobSnapshot = useSampleStore(
    useShallow((s) => ({
      isScanning: s.isScanning,
      scanProgress: s.scanProgress,
      isDetectingGenres: s.isDetectingGenres,
      genreDetectProgress: s.genreDetectProgress,
      isApplyingAutoTags: s.isApplyingAutoTags,
      autoTagProgress: s.autoTagProgress,
      isAnalyzingBpmKey: s.isAnalyzingBpmKey,
      bpmKeyProgress: s.bpmKeyProgress,
      isDownloadingAiModel: s.isDownloadingAiModel,
      aiDownloadProgress: s.aiDownloadProgress,
      isAnalyzingAi: s.isAnalyzingAi,
      aiIndexProgress: s.aiIndexProgress,
      isScanningDuplicates: s.isScanningDuplicates,
      duplicateScanProgress: s.duplicateScanProgress,
    }))
  );

  const activeJob = resolveActiveBackgroundJob(jobSnapshot);
  const lastActiveRef = useRef<ActiveBackgroundJobView | null>(null);
  const [completedLabel, setCompletedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (activeJob) {
      lastActiveRef.current = activeJob;
      setCompletedLabel(null);
      return;
    }
    if (lastActiveRef.current) {
      const finished = lastActiveRef.current;
      lastActiveRef.current = null;
      setCompletedLabel(finished.doneLabel);
      const timer = window.setTimeout(() => {
        setCompletedLabel(null);
      }, 2400);
      return () => window.clearTimeout(timer);
    }
  }, [activeJob]);

  if (!activeJob && !completedLabel) {
    return null;
  }

  if (!activeJob && completedLabel) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="settings-job-progress-strip"
        className="h-[26px] bg-surface-1 border-t border-line px-3 flex items-center justify-between gap-3 font-mono tabular-nums text-[10.5px] text-fg-2 shrink-0 select-none"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Check className="w-3 h-3 text-accent-fg shrink-0" />
          <span className="text-accent-fg font-semibold truncate">
            {completedLabel}
          </span>
        </div>
        <span className="text-[10px] text-fg-3 shrink-0">100%</span>
      </div>
    );
  }

  const job = activeJob!;
  const barWidth = job.indeterminate ? "28%" : `${job.percentage}%`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="settings-job-progress-strip"
      className="h-[26px] bg-surface-1 border-t border-line px-3 flex items-center justify-between gap-3 font-mono tabular-nums text-[10.5px] text-fg-2 shrink-0 select-none"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Loader2 className="w-3 h-3 text-accent-fg animate-spin shrink-0" />
        <span className="text-accent-fg font-semibold shrink-0">
          {job.label}
        </span>
        {job.countLabel && (
          <span className="text-fg-2 shrink-0">[{job.countLabel}]</span>
        )}
        <span className="text-fg font-semibold shrink-0">
          ({job.percentage}%)
        </span>
        <div className="w-[150px] h-[6px] bg-surface-0 border border-line rounded-2xs overflow-hidden shrink-0">
          <div
            className={`h-full bg-accent transition-[width] duration-75 ${
              job.indeterminate ? "animate-pulse" : ""
            }`}
            style={{ width: barWidth }}
          />
        </div>
        {job.detail && (
          <span className="text-fg-3 truncate min-w-0">{job.detail}</span>
        )}
      </div>

      {job.activeCount > 1 && (
        <span
          className="px-1.5 py-0.5 rounded-2xs bg-accent-soft border border-accent/40 text-accent-fg text-[9.5px] font-semibold shrink-0"
          title={`${job.activeCount} background tasks currently running`}
        >
          +{job.activeCount - 1} active
        </span>
      )}
    </div>
  );
});
