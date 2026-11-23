import React from "react";
import {
  ExternalLink,
  FolderOpen,
  Music,
  RotateCcw,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  ExportAudioPreset,
  WaveformSensitivity,
  WaveformStyle,
} from "../../types";
import { AudioOutputDeviceRow } from "./AudioOutputDeviceRow";
import { ToggleRow } from "./ToggleRow";

const WAVEFORM_PREVIEW_SAMPLES = [
  0.14, 0.36, 0.74, 0.95, 0.62, 0.25, 0.11, 0.07, 0.44, 0.88, 0.98, 0.58,
  0.19, 0.09, 0.31, 0.66, 0.49, 0.18, 0.08, 0.52, 0.82, 0.43, 0.16, 0.07,
] as const;

function applyCurvePreview(amp: number, curve: WaveformSensitivity): number {
  if (curve === "high_boost") return Math.pow(amp, 0.42);
  if (curve === "logarithmic") return Math.pow(amp, 0.68);
  return amp;
}

export const AudioTab: React.FC = () => {
  const waveformStyle = useSampleStore((s) => s.waveformStyle);
  const waveformSensitivity = useSampleStore((s) => s.waveformSensitivity);
  const playheadLatencyMs = useSampleStore((s) => s.playheadLatencyMs);
  const customSliceExportPath = useSampleStore((s) => s.customSliceExportPath);
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);
  const sliceMicroFade = useSampleStore((s) => s.sliceMicroFade);
  const exportAudioPreset = useSampleStore((s) => s.exportAudioPreset);
  const skipLeadingSilence = useSampleStore((s) => s.skipLeadingSilence);
  const normalizePreview = useSampleStore((s) => s.normalizePreview);
  const autoAnalyzeBpmKey = useSampleStore((s) => s.autoAnalyzeBpmKey);
  const isAnalyzingBpmKey = useSampleStore((s) => s.isAnalyzingBpmKey);
  const bpmKeyProgress = useSampleStore((s) => s.bpmKeyProgress);

  const setWaveformStyle = useSampleStore((s) => s.setWaveformStyle);
  const setWaveformSensitivity = useSampleStore(
    (s) => s.setWaveformSensitivity
  );
  const setPlayheadLatencyMs = useSampleStore((s) => s.setPlayheadLatencyMs);
  const setCustomSliceExportPath = useSampleStore(
    (s) => s.setCustomSliceExportPath
  );
  const pickCustomSliceExportPath = useSampleStore(
    (s) => s.pickCustomSliceExportPath
  );
  const openSlicesFolder = useSampleStore((s) => s.openSlicesFolder);
  const setAutoBinOnNleDrag = useSampleStore((s) => s.setAutoBinOnNleDrag);
  const setSliceMicroFade = useSampleStore((s) => s.setSliceMicroFade);
  const setExportAudioPreset = useSampleStore((s) => s.setExportAudioPreset);
  const setSkipLeadingSilence = useSampleStore((s) => s.setSkipLeadingSilence);
  const setNormalizePreview = useSampleStore((s) => s.setNormalizePreview);
  const setAutoAnalyzeBpmKey = useSampleStore((s) => s.setAutoAnalyzeBpmKey);
  const analyzeLibraryBpmAndKey = useSampleStore(
    (s) => s.analyzeLibraryBpmAndKey
  );

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(480px,1fr))] gap-3 items-start">
      <div className="space-y-3 min-w-0">
        {/* CARD 1: PLAYBACK & MONITORING */}
        <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            PLAYBACK &amp; MONITORING
          </span>
        </div>

        <div className="divide-y divide-line">
          {/* Output Device (Native WASAPI) */}
          <AudioOutputDeviceRow />

          {/* Normalize preview loudness */}
          <ToggleRow
            label="Normalize preview loudness (Auto-Gain)"
            description="Balances loud and quiet samples during preview only — files on disk are untouched"
            checked={normalizePreview}
            onChange={setNormalizePreview}
            title="Enable non-destructive Auto-Gain preview loudness normalization"
          />

          {/* Skip leading silence */}
          <ToggleRow
            label="Skip leading silence on preview"
            description="Starts playback immediately at the first audible transient (scrub to 0:00 anytime)"
            checked={skipLeadingSilence}
            onChange={setSkipLeadingSilence}
            title="Skip silent lead-in when previewing samples"
          />
        </div>
      </div>

      {/* CARD 4: BPM & MUSICAL KEY / CAMELOT */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            BPM &amp; MUSICAL KEY / CAMELOT
          </span>
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              disabled={isAnalyzingBpmKey}
              onClick={() => void analyzeLibraryBpmAndKey(null, true)}
              className="h-[22px] px-2 bg-surface-3 hover:bg-surface-hover hover:border-accent disabled:opacity-50 border border-line text-fg-2 hover:text-fg text-[10.5px] font-medium rounded-xs transition-colors cursor-pointer"
              title="Re-run DSP BPM & Key detection across all non-manual samples"
            >
              Re-analyze all
            </button>
            <button
              type="button"
              disabled={isAnalyzingBpmKey}
              onClick={() => void analyzeLibraryBpmAndKey(null, false)}
              className="h-[22px] px-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-on text-[10.5px] font-semibold rounded-xs inline-flex items-center space-x-1 transition-colors cursor-pointer shadow-xs"
              title="Scan loops & musical tracks missing BPM or Key"
            >
              <Music className="w-3 h-3 shrink-0" />
              <span>
                {isAnalyzingBpmKey ? "Analyzing..." : "Analyze missing"}
              </span>
            </button>
          </div>
        </div>

        <div className="divide-y divide-line">
          {isAnalyzingBpmKey && bpmKeyProgress && (
            <div className="p-2.5 bg-surface-2 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-accent-fg font-semibold">
                  Analyzing [{bpmKeyProgress.processed}/{bpmKeyProgress.total}]
                  — {bpmKeyProgress.updated_count} detected
                </span>
                <span className="text-fg">
                  {Math.round(bpmKeyProgress.percentage)}%
                </span>
              </div>
              <div className="w-full h-[4px] bg-surface-0 border border-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, Math.round(bpmKeyProgress.percentage))
                    )}%`,
                  }}
                />
              </div>
              {bpmKeyProgress.current_file && (
                <div className="font-mono text-[10px] text-fg-2 truncate">
                  {bpmKeyProgress.current_file}
                </div>
              )}
            </div>
          )}

          <ToggleRow
            label="Auto-analyze BPM &amp; Key on new scans"
            checked={autoAnalyzeBpmKey}
            onChange={setAutoAnalyzeBpmKey}
            title="Automatically detect BPM & Musical Key after library scans"
          />
        </div>
      </div>
      </div>

      <div className="space-y-3 min-w-0">
      {/* CARD 2: WAVEFORM */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            WAVEFORM
          </span>
          <span className="font-mono text-[9.5px] text-fg-3">
            {waveformStyle === "solid_baseline"
              ? "Solid Baseline"
              : "Studio Center"}{" "}
            ·{" "}
            {waveformSensitivity === "high_boost"
              ? "Boost Quiet"
              : waveformSensitivity === "linear"
              ? "Linear"
              : "Natural"}
          </span>
        </div>

        {/* Live Waveform Style & Sensitivity Preview */}
        <div className="px-3 py-2 bg-surface-0 border-b border-line flex items-center justify-between gap-3">
          <svg
            viewBox="0 0 240 28"
            className="w-full h-[28px]"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {waveformStyle === "symmetric" && (
              <line
                x1="0"
                y1="14"
                x2="240"
                y2="14"
                stroke="currentColor"
                className="text-line"
                strokeWidth="1"
              />
            )}
            {WAVEFORM_PREVIEW_SAMPLES.map((rawAmp, idx) => {
              const scaled = applyCurvePreview(rawAmp, waveformSensitivity);
              const barH = Math.max(2, Math.round(scaled * 24));
              const y =
                waveformStyle === "symmetric"
                  ? Math.round((28 - barH) / 2)
                  : 27 - barH;
              const isPlayed = idx < 11;
              return (
                <rect
                  key={idx}
                  x={idx * 10 + 1}
                  y={y}
                  width="7"
                  height={barH}
                  rx="1"
                  fill="currentColor"
                  className={isPlayed ? "text-accent-fg" : "text-fg-3"}
                />
              );
            })}
          </svg>
        </div>

        <div className="divide-y divide-line">
          {/* Render style */}
          <div className="h-[38px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg">
              Render style
            </span>
            <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line">
              {(
                [
                  { id: "solid_baseline", label: "Solid Baseline" },
                  { id: "symmetric", label: "Studio Center" },
                ] as { id: WaveformStyle; label: string }[]
              ).map((opt) => {
                const active = waveformStyle === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setWaveformStyle(opt.id)}
                    className={`h-[22px] px-2.5 rounded-xs text-[11px] flex items-center space-x-1.5 transition-colors cursor-pointer ${
                      active
                        ? "bg-accent-soft border border-accent/60 text-accent-fg font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent font-medium"
                    }`}
                  >
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amplitude curve */}
          <div className="h-[38px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg">
              Amplitude curve
            </span>
            <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line">
              {(
                [
                  { id: "logarithmic", label: "Natural" },
                  { id: "high_boost", label: "Boost Quiet" },
                  { id: "linear", label: "Linear" },
                ] as { id: WaveformSensitivity; label: string }[]
              ).map((opt) => {
                const active = waveformSensitivity === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setWaveformSensitivity(opt.id)}
                    className={`h-[22px] px-2.5 rounded-xs text-[11px] flex items-center space-x-1.5 transition-colors cursor-pointer ${
                      active
                        ? "bg-accent-soft border border-accent/60 text-accent-fg font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent font-medium"
                    }`}
                  >
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Playhead latency */}
          <div className="py-2 px-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-fg">
                Playhead latency
              </div>
              <div className="text-[11px] text-fg-2">
                Aligns visual playhead with audio output delay
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <input
                type="range"
                min={-100}
                max={300}
                step={5}
                disabled={playheadLatencyMs === null}
                value={playheadLatencyMs ?? 0}
                onChange={(e) => setPlayheadLatencyMs(Number(e.target.value))}
                className="w-[116px]"
              />
              {playheadLatencyMs !== null && (
                <span className="font-mono tabular-nums text-[10.5px] font-semibold text-accent-fg bg-surface-2 border border-line rounded-xs w-[52px] h-[20px] inline-flex items-center justify-center">
                  {playheadLatencyMs} ms
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  setPlayheadLatencyMs(playheadLatencyMs === null ? 0 : null)
                }
                className={`h-[22px] px-2.5 rounded-xs border text-[10.5px] font-mono transition-colors cursor-pointer ${
                  playheadLatencyMs === null
                    ? "bg-accent-soft border-accent/60 text-accent-fg font-semibold"
                    : "bg-surface-2 border-line text-fg-2 hover:text-fg"
                }`}
                title="Use system-reported output latency automatically"
              >
                Auto
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CARD 3: SLICE & NLE WORKFLOW */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            SLICE &amp; NLE WORKFLOW
          </span>
        </div>

        <div className="divide-y divide-line">
          {/* Slice export path */}
          <div className="h-[38px] px-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Slice export path
            </span>
            <div className="flex items-center space-x-1.5 min-w-0 flex-1 max-w-[340px]">
              <div
                className="flex-1 min-w-0 h-[24px] px-2 bg-surface-2 border border-line rounded-xs flex items-center font-mono text-[10.5px] text-fg-2 truncate"
                title={
                  customSliceExportPath ||
                  "Default portable path: user/slices"
                }
              >
                <span className="truncate">
                  {customSliceExportPath || "user/slices (Default)"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void pickCustomSliceExportPath()}
                className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg flex items-center justify-center transition-colors cursor-pointer"
                title="Browse custom slice export folder"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void openSlicesFolder()}
                className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg flex items-center justify-center transition-colors cursor-pointer"
                title="Open slice export folder in Explorer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCustomSliceExportPath("")}
                disabled={!customSliceExportPath}
                className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
                title="Reset to default portable path (user/slices)"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Auto-Bin NLE drags */}
          <ToggleRow
            label="Auto-Bin NLE drags"
            description="Add tracks dragged to Resolve / Premiere into Session Bin"
            checked={autoBinOnNleDrag}
            onChange={setAutoBinOnNleDrag}
            title="Automatically add tracks dragged to NLE / DAW into the Session Bin"
          />

          {/* Export WAV format preset */}
          <div className="py-2 px-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-fg">
                Export format (Slice &amp; Pitch)
              </div>
              <div className="text-[11px] text-fg-2">
                {exportAudioPreset === "nle_48k_24"
                  ? "Broadcast 48 kHz / 24-bit WAV for Premiere & Resolve"
                  : exportAudioPreset === "wav_24"
                  ? "Lossless 24-bit WAV at original sample rate"
                  : "Keeps source rate & preserves 24-bit on hi-res audio"}
              </div>
            </div>
            <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line shrink-0">
              {(
                [
                  { id: "original", label: "Source" },
                  { id: "wav_24", label: "24-bit" },
                  { id: "nle_48k_24", label: "48k / 24b" },
                ] as { id: ExportAudioPreset; label: string }[]
              ).map((opt) => {
                const active = exportAudioPreset === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setExportAudioPreset(opt.id)}
                    className={`h-[22px] px-2 rounded-xs text-[11px] flex items-center transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? "bg-accent-soft border border-accent/60 text-accent-fg font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent font-medium"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slice 3 ms micro-fade */}
          <ToggleRow
            label="Slice 3 ms micro-fade"
            description="Prevents zero-crossing clicks on exported WAV slices"
            checked={sliceMicroFade}
            onChange={setSliceMicroFade}
            title="Apply 3ms anti-click micro-fade on exported WAV slices"
          />
        </div>
      </div>
      </div>
    </div>
  );
};
