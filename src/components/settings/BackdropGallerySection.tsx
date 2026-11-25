import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Film,
  FolderOpen,
  Image as ImageIcon,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { hasActiveVisualBackdrop } from "../../store/storageHelpers";
import { ASCII_PRESETS } from "../../constants/asciiPresets";
import { folderNameFromPath } from "../../utils/format";
import {
  getVideoWallpaperExtBadge,
  isGifWallpaperPath,
  isVideoWallpaperPath,
} from "../../utils/thumbnailCache";
import { AsciiWallpaperSection } from "./AsciiWallpaperSection";
import { WallpaperTile } from "./WallpaperTile";

type UploadedMediaFilter = "all" | "image" | "video" | "gif";

function extractBgSubfolder(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const marker = "/images/";
  const idx = lower.lastIndexOf(marker);
  if (idx === -1) return "";
  const rel = normalized.slice(idx + marker.length);
  const lastSlash = rel.lastIndexOf("/");
  return lastSlash > 0 ? rel.slice(0, lastSlash) : "";
}

/**
 * Unified Studio Wallpaper Deck: Live ASCII Scenes & Uploaded Image/Video/GIF Wallpapers.
 */
export const WallpaperCanvasControl: React.FC = React.memo(() => {
  const wallpaperKind = useSampleStore((s) => s.wallpaperKind);
  const asciiPreset = useSampleStore((s) => s.asciiPreset);
  const asciiMagicSlug = useSampleStore((s) => s.asciiMagicSlug);
  const customBgImage = useSampleStore((s) => s.customBgImage);
  const customBgGallery = useSampleStore((s) => s.customBgGallery);

  const setWallpaperKind = useSampleStore((s) => s.setWallpaperKind);
  const setCustomBgImage = useSampleStore((s) => s.setCustomBgImage);
  const deleteCustomBgImage = useSampleStore((s) => s.deleteCustomBgImage);
  const openCustomBgFolder = useSampleStore((s) => s.openCustomBgFolder);
  const selectCustomBgImageFile = useSampleStore(
    (s) => s.selectCustomBgImageFile
  );
  const loadCustomBgGallery = useSampleStore((s) => s.loadCustomBgGallery);

  const [mediaFilter, setMediaFilter] = useState<UploadedMediaFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");

  useEffect(() => {
    void loadCustomBgGallery();
  }, [loadCustomBgGallery]);

  const {
    gifPaths,
    videoPaths,
    staticPaths,
    folderNames,
    folderCounts,
    rootCount,
  } = useMemo(() => {
    const gifs: string[] = [];
    const videos: string[] = [];
    const statics: string[] = [];
    const counts = new Map<string, number>();
    let root = 0;
    for (const p of customBgGallery) {
      if (isGifWallpaperPath(p)) {
        gifs.push(p);
      } else if (isVideoWallpaperPath(p)) {
        videos.push(p);
      } else {
        statics.push(p);
      }
      const sub = extractBgSubfolder(p);
      if (!sub) {
        root++;
      } else {
        counts.set(sub, (counts.get(sub) ?? 0) + 1);
      }
    }
    return {
      gifPaths: gifs,
      videoPaths: videos,
      staticPaths: statics,
      folderNames: Array.from(counts.keys()).sort(),
      folderCounts: counts,
      rootCount: root,
    };
  }, [customBgGallery]);

  useEffect(() => {
    if (
      folderFilter !== "all" &&
      folderFilter !== "" &&
      !folderCounts.has(folderFilter)
    ) {
      setFolderFilter("all");
    }
  }, [folderFilter, folderCounts]);

  const handleSelectWallpaper = useCallback(
    (filePath: string) => {
      setCustomBgImage(filePath);
    },
    [setCustomBgImage]
  );

  const handleDeleteWallpaper = useCallback(
    (filePath: string) => {
      void deleteCustomBgImage(filePath);
    },
    [deleteCustomBgImage]
  );

  const mediaFilteredGallery =
    mediaFilter === "gif"
      ? gifPaths
      : mediaFilter === "video"
        ? videoPaths
        : mediaFilter === "image"
          ? staticPaths
          : customBgGallery;

  const visibleGallery = useMemo(() => {
    if (folderFilter === "all") return mediaFilteredGallery;
    return mediaFilteredGallery.filter(
      (p) => extractBgSubfolder(p) === folderFilter
    );
  }, [mediaFilteredGallery, folderFilter]);

  const isActiveImageGif =
    wallpaperKind === "image" &&
    Boolean(customBgImage) &&
    isGifWallpaperPath(customBgImage);

  const isActiveImageVideo =
    wallpaperKind === "image" &&
    Boolean(customBgImage) &&
    isVideoWallpaperPath(customBgImage);

  const hasBackdrop = hasActiveVisualBackdrop(
    wallpaperKind,
    customBgImage,
    asciiMagicSlug
  );

  const activeVideoBadge = isActiveImageVideo
    ? getVideoWallpaperExtBadge(customBgImage) ?? "VIDEO"
    : "";

  const activeLabel =
    wallpaperKind === "ascii_preset"
      ? `ASCII · ${
          ASCII_PRESETS.find((preset) => preset.id === asciiPreset)?.name ??
          asciiPreset
        }`
      : wallpaperKind === "ascii_magic" && asciiMagicSlug
        ? `Catalog · ${asciiMagicSlug}`
        : wallpaperKind === "image" && customBgImage
          ? `${
              isActiveImageGif
                ? "GIF · "
                : isActiveImageVideo
                  ? `${activeVideoBadge} · `
                  : ""
            }${folderNameFromPath(customBgImage)}`
          : "";

  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col overflow-hidden">
      <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <ImageIcon className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          <span className="font-mono text-[10.5px] font-semibold text-fg uppercase tracking-wider shrink-0">
            WALLPAPERS &amp; ASCII
          </span>
          <span className="text-[10px] font-mono text-fg-2 bg-surface-3 px-1.5 py-0.2 rounded-xs border border-line shrink-0">
            {customBgGallery.length}
          </span>
          {activeLabel && (
            <span className="text-[10.5px] font-mono text-fg-2 truncate">
              {activeLabel}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {hasBackdrop && (
            <button
              type="button"
              onClick={() => setWallpaperKind("none")}
              className="h-[22px] px-2 bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg rounded-xs inline-flex items-center text-[10.5px] transition-colors cursor-pointer"
              title="Clear active backdrop"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => void openCustomBgFolder()}
            className="w-[22px] h-[22px] bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg rounded-xs flex items-center justify-center transition-colors cursor-pointer"
            title="Open wallpapers folder in File Explorer"
          >
            <FolderOpen className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => void loadCustomBgGallery()}
            className="w-[22px] h-[22px] bg-surface-2 hover:bg-surface-3 border border-line text-fg-2 hover:text-fg rounded-xs flex items-center justify-center transition-colors cursor-pointer"
            title="Refresh gallery"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => void selectCustomBgImageFile()}
            className="h-[22px] px-2.5 bg-accent hover:bg-accent-hover text-accent-on rounded-xs inline-flex items-center space-x-1 text-[10.5px] font-semibold transition-colors shadow-xs cursor-pointer"
            title="Add wallpaper image(s), GIF(s), or MP4/WebM loop video(s)"
          >
            <Plus className="w-3 h-3 shrink-0" />
            <span>Add</span>
          </button>
        </div>
      </div>

      <div className="p-2.5 grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)] gap-3 items-start">
        <AsciiWallpaperSection />

        <div className="border-t border-line pt-2.5 xl:border-t-0 xl:pt-0 xl:border-l xl:pl-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-2 flex items-center space-x-1.5">
              <ImageIcon className="w-3 h-3 text-accent-fg shrink-0" />
              <span>Uploaded Wallpapers</span>
              <span className="text-fg-3">
                ({visibleGallery.length}/{customBgGallery.length})
              </span>
            </span>

            <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line gap-0.5">
              {(
                [
                  {
                    id: "all" as const,
                    label: "All",
                    count: customBgGallery.length,
                    hasActive:
                      wallpaperKind === "image" && Boolean(customBgImage),
                  },
                  {
                    id: "image" as const,
                    label: "Images",
                    count: staticPaths.length,
                    hasActive:
                      wallpaperKind === "image" &&
                      Boolean(customBgImage) &&
                      !isActiveImageGif &&
                      !isActiveImageVideo,
                  },
                  {
                    id: "video" as const,
                    label: "Videos",
                    count: videoPaths.length,
                    hasActive: isActiveImageVideo,
                  },
                  {
                    id: "gif" as const,
                    label: "GIFs",
                    count: gifPaths.length,
                    hasActive: isActiveImageGif,
                  },
                ]
              ).map((tab) => {
                const active = mediaFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMediaFilter(tab.id)}
                    className={`relative h-[18px] px-2 rounded-xs inline-flex items-center justify-center space-x-1 text-[10px] font-medium transition-colors cursor-pointer ${
                      active
                        ? "bg-accent text-accent-on font-semibold shadow-xs"
                        : "text-fg-3 hover:text-fg"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`font-mono text-[9px] ${
                        active ? "text-accent-on" : "text-fg-3"
                      }`}
                    >
                      {tab.count}
                    </span>
                    {tab.hasActive && !active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 inset-x-2 h-[2px] rounded-full bg-accent pointer-events-none"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {folderNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setFolderFilter("all")}
                className={`h-[18px] px-2 rounded-xs border text-[9.5px] font-mono transition-colors cursor-pointer ${
                  folderFilter === "all"
                    ? "border-accent bg-accent-soft text-fg font-semibold"
                    : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                }`}
              >
                All Folders ({customBgGallery.length})
              </button>
              {rootCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFolderFilter("")}
                  className={`h-[18px] px-2 rounded-xs border text-[9.5px] font-mono transition-colors cursor-pointer ${
                    folderFilter === ""
                      ? "border-accent bg-accent-soft text-fg font-semibold"
                      : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                  }`}
                >
                  Root ({rootCount})
                </button>
              )}
              {folderNames.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setFolderFilter(sub)}
                  className={`h-[18px] px-2 rounded-xs border text-[9.5px] font-mono transition-colors cursor-pointer max-w-[140px] truncate ${
                    folderFilter === sub
                      ? "border-accent bg-accent-soft text-fg font-semibold"
                      : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                  }`}
                  title={`Filter by subfolder: ${sub}`}
                >
                  {sub} ({folderCounts.get(sub) ?? 0})
                </button>
              ))}
            </div>
          )}

          {mediaFilter === "gif" && (
            <p className="text-[10px] text-fg-3 font-mono leading-tight">
              Tip: MP4/WebM loop videos use hardware decoding and significantly less RAM than large GIFs.
            </p>
          )}

          {mediaFilter === "video" && videoPaths.length === 0 ? (
            <div className="h-[112px] rounded-xs border border-dashed border-line bg-surface-sub px-3 flex flex-col items-center justify-center text-center gap-1.5">
              <div className="flex items-center space-x-1.5 text-[11px] font-medium text-fg-2">
                <Film className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                <span>No loop videos in library</span>
              </div>
              <span className="text-[10px] font-mono text-fg-3">
                Add lightweight .mp4 or .webm loops (hardware decoded, auto-pauses in background)
              </span>
              <button
                type="button"
                onClick={() => void selectCustomBgImageFile()}
                className="mt-0.5 h-[22px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg rounded-xs inline-flex items-center space-x-1 text-[10px] font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 text-accent-fg shrink-0" />
                <span>Add Loop Video</span>
              </button>
            </div>
          ) : mediaFilter === "gif" && gifPaths.length === 0 ? (
            <div className="h-[112px] rounded-xs border border-dashed border-line bg-surface-sub px-3 flex flex-col items-center justify-center text-center gap-1.5">
              <div className="flex items-center space-x-1.5 text-[11px] font-medium text-fg-2">
                <Film className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                <span>No GIF wallpapers in library</span>
              </div>
              <span className="text-[10px] font-mono text-fg-3">
                Drop .gif files into the wallpapers folder or click Add
              </span>
              <button
                type="button"
                onClick={() => void selectCustomBgImageFile()}
                className="mt-0.5 h-[22px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg rounded-xs inline-flex items-center space-x-1 text-[10px] font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 text-accent-fg shrink-0" />
                <span>Add GIF Wallpaper</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-2 2xl:grid-cols-3 gap-2 auto-rows-max max-h-[168px] xl:max-h-[224px] overflow-y-auto pr-1">
              {visibleGallery.map((imgFilePath) => (
                <WallpaperTile
                  key={imgFilePath}
                  filePath={imgFilePath}
                  subfolder={extractBgSubfolder(imgFilePath)}
                  isSelected={
                    wallpaperKind === "image" && customBgImage === imgFilePath
                  }
                  onSelect={handleSelectWallpaper}
                  onDelete={handleDeleteWallpaper}
                />
              ))}

              <button
                type="button"
                onClick={() => void selectCustomBgImageFile()}
                className="aspect-video w-full rounded-xs border border-dashed border-line hover:border-accent bg-surface-sub hover:bg-surface-2 flex items-center justify-center cursor-pointer text-fg-3 hover:text-accent-fg"
                title="Add wallpaper image(s), GIF(s), or MP4/WebM loop video(s)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
