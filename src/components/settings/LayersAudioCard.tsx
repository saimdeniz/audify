import React from "react";
import { ExternalLink, FolderOpen, RotateCcw } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { ToggleRow } from "./ToggleRow";

/**
 * Settings -> Audio card for Layers export directory and auto-save on NLE drag.
 * Shares identical header/row dimensions (`h-[34px]`, `h-[38px]`, `px-3`) with sibling Audio cards.
 */
export const LayersAudioCard: React.FC = () => {
  const customLayerExportPath = useSampleStore((s) => s.customLayerExportPath);
  const autoSaveLayerOnNleDrag = useSampleStore(
    (s) => s.autoSaveLayerOnNleDrag
  );

  const setCustomLayerExportPath = useSampleStore(
    (s) => s.setCustomLayerExportPath
  );
  const pickCustomLayerExportPath = useSampleStore(
    (s) => s.pickCustomLayerExportPath
  );
  const openLayersFolder = useSampleStore((s) => s.openLayersFolder);
  const setAutoSaveLayerOnNleDrag = useSampleStore(
    (s) => s.setAutoSaveLayerOnNleDrag
  );

  return (
    <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
      <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
          LAYERS &amp; MIX EXPORT
        </span>
      </div>

      <div className="divide-y divide-line">
        {/* Layer export path */}
        <div className="h-[38px] px-3 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-fg shrink-0">
            Layer export path
          </span>
          <div className="flex items-center space-x-1.5 min-w-0 flex-1 max-w-[340px]">
            <div
              className="flex-1 min-w-0 h-[24px] px-2 bg-surface-2 border border-line rounded-xs flex items-center font-mono text-[10.5px] text-fg-2 truncate"
              title={
                customLayerExportPath || "Default portable path: user/layers"
              }
            >
              <span className="truncate">
                {customLayerExportPath || "user/layers (Default)"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void pickCustomLayerExportPath()}
              className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg flex items-center justify-center transition-colors cursor-pointer"
              title="Browse custom layers export folder"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void openLayersFolder()}
              className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg flex items-center justify-center transition-colors cursor-pointer"
              title="Open layers export folder in Explorer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCustomLayerExportPath("")}
              disabled={!customLayerExportPath}
              className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
              title="Reset to default portable path (user/layers)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Auto-save layer on NLE drag */}
        <ToggleRow
          label="Auto-save layer on NLE drag"
          description="Saves dragged mixes permanently into your Layers folder instead of preview cache"
          checked={autoSaveLayerOnNleDrag}
          onChange={setAutoSaveLayerOnNleDrag}
          title="Save layer WAV & recipe permanently when dragging directly to Premiere / Resolve"
        />
      </div>
    </div>
  );
};
