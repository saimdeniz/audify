import React from "react";
import {
  CopyCheck,
  FileCheck2,
  Folder,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  Loader2,
  Scissors,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type {
  Collection,
  DuplicateScanProgressPayload,
  DuplicateScanResult,
  FavoritesViewTab,
  LicenseGroup,
  TrashOpStatus,
  TrashViewTab,
} from "../../types";
import { formatBytesCompact } from "../../utils/format";
import { formatTrashOpLabel } from "../../utils/trashStatusFormat";

export interface ActiveFilterChipProps {
  children: React.ReactNode;
  title?: string;
  strongBorder?: boolean;
  mono?: boolean;
  onRemove?: () => void;
  removeTitle?: string;
}

export const ActiveFilterChip: React.FC<ActiveFilterChipProps> = ({
  children,
  title,
  strongBorder = false,
  mono = false,
  onRemove,
  removeTitle,
}) => (
  <span
    className={`inline-flex items-center gap-1.5 h-[20px] ${
      onRemove ? "pl-1.5 pr-1" : "px-2"
    } rounded-[3px] border ${
      strongBorder ? "border-accent" : "border-accent/50"
    } bg-accent-soft text-accent-fg text-[11px] ${mono ? "font-mono" : ""}`}
    title={title}
  >
    {children}
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        className="w-3.5 h-3.5 rounded-[2px] flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3"
        title={removeTitle}
        aria-label={removeTitle}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    )}
  </span>
);

interface ActiveFilterPrimaryChipsProps {
  folderFilter: string | null;
  folderDisplayName: string | null;
  activeCollection: Collection | null;
  activeLicenseGroup: LicenseGroup | null;
  favoriteOnly: boolean;
  favoritesViewTab: FavoritesViewTab;
  recentOnly: boolean;
  binFilterActive: boolean;
  trashFilterActive: boolean;
  trashViewTab: TrashViewTab;
  trashOpStatus: TrashOpStatus | null;
  trashedCount: number;
  trashedTotalBytes: number;
  trashedSliceCount: number;
  trashedSliceTotalBytes: number;
  trashedLayerCount: number;
  trashedLayerTotalBytes: number;
  layersFilterActive: boolean;
  layerHistoryCount: number;
  slicesFilterActive: boolean;
  sliceHistoryCount: number;
  sliceFavoriteOnly: boolean;
  slicePitchOnly: boolean;
  duplicatesFilterActive: boolean;
  isScanningDuplicates: boolean;
  duplicateScanProgress: DuplicateScanProgressPayload | null;
  duplicateScanError: string | null;
  duplicateScanResult: DuplicateScanResult | null;
  onClearFolder: () => void;
  onClearCollection: () => void;
  onClearLicenseGroup: () => void;
  onClearFavorite: () => void;
  onClearRecent: () => void;
  onClearBin: () => void;
  onClearTrash: () => void;
  onClearLayers: () => void;
  onClearSlices: () => void;
  onClearSliceFavorite: () => void;
  onClearSlicePitch: () => void;
  onClearDuplicates: () => void;
}

