import React, { useMemo } from "react";
import {
  Eye,
  EyeOff,
  FolderOpen,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

interface LayerGeneralControlsProps {
  compact?: boolean;
}

/**
 * Contextual Layers management bar rendered on row 2 of `Filters -> Tools -> Layers`
 * with exact structural parity to `SliceGeneralControls`.
 */
export const LayerGeneralControls: React.FC<LayerGeneralControlsProps> = ({
  compact = false,
}) => {
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const layersWorkspaceTab = useSampleStore((s) => s.layersWorkspaceTab);
  const isMiniDock = useSampleStore((s) => s.isMiniDock);
  const layerHideMissing = useSampleStore((s) => s.layerHideMissing);
  const customLayerExportPath = useSampleStore((s) => s.customLayerExportPath);

  const setLayersWorkspaceTab = useSampleStore((s) => s.setLayersWorkspaceTab);
  const toggleMiniDock = useSampleStore((s) => s.toggleMiniDock);
  const resetLayerDraft = useSampleStore((s) => s.resetLayerDraft);
  const setLayerHideMissing = useSampleStore((s) => s.setLayerHideMissing);
  const openLayersFolder = useSampleStore((s) => s.openLayersFolder);
  const clearMissingLayers = useSampleStore((s) => s.clearMissingLayers);

  const { readyCount, missingCount } = useMemo(() => {
    let missing = 0;
    for (const item of layerHistory) {
      if (!item.file_exists) missing++;
    }
    return {
      readyCount: layerHistory.length - missing,
      missingCount: missing,
    };
  }, [layerHistory]);

  const btnHeight = compact
    ? "h-[22px] px-1.5 text-[10px]"
    : "h-[24px] px-2 text-[10.5px]";

  // Mini Dock always shows Saved Layers; clicking Open Editor or New Layer exits Mini Dock into Main Editor
  const isEditor = !isMiniDock && layersWorkspaceTab === "editor";

  const handleOpenOrToggleEditor = () => {
    if (isMiniDock) {
      setLayersWorkspaceTab("editor");
      void toggleMiniDock();
      return;
    }
    setLayersWorkspaceTab(isEditor ? "saved" : "editor");
  };

  const handleNewLayer = () => {
    resetLayerDraft();
    setLayersWorkspaceTab("editor");
    if (isMiniDock) {
      void toggleMiniDock();
    }
  };

  return (
    <div
      className={`border-t border-line flex flex-1 flex-wrap items-start justify-between w-full ${
        compact ? "pt-1.5 mt-0.5 gap-1" : "pt-2 mt-0.5 gap-1.5"
      }`}
    >
      <div className={`flex items-center flex-wrap ${compact ? "gap-1" : "gap-1.5"}`}>
      <button
        type="button"
        onClick={handleOpenOrToggleEditor}
        className={`${btnHeight} rounded-[3px] border inline-flex items-center gap-1 font-mono font-medium cursor-pointer transition-colors shrink-0 ${
          isEditor
            ? "bg-accent-soft border-accent text-accent-fg"
            : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        }`}
        title={
          isEditor
            ? `Layers Editor active (click to return to Saved Layers · ${layerHistory.length})`
            : isMiniDock
            ? "Expand to Main View and open Layers Timeline Editor"
            : "Open DaVinci-style Layers Timeline Editor"
        }
      >
        <SlidersHorizontal className="w-3 h-3 shrink-0" />
        <span>Editor</span>
      </button>

      <button
        type="button"
        onClick={handleNewLayer}
        className={`${btnHeight} rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0`}
        title={
          isMiniDock
            ? "Expand to Main View and start a fresh Layer draft"
            : "Start a fresh empty Layer draft in the Timeline Editor"
        }
      >
        <Plus className="w-3 h-3 shrink-0" />
        <span>New Layer</span>
      </button>

      {!isEditor && (
        <button
          type="button"
          onClick={() => setLayerHideMissing(!layerHideMissing)}
          className={`${btnHeight} rounded-[3px] border inline-flex items-center gap-1 font-mono font-medium cursor-pointer transition-colors shrink-0 ${
            layerHideMissing
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
          }`}
          title={
            layerHideMissing
              ? "Missing layers hidden (click to show missing entries)"
              : "Hide layer records whose exported WAV file was removed from disk"
          }
        >
          {layerHideMissing ? (
            <EyeOff className="w-3 h-3 shrink-0" />
          ) : (
            <Eye className="w-3 h-3 shrink-0" />
          )}
          <span>Hide Missing</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => void openLayersFolder()}
        className={`${btnHeight} rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0`}
        title={`Open layers export folder (${customLayerExportPath || "user/layers"})`}
      >
        <FolderOpen className="w-3 h-3 shrink-0" />
        <span>Open Folder</span>
      </button>

      {!isEditor && (
        <button
          type="button"
          onClick={() => void clearMissingLayers()}
          disabled={missingCount === 0}
          className={`${btnHeight} rounded-[3px] bg-surface-3 border border-line hover:bg-accent-soft hover:border-accent text-fg-2 hover:text-accent-fg font-mono font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0`}
          title="Remove saved layer records whose exported WAV files no longer exist on disk"
        >
          <Trash2 className="w-3 h-3 shrink-0" />
          <span>Clear Missing ({missingCount})</span>
        </button>
      )}
      </div>

      <div className="ml-auto self-end flex items-center gap-1.5 font-mono text-[10px] shrink-0">
        <span className="text-fg-3 truncate">
          {compact
            ? `${readyCount} ready · ${missingCount} missing`
            : `${readyCount.toLocaleString()} ready · ${missingCount.toLocaleString()} missing · ${
                customLayerExportPath || "user/layers"
              }`}
        </span>
      </div>
    </div>
  );
};
