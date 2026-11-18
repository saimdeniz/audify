import React, { useEffect, useMemo, useState } from "react";
import {
  FolderPlus,
  Hash,
  Inbox,
  Layers,
  Music,
  Star,
  Trash2,
} from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { filterVisibleLibraries, folderNameFromPath } from "../../utils/format";

interface DropOverlayEventDetail {
  isExternalFileDragActive?: boolean;
  dragHoverTarget?: string | null;
  hoveredRailTab?: string | null;
  isPointerInSidebar?: boolean;
}

interface DragDropFeedbackOverlayProps {
  compact?: boolean;
}

export const DragDropFeedbackOverlay: React.FC<
  DragDropFeedbackOverlayProps
> = ({ compact = false }) => {
  const libraries = useSampleStore((s) => s.libraries);
  const collections = useSampleStore((s) => s.collections);
  const tags = useSampleStore((s) => s.tags);
  const genres = useSampleStore((s) => s.genres);
  const folderFilter = useSampleStore((s) => s.folderFilter);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);
  const autoRouteCollectionDrops = useSampleStore(
    (s) => s.autoRouteCollectionDrops
  );
  const inAppDragSample = useSampleStore((s) => s.inAppDragSample);
  const inAppDragSamples = useSampleStore((s) => s.inAppDragSamples);

  const [overlayState, setOverlayState] = useState<{
    isExternalFileDragActive: boolean;
    dragHoverTarget: string | null;
  }>({
    isExternalFileDragActive: false,
    dragHoverTarget: null,
  });

  useEffect(() => {
    const handleDropOverlayEvent = (e: Event) => {
      const detail = (e as CustomEvent<DropOverlayEventDetail>).detail;
      if (!detail) return;
      setOverlayState({
        isExternalFileDragActive: Boolean(detail.isExternalFileDragActive),
        dragHoverTarget: detail.dragHoverTarget ?? null,
      });
    };
    window.addEventListener(
      "audify:folder-drop-overlay",
      handleDropOverlayEvent
    );
    return () =>
      window.removeEventListener(
        "audify:folder-drop-overlay",
        handleDropOverlayEvent
      );
  }, []);

  const draggedCount = useMemo(() => {
    if (!inAppDragSample) return 0;
    return inAppDragSamples.length > 0 ? inAppDragSamples.length : 1;
  }, [inAppDragSample, inAppDragSamples.length]);

  const trackWord = draggedCount === 1 ? "track" : "tracks";

  const activeFolderInfo = useMemo(() => {
    if (overlayState.dragHoverTarget?.startsWith("folder:")) {
      const rest = overlayState.dragHoverTarget.slice("folder:".length);
      const sepIdx = rest.indexOf(":");
      const rawPath = sepIdx >= 0 ? rest.slice(sepIdx + 1) : rest;
      return { path: rawPath, name: folderNameFromPath(rawPath, rawPath) };
    }
    if (folderFilter) {
      return {
        path: folderFilter,
        name: folderNameFromPath(folderFilter, folderFilter),
      };
    }
    const visibleLibs = filterVisibleLibraries(libraries);
    if (visibleLibs.length === 1) {
      return {
        path: visibleLibs[0].path,
        name: folderNameFromPath(visibleLibs[0].path, visibleLibs[0].name),
      };
    }
    return null;
  }, [overlayState.dragHoverTarget, folderFilter, libraries]);

  const descriptor = useMemo(() => {
    const target = overlayState.dragHoverTarget;

    // 1. In-App Track Drag over any Sidebar Drop Target or Rail Tab
    if (inAppDragSample !== null) {
      if (target === "favorites") {
        return {
          Icon: Star,
          accentClass: "text-accent-fg border-accent/60",
          titlePrefix: `Add ${draggedCount} ${trackWord} to `,
          titleHighlight: "Favorites",
          subtitle: "Marks selected audio files as Favorite (Shortcut: F).",
          badgeText: "Target: Library Views → Favorites",
        };
      }

      if (target === "bin") {
        return {
          Icon: Inbox,
          accentClass: "text-accent-fg border-accent/60",
          titlePrefix: `Add ${draggedCount} ${trackWord} to `,
          titleHighlight: "Session Bin",
          subtitle:
            "Stages selected audio files in your Session Bin for fast NLE timeline export.",
          badgeText: "Target: Session Bin (Shortcut: B)",
        };
      }

      if (target === "trash" && enableAdvancedFileOps) {
        return {
          Icon: Trash2,
          accentClass: "text-accent-fg border-accent/60",
          titlePrefix: `Move ${draggedCount} ${trackWord} to `,
          titleHighlight: "Trash",
          subtitle:
            "Moves files to Trash safely while keeping 100% of Favorites, Tags & Collections (Ctrl+Z to Undo).",
          badgeText: "Target: Trash",
        };
      }

      if (target?.startsWith("col-")) {
        const colId = parseInt(target.slice(4), 10);
        const col = collections.find((c) => c.id === colId);
        if (col) {
          const isRoot = !col.parent_id;
          const hasChildren = collections.some((c) => c.parent_id === col.id);
          const smartRoute =
            isRoot && hasChildren && Boolean(autoRouteCollectionDrops);
          return {
            Icon: Layers,
            accentClass: "text-accent-fg border-accent/60",
            titlePrefix: `Add ${draggedCount} ${trackWord} to `,
            titleHighlight: `"${col.name}"`,
            subtitle: smartRoute
              ? "Smart Route active — automatically sorts tracks into matching collection subfolders."
              : "Assigns selected audio files to this virtual Collection.",
            badgeText: `Collection: ${col.name}`,
          };
        }
      }

      if (target?.startsWith("tag-")) {
        const tagId = parseInt(target.slice(4), 10);
        const tag = tags.find((t) => t.id === tagId);
        if (tag) {
          return {
            Icon: Hash,
            accentClass: "text-accent-fg border-accent/60",
            titlePrefix: `Tag ${draggedCount} ${trackWord} with `,
            titleHighlight: `#${tag.name}`,
            subtitle: "Assigns this tag to all selected audio files.",
            badgeText: `Tag: #${tag.name}`,
          };
        }
      }

      if (target?.startsWith("genre-")) {
        const genreName = target.slice(6);
        if (genreName) {
          const matched = genres.find(
            (g) => g.name.toLowerCase() === genreName.toLowerCase()
          );
          const display = matched?.name || genreName;
          return {
            Icon: Music,
            accentClass: "text-accent-fg border-accent/60",
            titlePrefix: `Set Genre of ${draggedCount} ${trackWord} to `,
            titleHighlight: `"${display}"`,
            subtitle: "Assigns musical/SFX genre to all selected audio files.",
            badgeText: `Genre: ${display}`,
          };
        }
      }

      if (target?.startsWith("folder:") && enableAdvancedFileOps) {
        return {
          Icon: FolderPlus,
          accentClass: "text-accent-fg border-accent/60",
          titlePrefix: `Move ${draggedCount} ${trackWord} to `,
          titleHighlight: `"${activeFolderInfo?.name ?? "folder"}"`,
          subtitle:
            "Physically moves selected audio files on disk while preserving 100% of Favorites, Tags & Collections (Ctrl+Z to Undo).",
          badgeText: activeFolderInfo?.path
            ? `Target: ${activeFolderInfo.path}`
            : null,
        };
      }
    }

    // 2. External OS File Explorer Drag (when Disk Write Active is ON)
    if (overlayState.isExternalFileDragActive && enableAdvancedFileOps) {
      if (activeFolderInfo) {
        return {
          Icon: FolderPlus,
          accentClass: "text-accent-fg border-accent/60",
          titlePrefix: "Drop audio files into ",
          titleHighlight: `"${activeFolderInfo.name}"`,
          subtitle:
            "Copies external audio files (WAV, MP3, FLAC, OGG, AIFF, M4A, OPUS) into the active folder or hover any sidebar folder.",
          badgeText: `Target: ${activeFolderInfo.path}`,
        };
      }
      return {
        Icon: FolderPlus,
        accentClass: "text-accent-fg border-accent/60",
        titlePrefix: "Hover a folder in the sidebar to ",
        titleHighlight: "import audio files",
        subtitle:
          "Select or hover a destination folder in the Folders tree on the left to import external audio files directly.",
        badgeText: null,
      };
    }

    return null;
  }, [
    overlayState.dragHoverTarget,
    overlayState.isExternalFileDragActive,
    inAppDragSample,
    draggedCount,
    trackWord,
    enableAdvancedFileOps,
    collections,
    autoRouteCollectionDrops,
    tags,
    genres,
    activeFolderInfo,
  ]);

  if (!descriptor) return null;

  const { Icon } = descriptor;

  return (
    <div
      className="audify-drop-overlay-backdrop pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-accent/55 rounded-xs m-1 transition-opacity duration-150 select-none"
      style={{ zIndex: Z_INDEX.dragFeedback }}
    >
      <div
        className={`flex flex-col items-center text-center ${
          compact ? "max-w-[300px] px-4 py-3" : "max-w-[440px] px-6 py-5"
        }`}
      >
        <div
          className={`relative rounded-full bg-surface-2 border-[1.5px] ${
            descriptor.accentClass
          } flex items-center justify-center shadow-xl animate-audify-float-badge ${
            compact ? "w-[72px] h-[72px] mb-3" : "w-[104px] h-[104px] mb-4"
          }`}
        >
          <div className="absolute -inset-2 rounded-full border border-accent/45 animate-audify-pulse-ring pointer-events-none" />
          <Icon
            className={`${
              compact ? "w-8 h-8" : "w-11 h-11"
            } stroke-[1.75] shrink-0`}
          />
        </div>

        <div
          className={`${
            compact ? "text-[15px]" : "text-[19px]"
          } font-bold text-fg tracking-tight mb-1.5 leading-snug`}
        >
          {descriptor.titlePrefix}
          <span className="text-accent-fg">{descriptor.titleHighlight}</span>
        </div>

        <p
          className={`${
            compact ? "text-[11px]" : "text-[12.5px]"
          } text-fg-2 leading-relaxed`}
        >
          {descriptor.subtitle}
        </p>

        {descriptor.badgeText && (
          <div
            className={`mt-3 px-2.5 py-1 rounded-xs bg-surface-2 border border-line-strong font-mono ${
              compact
                ? "text-[9.5px] max-w-[260px]"
                : "text-[10px] max-w-[380px]"
            } text-fg-2 truncate shadow-sm`}
          >
            {descriptor.badgeText}
          </div>
        )}

        <div className="mt-3 text-[11px] text-fg-3">
          (Press{" "}
          <kbd className="px-1.5 py-0.5 rounded-[3px] bg-surface-3 border border-line font-mono text-[10px] text-fg-2">
            Escape
          </kbd>{" "}
          to cancel)
        </div>
      </div>
    </div>
  );
};