export const ActiveFilterPrimaryChips: React.FC<ActiveFilterPrimaryChipsProps> = ({
  folderFilter,
  folderDisplayName,
  activeCollection,
  activeLicenseGroup,
  favoriteOnly,
  favoritesViewTab,
  recentOnly,
  binFilterActive,
  trashFilterActive,
  trashViewTab,
  trashOpStatus,
  trashedCount,
  trashedTotalBytes,
  trashedSliceCount,
  trashedSliceTotalBytes,
  trashedLayerCount,
  trashedLayerTotalBytes,
  layersFilterActive,
  layerHistoryCount,
  slicesFilterActive,
  sliceHistoryCount,
  sliceFavoriteOnly,
  slicePitchOnly,
  duplicatesFilterActive,
  isScanningDuplicates,
  duplicateScanProgress,
  duplicateScanError,
  duplicateScanResult,
  onClearFolder,
  onClearCollection,
  onClearLicenseGroup,
  onClearFavorite,
  onClearRecent,
  onClearBin,
  onClearTrash,
  onClearLayers,
  onClearSlices,
  onClearSliceFavorite,
  onClearSlicePitch,
  onClearDuplicates,
}) => (
  <>
    {folderFilter && (
      <ActiveFilterChip
        title={`Folder: ${folderFilter}`}
        onRemove={onClearFolder}
        removeTitle="Remove folder filter"
      >
        <Folder className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[160px]">{folderDisplayName}</span>
      </ActiveFilterChip>
    )}

    {activeCollection && (
      <ActiveFilterChip
        title={
          activeCollection.smart_query
            ? `Smart Collection: ${activeCollection.smart_query}`
            : undefined
        }
        onRemove={onClearCollection}
        removeTitle="Remove collection filter"
      >
        {activeCollection.smart_query ? (
          <Zap className="w-3 h-3 shrink-0" />
        ) : (
          <LayoutGrid className="w-3 h-3 shrink-0" />
        )}
        <span className="truncate max-w-[150px]">{activeCollection.name}</span>
      </ActiveFilterChip>
    )}

    {activeLicenseGroup && (
      <ActiveFilterChip
        onRemove={onClearLicenseGroup}
        removeTitle="Remove license filter"
      >
        <FileCheck2 className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[150px]">{activeLicenseGroup.name}</span>
      </ActiveFilterChip>
    )}

    {favoriteOnly && (
      <ActiveFilterChip
        onRemove={onClearFavorite}
        removeTitle="Remove Favorites filter"
      >
        <Star className="w-3 h-3 fill-current shrink-0" />
        <span>
          {favoritesViewTab === "slices"
            ? "Favorites · Slices"
            : favoritesViewTab === "layers"
            ? "Favorites · Layers"
            : "Favorites"}
        </span>
      </ActiveFilterChip>
    )}

    {recentOnly && (
      <ActiveFilterChip
        onRemove={onClearRecent}
        removeTitle="Remove Recent filter"
      >
        <History className="w-3 h-3 shrink-0" />
        <span>Recent</span>
      </ActiveFilterChip>
    )}

    {binFilterActive && (
      <ActiveFilterChip
        onRemove={onClearBin}
        removeTitle="Remove Session Bin filter"
      >
        <Inbox className="w-3 h-3 shrink-0" />
        <span>Session Bin</span>
      </ActiveFilterChip>
    )}

    {trashFilterActive ? (
      <ActiveFilterChip
        title="Trash — Favorites, Tags, Genres & Collections are preserved until emptied"
        onRemove={trashOpStatus ? undefined : onClearTrash}
        removeTitle="Exit Trash view"
      >
        {trashOpStatus ? (
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        ) : (
          <Trash2 className="w-3 h-3 shrink-0" />
        )}
        <span>
          {trashOpStatus
            ? `Trash · ${formatTrashOpLabel(trashOpStatus)}`
            : trashViewTab === "slices"
              ? `Trash · Slices · ${trashedSliceCount.toLocaleString()} ${
                  trashedSliceCount === 1 ? "slice" : "slices"
                } · ${formatBytesCompact(trashedSliceTotalBytes)}`
              : trashViewTab === "layers"
                ? `Trash · Layers · ${trashedLayerCount.toLocaleString()} ${
                    trashedLayerCount === 1 ? "layer" : "layers"
                  } · ${formatBytesCompact(trashedLayerTotalBytes)}`
                : `Trash · ${trashedCount.toLocaleString()} ${
                    trashedCount === 1 ? "file" : "files"
                  } · ${formatBytesCompact(trashedTotalBytes)}`}
        </span>
      </ActiveFilterChip>
    ) : (
      trashOpStatus && (
        <ActiveFilterChip>
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>{formatTrashOpLabel(trashOpStatus)}</span>
        </ActiveFilterChip>
      )
    )}

    {layersFilterActive && (
      <ActiveFilterChip
        strongBorder
        title="Layers Multi-Track SFX Studio"
        onRemove={onClearLayers}
        removeTitle="Exit Layers Studio"
      >
        <Layers className="w-3 h-3 shrink-0" />
        <span>Layers · {layerHistoryCount.toLocaleString()} saved</span>
      </ActiveFilterChip>
    )}

    {slicesFilterActive && (
      <>
        <ActiveFilterChip
          strongBorder
          title="Saved slices · Click row to preview · Click Source Track (↗) to open original track · F2 Rename · Del Trash · Ctrl+Z Undo"
          onRemove={onClearSlices}
          removeTitle="Exit Slices view"
        >
          <Scissors className="w-3 h-3 shrink-0" />
          <span>Slices · {sliceHistoryCount.toLocaleString()}</span>
        </ActiveFilterChip>
        {sliceFavoriteOnly && (
          <ActiveFilterChip
            onRemove={onClearSliceFavorite}
            removeTitle="Clear slice favorites filter"
          >
            <Star className="w-3 h-3 fill-current shrink-0" />
            <span>Favorites</span>
          </ActiveFilterChip>
        )}
        {slicePitchOnly && (
          <ActiveFilterChip
            onRemove={onClearSlicePitch}
            removeTitle="Clear slice pitch filter"
          >
            <span>Pitch / FX</span>
          </ActiveFilterChip>
        )}
      </>
    )}

    {duplicatesFilterActive && (
      <ActiveFilterChip
        title={
          duplicateScanError
            ? `Duplicate scan failed: ${duplicateScanError}`
            : duplicateScanResult
            ? `${duplicateScanResult.groups_found} groups · ${duplicateScanResult.duplicate_files_count} extra files (${formatBytesCompact(duplicateScanResult.reclaimable_bytes)})`
            : "Duplicates filter active"
        }
        onRemove={onClearDuplicates}
        removeTitle="Exit Duplicates view"
      >
        <CopyCheck className="w-3 h-3 shrink-0" />
        <span>
          {isScanningDuplicates
            ? duplicateScanProgress
              ? `${duplicateScanProgress.stage_label} (${Math.min(
                  100,
                  Math.max(0, Math.round(duplicateScanProgress.percentage))
                )}%)`
              : "Scanning duplicates..."
            : duplicateScanError
            ? "Duplicates (Error)"
            : duplicateScanResult
            ? `Duplicates · ${duplicateScanResult.groups_found.toLocaleString()} ${
                duplicateScanResult.groups_found === 1 ? "group" : "groups"
              } · ${formatBytesCompact(duplicateScanResult.reclaimable_bytes)}`
            : "Duplicates"}
        </span>
      </ActiveFilterChip>
    )}
  </>
);
