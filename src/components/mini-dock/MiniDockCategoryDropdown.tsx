import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, FileAudio, Layers, Scissors } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import type { FavoritesViewTab } from "../../types";

/**
 * Compact Option A single-button portal dropdown for Mini Dock Favorites & Trash
 * (`Tracks | Slices | Layers`), matching Audify's custom themed dropdown language.
 */
export const MiniDockCategoryDropdown: React.FC = () => {
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const favoritesViewTab = useSampleStore((s) => s.favoritesViewTab);
  const favoritesCount = useSampleStore((s) => s.favoritesCount);
  const sliceHistory = useSampleStore((s) => s.sliceHistory);
  const layerHistory = useSampleStore((s) => s.layerHistory);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const trashViewTab = useSampleStore((s) => s.trashViewTab);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const trashedSliceCount = useSampleStore((s) => s.trashedSliceCount);
  const trashedLayerCount = useSampleStore((s) => s.trashedLayerCount);

  const setFavoritesViewTab = useSampleStore((s) => s.setFavoritesViewTab);
  const setTrashViewTab = useSampleStore((s) => s.setTrashViewTab);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const favSliceCount = useMemo(
    () => sliceHistory.reduce((acc, s) => acc + (s.is_favorite ? 1 : 0), 0),
    [sliceHistory]
  );
  const favLayerCount = useMemo(
    () => layerHistory.reduce((acc, l) => acc + (l.is_favorite ? 1 : 0), 0),
    [layerHistory]
  );

  const isTrash = trashFilterActive && !favoriteOnly;
  const activeTab: FavoritesViewTab = isTrash ? trashViewTab : favoritesViewTab;

  const items: ReadonlyArray<{
    id: FavoritesViewTab;
    label: string;
    count: number;
    icon: React.ReactNode;
  }> = [
    {
      id: "tracks",
      label: "Tracks",
      count: isTrash ? trashedCount ?? 0 : favoritesCount ?? 0,
      icon: <FileAudio className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: "slices",
      label: "Slices",
      count: isTrash ? trashedSliceCount ?? 0 : favSliceCount,
      icon: <Scissors className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: "layers",
      label: "Layers",
      count: isTrash ? trashedLayerCount ?? 0 : favLayerCount,
      icon: <Layers className="w-3.5 h-3.5 shrink-0" />,
    },
  ];

  const activeItem = items.find((i) => i.id === activeTab) ?? items[0];

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 156;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = Math.min(rect.bottom + 4, window.innerHeight - 110);
    setCoords({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!favoriteOnly && !trashFilterActive) return null;

  const handleSelect = (tab: FavoritesViewTab) => {
    setOpen(false);
    if (isTrash) {
      setTrashViewTab(tab);
    } else {
      setFavoritesViewTab(tab);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${isTrash ? "Trash" : "Favorites"} category: ${activeItem.label} (${activeItem.count})`}
        className="h-[28px] px-2 rounded-xs bg-accent-soft border border-accent text-accent-fg font-mono tabular-nums text-[10.5px] inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
      >
        {activeItem.icon}
        <span>{activeItem.count.toLocaleString()}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${isTrash ? "Trash" : "Favorites"} category`}
            data-popover-portal="true"
            data-mica-overlay="true"
            style={{
              top: coords.top,
              left: coords.left,
              zIndex: Z_INDEX.floatingMenu,
            }}
            className="fixed w-[156px] bg-surface-2 border border-line-strong rounded-md py-1 shadow-2xl text-[11px] text-fg"
          >
            {items.map((item) => {
              const selected = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => handleSelect(item.id)}
                  className={`w-full h-[26px] px-2.5 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    selected
                      ? "bg-accent-soft text-accent-fg font-medium"
                      : "text-fg-2 hover:text-fg hover:bg-surface-hover"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    {item.icon}
                    <span>{item.label}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[10px] text-fg-3">
                    <span>{item.count.toLocaleString()}</span>
                    {selected && <Check className="w-3 h-3 text-accent-fg" />}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
};
