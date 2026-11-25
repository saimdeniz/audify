import { open } from "@tauri-apps/plugin-dialog";
import { invokeCommand } from "../../utils/tauriCommands";
import { postCrossWindowSync } from "../storageHelpers";
import type { StoreSliceContext } from "../types";
import type { AiSliceActions } from "./aiSlice";

export type AiModelLifecycleActions = Pick<
  AiSliceActions,
  | "fetchAiModelStatus"
  | "verifyAiModelIntegrity"
  | "downloadAiModel"
  | "cancelAiDownload"
  | "importAiModelFile"
  | "removeAiModel"
>;

/**
 * Local ONNX model & runtime lifecycle actions extracted from `aiSlice`
 * to keep store modules focused and under size budgets.
 */
export function createAiModelLifecycleActions(
  ctx: StoreSliceContext,
  cancelPendingSimilaritySearch?: () => void
): AiModelLifecycleActions {
  const { set, get, getProfileEpoch, emitNotice } = ctx;

  const buildClearedAiDataPatch = () => {
    cancelPendingSimilaritySearch?.();
    const prevSim = get().similaritySession;
    const prevSortKey = get().sortKey;
    return {
      aiSuggestionsBySampleId: {},
      similaritySession: null,
      externalSimilarityPendingFile: null,
      ...(prevSim
        ? {
            sortKey:
              prevSim.prevSortKey === "match" ? null : prevSim.prevSortKey,
            sortDir: prevSim.prevSortDir,
          }
        : prevSortKey === "match"
        ? { sortKey: null }
        : {}),
    };
  };

  return {
    fetchAiModelStatus: async () => {
      const epoch = getProfileEpoch();
      try {
        const status = await invokeCommand("get_ai_model_status", {});
        if (!status || typeof status !== "object") {
          return null;
        }
        if (epoch !== getProfileEpoch()) {
          return null;
        }
        set({
          aiModelStatus: status,
          pendingAiSuggestionsCount: status.pending_suggestions_count ?? 0,
        });
        return status;
      } catch (err) {
        console.error("Failed loading AI model status:", err);
        return null;
      }
    },

    verifyAiModelIntegrity: async () => {
      if (get().isVerifyingAiModel) return;
      const epoch = getProfileEpoch();
      set({ isVerifyingAiModel: true });
      try {
        const status = await invokeCommand("verify_ai_model_integrity", {});
        if (epoch !== getProfileEpoch()) {
          set({ isVerifyingAiModel: false });
          return;
        }
        set({
          aiModelStatus: status,
          pendingAiSuggestionsCount: status.pending_suggestions_count,
          isVerifyingAiModel: false,
        });
        if (status.ready && status.model_sha256_ok && status.runtime_sha256_ok) {
          emitNotice("AI engine & model SHA-256 checksums verified.", "success");
        } else if (status.ready && status.is_custom_model) {
          emitNotice("Custom ONNX model & runtime verified.", "success");
        } else {
          emitNotice(
            "AI engine verification found missing or modified files.",
            "error"
          );
        }
      } catch (err) {
        set({ isVerifyingAiModel: false });
        if (epoch !== getProfileEpoch()) return;
        emitNotice(`AI verify failed: ${String(err)}`, "error");
      }
    },

    downloadAiModel: async () => {
      if (get().isDownloadingAiModel) return;
      const epoch = getProfileEpoch();
      set({
        isDownloadingAiModel: true,
        aiDownloadProgress: {
          stage: "runtime",
          downloaded_bytes: 0,
          total_bytes: 0,
          percentage: 0,
        },
        statusMessage: "Downloading ONNX Runtime & YAMNet AudioSet model...",
      });
      try {
        const status = await invokeCommand("download_ai_model", {});
        if (epoch !== getProfileEpoch()) {
          set({ isDownloadingAiModel: false, aiDownloadProgress: null });
          return;
        }
        set({
          aiModelStatus: status,
          pendingAiSuggestionsCount: status.pending_suggestions_count,
          isDownloadingAiModel: false,
          aiDownloadProgress: null,
          statusMessage: "Local AI Audio Engine is ready.",
        });
        emitNotice("YAMNet AI model & ONNX Runtime installed cleanly.", "success");
        postCrossWindowSync("catalog");
      } catch (err) {
        set({ isDownloadingAiModel: false, aiDownloadProgress: null });
        if (epoch !== getProfileEpoch()) return;
        const msg = String(err);
        if (msg.toLowerCase().includes("cancel")) {
          emitNotice("AI download canceled.", "info");
        } else {
          emitNotice(`AI download failed: ${msg}`, "error");
        }
      }
    },

    cancelAiDownload: async () => {
      try {
        await invokeCommand("cancel_ai_download", {});
      } catch (err) {
        console.error("Failed canceling AI download:", err);
      }
    },

    importAiModelFile: async (kind) => {
      const epoch = getProfileEpoch();
      try {
        const selected = await open({
          directory: false,
          multiple: false,
          title:
            kind === "onnx"
              ? "Select Local ONNX Model (.onnx)"
              : "Select ONNX Runtime DLL (onnxruntime.dll)",
          filters:
            kind === "onnx"
              ? [{ name: "ONNX Model", extensions: ["onnx"] }]
              : [{ name: "ONNX Runtime DLL", extensions: ["dll"] }],
        });
        if (!selected || typeof selected !== "string") return;

        const status = await invokeCommand("import_ai_model_file", {
          sourcePath: selected,
          kind,
        });
        if (epoch !== getProfileEpoch()) return;
        set({
          aiModelStatus: status,
          pendingAiSuggestionsCount: status.pending_suggestions_count,
        });
        emitNotice(
          kind === "onnx"
            ? "Imported local ONNX audio model."
            : "Imported local ONNX Runtime library.",
          "success"
        );
        postCrossWindowSync("catalog");
      } catch (err) {
        if (epoch !== getProfileEpoch()) return;
        emitNotice(`AI file import failed: ${String(err)}`, "error");
      }
    },

    removeAiModel: async (opts) => {
      const epoch = getProfileEpoch();
      const clearAiData = opts?.clearAiData ?? false;
      try {
        const status = await invokeCommand("remove_ai_model", {
          includeRuntime: opts?.includeRuntime ?? false,
          clearAiData,
        });
        if (epoch !== getProfileEpoch()) return;
        set({
          aiModelStatus: status,
          pendingAiSuggestionsCount: status.pending_suggestions_count,
          ...(clearAiData ? buildClearedAiDataPatch() : {}),
        });
        emitNotice(
          clearAiData
            ? "Removed AI model files and cleared cached embeddings/suggestions."
            : "Removed AI model files from user/models.",
          "info"
        );
        postCrossWindowSync("catalog");
      } catch (err) {
        if (epoch !== getProfileEpoch()) return;
        // Partial delete (e.g. yamnet.onnx removed + DB cleared while loaded onnxruntime.dll stays locked on Windows)
        if (clearAiData) {
          set(buildClearedAiDataPatch());
        }
        await get().fetchAiModelStatus();
        postCrossWindowSync("catalog");
        emitNotice(`Failed removing AI assets: ${String(err)}`, "error");
      }
    },
  };
}
