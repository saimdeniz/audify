import React, { useEffect, useState } from "react";
import {
  Cpu,
  Download,
  FolderOpen,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { formatBytesCompact } from "../../utils/format";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";

/**
 * Local ONNX YAMNet model & runtime engine lifecycle card inside Settings → AI Audio.
 * Manages download progress, SHA-256 verification, offline .onnx/.dll import, and purge.
 */
export const AiModelSetupCard: React.FC = () => {
  const aiModelStatus = useSampleStore((s) => s.aiModelStatus);
  const aiDownloadProgress = useSampleStore((s) => s.aiDownloadProgress);
  const isDownloadingAiModel = useSampleStore((s) => s.isDownloadingAiModel);
  const isVerifyingAiModel = useSampleStore((s) => s.isVerifyingAiModel);
  const isAnalyzingAi = useSampleStore((s) => s.isAnalyzingAi);

  const verifyAiModelIntegrity = useSampleStore((s) => s.verifyAiModelIntegrity);
  const downloadAiModel = useSampleStore((s) => s.downloadAiModel);
  const cancelAiDownload = useSampleStore((s) => s.cancelAiDownload);
  const importAiModelFile = useSampleStore((s) => s.importAiModelFile);
  const removeAiModel = useSampleStore((s) => s.removeAiModel);

  const [confirmClearData, setConfirmClearData] = useState(false);

  useEffect(() => {
    if (!confirmClearData) return;
    const t = setTimeout(() => setConfirmClearData(false), 3500);
    return () => clearTimeout(t);
  }, [confirmClearData]);

  const ready = Boolean(aiModelStatus?.ready);
  const installed = Boolean(aiModelStatus?.installed);
  const runtimeInstalled = Boolean(aiModelStatus?.runtime_installed);

  return (
    <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
      <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2 min-w-0">
          <Cpu className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg truncate">
            AI MODEL &amp; ONNX ENGINE
          </span>
          <span
            className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded-xs border shrink-0 whitespace-nowrap ${
              ready
                ? "bg-accent-soft text-accent-fg border-accent font-semibold"
                : "bg-surface-3 text-fg-2 border-line"
            }`}
          >
            {ready ? "READY" : "NEEDS SETUP"}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {isDownloadingAiModel ? (
            <button
              type="button"
              onClick={() => void cancelAiDownload()}
              className="h-[22px] px-2.5 bg-surface-3 hover:bg-surface-hover border border-line hover:border-accent text-fg hover:text-accent-fg text-[10.5px] font-medium rounded-xs inline-flex items-center space-x-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Cancel download</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isAnalyzingAi}
              onClick={() => void downloadAiModel()}
              className="h-[22px] px-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-on text-[10.5px] font-semibold rounded-xs inline-flex items-center space-x-1 transition-colors cursor-pointer shadow-xs"
              title="Download official YAMNet AudioSet model + Microsoft ONNX Runtime (~30 MB total)"
            >
              <Download className="w-3 h-3 shrink-0" />
              <span>
                {ready
                  ? "Re-verify / Repair Engine"
                  : "Download YAMNet Engine (~30 MB)"}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-line">
        {isDownloadingAiModel && aiDownloadProgress && (
          <div className="p-2.5 bg-surface-2 space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-accent-fg font-semibold uppercase">
                Downloading AI {aiDownloadProgress.stage}...
              </span>
              <span className="text-fg tabular-nums">
                {formatBytesCompact(aiDownloadProgress.downloaded_bytes)} /{" "}
                {formatBytesCompact(aiDownloadProgress.total_bytes)} (
                {Math.round(aiDownloadProgress.percentage)}%)
              </span>
            </div>
            <div className="w-full h-[4px] bg-surface-0 border border-line rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, Math.round(aiDownloadProgress.percentage))
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Model Binary Status Row */}
        <div className="px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-[12px] font-medium text-fg">
                {aiModelStatus?.model_name || "YAMNet AudioSet ONNX"}
              </span>
              <span className="font-mono text-[10px] text-fg-2">
                {installed && aiModelStatus
                  ? formatBytesCompact(aiModelStatus.model_size_bytes)
                  : "Not installed"}
              </span>
              {installed && (
                <span
                  className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded-xs border ${
                    aiModelStatus?.model_sha256_ok
                      ? "border-ok text-ok bg-surface-2"
                      : "border-warn text-warn bg-surface-2"
                  }`}
                >
                  {aiModelStatus?.is_custom_model
                    ? "CUSTOM ONNX"
                    : aiModelStatus?.model_sha256_ok
                    ? "SHA-256 OK"
                    : "HASH MISMATCH"}
                </span>
              )}
            </div>
            <div className="font-mono text-[10px] text-fg-3 truncate mt-0.5">
              {aiModelStatus?.model_rel_path || "user/models/yamnet.onnx"} · 521
              AudioSet classes · {aiModelStatus?.embedding_dim || 128}-dim vector
            </div>
          </div>

          <button
            type="button"
            disabled={isDownloadingAiModel || isAnalyzingAi}
            onClick={() => void importAiModelFile("onnx")}
            className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent disabled:opacity-50 rounded-xs text-[11px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1.5 shrink-0 cursor-pointer"
            title="Import local .onnx model offline"
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span>Import .onnx</span>
          </button>
        </div>

        {/* ONNX Runtime DLL Status Row */}
        <div className="px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-[12px] font-medium text-fg">
                ONNX Runtime Engine
              </span>
              <span className="font-mono text-[10px] text-fg-2">
                {runtimeInstalled && aiModelStatus
                  ? formatBytesCompact(aiModelStatus.runtime_size_bytes)
                  : "Not installed"}
              </span>
              {runtimeInstalled && (
                <span
                  className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded-xs border ${
                    aiModelStatus?.runtime_sha256_ok
                      ? "border-ok text-ok bg-surface-2"
                      : "border-line text-fg-2 bg-surface-2"
                  }`}
                >
                  {aiModelStatus?.runtime_sha256_ok ? "SHA-256 OK" : "CUSTOM DLL"}
                </span>
              )}
            </div>
            <div className="font-mono text-[10px] text-fg-3 truncate mt-0.5">
              {aiModelStatus?.runtime_rel_path ||
                "user/models/bin/onnxruntime.dll"}{" "}
              · Dynamically loaded on demand
            </div>
          </div>

          <button
            type="button"
            disabled={isDownloadingAiModel || isAnalyzingAi}
            onClick={() => void importAiModelFile("runtime_dll")}
            className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent disabled:opacity-50 rounded-xs text-[11px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1.5 shrink-0 cursor-pointer"
            title="Import local onnxruntime.dll offline"
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span>Import .dll</span>
          </button>
        </div>

        {/* Integrity & Cleanup Action Row */}
        {(installed ||
          runtimeInstalled ||
          (aiModelStatus?.indexed_count || 0) > 0) && (
          <div className="min-h-[38px] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 bg-surface-0">
            <button
              type="button"
              disabled={isVerifyingAiModel || isDownloadingAiModel}
              onClick={() => void verifyAiModelIntegrity()}
              className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent disabled:opacity-50 rounded-xs text-[11px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1.5 shrink-0 whitespace-nowrap cursor-pointer"
            >
              <ShieldCheck className="w-3 h-3 text-accent-fg shrink-0" />
              <span>
                {isVerifyingAiModel ? "Verifying..." : "Verify SHA-256 Checksums"}
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {!confirmClearData && (
                <button
                  type="button"
                  disabled={isDownloadingAiModel || isAnalyzingAi}
                  onClick={() =>
                    void removeAiModel({
                      includeRuntime: false,
                      clearAiData: false,
                    })
                  }
                  className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent disabled:opacity-50 rounded-xs text-[11px] font-medium text-fg-2 hover:text-accent-fg inline-flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
                  title="Delete .onnx model while keeping analyzed embeddings"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  <span>Remove Model</span>
                </button>
              )}
              <InlineConfirmDeleteButton
                isConfirming={confirmClearData}
                disabled={isDownloadingAiModel || isAnalyzingAi}
                onRequest={() => setConfirmClearData(true)}
                onConfirm={() => {
                  setConfirmClearData(false);
                  void removeAiModel({
                    includeRuntime: false,
                    clearAiData: true,
                  });
                }}
                onCancel={() => setConfirmClearData(false)}
                idleLabel="Purge AI Index"
                confirmLabel="Confirm Remove Model + Embeddings"
                cancelLabel="Cancel"
                deleteTitle="Remove model and purge all AI embeddings & pending suggestions"
                confirmTitle="Confirm removing model and purging all AI embeddings"
                idleClassName="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent disabled:opacity-50 rounded-xs text-[11px] font-medium text-fg-2 hover:text-accent-fg inline-flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
