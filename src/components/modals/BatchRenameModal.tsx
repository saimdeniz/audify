import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Pencil, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem } from "../../types";
import {
  BatchRenameConfig,
  buildBatchRenamePreview,
  createInitialBatchRenameConfig,
  DEFAULT_BATCH_RENAME_CONFIG,
} from "../../utils/batchRename";
import { splitFileNameAndExt } from "../../utils/format";
import { layerEntryToRenameAdapter } from "../../utils/layerHelpers";
import { useDialogFocusTrap } from "../../utils/modalFocus";
import { resolveSamplesByIds } from "../../utils/sampleLookup";
import { sliceEntryToRenameAdapter } from "../../utils/slicePreview";
import { BatchRenameControls } from "./BatchRenameControls";
import { BatchRenamePreviewPane } from "./BatchRenamePreviewPane";

function parentFolderKeyFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  return normalized.slice(0, lastSlash === 0 ? 1 : lastSlash).toLowerCase();
}

/**
 * Unified portal modal for both single-file and multi-file disk renaming
 * (New Name, Prefix/Suffix, Find & Replace, Pattern + Counter, Case transform,
 * collision safeguard, and live diff preview) with zero layout shift across tabs.
 */
export const BatchRenameModal: React.FC = () => {
  const batchRenameSampleIds = useSampleStore((s) => s.batchRenameSampleIds);
  const batchRenameSliceIds = useSampleStore((s) => s.batchRenameSliceIds);
  const batchRenameLayerIds = useSampleStore((s) => s.batchRenameLayerIds);
  const samples = useSampleStore((s) => s.samples);
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const libraries = useSampleStore((s) => s.libraries);
  const isMiniDock = useSampleStore((s) => s.isMiniDock);
  const closeBatchRenameModal = useSampleStore((s) => s.closeBatchRenameModal);
  const closeBatchRenameSlicesModal = useSampleStore(
    (s) => s.closeBatchRenameSlicesModal
  );
  const closeBatchRenameLayersModal = useSampleStore(
    (s) => s.closeBatchRenameLayersModal
  );
  const batchRenameSamples = useSampleStore((s) => s.batchRenameSamples);
  const batchRenameSlices = useSampleStore((s) => s.batchRenameSlices);
  const batchRenameLayers = useSampleStore((s) => s.batchRenameLayers);

  const [config, setConfig] = useState<BatchRenameConfig>(
    DEFAULT_BATCH_RENAME_CONFIG
  );
  const [isApplying, setIsApplying] = useState(false);

  const hasSampleIds = Boolean(batchRenameSampleIds && batchRenameSampleIds.length > 0);
  const hasSliceIds = Boolean(batchRenameSliceIds && batchRenameSliceIds.length > 0);
  const hasLayerIds = Boolean(batchRenameLayerIds && batchRenameLayerIds.length > 0);
  const isSliceMode = !hasSampleIds && hasSliceIds;
  const isLayerMode = !hasSampleIds && !hasSliceIds && hasLayerIds;
  const activeIds = isSliceMode
    ? batchRenameSliceIds
    : isLayerMode
    ? batchRenameLayerIds
    : batchRenameSampleIds;
  const closeModal = isSliceMode
    ? closeBatchRenameSlicesModal
    : isLayerMode
    ? closeBatchRenameLayersModal
    : closeBatchRenameModal;

  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = Boolean(activeIds && activeIds.length > 0);
  useDialogFocusTrap(isOpen, dialogRef);

  const selectedSamples = useMemo(() => {
    if (isSliceMode) {
      if (!batchRenameSliceIds || batchRenameSliceIds.length === 0) return [];
      const sliceMap = new Map(sliceHistory.map((s) => [s.id, s]));
      const out: SampleItem[] = [];
      for (const id of batchRenameSliceIds) {
        const hit = sliceMap.get(id);
        if (hit) out.push(sliceEntryToRenameAdapter(hit));
      }
      return out;
    }
    if (isLayerMode) {
      if (!batchRenameLayerIds || batchRenameLayerIds.length === 0) return [];
      const layerMap = new Map(layerHistory.map((l) => [l.id, l]));
      const out: SampleItem[] = [];
      for (const id of batchRenameLayerIds) {
        const hit = layerMap.get(id);
        if (hit) out.push(layerEntryToRenameAdapter(hit));
      }
      return out;
    }
    if (!batchRenameSampleIds || batchRenameSampleIds.length === 0) return [];
    const storeState = useSampleStore.getState();
    const primaryPool =
      storeState.allProfileSamples.length > 0
        ? storeState.allProfileSamples
        : samples;
    return resolveSamplesByIds(batchRenameSampleIds, primaryPool, samples);
  }, [
    isSliceMode,
    isLayerMode,
    batchRenameSliceIds,
    batchRenameLayerIds,
    sliceHistory,
    layerHistory,
    batchRenameSampleIds,
    samples,
  ]);

  const isSingle = selectedSamples.length === 1;
  const singleSplit = useMemo(
    () => (isSingle ? splitFileNameAndExt(selectedSamples[0].file_name) : null),
    [isSingle, selectedSamples]
  );

  useEffect(() => {
    if (isOpen) {
      setConfig(
        createInitialBatchRenameConfig(isSingle, singleSplit?.stem ?? "")
      );
      setIsApplying(false);
    }
  }, [isOpen, activeIds, isSingle, singleSplit?.stem]);

  const readOnlyLibraryIds = useMemo(() => {
    const ids = new Set<number>();
    if (isSliceMode || isLayerMode) return ids;
    for (const lib of libraries) {
      if (lib.is_read_only) ids.add(lib.id);
    }
    return ids;
  }, [isSliceMode, isLayerMode, libraries]);

  const siblingSamplesPool = useMemo(() => {
    if (isSliceMode) {
      const folderKeys = new Set<string>();
      for (const s of selectedSamples) {
        folderKeys.add(parentFolderKeyFromPath(s.file_path));
      }
      return sliceHistory
        .filter(
          (entry) =>
            entry.file_exists &&
            folderKeys.has(parentFolderKeyFromPath(entry.slice_path))
        )
        .map((entry) => sliceEntryToRenameAdapter(entry));
    }
    if (isLayerMode) {
      const folderKeys = new Set<string>();
      for (const s of selectedSamples) {
        folderKeys.add(parentFolderKeyFromPath(s.file_path));
      }
      return layerHistory
        .filter(
          (entry) =>
            entry.file_exists &&
            folderKeys.has(parentFolderKeyFromPath(entry.layer_path))
        )
        .map((entry) => layerEntryToRenameAdapter(entry));
    }
    const storeState = useSampleStore.getState();
    const catalogPool =
      storeState.allProfileSamples.length > 0
        ? storeState.allProfileSamples
        : samples;
    if (selectedSamples.length === 0) return catalogPool;
    const folderKeys = new Set<string>();
    for (const s of selectedSamples) {
      folderKeys.add(parentFolderKeyFromPath(s.file_path));
    }
    return catalogPool.filter((s) =>
      folderKeys.has(parentFolderKeyFromPath(s.file_path))
    );
  }, [isSliceMode, isLayerMode, sliceHistory, layerHistory, selectedSamples, samples]);

  const preview = useMemo(
    () =>
      buildBatchRenamePreview(selectedSamples, config, {
        readOnlyLibraryIds,
        catalogSamples: siblingSamplesPool,
      }),
    [selectedSamples, config, readOnlyLibraryIds, siblingSamplesPool]
  );

  const handleApply = async () => {
    if (!preview.canApply || isApplying) return;
    setIsApplying(true);
    try {
      if (isSliceMode) {
        const entries = preview.readyRows.map((row) => ({
          slice_id: row.sample.id,
          new_stem: row.finalStem,
        }));
        await batchRenameSlices(entries);
      } else if (isLayerMode) {
        const entries = preview.readyRows.map((row) => ({
          layer_id: row.sample.id,
          new_stem: row.finalStem,
        }));
        await batchRenameLayers(entries);
      } else {
        const entries = preview.readyRows.map((row) => ({
          sample_id: row.sample.id,
          new_stem: row.finalStem,
        }));
        await batchRenameSamples(entries);
      }
    } finally {
      setIsApplying(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isApplying) {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, isApplying, closeModal]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-modal-portal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isApplying) {
          closeModal();
        }
      }}
      className={`fixed inset-0 audify-modal-backdrop flex items-center justify-center select-none ${
        isMiniDock ? "p-2" : "p-2 sm:p-4"
      }`}
      style={{ zIndex: Z_INDEX.modalConfirm }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          isSliceMode
            ? isSingle
              ? "Rename Slice File"
              : "Batch Rename Slice Files"
            : isLayerMode
            ? isSingle
              ? "Rename Layer File"
              : "Batch Rename Layer Files"
            : isSingle
            ? "Rename Audio File"
            : "Batch Rename Audio Files"
        }
        tabIndex={-1}
        data-mica-overlay="true"
        className={`w-full max-w-[680px] flex flex-col rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-fg ${
          isMiniDock ? "h-[min(510px,94vh)]" : "h-[min(510px,86vh)]"
        }`}
      >
        {/* Fixed Header */}
        <div className="px-4 py-2.5 border-b border-line bg-surface-header flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Pencil className="w-4 h-4 text-accent-fg shrink-0" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-fg-head truncate">
              {isSliceMode
                ? isSingle
                  ? "RENAME SLICE"
                  : "BATCH RENAME SLICES"
                : isSingle
                ? "RENAME FILE"
                : "BATCH RENAME FILES"}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-xs bg-accent-soft text-accent-fg border border-accent shrink-0">
              {isSingle
                ? singleSplit?.ext
                  ? singleSplit.ext.slice(1).toUpperCase()
                  : "1 file"
                : `${selectedSamples.length} selected`}
            </span>
          </div>
          <button
            type="button"
            disabled={isApplying}
            onClick={closeModal}
            aria-label="Close Rename Dialog"
            className="w-6 h-6 flex items-center justify-center rounded-xs text-fg-3 hover:text-fg hover:bg-surface-3 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleApply();
          }}
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          {isSliceMode && (
            <div className="px-4 py-1.5 bg-warn/10 border-b border-warn/30 text-warn text-[10.5px] font-mono flex items-center gap-2 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Renaming changes the .wav filename on disk — DAW timeline clips referencing the old name may need relinking. Ctrl+Z reverts.
              </span>
            </div>
          )}
          <BatchRenameControls
            config={config}
            setConfig={setConfig}
            isSingle={isSingle}
            isCompact={isMiniDock}
            singleExt={singleSplit?.ext ?? ""}
            onReset={() =>
              setConfig(
                createInitialBatchRenameConfig(
                  isSingle,
                  singleSplit?.stem ?? ""
                )
              )
            }
          />

          <BatchRenamePreviewPane
            preview={preview}
            autoDisambiguate={config.autoDisambiguate}
            onEnableAutoDisambiguate={() =>
              setConfig((prev) => ({ ...prev, autoDisambiguate: true }))
            }
          />

          {/* Fixed Footer */}
          <div className="px-4 py-2.5 border-t border-line bg-surface-header flex items-center justify-between gap-2 shrink-0">
            <div className="font-mono text-[10px] text-fg-3">
              <span>{preview.changedCount} to rename</span>
              {preview.lockedCount > 0 && (
                <span className="ml-2 text-warn">
                  · {preview.lockedCount} skipped (Protected Vault)
                </span>
              )}
              <span className="ml-2">
                · Ctrl+Z {isSingle ? "reverts" : "reverts all"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isApplying}
                onClick={closeModal}
                className="h-[26px] px-3 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-2 hover:text-fg disabled:opacity-40 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!preview.canApply || isApplying}
                className="h-[26px] px-3 rounded-xs bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-on font-mono text-[11px] font-bold transition-colors cursor-pointer"
              >
                {isApplying
                  ? "Renaming..."
                  : isSliceMode
                  ? isSingle
                    ? "Rename Slice"
                    : `Rename ${preview.readyRows.length} Slice${
                        preview.readyRows.length === 1 ? "" : "s"
                      }`
                  : isLayerMode
                  ? isSingle
                    ? "Rename Layer"
                    : `Rename ${preview.readyRows.length} Layer${
                        preview.readyRows.length === 1 ? "" : "s"
                      }`
                  : isSingle
                  ? "Rename File"
                  : `Rename ${preview.readyRows.length} File${
                      preview.readyRows.length === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
