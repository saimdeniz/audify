import React from "react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  SliceTrashActionControls,
  TrashActionToolbarStrip,
} from "./SliceTrashActionControls";

interface TrashGeneralControlsProps {
  compact?: boolean;
}

/**
 * Contextual Trash quarantine actions rendered dynamically on row 2 of
 * Filters -> General only while `trashFilterActive` is enabled.
 */
export const TrashGeneralControls: React.FC<TrashGeneralControlsProps> = ({
  compact = false,
}) => {
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedTotalBytes = useSampleStore((s) => s.trashedTotalBytes);
  const trashedLayerCount = useSampleStore((s) => s.trashedLayerCount);
  const trashedLayerTotalBytes = useSampleStore((s) => s.trashedLayerTotalBytes);
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const selectedLayerIds = useSampleStore((s) => s.selectedLayerIds);
  const trashOpStatus = useSampleStore((s) => s.trashOpStatus);

  const restoreSamplesFromTrash = useSampleStore(
    (s) => s.restoreSamplesFromTrash
  );
  const emptyAudifyTrash = useSampleStore((s) => s.emptyAudifyTrash);
  const restoreTrashedLayers = useSampleStore((s) => s.restoreTrashedLayers);
  const emptyTrashedLayers = useSampleStore((s) => s.emptyTrashedLayers);

  if (trashViewTab === "slices") {
    return <SliceTrashActionControls compact={compact} />;
  }

  if (trashViewTab === "layers") {
    return (
      <TrashActionToolbarStrip
        compact={compact}
        trashedCount={trashedLayerCount}
        trashedTotalBytes={trashedLayerTotalBytes}
        selectedIds={selectedLayerIds}
        trashOpStatus={trashOpStatus}
        itemNoun="layer"
        preservedSummarySuffix="Layer recipe & favorites preserved until emptied"
        restoreSelectedTitle="Restore selected layers to their original export folder"
        restoreAllTitle="Restore all trashed layers to their original export folder"
        emptyTitle="Send trashed layers to Windows OS Recycle Bin"
        onRestoreSelected={(ids) => void restoreTrashedLayers(ids)}
        onRestoreAll={() => void restoreTrashedLayers()}
        onEmptyAll={() => void emptyTrashedLayers()}
      />
    );
  }

  return (
    <TrashActionToolbarStrip
      compact={compact}
      trashedCount={trashedCount}
      trashedTotalBytes={trashedTotalBytes}
      selectedIds={selectedSampleIds}
      trashOpStatus={trashOpStatus}
      itemNoun="file"
      preservedSummarySuffix="Favorites & tags preserved until emptied"
      restoreSelectedTitle="Restore selected files to their original folders"
      restoreAllTitle="Restore all trashed files to their original folders"
      emptyTitle="Send trashed files to Windows OS Recycle Bin"
      onRestoreSelected={(ids) => void restoreSamplesFromTrash(ids)}
      onRestoreAll={() => void restoreSamplesFromTrash()}
      onEmptyAll={() => void emptyAudifyTrash()}
    />
  );
};
