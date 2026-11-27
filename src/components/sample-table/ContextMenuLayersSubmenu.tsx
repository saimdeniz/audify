import React from "react";
import { Layers, ListPlus, Plus, SlidersHorizontal } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem } from "../../types";
import { MenuItem } from "../common/MenuItem";
import type { ContextMenuState } from "./tableLayout";

interface ContextMenuLayersSubmenuProps {
  submenuPositionClass: string;
  targetSamples: SampleItem[];
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

/**
 * Hover submenu under `Layers ▸` in `SampleContextMenu`, matching
 * `ContextMenuCollectionSubmenu` / `ContextMenuTagSubmenu` geometry and theme tokens.
 */
export const ContextMenuLayersSubmenu: React.FC<ContextMenuLayersSubmenuProps> = ({
  submenuPositionClass,
  targetSamples,
  setContextMenu,
}) => {
  const layerDraftName = useSampleStore((s) => s.layerDraftName);
  const hasDraftClips = useSampleStore((s) => s.layerDraftRecipe.clips.length > 0);
  const sendSamplesToLayers = useSampleStore((s) => s.sendSamplesToLayers);
  const setLayersFilterActive = useSampleStore((s) => s.setLayersFilterActive);

  const count = targetSamples.length;
  const suffix = count > 1 ? ` (${count})` : "";

  return (
    <div
      role="menu"
      aria-label="Layers options"
      className={`absolute ${submenuPositionClass} w-[238px] bg-surface-2 border border-line-strong rounded-md py-1 text-[11.5px] text-fg shadow-2xl z-30`}
    >
      <MenuItem
        compactHeight
        tone="accent"
        icon={<Layers className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label={
          hasDraftClips
            ? `Add${suffix} to "${layerDraftName}"`
            : `Send${suffix} to Layers`
        }
        onClick={() => {
          setContextMenu(null);
          void sendSamplesToLayers(targetSamples, "current");
        }}
      />

      <MenuItem
        compactHeight
        tone="accent"
        icon={<Plus className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label={`Create New Layer${suffix}`}
        onClick={() => {
          setContextMenu(null);
          void sendSamplesToLayers(targetSamples, "new");
        }}
      />

      {hasDraftClips && (
        <MenuItem
          compactHeight
          tone="accent"
          icon={<ListPlus className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
          label={`Add${suffix} to Active Lane`}
          onClick={() => {
            setContextMenu(null);
            void sendSamplesToLayers(targetSamples, "active-lane");
          }}
        />
      )}

      <div className="my-1 border-t border-line" />

      <MenuItem
        compactHeight
        tone="accent"
        icon={<SlidersHorizontal className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
        label="Open Layers Studio"
        onClick={() => {
          setContextMenu(null);
          setLayersFilterActive(true, "editor");
        }}
      />
    </div>
  );
};
