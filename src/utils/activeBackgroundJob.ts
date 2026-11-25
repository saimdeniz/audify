import type {
  AiDownloadProgressPayload,
  AiIndexProgressPayload,
  BatchJobProgressPayload,
  BpmKeyProgressPayload,
  DuplicateScanProgressPayload,
  ScanProgressPayload,
} from "../types";

export type BackgroundJobKind =
  | "library_scan"
  | "genre_detect"
  | "auto_tag"
  | "bpm_key"
  | "ai_download"
  | "ai_index"
  | "duplicate_scan";

export interface BackgroundJobSnapshotInput {
  isScanning: boolean;
  scanProgress: ScanProgressPayload | null;
  isDetectingGenres: boolean;
  genreDetectProgress: BatchJobProgressPayload | null;
  isApplyingAutoTags: boolean;
  autoTagProgress: BatchJobProgressPayload | null;
  isAnalyzingBpmKey: boolean;
  bpmKeyProgress: BpmKeyProgressPayload | null;
  isDownloadingAiModel: boolean;
  aiDownloadProgress: AiDownloadProgressPayload | null;
  isAnalyzingAi: boolean;
  aiIndexProgress: AiIndexProgressPayload | null;
  isScanningDuplicates: boolean;
  duplicateScanProgress: DuplicateScanProgressPayload | null;
}

export interface ActiveBackgroundJobView {
  kind: BackgroundJobKind;
  label: string;
  doneLabel: string;
  percentage: number;
  indeterminate: boolean;
  countLabel: string | null;
  detail: string;
  activeCount: number;
}

function clampPct(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatMb(bytes: number): string {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Resolves the highest-priority active background job across Library Scan,
 * Genres Auto-assign, Tags Apply Rules, BPM/Key Analysis, AI Indexing/Download,
 * and Duplicate Scan so Main StatusBar and Settings footer share one consistent view.
 */
export function resolveActiveBackgroundJob(
  s: BackgroundJobSnapshotInput
): ActiveBackgroundJobView | null {
  const active: Omit<ActiveBackgroundJobView, "activeCount">[] = [];

  if (s.isScanning && s.scanProgress) {
    const p = s.scanProgress;
    const pct = clampPct(p.percentage);
    active.push({
      kind: "library_scan",
      label: "Scanning",
      doneLabel: "Library scan complete",
      percentage: pct,
      indeterminate: p.total <= 0 && pct === 0,
      countLabel:
        p.total > 0
          ? `${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`
          : null,
      detail: p.current_file || "",
    });
  }

  if (s.isDetectingGenres) {
    const p = s.genreDetectProgress;
    const pct = clampPct(p?.percentage);
    active.push({
      kind: "genre_detect",
      label: p?.stage_label || "Scanning genres",
      doneLabel: "Genres auto-assign complete",
      percentage: pct,
      indeterminate: !p || (p.total <= 0 && pct === 0),
      countLabel:
        p && p.total > 0
          ? `${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`
          : null,
      detail: p?.current_item || "",
    });
  }

  if (s.isApplyingAutoTags) {
    const p = s.autoTagProgress;
    const pct = clampPct(p?.percentage);
    active.push({
      kind: "auto_tag",
      label: p?.stage_label || "Applying rules",
      doneLabel: "Auto-tag rules applied",
      percentage: pct,
      indeterminate: !p || (p.total <= 0 && pct === 0),
      countLabel:
        p && p.total > 0
          ? `${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`
          : null,
      detail: p?.current_item || "",
    });
  }

  if (s.isAnalyzingBpmKey && s.bpmKeyProgress) {
    const p = s.bpmKeyProgress;
    const pct = clampPct(p.percentage);
    active.push({
      kind: "bpm_key",
      label: "Analyzing BPM & Key",
      doneLabel: "BPM & Key analysis complete",
      percentage: pct,
      indeterminate: p.total <= 0 && pct === 0,
      countLabel:
        p.total > 0
          ? `${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`
          : null,
      detail: p.current_file || "",
    });
  }

  if (s.isDownloadingAiModel && s.aiDownloadProgress) {
    const p = s.aiDownloadProgress;
    const pct = clampPct(p.percentage);
    active.push({
      kind: "ai_download",
      label: p.stage ? `AI Download · ${p.stage}` : "Downloading AI model",
      doneLabel: "AI model download complete",
      percentage: pct,
      indeterminate: p.total_bytes <= 0 && pct === 0,
      countLabel:
        p.total_bytes > 0
          ? `${formatMb(p.downloaded_bytes)} / ${formatMb(p.total_bytes)}`
          : null,
      detail: "",
    });
  }

  if (s.isAnalyzingAi && s.aiIndexProgress) {
    const p = s.aiIndexProgress;
    const pct = clampPct(p.percentage);
    active.push({
      kind: "ai_index",
      label: "AI Indexing",
      doneLabel: "AI indexing complete",
      percentage: pct,
      indeterminate: p.total <= 0 && pct === 0,
      countLabel:
        p.total > 0
          ? `${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`
          : null,
      detail: p.current_file || "",
    });
  }

  if (s.isScanningDuplicates && s.duplicateScanProgress) {
    const p = s.duplicateScanProgress;
    const pct = clampPct(p.percentage);
    active.push({
      kind: "duplicate_scan",
      label: p.stage_label || "Scanning duplicates",
      doneLabel: "Duplicate scan complete",
      percentage: pct,
      indeterminate: p.total <= 0 && pct === 0,
      countLabel: null,
      detail: p.current_file || "",
    });
  }

  if (active.length === 0) return null;
  return {
    ...active[0],
    activeCount: active.length,
  };
}
