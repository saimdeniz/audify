import React, { useEffect, useState } from "react";
import { Check, Film, X } from "lucide-react";
import { folderNameFromPath } from "../../utils/format";
import {
  evictThumbnailCache,
  getCachedThumbnailUrl,
  getVideoWallpaperExtBadge,
  getWallpaperThumbnailUrl,
  isGifWallpaperPath,
  isVideoWallpaperPath,
} from "../../utils/thumbnailCache";
import { evictBlurredWallpaperCache } from "../../utils/wallpaperBlurCache";

export interface WallpaperTileProps {
  filePath: string;
  subfolder: string;
  isSelected: boolean;
  onSelect: (filePath: string) => void;
  onDelete: (filePath: string) => void;
}

export const WallpaperTile: React.FC<WallpaperTileProps> = React.memo(
  ({ filePath, subfolder, isSelected, onSelect, onDelete }) => {
    const [thumbUrl, setThumbUrl] = useState<string>(
      () => getCachedThumbnailUrl(filePath) || ""
    );

    useEffect(() => {
      let active = true;
      const cached = getCachedThumbnailUrl(filePath);
      if (cached) {
        setThumbUrl(cached);
      } else {
        void getWallpaperThumbnailUrl(filePath).then((url) => {
          if (active) setThumbUrl(url);
        });
      }
      return () => {
        active = false;
      };
    }, [filePath]);

    const fileName = folderNameFromPath(filePath, "Wallpaper");
    const isGif = isGifWallpaperPath(filePath);
    const isVideo = isVideoWallpaperPath(filePath);
    const videoBadge = getVideoWallpaperExtBadge(filePath);
    const mediaBadge = isGif ? "GIF" : videoBadge;
    const mediaKindHint = isGif
      ? " (Animated GIF)"
      : isVideo
        ? ` (Loop ${videoBadge ?? "Video"})`
        : "";
    const subLower = subfolder.toLowerCase();
    const showFolderBadge =
      Boolean(subfolder) &&
      !(isGif && subLower === "gifs") &&
      !(isVideo && subLower === "videos");

    return (
      <div
        className={`group relative aspect-video w-full rounded-xs border overflow-hidden cursor-pointer ${
          isSelected
            ? "border-accent ring-1 ring-accent"
            : "border-line hover:border-accent"
        }`}
        onClick={() => onSelect(filePath)}
        title={
          subfolder
            ? `${subfolder}/${fileName}${mediaKindHint}`
            : `${fileName}${mediaKindHint}`
        }
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={fileName}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <div className="w-full h-full bg-surface-3 flex items-center justify-center">
            {isVideo && <Film className="w-4 h-4 text-fg-3" />}
          </div>
        )}

        {isSelected && (
          <div className="absolute top-1 left-1 w-3.5 h-3.5 rounded-full bg-accent text-accent-on flex items-center justify-center shadow-xs pointer-events-none">
            <Check className="w-2.5 h-2.5 stroke-[3]" />
          </div>
        )}

        {showFolderBadge && (
          <span className="absolute bottom-1 left-1 max-w-[70%] truncate px-1 py-[1px] rounded-xs bg-surface-1 border border-line-strong font-mono text-[8px] font-medium text-fg-2 shadow-xs pointer-events-none">
            {subfolder}
          </span>
        )}

        {mediaBadge && (
          <span className="absolute bottom-1 right-1 px-1 py-[1px] rounded-xs bg-surface-1 border border-line-strong font-mono text-[8.5px] font-bold text-accent-fg uppercase tracking-wider shadow-xs pointer-events-none">
            {mediaBadge}
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            evictThumbnailCache(filePath);
            evictBlurredWallpaperCache(filePath);
            onDelete(filePath);
          }}
          className="absolute top-1 right-1 w-4 h-4 rounded-xs bg-surface-3 border border-line-strong hover:bg-accent hover:border-accent text-fg hover:text-accent-on flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          title="Delete wallpaper"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>
    );
  }
);
